// components/ContainerBoard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, X, Ship, Edit3, RefreshCw, AlertTriangle
} from 'lucide-react';
import {
  collection, onSnapshot, query, where, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';

// ────────────── DATE HELPERS ──────────────
const getRvAlert = (load) => {
  if (!load.rvNo && !load.rvEarlyReturnDate && !load.rvCutoffDate) return null;

  const now = new Date();
    // ✅ FIX: Use local date to prevent timezone offsets
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  const parseDate = (d) => d ? (d.includes('T') ? d.split('T')[0] : d) : null;
  const earlyDateStr = parseDate(load.rvEarlyReturnDate);
  const cutoffDateStr = parseDate(load.rvCutoffDate);
  
  if (cutoffDateStr) {
      const cutoff = new Date(cutoffDateStr + 'T23:59:59');
      if (now > cutoff) {
        return { type: 'expired', message: `RV EXPIRED! Cut-off was ${formatDate(cutoffDateStr)}. Terminate immediately!` };
      }
      if (cutoffDateStr === todayStr) {
        return { type: 'critical', message: `Terminate container! Cut-off is TODAY.` };
      }
  }

  if (earlyDateStr) {
      if (earlyDateStr === todayStr) {
        const earlyTime = load.rvEarlyReturnTime || '00:00';
        const [h, m] = earlyTime.split(':').map(Number);
        const earlyDateTime = new Date();
        earlyDateTime.setHours(h || 0, m || 0, 0, 0);
        
        if (now < earlyDateTime) {
            return { type: 'upcoming', message: `RV active today after ${earlyTime}. Arrange termination.` };
        } else {
            return { type: 'active', message: `RV active NOW (since ${earlyTime}). Arrange termination!` };
        }
      } else if (earlyDateStr < todayStr) {
        const cutoffMsg = cutoffDateStr ? ` Cut-off is ${formatDate(cutoffDateStr)}.` : '';
        return { type: 'warning', message: `Terminate container! RV active since ${formatDate(earlyDateStr)}.${cutoffMsg}` };
      }
  }
  return null;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(cleanDate + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch (_) {
    return dateStr;
  }
};

// ────────────── CORE COLOR LOGIC ──────────────
const getRowColorClass = (load) => {
  // 1. Ready for Billing / Completed / Terminated = BLACK
  if (load.status === 'Ready for Billing' || load.isBillingComplete || load.status === 'Completed' || load.isTerminated) {
    return 'bg-black text-white hover:bg-gray-800';
  }
  
  // 2. Ready at Customer / Ready for Pickup = DARK YELLOW + BLINKING
  if (load.isReadyForPickup || load.readyForPickup) {
    return 'bg-yellow-500 text-yellow-950 font-black animate-pulse hover:bg-yellow-600';
  }

  // 3. Dropped at Customer = YELLOW
  if (load.isDroppedAtCustomer) {
    return 'bg-yellow-300 text-yellow-900 hover:bg-yellow-400 animate-pulse'; // ✅ Added animate-pulse
  }

    // ✅ 4. In Yard / Prepulled = BLUE (Moved ABOVE Grounded)
  if (load.isInYard || load.isInYardPrePull || load.isInYardReturn) {
    return 'bg-blue-300 text-blue-900 hover:bg-blue-400';
  }

  // ✅ 5. Grounded = GREEN
  if (load.isGrounded) {
    return 'bg-green-400 text-green-950 hover:bg-green-500';
  }

  // 6. ETA Added = ORANGE
  if (load.etaDate) {
    return 'bg-orange-300 text-orange-900 hover:bg-orange-400';
  }

  // 7. No ETA = PINK
  return 'bg-pink-300 text-pink-900 hover:bg-pink-400';
};

// ────────────── SORTING PRIORITY ──────────────
const getSortPriority = (load) => {
  if (load.status === 'Ready for Billing' || load.isBillingComplete || load.status === 'Completed' || load.isTerminated) return 1;
  if (load.isReadyForPickup || load.readyForPickup) return 2;
    if (load.isDroppedAtCustomer) return 3;
  // ✅ In Yard (Blue) should sort ABOVE Grounded (Green)
  if (load.isInYard || load.isInYardPrePull || load.isInYardReturn) return 4;
  if (load.isGrounded) return 5;
  if (load.etaDate) return 6;
  return 7; // No ETA (Pink) goes to bottom
};

// 👇 PASTE THE NEW FUNCTION HERE 👇
// ────────────── DERIVE RAIL CARRIER & LOCATION ──────────────
const getRailCarrier = (load) => {
  // 1. Check if we manually typed a Return Location in the form
  if (load.returnLocation && load.returnLocation.trim() !== '') {
    // Splits "CN CALGARY - 123 Road" and just grabs "CN CALGARY"
    return load.returnLocation.split(' - ')[0].trim();
  }

  // 2. Fallback to Terminal
  const terminal = (load.terminal || '').toUpperCase().trim();
  if (terminal && terminal !== 'N/A' && terminal !== 'NONE') {
    const shortTerminal = terminal.split(' - ')[0].trim();
    if (shortTerminal) return shortTerminal;
  }

  // 3. Fallback to saved railCarrier
  if (load.railCarrier && load.railCarrier.trim() !== '') {
    return load.railCarrier;
  }

  // 4. Default
  return '—';
};
// 👆 END OF NEW FUNCTION 👆

// ────────────── MAIN COMPONENT ──────────────
const ContainerBoard = ({ companyId, setFeedback, onEdit }) => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [boardView, setBoardView] = useState('import'); // 'import' or 'export'
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!companyId) return;
    
        // Fetch active loads (Exclude Billing, Paid, and Completed so they vanish immediately)
    const q = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', [
        'Open', 'Dispatched', 'In Transit', 'Delivered'
      ]),
      orderBy('createdAt', 'asc')
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          type: data.shipmentType || data.type || 'import' 
        };
      });
      
            // Filter out loads that are ready for billing, completed, or soft-deleted
      const activeLoads = all.filter((l) => 
        !l.isDeleted && 
        l.status !== 'Paid' && 
        l.status !== 'Archived' &&
        l.status !== 'Ready for Billing' && // ✅ Instantly hide when sent to billing
        l.status !== 'Completed' &&         // ✅ Instantly hide when completed
        !l.isBillingComplete                // ✅ Hide if the "Send to Billing" button was clicked
      );
      
      setContainers(activeLoads);
      setLoading(false);
    });
    return () => unsub();
  }, [companyId]);

    const filteredContainers = useMemo(() => {
    let list = containers.filter(c => c.type === boardView);
    
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.containerNo?.toLowerCase().includes(t) ||
          c.customerName?.toLowerCase().includes(t) ||
          c.bookingNo?.toLowerCase().includes(t) ||
          c.vesselName?.toLowerCase().includes(t) ||
          getRailCarrier(c)?.toLowerCase().includes(t) || // ✅ NEW: Search by Rail (CN, CP, etc.)
          c.rvNo?.toLowerCase().includes(t) ||
          c.railCarrier?.toLowerCase().includes(t)        // ✅ Fallback
      );
    }

    // ✅ APPLY SORTING LOGIC HERE
    list.sort((a, b) => {
      const priorityA = getSortPriority(a);
      const priorityB = getSortPriority(b);
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Sort by priority (1 comes first)
      }
      // If same priority, sort by created date (newest first)
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return list;
  }, [containers, boardView, searchTerm]);

  if (loading) {
    return (
      <div className="h-[80vh] flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
          <span className="text-sm font-bold text-slate-500">Loading Tracking Sheets...</span>
        </div>
      </div>
    );
  }


  return (
    <div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm">
      
      {/* ================= HEADER & TABS ================= */}
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Ship className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Live Tracking Board</h2>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-synced with Load Form</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setBoardView('import')}
            className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${
              boardView === 'import' 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            IMPORTS
          </button>
          <button
            onClick={() => setBoardView('export')}
            className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${
              boardView === 'export' 
                ? 'bg-teal-600 text-white shadow-md' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            EXPORTS
          </button>
        </div>
      </div>

      {/* ================= SEARCH BAR ================= */}
      <div className="bg-white border-b px-4 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4 max-w-xl w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${boardView === 'import' ? 'Imports' : 'Exports'} by Container, Customer, Booking...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
          {/* ✅ NEW: Result Count */}
          <div className="text-xs font-black text-slate-500 bg-slate-100 px-3 py-2 rounded-lg whitespace-nowrap border border-slate-200">
            Found: <span className="text-blue-600">{filteredContainers.length}</span> Containers
          </div>
        </div>
        
        
        {/* Color Legend */}
        <div className="hidden lg:flex items-center gap-3 text-[9px] font-bold uppercase tracking-wider">
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-black rounded-sm"></div> Billing</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-yellow-500 animate-pulse rounded-sm"></div> Ready (Pickup)</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-yellow-300 rounded-sm"></div> At Cust</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-green-400 rounded-sm"></div> Grounded</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-blue-300 rounded-sm"></div> In Yard</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-orange-300 rounded-sm"></div> ETA</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-pink-300 rounded-sm"></div> Pending</div>
        </div>
      </div>

            {/* ================= RV ALERTS BANNER ================= */}
      {(() => {
        const rvAlerts = containers.map(c => ({ load: c, alert: getRvAlert(c) })).filter(item => item.alert !== null);
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

      {/* ================= SPREADSHEET VIEW ================= */}
      <div className="w-full overflow-x-auto bg-slate-100 p-2">
        <table className="w-full text-left border-collapse bg-white shadow-sm border border-slate-300 table-fixed">

          
          {/* ================= IMPORTS HEADERS ================= */}
          {boardView === 'import' && (
            <thead>
  <tr className="sticky top-0 z-20 bg-slate-200 text-[10px] font-black text-slate-700 uppercase tracking-wider border-b-2 border-slate-300 shadow-sm">
                <th className="px-3 py-2 border-r border-slate-300 w-32 bg-slate-200">Customer</th>
                <th className="px-3 py-2 border-r border-slate-300 w-20 bg-slate-200">Rail</th>
                <th className="px-3 py-2 border-r border-slate-300 w-32 bg-slate-200">Container #</th>
                <th className="px-3 py-2 border-r border-slate-300 w-20 bg-slate-200">RV #</th>
                <th className="px-3 py-2 border-r border-slate-300 w-24 bg-slate-200">Pick up</th>
                <th className="px-3 py-2 border-r border-slate-300 w-16 text-center bg-slate-200">Size</th>
                <th className="px-3 py-2 border-r border-slate-300 w-20 bg-slate-200">SSL</th>
                <th className="px-3 py-2 border-r border-slate-300 w-20 bg-slate-200">ETA</th>
                <th className="px-3 py-2 border-r border-slate-300 w-20 bg-slate-200">ETA Time</th>
                <th className="px-3 py-2 border-r border-slate-300 w-24 bg-red-100 text-red-800">LFD</th>
                <th className="px-3 py-2 border-r border-slate-300 w-24 bg-slate-200">Prepull Date</th>
                <th className="px-3 py-2 border-r border-slate-300 w-24 bg-slate-200">Delivery Date</th>
                <th className="px-3 py-2 text-center w-12 bg-slate-200">Edit</th>
              </tr>
            </thead>
          )}


          {/* ================= EXPORTS HEADERS ================= */}
          {boardView === 'export' && (
            <thead>
  <tr className="sticky top-0 z-20 bg-slate-200 text-[10px] font-black text-slate-700 uppercase tracking-wider border-b-2 border-slate-300 shadow-sm">
                <th className="px-2 py-2 border-r border-slate-300 w-[120px] bg-slate-200">Customer</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[80px] bg-slate-200">Booking #</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[60px] bg-slate-200">RV #</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[120px] bg-slate-200">Release Location</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[50px] bg-slate-200">SSL</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[60px] text-center bg-slate-200">Size</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[110px] bg-slate-200">Vessel Name</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[90px] bg-slate-200">Return Rail</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[100px] bg-slate-200">Port Name</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[60px] bg-slate-200">ERD</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[60px] bg-red-100 text-red-800">CUT OFF</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[70px] bg-slate-200">Prepull</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[70px] bg-slate-200">Loading</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[70px] bg-slate-200">Return</th>
                <th className="px-2 py-2 border-r border-slate-300 w-[70px] bg-slate-200">Rail Bill</th>
                <th className="px-2 py-2 text-center w-[40px] bg-slate-200">Edit</th>
              </tr>
            </thead>
          )}


          {/* ================= TABLE BODY ================= */}
          <tbody className="divide-y divide-slate-300">
            {filteredContainers.map((load) => {
              const rowColor = getRowColorClass(load);
              
              // ✅ FIXED: LFD only blinks if it's NOT in yard, NOT dropped, and NOT ready for pickup
              const isLfdUrgent = load.lfdDate && 
                !load.isInYard && 
                !load.isInYardPrePull && 
                !load.isInYardReturn && 
                !load.isDroppedAtCustomer && 
                !load.isReadyForPickup && 
                !load.isTerminated && 
                load.status !== 'Completed' && 
                load.status !== 'Ready for Billing';

              const lfdCellClass = isLfdUrgent 
                ? 'bg-red-500 text-white font-black animate-pulse' 
                : '';

              const cutoffCellClass = load.cutoffDate 
                ? 'bg-red-500 text-white font-black' 
                : '';

              return (
                <tr 
                  key={load.id} 
                  className={`${rowColor} transition-all cursor-pointer text-xs font-bold`}
                  onClick={() => onEdit && onEdit(load)}
                >
                  
                  {/* ────────────── IMPORT ROW DATA ────────────── */}
                  {boardView === 'import' && (
                    <>
                      <td className="px-3 py-2 border-r border-black/10 truncate" title={load.customerName}>{load.customerName || '—'}</td>
                      <td className="px-3 py-2 border-r border-black/10">
                        {load.returnLocation ? load.returnLocation : getRailCarrier(load)}
                      </td>
                                            <td className="px-3 py-2 border-r border-black/10 font-black">
                        <div className="flex items-center gap-1.5">
                          {load.containerNo || '—'}
                          {(() => {
                            const rvAlert = getRvAlert(load);
                            if (!rvAlert) return null;
                            return <span className={`px-1.5 py-0.5 rounded text-[9px] text-white ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'bg-red-600 animate-pulse' : 'bg-amber-500'}`} title={rvAlert.message}>RV Alert</span>;
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-2 border-r border-black/10 font-bold truncate" title={load.rvNo}>
                        {load.rvNo || '—'}
                      </td>
                      <td className="px-3 py-2 border-r border-black/10">{load.pickupNo || '—'}</td>
                      <td className="px-3 py-2 border-r border-black/10 text-center">{load.size?.split(' ')[0] || '—'}</td>
                      <td className="px-3 py-2 border-r border-black/10 truncate">{load.shippingLine || '—'}</td>
                      <td className="px-3 py-2 border-r border-black/10">{formatDate(load.etaDate)}</td>
                      <td className="px-3 py-2 border-r border-black/10">{load.etaTime || '—'}</td>
                      
                      {/* LFD CELL */}
                      <td className={`px-3 py-2 border-r border-black/10 ${lfdCellClass}`}>
                        {formatDate(load.lfdDate)}
                      </td>
                      
                      <td className="px-3 py-2 border-r border-black/10">{formatDate(load.prepullDate)}</td>
                      
                      {/* FIXED: Fallback to appointmentDate if deliveryDate is empty */}
                      <td className="px-3 py-2 border-r border-black/10">
                        {formatDate(load.deliveryDate || load.appointmentDate)}
                      </td>
                    </>
                  )}

                  {/* ────────────── EXPORT ROW DATA ────────────── */}
                  {boardView === 'export' && (
                    <>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={load.customerName}>{load.customerName || '—'}</td>
                                            <td className="px-2 py-2 border-r border-black/10 font-black truncate" title={load.bookingNo}>
                        <div className="flex items-center gap-1.5">
                          {load.bookingNo || '—'}
                          {(() => {
                            const rvAlert = getRvAlert(load);
                            if (!rvAlert) return null;
                            return <span className={`px-1.5 py-0.5 rounded text-[9px] text-white ${rvAlert.type === 'expired' || rvAlert.type === 'critical' || rvAlert.type === 'active' ? 'bg-red-600 animate-pulse' : 'bg-amber-500'}`} title={rvAlert.message}>RV Alert</span>;
                          })()}
                        </div>
                      </td>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={load.rvNo}>
                        {load.rvNo || '—'}
                      </td>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={load.releaseLocation || load.terminal}>{load.releaseLocation || load.terminal || '—'}</td>
                      <td className="px-2 py-2 border-r border-black/10 truncate">{load.shippingLine || '—'}</td>
                      <td className="px-2 py-2 border-r border-black/10 text-center">{load.size?.split(' ')[0] || '—'}</td>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={load.vesselName}>{load.vesselName || '—'}</td>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={getRailCarrier(load)}>{getRailCarrier(load)}</td>
                      <td className="px-2 py-2 border-r border-black/10 truncate" title={load.portName}>{load.portName || '—'}</td>
                      <td className="px-2 py-2 border-r border-black/10">{formatDate(load.erdDate)}</td>
                      
                      <td className={`px-2 py-2 border-r border-black/10 ${cutoffCellClass}`}>
                        {formatDate(load.cutoffDate)}
                      </td>
                      
                      <td className="px-2 py-2 border-r border-black/10">{formatDate(load.prepullDate)}</td>
                      <td className="px-2 py-2 border-r border-black/10">{formatDate(load.loadingDate)}</td>
                      <td className="px-2 py-2 border-r border-black/10">{formatDate(load.returnDate)}</td>
                      <td className="px-2 py-2 border-r border-black/10 text-center truncate">
                        {load.railBill ? `✅ ${load.railBillNumber || 'Yes'}` : '❌ No'}
                      </td>
                    </>
                  )}

                  {/* EDIT BUTTON */}
                  <td className="px-1 py-2 text-center whitespace-nowrap">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onEdit && onEdit(load); }}
                      className="p-1 hover:bg-black/10 rounded transition-colors mx-auto flex items-center justify-center"
                      title="Edit Load"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </td>

                </tr>
              );
            })}
            
            {filteredContainers.length === 0 && (
              <tr>
                                <td colSpan={boardView === 'import' ? 13 : 16} className="px-4 py-12 text-center text-slate-400 font-bold italic bg-white">
                  No {boardView} containers found. Create a new {boardView} load to see it here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContainerBoard;