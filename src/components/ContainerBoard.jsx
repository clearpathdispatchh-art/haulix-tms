// components/ContainerBoard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, X, Clock, CheckCircle, Truck, Home, Package,
  User, Calendar, MapPin, Edit3, Anchor, AlertTriangle, Ship, Filter
} from 'lucide-react';
import {
  collection, onSnapshot, query, where, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';

// ────────────── TIMEZONE-SAFE DATE HELPERS ──────────────
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (s.includes('T') || s.includes(' ')) return new Date(s);
  return new Date(s + 'T00:00:00');
};

const getLocalTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDateShort = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = parseLocalDate(dateStr);
    if (d && !isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    }
  } catch (_) {}
  return '—';
};

// ────────────── CORE QUEUE LOGIC ──────────────
const QUEUES = {
  NEED_ETA: 'need_eta',               // Pink
  ETA_SET: 'eta_set',                 // Orange
  IN_YARD: 'in_yard',                 // Blue
  DROPPED: 'dropped',                 // Yellow
  READY_TO_TERMINATE: 'ready_to_terminate', // Red
  COMPLETE_BILLING: 'complete_billing' // Black
};

const QUEUE_PRIORITY = {
  [QUEUES.COMPLETE_BILLING]: 1,
  [QUEUES.DROPPED]: 2,
  [QUEUES.READY_TO_TERMINATE]: 3,
  [QUEUES.IN_YARD]: 4,
  [QUEUES.ETA_SET]: 5,
  [QUEUES.NEED_ETA]: 6
};

const getContainerQueue = (container) => {
  // 1. Complete / Billing (BLACK)
  if (container.status === 'Completed' || container.status === 'Paid' || container.isBillingComplete || container.status === 'Ready for Billing') {
    return QUEUES.COMPLETE_BILLING;
  }

  // 2. Ready to Terminate (RED) - At customer, ready for pickup
  if (container.isReadyForPickup || container.readyForPickup) {
    return QUEUES.READY_TO_TERMINATE;
  }

  // 3. Smart "At Customer" Logic based STRICTLY on Legs (YELLOW)
  const legs = container.legs || [];
  let isAtCustomer = false;

  if (legs.length > 0) {
    const hasCompletedDelivery = legs.some(l => 
      l.legType === 'delivery' && 
      (l.status === 'Completed' || l.status === 'Delivered')
    );
    
    const hasTerminationLeg = legs.some(l => l.legType === 'termination');
    
    if (hasCompletedDelivery && !hasTerminationLeg) {
      isAtCustomer = true;
    }
    
    if (legs.length === 1 && legs[0].legType === 'delivery' && (legs[0].status === 'Completed' || legs[0].status === 'Delivered')) {
      isAtCustomer = true;
    }
  }

  if (isAtCustomer) {
    return QUEUES.DROPPED; // Yellow
  }

  // 4. In Yard / Grounded / Prepulled (BLUE)
  if (container.isInYard || container.isGrounded || container.isInYardPrePull || container.isInYardReturn) {
    return QUEUES.IN_YARD;
  }

  // 5. ETA Set (ORANGE)
  if (container.etaDate && container.etaDate.trim() !== '') {
    return QUEUES.ETA_SET;
  }

  // 6. Pending ETA (PINK)
  return QUEUES.NEED_ETA;
};

const STATUS_STYLES = {
  [QUEUES.NEED_ETA]: {
    bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-800', label: 'Pending ETA', color: 'pink'
  },
  [QUEUES.ETA_SET]: {
    bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', label: 'ETA Set', color: 'orange'
  },
  [QUEUES.IN_YARD]: {
    bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800', label: 'In Yard / Prepulled', color: 'blue'
  },
  [QUEUES.DROPPED]: {
    bg: 'bg-yellow-100', border: 'border-yellow-300', text: 'text-yellow-800', label: 'At Customer', color: 'yellow'
  },
  [QUEUES.READY_TO_TERMINATE]: {
    bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', label: 'Ready to Terminate', color: 'red'
  },
  [QUEUES.COMPLETE_BILLING]: {
    bg: 'bg-black', border: 'border-slate-800', text: 'text-white', label: 'Complete - Need to Bill', color: 'black', rowClass: 'bg-black text-white border-l-4 border-slate-700 hover:bg-slate-900'
  }
};

// ────────────── MAIN COMPONENT ──────────────
const ContainerBoard = ({ companyId, setFeedback, onEdit }) => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('excel'); // 'excel' or 'cards'
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterSSL, setFilterSSL] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterDateType, setFilterDateType] = useState('deliveryDate');
  
  // Queues
  const [activeQueue, setActiveQueue] = useState(null);

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
      const withType = all.map(l => ({ ...l, type: l.type || l.shipmentType || 'import' }));
      setContainers(withType.filter((l) => !l.isDeleted));
      setLoading(false);
    });
    return () => unsub();
  }, [companyId]);

  // Derive unique customers and SSLs for filter dropdowns
  const uniqueCustomers = useMemo(() => {
    const set = new Set(containers.map(c => c.customerName).filter(Boolean));
    return Array.from(set).sort();
  }, [containers]);

  const uniqueSSLs = useMemo(() => {
    const set = new Set(containers.map(c => c.shippingLine).filter(Boolean));
    return Array.from(set).sort();
  }, [containers]);

  // Apply Filters and Sort
  const filteredContainers = useMemo(() => {
    let list = containers;

    // 1. Queue Filter
    if (activeQueue) {
      list = list.filter(c => getContainerQueue(c) === activeQueue);
    }

    // 2. Search Filter
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.containerNo?.toLowerCase().includes(t) ||
          c.customerName?.toLowerCase().includes(t) ||
          c.bookingNo?.toLowerCase().includes(t) ||
          c.vesselName?.toLowerCase().includes(t) ||
          c.pickupNo?.toLowerCase().includes(t)
      );
    }

    // 3. Customer Filter
    if (filterCustomer) {
      list = list.filter(c => c.customerName === filterCustomer);
    }

    // 4. SSL Filter
    if (filterSSL) {
      list = list.filter(c => c.shippingLine === filterSSL);
    }

    // 5. Date Filter
    if (filterDate) {
      list = list.filter(c => {
        const dateValue = c[filterDateType];
        return dateValue === filterDate;
      });
    }

    // 6. SMART SORTING: Sort by Queue Priority
    list.sort((a, b) => {
      const qA = getContainerQueue(a);
      const qB = getContainerQueue(b);
      return QUEUE_PRIORITY[qA] - QUEUE_PRIORITY[qB];
    });

    return list;
  }, [containers, activeQueue, searchTerm, filterCustomer, filterSSL, filterDate, filterDateType]);

  // Calculate Stats for the Dashboard
  const stats = useMemo(() => {
    const counts = {
      total: containers.length,
      [QUEUES.NEED_ETA]: 0,
      [QUEUES.ETA_SET]: 0,
      [QUEUES.IN_YARD]: 0,
      [QUEUES.DROPPED]: 0,
      [QUEUES.READY_TO_TERMINATE]: 0,
      [QUEUES.COMPLETE_BILLING]: 0,
    };
    
    filteredContainers.forEach(c => {
      const q = getContainerQueue(c);
      if (counts[q] !== undefined) counts[q]++;
    });
    
    counts.total = filteredContainers.length;
    return counts;
  }, [filteredContainers, containers.length]);

  const clearFilters = () => {
    setSearchTerm('');
    setFilterCustomer('');
    setFilterSSL('');
    setFilterDate('');
    setActiveQueue(null);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-blue-600" />
          <span className="text-sm font-bold text-slate-500">Loading Container Board...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* ================= TOP SUMMARY DASHBOARD ================= */}
      <div className="bg-white border-b px-4 py-3 shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Ship className="w-5 h-5 text-blue-600" />
            Container Mission Control
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('excel')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${viewMode === 'excel' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              📊 Excel View
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${viewMode === 'cards' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              📋 Card View
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="bg-slate-100 p-2 rounded-xl border border-slate-200 text-center cursor-pointer hover:bg-slate-200 transition-colors" onClick={() => setActiveQueue(null)}>
            <div className="text-xl font-black text-slate-800">{stats.total}</div>
            <div className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Total View</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.NEED_ETA].bg} ${STATUS_STYLES[QUEUES.NEED_ETA].border} ${activeQueue === QUEUES.NEED_ETA ? 'ring-2 ring-pink-400' : ''}`} onClick={() => setActiveQueue(QUEUES.NEED_ETA)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.NEED_ETA].text}`}>{stats[QUEUES.NEED_ETA]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.NEED_ETA].text}`}>Pending ETA</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.ETA_SET].bg} ${STATUS_STYLES[QUEUES.ETA_SET].border} ${activeQueue === QUEUES.ETA_SET ? 'ring-2 ring-orange-400' : ''}`} onClick={() => setActiveQueue(QUEUES.ETA_SET)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.ETA_SET].text}`}>{stats[QUEUES.ETA_SET]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.ETA_SET].text}`}>ETA Set</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.IN_YARD].bg} ${STATUS_STYLES[QUEUES.IN_YARD].border} ${activeQueue === QUEUES.IN_YARD ? 'ring-2 ring-blue-400' : ''}`} onClick={() => setActiveQueue(QUEUES.IN_YARD)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.IN_YARD].text}`}>{stats[QUEUES.IN_YARD]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.IN_YARD].text}`}>In Yard</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.DROPPED].bg} ${STATUS_STYLES[QUEUES.DROPPED].border} ${activeQueue === QUEUES.DROPPED ? 'ring-2 ring-yellow-400' : ''}`} onClick={() => setActiveQueue(QUEUES.DROPPED)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.DROPPED].text}`}>{stats[QUEUES.DROPPED]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.DROPPED].text}`}>At Customer</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.READY_TO_TERMINATE].bg} ${STATUS_STYLES[QUEUES.READY_TO_TERMINATE].border} ${activeQueue === QUEUES.READY_TO_TERMINATE ? 'ring-2 ring-red-400' : ''}`} onClick={() => setActiveQueue(QUEUES.READY_TO_TERMINATE)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.READY_TO_TERMINATE].text}`}>{stats[QUEUES.READY_TO_TERMINATE]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.READY_TO_TERMINATE].text}`}>Ready to Term</div>
          </div>
          <div className={`p-2 rounded-xl border text-center cursor-pointer transition-all ${STATUS_STYLES[QUEUES.COMPLETE_BILLING].bg} ${STATUS_STYLES[QUEUES.COMPLETE_BILLING].border} ${activeQueue === QUEUES.COMPLETE_BILLING ? 'ring-2 ring-black' : ''}`} onClick={() => setActiveQueue(QUEUES.COMPLETE_BILLING)}>
            <div className={`text-xl font-black ${STATUS_STYLES[QUEUES.COMPLETE_BILLING].text}`}>{stats[QUEUES.COMPLETE_BILLING]}</div>
            <div className={`text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[QUEUES.COMPLETE_BILLING].text}`}>Need to Bill</div>
          </div>
        </div>
      </div>

      {/* ================= ADVANCED FILTERS ================= */}
      <div className="bg-white border-b px-4 py-2 flex flex-wrap items-center gap-3 text-xs shrink-0 shadow-sm z-10">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search Container, Customer, SSL, Booking..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 font-medium"
          />
        </div>

        <select
          value={filterCustomer}
          onChange={(e) => setFilterCustomer(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg outline-none font-bold text-slate-700 bg-white"
        >
          <option value="">All Customers</option>
          {uniqueCustomers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={filterSSL}
          onChange={(e) => setFilterSSL(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg outline-none font-bold text-slate-700 bg-white"
        >
          <option value="">All SSL / Rail</option>
          {uniqueSSLs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-lg px-2 py-0.5">
          <span className="text-[10px] font-black text-slate-400 uppercase">Date Filter:</span>
          <select
            value={filterDateType}
            onChange={(e) => setFilterDateType(e.target.value)}
            className="bg-transparent text-xs font-bold text-slate-700 outline-none py-1"
          >
            <option value="deliveryDate">Delivery Date</option>
            <option value="etaDate">ETA Date</option>
            <option value="lfdDate">LFD Date</option>
            <option value="prepullDate">Prepull Date</option>
            <option value="appointmentDate">Appointment Date</option>
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="bg-transparent text-xs font-bold text-slate-700 outline-none py-1 cursor-pointer"
          />
          {filterDate && (
            <button onClick={() => setFilterDate('')} className="text-slate-400 hover:text-red-500 ml-1">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {(searchTerm || filterCustomer || filterSSL || filterDate || activeQueue) && (
          <button
            onClick={clearFilters}
            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-bold hover:bg-red-100 transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* ================= MAIN DATA VIEW ================= */}
      <div className="flex-1 overflow-auto bg-slate-50 p-4">
        {viewMode === 'excel' ? (
          /* --- EXCEL TABLE VIEW --- */
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1200px]">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-300 text-[10px] font-black text-slate-600 uppercase tracking-wider">
                    <th className="px-3 py-2">Rail</th>
                    <th className="px-3 py-2">Container #</th>
                    <th className="px-3 py-2">Pick up</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">SSL</th>
                    <th className="px-3 py-2">ETA</th>
                    <th className="px-3 py-2">ETA Time</th>
                    <th className="px-3 py-2">LFD</th>
                    <th className="px-3 py-2">Prepull Date</th>
                    <th className="px-3 py-2">Delivery Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredContainers.map(container => {
                    const queue = getContainerQueue(container);
                    const style = STATUS_STYLES[queue];
                    const isComplete = queue === QUEUES.COMPLETE_BILLING;
                    
                    const rowStyle = style.rowClass || style.bg;
                    const today = getLocalTodayStr();
                    const isEtaOverdue = container.etaDate && container.etaDate < today && !container.isGrounded && !container.isInYard;

                    return (
                      <tr 
                        key={container.id} 
                        className={`${rowStyle} transition-colors cursor-pointer group`}
                        onClick={() => onEdit(container)}
                      >
                        <td className={`px-3 py-2 font-bold text-xs ${isComplete ? 'text-white' : 'text-slate-700'}`}>{container.railCarrier || 'CN'}</td>
                        <td className="px-3 py-2">
                          <span className={`font-black text-xs ${isComplete ? 'text-white' : 'text-slate-900'}`}>{container.containerNo || 'N/A'}</span>
                          {container.isPrePull && <span className={`ml-2 text-[8px] font-black px-1.5 py-0.5 rounded ${isComplete ? 'bg-gray-800 text-gray-200' : 'bg-purple-200 text-purple-800'}`}>PREPULL</span>}
                        </td>
                        <td className={`px-3 py-2 text-xs font-medium ${isComplete ? 'text-gray-300' : 'text-slate-600'}`}>{container.pickupNo || '—'}</td>
                        <td className={`px-3 py-2 text-xs font-bold ${isComplete ? 'text-white' : 'text-slate-700'}`}>{container.size || '—'}</td>
                        <td className={`px-3 py-2 text-xs font-bold ${isComplete ? 'text-gray-300' : 'text-slate-600'}`}>{container.shippingLine || '—'}</td>
                        
                        <td className={`px-3 py-2 text-xs font-bold ${isComplete ? 'text-white' : isEtaOverdue ? 'text-red-600 underline decoration-red-400' : 'text-slate-700'}`}>
                          {formatDateShort(container.etaDate)}
                        </td>
                        <td className={`px-3 py-2 text-xs font-medium ${isComplete ? 'text-gray-400' : 'text-slate-500'}`}>{container.etaTime || '—'}</td>
                        
                        <td className={`px-3 py-2 text-xs font-bold ${isComplete ? 'text-white' : 'text-slate-700'}`}>{formatDateShort(container.lfdDate)}</td>
                        <td className={`px-3 py-2 text-xs font-bold ${isComplete ? 'text-white' : 'text-slate-700'}`}>{formatDateShort(container.prepullDate || container.prePullDate)}</td>
                        <td className={`px-3 py-2 text-xs font-black ${isComplete ? 'text-white' : 'text-slate-800'}`}>{formatDateShort(container.deliveryDate)}</td>
                        
                        <td className="px-3 py-2">
                          <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${isComplete ? 'bg-white text-black border-gray-200' : `${style.bg} ${style.text} ${style.border}`}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button 
                            onClick={(e) => { e.stopPropagation(); onEdit(container); }}
                            className={`p-1 rounded transition-colors ${isComplete ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-slate-400 hover:text-blue-600 hover:bg-white'}`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredContainers.length === 0 && (
                    <tr>
                      <td colSpan="12" className="px-4 py-12 text-center text-slate-400 font-bold italic">
                        No containers match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* --- CARD VIEW --- */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredContainers.map(container => {
              const queue = getContainerQueue(container);
              const style = STATUS_STYLES[queue];
              const isComplete = queue === QUEUES.COMPLETE_BILLING;
              const isEtaOverdue = container.etaDate && container.etaDate < getLocalTodayStr() && !container.isGrounded;

              return (
                <div 
                  key={container.id} 
                  className={`border-2 ${isComplete ? 'border-black' : style.border} rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col gap-3 ${isComplete ? 'bg-black text-white' : 'bg-white'}`}
                  onClick={() => onEdit(container)}
                >
                  {/* Header */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${isComplete ? 'bg-gray-500' : style.bg.replace('bg-', 'bg-').replace('100', '500')}`} />
                      <span className={`font-black text-sm ${isComplete ? 'text-white' : 'text-slate-800'}`}>{container.containerNo || 'N/A'}</span>
                    </div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${isComplete ? 'bg-white text-black border-gray-200' : `${style.bg} ${style.text} ${style.border}`}`}>
                      {style.label}
                    </span>
                  </div>

                  {/* Customer & SSL */}
                  <div className="text-xs">
                    <div className={`font-bold truncate ${isComplete ? 'text-gray-300' : 'text-slate-600'}`}>{container.customerName || 'No Customer'}</div>
                    <div className={`text-[10px] font-medium ${isComplete ? 'text-gray-400' : 'text-slate-400'}`}>{container.shippingLine || 'No SSL'} • {container.railCarrier || 'CN'}</div>
                  </div>

                  {/* Dates Grid */}
                  <div className={`grid grid-cols-2 gap-2 p-2 rounded-xl text-[10px] font-bold border ${isComplete ? 'bg-gray-900 border-gray-800' : 'bg-slate-50 border-slate-100'}`}>
                    <div>
                      <span className={`block ${isComplete ? 'text-gray-500' : 'text-slate-400'}`}>ETA</span>
                      <span className={isComplete ? 'text-white' : isEtaOverdue ? 'text-red-600' : 'text-slate-700'}>{formatDateShort(container.etaDate)}</span>
                    </div>
                    <div>
                      <span className={`block ${isComplete ? 'text-gray-500' : 'text-slate-400'}`}>LFD</span>
                      <span className={isComplete ? 'text-white' : 'text-slate-700'}>{formatDateShort(container.lfdDate)}</span>
                    </div>
                    <div>
                      <span className={`block ${isComplete ? 'text-gray-500' : 'text-slate-400'}`}>Delivery</span>
                      <span className={isComplete ? 'text-white' : 'text-slate-700'}>{formatDateShort(container.deliveryDate)}</span>
                    </div>
                    <div>
                      <span className={`block ${isComplete ? 'text-gray-500' : 'text-slate-400'}`}>Prepull</span>
                      <span className={isComplete ? 'text-white' : 'text-slate-700'}>{formatDateShort(container.prepullDate || container.prePullDate)}</span>
                    </div>
                  </div>

                  {/* Footer Action */}
                  <div className={`flex justify-between items-center mt-auto pt-2 border-t ${isComplete ? 'border-gray-800' : 'border-slate-100'}`}>
                    <span className={`text-[10px] font-black uppercase ${isComplete ? 'text-gray-400' : 'text-slate-400'}`}>
                      {container.size || '—'}
                    </span>
                    <button className={`text-[10px] font-bold flex items-center gap-1 ${isComplete ? 'text-gray-300 hover:text-white' : 'text-blue-600 hover:text-blue-800'}`}>
                      <Edit3 className="w-3 h-3" /> Edit
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredContainers.length === 0 && (
              <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-2xl border border-slate-200">
                No containers match the current filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContainerBoard;