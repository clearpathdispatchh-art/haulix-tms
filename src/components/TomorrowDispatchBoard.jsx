// src/components/TomorrowDispatchBoard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { Clock, Calendar, Package, Truck, User, MapPin, ChevronDown, AlertCircle, Loader2 } from 'lucide-react';
import DailyDispatchBoard from './DailyDispatchBoard';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    prepull: 0,
    delivery: 0,
    termination: 0,
    completed: 0
  });

  // Fetch tomorrow's loads
  const fetchTomorrowLoads = useCallback(async () => {
    if (!companyId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const q = query(
        collection(db, 'companies', companyId, 'loads'),
        where('appointmentDate', '==', tomorrowDate)
      );
      
      const snapshot = await getDocs(q);
      const loads = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Process loads to ensure consistent data structure
      const processedLoads = loads.map(load => ({
        ...load,
        etaDate: load.etaDate || '',
        etaTime: load.etaTime || '',
        lfdDate: load.lfdDate || '',
        appointmentDate: load.appointmentDate || '',
        appointmentTime: load.appointmentTime || '',
        prepullDate: load.prepullDate || load.prePullDate || '',
        isPrePull: load.isPrePull || false,
        isDelivered: load.isDelivered || false,
        isTerminated: load.isTerminated || false,
        shippingLine: load.shippingLine || '',
        railCarrier: load.railCarrier || 'CN',
        terminal: load.terminal || '',
        delivery: load.delivery || '',
        driverName: load.legs?.[0]?.driverName || '',
        truckNo: load.legs?.[0]?.truckNo || ''
      }));
      
      setTomorrowLoads(processedLoads);
      
      // Calculate statistics
      const statsData = {
        total: processedLoads.length,
        prepull: processedLoads.filter(l => l.isPrePull).length,
        delivery: processedLoads.filter(l => 
          l.loadType === 'DROP' || 
          l.legs?.some(leg => leg.legType === 'delivery')
        ).length,
        termination: processedLoads.filter(l => 
          l.legs?.some(leg => leg.legType === 'termination')
        ).length,
        completed: processedLoads.filter(l => 
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
  }, [companyId, tomorrowDate, setFeedback]);

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

      {/* Pre-Pull Alert for Tomorrow */}
      {!loading && stats.prepull > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-2 rounded-xl">
              <AlertCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <span className="font-bold text-purple-800">
                📦 {stats.prepull} container{stats.prepull > 1 ? 's' : ''} need pre-pull tomorrow
              </span>
              <span className="text-xs text-purple-600 ml-2 font-medium">
                (Prepare chassis and yard space)
              </span>
            </div>
          </div>
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

      {/* Dispatch Board with pre-loaded data */}
      {!loading && tomorrowLoads.length > 0 && (
        <div>
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm font-bold text-blue-800">
              📋 Showing dispatch board for {formatDisplayDate(tomorrowDate)} with {tomorrowLoads.length} pre-loaded containers
            </p>
          </div>
          <DailyDispatchBoard
            companyId={companyId}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewDetails={onViewDetails}
            setFeedback={setFeedback}
            isAdmin={isAdmin}
            isDispatcher={isDispatcher}
            isAccounting={isAccounting}
            selectedDate={tomorrowDate}
            preloadedContainers={tomorrowLoads}
            skipInitialFetch={true}
          />
        </div>
      )}

      {/* Quick Summary */}
      {!loading && tomorrowLoads.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-black text-sm text-slate-700 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-600" />
            Tomorrow's Load Summary
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tomorrowLoads.slice(0, 10).map((load) => (
              <div 
                key={load.id} 
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer group"
                onClick={() => onEdit?.(load)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    load.isPrePull ? 'bg-purple-500' :
                    load.loadType === 'LIVE' ? 'bg-blue-500' :
                    load.loadType === 'DROP' ? 'bg-green-500' :
                    'bg-slate-300'
                  }`} />
                  <span className="font-bold text-sm text-slate-700 truncate">{load.containerNo || 'N/A'}</span>
                  <span className="text-xs text-slate-400 truncate hidden sm:block">{load.customerName || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {load.loadType && (
                    <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                      load.loadType === 'LIVE' ? 'bg-blue-100 text-blue-700' :
                      load.loadType === 'DROP' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {load.loadType}
                    </span>
                  )}
                  {load.isPrePull && (
                    <span className="font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-xs">
                      Pre-Pull
                    </span>
                  )}
                  <span className="text-slate-400 text-xs font-medium">{load.appointmentTime || 'TBD'}</span>
                  <ChevronDown className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
            {tomorrowLoads.length > 10 && (
              <div className="text-center text-xs text-slate-400 font-bold pt-2 bg-slate-50 rounded-xl py-3">
                +{tomorrowLoads.length - 10} more loads
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {!loading && tomorrowLoads.length > 0 && (
        <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-wrap items-center gap-4 text-xs">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Legend:</span>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
            <span className="font-bold text-slate-600">Pre-Pull</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span className="font-bold text-slate-600">Live Load</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="font-bold text-slate-600">Drop</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-300"></div>
            <span className="font-bold text-slate-600">Other</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TomorrowDispatchBoard;