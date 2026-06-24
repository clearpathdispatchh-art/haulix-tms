// DriverApp.jsx - COMPLETE FIXED VERSION

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp, getApp, getApps } from "firebase/app";
import { 
  getFirestore,
  collection, query, where, getDocs, onSnapshot, doc, updateDoc, getDoc, 
  addDoc, orderBy, limit, enableNetwork, disableNetwork,
} from 'firebase/firestore';
import { 
  getStorage, ref, uploadBytes, getDownloadURL 
} from 'firebase/storage';
import { 
  Truck, MapPin, Clock, CheckCircle, RefreshCw, LogOut, User, 
  ChevronRight, Navigation, ArrowRight, X,
  Building, AlertCircle, Play, Flag, MapPinCheck,
  TruckIcon, Loader2, Camera, Moon, Sun, MessageCircle,
  AlertTriangle, PhoneCall, MessageSquare,
  Search, Lock, Key, Eye, FileDown, Upload, EyeOff, Wifi, WifiOff,
  Package, Home, Layers, Navigation2, Send, PenTool, Phone,
  DollarSign
} from 'lucide-react';

// ========== FIREBASE CONFIG ==========
const firebaseConfig = {
  apiKey: "AIzaSyAuFs4eLaP8Pug6RSde07OXu_mofd0IfYs",
  authDomain: "haulix-tms.firebaseapp.com",
  projectId: "haulix-tms",
  storageBucket: "haulix-tms.firebasestorage.app",
  messagingSenderId: "864718858606",
  appId: "1:864718858606:web:ea068d9ea1a5cdacb9f97f"
};

// Initialize Firebase ONCE
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// ========== OFFLINE PERSISTENCE ==========
try {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') console.warn('Offline already enabled');
    else if (err.code === 'unimplemented') console.warn('Browser does not support offline');
  });
} catch (e) { console.warn('Offline persistence not available'); }

// ========== CONSTANTS ==========
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STATUS_UPDATE_COOLDOWN_MS = 3000;
const MAX_COMPANIES_LOAD = 100;
const EMERGENCY_NUMBER = '911';
const FEEDBACK_DURATION_MS = 4000;

// ========== STATUS FLOW ==========
const LEG_STATUS_FLOW = {
  'Pending': ['Started'],
  'Started': ['Arrived Pickup'],
  'Arrived Pickup': ['Loaded'],
  'Loaded': ['In Transit'],
  'In Transit': ['Arrived Delivery'],
  'Arrived Delivery': ['Delivered'],
  'Delivered': ['POD Uploaded'],
  'POD Uploaded': ['Heading to Yard'],
  'Heading to Yard': ['Arrived Yard'],
  'Arrived Yard': ['Completed']
};

// ========== LEG TYPES ==========
const getLegTypeLabel = (type) => {
  switch(type) {
    case 'pickup': return '📦 Pickup';
    case 'delivery': return '🚚 Delivery';
    case 'termination': return '🏁 Termination';
    default: return '📍 Leg';
  }
};

const getLegTypeColor = (type) => {
  switch(type) {
    case 'pickup': return 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300';
    case 'delivery': return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
    case 'termination': return 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300';
    default: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
  }
};

// ========== HELPERS ==========
const formatLocation = (location) => {
  if (!location) return 'N/A';
  return location.split(' - ')[0];
};

const getStatusColor = (status) => {
  switch (status) {
    case 'Completed': case 'Delivered': return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
    case 'Arrived': case 'Arrived Pickup': case 'Arrived Delivery': case 'Arrived Yard':
      return 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300';
    case 'Started': return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300';
    case 'Loaded': return 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300';
    case 'In Transit': return 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300';
    case 'POD Uploaded': return 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300';
    case 'Heading to Yard': return 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300';
    default: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
  }
};

const compressImage = async (file, maxWidth = 1200) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => img.src = e.target.result;
    reader.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Compression failed'));
      }, 'image/jpeg', 0.7);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const logError = (context, error, metadata = {}) => {
  console.error(`[DriverApp][${context}]`, {
    message: error?.message || error,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

// ========== SIGNATURE PAD ==========
function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    const resize = () => {
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.parentElement.clientWidth, h = 200;
      canvas.width = w * ratio; canvas.height = h * ratio;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(1,0,0,1,0,0); ctx.scale(ratio,ratio);
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const getCoordinates = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (e.touches?.[0]) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath(); ctx.moveTo(x, y);
    setIsDrawing(true); setHasDrawn(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y); ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) { canvasRef.current?.getContext('2d').closePath(); setIsDrawing(false); }
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasDrawn(false);
  };

  return (
    <div className="space-y-3">
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-900 relative overflow-hidden touch-none" style={{ height: 200 }}>
        {!hasDrawn && <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none text-sm">Sign here</div>}
        <canvas ref={canvasRef} className="w-full h-full cursor-crosshair touch-none"
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} />
      </div>
      <div className="flex gap-3">
        <button onClick={clearCanvas} className="flex-1 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-100 dark:hover:bg-gray-800">Clear</button>
        <button onClick={() => { if (hasDrawn && onSave) onSave(canvasRef.current.toDataURL('image/png')); }} disabled={!hasDrawn}
          className={`flex-1 py-3 rounded-xl font-bold text-white ${hasDrawn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'}`}>
          Submit Signature
        </button>
        {onCancel && <button onClick={onCancel} className="px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-xl font-bold text-sm">Cancel</button>}
      </div>
    </div>
  );
}

// ========== CHAT MODAL ==========
function ChatModal({ isOpen, onClose, partnerName, messages, onSend }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (isOpen) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4">
      <div className="w-full sm:w-[400px] bg-white dark:bg-slate-800 sm:rounded-2xl flex flex-col shadow-2xl max-h-[80vh] sm:max-h-[600px]">
        <div className="bg-blue-600 text-white p-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <MessageSquare size={20} />
            <div>
              <h3 className="font-bold text-sm">{partnerName}</h3>
              <span className="text-[10px] text-blue-200">Online</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <div className="text-center text-gray-400 text-sm mt-10">No messages yet</div>}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col w-fit max-w-[85%] ${m.sender === 'driver' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
              <div className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm ${m.sender === 'driver' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white'}`}>
                {m.text}
              </div>
              <span className="text-[10px] text-gray-400 mt-1 px-1">
                {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="p-3 border-t dark:border-gray-700">
          <div className="flex gap-2">
            <input type="text" value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSend(text.trim()); setText(''); } }}
              placeholder="Type a message..." className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl text-sm outline-none" />
            <button onClick={() => { onSend(text.trim()); setText(''); }} disabled={!text.trim()}
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50"><Send size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== MAIN DRIVER APP ==========
const DriverApp = () => {
  // Auth state
  const [driverProfile, setDriverProfile] = useState(null);
  const [companyInfo, setCompanyInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Data state
  const [assignedLoads, setAssignedLoads] = useState([]);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [selectedLeg, setSelectedLeg] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [updating, setUpdating] = useState(false);
  
  // UI state
  const [showPODModal, setShowPODModal] = useState(false);
  const [podData, setPodData] = useState({ photo: null, receiverName: '', legId: null });
  const [darkMode, setDarkMode] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  
  // Track which buttons have been clicked per leg
  const [clickedButtons, setClickedButtons] = useState({});
  
  // POD state
  const [showPODViewer, setShowPODViewer] = useState(false);
  const [selectedPODLoad, setSelectedPODLoad] = useState(null);
  
  // Communication state
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Pay state
  const [driverPay, setDriverPay] = useState(0);
  const [payHistory, setPayHistory] = useState([]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  
  // GPS state
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [distanceToDest, setDistanceToDest] = useState(null);
  const watchIdRef = useRef(null);
  
  // Login state
  const [loginStep, setLoginStep] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companySearch, setCompanySearch] = useState('');
  const [loginError, setLoginError] = useState('');
  const [availableDrivers, setAvailableDrivers] = useState([]);
  
  // Network state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Refs
  const listenersRef = useRef({});
  const isMountedRef = useRef(true);
  const lastStatusUpdateRef = useRef(0);
  const feedbackTimerRef = useRef(null);

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Dark mode
  useEffect(() => {
    const saved = localStorage.getItem('driverDarkMode');
    if (saved === 'true') { setDarkMode(true); document.documentElement.classList.add('dark'); }
  }, []);

  // Network monitoring
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); enableNetwork(db).catch(console.warn); };
    const handleOffline = () => { setIsOnline(false); disableNetwork(db).catch(console.warn); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, [db]);

  // GPS Tracking
  const startGPSTracking = useCallback(() => {
    if (!navigator.geolocation) return;
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    
    setIsTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: Date.now() };
        setCurrentLocation(loc);
        if (driverProfile?.driverId && db) {
          const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
          updateDoc(driverRef, { lat: loc.lat, lng: loc.lng, lastUpdated: Date.now(), isTracking: true }).catch(() => {});
        }
      },
      (err) => console.warn('GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, [driverProfile, db]);

  const stopGPSTracking = useCallback(() => {
    if (watchIdRef.current) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    setIsTracking(false);
    if (driverProfile?.driverId && db) {
      const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
      updateDoc(driverRef, { isTracking: false }).catch(() => {});
    }
  }, [driverProfile, db]);

  useEffect(() => {
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, []);

  // Load companies
  useEffect(() => {
    if (!db) return;
    const loadCompanies = async () => {
      try {
        const q = query(collection(db, 'companies'), orderBy('name'), limit(MAX_COMPANIES_LOAD));
        const snap = await getDocs(q);
        if (isMountedRef.current) {
          const companyList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setCompanies(companyList);
        }
      } catch (e) { logError('loadCompanies', e); }
    };
    loadCompanies();
  }, [db]);

  // Check session
  useEffect(() => {
    const saved = localStorage.getItem('driverSession');
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (Date.now() - session.timestamp > SESSION_EXPIRY_MS) { localStorage.removeItem('driverSession'); setLoading(false); return; }
        handleAutoLogin(session);
      } catch { localStorage.removeItem('driverSession'); setLoading(false); }
    } else { setLoading(false); }
  }, []);

  const handleAutoLogin = async (session) => {
    if (!db) return;
    try {
      const driverDoc = await getDoc(doc(db, 'companies', session.companyId, 'drivers', session.driverId));
      if (driverDoc.exists() && isMountedRef.current) {
        const d = driverDoc.data();
        setDriverProfile({ driverId: session.driverId, companyId: session.companyId, name: d.name, truckNo: d.truckNo });
        const cDoc = await getDoc(doc(db, 'companies', session.companyId));
        if (cDoc.exists()) setCompanyInfo(cDoc.data());
        startGPSTracking();
        setLoading(false); return;
      }
    } catch (e) { logError('autoLogin', e); }
    localStorage.removeItem('driverSession'); setLoading(false);
  };

  // Load drivers for selected company
  useEffect(() => {
    if (!selectedCompany || !db) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'companies', selectedCompany.id, 'drivers'));
        if (isMountedRef.current) setAvailableDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { logError('loadDrivers', e); }
    })();
  }, [selectedCompany, db]);

  // Fetch loads
  useEffect(() => {
    if (!driverProfile?.companyId || !db) return;
    if (listenersRef.current.loads) listenersRef.current.loads();
    
    const q = query(collection(db, 'companies', driverProfile.companyId, 'loads'), orderBy('updatedAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      if (!isMountedRef.current) return;
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const assigned = all.filter(l => (l.legs || []).some(leg => leg.truckNo === driverProfile.truckNo));
      setAssignedLoads(assigned);
      
      // If no loads assigned, reset driver status
      if (assigned.length === 0 && driverProfile.tripStatus && driverProfile.tripStatus !== 'Idle') {
        const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
        updateDoc(driverRef, {
          tripStatus: 'Idle',
          tripStartedAt: null,
          arrivedPickupAt: null,
          loadedAt: null,
          inTransitAt: null,
          arrivedDeliveryAt: null,
          deliveredAt: null,
          podUploadedAt: null,
          headingToYardAt: null,
          arrivedYardAt: null,
          completedAt: null,
          podPhotoUrl: null,
          receiverName: null,
          lastTripUpdate: new Date().toISOString()
        }).catch(() => {});
      }
    }, (error) => logError('loadsListener', error));
    
    listenersRef.current.loads = unsub;
    return () => { if (listenersRef.current.loads) { listenersRef.current.loads(); listenersRef.current.loads = null; } };
  }, [driverProfile?.companyId, db]);

  // Messages listener
  useEffect(() => {
    if (!driverProfile?.driverId || !db) return;
    const q = query(collection(db, 'companies', driverProfile.companyId, 'messages'), where('driverId', '==', driverProfile.driverId), orderBy('timestamp', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);
      setUnreadMessages(msgs.filter(m => !m.read).length);
    });
    return () => unsub();
  }, [driverProfile?.driverId, db]);

  // ========== LEG HELPERS ==========
  const getDriverLegs = useCallback((load) => {
    if (!load?.legs || !driverProfile?.truckNo) return [];
    return load.legs.filter(leg => leg.truckNo === driverProfile.truckNo);
  }, [driverProfile?.truckNo]);

  const getNextIncompleteLeg = useCallback((load) => {
    const legs = getDriverLegs(load).sort((a, b) => (a.legOrder || 0) - (b.legOrder || 0));
    return legs.find(leg => { 
      const s = leg.tripStatus || leg.status || 'Pending'; 
      return s !== 'Completed' && s !== 'Delivered'; 
    }) || null;
  }, [getDriverLegs]);

  const activeLoads = useMemo(() => {
    return assignedLoads.filter(l => {
      const legs = getDriverLegs(l);
      return legs.some(leg => { 
        const s = leg.tripStatus || leg.status || 'Pending'; 
        return s !== 'Completed' && s !== 'Delivered'; 
      });
    });
  }, [assignedLoads, getDriverLegs]);

  const completedLoads = useMemo(() => {
    return assignedLoads.filter(l => { 
      const legs = getDriverLegs(l); 
      return legs.length > 0 && legs.every(leg => { 
        const s = leg.tripStatus || leg.status || 'Pending'; 
        return s === 'Completed' || s === 'Delivered'; 
      }); 
    });
  }, [assignedLoads, getDriverLegs]);

  const areAllLegsComplete = useCallback((load) => {
    const legs = getDriverLegs(load);
    if (legs.length === 0) return false;
    return legs.every(leg => {
      const s = leg.tripStatus || leg.status || 'Pending';
      return s === 'Completed' || s === 'Delivered';
    });
  }, [getDriverLegs]);

  // ========== PAY TRACKING FUNCTIONS ==========
  const calculateDriverPay = useCallback((load) => {
    if (!load?.legs) return 0;
    let total = 0;
    const driverLegs = getDriverLegs(load);
    driverLegs.forEach(leg => {
      if (leg.driverPay) {
        total += parseFloat(leg.driverPay) || 0;
      } else {
        total += 50;
      }
    });
    return total;
  }, [getDriverLegs]);

  const calculateTotalEarnings = useCallback(() => {
    let total = 0;
    assignedLoads.forEach(load => {
      const legs = getDriverLegs(load);
      legs.forEach(leg => {
        if (leg.driverPay) total += parseFloat(leg.driverPay) || 0;
        else total += 50;
      });
    });
    return total;
  }, [assignedLoads, getDriverLegs]);

  const calculatePendingPayments = useCallback(() => {
    let total = 0;
    assignedLoads.forEach(load => {
      const legs = getDriverLegs(load);
      legs.forEach(leg => {
        const status = leg.tripStatus || leg.status || 'Pending';
        if (status !== 'Completed' && status !== 'Delivered') {
          if (leg.driverPay) total += parseFloat(leg.driverPay) || 0;
          else total += 50;
        }
      });
    });
    return total;
  }, [assignedLoads, getDriverLegs]);

  // Update pay when loads change
  useEffect(() => {
    const earnings = calculateTotalEarnings();
    const pending = calculatePendingPayments();
    setTotalEarnings(earnings);
    setPendingPayments(pending);
  }, [assignedLoads, calculateTotalEarnings, calculatePendingPayments]);

  // Cleanup
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; stopGPSTracking(); }; }, []);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => { if (isMountedRef.current) setFeedback(''); }, FEEDBACK_DURATION_MS);
  }, [feedback]);

  // Login handlers
  const handleCompanySelect = (company) => { 
    setSelectedCompany(company); 
    setLoginError(''); 
  };

  const handleDriverSelect = (driver) => {
    setDriverProfile({ 
      driverId: driver.id, 
      companyId: selectedCompany.id, 
      name: driver.name, 
      truckNo: driver.truckNo 
    });
    setCompanyInfo(selectedCompany);
    localStorage.setItem('driverSession', JSON.stringify({ 
      companyId: selectedCompany.id, 
      driverId: driver.id, 
      timestamp: Date.now() 
    }));
    startGPSTracking();
  };

  const handleSignOut = () => {
    stopGPSTracking();
    localStorage.removeItem('driverSession');
    setDriverProfile(null); 
    setCompanyInfo(null); 
    setAssignedLoads([]); 
    setSelectedLoad(null);
    setSelectedCompany(null);
  };

  const toggleDarkMode = () => {
    const newMode = !darkMode; 
    setDarkMode(newMode);
    localStorage.setItem('driverDarkMode', String(newMode));
    if (newMode) document.documentElement.classList.add('dark'); 
    else document.documentElement.classList.remove('dark');
  };

  // ========== UPDATE DRIVER STATUS ==========
  const handleUpdateDriverStatus = async (newStatus, legId) => {
    if (!db || !driverProfile) {
      setFeedback('❌ Not authenticated');
      return;
    }
    
    let targetLeg = null;
    let targetLoad = selectedLoad;
    
    if (legId && targetLoad) {
      targetLeg = targetLoad.legs.find(l => l.id === legId);
    } else if (selectedLeg) {
      targetLeg = selectedLeg;
    } else {
      if (targetLoad) {
        const legs = getDriverLegs(targetLoad);
        targetLeg = legs.find(l => {
          const s = l.tripStatus || l.status || 'Pending';
          return s !== 'Completed' && s !== 'Delivered';
        });
        if (targetLeg) setSelectedLeg(targetLeg);
      }
    }
    
    if (!targetLeg) {
      setFeedback('❌ No leg selected. Please select a leg first.');
      return;
    }
    
    if (!selectedLeg) setSelectedLeg(targetLeg);
    
    const now = Date.now();
    if (now - lastStatusUpdateRef.current < STATUS_UPDATE_COOLDOWN_MS) { 
      setFeedback('⏳ Please wait 3 seconds before updating again'); 
      return; 
    }
    
    const buttonKey = `${targetLoad.id}-${targetLeg.id}-${newStatus}`;
    if (clickedButtons[buttonKey]) {
      setFeedback('⏳ This status has already been updated');
      return;
    }
    
    lastStatusUpdateRef.current = now; 
    setUpdating(true);
    setFeedback(`⏳ Updating Leg ${targetLeg.legOrder || 1} to "${newStatus}"...`);
    
    try {
      const loadRef = doc(db, 'companies', driverProfile.companyId, 'loads', targetLoad.id);
      const loadSnap = await getDoc(loadRef);
      if (!loadSnap.exists()) {
        setFeedback('❌ Load not found');
        return;
      }
      
      const loadData = loadSnap.data();
      const legs = loadData.legs || [];
      const timeStr = new Date().toLocaleTimeString();
      
      const updatedLegs = legs.map(leg => {
        if (leg.id !== targetLeg.id) return leg;
        
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
      });
      
      await updateDoc(loadRef, { 
        legs: updatedLegs,
        updatedAt: new Date().toISOString()
      });
      
      const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
      const driverUpdates = {
        tripStatus: newStatus,
        lastTripUpdate: new Date().toISOString(),
      };
      if (currentLocation) {
        driverUpdates.lat = currentLocation.lat;
        driverUpdates.lng = currentLocation.lng;
        driverUpdates.lastUpdated = now;
      }
      await updateDoc(driverRef, driverUpdates);
      
      setClickedButtons(prev => ({ ...prev, [buttonKey]: true }));
      
      setSelectedLoad(prev => {
        if (!prev) return prev;
        const newLegs = prev.legs.map(leg => {
          if (leg.id !== targetLeg.id) return leg;
          const updatedLeg = { ...leg, tripStatus: newStatus, status: newStatus };
          const timeStr2 = new Date().toLocaleTimeString();
          if (newStatus === 'Started') updatedLeg.startedAt = timeStr2;
          if (newStatus === 'Arrived Pickup') updatedLeg.arrivedPickupAt = timeStr2;
          if (newStatus === 'Loaded') updatedLeg.loadedAt = timeStr2;
          if (newStatus === 'In Transit') updatedLeg.inTransitAt = timeStr2;
          if (newStatus === 'Arrived Delivery') updatedLeg.arrivedDeliveryAt = timeStr2;
          if (newStatus === 'Delivered') updatedLeg.deliveredAt = timeStr2;
          if (newStatus === 'POD Uploaded') updatedLeg.podUploadedAt = timeStr2;
          if (newStatus === 'Heading to Yard') updatedLeg.headingToYardAt = timeStr2;
          if (newStatus === 'Arrived Yard') updatedLeg.arrivedYardAt = timeStr2;
          if (newStatus === 'Completed') updatedLeg.completedAt = timeStr2;
          return updatedLeg;
        });
        return { ...prev, legs: newLegs };
      });
      
      setFeedback(`✅ ${newStatus} for Leg ${targetLeg.legOrder || 1}`);
      setShowPODModal(false); 
      setPodData({ photo: null, receiverName: '', legId: null });
      
      const allComplete = updatedLegs.every(leg => {
        const s = leg.tripStatus || leg.status || 'Pending';
        return s === 'Completed' || s === 'Delivered';
      });
      if (allComplete && updatedLegs.length >= 2) {
        setFeedback('🎉 Both legs complete! Dispatch closed for today.');
        setTimeout(() => {
          setSelectedLoad(null);
          setSelectedLeg(null);
        }, 3000);
      }
      
    } catch (error) { 
      logError('updateDriverStatus', error);
      setFeedback('❌ Update failed: ' + (error.message || 'Unknown error')); 
    }
    finally { setUpdating(false); }
  };

  // POD handlers
  const handlePODPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const reader = new FileReader();
      reader.onloadend = () => { 
        if (isMountedRef.current) setPodData(prev => ({ ...prev, photo: reader.result })); 
      };
      reader.readAsDataURL(compressed);
    } catch (error) { 
      logError('handlePODPhoto', error); 
      setFeedback('Failed to process photo'); 
    }
  };

  const handlePODSubmit = async () => {
    if (!podData.legId) { setFeedback('❌ No leg selected'); return; }
    if (!podData.receiverName.trim()) { setFeedback('❌ Please enter receiver name'); return; }
    if (!selectedLoad) { setFeedback('❌ No load selected'); return; }
    
    setUpdating(true);
    try {
      let photoUrl = null;
      if (podData.photo) {
        const blob = await fetch(podData.photo).then(r => r.blob());
        const path = `pod/${driverProfile.companyId}/${selectedLoad.id}/${podData.legId}/${Date.now()}.jpg`;
        const photoRef = ref(storage, path);
        await uploadBytes(photoRef, blob);
        photoUrl = await getDownloadURL(photoRef);
      }
      
      const loadRef = doc(db, 'companies', driverProfile.companyId, 'loads', selectedLoad.id);
      const loadSnap = await getDoc(loadRef);
      if (!loadSnap.exists()) {
        setFeedback('❌ Load not found');
        return;
      }
      
      const loadData = loadSnap.data();
      const legs = loadData.legs || [];
      
      const updatedLegs = legs.map(leg => {
        if (leg.id !== podData.legId) return leg;
        return {
          ...leg,
          receiverName: podData.receiverName.trim(),
          podPhotoUrl: photoUrl,
          tripStatus: 'POD Uploaded',
          status: 'POD Uploaded',
          podUploadedAt: new Date().toLocaleTimeString()
        };
      });
      
      await updateDoc(loadRef, { 
        legs: updatedLegs,
        updatedAt: new Date().toISOString()
      });
      
      const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
      await updateDoc(driverRef, { 
        receiverName: podData.receiverName.trim(), 
        podPhotoUrl: photoUrl,
        tripStatus: 'POD Uploaded',
        podUploadedAt: new Date().toLocaleTimeString()
      });
      
      const buttonKey = `${selectedLoad.id}-${podData.legId}-POD`;
      setClickedButtons(prev => ({ ...prev, [buttonKey]: true }));
      
      setSelectedLoad(prev => {
        if (!prev) return prev;
        const newLegs = prev.legs.map(leg => {
          if (leg.id !== podData.legId) return leg;
          return {
            ...leg,
            receiverName: podData.receiverName.trim(),
            podPhotoUrl: photoUrl,
            tripStatus: 'POD Uploaded',
            status: 'POD Uploaded',
            podUploadedAt: new Date().toLocaleTimeString()
          };
        });
        return { ...prev, legs: newLegs };
      });
      
      setFeedback(`✅ POD Uploaded for Leg ${selectedLeg?.legOrder || 1}`);
      setShowPODModal(false); 
      setPodData({ photo: null, receiverName: '', legId: null });
      
    } catch (error) { 
      logError('handlePODSubmit', error);
      setFeedback('❌ Upload failed: ' + (error.message || 'Unknown error')); 
    }
    finally { setUpdating(false); }
  };

  const handleSignatureSubmit = async (sigDataUrl) => {
    if (!selectedLeg || !selectedLoad) return;
    
    setUpdating(true);
    try {
      const blob = await fetch(sigDataUrl).then(r => r.blob());
      const path = `signatures/${driverProfile.companyId}/${selectedLoad.id}/${selectedLeg.id}/${Date.now()}.png`;
      const sigRef = ref(storage, path);
      await uploadBytes(sigRef, blob);
      const url = await getDownloadURL(sigRef);
      
      await handleUpdateDriverStatus('Completed', selectedLeg.id);
      
      const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
      await updateDoc(driverRef, { signature: url });
      setShowSignaturePad(false);
      
    } catch (error) { 
      logError('handleSignatureSubmit', error);
      setFeedback('Signature upload failed'); 
    }
    finally { setUpdating(false); }
  };

  const sendMessage = async (text) => {
    if (!text || !db || !driverProfile) return;
    try {
      await addDoc(collection(db, 'companies', driverProfile.companyId, 'messages'), {
        driverId: driverProfile.driverId,
        text,
        sender: 'driver',
        timestamp: Date.now(),
        read: false
      });
    } catch (error) { logError('sendMessage', error); }
  };

  // Filtered companies
  const filteredCompanies = useMemo(() => {
    if (!companySearch) return companies;
    const search = companySearch.toLowerCase();
    return companies.filter(c => 
      (c.name || '').toLowerCase().includes(search) ||
      (c.address || '').toLowerCase().includes(search)
    );
  }, [companies, companySearch]);

  // Check if button is clicked
  const isButtonClicked = (legId, status) => {
    if (!selectedLoad) return false;
    const key = `${selectedLoad.id}-${legId}-${status}`;
    return !!clickedButtons[key];
  };

  // ========== LOADING ==========
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // ========== LOGIN SCREEN ==========
  if (!driverProfile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 max-w-md w-full">
          <div className={`flex items-center justify-center gap-2 mb-4 text-xs font-bold ${isOnline ? 'text-green-600' : 'text-red-600'}`}>
            {isOnline ? <><Wifi className="w-4 h-4" /> Online</> : <><WifiOff className="w-4 h-4" /> Offline</>}
          </div>
          
          {!selectedCompany ? (
            <>
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Truck className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                </div>
                <h1 className="text-2xl font-black text-slate-800 dark:text-white">Driver Portal</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Enter your company name</p>
              </div>
              
              {loginError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4 text-center">{loginError}</div>
              )}
              
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  value={companySearch} 
                  onChange={(e) => setCompanySearch(e.target.value)} 
                  placeholder="e.g. Acme Logistics" 
                  className="w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white" 
                  autoFocus
                />
              </div>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredCompanies.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-8">No companies found</p>
                ) : (
                  filteredCompanies.map(company => (
                    <button key={company.id} onClick={() => handleCompanySelect(company)} 
                      className="w-full text-left p-4 bg-slate-50 dark:bg-slate-900/50 hover:bg-blue-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Building className="w-5 h-5 text-blue-600" />
                        <span className="font-bold">{company.name}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-center mb-6">
                <button onClick={() => setSelectedCompany(null)} className="text-sm text-blue-600 mb-4 block">← Change Company</button>
                <h2 className="text-xl font-black">{selectedCompany.name}</h2>
                <p className="text-slate-500 text-sm">Select your name</p>
              </div>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableDrivers.length === 0 ? (
                  <div className="text-center py-8"><Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" /><p className="text-sm text-slate-400">Loading drivers...</p></div>
                ) : (
                  availableDrivers.map(driver => (
                    <button key={driver.id} onClick={() => handleDriverSelect(driver)} 
                      className="w-full text-left p-4 bg-slate-50 dark:bg-slate-900/50 hover:bg-blue-50 rounded-xl flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-black text-lg">
                        {driver.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="font-black">{driver.name}</div>
                        <div className="text-xs text-slate-400">{driver.truckNo ? `🚛 ${driver.truckNo}` : 'No truck'}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ========== MAIN DASHBOARD ==========
  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-900' : 'bg-slate-50'}`}>
      
      {/* POD Viewer */}
      {showPODViewer && selectedPODLoad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setShowPODViewer(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold">POD - {selectedPODLoad.containerNo}</h3>
              <button onClick={() => setShowPODViewer(false)}><X size={20} /></button>
            </div>
            <div className="p-4 bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
              <img src={selectedPODLoad.podPhotoUrl} alt="POD" className="max-w-full max-h-[70vh] rounded-lg" />
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button onClick={() => window.open(selectedPODLoad.podPhotoUrl, '_blank')} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold">Download</button>
              <button onClick={() => setShowPODViewer(false)} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 dark:text-white rounded-xl text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-bold shadow-lg animate-in fade-in slide-in-from-top-4 ${
          feedback.includes('✅') ? 'bg-green-600 text-white' : 
          feedback.includes('⚠️') ? 'bg-amber-600 text-white' : 
          feedback.includes('❌') ? 'bg-red-600 text-white' :
          'bg-slate-800 text-white'
        }`}>
          {feedback}
        </div>
      )}
      
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b sticky top-0 z-30">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl"><Truck className="w-6 h-6 text-white" /></div>
            <div>
              <h1 className="font-black text-slate-800 dark:text-white">Nexdray Driver</h1>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                {isOnline ? <Wifi className="w-3 h-3 text-green-500" /> : <WifiOff className="w-3 h-3 text-red-500" />}
                {currentDate}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowChat(true)} className="p-2 text-slate-400 hover:text-blue-600 rounded-xl relative">
              <MessageSquare size={20} />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {unreadMessages}
                </span>
              )}
            </button>
            <button onClick={() => setShowPayModal(true)} className="p-2 text-emerald-600 hover:text-emerald-800 rounded-xl bg-emerald-50 dark:bg-emerald-900/30">
              <DollarSign size={20} />
            </button>
            <button onClick={toggleDarkMode} className="p-2 text-slate-400 hover:text-blue-600 rounded-xl">
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={isTracking ? stopGPSTracking : startGPSTracking} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold ${isTracking ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></div>
              GPS {isTracking ? 'ON' : 'OFF'}
            </button>
            <button onClick={handleSignOut} className="p-2 text-slate-400 hover:text-red-600 rounded-xl"><LogOut size={20} /></button>
          </div>
        </div>
      </header>
      
      {/* Driver Info Bar */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2"><User size={16} /><span className="font-bold">{driverProfile?.name || 'Driver'}</span></div>
            {companyInfo && <div className="text-xs opacity-80">{companyInfo.name}</div>}
            <div className="text-xs opacity-80">🚛 {driverProfile?.truckNo}</div>
            {currentLocation && (
              <div className="text-[10px] opacity-70 mt-1">
                📍 {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80">Active</div>
            <div className="text-2xl font-black">{activeLoads.length}</div>
          </div>
        </div>
      </div>
      
      {/* Stats with Pay */}
      <div className="grid grid-cols-4 gap-3 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-black text-blue-600">{activeLoads.length}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Active</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-black text-green-600">{completedLoads.length}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Completed</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-black text-emerald-600">${totalEarnings.toFixed(2)}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Total Earned</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-black text-amber-600">${pendingPayments.toFixed(2)}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Pending</div>
        </div>
      </div>
      
      {/* Main Content */}
      <main className="p-4 pb-24">
        {selectedLoad ? (
          // ========== LOAD DETAIL VIEW ==========
          <div>
            <button onClick={() => { setSelectedLoad(null); setSelectedLeg(null); }} className="flex items-center gap-1 text-slate-500 mb-4 hover:text-blue-600">
              <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dispatches
            </button>
            
            <div className="bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-lg font-black">🚛 DISPATCH</h2>
                    <p className="text-xs opacity-80">WO: {selectedLoad.workOrderNo}</p>
                    <p className="text-xs opacity-70">Container: {selectedLoad.containerNo}</p>
                  </div>
                  {(() => {
                    const nextLeg = getNextIncompleteLeg(selectedLoad);
                    if (nextLeg?.to) {
                      return (
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextLeg.to)}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 px-3 py-1.5 bg-white/20 rounded-lg text-xs font-bold hover:bg-white/30">
                          <Navigation2 size={14} /> Navigate
                        </a>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Pay Section */}
                {selectedLoad && (() => {
                  const totalPay = calculateDriverPay(selectedLoad);
                  return (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <DollarSign size={16} className="text-emerald-600" />
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Your Pay</span>
                        </div>
                        <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">${totalPay.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {getDriverLegs(selectedLoad).map((leg, idx) => {
                          const pay = leg.driverPay ? parseFloat(leg.driverPay) : 50;
                          const status = leg.tripStatus || leg.status || 'Pending';
                          const isComplete = status === 'Completed' || status === 'Delivered';
                          return (
                            <span key={leg.id} className={`text-[10px] px-2 py-0.5 rounded-full ${isComplete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              Leg {idx + 1}: ${pay.toFixed(2)} {isComplete ? '✅' : '⏳'}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Customer and Appointment Info */}
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between"><span className="text-xs text-slate-500">Customer:</span><span className="text-sm font-bold">{selectedLoad.customerName}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-slate-500">Appointment:</span><span className="text-sm font-bold text-blue-600">{selectedLoad.appointmentDate} at {selectedLoad.appointmentTime}</span></div>
                </div>
                
                {/* Multi-Leg Display */}
                <div>
                  <div className="flex items-center gap-2 mb-3"><Layers size={16} /><h3 className="text-xs font-bold text-slate-400 uppercase">Trip Legs ({getDriverLegs(selectedLoad).length})</h3></div>
                  <div className="space-y-3">
                    {getDriverLegs(selectedLoad).map((leg, index) => {
                      const legStatus = leg.tripStatus || leg.status || 'Pending';
                      const isCompleted = legStatus === 'Completed' || legStatus === 'Delivered';
                      const isAllLegsComplete = areAllLegsComplete(selectedLoad);
                      
                      return (
                        <div 
                          key={leg.id} 
                          className={`border rounded-xl p-3 transition-all cursor-pointer ${
                            isCompleted 
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                              : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 ring-2 ring-blue-400'
                          } ${selectedLeg?.id === leg.id ? 'ring-4 ring-blue-500' : ''}`}
                          onClick={() => {
                            setSelectedLeg(leg);
                            setFeedback(`Selected Leg ${index + 1}: ${formatLocation(leg.from)} → ${formatLocation(leg.to)}`);
                          }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${getLegTypeColor(leg.legType)}`}>
                                {getLegTypeLabel(leg.legType)} #{index + 1}
                              </span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${getStatusColor(legStatus)}`}>
                                {legStatus}
                              </span>
                              {selectedLeg?.id === leg.id && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500 text-white">
                                  SELECTED
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin size={16} className="text-green-600" /><span className="font-medium">{formatLocation(leg.from)}</span>
                            <ArrowRight size={16} />
                            <Flag size={16} className="text-red-600" /><span className="font-medium">{formatLocation(leg.to)}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-2 mt-2 text-xs flex justify-between">
                            <span>👤 {leg.driverName || 'N/A'}</span><span>🚛 {leg.truckNo || 'N/A'}</span>
                          </div>
                          
                          {/* STATUS UPDATE BUTTONS */}
                          {!isCompleted && !isAllLegsComplete && (
                            <div className="mt-3 pt-3 border-t dark:border-slate-700">
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">
                                Update Status {leg.legType === 'termination' ? '(Termination Leg)' : '(Delivery Leg)'}:
                              </div>
                              <div className="flex flex-wrap gap-2">
                                
                                {/* DELIVERY/PICKUP LEG OPTIONS */}
                                {leg.legType !== 'termination' && (
                                  <>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Started', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Started')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Started') 
                                          ? 'bg-blue-300 cursor-not-allowed' 
                                          : 'bg-blue-600 hover:bg-blue-700'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Started') ? <CheckCircle size={18} /> : <Play size={18} />}
                                      {isButtonClicked(leg.id, 'Started') ? 'Started ✓' : '🚛 Start Trip'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Arrived Pickup', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Arrived Pickup')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Arrived Pickup') 
                                          ? 'bg-cyan-300 cursor-not-allowed' 
                                          : 'bg-cyan-500 hover:bg-cyan-600'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Arrived Pickup') ? <CheckCircle size={18} /> : <MapPin size={18} />}
                                      {isButtonClicked(leg.id, 'Arrived Pickup') ? 'Arrived ✓' : '📍 Reached Pickup'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Loaded', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Loaded')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Loaded') 
                                          ? 'bg-teal-300 cursor-not-allowed' 
                                          : 'bg-teal-500 hover:bg-teal-600'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Loaded') ? <CheckCircle size={18} /> : <Package size={18} />}
                                      {isButtonClicked(leg.id, 'Loaded') ? 'Loaded ✓' : '📦 Loaded'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('In Transit', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'In Transit')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'In Transit') 
                                          ? 'bg-indigo-300 cursor-not-allowed' 
                                          : 'bg-indigo-500 hover:bg-indigo-600'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'In Transit') ? <CheckCircle size={18} /> : <Navigation size={18} />}
                                      {isButtonClicked(leg.id, 'In Transit') ? 'In Transit ✓' : '🚛 In Transit'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Arrived Delivery', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Arrived Delivery')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Arrived Delivery') 
                                          ? 'bg-orange-300 cursor-not-allowed' 
                                          : 'bg-orange-500 hover:bg-orange-600'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Arrived Delivery') ? <CheckCircle size={18} /> : <MapPinCheck size={18} />}
                                      {isButtonClicked(leg.id, 'Arrived Delivery') ? 'Arrived ✓' : '📍 Arrived at Delivery'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => { 
                                        e.stopPropagation();
                                        if (isButtonClicked(leg.id, 'POD')) {
                                          setFeedback('⏳ POD already uploaded');
                                          return;
                                        }
                                        setSelectedLeg(leg); 
                                        setPodData({ photo: null, receiverName: '', legId: leg.id }); 
                                        setShowPODModal(true); 
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'POD')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'POD') 
                                          ? 'bg-green-300 cursor-not-allowed' 
                                          : 'bg-green-600 hover:bg-green-700'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'POD') ? <CheckCircle size={18} /> : <Camera size={18} />}
                                      {isButtonClicked(leg.id, 'POD') ? 'POD Done ✓' : '✅ Delivery Done (Upload POD)'}
                                    </button>
                                  </>
                                )}
                                
                                {/* TERMINATION LEG OPTIONS */}
                                {leg.legType === 'termination' && (
                                  <>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Started', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Started')} 
                                      className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Started') 
                                          ? 'bg-purple-300 cursor-not-allowed' 
                                          : 'bg-purple-600 hover:bg-purple-700'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Started') ? <CheckCircle size={18} /> : <Flag size={18} />}
                                      {isButtonClicked(leg.id, 'Started') ? 'Started ✓' : '🏁 Start Termination'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Heading to Yard', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Heading to Yard')} 
                                      className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Heading to Yard') 
                                          ? 'bg-purple-300 cursor-not-allowed' 
                                          : 'bg-purple-600 hover:bg-purple-700'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Heading to Yard') ? <CheckCircle size={18} /> : <Home size={18} />}
                                      {isButtonClicked(leg.id, 'Heading to Yard') ? 'Heading ✓' : '🏗️ Heading to Yard (Termination)'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Arrived Yard', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Arrived Yard')} 
                                      className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Arrived Yard') 
                                          ? 'bg-violet-300 cursor-not-allowed' 
                                          : 'bg-violet-500 hover:bg-violet-600'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Arrived Yard') ? <CheckCircle size={18} /> : <Flag size={18} />}
                                      {isButtonClicked(leg.id, 'Arrived Yard') ? 'At Yard ✓' : '📍 Arrived at Yard'}
                                    </button>
                                    
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLeg(leg);
                                        handleUpdateDriverStatus('Completed', leg.id);
                                      }} 
                                      disabled={updating || isButtonClicked(leg.id, 'Completed')} 
                                      className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md ${
                                        isButtonClicked(leg.id, 'Completed') 
                                          ? 'bg-emerald-300 cursor-not-allowed' 
                                          : 'bg-emerald-600 hover:bg-emerald-700'
                                      } text-white disabled:opacity-50`}
                                    >
                                      {isButtonClicked(leg.id, 'Completed') ? <CheckCircle size={18} /> : <CheckCircle size={18} />}
                                      {isButtonClicked(leg.id, 'Completed') ? 'Complete ✓' : '✅ Container Terminated / Job Complete'}
                                    </button>
                                  </>
                                )}
                              </div>
                              
                              {/* Current Status */}
                              <div className="mt-3 p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                <div className="text-[10px] text-slate-500 text-center">
                                  Current: <strong>{driverProfile?.tripStatus || 'Not Started'}</strong>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* When both legs are complete */}
                          {isAllLegsComplete && (
                            <div className="mt-3 pt-3 border-t dark:border-slate-700">
                              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-center">
                                <div className="text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                                  ✅ ALL LEGS COMPLETE! Dispatch closed for today.
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* POD Photo Display */}
                          {leg.podPhotoUrl && (
                            <div className="mt-2 pt-2 border-t dark:border-slate-700 flex gap-2">
                              <button onClick={(e) => { e.stopPropagation(); setSelectedPODLoad({ ...selectedLoad, podPhotoUrl: leg.podPhotoUrl }); setShowPODViewer(true); }} 
                                className="px-3 py-1 bg-green-600 text-white rounded-lg text-[10px] font-bold">View POD</button>
                              {leg.receiverName && <span className="text-[10px] text-green-700">✅ {leg.receiverName}</span>}
                            </div>
                          )}
                          
                          {/* Signature Display */}
                          {leg.signature && (
                            <div className="mt-2 pt-2 border-t dark:border-slate-700">
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Signed POD</div>
                              <img src={leg.signature} alt="Signature" className="w-full max-h-24 object-contain rounded-lg border" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {selectedLoad.notes && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-100">
                    <div className="text-[10px] font-black text-amber-700 uppercase mb-1">📝 Notes</div>
                    <p className="text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap">{selectedLoad.notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          // ========== LOAD LIST VIEW ==========
          <>
            <div className="mb-6">
              <h2 className="text-sm font-black text-slate-400 uppercase tracking-wider mb-3">Active Dispatches ({activeLoads.length})</h2>
              
              {/* PAY SUMMARY */}
              {activeLoads.length > 0 && (
                <div className="bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-xl p-4 mb-4 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase">Total Earnings</div>
                      <div className="text-2xl font-black text-emerald-600">${totalEarnings.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-500 uppercase">Pending</div>
                      <div className="text-xl font-black text-amber-600">${pendingPayments.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-500 uppercase">Completed</div>
                      <div className="text-xl font-black text-green-600">${(totalEarnings - pendingPayments).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeLoads.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border p-8 text-center">
                  <Truck size={48} className="text-slate-300 mx-auto mb-4" />
                  <p className="font-bold text-slate-400">No Active Dispatches</p>
                  <p className="text-xs text-slate-400 mt-2">Wait for dispatcher to assign loads</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeLoads.map(load => {
                    const legs = getDriverLegs(load);
                    const completed = legs.filter(l => { 
                      const s = l.tripStatus || l.status || 'Pending'; 
                      return s === 'Completed' || s === 'Delivered'; 
                    }).length;
                    const allComplete = legs.length > 0 && legs.every(l => {
                      const s = l.tripStatus || l.status || 'Pending';
                      return s === 'Completed' || s === 'Delivered';
                    });
                    
                    return (
                      <div key={load.id} onClick={() => setSelectedLoad(load)} className={`bg-white dark:bg-slate-800 rounded-2xl border p-4 shadow-sm active:scale-[0.98] cursor-pointer ${allComplete ? 'border-green-300 bg-green-50/30' : ''}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-black text-lg">{load.containerNo}</div>
                            <div className="text-xs text-slate-400">{load.workOrderNo}</div>
                          </div>
                          <span className={`text-[10px] font-black px-2 py-1 rounded-full ${
                            allComplete ? 'bg-green-100 text-green-700' :
                            legs.length === completed ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {completed}/{legs.length} Legs
                          </span>
                        </div>
                        <div className="space-y-2">
                          {legs.map((leg, idx) => {
                            const s = leg.tripStatus || leg.status || 'Pending';
                            const done = s === 'Completed' || s === 'Delivered';
                            return (
                              <div key={leg.id} className="flex items-center gap-2 text-xs">
                                <span className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                                <span className={done ? 'text-green-600' : 'text-slate-600'}>
                                  Leg {idx + 1}: {formatLocation(leg.from)} → {formatLocation(leg.to)}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${getLegTypeColor(leg.legType)}`}>
                                  {getLegTypeLabel(leg.legType)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Clock size={12} /> {load.appointmentTime || 'TBD'}</span>
                          <span className="text-blue-600 flex items-center gap-1">View Details <ChevronRight size={12} /></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {completedLoads.length > 0 && (
              <div>
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-wider mb-3">Completed ({completedLoads.length})</h2>
                <div className="space-y-2">
                  {completedLoads.map(load => (
                    <div key={load.id} onClick={() => setSelectedLoad(load)} className="bg-white dark:bg-slate-800 rounded-xl border p-3 opacity-75 cursor-pointer hover:opacity-100">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-bold text-sm">{load.containerNo}</div>
                          <div className="text-[10px] text-green-600">✅ All {getDriverLegs(load).length} legs done</div>
                        </div>
                        <CheckCircle size={20} className="text-green-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
      
      {/* POD Modal */}
      {showPODModal && selectedLeg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowPODModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg mb-2">📋 Proof of Delivery</h3>
            <p className="text-sm text-slate-500 mb-4">{getLegTypeLabel(selectedLeg.legType)}: {formatLocation(selectedLeg.from)} → {formatLocation(selectedLeg.to)}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Receiver Name *</label>
                <input type="text" value={podData.receiverName} onChange={e => setPodData(p => ({ ...p, receiverName: e.target.value }))} 
                  className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">POD Photo</label>
                {podData.photo ? (
                  <div className="relative">
                    <img src={podData.photo} alt="POD" className="w-full h-40 object-cover rounded-xl" />
                    <button onClick={() => setPodData(p => ({ ...p, photo: null }))} className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"><X size={16} /></button>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl hover:border-green-400">
                    <Camera size={32} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-500">Tap to take photo</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePODPhoto} />
                  </label>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowPODModal(false); setPodData({ photo: null, receiverName: '', legId: null }); }} 
                  className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-sm">Cancel</button>
                <button onClick={handlePODSubmit} disabled={updating} 
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-50">
                  {updating ? 'Uploading...' : 'Submit POD'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Signature Pad Modal */}
      {showSignaturePad && selectedLeg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowSignaturePad(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg mb-4">✍️ Sign POD</h3>
            <p className="text-sm text-slate-500 mb-4">{getLegTypeLabel(selectedLeg.legType)}: {formatLocation(selectedLeg.from)} → {formatLocation(selectedLeg.to)}</p>
            <SignaturePad onSave={handleSignatureSubmit} onCancel={() => setShowSignaturePad(false)} />
          </div>
        </div>
      )}

      {/* PAY MODAL */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowPayModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-black text-lg">💰 Pay Details</h3>
              <button onClick={() => setShowPayModal(false)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              {assignedLoads.map(load => {
                const legs = getDriverLegs(load);
                const total = legs.reduce((sum, leg) => sum + (parseFloat(leg.driverPay) || 50), 0);
                const allComplete = legs.every(l => {
                  const s = l.tripStatus || l.status || 'Pending';
                  return s === 'Completed' || s === 'Delivered';
                });
                return (
                  <div key={load.id} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-bold text-sm">{load.containerNo}</div>
                        <div className="text-[10px] text-slate-400">{load.workOrderNo}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-black ${allComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
                          ${total.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400">{allComplete ? '✅ Paid' : '⏳ Pending'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {assignedLoads.every(l => getDriverLegs(l).reduce((s, leg) => s + (parseFloat(leg.driverPay) || 50), 0) === 0) && (
                <div className="text-center text-slate-400 py-8">
                  <p>No pay details available</p>
                  <p className="text-xs mt-1">Pay is set by dispatch</p>
                </div>
              )}
              <div className="pt-3 border-t dark:border-slate-700">
                <div className="flex justify-between items-center font-bold">
                  <span>Total Earnings</span>
                  <span className="text-emerald-600">${totalEarnings.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Chat Modal - SINGLE INSTANCE */}
      <ChatModal isOpen={showChat} onClose={() => setShowChat(false)} partnerName="Dispatch" messages={messages} onSend={sendMessage} />
      
      {/* Emergency Button */}
      <button onClick={() => window.open(`tel:${EMERGENCY_NUMBER}`, '_self')} 
        className="fixed bottom-6 left-6 w-14 h-14 bg-red-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-red-700 active:scale-95 z-40">
        <Phone size={24} />
      </button>
      
      {/* Chat Button */}
      <button onClick={() => setShowChat(true)} 
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-95 z-40 relative">
        <MessageSquare size={24} />
        {unreadMessages > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {unreadMessages}
          </span>
        )}
      </button>
    </div>
  );
};

export default DriverApp;