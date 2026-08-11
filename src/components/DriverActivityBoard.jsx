// components/DriverActivityBoard.jsx
import React, { useState, useEffect } from 'react';
import { 
  Truck, Hash, Package, Eye, Phone, MessageSquare, MapPin, 
  Navigation, Clock, Award, TrendingUp, AlertCircle, 
  CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronUp,
  Search, Filter, GripVertical, Activity, Timer, Zap,
  Star, Shield, User, Calendar, ArrowRight
} from 'lucide-react';
import { collection, query, where, getDocs, limit, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase.js';

// Status configurations with icons and colors
const DRIVER_STATUS_CONFIG = {
  'Active': { 
    icon: Activity, 
    color: 'text-green-600', 
    bg: 'bg-green-100', 
    border: 'border-green-300',
    pulse: true 
  },
  'On Trip': { 
    icon: Navigation, 
    color: 'text-blue-600', 
    bg: 'bg-blue-100', 
    border: 'border-blue-300',
    pulse: true 
  },
  'Idle': { 
    icon: Clock, 
    color: 'text-slate-500', 
    bg: 'bg-slate-100', 
    border: 'border-slate-200',
    pulse: false 
  },
  'Completed': { 
    icon: CheckCircle, 
    color: 'text-green-600', 
    bg: 'bg-green-100', 
    border: 'border-green-200',
    pulse: false 
  },
  'Break': { 
    icon: Timer, 
    color: 'text-yellow-600', 
    bg: 'bg-yellow-100', 
    border: 'border-yellow-200',
    pulse: false 
  }
};

const DriverActivityBoard = ({ drivers, companyId, onViewPOD, onResetDriver }) => {
  const [driverLoads, setDriverLoads] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedDrivers, setExpandedDrivers] = useState(new Set());
  const [viewMode, setViewMode] = useState('cards');
  const [sortBy, setSortBy] = useState('name');
  const [updatingLoad, setUpdatingLoad] = useState(null); // ✅ FIX 2: Track which load is being updated

  // ========== FETCH LOADS FOR ALL DRIVERS ==========
  useEffect(() => {
    if (!companyId || !drivers || drivers.length === 0) return;

    const fetchAllDriverLoads = async () => {
      try {
        const q = query(
          collection(db, 'companies', companyId, 'loads'),
          where('status', 'in', ['Open', 'Dispatched', 'In Transit', 'Delivered', 'Ready for Billing']),
          limit(100)
        );
        const snapshot = await getDocs(q);
        const loadsData = {};
        
        snapshot.docs.forEach(doc => {
          const load = { id: doc.id, ...doc.data() };
          const legs = load.legs || [];
          
          legs.forEach(leg => {
            if (leg.driverName || leg.truckNo) {
              const key = leg.driverName || leg.truckNo;
              if (key) {
                if (!loadsData[key]) {
                  loadsData[key] = [];
                }
                
                loadsData[key].push({
                  containerNo: load.containerNo || 'N/A',
                  workOrderNo: load.workOrderNo || 'N/A',
                  customerName: load.customerName || 'N/A',
                  loadId: load.id,
                  from: leg.from || 'N/A',
                  to: leg.to || 'N/A',
                  status: leg.tripStatus || leg.status || 'Planned',
                  driverName: leg.driverName || null,
                  truckNo: leg.truckNo || null
                });
              }
            }
          });
        });
        
        setDriverLoads(loadsData);
      } catch (error) {
        console.error('Error fetching driver loads:', error);
      }
    };

    fetchAllDriverLoads();
  }, [companyId, drivers]);

  // ========== UPDATE LOAD LEG STATUS FROM FLEET BOARD ==========
  // ✅ FIX 3: Status update handler
  const handleUpdateLegStatus = async (loadId, driverName, truckNo, newStatus) => {
    if (!companyId || !loadId) return;
    
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', loadId);
      const loadSnap = await getDoc(loadRef);
      
      if (!loadSnap.exists()) {
        console.error('Load not found');
        return;
      }
      
      const loadData = loadSnap.data();
      const legs = loadData.legs || [];
      const timeStr = new Date().toLocaleTimeString();
      
      const updatedLegs = legs.map(leg => {
        if ((leg.driverName === driverName || leg.truckNo === truckNo) && 
            leg.status !== 'Completed' && leg.status !== 'Delivered' && leg.status !== 'POD Uploaded') {
          
          const updatedLeg = { 
            ...leg, 
            tripStatus: newStatus,
            status: newStatus,
            lastTripUpdate: new Date().toISOString()
          };
          
          if (newStatus === 'Started') updatedLeg.startedAt = timeStr;
          if (newStatus === 'Arrived Pickup') updatedLeg.arrivedPickupAt = timeStr;
          if (newStatus === 'Loaded') updatedLeg.loadedAt = timeStr;
          if (newStatus === 'In Transit') updatedLeg.inTransitAt = timeStr;
          if (newStatus === 'Arrived Delivery') updatedLeg.arrivedDeliveryAt = timeStr;
          if (newStatus === 'Delivered') updatedLeg.deliveredAt = timeStr;
          if (newStatus === 'POD Uploaded') updatedLeg.podUploadedAt = timeStr;
          if (newStatus === 'Heading to Yard') updatedLeg.headingToYardAt = timeStr;
          if (newStatus === 'Arrived Yard') updatedLeg.arrivedYardAt = timeStr;
          if (newStatus === 'Completed') updatedLeg.completedAt = timeStr;
          
          return updatedLeg;
        }
        return leg;
      });
      
      await updateDoc(loadRef, { 
        legs: updatedLegs,
        updatedAt: new Date().toISOString()
      });
      
      // Also update driver document
      if (driverName) {
        const driverQuery = query(
          collection(db, 'companies', companyId, 'drivers'),
          where('name', '==', driverName)
        );
        const driverSnap = await getDocs(driverQuery);
        if (!driverSnap.empty) {
          const driverRef = doc(db, 'companies', companyId, 'drivers', driverSnap.docs[0].id);
          await updateDoc(driverRef, {
            tripStatus: newStatus,
            lastTripUpdate: new Date().toISOString()
          });
        }
      }
      
      console.log(`✅ Fleet Board: Updated ${driverName} status to "${newStatus}" for load ${loadId}`);
      
    } catch (error) {
      console.error('Error updating leg status from fleet board:', error);
    }
  };

  // ========== GET LOADS FOR A DRIVER ==========
  const getDriverLoads = (driver) => {
    if (!driver) return [];
    
    let loads = [];
    
    // ✅ CHECK 1: Firestore loads FIRST (they have the latest trip status)
    if (driver.name && driverLoads[driver.name]) {
      const firestoreLoads = driverLoads[driver.name];
      firestoreLoads.forEach(load => {
        if (!loads.find(l => l.loadId === load.loadId)) {
          loads.push({ ...load });
        }
      });
    }
    
    if (driver.truckNo && driverLoads[driver.truckNo]) {
      const truckLoads = driverLoads[driver.truckNo];
      truckLoads.forEach(truckLoad => {
        if (!loads.find(l => l.loadId === truckLoad.loadId)) {
          loads.push({ ...truckLoad });
        }
      });
    }
    
    // ✅ CHECK 2: assignedContainers array (supplement with any missing)
    if (driver.assignedContainers && Array.isArray(driver.assignedContainers)) {
      driver.assignedContainers.forEach(container => {
        if (!loads.find(l => l.containerNo === container.containerNo)) {
          loads.push({
            containerNo: container.containerNo,
            workOrderNo: container.workOrderNo || 'N/A',
            customerName: container.customerName || 'N/A',
            loadId: container.loadId || null,
            from: container.from || 'N/A',
            to: container.to || 'N/A',
            status: 'Planned'
          });
        }
      });
    }
    
    // ✅ CHECK 3: Fallback to currentContainerNo
    if (loads.length === 0 && driver.currentContainerNo) {
      loads.push({
        containerNo: driver.currentContainerNo,
        workOrderNo: driver.currentWorkOrderNo || 'N/A',
        customerName: driver.currentCustomerName || 'N/A',
        loadId: driver.currentLoadId || null,
        from: driver.currentFrom || 'N/A',
        to: driver.currentTo || 'N/A',
        status: driver.tripStatus || 'Planned'
      });
    }
    
    return loads;
  };

  const isDriverActive = (driver) => {
    const status = driver.tripStatus || 'Idle';
    return status === 'Active' || status === 'On Trip';
  };

  const getTripDuration = (driver) => {
    if (!driver.tripStartedAt) return null;
    try {
      const start = new Date(driver.tripStartedAt);
      const now = new Date();
      const diffMs = now - start;
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${minutes}m`;
    } catch {
      return null;
    }
  };

  const toggleExpand = (driverId) => {
    const newExpanded = new Set(expandedDrivers);
    if (newExpanded.has(driverId)) {
      newExpanded.delete(driverId);
    } else {
      newExpanded.add(driverId);
    }
    setExpandedDrivers(newExpanded);
  };

  const filteredAndSortedDrivers = drivers
    .filter(driver => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch = 
          driver.name?.toLowerCase().includes(term) ||
          driver.truckNo?.toLowerCase().includes(term) ||
          driver.phone?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }
      
      if (statusFilter !== 'all') {
        const driverStatus = driver.tripStatus || 'Idle';
        if (driverStatus !== statusFilter) return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'status':
          const statusOrder = ['Active', 'On Trip', 'Break', 'Idle', 'Completed'];
          return statusOrder.indexOf(a.tripStatus || 'Idle') - statusOrder.indexOf(b.tripStatus || 'Idle');
        case 'tripTime':
          const timeA = a.tripStartedAt ? new Date(a.tripStartedAt).getTime() : 0;
          const timeB = b.tripStartedAt ? new Date(b.tripStartedAt).getTime() : 0;
          return timeB - timeA;
        default:
          return (a.name || '').localeCompare(b.name || '');
      }
    });

  const stats = {
    total: drivers.length,
    active: drivers.filter(d => isDriverActive(d)).length,
    idle: drivers.filter(d => (d.tripStatus || 'Idle') === 'Idle').length,
    completed: drivers.filter(d => d.tripStatus === 'Completed').length,
    withLoads: drivers.filter(d => getDriverLoads(d).length > 0).length
  };

  // ✅ FIX 4 & 5: Helper function for status badge colors
  const getStatusColor = (status) => {
    switch (status) {
      case 'Started': return { bg: 'bg-blue-100', text: 'text-blue-700', icon: 'text-blue-600' };
      case 'In Transit': return { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: 'text-indigo-600' };
      case 'Arrived Pickup': return { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: 'text-cyan-600' };
      case 'Loaded': return { bg: 'bg-teal-100', text: 'text-teal-700', icon: 'text-teal-600' };
      case 'Arrived Delivery': return { bg: 'bg-orange-100', text: 'text-orange-700', icon: 'text-orange-600' };
      case 'Delivered': return { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: 'text-yellow-600' };
      case 'POD Uploaded': return { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'text-emerald-600' };
      case 'Completed': return { bg: 'bg-green-100', text: 'text-green-700', icon: 'text-green-600' };
      case 'Heading to Yard': return { bg: 'bg-purple-100', text: 'text-purple-700', icon: 'text-purple-600' };
      default: return { bg: 'bg-slate-100', text: 'text-slate-600', icon: 'text-slate-600' };
    }
  };

  return (
    <div className="animate-in fade-in p-4 space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" />
            Driver Status Board
          </h2>
          <p className="text-sm text-slate-500 font-medium">
            {stats.active} active • {stats.withLoads} assigned • {stats.total} total
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 text-xs font-bold transition-all ${
                viewMode === 'cards' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >📋 Cards</button>
            <button
              onClick={() => setViewMode('compact')}
              className={`px-3 py-1.5 text-xs font-bold transition-all ${
                viewMode === 'compact' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >📊 Compact</button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 text-xs font-bold transition-all ${
                viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >🗺️ Grid</button>
          </div>
        </div>
      </div>

      {/* MODERN STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
              <Truck className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">{stats.total}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase">Total</div>
            </div>
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-2xl border border-green-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <div className="text-lg font-black text-green-700">{stats.active}</div>
              <div className="text-[9px] font-bold text-green-600 uppercase">Active</div>
            </div>
          </div>
        </div>
        
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="text-lg font-black text-blue-700">{stats.withLoads}</div>
              <div className="text-[9px] font-bold text-blue-600 uppercase">Assigned</div>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-700">{stats.idle}</div>
              <div className="text-[9px] font-bold text-slate-500 uppercase">Idle</div>
            </div>
          </div>
        </div>
        
        <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <div className="text-lg font-black text-purple-700">{stats.completed}</div>
              <div className="text-[9px] font-bold text-purple-600 uppercase">Completed</div>
            </div>
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search driver name, truck #, phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
          />
        </div>
        
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="appearance-none w-full sm:w-48 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-sm pr-10 cursor-pointer"
        >
          <option value="all">📋 All Statuses</option>
          <option value="Active">🟢 Active</option>
          <option value="On Trip">🔵 On Trip</option>
          <option value="Idle">⏳ Idle</option>
          <option value="Break">🟡 On Break</option>
          <option value="Completed">✅ Completed</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="appearance-none w-full sm:w-40 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-sm pr-10 cursor-pointer"
        >
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="tripTime">Sort: Trip Time</option>
        </select>
      </div>

      {/* DRIVER CARDS */}
      {viewMode === 'compact' ? (
        /* COMPACT LIST VIEW */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filteredAndSortedDrivers.map(driver => {
              const status = driver.tripStatus || 'Idle';
              const statusConfig = DRIVER_STATUS_CONFIG[status] || DRIVER_STATUS_CONFIG['Idle'];
              const StatusIcon = statusConfig.icon;
              const assignedLoads = getDriverLoads(driver);
              const tripDuration = getTripDuration(driver);
              
              return (
                <div key={driver.id}>
                  <div 
                    className="flex items-center gap-4 p-3 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(driver.id)}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black ${
                      isDriverActive(driver) ? 'bg-blue-500' : 'bg-slate-400'
                    }`}>
                      {driver.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-slate-900 truncate">{driver.name}</div>
                      <div className="text-xs text-slate-400">{driver.truckNo}</div>
                    </div>
                    <div className="hidden md:flex items-center gap-1">
                      {assignedLoads.length > 0 && (
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          {assignedLoads.length} container{assignedLoads.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${statusConfig.bg} ${statusConfig.color}`}>
                      {statusConfig.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>}
                      <StatusIcon className="w-3 h-3" />
                      {status}
                    </span>
                    {tripDuration && (
                      <span className="text-xs font-bold text-slate-500 hidden md:block">{tripDuration}</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedDrivers.has(driver.id) ? 'rotate-180' : ''}`} />
                  </div>
                  
                  {expandedDrivers.has(driver.id) && assignedLoads.length > 1 && (
                    <div className="bg-slate-50 px-4 py-2 border-t border-slate-100">
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">All Containers:</div>
                      {assignedLoads.map((load, idx) => (
                        <div key={idx} className="text-xs text-slate-600 flex items-center gap-2 py-0.5">
                          <Hash className="w-3 h-3 text-slate-400" />
                          {load.containerNo} - {load.workOrderNo} 
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${getStatusColor(load.status).bg} ${getStatusColor(load.status).text}`}>
                            {load.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filteredAndSortedDrivers.map(driver => {
            const status = driver.tripStatus || 'Idle';
            const isActive = isDriverActive(driver);
            const statusConfig = DRIVER_STATUS_CONFIG[status] || DRIVER_STATUS_CONFIG['Idle'];
            const StatusIcon = statusConfig.icon;
            const assignedLoads = getDriverLoads(driver);
            
            return (
              <div key={driver.id} 
                className={`bg-white rounded-2xl p-3 border shadow-sm hover:shadow-md transition-all cursor-pointer text-center ${
                  isActive ? 'border-blue-300' : 'border-slate-200'
                }`}
                onClick={() => toggleExpand(driver.id)}>
                <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center text-white font-black text-lg mb-2 ${
                  isActive ? 'bg-blue-500' : 'bg-slate-400'
                }`}>
                  {driver.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="font-bold text-sm text-slate-900 truncate">{driver.name}</div>
                <div className="text-[10px] text-slate-400">{driver.truckNo}</div>
                {assignedLoads.length > 0 && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    <Package className="w-2.5 h-2.5" />
                    {assignedLoads.length} load{assignedLoads.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 mt-2 text-[9px] font-bold px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.color}`}>
                  {statusConfig.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>}
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* DETAILED CARD VIEW - ONE CARD PER CONTAINER, GROUPED BY DRIVER */
        <div className="space-y-8">
          {filteredAndSortedDrivers.length === 0 ? (
            <div className="text-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-200">
              <Truck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="font-bold">No drivers found</p>
              <p className="text-xs mt-1">{searchTerm ? 'Try a different search' : 'Add drivers in the Database tab'}</p>
            </div>
          ) : (
            filteredAndSortedDrivers.map(driver => {
              const status = driver.tripStatus || 'Idle';
              const isActive = isDriverActive(driver);
              const statusConfig = DRIVER_STATUS_CONFIG[status] || DRIVER_STATUS_CONFIG['Idle'];
              const StatusIcon = statusConfig.icon;
              const assignedLoads = getDriverLoads(driver);
              const tripDuration = getTripDuration(driver);
              
              if (assignedLoads.length === 0) return null;
              
              return (
                <div key={driver.id} className="space-y-3">
                  {/* DRIVER HEADER BAR */}
                  <div className="flex items-center gap-3 bg-slate-100 rounded-2xl px-4 py-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black ${
                      isActive ? 'bg-blue-500' : 'bg-slate-400'
                    }`}>
                      {driver.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1">
                      <div className="font-black text-slate-900">{driver.name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        <Truck className="w-3 h-3" />
                        {driver.truckNo || 'No Truck'}
                      </div>
                    </div>
                    <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${statusConfig.bg} ${statusConfig.color} border ${statusConfig.border}`}>
                      {statusConfig.pulse && <span className="w-2 h-2 rounded-full bg-current animate-pulse"></span>}
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status}
                    </span>
                    {tripDuration && (
                      <span className="flex items-center gap-1 text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded-full">
                        <Timer className="w-3 h-3" />
                        {tripDuration}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                      <Package className="w-3 h-3" />
                      {assignedLoads.length} container{assignedLoads.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* INDIVIDUAL CONTAINER CARDS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                    {assignedLoads.map((load, idx) => {
                      const isExpanded = expandedDrivers.has(`${driver.id}-${load.loadId || idx}`);
                      const statusColors = getStatusColor(load.status);
                      
                      return (
                        <div key={load.loadId || idx} 
                          className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 hover:shadow-lg ${
                            load.status === 'Completed' ? 'border-green-200' :
                            load.status === 'In Transit' ? 'border-blue-300 ring-1 ring-blue-100' : 
                            load.status === 'Delivered' ? 'border-yellow-200' :
                            load.status === 'Started' ? 'border-blue-200' :
                            'border-slate-200'
                          }`}>
                          
                          <div className="p-4">
                            {/* Container Number & Status */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${statusColors.bg}`}>
                                  <Hash className={`w-4 h-4 ${statusColors.icon}`} />
                                </div>
                                <div>
                                  <div className="font-black text-slate-900 text-sm">{load.containerNo}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-slate-400">{load.workOrderNo}</span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusColors.bg} ${statusColors.text}`}>
                                      {load.status || 'Planned'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => toggleExpand(`${driver.id}-${load.loadId || idx}`)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                            
                            {/* Customer & Location */}
                            <div className="mb-3">
                              <div className="text-xs font-bold text-slate-600 truncate">{load.customerName}</div>
                              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
                                <MapPin className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{load.from || 'N/A'}</span>
                                <ArrowRight className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{load.to || 'N/A'}</span>
                              </div>
                            </div>
                            
                            {/* ✅ FIX 4: STATUS UPDATE BUTTONS */}
                            {load.status !== 'Completed' && load.status !== 'Delivered' && load.status !== 'POD Uploaded' && (
                              <div className="mb-3 p-2 bg-slate-50 rounded-lg">
                                <div className="text-[9px] font-bold text-slate-400 uppercase mb-2">Update Status:</div>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Started');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Started' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Started'
                                        ? 'bg-blue-200 text-blue-400 cursor-not-allowed'
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                    } disabled:opacity-50`}
                                  >
                                    {updatingLoad === load.loadId ? '...' : load.status === 'Started' ? '✅ Start' : '🚛 Start'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Arrived Pickup');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Arrived Pickup' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Arrived Pickup'
                                        ? 'bg-cyan-200 text-cyan-400 cursor-not-allowed'
                                        : 'bg-cyan-500 text-white hover:bg-cyan-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Arrived Pickup' ? '✅ Arr PU' : '📍 Arr PU'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Loaded');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Loaded' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Loaded'
                                        ? 'bg-teal-200 text-teal-400 cursor-not-allowed'
                                        : 'bg-teal-500 text-white hover:bg-teal-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Loaded' ? '✅ Loaded' : '📦 Load'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'In Transit');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'In Transit' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'In Transit'
                                        ? 'bg-indigo-200 text-indigo-400 cursor-not-allowed'
                                        : 'bg-indigo-500 text-white hover:bg-indigo-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'In Transit' ? '✅ Transit' : '🚛 Transit'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Arrived Delivery');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Arrived Delivery' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Arrived Delivery'
                                        ? 'bg-orange-200 text-orange-400 cursor-not-allowed'
                                        : 'bg-orange-500 text-white hover:bg-orange-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Arrived Delivery' ? '✅ Arr DEL' : '📍 Arr DEL'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Delivered');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Delivered' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Delivered'
                                        ? 'bg-yellow-200 text-yellow-400 cursor-not-allowed'
                                        : 'bg-yellow-500 text-white hover:bg-yellow-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Delivered' ? '✅ Delivered' : '✅ Deliver'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Heading to Yard');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Heading to Yard' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Heading to Yard'
                                        ? 'bg-purple-200 text-purple-400 cursor-not-allowed'
                                        : 'bg-purple-500 text-white hover:bg-purple-600'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Heading to Yard' ? '✅ Yard' : '🏁 Yard'}
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpdatingLoad(load.loadId);
                                      handleUpdateLegStatus(load.loadId, driver.name, driver.truckNo, 'Completed');
                                      setTimeout(() => setUpdatingLoad(null), 2000);
                                    }}
                                    disabled={load.status === 'Completed' || updatingLoad === load.loadId}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                      load.status === 'Completed'
                                        ? 'bg-green-200 text-green-400 cursor-not-allowed'
                                        : 'bg-green-600 text-white hover:bg-green-700'
                                    } disabled:opacity-50`}
                                  >
                                    {load.status === 'Completed' ? '✅ Done' : '✅ Complete'}
                                  </button>
                                </div>
                              </div>
                            )}
                            
                            {/* Driver & Truck */}
                            <div className="flex items-center justify-between mb-3 p-2 bg-slate-50 rounded-lg">
                              <div className="flex items-center gap-1 text-xs">
                                <User className="w-3 h-3 text-slate-400" />
                                <span className="font-bold text-slate-700">{driver.name}</span>
                              </div>
                              <div className="flex items-center gap-1 text-xs">
                                <Truck className="w-3 h-3 text-slate-400" />
                                <span className="text-slate-600">{driver.truckNo || 'N/A'}</span>
                              </div>
                            </div>
                            
                            {/* Quick Actions */}
                            <div className="flex gap-2 mb-3">
                              {driver.phone && (
                                <a href={`tel:${driver.phone}`}
                                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg text-green-700 font-bold text-[10px] transition-colors">
                                  <Phone className="w-3 h-3" />
                                  Call
                                </a>
                              )}
                              {driver.phone && (
                                <a href={`sms:${driver.phone}`}
                                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-blue-700 font-bold text-[10px] transition-colors">
                                  <MessageSquare className="w-3 h-3" />
                                  Text
                                </a>
                              )}
                              {driver.lat && driver.lng && (
                                <a href={`https://www.google.com/maps?q=${driver.lat},${driver.lng}`} 
                                  target="_blank" rel="noreferrer"
                                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-purple-700 font-bold text-[10px] transition-colors">
                                  <Navigation className="w-3 h-3" />
                                  Map
                                </a>
                              )}
                            </div>
                            
                            {/* POD Button */}
                            {driver.podPhotoUrl && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onViewPOD && onViewPOD(driver.podPhotoUrl); }}
                                className="w-full py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-blue-700 font-bold text-[10px] flex items-center justify-center gap-1 transition-colors mb-2">
                                <Eye size={12} />
                                View POD
                              </button>
                            )}
                            
                            {/* EIR Button */}
                            {driver.eirPhotoUrl && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onViewPOD && onViewPOD(driver.eirPhotoUrl); }}
                                className="w-full py-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-purple-700 font-bold text-[10px] flex items-center justify-center gap-1 transition-colors mb-2">
                                <Eye size={12} />
                                View EIR
                              </button>
                            )}
                            
                            {/* GPS Status */}
                            <div className="flex items-center gap-2 text-[10px]">
                              <div className={`w-1.5 h-1.5 rounded-full ${driver.isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                              <span className="text-slate-400">{driver.isTracking ? '📍 GPS Active' : '📍 GPS Offline'}</span>
                            </div>
                          </div>
                          
                          {/* EXPANDED TIMELINE */}
                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-slate-50/50 rounded-b-2xl p-4 animate-in slide-in-from-top-2">
                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Trip Timeline</h4>
                              <div className="space-y-3">
                                {driver.tripStartedAt && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <Activity className="w-3 h-3 text-blue-600" />
                                    </div>
                                    <div>
                                      <div className="text-[10px] font-bold text-slate-700">Trip Started</div>
                                      <div className="text-[9px] text-slate-500">{driver.tripStartedAt}</div>
                                    </div>
                                  </div>
                                )}
                                {driver.podPhotoUrl && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <CheckCircle className="w-3 h-3 text-green-600" />
                                    </div>
                                    <div>
                                      <div className="text-[10px] font-bold text-slate-700">POD Submitted</div>
                                      <div className="text-[9px] text-slate-500">{driver.podReceiverName || 'Completed'}</div>
                                    </div>
                                  </div>
                                )}
                                {!driver.tripStartedAt && (
                                  <div className="flex items-center gap-3 text-slate-400">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-[10px] italic">⏳ Waiting to start trip</span>
                                  </div>
                                )}
                              </div>
                              
                              {onResetDriver && (
                                <div className="flex justify-end mt-3 pt-3 border-t border-slate-200">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm(`Reset ${driver.name}'s status to Idle?`)) {
                                        onResetDriver(driver.id);
                                      }
                                    }}
                                    className="text-[9px] px-3 py-1.5 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-lg transition-colors border border-slate-200 hover:border-red-300 font-bold">
                                    🔄 Reset Status
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default DriverActivityBoard;