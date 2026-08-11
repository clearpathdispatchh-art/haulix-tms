// DriverApp.jsx - COMPLETE FIXED VERSION WITH EMAIL/PASSWORD LOGIN

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp, getApp, getApps } from "firebase/app";
import { 
  getFirestore,
  collection, query, where, getDocs, onSnapshot, doc, updateDoc, getDoc, 
  addDoc, orderBy, limit, enableNetwork, disableNetwork
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getStorage, ref, uploadBytes, getDownloadURL 
} from 'firebase/storage';
import { 
  Truck, MapPin, Clock, CheckCircle, RefreshCw, LogOut, User, 
  ChevronRight, Navigation, ArrowRight, X,
  Building, AlertCircle, Play, Flag, MapPinCheck,
  TruckIcon, Loader2, Camera, Moon, Sun, MessageCircle,
  AlertTriangle, PhoneCall, MessageSquare,
  Search, Lock, Eye, FileDown, Upload, EyeOff, Wifi, WifiOff,
  Package, Home, Layers, Navigation2, Send, PenTool, Phone,
  DollarSign,
  FileText,
  Copy,
  FileUp
} from 'lucide-react';

// ========== CLIPBOARD HELPER ==========
const copyToClipboard = (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    });
  } else {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
};

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
const auth = getAuth(app);

// Network status handling
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { enableNetwork(db).catch(console.warn); });
  window.addEventListener('offline', () => { disableNetwork(db).catch(console.warn); });
}

// ========== CONSTANTS ==========
const STATUS_UPDATE_COOLDOWN_MS = 3000;
const EMERGENCY_NUMBER = '911';
const FEEDBACK_DURATION_MS = 4000;

// ========== LEG TYPES ==========
const getLegTypeLabel = (type) => {
  switch(type) {
    case 'pickup': return '📦 Pickup';
    case 'delivery': return '🚚 Delivery';
    case 'termination': return '🏁 Termination';
    case 'drop': return '📦 Drop';
    default: return '📍 Leg';
  }
};

const getLegTypeColor = (type) => {
  switch(type) {
    case 'pickup': return 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300';
    case 'delivery': return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
    case 'termination': return 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300';
    case 'drop': return 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300';
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
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [companyInfo, setCompanyInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  
  // Data state
  const [assignedLoads, setAssignedLoads] = useState([]);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [selectedLeg, setSelectedLeg] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [updating, setUpdating] = useState(false);
  
  // UI state
  const [showPODModal, setShowPODModal] = useState(false);
  const [podData, setPodData] = useState({ photo: null, receiverName: '', legId: null, isEIR: false });
  // Dark mode removed - always light mode
const [darkMode, setDarkMode] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  
  // Track clicked buttons per leg
  const [clickedButtons, setClickedButtons] = useState({});
  
  // POD state
  const [showPODViewer, setShowPODViewer] = useState(false);
  const [selectedPODLoad, setSelectedPODLoad] = useState(null);
  
  // Communication state
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Pay state
  const [showPayModal, setShowPayModal] = useState(false);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  
  // GPS state
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef(null);
  
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

// Network monitoring - FIXED
useEffect(() => {
  const handleOnline = () => { 
    setIsOnline(true); 
    console.log('🌐 Online - Enabling Firestore network');
    enableNetwork(db).then(() => {
      console.log('✅ Firestore network enabled');
      if (auth.currentUser) {
        console.log('🔄 Re-checking auth state...');
      }
    }).catch(err => {
      console.warn('⚠️ enableNetwork failed:', err);
    });
  };
  
  const handleOffline = () => { 
    setIsOnline(false); 
    console.log('📴 Offline - Disabling Firestore network');
    disableNetwork(db).catch(console.warn);
  };
  
  // Force enable network on mount
  enableNetwork(db).catch(() => {});
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => { 
    window.removeEventListener('online', handleOnline); 
    window.removeEventListener('offline', handleOffline); 
  };
}, [db]);

// Auth state listener - handles auto-login (FIXED VERSION)
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log('✅ Driver authenticated:', user.email);
      try {
        // First try to get user doc directly
        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap;
        
        try {
          userDocSnap = await getDoc(userDocRef);
        } catch (e) {
          console.warn('⚠️ Cannot read user document (permissions):', e.message);
          // If we can't read the user doc, try fallback search
          userDocSnap = { exists: () => false };
        }
        
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          const companyId = userData.companyId;
          
          if (companyId) {
            try {
              const driversSnap = await getDocs(
                collection(db, 'companies', companyId, 'drivers')
              );
              
              for (const driverDoc of driversSnap.docs) {
                const driverData = driverDoc.data();
                if (driverData.email === user.email || driverData.uid === user.uid) {
                  if (isMountedRef.current) {
                    setDriverProfile({
                      driverId: driverDoc.id,
                      companyId: companyId,
                      name: driverData.name,
                      truckNo: driverData.truckNo,
                      email: user.email
                    });
                    try {
                      const companyDoc = await getDoc(doc(db, 'companies', companyId));
                      if (companyDoc.exists()) setCompanyInfo(companyDoc.data());
                    } catch (e) {
                      console.warn('Could not read company info');
                    }
                    startGPSTracking();
                    setLoading(false);
                  }
                  return;
                }
              }
            } catch (e) {
              console.warn('⚠️ Cannot access company drivers:', e.message);
            }
          }
        }
        
        // Fallback: Search all companies (only if we have permission)
        try {
          const companiesSnap = await getDocs(collection(db, 'companies'));
          let foundDriver = null;
          let foundCompanyId = null;
          
          for (const companyDoc of companiesSnap.docs) {
            try {
              const driversSnap = await getDocs(
                collection(db, 'companies', companyDoc.id, 'drivers')
              );
              for (const driverDoc of driversSnap.docs) {
                const driverData = driverDoc.data();
                if (driverData.email === user.email || driverData.uid === user.uid) {
                  foundDriver = { id: driverDoc.id, ...driverData };
                  foundCompanyId = companyDoc.id;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
            if (foundDriver) break;
          }
          
          if (foundDriver && isMountedRef.current) {
            setDriverProfile({
              driverId: foundDriver.id,
              companyId: foundCompanyId,
              name: foundDriver.name,
              truckNo: foundDriver.truckNo,
              email: user.email
            });
            try {
              const companyDoc = await getDoc(doc(db, 'companies', foundCompanyId));
              if (companyDoc.exists()) setCompanyInfo(companyDoc.data());
            } catch (e) {}
            startGPSTracking();
            setLoading(false);
            return;
          }
        } catch (e) {
          console.warn('⚠️ Fallback search failed:', e.message);
        }
        
        // If we get here, no driver profile was found
        console.warn('No driver profile found for:', user.email);
        setAuthError('No driver profile found. Contact your dispatcher. Your account may not be fully set up yet.');
        await firebaseSignOut(auth);
        setLoading(false);
        
      } catch (error) {
        console.error('Error loading driver profile:', error);
        setAuthError('Error loading profile: ' + error.message);
        setLoading(false);
      }
    } else {
      setDriverProfile(null);
      setCompanyInfo(null);
      setLoading(false);
    }
  });
  
  return () => unsubscribe();
}, []);

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

  // ========== PAY TRACKING ==========
  const calculateDriverPay = useCallback((load) => {
    if (!load?.legs) return 0;
    let total = 0;
    const driverLegs = getDriverLegs(load);
    driverLegs.forEach(leg => {
      if (leg.driverPay) total += parseFloat(leg.driverPay) || 0;
      else total += 50;
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

  useEffect(() => {
    setTotalEarnings(calculateTotalEarnings());
    setPendingPayments(calculatePendingPayments());
  }, [assignedLoads, calculateTotalEarnings, calculatePendingPayments]);

  // Cleanup
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; stopGPSTracking(); }; }, []);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => { if (isMountedRef.current) setFeedback(''); }, FEEDBACK_DURATION_MS);
  }, [feedback]);

  // ========== LOGIN HANDLER ==========
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setAuthError('Please enter email and password');
      return;
    }
    
    setAuthLoading(true);
    setAuthError('');
    
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged will handle the rest
    } catch (error) {
      console.error('Login error:', error);
      switch (error.code) {
        case 'auth/invalid-email':
          setAuthError('Invalid email address');
          break;
        case 'auth/user-not-found':
          setAuthError('No driver account found with this email');
          break;
        case 'auth/wrong-password':
          setAuthError('Incorrect password');
          break;
        case 'auth/invalid-credential':
          setAuthError('Invalid email or password');
          break;
        default:
          setAuthError('Login failed. Please try again.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

    const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const INACTIVITY_TIMEOUT_DRIVER_MS = 30 * 60 * 1000; // 30 minutes
  const WARNING_BEFORE_MS = 5 * 60 * 1000; // 5 minutes warning
  const inactivityTimerRefDriver = useRef(null);
  const warningTimerRefDriver = useRef(null);

  const resetDriverInactivityTimer = useCallback(() => {
    if (inactivityTimerRefDriver.current) clearTimeout(inactivityTimerRefDriver.current);
    if (warningTimerRefDriver.current) clearTimeout(warningTimerRefDriver.current);
    setShowTimeoutWarning(false);
    
    // Set warning timer (25 minutes)
    warningTimerRefDriver.current = setTimeout(() => {
      setShowTimeoutWarning(true);
    }, INACTIVITY_TIMEOUT_DRIVER_MS - WARNING_BEFORE_MS);
    
    // Set logout timer (30 minutes)
    inactivityTimerRefDriver.current = setTimeout(async () => {
      setShowTimeoutWarning(false);
      stopGPSTracking();
      await firebaseSignOut(auth);
      setDriverProfile(null); 
      setCompanyInfo(null); 
      setAssignedLoads([]); 
      setSelectedLoad(null);
    }, INACTIVITY_TIMEOUT_DRIVER_MS);
  }, []);

  useEffect(() => {
    if (!driverProfile) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => window.addEventListener(event, resetDriverInactivityTimer));
    resetDriverInactivityTimer();
    return () => {
      events.forEach(event => window.removeEventListener(event, resetDriverInactivityTimer));
      if (inactivityTimerRefDriver.current) clearTimeout(inactivityTimerRefDriver.current);
      if (warningTimerRefDriver.current) clearTimeout(warningTimerRefDriver.current);
    };
  }, [driverProfile, resetDriverInactivityTimer]);

  const handleSignOut = async () => {
    stopGPSTracking();
    await firebaseSignOut(auth);
    setDriverProfile(null); 
    setCompanyInfo(null); 
    setAssignedLoads([]); 
    setSelectedLoad(null);
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
      setFeedback('⏳ Please wait before updating again'); 
      return; 
    }
    
    const buttonKey = `${targetLoad.id}-${targetLeg.id}-${newStatus}`;
    if (clickedButtons[buttonKey]) {
      setFeedback('⏳ This status has already been updated');
      return;
    }
    
    lastStatusUpdateRef.current = now; 
    setUpdating(true);
    setFeedback(`⏳ Updating to "${newStatus}"...`);
    
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
          return { ...leg, tripStatus: newStatus, status: newStatus };
        });
        return { ...prev, legs: newLegs };
      });
      
      setFeedback(`✅ ${newStatus}`);
      setShowPODModal(false); 
      setPodData({ photo: null, receiverName: '', legId: null });
      
    } catch (error) { 
      logError('updateDriverStatus', error);
      setFeedback('❌ Update failed'); 
    }
    finally { setUpdating(false); }
  };

  // POD handlers (keep existing ones from your original code)
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
  if (!podData.receiverName.trim()) { 
    setFeedback(podData.isEIR ? '❌ Please enter EIR number' : '❌ Please enter receiver name'); 
    return; 
  }
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
      console.log('✅ POD uploaded to:', photoUrl);
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
      
      const status = podData.isEIR ? 'Completed' : 'POD Uploaded';
      const statusField = podData.isEIR ? 'completedAt' : 'podUploadedAt';
      
      const updatedLeg = {
        ...leg,
        receiverName: podData.receiverName.trim(),
        podPhotoUrl: photoUrl,
        tripStatus: status,
        status: status,
        [statusField]: new Date().toLocaleTimeString()
      };
      
      console.log('✅ Updated leg with POD URL:', updatedLeg);
      return updatedLeg;
    });
    
    await updateDoc(loadRef, { 
      legs: updatedLegs,
      updatedAt: new Date().toISOString()
    });
    
    // ✅ CHANGED: Store POD and EIR separately in driver document
    const driverRef = doc(db, 'companies', driverProfile.companyId, 'drivers', driverProfile.driverId);
    
    // Base updates always applied
    const driverUpdates = {
      receiverName: podData.receiverName.trim(),
      tripStatus: podData.isEIR ? 'Completed' : 'POD Uploaded',
      podUploadedAt: new Date().toLocaleTimeString()
    };
    
    if (podData.isEIR) {
      // ✅ Store as EIR
      driverUpdates.eirPhotoUrl = photoUrl;
      driverUpdates.eirReceiverName = podData.receiverName.trim();
      driverUpdates.eirUploadedAt = new Date().toLocaleTimeString();
      // Clear any old POD from this driver (optional - keeps it clean)
      // driverUpdates.podPhotoUrl = null;
    } else {
      // ✅ Store as POD
      driverUpdates.podPhotoUrl = photoUrl;
      driverUpdates.podReceiverName = podData.receiverName.trim();
      driverUpdates.podUploadedAt = new Date().toLocaleTimeString();
      // Clear any old EIR from this driver (optional - keeps it clean)
      // driverUpdates.eirPhotoUrl = null;
    }
    
    await updateDoc(driverRef, driverUpdates);
    
    // ✅ FIX: Force refresh the load from Firestore
    const freshSnap = await getDoc(loadRef);
    if (freshSnap.exists()) {
      const freshLoad = { id: freshSnap.id, ...freshSnap.data() };
      setSelectedLoad(freshLoad);
      console.log('✅ Load refreshed with POD URL:', freshLoad.legs.find(l => l.id === podData.legId)?.podPhotoUrl);
    }
    
    setFeedback(podData.isEIR ? '✅ EIR Uploaded' : '✅ POD Uploaded');
    setShowPODModal(false); 
    setPodData({ photo: null, receiverName: '', legId: null, isEIR: false });
    
  } catch (error) { 
    logError('handlePODSubmit', error);
    setFeedback('❌ Upload failed'); 
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

  // Check if button is clicked
  const isButtonClicked = (legId, status) => {
    if (!selectedLoad) return false;
    const key = `${selectedLoad.id}-${legId}-${status}`;
    return !!clickedButtons[key];
  };



  // ========== UPDATE TIMES ==========
  const handleUpdateTimes = async (legId, arrival, departure) => {
    if (!selectedLoad || !driverProfile) {
      setFeedback('⚠️ No load selected');
      return;
    }
    if (!arrival && !departure) {
      setFeedback('⚠️ Please enter at least one time');
      return;
    }

    setUpdating(true);
    try {
      const loadRef = doc(db, 'companies', driverProfile.companyId, 'loads', selectedLoad.id);
      const loadSnap = await getDoc(loadRef);
      if (!loadSnap.exists()) {
        setFeedback('❌ Load not found');
        return;
      }

      const loadData = loadSnap.data();
      const legs = loadData.legs || [];

      const updatedLegs = legs.map(leg => {
        if (leg.id !== legId) return leg;
        return {
          ...leg,
          arrivalTime: arrival || leg.arrivalTime || '',
          departureTime: departure || leg.departureTime || '',
          lastTripUpdate: new Date().toISOString()
        };
      });

      await updateDoc(loadRef, {
        legs: updatedLegs,
        updatedAt: new Date().toISOString()
      });

      // Update local state
      setSelectedLoad(prev => ({
        ...prev,
        legs: updatedLegs
      }));

      setFeedback('✅ Times updated successfully');
    } catch (error) {
      console.error('Update times error:', error);
      setFeedback('❌ Failed to update times');
    } finally {
      setUpdating(false);
    }
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
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
  <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full">
        <div className={`flex items-center justify-center gap-2 mb-4 text-xs font-bold ${isOnline ? 'text-green-600' : 'text-red-600'}`}>
          {isOnline ? <><Wifi className="w-4 h-4" /> Online</> : <><WifiOff className="w-4 h-4" /> Offline</>}
        </div>
        
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Truck className="w-10 h-10 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">Driver Login</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in with your driver credentials</p>
        </div>
        
        {authError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm font-bold mb-4 text-center flex items-center justify-center gap-2">
            <AlertCircle size={16} />
            {authError}
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Email</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder="driver@company.com" 
                className="w-full pl-10 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white" 
                autoFocus
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••" 
                className="w-full pl-10 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white" 
                required
              />
            </div>
          </div>
          
          <button 
            type="submit" 
            disabled={authLoading || !email || !password}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
          >
            {authLoading ? (
              <><Loader2 size={18} className="animate-spin" /> Signing in...</>
            ) : (
              <><LogOut size={18} className="rotate-180" /> Sign In</>
            )}
          </button>
        </form>
        
        <p className="text-center text-xs text-slate-400 mt-6">
          Contact your dispatcher if you need an account
        </p>
      </div>
    </div>
  );
}

  // ========== MAIN DASHBOARD ==========
  return (
    <div className="min-h-screen bg-white">
      
      {/* POD Viewer */}
{showPODViewer && selectedPODLoad && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setShowPODViewer(false)}>
    <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-bold text-slate-800">
          {selectedPODLoad.isEIR ? '📄 EIR' : '📋 POD'} - {selectedPODLoad.containerNo}
        </h3>
        <button onClick={() => setShowPODViewer(false)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
      </div>
      <div className="p-4 bg-slate-100 flex items-center justify-center">
        {selectedPODLoad.podPhotoUrl ? (
          <img src={selectedPODLoad.podPhotoUrl} alt={selectedPODLoad.isEIR ? 'EIR' : 'POD'} className="max-w-full max-h-[70vh] rounded-lg shadow-lg" />
        ) : (
          <div className="text-center text-slate-400 p-8">
            <FileUp size={48} className="mx-auto mb-4 text-slate-300" />
            <p>No {selectedPODLoad.isEIR ? 'EIR' : 'POD'} uploaded yet</p>
          </div>
        )}
      </div>
      <div className="p-3 border-t bg-slate-50 flex justify-between text-xs text-slate-500">
        <span>Leg: {selectedPODLoad.legType || 'N/A'}</span>
        <span>Receiver: {selectedPODLoad.receiverName || 'N/A'}</span>
      </div>
    </div>
  </div>
)}

      {feedback && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-bold shadow-lg ${
          feedback.includes('✅') ? 'bg-green-600 text-white' : 
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
            {/* Dark mode button removed - always light mode */}
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
            {driverProfile?.email && <div className="text-xs opacity-70">📧 {driverProfile.email}</div>}
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
      <div className="grid grid-cols-2 gap-3 p-4">
  <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
    <div className="text-2xl font-black text-blue-600">{activeLoads.length}</div>
    <div className="text-[10px] font-bold text-slate-400 uppercase">Active</div>
  </div>
  <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow-sm">
    <div className="text-2xl font-black text-green-600">{completedLoads.length}</div>
    <div className="text-[10px] font-bold text-slate-400 uppercase">Completed</div>
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
                {selectedLoad && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <DollarSign size={16} className="text-emerald-600" />
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Your Pay</span>
                      </div>
                      <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">${calculateDriverPay(selectedLoad).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* DISPATCH DETAILS - Full Assignment Text */}
{selectedLoad && (
  <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
    <div className="flex items-center gap-2 mb-2">
      <FileText className="w-4 h-4 text-blue-600" />
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Dispatch Assignment</h3>
      <button 
        onClick={() => {
          const leg = getDriverLegs(selectedLoad)[0];
          if (leg) {
            const currencySymbol = selectedLoad?.currency === 'USD' ? 'US$' : 'C$';
            let text = `🚛 DISPATCH ASSIGNMENT 🚛\n---------------------------\nWork Order: ${selectedLoad?.workOrderNo || 'N/A'}\nContainer: ${selectedLoad?.containerNo || 'TBD'}\nLine: ${selectedLoad?.shippingLine || 'N/A'}\nSize/Weight: ${selectedLoad?.size || 'N/A'} / ${selectedLoad?.weight || 'N/A'}\nPO #: ${selectedLoad?.poNumber || 'N/A'}\nPickup #: ${selectedLoad?.pickupNo || 'N/A'}\nRef #: ${selectedLoad?.customerRefNo || 'N/A'}\nAppointment: ${selectedLoad?.appointmentDate || 'TBD'} at ${selectedLoad?.appointmentTime || 'TBD'}\nCurrency: ${currencySymbol}\n\nROUTING:\n📍 From: ${leg?.from || 'N/A'}\n🏁 To: ${leg?.to || 'N/A'}\n\nDRIVER INFO:\n👤 Driver: ${leg?.driverName || 'TBD'}\n🚛 Truck: ${leg?.truckNo || 'TBD'}\n---------------------------`;
            copyToClipboard(text);
            setFeedback("📋 Dispatch copied to clipboard!");
          }
        }}
        className="text-xs text-blue-600 hover:text-blue-800 font-bold ml-auto flex items-center gap-1"
      >
        <Copy className="w-3 h-3" /> Copy
      </button>
    </div>
    <div className="bg-white rounded-lg p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap border border-slate-200 max-h-60 overflow-y-auto">
      {(() => {
        const leg = getDriverLegs(selectedLoad)[0];
        const currencySymbol = selectedLoad?.currency === 'USD' ? 'US$' : 'C$';
        return `<span style="color: #1a1a2e;">🚛 DISPATCH ASSIGNMENT 🚛
---------------------------
Work Order: ${selectedLoad?.workOrderNo || 'N/A'}
Container: ${selectedLoad?.containerNo || 'TBD'}
Line: ${selectedLoad?.shippingLine || 'N/A'}
Size/Weight: ${selectedLoad?.size || 'N/A'} / ${selectedLoad?.weight || 'N/A'}
PO #: ${selectedLoad?.poNumber || 'N/A'}
Pickup #: ${selectedLoad?.pickupNo || 'N/A'}
Ref #: ${selectedLoad?.customerRefNo || 'N/A'}
Appointment: ${selectedLoad?.appointmentDate || 'TBD'} at ${selectedLoad?.appointmentTime || 'TBD'}
Currency: ${currencySymbol}

ROUTING:
📍 From: ${leg?.from || 'N/A'}
🏁 To: ${leg?.to || 'N/A'}

DRIVER INFO:
👤 Driver: ${leg?.driverName || 'TBD'}
🚛 Truck: ${leg?.truckNo || 'TBD'}
---------------------------</span>`;
      })()}
    </div>
  </div>
)}

                {/* Customer Info */}
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
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-200' 
                              : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 ring-2 ring-blue-400'
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
                              {/* View POD/EIR Button for Completed Legs */}
{(legStatus === 'Completed' || legStatus === 'POD Uploaded' || legStatus === 'Delivered') && leg.podPhotoUrl && (
  <button 
    onClick={(e) => { 
      e.stopPropagation(); 
      setSelectedPODLoad({ 
        ...selectedLoad, 
        podPhotoUrl: leg.podPhotoUrl, 
        containerNo: selectedLoad.containerNo,
        isEIR: leg.legType === 'termination',
        legType: getLegTypeLabel(leg.legType),
        receiverName: leg.receiverName || 'N/A'
      });
      setShowPODViewer(true); 
    }}
    className="text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 ml-2"
  >
    <Eye size={14} /> View {leg.legType === 'termination' ? 'EIR' : 'POD'}
  </button>
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
                          
                          {/* STATUS UPDATE BUTTONS - Based on Leg Type */}
{!isCompleted && !isAllLegsComplete && (
  <div className="mt-3 pt-3 border-t dark:border-slate-700">
    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">
      {leg.legType === 'termination' ? '🏁 Termination Progress:' :
       leg.legType === 'drop' ? '📦 Drop Progress:' :
       '🚚 Delivery Progress:'}
    </div>
    <div className="flex flex-wrap gap-2">
      
      {/* DELIVERY LEG STATUSES */}
      {leg.legType === 'delivery' && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Started', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Started')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Started') ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Started') ? <CheckCircle size={16} /> : <Play size={16} />}
            {isButtonClicked(leg.id, 'Started') ? 'Started ✓' : '🚛 Start Trip'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Arrived Pickup', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Arrived Pickup')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Arrived Pickup') ? 'bg-cyan-300 cursor-not-allowed' : 'bg-cyan-500 hover:bg-cyan-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Arrived Pickup') ? <CheckCircle size={16} /> : <MapPin size={16} />}
            {isButtonClicked(leg.id, 'Arrived Pickup') ? 'Arrived ✓' : '📍 Reached Pickup'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Loaded', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Loaded')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Loaded') ? 'bg-teal-300 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Loaded') ? <CheckCircle size={16} /> : <Package size={16} />}
            {isButtonClicked(leg.id, 'Loaded') ? 'Loaded ✓' : '📦 Loaded'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('In Transit', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'In Transit')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'In Transit') ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 hover:bg-indigo-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'In Transit') ? <CheckCircle size={16} /> : <Navigation size={16} />}
            {isButtonClicked(leg.id, 'In Transit') ? 'In Transit ✓' : '🚛 In Transit'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Arrived Delivery', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Arrived Delivery')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Arrived Delivery') ? 'bg-orange-300 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Arrived Delivery') ? <CheckCircle size={16} /> : <MapPinCheck size={16} />}
            {isButtonClicked(leg.id, 'Arrived Delivery') ? 'Arrived ✓' : '📍 Arrived Delivery'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); setPodData({ photo: null, receiverName: '', legId: leg.id, isEIR: false }); setShowPODModal(true); }} disabled={updating || isButtonClicked(leg.id, 'POD')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'POD') ? 'bg-green-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'POD') ? <CheckCircle size={16} /> : <Camera size={16} />}
            {isButtonClicked(leg.id, 'POD') ? 'POD Done ✓' : '✅ Delivery Done (Upload POD)'}
          </button>
        </>
      )}
      
      {/* DROP LEG STATUSES */}
      {leg.legType === 'drop' && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Started', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Started')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Started') ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Started') ? <CheckCircle size={16} /> : <Play size={16} />}
            {isButtonClicked(leg.id, 'Started') ? 'Started ✓' : '🚛 Start Trip'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Arrived Pickup', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Arrived Pickup')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Arrived Pickup') ? 'bg-cyan-300 cursor-not-allowed' : 'bg-cyan-500 hover:bg-cyan-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Arrived Pickup') ? <CheckCircle size={16} /> : <MapPin size={16} />}
            {isButtonClicked(leg.id, 'Arrived Pickup') ? 'Arrived ✓' : '📍 Reached Pickup'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Loaded', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Loaded')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Loaded') ? 'bg-teal-300 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Loaded') ? <CheckCircle size={16} /> : <Package size={16} />}
            {isButtonClicked(leg.id, 'Loaded') ? 'Loaded ✓' : '📦 Loaded'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('In Transit', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'In Transit')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'In Transit') ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 hover:bg-indigo-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'In Transit') ? <CheckCircle size={16} /> : <Navigation size={16} />}
            {isButtonClicked(leg.id, 'In Transit') ? 'In Transit ✓' : '🚛 In Transit'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Arrived Drop', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Arrived Drop')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Arrived Drop') ? 'bg-orange-300 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Arrived Drop') ? <CheckCircle size={16} /> : <MapPinCheck size={16} />}
            {isButtonClicked(leg.id, 'Arrived Drop') ? 'Arrived ✓' : '📍 Arrived at Drop'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); setPodData({ photo: null, receiverName: '', legId: leg.id, isEIR: false }); setShowPODModal(true); }} disabled={updating || isButtonClicked(leg.id, 'POD')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'POD') ? 'bg-green-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'POD') ? <CheckCircle size={16} /> : <Camera size={16} />}
            {isButtonClicked(leg.id, 'POD') ? 'POD Done ✓' : '✅ Drop Done (Upload POD)'}
          </button>
        </>
      )}
      
      {/* TERMINATION LEG STATUSES */}
      {leg.legType === 'termination' && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Heading to Terminate', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Heading to Terminate')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Heading to Terminate') ? 'bg-purple-300 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Heading to Terminate') ? <CheckCircle size={16} /> : <Flag size={16} />}
            {isButtonClicked(leg.id, 'Heading to Terminate') ? 'Started ✓' : '🏁 Start Heading to Terminate'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); handleUpdateDriverStatus('Terminated', leg.id); }} disabled={updating || isButtonClicked(leg.id, 'Terminated')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'Terminated') ? 'bg-teal-300 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'Terminated') ? <CheckCircle size={16} /> : <CheckCircle size={16} />}
            {isButtonClicked(leg.id, 'Terminated') ? 'Terminated ✓' : '✅ Container Terminated'}
          </button>
          
          <button onClick={(e) => { e.stopPropagation(); setSelectedLeg(leg); setPodData({ photo: null, receiverName: '', legId: leg.id, isEIR: true }); setShowPODModal(true); }} disabled={updating || isButtonClicked(leg.id, 'EIR')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md ${isButtonClicked(leg.id, 'EIR') ? 'bg-emerald-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'} text-white disabled:opacity-50`}>
            {isButtonClicked(leg.id, 'EIR') ? <CheckCircle size={16} /> : <FileUp size={16} />}
            {isButtonClicked(leg.id, 'EIR') ? 'EIR Done ✓' : '📄 Upload EIR'}
          </button>
        </>
      )}
      
    </div>
  </div>
)}
                          
                          {isAllLegsComplete && (
  <div className="mt-3 pt-3 border-t border-slate-200">
    <div className="p-3 bg-emerald-100 rounded-lg text-center">
      <div className="text-emerald-700 font-bold text-sm">✅ ALL LEGS COMPLETE!</div>
      {/* View POD/EIR Button for Completed Legs */}
{(legStatus === 'Completed' || legStatus === 'POD Uploaded' || legStatus === 'Delivered') && leg.podPhotoUrl && (
  <button 
    onClick={(e) => { 
      e.stopPropagation(); 
      // Use the leg's podPhotoUrl directly, not from selectedLoad
      setSelectedPODLoad({ 
        podPhotoUrl: leg.podPhotoUrl,  // ✅ Use leg directly
        containerNo: selectedLoad.containerNo,
        workOrderNo: selectedLoad.workOrderNo,
        isEIR: leg.legType === 'termination',
        legType: getLegTypeLabel(leg.legType),
        receiverName: leg.receiverName || 'N/A'
      });
      setShowPODViewer(true); 
    }}
    className="text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 ml-2"
  >
    <Eye size={14} /> View {leg.legType === 'termination' ? 'EIR' : 'POD'}
  </button>
)}
    </div>
  </div>
)}
                          {/* ---- TIME INPUTS (new) ---- */}
                          <div className="mt-3 pt-3 border-t dark:border-slate-700">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Arrival Time</label>
                                <input
                                  type="time"
                                  value={leg.arrivalTime || ''}
                                  onChange={(e) => {
                                    const newVal = e.target.value;
                                    setSelectedLoad(prev => ({
                                      ...prev,
                                      legs: prev.legs.map(l => l.id === leg.id ? { ...l, arrivalTime: newVal } : l)
                                    }));
                                  }}
                                  className="w-full px-3 py-2 border rounded-xl text-sm dark:bg-slate-900 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Departure Time</label>
                                <input
                                  type="time"
                                  value={leg.departureTime || ''}
                                  onChange={(e) => {
                                    const newVal = e.target.value;
                                    setSelectedLoad(prev => ({
                                      ...prev,
                                      legs: prev.legs.map(l => l.id === leg.id ? { ...l, departureTime: newVal } : l)
                                    }));
                                  }}
                                  className="w-full px-3 py-2 border rounded-xl text-sm dark:bg-slate-900 dark:text-white"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => handleUpdateTimes(leg.id, leg.arrivalTime, leg.departureTime)}
                              disabled={updating}
                              className="mt-2 w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50"
                            >
                              {updating ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />}
                              Update Times
                            </button>
                          </div>
                          {/* ---- END TIME INPUTS ---- */}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // ========== LOAD LIST VIEW ==========
          <>
            <div className="mb-6">
              <h2 className="text-sm font-black text-slate-400 uppercase tracking-wider mb-3">Active Dispatches ({activeLoads.length})</h2>
              
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
                    
                    return (
                      <div key={load.id} onClick={() => setSelectedLoad(load)} className="bg-white dark:bg-slate-800 rounded-2xl border p-4 shadow-sm active:scale-[0.98] cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-black text-lg">{load.containerNo}</div>
                            <div className="text-xs text-slate-400">{load.workOrderNo}</div>
                          </div>
                          <span className="text-[10px] font-black px-2 py-1 rounded-full bg-blue-100 text-blue-700">
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
          </>
        )}
      </main>
      
      
      {/* POD / EIR Modal */}
{showPODModal && selectedLeg && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowPODModal(false)}>
    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
      <h3 className="font-black text-lg mb-2">
        {podData.isEIR ? '📄 Equipment Interchange Report (EIR)' : '📋 Proof of Delivery'}
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        {getLegTypeLabel(selectedLeg.legType)}: {formatLocation(selectedLeg.from)} → {formatLocation(selectedLeg.to)}
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">
            {podData.isEIR ? 'EIR Number *' : 'Receiver Name *'}
          </label>
          <input 
            type="text" 
            value={podData.receiverName} 
            onChange={e => setPodData(p => ({ ...p, receiverName: e.target.value }))} 
            className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-slate-900 dark:text-white" 
            required 
            placeholder={podData.isEIR ? 'Enter EIR number' : 'Enter receiver name'}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">
            {podData.isEIR ? 'EIR Photo' : 'POD Photo'}
          </label>
          {podData.photo ? (
            <div className="relative">
              <img src={podData.photo} alt={podData.isEIR ? 'EIR' : 'POD'} className="w-full h-40 object-cover rounded-xl" />
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
          <button onClick={() => { setShowPODModal(false); setPodData({ photo: null, receiverName: '', legId: null, isEIR: false }); }} 
            className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-sm">Cancel</button>
          <button onClick={handlePODSubmit} disabled={updating} 
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-50">
            {updating ? 'Uploading...' : podData.isEIR ? 'Submit EIR' : 'Submit POD'}
          </button>
        </div>
      </div>
    </div>
  </div>
)}
      
      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowPayModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-black text-lg">💰 Pay Details</h3>
              <button onClick={() => setShowPayModal(false)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={20} /></button>
            </div>
            <div className="pt-3 border-t dark:border-slate-700">
              <div className="flex justify-between items-center font-bold">
                <span>Total Earnings</span>
                <span className="text-emerald-600">${totalEarnings.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center font-bold mt-2">
                <span>Pending</span>
                <span className="text-amber-600">${pendingPayments.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Chat Modal */}
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
      
      {/* Session Timeout Warning Modal */}
      {showTimeoutWarning && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
            <h3 className="font-black text-lg text-slate-800 mb-2">Session Expiring Soon</h3>
            <p className="text-sm text-slate-500 mb-6">
              You will be automatically logged out in 5 minutes due to inactivity.
            </p>
            <button 
              onClick={() => {
                resetDriverInactivityTimer();
                setShowTimeoutWarning(false);
              }}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
            >
              I'm Still Here
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverApp;