// src/components/TomorrowDispatchBoard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase.js';
import { 
  Clock, Calendar, Package, Truck, User, MapPin, 
  ChevronDown, AlertCircle, Loader2, Zap, CheckCircle2 
} from 'lucide-react';

const TomorrowDispatchBoard = ({ 
  companyId, 
  onEdit, 
  onDelete, 
  onViewDetails, 
  setFeedback,
  isAdmin = false,
  isDispatcher = false,
  isAccounting = false,
  selectedDate // optional override
}) => {
  // Calculate tomorrow's date
  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const [tomorrowDate, setTomorrowDate] = useState(selectedDate || getTomorrowDate());
  const [tomorrowLoads, setTomorrowLoads] = useState([]);
  const [smartSuggestions, setSmartSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    prepull: 0,
    delivery: 0,
    termination: 0,
    completed: 0
  });

  // ===== SMART MATCHING LOGIC =====
  const generateSmartSuggestions = useCallback((loads) => {
    const suggestions = [];
    
    // 1. Find all containers that are terminating (Ready for pickup / Empty)
    const terminatingContainers = loads.filter(l => 
      l.isReadyForPickup || 
      l.isTerminated ||
      l.legs?.some(leg => leg.legType === 'termination') ||
      l.status === 'Ready for Termination'
    );

    // 2. Find all containers that are picking up (Import / Pre-pull / Live load)
    const pickupContainers = loads.filter(l => 
      l.shipmentType === 'import' || 
      l.isPrePull || 
      l.legs?.some(leg => leg.legType === 'pickup' || leg.legType === 'prepull')
    );

    // 3. Match them based on Location and Size
    terminatingContainers.forEach(term => {
      pickupContainers.forEach(pickup => {
        if (term.id === pickup.id) return; // Don't match with itself

        // Extract locations (Terminal or first leg origin)
        const termLocation = (term.terminal || term.legs?.[0]?.to || '').toLowerCase().trim();
        const pickupLocation = (pickup.terminal || pickup.legs?.[0]?.from || '').toLowerCase().trim();

        // Extract sizes (e.g., 40GE, 20GE, 40HC)
        const termSize = (term.size || '').trim();
        const pickupSize = (pickup.size || '').trim();

        // STRICT MATCHING: Location must match AND Size must match
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

  // Fetch tomorrow's loads
  const fetchTomorrowLoads = useCallback(async () => {
    if (!companyId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const loadsCollection = collection(db, 'companies', companyId, 'loads');
      const seen = new Set();
      let merged = [];
      
      const addLoads = (snapshot) => {
        snapshot.docs.forEach(docSnap => {
          if (seen.has(docSnap.id)) return;
          seen.add(docSnap.id);
          const data = docSnap.data();
          merged.push({
            id: docSnap.id,
            ...data,
            etaDate: data.etaDate || '',
            etaTime: data.etaTime || '',
            lfdDate: data.lfdDate || '',
            appointmentDate: data.appointmentDate || '',
            appointmentTime: data.appointmentTime || '',
            prepullDate: data.prepullDate || data.prePullDate || '',
            isPrePull: data.isPrePull || false,
            isDelivered: data.isDelivered || false,
            isTerminated: data.isTerminated || false,
            isReadyForPickup: data.isReadyForPickup || false,
            readyForPickupDate: data.readyForPickupDate || '',
            shippingLine: data.shippingLine || '',
            railCarrier: data.railCarrier || 'CN',
            terminal: data.terminal || '',
            delivery: data.delivery || '',
            driverName: data.legs?.[0]?.driverName || '',
            truckNo: data.legs?.[0]?.truckNo || ''
          });
        });
      };
      
      // 1. Appointment date = tomorrow
      const apptQuery = query(loadsCollection, where('appointmentDate', '==', tomorrowDate));
      const apptSnap = await getDocs(apptQuery);
      addLoads(apptSnap);
      
      // 2. Ready for pickup tomorrow (needs termination)
      const readyQuery = query(loadsCollection, where('readyForPickupDate', '==', tomorrowDate));
      try {
        const readySnap = await getDocs(readyQuery);
        addLoads(readySnap);
      } catch (e) { /* index may not exist yet, ignore */ }
      
      // 3. Pre-pull date = tomorrow
      const prepullQuery = query(loadsCollection, where('prepullDate', '==', tomorrowDate));
      try {
        const prepullSnap = await getDocs(prepullQuery);
        addLoads(prepullSnap);
      } catch (e) { /* ignore */ }
      
      // 4. Backdated drops (delivered before today, not terminated)
      const todayStr = new Date().toISOString().split('T')[0];
      const allActiveQuery = query(
        loadsCollection,
        where('status', 'in', ['Open', 'Dispatched', 'In Transit', 'Delivered', 'Ready for Termination']),
        limit(200)
      );
      try {
        const allSnap = await getDocs(allActiveQuery);
        allSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.isDelivered && !data.isTerminated && data.deliveryDate && data.deliveryDate < todayStr) {
            if (!seen.has(docSnap.id)) {
              seen.add(docSnap.id);
              merged.push({
                id: docSnap.id,
                ...data,
                isReadyForPickup: data.isReadyForPickup || false,
                readyForPickupDate: data.readyForPickupDate || ''
              });
            }
          }
        });
      } catch (e) { /* ignore */ }

      // ===== ENRICH DATA WITH TERMINATION NOTES =====
      merged = merged.map(load => {
        if (load.isReadyForPickup || load.isTerminated) {
          const dropDate = load.deliveryDate || load.appointmentDate || 'recently';
          return {
            ...load,
            terminationNote: `Dropped on ${dropDate}. Ready to terminate today!`
          };
        }
        return load;
      });
      
      setTomorrowLoads(merged);
      setSmartSuggestions(generateSmartSuggestions(merged));
      
      // Statistics
      const statsData = {
        total: merged.length,
        prepull: merged.filter(l => l.isPrePull).length,
        delivery: merged.filter(l => 
          l.loadType === 'DROP' || 
          l.legs?.some(leg => leg.legType === 'delivery')
        ).length,
        termination: merged.filter(l => 
          l.legs?.some(leg => leg.legType === 'termination') || l.isReadyForPickup
        ).length,
        completed: merged.filter(l => 
          l.status === 'Completed' || 
          l.status === 'Delivered' || 
          l.status === 'Ready for Billing'
        ).length
      };
      setStats(statsData);
      
    } catch (error) {
      console.error('Error fetching tomorrow loads:', error);
      setError(error.message || 'Failed to load tomorrow\'s dispatch');
      setFeedback?.('❌ Failed to load tomorrow\'s dispatch');
    } finally {
      setLoading(false);
    }
  }, [companyId, tomorrowDate, setFeedback, generateSmartSuggestions]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    fetchTomorrowLoads();
    const interval = setInterval(fetchTomorrowLoads, 60000);
    return () => clearInterval(interval);
  }, [fetchTomorrowLoads]);

  // Handle date change
  const handleDateChange = (e) => {
    setTomorrowDate(e.target.value);
  };

  // Re-fetch when date changes
  useEffect(() => {
    if (tomorrowDate) {
      fetchTomorrowLoads();
    }
  }, [tomorrowDate, fetchTomorrowLoads]);

  // Update date when selectedDate prop changes
  useEffect(() => {
    if (selectedDate && selectedDate !== tomorrowDate) {
      setTomorrowDate(selectedDate);
    }
  }, [selectedDate]);

  // Get day of week for display
  const getDayOfWeek = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  };

  // Format date for display
  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Calculate minimum date for date picker
  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header with Stats */}
      <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-[32px] p-6 border border-orange-200 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="bg-orange-600 p-3 rounded-2xl">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-orange-900 tracking-tight">
                  Tomorrow's Board
                </h2>
                <p className="text-orange-700 font-bold text-sm">
                  {getDayOfWeek(tomorrowDate)} — {formatDisplayDate(tomorrowDate)}
                </p>
              </div>
            </div>
          </div>
          
          {/* Date Picker */}
          <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-orange-200 shadow-sm">
            <Clock className="w-5 h-5 text-orange-600 ml-2" />
            <input 
              type="date" 
              value={tomorrowDate} 
              onChange={handleDateChange}
              min={getMinDate()}
              className="bg-transparent font-black text-orange-800 outline-none w-full sm:w-auto px-2 py-1 rounded-lg cursor-pointer"
              title="Change date to view dispatch for any day"
            />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
          <div className="bg-white/80 p-4 rounded-2xl border border-orange-100 text-center hover:shadow-md transition-all">
            <div className="text-2xl font-black text-orange-700">{stats.total}</div>
            <div className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Total</div>
          </div>
          <div className="bg-white/80 p-4 rounded-2xl border border-purple-100 text-center hover:shadow-md transition-all">
            <div className="text-2xl font-black text-purple-600">{stats.prepull}</div>
            <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Pre-Pull</div>
          </div>
          <div className="bg-white/80 p-4 rounded-2xl border border-blue-100 text-center hover:shadow-md transition-all">
            <div className="text-2xl font-black text-blue-600">{stats.delivery}</div>
            <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Delivery</div>
          </div>
          <div className="bg-white/80 p-4 rounded-2xl border border-red-100 text-center hover:shadow-md transition-all">
            <div className="text-2xl font-black text-red-600">{stats.termination}</div>
            <div className="text-[10px] font-black text-red-400 uppercase tracking-widest">Termination</div>
          </div>
          <div className="bg-white/80 p-4 rounded-2xl border border-green-100 text-center hover:shadow-md transition-all">
            <div className="text-2xl font-black text-green-600">{stats.completed}</div>
            <div className="text-[10px] font-black text-green-400 uppercase tracking-widest">Completed</div>
          </div>
        </div>
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

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <span className="font-bold text-red-800">Error loading data</span>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </div>
            <button 
              onClick={fetchTomorrowLoads}
              className="ml-auto px-4 py-2 bg-red-100 text-red-700 rounded-xl font-bold text-sm hover:bg-red-200 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
          <span className="ml-3 text-orange-800 font-bold">Loading tomorrow's dispatch...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && tomorrowLoads.length === 0 && (
        <div className="bg-amber-50 border-2 border-dashed border-amber-300 rounded-2xl p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
              <Calendar className="w-8 h-8 text-amber-500" />
            </div>
            <div className="font-black text-amber-800 text-xl">No Loads Scheduled for Tomorrow</div>
            <div className="text-amber-600 font-medium">Great time to plan ahead and prepare!</div>
            <button
              onClick={() => setTomorrowDate(new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0])}
              className="mt-4 px-6 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-colors shadow-lg"
            >
              Check Day After Tomorrow
            </button>
          </div>
        </div>
      )}

      {/* ===== CARD VIEW FOR TOMORROW'S LOADS ===== */}
      {!loading && tomorrowLoads.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-600" />
              Tomorrow's Load Cards
            </h3>
            <span className="text-sm font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
              {tomorrowLoads.length} Containers
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tomorrowLoads.map((load) => (
              <div 
                key={load.id} 
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-orange-300 transition-all cursor-pointer group"
                onClick={() => onEdit?.(load)}
              >
                {/* Card Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex gap-2">
                    <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider ${
                      load.shipmentType === 'import' ? 'bg-blue-100 text-blue-700' : 
                      load.shipmentType === 'export' ? 'bg-green-100 text-green-700' : 
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {load.shipmentType || 'IMPORT'}
                    </span>
                    <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider ${
                      load.loadType === 'LIVE' ? 'bg-blue-100 text-blue-700' : 
                      load.loadType === 'DROP' ? 'bg-green-100 text-green-700' : 
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {load.loadType || 'DROP'}
                    </span>
                  </div>
                  {load.isPrePull && (
                    <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-200">
                      Pre-Pull
                    </span>
                  )}
                </div>

                {/* Container & Customer */}
                <div className="mb-3">
                  <h4 className="font-black text-xl text-slate-800 group-hover:text-orange-600 transition-colors">
                    {load.containerNo || 'N/A'}
                  </h4>
                  <p className="text-sm font-bold text-slate-600 truncate">
                    {load.customerName || 'N/A'}
                  </p>
                </div>

                {/* Time & Location */}
                <div className="space-y-1.5 text-xs text-slate-500 font-medium mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{load.appointmentTime || load.etaTime || 'TBD'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{load.delivery || load.terminal || 'No Location'}</span>
                  </div>
                  {load.size && (
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-bold text-slate-700">{load.size}</span>
                    </div>
                  )}
                </div>

                {/* Termination Note */}
                {load.terminationNote && (
                  <div className="mb-3 bg-red-50 p-2.5 rounded-xl border border-red-100 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs font-bold text-red-700">
                      {load.terminationNote}
                    </span>
                  </div>
                )}

                {/* Driver Info */}
                {load.driverName ? (
                  <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-black text-slate-700 truncate">{load.driverName}</div>
                      <div className="text-[10px] font-bold text-slate-400">Truck: {load.truckNo || 'N/A'}</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-yellow-50 p-2.5 rounded-xl border border-yellow-100">
                    <User className="w-4 h-4 text-yellow-500" />
                    <span className="text-xs font-bold text-yellow-700">Driver Unassigned</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TomorrowDispatchBoard;