// src/firebase.js - VITE COMPATIBLE

import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'; // ✅ ADD initializeFirestore
import { 
  getAuth, 
  connectAuthEmulator, 
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

// ========== FIREBASE CONFIGURATION ==========
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAuFs4eLaP8Pug6RSde07OXu_mofd0IfYs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "haulix-tms.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "haulix-tms",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "haulix-tms.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "864718858606",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:864718858606:web:ea068d9ea1a5cdacb9f97f"
};

// ========== SINGLETON INITIALIZATION ==========
const GLOBAL_KEY = '__HAULIX_FIREBASE__';

const getOrCreateFirebaseApp = () => {
  if (typeof window === 'undefined') return null;
  if (window[GLOBAL_KEY]?.app) return window[GLOBAL_KEY].app;
  let app;
  if (getApps().length > 0) {
    app = getApp();
  } else {
    app = initializeApp(firebaseConfig);
  }
  return app;
};

const firebaseApp = getOrCreateFirebaseApp();

// ========== SERVICE INITIALIZATION ==========
const getFirebaseServices = () => {
  if (typeof window === 'undefined') {
    return { db: null, auth: null, storage: null, app: null };
  }

  if (window[GLOBAL_KEY]?.db && window[GLOBAL_KEY]?.auth && window[GLOBAL_KEY]?.storage) {
    return window[GLOBAL_KEY];
  }

  if (!firebaseApp) {
    console.error('Firebase app not initialized');
    return { db: null, auth: null, storage: null, app: null };
  }

  // ✅ NEW: Initialize Firestore with cache settings (replaces enableIndexedDbPersistence)
  const db = initializeFirestore(firebaseApp, {
    cache: {
      kind: 'persistent',  // This replaces enableIndexedDbPersistence()
      tabManager: { kind: 'auto' }  // Handles multiple tabs automatically
    }
  });

  const auth = getAuth(firebaseApp);
  
  // Auth persistence - keeps user logged in
  setPersistence(auth, browserLocalPersistence).catch(err => {
    console.warn('Auth persistence warning:', err);
  });
  
  const storage = getStorage(firebaseApp);

  // Emulator support (only in development)
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
    try {
      connectFirestoreEmulator(db, 'localhost', 8080);
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectStorageEmulator(storage, 'localhost', 9199);
      console.log('🔧 Connected to Firebase emulators');
    } catch (error) {
      console.warn('Failed to connect to emulators:', error.message);
    }
  }

  window[GLOBAL_KEY] = Object.freeze({
    firebaseApp,
    db,
    auth,
    storage
  });

  return window[GLOBAL_KEY];
};

// ========== EXPORTS ==========
const services = getFirebaseServices();

export const db = services.db;
export const auth = services.auth;
export const storage = services.storage;
export const app = services.firebaseApp;

export { getFirebaseServices };

export default app;