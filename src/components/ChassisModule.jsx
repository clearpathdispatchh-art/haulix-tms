// components/ChassisModule.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Trash2, Edit3, X, Anchor, Calendar, Hash, FileText,
  CheckCircle, AlertCircle, Save, RefreshCw, MoreVertical, Filter,
  Printer, Download, Truck, Wrench, Clock, MapPin, User
} from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase.js';

const ChassisModule = ({ companyId, setFeedback, isAdmin, isDispatcher }) => {
  const [chassisList, setChassisList] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingChassis, setEditingChassis] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('all'); // 'all' | 'inactive' | 'outside'
  
  // ===== NEW FORM STATE =====
  const [formData, setFormData] = useState({
    name: '',
    type: '40ft',
    vin: '',
    year: '',
    licensePlate: '',
    tareWeight: '',
    tareWeightType: 'lbs',
    status: 'Active',
    location: 'Inside',
    moves: '',
    lifeCycle: 'Active',
    lastPreventiveMaintenance: '',
    nextPreventiveMaintenance: '',
    lastPreventiveMaintenance2: '',
    nextPreventiveMaintenance2: '',
    lastPreventiveMaintenance3: '',
    nextPreventiveMaintenance3: '',
    lastAnnualInspection: '',
    nextAnnualInspection: '',
    alignmentDate: '',
    notes: '',
    manufacturer: '',
    model: '',
    capacity: '',
    tireSize: '',
    axleCount: '',
    lastServiceDate: '',
    nextServiceDate: '',
    // ✅ NEW FIELD: Terminal chassis flag
    isTerminalChassis: false
  });

  // Real-time listener
  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'companies', companyId, 'chassis'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chassis = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setChassisList(chassis);
    });
    return () => unsubscribe();
  }, [companyId]);

  // ===== FILTER CHASSIS =====
  const filteredChassis = chassisList.filter(ch => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = ch.name?.toLowerCase().includes(search) ||
                          ch.vin?.toLowerCase().includes(search) ||
                          ch.licensePlate?.toLowerCase().includes(search) ||
                          ch.type?.toLowerCase().includes(search);
    
    if (viewMode === 'inactive') return matchesSearch && ch.status === 'Inactive';
    if (viewMode === 'outside') return matchesSearch && ch.location === 'Outside';
    return matchesSearch;
  });

  // ===== CHECK IF CHASSIS IS AVAILABLE =====
  const isChassisAvailable = useCallback(async (chassisId, chassisName, excludeLoadId = null) => {
    if (!companyId) return { available: false, reason: 'No company ID' };
    
    try {
      // Find the chassis document
      const chassisQuery = query(
        collection(db, 'companies', companyId, 'chassis'),
        where('name', '==', chassisName)
      );
      const chassisSnap = await getDocs(chassisQuery);
      
      if (chassisSnap.empty) {
        return { available: false, reason: 'Chassis not found' };
      }
      
      const chassisDoc = chassisSnap.docs[0];
      const chassisData = chassisDoc.data();
      
      // ✅ TERMINAL CHASSIS: Always available (can be assigned to multiple containers)
      if (chassisData.isTerminalChassis === true) {
        return { available: true, reason: 'Terminal chassis - can be shared', isTerminal: true };
      }
      
      // ✅ REGULAR CHASSIS: Check if already assigned to another active load
      const loadsQuery = query(
        collection(db, 'companies', companyId, 'loads'),
        where('chassisNumber', '==', chassisName),
        where('status', 'in', ['Open', 'Dispatched', 'In Transit', 'Delivered', 'Ready for Billing'])
      );
      const loadsSnap = await getDocs(loadsQuery);
      
      // If there's an active load using this chassis (and it's not the one we're editing)
      for (const loadDoc of loadsSnap.docs) {
        const loadId = loadDoc.id;
        if (excludeLoadId && loadId === excludeLoadId) continue; // Skip the load being edited
        
        // This is a different active load using this chassis
        const loadData = loadDoc.data();
        return { 
          available: false, 
          reason: `Chassis is already assigned to ${loadData.workOrderNo || loadData.containerNo || 'another active load'}`,
          loadId: loadId
        };
      }
      
      return { available: true, reason: 'Available' };
    } catch (error) {
      console.error('Error checking chassis availability:', error);
      return { available: false, reason: 'Error checking availability' };
    }
  }, [companyId]);

  // ===== SAVE CHASSIS =====
  const handleSaveChassis = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFeedback("❌ Chassis number is required");
      return;
    }
    
    try {
      const data = {
        ...formData,
        companyId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'companies', companyId, 'chassis'), data);
      setFeedback(`✅ Chassis ${formData.name} added successfully`);
      setShowAddModal(false);
      resetForm();
    } catch (error) {
      console.error('Error adding chassis:', error);
      setFeedback("❌ Failed to save chassis");
    }
  };

  // ===== UPDATE CHASSIS =====
  const handleUpdateChassis = async (e) => {
    e.preventDefault();
    if (!editingChassis?.id) return;
    
    try {
      const chassisRef = doc(db, 'companies', companyId, 'chassis', editingChassis.id);
      await updateDoc(chassisRef, {
        ...formData,
        updatedAt: new Date().toISOString()
      });
      setFeedback(`✅ Chassis ${formData.name} updated successfully`);
      setShowEditModal(false);
      setEditingChassis(null);
      resetForm();
    } catch (error) {
      console.error('Error updating chassis:', error);
      setFeedback("❌ Failed to update chassis");
    }
  };

  // ===== DELETE CHASSIS =====
  const handleDeleteChassis = async (id) => {
    if (!window.confirm('Delete this chassis? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'chassis', id));
      setFeedback("✅ Chassis deleted");
    } catch (error) {
      console.error('Error deleting chassis:', error);
      setFeedback("❌ Failed to delete chassis");
    }
  };

  // ===== OPEN EDIT MODAL =====
  const openEditModal = (chassis) => {
    setEditingChassis(chassis);
    setFormData({
      name: chassis.name || '',
      type: chassis.type || '40ft',
      vin: chassis.vin || '',
      year: chassis.year || '',
      licensePlate: chassis.licensePlate || '',
      tareWeight: chassis.tareWeight || '',
      tareWeightType: chassis.tareWeightType || 'lbs',
      status: chassis.status || 'Active',
      location: chassis.location || 'Inside',
      moves: chassis.moves || '',
      lifeCycle: chassis.lifeCycle || 'Active',
      lastPreventiveMaintenance: chassis.lastPreventiveMaintenance || '',
      nextPreventiveMaintenance: chassis.nextPreventiveMaintenance || '',
      lastPreventiveMaintenance2: chassis.lastPreventiveMaintenance2 || '',
      nextPreventiveMaintenance2: chassis.nextPreventiveMaintenance2 || '',
      lastPreventiveMaintenance3: chassis.lastPreventiveMaintenance3 || '',
      nextPreventiveMaintenance3: chassis.nextPreventiveMaintenance3 || '',
      lastAnnualInspection: chassis.lastAnnualInspection || '',
      nextAnnualInspection: chassis.nextAnnualInspection || '',
      alignmentDate: chassis.alignmentDate || '',
      notes: chassis.notes || '',
      manufacturer: chassis.manufacturer || '',
      model: chassis.model || '',
      capacity: chassis.capacity || '',
      tireSize: chassis.tireSize || '',
      axleCount: chassis.axleCount || '',
      lastServiceDate: chassis.lastServiceDate || '',
      nextServiceDate: chassis.nextServiceDate || '',
      // ✅ TERMINAL CHASSIS FLAG
      isTerminalChassis: chassis.isTerminalChassis || false
    });
    setShowEditModal(true);
  };

  // ===== RESET FORM =====
  const resetForm = () => {
    setFormData({
      name: '',
      type: '40ft',
      vin: '',
      year: '',
      licensePlate: '',
      tareWeight: '',
      tareWeightType: 'lbs',
      status: 'Active',
      location: 'Inside',
      moves: '',
      lifeCycle: 'Active',
      lastPreventiveMaintenance: '',
      nextPreventiveMaintenance: '',
      lastPreventiveMaintenance2: '',
      nextPreventiveMaintenance2: '',
      lastPreventiveMaintenance3: '',
      nextPreventiveMaintenance3: '',
      lastAnnualInspection: '',
      nextAnnualInspection: '',
      alignmentDate: '',
      notes: '',
      manufacturer: '',
      model: '',
      capacity: '',
      tireSize: '',
      axleCount: '',
      lastServiceDate: '',
      nextServiceDate: '',
      isTerminalChassis: false
    });
  };

  // ===== STATS =====
  const stats = {
    total: chassisList.length,
    active: chassisList.filter(c => c.status === 'Active').length,
    inactive: chassisList.filter(c => c.status === 'Inactive').length,
    inside: chassisList.filter(c => c.location === 'Inside').length,
    outside: chassisList.filter(c => c.location === 'Outside').length,
    terminal: chassisList.filter(c => c.isTerminalChassis === true).length
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* ===== STATS BAR ===== */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase">Total Chassis</div>
          <div className="text-2xl font-black text-slate-900">{stats.total}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-xl border border-green-200 shadow-sm">
          <div className="text-[10px] font-black text-green-600 uppercase">Active</div>
          <div className="text-2xl font-black text-green-700">{stats.active}</div>
        </div>
        <div className="bg-red-50 p-4 rounded-xl border border-red-200 shadow-sm">
          <div className="text-[10px] font-black text-red-600 uppercase">Inactive</div>
          <div className="text-2xl font-black text-red-700">{stats.inactive}</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 shadow-sm">
          <div className="text-[10px] font-black text-blue-600 uppercase">Inside</div>
          <div className="text-2xl font-black text-blue-700">{stats.inside}</div>
        </div>
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 shadow-sm">
          <div className="text-[10px] font-black text-amber-600 uppercase">Outside</div>
          <div className="text-2xl font-black text-amber-700">{stats.outside}</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 shadow-sm">
          <div className="text-[10px] font-black text-purple-600 uppercase">Terminal Chassis</div>
          <div className="text-2xl font-black text-purple-700">{stats.terminal}</div>
        </div>
      </div>

      {/* ===== TOOLBAR ===== */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search chassis by number, VIN, or plate..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
          />
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setViewMode('inactive')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === 'inactive' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Inactive
          </button>
          <button
            onClick={() => setViewMode('outside')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === 'outside' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Outside
          </button>
        </div>

        <button
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-purple-700 transition-all shadow-lg shadow-purple-200"
        >
          <Plus className="w-4 h-4" />
          Add Chassis
        </button>
      </div>

      {/* ===== CHASSIS GRID ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredChassis.map(chassis => (
          <ChassisCard
            key={chassis.id}
            chassis={chassis}
            onEdit={() => openEditModal(chassis)}
            onDelete={() => handleDeleteChassis(chassis.id)}
            isAdmin={isAdmin}
          />
        ))}
        {filteredChassis.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-2xl border border-slate-200">
            No chassis found. Add your first chassis!
          </div>
        )}
      </div>

      {/* ===== ADD CHASSIS MODAL ===== */}
      {showAddModal && (
        <ChassisFormModal
          title="Add Chassis"
          formData={formData}
          setFormData={setFormData}
          onSave={handleSaveChassis}
          onCancel={() => { setShowAddModal(false); resetForm(); }}
        />
      )}

      {/* ===== EDIT CHASSIS MODAL ===== */}
      {showEditModal && (
        <ChassisFormModal
          title="Edit Chassis"
          formData={formData}
          setFormData={setFormData}
          onSave={handleUpdateChassis}
          onCancel={() => { setShowEditModal(false); setEditingChassis(null); resetForm(); }}
          isEdit
        />
      )}
    </div>
  );
};

// ===== CHASSIS CARD COMPONENT =====
const ChassisCard = ({ chassis, onEdit, onDelete, isAdmin }) => {
  const statusColor = chassis.status === 'Active' ? 'green' : 'red';
  const locationColor = chassis.location === 'Inside' ? 'blue' : 'amber';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all p-5 group">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Anchor className="w-5 h-5 text-purple-600" />
            <span className="font-black text-lg text-slate-900">{chassis.name || 'N/A'}</span>
            {/* ✅ TERMINAL CHASSIS BADGE */}
            {chassis.isTerminalChassis && (
              <span className="text-[9px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200 flex items-center gap-1">
                <Users className="w-3 h-3" />
                Shared
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              chassis.status === 'Active' 
                ? 'bg-green-100 text-green-700 border border-green-200' 
                : 'bg-red-100 text-red-700 border border-red-200'
            }`}>
              {chassis.status || 'Active'}
            </span>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              chassis.location === 'Inside' 
                ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                : 'bg-amber-100 text-amber-700 border border-amber-200'
            }`}>
              {chassis.location || 'Inside'}
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              {chassis.type || '40ft'}
            </span>
            {chassis.isTerminalChassis && (
              <span className="text-[9px] font-bold text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                ♻️ Multi-Use
              </span>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={onEdit} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
              <Edit3 className="w-4 h-4" />
            </button>
            <button onClick={onDelete} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {chassis.vin && (
          <div className="flex items-center gap-1 text-slate-600">
            <Hash className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-xs">{chassis.vin}</span>
          </div>
        )}
        {chassis.licensePlate && (
          <div className="flex items-center gap-1 text-slate-600">
            <span className="font-bold text-xs">{chassis.licensePlate}</span>
          </div>
        )}
        {chassis.year && (
          <div className="flex items-center gap-1 text-slate-600">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-bold">{chassis.year}</span>
          </div>
        )}
        {chassis.tareWeight && (
          <div className="flex items-center gap-1 text-slate-600">
            <span className="text-xs font-bold">{chassis.tareWeight} {chassis.tareWeightType || 'lbs'}</span>
          </div>
        )}
      </div>

      {/* ===== TERMINAL CHASSIS INFO ===== */}
      {chassis.isTerminalChassis && (
        <div className="mt-2 pt-2 border-t border-purple-100 bg-purple-50/50 p-2 rounded-lg">
          <div className="flex items-center gap-2 text-[10px] text-purple-700 font-bold">
            <Users className="w-3.5 h-3.5" />
            <span>Terminal Chassis - Can be shared across multiple containers</span>
          </div>
        </div>
      )}

      {/* Maintenance indicators */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex gap-3 text-[10px] font-bold text-slate-400">
          {chassis.lastPreventiveMaintenance && (
            <div className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              <span>PM: {new Date(chassis.lastPreventiveMaintenance).toLocaleDateString()}</span>
            </div>
          )}
          {chassis.nextPreventiveMaintenance && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Next: {new Date(chassis.nextPreventiveMaintenance).toLocaleDateString()}</span>
            </div>
          )}
        </div>
        {chassis.notes && (
          <div className="text-[10px] text-slate-400 mt-1 truncate">{chassis.notes}</div>
        )}
      </div>
    </div>
  );
};

// ===== CHASSIS FORM MODAL =====
const ChassisFormModal = ({ title, formData, setFormData, onSave, onCancel, isEdit }) => {
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: type === 'checkbox' ? checked : value 
    }));
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onCancel}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2 rounded-xl text-white"><Anchor className="w-5 h-5" /></div>
            <div><h2 className="font-black text-slate-900 text-lg">{title}</h2></div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={onSave} className="p-6 overflow-y-auto space-y-6">
          {/* BASIC INFO */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Chassis Number *</label>
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                placeholder="e.g., CH-12345"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Type</label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              >
                <option value="20ft">20ft</option>
                <option value="40ft">40ft</option>
                <option value="45ft">45ft</option>
                <option value="53ft">53ft</option>
                <option value="Tri-Axle">Tri-Axle</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Location</label>
              <select
                name="location"
                value={formData.location}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              >
                <option value="Inside">Inside</option>
                <option value="Outside">Outside</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Life Cycle</label>
              <select
                name="lifeCycle"
                value={formData.lifeCycle}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              >
                <option value="Active">Active</option>
                <option value="Retired">Retired</option>
                <option value="Under Maintenance">Under Maintenance</option>
              </select>
            </div>
          </div>

          {/* ✅ TERMINAL CHASSIS TOGGLE */}
          <div className="bg-purple-50 p-4 rounded-xl border-2 border-purple-200">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="isTerminalChassis"
                  checked={formData.isTerminalChassis}
                  onChange={handleChange}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-sm text-slate-700">Terminal Chassis</span>
                  <span className="text-[10px] font-bold text-purple-600 bg-white px-2 py-0.5 rounded-full border border-purple-200">
                    {formData.isTerminalChassis ? '✅ Shared' : '🔒 Dedicated'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {formData.isTerminalChassis 
                    ? 'Can be assigned to multiple containers simultaneously (e.g., terminal-owned chassis)' 
                    : 'Dedicated to one container at a time (e.g., company-owned chassis)'}
                </p>
              </div>
            </div>
          </div>

          {/* VEHICLE IDENTIFICATION */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Vehicle Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
                  VIN
                  {formData.vin && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      formData.vin.length === 17 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {formData.vin.length}/17
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    name="vin"
                    value={formData.vin}
                    onChange={handleChange}
                    maxLength={17}
                    className="w-full px-4 py-2.5 border rounded-xl text-sm font-mono uppercase outline-none focus:ring-2 focus:ring-purple-200 transition-all"
                    placeholder="17-CHARACTER VIN"
                  />
                  {formData.vin && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {formData.vin.length === 17 ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Year</label>
                <input
                  name="year"
                  value={formData.year}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="e.g., 2005"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">License Plate</label>
                <input
                  name="licensePlate"
                  value={formData.licensePlate}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="Plate number"
                />
              </div>
            </div>
          </div>

          {/* WEIGHT & SPECS - Keep existing code */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Weight & Specifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase">Tare Weight</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      name="tareWeight"
                      type="number"
                      value={formData.tareWeight}
                      onChange={handleChange}
                      className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 transition-all"
                      placeholder="Weight"
                    />
                    {formData.tareWeight && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-purple-50 px-2 py-0.5 rounded-lg">
                        <span className="text-[10px] font-black text-purple-600">
                          {formData.tareWeightType === 'kg' ? 'kg' : 'lbs'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                    <button
                      type="button"
                      className={`px-3 py-2 text-xs font-bold transition-all ${
                        formData.tareWeightType === 'lbs'
                          ? 'bg-purple-600 text-white shadow-lg shadow-purple-200'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                      onClick={() => setFormData(prev => ({ ...prev, tareWeightType: 'lbs' }))}
                    >
                      lbs
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-2 text-xs font-bold transition-all ${
                        formData.tareWeightType === 'kg'
                          ? 'bg-purple-600 text-white shadow-lg shadow-purple-200'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                      onClick={() => setFormData(prev => ({ ...prev, tareWeightType: 'kg' }))}
                    >
                      kg
                    </button>
                  </div>
                </div>
                {/* Quick Weight Presets */}
                <div className="grid grid-cols-3 gap-1">
                  {['5000', '8000', '10000'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, tareWeight: preset }))}
                      className={`text-[9px] font-bold py-1 rounded-lg border transition-all ${
                        formData.tareWeight === preset
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-purple-300 hover:text-purple-600'
                      }`}
                    >
                      {parseInt(preset).toLocaleString()} {formData.tareWeightType}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Moves</label>
                <input
                  name="moves"
                  type="number"
                  value={formData.moves}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="Number of moves"
                />
              </div>
            </div>
          </div>

          {/* PREVENTIVE MAINTENANCE - Keep existing code */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Preventive Maintenance</h3>
            <div className="space-y-3">
              {[
                { 
                  number: '1', 
                  last: 'lastPreventiveMaintenance', 
                  next: 'nextPreventiveMaintenance',
                  color: 'blue' 
                },
                { 
                  number: '2', 
                  last: 'lastPreventiveMaintenance2', 
                  next: 'nextPreventiveMaintenance2',
                  color: 'amber' 
                },
                { 
                  number: '3', 
                  last: 'lastPreventiveMaintenance3', 
                  next: 'nextPreventiveMaintenance3',
                  color: 'green' 
                }
              ].map((pm) => {
                const lastDate = formData[pm.last];
                const nextDate = formData[pm.next];
                const isOverdue = nextDate && new Date(nextDate) < new Date();
                const isUpcoming = nextDate && !isOverdue && 
                  (new Date(nextDate) - new Date()) < (30 * 24 * 60 * 60 * 1000);
                
                return (
                  <div key={pm.number} className={`p-4 rounded-xl border transition-all ${
                    isOverdue 
                      ? 'bg-red-50 border-red-200' 
                      : isUpcoming
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isOverdue 
                            ? 'bg-red-600 text-white' 
                            : isUpcoming
                            ? 'bg-yellow-600 text-white'
                            : 'bg-purple-600 text-white'
                        }`}>
                          <span className="text-xs font-black">{pm.number}</span>
                        </div>
                        <span className="font-black text-sm text-slate-700">PM #{pm.number}</span>
                      </div>
                      {nextDate && (
                        <span className={`text-[10px] font-black px-2 py-1 rounded-full ${
                          isOverdue 
                            ? 'bg-red-100 text-red-700' 
                            : isUpcoming
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {isOverdue 
                            ? '⚠️ Overdue' 
                            : isUpcoming 
                            ? '⏰ Due Soon' 
                            : '✅ On Track'}
                        </span>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase">Last PM</label>
                        <input
                          type="date"
                          name={pm.last}
                          value={lastDate}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase">Next PM</label>
                        <input
                          type="date"
                          name={pm.next}
                          value={nextDate}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white mt-1"
                        />
                      </div>
                    </div>
                    
                    {/* Days remaining indicator */}
                    {nextDate && !isOverdue && (
                      <div className="mt-2 pt-2 border-t border-slate-200/50">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="font-bold text-slate-400">Days remaining:</span>
                          <span className={`font-black ${isUpcoming ? 'text-yellow-600' : 'text-green-600'}`}>
                            {Math.ceil((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24))} days
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ANNUAL INSPECTION & ALIGNMENT - Keep existing code */}
          <div className="border-t border-slate-200 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Last Annual Inspection</label>
                <input
                  type="date"
                  name="lastAnnualInspection"
                  value={formData.lastAnnualInspection}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Next Annual Inspection</label>
                <input
                  type="date"
                  name="nextAnnualInspection"
                  value={formData.nextAnnualInspection}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Alignment Date</label>
                <input
                  type="date"
                  name="alignmentDate"
                  value={formData.alignmentDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                />
              </div>
            </div>
          </div>

          {/* NOTES - Keep existing code */}
          <div className="border-t border-slate-200 pt-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
                Notes
                {formData.notes && (
                  <span className="text-[9px] font-bold text-slate-400">
                    {formData.notes.length}/500
                  </span>
                )}
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                maxLength={500}
                className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-200 min-h-[60px] resize-none"
                placeholder="Additional notes about this chassis..."
              />
            </div>
          </div>

          {/* BUTTONS */}
          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-[2] py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors shadow-lg shadow-purple-200"
            >
              {isEdit ? 'Update Chassis' : 'Save Chassis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChassisModule;