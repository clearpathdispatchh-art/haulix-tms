// components/DailyDispatchBoard.jsx

import React, { useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  Package, Calendar, Clock, AlertCircle, CheckCircle, Truck, Anchor,
  FileText, Edit3, Trash2, Search, RefreshCw, ChevronDown, ChevronUp,
  X, Plus, DollarSign, Loader2, MapPin, User, Building, Filter,
  GripVertical, MoreHorizontal, TrendingUp, TrendingDown, Activity,
  Layers, ArrowRight, ArrowLeft, Timer, Navigation, Phone, Mail,
  CheckSquare, Square, Save, AlertTriangle, CalendarDays, Clock as ClockIcon,
  MessageSquare, Bell, History, AlertOctagon
} from 'lucide-react';

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

import { db } from '../firebase';

// ========== CONSTANTS ==========
const STATUS_STYLES = {
  'prepull': {
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    text: 'text-blue-800',
    badge: 'bg-blue-200 text-blue-900 border-blue-300',
    icon: '🔵',
    gradient: 'from-blue-50 to-blue-100'
  },
  'delivery': {
    bg: 'bg-yellow-100',
    border: 'border-yellow-300',
    text: 'text-yellow-800',
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    icon: '🟡',
    gradient: 'from-yellow-50 to-yellow-100'
  },
  'termination': {
    bg: 'bg-red-100',
    border: 'border-red-300',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-800 border-red-300',
    icon: '🔴',
    gradient: 'from-red-50 to-red-100'
  },
  'completed': {
    bg: 'bg-green-100',
    border: 'border-green-300',
    text: 'text-green-800',
    badge: 'bg-green-100 text-green-800 border-green-300',
    icon: '✅',
    gradient: 'from-green-50 to-green-100'
  },
  'pending_followup': {
    bg: 'bg-amber-100',
    border: 'border-amber-400',
    text: 'text-amber-800',
    badge: 'bg-amber-200 text-amber-900 border-amber-300',
    icon: '⏳',
    gradient: 'from-amber-50 to-amber-100'
  },
  'backdate_dropped': {
    bg: 'bg-orange-100',
    border: 'border-orange-400',
    text: 'text-orange-800',
    badge: 'bg-orange-200 text-orange-900 border-orange-300',
    icon: '📦',
    gradient: 'from-orange-50 to-orange-100'
  },
  'scheduled': {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-600',
    badge: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: '📋',
    gradient: 'from-gray-50 to-gray-100'
  }
};

const WORK_TYPES = {
  PREPULL: 'prepull',
  DELIVERY: 'delivery',
  TERMINATION: 'termination',
  COMPLETED: 'completed',
  PENDING_FOLLOWUP: 'pending_followup',
  BACKDATE_DROPPED: 'backdate_dropped'
};

const WORK_TYPE_LABELS = {
  [WORK_TYPES.PREPULL]: '🔵 Pre-Pull',
  [WORK_TYPES.DELIVERY]: '🟡 Delivery',
  [WORK_TYPES.TERMINATION]: '🔴 Termination',
  [WORK_TYPES.COMPLETED]: '✅ Completed',
  [WORK_TYPES.PENDING_FOLLOWUP]: '⏳ Pending Follow-Up',
  [WORK_TYPES.BACKDATE_DROPPED]: '📦 Back-Dated Drop'
};

// Time slots for the day
const TIME_SLOTS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
];

// ========== HELPER FUNCTIONS ==========

// Get today's date in local timezone
const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Date comparison helper that handles multiple formats
const isSameDay = (dateStr1, dateStr2) => {
  if (!dateStr1 || !dateStr2) return false;
  
  const normalizeDate = (dateStr) => {
    if (!dateStr) return null;
    // If it's already YYYY-MM-DD, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Try to parse as date (handles MM/DD/YYYY, DD/MM/YYYY, etc.)
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {}
    return null;
  };
  
  const normalized1 = normalizeDate(dateStr1);
  const normalized2 = normalizeDate(dateStr2);
  
  if (normalized1 && normalized2) {
    return normalized1 === normalized2;
  }
  
  return dateStr1 === dateStr2;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const formatTime = (timeStr) => {
  if (!timeStr) return '—';
  try {
    const time = timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr;
    const d = new Date(`2000-01-01T${time}:00`);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return timeStr;
  }
};

const getDaysBetween = (dateStr1, dateStr2) => {
  if (!dateStr1 || !dateStr2) return 0;
  try {
    const d1 = new Date(dateStr1 + 'T00:00:00');
    const d2 = new Date(dateStr2 + 'T00:00:00');
    const diffTime = Math.abs(d2 - d1);
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
};

// Updated getWorkType with isSameDay and Ready for Pickup
const getWorkType = (container, selectedDateStr) => {
  if (!selectedDateStr) selectedDateStr = getTodayDate();
  
  if (container.isDelivered && !container.isTerminated && container.status !== 'Ready for Billing') {
    const deliveryDate = container.deliveryDate || container.appointmentDate;
    if (deliveryDate && isSameDay(deliveryDate, selectedDateStr) === false) {
      try {
        const d1 = new Date(deliveryDate);
        const d2 = new Date(selectedDateStr);
        if (d1 < d2) {
          return WORK_TYPES.BACKDATE_DROPPED;
        }
      } catch (e) {}
    }
    if (deliveryDate && isSameDay(deliveryDate, selectedDateStr)) {
      return WORK_TYPES.PENDING_FOLLOWUP;
    }
    return WORK_TYPES.PENDING_FOLLOWUP;
  }
  
  // ✅ NEW: Ready for Pickup → Termination
  if (container.isReadyForPickup && container.readyForPickupDate && isSameDay(container.readyForPickupDate, selectedDateStr)) {
    return WORK_TYPES.TERMINATION;
  }
  
  if (container.isTerminated || container.status === 'Ready for Billing' || container.status === 'Completed') {
    return WORK_TYPES.COMPLETED;
  }
  if (container.isPrePull) {
    return WORK_TYPES.PREPULL;
  }
  if (container.appointmentDate) {
    return WORK_TYPES.DELIVERY;
  }
  return 'scheduled';
};

// Updated getProgressPercentage with selectedDate
const getProgressPercentage = (container, selectedDate) => {
  const workType = container.workType || getWorkType(container, selectedDate || getTodayDate());
  switch (workType) {
    case WORK_TYPES.PREPULL: return 25;
    case WORK_TYPES.DELIVERY: return 50;
    case WORK_TYPES.PENDING_FOLLOWUP: return 75;
    case WORK_TYPES.BACKDATE_DROPPED: return 70;
    case WORK_TYPES.TERMINATION: return 85;
    case WORK_TYPES.COMPLETED: return 100;
    default: return 0;
  }
};

// ========== MAIN COMPONENT ==========
const DailyDispatchBoard = ({
  companyId,
  onEdit,
  onDelete,
  onViewDetails,
  setFeedback,
  isAdmin,
  isDispatcher,
  isAccounting,
  selectedDate: propSelectedDate,
  preloadedContainers,
  skipInitialFetch,
  availableDrivers,
  onQuickAssign
}) => {
  const todayStr = getTodayDate();
  
  const [selectedDate, setSelectedDate] = useState(propSelectedDate || todayStr);
  const [containers, setContainers] = useState(preloadedContainers || []);
  const [loading, setLoading] = useState(!preloadedContainers);
  const [searchTerm, setSearchTerm] = useState('');
  const [workTypeFilter, setWorkTypeFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loadContainers, setLoadContainers] = useState([]);
  const [exportContainers, setExportContainers] = useState([]);
  const [sortField, setSortField] = useState('appointmentDate');
  const [sortDirection, setSortDirection] = useState('asc');
  const [viewMode, setViewMode] = useState('cards');
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [driverAssignment, setDriverAssignment] = useState({ containerId: null, driverName: '', truckNo: '' });
  const [updatingContainer, setUpdatingContainer] = useState(null);
  const [error, setError] = useState(null);
  const [pendingFollowupCount, setPendingFollowupCount] = useState(0);
  const [backdateDroppedCount, setBackdateDroppedCount] = useState(0);
  
  const [advancedFilters, setAdvancedFilters] = useState({
    driver: '',
    truck: '',
    terminal: '',
    customer: ''
  });

  const defaultDrivers = [
    { name: 'John Smith', phone: '555-0101' },
    { name: 'Mike Johnson', phone: '555-0102' },
    { name: 'Dave Wilson', phone: '555-0103' },
    { name: 'Robert Brown', phone: '555-0104' },
    { name: 'James Taylor', phone: '555-0105' }
  ];

  const drivers = availableDrivers || defaultDrivers;

  useEffect(() => {
    if (propSelectedDate) {
      setSelectedDate(propSelectedDate);
    }
  }, [propSelectedDate]);

  // ============================================================
  // ✅ FIX 1: MAIN USEFFECT - FETCH DATA, UPDATE SEPARATE STATES
  // ============================================================
  useEffect(() => {
    if (!companyId) return;
    
    if (skipInitialFetch && preloadedContainers) {
      const processed = preloadedContainers.map(c => ({
        ...c,
        workType: getWorkType(c, selectedDate),
        progress: getProgressPercentage(c, selectedDate)
      }));
      setContainers(processed);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const loadQuery = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', ['Open', 'Dispatched', 'In Transit', 'Delivered', 'Ready for Termination'])
    );

    const exportQuery = query(
      collection(db, 'companies', companyId, 'exports'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeLoads = onSnapshot(loadQuery,
      (snapshot) => {
        const loadList = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            _type: 'import',
            etaDate: data.etaDate || '',
            etaTime: data.etaTime || '',
            lfdDate: data.lfdDate || '',
            appointmentDate: data.appointmentDate || '',
            appointmentTime: data.appointmentTime || '',
            prepullDate: data.prepullDate || data.prePullDate || '',
            deliveryDate: data.deliveryDate || '',
            isPrePull: data.isPrePull || false,
            isDelivered: data.isDelivered || false,
            isTerminated: data.isTerminated || false,
            isReadyForPickup: data.isReadyForPickup || false,       // <-- ADDED
            readyForPickupDate: data.readyForPickupDate || '',      // <-- ADDED
            shippingLine: data.shippingLine || '',
            railCarrier: data.railCarrier || 'CN',
            terminal: data.terminal || '',
            delivery: data.delivery || '',
            driverName: data.legs?.[0]?.driverName || '',
            truckNo: data.legs?.[0]?.truckNo || '',
            status: data.status || 'Open',
            containerNo: data.containerNo || 'N/A',
            customerName: data.customerName || 'N/A'
          };
        });
        
        const processedLoads = loadList.map(c => ({
          ...c,
          workType: getWorkType(c, selectedDate),
          progress: getProgressPercentage(c, selectedDate)
        }));
        
        // ✅ ONLY update loadContainers - NOT containers
        setLoadContainers(processedLoads);
        setLoading(false);
      },
      (error) => {
        console.error('Loads fetch error:', error);
        setError(error.message || 'Failed to load import containers');
        setFeedback?.('❌ Failed to load import containers');
        setLoading(false);
      }
    );

    const unsubscribeExports = onSnapshot(exportQuery,
      (snapshot) => {
        const exportList = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            _type: 'export',
            containerNo: data.bookingNo || data.customer || 'N/A',
            customerName: data.customer || 'N/A',
            appointmentDate: data.loadingDate || data.erd || '',
            appointmentTime: '',
            terminal: data.releaseLocation || '',
            delivery: data.returnRail || '',
            shippingLine: data.ssl || '',
            etaDate: data.erd || '',
            etaTime: '',
            lfdDate: data.cutOff || '',
            prepullDate: data.prepullDate || '',
            deliveryDate: data.deliveryDate || '',
            isPrePull: false,
            isDelivered: data.isDelivered || false,
            isTerminated: data.isTerminated || false,
            isReadyForPickup: data.isReadyForPickup || false,       // <-- ADDED
            readyForPickupDate: data.readyForPickupDate || '',      // <-- ADDED
            status: 'Open',
            driverName: '',
            truckNo: '',
            railCarrier: 'CN',
            bookingNo: data.bookingNo || '',
            isLoaded: data.isLoaded || false,
            isConfirmed: data.isConfirmed || false
          };
        });
        
        const processedExports = exportList.map(c => ({
          ...c,
          workType: getWorkType(c, selectedDate),
          progress: getProgressPercentage(c, selectedDate)
        }));
        
        // ✅ ONLY update exportContainers - NOT containers
        setExportContainers(processedExports);
        setLoading(false);
      },
      (error) => {
        console.error('Exports fetch error:', error);
        setError(error.message || 'Failed to load export containers');
        setFeedback?.('❌ Failed to load export containers');
        setLoading(false);
      }
    );

    return () => {
      unsubscribeLoads();
      unsubscribeExports();
    };
  }, [companyId, setFeedback, skipInitialFetch, preloadedContainers, selectedDate]);

  // ============================================================
  // ✅ FIX 2: NEW USEEFFECT - COMBINE CONTAINERS
  // ============================================================
  useEffect(() => {
    const allContainers = [...loadContainers, ...exportContainers];
    setContainers(allContainers);
    
    const pending = allContainers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP);
    const backdated = allContainers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED);
    setPendingFollowupCount(pending.length);
    setBackdateDroppedCount(backdated.length);
  }, [loadContainers, exportContainers]);

  // ============================================================
  // ✅ FIX 3: FILTERING LOGIC WITH isSameDay AND READY FOR PICKUP
  // ============================================================
  const filteredAndSortedContainers = useMemo(() => {
    let filtered = [...containers];
    const today = selectedDate || todayStr;
    
    filtered = filtered.filter(c => {
  // 1. EXCLUDE completed/paid/closed/ready-for-billing/terminated loads
  if (c.status === 'Completed' || c.status === 'Paid' || c.status === 'Closed' || c.status === 'Ready for Billing' || c.isTerminated === true) {
    return false;
  }
      
      // 2. ALWAYS SHOW BACK-DATED DROPS
      const isBackdatedDrop = c.isDelivered && !c.isTerminated && 
                              c.status !== 'Ready for Billing' &&
                              c.deliveryDate && 
                              isSameDay(c.deliveryDate, today) === false;
      
      let isBeforeToday = false;
      if (isBackdatedDrop) {
        try {
          const d1 = new Date(c.deliveryDate);
          const d2 = new Date(today);
          isBeforeToday = d1 < d2;
        } catch (e) {
          isBeforeToday = false;
        }
      }
      
      if (isBackdatedDrop && isBeforeToday) return true;
      
      // 3. CHECK FOR PENDING FOLLOW-UP (dropped on selected date)
      const isPendingFollowup = c.isDelivered && !c.isTerminated && 
                                c.status !== 'Ready for Billing' &&
                                c.deliveryDate && 
                                isSameDay(c.deliveryDate, today);
      
      // 4. Check each possible date field against selected date
      const hasAppointmentToday = isSameDay(c.appointmentDate, today);
      const hasPrepullToday = isSameDay(c.prepullDate, today) && c.isPrePull === true;
      const hasDeliveryToday = isSameDay(c.deliveryDate, today);
      const hasReturnToday = isSameDay(c.returnDate, today);
      const hasEtaToday = isSameDay(c.etaDate, today);
      const hasLoadingDateToday = isSameDay(c.loadingDate, today);
      const hasErdToday = isSameDay(c.erd, today);
      const hasReadyForPickupToday = isSameDay(c.readyForPickupDate, today) && c.isReadyForPickup === true;
      
      return isPendingFollowup || 
             hasAppointmentToday || 
             hasPrepullToday || 
             hasDeliveryToday || 
             hasReturnToday || 
             hasEtaToday || 
             hasLoadingDateToday || 
             hasErdToday ||
             hasReadyForPickupToday;  // <-- CORRECTLY INCLUDED
    });
    
    if (workTypeFilter !== 'all') {
      filtered = filtered.filter(c => c.workType === workTypeFilter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(c =>
        c.containerNo?.toLowerCase().includes(term) ||
        c.customerName?.toLowerCase().includes(term) ||
        c.poNumber?.toLowerCase().includes(term) ||
        c.pickupNo?.toLowerCase().includes(term) ||
        c.driverName?.toLowerCase().includes(term) ||
        c.truckNo?.toLowerCase().includes(term)
      );
    }

    if (advancedFilters.driver) {
      filtered = filtered.filter(c => c.driverName?.toLowerCase().includes(advancedFilters.driver.toLowerCase()));
    }
    if (advancedFilters.truck) {
      filtered = filtered.filter(c => c.truckNo?.toLowerCase().includes(advancedFilters.truck.toLowerCase()));
    }
    if (advancedFilters.terminal) {
      filtered = filtered.filter(c => c.terminal?.toLowerCase().includes(advancedFilters.terminal.toLowerCase()));
    }
    if (advancedFilters.customer) {
      filtered = filtered.filter(c => c.customerName?.toLowerCase().includes(advancedFilters.customer.toLowerCase()));
    }

    filtered.sort((a, b) => {
      const aIsBackdated = a.workType === WORK_TYPES.BACKDATE_DROPPED;
      const bIsBackdated = b.workType === WORK_TYPES.BACKDATE_DROPPED;
      
      if (aIsBackdated && !bIsBackdated) return -1;
      if (!aIsBackdated && bIsBackdated) return 1;
      
      if (aIsBackdated && bIsBackdated) {
        return (a.deliveryDate || '').localeCompare(b.deliveryDate || '');
      }
      
      let valA, valB;
      switch (sortField) {
        case 'appointmentDate':
          valA = a.appointmentDate || '9999-99-99';
          valB = b.appointmentDate || '9999-99-99';
          break;
        case 'containerNo':
          valA = a.containerNo || '';
          valB = b.containerNo || '';
          break;
        case 'customerName':
          valA = a.customerName || '';
          valB = b.customerName || '';
          break;
        case 'workType':
          const order = ['prepull', 'delivery', 'pending_followup', 'backdate_dropped', 'termination', 'completed'];
          valA = order.indexOf(a.workType);
          valB = order.indexOf(b.workType);
          break;
        default:
          valA = a[sortField] || '';
          valB = b[sortField] || '';
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [containers, workTypeFilter, searchTerm, sortField, sortDirection, selectedDate, todayStr, advancedFilters]);

  const pendingFollowupContainers = useMemo(() => {
    return containers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP);
  }, [containers]);

  const backdateDroppedContainers = useMemo(() => {
    return containers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED);
  }, [containers]);

  const stats = useMemo(() => {
    const todayContainers = filteredAndSortedContainers;
    return {
      total: todayContainers.length,
      imports: todayContainers.filter(c => c._type === 'import').length,
      exports: todayContainers.filter(c => c._type === 'export').length,
      prepull: todayContainers.filter(c => c.workType === WORK_TYPES.PREPULL).length,
      delivery: todayContainers.filter(c => c.workType === WORK_TYPES.DELIVERY).length,
      pending_followup: todayContainers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP).length,
      backdate_dropped: todayContainers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED).length,
      termination: todayContainers.filter(c => c.workType === WORK_TYPES.TERMINATION).length,
      completed: todayContainers.filter(c => c.workType === WORK_TYPES.COMPLETED).length,
      progress: todayContainers.length > 0 
        ? Math.round(todayContainers.reduce((sum, c) => sum + c.progress, 0) / todayContainers.length)
        : 0
    };
  }, [filteredAndSortedContainers]);

  const driverWorkload = useMemo(() => {
    const workload = {};
    filteredAndSortedContainers.forEach(c => {
      if (c.driverName) {
        workload[c.driverName] = (workload[c.driverName] || 0) + 1;
      }
    });
    return workload;
  }, [filteredAndSortedContainers]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      setFeedback?.('✅ Data refreshed');
    }, 1000);
  };

  const handleQuickStatusChange = async (containerId, newStatus) => {
    setUpdatingContainer(containerId);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', containerId);
      const updates = { updatedAt: new Date().toISOString() };

      switch (newStatus) {
        case WORK_TYPES.PREPULL:
          updates.isPrePull = true;
          updates.prepullDate = selectedDate;
          break;
        case WORK_TYPES.DELIVERY:
          updates.isPrePull = false;
          updates.isDelivered = true;
          updates.deliveryDate = selectedDate;
          break;
        case WORK_TYPES.TERMINATION:
          updates.isDelivered = false;
          updates.isTerminated = true;
          break;
        case WORK_TYPES.COMPLETED:
          updates.isTerminated = false;
          updates.status = 'Ready for Billing';
          break;
        default:
          break;
      }

      await updateDoc(loadRef, updates);
      setFeedback?.(`✅ Status updated to ${WORK_TYPE_LABELS[newStatus]}`);
    } catch (error) {
      console.error('Status update error:', error);
      setFeedback?.('❌ Failed to update status');
    } finally {
      setUpdatingContainer(null);
    }
  };

  const handleConfirmReady = async (containerId) => {
    setUpdatingContainer(containerId);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', containerId);
      await updateDoc(loadRef, {
        isReadyForTermination: true,
        readyForTerminationAt: new Date().toISOString(),
        status: 'Ready for Termination',
        updatedAt: new Date().toISOString()
      });
      setFeedback?.('✅ Customer confirmed - ready for termination');
    } catch (error) {
      console.error('Confirm ready error:', error);
      setFeedback?.('❌ Failed to update status');
    } finally {
      setUpdatingContainer(null);
    }
  };

  const [bulkUpdating, setBulkUpdating] = useState(false);
  
  const handleBulkStatusChange = async (newStatus) => {
    if (selectedContainers.size === 0) {
      setFeedback?.('⚠️ No containers selected');
      return;
    }

    setBulkUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedContainers.forEach(id => {
        const loadRef = doc(db, 'companies', companyId, 'loads', id);
        const updates = { updatedAt: new Date().toISOString() };
        
        switch (newStatus) {
          case WORK_TYPES.PREPULL:
            updates.isPrePull = true;
            updates.prepullDate = selectedDate;
            break;
          case WORK_TYPES.DELIVERY:
            updates.isPrePull = false;
            updates.isDelivered = true;
            updates.deliveryDate = selectedDate;
            break;
          case WORK_TYPES.TERMINATION:
            updates.isDelivered = false;
            updates.isTerminated = true;
            break;
          case WORK_TYPES.COMPLETED:
            updates.isTerminated = false;
            updates.status = 'Ready for Billing';
            break;
          default:
            break;
        }
        
        batch.update(loadRef, updates);
      });

      await batch.commit();
      setFeedback?.(`✅ ${selectedContainers.size} containers updated to ${WORK_TYPE_LABELS[newStatus]}`);
      setSelectedContainers(new Set());
    } catch (error) {
      console.error('Bulk update error:', error);
      setFeedback?.('❌ Failed to update containers');
    } finally {
      setBulkUpdating(false);
    }
  };

  const [assigningDriver, setAssigningDriver] = useState(false);

  const handleAssignDriver = async (containerId, driverName, truckNo) => {
    setAssigningDriver(true);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', containerId);
      const container = containers.find(c => c.id === containerId);
      const currentLegs = container?.legs || [];
      
      const updatedLegs = currentLegs.length > 0 
        ? [{ ...currentLegs[0], driverName, truckNo }, ...currentLegs.slice(1)]
        : [{ id: Date.now(), from: '', to: '', driverName, truckNo, status: 'Assigned' }];

      await updateDoc(loadRef, {
        legs: updatedLegs,
        updatedAt: new Date().toISOString()
      });
      
      setFeedback?.(`✅ Driver ${driverName} assigned to ${container?.containerNo}`);
      setShowDriverModal(false);
    } catch (error) {
      console.error('Driver assignment error:', error);
      setFeedback?.('❌ Failed to assign driver');
    } finally {
      setAssigningDriver(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedContainers.size === filteredAndSortedContainers.length) {
      setSelectedContainers(new Set());
    } else {
      setSelectedContainers(new Set(filteredAndSortedContainers.map(c => c.id)));
    }
  };

  const toggleSelectContainer = (id) => {
    const newSelected = new Set(selectedContainers);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedContainers(newSelected);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        <div className="text-center">
          <p className="text-slate-500 font-bold">Loading dispatch board...</p>
          <p className="text-xs text-slate-400 mt-1">Fetching containers for {formatDate(selectedDate)}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="font-black text-red-800 text-lg mb-2">Failed to Load Data</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-600" />
            Today's Board
          </h2>
          <p className="text-sm text-slate-500 font-medium flex items-center gap-2">
            {formatDate(selectedDate)} • {stats.total} containers
            {backdateDroppedCount > 0 && (
              <span className="flex items-center gap-1 text-orange-600 text-xs font-bold bg-orange-50 px-2 py-0.5 rounded-full">
                <AlertOctagon className="w-3 h-3" />
                {backdateDroppedCount} from previous dates
              </span>
            )}
            <span className="flex items-center gap-1 text-blue-600 text-xs font-bold bg-blue-50 px-2 py-0.5 rounded-full">
              <Activity className="w-3 h-3" />
              {stats.progress}% complete
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 text-xs font-bold transition-all ${
                viewMode === 'cards' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >📋 Cards</button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 text-xs font-bold transition-all ${
                viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >📊 Table</button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-2 text-xs font-bold transition-all ${
                viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >⏰ Timeline</button>
          </div>

          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-sm transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* BACK-DATED DROPS ALERT SECTION */}
      {backdateDroppedContainers.length > 0 && (
        <div className="bg-orange-50 border-2 border-orange-400 rounded-[32px] p-6 animate-in slide-in-from-top-4 relative overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <History className="w-32 h-32 text-orange-600" />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-orange-100 p-3 rounded-2xl text-orange-700 shadow-sm">
                <AlertOctagon className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-black text-2xl text-orange-900 tracking-tight">
                  📦 Back-Dated Drops — Action Required
                </h3>
                <p className="text-orange-800 font-bold text-sm">
                  {backdateDroppedContainers.length} container{backdateDroppedContainers.length > 1 ? 's' : ''} 
                  dropped at customer on previous dates — please follow up and plan termination
                </p>
                <p className="text-orange-600 text-xs mt-1 font-medium">
                  These containers were delivered before today and need customer confirmation
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {backdateDroppedContainers.map(container => {
                const isExport = container._type === 'export';
                const daysSinceDrop = getDaysBetween(container.deliveryDate, selectedDate);
                
                return (
                  <div 
                    key={container.id}
                    className="bg-white p-5 rounded-2xl border border-orange-200 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-orange-300 transition-all cursor-pointer"
                    onClick={() => onEdit && onEdit(container)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-black text-slate-800 text-lg flex items-center gap-2">
                          {container.containerNo || 'N/A'}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            isExport ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {isExport ? '📤 EXPORT' : '📥 IMPORT'}
                          </span>
                        </div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                          {container.customerName || 'N/A'}
                        </div>
                      </div>
                      <div className="bg-orange-100 text-orange-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase border border-orange-200">
                        {isExport ? 'LOADED 📦' : 'DROPPED 📦'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Calendar className="w-3.5 h-3.5 text-orange-500" />
                      <span>Dropped: {formatDate(container.deliveryDate)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        daysSinceDrop > 5 ? 'bg-red-100 text-red-700' : 
                        daysSinceDrop > 3 ? 'bg-orange-100 text-orange-700' : 
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {daysSinceDrop}d ago
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-orange-500" />
                      <span className="truncate">{container.delivery || container.terminal || 'Customer Location'}</span>
                    </div>

                    {daysSinceDrop > 3 && (
                      <div className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Urgent — {daysSinceDrop} days since drop!</span>
                      </div>
                    )}

                    <div className="pt-3 mt-auto flex gap-2 border-t border-slate-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmReady(container.id);
                        }}
                        disabled={updatingContainer === container.id}
                        className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {updatingContainer === container.id ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Updating...
                          </span>
                        ) : (
                          '✅ Confirm Ready'
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEdit) onEdit(container);
                        }}
                        className="flex-1 py-2 bg-orange-600 text-white rounded-xl font-bold text-xs hover:bg-orange-700 shadow-md shadow-orange-200 transition-all active:scale-95"
                      >
                        📝 Plan Termination
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* PENDING FOLLOW-UP ALERT SECTION */}
      {pendingFollowupContainers.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-[32px] p-6 animate-in slide-in-from-top-4 relative overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Bell className="w-32 h-32 text-amber-600" />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm">
                <ClockIcon className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-black text-2xl text-amber-900 tracking-tight">
                  ⏳ Pending Customer Follow-Up (Today)
                </h3>
                <p className="text-amber-800 font-bold text-sm">
                  {pendingFollowupContainers.length} container{pendingFollowupContainers.length > 1 ? 's' : ''} 
                  dropped today — waiting for confirmation
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingFollowupContainers.map(container => {
                const isExport = container._type === 'export';
                
                return (
                  <div 
                    key={container.id}
                    className="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-amber-300 transition-all cursor-pointer"
                    onClick={() => onEdit && onEdit(container)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-black text-slate-800 text-lg flex items-center gap-2">
                          {container.containerNo || 'N/A'}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            isExport ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {isExport ? '📤 EXPORT' : '📥 IMPORT'}
                          </span>
                        </div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                          {container.customerName || 'N/A'}
                        </div>
                      </div>
                      <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase border border-amber-200">
                        {isExport ? 'LOADED ⏳' : 'EMPTY ⏳'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-amber-500" />
                      <span className="truncate">{container.delivery || container.terminal || 'Customer Location'}</span>
                    </div>

                    {container.deliveryDate && (
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Dropped: {formatDate(container.deliveryDate)}</span>
                      </div>
                    )}

                    <div className="pt-3 mt-auto flex gap-2 border-t border-slate-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmReady(container.id);
                        }}
                        disabled={updatingContainer === container.id}
                        className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {updatingContainer === container.id ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Updating...
                          </span>
                        ) : (
                          '✅ Confirm Ready'
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEdit) onEdit(container);
                        }}
                        className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold text-xs hover:bg-amber-700 shadow-md shadow-amber-200 transition-all active:scale-95"
                      >
                        📝 Plan Termination
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODERN STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer"
             onClick={() => setWorkTypeFilter('all')}>
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-slate-600" />
            </div>
            <span className="text-2xl font-black text-slate-900">{stats.total}</span>
          </div>
          <div className="mt-2 text-[10px] font-black text-slate-400 uppercase">Total</div>
        </div>

        {Object.entries(WORK_TYPES).map(([key, value]) => {
          const style = STATUS_STYLES[value];
          const icons2 = { 
            PREPULL: Truck, DELIVERY: Navigation, PENDING_FOLLOWUP: Bell,
            BACKDATE_DROPPED: History, TERMINATION: Anchor, COMPLETED: CheckCircle 
          };
          const IconComponent = icons2[key];
          
          return (
            <div key={value}
              className={`${style.bg} p-4 rounded-2xl border ${style.border} shadow-sm hover:shadow-md transition-all cursor-pointer ${
                key === 'PENDING_FOLLOWUP' ? 'ring-2 ring-amber-400 ring-offset-1' : 
                key === 'BACKDATE_DROPPED' ? 'ring-2 ring-orange-400 ring-offset-1' : ''
              }`}
              onClick={() => setWorkTypeFilter(workTypeFilter === value ? 'all' : value)}>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-white/50 rounded-xl flex items-center justify-center">
                  <IconComponent className={`w-5 h-5 ${style.text}`} />
                </div>
                <span className={`text-2xl font-black ${style.text}`}>{stats[value] || 0}</span>
              </div>
              <div className={`mt-2 text-[9px] font-black uppercase ${style.text}`}>
                {value === 'backdate_dropped' ? '📦 Back-Dated' : key.charAt(0) + key.slice(1).toLowerCase()}
              </div>
            </div>
          );
        })}
      </div>

      {/* DRIVER WORKLOAD - SHOW ALL LOADS PER DRIVER */}
{Object.keys(driverWorkload).length > 0 && (
  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Driver Workload</h3>
    <div className="space-y-3">
      {Object.entries(driverWorkload).map(([driver, count]) => {
        // Get all containers for this driver
        const driverContainers = filteredAndSortedContainers.filter(c => c.driverName === driver);
        
        return (
          <div key={driver} className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
            {/* Driver Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-100 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-sm text-slate-700">{driver}</span>
              </div>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                count > 3 ? 'bg-red-100 text-red-700' : 
                count > 2 ? 'bg-yellow-100 text-yellow-700' : 
                'bg-green-100 text-green-700'
              }`}>
                {count} load{count > 1 ? 's' : ''}
              </span>
            </div>
            
            {/* ALL LOADS FOR THIS DRIVER */}
            <div className="divide-y divide-slate-100">
              {driverContainers.map(container => (
                <div 
                  key={container.id} 
                  className="px-4 py-3 hover:bg-white/50 transition-colors cursor-pointer"
                  onClick={() => onEdit && onEdit(container)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        container.status === 'Completed' ? 'bg-green-500' : 
                        container.status === 'In Transit' ? 'bg-blue-500' : 
                        'bg-yellow-500'
                      }`}></div>
                      <span className="font-bold text-sm text-slate-800">{container.containerNo}</span>
                    </div>
                    <span className="text-xs text-slate-400">{container.appointmentTime || 'TBD'}</span>
                  </div>
                  
                  <div className="mt-1 text-xs text-slate-500 truncate">{container.customerName}</div>
                  
                  <div className="mt-0.5 text-[10px] text-slate-400 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {container.delivery || container.terminal || 'No destination'}
                  </div>
                  
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      container.loadType === 'LIVE' ? 'bg-blue-100 text-blue-700' :
                      container.loadType === 'DROP' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {container.loadType || 'N/A'}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      container._type === 'export' ? 'bg-orange-100 text-orange-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {container._type === 'export' ? '📤 EXPORT' : '📥 IMPORT'}
                    </span>
                    {container.isPrePull && (
                      <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                        📦 Pre-Pull
                      </span>
                    )}
                    {container.workType === WORK_TYPES.BACKDATE_DROPPED && (
                      <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                        ⚠️ Back-Dated
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}

      {/* FILTERS & SEARCH */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input type="text" placeholder="Search container #, PO#, customer, driver..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" />
        </div>
        
        <select value={workTypeFilter} onChange={(e) => setWorkTypeFilter(e.target.value)}
          className="appearance-none w-full sm:w-48 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-sm pr-10 cursor-pointer">
          <option value="all">📋 All Types</option>
          <option value="prepull">🔵 Pre-Pull</option>
          <option value="delivery">🟡 Delivery</option>
          <option value="pending_followup">⏳ Pending Follow-Up</option>
          <option value="backdate_dropped">📦 Back-Dated Drops</option>
          <option value="termination">🔴 Termination</option>
          <option value="completed">✅ Completed</option>
        </select>

        <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
            showAdvancedFilters ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}>
          <Filter className="w-4 h-4" />
          Filters
          <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ADVANCED FILTERS */}
      {showAdvancedFilters && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Driver</label>
            <input type="text" value={advancedFilters.driver}
              onChange={e => setAdvancedFilters(prev => ({ ...prev, driver: e.target.value }))}
              className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Driver name..." />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Truck</label>
            <input type="text" value={advancedFilters.truck}
              onChange={e => setAdvancedFilters(prev => ({ ...prev, truck: e.target.value }))}
              className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Truck #..." />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Terminal</label>
            <input type="text" value={advancedFilters.terminal}
              onChange={e => setAdvancedFilters(prev => ({ ...prev, terminal: e.target.value }))}
              className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Terminal..." />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Customer</label>
            <input type="text" value={advancedFilters.customer}
              onChange={e => setAdvancedFilters(prev => ({ ...prev, customer: e.target.value }))}
              className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Customer..." />
          </div>
        </div>
      )}

      {/* BULK ACTIONS BAR */}
      {selectedContainers.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top">
          <span className="font-bold text-blue-700">
            {selectedContainers.size} container{selectedContainers.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap gap-2">
            <button 
              onClick={() => handleBulkStatusChange(WORK_TYPES.PREPULL)}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-blue-200 text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-300 disabled:opacity-50 disabled:cursor-not-allowed">
              {bulkUpdating ? 'Updating...' : '🔵 Pre-Pull'}
            </button>
            <button 
              onClick={() => handleBulkStatusChange(WORK_TYPES.DELIVERY)}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-yellow-200 text-yellow-900 rounded-lg text-xs font-bold hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed">
              {bulkUpdating ? 'Updating...' : '🟡 Deliver'}
            </button>
            <button 
              onClick={() => handleBulkStatusChange(WORK_TYPES.TERMINATION)}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-red-200 text-red-900 rounded-lg text-xs font-bold hover:bg-red-300 disabled:opacity-50 disabled:cursor-not-allowed">
              {bulkUpdating ? 'Updating...' : '🔴 Terminate'}
            </button>
            <button 
              onClick={() => handleBulkStatusChange(WORK_TYPES.COMPLETED)}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-green-200 text-green-900 rounded-lg text-xs font-bold hover:bg-green-300 disabled:opacity-50 disabled:cursor-not-allowed">
              {bulkUpdating ? 'Updating...' : '✅ Complete'}
            </button>
            <button 
              onClick={() => setSelectedContainers(new Set())}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* TIMELINE VIEW */}
      {viewMode === 'timeline' ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-[100px_repeat(14,1fr)] gap-1">
              <div className="text-[10px] font-black text-slate-400 uppercase">Driver</div>
              {TIME_SLOTS.map(time => (
                <div key={time} className="text-[9px] font-bold text-slate-400 text-center">
                  {formatTime(time)}
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {filteredAndSortedContainers.filter(c => c.workType !== WORK_TYPES.BACKDATE_DROPPED && c.workType !== WORK_TYPES.PENDING_FOLLOWUP).map(container => {
                const style = STATUS_STYLES[container.workType] || STATUS_STYLES.scheduled;
                const hourSlot = container.appointmentTime 
                  ? parseInt(container.appointmentTime.split(':')[0]) - 6
                  : 0;
                
                return (
                  <div key={container.id} className="grid grid-cols-[100px_repeat(14,1fr)] gap-1 items-center">
                    <div className="text-xs font-bold text-slate-700 truncate">
                      {container.driverName || 'TBD'}
                    </div>
                    {TIME_SLOTS.map((_, index) => (
                      <div key={index} className="h-8">
                        {index === Math.max(0, Math.min(13, hourSlot)) && (
                          <div className={`h-full rounded-lg ${style.bg} border ${style.border} flex items-center justify-center text-[9px] font-bold ${style.text} cursor-pointer hover:shadow-md transition-all`}
                            onClick={() => onEdit && onEdit(container)}>
                            {container.containerNo?.slice(-4)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            
            {backdateDroppedContainers.length > 0 && (
              <div className="mt-6 pt-4 border-t-2 border-dashed border-orange-300">
                <div className="text-[10px] font-black text-orange-600 uppercase mb-3">📦 Back-Dated Drops (No Time Slot)</div>
                <div className="flex flex-wrap gap-2">
                  {backdateDroppedContainers.map(container => (
                    <div key={container.id} 
                      className="bg-orange-100 border border-orange-300 rounded-lg px-3 py-1.5 text-xs font-bold text-orange-800 cursor-pointer hover:bg-orange-200"
                      onClick={() => onEdit && onEdit(container)}>
                      {container.containerNo} — {container.customerName?.substring(0, 15)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <th className="px-4 py-3 w-10">
                    <button onClick={toggleSelectAll}>
                      {selectedContainers.size === filteredAndSortedContainers.length && filteredAndSortedContainers.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('appointmentDate')}>
                    Date/Time {sortField === 'appointmentDate' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('containerNo')}>
                    Container {sortField === 'containerNo' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('customerName')}>
                    Customer {sortField === 'customerName' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedContainers.length === 0 ? (
                  <tr><td colSpan="10" className="px-6 py-12 text-center text-slate-400 font-bold italic">
                    No containers scheduled for {formatDate(selectedDate)}</td></tr>
                ) : (
                  filteredAndSortedContainers.map(container => {
                    const workType = container.workType;
                    const style = STATUS_STYLES[workType] || STATUS_STYLES.scheduled;
                    const isUpdating = updatingContainer === container.id;
                    const isExport = container._type === 'export';
                    const isBackdated = workType === WORK_TYPES.BACKDATE_DROPPED;
                    const isPending = workType === WORK_TYPES.PENDING_FOLLOWUP;
                    
                    return (
                      <tr key={container.id} 
                        className={`${style.bg} hover:shadow-md transition-all cursor-pointer group ${
                          isBackdated ? 'border-l-4 border-l-orange-400' : 
                          isPending ? 'border-l-4 border-l-amber-400' : ''
                        }`}>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => toggleSelectContainer(container.id)}>
                            {selectedContainers.has(container.id) ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : <Square className="w-4 h-4 text-slate-300" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {isBackdated ? (
                            <div>
                              <div className="font-bold text-sm text-orange-700">
                                {formatDate(container.deliveryDate)}
                              </div>
                              <div className="text-[8px] font-black text-orange-400 uppercase">
                                📦 BACK-DATED
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-sm">
                                {container.appointmentTime ? formatTime(container.appointmentTime) : '—'}
                              </div>
                              <div className="text-[8px] font-black text-slate-400 uppercase">
                                {isExport ? '📤 EXPORT' : '📥 IMPORT'}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border ${style.badge}`}>
                            {WORK_TYPE_LABELS[workType] || '📋 Scheduled'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-black text-slate-900">{container.containerNo || 'N/A'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{container.customerName || 'N/A'}</div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {isBackdated || isPending ? (
                            <span className={`font-bold flex items-center gap-1 ${isBackdated ? 'text-orange-600' : 'text-amber-600'}`}>
                              <MapPin className="w-3 h-3" />
                              {container.delivery || container.terminal || 'Customer'}
                            </span>
                          ) : workType === WORK_TYPES.PREPULL ? container.terminal || '—' :
                            workType === WORK_TYPES.TERMINATION ? 'Return to Yard' :
                            container.delivery || '—'}
                        </td>
                        <td className="px-4 py-3">
  <div className="flex items-center gap-1">
    {container.driverName ? (
      <span className="text-sm font-bold text-green-600">{container.driverName}</span>
    ) : (
      <button 
        onClick={(e) => {
          e.stopPropagation();
          const driverName = prompt('Enter driver name:');
          if (driverName && driverName.trim()) {
            const truckNo = prompt('Enter truck number:');
            if (truckNo && truckNo.trim()) {
              onQuickAssign && onQuickAssign(container.id, container.legs?.[0]?.id, driverName.trim(), truckNo.trim());
            }
          }
        }}
        className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors"
      >
        + Quick Assign
      </button>
    )}
    <button 
      onClick={(e) => {
        e.stopPropagation();
        setDriverAssignment({ 
          containerId: container.id, 
          driverName: container.driverName || '', 
          truckNo: container.truckNo || '' 
        });
        setShowDriverModal(true);
      }} 
      className="text-xs font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
    >
      {container.driverName ? 'Change' : 'Assign →'}
    </button>
  </div>
</td>
                        <td className="px-4 py-3 text-sm">{container.truckNo || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="w-20 bg-slate-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${
                              container.progress >= 100 ? 'bg-green-500' :
                              container.progress >= 70 ? 'bg-yellow-500' :
                              'bg-blue-500'
                            }`} style={{ width: `${container.progress}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(container); }}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {(isBackdated || isPending) && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConfirmReady(container.id);
                                }}
                                disabled={isUpdating}
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                                title="Confirm ready for termination">
                                {isUpdating ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedContainers.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-2xl border border-slate-200">
              No containers scheduled for {formatDate(selectedDate)}
            </div>
          ) : (
            filteredAndSortedContainers.map(container => {
              const workType = container.workType;
              const style = STATUS_STYLES[workType] || STATUS_STYLES.scheduled;
              const isUpdating = updatingContainer === container.id;
              const isExport = container._type === 'export';
              const isBackdated = workType === WORK_TYPES.BACKDATE_DROPPED;
              const isPending = workType === WORK_TYPES.PENDING_FOLLOWUP;
              const daysSinceDrop = isBackdated ? getDaysBetween(container.deliveryDate, selectedDate) : 0;
              
              return (
                <div key={container.id}
                  className={`bg-gradient-to-br ${style.gradient} rounded-2xl border ${style.border} p-5 shadow-sm hover:shadow-lg transition-all cursor-pointer group ${
                    isBackdated ? 'ring-2 ring-orange-400 ring-offset-1' : 
                    isPending ? 'ring-2 ring-amber-400 ring-offset-1' : ''
                  }`}
                  onClick={() => onEdit && onEdit(container)}>
                  
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${style.badge}`}>
                          {WORK_TYPE_LABELS[workType]}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black border ${
                          isExport ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-blue-100 text-blue-700 border-blue-300'
                        }`}>
                          {isExport ? '📤 EXPORT' : '📥 IMPORT'}
                        </span>
                        {isBackdated && (
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-black border bg-orange-100 text-orange-700 border-orange-300">
                            ⚠️ {daysSinceDrop}d ago
                          </span>
                        )}
                      </div>
                      <div className="font-black text-lg text-slate-900 mt-1">{container.containerNo}</div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(container); }}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    {isBackdated ? (
                      <div className="flex items-center gap-2 text-sm">
                        <History className="w-4 h-4 text-orange-500" />
                        <span className="font-bold text-orange-700">
                          Dropped: {formatDate(container.deliveryDate)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="font-bold">
                          {container.appointmentTime ? formatTime(container.appointmentTime) : 'Time TBD'}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">{container.customerName || 'No customer'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-slate-400" />
                      <span className={`text-xs ${isBackdated ? 'font-bold text-orange-600' : isPending ? 'font-bold text-amber-600' : 'text-slate-600'}`}>
                        {container.delivery || container.terminal || 'TBD'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white/50 rounded-xl p-3 mb-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-1 text-xs">
                          <User className="w-3 h-3 text-slate-400" />
                          <span className="font-bold">{container.driverName || 'TBD'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs mt-1">
                          <Truck className="w-3 h-3 text-slate-400" />
                          <span>{container.truckNo || '—'}</span>
                        </div>
                      </div>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        setDriverAssignment({ containerId: container.id, driverName: container.driverName || '', truckNo: container.truckNo || '' });
                        setShowDriverModal(true);
                      }} className="text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                        {container.driverName ? 'Change' : 'Assign'}
                      </button>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="flex justify-between text-[9px] font-bold text-slate-400 mb-1">
                      <span>Progress</span>
                      <span>{container.progress}%</span>
                    </div>
                    <div className="w-full bg-white/50 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all duration-500 ${
                        container.progress >= 100 ? 'bg-green-500' :
                        container.progress >= 70 ? 'bg-yellow-500' :
                        'bg-blue-500'
                      }`} style={{ width: `${container.progress}%` }} />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {isBackdated || isPending ? (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleConfirmReady(container.id); }}
                          disabled={isUpdating}
                          className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                          {isUpdating ? (
                            <span className="flex items-center justify-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                            </span>
                          ) : '✅ Confirm Ready'}
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }}
                          className="flex-1 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-colors">
                          📝 Plan Term
                        </button>
                      </>
                    ) : workType === 'scheduled' ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(container.id, WORK_TYPES.PREPULL); }}
                        disabled={isUpdating}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isUpdating ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                          </span>
                        ) : '🔵 Pre-Pull'}
                      </button>
                    ) : workType === WORK_TYPES.PREPULL ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(container.id, WORK_TYPES.DELIVERY); }}
                        disabled={isUpdating}
                        className="flex-1 py-2 bg-yellow-500 text-white rounded-xl text-xs font-bold hover:bg-yellow-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isUpdating ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                          </span>
                        ) : '🟡 Deliver'}
                      </button>
                    ) : workType === WORK_TYPES.DELIVERY ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(container.id, WORK_TYPES.TERMINATION); }}
                        disabled={isUpdating}
                        className="flex-1 py-2 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isUpdating ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                          </span>
                        ) : '🔴 Terminate'}
                      </button>
                    ) : workType === WORK_TYPES.TERMINATION ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(container.id, WORK_TYPES.COMPLETED); }}
                        disabled={isUpdating}
                        className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isUpdating ? (
                          <span className="flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                          </span>
                        ) : '✅ Complete'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* DRIVER ASSIGNMENT MODAL */}
      {showDriverModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowDriverModal(false)}></div>
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="font-black text-slate-900 text-lg">Assign Driver</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {containers.find(c => c.id === driverAssignment.containerId)?.containerNo}
                </p>
              </div>
              <button onClick={() => setShowDriverModal(false)} className="p-2 hover:bg-slate-200 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Driver</label>
                <select
                  value={driverAssignment.driverName}
                  onChange={e => setDriverAssignment({ ...driverAssignment, driverName: e.target.value })}
                  className="w-full p-3 border rounded-xl text-sm font-bold bg-white mt-1">
                  <option value="">Select driver...</option>
                  {drivers.map(driver => (
                    <option key={driver.name} value={driver.name}>{driver.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Truck #</label>
                <input
                  type="text"
                  value={driverAssignment.truckNo}
                  onChange={e => setDriverAssignment({ ...driverAssignment, truckNo: e.target.value })}
                  className="w-full p-3 border rounded-xl text-sm font-bold mt-1"
                  placeholder="e.g., TRK-001"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setShowDriverModal(false)}
                  disabled={assigningDriver}
                  className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-50">
                  Cancel
                </button>
                <button
                  onClick={() => handleAssignDriver(driverAssignment.containerId, driverAssignment.driverName, driverAssignment.truckNo)}
                  disabled={assigningDriver || !driverAssignment.driverName}
                  className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {assigningDriver ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Assigning...
                    </>
                  ) : 'Assign Driver'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEGEND */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-wrap items-center gap-4">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Work Types:</span>
        {Object.entries(WORK_TYPES).map(([key, value]) => {
          const style = STATUS_STYLES[value];
          const icons = { 
            PREPULL: '🔵', DELIVERY: '🟡', PENDING_FOLLOWUP: '⏳',
            BACKDATE_DROPPED: '📦', TERMINATION: '🔴', COMPLETED: '✅' 
          };
          return (
            <div key={value} className="flex items-center gap-1">
              <span className={`w-4 h-4 rounded border ${style.border} ${style.bg}`}></span>
              <span className={`text-[9px] font-bold ${style.text}`}>
                {icons[key]} {value === 'backdate_dropped' ? 'Back-Dated' : key.charAt(0) + key.slice(1).toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

DailyDispatchBoard.propTypes = {
  companyId: PropTypes.string.isRequired,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
  onViewDetails: PropTypes.func,
  setFeedback: PropTypes.func,
  isAdmin: PropTypes.bool,
  isDispatcher: PropTypes.bool,
  isAccounting: PropTypes.bool,
  selectedDate: PropTypes.string,
  preloadedContainers: PropTypes.array,
  skipInitialFetch: PropTypes.bool,
  availableDrivers: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    phone: PropTypes.string
  }))
};

DailyDispatchBoard.defaultProps = {
  isAdmin: false,
  isDispatcher: false,
  isAccounting: false,
  skipInitialFetch: false,
  preloadedContainers: null,
  availableDrivers: null
};

export default DailyDispatchBoard;