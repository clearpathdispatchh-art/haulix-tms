import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, X, AlertCircle, Clock, CheckCircle, Truck, Home, Package,
  User, Calendar, MapPin, Eye, Edit3, Zap, Flag, Anchor, DollarSign, AlertTriangle, Ship, BookOpen
} from 'lucide-react';
import {
  collection, doc, updateDoc, onSnapshot, query, where, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';

// ────────────── HELPER: Has the container been pre‑pulled before LFD? (import only) ──────────────
const hasPrepullScheduledOrCompleted = (container) => {
  if (container.type === 'export') return false; // not used for exports
  if (!container.lfdDate) return false;
  const lfdDate = container.lfdDate;
  return (container.legs || []).some(leg => {
    const to = (leg.to || '').toLowerCase();
    const isYardLeg = to.includes('yard') || to.includes('ifs') || to.includes('depot');
    if (isYardLeg) {
      const status = leg.tripStatus || leg.status || '';
      const isComplete = status === 'Completed' || status === 'Delivered';
      if (isComplete) {
        const legDate = leg.legDate || leg.completedAt || new Date().toISOString().slice(0, 10);
        return legDate <= lfdDate;
      }
      if (leg.driverName && leg.legDate) {
        return leg.legDate <= lfdDate;
      }
    }
    if (leg.driverName && leg.legDate) {
      return leg.legDate <= lfdDate;
    }
    return false;
  });
};

// ────────────── GRANULAR QUEUES (shared) ──────────────
const QUEUES = {
  // Import
  NEED_ETA: 'need_eta',
  NEED_APPOINTMENT: 'need_appointment',
  PREPULL_REQUIRED: 'prepull_required',
  APPOINTMENT_SET: 'appointment_set',
  IN_YARD: 'in_yard',
  PREPULL_YARD: 'prepull_yard',
  RETURNED_YARD: 'returned_yard',
  AT_CUSTOMER: 'at_customer',
  READY_FOR_PICKUP: 'ready_for_pickup',
  // Export
  NEED_BOOKING: 'need_booking',
  NEED_ERD: 'need_erd',
  NEED_CUTOFF: 'need_cutoff',
  AWAITING_RETURN: 'awaiting_return',
  RETURNED_EXPORT: 'returned_export',
  LOADED: 'loaded',
  // Common
  TERMINATED: 'terminated',
  BILLING: 'billing',
  COMPLETED: 'completed'
};

const getContainerQueue = (container) => {
  const today = new Date().toISOString().slice(0, 10);

  // Common terminal states
  if (container.status === 'Completed' || container.status === 'Paid' || container.status === 'Closed')
    return QUEUES.COMPLETED;
  if (container.isTerminated)
    return container.status === 'Ready for Billing' || container.status === 'Invoiced'
      ? QUEUES.BILLING
      : QUEUES.TERMINATED;

  // ── IMPORT logic ──
  if (container.type !== 'export') {
    if (container.isInYardReturn) return QUEUES.RETURNED_YARD;
    if (container.isInYardPrePull) return QUEUES.PREPULL_YARD;
    if (container.isReadyForPickup || container.readyForPickup) return QUEUES.READY_FOR_PICKUP;
    if (container.isDroppedAtCustomer) return QUEUES.AT_CUSTOMER;
    if (container.isInYard || container.isGrounded || hasPrepullScheduledOrCompleted(container))
      return QUEUES.IN_YARD;

    if (!container.etaDate || container.etaDate.trim() === '') return QUEUES.NEED_ETA;

    const lfdOverdue = container.lfdDate && container.lfdDate < today;
    const prepulled = hasPrepullScheduledOrCompleted(container);

    if (lfdOverdue && !prepulled) return QUEUES.PREPULL_REQUIRED;
    if (!container.appointmentDate || container.appointmentDate.trim() === '')
      return QUEUES.NEED_APPOINTMENT;

    return QUEUES.APPOINTMENT_SET;
  }

  // ── EXPORT logic ──
  if (!container.bookingNo || container.bookingNo.trim() === '') return QUEUES.NEED_BOOKING;
  if (!container.erdDate || container.erdDate.trim() === '') return QUEUES.NEED_ERD;
  if (!container.cutoffDate || container.cutoffDate.trim() === '') return QUEUES.NEED_CUTOFF;

  // Check if returned (you can use a flag like `isReturned` or check legs)
  const isReturned = container.isReturned || (container.legs || []).some(l =>
    l.to?.toLowerCase().includes('port') || l.to?.toLowerCase().includes('rail')
  );
  if (isReturned) {
    // Check if loaded (maybe a flag `isLoaded`)
    if (container.isLoaded) return QUEUES.LOADED;
    return QUEUES.RETURNED_EXPORT;
  }

  // If not returned, check cut-off urgency
  const cutOffDiff = container.cutOffDate ? Math.ceil((new Date(container.cutOffDate) - new Date()) / 86400000) : null;
  if (cutOffDiff !== null && cutOffDiff < 0) {
    // Overdue – urgent
    return QUEUES.NEED_CUTOFF; // we reuse this to show as "CUTOFF OVERDUE" in UI
  } else {
    return QUEUES.AWAITING_RETURN;
  }
};

// ────────────── TERMINAL CATEGORY ──────────────
const getTerminalCategory = (container) => {
  const terminal = (container.terminal || container.pickupTerminal || '').toUpperCase();
  if (terminal.includes('CN')) return 'CN';
  if (terminal.includes('CP')) return 'CP';
  return 'none';
};

// ────────────── ATTENTION STATUS (shared, but labels differ per type) ──────────────
const getContainerStatus = (container) => {
  const today = new Date().toISOString().slice(0, 10);
  const queue = getContainerQueue(container);
  let status = { label: '', color: '', icon: null, blink: false };

  const isImport = container.type !== 'export';

  if (isImport) {
    // ... (existing import status logic – unchanged)
    switch (queue) {
      case QUEUES.NEED_ETA:
        status = { label: 'ENTER ETA', color: 'red', icon: AlertCircle, blink: true };
        break;
      case QUEUES.NEED_APPOINTMENT: {
        const lfdDiff = container.lfdDate ? Math.ceil((new Date(container.lfdDate) - new Date(today)) / 86400000) : null;
        if (lfdDiff !== null && lfdDiff <= 3 && lfdDiff >= 0) {
          status = { label: 'BOOK APPT (LFD SOON)', color: 'orange', icon: Calendar, blink: true };
        } else {
          status = { label: 'BOOK APPOINTMENT', color: 'orange', icon: Calendar, blink: false };
        }
        break;
      }
      case QUEUES.PREPULL_REQUIRED:
        status = { label: 'PREPULL REQUIRED', color: 'red', icon: AlertCircle, blink: true };
        break;
      case QUEUES.APPOINTMENT_SET: {
        if (container.appointmentDate) {
          const apptDiff = Math.ceil((new Date(container.appointmentDate) - new Date()) / 86400000);
          if (apptDiff < 0) {
            status = { label: 'APPT OVERDUE', color: 'red', icon: Calendar, blink: true };
          } else if (apptDiff === 0) {
            status = { label: 'APPT TODAY', color: 'green', icon: Calendar, blink: false };
          } else if (apptDiff === 1) {
            status = { label: 'APPT TOMORROW', color: 'blue', icon: Calendar, blink: false };
          } else if (apptDiff <= 3) {
            status = { label: `APPT IN ${apptDiff}d`, color: 'blue', icon: Clock, blink: false };
          } else {
            const dateStr = new Date(container.appointmentDate).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric'
            });
            status = { label: `APPT: ${dateStr}`, color: 'blue', icon: Calendar, blink: false };
          }
        } else {
          status = { label: 'APPT SET', color: 'blue', icon: Calendar, blink: false };
        }
        break;
      }
      case QUEUES.PREPULL_YARD:
        status = { label: 'PRE‑PULLED IN YARD', color: 'emerald', icon: Home, blink: false };
        break;
      case QUEUES.RETURNED_YARD:
        status = { label: '⚠ TERMINATE ASAP', color: 'red', icon: AlertTriangle, blink: true };
        break;
      case QUEUES.IN_YARD:
        status = { label: 'IN YARD', color: 'green', icon: Home, blink: false };
        break;
      case QUEUES.AT_CUSTOMER: {
        let label = 'AT CUSTOMER';
        let daysAtCustomer = 0;
        if (container.appointmentDate) {
          const apptDate = new Date(container.appointmentDate);
          const now = new Date();
          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const apptMidnight = new Date(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate());
          const diff = Math.floor((todayMidnight - apptMidnight) / 86400000);
          if (diff > 0) daysAtCustomer = diff;
        }
        if (daysAtCustomer > 0) label += ` (${daysAtCustomer}d)`;
        status = { label, color: 'yellow', icon: Truck, blink: false };
        break;
      }
      case QUEUES.READY_FOR_PICKUP: {
        let label = 'READY FOR PICKUP';
        let daysAtCustomer = 0;
        if (container.appointmentDate) {
          const apptDate = new Date(container.appointmentDate);
          const now = new Date();
          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const apptMidnight = new Date(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate());
          const diff = Math.floor((todayMidnight - apptMidnight) / 86400000);
          if (diff > 0) daysAtCustomer = diff;
        }
        if (daysAtCustomer > 0) label += ` (${daysAtCustomer}d)`;
        status = { label, color: 'blue', icon: Package, blink: false };
        break;
      }
      // ... billing/terminated handled above
    }
  } else {
    // ── EXPORT status ──
    switch (queue) {
      case QUEUES.NEED_BOOKING:
        status = { label: 'NEED BOOKING', color: 'red', icon: BookOpen, blink: true };
        break;
      case QUEUES.NEED_ERD:
        status = { label: 'NEED ERD', color: 'red', icon: AlertCircle, blink: true };
        break;
      case QUEUES.NEED_CUTOFF:
        // Check if cut-off is overdue
        if (container.cutoffDate && container.cutoffDate < today) {
          status = { label: 'CUTOFF OVERDUE', color: 'red', icon: AlertTriangle, blink: true };
        } else {
          status = { label: 'NEED CUTOFF', color: 'orange', icon: Calendar, blink: false };
        }
        break;
      case QUEUES.AWAITING_RETURN: {
        const cutOffDiff = container.cutoffDate ? Math.ceil((new Date(container.cutoffDate) - new Date()) / 86400000) : null;
        if (cutOffDiff !== null && cutOffDiff < 0) {
          status = { label: 'OVERDUE', color: 'red', icon: AlertTriangle, blink: true };
        } else if (cutOffDiff === 0) {
          status = { label: 'RETURN TODAY', color: 'orange', icon: Clock, blink: true };
        } else if (cutOffDiff <= 2) {
          status = { label: `RETURN IN ${cutOffDiff}d`, color: 'yellow', icon: Clock, blink: false };
        } else {
          status = { label: 'AWAITING RETURN', color: 'blue', icon: Truck, blink: false };
        }
        break;
      }
      case QUEUES.RETURNED_EXPORT:
        status = { label: 'RETURNED', color: 'green', icon: CheckCircle, blink: false };
        break;
      case QUEUES.LOADED:
        status = { label: 'LOADED', color: 'emerald', icon: Ship, blink: false };
        break;
    }
  }

  // Fallback (should not happen)
  if (!status.label) status = { label: 'UNKNOWN', color: 'gray', icon: null, blink: false };
  return status;
};

// ────────────── COUNTDOWN CHIP (with date) ──────────────
const CountdownChip = ({ dateString, type = 'eta', isCompleted = false, apptCompleted = false, showDate = true }) => {
  if (!dateString) return null;

  let formattedDate = '';
  try {
    const d = new Date(dateString);
    if (!isNaN(d)) {
      formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch (_) {}

  // Map type to display label
  const labelMap = {
    eta: 'ETA',
    lfd: 'LFD',
    appt: 'APPT',
    erd: 'ERD',
    cutoff: 'CUT OFF',
    loading: 'LOADING'
  };
  const displayType = labelMap[type] || type.toUpperCase();

  if (type === 'appt' && apptCompleted) {
    return (
      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border bg-green-100 text-green-700 border-green-300">
        <CheckCircle className="w-3.5 h-3.5" /> {displayType} Done
        {showDate && formattedDate && <span className="ml-1 text-gray-600 font-normal">· {formattedDate}</span>}
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border bg-green-100 text-green-700 border-green-300">
        <CheckCircle className="w-3.5 h-3.5" /> {displayType} Done
        {showDate && formattedDate && <span className="ml-1 text-gray-600 font-normal">· {formattedDate}</span>}
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.ceil((new Date(dateString) - new Date()) / 86400000);
  const overdue = diff < 0;
  let label = '', cls = '';
  if (overdue) {
    label = `${Math.abs(diff)}d overdue`;
    cls = 'bg-red-100 text-red-700 border-red-200';
  } else if (diff === 0) {
    label = 'Today';
    cls = 'bg-yellow-100 text-yellow-700 border-yellow-200 animate-pulse';
  } else if (diff === 1) {
    label = 'Tomorrow';
    cls = 'bg-yellow-50 text-yellow-700 border-yellow-200';
  } else if (diff <= 3) {
    label = `${diff}d`;
    cls = 'bg-green-50 text-green-700 border-green-200';
  } else {
    label = `${diff}d`;
    cls = 'bg-gray-50 text-gray-500 border-gray-200';
  }

  return (
    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${cls}`}>
      <Clock className="w-3.5 h-3.5" /> {displayType}: {label}
      {showDate && formattedDate && <span className="ml-1 text-gray-600 font-normal">· {formattedDate}</span>}
    </div>
  );
};

// ────────────── IMPORT CONTAINER CARD ──────────────
const ImportContainerCard = React.memo(({ container, onEdit }) => {
  const status = getContainerStatus(container);
  const StatusIcon = status.icon;

  const hasAppointment = container.appointmentDate && container.appointmentDate.trim() !== '';
  const arrived = container.isGrounded || container.isInYard || hasPrepullScheduledOrCompleted(container);
  const delivered = container.isDroppedAtCustomer;
  const etaCompleted = arrived || hasAppointment;
  const lfdCompleted = hasPrepullScheduledOrCompleted(container) || arrived || delivered;
  const apptCompleted = container.isDroppedAtCustomer || container.isReadyForPickup || container.readyForPickup;

  const terminal = container.terminal || container.pickupTerminal || '';
  const terminalDisplay = terminal ? `📍 ${terminal}` : '';

  return (
    <div
      className="group flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-100 hover:bg-gray-50 cursor-pointer text-xs"
      onClick={() => onEdit(container)}
    >
      {/* Status badge */}
      <div className={`flex items-center gap-2 w-32 ${status.blink ? 'animate-pulse' : ''}`}>
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            status.color === 'red' ? 'bg-red-500' :
            status.color === 'orange' ? 'bg-orange-500' :
            status.color === 'green' ? 'bg-green-500' :
            status.color === 'emerald' ? 'bg-emerald-500' :
            status.color === 'yellow' ? 'bg-yellow-500' :
            status.color === 'blue' ? 'bg-blue-500' :
            status.color === 'purple' ? 'bg-purple-500' :
            'bg-gray-500'
          }`}
        />
        <span className={`font-black text-[10px] uppercase ${status.color === 'red' ? 'text-red-700' :
            status.color === 'orange' ? 'text-orange-700' :
            status.color === 'emerald' ? 'text-emerald-700' :
            'text-gray-700'}`}>
          {StatusIcon && <StatusIcon className="w-3 h-3 inline mr-1" />}
          {status.label}
        </span>
      </div>

      {/* Container & customer */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900">{container.containerNo}</span>
          <span className="text-gray-500 truncate">{container.customerName}</span>
        </div>
        {terminalDisplay && (
          <div className="text-[9px] text-gray-400 truncate">{terminalDisplay}</div>
        )}
      </div>

      {/* Key dates */}
      <div className="flex items-center gap-2">
        <CountdownChip dateString={container.etaDate} type="eta" isCompleted={etaCompleted} />
        <CountdownChip dateString={container.lfdDate} type="lfd" isCompleted={lfdCompleted} />
        <CountdownChip dateString={container.appointmentDate} type="appt" apptCompleted={apptCompleted} />
      </div>

      {/* Quick icons */}
      <div className="flex items-center gap-2">
        {container.legs?.some((l) => l.driverName) ? (
          <User className="w-3.5 h-3.5 text-green-600" />
        ) : (
          <User className="w-3.5 h-3.5 text-red-400" />
        )}
        {container.chassisNumber ? <Anchor className="w-3.5 h-3.5 text-blue-500" /> : null}
      </div>

      {/* Edit button */}
      <div className="opacity-0 group-hover:opacity-100">
        <Edit3 className="w-3.5 h-3.5 text-blue-600" />
      </div>
    </div>
  );
});

// ────────────── EXPORT CONTAINER CARD ──────────────
const ExportContainerCard = React.memo(({ container, onEdit }) => {
  const status = getContainerStatus(container);
  const StatusIcon = status.icon;

  // Determine if dates are "completed" based on status
  const erdCompleted = container.erdDate && container.erdDate < new Date().toISOString().slice(0, 10);
  const cutOffCompleted = container.cutOffDate && container.cutOffDate < new Date().toISOString().slice(0, 10);
  const loadingCompleted = container.loadingDate && container.loadingDate < new Date().toISOString().slice(0, 10);

  return (
    <div
      className="group flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-100 hover:bg-gray-50 cursor-pointer text-xs"
      onClick={() => onEdit(container)}
    >
      {/* Status badge */}
      <div className={`flex items-center gap-2 w-32 ${status.blink ? 'animate-pulse' : ''}`}>
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            status.color === 'red' ? 'bg-red-500' :
            status.color === 'orange' ? 'bg-orange-500' :
            status.color === 'green' ? 'bg-green-500' :
            status.color === 'emerald' ? 'bg-emerald-500' :
            status.color === 'yellow' ? 'bg-yellow-500' :
            status.color === 'blue' ? 'bg-blue-500' :
            status.color === 'purple' ? 'bg-purple-500' :
            'bg-gray-500'
          }`}
        />
        <span className={`font-black text-[10px] uppercase ${status.color === 'red' ? 'text-red-700' :
            status.color === 'orange' ? 'text-orange-700' :
            status.color === 'emerald' ? 'text-emerald-700' :
            'text-gray-700'}`}>
          {StatusIcon && <StatusIcon className="w-3 h-3 inline mr-1" />}
          {status.label}
        </span>
      </div>

      {/* Container & customer + extra fields */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900">{container.containerNo}</span>
          <span className="text-gray-500 truncate">{container.customerName}</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-gray-400 truncate">
          <span>Booking: {container.bookingNo || '—'}</span>
          <span>·</span>
          <span>Vessel: {container.vesselName || '—'}</span>
          <span>·</span>
          <span>Port: {container.portName || '—'}</span>
        </div>
      </div>

      {/* Date chips */}
      <div className="flex items-center gap-2">
        <CountdownChip dateString={container.erdDate} type="erd" isCompleted={erdCompleted} />
        <CountdownChip dateString={container.cutOffDate} type="cutoff" isCompleted={cutOffCompleted} />
        <CountdownChip dateString={container.loadingDate} type="loading" isCompleted={loadingCompleted} />
      </div>

      {/* Rail Bill / RV */}
      <div className="w-16 text-center">
        {container.railBill ? (
          <span className="text-green-600 font-bold text-xs">RV: ✓</span>
        ) : (
          <span className="text-red-400 font-bold text-xs">RV: ✗</span>
        )}
      </div>

      {/* Edit button */}
      <div className="opacity-0 group-hover:opacity-100">
        <Edit3 className="w-3.5 h-3.5 text-blue-600" />
      </div>
    </div>
  );
});

// ────────────── MISSION CONTROL PANEL ──────────────
const MissionControl = ({ containers, onFilterQueue, onFilterTerminal, activeTerminal, viewType, onViewChange }) => {
  // ── Queue counts ──
  const queueCounts = useMemo(() => {
    const c = {};
    Object.values(QUEUES).forEach((q) => (c[q] = 0));
    containers.forEach((con) => {
      const q = getContainerQueue(con);
      if (c[q] !== undefined) c[q]++;
    });
    return c;
  }, [containers]);

  // Determine which queue sections to show based on viewType
  const queueSections = viewType === 'import' ? [
    { q: QUEUES.NEED_ETA,          label: '🔴 Missing ETA',      color: 'bg-red-100 text-red-800' },
    { q: QUEUES.NEED_APPOINTMENT,  label: '🟠 Need Appointment', color: 'bg-orange-100 text-orange-800' },
    { q: QUEUES.PREPULL_REQUIRED,  label: '⭕ Prepull Required',  color: 'bg-red-200 text-red-900' },
    { q: QUEUES.APPOINTMENT_SET,   label: '📅 Appointment Set',  color: 'bg-blue-100 text-blue-800' },
    { q: QUEUES.PREPULL_YARD,      label: '🌿 Pre‑pulled Yard',  color: 'bg-emerald-100 text-emerald-800' },
    { q: QUEUES.IN_YARD,           label: '🟢 In Yard',          color: 'bg-green-100 text-green-800' },
    { q: QUEUES.RETURNED_YARD,     label: '🔴 Returned Yard',    color: 'bg-red-200 text-red-900' },
    { q: QUEUES.AT_CUSTOMER,       label: '🟡 At Customer',      color: 'bg-yellow-100 text-yellow-800' },
    { q: QUEUES.READY_FOR_PICKUP,  label: '📦 Ready for Pickup', color: 'bg-blue-200 text-blue-900' },
    { q: QUEUES.TERMINATED,        label: '⚫ Completed',        color: 'bg-gray-200 text-gray-800' },
    { q: QUEUES.BILLING,           label: '💲 Billing',          color: 'bg-purple-100 text-purple-800' },
  ] : [
    { q: QUEUES.NEED_BOOKING,      label: '📕 Need Booking',     color: 'bg-red-100 text-red-800' },
    { q: QUEUES.NEED_ERD,          label: '📅 Need ERD',         color: 'bg-orange-100 text-orange-800' },
    { q: QUEUES.NEED_CUTOFF,       label: '⏰ Need Cut‑off',     color: 'bg-yellow-100 text-yellow-800' },
    { q: QUEUES.AWAITING_RETURN,   label: '🚚 Awaiting Return',  color: 'bg-blue-100 text-blue-800' },
    { q: QUEUES.RETURNED_EXPORT,   label: '✅ Returned',         color: 'bg-green-100 text-green-800' },
    { q: QUEUES.LOADED,            label: '⛴️ Loaded',           color: 'bg-emerald-100 text-emerald-800' },
    { q: QUEUES.TERMINATED,        label: '⚫ Completed',        color: 'bg-gray-200 text-gray-800' },
    { q: QUEUES.BILLING,           label: '💲 Billing',          color: 'bg-purple-100 text-purple-800' },
  ];

  // ── Terminal counts ──
  const terminalCounts = useMemo(() => {
    const c = { CN: 0, CP: 0, none: 0 };
    containers.forEach((con) => {
      const cat = getTerminalCategory(con);
      c[cat] = (c[cat] || 0) + 1;
    });
    return c;
  }, [containers]);

  return (
    <div className="bg-white border-b px-4 py-2 flex flex-col gap-1">
      {/* Row 0: View toggle */}
      <div className="flex items-center gap-2 mb-1">
        <span className="font-black text-gray-700 mr-2">VIEW</span>
        <button
          onClick={() => onViewChange('import')}
          className={`px-3 py-1 rounded-full font-bold text-xs border ${
            viewType === 'import' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
          } hover:shadow-sm`}
        >
          Import
        </button>
        <button
          onClick={() => onViewChange('export')}
          className={`px-3 py-1 rounded-full font-bold text-xs border ${
            viewType === 'export' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
          } hover:shadow-sm`}
        >
          Export
        </button>
      </div>

      {/* Row 1: Queue filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs py-1">
  <span className="font-black text-gray-700 mr-2">QUEUE</span>
  {queueSections.map((sec) => (
    <button
      key={sec.q}
      onClick={() => onFilterQueue(sec.q)}
      className={`px-3 py-1 rounded-full font-bold whitespace-nowrap border ${sec.color} hover:shadow-sm`}
    >
      {sec.label} ({queueCounts[sec.q] || 0})
    </button>
  ))}
</div>

      {/* Row 2: Terminal filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs border-t pt-1">
  <span className="font-black text-gray-700 mr-2">TERMINAL</span>
  <button
    onClick={() => onFilterTerminal(null)}
    className={`px-3 py-1 rounded-full font-bold whitespace-nowrap border ${
      activeTerminal === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700'
    } hover:shadow-sm`}
  >
    All ({containers.length})
  </button>
  {['CN', 'CP', 'none'].map((cat) => (
    <button
      key={cat}
      onClick={() => onFilterTerminal(cat)}
      className={`px-3 py-1 rounded-full font-bold whitespace-nowrap border ${
        activeTerminal === cat
          ? 'bg-blue-600 text-white'
          : cat === 'CN' ? 'bg-blue-100 text-blue-800'
          : cat === 'CP' ? 'bg-purple-100 text-purple-800'
          : 'bg-gray-100 text-gray-700'
      } hover:shadow-sm`}
    >
      {cat === 'none' ? '🚫 No Terminal' : cat} ({terminalCounts[cat] || 0})
    </button>
  ))}
</div>
    </div>
  );
};

// ────────────── MAIN COMPONENT ──────────────
const ContainerBoard = ({ companyId, setFeedback, onEdit }) => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeQueue, setActiveQueue] = useState(null);
  const [activeTerminal, setActiveTerminal] = useState(null);
  const [viewType, setViewType] = useState('import'); // 'import' | 'export'

  useEffect(() => {
    if (!companyId) return;
    const q = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', [
        'Open', 'Dispatched', 'In Transit', 'Delivered',
        'Ready for Billing', 'Completed', 'Paid'
      ]),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // If a container doesn't have 'type', default to 'import' for backward compatibility
      const withType = all.map(l => ({ ...l, type: l.type || 'import' }));
      setContainers(withType.filter((l) => !l.isDeleted));
      setLoading(false);
    });
    return () => unsub();
  }, [companyId]);

  const filtered = useMemo(() => {
    let list = containers;
    // Filter by view type
    list = list.filter((c) => c.type === viewType);

    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.containerNo?.toLowerCase().includes(t) ||
          c.customerName?.toLowerCase().includes(t) ||
          c.bookingNo?.toLowerCase().includes(t) ||
          c.vesselName?.toLowerCase().includes(t)
      );
    }
    if (activeQueue) {
      list = list.filter((c) => getContainerQueue(c) === activeQueue);
    }
    if (activeTerminal !== null) {
      list = list.filter((c) => getTerminalCategory(c) === activeTerminal);
    }
    return list;
  }, [containers, searchTerm, activeQueue, activeTerminal, viewType]);

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600" />
      </div>
    );

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <MissionControl
        containers={containers.filter(c => c.type === viewType)} // pass only current view containers for counts
        onFilterQueue={setActiveQueue}
        onFilterTerminal={setActiveTerminal}
        activeTerminal={activeTerminal}
        viewType={viewType}
        onViewChange={setViewType}
      />

      {/* Search */}
      <div className="bg-white border-b px-4 py-1.5 flex items-center text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search containers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {(activeQueue || activeTerminal !== null) && (
          <button
            onClick={() => {
              setActiveQueue(null);
              setActiveTerminal(null);
            }}
            className="ml-3 text-xs text-red-500 hover:underline"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Container list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((container) => (
          container.type === 'import'
            ? <ImportContainerCard key={container.id} container={container} onEdit={onEdit} />
            : <ExportContainerCard key={container.id} container={container} onEdit={onEdit} />
        ))}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">
            No {viewType} containers match these filters.
          </div>
        )}
      </div>
    </div>
  );
};

export default ContainerBoard;