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

// ✅ PASTE getRvAlert HERE (After formatDate)
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
  if (!selectedDateStr) selectedDateStr = getTodayDate();
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
  if (!selectedDateStr) selectedDateStr = getTodayDate();

  if (container.isTerminated || container.status === 'Ready for Billing' || container.status === 'Completed') {
    return WORK_TYPES.COMPLETED;
  }

  const legs = container.legs || [];
  const selectedLegs = legs.filter(l => isSameDay(l.legDate, selectedDateStr));

  // ✅ 1. CHECK IF DROPPED/DELIVERED FIRST (Before checking today's legs)
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

  // ✅ 2. Check for active deliveries 
  if (selectedLegs.length > 0) {
    const activeDelivery = selectedLegs.find(l => 
      l.legType !== 'termination' && 
      l.legType !== 'prepull' && 
      l.status !== 'Completed' && 
      l.status !== 'Delivered'
    );
    if (activeDelivery) return WORK_TYPES.DELIVERY;
  }

  // ✅ 3. Check the warning separately
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

  if (container.isReadyForPickup) return WORK_TYPES.TERMINATION;

  if (container.lfdDate && isSameDay(container.lfdDate, selectedDateStr) && !container.isInYard) {
    return WORK_TYPES.PREPULL;
  }

  if (container.isPrePull && !container.isInYard) return WORK_TYPES.PREPULL;
  
  if (container.appointmentDate) return WORK_TYPES.DELIVERY;
  
  return 'scheduled';
};

const getProgressPercentage = (container, selectedDate) => {
  const workType = container.workType || getWorkType(container, selectedDate || getTodayDate());
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
  
  const [viewMode, setViewMode] = useState('cards'); 
  const [boardTab, setBoardTab] = useState('deliveries'); 

  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [updatingContainer, setUpdatingContainer] = useState(null);
  const [error, setError] = useState(null);
  const [pendingFollowupCount, setPendingFollowupCount] = useState(0);
  const [backdateDroppedCount, setBackdateDroppedCount] = useState(0);
  const [prepullWarningCount, setPrepullWarningCount] = useState(0);

  const [completeConfirm, setCompleteConfirm] = useState({ isOpen: false, container: null, acknowledged: false, notes: '' });
  const [advancedFilters, setAdvancedFilters] = useState({ driver: '', truck: '', terminal: '', customer: '' });

  useEffect(() => {
    if (propSelectedDate) setSelectedDate(propSelectedDate);
  }, [propSelectedDate]);

  // ========== FETCH DATA ==========
  useEffect(() => {
    if (!companyId) return;

    if (skipInitialFetch && preloadedContainers) {
      const processed = preloadedContainers.map(c => {
        const workType = getWorkType(c, selectedDate);
        const driverInfo = getActiveDriver(c.legs, workType, c);
        return {
          ...c,
          driverName: driverInfo.driverName,
          truckNo: driverInfo.truckNo,
          workType: workType,
          hasMissedPrepull: checkMissedPrepull(c, selectedDate),
          progress: getProgressPercentage(c, selectedDate)
        };
      });
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
          const workType = getWorkType(data, selectedDate);
          const driverInfo = getActiveDriver(data.legs, workType, data);

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
            railCarrier: data.railCarrier || 'CN',
            terminal: data.terminal || '',
            delivery: data.delivery || '',
            driverName: driverInfo.driverName, 
            truckNo: driverInfo.truckNo,       
            status: data.status || 'Open',
            containerNo: data.containerNo || 'N/A',
            customerName: data.customerName || 'N/A',
            workType: workType
          };
        });

        const processedLoads = loadList.map(c => ({
          ...c,
          hasMissedPrepull: checkMissedPrepull(c, selectedDate),
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
          const workType = getWorkType({ ...data, _type: 'export' }, selectedDate);
          const driverInfo = getActiveDriver(data.legs, workType, data);

          return {
            id: doc.id,
            ...data,
            _type: 'export', // This is safe for the exports collection
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
            driverName: driverInfo.driverName || data.driverName || '',
            truckNo: driverInfo.truckNo || data.truckNo || '',
            railCarrier: 'CN',
            bookingNo: data.bookingNo || '',
            isLoaded: data.isLoaded || false,
            isConfirmed: data.isConfirmed || false,
            workType: workType
          };
        });

        const processedExports = exportList.map(c => ({
          ...c,
          hasMissedPrepull: checkMissedPrepull(c, selectedDate),
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
    const warnings = allContainers.filter(c => c.hasMissedPrepull);
    
    setPendingFollowupCount(pending.length);
    setBackdateDroppedCount(backdated.length);
    setPrepullWarningCount(warnings.length);
  }, [loadContainers, exportContainers]);

  // ========== FILTERING ==========
  const filteredAndSortedContainers = useMemo(() => {
    let filtered = [...containers];
    const today = selectedDate || todayStr;

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

      // Tab Separation Logic
      if (boardTab === 'prepull_warning') {
        if (!c.hasMissedPrepull) return false; 
      } else if (boardTab === 'unassigned') {
        const needsAction = isBackdated || isPending || c.workType === WORK_TYPES.TERMINATION || c.isInYard;
        if (!needsAction) return false;
        if (c.driverName && c.driverName.trim() !== '' && c.driverName.toLowerCase() !== 'unassigned') return false;
      } else if (boardTab === 'drivers') {
        if (!c.driverName || c.driverName.trim() === '' || c.driverName.toLowerCase().includes('unassigned') || c.driverName.toLowerCase().includes('tbd')) {
          return false;
        }
      } else if (boardTab === 'followup') {
        if (!isBackdated && !isPending) return false;
      } else {
        // boardTab === 'deliveries'
        if (isBackdated || isPending) return false; 
      }

      const needsTermination = c.isDroppedAtCustomer || c.isReadyForPickup || c.workType === WORK_TYPES.PENDING_FOLLOWUP || c.workType === WORK_TYPES.BACKDATE_DROPPED;

      if (needsTermination) {
        if (workTypeFilter === WORK_TYPES.PENDING_FOLLOWUP) return c.workType === WORK_TYPES.PENDING_FOLLOWUP;
        if (workTypeFilter === WORK_TYPES.BACKDATE_DROPPED) return c.workType === WORK_TYPES.BACKDATE_DROPPED;
        if (workTypeFilter === WORK_TYPES.TERMINATION) return c.workType === WORK_TYPES.TERMINATION;
        if (workTypeFilter === 'all') return true;
        return false;
      }

      const hasAppointmentToday = isSameDay(c.appointmentDate, today);
      const hasPrepullToday = isSameDay(c.prepullDate, today) && c.isPrePull === true;
      const hasDeliveryToday = isSameDay(c.deliveryDate, today);
      const hasReturnToday = isSameDay(c.returnDate, today);
      const hasLoadingDateToday = isSameDay(c.loadingDate, today);
      const hasErdToday = isSameDay(c.erd, today);
      const hasReadyForPickupToday = isSameDay(c.readyForPickupDate, today) && c.isReadyForPickup === true;
      const hasLfdToday = isSameDay(c.lfdDate, today) && !c.isInYard;
      const hasLegToday = (c.legs || []).some(leg => isSameDay(leg.legDate, today));

      const hasEventToday = c.hasMissedPrepull || hasAppointmentToday || hasPrepullToday || hasDeliveryToday || hasReturnToday || hasLoadingDateToday || hasErdToday || hasReadyForPickupToday || hasLfdToday || hasLegToday;

      if (!hasEventToday) return false;

      if (workTypeFilter !== 'all' && c.workType !== workTypeFilter) {
        return false;
      }

      return true;
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
      if (boardTab === 'drivers') {
        const driverA = a.driverName || '';
        const driverB = b.driverName || '';
        if (driverA < driverB) return -1;
        if (driverA > driverB) return 1;
        return 0;
      }

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
          const order = ['prepull_warning', 'prepull', 'delivery', 'pending_followup', 'backdate_dropped', 'termination', 'completed'];
          valA = order.indexOf(a.workType); valB = order.indexOf(b.workType); break;
        default: valA = a[sortField] || ''; valB = b[sortField] || '';
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
}, [containers, workTypeFilter, searchTerm, sortField, sortDirection, selectedDate, todayStr, advancedFilters, boardTab]);

  const pendingFollowupContainers = useMemo(() => containers.filter(c => c.workType === WORK_TYPES.PENDING_FOLLOWUP), [containers]);
  const backdateDroppedContainers = useMemo(() => containers.filter(c => c.workType === WORK_TYPES.BACKDATE_DROPPED), [containers]);

  const stats = useMemo(() => {
    const todayContainers = filteredAndSortedContainers;
    return {
      total: todayContainers.length,
      imports: todayContainers.filter(c => c._type === 'import').length,
      exports: todayContainers.filter(c => c._type === 'export').length,
      prepull: todayContainers.filter(c => c.workType === WORK_TYPES.PREPULL).length,
      prepull_warning: todayContainers.filter(c => c.hasMissedPrepull).length,
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
        className={`bg-white border ${isPrepullWarning ? 'border-red-300 shadow-red-100' : 'border-slate-200'} rounded-lg p-2 shadow-sm hover:shadow-md hover:border-blue-400 transition-all cursor-pointer group flex flex-col`}
        onClick={() => onEdit?.(container)}
      >
        {/* Header Tags */}
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
            <span className="text-[8px] font-black text-white bg-red-600 px-1 py-0.5 rounded animate-pulse shadow-sm">
              Pre-Pull Missed
            </span>
          ) : container.isReadyForPickup ? (
            <span className="text-[8px] font-black text-red-600 bg-red-50 px-1 py-0.5 rounded border border-red-200 animate-pulse shadow-sm">
              Ready for Pickup
            </span>
          ) : isDroppedToday ? (
            <span className="text-[8px] font-black text-amber-900 bg-amber-100 px-1 py-0.5 rounded border border-amber-300 shadow-sm">
              Dropped Today
            </span>
          ) : isDroppedPast ? (
            <span className="text-[8px] font-black text-orange-900 bg-orange-100 px-1 py-0.5 rounded border border-orange-300 shadow-sm">
              Dropped
            </span>
          ) : container.isInYard ? (
            <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-200">
              Ready in Yard
            </span>
          ) : container.workType === WORK_TYPES.PREPULL ? (
            <span className="text-[8px] font-black text-purple-600 bg-purple-50 px-1 py-0.5 rounded border border-purple-200">
              Pre-Pull
            </span>
          ) : null}
        </div>

        {/* Container & Customer */}
        <div className="mb-1.5">
          <h4 className="font-black text-xs text-slate-800 group-hover:text-blue-600 truncate">{container.containerNo || 'N/A'}</h4>
          <p className="text-[9px] font-bold text-slate-500 truncate">{container.customerName || 'N/A'}</p>
        </div>

        {/* Details */}
        <div className="space-y-1 text-[9px] font-medium text-slate-600 mb-1.5 flex-1">
          <div className="flex items-start gap-1">
            <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0 mt-0.5" />
            <span>{container.appointmentTime || 'TBD'}</span>
          </div>
          <div className="flex items-start gap-1">
            <MapPin className="w-2.5 h-2.5 text-slate-400 shrink-0 mt-0.5" />
            <span className="truncate">{container.delivery || container.terminal || 'No Location'}</span>
          </div>
          {container.size && (
            <div className="flex items-start gap-1">
              <Package className="w-2.5 h-2.5 text-slate-400 shrink-0 mt-0.5" />
              <span className="font-bold">{container.size}</span>
            </div>
          )}
        </div>

        {/* Alerts */}
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
          <div className="mb-1.5 bg-red-100 p-2 rounded border border-red-300 flex items-start gap-1.5 shadow-sm animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
            <span className="text-[9px] font-black text-red-800 leading-snug">
              PRE-PULL MISSED! LFD was {formatDate(container.lfdDate)}. Arrange ASAP.
            </span>
          </div>
        ) : (isDropped || isPending || isBackdated) ? (
          <div className="mb-1.5 bg-red-50 p-2 rounded border border-red-100 flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
            <span className="text-[9px] font-bold text-red-700 leading-snug">
              Dropped on {formatDate(actualDropDate || getTodayDate())}. Take follow up.
            </span>
          </div>
        ) : null}

        {/* Driver Info */}
        <div className="mt-auto pt-1 border-t border-slate-100 flex items-center justify-between">
          {container.driverName ? (
            <div className="flex items-center gap-1 min-w-0">
              <User className="w-2.5 h-2.5 text-slate-400 shrink-0" />
              <span className="text-[9px] font-bold text-slate-700 truncate">{container.driverName}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-yellow-600">
              <User className="w-2.5 h-2.5 shrink-0" />
              <span className="text-[8px] font-bold uppercase">Unassigned</span>
            </div>
          )}
          <span className="text-[8px] font-bold text-slate-400 bg-slate-50 px-1 rounded">
            {container.truckNo || 'No Truck'}
          </span>
        </div>
      </div>
    );
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
    <div className="space-y-3">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Today's Board
          </h2>
          <p className="text-xs text-slate-500 font-medium flex items-center gap-2 mt-0.5">
            {formatDate(selectedDate)} • {stats.total} containers
            {backdateDroppedCount > 0 && (
              <span className="flex items-center gap-1 text-orange-600 text-[10px] font-bold bg-orange-50 px-2 py-0.5 rounded-full">
                <AlertOctagon className="w-3 h-3" /> {backdateDroppedCount} backdated
              </span>
            )}
            <span className="flex items-center gap-1 text-blue-600 text-[10px] font-bold bg-blue-50 px-2 py-0.5 rounded-full">
              <Activity className="w-3 h-3" /> {stats.progress}% complete
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-xs outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            <button onClick={() => setViewMode('cards')} className={`px-3 py-1.5 text-[10px] font-bold transition-all ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📋 Cards</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 text-[10px] font-bold transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>📊 Table</button>
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
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
            <div key={value} className={`${style.bg} p-2 rounded-xl border ${style.border} shadow-sm hover:shadow-md transition-all cursor-pointer ${key === 'PENDING_FOLLOWUP' ? 'ring-1 ring-amber-400' : key === 'BACKDATE_DROPPED' ? 'ring-1 ring-orange-400' : key === 'PREPULL_WARNING' ? 'ring-2 ring-red-500 animate-pulse' : ''}`} onClick={() => setWorkTypeFilter(workTypeFilter === value ? 'all' : value)}>
              <div className="flex items-center justify-between"><div className="w-6 h-6 bg-white/50 rounded flex items-center justify-center"><IconComponent className={`w-3 h-3 ${style.text}`} /></div><span className={`text-lg font-black ${style.text}`}>{stats[value] || 0}</span></div>
              <div className={`mt-1 text-[8px] font-black uppercase ${style.text}`}>{value === 'backdate_dropped' ? '📦 Back-Dated' : value === 'prepull_warning' ? '🚨 Pre-Pull Missed' : key.charAt(0) + key.slice(1).toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      {/* ================= MERGED TABS, SEARCH & FILTERS ================= */}
      {/* ================= RV ALERTS BANNER ================= */}
      {(() => {
        const rvAlerts = filteredAndSortedContainers.map(c => ({ load: c, alert: getRvAlert(c) })).filter(item => item.alert !== null);
        if (rvAlerts.length === 0) return null;
        
        return (
          <div className="bg-red-50 border-2 border-red-500 rounded-xl p-4 mb-4 animate-in slide-in-from-top-4 shadow-md">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="w-6 h-6 text-red-600 animate-pulse" />
              <h3 className="font-black text-red-900 text-lg">RV Action Required ({rvAlerts.length})</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {rvAlerts.map(({load, alert}, i) => (
                <div key={i} className="bg-white p-3 rounded-lg border border-red-200 shadow-sm cursor-pointer hover:border-red-400 transition-all" onClick={() => onEdit && onEdit(load)}>
                  <div className="font-black text-slate-800 text-sm flex justify-between">
                    <span>{load.containerNo || load.bookingNo || 'N/A'}</span>
                    <span className="text-[10px] text-slate-400">RV: {load.rvNo || 'N/A'}</span>
                  </div>
                  <div className={`text-xs font-bold mt-1 ${alert.type === 'expired' || alert.type === 'critical' || alert.type === 'active' ? 'text-red-600' : 'text-amber-600'}`}>
                    {alert.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 border-b border-slate-200 pb-1 mb-2">
        
        <div className="flex gap-4 overflow-x-auto w-full xl:w-auto pb-1 custom-scrollbar">
          <button onClick={() => setBoardTab('deliveries')} className={`px-4 py-2 font-black text-sm border-b-2 transition-all whitespace-nowrap ${boardTab === 'deliveries' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Active Deliveries</button>
          <button onClick={() => setBoardTab('followup')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'followup' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Follow Up Required</button>
          <button onClick={() => setBoardTab('drivers')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'drivers' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><User className="w-4 h-4" /> Drivers</button>
          <button onClick={() => setBoardTab('unassigned')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'unassigned' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><AlertCircle className="w-4 h-4" /> Unassigned</button>
          <button onClick={() => setBoardTab('prepull_warning')} className={`px-4 py-2 font-black text-sm border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${boardTab === 'prepull_warning' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}><AlertTriangle className="w-4 h-4" /> Pre-Pull Warning {stats.prepull_warning > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">{stats.prepull_warning}</span>}</button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto pb-2 xl:pb-1">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input type="text" placeholder="Search container #, customer..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-xs font-medium" />
          </div>
          <select value={workTypeFilter} onChange={(e) => setWorkTypeFilter(e.target.value)} className="appearance-none w-full sm:w-36 px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-bold text-[10px] cursor-pointer">
            <option value="all">📋 All Types</option>
            <option value="prepull">🔵 Pre-Pull</option>
            <option value="prepull_warning">🚨 Pre-Pull Missed</option>
            <option value="delivery">🟡 Delivery</option>
            <option value="pending_followup">⏳ Pending Follow-Up</option>
            <option value="backdate_dropped">📦 Back-Dated Drops</option>
            <option value="termination">🔴 Termination</option>
            <option value="completed">✅ Completed</option>
          </select>
          <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${showAdvancedFilters ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
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
                    const isPrepullWarning = container.hasMissedPrepull;
                    const termStatus = workType === WORK_TYPES.TERMINATION ? getTerminationStatus(container) : null;
                    
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
                      <tr key={container.id} className={`${style.bg} hover:shadow-md transition-all cursor-pointer group ${isBackdated ? 'border-l-4 border-l-orange-400' : isPending ? 'border-l-4 border-l-amber-400' : isPrepullWarning ? 'border-l-4 border-l-red-600' : ''}`}>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => toggleSelectContainer(container.id)}>
                            {selectedContainers.has(container.id) ? (<CheckSquare className="w-4 h-4 text-blue-600" />) : <Square className="w-4 h-4 text-slate-300" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {isBackdated ? (
                            <div><div className="font-bold text-sm text-orange-700">{formatDate(actualDropDate)}</div><div className="text-[8px] font-black text-orange-400 uppercase">📦 BACK-DATED</div></div>
                          ) : isPrepullWarning ? (
                            <div><div className="font-bold text-sm text-red-700">{formatDate(container.lfdDate)}</div><div className="text-[8px] font-black text-red-500 uppercase animate-pulse">🚨 LFD MISSED</div></div>
                          ) : (
                            <div><div className="font-bold text-sm">{container.appointmentTime ? formatTime(container.appointmentTime) : '—'}</div><div className="text-[8px] font-black text-slate-400 uppercase">{isExport ? '📤 EXPORT' : '📥 IMPORT'}</div></div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const rvAlert = getRvAlert(container);
                            if (!rvAlert) return null;
                            return <span className={`px-1.5 py-0.5 rounded text-[9px] text-white ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'bg-red-600 animate-pulse' : 'bg-amber-500'}`} title={rvAlert.message}>RV Alert</span>;
                          })()}
                          {isPrepullWarning ? (
                            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border bg-red-600 text-white border-red-700 animate-pulse ml-1`}>
                              Pre-Pull Missed
                            </span>
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
                              {WORK_TYPE_LABELS[workType] || '📋 Scheduled'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3"><button onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(container); }} className="font-black text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left" title="Open load">{container.containerNo || 'N/A'}</button></td>
                        <td className="px-4 py-3"><div className="font-medium text-sm">{container.customerName || 'N/A'}</div></td>
                        <td className="px-4 py-3 text-sm">
                          {isBackdated || isPending || isPrepullWarning ? (
                            <span className={`font-bold flex items-center gap-1 ${isBackdated ? 'text-orange-600' : isPrepullWarning ? 'text-red-600' : 'text-amber-600'}`}><MapPin className="w-3 h-3" />{container.delivery || container.terminal || 'Customer'}</span>
                          ) : (
                            <span className="truncate block max-w-[300px]" title={container.delivery || container.terminal}>
                              {container.delivery || container.terminal || '—'}
                            </span>
                          )}
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
        /* CARD VIEW - HIGHLY COMPACT */
        <div className={boardTab === 'drivers' ? "space-y-6" : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2"}>
          {filteredAndSortedContainers.length === 0 ? (
            <div className="col-span-full text-center py-8 text-slate-400 font-bold italic bg-white rounded-xl border border-slate-200 text-xs">No containers scheduled for {formatDate(selectedDate)}</div>
          ) : boardTab === 'drivers' ? (
            
            Object.entries(
              filteredAndSortedContainers.reduce((acc, c) => {
                const d = c.driverName || 'Unassigned';
                if (!acc[d]) acc[d] = [];
                acc[d].push(c);
                return acc;
              }, {})
            ).map(([driver, driverContainers]) => (
              <div key={driver} className="bg-slate-50/50 p-3 rounded-2xl border border-slate-200">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3 bg-white p-2 rounded-xl shadow-sm border border-slate-200">
                  <User className="w-4 h-4 text-purple-600" /> 
                  {driver} 
                  <span className="bg-purple-100 text-purple-800 text-[10px] px-2 py-0.5 rounded-full">{driverContainers.length} Container{driverContainers.length > 1 ? 's' : ''}</span>
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
      <div className="p-2 bg-white rounded-lg border border-slate-200 flex flex-wrap items-center gap-3">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Work Types:</span>
        {Object.entries(WORK_TYPES).map(([key, value]) => {
          const style = STATUS_STYLES[value];
          const icons = { PREPULL: '🔵', DELIVERY: '🟡', PENDING_FOLLOWUP: '⏳', BACKDATE_DROPPED: '📦', TERMINATION: '🔴', COMPLETED: '✅', PREPULL_WARNING: '🚨' };
          return (
            <div key={value} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded border ${style.border} ${style.bg}`}></span>
              <span className={`text-[8px] font-bold ${style.text}`}>{icons[key]} {value === 'backdate_dropped' ? 'Back-Dated' : value === 'prepull_warning' ? 'Pre-Pull Missed' : key.charAt(0) + key.slice(1).toLowerCase()}</span>
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