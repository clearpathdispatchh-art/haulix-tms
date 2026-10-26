// src/components/TomorrowDispatchBoard.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, query, where, getDocs, limit, onSnapshot, doc, updateDoc, writeBatch
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { 
  Clock, Calendar, Package, Truck, User, MapPin, 
  ChevronDown, AlertCircle, Loader2, Zap, CheckCircle2,
  Search, RefreshCw, Filter, Edit3, AlertTriangle, 
  AlertOctagon, Activity, History, Bell, Anchor, CheckCircle, Navigation,
  CheckSquare, Square, X
} from 'lucide-react';

// ========== CONSTANTS ==========
const STATUS_STYLES = {
  'prepull': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-800 border-blue-200', icon: '🔵' },
  'delivery': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', badge: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: '🟡' },
  'termination': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', badge: 'bg-red-100 text-red-800 border-red-200', icon: '🔴' },
  'completed': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', badge: 'bg-green-100 text-green-800 border-green-200', icon: '✅' },
  'pending_followup': { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800 border-amber-300', icon: '⏳' },
  'backdate_dropped': { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-800 border-orange-300', icon: '📦' },
  'prepull_warning': { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-900', badge: 'bg-red-600 text-white border-red-700', icon: '🚨' },
  'scheduled': { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-600 border-slate-200', icon: '📋' }
};

const WORK_TYPES = {
  PREPULL: 'prepull',
  DELIVERY: 'delivery',
  TERMINATION: 'termination',
  COMPLETED: 'completed',
  PENDING_FOLLOWUP: 'pending_followup',
  BACKDATE_DROPPED: 'backdate_dropped',
  PREPULL_WARNING: 'prepull_warning'
};

const WORK_TYPE_LABELS = {
  [WORK_TYPES.PREPULL]: 'Pre-Pull',
  [WORK_TYPES.DELIVERY]: 'Delivery',
  [WORK_TYPES.TERMINATION]: 'Termination',
  [WORK_TYPES.COMPLETED]: 'Completed',
  [WORK_TYPES.PENDING_FOLLOWUP]: 'Pending',
  [WORK_TYPES.BACKDATE_DROPPED]: 'Back-Dated',
  [WORK_TYPES.PREPULL_WARNING]: 'Pre-Pull Missed'
};

// ========== HELPER FUNCTIONS ==========
const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTomorrowDateString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
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
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(cleanDate + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

const getRvAlert = (container) => {
  if (!container.rvNo && !container.rvEarlyReturnDate && !container.rvCutoffDate) return null;

  const now = new Date();
  const todayStr = getTodayDate();
  
  const parseDate = (d) => d ? (d.includes('T') ? d.split('T')[0] : d) : null;
  const earlyDateStr = parseDate(container.rvEarlyReturnDate);
  const cutoffDateStr = parseDate(container.rvCutoffDate);

  const details = {
    rvNo: container.rvNo,
    earlyDate: earlyDateStr,
    earlyTime: container.rvEarlyReturnTime,
    cutoffDate: cutoffDateStr,
    cutoffTime: container.rvCutoffTime
  };
  
  if (cutoffDateStr) {
      const cutoff = new Date(cutoffDateStr + 'T23:59:59');
      if (now > cutoff) {
        return { type: 'expired', message: `RV EXPIRED! Terminate immediately!`, ...details };
      }
      if (cutoffDateStr === todayStr) {
        return { type: 'critical', message: `Terminate container! Cut-off is TODAY.`, ...details };
      }
  }

  if (earlyDateStr) {
      if (earlyDateStr === todayStr) {
        const earlyTime = container.rvEarlyReturnTime || '00:00';
        const [h, m] = earlyTime.split(':').map(Number);
        const earlyDateTime = new Date();
        earlyDateTime.setHours(h || 0, m || 0, 0, 0);
        
        if (now < earlyDateTime) {
            return { type: 'upcoming', message: `RV active today after ${earlyTime}. Arrange termination.`, ...details };
        } else {
            return { type: 'active', message: `RV active NOW. Arrange termination!`, ...details };
        }
      } else if (earlyDateStr < todayStr) {
        return { type: 'warning', message: `Terminate container! RV active since ${formatDate(earlyDateStr)}.`, ...details };
      }
  }
  return null;
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

const checkMissedPrepull = (container, selectedDateStr) => {
  if (!selectedDateStr) selectedDateStr = getTomorrowDateString();
  const legs = container.legs || [];
  
  const isLfdPast = !!(container.lfdDate && new Date(container.lfdDate).setHours(0,0,0,0) < new Date(selectedDateStr).setHours(0,0,0,0));
  const hasPrepullLeg = legs.some(l => l.legType === 'prepull');
  
  let needsPrepull = true; 
  if (container.lfdDate && container.appointmentDate) {
    const lfd = new Date(container.lfdDate);
    const appt = new Date(container.appointmentDate);
    if (appt <= lfd) needsPrepull = false; 
  }

  const hasCompletedDropLeg = legs.some(
    leg => (leg.legType === 'delivery' || leg.legType === 'drop' || leg.legType === 'stopoff' || leg.legType === 'live') && 
            (leg.status === 'Completed' || leg.status === 'Delivered')
  );
  const isDelivered = container.isDelivered || container.isDroppedAtCustomer || hasCompletedDropLeg;

  return !!(isLfdPast && needsPrepull && !container.isInYard && !hasPrepullLeg && !isDelivered);
};

const getActiveDriver = (legs, workType, container) => {
  if (!legs || legs.length === 0) return { driverName: '', truckNo: '' };
  
  const activeLeg = [...legs].reverse().find(l => 
    (l.status === 'Dispatched' || l.status === 'In Transit' || l.status === 'Planned') && l.driverName
  );
  
  if (activeLeg) return { driverName: activeLeg.driverName, truckNo: activeLeg.truckNo || '' };

  if (workType === 'pending_followup' || workType === 'backdate_dropped' || workType === 'termination' || container?.isInYard) {
    const termLeg = legs.find(l => l.legType === 'termination');
    if (termLeg && termLeg.driverName && termLeg.status !== 'Completed' && termLeg.status !== 'Delivered') {
      return { driverName: termLeg.driverName, truckNo: termLeg.truckNo || '' };
    }
    return { driverName: '', truckNo: '' }; 
  }

  const lastLegWithDriver = [...legs].reverse().find(l => l.driverName);
  if (lastLegWithDriver) return { driverName: lastLegWithDriver.driverName, truckNo: lastLegWithDriver.truckNo || '' };
  
  return { driverName: '', truckNo: '' };
};

const getWorkType = (container, selectedDateStr) => {
  if (!selectedDateStr) selectedDateStr = getTomorrowDateString();

  if (container.isTerminated || container.status === 'Ready for Billing' || container.status === 'Completed') {
    return WORK_TYPES.COMPLETED;
  }

  const legs = container.legs || [];
  const selectedLegs = legs.filter(l => isSameDay(l.legDate, selectedDateStr));

  // ✅ 1. CHECK IF DROPPED/DELIVERED FIRST
  const hasCompletedDropLeg = legs.some(
    leg => (leg.legType === 'delivery' || leg.legType === 'drop' || leg.legType === 'stopoff' || leg.legType === 'live') && 
            (leg.status === 'Completed' || leg.status === 'Delivered')
  );

  if (container.isDelivered || container.isDroppedAtCustomer || hasCompletedDropLeg) {
    const completedLegs = legs.filter(l => l.status === 'Completed' || l.status === 'Delivered');
    let deliveryDate = null;
    
    if (completedLegs.length > 0) {
      const dropLeg = completedLegs.find(l => 
        (l.legType === 'delivery' || l.legType === 'drop' || l.legType === 'stopoff' || l.legType === 'live')
      );
      const targetLeg = dropLeg || completedLegs[completedLegs.length - 1];
      deliveryDate = targetLeg.legDate;
    }
    
    if (!deliveryDate) {
      deliveryDate = container.deliveryDate || container.appointmentDate || container.updatedAt;
    }
    
    if (deliveryDate && typeof deliveryDate === 'string' && deliveryDate.includes('T')) {
      deliveryDate = deliveryDate.split('T')[0];
    }
    
    if (deliveryDate && !isSameDay(deliveryDate, selectedDateStr)) {
      try {
        const d1 = new Date(deliveryDate);
        const d2 = new Date(selectedDateStr);
        if (d1 < d2) return WORK_TYPES.BACKDATE_DROPPED;
      } catch (e) {}
    }
    return WORK_TYPES.PENDING_FOLLOWUP;
  }

  // ✅ 2. DATE LOGIC (Overrides generated legs)
  const isApptOnSelectedDate = container.appointmentDate && isSameDay(container.appointmentDate, selectedDateStr);
  const isLfdOnSelectedDate = container.lfdDate && isSameDay(container.lfdDate, selectedDateStr);

  if (isApptOnSelectedDate) {
    return WORK_TYPES.DELIVERY;
  }

  if (isLfdOnSelectedDate && !container.isInYard) {
    if (container.appointmentDate) {
      const lfd = new Date(container.lfdDate);
      const appt = new Date(container.appointmentDate);
      if (appt > lfd) {
        return WORK_TYPES.PREPULL;
      }
    } else {
      return WORK_TYPES.PREPULL;
    }
  }

  // ✅ 3. Check for active deliveries 
  if (selectedLegs.length > 0) {
    const activeDelivery = selectedLegs.find(l => 
      l.legType !== 'termination' && 
      l.legType !== 'prepull' && 
      l.status !== 'Completed' && 
      l.status !== 'Delivered'
    );
    if (activeDelivery) return WORK_TYPES.DELIVERY;
  }

  // ✅ 4. Check the warning separately
  if (checkMissedPrepull(container, selectedDateStr)) {
    return WORK_TYPES.PREPULL_WARNING;
  }

  if (selectedLegs.length > 0) {
    const activePrepull = selectedLegs.find(l => l.legType === 'prepull' && l.status !== 'Completed' && l.status !== 'Delivered');
    if (activePrepull && !container.isInYard) return WORK_TYPES.PREPULL;

    const activeTermination = selectedLegs.find(l => l.legType === 'termination' && l.status !== 'Completed' && l.status !== 'Delivered');
    if (activeTermination) return WORK_TYPES.TERMINATION;

    const lastLeg = selectedLegs[selectedLegs.length - 1];
    if (lastLeg.legType === 'termination') return WORK_TYPES.TERMINATION;
    if (lastLeg.legType === 'prepull' && !container.isInYard) return WORK_TYPES.PREPULL;
    
    return WORK_TYPES.DELIVERY; 
  }

  // ✅ 5. Fallbacks
  if (container.isReadyForPickup) return WORK_TYPES.TERMINATION;
  if (container.isPrePull && !container.isInYard) return WORK_TYPES.PREPULL;
  if (container.appointmentDate) return WORK_TYPES.DELIVERY;
  
  return 'scheduled';
};

const getProgressPercentage = (container, selectedDateStr) => {
  const workType = container.workType || getWorkType(container, selectedDateStr);
  switch (workType) {
    case WORK_TYPES.PREPULL: return 25;
    case WORK_TYPES.PREPULL_WARNING: return 10;
    case WORK_TYPES.DELIVERY: return 50;
    case WORK_TYPES.PENDING_FOLLOWUP: return 75;
    case WORK_TYPES.BACKDATE_DROPPED: return 70;
    case WORK_TYPES.TERMINATION: return 85;
    case WORK_TYPES.COMPLETED: return 100;
    default: return 0;
  }
};


// ========== MAIN COMPONENT ==========
const TomorrowDispatchBoard = ({ 
  companyId, 
  onEdit, 
  setFeedback,
  selectedDate 
}) => {
  const [tomorrowDate, setTomorrowDate] = useState(selectedDate || getTomorrowDateString());
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // UI State
  const [boardTab, setBoardTab] = useState('deliveries'); 
  const [viewMode, setViewMode] = useState('cards');
  const [searchTerm, setSearchTerm] = useState('');
  const [workTypeFilter, setWorkTypeFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [sortField, setSortField] = useState('appointmentDate');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({ driver: '', truck: '', terminal: '', customer: '' });
  const [selectedContainers, setSelectedContainers] = useState(new Set());

  useEffect(() => {
    if (selectedDate) setTomorrowDate(selectedDate);
  }, [selectedDate]);

  // Fetch Data
  useEffect(() => {
    if (!companyId) return;

    setLoading(true);
    setError(null);

    const loadQuery = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', ['Open', 'Dispatched', 'In Transit', 'Delivered', 'Ready for Termination'])
    );

    const unsubscribe = onSnapshot(loadQuery,
      (snapshot) => {
        const loadList = snapshot.docs.map(doc => {
          const data = doc.data();
          const workType = getWorkType(data, tomorrowDate);
          const driverInfo = getActiveDriver(data.legs, workType, data);
          const hasMissedPrepull = checkMissedPrepull(data, tomorrowDate);

          return {
            id: doc.id,
            ...data,
            _type: data.shipmentType || data.type || 'import', // ✅ FIXED: Use actual type
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
            terminal: data.terminal || '',
            delivery: data.delivery || '',
            driverName: driverInfo.driverName, 
            truckNo: driverInfo.truckNo,       
            status: data.status || 'Open',
            containerNo: data.containerNo || 'N/A',
            customerName: data.customerName || 'N/A',
            workType: workType,
            hasMissedPrepull: hasMissedPrepull
          };
        });

        const processedLoads = loadList.map(c => ({
          ...c,
          progress: getProgressPercentage(c, tomorrowDate)
        }));

        setContainers(processedLoads);
        setLoading(false);
      },
      (error) => {
        console.error('Tomorrow fetch error:', error);
        setError(error.message || 'Failed to load tomorrow\'s dispatch');
        setFeedback?.('❌ Failed to load tomorrow\'s dispatch');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [companyId, tomorrowDate, setFeedback]);


  // Filtering & Sorting
  const filteredAndSortedContainers = useMemo(() => {
    let filtered = [...containers];

    filtered = filtered.filter(c => {
      const isFinished =
        c.isTerminated ||
        c.status === 'Completed' ||
        c.status === 'Paid' ||
        c.status === 'Closed' ||
        c.status === 'Ready for Billing';

      if (isFinished) return false;

      const isBackdated = c.workType === WORK_TYPES.BACKDATE_DROPPED;
      const isPending = c.workType === WORK_TYPES.PENDING_FOLLOWUP;

      // Tab Separation
      if (boardTab === 'prepull_warning') {
        if (!c.hasMissedPrepull) return false;
      } else if (boardTab === 'unassigned') {
        const needsAction = isBackdated || isPending || c.workType === WORK_TYPES.TERMINATION || c.isInYard;
        if (!needsAction) return false;
        if (c.driverName && c.driverName.trim() !== '' && c.driverName.toLowerCase() !== 'unassigned') return false;
      } else if (boardTab === 'drivers') {
        if (!c.driverName || c.driverName.trim() === '' || c.driverName.toLowerCase().includes('unassigned') || c.driverName.toLowerCase().includes('tbd')) return false;
      } else if (boardTab === 'followup') {
        if (!isBackdated && !isPending) return false;
      } else {
        if (isBackdated || isPending) return false; // Active Deliveries tab
      }

      // Event Check for Tomorrow
      const needsTermination = c.isDroppedAtCustomer || c.isReadyForPickup || c.workType === WORK_TYPES.PENDING_FOLLOWUP || c.workType === WORK_TYPES.BACKDATE_DROPPED;
      if (needsTermination) {
        if (workTypeFilter === WORK_TYPES.PENDING_FOLLOWUP) return c.workType === WORK_TYPES.PENDING_FOLLOWUP;
        if (workTypeFilter === WORK_TYPES.BACKDATE_DROPPED) return c.workType === WORK_TYPES.BACKDATE_DROPPED;
        if (workTypeFilter === WORK_TYPES.TERMINATION) return c.workType === WORK_TYPES.TERMINATION;
        if (workTypeFilter === 'all') return true;
        return false;
      }

      const hasAppointmentTomorrow = isSameDay(c.appointmentDate, tomorrowDate);
      const hasPrepullTomorrow = isSameDay(c.prepullDate, tomorrowDate) && c.isPrePull === true;
      const hasDeliveryTomorrow = isSameDay(c.deliveryDate, tomorrowDate);
      const hasReturnTomorrow = isSameDay(c.returnDate, tomorrowDate);
      const hasReadyForPickupTomorrow = isSameDay(c.readyForPickupDate, tomorrowDate) && c.isReadyForPickup === true;
      const hasLfdTomorrow = isSameDay(c.lfdDate, tomorrowDate) && !c.isInYard;
      const hasLegTomorrow = (c.legs || []).some(leg => isSameDay(leg.legDate, tomorrowDate));

      const hasEventTomorrow = c.hasMissedPrepull || hasAppointmentTomorrow || hasPrepullTomorrow || hasDeliveryTomorrow || hasReturnTomorrow || hasReadyForPickupTomorrow || hasLfdTomorrow || hasLegTomorrow;

      if (!hasEventTomorrow) return false;

      if (workTypeFilter !== 'all' && c.workType !== workTypeFilter) return false;

      return true;
    });

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(c =>
        c.containerNo?.toLowerCase().includes(term) ||
        c.customerName?.toLowerCase().includes(term) ||
        c.driverName?.toLowerCase().includes(term)
      );
    }

    if (advancedFilters.driver) filtered = filtered.filter(c => c.driverName?.toLowerCase().includes(advancedFilters.driver.toLowerCase()));
    if (advancedFilters.truck) filtered = filtered.filter(c => c.truckNo?.toLowerCase().includes(advancedFilters.truck.toLowerCase()));
    if (advancedFilters.terminal) filtered = filtered.filter(c => c.terminal?.toLowerCase().includes(advancedFilters.terminal.toLowerCase()));
    if (advancedFilters.customer) filtered = filtered.filter(c => c.customerName?.toLowerCase().includes(advancedFilters.customer.toLowerCase()));

    filtered.sort((a, b) => {
      if (boardTab === 'drivers') {
        const driverA = a.driverName || '';
        const driverB = b.driverName || '';
        if (driverA < driverB) return -1;
        if (driverA > driverB) return 1;
        return 0;
      }
      let valA, valB;
      switch (sortField) {
        case 'appointmentDate': valA = a.appointmentDate || '9999-99-99'; valB = b.appointmentDate || '9999-99-99'; break;
        case 'containerNo': valA = a.containerNo || ''; valB = b.containerNo || ''; break;
        case 'customerName': valA = a.customerName || ''; valB = b.customerName || ''; break;
        default: valA = a[sortField] || ''; valB = b[sortField] || '';
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [containers, boardTab, searchTerm, workTypeFilter, tomorrowDate, sortField, sortDirection, advancedFilters]);

  // Calculate Stats for Tomorrow
  const stats = useMemo(() => {
    return {
      total: filteredAndSortedContainers.length,
      prepull: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.PREPULL).length,
      prepull_warning: filteredAndSortedContainers.filter(c => c.hasMissedPrepull).length,
      delivery: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.DELIVERY).length,
      pending_followup: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP).length,
      backdate_dropped: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED).length,
      termination: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.TERMINATION).length,
      completed: filteredAndSortedContainers.filter(c => c.workType === WORK_TYPES.COMPLETED).length,
    };
  }, [filteredAndSortedContainers]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => { setRefreshing(false); setFeedback?.('✅ Data refreshed'); }, 1000);
  };

  const renderCardContent = (container) => {
    const isExport = container._type === 'export';
    const isBackdated = container.workType === WORK_TYPES.BACKDATE_DROPPED;
    const isPending = container.workType === WORK_TYPES.PENDING_FOLLOWUP;
    const isPrepullWarning = container.hasMissedPrepull;
    const rvAlert = getRvAlert(container);

    // ✅ Get accurate drop date from completed legs
    const completedLegs = (container.legs || []).filter(l => l.status === 'Completed' || l.status === 'Delivered');
    let actualDropDate = null;
    
    if (completedLegs.length > 0) {
      const dropLeg = completedLegs.find(l => 
        (l.legType === 'delivery' || l.legType === 'drop' || l.legType === 'stopoff' || l.legType === 'live')
      );
      const targetLeg = dropLeg || completedLegs[completedLegs.length - 1];
      actualDropDate = targetLeg.legDate;
    }
    
    if (!actualDropDate) {
      actualDropDate = container.deliveryDate || container.appointmentDate || container.updatedAt;
    }

    if (actualDropDate && typeof actualDropDate === 'string' && actualDropDate.includes('T')) {
      actualDropDate = actualDropDate.split('T')[0];
    }

    const isDropped = container.isDroppedAtCustomer || container.isDelivered || isPending || isBackdated || completedLegs.length > 0;
    const isDroppedToday = isDropped && actualDropDate && isSameDay(actualDropDate, getTodayDate());
    const isDroppedPast = isDropped && actualDropDate && !isSameDay(actualDropDate, getTodayDate());
    
    return (
      <div 
        key={container.id} 
        className={`bg-white border ${isPrepullWarning ? 'border-red-300 shadow-red-100' : 'border-slate-200'} rounded-lg p-3 shadow-sm hover:shadow-md hover:border-orange-400 transition-all cursor-pointer group flex flex-col`}
        onClick={() => onEdit?.(container)}
      >
        <div className="flex justify-between items-start mb-1">
          <div className="flex gap-1">
            <span className={`text-[8px] font-black px-1 py-0.5 rounded ${isExport ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
              {isExport ? 'EXP' : 'IMP'}
            </span>
            <span className={`text-[8px] font-black px-1 py-0.5 rounded ${container.loadType === 'LIVE' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
              {container.loadType || 'DROP'}
            </span>
          </div>
          {isPrepullWarning ? (
            <span className="text-[8px] font-black text-white bg-red-600 px-1 py-0.5 rounded animate-pulse shadow-sm">Pre-Pull Missed</span>
          ) : container.isReadyForPickup ? (
            <span className="text-[8px] font-black text-red-600 bg-red-50 px-1 py-0.5 rounded border border-red-200 animate-pulse shadow-sm">Ready for Pickup</span>
          ) : isDroppedToday ? (
            <span className="text-[8px] font-black text-amber-900 bg-amber-100 px-1 py-0.5 rounded border border-amber-300 shadow-sm">
              Dropped Today
            </span>
          ) : isDroppedPast ? (
            <span className="text-[8px] font-black text-orange-900 bg-orange-100 px-1 py-0.5 rounded border border-orange-300 shadow-sm">
              Dropped
            </span>
          ) : container.isInYard ? (
            <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-200">Ready in Yard</span>
          ) : container.workType === WORK_TYPES.PREPULL ? (
            <span className="text-[8px] font-black text-purple-600 bg-purple-50 px-1 py-0.5 rounded border border-purple-200">Pre-Pull</span>
          ) : null}
        </div>

        <div className="mb-1.5">
          <h4 className="font-black text-sm text-slate-800 group-hover:text-orange-600 truncate">{container.containerNo || 'N/A'}</h4>
          <p className="text-[10px] font-bold text-slate-500 truncate">{container.customerName || 'N/A'}</p>
        </div>

        <div className="space-y-1 text-[10px] font-medium text-slate-600 mb-2 flex-1">
          <div className="flex items-start gap-1">
            <Clock className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            <span>{container.appointmentTime || 'TBD'}</span>
          </div>
          <div className="flex items-start gap-1">
            <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            <span className="truncate">{container.delivery || container.terminal || 'No Location'}</span>
          </div>
          {container.size && (
            <div className="flex items-start gap-1">
              <Package className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
              <span className="font-bold">{container.size}</span>
            </div>
          )}
        </div>

        {/* RV Alerts */}
        {rvAlert && (
          <div className={`mb-1.5 p-2 rounded border flex flex-col gap-1.5 ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'bg-red-100 border-red-300 shadow-sm animate-pulse' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-1.5">
              <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'text-red-700' : 'text-amber-600'}`} />
              <span className={`text-[10px] font-black ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'text-red-800' : 'text-amber-800'}`}>
                RV: {rvAlert.rvNo || 'N/A'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-2 text-[8px] font-bold text-slate-600 bg-white/50 px-1.5 py-1 rounded">
              {rvAlert.earlyDate && <span>Active: {rvAlert.earlyDate} {rvAlert.earlyTime}</span>}
              {rvAlert.cutoffDate && <span>| Cutoff: {rvAlert.cutoffDate} {rvAlert.cutoffTime}</span>}
            </div>
            <span className={`text-[9px] font-black leading-snug ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'text-red-800' : 'text-amber-800'}`}>
              {rvAlert.message}
            </span>
          </div>
        )}

        {isPrepullWarning ? (
          <div className="mb-2 bg-red-100 p-2 rounded border border-red-300 flex items-start gap-1.5 shadow-sm animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
            <span className="text-[9px] font-black text-red-800 leading-snug">
              PRE-PULL MISSED! LFD was {formatDate(container.lfdDate)}. Arrange ASAP.
            </span>
          </div>
        ) : (isDropped || isPending || isBackdated) ? (
          <div className="mb-2 bg-amber-50 p-2 rounded border border-amber-200 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-[9px] font-bold text-amber-800 leading-snug">
              Dropped on {formatDate(actualDropDate || getTodayDate())}. Take follow up.
            </span>
          </div>
        ) : null}

        <div className="mt-auto pt-1 border-t border-slate-100 flex items-center justify-between">
          {container.driverName ? (
            <div className="flex items-center gap-1 min-w-0">
              <User className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-700 truncate">{container.driverName}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-yellow-600">
              <User className="w-3 h-3 shrink-0" />
              <span className="text-[9px] font-bold uppercase">Unassigned</span>
            </div>
          )}
          <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-1 rounded">
            {container.truckNo || 'No Truck'}
          </span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 text-orange-600 animate-spin" />
        <div className="text-center">
          <p className="text-orange-700 font-bold">Loading tomorrow's dispatch...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-gradient-to-r from-orange-50 to-amber-50 p-4 rounded-2xl border border-orange-200">
        <div>
          <h2 className="text-xl font-black text-orange-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-orange-600" />
            Tomorrow's Board
          </h2>
          <p className="text-xs text-orange-700 font-medium flex items-center gap-2 mt-0.5">
            Planning for {formatDate(tomorrowDate)} • {stats.total} containers
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={tomorrowDate} onChange={(e) => setTomorrowDate(e.target.value)} className="px-3 py-1.5 bg-white border border-orange-200 rounded-lg font-bold text-xs outline-none focus:ring-2 focus:ring-orange-500" />
          <div className="flex rounded-lg border border-orange-200 overflow-hidden bg-white">
            <button onClick={() => setViewMode('cards')} className={`px-3 py-1.5 text-[10px] font-bold transition-all ${viewMode === 'cards' ? 'bg-orange-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📋 Cards</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 text-[10px] font-bold transition-all ${viewMode === 'table' ? 'bg-orange-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📊 Table</button>
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-orange-200 hover:bg-orange-100 rounded-lg font-bold text-xs transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 text-orange-600 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* MODERN STATS CARDS */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer" onClick={() => setWorkTypeFilter('all')}>
          <div className="flex items-center justify-between"><div className="w-6 h-6 bg-slate-100 rounded flex items-center justify-center"><Package className="w-3 h-3 text-slate-600" /></div><span className="text-lg font-black text-slate-900">{stats.total}</span></div>
          <div className="mt-1 text-[9px] font-black text-slate-400 uppercase">Total</div>
        </div>
        {Object.entries(WORK_TYPES).map(([key, value]) => {
          const style = STATUS_STYLES[value];
          const icons2 = { PREPULL: Truck, DELIVERY: Navigation, PENDING_FOLLOWUP: Bell, BACKDATE_DROPPED: History, TERMINATION: Anchor, COMPLETED: CheckCircle, PREPULL_WARNING: AlertTriangle };
          const IconComponent = icons2[key];
          return (
            <div key={value} className={`${style.bg} p-2 rounded-xl border ${style.border} shadow-sm hover:shadow-md transition-all cursor-pointer ${key === 'PREPULL_WARNING' ? 'ring-2 ring-red-500 animate-pulse' : ''}`} onClick={() => setWorkTypeFilter(workTypeFilter === value ? 'all' : value)}>
              <div className="flex items-center justify-between"><div className="w-6 h-6 bg-white/50 rounded flex items-center justify-center"><IconComponent className={`w-3 h-3 ${style.text}`} /></div><span className={`text-lg font-black ${style.text}`}>{stats[value] || 0}</span></div>
              <div className={`mt-1 text-[8px] font-black uppercase ${style.text}`}>{value === 'backdate_dropped' ? '📦 Back-Dated' : value === 'prepull_warning' ? '🚨 Pre-Pull Missed' : key.charAt(0) + key.slice(1).toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      {/* MERGED TABS, SEARCH & FILTERS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 border-b border-slate-200 pb-1 mb-2">
        <div className="flex gap-4 overflow-x-auto w-full xl:w-auto pb-1 custom-scrollbar">
          <button onClick={() => setBoardTab('deliveries')} className={`px-4 py-2 font-black text-sm border-b-2 transition-all whitespace-nowrap ${boardTab === 'deliveries' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Active Deliveries</button>
          <button onClick={() => setBoardTab('followup')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'followup' ? 'border-amber-600 text-amber-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Follow Up Required</button>
          <button onClick={() => setBoardTab('drivers')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'drivers' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><User className="w-4 h-4" /> Drivers</button>
          <button onClick={() => setBoardTab('unassigned')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'unassigned' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><AlertCircle className="w-4 h-4" /> Unassigned</button>
          <button onClick={() => setBoardTab('prepull_warning')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'prepull_warning' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><AlertTriangle className="w-4 h-4" /> Pre-Pull Warning {stats.prepull_warning > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">{stats.prepull_warning}</span>}</button>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto pb-2 xl:pb-1">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input type="text" placeholder="Search container #, customer..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500 text-xs font-medium" />
          </div>
          <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${showAdvancedFilters ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            <Filter className="w-3.5 h-3.5" /> Filters <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
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

      {/* VIEW MODES */}
      {viewMode === 'table' ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Container</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedContainers.length === 0 ? (
                  <tr><td colSpan="7" className="px-6 py-12 text-center text-slate-400 font-bold italic">No containers scheduled for {formatDate(tomorrowDate)}</td></tr>
                ) : (
                  filteredAndSortedContainers.map(container => {
                    const workType = container.workType;
                    const style = STATUS_STYLES[workType] || STATUS_STYLES.scheduled;
                    const isPrepullWarning = container.hasMissedPrepull;

                    const completedLegs = (container.legs || []).filter(l => l.status === 'Completed' || l.status === 'Delivered');
                    let actualDropDate = null;
                    
                    if (completedLegs.length > 0) {
                      const dropLeg = completedLegs.find(l => 
                        (l.legType === 'delivery' || l.legType === 'drop' || l.legType === 'stopoff' || l.legType === 'live')
                      );
                      const targetLeg = dropLeg || completedLegs[completedLegs.length - 1];
                      actualDropDate = targetLeg.legDate;
                    }
                    
                    if (!actualDropDate) {
                      actualDropDate = container.deliveryDate || container.appointmentDate || container.updatedAt;
                    }
                    
                    if (actualDropDate && typeof actualDropDate === 'string' && actualDropDate.includes('T')) {
                      actualDropDate = actualDropDate.split('T')[0];
                    }

                    const isDropped = container.isDroppedAtCustomer || container.isDelivered || workType === WORK_TYPES.PENDING_FOLLOWUP || workType === WORK_TYPES.BACKDATE_DROPPED || completedLegs.length > 0;
                    const isDroppedToday = isDropped && actualDropDate && isSameDay(actualDropDate, getTodayDate());
                    const isDroppedPast = isDropped && actualDropDate && !isSameDay(actualDropDate, getTodayDate());

                    return (
                      <tr key={container.id} className={`${style.bg} hover:shadow-md transition-all cursor-pointer group`}>
                        <td className="px-4 py-3">
                          {isPrepullWarning ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-red-600 text-white border-red-700 animate-pulse`}>Pre-Pull Missed</span>
                          ) : container.isReadyForPickup ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-red-100 text-red-800 border-red-300 animate-pulse ml-1`}>
                              Ready for Pickup
                            </span>
                          ) : isDroppedToday ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-amber-100 text-amber-900 border-amber-300 ml-1`}>
                              Dropped Today
                            </span>
                          ) : isDroppedPast ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-orange-100 text-orange-900 border-orange-300 ml-1`}>
                              Dropped
                            </span>
                          ) : container.isInYard && workType !== WORK_TYPES.TERMINATION && workType !== WORK_TYPES.COMPLETED ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-blue-100 text-blue-800 border-blue-200 ml-1`}>
                              Ready in Yard
                            </span>
                          ) : (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border ${style.badge} ml-1`}>
                              {WORK_TYPE_LABELS[workType] || 'Scheduled'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3"><button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="font-black text-slate-900 hover:text-orange-600 text-left">{container.containerNo || 'N/A'}</button></td>
                        <td className="px-4 py-3 text-sm">{container.customerName || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm truncate max-w-[250px]">{container.delivery || container.terminal || '—'}</td>
                        <td className="px-4 py-3">
                          {container.driverName ? (<span className="text-sm font-bold text-green-600">{container.driverName}</span>) : (<span className="text-xs text-slate-400 italic">Unassigned</span>)}
                        </td>
                        <td className="px-4 py-3 text-sm">{container.truckNo || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(container); }} className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"><Edit3 className="w-4 h-4" /></button>
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
        <div className={boardTab === 'drivers' ? "space-y-6" : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2"}>
          {filteredAndSortedContainers.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-xl border border-slate-200 text-sm">
              No containers scheduled for {formatDate(tomorrowDate)} under this tab.
            </div>
          ) : boardTab === 'drivers' ? (
            Object.entries(
              filteredAndSortedContainers.reduce((acc, c) => {
                const d = c.driverName || 'Unassigned';
                if (!acc[d]) acc[d] = [];
                acc[d].push(c);
                return acc;
              }, {})
            ).map(([driver, driverContainers]) => (
              <div key={driver} className="bg-orange-50/50 p-3 rounded-2xl border border-orange-200">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3 bg-white p-2 rounded-xl shadow-sm border border-orange-100">
                  <User className="w-4 h-4 text-orange-600" /> 
                  {driver} 
                  <span className="bg-orange-100 text-orange-800 text-[10px] px-2 py-0.5 rounded-full">{driverContainers.length} Container{driverContainers.length > 1 ? 's' : ''}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                  {driverContainers.map(container => renderCardContent(container))}
                </div>
              </div>
            ))
          ) : (
            filteredAndSortedContainers.map(container => renderCardContent(container))
          )}
        </div>
      )}
    </div>
  );
};

export default TomorrowDispatchBoard;