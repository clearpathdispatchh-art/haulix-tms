// src/components/AdminDashboard.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, query, orderBy, onSnapshot, doc, updateDoc, getDoc 
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { 
  Building, Users, DollarSign, Calendar, CheckCircle, XCircle,
  Clock, Search, TrendingUp, AlertCircle, RefreshCw, Truck, ShieldAlert
} from 'lucide-react';
import { db, auth } from '../firebase.js';



// FIXED: Moved helpers outside component to prevent re-creation
const getDaysLeft = (date) => {
  if (!date) return null;
  const days = Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
  return days;
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  try {
    const dateObj = date?.toDate ? date.toDate() : new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return dateObj.toLocaleDateString('en-US', { 
      year: 'numeric', month: 'short', day: 'numeric' 
    });
  } catch {
    return 'Invalid Date';
  }
};

const logError = (context, error, metadata = {}) => {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[AdminDashboard][${context}]`, {
      message: error?.message || error,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  } else {
    console.error(`[AdminDashboard][${context}]`, error, metadata);
  }
};

const AdminDashboard = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPaid, setFilterPaid] = useState('all');
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');
  
  // FIXED: Admin authentication state
  const [adminUser, setAdminUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);



  // FIXED: Check authentication and admin role
  useEffect(() => {
    if (!auth) {
      setAuthChecking(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAdminUser(null);
        setIsAdmin(false);
        setAuthChecking(false);
        return;
      }

      setAdminUser(user);

      try {
        // Check if user is a platform admin (not just company admin)
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          // FIXED: Check for platform admin role (different from company admin)
          const isPlatformAdmin = userData.platformRole === 'admin' || 
                                   userData.isPlatformAdmin === true;
          setIsAdmin(isPlatformAdmin);
          
          if (!isPlatformAdmin) {
            setError('Access denied. Platform admin privileges required.');
          }
        } else {
          setIsAdmin(false);
          setError('User profile not found.');
        }
      } catch (err) {
        logError('authCheck', err);
        setIsAdmin(false);
        setError('Failed to verify admin status.');
      }
      
      setAuthChecking(false);
    });

    return () => unsubscribe();
  }, [auth, db]);

  // Load all companies (only if admin)
  useEffect(() => {
    if (!db || !isAdmin) return;

    const q = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const companiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          paymentStatus: doc.data().paymentStatus || 'trial',
          trialEndsAt: doc.data().trialEndsAt || null,
          nextPaymentDate: doc.data().nextPaymentDate || null,
          subscriptionActive: doc.data().subscriptionActive !== false,
          monthlyAmount: doc.data().monthlyAmount || 200,
          currency: doc.data().currency || 'CAD'
        }));
        setCompanies(companiesData);
        setLoading(false);
      },
      (error) => {
        logError('companiesListener', error);
        setError('Failed to load companies. Please refresh.');
        setLoading(false);
      }
    );
    
    return () => unsubscribe();
  }, [db, isAdmin]);

  // Activate free trial (30 days)
  const activateTrial = useCallback(async (companyId) => {
    if (!db) return;
    setUpdating(companyId);
    setError('');
    try {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);
      await updateDoc(doc(db, 'companies', companyId), {
        paymentStatus: 'trial',
        trialEndsAt: trialEnd.toISOString(),
        subscriptionActive: true
      });
    } catch (error) {
      logError('activateTrial', error, { companyId });
      setError(`Failed to activate trial: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Mark as paid
  const markAsPaid = useCallback(async (companyId) => {
    if (!db) return;
    setUpdating(companyId);
    setError('');
    try {
      const nextPayment = new Date();
      nextPayment.setMonth(nextPayment.getMonth() + 1);
      await updateDoc(doc(db, 'companies', companyId), {
        paymentStatus: 'paid',
        lastPaymentDate: new Date().toISOString(),
        nextPaymentDate: nextPayment.toISOString(),
        subscriptionActive: true,
        trialEndsAt: null
      });
    } catch (error) {
      logError('markAsPaid', error, { companyId });
      setError(`Failed to mark as paid: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Suspend company (FIXED: Added confirmation via window.confirm)
  const suspendCompany = useCallback(async (companyId) => {
    if (!db) return;
    
    // FIXED: Confirmation dialog
    const company = companies.find(c => c.id === companyId);
    const confirmed = window.confirm(
      `Are you sure you want to suspend "${company?.name || 'this company'}"?\n\nThis will block all users from accessing the application.`
    );
    if (!confirmed) return;
    
    setUpdating(companyId);
    setError('');
    try {
      await updateDoc(doc(db, 'companies', companyId), {
        paymentStatus: 'suspended',
        subscriptionActive: false
      });
    } catch (error) {
      logError('suspendCompany', error, { companyId });
      setError(`Failed to suspend company: ${error.message}`);
    }
    setUpdating(null);
  }, [db, companies]);

  // Extend trial by 7 days
  const extendTrial = useCallback(async (companyId, currentEndDate) => {
    if (!db) return;
    setUpdating(companyId);
    setError('');
    try {
      const newEnd = new Date(currentEndDate || Date.now());
      newEnd.setDate(newEnd.getDate() + 7);
      await updateDoc(doc(db, 'companies', companyId), {
        trialEndsAt: newEnd.toISOString()
      });
    } catch (error) {
      logError('extendTrial', error, { companyId });
      setError(`Failed to extend trial: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Filter and search
  const filteredCompanies = useMemo(() => {
    return companies.filter(company => {
      const matchesSearch = !searchTerm || 
        (company.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      if (filterPaid === 'all') return matchesSearch;
      if (filterPaid === 'paid') return matchesSearch && company.paymentStatus === 'paid';
      if (filterPaid === 'trial') return matchesSearch && company.paymentStatus === 'trial';
      if (filterPaid === 'suspended') return matchesSearch && company.paymentStatus === 'suspended';
      return matchesSearch;
    });
  }, [companies, searchTerm, filterPaid]);

  // Stats (FIXED: Use actual monthly amounts instead of hardcoded $200)
  const stats = useMemo(() => {
    const total = companies.length;
    const paid = companies.filter(c => c.paymentStatus === 'paid').length;
    const trial = companies.filter(c => c.paymentStatus === 'trial').length;
    const suspended = companies.filter(c => c.paymentStatus === 'suspended').length;
    // FIXED: Sum actual monthly amounts
    const monthlyRevenue = companies
      .filter(c => c.paymentStatus === 'paid')
      .reduce((sum, c) => sum + (c.monthlyAmount || 200), 0);
    const trialEndingSoon = companies.filter(c => {
      if (c.paymentStatus !== 'trial' || !c.trialEndsAt) return false;
      const daysLeft = getDaysLeft(c.trialEndsAt);
      return daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
    }).length;
    return { total, paid, trial, suspended, monthlyRevenue, trialEndingSoon };
  }, [companies]);

  // FIXED: Loading state for auth check
  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // FIXED: Access denied state
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500 mb-6">
            {error || 'You do not have permission to access the admin dashboard.'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {/* FIXED: Error banner */}
      {error && (
        <div className="max-w-7xl mx-auto mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-bold text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900">🛡️ Admin Dashboard</h1>
            <p className="text-slate-500 mt-1">Manage companies, payments, and subscriptions</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Monthly Revenue</div>
            <div className="text-3xl font-black text-green-600">${stats.monthlyRevenue.toLocaleString()}</div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <Building className="w-6 h-6 text-blue-600 mb-2" />
            <div className="text-2xl font-black">{stats.total}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Companies</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <CheckCircle className="w-6 h-6 text-green-600 mb-2" />
            <div className="text-2xl font-black">{stats.paid}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Paid</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <Clock className="w-6 h-6 text-yellow-600 mb-2" />
            <div className="text-2xl font-black">{stats.trial}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Trial</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <AlertCircle className="w-6 h-6 text-red-600 mb-2" />
            <div className="text-2xl font-black">{stats.trialEndingSoon}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Ending Soon</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <XCircle className="w-6 h-6 text-slate-600 mb-2" />
            <div className="text-2xl font-black">{stats.suspended}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Suspended</div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'paid', 'trial', 'suspended'].map(filter => (
              <button
                key={filter}
                onClick={() => setFilterPaid(filter)}
                className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all ${
                  filterPaid === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-500 border hover:border-blue-300'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Companies Table */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-black text-slate-400 uppercase">
                  <th className="px-6 py-4">Company</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Registered</th>
                  <th className="px-6 py-4">Trial Ends</th>
                  <th className="px-6 py-4">Next Payment</th>
                  <th className="px-6 py-4">Last Payment</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCompanies.map(company => {
                  const daysLeft = company.trialEndsAt ? getDaysLeft(company.trialEndsAt) : null;
                  const isTrialExpired = daysLeft !== null && daysLeft <= 0;
                  
                  return (
                    <tr key={company.id} className="hover:bg-slate-50 text-sm">
                      <td className="px-6 py-4">
                        {/* FIXED: Removed company ID from UI */}
                        <div className="font-bold text-slate-900">{company.name || 'Unnamed Company'}</div>
                        <div className="text-xs text-slate-400">
                          {company.locations?.length || 0} location{company.locations?.length !== 1 ? 's' : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black uppercase ${
                          company.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
                          company.paymentStatus === 'trial' ? (isTrialExpired ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700') :
                          company.paymentStatus === 'suspended' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {company.paymentStatus}
                          {company.paymentStatus === 'trial' && daysLeft !== null && (
                            <span className="ml-1">({daysLeft > 0 ? `${daysLeft}d left` : 'Expired'})</span>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {formatDate(company.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {company.paymentStatus === 'trial' ? formatDate(company.trialEndsAt) : '-'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {company.paymentStatus === 'paid' ? formatDate(company.nextPaymentDate) : '-'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {company.lastPaymentDate ? formatDate(company.lastPaymentDate) : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {company.paymentStatus !== 'paid' && company.paymentStatus !== 'suspended' && (
                            <button
                              onClick={() => markAsPaid(company.id)}
                              disabled={updating === company.id}
                              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-50"
                            >
                              {updating === company.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                          {(company.paymentStatus === 'trial' || !company.trialEndsAt) && (
                            <button
                              onClick={() => {
                                if (company.trialEndsAt) {
                                  extendTrial(company.id, company.trialEndsAt);
                                } else {
                                  activateTrial(company.id);
                                }
                              }}
                              disabled={updating === company.id}
                              className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-xs font-bold hover:bg-yellow-700 disabled:opacity-50"
                            >
                              {updating === company.id ? '...' : company.trialEndsAt ? '+7 Days' : '30-Day Trial'}
                            </button>
                          )}
                          {company.subscriptionActive && (
                            <button
                              onClick={() => suspendCompany(company.id)}
                              disabled={updating === company.id}
                              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 disabled:opacity-50"
                            >
                              {updating === company.id ? '...' : 'Suspend'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCompanies.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-slate-400 font-bold">
                      No companies found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;