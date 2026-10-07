// components/DailyDispatchBoard.jsx

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  Package, Calendar, Clock, AlertCircle, CheckCircle, Truck, Anchor,
  FileText, Edit3, Trash2, Search, RefreshCw, ChevronDown, ChevronUp,
  X, Plus, DollarSign, Loader2, MapPin, User, Building, Filter,
  GripVertical, MoreHorizontal, TrendingUp, TrendingDown, Activity,
  Layers, ArrowRight, ArrowLeft, Timer, Navigation, Phone, Mail,
  CheckSquare, Square, Save, AlertTriangle, CalendarDays, Clock as ClockIcon,
  MessageSquare, Bell, History, AlertOctagon, Zap, CheckCircle2
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
  'prepull': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-800 border-blue-200', icon: '🔵' },
  'delivery': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', badge: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: '🟡' },
  'termination': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', badge: 'bg-red-100 text-red-800 border-red-200', icon: '🔴' },
  'completed': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', badge: 'bg-green-100 text-green-800 border-green-200', icon: '✅' },
  'pending_followup': { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800 border-amber-300', icon: '⏳' },
  'backdate_dropped': { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-800 border-orange-300', icon: '📦' },
  'scheduled': { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-600 border-slate-200', icon: '📋' }
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
  [WORK_TYPES.PREPULL]: 'Pre-Pull',
  [WORK_TYPES.DELIVERY]: 'Delivery',
  [WORK_TYPES.TERMINATION]: 'Termination',
  [WORK_TYPES.COMPLETED]: 'Completed',
  [WORK_TYPES.PENDING_FOLLOWUP]: 'Pending',
  [WORK_TYPES.BACKDATE_DROPPED]: 'Back-Dated'
};

// ========== HELPER FUNCTIONS ==========
const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isSameDay = (dateStr1, dateStr2) => {
  if (!dateStr1 || !dateStr2) return false;
  const normalizeDate = (dateStr) => {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
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
  if (normalized1 && normalized2) return normalized1 === normalized2;
  return dateStr1 === dateStr2;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

const getWorkType = (container, selectedDateStr) => {
  if (!selectedDateStr) selectedDateStr = getTodayDate();

  if (container.isDelivered && !container.isTerminated && container.status !== 'Ready for Billing') {
    const deliveryDate = container.deliveryDate || container.appointmentDate;
    if (deliveryDate && isSameDay(deliveryDate, selectedDateStr) === false) {
      try {
        const d1 = new Date(deliveryDate);
        const d2 = new Date(selectedDateStr);
        if (d1 < d2) return WORK_TYPES.BACKDATE_DROPPED;
      } catch (e) {}
    }
    if (deliveryDate && isSameDay(deliveryDate, selectedDateStr)) return WORK_TYPES.PENDING_FOLLOWUP;
    return WORK_TYPES.PENDING_FOLLOWUP;
  }

  if (container.isReadyForPickup && container.readyForPickupDate && isSameDay(container.readyForPickupDate, selectedDateStr)) {
    return WORK_TYPES.TERMINATION;
  }
  if (container.isTerminated || container.status === 'Ready for Billing' || container.status === 'Completed') {
    return WORK_TYPES.COMPLETED;
  }
  if (container.isPrePull) return WORK_TYPES.PREPULL;
  if (container.appointmentDate) return WORK_TYPES.DELIVERY;
  return 'scheduled';
};

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

const getTerminationStatus = (container) => {
  if (!container) return { canComplete: false, reason: 'no-container', label: 'Plan Termination' };
  const legs = container.legs || [];
  const termLeg = legs.find(l => l.legType === 'termination');
  const hasEIR = !!(container.eirPhotoUrl || container.podPhotoUrl);

  if (!termLeg && !hasEIR) return { canComplete: false, reason: 'no-termination-leg', label: 'Plan Termination' };
  if (termLeg && (!termLeg.driverName || termLeg.driverName.trim() === '')) return { canComplete: false, reason: 'no-driver', label: 'Assign Driver' };
  if (termLeg && termLeg.driverName) {
    const status = termLeg.tripStatus || termLeg.status || 'Planned';
    if (status !== 'Completed' && status !== 'Delivered') {
      return { canComplete: false, reason: 'in-progress', label: `${termLeg.driverName} en route`, inProgress: true };
    }
  }
  return { canComplete: true, reason: 'ready', label: 'Confirm Terminated' };
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
  skipInitialFetch
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
  
  // ===== DEFAULT TO CARDS VIEW (LIKE TOMORROW'S BOARD) =====
  const [viewMode, setViewMode] = useState('cards'); 

  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [updatingContainer, setUpdatingContainer] = useState(null);
  const [error, setError] = useState(null);
  const [pendingFollowupCount, setPendingFollowupCount] = useState(0);
  const [backdateDroppedCount, setBackdateDroppedCount] = useState(0);
  
  // ===== SMART SUGGESTIONS STATE =====
  const [smartSuggestions, setSmartSuggestions] = useState([]);

  const [completeConfirm, setCompleteConfirm] = useState({ isOpen: false, container: null, acknowledged: false, notes: '' });
  const [advancedFilters, setAdvancedFilters] = useState({ driver: '', truck: '', terminal: '', customer: '' });

  useEffect(() => {
    if (propSelectedDate) setSelectedDate(propSelectedDate);
  }, [propSelectedDate]);

  // ===== SMART MATCHING LOGIC =====
  const generateSmartSuggestions = useCallback((loads) => {
    const suggestions = [];
    
    const terminatingContainers = loads.filter(l => 
      l.isReadyForPickup || l.isTerminated || l.legs?.some(leg => leg.legType === 'termination') || l.status === 'Ready for Termination'
    );

    const pickupContainers = loads.filter(l => 
      l.shipmentType === 'import' || l.isPrePull || l.legs?.some(leg => leg.legType === 'pickup' || leg.legType === 'prepull')
    );

    terminatingContainers.forEach(term => {
      pickupContainers.forEach(pickup => {
        if (term.id === pickup.id) return;

        const termLocation = (term.terminal || term.legs?.[0]?.to || '').toLowerCase().trim();
        const pickupLocation = (pickup.terminal || pickup.legs?.[0]?.from || '').toLowerCase().trim();
        const termSize = (term.size || '').trim();
        const pickupSize = (pickup.size || '').trim();

        if (termLocation && termLocation === pickupLocation && termSize && termSize === pickupSize) {
          suggestions.push({
            terminationContainer: term.containerNo || 'N/A',
            pickupContainer: pickup.containerNo || 'N/A',
            location: term.terminal || term.legs?.[0]?.to || 'N/A',
            size: termSize,
            termId: term.id,
            pickupId: pickup.id,
            termCustomer: term.customerName || 'N/A',
            pickupCustomer: pickup.customerName || 'N/A'
          });
        }
      });
    });

    return suggestions;
  }, []);

  // ========== FETCH DATA ==========
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
            isReadyForPickup: data.isReadyForPickup || false,
            readyForPickupDate: data.readyForPickupDate || '',
            eirPhotoUrl: data.eirPhotoUrl || null,
            podPhotoUrl: data.podPhotoUrl || null,
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
            isReadyForPickup: data.isReadyForPickup || false,
            readyForPickupDate: data.readyForPickupDate || '',
            eirPhotoUrl: data.eirPhotoUrl || null,
            podPhotoUrl: data.podPhotoUrl || null,
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

  // ========== COMBINE CONTAINERS ==========
  useEffect(() => {
    const allContainers = [...loadContainers, ...exportContainers];
    setContainers(allContainers);

    const pending = allContainers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP);
    const backdated = allContainers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED);
    setPendingFollowupCount(pending.length);
    setBackdateDroppedCount(backdated.length);
  }, [loadContainers, exportContainers]);

  // ========== FILTERING ==========
  const filteredAndSortedContainers = useMemo(() => {
    let filtered = [...containers];
    const today = selectedDate || todayStr;

    filtered = filtered.filter(c => {
      if (c.status === 'Completed' || c.status === 'Paid' || c.status === 'Closed' || c.status === 'Ready for Billing' || c.isTerminated === true) {
        return false;
      }

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

      const isPendingFollowup = c.isDelivered && !c.isTerminated &&
                                c.status !== 'Ready for Billing' &&
                                c.deliveryDate &&
                                isSameDay(c.deliveryDate, today);

      const hasAppointmentToday = isSameDay(c.appointmentDate, today);
      const hasPrepullToday = isSameDay(c.prepullDate, today) && c.isPrePull === true;
      const hasDeliveryToday = isSameDay(c.deliveryDate, today);
      const hasReturnToday = isSameDay(c.returnDate, today);
      const hasLoadingDateToday = isSameDay(c.loadingDate, today);
      const hasErdToday = isSameDay(c.erd, today);
      const hasReadyForPickupToday = isSameDay(c.readyForPickupDate, today) && c.isReadyForPickup === true;

      return isPendingFollowup ||
             hasAppointmentToday ||
             hasPrepullToday ||
             hasDeliveryToday ||
             hasReturnToday ||
             hasLoadingDateToday ||
             hasErdToday ||
             hasReadyForPickupToday;
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

    if (advancedFilters.driver) filtered = filtered.filter(c => c.driverName?.toLowerCase().includes(advancedFilters.driver.toLowerCase()));
    if (advancedFilters.truck) filtered = filtered.filter(c => c.truckNo?.toLowerCase().includes(advancedFilters.truck.toLowerCase()));
    if (advancedFilters.terminal) filtered = filtered.filter(c => c.terminal?.toLowerCase().includes(advancedFilters.terminal.toLowerCase()));
    if (advancedFilters.customer) filtered = filtered.filter(c => c.customerName?.toLowerCase().includes(advancedFilters.customer.toLowerCase()));

    filtered.sort((a, b) => {
      const aIsBackdated = a.workType === WORK_TYPES.BACKDATE_DROPPED;
      const bIsBackdated = b.workType === WORK_TYPES.BACKDATE_DROPPED;

      if (aIsBackdated && !bIsBackdated) return -1;
      if (!aIsBackdated && bIsBackdated) return 1;

      if (aIsBackdated && bIsBackdated) return (a.deliveryDate || '').localeCompare(b.deliveryDate || '');

      let valA, valB;
      switch (sortField) {
        case 'appointmentDate': valA = a.appointmentDate || '9999-99-99'; valB = b.appointmentDate || '9999-99-99'; break;
        case 'containerNo': valA = a.containerNo || ''; valB = b.containerNo || ''; break;
        case 'customerName': valA = a.customerName || ''; valB = b.customerName || ''; break;
        case 'workType':
          const order = ['prepull', 'delivery', 'pending_followup', 'backdate_dropped', 'termination', 'completed'];
          valA = order.indexOf(a.workType); valB = order.indexOf(b.workType); break;
        default: valA = a[sortField] || ''; valB = b[sortField] || '';
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [containers, workTypeFilter, searchTerm, sortField, sortDirection, selectedDate, todayStr, advancedFilters]);

  // ===== TRIGGER SMART SUGGESTIONS BASED ONLY ON TODAY'S FILTERED LOADS =====
  useEffect(() => {
    setSmartSuggestions(generateSmartSuggestions(filteredAndSortedContainers));
  }, [filteredAndSortedContainers, generateSmartSuggestions]);

  const pendingFollowupContainers = useMemo(() => containers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP), [containers]);
  const backdateDroppedContainers = useMemo(() => containers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED), [containers]);

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
      progress: todayContainers.length > 0 ? Math.round(todayContainers.reduce((sum, c) => sum + c.progress, 0) / todayContainers.length) : 0
    };
  }, [filteredAndSortedContainers]);

  const handleSort = (field) => {
    if (sortField === field) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => { setRefreshing(false); setFeedback?.('✅ Data refreshed'); }, 1000);
  };

  const handleQuickStatusChange = async (containerId, newStatus) => {
    setUpdatingContainer(containerId);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', containerId);
      const updates = { updatedAt: new Date().toISOString() };
      switch (newStatus) {
        case WORK_TYPES.PREPULL: updates.isPrePull = true; updates.prepullDate = selectedDate; break;
        case WORK_TYPES.DELIVERY: updates.isPrePull = false; updates.isDelivered = true; updates.deliveryDate = selectedDate; break;
        case WORK_TYPES.TERMINATION: updates.isDelivered = false; updates.isTerminated = true; break;
        case WORK_TYPES.COMPLETED: updates.isTerminated = false; updates.status = 'Ready for Billing'; break;
        default: break;
      }
      await updateDoc(loadRef, updates);
      setFeedback?.(`✅ Status updated to ${WORK_TYPE_LABELS[newStatus]}`);
    } catch (error) {
      console.error('Status update error:', error);
      setFeedback?.('❌ Failed to update status');
    } finally { setUpdatingContainer(null); }
  };

  const handleConfirmReady = async (containerId) => {
    setUpdatingContainer(containerId);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', containerId);
      await updateDoc(loadRef, { isReadyForTermination: true, readyForTerminationAt: new Date().toISOString(), status: 'Ready for Termination', updatedAt: new Date().toISOString() });
      setFeedback?.('✅ Customer confirmed - ready for termination');
    } catch (error) {
      console.error('Confirm ready error:', error);
      setFeedback?.('❌ Failed to update status');
    } finally { setUpdatingContainer(null); }
  };

  const handleCompleteClick = (container) => {
    setCompleteConfirm({ isOpen: true, container, acknowledged: false, notes: '' });
  };

  const handleConfirmComplete = async () => {
    const container = completeConfirm.container;
    if (!container) return;
    if (!completeConfirm.acknowledged) { setFeedback?.('❌ Please confirm the termination is complete'); return; }
    setUpdatingContainer(container.id);
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', container.id);
      const now = new Date().toISOString();
      const auditEntry = { timestamp: now, user: 'Dispatcher', role: 'dispatcher', action: 'Marked as Terminated', changes: [{ field: 'status', from: container.status, to: 'Ready for Billing' }], notes: completeConfirm.notes || '' };
      const cappedLog = (container.auditLog || []).slice(-49);
      await updateDoc(loadRef, { isTerminated: true, isReadyForPickup: false, isReadyForTermination: false, status: 'Ready for Billing', terminatedAt: now, terminatedBy: 'Dispatcher', terminationNotes: completeConfirm.notes || '', updatedAt: now, auditLog: [...cappedLog, auditEntry] });
      setFeedback?.(`✅ ${container.containerNo} marked as terminated`);
      setCompleteConfirm({ isOpen: false, container: null, acknowledged: false, notes: '' });
    } catch (error) {
      console.error('Complete error:', error);
      setFeedback?.('❌ Failed to complete termination');
    } finally { setUpdatingContainer(null); }
  };

  const handleCancelComplete = () => { setCompleteConfirm({ isOpen: false, container: null, acknowledged: false, notes: '' }); };

  const [bulkUpdating, setBulkUpdating] = useState(false);
  const handleBulkStatusChange = async (newStatus) => {
    if (selectedContainers.size === 0) { setFeedback?.('⚠️ No containers selected'); return; }
    if (newStatus === WORK_TYPES.COMPLETED) { setFeedback?.('⚠️ Bulk Complete is disabled for safety. Please confirm each container individually.'); return; }
    setBulkUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedContainers.forEach(id => {
        const loadRef = doc(db, 'companies', companyId, 'loads', id);
        const updates = { updatedAt: new Date().toISOString() };
        switch (newStatus) {
          case WORK_TYPES.PREPULL: updates.isPrePull = true; updates.prepullDate = selectedDate; break;
          case WORK_TYPES.DELIVERY: updates.isPrePull = false; updates.isDelivered = true; updates.deliveryDate = selectedDate; break;
          case WORK_TYPES.TERMINATION: updates.isDelivered = false; updates.isTerminated = true; break;
          default: break;
        }
        batch.update(loadRef, updates);
      });
      await batch.commit();
      setFeedback?.(`✅ ${selectedContainers.size} containers updated to ${WORK_TYPE_LABELS[newStatus]}`);
      setSelectedContainers(new Set());
    } catch (error) {
      console.error('Bulk update error:', error);
      setFeedback?.('❌ Failed to update containers');
    } finally { setBulkUpdating(false); }
  };

  const toggleSelectAll = () => {
    if (selectedContainers.size === filteredAndSortedContainers.length) setSelectedContainers(new Set());
    else setSelectedContainers(new Set(filteredAndSortedContainers.map(c => c.id)));
  };

  const toggleSelectContainer = (id) => {
    const newSelected = new Set(selectedContainers);
    if (newSelected.has(id)) newSelected.delete(id); else newSelected.add(id);
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
        <button onClick={handleRefresh} className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors">Try Again</button>
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
                <AlertOctagon className="w-3 h-3" /> {backdateDroppedCount} from previous dates
              </span>
            )}
            <span className="flex items-center gap-1 text-blue-600 text-xs font-bold bg-blue-50 px-2 py-0.5 rounded-full">
              <Activity className="w-3 h-3" /> {stats.progress}% complete
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
            <button onClick={() => setViewMode('cards')} className={`px-3 py-2 text-xs font-bold transition-all ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📋 Cards</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-2 text-xs font-bold transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📊 Table</button>
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-sm transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* BACK-DATED DROPS ALERT SECTION */}
      {backdateDroppedContainers.length > 0 && (
        <div className="bg-orange-50 border-2 border-orange-400 rounded-[32px] p-6 animate-in slide-in-from-top-4 relative overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><History className="w-32 h-32 text-orange-600" /></div>
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-orange-100 p-3 rounded-2xl text-orange-700 shadow-sm"><AlertOctagon className="w-8 h-8" /></div>
              <div>
                <h3 className="font-black text-2xl text-orange-900 tracking-tight">📦 Back-Dated Drops — Action Required</h3>
                <p className="text-orange-800 font-bold text-sm">{backdateDroppedContainers.length} container{backdateDroppedContainers.length > 1 ? 's' : ''} dropped at customer on previous dates — please follow up and plan termination</p>
                <p className="text-orange-600 text-xs mt-1 font-medium">These containers were delivered before today and need customer confirmation</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {backdateDroppedContainers.map(container => {
                const isExport = container._type === 'export';
                const daysSinceDrop = getDaysBetween(container.deliveryDate, selectedDate);
                return (
                  <div key={container.id} className="bg-white p-5 rounded-2xl border border-orange-200 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-orange-300 transition-all cursor-pointer" onClick={() => onEdit && onEdit(container)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-black text-slate-800 text-lg flex items-center gap-2">
                          {container.containerNo || 'N/A'}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isExport ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{isExport ? '📤 EXPORT' : '📥 IMPORT'}</span>
                        </div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{container.customerName || 'N/A'}</div>
                      </div>
                      <div className="bg-orange-100 text-orange-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase border border-orange-200">{isExport ? 'LOADED 📦' : 'DROPPED 📦'}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Calendar className="w-3.5 h-3.5 text-orange-500" />
                      <span>Dropped: {formatDate(container.deliveryDate)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${daysSinceDrop > 5 ? 'bg-red-100 text-red-700' : daysSinceDrop > 3 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>{daysSinceDrop}d ago</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><MapPin className="w-3.5 h-3.5 text-orange-500" /><span className="truncate">{container.delivery || container.terminal || 'Customer Location'}</span></div>
                    {daysSinceDrop > 3 && (<div className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg"><AlertCircle className="w-3.5 h-3.5" /><span>Urgent — {daysSinceDrop} days since drop!</span></div>)}
                    <div className="pt-3 mt-auto flex gap-2 border-t border-slate-100">
                      <button onClick={(e) => { e.stopPropagation(); handleConfirmReady(container.id); }} disabled={updatingContainer === container.id} className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95 disabled:opacity-50">{updatingContainer === container.id ? <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Updating...</span> : '✅ Confirm Ready'}</button>
                      <button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="flex-1 py-2 bg-orange-600 text-white rounded-xl font-bold text-xs hover:bg-orange-700 shadow-md shadow-orange-200 transition-all active:scale-95">📝 Plan Termination</button>
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
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><Bell className="w-32 h-32 text-amber-600" /></div>
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm"><ClockIcon className="w-8 h-8" /></div>
              <div>
                <h3 className="font-black text-2xl text-amber-900 tracking-tight">⏳ Pending Customer Follow-Up (Today)</h3>
                <p className="text-amber-800 font-bold text-sm">{pendingFollowupContainers.length} container{pendingFollowupContainers.length > 1 ? 's' : ''} dropped today — waiting for confirmation</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingFollowupContainers.map(container => {
                const isExport = container._type === 'export';
                return (
                  <div key={container.id} className="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-amber-300 transition-all cursor-pointer" onClick={() => onEdit && onEdit(container)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-black text-slate-800 text-lg flex items-center gap-2">
                          {container.containerNo || 'N/A'}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isExport ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{isExport ? '📤 EXPORT' : '📥 IMPORT'}</span>
                        </div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{container.customerName || 'N/A'}</div>
                      </div>
                      <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase border border-amber-200">{isExport ? 'LOADED ⏳' : 'EMPTY ⏳'}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><MapPin className="w-3.5 h-3.5 text-amber-500" /><span className="truncate">{container.delivery || container.terminal || 'Customer Location'}</span></div>
                    {container.deliveryDate && (<div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Calendar className="w-3.5 h-3.5" /><span>Dropped: {formatDate(container.deliveryDate)}</span></div>)}
                    <div className="pt-3 mt-auto flex gap-2 border-t border-slate-100">
                      <button onClick={(e) => { e.stopPropagation(); handleConfirmReady(container.id); }} disabled={updatingContainer === container.id} className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95 disabled:opacity-50">{updatingContainer === container.id ? <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Updating...</span> : '✅ Confirm Ready'}</button>
                      <button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold text-xs hover:bg-amber-700 shadow-md shadow-amber-200 transition-all active:scale-95">📝 Plan Termination</button>
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
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer" onClick={() => setWorkTypeFilter('all')}>
          <div className="flex items-center justify-between"><div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center"><Package className="w-5 h-5 text-slate-600" /></div><span className="text-2xl font-black text-slate-900">{stats.total}</span></div>
          <div className="mt-2 text-[10px] font-black text-slate-400 uppercase">Total</div>
        </div>
        {Object.entries(WORK_TYPES).map(([key, value]) => {
          const style = STATUS_STYLES[value];
          const icons2 = { PREPULL: Truck, DELIVERY: Navigation, PENDING_FOLLOWUP: Bell, BACKDATE_DROPPED: History, TERMINATION: Anchor, COMPLETED: CheckCircle };
          const IconComponent = icons2[key];
          return (
            <div key={value} className={`${style.bg} p-4 rounded-2xl border ${style.border} shadow-sm hover:shadow-md transition-all cursor-pointer ${key === 'PENDING_FOLLOWUP' ? 'ring-2 ring-amber-400 ring-offset-1' : key === 'BACKDATE_DROPPED' ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`} onClick={() => setWorkTypeFilter(workTypeFilter === value ? 'all' : value)}>
              <div className="flex items-center justify-between"><div className="w-10 h-10 bg-white/50 rounded-xl flex items-center justify-center"><IconComponent className={`w-5 h-5 ${style.text}`} /></div><span className={`text-2xl font-black ${style.text}`}>{stats[value] || 0}</span></div>
              <div className={`mt-2 text-[9px] font-black uppercase ${style.text}`}>{value === 'backdate_dropped' ? '📦 Back-Dated' : key.charAt(0) + key.slice(1).toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      {/* ===== SMART SUGGESTIONS ALERT BANNER ===== */}
      {smartSuggestions.length > 0 && (
        <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-4 shadow-md animate-pulse">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-yellow-400 p-2 rounded-xl">
              <Zap className="w-5 h-5 text-yellow-900" />
            </div>
            <div>
              <h3 className="font-black text-yellow-900 text-lg">Smart Dispatch Suggestions</h3>
              <p className="text-xs font-bold text-yellow-700">Reuse terminating containers for pickups to save time and fuel!</p>
            </div>
          </div>
          <div className="space-y-2">
            {smartSuggestions.map((s, i) => (
              <div key={i} className="bg-white p-3 rounded-xl border border-yellow-200 flex items-start gap-3 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm font-medium text-slate-700">
                  Use <span className="font-black text-blue-700">{s.terminationContainer}</span> ({s.size}) terminating at <span className="font-bold">{s.location}</span> to pick up <span className="font-black text-green-700">{s.pickupContainer}</span> ({s.size}) from the same location. 
                  <span className="block text-xs text-slate-400 mt-1">
                    Term Customer: {s.termCustomer} | Pickup Customer: {s.pickupCustomer}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FILTERS & SEARCH */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input type="text" placeholder="Search container #, PO#, customer, driver..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" />
        </div>
        <select value={workTypeFilter} onChange={(e) => setWorkTypeFilter(e.target.value)} className="appearance-none w-full sm:w-48 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-sm pr-10 cursor-pointer">
          <option value="all">📋 All Types</option>
          <option value="prepull">🔵 Pre-Pull</option>
          <option value="delivery">🟡 Delivery</option>
          <option value="pending_followup">⏳ Pending Follow-Up</option>
          <option value="backdate_dropped">📦 Back-Dated Drops</option>
          <option value="termination">🔴 Termination</option>
          <option value="completed">✅ Completed</option>
        </select>
        <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${showAdvancedFilters ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Filter className="w-4 h-4" /> Filters <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ADVANCED FILTERS */}
      {showAdvancedFilters && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2">
          <div><label className="text-[10px] font-black text-slate-400 uppercase">Driver</label><input type="text" value={advancedFilters.driver} onChange={e => setAdvancedFilters(prev => ({ ...prev, driver: e.target.value }))} className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Driver name..." /></div>
          <div><label className="text-[10px] font-black text-slate-400 uppercase">Truck</label><input type="text" value={advancedFilters.truck} onChange={e => setAdvancedFilters(prev => ({ ...prev, truck: e.target.value }))} className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Truck #..." /></div>
          <div><label className="text-[10px] font-black text-slate-400 uppercase">Terminal</label><input type="text" value={advancedFilters.terminal} onChange={e => setAdvancedFilters(prev => ({ ...prev, terminal: e.target.value }))} className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Terminal..." /></div>
          <div><label className="text-[10px] font-black text-slate-400 uppercase">Customer</label><input type="text" value={advancedFilters.customer} onChange={e => setAdvancedFilters(prev => ({ ...prev, customer: e.target.value }))} className="w-full p-2 border rounded-xl text-sm mt-1" placeholder="Customer..." /></div>
        </div>
      )}

      {/* BULK ACTIONS BAR */}
      {selectedContainers.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top">
          <span className="font-bold text-blue-700">{selectedContainers.size} container{selectedContainers.size > 1 ? 's' : ''} selected</span>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleBulkStatusChange(WORK_TYPES.PREPULL)} disabled={bulkUpdating} className="px-3 py-1.5 bg-blue-200 text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-300 disabled:opacity-50 disabled:cursor-not-allowed">{bulkUpdating ? 'Updating...' : '🔵 Pre-Pull'}</button>
            <button onClick={() => handleBulkStatusChange(WORK_TYPES.DELIVERY)} disabled={bulkUpdating} className="px-3 py-1.5 bg-yellow-200 text-yellow-900 rounded-lg text-xs font-bold hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed">{bulkUpdating ? 'Updating...' : '🟡 Deliver'}</button>
            <button onClick={() => handleBulkStatusChange(WORK_TYPES.TERMINATION)} disabled={bulkUpdating} className="px-3 py-1.5 bg-red-200 text-red-900 rounded-lg text-xs font-bold hover:bg-red-300 disabled:opacity-50 disabled:cursor-not-allowed">{bulkUpdating ? 'Updating...' : '🔴 Terminate'}</button>
            <button onClick={() => setSelectedContainers(new Set())} className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300">Clear</button>
          </div>
        </div>
      )}

      {/* ================= VIEW MODES ================= */}
      
      {viewMode === 'table' ? (
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
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('appointmentDate')}>Date/Time {sortField === 'appointmentDate' && (sortDirection === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('containerNo')}>Container {sortField === 'containerNo' && (sortDirection === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => handleSort('customerName')}>Customer {sortField === 'customerName' && (sortDirection === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedContainers.length === 0 ? (
                  <tr><td colSpan="10" className="px-6 py-12 text-center text-slate-400 font-bold italic">No containers scheduled for {formatDate(selectedDate)}</td></tr>
                ) : (
                  filteredAndSortedContainers.map(container => {
                    const workType = container.workType;
                    const style = STATUS_STYLES[workType] || STATUS_STYLES.scheduled;
                    const isUpdating = updatingContainer === container.id;
                    const isExport = container._type === 'export';
                    const isBackdated = workType === WORK_TYPES.BACKDATE_DROPPED;
                    const isPending = workType === WORK_TYPES.PENDING_FOLLOWUP;
                    const termStatus = workType === WORK_TYPES.TERMINATION ? getTerminationStatus(container) : null;
                    return (
                      <tr key={container.id} className={`${style.bg} hover:shadow-md transition-all cursor-pointer group ${isBackdated ? 'border-l-4 border-l-orange-400' : isPending ? 'border-l-4 border-l-amber-400' : ''}`}>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => toggleSelectContainer(container.id)}>
                            {selectedContainers.has(container.id) ? (<CheckSquare className="w-4 h-4 text-blue-600" />) : <Square className="w-4 h-4 text-slate-300" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {isBackdated ? (
                            <div><div className="font-bold text-sm text-orange-700">{formatDate(container.deliveryDate)}</div><div className="text-[8px] font-black text-orange-400 uppercase">📦 BACK-DATED</div></div>
                          ) : (
                            <div><div className="font-bold text-sm">{container.appointmentTime ? formatTime(container.appointmentTime) : '—'}</div><div className="text-[8px] font-black text-slate-400 uppercase">{isExport ? '📤 EXPORT' : '📥 IMPORT'}</div></div>
                          )}
                        </td>
                        <td className="px-4 py-3"><span className={`px-3 py-1.5 rounded-full text-[10px] font-black border ${style.badge}`}>{WORK_TYPE_LABELS[workType] || '📋 Scheduled'}</span></td>
                        <td className="px-4 py-3"><button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="font-black text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left" title="Open load">{container.containerNo || 'N/A'}</button></td>
                        <td className="px-4 py-3"><div className="font-medium text-sm">{container.customerName || 'N/A'}</div></td>
                        <td className="px-4 py-3 text-sm">
                          {isBackdated || isPending ? (
                            <span className={`font-bold flex items-center gap-1 ${isBackdated ? 'text-orange-600' : 'text-amber-600'}`}><MapPin className="w-3 h-3" />{container.delivery || container.terminal || 'Customer'}</span>
                          ) : workType === WORK_TYPES.PREPULL ? container.terminal || '—' : workType === WORK_TYPES.TERMINATION ? 'Return to Yard' : container.delivery || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {container.driverName ? (<span className="text-sm font-bold text-green-600">{container.driverName}</span>) : (<span className="text-xs text-slate-400 italic">No driver</span>)}
                            <button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="text-xs font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">{container.driverName ? 'Change' : 'Assign →'}</button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">{container.truckNo || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="w-20 bg-slate-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${container.progress >= 100 ? 'bg-green-500' : container.progress >= 70 ? 'bg-yellow-500' : 'bg-blue-500'}`} style={{ width: `${container.progress}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(container); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit3 className="w-3.5 h-3.5" /></button>
                            {(isBackdated || isPending) && (
                              <button onClick={(e) => { e.stopPropagation(); handleConfirmReady(container.id); }} disabled={isUpdating} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50" title="Confirm ready for termination">
                                {isUpdating ? (<Loader2 className="w-3.5 h-3.5 animate-spin" />) : (<CheckCircle className="w-3.5 h-3.5" />)}
                              </button>
                            )}
                            {workType === WORK_TYPES.TERMINATION && termStatus && (
                              termStatus.canComplete ? (
                                <button onClick={(e) => { e.stopPropagation(); handleCompleteClick(container); }} disabled={isUpdating} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50" title="Confirm termination complete">
                                  {isUpdating ? (<Loader2 className="w-3.5 h-3.5 animate-spin" />) : (<CheckCircle className="w-3.5 h-3.5" />)}
                                </button>
                              ) : (
                                <button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className={`p-1.5 rounded-lg ${termStatus.inProgress ? 'text-amber-500 hover:bg-amber-50 cursor-help' : 'text-orange-500 hover:bg-orange-50'}`} title={termStatus.label}><Edit3 className="w-3.5 h-3.5" /></button>
                              )
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
        /* CARD VIEW - EXACTLY MATCHES TOMORROW'S BOARD */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedContainers.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-2xl border border-slate-200">No containers scheduled for {formatDate(selectedDate)}</div>
          ) : (
            filteredAndSortedContainers.map(container => {
              const isExport = container._type === 'export';
              const isBackdated = container.workType === WORK_TYPES.BACKDATE_DROPPED;
              const isPending = container.workType === WORK_TYPES.PENDING_FOLLOWUP;
              
              return (
                <div 
                  key={container.id} 
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group"
                  onClick={() => onEdit?.(container)}
                >
                  {/* Card Header */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex gap-2">
                      <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider ${
                        isExport ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {isExport ? 'EXPORT' : 'IMPORT'}
                      </span>
                      <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider ${
                        container.loadType === 'LIVE' ? 'bg-blue-100 text-blue-700' : 
                        container.loadType === 'DROP' ? 'bg-green-100 text-green-700' : 
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {container.loadType || 'DROP'}
                      </span>
                    </div>
                    {container.isPrePull && (
                      <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-200">
                        Pre-Pull
                      </span>
                    )}
                  </div>

                  {/* Container & Customer */}
                  <div className="mb-3">
                    <h4 className="font-black text-xl text-slate-800 group-hover:text-blue-600 transition-colors">
                      {container.containerNo || 'N/A'}
                    </h4>
                    <p className="text-sm font-bold text-slate-600 truncate">
                      {container.customerName || 'N/A'}
                    </p>
                  </div>

                  {/* Time & Location */}
                  <div className="space-y-1.5 text-xs text-slate-500 font-medium mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{container.appointmentTime || 'TBD'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{container.delivery || container.terminal || 'No Location'}</span>
                    </div>
                    {container.size && (
                      <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-bold text-slate-700">{container.size}</span>
                      </div>
                    )}
                  </div>

                  {/* Termination / Status Note */}
                  {(isBackdated || isPending) && (
                    <div className="mb-3 bg-red-50 p-2.5 rounded-xl border border-red-100 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs font-bold text-red-700">
                        {isBackdated 
                          ? `Dropped on ${container.deliveryDate}. Please follow up and plan termination!`
                          : `Dropped on ${container.deliveryDate || container.appointmentDate}. Ready to terminate today!`}
                      </span>
                    </div>
                  )}

                  {/* Driver Info */}
                  {container.driverName ? (
                    <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-black text-slate-700 truncate">{container.driverName}</div>
                        <div className="text-[10px] font-bold text-slate-400">Truck: {container.truckNo || 'N/A'}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-yellow-50 p-2.5 rounded-xl border border-yellow-100">
                      <User className="w-4 h-4 text-yellow-500" />
                      <span className="text-xs font-bold text-yellow-700">Driver Unassigned</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TERMINATION CONFIRMATION MODAL (SAFETY) */}
      {completeConfirm.isOpen && completeConfirm.container && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCancelComplete}></div>
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 bg-orange-50">
              <div className="flex items-center gap-3">
                <div className="bg-orange-100 p-2 rounded-xl"><AlertTriangle className="w-5 h-5 text-orange-600" /></div>
                <div><h2 className="font-black text-slate-900 text-lg">Confirm Termination</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{completeConfirm.container.containerNo}</p></div>
                <button onClick={handleCancelComplete} className="ml-auto p-2 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-bold text-amber-800 mb-2">⚠️ This will move the container out of the active board.</p>
                <p className="text-xs text-amber-700">Only proceed if the container has been physically terminated and the EIR/POD is uploaded.</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="font-bold text-slate-500">Container:</span><span className="font-black text-slate-900">{completeConfirm.container.containerNo}</span></div>
                <div className="flex items-center justify-between"><span className="font-bold text-slate-500">Customer:</span><span className="font-bold text-slate-700">{completeConfirm.container.customerName}</span></div>
                <div className="flex items-center justify-between"><span className="font-bold text-slate-500">Driver:</span><span className="font-bold text-slate-700">{completeConfirm.container.driverName || '❌ Not assigned'}</span></div>
                <div className="flex items-center justify-between"><span className="font-bold text-slate-500">EIR / POD:</span><span className="font-bold text-slate-700">{completeConfirm.container.eirPhotoUrl || completeConfirm.container.podPhotoUrl ? '✅ Uploaded' : '❌ Not uploaded'}</span></div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Termination Notes (optional)</label>
                <textarea value={completeConfirm.notes} onChange={(e) => setCompleteConfirm({ ...completeConfirm, notes: e.target.value })} placeholder="EIR number, yard reference, notes..." className="w-full mt-1 p-3 border rounded-xl text-sm resize-none" rows={2} />
              </div>
              <label className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl cursor-pointer hover:bg-red-100 transition-colors">
                <input type="checkbox" checked={completeConfirm.acknowledged} onChange={(e) => setCompleteConfirm({ ...completeConfirm, acknowledged: e.target.checked })} className="w-4 h-4 mt-0.5 text-red-600 rounded focus:ring-red-500" />
                <span className="text-xs font-bold text-red-800 leading-relaxed">I confirm that container <strong>{completeConfirm.container.containerNo}</strong> has been physically terminated at the yard, and the EIR/POD is uploaded. I understand this will remove it from the active dispatch board.</span>
              </label>
              <div className="flex gap-3 pt-2">
                <button onClick={handleCancelComplete} className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={handleConfirmComplete} disabled={!completeConfirm.acknowledged || updatingContainer === completeConfirm.container.id} className="flex-[2] py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">{updatingContainer === completeConfirm.container.id ? (<><Loader2 className="w-4 h-4 animate-spin" /> Confirming...</>) : '✅ Confirm Terminated'}</button>
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
          const icons = { PREPULL: '🔵', DELIVERY: '🟡', PENDING_FOLLOWUP: '⏳', BACKDATE_DROPPED: '📦', TERMINATION: '🔴', COMPLETED: '✅' };
          return (
            <div key={value} className="flex items-center gap-1">
              <span className={`w-4 h-4 rounded border ${style.border} ${style.bg}`}></span>
              <span className={`text-[9px] font-bold ${style.text}`}>{icons[key]} {value === 'backdate_dropped' ? 'Back-Dated' : key.charAt(0) + key.slice(1).toLowerCase()}</span>
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
  skipInitialFetch: PropTypes.bool
};

DailyDispatchBoard.defaultProps = {
  isAdmin: false,
  isDispatcher: false,
  isAccounting: false,
  skipInitialFetch: false,
  preloadedContainers: null
};

export default DailyDispatchBoard;