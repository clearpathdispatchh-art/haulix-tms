import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, query, orderBy, onSnapshot, doc, updateDoc, getDoc, addDoc, deleteDoc, serverTimestamp, where, writeBatch, setDoc
} from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
  Building, Users, DollarSign, Calendar, CheckCircle, XCircle,
  Clock, Search, TrendingUp, AlertCircle, RefreshCw, Truck, ShieldAlert,
  UserPlus, Power, Trash2, CreditCard, Ban, Activity, Settings, LogOut, Plus
} from 'lucide-react';
import { db, auth } from '../firebase.js';

// Helper functions (keep these from your original)
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

const AdminDashboard = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPaid, setFilterPaid] = useState('all');
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');
  
  // Super admin authentication
  const [adminUser, setAdminUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // New company form state
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [newCompany, setNewCompany] = useState({
    name: '',
    adminEmail: '',
    adminPassword: '',
    locations: [{ name: 'Headquarters', address: '', city: '', province: '', postalCode: '' }],
    dataSharingMode: 'separate'
  });

  // Payment tracking
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(200);
  const [paymentNotes, setPaymentNotes] = useState('');

  // SUPER ADMIN UID - Replace with YOUR Firebase Auth UID
  const SUPER_ADMIN_UID = "UFbOqd1GElPJnrTZiJrhZEwB5uz1";

  // Check authentication
  useEffect(() => {
    if (!auth) {
      setAuthChecking(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAdminUser(null);
        setIsSuperAdmin(false);
        setAuthChecking(false);
        return;
      }

      setAdminUser(user);

      console.log("🔥 SUPER ADMIN CHECK");


      // Check if user is the SUPER ADMIN
      if (user.uid === SUPER_ADMIN_UID) {
        setIsSuperAdmin(true);
      } else {
        // Also check if user has platform admin role
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.platformRole === 'super_admin' || userData.isPlatformAdmin === true) {
              setIsSuperAdmin(true);
            } else {
              setIsSuperAdmin(false);
              setError('Access denied. Super admin privileges required.');
            }
          } else {
            setIsSuperAdmin(false);
            setError('User profile not found.');
          }
        } catch (err) {
          console.error('Auth check error:', err);
          setIsSuperAdmin(false);
          setError('Failed to verify admin status.');
        }
      }
      
      setAuthChecking(false);
    });

    return () => unsubscribe();
  }, []);

  // Load all companies
  useEffect(() => {
    if (!db || !isSuperAdmin) return;

    const q = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const companiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          paymentStatus: doc.data().paymentStatus || 'trial',
          trialEndsAt: doc.data().trialEndsAt || null,
          subscriptionActive: doc.data().subscriptionActive !== false,
          monthlyAmount: doc.data().monthlyAmount || 200,
          currency: doc.data().currency || 'USD'
        }));
        setCompanies(companiesData);
        setLoading(false);
      },
      (error) => {
        console.error('Companies listener error:', error);
        setError('Failed to load companies.');
        setLoading(false);
      }
    );
    
    return () => unsubscribe();
  }, [db, isSuperAdmin]);

  // ==========================================
  // CREATE COMPANY USING CLOUD FUNCTION
  // ==========================================
  const createNewCompany = useCallback(async (e) => {
    e.preventDefault();
    if (!db || !auth) return;

    setUpdating('creating');
    setError('');

    try {
      const functions = getFunctions();
      const createCompanyFn = httpsCallable(functions, 'createCompany');
      
      const result = await createCompanyFn({
        companyName: newCompany.name,
        adminEmail: newCompany.adminEmail,
        adminPassword: newCompany.adminPassword,
        locations: newCompany.locations.map(loc => ({
          id: crypto.randomUUID(),
          name: loc.name,
          address: loc.address,
          city: loc.city,
          province: loc.province,
          postalCode: loc.postalCode
        })),
        dataSharingMode: newCompany.dataSharingMode
      });

      // Reset form
      setNewCompany({
        name: '',
        adminEmail: '',
        adminPassword: '',
        locations: [{ name: 'Headquarters', address: '', city: '', province: '', postalCode: '' }],
        dataSharingMode: 'separate'
      });
      setShowNewCompanyModal(false);
      setError('');
      console.log("Company created:", result.data);
    } catch (error) {
      console.error('Create company error:', error);
      setError(`Failed to create company: ${error.message}`);
    }

    setUpdating(null);
  }, [newCompany, adminUser, db, auth]);

  // Activate trial (30 days)
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
      setError(`Failed to activate trial: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Record payment
  const recordPayment = useCallback(async (companyId) => {
    if (!db) return;
    setUpdating(companyId);
    setError('');
    try {
      const nextPayment = new Date();
      nextPayment.setMonth(nextPayment.getMonth() + 1);
      
      await updateDoc(doc(db, 'companies', companyId), {
        paymentStatus: 'paid',
        lastPaymentDate: new Date().toISOString(),
        lastPaymentAmount: paymentAmount,
        lastPaymentNotes: paymentNotes,
        nextPaymentDate: nextPayment.toISOString(),
        subscriptionActive: true,
        trialEndsAt: null
      });
      
      setShowPaymentModal(false);
      setPaymentAmount(200);
      setPaymentNotes('');
      setSelectedCompany(null);
    } catch (error) {
      setError(`Failed to record payment: ${error.message}`);
    }
    setUpdating(null);
  }, [db, paymentAmount, paymentNotes]);

  // Suspend company
  const suspendCompany = useCallback(async (companyId) => {
    if (!db) return;
    
    const company = companies.find(c => c.id === companyId);
    const confirmed = window.confirm(
      `Are you sure you want to suspend "${company?.name}"?\n\nThis will block ALL users from accessing the application.`
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
      setError(`Failed to suspend company: ${error.message}`);
    }
    setUpdating(null);
  }, [db, companies]);

  // Reactivate company
  const reactivateCompany = useCallback(async (companyId) => {
    if (!db) return;
    setUpdating(companyId);
    setError('');
    try {
      await updateDoc(doc(db, 'companies', companyId), {
        paymentStatus: 'trial',
        subscriptionActive: true,
        trialEndsAt: null
      });
    } catch (error) {
      setError(`Failed to reactivate company: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Delete company permanently
  const deleteCompany = useCallback(async (companyId) => {
    if (!db) return;
    
    const company = companies.find(c => c.id === companyId);
    const confirmed = window.confirm(
      `⚠️ PERMANENTLY DELETE "${company?.name}"?\n\nThis will delete:\n- All company data\n- All loads, customers, drivers\n- All user accounts\n\nThis CANNOT be undone!`
    );
    if (!confirmed) return;
    
    const doubleConfirmed = window.confirm(
      `Type "DELETE" to confirm permanent deletion of ${company?.name}:`
    );
    if (doubleConfirmed !== 'DELETE' && doubleConfirmed !== true) {
      if (typeof doubleConfirmed === 'string' && doubleConfirmed !== 'DELETE') {
        setError('Deletion cancelled. Type "DELETE" to confirm.');
        return;
      }
    }
    
    setUpdating(companyId);
    setError('');
    try {
      await deleteDoc(doc(db, 'companies', companyId));
      setError('Company deleted. Run cleanup function to remove all subcollections.');
    } catch (error) {
      setError(`Failed to delete company: ${error.message}`);
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
      setError(`Failed to extend trial: ${error.message}`);
    }
    setUpdating(null);
  }, [db]);

  // Filtered companies
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

  // Stats
  const stats = useMemo(() => {
    const total = companies.length;
    const paid = companies.filter(c => c.paymentStatus === 'paid').length;
    const trial = companies.filter(c => c.paymentStatus === 'trial').length;
    const suspended = companies.filter(c => c.paymentStatus === 'suspended').length;
    const monthlyRevenue = companies
      .filter(c => c.paymentStatus === 'paid')
      .reduce((sum, c) => sum + (c.monthlyAmount || 200), 0);
    const trialEndingSoon = companies.filter(c => {
      if (c.paymentStatus !== 'trial' || !c.trialEndsAt) return false;
      const daysLeft = getDaysLeft(c.trialEndsAt);
      return daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
    }).length;
    const paymentDue = companies.filter(c => {
      if (c.paymentStatus !== 'paid' || !c.nextPaymentDate) return false;
      const daysLeft = getDaysLeft(c.nextPaymentDate);
      return daysLeft !== null && daysLeft <= 7;
    }).length;
    return { total, paid, trial, suspended, monthlyRevenue, trialEndingSoon, paymentDue };
  }, [companies]);

  // Handle logout
  const handleLogout = async () => {
    await signOut(auth);
  };

  // Loading state
  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // Access denied
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500 mb-6">
            {error || 'You do not have permission to access the admin dashboard.'}
          </p>
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
      {/* Error banner */}
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
            <h1 className="text-3xl font-black text-slate-900">🛡️ Super Admin Dashboard</h1>
            <p className="text-slate-500 mt-1">Complete platform control</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-slate-500">Monthly Revenue</div>
              <div className="text-3xl font-black text-green-600">US${stats.monthlyRevenue.toLocaleString()}</div>
            </div>
            <button
              onClick={() => setShowNewCompanyModal(true)}
              className="flex items-center gap-2 px-5 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors shadow-lg"
            >
              <Plus className="w-5 h-5" />
              Add New Company
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
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
            <XCircle className="w-6 h-6 text-red-600 mb-2" />
            <div className="text-2xl font-black">{stats.suspended}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Suspended</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <AlertCircle className="w-6 h-6 text-orange-600 mb-2" />
            <div className="text-2xl font-black">{stats.trialEndingSoon}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Trial Ending</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <CreditCard className="w-6 h-6 text-purple-600 mb-2" />
            <div className="text-2xl font-black">{stats.paymentDue}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Payment Due</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border">
            <DollarSign className="w-6 h-6 text-emerald-600 mb-2" />
            <div className="text-2xl font-black">US${stats.monthlyRevenue.toLocaleString()}</div>
            <div className="text-xs text-slate-400 uppercase font-bold">Monthly Rev</div>
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
                  <th className="px-6 py-4">Created</th>
                  <th className="px-6 py-4">Trial Ends</th>
                  <th className="px-6 py-4">Next Payment</th>
                  <th className="px-6 py-4">Last Payment</th>
                  <th className="px-6 py-4">Monthly Fee</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCompanies.map(company => {
                  const daysLeft = company.trialEndsAt ? getDaysLeft(company.trialEndsAt) : null;
                  const isTrialExpired = daysLeft !== null && daysLeft <= 0;
                  const paymentDueDays = company.nextPaymentDate ? getDaysLeft(company.nextPaymentDate) : null;
                  const isPaymentDue = paymentDueDays !== null && paymentDueDays <= 7 && paymentDueDays > 0;
                  const isPaymentOverdue = paymentDueDays !== null && paymentDueDays <= 0;
                  
                  return (
                    <tr key={company.id} className="hover:bg-slate-50 text-sm">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">{company.name || 'Unnamed Company'}</div>
                        <div className="text-xs text-slate-400">
                          {company.locations?.length || 0} location{(company.locations?.length || 0) !== 1 ? 's' : ''}
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
                        {isPaymentDue && (
                          <span className="ml-2 text-xs font-bold text-orange-600">⚠️ Due in {paymentDueDays}d</span>
                        )}
                        {isPaymentOverdue && company.paymentStatus === 'paid' && (
                          <span className="ml-2 text-xs font-bold text-red-600">🔴 Overdue</span>
                        )}
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
                      <td className="px-6 py-4 font-bold">
                        US${(company.monthlyAmount || 200).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {/* Record Payment */}
                          <button
                            onClick={() => {
                              setSelectedCompany(company);
                              setPaymentAmount(company.monthlyAmount || 200);
                              setShowPaymentModal(true);
                            }}
                            disabled={updating === company.id}
                            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-50"
                            title="Record Monthly Payment"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                          
                          {/* Activate/Extend Trial */}
                          {(company.paymentStatus === 'trial' || company.paymentStatus === 'suspended' || !company.trialEndsAt) && (
                            <button
                              onClick={() => {
                                if (company.paymentStatus === 'suspended') {
                                  reactivateCompany(company.id);
                                } else if (company.trialEndsAt) {
                                  extendTrial(company.id, company.trialEndsAt);
                                } else {
                                  activateTrial(company.id);
                                }
                              }}
                              disabled={updating === company.id}
                              className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-xs font-bold hover:bg-yellow-700 disabled:opacity-50"
                              title={company.paymentStatus === 'suspended' ? 'Reactivate' : company.trialEndsAt ? 'Extend +7 Days' : 'Start 30-Day Trial'}
                            >
                              <Clock className="w-3.5 h-3.5" />
                            </button>
                          )}
                          
                          {/* Suspend */}
                          {company.subscriptionActive && company.paymentStatus !== 'suspended' && (
                            <button
                              onClick={() => suspendCompany(company.id)}
                              disabled={updating === company.id}
                              className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-bold hover:bg-orange-700 disabled:opacity-50"
                              title="Suspend Company"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          
                          {/* Delete */}
                          <button
                            onClick={() => deleteCompany(company.id)}
                            disabled={updating === company.id}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 disabled:opacity-50"
                            title="Delete Company Permanently"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCompanies.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-slate-400 font-bold">
                      No companies found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Company Modal */}
      {showNewCompanyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowNewCompanyModal(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-purple-600 p-2 rounded-xl text-white"><Building className="w-5 h-5" /></div>
                <div>
                  <h2 className="font-black text-slate-900 text-lg">Add New Company</h2>
                  <p className="text-xs text-slate-500">Create company with 30-day free trial</p>
                </div>
              </div>
              <button onClick={() => setShowNewCompanyModal(false)} className="p-2 hover:bg-slate-200 rounded-lg"><XCircle className="w-5 h-5" /></button>
            </div>
            <form onSubmit={createNewCompany} className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="text-xs font-black text-slate-500 uppercase">Company Name *</label>
                <input
                  required
                  value={newCompany.name}
                  onChange={e => setNewCompany({...newCompany, name: e.target.value})}
                  className="w-full px-4 py-3 border rounded-xl text-sm font-bold mt-1"
                  placeholder="Acme Logistics Inc."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-black text-slate-500 uppercase">Admin Email *</label>
                  <input
                    required
                    type="email"
                    value={newCompany.adminEmail}
                    onChange={e => setNewCompany({...newCompany, adminEmail: e.target.value})}
                    className="w-full px-4 py-3 border rounded-xl text-sm font-bold mt-1"
                    placeholder="admin@company.com"
                  />
                </div>
                <div>
                  <label className="text-xs font-black text-slate-500 uppercase">Password *</label>
                  <input
                    required
                    type="password"
                    value={newCompany.adminPassword}
                    onChange={e => setNewCompany({...newCompany, adminPassword: e.target.value})}
                    className="w-full px-4 py-3 border rounded-xl text-sm font-bold mt-1"
                    placeholder="Min. 6 characters"
                    minLength={6}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-black text-slate-500 uppercase">Monthly Fee (USD)</label>
                <input
                  type="number"
                  value={200}
                  readOnly
                  className="w-full px-4 py-3 border rounded-xl text-sm font-bold mt-1 bg-slate-50"
                />
                <p className="text-xs text-slate-400 mt-1">$200 USD/month - Fixed rate</p>
              </div>
              <div className="flex gap-3 pt-4 border-t">
                <button type="button" onClick={() => setShowNewCompanyModal(false)} className="flex-1 py-3 border rounded-xl font-bold text-slate-500">Cancel</button>
                <button type="submit" disabled={updating === 'creating'} className="flex-[2] py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-50">
                  {updating === 'creating' ? 'Creating...' : 'Create Company + 30-Day Trial'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedCompany && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowPaymentModal(false)}></div>
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl relative z-10 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="font-black text-slate-900 text-lg">Record Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="p-2 hover:bg-slate-200 rounded-lg"><XCircle className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500">Company</label>
                <p className="font-black text-slate-900">{selectedCompany.name}</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">Amount (USD)</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-3 border rounded-xl text-sm font-bold mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">Notes</label>
                <input
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  className="w-full px-4 py-3 border rounded-xl text-sm mt-1"
                  placeholder="Payment method, reference, etc."
                />
              </div>
              <button
                onClick={() => recordPayment(selectedCompany.id)}
                disabled={updating === selectedCompany.id}
                className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50"
              >
                Confirm Payment - Next Due: {new Date(new Date().setMonth(new Date().getMonth() + 1)).toLocaleDateString()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;