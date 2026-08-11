// components/TrucksModule.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Trash2, Edit3, X, Truck, Calendar, Hash, FileText,
  CheckCircle, AlertCircle, Save, RefreshCw, Filter, Shield, 
  MapPin, User, Phone, Mail, DollarSign, Wrench, Clock
} from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase.js';

const TrucksModule = ({ companyId, setFeedback, isAdmin, isDispatcher }) => {
  const [trucksList, setTrucksList] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTruck, setEditingTruck] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('all');

  // ===== FORM STATE =====
  const [formData, setFormData] = useState({
    name: '',
    vehicleType: 'Tractor-Trailer',
    truckType: '',
    vin: '',
    licensePlate: '',
    licensePlateIssuedBy: '',
    make: '',
    model: '',
    year: '',
    ifta1: '',
    ifta2: '',
    ambassadorBridgeRfid: '',
    newYorkPermit: '',
    tareWeight: '',
    plateWeight: '',
    valveAdjustment: '',
    status: 'Active',
    // Additional fields
    fuelType: 'Diesel',
    engineHours: '',
    odometer: '',
    lastOilChange: '',
    nextOilChange: '',
    insuranceExpiry: '',
    registrationExpiry: '',
    notes: ''
  });

  // Real-time listener
  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'companies', companyId, 'trucks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const trucks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTrucksList(trucks);
    });
    return () => unsubscribe();
  }, [companyId]);

  // ===== FILTER TRUCKS =====
  const filteredTrucks = trucksList.filter(truck => {
    const search = searchTerm.toLowerCase();
    return truck.name?.toLowerCase().includes(search) ||
           truck.vin?.toLowerCase().includes(search) ||
           truck.licensePlate?.toLowerCase().includes(search) ||
           truck.make?.toLowerCase().includes(search) ||
           truck.model?.toLowerCase().includes(search);
  });

  // ===== STATS =====
  const stats = {
    total: trucksList.length,
    active: trucksList.filter(t => t.status === 'Active').length,
    inactive: trucksList.filter(t => t.status === 'Inactive').length
  };

  // ===== SAVE TRUCK =====
  const handleSaveTruck = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFeedback("❌ Truck name is required");
      return;
    }
    
    try {
      const data = {
        ...formData,
        companyId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'companies', companyId, 'trucks'), data);
      setFeedback(`✅ Truck ${formData.name} added successfully`);
      setShowAddModal(false);
      resetForm();
    } catch (error) {
      console.error('Error adding truck:', error);
      setFeedback("❌ Failed to save truck");
    }
  };

  // ===== UPDATE TRUCK =====
  const handleUpdateTruck = async (e) => {
    e.preventDefault();
    if (!editingTruck?.id) return;
    
    try {
      const truckRef = doc(db, 'companies', companyId, 'trucks', editingTruck.id);
      await updateDoc(truckRef, {
        ...formData,
        updatedAt: new Date().toISOString()
      });
      setFeedback(`✅ Truck ${formData.name} updated successfully`);
      setShowEditModal(false);
      setEditingTruck(null);
      resetForm();
    } catch (error) {
      console.error('Error updating truck:', error);
      setFeedback("❌ Failed to update truck");
    }
  };

  // ===== DELETE TRUCK =====
  const handleDeleteTruck = async (id) => {
    if (!window.confirm('Delete this truck? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'trucks', id));
      setFeedback("✅ Truck deleted");
    } catch (error) {
      console.error('Error deleting truck:', error);
      setFeedback("❌ Failed to delete truck");
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      vehicleType: 'Tractor-Trailer',
      truckType: '',
      vin: '',
      licensePlate: '',
      licensePlateIssuedBy: '',
      make: '',
      model: '',
      year: '',
      ifta1: '',
      ifta2: '',
      ambassadorBridgeRfid: '',
      newYorkPermit: '',
      tareWeight: '',
      plateWeight: '',
      valveAdjustment: '',
      status: 'Active',
      fuelType: 'Diesel',
      engineHours: '',
      odometer: '',
      lastOilChange: '',
      nextOilChange: '',
      insuranceExpiry: '',
      registrationExpiry: '',
      notes: ''
    });
  };

  const openEditModal = (truck) => {
    setEditingTruck(truck);
    setFormData({
      name: truck.name || '',
      vehicleType: truck.vehicleType || 'Tractor-Trailer',
      truckType: truck.truckType || '',
      vin: truck.vin || '',
      licensePlate: truck.licensePlate || '',
      licensePlateIssuedBy: truck.licensePlateIssuedBy || '',
      make: truck.make || '',
      model: truck.model || '',
      year: truck.year || '',
      ifta1: truck.ifta1 || '',
      ifta2: truck.ifta2 || '',
      ambassadorBridgeRfid: truck.ambassadorBridgeRfid || '',
      newYorkPermit: truck.newYorkPermit || '',
      tareWeight: truck.tareWeight || '',
      plateWeight: truck.plateWeight || '',
      valveAdjustment: truck.valveAdjustment || '',
      status: truck.status || 'Active',
      fuelType: truck.fuelType || 'Diesel',
      engineHours: truck.engineHours || '',
      odometer: truck.odometer || '',
      lastOilChange: truck.lastOilChange || '',
      nextOilChange: truck.nextOilChange || '',
      insuranceExpiry: truck.insuranceExpiry || '',
      registrationExpiry: truck.registrationExpiry || '',
      notes: truck.notes || ''
    });
    setShowEditModal(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* STATS BAR */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase">Total Trucks</div>
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
      </div>

      {/* TOOLBAR */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search trucks by name, VIN, or plate..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>

        <button
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
        >
          <Plus className="w-4 h-4" />
          Add Truck
        </button>
      </div>

      {/* TRUCK GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredTrucks.map(truck => (
          <TruckCard
            key={truck.id}
            truck={truck}
            onEdit={() => openEditModal(truck)}
            onDelete={() => handleDeleteTruck(truck.id)}
            isAdmin={isAdmin}
          />
        ))}
        {filteredTrucks.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-400 font-bold italic bg-white rounded-2xl border border-slate-200">
            No trucks found. Add your first truck!
          </div>
        )}
      </div>

      {/* ADD/EDIT MODAL */}
      {(showAddModal || showEditModal) && (
        <TruckFormModal
          title={showAddModal ? 'Add Truck' : 'Edit Truck'}
          formData={formData}
          setFormData={setFormData}
          onSave={showAddModal ? handleSaveTruck : handleUpdateTruck}
          onCancel={() => {
            setShowAddModal(false);
            setShowEditModal(false);
            setEditingTruck(null);
            resetForm();
          }}
          isEdit={showEditModal}
        />
      )}
    </div>
  );
};

// ===== TRUCK CARD =====
const TruckCard = ({ truck, onEdit, onDelete, isAdmin }) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all p-5 group">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            <span className="font-black text-lg text-slate-900">{truck.name || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              truck.status === 'Active' 
                ? 'bg-green-100 text-green-700 border border-green-200' 
                : 'bg-red-100 text-red-700 border border-red-200'
            }`}>
              {truck.status || 'Active'}
            </span>
            <span className="text-[10px] font-bold text-slate-400">{truck.vehicleType || 'Tractor-Trailer'}</span>
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

      <div className="grid grid-cols-2 gap-1 text-sm">
        {truck.vin && (
          <div className="flex items-center gap-1 text-slate-600 col-span-2">
            <Hash className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-xs">{truck.vin}</span>
          </div>
        )}
        {truck.licensePlate && (
          <div className="flex items-center gap-1 text-slate-600">
            <span className="font-bold text-sm text-blue-600">{truck.licensePlate}</span>
            {truck.licensePlateIssuedBy && (
              <span className="text-[10px] text-slate-400">({truck.licensePlateIssuedBy})</span>
            )}
          </div>
        )}
        {truck.make && truck.model && (
          <div className="flex items-center gap-1 text-slate-600">
            <span className="text-xs font-bold">{truck.make} {truck.model}</span>
            {truck.year && <span className="text-[10px] text-slate-400">({truck.year})</span>}
          </div>
        )}
      </div>

      {/* Permit info */}
      {(truck.ifta1 || truck.ifta2) && (
        <div className="mt-2 flex gap-2 text-[10px] font-bold text-slate-400">
          {truck.ifta1 && <span>IFTA: {truck.ifta1}</span>}
          {truck.ifta2 && <span>IFTA2: {truck.ifta2}</span>}
        </div>
      )}

      {truck.notes && (
        <div className="mt-2 text-[10px] text-slate-400 truncate">{truck.notes}</div>
      )}
    </div>
  );
};

// ===== TRUCK FORM MODAL =====
const TruckFormModal = ({ title, formData, setFormData, onSave, onCancel, isEdit }) => {
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onCancel}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl text-white"><Truck className="w-5 h-5" /></div>
            <div><h2 className="font-black text-slate-900 text-lg">{title}</h2></div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={onSave} className="p-6 overflow-y-auto space-y-6">
          {/* BASIC INFO */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Truck Name *</label>
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="e.g., 721"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Vehicle Type</label>
              <select
                name="vehicleType"
                value={formData.vehicleType}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                <option value="Tractor-Trailer">Tractor-Trailer</option>
                <option value="Straight Truck">Straight Truck</option>
                <option value="Day Cab">Day Cab</option>
                <option value="Sleeper">Sleeper</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Under Maintenance">Under Maintenance</option>
              </select>
            </div>
          </div>

          {/* VEHICLE IDENTIFICATION */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Vehicle Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">VIN</label>
                <input
                  name="vin"
                  value={formData.vin}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="17-character VIN"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">License Plate</label>
                <input
                  name="licensePlate"
                  value={formData.licensePlate}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Plate number"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Plate Issued By</label>
                <input
                  name="licensePlateIssuedBy"
                  value={formData.licensePlateIssuedBy}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="e.g., AB, ON, CA"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Make</label>
                <input
                  name="make"
                  value={formData.make}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="e.g., Volvo, Freightliner"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Model</label>
                <input
                  name="model"
                  value={formData.model}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="e.g., VNL 860"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Year</label>
                <input
                  name="year"
                  value={formData.year}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="e.g., 2007"
                />
              </div>
            </div>
          </div>

          {/* PERMITS & REGISTRATION */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Permits & Registration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">IFTA #1</label>
                <input
                  name="ifta1"
                  value={formData.ifta1}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="IFTA number"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">IFTA #2</label>
                <input
                  name="ifta2"
                  value={formData.ifta2}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Secondary IFTA"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Ambassador Bridge RFID</label>
                <input
                  name="ambassadorBridgeRfid"
                  value={formData.ambassadorBridgeRfid}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="RFID tag number"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">New York Permit #</label>
                <input
                  name="newYorkPermit"
                  value={formData.newYorkPermit}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="NY permit number"
                />
              </div>
            </div>
          </div>

          {/* WEIGHT & MAINTENANCE */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-600 mb-4">Weight & Maintenance</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Tare Weight</label>
                <input
                  name="tareWeight"
                  value={formData.tareWeight}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Weight"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Plate Weight</label>
                <input
                  name="plateWeight"
                  value={formData.plateWeight}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Registered weight"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Valve Adjustment</label>
                <input
                  name="valveAdjustment"
                  value={formData.valveAdjustment}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Last valve adjustment"
                />
              </div>
            </div>
          </div>

          {/* NOTES */}
          <div className="border-t border-slate-200 pt-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-200 min-h-[60px]"
                placeholder="Additional notes about this truck..."
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
              className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              {isEdit ? 'Update Truck' : 'Save Truck'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TrucksModule;