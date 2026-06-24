// components/DriverActivityBoard.jsx
import React, { useState, useEffect } from 'react';
import { Truck, Hash, Package } from 'lucide-react';
import { getFirestore, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';

// ========== FIREBASE CONFIG ==========
const firebaseConfig = {
  apiKey: "AIzaSyAuFs4eLaP8Pug6RSde07OXu_mofd0IfYs",
  authDomain: "haulix-tms.firebaseapp.com",
  projectId: "haulix-tms",
  storageBucket: "haulix-tms.firebasestorage.app",
  messagingSenderId: "864718858606",
  appId: "1:864718858606:web:ea068d9ea1a5cdacb9f97f"
};

const getFirebaseServices = () => {
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  if (!root.__HAULIX_FIREBASE__) {
    const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    root.__HAULIX_FIREBASE__ = {
      app: firebaseApp,
      db: getFirestore(firebaseApp)
    };
  }
  return root.__HAULIX_FIREBASE__;
};

const { db } = getFirebaseServices();

const DriverActivityBoard = ({ drivers, companyId, onViewPOD, onResetDriver }) => {
  const [driverLoads, setDriverLoads] = useState({});

  // ========== FETCH LOADS FOR ALL DRIVERS ==========
  useEffect(() => {
    if (!companyId || !drivers || drivers.length === 0) return;

    const fetchAllDriverLoads = async () => {
      try {
        const q = query(
          collection(db, 'companies', companyId, 'loads'),
          where('status', '==', 'Open'),
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
                loadsData[key] = {
                  containerNo: load.containerNo || 'N/A',
                  workOrderNo: load.workOrderNo || 'N/A',
                  customerName: load.customerName || 'N/A',
                  loadId: load.id
                };
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

  // ========== GET LOAD FOR A DRIVER ==========
  const getDriverLoad = (driver) => {
    if (!driver) return null;
    
    // ✅ FIRST: Check if driver has currentContainerNo directly
    if (driver.currentContainerNo) {
      return {
        containerNo: driver.currentContainerNo,
        workOrderNo: driver.currentWorkOrderNo || 'N/A',
        customerName: driver.currentCustomerName || 'N/A',
        loadId: driver.currentLoadId || null
      };
    }
    
    // THEN: Check by name or truck number
    if (driver.name && driverLoads[driver.name]) {
      return driverLoads[driver.name];
    }
    
    if (driver.truckNo && driverLoads[driver.truckNo]) {
      return driverLoads[driver.truckNo];
    }
    
    return null;
  };

  const isDriverActive = (driver) => {
    const status = driver.tripStatus || 'Idle';
    return status !== 'Idle' && status !== 'Completed';
  };

  return (
    <div className="animate-in fade-in p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black text-slate-900">🚛 Driver Status Board</h2>
        <span className="text-xs font-bold text-slate-400">
          {drivers.filter(d => isDriverActive(d)).length} Active / {drivers.length} Total
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drivers.map(driver => {
          const status = driver.tripStatus || 'Idle';
          const isActive = isDriverActive(driver);
          const assignedLoad = getDriverLoad(driver);
          
          return (
            <div key={driver.id} 
              className={`bg-white rounded-2xl p-5 shadow-sm border transition-all hover:shadow-md ${
                status === 'Completed' ? 'border-green-200 bg-green-50/30' :
                isActive ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200'
              }`}
            >
              {/* Driver Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-lg ${
                  isActive ? 'bg-blue-500' : 
                  status === 'Completed' ? 'bg-green-500' : 'bg-slate-400'
                }`}>
                  {driver.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-900 truncate">{driver.name}</div>
                  <div className="text-xs text-slate-400">{driver.truckNo}</div>
                </div>
                <span className={`text-[10px] font-black px-2 py-1 rounded-full whitespace-nowrap ${
                  status === 'Completed' ? 'bg-green-100 text-green-700' :
                  isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {status}
                </span>
              </div>
              
              {/* ✅ ASSIGNED LOAD WITH CONTAINER NUMBER */}
              {assignedLoad && (
                <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-700">
                    <Hash className="w-3.5 h-3.5" />
                    <span>Container: {assignedLoad.containerNo}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-blue-600 mt-1">
                    <Package className="w-3 h-3" />
                    <span>WO: {assignedLoad.workOrderNo}</span>
                    <span className="text-blue-300">|</span>
                    <span className="truncate">{assignedLoad.customerName}</span>
                  </div>
                </div>
              )}
              
              {/* GPS Status */}
              <div className="flex items-center gap-2 text-xs mb-3">
                <div className={`w-2 h-2 rounded-full ${driver.isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                <span className="text-slate-500">{driver.isTracking ? '📍 GPS Active' : '📍 GPS Offline'}</span>
                {driver.lat && driver.lng && (
                  <a href={`https://www.google.com/maps?q=${driver.lat},${driver.lng}`} target="_blank" rel="noreferrer"
                    className="ml-auto text-blue-600 text-[10px] font-bold hover:underline">View Map</a>
                )}
              </div>
              
              {/* Reset Status Button */}
              {onResetDriver && (
                <div className="flex justify-end mb-2">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Reset ${driver.name}'s status to Idle? This will clear all trip data.`)) {
                        onResetDriver(driver.id);
                      }
                    }}
                    className="text-[9px] px-2 py-1 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-lg transition-colors border border-slate-200 hover:border-red-300"
                    title="Reset driver status (use when dispatch is reassigned)"
                  >
                    🔄 Reset Status
                  </button>
                </div>
              )}

              {/* Timeline */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-[10px]">
                {driver.tripStartedAt && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span className="text-slate-600">Started: {driver.tripStartedAt}</span>
                  </div>
                )}
                {!driver.tripStartedAt && (
                  <div className="text-slate-400 italic">⏳ Waiting to start</div>
                )}
              </div>
            </div>
          );
        })}
        {drivers.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-200">
            <Truck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="font-bold">No drivers added yet</p>
            <p className="text-xs mt-1">Add drivers in the Database tab</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverActivityBoard;