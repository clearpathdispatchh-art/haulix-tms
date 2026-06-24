// src/components/UserManagement.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { UserPlus, X, ShieldCheck, Loader2, Trash2, AlertTriangle, Eye, EyeOff } from "lucide-react";

// ========== HELPERS ==========
const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return emailRegex.test(email);
};

const logError = (context, error, metadata = {}) => {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[UserManagement][${context}]`, {
      message: error?.message || error,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  } else {
    console.error(`[UserManagement][${context}]`, error, metadata);
  }
};

// ========== MAIN COMPONENT ==========
const UserManagement = ({ isOpen, onClose, companyId, currentUserUid, userRole }) => {
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("dispatcher");
  const [tempPassword, setTempPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info"); // 'success' | 'error' | 'info'
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const messageTimerRef = React.useRef(null);

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // FIXED: Get Firebase app instance for getFunctions()
  const app = useMemo(() => {
    try {
      return getApp();
    } catch {
      return null;
    }
  }, []);

  // FIXED: Auto-dismiss messages
  const showMessage = useCallback((text, type = 'info') => {
    setMessage(text);
    setMessageType(type);
    
    // Clear previous timer
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
    }
    
    // Auto-dismiss success messages after 5 seconds
    if (type === 'success') {
      messageTimerRef.current = setTimeout(() => {
        setMessage('');
      }, 5000);
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    if (!companyId || !app) return;
    setLoading(true);
    try {
      const functions = getFunctions(app);
      const getTeamMembersFn = httpsCallable(functions, 'getTeamMembers');
      const result = await getTeamMembersFn({ companyId });
      if (result.data.success) {
        setTeamMembers(result.data.members || []);
      }
    } catch (error) {
      logError('fetchTeamMembers', error);
      showMessage("Failed to load team members", "error");
    } finally {
      setLoading(false);
    }
  }, [companyId, app, showMessage]);

  useEffect(() => {
    if (isOpen) {
      fetchTeamMembers();
    }
  }, [isOpen, fetchTeamMembers]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    
    // FIXED: Better validation
    if (!inviteEmail.trim()) {
      showMessage("Email address is required.", "error");
      return;
    }
    
    if (!isValidEmail(inviteEmail.trim())) {
      showMessage("Please enter a valid email address.", "error");
      return;
    }
    
    if (!tempPassword || tempPassword.length < 6) {
      showMessage("Password must be at least 6 characters.", "error");
      return;
    }
    
    if (!['dispatcher', 'accounting', 'admin'].includes(inviteRole)) {
      showMessage("Invalid role selected.", "error");
      return;
    }
    
    setAddingUser(true);
    setMessage("");
    
    try {
      // FIXED: Pass app instance
      const functions = getFunctions(app);
      const createTeamMemberFn = httpsCallable(functions, 'createTeamMember');
      const result = await createTeamMemberFn({ 
        email: inviteEmail.trim(), 
        password: tempPassword, 
        role: inviteRole, 
        companyId 
      });
      
      if (result.data.success) {
        showMessage(`✅ ${inviteEmail} added as ${inviteRole}`, "success");
        setInviteEmail("");
        setTempPassword("");
        setShowPassword(false);
        setInviteRole("dispatcher");
        fetchTeamMembers();
      } else {
        showMessage(`❌ Failed: ${result.data.error || 'Unknown error'}`, "error");
      }
    } catch (error) {
      logError('handleAddUser', error, { email: inviteEmail });
      const errorMsg = error.details?.message || error.message || "Failed to add user";
      showMessage(`❌ ${errorMsg}`, "error");
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (uid, email) => {
    setDeleteConfirm(null);
    setMessage("");
    
    try {
      const functions = getFunctions(app);
      const deleteTeamMemberFn = httpsCallable(functions, 'deleteTeamMember');
      const result = await deleteTeamMemberFn({ targetUid: uid, companyId });
      
      if (result.data.success) {
        showMessage(`✅ ${email} removed successfully`, "success");
        fetchTeamMembers();
      } else {
        showMessage(`❌ Failed to delete user: ${result.data.error || 'Unknown error'}`, "error");
      }
    } catch (error) {
      logError('handleDeleteUser', error, { uid });
      const errorMsg = error.details?.message || error.message || "Failed to delete user";
      showMessage(`❌ ${errorMsg}`, "error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2 rounded-xl text-white">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-900">User Management</h2>
              <p className="text-xs text-slate-500">Manage team members and their roles</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* FIXED: Message with type-based styling */}
          {message && (
            <div className={`mb-4 p-3 rounded-xl text-xs font-bold flex items-center justify-between ${
              messageType === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 
              messageType === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 
              'bg-blue-50 text-blue-700 border border-blue-100'
            }`}>
              <span>{message}</span>
              {messageType === 'error' && (
                <button onClick={() => setMessage('')} className="text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Add User Form - Only for admins */}
            {isAdmin ? (
              <div className="bg-slate-50 p-6 rounded-2xl">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-purple-600" />
                  Add New Team Member
                </h3>
                <form onSubmit={handleAddUser} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      Email address
                    </label>
                    <input 
                      type="email" 
                      required 
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-purple-200" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)} 
                      placeholder="newuser@company.com" 
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      Temporary password
                    </label>
                    {/* FIXED: Password visibility toggle */}
                    <div className="relative">
                      <input 
                        type={showPassword ? "text" : "password"}
                        required 
                        className="w-full px-4 py-2.5 pr-12 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-purple-200" 
                        value={tempPassword} 
                        onChange={e => setTempPassword(e.target.value)} 
                        placeholder="Minimum 6 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      User should change password after first login
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      Role
                    </label>
                    <select 
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-purple-200" 
                      value={inviteRole} 
                      onChange={e => setInviteRole(e.target.value)}
                    >
                      <option value="dispatcher">Dispatcher - Operations only</option>
                      <option value="accounting">Accounting - Billing & Financial</option>
                      <option value="admin">Admin - Full access</option>
                    </select>
                  </div>
                  <button 
                    type="submit" 
                    disabled={addingUser} 
                    className="w-full py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addingUser ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</>
                    ) : (
                      'Add Team Member'
                    )}
                  </button>
                </form>
              </div>
            ) : (
              <div className="bg-slate-50 p-6 rounded-2xl flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-bold">Admin access required</p>
                  <p className="text-xs mt-1">Only owners and admins can manage team members</p>
                </div>
              </div>
            )}
            
            {/* Team Members List */}
            <div className="bg-slate-50 p-6 rounded-2xl">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                Team Members ({teamMembers.length})
              </h3>
              
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                </div>
              ) : teamMembers.length === 0 ? (
                <p className="text-slate-400 text-sm italic py-4">No team members found.</p>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {teamMembers.map(member => (
                    <div 
                      key={member.uid} 
                      className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                          member.role === 'owner' ? 'bg-yellow-500' : 
                          member.role === 'admin' ? 'bg-purple-500' : 
                          member.role === 'accounting' ? 'bg-green-500' : 
                          'bg-blue-500'
                        }`}>
                          {member.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-sm">
                            {member.email}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              member.role === 'owner' ? 'bg-yellow-100 text-yellow-700' : 
                              member.role === 'admin' ? 'bg-purple-100 text-purple-700' : 
                              member.role === 'accounting' ? 'bg-green-100 text-green-700' : 
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {member.role}
                            </span>
                            {member.uid === currentUserUid && (
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                YOU
                              </span>
                            )}
                            {/* FIXED: Show setup status */}
                            {member.setupComplete === false && (
                              <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                                Setup Pending
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Delete button - only for admins, not self, not owner */}
                      {isAdmin && member.uid !== currentUserUid && member.role !== 'owner' && (
                        <button 
                          onClick={() => setDeleteConfirm(member)} 
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" 
                          title="Remove user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)}></div>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl relative z-10 p-6 animate-in zoom-in-95">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="font-black text-slate-900 mb-2">Remove Team Member?</h3>
              <p className="text-sm text-slate-500 mb-6">
                Are you sure you want to remove <strong>{deleteConfirm.email}</strong>? 
                This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeleteConfirm(null)} 
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDeleteUser(deleteConfirm.uid, deleteConfirm.email)} 
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;