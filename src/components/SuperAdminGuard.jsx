// SuperAdminGuard.jsx
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ShieldAlert, RefreshCw } from 'lucide-react';

const SuperAdminGuard = ({ children }) => {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAuthorized(false);
        setIsLoading(false);
        return;
      }

      try {
        // 1) Hardcoded super admin UID (matches your Firestore document)
        const SUPER_ADMIN_UID = 'UFbOqd1GElPJnrTZiJrhZEwB5uz1';
        if (user.uid === SUPER_ADMIN_UID) {
          setIsAuthorized(true);
          setIsLoading(false);
          return;
        }

        // 2) Fallback: check Firestore for platform admin flags
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.isPlatformAdmin === true || data.platformRole === 'super_admin') {
            setIsAuthorized(true);
          } else {
            setIsAuthorized(false);
          }
        } else {
          setIsAuthorized(false);
        }
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAuthorized(false);
      }
      
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500">
            You do not have super admin privileges. Only the platform owner can access this area.
          </p>
        </div>
      </div>
    );
  }

  return children;
};

export default SuperAdminGuard;