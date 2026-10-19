import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

import {
  Plus, Search, Trash2, Package, User, Scale, Maximize, Navigation, Hash,
  FileText, Filter, Download, Edit3, X, MapPin, Building, ChevronDown, ChevronUp,
  CheckCircle2, Mail, ArrowRight, Route, Truck, Copy, Check, UserPlus,
  FileDown, DollarSign, Calculator, Receipt, Printer, FileCheck, Anchor,
  Clock, Calendar, ArrowUpRight, Pencil, Eye, RotateCcw, FileUp, Paperclip,
  ClipboardCheck, BadgeInfo, Layers, ArrowRightLeft, CalendarDays, Send, Loader2, AlertTriangle,
  Globe, Train, Ship, ExternalLink, RefreshCw, Sparkles, MessageSquare, Cloud, Wifi, Briefcase,
  TrendingUp, BarChart3, Activity, Wallet, AlertCircle, History, Archive,
  Key, LogOut, ShieldCheck, Upload, FileSpreadsheet, CheckCircle, XCircle,
  Camera, Target,
  Lock, EyeOff // ✅ ADD THESE TWO ICONS HERE
} from "lucide-react";

// ✅ NEEDED FOR FUNCTIONS
import { getFunctions, httpsCallable } from "firebase/functions";

// ✅ NEEDED FOR AUTH
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "firebase/auth";

// ✅ NEEDED FOR FIRESTORE - UPDATED WITH writeBatch AND serverTimestamp
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  setDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";

// ✅ YOUR SINGLE SOURCE OF TRUTH
import { db, auth, storage, app } from './firebase.js';

import ErrorBoundary from "./ErrorBoundary.jsx";
import DriverApp from "./DriverApp.jsx";
import DOMPurify from 'dompurify';
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';
import DriverActivityBoard from './components/DriverActivityBoard';
import ChassisModule from './components/ChassisModule';
import UserManagement from './components/UserManagement';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminGuard from './components/SuperAdminGuard';  // ← This line
import DriverPayroll from './components/DriverPayroll.jsx';
import ContainerBoard from './components/ContainerBoard';
import DailyDispatchBoard from './components/DailyDispatchBoard';
import TomorrowDispatchBoard from './components/TomorrowDispatchBoard';
import TrucksModule from './components/TrucksModule';
import InvoicesModule from './components/InvoicesModule';
import ExportBatchesModule from './components/ExportBatchesModule';   // ✅ NEW
import EmailSettingsModal from './components/EmailSettingsModal';  // ✅ ADD THIS LINE
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ✅ ADD THIS IMPORT - COST CALCULATION UTILITIES
import {
  calculateLegCost,
  calculateLoadCosts,
  getDriverCostAnalytics,
  updateFuelPriceForLegs,
  safeFloat
} from './utils/costCalculations.js';
// ✅ ADD THIS IMPORT - DISTANCE CALCULATION
import {
  calculateTruckDistance,
  saveRouteToCache,
  calculateBatchDistances,
  clearDistanceCache,
  getCacheStats
} from './utils/distanceService.js';
import { runTransaction } from "firebase/firestore";

// ========== CURRENCY SUPPORT ==========
const SUPPORTED_CURRENCIES = {
  CAD: { symbol: 'C$', code: 'CAD', name: 'Canadian Dollar' },
  USD: { symbol: 'US$', code: 'USD', name: 'US Dollar' }
};

// ========== PRE-PULL TEMPLATES ==========
const PRE_PULL_TEMPLATES = [
  {
    id: 'terminal-to-yard-prepull',
    name: 'Terminal to Yard - PREPULL',
    description: 'Pick up from terminal, drop at yard',
    legs: [
      { type: 'prepull', fromType: 'terminal', toType: 'yard' }
    ]
  },
  {
    id: 'terminal-to-customer-prepull',
    name: 'Terminal to Customer - PREPULL DROP',
    description: 'Pick up from terminal, deliver to customer',
    legs: [
      { type: 'prepull', fromType: 'terminal', toType: 'customer' }
    ]
  },
  {
    id: 'yard-to-customer-prepull',
    name: 'Yard to Customer - PREPULLED DROP',
    description: 'Pick up from yard, deliver to customer',
    legs: [
      { type: 'prepull', fromType: 'yard', toType: 'customer' }
    ]
  },
  {
    id: 'terminal-to-customer-return-live',
    name: 'Terminal to Customer + Return - LIVE',
    description: 'Deliver to customer and return to terminal',
    legs: [
      { type: 'delivery', fromType: 'terminal', toType: 'customer' },
      { type: 'return', fromType: 'customer', toType: 'terminal' }
    ]
  },
  {
    id: 'yard-to-customer-return-live',
    name: 'Yard to Customer + Return - LIVE',
    description: 'Deliver from yard to customer and return to yard',
    legs: [
      { type: 'delivery', fromType: 'yard', toType: 'customer' },
      { type: 'return', fromType: 'customer', toType: 'yard' }
    ]
  },
  {
    id: 'customer-to-terminal-pickup',
    name: 'Customer to Terminal - PICK UP CONTAINER',
    description: 'Pick up from customer, drop at terminal',
    legs: [
      { type: 'pickup', fromType: 'customer', toType: 'terminal' }
    ]
  },
  {
    id: 'customer-to-yard-stopoff',
    name: 'Customer to Yard - STOP OFF',
    description: 'Pick up from customer, drop at yard',
    legs: [
      { type: 'stopoff', fromType: 'customer', toType: 'yard' }
    ]
  },
  {
    id: 'live-load-stopoff-yard',
    name: 'LIVE LOAD - STOP OFF AT YARD',
    description: 'Live load at yard',
    legs: [
      { type: 'live', fromType: 'terminal', toType: 'yard' }
    ]
  },
  {
    id: 'live-load-stopoff-amar',
    name: 'LIVE LOAD - STOP OFF AT AMAR',
    description: 'Live load at AMAR location',
    legs: [
      { type: 'live', fromType: 'terminal', toType: 'customer' }
    ]
  },
  {
    id: 'return-from-yard',
    name: 'Return from YARD',
    description: 'Return from yard to terminal',
    legs: [
      { type: 'return', fromType: 'yard', toType: 'terminal' }
    ]
  }
];

const formatCurrency = (amount, currency = 'CAD') => {
  const curr = SUPPORTED_CURRENCIES[currency] || SUPPORTED_CURRENCIES.CAD;
  return `${curr.symbol}${safeFloat(amount).toFixed(2)}`;
};

// ========== ROLE DISPLAY NAMES ==========
const ROLE_DISPLAY_NAMES = {
  owner: 'Company Administrator',
  admin: 'Operations Manager',
  dispatcher: 'Dispatcher',
  accounting: 'Accounting',
  customer_service: 'Customer Service'
};

// ========== TAB CONFIGURATION (per role) ==========
const TAB_CONFIG = {
  summary: { label: 'Dashboard', roles: ['owner', 'admin', 'dispatcher', 'accounting', 'customer_service'] },
  loads: { label: 'Loads', roles: ['owner', 'admin', 'dispatcher', 'accounting', 'customer_service'] },
  addressBook: { label: 'Customers', roles: ['owner', 'admin', 'dispatcher', 'customer_service'] },
  billing: { label: 'Billing', roles: ['owner', 'admin', 'accounting'] },
  invoices: { label: 'Invoices', roles: ['owner', 'admin', 'accounting'] },
  exportBatches: { label: 'Export Batches', roles: ['owner', 'admin', 'accounting'] },   // ✅ NEW
  history: { label: 'History', roles: ['owner', 'admin', 'accounting'] },
  assignment: { label: 'Assignment', roles: ['owner', 'admin', 'dispatcher', 'customer_service'] },
  revenue: { label: 'Analytics', roles: ['owner', 'admin'] },
  payroll: { label: 'Payroll', roles: ['owner'] },
  driverActivity: { label: 'Fleet', roles: ['owner', 'admin', 'dispatcher', 'customer_service'] }
};

// ========== HELPER FUNCTIONS ==========
const escapeCsv = (value) => {
  if (value === undefined || value === null) return '""';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const sanitizeInput = (input) => {
  if (!input) return '';
  if (typeof input !== 'string') return String(input);
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
};

const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
  return emailRegex.test(email);
};

const sanitizeEmailContent = (content) => {
  if (!content) return '';
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const toCents = (amount) => Math.round(parseFloat(amount || 0) * 100);

const calculateTotal = (load) => {
  if (!load) return "0.00";
  const revenueItems = load.revenueItems || [];
  if (revenueItems.length === 0) return "0.00";
 
  const totalCents = revenueItems.reduce((sum, item) => {
    return sum + toCents(item?.amount);
  }, 0);
 
  return (totalCents / 100).toFixed(2);
};

const calculateCost = (load) => {
  if (!load) return "0.00";
 
  let legCostCents = 0;
  const legs = load.legs || [];
 
  legs.forEach(leg => {
    if (leg.calculatedCost !== undefined && leg.calculatedCost !== null && leg.calculatedCost !== '') {
      legCostCents += toCents(leg.calculatedCost);
    } else {
      legCostCents += toCents(leg.driverPay) + toCents(leg.fuelCost) + toCents(leg.detentionPay);
    }
  });
 
  const expenseCostCents = (load.expenseItems || []).reduce((sum, item) => {
    return sum + toCents(item?.amount);
  }, 0);
 
  const totalCents = legCostCents + expenseCostCents;
  return (totalCents / 100).toFixed(2);
};

const calculateProfit = (load) => {
  if (!load) return "0.00";
  const revenueCents = toCents(calculateTotal(load));
  const costCents = toCents(calculateCost(load));
  return ((revenueCents - costCents) / 100).toFixed(2);
};

const calculateProfitFormatted = (load) => {
  if (!load) return "C$0.00";
  return formatCurrency(calculateProfit(load), load.currency || 'CAD');
};

const validateLoadForm = (formData) => {
  const requiredFields = {
    containerNo: "Container Number",
    shippingLine: "Shipping Line",
    customerName: "Customer Name",
    status: "Status"
  };
  for (const [field, label] of Object.entries(requiredFields)) {
    if (!formData[field] || String(formData[field]).trim() === "") {
      return { valid: false, error: `${label} is required.` };
    }
  }
  if (formData.currency && !SUPPORTED_CURRENCIES[formData.currency]) {
    return { valid: false, error: "Invalid currency selected." };
  }
  const revenueItems = formData.revenueItems || [];
  const hasBasePrice = safeFloat(formData.basePrice) > 0 || safeFloat(formData.waitingTime) > 0 || safeFloat(formData.fuelSurcharge) > 0;
  const hasLineItems = revenueItems.length > 0;
  if (!hasBasePrice && !hasLineItems) {
    return { valid: false, error: "At least one revenue item or base price is required." };
  }
  if (hasBasePrice && hasLineItems) {
    return { valid: false, error: "Cannot mix legacy pricing and line items." };
  }
  const totalRevenue = hasLineItems
    ? revenueItems.reduce((sum, item) => sum + safeFloat(item.amount), 0)
    : safeFloat(formData.basePrice) + safeFloat(formData.waitingTime) + safeFloat(formData.fuelSurcharge);
 
  if (totalRevenue <= 0.01) {
    return { valid: false, error: "Total revenue must be greater than zero. Please add at least one revenue item." };
  }
 
  return { valid: true };
};

const migrateToLineItems = (loadData) => {
  const migrated = { ...loadData };
  if (!migrated.currency) {
    migrated.currency = "CAD";
  }
  if ((!migrated.revenueItems || migrated.revenueItems.length === 0)) {
    migrated.revenueItems = [];
    if (safeFloat(migrated.basePrice) > 0) migrated.revenueItems.push({ id: Date.now().toString() + '_rev1', item: 'Freight Charge', qty: 1, rate: migrated.basePrice, amount: migrated.basePrice });
    if (safeFloat(migrated.waitingTime) > 0) migrated.revenueItems.push({ id: Date.now().toString() + '_rev2', item: 'Waiting Time', qty: 1, rate: migrated.waitingTime, amount: migrated.waitingTime });
    if (safeFloat(migrated.fuelSurcharge) > 0) migrated.revenueItems.push({ id: Date.now().toString() + '_rev3', item: 'Fuel Surcharge', qty: 1, rate: migrated.fuelSurcharge, amount: migrated.fuelSurcharge });
  }
  if ((!migrated.expenseItems || migrated.expenseItems.length === 0)) {
    migrated.expenseItems = [];
    if (safeFloat(migrated.driverCost) > 0) migrated.expenseItems.push({ id: Date.now().toString() + '_exp1', item: 'Driver Cost', qty: 1, rate: migrated.driverCost, amount: migrated.driverCost });
    if (safeFloat(migrated.fuelCost) > 0) migrated.expenseItems.push({ id: Date.now().toString() + '_exp2', item: 'Fuel Cost', qty: 1, rate: migrated.fuelCost, amount: migrated.fuelCost });
    if (safeFloat(migrated.brokerRate) > 0) migrated.expenseItems.push({ id: Date.now().toString() + '_exp3', item: 'Broker/Other', qty: 1, rate: migrated.brokerRate, amount: migrated.brokerRate });
  }
  return migrated;
};

const copyToClipboard = async (text) => {
  if (typeof window === "undefined") return false;
  let success = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); success = true; } catch (err) { console.warn("Clipboard API failed", err); }
  }
  if (!success) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      success = document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) { console.error("Fallback copy failed:", err); success = false; }
  }
  return success;
};

const copyDispatch = async (load, leg, setFeedback) => {
  try {
    let text = '';
    
    // ✅ FALLBACK: Use the leg's data, but if it's empty, fall back to the main Load data
    const pickupLocation = leg?.from || load?.terminal || 'N/A';
    const dropLocation = leg?.to || load?.delivery || 'N/A';

    if (load?.emptyPickupBookingNo) {
      text = `🚛 EXPORT DISPATCH ASSIGNMENT 🚛
---------------------------
*** EMPTY PICKUP REQUIRED ***
Work Order: ${load.workOrderNo || 'N/A'}
Booking #: ${load.emptyPickupBookingNo || 'N/A'}
Line: ${load.shippingLine || 'N/A'}
Size/Weight: ${load.size || 'N/A'} / ${load.weight || 'N/A'}
ERD Date: ${load.erdDate || 'N/A'}
CutOff Date: ${load.cutoffDate || 'N/A'}

Container: ${load.containerNo || 'TBD'}
PO #: ${load.poNumber || 'N/A'}
Ref #: ${load.customerRefNo || 'N/A'}
Appointment: ${load.appointmentDate || 'TBD'} at ${load.appointmentTime || 'TBD'}

From: ${pickupLocation}
To: ${dropLocation}

Driver: ${leg?.driverName || 'TBD'}
Truck: ${leg?.truckNo || 'TBD'}
---------------------------`;
    } else {
      text = `🚛 DISPATCH ASSIGNMENT 🚛
---------------------------
Work Order: ${load?.workOrderNo || 'N/A'}
Container: ${load?.containerNo || 'TBD'}
Line: ${load?.shippingLine || 'N/A'}
Size/Weight: ${load?.size || 'N/A'} / ${load?.weight || 'N/A'}
PO #: ${load?.poNumber || 'N/A'}
Pickup #: ${load?.pickupNo || 'N/A'}
Ref #: ${load?.customerRefNo || 'N/A'}
Appointment: ${load?.appointmentDate || 'TBD'} at ${load?.appointmentTime || 'TBD'}

From: ${pickupLocation}
To: ${dropLocation}

Driver: ${leg?.driverName || 'TBD'}
Truck: ${leg?.truckNo || 'TBD'}
---------------------------`;
    }
    const success = await copyToClipboard(text);
    if(setFeedback) setFeedback(success ? "Dispatch Copied!" : "Copy failed");
  } catch (error) {
    console.error("Error formatting dispatch text:", error);
    if (setFeedback) setFeedback("Error copying dispatch");
  }
};

const getSafeLegs = (item) => (Array.isArray(item?.legs) ? item.legs : []);
const normalizeFileRef = (file) => {
  if (!file) return null;
  if (typeof file === "string") return { name: "Document", type: "application/octet-stream", url: file };
  const url = file.url || file.data || null;
  if (!url) return null;
  return { ...file, url };
};

const normalizeLoad = (data, id) => ({
  ...(data || {}),
  id,
  workOrderNo: data?.workOrderNo || "",
  status: data?.status || "Open",
  currency: data?.currency || "CAD",
  legs: getSafeLegs(data),
  loadConfirmation: normalizeFileRef(data?.loadConfirmation),
  signedPodDoc: normalizeFileRef(data?.signedPodDoc),
  documents: data?.documents || [], // ✅ ADD THIS LINE
  lastTrackingStatus: data?.lastTrackingStatus || "Pending",
  auditLog: data?.auditLog || [],
  isPrePull: data?.isPrePull || false,
  prePullDate: data?.prePullDate || "",
  locationId: data?.locationId || null,
  chassisNumber: data?.chassisNumber || "",
  weightUnit: data?.weightUnit || "lbs",
  appointmentAmPm: data?.appointmentAmPm || "AM",
});

const useFeedback = (timeout = 4000) => {
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(""), timeout);
      return () => clearTimeout(timer);
    }
  }, [feedback, timeout]);
  return [feedback, setFeedback];
};

const useIsMountedRef = () => {
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  return isMountedRef;
};

const debounce = (func, wait) => {
  let timeout;
  function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  }
  executedFunction.cancel = () => { if (timeout) clearTimeout(timeout); };
  return executedFunction;
};

const retryDynamicImport = async (importFn, retries = 3, delayMs = 500) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await importFn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

const createDefaultLeg = () => ({
  id: Date.now(),
  from: "",
  to: "",
  driverName: "",
  truckNo: "",
  status: "Planned",
  arrivalTime: "",
  departureTime: "",
  signature: null,
  driverPay: "",
  fuelCost: "",
  detentionPay: "",
  payType: "flat",
  notes: "",
  driverType: "Not Set",
  payRate: "",
  totalDistance: "",
  totalHours: "",
  fuelPrice: "",
  fuelEfficiency: "",
  markupPercentage: "",
  calculatedCost: "",
  costBreakdown: null,
  legDate: ""
});

const createEmptyLoadForm = () => ({
  status: "Open",
  workOrderNo: "",
  containerNo: "",
  shippingLine: "",
  poNumber: "",
  pickupNo: "",
  customerRefNo: "",
  size: "40GE (General)",
  weight: "",
  weightUnit: "lbs",
  sealNumber: "", // ✅ ADD THIS
  deliveryTime: "", // ✅ ADD THIS
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  customerAddress: "",
  appointmentDate: "",
  appointmentTime: "",
  appointmentAmPm: "AM",
  loadConfirmation: null,
  signedPodDoc: null,
  documents: [], // ✅ ADD THIS LINE
  basePrice: "",
  waitingTime: "",
  fuelSurcharge: "",
  driverCost: "",
  fuelCost: "",
  brokerRate: "",
  currency: "CAD",
  revenueItems: [{ id: Date.now().toString(), item: 'Freight Charge', qty: 1, rate: '', amount: '' }],
  expenseItems: [],
  legs: [],
  notes: "",
  lastTrackingStatus: "Pending",
  auditLog: [],
  emptyPickupBookingNo: "",
  erdDate: "",
  cutoffDate: "",
  isOffHire: false,
  returnLocation: "",
  returnBookingNo: "",
  returnRvNo: "",
  returnDate: "",
  returnRvTir: "",
  locationId: "",
  isPrePull: false,
  prePullDate: "",
  delivery: "",
  deliveryDate: "", // ✅ Add this line
  terminal: "",
  loadType: "",
  shipmentType: "",
  bookingNo: "",
  vesselName: "",
  portName: "",
  loadingDate: "",
  railBill: false,
  railBillNumber: "",
  chassisNumber: "",
  isStopOff: false,
  isGrounded: false,
  isInYard: false,
  isInYardPrePull: false,
  isInYardReturn: false,
    isDroppedAtCustomer: false,
  isReadyForPickup: false,
  isTerminated: false,
  isBillingComplete: false,
  etaDate: "",  // ✅ ADD THIS
  etaTime: "",  // ✅ ADD THIS
  readyForPickupDate: '',
  containerStatusHistory: [],
});

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const addAuditEntry = async (companyId, loadId, entry) => {
  if (!companyId || !loadId) return;
  try {
    const auditRef = collection(db, 'companies', companyId, 'loads', loadId, 'audit');
    await addDoc(auditRef, {
      ...entry,
      id: Date.now().toString()
    });
    const q = query(auditRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    if (snapshot.size > 100) {
      const batch = [];
      const docs = snapshot.docs.slice(100);
      docs.forEach(doc => batch.push(deleteDoc(doc.ref)));
      await Promise.all(batch);
    }
  } catch (error) {
    console.error("Error adding audit entry:", error);
  }
};

const getTrackingUrl = (carrier, load = null) => {
  const c = String(carrier || "").toLowerCase().trim();
  const cleanCarrier = c.replace(/[^a-z]/g, '');
  
  // CMA CGM
  if (cleanCarrier.includes('cma') || cleanCarrier.includes('cmacgm')) {
    return 'https://apps.usa.cma-cgm.com/econtainer/';
  }
  
  // COSCO
  if (cleanCarrier.includes('cosco')) {
    return 'https://n2c3-s.lines.coscoshipping.com/start';
  }
  
  // EVERGREEN
  if (cleanCarrier.includes('evergreen')) {
    return 'http://www.evergreen-shipping.us/';
  }
  
  // HAPAG-LLOYD - Multiple URLs based on context
  if (cleanCarrier.includes('hapag')) {
    if (load?.shipmentType === 'export') {
      return 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/north-america/canada/local-info/export-rail-billing-form.html';
    } else if (load?.shipmentType === 'import') {
      return 'https://ianaerld.com/apps/erld/locations/Mi6cLBwXspVXAHh2EEJWSPChK';
    } else {
      return 'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/north-america/canada/local-info/empty-rail-billing-form.html';
    }
  }
  
  // HMM (Hyundai Merchant Marine)
  if (cleanCarrier.includes('hmm') || cleanCarrier.includes('hyundai')) {
    return 'https://www.hmm21.com/cms/business/ebiz/user/login/index.jsp';
  }
  
  // MAERSK
  if (cleanCarrier.includes('maersk')) {
    return 'https://www.maersk.com/local-information/north-america/canada';
  }
  
  // MSC
  if (cleanCarrier.includes('msc')) {
    return 'https://eservices.msccanada.ca/ERC/Main';
  }
  
  // ONE (Ocean Network Express)
  if (cleanCarrier.includes('one')) {
    return 'https://ecomm.one-line.com/ecom/SPP_COM_1001.do';
  }
  
  // OOCL
  if (cleanCarrier.includes('oocl')) {
    return 'https://n2c3-s.home.oocl.com/login';
  }
  
  // SM LINES
  if (cleanCarrier.includes('sm') || cleanCarrier.includes('smlines')) {
    // If rail bill is required, use partner URL
    if (load?.railBill) {
      return 'https://partner.smlines.com/sppWeb/login/login.jsp';
    }
    return 'https://esvc.smlines.com/smline/CUP_HOM_3053.do';
  }
  
  // SWIRE SHIPPING
  if (cleanCarrier.includes('swire')) {
    return 'http://na.swireshipping.com/';
  }
  
  // YANG MING
  if (cleanCarrier.includes('yangming') || cleanCarrier.includes('yangming')) {
    return 'https://www.yangming.com/en/contact/office_info/CA';
  }
  
  // ZIM
  if (cleanCarrier.includes('zim')) {
    return 'https://www.zim.com/tools/econtainer';
  }
  
  // CN (Canadian National)
  if (cleanCarrier.includes('cn') || cleanCarrier.includes('canadiannational')) {
    return 'https://www.cn.ca/en/customer-centre/your-shipment/shipment-tracking/';
  }
  
  // CP (Canadian Pacific)
  if (cleanCarrier.includes('cp') || cleanCarrier.includes('cpkc') || cleanCarrier.includes('canadianpacific')) {
    return 'https://www.cpkcr.com/en/customer-resources/tracking';
  }
  
  // Default fallback
  return `https://www.google.com/search?q=${encodeURIComponent(carrier)}+container+tracking`;
};

// ========== PDF & INVOICE FUNCTIONS ==========
export const downloadPOD = (load, leg, setFeedback, companyName, companyDetails = {}, locationAddress = null) => {
  if (typeof window === "undefined" || !load) return;
  try {
    if (setFeedback) setFeedback("Generating POD PDF...");
    let addressStr = '';
    if (locationAddress) {
      addressStr = locationAddress;
    } else {
      addressStr = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    }
    const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
    const currentDate = new Date().toISOString().split('T')[0];
    const originName = leg?.from?.split(' - ')[0] || 'N/A';
    const originAddr = leg?.from || 'Address provided separately';
    const destName = leg?.to?.split(' - ')[0] || 'N/A';
    const destAddr = leg?.to || 'Address provided separately';
    
    // Build the full address string for display
    const fullCompanyAddress = [
      companyDetails?.address,
      companyDetails?.city,
      companyDetails?.province,
      companyDetails?.postalCode
    ].filter(Boolean).join(', ');

    const podContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #111827; background: #fff; line-height: 1.4; box-sizing: border-box; width: 100%;">
        <style>
          * { box-sizing: border-box; }
          .flex { display: flex; }
          .justify-between { justify-content: space-between; }
          .items-start { align-items: flex-start; }
          .gap-4 { gap: 16px; }
          .w-1-2 { width: 50%; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .mb-2 { margin-bottom: 8px; }
          .mb-8 { margin-bottom: 32px; }
          .mt-2 { margin-top: 8px; }
          .font-bold { font-weight: 700; }
          .font-black { font-weight: 900; }
          .text-blue { color: #1d4ed8; }
          .text-gray { color: #9ca3af; }
          .text-dark { color: #111827; }
          .text-xs { font-size: 9px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; }
          .text-sm { font-size: 11px; }
          .text-base { font-size: 13px; }
          .text-2xl { font-size: 24px; letter-spacing: -0.5px; }
          .divider { border-bottom: 3px solid #111827; margin: 15px 0 25px 0; }
          .dashed-divider { border-bottom: 1px dashed #cbd5e1; margin: 30px 0; }
          .section-title { font-weight: 900; font-size: 12px; color: #1f2937; margin-bottom: 12px; display: flex; align-items: center; }
          .section-title::before { content: ''; display: inline-block; width: 4px; height: 14px; background-color: #1d4ed8; margin-right: 8px; }
          .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; background: #fff; }
          .card-blue { border-color: #bfdbfe; }
          .card-green { border-color: #bbf7d0; }
          .text-blue-label { color: #2563eb; }
          .text-green-label { color: #16a34a; }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .meta-table { width: auto; margin-left: auto; border-collapse: collapse; }
          .meta-table td { padding: 3px 8px; font-size: 10px; }
          .meta-table .label { font-weight: 800; text-align: right; text-transform: uppercase; color: #4b5563; }
          .meta-table .value { font-weight: 800; text-align: right; color: #111827; }
          .sig-line { border-bottom: 1px solid #9ca3af; height: 20px; width: 100%; margin-top: 5px;}
        </style>
        <div class="flex justify-between items-start">
          <!-- LEFT SIDE: Company Info -->
          <div>
            <div class="text-2xl font-black text-blue mb-2">${sanitizeInput(companyName || 'Company Name')}</div>
            ${fullCompanyAddress ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">${sanitizeInput(fullCompanyAddress)}</div>` : ''}
            ${companyDetails?.email ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">Email: ${sanitizeInput(companyDetails.email)}</div>` : ''}
            ${companyDetails?.phone ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">Tel: ${sanitizeInput(companyDetails.phone)}</div>` : ''}
          </div>
          
          <!-- RIGHT SIDE: Logo and Work Order Details -->
          <div class="text-right">
            ${companyDetails?.logoUrl ? `<img src="${sanitizeInput(companyDetails.logoUrl)}" style="max-height: 70px; max-width: 220px; margin-bottom: 10px; margin-left: auto; display: block;" alt="Company Logo" crossorigin="anonymous" />` : ''}
            <div class="text-2xl font-black text-gray mb-2">WORK ORDER</div>
            <table class="meta-table">
              <tr><td class="label">WO #</td><td class="value">${sanitizeInput(load.workOrderNo || String(load.id || '').substring(0,8).toUpperCase())}</td></tr>
              <tr><td class="label">DATE</td><td class="value">${currentDate}</td></tr>
              <tr><td class="label">PO #</td><td class="value">${sanitizeInput(load.poNumber || 'N/A')}</td></tr>
              <tr><td class="label">REF #</td><td class="value">${sanitizeInput(load.customerRefNo || 'N/A')}</td></tr>
              <tr><td class="label">CURRENCY</td><td class="value">${currencySymbol}</td></tr>
            </table>
          </div>
        </div>
        <div class="divider"></div>
        <div class="flex gap-4 mb-8">
          <div class="w-1-2">
            <div class="section-title">CUSTOMER</div>
            <div class="card" style="height: 110px;">
              <div class="font-black text-base mb-2">${sanitizeInput(load.customerName || 'N/A')}</div>
              <div class="text-sm text-dark">${sanitizeInput(load.customerAddress || 'Address on file')}</div>
              <div class="text-sm text-dark mt-2">${sanitizeInput(load.customerEmail || load.customerPhone || '')}</div>
            </div>
          </div>
          <div class="w-1-2">
            <div class="section-title">SHIPMENT DETAILS</div>
            <div class="grid-2">
              <div class="card"><div class="text-xs text-dark mb-1">CONTAINER</div><div class="font-black text-base">${sanitizeInput(load.containerNo || 'N/A')}</div></div>
              <div class="card"><div class="text-xs text-dark mb-1">SIZE / TYPE</div><div class="font-black text-base">${sanitizeInput(load.size || 'N/A')}</div></div>
              <div class="card"><div class="text-xs text-dark mb-1">WEIGHT</div><div class="font-black text-base">${sanitizeInput(load.weight || 'N/A')}</div></div>
              <div class="card"><div class="text-xs text-dark mb-1">LINE</div><div class="font-black text-base">${sanitizeInput(load.shippingLine || 'NON')}</div></div>
            </div>
          </div>
        </div>
        <div class="section-title">ROUTING INSTRUCTIONS</div>
        <div class="flex gap-4 items-center mb-8">
          <div class="card card-blue w-1-2" style="min-height: 120px;">
            <div class="text-xs text-blue-label mb-2">PICK UP / ORIGIN</div>
            <div class="font-black text-base mb-1">${sanitizeInput(originName)}</div>
            <div class="text-sm text-dark mb-2">${sanitizeInput(originAddr)}</div>
            <div class="text-xs text-dark mt-2 mb-1">INSTRUCTIONS</div>
            <div class="text-sm">Booking #: ${sanitizeInput(load.bookingNo || 'N/A')} | RV #: ${sanitizeInput(load.rvNo || 'N/A')}</div>
          </div>
          <div class="text-gray font-black">&rarr;</div>
          <div class="card card-green w-1-2" style="min-height: 120px;">
            <div class="text-xs text-green-label mb-2">DELIVERY / DESTINATION</div>
            <div class="font-black text-base mb-1">${sanitizeInput(destName)}</div>
            <div class="text-sm text-dark mb-2">${sanitizeInput(destAddr)}</div>
            <div class="text-xs text-dark mt-2 mb-1">APPOINTMENT</div>
            <div class="text-sm">${sanitizeInput(load.appointmentDate || 'N/A')} @ ${sanitizeInput(load.appointmentTime || 'TBD')}</div>
          </div>
        </div>
        <div class="section-title">DRIVER INSTRUCTIONS & NOTES</div>
        <div class="card mb-8"><div class="text-sm" style="font-style: italic; white-space: pre-wrap;">${sanitizeInput(load.notes || 'No special instructions. Please drive safely and report any delays immediately.')}</div></div>
        <div class="dashed-divider"></div>
        <div class="flex gap-4">
          <div style="width: 30%;"><div class="text-xs text-dark mb-2">DRIVER</div><div class="card text-center flex items-center justify-center" style="height: 100px; flex-direction: column;"><div class="font-black text-base">${sanitizeInput(leg?.driverName || '_________________')}</div><div class="text-xs mt-2 text-gray">Signature on File</div></div></div>
          <div style="width: 70%;"><div class="text-xs text-dark mb-2">RECEIVER / CONSIGNEE</div><div class="card" style="height: 100px; display: flex; flex-direction: column; justify-content: space-around;"><div class="flex gap-4"><div class="w-1-2"><div class="text-xs text-center mb-1">ARRIVAL TIME</div><div class="sig-line"></div></div><div class="w-1-2"><div class="text-xs text-center mb-1">DEPARTURE TIME</div><div class="sig-line"></div></div></div><div class="flex gap-4 mt-2"><div class="w-1-2"><div class="text-xs text-center mb-1">RECEIVER NAME</div><div class="sig-line"></div></div><div class="w-1-2"><div class="text-xs text-center mb-1">SIGNATURE</div><div class="sig-line"></div></div></div></div></div>
        </div>
        <div class="text-center text-xs text-gray" style="margin-top: 40px;">Generated by ${sanitizeInput(companyName || 'System')} - ${new Date().toLocaleString()}</div>
      </div>
    `;
    const sanitizedHtml = DOMPurify.sanitize(podContent, { ALLOWED_TAGS: ['div','span','style','table','thead','tbody','tr','td','th','p','h3','h4','strong','b','i','em','br','hr','ul','li','pre','img','a','input','label','select','option'], ALLOWED_ATTR: ['class','style','href','src','alt','title','type','name','value','checked','for','id','colspan','rowspan','align','border','cellpadding','crossorigin'] });
    const element = document.createElement('div');
    element.innerHTML = sanitizedHtml;
    const opt = { margin: 0.4, filename: `POD-${load.workOrderNo || 'WorkOrder'}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save().then(() => { if (setFeedback) setFeedback("POD Downloaded Successfully"); });
  } catch (error) { console.error("Error downloading POD:", error); if (setFeedback) setFeedback("Error downloading POD"); }
};

export const downloadInvoice = (load, setFeedback, companyName, companyDetails = {}, locationAddress = null) => {
  if (typeof window === "undefined" || !load) return;
  try {
    if (setFeedback) setFeedback("Generating Invoice PDF...");
    let addressStr = '';
    if (locationAddress) {
      addressStr = locationAddress;
    } else {
      addressStr = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    }
    const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
    const currentDate = new Date().toISOString().split('T')[0];
    
    let rowsHtml = '';
    if (load.revenueItems && Array.isArray(load.revenueItems) && load.revenueItems.length > 0) {
      load.revenueItems.forEach(item => {
        if (safeFloat(item?.amount) > 0 || safeFloat(item?.rate) > 0) {
          rowsHtml += `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">${sanitizeInput(item.item || 'Service Charge')}</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.qty || 1}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${safeFloat(item.rate).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">${currencySymbol}${safeFloat(item.amount).toFixed(2)}</td></tr>`;
        }
      });
    }
    
    // Build the full address string for display
    const fullCompanyAddress = [
      companyDetails?.address,
      companyDetails?.city,
      companyDetails?.province,
      companyDetails?.postalCode
    ].filter(Boolean).join(', ');

    const invoiceContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #111827; background: #fff; line-height: 1.4; box-sizing: border-box; width: 100%;">
        <style>
          * { box-sizing: border-box; }
          .flex { display: flex; }
          .justify-between { justify-content: space-between; }
          .items-start { align-items: flex-start; }
          .gap-4 { gap: 16px; }
          .w-1-2 { width: 50%; }
          .text-right { text-align: right; }
          .mb-8 { margin-bottom: 32px; }
          .font-bold { font-weight: 700; }
          .font-black { font-weight: 900; }
          .text-blue { color: #1d4ed8; }
          .text-gray { color: #9ca3af; }
          .text-xs { font-size: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; }
          .text-base { font-size: 13px; }
          .text-2xl { font-size: 26px; letter-spacing: -0.5px; }
          .divider { border-bottom: 3px solid #111827; margin: 15px 0 25px 0; }
          .section-title { font-weight: 900; font-size: 12px; color: #1f2937; margin-bottom: 12px; display: flex; align-items: center; }
          .section-title::before { content: ''; display: inline-block; width: 4px; height: 14px; background-color: #1d4ed8; margin-right: 8px; }
          .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; background: #f9fafb; }
          .meta-table { width: auto; margin-left: auto; border-collapse: collapse; }
          .meta-table td { padding: 4px 8px; font-size: 11px; }
          .meta-table .label { font-weight: 800; text-align: right; text-transform: uppercase; color: #4b5563; }
          .meta-table .value { font-weight: 800; text-align: right; color: #111827; }
          .invoice-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          .invoice-table th { background: #f3f4f6; border-bottom: 2px solid #d1d5db; padding: 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #4b5563;}
          .invoice-table td { color: #111827; }
          .totals-box { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
          .totals-row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
          .totals-row.grand { background: #1d4ed8; color: #fff; border-bottom: none; }
          .totals-row.grand .label, .totals-row.grand .value { color: #fff; font-weight: 900; font-size: 16px; }
        </style>
        <div class="flex justify-between items-start">
          <!-- LEFT SIDE: Company Info -->
          <div>
            <div class="text-2xl font-black text-blue mb-2">${sanitizeInput(companyName || 'Company Name')}</div>
            ${fullCompanyAddress ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">${sanitizeInput(fullCompanyAddress)}</div>` : ''}
            ${companyDetails?.phone ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">Tel: ${sanitizeInput(companyDetails.phone)}</div>` : ''}
            ${companyDetails?.email ? `<div style="color: #374151; font-size: 11px; line-height: 1.4; font-weight: bold;">Email: ${sanitizeInput(companyDetails.email)}</div>` : ''}
          </div>
          
          <!-- RIGHT SIDE: Logo and Invoice Details -->
          <div class="text-right">
            ${companyDetails?.logoUrl ? `<img src="${sanitizeInput(companyDetails.logoUrl)}" style="max-height: 70px; max-width: 220px; margin-bottom: 10px; margin-left: auto; display: block;" alt="Company Logo" crossorigin="anonymous" />` : ''}
            <div class="text-2xl font-black text-gray mb-2">INVOICE</div>
            <table class="meta-table"><tr><td class="label">INVOICE #</td><td class="value">${sanitizeInput(load.workOrderNo || String(load.id || '').substring(0,8).toUpperCase())}</td></tr><tr><td class="label">DATE</td><td class="value">${currentDate}</td></tr><tr><td class="label">PO #</td><td class="value">${sanitizeInput(load.poNumber || 'N/A')}</td></tr><tr><td class="label">CURRENCY</td><td class="value">${load.currency || 'CAD'}</td></tr><tr><td class="label">TERMS</td><td class="value">Due on Receipt</td></tr></table></div>
        </div>
        <div class="divider"></div>
        <div class="flex gap-4 mb-8">
          <div class="w-1-2"><div class="section-title">BILL TO</div><div class="card" style="height: 120px; background: #fff;"><div class="font-black text-base mb-1">${sanitizeInput(load.customerName || 'N/A')}</div><div style="color: #374151; line-height: 1.5;">${sanitizeInput(load.customerAddress || 'Address on file')}</div><div style="color: #374151; margin-top: 4px;">${sanitizeInput(load.customerEmail || '')}</div></div></div>
          <div class="w-1-2"><div class="section-title">SHIPMENT SUMMARY</div><div class="card flex" style="height: 120px; flex-wrap: wrap; gap: 15px;"><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">CONTAINER #</div><div class="font-bold">${sanitizeInput(load.containerNo || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">SIZE / TYPE</div><div class="font-bold">${sanitizeInput(load.size || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">WEIGHT</div><div class="font-bold">${sanitizeInput(load.weight || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">REF NO</div><div class="font-bold">${sanitizeInput(load.customerRefNo || 'N/A')}</div></div></div></div>
        </div>
        <table class="invoice-table"><thead><tr><th style="width: 50%;">Description</th><th style="width: 15%; text-align: center;">Qty</th><th style="width: 15%; text-align: right;">Rate</th><th style="width: 20%; text-align: right;">Amount</th></tr></thead><tbody>${rowsHtml || `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">Freight Charge</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">1</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${safeFloat(calculateTotal(load)).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">${currencySymbol}${safeFloat(calculateTotal(load)).toFixed(2)}</td></tr>`}</tbody></table>
        <div class="flex justify-between" style="margin-top: 30px; align-items: flex-start;"><div style="width: 50%; color: #6b7280; font-size: 11px; padding-right: 20px;"><p>Thank you for your business.</p><p>Please include invoice number on your check or remittance advice.</p></div><div style="width: 40%;"><div class="totals-box"><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Subtotal</span><span class="value font-bold">${currencySymbol}${calculateTotal(load)}</span></div><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Tax (0%)</span><span class="value font-bold">${currencySymbol}0.00</span></div><div class="totals-row grand"><span class="label">TOTAL DUE</span><span class="value">${currencySymbol}${calculateTotal(load)}</span></div></div></div></div>
      </div>
    `;
    const sanitizedHtml = DOMPurify.sanitize(invoiceContent, { ALLOWED_TAGS: ['div','span','style','table','thead','tbody','tr','td','th','p','h3','h4','strong','b','i','em','br','hr','ul','li','pre','img','a','input','label','select','option'], ALLOWED_ATTR: ['class','style','href','src','alt','title','type','name','value','checked','for','id','colspan','rowspan','align','border','cellpadding','crossorigin'] });
    const element = document.createElement('div');
    element.innerHTML = sanitizedHtml;
    const opt = { margin: 0.4, filename: `Invoice-${load.workOrderNo || 'WorkOrder'}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save().then(() => { if (setFeedback) setFeedback("Invoice Downloaded Successfully"); });
  } catch (error) { console.error("Error downloading invoice:", error); if (setFeedback) setFeedback("Error generating invoice"); }
};

const downloadDailyReportCSV = (loads, companyName) => {
  if (typeof window === "undefined" || !Array.isArray(loads)) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayLoads = loads.filter(l => l?.appointmentDate === today);
    const headers = ["Work Order No", "Container No", "Customer", "Shipping Line", "Size", "Weight", "PO Number", "Pickup No", "Origin", "Destination", "Driver(s)", "Truck(s)", "Appointment Time", "Status", "Currency", "Total Revenue", "Total Cost", "Net Profit"];
    const rows = todayLoads.map(load => {
      const legs = getSafeLegs(load);
      const origin = legs[0]?.from || 'N/A';
      const dest = legs[legs.length - 1]?.to || 'N/A';
      const drivers = [...new Set(legs.map(l => l?.driverName).filter(Boolean))].join(' / ') || 'TBD';
      const trucks = [...new Set(legs.map(l => l?.truckNo).filter(Boolean))].join(' / ') || 'TBD';
      const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
      const rate = calculateTotal(load);
      const cost = calculateCost(load);
      const profit = calculateProfit(load);
      return [escapeCsv(load.workOrderNo), escapeCsv(load.containerNo), escapeCsv(load.customerName), escapeCsv(load.shippingLine), escapeCsv(load.size), escapeCsv(load.weight), escapeCsv(load.poNumber), escapeCsv(load.pickupNo), escapeCsv(origin), escapeCsv(dest), escapeCsv(drivers), escapeCsv(trucks), escapeCsv(load.appointmentTime), escapeCsv(load.status), escapeCsv(load.currency || 'CAD'), escapeCsv(`${currencySymbol}${rate}`), escapeCsv(`${currencySymbol}${cost}`), escapeCsv(`${currencySymbol}${profit}`)].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(companyName || 'Company').replace(/\s+/g, '_')}_Daily_Report_${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) { console.error("Error generating CSV:", error); }
};

const downloadFullCompanyData = async (companyId, companyName, loads, savedCustomers, savedDestinations, savedDrivers, setFeedback) => {
  if (typeof window === "undefined") return;
  try {
    setFeedback("Preparing export...");
    const sheets = {
      'Loads': loads.map(load => ({ 'Work Order No': load.workOrderNo, 'Container No': load.containerNo, 'Status': load.status, 'Customer': load.customerName, 'Shipping Line': load.shippingLine, 'Size': load.size, 'Weight': load.weight, 'PO Number': load.poNumber, 'Pickup No': load.pickupNo, 'Customer Ref': load.customerRefNo, 'Appointment Date': load.appointmentDate, 'Appointment Time': load.appointmentTime, 'Currency': load.currency || 'CAD', 'Total Revenue': formatCurrency(calculateTotal(load), load.currency), 'Total Cost': formatCurrency(calculateCost(load), load.currency), 'Net Profit': formatCurrency(calculateProfit(load), load.currency), 'Notes': load.notes, 'Created At': load.createdAt ? new Date(load.createdAt).toLocaleString() : '', 'Last Updated': load.updatedAt ? new Date(load.updatedAt).toLocaleString() : '', 'Location ID': load.locationId || 'N/A' })),
      'Customers': savedCustomers.map(cust => ({ 'Company Name': cust.name, 'Email': cust.email, 'Phone': cust.phone, 'Address': cust.address, 'City': cust.city, 'Contact Name': cust.contactName, 'Contact Title': cust.contactTitle, 'Fax': cust.fax, 'Postal Code': cust.postalCode, 'Division': cust.division, 'Accounting ID': cust.accountingId })),
      'Locations': savedDestinations.map(loc => ({ 'Name': loc.name, 'Address': loc.address })),
      'Drivers': savedDrivers.map(driver => ({ 'Name': driver.name, 'Truck Number': driver.truckNo, 'Type': driver.type || 'Company Driver' }))
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderName = `${(companyName || 'Company').replace(/\s+/g, '_')}_Full_Export_${timestamp}`;
    for (const [sheetName, data] of Object.entries(sheets)) {
      if (data.length === 0) continue;
      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(','), ...data.map(row => headers.map(header => { const value = row[header] || ''; return `"${String(value).replace(/"/g, '""')}"`; }).join(','))];
      const csvContent = csvRows.join('\n');
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}_${sheetName}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    setFeedback(`✅ Full data export complete! ${Object.keys(sheets).filter(k => sheets[k].length > 0).length} files downloaded.`);
  } catch (error) { console.error("Export error:", error); setFeedback("❌ Export failed. Please try again."); }
};

const exportInvoicesToExcel = (loads, startDate, endDate, companyName, savedCustomers) => {
  const filtered = loads.filter(load => {
    // ✅ Only include approved loads with invoice numbers
    if (!load.billingApproved || !load.invoiceNumber) return false;
    
    const invoiceDate = load.appointmentDate || load.createdAt?.split('T')[0];
    if (!invoiceDate) return false;
    if (startDate && invoiceDate < startDate) return false;
    if (endDate && invoiceDate > endDate) return false;
    return true;
  });

  if (filtered.length === 0) {
    alert('No approved invoices found in the selected date range.');
    return;
  }

  const rows = [];

  filtered.forEach(load => {
    // ✅ Use the generated invoice number, NOT work order
    const invoiceNo = load.invoiceNumber || load.workOrderNo || String(load.id).substring(0,8).toUpperCase();
    const customer = load.customerName || 'N/A';
    const invoiceDate = load.appointmentDate || load.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0];
    const currency = load.currency || 'CAD';
   
    const dueDateObj = new Date(invoiceDate);
    dueDateObj.setDate(dueDateObj.getDate() + 30);
    const dueDate = dueDateObj.toISOString().split('T')[0];
   
    const terms = 'NET30';
    const memo = 'Internal reference';
   
    const customerObj = savedCustomers?.find(c => c.name === load.customerName);
    const taxRates = {
      'GST': 0.05,
      'HST': 0.13,
      'QST': 0.09975,
      'None': 0
    };
    const taxRate = taxRates[customerObj?.taxStatus || 'GST'] || 0.05;
    const tax = taxRate;

    let paymentStatus = 'Unpaid';
    if (load.status === 'Paid' || load.status === 'Completed') {
      paymentStatus = 'Paid';
    } else {
      const today = new Date();
      if (dueDateObj < today) {
        paymentStatus = 'Overdue';
      }
    }

    // ✅ Get ALL revenue items (including extra charges)
    const revenueItems = load.revenueItems || [];
    
    // ✅ ALWAYS show each charge as a separate row
    if (revenueItems.length === 0) {
      // If no revenue items, show the total as freight
      rows.push({
        InvoiceNo: invoiceNo,
        Customer: customer,
        InvoiceDate: invoiceDate,
        DueDate: dueDate,
        Terms: terms,
        PaymentStatus: paymentStatus,
        Currency: currency,
        Item: 'Freight Charge',
        ItemDesc: '',
        ItemQuantity: 1,
        ItemRate: safeFloat(calculateTotal(load)),
        ItemAmount: safeFloat(calculateTotal(load)),
        Memo: memo,
        ItemTax: tax
      });
    } else {
      // ✅ Each revenue item gets its own row with the SAME invoice number
      revenueItems.forEach(item => {
        // Skip items with zero amount
        const amount = safeFloat(item.amount);
        if (amount <= 0) return;
        
        rows.push({
          InvoiceNo: invoiceNo,
          Customer: customer,
          InvoiceDate: invoiceDate,
          DueDate: dueDate,
          Terms: terms,
          PaymentStatus: paymentStatus,
          Currency: currency,
          Item: item.item || 'Service',
          ItemDesc: '',
          ItemQuantity: item.qty || 1,
          ItemRate: safeFloat(item.rate),
          ItemAmount: amount,
          Memo: memo,
          ItemTax: tax
        });
      });
      
      // ✅ If no items were added (all were zero), add a default freight charge
      if (rows.length === 0 || rows[rows.length - 1].InvoiceNo !== invoiceNo) {
        const totalAmount = safeFloat(calculateTotal(load));
        if (totalAmount > 0) {
          rows.push({
            InvoiceNo: invoiceNo,
            Customer: customer,
            InvoiceDate: invoiceDate,
            DueDate: dueDate,
            Terms: terms,
            PaymentStatus: paymentStatus,
            Currency: currency,
            Item: 'Freight Charge',
            ItemDesc: '',
            ItemQuantity: 1,
            ItemRate: totalAmount,
            ItemAmount: totalAmount,
            Memo: memo,
            ItemTax: tax
          });
        }
      }
    }
  });

  // Sort rows by InvoiceNo and then by Item
  rows.sort((a, b) => {
    if (a.InvoiceNo < b.InvoiceNo) return -1;
    if (a.InvoiceNo > b.InvoiceNo) return 1;
    return a.Item.localeCompare(b.Item);
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  
  // Set column widths
  ws['!cols'] = [
    { wch: 15 }, // InvoiceNo
    { wch: 25 }, // Customer
    { wch: 12 }, // InvoiceDate
    { wch: 12 }, // DueDate
    { wch: 10 }, // Terms
    { wch: 12 }, // PaymentStatus
    { wch: 10 }, // Currency
    { wch: 25 }, // Item
    { wch: 25 }, // ItemDesc
    { wch: 10 }, // ItemQuantity
    { wch: 12 }, // ItemRate
    { wch: 12 }, // ItemAmount
    { wch: 20 }, // Memo
    { wch: 10 }  // ItemTax
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SalesInvoices');
  const fileName = startDate && endDate
    ? `Invoices_${startDate}_to_${endDate}.xlsx`
    : `Invoices_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

// ========== MIGRATION SCRIPT ==========
export const fixUsersWithNullCompanyId = async () => {
  try {
    console.log("🔍 Scanning for users with null companyId...");
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let fixed = 0;
    let errors = [];
   
    for (const userDoc of usersSnapshot.docs) {
      const data = userDoc.data();
      if (!data.companyId) {
        console.log(`🔧 Fixing user: ${userDoc.id}`);
       
        const companiesQuery = query(
          collection(db, 'companies'),
          where('memberUids', 'array-contains', userDoc.id)
        );
        const companiesSnap = await getDocs(companiesQuery);
       
        if (!companiesSnap.empty) {
          const companyId = companiesSnap.docs[0].id;
          await updateDoc(userDoc.ref, {
            companyId: companyId,
            fixedByMigration: true,
            fixedAt: new Date()
          });
          fixed++;
          console.log(`✅ Fixed user ${userDoc.id} → company ${companyId}`);
        } else {
          const creatorQuery = query(
            collection(db, 'companies'),
            where('createdBy', '==', userDoc.id)
          );
          const creatorSnap = await getDocs(creatorQuery);
         
          if (!creatorSnap.empty()) {
            const companyId = creatorSnap.docs[0].id;
            await updateDoc(userDoc.ref, {
              companyId: companyId,
              fixedByMigration: true,
              fixedAt: new Date()
            });
            await updateDoc(creatorSnap.docs[0].ref, {
              memberUids: arrayUnion(userDoc.id)
            });
            fixed++;
            console.log(`✅ Fixed user ${userDoc.id} → company ${companyId} (creator)`);
          } else {
            console.warn(`⚠️ Could not find company for user ${userDoc.id}`);
            errors.push({ userId: userDoc.id, error: "No company found" });
          }
        }
      }
    }
   
    console.log(`✅ Migration complete. Fixed ${fixed} users. Errors: ${errors.length}`);
    return { fixed, errors };
  } catch (error) {
    console.error("Migration failed:", error);
    return { fixed: 0, errors: [error.message] };
  }
};

// ================================================
// SIGNUP & TEAM FUNCTIONS
// ================================================

const signUp = async (email, password, companyName, locations = [], dataSharingMode = 'separate') => {
  let userCredential;
  try {
    userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const companyId = crypto.randomUUID();

    const batch = writeBatch(db);
   
    const companyRef = doc(db, "companies", companyId);
    const userRef = doc(db, "users", uid);
   
    batch.set(companyRef, {
      name: sanitizeInput(companyName),
      dataSharingMode: dataSharingMode,
      locations: locations.map(l => ({
        ...l,
        id: l.id,
        name: sanitizeInput(l.name),
        address: sanitizeInput(l.address),
        city: sanitizeInput(l.city || ''),
        province: sanitizeInput(l.province || ''),
        postalCode: sanitizeInput(l.postalCode || '')
      })),
      createdAt: serverTimestamp(),
      createdBy: uid,
      memberUids: [uid],
      setupComplete: false
    });
   
    batch.set(userRef, {
      email: email,
      companyId: companyId,
      role: "owner",
      accessibleLocations: locations.map(l => l.id),
      defaultLocation: locations[0]?.id || null,
      setupComplete: false,
      createdAt: serverTimestamp(),
      emailVerified: userCredential.user.emailVerified || false
    });
   
    await batch.commit();
   
    return { companyId, uid };
   
  } catch (error) {
    console.error("Signup error:", error);
   
    if (userCredential?.user) {
      try {
        await userCredential.user.delete();
        console.log("🧹 Cleaned up auth user after Firestore failure");
      } catch (cleanupError) {
        console.error("Failed to cleanup auth user:", cleanupError);
      }
    }
   
    throw new Error("Failed to create account. Please try again.");
  }
};

const handleSignIn = async (email, password, setCompanyId, setUserRole, setAppState) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const userDoc = await getDoc(doc(db, "users", uid));
    if (!userDoc.exists()) throw new Error("User profile missing");
    const { companyId, role } = userDoc.data();
    setCompanyId(companyId);
    setUserRole(role);
    setAppState("dashboard");
  } catch (error) {
    console.error("Login error:", error.message);
    alert(error.message);
  }
};

const LocationSelector = ({ userLocations, currentLocation, onLocationChange, dataSharingMode }) => {
  if (dataSharingMode === 'unified' || !userLocations || userLocations.length <= 1) return null;
  return (
    <div className="relative">
      <select
        value={currentLocation || ''}
        onChange={(e) => onLocationChange(e.target.value)}
        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-purple-500"
      >
        <option value="">All Locations (Admin View)</option>
        {userLocations.map(loc => (
          <option key={loc.id} value={loc.id}>{loc.name}</option>
        ))}
      </select>
    </div>
  );
};

// ========== MODAL COMPONENTS ==========
const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-2"><AlertCircle className="w-8 h-8 text-red-500" /></div>
          <h3 className="text-xl font-black text-slate-900">{sanitizeInput(title)}</h3>
          <p className="text-sm font-medium text-slate-500 leading-relaxed">{sanitizeInput(message)}</p>
        </div>
        <div className="flex border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
          <div className="w-px bg-slate-100"></div>
          <button onClick={() => { if (onConfirm) onConfirm(); if (onClose) onClose(); }} className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
};

const ImportDataModal = ({ isOpen, onClose, onImport, isLoading }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mappingStep, setMappingStep] = useState('upload');
  const [importType, setImportType] = useState('loads');
  const [detectedMapping, setDetectedMapping] = useState(null);
  const [customMapping, setCustomMapping] = useState({});
  const [importStats, setImportStats] = useState(null);
  
  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    const extension = selectedFile.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(extension)) { alert("Please upload .xlsx, .xls, or .csv files only"); return; }
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const ExcelJS = await retryDynamicImport(() => import('exceljs'));
        const workbook = new ExcelJS.Workbook();
        const buffer = event.target.result;
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) { alert("No worksheet found in file"); return; }
        const headers = [];
        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell, colNumber) => { headers.push(cell.value ? String(cell.value).trim() : `Column${colNumber}`); });
        const sample = [];
        let rowCount = 0;
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          if (rowCount >= 5) return;
          const rowData = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber - 1];
            let value = cell.value;
            if (value && typeof value === 'object') {
              if (value.text) value = value.text;
              else if (value.result) value = value.result;
              else if (value.error) value = value.error;
              else if (value.formula) value = value.formula;
              else value = JSON.stringify(value);
            }
            rowData[header] = value;
          });
          sample.push(rowData);
          rowCount++;
        });
        setPreview({ headers, sample });
      } catch (err) {
        console.error("Error previewing file:", err);
        setFile(null);
        alert("❌ This file format is not supported. Please re-save it as .xlsx (File → Save As → Excel Workbook) and try again.");
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  };
  
  const handleAnalyze = async () => {
    if (!file) return;
    try {
      const result = await importExcelData(file, null, null, (progress) => {
        setDetectedMapping({ foundColumns: progress.foundColumns, missingColumns: progress.missingColumns, totalFound: progress.found, totalFields: progress.total });
      });
      setMappingStep('mapping');
      setCustomMapping(result.mapping);
    } catch (err) {
      console.error("Error analyzing file:", err);
      setFile(null);
      alert("❌ This file format is not supported. Please re-save it as .xlsx (File → Save As → Excel Workbook) and try again.");
    }
  };
  
  const handleConfirmImport = async () => {
    setMappingStep('confirm');
    const result = await onImport(file, importType);
    setImportStats(result);
  };
  
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-3"><div className="bg-purple-600 p-2 rounded-xl text-white"><FileSpreadsheet className="w-5 h-5" /></div><div><h2 className="font-black text-slate-900">Import Data from Excel/CSV</h2><p className="text-xs text-slate-500">Upload your old software data - we'll map it automatically</p><div className="flex gap-2 mt-3">
            {['loads', 'customers', 'locations', 'drivers'].map(type => (
              <button
                key={type}
                onClick={() => setImportType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  importType === type
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div></div></div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {mappingStep === 'upload' && (
            <div className="bg-slate-50 p-4 rounded-xl mb-4">
              <h4 className="font-bold text-sm mb-3">Download Template Files</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {['loads', 'customers', 'locations', 'drivers'].map(type => {
                  const templates = {
                    loads: { headers: 'containerNo,customerName,shippingLine,size,weight,poNumber,pickupNo,customerRefNo,appointmentDate,appointmentTime,origin,destination,driverName,truckNo,basePrice,currency' },
                    customers: { headers: 'name,email,phone,address,city,postalCode,contactName,contactTitle,fax,division,accountingId' },
                    locations: { headers: 'name,address,city,province,postalCode' },
                    drivers: { headers: 'name,truckNo,type' }
                  };
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        const csv = templates[type].headers + '\n';
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${type}_template.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="px-3 py-2 bg-white border rounded-lg text-xs font-bold hover:bg-purple-50 hover:border-purple-200 transition-colors capitalize"
                    >
                      📥 {type} Template
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {mappingStep === 'upload' && (<><div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-purple-300 transition-colors"><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" id="excelUpload" /><label htmlFor="excelUpload" className="cursor-pointer block"><Upload className="w-12 h-12 text-purple-400 mx-auto mb-4" /><div className="font-bold text-slate-700 mb-2">Click to upload Excel/CSV file</div><div className="text-xs text-slate-400">Supports .xlsx, .xls, .csv formats</div></label></div>{preview && (<div className="bg-slate-50 rounded-xl p-4"><h3 className="font-bold text-sm mb-3">File Preview</h3><div className="overflow-x-auto"><table className="text-xs border-collapse w-full"><thead><tr className="bg-slate-200">{preview.headers.map((h, i) => (<th key={i} className="p-2 text-left font-bold">{h}</th>))}</tr></thead><tbody>{preview.sample.map((row, i) => (<tr key={i} className="border-b border-slate-200">{preview.headers.map((h, j) => (<td key={j} className="p-2">{String(row[h] || '-').substring(0, 30)}</td>))}</tr>))}</tbody></table></div><p className="text-[10px] text-slate-400 mt-3">Showing first 5 rows. Total columns: {preview.headers.length}</p></div>)}<button onClick={handleAnalyze} disabled={!file} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors disabled:opacity-50">Analyze & Map Columns →</button></>)}
          {mappingStep === 'mapping' && detectedMapping && (<><div className="bg-green-50 p-4 rounded-xl border border-green-200"><div className="flex items-center gap-2 mb-2"><CheckCircle className="w-5 h-5 text-green-600" /><span className="font-bold text-green-800">Auto-detected {detectedMapping.totalFound} of {detectedMapping.totalFields} fields</span></div><p className="text-xs text-green-700">Review the mapping below and adjust if needed</p></div>{detectedMapping.missingColumns.length > 0 && (<div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200"><div className="flex items-center gap-2 mb-2"><AlertCircle className="w-5 h-5 text-yellow-600" /><span className="font-bold text-yellow-800">Missing {detectedMapping.missingColumns.length} fields</span></div><p className="text-xs text-yellow-700">These fields couldn't be auto-detected. They will be set to default values. Missing: {detectedMapping.missingColumns.join(', ')}</p></div>)}<div className="space-y-3 max-h-96 overflow-y-auto"><h3 className="font-bold text-sm">Column Mapping</h3>{Object.entries(customMapping).map(([field, column]) => (<div key={field} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg"><div className="w-32 text-xs font-bold text-slate-700">{field.replace(/([A-Z])/g, ' $1').trim()}</div><div className="flex-1"><select value={column || ''} onChange={(e) => setCustomMapping({ ...customMapping, [field]: e.target.value || null })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white"><option value="">-- Auto-detect --</option>{preview?.headers.map(h => (<option key={h} value={h}>{h}</option>))}</select></div>{column && (<div className="text-green-600"><CheckCircle className="w-4 h-4" /></div>)}</div>))}</div><div className="flex gap-3"><button onClick={() => setMappingStep('upload')} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Back</button><button onClick={handleConfirmImport} className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700">Import {preview?.sample?.length || 0} {importType} →</button></div></>)}
          {mappingStep === 'confirm' && importStats && (<div className="space-y-4"><div className={`p-6 rounded-xl text-center ${importStats.success ? 'bg-green-50' : 'bg-red-50'}`}>{importStats.success ? (<><CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" /><h3 className="text-xl font-black text-green-800">Import Complete!</h3><p className="text-green-700 mt-2">Successfully imported {importStats.imported} loads</p>{importStats.errors > 0 && (<p className="text-yellow-600 text-sm mt-2">{importStats.errors} records had issues and were skipped</p>)}</>) : (<><XCircle className="w-16 h-16 text-red-600 mx-auto mb-4" /><h3 className="text-xl font-black text-red-800">Import Failed</h3><p className="text-red-700 mt-2">{importStats.error}</p></>)}</div>{importStats.errors > 0 && importStats.errorDetails && (<div className="bg-yellow-50 p-4 rounded-xl max-h-48 overflow-y-auto"><p className="font-bold text-sm mb-2">Issues encountered:</p>{importStats.errorDetails.slice(0, 10).map((err, i) => (<p key={i} className="text-xs text-yellow-700">Row {err.row}: {err.error}</p>))}</div>)}<button onClick={onClose} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700">Done</button></div>)}
        </div>
      </div>
    </div>
  );
};

const DraftEmailModal = ({ isOpen, onClose, content, onSend }) => {
  const [editedContent, setEditedContent] = useState(content || "");
  useEffect(() => { setEditedContent(content || ""); }, [content]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 p-6 space-y-4 animate-in zoom-in-95">
        <div className="flex justify-between items-center border-b pb-4"><h3 className="font-bold text-lg flex items-center gap-2 text-slate-800"><div className="bg-purple-100 p-2 rounded-lg"><Mail className="w-5 h-5 text-purple-600" /></div>Compose Invoice Email</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button></div>
        <textarea className="w-full h-64 p-4 border border-slate-200 rounded-xl text-sm leading-relaxed outline-blue-500 bg-slate-50 font-medium text-slate-700 resize-none" value={editedContent} onChange={(e) => setEditedContent(e.target.value)} />
        <div className="flex gap-3 justify-end pt-2"><button onClick={onClose} className="px-5 py-2.5 text-slate-500 font-bold text-sm hover:bg-slate-50 rounded-xl transition-colors">Cancel</button><button onClick={() => onSend && onSend(editedContent)} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"><Send className="w-4 h-4" /> Send Email</button></div>
      </div>
    </div>
  );
};

const TrackingModal = ({ load, onClose, onUpdateStatus }) => {
  const [loading, setLoading] = useState(false);
  const [manualStatus, setManualStatus] = useState(load?.lastTrackingStatus || "Pending");
  const timerRef = useRef(null);
  const isMountedRef = useIsMountedRef();
  useEffect(() => { return () => clearTimeout(timerRef.current); }, []);
  const simulateLiveCheck = () => {
    clearTimeout(timerRef.current);
    setLoading(true);
    timerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      const statuses = ["Vessel Arrived at Port", "Discharged from Vessel", "Loaded on Rail", "Rail Departed: Toronto, ON", "Rail Arrived: Chicago, IL", "Grounded at Terminal", "Available for Pickup"];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
      setManualStatus(randomStatus);
      if (onUpdateStatus && load?.id) onUpdateStatus(load.id, randomStatus);
      setLoading(false);
    }, 1500);
  };
  const openCarrierSite = async () => { 
  try { 
    if (load?.containerNo) await copyToClipboard(load.containerNo); 
    // Pass the entire load object to getTrackingUrl for context
    const url = getTrackingUrl(load?.shippingLine, load); 
    if (url) window.open(url, '_blank'); 
  } catch (error) { 
    console.error("Failed opening carrier site", error); 
  } 
};
  if (!load) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><div className="flex items-center gap-3"><div className="bg-blue-600 p-2 rounded-xl text-white"><Globe className="w-5 h-5" /></div><div><h2 className="font-black text-slate-900 text-lg">Live Tracking</h2><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{load.shippingLine} • {load.containerNo}</p></div></div><button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button></div>
        <div className="p-8 space-y-8"><div className="text-center space-y-2"><div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-black uppercase tracking-widest border border-blue-100">Current Status</div><div className="text-2xl font-black text-slate-800">{loading ? " contacting satellite..." : manualStatus}</div><p className="text-xs text-slate-400 font-bold">Last Updated: {new Date().toLocaleTimeString()}</p></div><div className="grid grid-cols-2 gap-4"><button onClick={simulateLiveCheck} disabled={loading} className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group"><RefreshCw className={`w-6 h-6 text-blue-600 ${loading ? 'animate-spin' : ''}`} /><span className="text-xs font-black text-slate-600 group-hover:text-blue-700">REFRESH STATUS</span></button><button onClick={openCarrierSite} className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group"><ExternalLink className="w-6 h-6 text-blue-600" /><span className="text-xs font-black text-slate-600 group-hover:text-blue-700">OPEN {load.shippingLine} SITE</span><span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">Auto-Copies Container #</span></button></div><div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-[10px] text-slate-400 font-medium leading-relaxed text-center">Note: Direct API tracking requires a paid subscription to Project44 or Vizion. This module provides direct links to carrier portals (CN, CP, ONE) and simulated status updates for this demo.</div></div>
      </div>
    </div>
  );
};

const SignaturePad = ({ onSave, onCancel }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const preventScroll = (e) => e.preventDefault();
    canvas.addEventListener('touchstart', preventScroll, { passive: false });
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    return () => { canvas.removeEventListener('touchstart', preventScroll); canvas.removeEventListener('touchmove', preventScroll); };
  }, []);
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX = 0, clientY = 0;
    if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } else { clientX = e.clientX; clientY = e.clientY; }
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const startDrawing = (e) => { const { x, y } = getCoordinates(e); const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.beginPath(); ctx.moveTo(x, y); setIsDrawing(true); };
  const draw = (e) => { if (!isDrawing) return; const { x, y } = getCoordinates(e); const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.lineTo(x, y); ctx.stroke(); };
  const stopDrawing = () => setIsDrawing(false);
  const clear = () => { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); };
  const save = () => { const canvas = canvasRef.current; if (canvas && onSave) { onSave(canvas.toDataURL()); } };
  return (
    <div className="space-y-4"><div className="border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 relative overflow-hidden touch-none"><canvas ref={canvasRef} width={500} height={200} className="w-full h-[200px] cursor-crosshair touch-none" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} /><button type="button" onClick={clear} className="absolute bottom-3 right-3 p-2 bg-white shadow-sm border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><RotateCcw className="w-4 h-4" /></button></div><div className="flex gap-3"><button type="button" onClick={onCancel} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 transition-colors hover:bg-slate-200">Cancel</button><button type="button" onClick={save} className="flex-1 py-3 bg-blue-600 rounded-xl font-bold text-white shadow-lg transition-all hover:bg-blue-700">Confirm Signature</button></div></div>
  );
};

const buildLegacyRevenueItems = (initialData) => {
  let revItems = initialData?.revenueItems;
  if (!revItems && initialData) {
    revItems = [];
    if (safeFloat(initialData.basePrice) > 0) revItems.push({ id: 'r1', item: 'Base Rate', qty: 1, rate: initialData.basePrice, amount: initialData.basePrice });
    if (safeFloat(initialData.waitingTime) > 0) revItems.push({ id: 'r2', item: 'Wait Time', qty: 1, rate: initialData.waitingTime, amount: initialData.waitingTime });
    if (safeFloat(initialData.fuelSurcharge) > 0) revItems.push({ id: 'r3', item: 'Fuel Surcharge', qty: 1, rate: initialData.fuelSurcharge, amount: initialData.fuelSurcharge });
    if (revItems.length === 0) revItems = [{ id: Date.now().toString(), item: 'Freight Charge', qty: 1, rate: '', amount: '' }];
  }
  return revItems || [{ id: Date.now().toString(), item: 'Freight Charge', qty: 1, rate: '', amount: '' }];
};

const buildLegacyExpenseItems = (initialData) => {
  let expItems = initialData?.expenseItems;
  if (!expItems && initialData) {
    expItems = [];
    if (safeFloat(initialData.driverCost) > 0) expItems.push({ id: 'e1', item: 'Driver Cost', qty: 1, rate: initialData.driverCost, amount: initialData.driverCost });
    if (safeFloat(initialData.fuelCost) > 0) expItems.push({ id: 'e2', item: 'Fuel Cost', qty: 1, rate: initialData.fuelCost, amount: initialData.fuelCost });
    if (safeFloat(initialData.brokerRate) > 0) expItems.push({ id: 'e3', item: 'Broker / Other', qty: 1, rate: initialData.brokerRate, amount: initialData.brokerRate });
  }
  return expItems || [];
};

const saveNewLocationIfNeeded = async (locationString, companyId) => {
  if (!locationString || !companyId) return;
  const name = locationString.split(' - ')[0].trim();
  if (!name) return;
  try {
    const q = query(collection(db, 'companies', companyId, 'locations'), where('name', '==', name));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await addDoc(collection(db, 'companies', companyId, 'locations'), {
        name: name,
        address: locationString,
        companyId: companyId
      });
    }
  } catch (err) {
    console.error("Error saving location:", err);
  }
};

const importExcelData = async (file, companyId, setFeedback, onProgress) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const ExcelJS = await retryDynamicImport(() => import('exceljs'));
        const workbook = new ExcelJS.Workbook();
        const buffer = e.target.result;
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) { reject(new Error("No worksheet found in file")); return; }
        const headers = [];
        const row1 = worksheet.getRow(1);
        row1.eachCell((cell, colNumber) => { headers.push(cell.value ? String(cell.value).trim() : `Column${colNumber}`); });
        const jsonData = [];
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const rowData = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber - 1];
            let value = cell.value;
            if (value && typeof value === 'object') {
              if (value.text) value = value.text;
              else if (value.result) value = value.result;
              else if (value.error) value = value.error;
              else if (value.formula) value = value.formula;
              else value = JSON.stringify(value);
            }
            rowData[header] = value;
          });
          jsonData.push(rowData);
        });
        if (jsonData.length === 0) { reject(new Error("No data found in file")); return; }
        const sampleRow = jsonData[0];
        const availableColumns = Object.keys(sampleRow);
        const detectColumn = (availableColumns, possibleNames) => {
          const lowerColumns = availableColumns.map(c => c.toLowerCase().trim());
          for (const possible of possibleNames) {
            const exactMatch = lowerColumns.find(col => col === possible.toLowerCase());
            if (exactMatch) return availableColumns[lowerColumns.indexOf(exactMatch)];
            const partialMatch = lowerColumns.find(col => col.includes(possible.toLowerCase()) || possible.toLowerCase().includes(col));
            if (partialMatch) return availableColumns[lowerColumns.indexOf(partialMatch)];
          }
          return null;
        };
        const columnMapping = {
          containerNo: detectColumn(availableColumns, ['container', 'container_no', 'container#', 'container number', 'cntr']),
          customerName: detectColumn(availableColumns, ['customer', 'customer_name', 'consignee', 'shipper', 'client']),
          poNumber: detectColumn(availableColumns, ['po', 'po_number', 'purchase_order', 'order_no']),
          pickupNo: detectColumn(availableColumns, ['pickup', 'pickup_no', 'pu_number', 'pick_up']),
          customerRefNo: detectColumn(availableColumns, ['ref', 'reference', 'cust_ref', 'customer_ref']),
          shippingLine: detectColumn(availableColumns, ['line', 'shipping_line', 'carrier', 'vessel']),
          size: detectColumn(availableColumns, ['size', 'container_size', 'equipment', 'type']),
          weight: detectColumn(availableColumns, ['weight', 'kg', 'lbs', 'gross_weight']),
          appointmentDate: detectColumn(availableColumns, ['date', 'appointment_date', 'delivery_date', 'pickup_date', 'eta']),
          appointmentTime: detectColumn(availableColumns, ['time', 'appointment_time', 'delivery_time']),
          status: detectColumn(availableColumns, ['status', 'load_status', 'trip_status']),
          workOrderNo: detectColumn(availableColumns, ['wo', 'work_order', 'workorder', 'trip_no', 'load_id']),
          customerEmail: detectColumn(availableColumns, ['email', 'customer_email', 'billing_email']),
          customerPhone: detectColumn(availableColumns, ['phone', 'customer_phone', 'tel']),
          customerAddress: detectColumn(availableColumns, ['address', 'customer_address', 'location']),
          notes: detectColumn(availableColumns, ['notes', 'instructions', 'comments', 'special_instructions']),
          basePrice: detectColumn(availableColumns, ['rate', 'price', 'charge', 'amount', 'revenue']),
          driverPay: detectColumn(availableColumns, ['driver_pay', 'driver_cost', 'pay', 'driver_rate']),
          fuelCost: detectColumn(availableColumns, ['fuel', 'fuel_cost', 'diesel']),
          currency: detectColumn(availableColumns, ['currency', 'curr', 'currency_code']),
          origin: detectColumn(availableColumns, ['origin', 'from', 'pickup_location', 'pu_location']),
          destination: detectColumn(availableColumns, ['destination', 'to', 'delivery_location', 'drop_location']),
          driverName: detectColumn(availableColumns, ['driver', 'driver_name', 'truck_driver']),
          truckNo: detectColumn(availableColumns, ['truck', 'truck_no', 'truck_number', 'unit'])
        };
        const foundMappings = Object.entries(columnMapping).filter(([_, col]) => col);
        const missingMappings = Object.entries(columnMapping).filter(([_, col]) => !col);
        if (foundMappings.length === 0) { reject(new Error("No matching columns found. Please check file format.")); return; }
        if (onProgress) { onProgress({ found: foundMappings.length, total: Object.keys(columnMapping).length, foundColumns: foundMappings.map(([key, col]) => ({ field: key, column: col })), missingColumns: missingMappings.map(([key, col]) => key) }); }
        const formatDate = (value) => {
          if (!value) return '';
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            return value.split('T')[0];
          }
          if (typeof value === 'number') {
            const date = new Date((value - 25569) * 86400000);
            if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
              return date.toISOString().split('T')[0];
            }
          }
          try {
            const date = new Date(value);
            if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
              return date.toISOString().split('T')[0];
            }
          } catch (e) {}
          return '';
        };

        const formatTime = (value) => {
          if (!value) return '';
          if (typeof value === 'string' && /^\d{2}:\d{2}/.test(value)) {
            return value.substring(0, 5);
          }
          if (typeof value === 'number') {
            const date = new Date((value - 25569) * 86400000);
            if (!isNaN(date.getTime())) {
              return date.toTimeString().substring(0, 5);
            }
          }
          return '';
        };

        const transformedLoads = [];
        const errors = [];
        for (let i = 0; i < jsonData.length; i++) {
          const row = jsonData[i];
          try {
            const currencyValue = row[columnMapping.currency];
            const currency = (currencyValue && ['CAD', 'USD'].includes(String(currencyValue).toUpperCase()))
              ? String(currencyValue).toUpperCase()
              : 'CAD';
           
            const load = {
              status: "Open",
              workOrderNo: row[columnMapping.workOrderNo] || `IMP-${Date.now()}-${i}`,
              containerNo: row[columnMapping.containerNo] || 'N/A',
              shippingLine: row[columnMapping.shippingLine] || '',
              poNumber: row[columnMapping.poNumber] || '',
              pickupNo: row[columnMapping.pickupNo] || '',
              customerRefNo: row[columnMapping.customerRefNo] || '',
              size: row[columnMapping.size] || '40GE (General)',
              weight: row[columnMapping.weight] || '',
              customerName: row[columnMapping.customerName] || '',
              customerEmail: row[columnMapping.customerEmail] || '',
              customerPhone: row[columnMapping.customerPhone] || '',
              customerAddress: row[columnMapping.customerAddress] || '',
              appointmentDate: formatDate(row[columnMapping.appointmentDate]),
              appointmentTime: formatTime(row[columnMapping.appointmentTime]) || '',
              currency: currency,
              loadConfirmation: null,
              signedPodDoc: null,
              revenueItems: [{ id: Date.now().toString() + i, item: 'Freight Charge', qty: 1, rate: row[columnMapping.basePrice] || '', amount: row[columnMapping.basePrice] || '' }],
              expenseItems: [],
              legs: [{ id: Date.now() + i, from: row[columnMapping.origin] || '', to: row[columnMapping.destination] || '', driverName: row[columnMapping.driverName] || '', truckNo: row[columnMapping.truckNo] || '', status: "Planned", arrivalTime: "", departureTime: "", signature: null, driverPay: row[columnMapping.driverPay] || '', fuelCost: row[columnMapping.fuelCost] || '', detentionPay: "" }],
              notes: row[columnMapping.notes] || `Imported from Excel on ${new Date().toLocaleString()}`,
              lastTrackingStatus: "Pending",
              auditLog: [{ timestamp: new Date().toISOString(), user: 'System Import', role: 'system', action: 'Imported from Excel', changes: [] }],
              createdAt: new Date().toISOString(),
              dateAdded: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            transformedLoads.push(load);
          } catch (err) { errors.push({ row: i + 2, error: err.message }); }
        }
        resolve({ loads: transformedLoads, errors, mapping: columnMapping });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
};

// ========== LOAD FORM COMPONENT ==========
const LoadForm = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  savedCustomers,
  savedDestinations,
  savedDrivers,
  savedBasePrices,
  apiKey,
  companyId,
  userId,
  userRole,
  userEmail,
  setFeedback,
  currentLocation,
  userAccessibleLocations,
  dataSharingMode,
  companyLocations = [],
  companyTerminals = [],
}) => {
  // ===== DEBUG: LOG BASE PRICES =====
  useEffect(() => {
    console.log("🔍 LoadForm received base prices:", savedBasePrices);
    if (savedBasePrices && savedBasePrices.length > 0) {
      console.log("📋 Base price locations:", savedBasePrices.map(bp => bp.location));
    }
  }, [savedBasePrices]);

  // ===== STATE VARIABLES =====
  const [formData, setFormData] = useState(createEmptyLoadForm());
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [recurringTemplate, setRecurringTemplate] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [activeStep, setActiveStep] = useState('step1');
  const [editingLegId, setEditingLegId] = useState(null); // ✅ Replaces expandedLegId
  const [isSaving, setIsSaving] = useState(false); // ✅ Prevent double submit

  const initializedLoadRef = useRef(null);
  const [formVersion, setFormVersion] = useState(0);
  const noteTimerRef = useRef(null);
  const isMountedRef = useIsMountedRef();
  const lastUploadTimeRef = useRef(0);
  const templateDropdownRef = useRef(null);
  const UPLOAD_COOLDOWN_MS = 5000;

  // ===== CONSTANTS =====
  const isAdmin = userRole === 'owner' || userRole === 'admin';
  const isDispatcher = userRole === 'dispatcher';
  const isAccounting = userRole === 'accounting';
  const isCustomerService = userRole === 'customer_service';

  const isFinancialLocked = 
    (userRole === 'dispatcher' && ['Invoiced', 'Paid', 'Completed'].includes(formData.status)) ||
    (userRole === 'customer_service' && ['Invoiced', 'Paid', 'Completed'].includes(formData.status)) ||
    (userRole !== 'accounting' && userRole !== 'admin' && userRole !== 'owner' && userRole !== 'customer_service' && ['Paid', 'Completed'].includes(formData.status));
  
  const currencySymbol = formData.currency === 'USD' ? 'US$' : 'C$';

  // ===== AUTO-FILL PRICE FROM BASE PRICES =====
  const autoFillPriceFromLocation = useCallback((itemName) => {
    if (!savedBasePrices || savedBasePrices.length === 0) return null;
    
    const normalizedName = itemName.toLowerCase().trim();
    let match = savedBasePrices.find(bp => bp.location.toLowerCase().trim() === normalizedName);
    
    if (!match) {
      match = savedBasePrices.find(bp => 
        normalizedName.includes(bp.location.toLowerCase().trim()) ||
        bp.location.toLowerCase().trim().includes(normalizedName)
      );
    }
    
    if (!match) {
      const firstWord = normalizedName.split(' ')[0];
      match = savedBasePrices.find(bp => 
        bp.location.toLowerCase().trim().startsWith(firstWord)
      );
    }
    
    if (match) {
      return {
        price: match.price || 0,
        currency: match.currency || 'CAD'
      };
    }
    return null;
  }, [savedBasePrices]);

  // ===== CLICK OUTSIDE HANDLER FOR TEMPLATE DROPDOWN =====
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handleClickOutside = (event) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplateDropdown]);

  // ===== TOOL FUNCTIONS =====
  const addLeg = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    const newLeg = {
      ...createDefaultLeg(),
      id: Date.now() + Math.random(),
      legDate: today
    };
    setFormData(prev => ({
      ...prev,
      legs: [...(prev.legs || []), newLeg]
    }));
  }, []);
 
  const removeLeg = useCallback((legId) => {
    setFormData(prev => ({ 
      ...prev, 
      legs: (prev.legs || []).filter(l => l.id !== legId) 
    }));
  }, []);

    const moveLegUp = useCallback((index) => {
    if (index === 0) return;
    setFormData(prev => {
      const newLegs = [...(prev.legs || [])];
      [newLegs[index - 1], newLegs[index]] = [newLegs[index], newLegs[index - 1]];
      return { ...prev, legs: newLegs };
    });
  }, []);

  const moveLegDown = useCallback((index) => {
    setFormData(prev => {
      const newLegs = [...(prev.legs || [])];
      if (index === newLegs.length - 1) return prev;
      [newLegs[index], newLegs[index + 1]] = [newLegs[index + 1], newLegs[index]];
      return { ...prev, legs: newLegs };
    });
  }, []);
 
  const addRevenueItem = useCallback(() => {
    setFormData(prev => ({ ...prev, revenueItems: [...(prev.revenueItems || []), { id: Date.now().toString(), item: '', qty: 1, rate: '', amount: '' }] }));
  }, []);
 
  const addExpenseItem = useCallback(() => {
    setFormData(prev => ({ ...prev, expenseItems: [...(prev.expenseItems || []), { id: Date.now().toString(), item: '', qty: 1, rate: '', amount: '' }] }));
  }, []);
 
  const removeRevenueItem = useCallback((id) => {
    setFormData(prev => ({ ...prev, revenueItems: (prev.revenueItems || []).filter(i => i.id !== id) }));
  }, []);
 
  const removeExpenseItem = useCallback((id) => {
    setFormData(prev => ({ ...prev, expenseItems: (prev.expenseItems || []).filter(i => i.id !== id) }));
  }, []);

  // ===== EFFECTS =====
  useEffect(() => {
    if (!isOpen) {
      initializedLoadRef.current = null;
      return;
    }
    if (initialData?.id) {
      if (initializedLoadRef.current === initialData.id) return;
      initializedLoadRef.current = initialData.id;
      const migratedData = migrateToLineItems(initialData);
      const revItems = buildLegacyRevenueItems(migratedData);
      const expItems = buildLegacyExpenseItems(migratedData);
      setFormData({
        ...createEmptyLoadForm(),
        ...migratedData,
        weightUnit: migratedData.weightUnit || 'lbs',
        appointmentAmPm: migratedData.appointmentAmPm || 'AM',
        legs: getSafeLegs(migratedData).length > 0 ? getSafeLegs(migratedData) : [createDefaultLeg()],
        revenueItems: revItems,
        expenseItems: expItems,
        driverCost: "",
        fuelCost: "",
        brokerRate: "",
        basePrice: "",
        waitingTime: "",
        fuelSurcharge: "",
        delivery: migratedData.delivery || "",
        terminal: migratedData.terminal || "",
        loadType: migratedData.loadType || "",
      });
      return;
    }
    if (initializedLoadRef.current !== "new") {
      initializedLoadRef.current = "new";
      const newForm = createEmptyLoadForm();
      if (dataSharingMode === 'separate' && currentLocation) {
        newForm.locationId = currentLocation;
      }
      setFormData(newForm);
    }
  }, [isOpen, initialData, dataSharingMode, currentLocation]);

  useEffect(() => {
    return () => clearTimeout(noteTimerRef.current);
  }, []);

  // ===== RECURRING TEMPLATE DETECTION =====
  useEffect(() => {
    const findRecurring = async () => {
      if (!formData.customerName || !companyId) return;
      try {
        const q = query(
          collection(db, 'companies', companyId, 'loads'),
          where('customerName', '==', formData.customerName),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const lastLoad = snap.docs[0].data();
          const currentDest = formData.legs?.[0]?.to;
          const lastDest = lastLoad.legs?.[0]?.to;
          if (currentDest && lastDest && currentDest === lastDest) {
            setRecurringTemplate(lastLoad);
          } else {
            setRecurringTemplate(null);
          }
        }
      } catch (err) {
        console.error("Recurring template lookup failed:", err);
      }
    };
    findRecurring();
  }, [formData.customerName, companyId]);

  // ===== HANDLERS =====
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: sanitizeInput(value) }));
  };
 
  const handleLineItemChange = (type, id, field, value) => {
    if (field === 'qty' || field === 'rate' || field === 'amount') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue < 0) {
        setFeedback?.("Negative values are not allowed");
        return;
      }
    }
    
    if (field === 'item' && type === 'revenue') {
      const autoFill = autoFillPriceFromLocation(value);
      if (autoFill && autoFill.price > 0) {
        setFormData(prev => {
          const listName = type === 'revenue' ? 'revenueItems' : 'expenseItems';
          const newItems = (prev[listName] || []).map(item => {
            if (item.id !== id) return item;
            const qty = safeFloat(item.qty || 1);
            return {
              ...item,
              [field]: value,
              rate: autoFill.price,
              amount: (qty * autoFill.price).toFixed(2)
            };
          });
          return { ...prev, [listName]: newItems };
        });
        const currencySymbol = autoFill.currency === 'USD' ? 'US$' : 'C$';
        setFeedback?.(`💰 Auto-filled rate: ${currencySymbol}${autoFill.price.toFixed(2)}`);
        return;
      }
    }
    
    setFormData(prev => {
      const listName = type === 'revenue' ? 'revenueItems' : 'expenseItems';
      const newItems = (prev[listName] || []).map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'qty' || field === 'rate') {
          const q = safeFloat(updated.qty);
          const r = safeFloat(updated.rate);
          if (q < 0 || r < 0) return updated;
          if (updated.qty !== '' && updated.rate !== '') {
            updated.amount = (q * r).toFixed(2);
          }
        }
        return updated;
      });
      return { ...prev, [listName]: newItems };
    });
  };

  const updateLeg = (id, field, value) => {
    if (field === 'driverName') {
      const selectedDriver = savedDrivers.find(d => d.name === value);
      setFormData(prev => ({
        ...prev,
        legs: (prev.legs || []).map(leg => {
          if (leg.id === id) {
            const updatedLeg = { ...leg, driverName: sanitizeInput(value) };
            if (selectedDriver) {
              updatedLeg.truckNo = selectedDriver.truckNo || '';
              updatedLeg.payRate = selectedDriver.payRate || 0;
              updatedLeg.payType = selectedDriver.payType || 'flat';
              updatedLeg.driverType = selectedDriver.type || 'Company Driver';
              updatedLeg.fuelEfficiency = selectedDriver.fuelEfficiency || null;
              const calculated = calculateLegCost(
                updatedLeg,
                leg.totalDistance || 0,
                leg.totalHours || 0
              );
              if (calculated) {
                updatedLeg.driverPay = calculated.driverWage;
                updatedLeg.fuelCost = calculated.fuelCost;
                updatedLeg.calculatedCost = calculated.total;
                updatedLeg.costBreakdown = calculated.breakdown;
              }
            }
            return updatedLeg;
          }
          return leg;
        })
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        legs: (prev.legs || []).map(leg => {
          if (leg.id === id) {
            const updatedLeg = { ...leg, [field]: sanitizeInput(value) };
            if (['totalDistance', 'totalHours', 'fuelPrice', 'driverPay', 'fuelCost'].includes(field)) {
              const calculated = calculateLegCost(
                updatedLeg,
                updatedLeg.totalDistance || 0,
                updatedLeg.totalHours || 0
              );
              if (calculated && updatedLeg.driverType && updatedLeg.driverType !== 'Not Set') {
                updatedLeg.driverPay = calculated.driverWage;
                updatedLeg.fuelCost = calculated.fuelCost;
                updatedLeg.calculatedCost = calculated.total;
                updatedLeg.costBreakdown = calculated.breakdown;
              }
            }
            return updatedLeg;
          }
          return leg;
        })
      }));
    }
  };

  const updateMultipleLegFields = (legId, updates) => {
    setFormData(prev => ({
      ...prev,
      legs: prev.legs.map(leg =>
        leg.id === legId ? { ...leg, ...updates } : leg
      )
    }));
  };

  // ===== EXTRA CHARGES HELPER FUNCTIONS =====
  const getCustomerRate = (customerName, chargeType) => {
    const customer = savedCustomers.find(c => c.name === customerName);
    if (!customer) return null;
    const rateMap = {
      'yardStorage': customer.yardStorageRate,
      'chassis': customer.chassisRate,
      'prepull': customer.prepullRate,
      'stopOff': customer.stopOffRate
    };
    const rate = rateMap[chargeType] || null;
    return {
      rate: rate ? parseFloat(rate) : null,
      currency: customer.rateCurrency || 'CAD'
    };
  };

  const addExtraChargeItem = (itemName, amount) => {
    if (amount <= 0) return;
    setFormData(prev => ({
      ...prev,
      revenueItems: [
        ...prev.revenueItems,
        {
          id: Date.now().toString() + '_' + itemName.replace(/\s/g, '_'),
          item: itemName,
          qty: 1,
          rate: amount,
          amount: amount
        }
      ]
    }));
  };

  const removeExtraChargeItem = (itemName) => {
    setFormData(prev => ({
      ...prev,
      revenueItems: prev.revenueItems.filter(item => item.item !== itemName)
    }));
  };

  // ===== AUTO DAY CALCULATION FUNCTION =====
  const calculateExtraChargeDays = useCallback(() => {
    let updated = false;
    const today = new Date().toISOString().split('T')[0];
    if (formData.isYardStorage && formData.yardStorageStartDate) {
      const startDate = new Date(formData.yardStorageStartDate);
      const endDate = new Date(today);
      const diffTime = Math.abs(endDate - startDate);
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
      if (days !== formData.yardStorageDays) {
        const rate = formData.yardStorageDailyRate || formData.yardStorageRate || 0;
        const amount = days * rate;
        setFormData(prev => ({
          ...prev,
          yardStorageDays: days,
          yardStorageAmount: amount
        }));
        removeExtraChargeItem('Yard Storage');
        if (amount > 0) {
          addExtraChargeItem('Yard Storage', amount);
        }
        updated = true;
      }
    }
    if (formData.isChassis && formData.chassisStartDate) {
      const startDate = new Date(formData.chassisStartDate);
      const endDate = new Date(today);
      const diffTime = Math.abs(endDate - startDate);
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
      if (days !== formData.chassisDays) {
        const rate = formData.chassisDailyRate || formData.chassisRate || 0;
        const amount = days * rate;
        setFormData(prev => ({
          ...prev,
          chassisDays: days,
          chassisAmount: amount
        }));
        removeExtraChargeItem('Chassis Rental');
        if (amount > 0) {
          addExtraChargeItem('Chassis Rental', amount);
        }
        updated = true;
      }
    }
    return updated;
  }, [formData, addExtraChargeItem, removeExtraChargeItem]);

  useEffect(() => {
    if (!formData.isYardStorage && !formData.isChassis) return;
    calculateExtraChargeDays();
    const interval = setInterval(() => {
      calculateExtraChargeDays();
    }, 60000);
    return () => clearInterval(interval);
  }, [formData.isYardStorage, formData.isChassis, calculateExtraChargeDays]);

  // ===== DISTANCE CALCULATION =====
  const handleAddressChange = async (legId, field, value) => {
    updateLeg(legId, field, value);
    const leg = formData.legs.find(l => l.id === legId);
    const from = field === 'from' ? value : leg?.from;
    const to = field === 'to' ? value : leg?.to;
    if (from && to && from.trim() && to.trim()) {
      updateLeg(legId, 'distanceLoading', true);
      setFeedback?.('📍 Calculating truck route...');
      try {
        const routeData = await calculateTruckDistance(from, to);
        if (routeData) {
          updateMultipleLegFields(legId, {
            totalDistance: routeData.distanceKm,
            totalHours: parseFloat(routeData.timeHours),
            autoCalculated: true,
            calculationSource: routeData.source,
            distanceLoading: false,
            fuelEstimate: routeData.fuelEstimate?.liters || 0,
            roadBreakdown: routeData.roadBreakdown,
          });
          saveRouteToCache(from, to, routeData);
          const updatedLeg = { ...leg, ...routeData };
          const calculatedCost = calculateLegCost(
            updatedLeg,
            routeData.distanceKm,
            parseFloat(routeData.timeHours)
          );
          if (calculatedCost) {
            updateMultipleLegFields(legId, {
              driverPay: calculatedCost.driverWage,
              fuelCost: calculatedCost.fuelCost,
              calculatedCost: calculatedCost.total,
              costBreakdown: calculatedCost.breakdown,
            });
          }
          setFeedback?.(`✅ Route calculated: ${routeData.distanceKm} km (${routeData.source})`);
        } else {
          updateLeg(legId, 'distanceLoading', false);
          setFeedback?.('⚠️ Could not calculate. Please enter manually.');
        }
      } catch (error) {
        console.error('Distance calculation failed:', error);
        updateLeg(legId, 'distanceLoading', false);
        setFeedback?.('❌ Route calculation failed. Enter manually.');
      }
    }
  };

  const calculateAllLegs = async () => {
    const legsWithAddresses = formData.legs.filter(l => l.from && l.to && l.from.trim() && l.to.trim());
    if (legsWithAddresses.length === 0) {
      setFeedback?.('⚠️ Please enter From/To addresses first');
      return;
    }
    setFeedback?.('🔄 Calculating all routes...');
    let completed = 0;
    for (const leg of legsWithAddresses) {
      try {
        updateLeg(leg.id, 'distanceLoading', true);
        const routeData = await calculateTruckDistance(leg.from, leg.to);
        if (routeData) {
          updateMultipleLegFields(leg.id, {
            totalDistance: routeData.distanceKm,
            totalHours: parseFloat(routeData.timeHours),
            autoCalculated: true,
            calculationSource: routeData.source,
            distanceLoading: false,
          });
          completed++;
        } else {
          updateLeg(leg.id, 'distanceLoading', false);
        }
      } catch (error) {
        console.error(`Failed to calculate leg ${leg.id}:`, error);
        updateLeg(leg.id, 'distanceLoading', false);
      }
    }
    setFeedback?.(`✅ Calculated ${completed} of ${legsWithAddresses.length} routes`);
  };

  // ===== SMART NOTES =====
  const handleSmartNotes = () => {
    clearTimeout(noteTimerRef.current);
    setGeneratingNotes(true);
    noteTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      const origin = formData.legs?.[0]?.from || '[Origin Not Set]';
      const dest = formData.legs?.[(formData.legs?.length || 1) - 1]?.to || '[Destination Not Set]';
      const carrier = formData.shippingLine || '[Carrier Not Set]';
      const size = formData.size || 'Container';
      const weight = formData.weight ? ` at ${formData.weight}` : '';
      let autoNotes = `=== DISPATCH & HANDLING INSTRUCTIONS ===\n\nROUTE SUMMARY:\n- From: ${origin}\n- To: ${dest}\n- Carrier: ${carrier}\n\nEQUIPMENT DETAILS:\n- Size/Type: ${size}${weight}\n`;
      if (size.includes('Reefer')) {
        autoNotes += `- Handling: ACTIVE REEFER. Driver must verify temperature settings and fuel levels prior to departure.\n`;
      } else if (size.includes('HC') || size.includes('45ft')) {
        autoNotes += `- Handling: HIGH CUBE / OVERSIZED. Driver must verify bridge and route clearances.\n`;
      } else {
        autoNotes += `- Handling: Standard dry freight transport rules apply.\n`;
      }
      autoNotes += `\nSAFETY & COMPLIANCE:\n- Weather/Traffic: Please monitor conditions along the route.\n- Documentation: ALL stops require a signed POD with clear arrival/departure times.\n`;
      if (formData.loadType) {
        autoNotes += `\nLOAD TYPE: ${formData.loadType} LOAD\n`;
        if (formData.loadType === 'LIVE') {
          autoNotes += `- Driver must remain on-site during loading/unloading\n- Expect 1-3 hours for complete operation\n`;
        } else if (formData.loadType === 'DROP') {
          autoNotes += `- Drop & Go: No waiting required\n- Ensure container is positioned correctly before departure\n`;
        }
      }
      setFormData(prev => ({ ...prev, notes: autoNotes }));
      setGeneratingNotes(false);
    }, 600);
  };

    // ===== FILE UPLOAD (MULTIPLE SUPPORT) =====
  const handleFileUpload = async (e, field) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!userId || !companyId) {
      setFeedback?.("Authentication required");
      return;
    }
    const now = Date.now();
    if (now - lastUploadTimeRef.current < UPLOAD_COOLDOWN_MS) {
      setFeedback?.("❌ Please wait before uploading another file");
      return;
    }

    setUploadingFile(true);
    const newDocs = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!ALLOWED_UPLOAD_TYPES.has(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) {
          setFeedback?.(`❌ Skipped ${file.name}: Invalid type or too large`);
          continue;
        }

        const safeFileName = file.name.replace(/[^\w.-]/g, "_");
        const filePath = `uploads/${companyId}/${userId}/${Date.now()}_${safeFileName}`;
        const storageRef = ref(storage, filePath);
        
        await uploadBytes(storageRef, file, { contentType: file.type });
        const url = await getDownloadURL(storageRef);
        
        newDocs.push({
          name: file.name,
          type: file.type,
          url,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString()
        });
      }

            if (!isMountedRef.current) return;

      setFormData(prev => {
        // ✅ NEW: If we are uploading a POD, save it to signedPodDoc
        if (field === 'signedPodDoc') {
          return { ...prev, signedPodDoc: newDocs[0] };
        }

        const updatedDocs = [...(prev.documents || []), ...newDocs];
        // Backward compatibility: if loadConfirmation is empty, set the first doc as load confirmation
        let updatedLoadConf = prev.loadConfirmation;
        if (!updatedLoadConf && newDocs.length > 0) updatedLoadConf = newDocs[0];

        return {
          ...prev,
          documents: updatedDocs,
          loadConfirmation: updatedLoadConf
        };
      });

      lastUploadTimeRef.current = now;
      setFeedback?.(`✅ Uploaded ${newDocs.length} file(s) successfully`);
    } catch (err) {
      console.error("Upload failed:", err);
      setFeedback?.("❌ Some uploads failed");
    } finally {
      setUploadingFile(false);
      // Reset input so the same file can be selected again if needed
      e.target.value = null; 
    }
  };

  const removeDocument = (urlToRemove) => {
    setFormData(prev => {
      const updatedDocs = (prev.documents || []).filter(d => d.url !== urlToRemove);
      // If we are removing the load confirmation, try to set it to the next available doc
      let updatedLoadConf = prev.loadConfirmation;
      if (prev.loadConfirmation?.url === urlToRemove) {
        updatedLoadConf = updatedDocs.length > 0 ? updatedDocs[0] : null;
      }
      return {
        ...prev,
        documents: updatedDocs,
        loadConfirmation: updatedLoadConf
      };
    });
  };

  // ===== TEMPLATE APPLICATION =====
  const applyTemplate = (templateId) => {
    const template = PRE_PULL_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      setFeedback?.('❌ Template not found');
      return;
    }
    if (!formData.terminal || !formData.delivery) {
      setFeedback?.('⚠️ Please fill in Terminal and Delivery fields before applying a template');
      return;
    }
    setSelectedTemplate(templateId);
    let companyYard = 'Company Yard';
    let yardFound = false;
    if (savedDestinations && savedDestinations.length > 0) {
      const yardMatch = savedDestinations.find(d =>
        d.name?.toLowerCase().includes('yard') ||
        d.name?.toLowerCase().includes('ifs') ||
        d.name?.toLowerCase().includes('depot') ||
        d.address?.toLowerCase().includes('yard')
      );
      if (yardMatch) {
        companyYard = yardMatch.address || yardMatch.name || 'Company Yard';
        yardFound = true;
      }
    }
    if (!yardFound && template.legs.some(l => l.fromType === 'yard' || l.toType === 'yard')) {
      setFeedback?.('⚠️ No yard found in database. Using default "Company Yard".');
    }
    const terminal = formData.terminal;
    const delivery = formData.delivery;
    const today = new Date().toISOString().split('T')[0];
    const newLegs = template.legs.map((legTemplate, index) => {
      const leg = createDefaultLeg();
      const locationMap = {
        'terminal': terminal,
        'yard': companyYard,
        'customer': delivery
      };
      leg.from = locationMap[legTemplate.fromType] || '';
      leg.to = locationMap[legTemplate.toType] || '';
      leg.legType = legTemplate.type === 'return' ? 'termination' : 'delivery';
      leg.status = 'Planned';
      leg.legDate = today;
      const notesMap = {
        'prepull': 'Pre-Pull: Pick up container from terminal and drop at yard',
        'return': 'Return: Return empty container to terminal',
        'live': 'LIVE LOAD: Immediate loading/unloading required',
        'drop': 'DROP LOAD: Drop & go - no waiting required'
      };
      leg.notes = notesMap[legTemplate.type] || `${template.name} - Leg ${index + 1}`;
      return leg;
    });
    setFormData(prev => ({
      ...prev,
      legs: newLegs,
      notes: prev.notes
        ? `${prev.notes}\n\n📋 Applied Template: ${template.name}`
        : `📋 Template: ${template.name}`
    }));
    setShowTemplateDropdown(false);
    setFeedback?.(`✅ ${template.name} template applied - ${newLegs.length} leg(s) created`);
  };

  // ===== RETURN EARLY IF NOT OPEN =====
  if (!isOpen) return null;

  // ===== RENDER =====
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose}></div>
      <div className="bg-white w-full h-full rounded-none shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
       
                {/* HEADER */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <h2 className="text-2xl font-black text-slate-900 flex items-center">
            {initialData ? "Update Load Profile" : "Create New Load"}
            {formData.workOrderNo && (
              <span className="ml-4 text-xs font-bold tracking-widest bg-blue-100 text-blue-800 px-3 py-1 rounded-full uppercase border border-blue-200 shadow-sm inline-flex items-center">
                {formData.workOrderNo}
              </span>
            )}
            {isFinancialLocked && (
              <span className="ml-3 flex items-center gap-1 text-[10px] font-black tracking-widest bg-slate-200 text-slate-600 px-3 py-1 rounded-full uppercase">
                <ShieldCheck className="w-3 h-3" /> Financials Locked
              </span>
            )}
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest" htmlFor="statusSelect">
                Load Status
              </label>
              <select
                id="statusSelect"
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-black text-xs uppercase text-blue-600 outline-none focus:ring-2 focus:ring-blue-100"
              >
                {(isAdmin || isDispatcher || isCustomerService) && <option value="Open">Open (Operations)</option>}
                <option value="Ready for Billing">Ready for Billing</option>
                {(isAdmin || isAccounting) && (
                  <>
                    <option value="Invoiced">Invoiced</option>
                    <option value="Paid">Paid</option>
                  </>
                )}
                {isAdmin && <option value="Completed">Completed</option>}
              </select>
            </div>
            <button onClick={onClose} className="p-3 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-2xl transition-all">
              <X />
            </button>
          </div>
        </div>

                                {/* TAB SWITCHER / WIZARD NAVIGATION */}
        <div className="flex gap-2 bg-slate-100 p-2 mx-8 mt-4 rounded-xl overflow-x-auto shrink-0">
          <button type="button" onClick={() => setActiveStep('step1')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'step1' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>1. Shipment</button>
          <button type="button" onClick={() => setActiveStep('step2')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'step2' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>2. Customer</button>
          <button type="button" onClick={() => setActiveStep('step3')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'step3' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>3. Dispatch</button>
          <button type="button" onClick={() => setActiveStep('step4')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'step4' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>4. Billing</button>
          <button type="button" onClick={() => setActiveStep('step5')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'step5' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>5. Docs</button>
          <button type="button" onClick={() => setActiveStep('lifecycle')} className={`flex-1 h-12 flex items-center justify-center px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeStep === 'lifecycle' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>🔄 Lifecycle</button>
        </div>

        <form
  onSubmit={async (e) => {
    e.preventDefault();
    if (isSaving) return; // ✅ Prevents double clicks
    
    // ===== EXISTING VALIDATIONS =====
    if (!formData.shipmentType) {
              setFeedback?.("❌ Please select Import or Export before saving");
              return;
            }
            if (!formData.loadType) {
              setFeedback?.("❌ Please select LIVE or DROP before saving this load");
              return;
            }
            if (!formData.terminal) {
              setFeedback?.("❌ Please enter a Terminal location");
              return;
            }
            if (!formData.delivery) {
              setFeedback?.("❌ Please enter a Delivery location");
              return;
            }
            if (formData.legs && formData.legs.length > 0) {
              for (let i = 0; i < formData.legs.length; i++) {
                const leg = formData.legs[i];
                if (!leg.from && !leg.to && !leg.driverName && !leg.truckNo) {
                  continue;
                }
                if (!leg.from || !leg.from.trim()) {
                  setFeedback?.(`❌ Please fill in Pickup location for leg ${i + 1}`);
                  return;
                }
                if (!leg.to || !leg.to.trim()) {
                  setFeedback?.(`❌ Please fill in Destination location for leg ${i + 1}`);
                  return;
                }
              }
            }

                        // ===== ✅ NEW: DATA INTEGRITY GUARD (Lifecycle vs Trip Legs) =====
            const legs = formData.legs || [];
            
            // 1. Verify "Dropped at Customer"
            if (formData.isDroppedAtCustomer) {
              const hasCompletedLeg = legs.some(l => 
                (l.status === 'Completed' || l.status === 'Delivered')
              );
              if (!hasCompletedLeg) {
                setFeedback?.("❌ Mismatch: You marked 'Dropped at Customer', but there is no completed Trip Leg. Please mark a leg as Completed first.");
                return;
              }
            }

            // 2. Verify "Ready for Pickup"
            if (formData.isReadyForPickup) {
              const hasCompletedLeg = legs.some(l => 
                (l.status === 'Completed' || l.status === 'Delivered')
              );
              if (!hasCompletedLeg) {
                setFeedback?.("❌ Mismatch: You marked 'Ready for Pickup', but there is no completed Trip Leg. Please mark a leg as Completed first.");
                return;
              }
            }

            // 3. Verify "Container Terminated"
            if (formData.isTerminated || formData.isBillingComplete) {
              const hasCompletedTermination = legs.some(l => 
                l.legType === 'termination' && 
                (l.status === 'Completed' || l.status === 'Delivered')
              );
              // Fallback: Allow saving if at least one leg is completed, even if type is missing
              const hasAnyCompletedLeg = legs.some(l => l.status === 'Completed' || l.status === 'Delivered');
              
              if (!hasCompletedTermination && !hasAnyCompletedLeg) {
                setFeedback?.("❌ Mismatch: You marked 'Container Terminated', but there is no completed Trip Leg. Please update the Trip Legs first.");
                return;
              }
            }

            // 4. Verify "In Yard" (If no legs, it shouldn't be marked In Yard unless it's a prepull)
            if (formData.isInYard && legs.length === 0) {
                setFeedback?.("❌ Mismatch: You marked 'In Yard', but there are no Trip Legs. Please add a leg first.");
                return;
            }

                        // If all checks pass, submit the form
            setIsSaving(true); // ✅ Disables button
            try {
              await onSubmit(formData);
            } finally {
              setIsSaving(false); // ✅ Re-enables if it fails
            }
          }}
                    className="p-8 pb-32 overflow-y-auto space-y-12"
        >
                    {/* ===== PAGE 1: SHIPMENT ===== */}
          {activeStep === 'step1' && (
            <>
              {/* Currency Settings */}
              <div className="space-y-4 bg-blue-50/30 p-6 rounded-[32px] border border-blue-100">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-blue-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-blue-900">Currency & Terminal</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-blue-700/70 uppercase" htmlFor="currencySelect">Billing Currency</label>
                    <select id="currencySelect" name="currency" value={formData.currency || 'CAD'} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-blue-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-200 transition-all">
                      <option value="CAD">🇨🇦 CAD - Canadian Dollar (C$)</option>
                      <option value="USD">🇺🇸 USD - US Dollar (US$)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-blue-700/70 uppercase" htmlFor="terminal">Terminal *</label>
                    <input id="terminal" name="terminal" value={formData.terminal || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-blue-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-200 transition-all" list="terminalLocations" placeholder="Search saved terminals..." required autoComplete="off" />
                    <datalist id="terminalLocations">
                      {companyTerminals && companyTerminals.length > 0 ? (
                        companyTerminals.map((t, i) => (<option key={t.id || i} value={t.name + (t.code ? ` (${t.code})` : '') + ' - ' + t.address}></option>))
                      ) : (<option value="">No terminals saved yet</option>)}
                    </datalist>
                  </div>
                </div>
              </div>

              {/* Location Assignment */}
              {dataSharingMode === 'separate' && userAccessibleLocations?.length > 0 && (
                <div className="space-y-4 bg-indigo-50/30 p-6 rounded-[32px] border border-indigo-100">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-black text-xs uppercase tracking-widest text-indigo-900">Location Assignment</h3>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-indigo-700/70 uppercase">Assigned Location</label>
                    <select name="locationId" value={formData.locationId || currentLocation || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-indigo-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-indigo-200 transition-all">
                      {userAccessibleLocations.map(locId => {
                        const loc = companyLocations?.find(l => l.id === locId);
                        return loc ? (<option key={loc.id} value={loc.id}>{loc.name} - {[loc.address, loc.city, loc.province].filter(Boolean).join(', ')}</option>) : null;
                      }).filter(Boolean)}
                    </select>
                  </div>
                </div>
              )}

              {/* Shipment Identity */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest">Shipment Identity</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="containerNo">Container No.*</label>
                    <input id="containerNo" required name="containerNo" value={formData.containerNo} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-black focus:ring-4 focus:ring-blue-100 outline-none transition-all" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="shippingLine">Shipping Line</label>
                    <input id="shippingLine" required name="shippingLine" value={formData.shippingLine} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" list="lines" placeholder="e.g. CMA, COSCO, MAERSK" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="sizeSelect">Size</label>
                    <select id="sizeSelect" name="size" value={formData.size} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold transition-all">
                      <option>20GE (General)</option><option>40GE (General)</option><option>40HC (High Cube)</option>
                      <option>45EQ (High Cube)</option><option>53GE (General)</option><option>53RE (Reefer)</option>
                      <option>20FL (Flat Rack)</option><option>20OT (Open Top)</option><option>20RE (Reefer)</option><option>40RE (Reefer)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="weight">Weight</label>
                    <input id="weight" name="weight" value={formData.weight || ''} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" placeholder="Enter weight..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="sealNumber">Seal Number</label>
                    <input id="sealNumber" name="sealNumber" value={formData.sealNumber || ''} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" placeholder="Enter seal number..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="workOrderNo">WO #</label>
                    <input id="workOrderNo" name="workOrderNo" value={formData.workOrderNo || ''} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" placeholder="Auto-generated if blank" />
                  </div>
                </div>
              </div>

                            {/* Chassis Number */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-slate-200">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="chassisNumber">Chassis Number</label>
                  <input id="chassisNumber" name="chassisNumber" value={formData.chassisNumber || ''} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" placeholder="Enter chassis number..." />
                </div>
              </div>

              {/* Load Type */}
              <div className="space-y-4 bg-amber-50/30 p-6 rounded-[32px] border-2 border-amber-200">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-amber-900">Load Type *</h3>
                  <span className="text-[10px] font-bold text-red-500 ml-2">(Required)</span>
                </div>
                <div className="flex gap-6">
                  <label className={`flex items-center gap-3 cursor-pointer px-6 py-4 rounded-2xl border-2 transition-all flex-1 justify-center ${formData.loadType === 'LIVE' ? 'border-blue-600 bg-blue-50 shadow-md' : 'border-slate-200 hover:border-blue-200 hover:bg-slate-50'}`}>
                    <input type="radio" name="loadType" value="LIVE" checked={formData.loadType === 'LIVE'} onChange={(e) => setFormData(prev => ({ ...prev, loadType: e.target.value }))} className="w-4 h-4 text-blue-600" />
                    <div className="flex items-center gap-2"><Clock className="w-5 h-5 text-blue-600" /><div><div className="font-black text-sm text-slate-800">LIVE LOAD</div><div className="text-[10px] text-slate-400">Immediate loading</div></div></div>
                  </label>
                  <label className={`flex items-center gap-3 cursor-pointer px-6 py-4 rounded-2xl border-2 transition-all flex-1 justify-center ${formData.loadType === 'DROP' ? 'border-green-600 bg-green-50 shadow-md' : 'border-slate-200 hover:border-green-200 hover:bg-slate-50'}`}>
                    <input type="radio" name="loadType" value="DROP" checked={formData.loadType === 'DROP'} onChange={(e) => setFormData(prev => ({ ...prev, loadType: e.target.value }))} className="w-4 h-4 text-green-600" />
                    <div className="flex items-center gap-2"><Package className="w-5 h-5 text-green-600" /><div><div className="font-black text-sm text-slate-800">DROP LOAD</div><div className="text-[10px] text-slate-400">Drop & go</div></div></div>
                  </label>
                </div>
              </div>

              {/* Import/Export */}
              <div className="space-y-4 bg-blue-50/30 p-6 rounded-[32px] border-2 border-blue-200">
                <div className="flex items-center gap-2">
                  <Ship className="w-4 h-4 text-blue-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-blue-900">Shipment Type *</h3>
                </div>
                <div className="flex gap-6">
                  <label className={`flex items-center gap-3 cursor-pointer px-6 py-4 rounded-2xl border-2 transition-all flex-1 justify-center ${formData.shipmentType === 'import' ? 'border-blue-600 bg-blue-50 shadow-md' : 'border-slate-200'}`}>
                    <input type="radio" name="shipmentType" value="import" checked={formData.shipmentType === 'import'} onChange={(e) => setFormData(prev => ({ ...prev, shipmentType: e.target.value }))} className="w-4 h-4 text-blue-600" />
                    <div className="font-black text-sm text-slate-800">IMPORT</div>
                  </label>
                  <label className={`flex items-center gap-3 cursor-pointer px-6 py-4 rounded-2xl border-2 transition-all flex-1 justify-center ${formData.shipmentType === 'export' ? 'border-green-600 bg-green-50 shadow-md' : 'border-slate-200'}`}>
                    <input type="radio" name="shipmentType" value="export" checked={formData.shipmentType === 'export'} onChange={(e) => setFormData(prev => ({ ...prev, shipmentType: e.target.value }))} className="w-4 h-4 text-green-600" />
                    <div className="font-black text-sm text-slate-800">EXPORT</div>
                  </label>
                </div>
              </div>

              {/* Export Specific Fields */}
              {formData.shipmentType === 'export' && (
                <div className="space-y-4 bg-teal-50/30 p-6 rounded-[32px] border-2 border-teal-200">
                  <div className="flex items-center gap-2"><Ship className="w-4 h-4 text-teal-600" /><h3 className="font-black text-xs uppercase tracking-widest text-teal-900">Export Details</h3></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">Booking No.*</label><input name="bookingNo" value={formData.bookingNo || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" required={formData.shipmentType === 'export'} /></div>
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">Vessel Name*</label><input name="vesselName" value={formData.vesselName || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" required={formData.shipmentType === 'export'} /></div>
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">Port Name*</label><input name="portName" value={formData.portName || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" required={formData.shipmentType === 'export'} /></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">ERD Date*</label><input type="date" name="erdDate" value={formData.erdDate || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" required={formData.shipmentType === 'export'} /></div>
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">Cut‑Off Date*</label><input type="date" name="cutoffDate" value={formData.cutoffDate || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" required={formData.shipmentType === 'export'} /></div>
                    <div className="space-y-1"><label className="text-[10px] font-black text-teal-700/70 uppercase">Loading Date</label><input type="date" name="loadingDate" value={formData.loadingDate || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-teal-200/50 rounded-2xl font-bold outline-none" /></div>
                  </div>
                </div>
              )}

              {/* Tracking & Reference Numbers */}
              <div className="space-y-4 bg-slate-50/50 p-6 rounded-[32px] border border-slate-100">
                <div className="flex items-center gap-2"><Hash className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Tracking & Reference Numbers</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="poNumber">PO Number</label><input id="poNumber" name="poNumber" value={formData.poNumber} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="pickupNo">Pick up Number</label><input id="pickupNo" name="pickupNo" value={formData.pickupNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerRefNo">Customer Ref No.</label><input id="customerRefNo" name="customerRefNo" value={formData.customerRefNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
                </div>
              </div>
            </>
          )}

          {/* ===== PAGE 2: CUSTOMER & SCHEDULE ===== */}
          {activeStep === 'step2' && (
            <>
              {/* Delivery Location */}
              <div className="space-y-4 bg-emerald-50/30 p-6 rounded-[32px] border border-emerald-100">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-emerald-900">Delivery Location</h3>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-emerald-700/70 uppercase" htmlFor="delivery">Delivery Location *</label>
                  <input id="delivery" name="delivery" value={formData.delivery || ''} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-emerald-200/50 rounded-2xl font-bold outline-none" placeholder="Customer delivery location" list="deliveryLocations" required autoComplete="off" />
                  <datalist id="deliveryLocations">
                    {savedDestinations && savedDestinations.map((d, i) => (<option key={d.id || i} value={d.name + ' - ' + d.address}></option>))}
                    {savedBasePrices && savedBasePrices.map((bp, i) => (<option key={bp.id || 'bp-' + i} value={bp.location}></option>))}
                  </datalist>
                </div>
              </div>

              {/* Customer Profile */}
              <div className="space-y-4 bg-slate-50/50 p-6 rounded-[32px] border border-slate-100 relative">
                <div className="flex items-center gap-2">
                  <Building className="text-blue-600 w-4 h-4" />
                  <h3 className="font-black text-xs uppercase tracking-widest">Customer Profile</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerName">Customer Name *</label>
                    <select name="customerName" value={formData.customerName} onChange={(e) => {
                      const selectedName = e.target.value;
                      const cust = savedCustomers.find(c => c.name === selectedName);
                      setFormData(prev => {
                        if (cust) return { ...prev, customerName: cust.name, customerEmail: cust.email || '', customerPhone: cust.phone || '', customerAddress: cust.address || '' };
                        return { ...prev, customerName: selectedName };
                      });
                    }} className="w-full px-4 py-3 bg-white border rounded-2xl font-bold outline-none appearance-none">
                      <option value="" disabled>Select saved customer...</option>
                      {savedCustomers.map((c, i) => (<option key={c.id || i} value={c.name}>{c.name}</option>))}
                    </select>
                    <ChevronDown className="absolute right-4 bottom-4 w-5 h-5 text-slate-400 pointer-events-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerEmail">Billing Email</label><input id="customerEmail" name="customerEmail" value={formData.customerEmail} onChange={handleChange} className="w-full px-4 py-3 bg-white border rounded-xl font-bold text-sm outline-none" /></div>
                    <div><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerPhone">Phone</label><input id="customerPhone" name="customerPhone" value={formData.customerPhone} onChange={handleChange} className="w-full px-4 py-3 bg-white border rounded-xl font-bold text-sm outline-none" /></div>
                  </div>
                </div>
              </div>

              {/* Appointment Schedule */}
              <div className="space-y-4 bg-orange-50/30 p-6 rounded-[32px] border border-orange-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-600" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-orange-900">Appointment Schedule</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <input type="date" name="appointmentDate" value={formData.appointmentDate && formData.appointmentDate.length === 10 ? formData.appointmentDate : ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" />
                    <input type="time" name="appointmentTime" value={formData.appointmentTime || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00'].map((time) => (
                      <button key={time} type="button" onClick={() => handleChange({ target: { name: 'appointmentTime', value: time } })} className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all ${formData.appointmentTime === time ? 'bg-orange-600 text-white border-orange-600 shadow-lg' : 'bg-white border-slate-200 text-slate-600'}`}>{time}</button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

                    {/* ===== PAGE 3: DISPATCH & LEGS ===== */}
          {activeStep === 'step3' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Trip Legs & Dispatching</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={calculateAllLegs} className="text-xs font-black text-green-600 hover:underline transition-all flex items-center gap-1 px-2 py-1 bg-green-50 rounded-lg border border-green-200">
                    <RefreshCw className="w-3 h-3" /> Calculate All
                  </button>
                  <button type="button" onClick={addLeg} className="text-xs font-black text-blue-600 hover:underline transition-all">+ Add Trip Leg</button>
                </div>
              </div>

              {(!formData.legs || formData.legs.length === 0) && (
                <div className="bg-amber-50 border-2 border-dashed border-amber-300 rounded-2xl p-8 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Truck className="w-12 h-12 text-amber-400" />
                    <div className="font-black text-amber-800">No Trip Legs Added</div>
                    <button type="button" onClick={addLeg} className="mt-2 px-6 py-2 bg-amber-600 text-white rounded-xl font-bold text-sm hover:bg-amber-700 transition-all shadow-lg shadow-amber-200">+ Add Your First Leg</button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {(formData.legs || []).map((leg, index) => (
                  <div key={leg.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between group hover:border-blue-300 transition-colors">
                    
                    {/* Left: Arrows & Actions */}
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => moveLegUp(index)} disabled={index === 0} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => moveLegDown(index)} disabled={index === formData.legs.length - 1} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                      </div>
                      
                      <button type="button" onClick={() => setEditingLegId(leg.id)} className="p-2 bg-emerald-100 text-emerald-700 rounded-full hover:bg-emerald-200 transition-colors shadow-sm" title="Edit Leg">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); copyDispatch(formData, leg, setFeedback); }} className="p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Middle: Date, Time, Driver */}
                    <div className="flex flex-col min-w-[150px]">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        {leg.legDate ? new Date(leg.legDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No Date'}
                        <span className="text-xs font-medium text-slate-500">({leg.arrivalTime || '00:00'} - {leg.departureTime || '00:00'})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                         <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full ${
                            leg.status === 'Dispatched' ? 'bg-blue-100 text-blue-700' :
                            leg.status === 'Completed' ? 'bg-green-100 text-green-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {leg.status || 'Planned'}
                          </span>
                          <div className="flex items-center gap-1 text-xs font-bold text-slate-600">
                            <User className="w-3.5 h-3.5 text-slate-400" /> {leg.driverName || 'Unassigned'}
                          </div>
                      </div>
                    </div>

                    {/* Right: Pick and Drop summary */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full md:w-auto border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4">
                      <div>
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1"><MapPin className="w-3 h-3"/> Pick</span>
                        <div className="text-sm font-bold text-slate-800 mt-1 truncate max-w-[250px]">{leg.from || 'Not set'}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest flex items-center gap-1"><MapPin className="w-3 h-3"/> Drop</span>
                        <div className="text-sm font-bold text-slate-800 mt-1 truncate max-w-[250px]">{leg.to || 'Not set'}</div>
                      </div>
                    </div>

                    {/* Far Right: Delete */}
                    <button type="button" onClick={() => { if(window.confirm('Remove this leg?')) removeLeg(leg.id); }} className="p-2 bg-red-50 text-red-500 rounded-full hover:bg-red-100 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

                    {/* ===== PAGE 4: BILLING & CHARGES ===== */}
          {activeStep === 'step4' && (
            <div className="animate-in fade-in space-y-8">
              
              {/* Pre-Pull Option */}
              <div className="space-y-4 bg-purple-50/30 p-6 rounded-[32px] border border-purple-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-600" />
                    <h3 className="font-black text-xs uppercase tracking-widest text-purple-900">Pre-Pull Option</h3>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-white px-4 py-2 rounded-xl border border-purple-200">
                    <input type="checkbox" name="isPrePull" checked={formData.isPrePull || false} onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({ ...prev, isPrePull: checked }));
                        if (checked) {
                          const rateData = getCustomerRate(formData.customerName, 'prepull');
                          if (rateData && rateData.rate > 0) {
                            setFormData(prev => ({ ...prev, prePullRate: rateData.rate, prePullAmount: rateData.rate, prePullChargeAdded: true }));
                            addExtraChargeItem('Pre-Pull Fee', rateData.rate);
                          } else {
                            const manualRate = prompt(`No pre-pull rate set for ${formData.customerName || 'this customer'}. Enter rate manually:`, '0');
                            if (manualRate && parseFloat(manualRate) > 0) {
                              setFormData(prev => ({
                                ...prev,
                                prePullRate: parseFloat(manualRate),
                                prePullAmount: parseFloat(manualRate),
                                prePullChargeAdded: true
                              }));
                              addExtraChargeItem('Pre-Pull Fee', parseFloat(manualRate));
                            } else {
                              setFormData(prev => ({ ...prev, isPrePull: false }));
                              setFeedback('⚠️ Pre-Pull rate required. Please set it in the customer profile.');
                            }
                          }
                        } else {
                          removeExtraChargeItem('Pre-Pull Fee');
                          setFormData(prev => ({ ...prev, prePullRate: 0, prePullAmount: 0, prePullChargeAdded: false }));
                        }
                      }} className="w-4 h-4 text-purple-600 rounded cursor-pointer" />
                    <span className="text-[10px] font-black text-purple-700 uppercase">{formData.isPrePull ? '✅ Required' : 'Mark for Pre-Pull'}</span>
                  </label>
                </div>
                {formData.isPrePull && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-purple-700/70 uppercase">Pre-Pull Date</label>
                      <input type="date" name="prePullDate" value={formData.prePullDate || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-purple-200/50 rounded-2xl font-bold outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-purple-700/70 uppercase">Pre-Pull Fee</label>
                      <div className="bg-white p-3 rounded-2xl border border-purple-200/50 flex items-center justify-between">
                        <span className="text-sm font-black text-purple-900">{currencySymbol}{formData.prePullAmount || formData.prePullRate || 0}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newRate = prompt(`Enter new pre-pull rate (current: ${formData.prePullRate || 0}):`, formData.prePullRate || 0);
                            if (newRate && parseFloat(newRate) > 0) {
                              const rate = parseFloat(newRate);
                              setFormData(prev => ({ ...prev, prePullRate: rate, prePullAmount: rate }));
                              removeExtraChargeItem('Pre-Pull Fee');
                              addExtraChargeItem('Pre-Pull Fee', rate);
                              setFeedback(`✅ Pre-Pull rate updated to ${rate}`);
                            }
                          }}
                          className="text-[10px] font-bold text-blue-600 hover:underline"
                        >
                          Edit Rate
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              
              {/* Extra Charges */}
              <div className="space-y-4 bg-teal-50/30 p-6 rounded-[32px] border border-teal-100">
                <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-teal-600" /><h3 className="font-black text-xs uppercase tracking-widest text-teal-900">Extra Charges</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer bg-white px-4 py-3 rounded-xl border border-teal-200">
                    <input type="checkbox" checked={formData.isStopOff || false} onChange={(e) => {
                        setFormData(prev => ({ ...prev, isStopOff: e.target.checked }));
                        if (e.target.checked) {
                          const rateData = getCustomerRate(formData.customerName, 'stopOff');
                          if (rateData && rateData.rate > 0) { addExtraChargeItem('Stop Off Fee', rateData.rate); }
                        } else { removeExtraChargeItem('Stop Off Fee'); }
                      }} className="w-4 h-4 text-teal-600 rounded cursor-pointer" />
                    <span className="text-[10px] font-black text-teal-700 uppercase">Stop Off</span>
                  </label>
                  <div className="bg-white p-4 rounded-xl border border-teal-200">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={formData.isYardStorage || false} onChange={(e) => {
                          const checked = e.target.checked;
                          setFormData(prev => ({ ...prev, isYardStorage: checked }));
                          if (checked) {
                            const rateData = getCustomerRate(formData.customerName, 'yardStorage');
                            if (rateData && rateData.rate > 0) {
                              setFormData(prev => ({ ...prev, yardStorageStartDate: new Date().toISOString().split('T')[0], yardStorageDailyRate: rateData.rate, yardStorageRate: rateData.rate, yardStorageDays: 1 }));
                              addExtraChargeItem('Yard Storage', rateData.rate);
                            }
                          } else {
                            removeExtraChargeItem('Yard Storage');
                            setFormData(prev => ({ ...prev, yardStorageDays: 0, yardStorageRate: 0, yardStorageAmount: 0, yardStorageStartDate: '' }));
                          }
                        }} className="w-4 h-4 text-teal-600 rounded cursor-pointer" />
                      <span className="text-[10px] font-black text-teal-700 uppercase">Yard Storage</span>
                    </div>
                    {formData.isYardStorage && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-50 p-2 rounded"><span className="text-slate-400">Days: </span><input type="number" min="1" value={formData.yardStorageDays || 1} onChange={(e) => { const days = parseInt(e.target.value) || 1; const amount = days * (formData.yardStorageDailyRate || 0); setFormData(prev => ({ ...prev, yardStorageDays: days, yardStorageAmount: amount })); removeExtraChargeItem('Yard Storage'); if (amount > 0) addExtraChargeItem('Yard Storage', amount); }} className="w-12 px-1 py-0.5 border rounded text-center font-bold" /></div>
                        <div className="bg-slate-50 p-2 rounded"><span className="text-slate-400">Total: </span><span className="font-bold">{currencySymbol}{formData.yardStorageAmount || 0}</span></div>
                      </div>
                    )}
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-teal-200 md:col-span-2">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={formData.isChassis || false} onChange={(e) => {
                          const checked = e.target.checked;
                          setFormData(prev => ({ ...prev, isChassis: checked }));
                          if (checked) {
                            const rateData = getCustomerRate(formData.customerName, 'chassis');
                            if (rateData && rateData.rate > 0) {
                              setFormData(prev => ({ ...prev, chassisStartDate: new Date().toISOString().split('T')[0], chassisDailyRate: rateData.rate, chassisRate: rateData.rate, chassisDays: 1 }));
                              addExtraChargeItem('Chassis Rental', rateData.rate);
                            }
                          } else {
                            removeExtraChargeItem('Chassis Rental');
                            setFormData(prev => ({ ...prev, chassisDays: 0, chassisRate: 0, chassisAmount: 0, chassisStartDate: '' }));
                          }
                        }} className="w-4 h-4 text-teal-600 rounded cursor-pointer" />
                      <span className="text-[10px] font-black text-teal-700 uppercase">Chassis Rental</span>
                    </div>
                    {formData.isChassis && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-50 p-2 rounded"><span className="text-slate-400">Days: </span><input type="number" min="1" value={formData.chassisDays || 1} onChange={(e) => { const days = parseInt(e.target.value) || 1; const amount = days * (formData.chassisDailyRate || 0); setFormData(prev => ({ ...prev, chassisDays: days, chassisAmount: amount })); removeExtraChargeItem('Chassis Rental'); if (amount > 0) addExtraChargeItem('Chassis Rental', amount); }} className="w-12 px-1 py-0.5 border rounded text-center font-bold" /></div>
                        <div className="bg-slate-50 p-2 rounded"><span className="text-slate-400">Total: </span><span className="font-bold">{currencySymbol}{formData.chassisAmount || 0}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Financials */}
              <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 space-y-8">
                <div className="flex justify-between items-center border-b border-slate-200 pb-4">
                  <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-slate-800"><Wallet className="w-5 h-5 text-green-600"/> Financials (Rate & Cost)</h3>
                  <div className="text-right flex items-center gap-6">
                    <div><div className="text-[10px] font-bold text-slate-400 uppercase">Total Revenue</div><div className="text-sm font-black text-slate-800">{currencySymbol}{calculateTotal(formData)}</div></div>
                    <div><div className="text-[10px] font-bold text-slate-400 uppercase">Total Cost</div><div className="text-sm font-black text-red-500">{currencySymbol}{calculateCost(formData)}</div></div>
                    <div className="bg-green-100 px-4 py-2 rounded-xl"><div className="text-[10px] font-black text-green-600 uppercase">Net Profit</div><div className="text-xl font-black text-green-700 tracking-tighter">{currencySymbol}{calculateProfit(formData)}</div></div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-end mb-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue Breakdown (Charged to Customer)</label>
                    <button type="button" onClick={addRevenueItem} className="text-[10px] font-black text-blue-600 uppercase hover:underline" disabled={isFinancialLocked}>+ Add Item</button>
                  </div>
                  <div className="space-y-3">
                    {(formData.revenueItems || []).map((item) => (
                      <div key={item.id} className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                        <div className="flex-1 w-full"><input disabled={isFinancialLocked} value={item.item} onChange={e => handleLineItemChange('revenue', item.id, 'item', e.target.value)} placeholder="Item Description" className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none" list="basePriceLocations" /></div>
                        <div className="w-full md:w-24 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.qty} onChange={e => handleLineItemChange('revenue', item.id, 'qty', e.target.value)} placeholder="Qty" className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none text-center" /></div>
                        <div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.rate} onChange={e => handleLineItemChange('revenue', item.id, 'rate', e.target.value)} placeholder={`Rate (${currencySymbol})`} className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none text-right" /></div>
                        <div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.amount} onChange={e => handleLineItemChange('revenue', item.id, 'amount', e.target.value)} placeholder={`Amount (${currencySymbol})`} className="w-full px-4 py-2.5 bg-white border border-green-300 rounded-xl font-black text-green-700 text-sm outline-none text-right" /></div>
                        <button type="button" disabled={isFinancialLocked} onClick={() => removeRevenueItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 rounded-xl"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== PAGE 5: DOCUMENTS & NOTES ===== */}
          {activeStep === 'step5' && (
            <div className="animate-in fade-in space-y-8">
              <div className="space-y-4 bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Documentation & Attachments</h3></div>
                  <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-lg border border-slate-200">{(formData.documents || []).length} Files</span>
                </div>
                {(formData.documents || []).length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {formData.documents.map((doc, idx) => {
                      const isImage = doc.type?.startsWith('image/');
                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-2 relative group">
                          <button type="button" onClick={() => removeDocument(doc.url)} className="absolute top-2 right-2 p-1 bg-red-50 text-red-500 rounded-md opacity-0 group-hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
                          <div className="cursor-pointer" onClick={() => window.open(doc.url, '_blank')}>
                            {isImage ? <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500"><Camera className="w-6 h-6" /></div> : <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center text-red-500"><FileText className="w-6 h-6" /></div>}
                          </div>
                          <div className="text-center w-full"><p className="text-[10px] font-bold text-slate-700 truncate px-1">{doc.name}</p></div>
                        </div>
                      );
                    })}
                  </div>
                )}
                                <div className="border-2 border-dashed border-slate-300 rounded-2xl bg-white p-8 text-center relative">
                  <input type="file" multiple accept=".pdf,image/*,.xlsx,.csv" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'documents')} disabled={uploadingFile} />
                  <div className="flex flex-col items-center justify-center gap-3 pointer-events-none">
                    {uploadingFile ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" /> : <Upload className="w-8 h-8 text-slate-400" />}
                    <div><p className="text-sm font-bold text-slate-700">{uploadingFile ? "Uploading..." : "Drop files here or click to upload"}</p></div>
                  </div>
                </div>
              </div>

              {/* ✅ NEW: POD SECTION */}
              <div className="space-y-4 bg-emerald-50/30 p-6 rounded-[32px] border border-emerald-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                    <h3 className="font-black text-xs uppercase tracking-widest text-emerald-900">Proof of Delivery (POD)</h3>
                  </div>
                </div>
                
                {formData.signedPodDoc ? (
                  <div className="bg-white p-4 rounded-xl border border-emerald-200 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-700">{formData.signedPodDoc.name || 'POD Document'}</p>
                          <a href={formData.signedPodDoc.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 font-medium hover:underline">View Document</a>
                        </div>
                     </div>
                     <button type="button" onClick={() => setFormData(prev => ({ ...prev, signedPodDoc: null }))} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                     </button>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-emerald-300 rounded-2xl bg-white p-8 text-center relative hover:bg-emerald-50/50 transition-colors">
                    <input type="file" accept=".pdf,image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'signedPodDoc')} disabled={uploadingFile} />
                    <div className="flex flex-col items-center justify-center gap-3 pointer-events-none">
                      {uploadingFile ? <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /> : <ClipboardCheck className="w-8 h-8 text-emerald-400" />}
                      <div>
                        <p className="text-sm font-bold text-slate-700">{uploadingFile ? "Uploading..." : "Drop POD here or click to upload"}</p>
                        <p className="text-[10px] text-slate-400 font-medium mt-1">Supports PDF and Images</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-purple-600" /><h3 className="font-black text-xs uppercase tracking-widest">Notes & Instructions</h3></div>
                  <button type="button" onClick={handleSmartNotes} disabled={generatingNotes} className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-xl text-[10px] font-black uppercase hover:bg-purple-200">
                    {generatingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate Notes
                  </button>
                </div>
                <textarea name="notes" value={formData.notes} onChange={handleChange} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-sm min-h-[120px] outline-none" placeholder="Driver instructions..." />
              </div>
            </div>
          )}

          {/* ===== PAGE 6: LIFECYCLE ===== */}
          {activeStep === 'lifecycle' && (
            <div className="animate-in fade-in">
              <div className="space-y-6 bg-gradient-to-br from-slate-50 to-gray-50 p-8 rounded-[32px] border-2 border-slate-300 shadow-inner">
                <div className="flex items-center justify-between border-b border-slate-200 pb-4 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-600 p-2.5 rounded-xl text-white"><Target className="w-5 h-5" /></div>
                    <div><h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Container Lifecycle</h3><p className="text-[10px] font-bold text-purple-600">Updates Board automatically</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400">CURRENT:</span>
                    {!formData.etaDate ? (<span className="px-4 py-2 bg-pink-500 text-white rounded-xl text-xs font-black shadow-lg">🟣 PENDING ETA</span>) : formData.isTerminated ? (<span className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-black shadow-lg">⚫ TERMINATED</span>) : formData.isReadyForPickup ? (<span className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black shadow-lg">🔴 READY PICKUP</span>) : formData.isDroppedAtCustomer ? (<span className="px-4 py-2 bg-yellow-500 text-white rounded-xl text-xs font-black shadow-lg">🟡 AT CUSTOMER</span>) : formData.lfdDate ? (<span className="px-4 py-2 bg-emerald-800 text-white rounded-xl text-xs font-black shadow-lg">🟢 LFD SET</span>) : formData.isInYard ? (<span className="px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-black shadow-lg">🔵 IN YARD</span>) : formData.isGrounded ? (<span className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-black shadow-lg">🟢 GROUNDED</span>) : formData.etaDate ? (<span className="px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-black shadow-lg">🟠 ETA RECEIVED</span>) : (<span className="px-4 py-2 bg-slate-400 text-white rounded-xl text-xs font-black">⚪ NEW</span>)}
                  </div>
                </div>

                                {/* Step 1: ETA */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${!formData.etaDate ? 'bg-pink-50 border-pink-400 shadow-md' : 'bg-green-50/30 border-green-200'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-8 h-8 rounded-full bg-pink-500 text-white flex items-center justify-center text-sm font-black">1</span>
                    <div><h4 className="font-black text-sm text-slate-800">ETA Date & Time {!formData.etaDate && <span className="text-pink-600 text-xs">- REQUIRED</span>}</h4></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">ETA Date</label>
                      <input type="date" name="etaDate" value={formData.etaDate || ''} onChange={handleChange} className={`w-full px-4 py-3 rounded-xl font-bold text-sm outline-none ${!formData.etaDate ? 'bg-white border-2 border-pink-400' : 'bg-white border border-slate-200'}`} />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">ETA Time</label>
                      <input type="time" name="etaTime" value={formData.etaTime || ''} onChange={handleChange} className={`w-full px-4 py-3 rounded-xl font-bold text-sm outline-none ${!formData.etaDate ? 'bg-white border-2 border-pink-400' : 'bg-white border border-slate-200'}`} />
                    </div>
                  </div>
                </div>

                {/* Step 2: Grounded */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isGrounded ? 'bg-green-50 border-green-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-black">2</span><div><h4 className="font-black text-sm text-slate-800">Container Grounded</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isGrounded ? 'bg-green-600 text-white border-green-600' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isGrounded || false} onChange={(e) => setFormData(prev => ({ ...prev, isGrounded: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Grounded</span></label>
                  </div>
                </div>

                {/* Step 2.5: In Yard */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isInYard ? 'bg-blue-50 border-blue-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-black">2.5</span><div><h4 className="font-black text-sm text-slate-800">Container in Yard</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isInYard ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isInYard || false} onChange={(e) => setFormData(prev => ({ ...prev, isInYard: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark In Yard</span></label>
                  </div>
                </div>

                {/* Step 2.5a: Pre-pulled */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isInYardPrePull ? 'bg-emerald-50 border-emerald-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-black">2.5a</span><div><h4 className="font-black text-sm text-slate-800">Pre‑pulled & In Yard</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isInYardPrePull ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isInYardPrePull || false} onChange={(e) => setFormData(prev => ({ ...prev, isInYardPrePull: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Pre‑pulled</span></label>
                  </div>
                </div>

                {/* Step 2.5b: Returned to Yard */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isInYardReturn ? 'bg-amber-50 border-amber-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-black">2.5b</span><div><h4 className="font-black text-sm text-slate-800">Returned to Yard</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isInYardReturn ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isInYardReturn || false} onChange={(e) => setFormData(prev => ({ ...prev, isInYardReturn: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Returned</span></label>
                  </div>
                </div>

                {/* Step 3: LFD */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.lfdDate ? 'bg-emerald-50 border-emerald-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center text-sm font-black">3</span><div><h4 className="font-black text-sm text-slate-800">Last Free Day (LFD)</h4></div></div>
                  <input type="date" name="lfdDate" value={formData.lfdDate || ''} onChange={handleChange} className={`w-full px-4 py-3 rounded-xl font-bold text-sm outline-none ${formData.lfdDate ? 'bg-white border-2 border-emerald-400' : 'bg-white border border-slate-200'}`} />
                </div>

                {/* Step 4: Dropped at Customer */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isDroppedAtCustomer ? 'bg-yellow-50 border-yellow-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-yellow-500 text-white flex items-center justify-center text-sm font-black">4</span><div><h4 className="font-black text-sm text-slate-800">Dropped at Customer</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isDroppedAtCustomer ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isDroppedAtCustomer || false} onChange={(e) => {
  const checked = e.target.checked;
  setFormData(prev => ({
    ...prev,
    isDroppedAtCustomer: checked,
    deliveryDate: checked ? (prev.deliveryDate || new Date().toISOString().split('T')[0]) : prev.deliveryDate
  }));
}} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Dropped</span></label>
                  </div>
                </div>

                {/* Step 5: Ready for Pickup */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isReadyForPickup ? 'bg-red-50 border-red-400 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center text-sm font-black">5</span><div><h4 className="font-black text-sm text-slate-800">Ready for Pickup</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isReadyForPickup ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isReadyForPickup || false} onChange={(e) => setFormData(prev => ({ ...prev, isReadyForPickup: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Ready</span></label>
                  </div>
                </div>

                {/* Step 6: Terminated */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isTerminated ? 'bg-gray-900 border-gray-700 shadow-md' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-black">6</span><div><h4 className={`font-black text-sm ${formData.isTerminated ? 'text-white' : 'text-slate-800'}`}>Container Terminated</h4></div></div>
                    <label className={`flex items-center gap-2 cursor-pointer px-5 py-3 rounded-xl border-2 ${formData.isTerminated ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-slate-300'}`}><input type="checkbox" checked={formData.isTerminated || false} onChange={(e) => setFormData(prev => ({ ...prev, isTerminated: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-xs font-black uppercase">Mark Terminated</span></label>
                  </div>
                </div>

                {/* Step 7: Send to Billing */}
                <div className={`p-5 rounded-2xl border-2 transition-all ${formData.isBillingComplete ? 'bg-gray-100 border-gray-400' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-gray-500 text-white flex items-center justify-center text-sm font-black">7</span><div><h4 className="font-black text-sm text-slate-800">Send to Billing</h4></div></div>
                    <button type="button" onClick={() => { if (window.confirm('Send to billing?')) setFormData(prev => ({ ...prev, isBillingComplete: true, status: 'Ready for Billing' })); }} disabled={!formData.isTerminated || formData.isBillingComplete} className={`px-5 py-3 rounded-xl text-xs font-black uppercase transition-all ${formData.isBillingComplete ? 'bg-gray-300 text-gray-500' : !formData.isTerminated ? 'bg-gray-200 text-gray-400' : 'bg-gray-600 text-white hover:bg-gray-700'}`}>{formData.isBillingComplete ? '✅ Billed' : !formData.isTerminated ? '🔒 Terminate First' : 'Send to Billing →'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

                    {/* ===== LEG EDIT MODAL ===== */}
          {editingLegId && (() => {
            const legToEdit = formData.legs.find(l => l.id === editingLegId);
            if (!legToEdit) return null;
            return (
              <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setEditingLegId(null)}></div>
                <div className="bg-white w-full max-w-3xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-600 p-2 rounded-xl text-white"><Truck className="w-5 h-5" /></div>
                      <div><h2 className="font-black text-slate-900 text-lg">Edit Trip Leg</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leg {formData.legs.findIndex(l => l.id === editingLegId) + 1}</p></div>
                    </div>
                    <button type="button" onClick={() => setEditingLegId(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto space-y-6">
                    {/* Status & Driver */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Date</label><input type="date" value={legToEdit.legDate || ''} onChange={e => updateLeg(legToEdit.id, 'legDate', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Time (In)</label><input type="time" value={legToEdit.arrivalTime || ''} onChange={e => updateLeg(legToEdit.id, 'arrivalTime', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Time (Out)</label><input type="time" value={legToEdit.departureTime || ''} onChange={e => updateLeg(legToEdit.id, 'departureTime', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200" /></div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Status</label><select value={legToEdit.status} onChange={e => updateLeg(legToEdit.id, 'status', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200"><option value="Planned">Planned</option><option value="Dispatched">Dispatched</option><option value="Completed">Completed</option></select></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Driver</label><select value={legToEdit.driverName} onChange={e => updateLeg(legToEdit.id, 'driverName', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200"><option value="">Select Driver...</option>{savedDrivers.map(d => <option key={d.id} value={d.name}>{d.name} (Truck: {d.truckNo})</option>)}</select></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Leg Type</label><select value={legToEdit.legType || 'delivery'} onChange={e => updateLeg(legToEdit.id, 'legType', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-200"><option value="delivery">📦 Delivery</option><option value="pickup">🏗️ Pickup</option><option value="prepull">⏳ Pre-pull</option><option value="termination">🏁 Termination</option></select></div>
                    </div>

                                        {/* Locations */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                      <div>
                        <label className="text-[10px] font-black text-emerald-600 uppercase block mb-1">Pickup Location</label>
                        <input type="text" value={legToEdit.from} onChange={e => handleAddressChange(legToEdit.id, 'from', e.target.value)} placeholder="Search location or terminal..." className="w-full px-3 py-2 border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-200" list={'loclist-' + legToEdit.id} />
                        <datalist id={'loclist-' + legToEdit.id}>
                          {savedDestinations.map((d, i) => <option key={'dest-pick-' + i} value={d.name + ' - ' + d.address}></option>)}
                          {companyTerminals && companyTerminals.map((t, i) => <option key={'term-pick-' + i} value={t.name + (t.code ? ` (${t.code})` : '') + ' - ' + t.address}></option>)}
                        </datalist>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-rose-600 uppercase block mb-1">Drop Location</label>
                        <input type="text" value={legToEdit.to} onChange={e => handleAddressChange(legToEdit.id, 'to', e.target.value)} placeholder="Search location or terminal..." className="w-full px-3 py-2 border border-rose-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-rose-200" list={'loclist-to-' + legToEdit.id} />
                        <datalist id={'loclist-to-' + legToEdit.id}>
                          {savedDestinations.map((d, i) => <option key={'dest-drop-' + i} value={d.name + ' - ' + d.address}></option>)}
                          {companyTerminals && companyTerminals.map((t, i) => <option key={'term-drop-' + i} value={t.name + (t.code ? ` (${t.code})` : '') + ' - ' + t.address}></option>)}
                        </datalist>
                      </div>
                    </div>

                    {/* Financials */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Driver Pay</label><input type="number" value={legToEdit.driverPay || ''} onChange={e => updateLeg(legToEdit.id, 'driverPay', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Fuel Cost</label><input type="number" value={legToEdit.fuelCost || ''} onChange={e => updateLeg(legToEdit.id, 'fuelCost', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Detention</label><input type="number" value={legToEdit.detentionPay || ''} onChange={e => updateLeg(legToEdit.id, 'detentionPay', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Distance (km)</label><input type="number" value={legToEdit.totalDistance || ''} onChange={e => updateLeg(legToEdit.id, 'totalDistance', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white" /></div>
                      <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Hours</label><input type="number" value={legToEdit.totalHours || ''} onChange={e => updateLeg(legToEdit.id, 'totalHours', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm font-bold bg-white" /></div>
                    </div>

                    {/* Notes */}
                    <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Dispatch Notes</label><textarea value={legToEdit.notes || ''} onChange={e => updateLeg(legToEdit.id, 'notes', e.target.value)} rows="2" className="w-full px-3 py-2 border rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-blue-200" placeholder="Add leg-specific notes..."></textarea></div>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
                    <button type="button" onClick={() => setEditingLegId(null)} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200">
                      Done Editing
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

                    {/* ===== STICKY BOTTOM NAVIGATION ===== */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 px-8 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)] flex items-center justify-between z-50">
            <div>
              <button type="button" onClick={onClose} className="px-6 py-3 border-2 border-slate-200 rounded-xl font-black text-slate-500 uppercase tracking-widest text-xs hover:bg-slate-50 transition-all">Discard</button>
            </div>
            
            <div className="flex gap-3">
              {activeStep !== 'step1' && activeStep !== 'lifecycle' && (
                <button type="button" onClick={() => {
                  if (activeStep === 'step2') setActiveStep('step1');
                  if (activeStep === 'step3') setActiveStep('step2');
                  if (activeStep === 'step4') setActiveStep('step3');
                  if (activeStep === 'step5') setActiveStep('step4');
                }} className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all flex items-center gap-2">
                  ← Back
                </button>
              )}

              {activeStep !== 'step5' && activeStep !== 'lifecycle' && (
                <button type="button" onClick={() => {
                  if (activeStep === 'step1') setActiveStep('step2');
                  if (activeStep === 'step2') setActiveStep('step3');
                  if (activeStep === 'step3') setActiveStep('step4');
                  if (activeStep === 'step4') setActiveStep('step5');
                }} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center gap-2">
                  Next Step →
                </button>
              )}

                                        {(activeStep === 'step5' || activeStep === 'lifecycle') && (
                            <button type="submit" disabled={isSaving} className="px-8 py-3 bg-green-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-green-700 transition-all shadow-lg shadow-green-200 disabled:opacity-50 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              {isSaving ? 'Saving...' : 'Save Load Record'}
                            </button>
                          )}
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              );
            };

        // ========== TABLE COMPONENTS (CONTINUED) ==========
const LoadTable = React.memo(({ loads, onEdit, onDelete, onStatusChange, onViewDoc, onSign, onCopy, onDownload, onDownloadLoadConfirmation, onDownloadPOD, onTrack, onQuickAssign, companyName, currentPage, pageSize, isLoadingMore, onNextPage, onPrevPage, hasNextPage, bulkDeleteMode = false, selectedLoadIds = [], onToggleSelection }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[1400px]">
        <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {bulkDeleteMode && <th className="px-4 py-3 w-10"></th>}
            <th className="px-4 py-3">Container</th>
            <th className="px-4 py-3">Line</th>
            <th className="px-4 py-3">Terminal</th>
            <th className="px-4 py-3">PO #</th>
            <th className="px-4 py-3">Pick Up #</th>
            <th className="px-4 py-3">Cust Ref</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Weight</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">WO #</th>
            <th className="px-4 py-3">Currency</th>
            <th className="px-4 py-3">Pre-Pull</th>
            <th className="px-4 py-3">Chassis</th>
            <th className="px-4 py-3 min-w-[200px]">Trip Legs</th>
            <th className="px-4 py-3">Billing</th>
            <th className="px-4 py-3 text-center">Load Conf</th>
            <th className="px-4 py-3 text-center">Signed POD</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
                    {(loads || []).map((load) => {
            const isSelected = selectedLoadIds.includes(load.id);
            return (
            <tr key={load.id}
                className={`hover:bg-slate-50/50 transition-colors group text-xs font-bold text-slate-700 cursor-pointer ${
                  bulkDeleteMode && isSelected ? 'bg-red-50' : ''
                }`}
                onClick={(e) => {
                  if (bulkDeleteMode) {
                    e.preventDefault();
                    onToggleSelection && onToggleSelection(load.id);
                  } else {
                    onEdit && onEdit(load);
                  }
                }}
            >
              {bulkDeleteMode && (
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelection && onToggleSelection(load.id)}
                    className="w-4 h-4 accent-red-600 cursor-pointer"
                  />
                </td>
              )}
              <td className="px-4 py-3">
                <div className="font-black text-slate-900 flex items-center gap-1">
  {load.containerNo || 'N/A'}
  {load.isReturningContainer && (
    <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200" title="This container has previous history in the system">
      🔄 RETURNED
    </span>
  )}
</div>
                <div className="mt-1 flex items-center gap-1 flex-wrap">
                  {load.loadType === 'LIVE' ? (
                    <span className="text-[10px] font-black text-blue-600 bg-blue-100 px-2 py-0.5 rounded flex items-center gap-1">
                      <Clock className="w-3 h-3" /> LIVE
                    </span>
                  ) : load.loadType === 'DROP' ? (
                    <span className="text-[10px] font-black text-green-600 bg-green-100 px-2 py-0.5 rounded flex items-center gap-1">
                      <Package className="w-3 h-3" /> DROP
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">⚠️ MISSING</span>
                  )}
                  <span className="text-[9px] font-bold text-slate-400 ml-1 truncate max-w-[80px]">{load.lastTrackingStatus || "Pending"}</span>
                </div>
              </td>
              <td className="px-4 py-3"><span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md uppercase whitespace-nowrap">{load.shippingLine || 'N/A'}</span></td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.legs?.[0]?.from}>{load.legs?.[0]?.from || <span className="text-slate-300 italic">N/A</span>}</td>
              <td className="px-4 py-3">{load.poNumber || '--'}</td>
              <td className="px-4 py-3">{load.pickupNo || '--'}</td>
              <td className="px-4 py-3">{load.customerRefNo || '--'}</td>
              <td className="px-4 py-3">{load.size || 'N/A'}</td>
              <td className="px-4 py-3">{load.weight || '--'}</td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.customerName}>{load.customerName || 'N/A'}</td>
              <td className="px-4 py-3 font-bold text-slate-700">{load.workOrderNo || '--'}</td>
              <td className="px-4 py-3">
                <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase ${load.currency === 'USD' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                  {load.currency === 'USD' ? 'US$' : 'C$'}
                </span>
              </td>
              <td className="px-4 py-3">
                {load.isPrePull ? (
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-2 py-1 rounded-md border border-purple-200 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      Pre-Pull
                    </span>
                    {load.prePullDate && (
                      <span className={`text-[10px] font-bold ${new Date(load.prePullDate) < new Date() ? 'text-red-600' : 'text-yellow-600'}`}>
                        {new Date(load.prePullDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  {(load.legs || []).map((leg) => (
                    <div key={leg.id} className="flex items-center gap-2 text-[10px] bg-slate-100 px-2 py-1 rounded border border-slate-200">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${leg.status === 'Completed' ? 'bg-green-500' : leg.status === 'Dispatched' ? 'bg-blue-500' : 'bg-yellow-500'}`}></div>
                      <span className="truncate max-w-[120px]">{leg.to || 'N/A'}</span>
                      {leg.legDate && (
                        <span className="text-[8px] font-bold text-slate-400 whitespace-nowrap">
                          📅 {new Date(leg.legDate).toLocaleDateString()}
                        </span>
                      )}
                      {leg.notes && (
                        <span className="text-blue-500" title={leg.notes}>
                          <FileText className="w-2.5 h-2.5" />
                        </span>
                      )}
                      <div className="ml-auto flex gap-1">
                        {onQuickAssign && !leg.driverName && (
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              const driverName = prompt('Enter driver name:');
                              if (driverName) {
                                const truckNo = prompt('Enter truck number:');
                                if (truckNo) {
                                  onQuickAssign(load.id, leg.id, driverName, truckNo);
                                }
                              }
                            }} 
                            className="text-orange-400 hover:text-orange-600"
                            title="Quick Assign Driver"
                          >
                            <User className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {leg.driverName && (
                          <span className="text-[8px] font-bold text-green-600 truncate max-w-[40px]" title={leg.driverName}>
                            {leg.driverName}
                          </span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onCopy && onCopy(load, leg); }} className="text-slate-400 hover:text-blue-600">
                          <Copy className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onDownload && onDownload(load, leg); }} className="text-slate-400 hover:text-green-600">
                          <FileDown className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onSign && onSign(load.id, leg); }} className="text-slate-400 hover:text-blue-600">
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <select 
                  value={load.status || 'Open'} 
                  onChange={(e) => onStatusChange && onStatusChange(load.id, e.target.value)} 
                  className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase transition-all outline-none ${load.status === 'Open' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-green-200 bg-green-50 text-green-600'}`}
                >
                  <option value="Open">Open</option>
                  <option value="Ready for Billing">Ready for Billing</option>
                </select>
              </td>
              <td className="px-4 py-3 text-center">
                {load.loadConfirmation ? (
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"});
                      }}
                      className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                      title="View Load Confirmation"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadLoadConfirmation && onDownloadLoadConfirmation(load);
                      }}
                      className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"
                      title="Download Load Confirmation"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-300">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-center">
                {load.signedPodDoc ? (
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"});
                      }}
                      className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                      title="View POD"
                    >
                      <ClipboardCheck className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadPOD && onDownloadPOD(load);
                      }}
                      className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"
                      title="Download POD"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-300">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={(e) => { e.stopPropagation(); onTrack && onTrack(load); }} className="p-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">
                    <Globe className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(load); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete && onDelete(load.id); }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
                        </tr>
            );
          })}
          {(!loads || loads.length === 0) && (<tr><td colSpan={bulkDeleteMode ? 19 : 18} className="px-4 py-8 text-center text-slate-400 font-bold italic">No loads found matching this view.</td></tr>)}
        </tbody>
      </table>
    </div>
    {onNextPage && onPrevPage && (
      <div className="flex justify-between items-center px-4 py-3 border-t border-slate-200">
        <button onClick={onPrevPage} disabled={currentPage === 0} className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold disabled:opacity-50">Previous</button>
        <span className="text-xs font-bold text-slate-500">Page {currentPage + 1}</span>
        <button onClick={onNextPage} disabled={!hasNextPage || isLoadingMore} className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold disabled:opacity-50">
          {isLoadingMore ? 'Loading...' : 'Next'}
        </button>
      </div>
    )}
  </div>
));

const BillingTable = ({ 
  loads, 
  onStatusChange, 
  onGenerateInvoice,      // ✅ ADD
  onDraftEmail, 
  onEdit, 
  onPrint, 
  onViewDoc, 
  onSendInvoice, 
  onApprove, 
  setFeedback,
  companyName, 
  companyEmail 
}) => {
  const BillingRow = ({ load }) => {
    const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
    
    // Determine current workflow state
    const isWaiting = load.status === 'Ready for Billing' || load.status === 'Waiting for Approval';
    const isApproved = load.status === 'Approved';
    const isInvoiced = load.status === 'Invoiced';
    const isPaid = load.status === 'Paid' || load.status === 'Completed';

    return (
      <tr 
        key={load.id} 
        className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${isWaiting ? 'bg-amber-50/30' : ''}`}
        onClick={() => onEdit && onEdit(load)}
      >
        <td className="px-6 py-4">
          <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
            {load.containerNo || 'N/A'}
            {load.invoiceNumber && (
              <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                📄 {load.invoiceNumber}
              </span>
            )}
          </div>
          <div className="text-[10px] font-black text-slate-400 mt-1 uppercase">
            {load.customerName || 'N/A'} • WO: {load.workOrderNo || 'No WO'}
          </div>
        </td>

        <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-center gap-2">
            {load.loadConfirmation && <button onClick={() => onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100" title="Load Confirmation"><Paperclip className="w-3.5 h-3.5" /></button>}
            {load.signedPodDoc && <button onClick={() => onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100" title="Signed POD"><ClipboardCheck className="w-3.5 h-3.5" /></button>}
          </div>
        </td>

        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-2">
            {isWaiting && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black border border-amber-200 shadow-sm w-fit">
                <Clock className="w-3.5 h-3.5" /> WAITING FOR APPROVAL
              </span>
            )}
            {isApproved && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black border border-blue-200 shadow-sm w-fit">
                <CheckCircle className="w-3.5 h-3.5" /> APPROVED
              </span>
            )}
            {isInvoiced && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-black border border-purple-200 shadow-sm w-fit">
                <FileText className="w-3.5 h-3.5" /> INVOICED
              </span>
            )}
            {isPaid && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-[10px] font-black border border-green-200 shadow-sm w-fit">
                <DollarSign className="w-3.5 h-3.5" /> PAID
              </span>
            )}
          </div>
        </td>

        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
          <div className="font-black text-slate-900 text-sm">Rev: {currencySymbol}{calculateTotal(load)}</div>
          <div className="font-bold text-red-500 text-[10px] mt-0.5 uppercase">Cost: {currencySymbol}{calculateCost(load)}</div>
          <div className="font-black text-green-600 text-[11px] mt-0.5 uppercase">Profit: {currencySymbol}{calculateProfit(load)}</div>
        </td>

        <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-2 items-center">
            
            {/* 1. WAITING → Approve Charges */}
            {isWaiting && (
              <button
                onClick={() => onApprove && onApprove(load.id)}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase hover:bg-amber-600 transition-all shadow-sm flex items-center gap-1"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Approve Charges
              </button>
            )}

            {/* 2. APPROVED → Generate Invoice */}
{isApproved && (
  <button
    onClick={() => onGenerateInvoice && onGenerateInvoice(load.id)}
    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-blue-700 transition-all shadow-sm flex items-center gap-1"
  >
    <FileText className="w-3.5 h-3.5" /> Generate Invoice
  </button>
)}

            {/* 3. INVOICED → Send to Customer (redirects to Invoices tab) */}
            {isInvoiced && (
              <button
                onClick={() => {
                  setFeedback?.('📧 Go to the Invoices tab to email this invoice');
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-green-700 transition-all shadow-sm flex items-center gap-1"
                title="Go to Invoices tab to send"
              >
                <Send className="w-3.5 h-3.5" /> Send via Invoices Tab
              </button>
            )}

            <div className="flex gap-1 ml-2 border-l border-slate-200 pl-2">
              <button onClick={() => onEdit && onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit Load"><Edit3 className="w-4 h-4" /></button>
              <button onClick={() => onPrint && onPrint(load)} className="p-2 text-slate-400 hover:text-green-600 rounded-lg transition-colors" title="Print Invoice"><Printer className="w-4 h-4" /></button>
            </div>
          </div>
        </td>
      </tr>
    );
  };
 
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">Container & Customer</th>
              <th className="px-6 py-4 text-center">Docs</th>
              <th className="px-6 py-4">Workflow Status</th>
              <th className="px-6 py-4">Financials</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(loads || []).map((load) => (<BillingRow key={load.id} load={load} />))}
            {(!loads || loads.length === 0) && (
              <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400 font-bold italic">No loads in billing queue.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const HistoryTable = ({ loads, onStatusChange, onViewDoc, onDelete, onEdit, onEditInvoice }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[800px]">
        <thead>
          <tr className="bg-slate-50/50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <th className="px-6 py-4">Container & Identity</th>
            <th className="px-6 py-4 text-center">Docs</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4">Financials</th>
            <th className="px-6 py-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(loads || []).map((load) => {
            const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
            return (
              <tr key={load.id} className="hover:bg-slate-50/50 transition-colors group opacity-75 hover:opacity-100">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900 text-sm">{load.containerNo || 'N/A'} <span className="text-xs text-slate-400 ml-2 font-normal">({load.workOrderNo || 'No WO'})</span></div>
                  <div className="text-[10px] font-black text-slate-400 mt-1 uppercase">{load.customerName || 'N/A'}</div>
                </td>
                <td className="px-6 py-4 text-center">
                  <div className="flex justify-center gap-2">
                    {load.loadConfirmation && <button onClick={() => onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><Paperclip className="w-3.5 h-3.5" /></button>}
                    {load.signedPodDoc && <button onClick={() => onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"><ClipboardCheck className="w-3.5 h-3.5" /></button>}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <select 
                    value={load.status || 'Paid'} 
                    onChange={(e) => onStatusChange && onStatusChange(load.id, e.target.value)} 
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-black uppercase transition-all"
                  >
                    <option value="Paid">Paid</option>
                    <option value="Completed">Completed</option>
                    <option value="Invoiced">Revert to Invoiced</option>
                  </select>
                </td>
                <td className="px-6 py-4">
                  <div className="font-black text-slate-900 text-sm">Profit: {currencySymbol}{calculateProfit(load)}</div>
                  <div className="font-bold text-slate-400 text-[10px] mt-0.5 uppercase">Closed: {new Date().toLocaleDateString()}</div>
                </td>
                <td className="px-6 py-4 text-right flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
  {/* ✅ NEW — Edit Invoice button (only if load has an invoice) */}
  {load.invoiceNumber && onEditInvoice && (
    <button
      onClick={() => onEditInvoice(load)}
      className="p-2 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
      title="Edit & Resend Invoice"
    >
      <FileText className="w-4 h-4" />
    </button>
  )}
  <button onClick={() => onEdit && onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors" title="Edit Load">
    <Edit3 className="w-4 h-4" />
  </button>
  <button onClick={() => onDelete && onDelete(load.id)} className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors" title="Delete">
    <Trash2 className="w-4 h-4" />
  </button>
</td>
              </tr>
            );
          })}
          {(!loads || loads.length === 0) && (
            <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-bold italic">No history matching this view.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// ========== ADDRESS BOOK COMPONENT WITH BASE PRICES TAB ==========
const AddressBook = ({ 
  savedCustomers, 
  savedDestinations, 
  savedDrivers,
  savedChassis,
  savedTrucks,
  savedBasePrices, // <-- NEW
  onDeleteCustomer, 
  onDeleteLocation, 
  onDeleteDriver,
  onDeleteBasePrice, // <-- NEW
  newCust, 
  setNewCust, 
  newLoc, 
  setNewLoc, 
  newDriver, 
  setNewDriver,
  newBasePrice, // <-- NEW
  setNewBasePrice, // <-- NEW
  onAddCustomer, 
  onAddLocation, 
  onAddDriver,
  onAddBasePrice, // <-- NEW
  onUpdateCustomer, 
  onUpdateLocation, 
  onUpdateDriver,
  onImportBasePrices,
  onImportLocations,
  savedTerminals,
  onDeleteTerminal,
  newTerminal,
  setNewTerminal,
  onAddTerminal,
  onUpdateTerminal,
  companyId,
  setFeedback,
  isAdmin,
  isDispatcher
}) => {
  // ===== STATE FOR TAB SELECTION =====
  const [activeDatabaseTab, setActiveDatabaseTab] = useState('customers');

  // ===== STATE FOR EDIT MODALS =====
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    address: '',
    contactName: '',
    contactTitle: '',
    fax: '',
    city: '',
    postalCode: '',
    defaultTax: '',
    accountingId: '',
    division: '',
    prepullRate: '',
    stopOffRate: '',
    yardStorageRate: '',
    chassisRate: '',
    rateCurrency: 'CAD'
  });
    // ===== NEW: SEARCH & BULK DELETE STATE FOR LOCATIONS =====
  const [locationSearchTerm, setLocationSearchTerm] = useState('');
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteStep, setBulkDeleteStep] = useState(1);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    // ===== NEW: SEARCH & BULK DELETE STATE FOR CUSTOMERS =====
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerBulkDeleteMode, setCustomerBulkDeleteMode] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [showCustomerBulkDeleteConfirm, setShowCustomerBulkDeleteConfirm] = useState(false);
  const [customerBulkDeleteStep, setCustomerBulkDeleteStep] = useState(1);
  const [isCustomerBulkDeleting, setIsCustomerBulkDeleting] = useState(false);

    // ===== NEW: SEARCH & BULK DELETE STATE FOR DRIVERS =====
  const [driverSearchTerm, setDriverSearchTerm] = useState('');
  const [driverBulkDeleteMode, setDriverBulkDeleteMode] = useState(false);
  const [selectedDriverIds, setSelectedDriverIds] = useState([]);
  const [showDriverBulkDeleteConfirm, setShowDriverBulkDeleteConfirm] = useState(false);
  const [driverBulkDeleteStep, setDriverBulkDeleteStep] = useState(1);
  const [isDriverBulkDeleting, setIsDriverBulkDeleting] = useState(false);

    // ===== NEW: SEARCH & BULK DELETE STATE FOR TERMINALS =====
  const [terminalSearchTerm, setTerminalSearchTerm] = useState('');
  const [terminalBulkDeleteMode, setTerminalBulkDeleteMode] = useState(false);
  const [selectedTerminalIds, setSelectedTerminalIds] = useState([]);
  const [showTerminalBulkDeleteConfirm, setShowTerminalBulkDeleteConfirm] = useState(false);
  const [terminalBulkDeleteStep, setTerminalBulkDeleteStep] = useState(1);
  const [isTerminalBulkDeleting, setIsTerminalBulkDeleting] = useState(false);

    // ===== NEW: SEARCH & BULK DELETE STATE FOR BASE PRICES =====
  const [basePriceSearchTerm, setBasePriceSearchTerm] = useState('');
  const [basePriceBulkDeleteMode, setBasePriceBulkDeleteMode] = useState(false);
  const [selectedBasePriceIds, setSelectedBasePriceIds] = useState([]);
  const [showBasePriceBulkDeleteConfirm, setShowBasePriceBulkDeleteConfirm] = useState(false);
  const [basePriceBulkDeleteStep, setBasePriceBulkDeleteStep] = useState(1);
  const [isBasePriceBulkDeleting, setIsBasePriceBulkDeleting] = useState(false);

  const [showLocationEditModal, setShowLocationEditModal] = useState(false);
  const [locationEditFormData, setLocationEditFormData] = useState({
    id: '',
    name: '',
    address: '',
    city: '',
    province: '',
    postalCode: ''
  });

  const [showDriverEditModal, setShowDriverEditModal] = useState(false);
  const [driverEditFormData, setDriverEditFormData] = useState({
    id: '',
    name: '',
    truckNo: '',
    type: 'Company Driver',
    payRate: 0,
    payType: 'flat',
    fuelEfficiency: '',
    email: '',
    password: ''
  });

  const [showTerminalEditModal, setShowTerminalEditModal] = useState(false);
  const [terminalEditFormData, setTerminalEditFormData] = useState({
    id: '',
    name: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    code: '',
    phone: '',
    email: '',
    contactName: ''
  });

  // ===== FAST BULK DELETE HELPER (uses writeBatch for 500x speed) =====
  const batchDeleteDocuments = async (collectionName, ids) => {
    const CHUNK_SIZE = 500; // Firestore limit per batch
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      try {
        const batch = writeBatch(db);
        chunk.forEach(id => {
          const ref = doc(db, 'companies', companyId, collectionName, id);
          batch.delete(ref);
        });
        await batch.commit();
        successCount += chunk.length;
        // Live progress feedback
        setFeedback(`⏳ Deleting... ${successCount}/${ids.length}`);
      } catch (err) {
        console.error(`Batch delete failed:`, err);
        failCount += chunk.length;
      }
    }

    return { successCount, failCount };
  };

  // ===== EDIT HANDLERS =====
  const openEditModal = (customer) => {
    setEditFormData({
      id: customer.id,
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      contactName: customer.contactName || '',
      contactTitle: customer.contactTitle || '',
      fax: customer.fax || '',
      city: customer.city || '',
      postalCode: customer.postalCode || '',
      defaultTax: customer.defaultTax || '',
      accountingId: customer.accountingId || '',
      division: customer.division || '',
      prepullRate: customer.prepullRate || '',
      stopOffRate: customer.stopOffRate || '',
      yardStorageRate: customer.yardStorageRate || '',
      chassisRate: customer.chassisRate || '',
      rateCurrency: customer.rateCurrency || 'CAD'
    });
    setShowEditModal(true);
  };

  const openLocationEditModal = (location) => {
    setLocationEditFormData({
      id: location.id,
      name: location.name || '',
      address: location.address || '',
      city: location.city || '',
      province: location.province || '',
      postalCode: location.postalCode || ''
    });
    setShowLocationEditModal(true);
  };

  const openDriverEditModal = (driver) => {
    setDriverEditFormData({
      id: driver.id,
      name: driver.name || '',
      truckNo: driver.truckNo || '',
      type: driver.type || 'Company Driver',
      payRate: driver.payRate || 0,
      payType: driver.payType || 'flat',
      fuelEfficiency: driver.fuelEfficiency || '',
      email: driver.email || '',
      password: ''
    });
    setShowDriverEditModal(true);
  };

  const openTerminalEditModal = (terminal) => {
    setTerminalEditFormData({
      id: terminal.id,
      name: terminal.name || '',
      address: terminal.address || '',
      city: terminal.city || '',
      province: terminal.province || '',
      postalCode: terminal.postalCode || '',
      code: terminal.code || '',
      phone: terminal.phone || '',
      email: terminal.email || '',
      contactName: terminal.contactName || ''
    });
    setShowTerminalEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editFormData.name.trim()) {
      alert('Customer name is required');
      return;
    }
    await onUpdateCustomer(editFormData.id, editFormData);
    setShowEditModal(false);
  };

  const handleLocationEditSubmit = async (e) => {
    e.preventDefault();
    if (!locationEditFormData.name.trim()) {
      alert('Location name is required');
      return;
    }
    await onUpdateLocation(locationEditFormData.id, locationEditFormData);
    setShowLocationEditModal(false);
  };

  const handleDriverEditSubmit = async (e) => {
    e.preventDefault();
    if (!driverEditFormData.name.trim()) {
      alert('Driver name is required');
      return;
    }
    await onUpdateDriver(driverEditFormData.id, driverEditFormData);
    setShowDriverEditModal(false);
  };

  const handleTerminalEditSubmit = async (e) => {
    e.preventDefault();
    if (!terminalEditFormData.name.trim()) {
      alert('Terminal name is required');
      return;
    }
    await onUpdateTerminal(terminalEditFormData.id, terminalEditFormData);
    setShowTerminalEditModal(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* ===== TAB BUTTONS ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2 flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveDatabaseTab('customers')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'customers'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building className="w-5 h-5" />
          Customers
          <span className="text-xs opacity-75">({savedCustomers.length})</span>
        </button>

        <button
          onClick={() => setActiveDatabaseTab('locations')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'locations'
              ? 'bg-red-600 text-white shadow-lg shadow-red-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MapPin className="w-5 h-5" />
          Locations
          <span className="text-xs opacity-75">({savedDestinations.length})</span>
        </button>

        <button
          onClick={() => setActiveDatabaseTab('drivers')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'drivers'
              ? 'bg-orange-600 text-white shadow-lg shadow-orange-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Truck className="w-5 h-5" />
          Drivers
          <span className="text-xs opacity-75">({savedDrivers.length})</span>
        </button>

        <button
          onClick={() => setActiveDatabaseTab('chassis')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'chassis'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Anchor className="w-5 h-5" />
          Chassis
          <span className="text-xs opacity-75">({savedChassis?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveDatabaseTab('trucks')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'trucks'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Truck className="w-5 h-5" />
          Trucks
          <span className="text-xs opacity-75">({savedTrucks?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveDatabaseTab('terminals')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'terminals'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Anchor className="w-5 h-5" />
          Terminals
          <span className="text-xs opacity-75">({savedTerminals?.length || 0})</span>
        </button>

        {/* ✅ NEW: BASE PRICES BUTTON */}
        <button
          onClick={() => setActiveDatabaseTab('basePrices')}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            activeDatabaseTab === 'basePrices'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <DollarSign className="w-5 h-5" />
          Base Prices
          <span className="text-xs opacity-75">({savedBasePrices?.length || 0})</span>
        </button>
      </div>

      {/* ===== RENDER ACTIVE TAB ===== */}
      {activeDatabaseTab === 'customers' && (() => {
  // Filter customers by search term
  const filteredCustomers = (savedCustomers || []).filter(cust => {
    if (!customerSearchTerm.trim()) return true;
    const term = customerSearchTerm.toLowerCase().trim();
    return (
      (cust.name || '').toLowerCase().includes(term) ||
      (cust.email || '').toLowerCase().includes(term) ||
      (cust.phone || '').toLowerCase().includes(term) ||
      (cust.address || '').toLowerCase().includes(term) ||
      (cust.city || '').toLowerCase().includes(term) ||
      (cust.contactName || '').toLowerCase().includes(term) ||
      (cust.accountingId || '').toLowerCase().includes(term)
    );
  });

  const toggleCustomerSelection = (id) => {
    setSelectedCustomerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFilteredCustomers = () => {
    setSelectedCustomerIds(filteredCustomers.map(c => c.id));
  };

  const deselectAllCustomers = () => {
    setSelectedCustomerIds([]);
  };

    const performCustomerBulkDelete = async () => {
    if (selectedCustomerIds.length === 0) return;
    setIsCustomerBulkDeleting(true);
    const { successCount, failCount } = await batchDeleteDocuments('customers', selectedCustomerIds);
    setIsCustomerBulkDeleting(false);
    setSelectedCustomerIds([]);
    setCustomerBulkDeleteMode(false);
    setShowCustomerBulkDeleteConfirm(false);
    setCustomerBulkDeleteStep(1);
    setFeedback(failCount === 0
      ? `✅ Deleted ${successCount} customer${successCount !== 1 ? 's' : ''}`
      : `⚠️ Deleted ${successCount}, failed ${failCount}`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* ===== LEFT: Add Customer ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700">
          <Building className="text-blue-600 w-5 h-5" /> Add Customer
        </h3>
        <form onSubmit={onAddCustomer} className="space-y-3">
          <input required className="w-full p-3 border rounded-xl text-sm font-bold" placeholder="Company Name*" value={newCust.name} onChange={e => setNewCust({...newCust, name: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Contact Name" value={newCust.contactName} onChange={e => setNewCust({...newCust, contactName: e.target.value})} />
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Contact Title" value={newCust.contactTitle} onChange={e => setNewCust({...newCust, contactTitle: e.target.value})} />
            <input type="tel" className="w-full p-3 border rounded-xl text-sm" placeholder="Phone Number" value={newCust.phone} onChange={e => setNewCust({...newCust, phone: e.target.value})} />
            <input type="tel" className="w-full p-3 border rounded-xl text-sm" placeholder="Fax Number" value={newCust.fax} onChange={e => setNewCust({...newCust, fax: e.target.value})} />
          </div>
          <input type="email" className="w-full p-3 border rounded-xl text-sm" placeholder="Email Address" value={newCust.email} onChange={e => setNewCust({...newCust, email: e.target.value})} />
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Address" value={newCust.address} onChange={e => setNewCust({...newCust, address: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="City" value={newCust.city} onChange={e => setNewCust({...newCust, city: e.target.value})} />
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Postal Code" value={newCust.postalCode} onChange={e => setNewCust({...newCust, postalCode: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Accounting ID" value={newCust.accountingId} onChange={e => setNewCust({...newCust, accountingId: e.target.value})} />
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Division" value={newCust.division} onChange={e => setNewCust({...newCust, division: e.target.value})} />
          </div>
          <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-700 transition-colors">Save Customer</button>
        </form>
      </div>

      {/* ===== RIGHT: Customer List with Search + Bulk Delete ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <Building className="text-blue-600 w-5 h-5" /> Customer List
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({filteredCustomers.length}{customerSearchTerm && ` of ${savedCustomers.length}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {!customerBulkDeleteMode ? (
              <button
                onClick={() => {
                  setCustomerBulkDeleteMode(true);
                  setSelectedCustomerIds([]);
                }}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Select & Delete
              </button>
            ) : (
              <button
                onClick={() => {
                  setCustomerBulkDeleteMode(false);
                  setSelectedCustomerIds([]);
                }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={customerSearchTerm}
            onChange={(e) => setCustomerSearchTerm(e.target.value)}
            placeholder="Search by company, contact, email, phone, city..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
          {customerSearchTerm && (
            <button
              onClick={() => setCustomerSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-600 rounded-md hover:bg-blue-50"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ===== BULK DELETE ACTION BAR ===== */}
        {customerBulkDeleteMode && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-red-700 uppercase">
                {selectedCustomerIds.length} selected
              </span>
              <button
                onClick={selectAllFilteredCustomers}
                className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
              >
                Select All ({filteredCustomers.length})
              </button>
              {selectedCustomerIds.length > 0 && (
                <button
                  onClick={deselectAllCustomers}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                >
                  Deselect All
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedCustomerIds.length === 0) {
                  setFeedback("⚠️ No customers selected");
                  return;
                }
                setCustomerBulkDeleteStep(1);
                setShowCustomerBulkDeleteConfirm(true);
              }}
              disabled={selectedCustomerIds.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedCustomerIds.length})
            </button>
          </div>
        )}

        {/* ===== CUSTOMER LIST ===== */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 font-bold italic text-sm">
              {customerSearchTerm ? `No customers match "${customerSearchTerm}"` : 'No customers saved yet'}
            </div>
          ) : (
            filteredCustomers.map((c) => {
              const isSelected = selectedCustomerIds.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`flex justify-between items-center p-3 rounded-xl text-sm font-bold border transition-colors ${
                    customerBulkDeleteMode && isSelected
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  } text-slate-600`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {customerBulkDeleteMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleCustomerSelection(c.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate">{c.name}</span>
                      {(c.email || c.phone || c.contactName) && (
                        <span className="text-[10px] text-slate-400 font-normal truncate">
                          {[c.contactName, c.phone, c.email].filter(Boolean).join(' • ')}
                        </span>
                      )}
                      {(c.prepullRate || c.stopOffRate || c.yardStorageRate || c.chassisRate) && (
                        <span className="text-[9px] text-purple-500 font-medium mt-0.5">
                          {c.prepullRate && `Pre: $${c.prepullRate} `}
                          {c.stopOffRate && `Stop: $${c.stopOffRate} `}
                          {c.yardStorageRate && `Yard: $${c.yardStorageRate}/day `}
                          {c.chassisRate && `Chassis: $${c.chassisRate}/day`}
                          <span className="text-slate-400 ml-1">({c.rateCurrency || 'CAD'})</span>
                        </span>
                      )}
                    </div>
                  </div>
                  {!customerBulkDeleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEditModal(c)} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Customer"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDeleteCustomer && onDeleteCustomer(c.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Customer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
      {showCustomerBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!isCustomerBulkDeleting) {
                setShowCustomerBulkDeleteConfirm(false);
                setCustomerBulkDeleteStep(1);
              }
            }}
          ></div>
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {customerBulkDeleteStep === 1 ? (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Delete {selectedCustomerIds.length} Customer{selectedCustomerIds.length !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    You are about to delete <strong className="text-red-600">{selectedCustomerIds.length}</strong> customer{selectedCustomerIds.length !== 1 ? 's' : ''}. This action cannot be undone.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => { setShowCustomerBulkDeleteConfirm(false); setCustomerBulkDeleteStep(1); }}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={() => setCustomerBulkDeleteStep(2)}
                    className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will permanently remove <strong>{selectedCustomerIds.length}</strong> customer{selectedCustomerIds.length !== 1 ? 's' : ''} from the system.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => setCustomerBulkDeleteStep(1)}
                    disabled={isCustomerBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={performCustomerBulkDelete}
                    disabled={isCustomerBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCustomerBulkDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete Forever
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
})()}

            {activeDatabaseTab === 'locations' && (() => {
  // Filter locations by search term
  const filteredLocations = (savedDestinations || []).filter(loc => {
    if (!locationSearchTerm.trim()) return true;
    const term = locationSearchTerm.toLowerCase().trim();
    return (
      (loc.name || '').toLowerCase().includes(term) ||
      (loc.address || '').toLowerCase().includes(term) ||
      (loc.city || '').toLowerCase().includes(term) ||
      (loc.province || '').toLowerCase().includes(term) ||
      (loc.postalCode || '').toLowerCase().includes(term)
    );
  });

  const toggleLocationSelection = (id) => {
    setSelectedLocationIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    const allIds = filteredLocations.map(l => l.id);
    setSelectedLocationIds(allIds);
  };

  const deselectAll = () => {
    setSelectedLocationIds([]);
  };

    const performBulkDelete = async () => {
    if (selectedLocationIds.length === 0) return;
    setIsBulkDeleting(true);
    const { successCount, failCount } = await batchDeleteDocuments('locations', selectedLocationIds);
    setIsBulkDeleting(false);
    setSelectedLocationIds([]);
    setBulkDeleteMode(false);
    setShowBulkDeleteConfirm(false);
    setBulkDeleteStep(1);
    setFeedback(failCount === 0
      ? `✅ Deleted ${successCount} location${successCount !== 1 ? 's' : ''}`
      : `⚠️ Deleted ${successCount}, failed ${failCount}`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* ===== LEFT: Add Location ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <MapPin className="text-red-600 w-5 h-5" /> Add Location
          </h3>
          <button
            onClick={() => document.getElementById('locationExcelUpload').click()}
            className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Upload Excel
          </button>
          <input
            type="file"
            id="locationExcelUpload"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (onImportLocations) {
                onImportLocations(file);
              } else {
                console.error("onImportLocations is not defined");
                setFeedback("❌ Import function not available");
              }
              e.target.value = '';
            }}
          />
        </div>
        <p className="text-[10px] text-slate-400 mb-4 -mt-2">
          Upload an Excel/CSV file with "Name" and "Full address" columns
        </p>
        <form onSubmit={onAddLocation} className="space-y-3">
          <input required className="w-full p-3 border rounded-xl text-sm font-bold" placeholder="Location Name*" value={newLoc.name} onChange={e => setNewLoc({...newLoc, name: e.target.value})} />
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Address*" value={newLoc.address} onChange={e => setNewLoc({...newLoc, address: e.target.value})} />
          <button type="submit" className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-red-700 transition-colors">Save Location</button>
        </form>
      </div>

      {/* ===== RIGHT: Location List with Search + Bulk Delete ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <MapPin className="text-red-600 w-5 h-5" /> Location List
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({filteredLocations.length}{locationSearchTerm && ` of ${savedDestinations.length}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {!bulkDeleteMode ? (
              <button
                onClick={() => {
                  setBulkDeleteMode(true);
                  setSelectedLocationIds([]);
                }}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Select & Delete
              </button>
            ) : (
              <button
                onClick={() => {
                  setBulkDeleteMode(false);
                  setSelectedLocationIds([]);
                }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={locationSearchTerm}
            onChange={(e) => setLocationSearchTerm(e.target.value)}
            placeholder="Search by name, address, city, or postal code..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
          />
          {locationSearchTerm && (
            <button
              onClick={() => setLocationSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ===== BULK DELETE ACTION BAR ===== */}
        {bulkDeleteMode && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-red-700 uppercase">
                {selectedLocationIds.length} selected
              </span>
              <button
                onClick={selectAllFiltered}
                className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
              >
                Select All ({filteredLocations.length})
              </button>
              {selectedLocationIds.length > 0 && (
                <button
                  onClick={deselectAll}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                >
                  Deselect All
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedLocationIds.length === 0) {
                  setFeedback("⚠️ No locations selected");
                  return;
                }
                setBulkDeleteStep(1);
                setShowBulkDeleteConfirm(true);
              }}
              disabled={selectedLocationIds.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedLocationIds.length})
            </button>
          </div>
        )}

        {/* ===== LOCATION LIST ===== */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {filteredLocations.length === 0 ? (
            <div className="text-center py-8 text-slate-400 font-bold italic text-sm">
              {locationSearchTerm ? `No locations match "${locationSearchTerm}"` : 'No locations saved yet'}
            </div>
          ) : (
            filteredLocations.map((d) => {
              const isSelected = selectedLocationIds.includes(d.id);
              return (
                <div
                  key={d.id}
                  className={`flex justify-between items-center p-3 rounded-xl text-sm font-bold border transition-colors ${
                    bulkDeleteMode && isSelected
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  } text-slate-600`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {bulkDeleteMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleLocationSelection(d.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate">{d.name}</span>
                      {d.address && (
                        <span className="text-[10px] text-slate-400 font-normal truncate">{d.address}</span>
                      )}
                      {d.city && d.province && (
                        <span className="text-[9px] text-slate-400 font-normal">{d.city}, {d.province} {d.postalCode || ''}</span>
                      )}
                    </div>
                  </div>
                  {!bulkDeleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openLocationEditModal(d)} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Location"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDeleteLocation && onDeleteLocation(d.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Location"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!isBulkDeleting) {
                setShowBulkDeleteConfirm(false);
                setBulkDeleteStep(1);
              }
            }}
          ></div>
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {bulkDeleteStep === 1 ? (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Delete {selectedLocationIds.length} Location{selectedLocationIds.length !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    You are about to delete <strong className="text-red-600">{selectedLocationIds.length}</strong> location{selectedLocationIds.length !== 1 ? 's' : ''}. This action cannot be undone.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => { setShowBulkDeleteConfirm(false); setBulkDeleteStep(1); }}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={() => setBulkDeleteStep(2)}
                    className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will permanently remove <strong>{selectedLocationIds.length}</strong> location{selectedLocationIds.length !== 1 ? 's' : ''} from the system.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => setBulkDeleteStep(1)}
                    disabled={isBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={performBulkDelete}
                    disabled={isBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isBulkDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete Forever
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
})()}

      {activeDatabaseTab === 'drivers' && (() => {
  // Filter drivers by search term
  const filteredDrivers = (savedDrivers || []).filter(d => {
    if (!driverSearchTerm.trim()) return true;
    const term = driverSearchTerm.toLowerCase().trim();
    return (
      (d.name || '').toLowerCase().includes(term) ||
      (d.truckNo || '').toLowerCase().includes(term) ||
      (d.type || '').toLowerCase().includes(term) ||
      (d.payType || '').toLowerCase().includes(term) ||
      (d.email || '').toLowerCase().includes(term)
    );
  });

  const toggleDriverSelection = (id) => {
    setSelectedDriverIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFilteredDrivers = () => {
    setSelectedDriverIds(filteredDrivers.map(d => d.id));
  };

  const deselectAllDrivers = () => {
    setSelectedDriverIds([]);
  };

    const performDriverBulkDelete = async () => {
    if (selectedDriverIds.length === 0) return;
    setIsDriverBulkDeleting(true);
    const { successCount, failCount } = await batchDeleteDocuments('drivers', selectedDriverIds);
    setIsDriverBulkDeleting(false);
    setSelectedDriverIds([]);
    setDriverBulkDeleteMode(false);
    setShowDriverBulkDeleteConfirm(false);
    setDriverBulkDeleteStep(1);
    setFeedback(failCount === 0
      ? `✅ Deleted ${successCount} driver${successCount !== 1 ? 's' : ''}`
      : `⚠️ Deleted ${successCount}, failed ${failCount}`
    );
  };

  const getDriverBadge = (type) => {
    switch(type) {
      case 'Owner Operator': return 'bg-purple-100 text-purple-700';
      case 'Company Driver': return 'bg-blue-100 text-blue-700';
      case 'Third-Party Driver': return 'bg-orange-100 text-orange-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };
  const getPayTypeLabel = (type) => {
    switch(type) {
      case 'hourly': return '⏱️/hr';
      case 'mileage': return '📏/km';
      default: return '💰/leg';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* ===== LEFT: Add Driver ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700">
          <Truck className="text-orange-600 w-5 h-5" /> Add Driver
        </h3>
                <form onSubmit={onAddDriver} className="space-y-3">
          <input required className="w-full p-3 border rounded-xl text-sm font-bold" placeholder="Driver / Company Name*" value={newDriver.name} onChange={e => setNewDriver({...newDriver, name: e.target.value})} />
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Truck Number (Optional)" value={newDriver.truckNo} onChange={e => setNewDriver({...newDriver, truckNo: e.target.value})} />
          
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Driver / Vendor Type</label>
            <select className="w-full p-3 border rounded-xl text-sm bg-white" value={newDriver.type || 'Company Driver'} onChange={e => {
              const newType = e.target.value;
              setNewDriver({...newDriver, type: newType, payType: newType === 'Owner Operator' ? 'flat' : 'hourly'});
            }}>
              <option value="Company Driver">🏢 Company Driver (Paid per hour/mile)</option>
              <option value="Owner Operator">💰 Owner Operator (Paid per leg)</option>
              <option value="Third-Party Driver">🔄 Third-Party Logistics (No Rates)</option>
            </select>
          </div>

          {/* ✅ ONLY SHOW THESE FOR COMPANY / OWNER OPERATOR */}
          {newDriver.type !== 'Third-Party Driver' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase">Pay Type</label>
                  <select className="w-full p-3 border rounded-xl text-sm bg-white" value={newDriver.payType || 'flat'} onChange={e => setNewDriver({...newDriver, payType: e.target.value})}>
                    <option value="flat">💰 Per Leg</option>
                    <option value="hourly">⏱️ Per Hour</option>
                    <option value="mileage">📏 Per Mile</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase">Pay Rate ($)</label>
                  <input type="number" step="0.01" className="w-full p-3 border rounded-xl text-sm font-bold" placeholder="0.00" value={newDriver.payRate || ''} onChange={e => setNewDriver({...newDriver, payRate: parseFloat(e.target.value) || 0})} />
                </div>
              </div>
              {newDriver.type === 'Company Driver' && (
                <input type="number" step="0.1" className="w-full p-3 border rounded-xl text-sm" placeholder="⛽ Fuel Efficiency (km/L)" value={newDriver.fuelEfficiency || ''} onChange={e => setNewDriver({...newDriver, fuelEfficiency: parseFloat(e.target.value) || null})} />
              )}
            </>
          )}

          {/* ✅ APP LOGIN IS ALWAYS OPTIONAL */}
          <div className="bg-slate-100 p-3 rounded-xl border border-slate-200">
            <p className="text-[10px] font-black text-slate-500 uppercase mb-2">App Login (Optional)</p>
            <input type="email" className="w-full p-3 border rounded-xl text-sm mb-2" placeholder="Email (Leave blank if no login)" value={newDriver.email || ''} onChange={e => setNewDriver({...newDriver, email: e.target.value})} />
            <input type="password" className="w-full p-3 border rounded-xl text-sm" placeholder="Password (min 6 chars)" value={newDriver.password || ''} onChange={e => setNewDriver({...newDriver, password: e.target.value})} />
          </div>

          <button type="submit" className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-orange-700 transition-colors">Save Driver</button>
        </form>
      </div>

      {/* ===== RIGHT: Driver List with Search + Bulk Delete ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <Truck className="text-orange-600 w-5 h-5" /> Driver List
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({filteredDrivers.length}{driverSearchTerm && ` of ${savedDrivers.length}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {!driverBulkDeleteMode ? (
              <button
                onClick={() => {
                  setDriverBulkDeleteMode(true);
                  setSelectedDriverIds([]);
                }}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Select & Delete
              </button>
            ) : (
              <button
                onClick={() => {
                  setDriverBulkDeleteMode(false);
                  setSelectedDriverIds([]);
                }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={driverSearchTerm}
            onChange={(e) => setDriverSearchTerm(e.target.value)}
            placeholder="Search by name, truck number, type, email..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
          />
          {driverSearchTerm && (
            <button
              onClick={() => setDriverSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-orange-600 rounded-md hover:bg-orange-50"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ===== BULK DELETE ACTION BAR ===== */}
        {driverBulkDeleteMode && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-red-700 uppercase">
                {selectedDriverIds.length} selected
              </span>
              <button
                onClick={selectAllFilteredDrivers}
                className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
              >
                Select All ({filteredDrivers.length})
              </button>
              {selectedDriverIds.length > 0 && (
                <button
                  onClick={deselectAllDrivers}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                >
                  Deselect All
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedDriverIds.length === 0) {
                  setFeedback("⚠️ No drivers selected");
                  return;
                }
                setDriverBulkDeleteStep(1);
                setShowDriverBulkDeleteConfirm(true);
              }}
              disabled={selectedDriverIds.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedDriverIds.length})
            </button>
          </div>
        )}

        {/* ===== DRIVER LIST ===== */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {filteredDrivers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 font-bold italic text-sm">
              {driverSearchTerm ? `No drivers match "${driverSearchTerm}"` : 'No drivers saved yet'}
            </div>
          ) : (
            filteredDrivers.map((d) => {
              const isSelected = selectedDriverIds.includes(d.id);
              return (
                <div
                  key={d.id}
                  className={`flex justify-between items-center p-3 rounded-xl text-sm font-bold border transition-colors ${
                    driverBulkDeleteMode && isSelected
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  } text-slate-600`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {driverBulkDeleteMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleDriverSelection(d.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate">{d.name}</span>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getDriverBadge(d.type)}`}>
                          {d.type || 'Company Driver'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-600">
                          {getPayTypeLabel(d.payType)} ${d.payRate || 0}
                        </span>
                        {d.truckNo && (
                          <span className="text-[10px] font-bold text-slate-500">🚛 {d.truckNo}</span>
                        )}
                        {d.type === 'Company Driver' && d.fuelEfficiency && (
                          <span className="text-[9px] text-blue-500">⛽ {d.fuelEfficiency} km/L</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!driverBulkDeleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openDriverEditModal(d)} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Driver"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDeleteDriver && onDeleteDriver(d.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Driver"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
      {showDriverBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!isDriverBulkDeleting) {
                setShowDriverBulkDeleteConfirm(false);
                setDriverBulkDeleteStep(1);
              }
            }}
          ></div>
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {driverBulkDeleteStep === 1 ? (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Delete {selectedDriverIds.length} Driver{selectedDriverIds.length !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    You are about to delete <strong className="text-red-600">{selectedDriverIds.length}</strong> driver{selectedDriverIds.length !== 1 ? 's' : ''}. This action cannot be undone.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => { setShowDriverBulkDeleteConfirm(false); setDriverBulkDeleteStep(1); }}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={() => setDriverBulkDeleteStep(2)}
                    className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will permanently remove <strong>{selectedDriverIds.length}</strong> driver{selectedDriverIds.length !== 1 ? 's' : ''} from the system.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => setDriverBulkDeleteStep(1)}
                    disabled={isDriverBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={performDriverBulkDelete}
                    disabled={isDriverBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isDriverBulkDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete Forever
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
})()}

      {activeDatabaseTab === 'terminals' && (() => {
  // Filter terminals by search term
  const filteredTerminals = (savedTerminals || []).filter(t => {
    if (!terminalSearchTerm.trim()) return true;
    const term = terminalSearchTerm.toLowerCase().trim();
    return (
      (t.name || '').toLowerCase().includes(term) ||
      (t.address || '').toLowerCase().includes(term) ||
      (t.city || '').toLowerCase().includes(term) ||
      (t.province || '').toLowerCase().includes(term) ||
      (t.code || '').toLowerCase().includes(term) ||
      (t.phone || '').toLowerCase().includes(term) ||
      (t.email || '').toLowerCase().includes(term)
    );
  });

  const toggleTerminalSelection = (id) => {
    setSelectedTerminalIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFilteredTerminals = () => {
    setSelectedTerminalIds(filteredTerminals.map(t => t.id));
  };

  const deselectAllTerminals = () => {
    setSelectedTerminalIds([]);
  };

    const performTerminalBulkDelete = async () => {
    if (selectedTerminalIds.length === 0) return;
    setIsTerminalBulkDeleting(true);
    const { successCount, failCount } = await batchDeleteDocuments('terminals', selectedTerminalIds);
    setIsTerminalBulkDeleting(false);
    setSelectedTerminalIds([]);
    setTerminalBulkDeleteMode(false);
    setShowTerminalBulkDeleteConfirm(false);
    setTerminalBulkDeleteStep(1);
    setFeedback(failCount === 0
      ? `✅ Deleted ${successCount} terminal${successCount !== 1 ? 's' : ''}`
      : `⚠️ Deleted ${successCount}, failed ${failCount}`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* ===== LEFT: Add Terminal ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700">
          <Anchor className="text-teal-600 w-5 h-5" /> Add Terminal
        </h3>
        <form onSubmit={onAddTerminal} className="space-y-3">
          <input required className="w-full p-3 border rounded-xl text-sm font-bold" placeholder="Terminal Name*" value={newTerminal?.name || ''} onChange={e => setNewTerminal({...newTerminal, name: e.target.value})} />
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Terminal Code (e.g., VAN01, TOR02)" value={newTerminal?.code || ''} onChange={e => setNewTerminal({...newTerminal, code: e.target.value.toUpperCase()})} />
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Address*" value={newTerminal?.address || ''} onChange={e => setNewTerminal({...newTerminal, address: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="City" value={newTerminal?.city || ''} onChange={e => setNewTerminal({...newTerminal, city: e.target.value})} />
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Province" value={newTerminal?.province || ''} onChange={e => setNewTerminal({...newTerminal, province: e.target.value})} />
          </div>
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Postal Code" value={newTerminal?.postalCode || ''} onChange={e => setNewTerminal({...newTerminal, postalCode: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Phone" value={newTerminal?.phone || ''} onChange={e => setNewTerminal({...newTerminal, phone: e.target.value})} />
            <input className="w-full p-3 border rounded-xl text-sm" placeholder="Email" value={newTerminal?.email || ''} onChange={e => setNewTerminal({...newTerminal, email: e.target.value})} />
          </div>
          <input className="w-full p-3 border rounded-xl text-sm" placeholder="Contact Name" value={newTerminal?.contactName || ''} onChange={e => setNewTerminal({...newTerminal, contactName: e.target.value})} />
          <button type="submit" className="w-full py-3 bg-teal-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-teal-700 transition-colors">Save Terminal</button>
        </form>
      </div>

      {/* ===== RIGHT: Terminal List with Search + Bulk Delete ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <Anchor className="text-teal-600 w-5 h-5" /> Terminal List
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({filteredTerminals.length}{terminalSearchTerm && ` of ${savedTerminals?.length || 0}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {!terminalBulkDeleteMode ? (
              <button
                onClick={() => {
                  setTerminalBulkDeleteMode(true);
                  setSelectedTerminalIds([]);
                }}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Select & Delete
              </button>
            ) : (
              <button
                onClick={() => {
                  setTerminalBulkDeleteMode(false);
                  setSelectedTerminalIds([]);
                }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={terminalSearchTerm}
            onChange={(e) => setTerminalSearchTerm(e.target.value)}
            placeholder="Search by name, code, address, city..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
          />
          {terminalSearchTerm && (
            <button
              onClick={() => setTerminalSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-teal-600 rounded-md hover:bg-teal-50"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ===== BULK DELETE ACTION BAR ===== */}
        {terminalBulkDeleteMode && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-red-700 uppercase">
                {selectedTerminalIds.length} selected
              </span>
              <button
                onClick={selectAllFilteredTerminals}
                className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
              >
                Select All ({filteredTerminals.length})
              </button>
              {selectedTerminalIds.length > 0 && (
                <button
                  onClick={deselectAllTerminals}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                >
                  Deselect All
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedTerminalIds.length === 0) {
                  setFeedback("⚠️ No terminals selected");
                  return;
                }
                setTerminalBulkDeleteStep(1);
                setShowTerminalBulkDeleteConfirm(true);
              }}
              disabled={selectedTerminalIds.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedTerminalIds.length})
            </button>
          </div>
        )}

        {/* ===== TERMINAL LIST ===== */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {filteredTerminals.length === 0 ? (
            <div className="text-center py-8 text-slate-400 font-bold italic text-sm">
              {terminalSearchTerm ? `No terminals match "${terminalSearchTerm}"` : 'No terminals saved yet'}
            </div>
          ) : (
            filteredTerminals.map((t) => {
              const isSelected = selectedTerminalIds.includes(t.id);
              return (
                <div
                  key={t.id}
                  className={`flex justify-between items-center p-3 rounded-xl text-sm font-bold border transition-colors ${
                    terminalBulkDeleteMode && isSelected
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  } text-slate-600`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {terminalBulkDeleteMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTerminalSelection(t.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{t.name}</span>
                        {t.code && (
                          <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                            {t.code}
                          </span>
                        )}
                      </div>
                      {t.address && (
                        <span className="text-[10px] text-slate-400 font-normal truncate">{t.address}</span>
                      )}
                      {t.city && t.province && (
                        <span className="text-[9px] text-slate-400 font-normal">{t.city}, {t.province} {t.postalCode || ''}</span>
                      )}
                      {(t.phone || t.email) && (
                        <span className="text-[9px] text-slate-400 font-normal">
                          {t.phone && `📞 ${t.phone}`} {t.email && `✉️ ${t.email}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {!terminalBulkDeleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openTerminalEditModal(t)} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Terminal"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDeleteTerminal && onDeleteTerminal(t.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Terminal"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
      {showTerminalBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!isTerminalBulkDeleting) {
                setShowTerminalBulkDeleteConfirm(false);
                setTerminalBulkDeleteStep(1);
              }
            }}
          ></div>
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {terminalBulkDeleteStep === 1 ? (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Delete {selectedTerminalIds.length} Terminal{selectedTerminalIds.length !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    You are about to delete <strong className="text-red-600">{selectedTerminalIds.length}</strong> terminal{selectedTerminalIds.length !== 1 ? 's' : ''}. This action cannot be undone.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => { setShowTerminalBulkDeleteConfirm(false); setTerminalBulkDeleteStep(1); }}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={() => setTerminalBulkDeleteStep(2)}
                    className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will permanently remove <strong>{selectedTerminalIds.length}</strong> terminal{selectedTerminalIds.length !== 1 ? 's' : ''} from the system.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => setTerminalBulkDeleteStep(1)}
                    disabled={isTerminalBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={performTerminalBulkDelete}
                    disabled={isTerminalBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isTerminalBulkDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete Forever
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
})()}

      {activeDatabaseTab === 'chassis' && (
        <ChassisModule
          companyId={companyId}
          setFeedback={setFeedback}
          isAdmin={isAdmin}
          isDispatcher={isDispatcher}
        />
      )}

      {activeDatabaseTab === 'trucks' && (
        <TrucksModule
          companyId={companyId}
          setFeedback={setFeedback}
          isAdmin={isAdmin}
          isDispatcher={isDispatcher}
        />
      )}

      {/* ===== BASE PRICES TAB ===== */}
{activeDatabaseTab === 'basePrices' && (() => {
  // Filter base prices by search term
  const filteredBasePrices = (savedBasePrices || []).filter(bp => {
    if (!basePriceSearchTerm.trim()) return true;
    const term = basePriceSearchTerm.toLowerCase().trim();
    return (
      (bp.location || '').toLowerCase().includes(term) ||
      (bp.description || '').toLowerCase().includes(term) ||
      (bp.currency || '').toLowerCase().includes(term)
    );
  });

  // Sort alphabetically
  const sortedBasePrices = [...filteredBasePrices].sort((a, b) =>
    (a.location || '').localeCompare(b.location || '')
  );

  const toggleBasePriceSelection = (id) => {
    setSelectedBasePriceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFilteredBasePrices = () => {
    setSelectedBasePriceIds(sortedBasePrices.map(bp => bp.id));
  };

  const deselectAllBasePrices = () => {
    setSelectedBasePriceIds([]);
  };

    const performBasePriceBulkDelete = async () => {
    if (selectedBasePriceIds.length === 0) return;
    setIsBasePriceBulkDeleting(true);
    const { successCount, failCount } = await batchDeleteDocuments('basePrices', selectedBasePriceIds);
    setIsBasePriceBulkDeleting(false);
    setSelectedBasePriceIds([]);
    setBasePriceBulkDeleteMode(false);
    setShowBasePriceBulkDeleteConfirm(false);
    setBasePriceBulkDeleteStep(1);
    setFeedback(failCount === 0
      ? `✅ Deleted ${successCount} base price${successCount !== 1 ? 's' : ''}`
      : `⚠️ Deleted ${successCount}, failed ${failCount}`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* ===== LEFT: Add Base Price ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <DollarSign className="text-amber-600 w-5 h-5" /> Add Base Price
          </h3>
          <button
            onClick={() => document.getElementById('basePriceExcelUpload').click()}
            className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Upload Locations
          </button>
          <input
            type="file"
            id="basePriceExcelUpload"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (onImportBasePrices) {
                onImportBasePrices(file);
              } else {
                console.error("onImportBasePrices is not defined");
                setFeedback("❌ Import function not available");
              }
              e.target.value = '';
            }}
          />
        </div>
        <p className="text-[10px] text-slate-400 mb-4 -mt-2">
          Upload an Excel/CSV file with location names in the first column
        </p>
        <form onSubmit={(e) => { e.preventDefault(); onAddBasePrice && onAddBasePrice(e); }} className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Location Name *</label>
            <input
              required
              className="w-full p-3 border rounded-xl text-sm font-bold"
              placeholder="e.g., Calgary to Airdrie, Calgary to Balzac..."
              value={newBasePrice?.location || ''}
              onChange={e => setNewBasePrice && setNewBasePrice({...newBasePrice, location: e.target.value})}
            />
            <p className="text-[9px] text-slate-400 mt-1">Enter the route/location name (e.g., Calgary to Airdrie)</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Price (Optional)</label>
              <input
                type="number"
                step="0.01"
                className="w-full p-3 border rounded-xl text-sm font-bold"
                placeholder="0.00"
                value={newBasePrice?.price || ''}
                onChange={e => setNewBasePrice && setNewBasePrice({...newBasePrice, price: e.target.value})}
              />
              <p className="text-[9px] text-slate-400 mt-1">Leave blank to set later in load form</p>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Currency</label>
              <select
                className="w-full p-3 border rounded-xl text-sm bg-white"
                value={newBasePrice?.currency || 'CAD'}
                onChange={e => setNewBasePrice && setNewBasePrice({...newBasePrice, currency: e.target.value})}
              >
                <option value="CAD">🇨🇦 CAD</option>
                <option value="USD">🇺🇸 USD</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Description (Optional)</label>
            <input
              className="w-full p-3 border rounded-xl text-sm"
              placeholder="e.g., Flat rate for Calgary to Airdrie"
              value={newBasePrice?.description || ''}
              onChange={e => setNewBasePrice && setNewBasePrice({...newBasePrice, description: e.target.value})}
            />
          </div>
          <button type="submit" className="w-full py-3 bg-amber-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-amber-700 transition-colors">
            Save Location
          </button>
        </form>
      </div>

      {/* ===== RIGHT: Base Price List with Search + Bulk Delete ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2 text-slate-700">
            <DollarSign className="text-amber-600 w-5 h-5" /> Location List
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({sortedBasePrices.length}{basePriceSearchTerm && ` of ${savedBasePrices?.length || 0}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {!basePriceBulkDeleteMode ? (
              <button
                onClick={() => {
                  setBasePriceBulkDeleteMode(true);
                  setSelectedBasePriceIds([]);
                }}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Select & Delete
              </button>
            ) : (
              <button
                onClick={() => {
                  setBasePriceBulkDeleteMode(false);
                  setSelectedBasePriceIds([]);
                }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={basePriceSearchTerm}
            onChange={(e) => setBasePriceSearchTerm(e.target.value)}
            placeholder="Search by location or description..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
          />
          {basePriceSearchTerm && (
            <button
              onClick={() => setBasePriceSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-amber-600 rounded-md hover:bg-amber-50"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ===== BULK DELETE ACTION BAR ===== */}
        {basePriceBulkDeleteMode && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-red-700 uppercase">
                {selectedBasePriceIds.length} selected
              </span>
              <button
                onClick={selectAllFilteredBasePrices}
                className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
              >
                Select All ({sortedBasePrices.length})
              </button>
              {selectedBasePriceIds.length > 0 && (
                <button
                  onClick={deselectAllBasePrices}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                >
                  Deselect All
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedBasePriceIds.length === 0) {
                  setFeedback("⚠️ No base prices selected");
                  return;
                }
                setBasePriceBulkDeleteStep(1);
                setShowBasePriceBulkDeleteConfirm(true);
              }}
              disabled={selectedBasePriceIds.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedBasePriceIds.length})
            </button>
          </div>
        )}

        {/* ===== BASE PRICE LIST ===== */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {sortedBasePrices.length === 0 ? (
            <div className="text-center py-8 text-slate-400 font-bold italic text-sm">
              {basePriceSearchTerm
                ? `No locations match "${basePriceSearchTerm}"`
                : 'No locations saved yet. Upload an Excel file or add manually.'}
            </div>
          ) : (
            sortedBasePrices.map((bp) => {
              const currencySymbol = bp.currency === 'USD' ? 'US$' : 'C$';
              const hasPrice = bp.price && parseFloat(bp.price) > 0;
              const isSelected = selectedBasePriceIds.includes(bp.id);
              return (
                <div
                  key={bp.id}
                  className={`flex justify-between items-center p-3 rounded-xl text-sm font-bold border transition-colors ${
                    basePriceBulkDeleteMode && isSelected
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  } text-slate-600`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {basePriceBulkDeleteMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleBasePriceSelection(bp.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate font-bold text-slate-800">{bp.location}</span>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {hasPrice ? (
                          <span className="text-sm font-black text-green-600">{currencySymbol}{bp.price}</span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            ⚠️ Price not set
                          </span>
                        )}
                        {bp.description && (
                          <span className="text-[10px] text-slate-400 truncate">- {bp.description}</span>
                        )}
                        {bp.importedFromExcel && (
                          <span className="text-[9px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">📥 Imported</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!basePriceBulkDeleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          const newPrice = prompt(`Enter price for ${bp.location}:`, bp.price || '');
                          if (newPrice !== null) {
                            const priceValue = parseFloat(newPrice);
                            if (!isNaN(priceValue) && priceValue >= 0) {
                              const bpRef = doc(db, 'companies', companyId, 'basePrices', bp.id);
                              updateDoc(bpRef, {
                                price: priceValue,
                                updatedAt: new Date().toISOString()
                              }).then(() => {
                                setFeedback(`✅ Price updated for ${bp.location}`);
                              }).catch(err => {
                                console.error("Error updating price:", err);
                                setFeedback("❌ Failed to update price");
                              });
                            }
                          }
                        }}
                        className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit Price"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteBasePrice && onDeleteBasePrice(bp.id)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Location"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
      {showBasePriceBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!isBasePriceBulkDeleting) {
                setShowBasePriceBulkDeleteConfirm(false);
                setBasePriceBulkDeleteStep(1);
              }
            }}
          ></div>
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {basePriceBulkDeleteStep === 1 ? (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Delete {selectedBasePriceIds.length} Location{selectedBasePriceIds.length !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    You are about to delete <strong className="text-red-600">{selectedBasePriceIds.length}</strong> base price location{selectedBasePriceIds.length !== 1 ? 's' : ''}. This action cannot be undone.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => { setShowBasePriceBulkDeleteConfirm(false); setBasePriceBulkDeleteStep(1); }}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={() => setBasePriceBulkDeleteStep(2)}
                    className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will permanently remove <strong>{selectedBasePriceIds.length}</strong> base price location{selectedBasePriceIds.length !== 1 ? 's' : ''} from the system.
                  </p>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => setBasePriceBulkDeleteStep(1)}
                    disabled={isBasePriceBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <div className="w-px bg-slate-100"></div>
                  <button
                    onClick={performBasePriceBulkDelete}
                    disabled={isBasePriceBulkDeleting}
                    className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isBasePriceBulkDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete Forever
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
})()}

      {/* ===== EDIT MODALS ===== */}
      {showEditModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowEditModal(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-xl text-white"><Building className="w-5 h-5" /></div>
                <div><h2 className="font-black text-slate-900 text-lg">Edit Customer</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Update customer details and rates</p></div>
              </div>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Company Name *</label><input required className="w-full p-2 border rounded-lg text-sm font-bold" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Email</label><input type="email" className="w-full p-2 border rounded-lg text-sm" value={editFormData.email} onChange={e => setEditFormData({...editFormData, email: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Phone</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.phone} onChange={e => setEditFormData({...editFormData, phone: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Contact Name</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.contactName} onChange={e => setEditFormData({...editFormData, contactName: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3"><label className="text-[10px] font-black text-slate-500 uppercase">Address</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.address} onChange={e => setEditFormData({...editFormData, address: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">City</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.city} onChange={e => setEditFormData({...editFormData, city: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Postal Code</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.postalCode} onChange={e => setEditFormData({...editFormData, postalCode: e.target.value})} /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Division</label><input className="w-full p-2 border rounded-lg text-sm" value={editFormData.division} onChange={e => setEditFormData({...editFormData, division: e.target.value})} /></div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center gap-2 mb-3"><DollarSign className="w-4 h-4 text-purple-600" /><h4 className="font-black text-xs uppercase tracking-widest text-purple-900">Extra Charges Rates</h4></div>
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-[10px] font-black text-slate-500">Rate Currency:</label>
                  <select className="px-2 py-1 border rounded-lg text-xs font-bold bg-white" value={editFormData.rateCurrency || 'CAD'} onChange={e => setEditFormData({...editFormData, rateCurrency: e.target.value})}>
                    <option value="CAD">🇨🇦 CAD</option><option value="USD">🇺🇸 USD</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[9px] font-bold text-slate-400">Pre-Pull Rate</label><input type="number" step="0.01" className="w-full p-2 border rounded-lg text-sm font-bold" placeholder="e.g. 150" value={editFormData.prepullRate} onChange={e => setEditFormData({...editFormData, prepullRate: e.target.value})} /></div>
                  <div><label className="text-[9px] font-bold text-slate-400">Stop Off Rate</label><input type="number" step="0.01" className="w-full p-2 border rounded-lg text-sm font-bold" placeholder="e.g. 50" value={editFormData.stopOffRate} onChange={e => setEditFormData({...editFormData, stopOffRate: e.target.value})} /></div>
                  <div><label className="text-[9px] font-bold text-slate-400">Yard Storage ($/day)</label><input type="number" step="0.01" className="w-full p-2 border rounded-lg text-sm font-bold" placeholder="e.g. 25" value={editFormData.yardStorageRate} onChange={e => setEditFormData({...editFormData, yardStorageRate: e.target.value})} /></div>
                  <div><label className="text-[9px] font-bold text-slate-400">Chassis Rate ($/day)</label><input type="number" step="0.01" className="w-full p-2 border rounded-lg text-sm font-bold" placeholder="e.g. 65" value={editFormData.chassisRate} onChange={e => setEditFormData({...editFormData, chassisRate: e.target.value})} /></div>
                </div>
              </div>
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200">Update Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLocationEditModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowLocationEditModal(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-red-600 p-2 rounded-xl text-white"><MapPin className="w-5 h-5" /></div>
                <div><h2 className="font-black text-slate-900 text-lg">Edit Location</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Update location details</p></div>
              </div>
              <button onClick={() => setShowLocationEditModal(false)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleLocationEditSubmit} className="p-6 overflow-y-auto space-y-4">
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Location Name *</label><input required className="w-full p-3 border rounded-xl text-sm font-bold" value={locationEditFormData.name} onChange={e => setLocationEditFormData({...locationEditFormData, name: e.target.value})} placeholder="e.g., Calgary Terminal" /></div>
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Address</label><input className="w-full p-3 border rounded-xl text-sm" value={locationEditFormData.address} onChange={e => setLocationEditFormData({...locationEditFormData, address: e.target.value})} placeholder="Street address" /></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="text-[10px] font-black text-slate-500 uppercase">City</label><input className="w-full p-3 border rounded-xl text-sm" value={locationEditFormData.city} onChange={e => setLocationEditFormData({...locationEditFormData, city: e.target.value})} placeholder="City" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Province</label><input className="w-full p-3 border rounded-xl text-sm" value={locationEditFormData.province} onChange={e => setLocationEditFormData({...locationEditFormData, province: e.target.value})} placeholder="Province" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Postal Code</label><input className="w-full p-3 border rounded-xl text-sm" value={locationEditFormData.postalCode} onChange={e => setLocationEditFormData({...locationEditFormData, postalCode: e.target.value})} placeholder="Postal Code" /></div>
              </div>
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowLocationEditModal(false)} className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-[2] py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200">Update Location</button>
              </div>
            </form>
          </div>
        </div>
      )}

            {showDriverEditModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowDriverEditModal(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-orange-600 p-2 rounded-xl text-white"><Truck className="w-5 h-5" /></div>
                <div><h2 className="font-black text-slate-900 text-lg">Edit Driver</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Update driver details</p></div>
              </div>
              <button onClick={() => setShowDriverEditModal(false)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleDriverEditSubmit} className="p-6 overflow-y-auto space-y-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Driver / Company Name *</label><input required className="w-full p-3 border rounded-xl text-sm font-bold" value={driverEditFormData.name} onChange={e => setDriverEditFormData({...driverEditFormData, name: e.target.value})} placeholder="Driver name" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Truck Number</label><input className="w-full p-3 border rounded-xl text-sm" value={driverEditFormData.truckNo} onChange={e => setDriverEditFormData({...driverEditFormData, truckNo: e.target.value})} placeholder="e.g., TRK-123" /></div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Driver Type</label>
                <select className="w-full p-3 border rounded-xl text-sm bg-white" value={driverEditFormData.type || 'Company Driver'} onChange={e => {
                  const newType = e.target.value;
                  setDriverEditFormData({...driverEditFormData, type: newType, payType: newType === 'Owner Operator' ? 'flat' : 'hourly'});
                }}>
                  <option value="Company Driver">🏢 Company Driver</option>
                  <option value="Owner Operator">💰 Owner Operator</option>
                  <option value="Third-Party Driver">🔄 Third-Party Driver (No Rates)</option>
                </select>
              </div>

              {/* ✅ HIDE PAY RATES FOR THIRD PARTY */}
              {driverEditFormData.type !== 'Third-Party Driver' && (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] font-black text-slate-500 uppercase">Pay Rate ($)</label><input type="number" step="0.01" className="w-full p-3 border rounded-xl text-sm font-bold" value={driverEditFormData.payRate || ''} onChange={e => setDriverEditFormData({...driverEditFormData, payRate: parseFloat(e.target.value) || 0})} placeholder="0.00" /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase">Pay Type</label>
                    <select className="w-full p-3 border rounded-xl text-sm bg-white" value={driverEditFormData.payType || 'flat'} onChange={e => setDriverEditFormData({...driverEditFormData, payType: e.target.value})}>
                      <option value="flat">💰 Per Leg</option>
                      <option value="hourly">⏱️ Per Hour</option>
                      <option value="mileage">📏 Per Mile</option>
                    </select>
                  </div>
                </div>
              )}

              {driverEditFormData.type === 'Company Driver' && (
                <div><label className="text-[10px] font-black text-slate-500 uppercase">⛽ Fuel Efficiency (km/L)</label>
                  <input type="number" step="0.1" className="w-full p-3 border rounded-xl text-sm" placeholder="e.g., 2.0 km/L" value={driverEditFormData.fuelEfficiency || ''} onChange={e => setDriverEditFormData({...driverEditFormData, fuelEfficiency: parseFloat(e.target.value) || null})} />
                </div>
              )}

              {/* APP LOGIN (OPTIONAL) */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">App Login (Optional)</p>
                <div className="space-y-3">
                  <div><label className="text-[10px] font-bold text-slate-400">Email (for app login)</label>
                    <input type="email" className="w-full p-3 border rounded-xl text-sm" value={driverEditFormData.email || ''} onChange={e => setDriverEditFormData({...driverEditFormData, email: e.target.value})} placeholder="driver@company.com" />
                  </div>
                  <div><label className="text-[10px] font-bold text-slate-400">New Password (optional)</label>
                    <input type="password" className="w-full p-3 border rounded-xl text-sm" value={driverEditFormData.password || ''} onChange={e => setDriverEditFormData({...driverEditFormData, password: e.target.value})} placeholder="Leave blank to keep current" minLength={6} />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowDriverEditModal(false)} className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-[2] py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-200">Update Driver</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTerminalEditModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowTerminalEditModal(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-teal-600 p-2 rounded-xl text-white"><Anchor className="w-5 h-5" /></div>
                <div><h2 className="font-black text-slate-900 text-lg">Edit Terminal</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Update terminal details</p></div>
              </div>
              <button onClick={() => setShowTerminalEditModal(false)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleTerminalEditSubmit} className="p-6 overflow-y-auto space-y-4">
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Terminal Name *</label><input required className="w-full p-3 border rounded-xl text-sm font-bold" value={terminalEditFormData.name} onChange={e => setTerminalEditFormData({...terminalEditFormData, name: e.target.value})} placeholder="e.g., Vanterm Terminal" /></div>
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Terminal Code</label><input className="w-full p-3 border rounded-xl text-sm font-bold" value={terminalEditFormData.code || ''} onChange={e => setTerminalEditFormData({...terminalEditFormData, code: e.target.value.toUpperCase()})} placeholder="e.g., VAN01" /></div>
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Address</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.address} onChange={e => setTerminalEditFormData({...terminalEditFormData, address: e.target.value})} placeholder="Street address" /></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="text-[10px] font-black text-slate-500 uppercase">City</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.city} onChange={e => setTerminalEditFormData({...terminalEditFormData, city: e.target.value})} placeholder="City" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Province</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.province} onChange={e => setTerminalEditFormData({...terminalEditFormData, province: e.target.value})} placeholder="Province" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Postal Code</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.postalCode} onChange={e => setTerminalEditFormData({...terminalEditFormData, postalCode: e.target.value})} placeholder="Postal Code" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Phone</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.phone || ''} onChange={e => setTerminalEditFormData({...terminalEditFormData, phone: e.target.value})} placeholder="Phone number" /></div>
                <div><label className="text-[10px] font-black text-slate-500 uppercase">Email</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.email || ''} onChange={e => setTerminalEditFormData({...terminalEditFormData, email: e.target.value})} placeholder="Email" /></div>
              </div>
              <div><label className="text-[10px] font-black text-slate-500 uppercase">Contact Name</label><input className="w-full p-3 border rounded-xl text-sm" value={terminalEditFormData.contactName || ''} onChange={e => setTerminalEditFormData({...terminalEditFormData, contactName: e.target.value})} placeholder="Contact person" /></div>
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowTerminalEditModal(false)} className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-[2] py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition-colors shadow-lg shadow-teal-200">Update Terminal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};



// ========== OTHER COMPONENTS ==========
const AssignmentView = ({ loads, assignmentDate, setAssignmentDate, assignmentSlots, onEdit }) => (
  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
    <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Assignment Schedule</h2>
        <p className="text-slate-400 font-bold text-sm">Review delivery timeline date-wise</p>
      </div>
      <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-2xl border border-slate-100 w-full sm:w-auto">
        <CalendarDays className="w-5 h-5 text-blue-600 ml-2" />
        <input type="date" className="bg-transparent font-black text-slate-800 outline-none w-full sm:w-auto" value={assignmentDate} onChange={(e) => setAssignmentDate && setAssignmentDate(e.target.value)} />
      </div>
    </div>
    <div className="space-y-12 pb-20 relative">
      <div className="absolute left-[70px] top-0 bottom-0 w-px bg-slate-200 border-dashed border-l hidden md:block"></div>
      {(assignmentSlots || []).map((slot) => (
        <div key={slot.id} className="relative z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 group">
            <div className="w-full md:w-[140px] md:text-center">
              <span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[11px] font-black tracking-tight border border-blue-100 whitespace-nowrap">{slot.label}</span>
            </div>
            <div className="hidden md:block flex-1 h-px bg-slate-200 border-dashed border-b"></div>
          </div>
          <div className="md:ml-[140px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {!slot.items || slot.items.length === 0 ? (
              <div className="col-span-full py-4 text-slate-300 font-bold italic text-sm">No assignments scheduled for this window.</div>
            ) : slot.items.map((item) => (
              <div
                key={item.id}
                className="bg-white border border-slate-200 p-6 rounded-[28px] shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 group cursor-pointer"
                onClick={() => {
                  if (onEdit) {
                    const fullLoad = loads.find(l => l.id === item.id);
                    if (fullLoad) {
                      onEdit(fullLoad);
                    }
                  }
                }}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-blue-50 text-blue-600 p-2 rounded-xl">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Appointment</div>
                    <div className="text-sm font-black text-slate-900">{item.appointmentTime || 'N/A'}</div>
                  </div>
                </div>
                <div className="mb-2 flex items-center gap-2">
                  {item.loadType === 'LIVE' ? (
                    <span className="text-[10px] font-black text-blue-600 bg-blue-100 px-2.5 py-0.5 rounded flex items-center gap-1">
                      <Clock className="w-3 h-3" /> LIVE LOAD
                    </span>
                  ) : item.loadType === 'DROP' ? (
                    <span className="text-[10px] font-black text-green-600 bg-green-100 px-2.5 py-0.5 rounded flex items-center gap-1">
                      <Package className="w-3 h-3" /> DROP LOAD
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2.5 py-0.5 rounded flex items-center gap-1">
                      ⚠️ MISSING
                    </span>
                  )}
                </div>
                <div className="mb-4">
                  <div className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                    {item.containerNo || 'N/A'}
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{item.size || 'N/A'}</span>
                  </div>
                  <div className="text-sm font-bold text-blue-600 mt-1">{item.customerName || 'N/A'}</div>
                </div>
                <div className="space-y-3 pt-4 border-t border-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <span className="text-xs font-bold text-slate-500 truncate">{item.legs?.[0]?.to?.split(' - ')[0] || "No Location Assigned"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                      <Truck className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">{item.legs?.[0]?.driverName || "Driver TBD"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const DailySummary = ({ loads }) => {
  const [showPendingModal, setShowPendingModal] = useState(false);
  const safeLoads = Array.isArray(loads) ? loads : [];
  const today = new Date().toISOString().split('T')[0];
  const loadsToday = safeLoads.filter(l => l?.appointmentDate === today);
  const workToday = loadsToday.length;
  
  const activeTrucks = new Set();
  loadsToday.forEach(l => { (l.legs || []).forEach(leg => { if (leg?.truckNo) activeTrucks.add(leg.truckNo); }); });
  const numActiveTrucks = activeTrucks.size;
  
  const needToBill = safeLoads.filter(l => { const legs = getSafeLegs(l); return l.status === 'Open' && legs.length > 0 && legs.every(leg => leg.status === 'Completed'); }).length;
  const pendingTerminationLoads = safeLoads.filter(l => { if(l.status !== 'Open') return false; const legs = getSafeLegs(l); const hasCompleted = legs.some(leg => leg.status === 'Completed'); const hasPending = legs.some(leg => leg.status !== 'Completed'); return hasCompleted && hasPending; });
  const needToTerminate = pendingTerminationLoads.length;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 animate-in fade-in">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
            <Package className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Loads Today</div>
            <div className="text-3xl font-black text-slate-900 leading-none">{workToday}</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Truck className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Active Trucks</div>
            <div className="text-3xl font-black text-slate-900 leading-none">{numActiveTrucks}</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Receipt className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Need to Bill</div>
            <div className="text-3xl font-black text-slate-900 leading-none">{needToBill}</div>
          </div>
        </div>

        <div onClick={() => setShowPendingModal(true)} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md hover:border-rose-300 transition-all cursor-pointer group">
          <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0 group-hover:bg-rose-100 transition-colors">
            <Anchor className="w-6 h-6 text-rose-600" />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Pending Terminations</div>
            <div className="text-3xl font-black text-slate-900 leading-none">{needToTerminate}</div>
          </div>
        </div>
      </div>
      {/* ... keep your showPendingModal code exactly as it is ... */}
    </>
  );
};

const ProfitDashboard = ({ loads, drivers }) => {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [viewType, setViewType] = useState('overview');
  
  const safeLoads = Array.isArray(loads) ? loads : [];
  
  const filteredLoads = useMemo(() => {
    if (viewType === 'overview') return safeLoads;
    return safeLoads.filter(load => {
      const date = load.appointmentDate || load.createdAt;
      if (!date) return false;
      return date.startsWith(selectedMonth);
    });
  }, [safeLoads, viewType, selectedMonth]);

  const getLoadTotal = (load) => safeFloat(calculateTotal(load));
  const getLoadCost = (load) => safeFloat(calculateCost(load));
  
  const cadLoadsList = safeLoads.filter(l => (l.currency || 'CAD') === 'CAD');
  const usdLoadsList = safeLoads.filter(l => l.currency === 'USD');
  
  const cadRevenue = cadLoadsList.reduce((sum, load) => sum + getLoadTotal(load), 0);
  const cadCost = cadLoadsList.reduce((sum, load) => sum + getLoadCost(load), 0);
  const cadProfit = cadRevenue - cadCost;
  
  const usdRevenue = usdLoadsList.reduce((sum, load) => sum + getLoadTotal(load), 0);
  const usdCost = usdLoadsList.reduce((sum, load) => sum + getLoadCost(load), 0);
  const usdProfit = usdRevenue - usdCost;
  
  const totalRevenue = cadRevenue + usdRevenue;
  const totalCost = cadCost + usdCost;
  const totalProfit = cadProfit + usdProfit;
  const grossMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0;
 
  const usdLoads = usdLoadsList.length;
  const cadLoads = cadLoadsList.length;
 
  useEffect(() => { 
    if (totalRevenue > 0) { 
      if (grossMargin > 80) { 
        console.warn(`⚠️ Unusually high gross margin: ${grossMargin}%. Check if all costs are being tracked correctly.`); 
      } 
      if (grossMargin < -20) { 
        console.warn(`⚠️ Significant loss detected: ${grossMargin}%. Review pricing and costs.`); 
      } 
    } 
  }, [totalRevenue, grossMargin]);

  const customerData = {}; 
  const laneData = {}; 
  const truckData = {}; 
  const driverData = {};
  
  safeLoads.forEach(load => { 
    const rev = getLoadTotal(load); 
    const cost = getLoadCost(load); 
    const profit = rev - cost; 
    const cName = load?.customerName || 'Unknown'; 
    if (!customerData[cName]) customerData[cName] = { rev: 0, profit: 0 }; 
    customerData[cName].rev += rev; 
    customerData[cName].profit += profit; 
    const legs = getSafeLegs(load); 
    if (legs.length > 0) { 
      const from = (legs[0]?.from || 'Unknown Origin').split(' - ')[0]; 
      const to = (legs[legs.length - 1]?.to || 'Unknown Dest').split(' - ')[0]; 
      const lane = `${from} → ${to}`; 
      if (!laneData[lane]) laneData[lane] = { rev: 0, profit: 0 }; 
      laneData[lane].rev += rev; 
      laneData[lane].profit += profit; 
      const trucks = [...new Set(legs.map(l => l?.truckNo).filter(Boolean))]; 
      if (trucks.length > 0) { 
        const splitRev = rev / trucks.length; 
        const splitProfit = profit / trucks.length; 
        trucks.forEach(t => { 
          if (!truckData[t]) truckData[t] = { rev: 0, profit: 0 }; 
          truckData[t].rev += splitRev; 
          truckData[t].profit += splitProfit; 
        }); 
      } 
      const drivers = [...new Set(legs.map(l => l?.driverName).filter(Boolean))]; 
      if (drivers.length > 0) { 
        const splitRev = rev / drivers.length; 
        const splitProfit = profit / drivers.length; 
        drivers.forEach(d => { 
          if (!driverData[d]) driverData[d] = { rev: 0, profit: 0 }; 
          driverData[d].rev += splitRev; 
          driverData[d].profit += splitProfit; 
        }); 
      } 
    } 
  });
  
  const topCustomers = Object.entries(customerData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topLanes = Object.entries(laneData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topTrucks = Object.entries(truckData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topDrivers = Object.entries(driverData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);

  const months = []; 
  const d = new Date(); 
  for (let i = 5; i >= 0; i--) { 
    const d2 = new Date(d.getFullYear(), d.getMonth() - i, 1); 
    months.push({ 
      label: d2.toLocaleString('default', { month: 'short', year: '2-digit' }), 
      month: d2.getMonth(), 
      year: d2.getFullYear(), 
      revenue: 0, 
      profit: 0 
    }); 
  }
  
  safeLoads.forEach(load => { 
    const dateSource = load?.appointmentDate || load?.createdAt || load?.dateAdded; 
    if (!dateSource) return; 
    const loadDate = new Date(dateSource); 
    if (isNaN(loadDate.getTime())) return; 
    const m = loadDate.getMonth(); 
    const y = loadDate.getFullYear(); 
    const monthObj = months.find(x => x.month === m && x.year === y); 
    if (!monthObj) return; 
    const revenue = Number(getLoadTotal(load)) || 0; 
    const cost = Number(getLoadCost(load)) || 0; 
    const profit = revenue - cost; 
    monthObj.revenue += revenue; 
    monthObj.profit += profit; 
  });
  
  const maxRev = Math.max(...months.map(m => m.revenue), 1000);

  const truckProfitData = useMemo(() => {
    const truckMap = {};
    filteredLoads.forEach(load => {
      const legs = load.legs || [];
      const revenue = getLoadTotal(load);
      const cost = getLoadCost(load);
      const profit = revenue - cost;
      legs.forEach(leg => {
        const truckNo = leg.truckNo || 'Unknown Truck';
        if (!truckMap[truckNo]) {
          truckMap[truckNo] = { revenue: 0, cost: 0, profit: 0, drivers: new Set() };
        }
        truckMap[truckNo].revenue += revenue / legs.length;
        truckMap[truckNo].cost += cost / legs.length;
        truckMap[truckNo].profit += profit / legs.length;
        if (leg.driverName) truckMap[truckNo].drivers.add(leg.driverName);
      });
    });
    return Object.entries(truckMap).map(([truck, data]) => ({
      truck,
      ...data,
      drivers: Array.from(data.drivers)
    })).sort((a, b) => b.profit - a.profit);
  }, [filteredLoads]);

  const driverProfitData = useMemo(() => {
    const driverMap = {};
    filteredLoads.forEach(load => {
      const legs = load.legs || [];
      const revenue = getLoadTotal(load);
      const cost = getLoadCost(load);
      const profit = revenue - cost;
      legs.forEach(leg => {
        const driverName = leg.driverName || 'Unknown Driver';
        if (!driverMap[driverName]) {
          driverMap[driverName] = { 
            revenue: 0, 
            cost: 0, 
            profit: 0, 
            hours: 0, 
            truckNo: leg.truckNo || 'Unknown' 
          };
        }
        driverMap[driverName].revenue += revenue / legs.length;
        driverMap[driverName].cost += cost / legs.length;
        driverMap[driverName].profit += profit / legs.length;
        driverMap[driverName].hours += safeFloat(leg.totalHours) || 0;
        driverMap[driverName].truckNo = leg.truckNo || driverMap[driverName].truckNo;
      });
    });
    return Object.entries(driverMap).map(([driver, data]) => ({
      driver,
      ...data
    })).sort((a, b) => b.profit - a.profit);
  }, [filteredLoads]);

  const filteredRevenue = filteredLoads.reduce((sum, l) => sum + getLoadTotal(l), 0);
  const filteredCost = filteredLoads.reduce((sum, l) => sum + getLoadCost(l), 0);
  const filteredProfit = filteredRevenue - filteredCost;

  return (
    <div className="animate-in fade-in space-y-8">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <h2 className="text-2xl font-black text-slate-900">Profit Dashboard</h2>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewType('overview')}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                viewType === 'overview' 
                  ? 'bg-white shadow-sm text-blue-600' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <BarChart3 className="w-4 h-4 inline mr-1" />
              Overview
            </button>
            <button
              onClick={() => setViewType('truck')}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                viewType === 'truck' 
                  ? 'bg-white shadow-sm text-blue-600' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Truck className="w-4 h-4 inline mr-1" />
              By Truck
            </button>
            <button
              onClick={() => setViewType('driver')}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                viewType === 'driver' 
                  ? 'bg-white shadow-sm text-blue-600' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <User className="w-4 h-4 inline mr-1" />
              By Driver
            </button>
          </div>
          {viewType !== 'overview' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-4 py-2 border rounded-xl font-bold text-sm"
            />
          )}
        </div>
      </div>

      {viewType === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 flex items-center justify-center">
                <DollarSign className="w-7 h-7 text-purple-600" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Revenue</div>
                <div className="text-lg font-black text-slate-900">
                  C${cadRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {usdLoads > 0 && (
                  <div className="text-sm font-black text-green-600">
                    US${usdRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                <Receipt className="w-7 h-7 text-red-600" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Cost</div>
                <div className="text-lg font-black text-slate-900">
                  C${cadCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {usdLoads > 0 && (
                  <div className="text-sm font-black text-red-600">
                    US${usdCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
                <Wallet className="w-7 h-7 text-green-600" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Profit</div>
                <div className="text-lg font-black text-slate-900">
                  C${cadProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {usdLoads > 0 && (
                  <div className="text-sm font-black text-green-600">
                    US${usdProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Activity className="w-7 h-7 text-blue-600" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross Margin</div>
                <div className="text-2xl font-black text-slate-900">{grossMargin}%</div>
                <div className="text-[10px] font-bold text-slate-400 mt-1">USD: {usdLoads} | CAD: {cadLoads}</div>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-8">
              <TrendingUp className="w-5 h-5 text-purple-600" />
              <h3 className="font-black text-lg text-slate-900">Revenue & Profit Trend (6 Months)</h3>
            </div>
            <div className="flex items-end justify-between gap-2 h-64 mt-4">
              {months.map((m, i) => { 
                const profitHeight = m.revenue > 0 ? Math.max(0, (m.profit / m.revenue) * 100) : 0; 
                return (
                  <div key={i} className="flex flex-col items-center flex-1 group">
                    <div className="relative w-full flex justify-center h-[200px] items-end">
                      <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] font-bold px-3 py-2 rounded-xl whitespace-nowrap z-20 shadow-xl">
                        <div className="text-purple-300">Rev: ${m.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-green-400">Profit: ${m.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                      <div className="w-full max-w-[40px] bg-purple-100 rounded-t-xl transition-colors relative flex items-end overflow-hidden" style={{ height: `${(m.revenue / maxRev) * 100}%`, minHeight: '4px' }}>
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-500 to-purple-400 opacity-80 group-hover:opacity-100 transition-opacity"></div>
                        <div className="w-full bg-green-400 opacity-90 z-10" style={{ height: `${profitHeight}%`, minHeight: '4px' }}></div>
                      </div>
                    </div>
                    <div className="mt-4 text-xs font-bold text-slate-500 uppercase">{m.label}</div>
                  </div>
                ); 
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <Building className="w-5 h-5 text-blue-600" />
                <h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Customer</h3>
              </div>
              <div className="space-y-4">
                {topCustomers.map((c, i) => (
                  <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                    <div className="text-xs font-bold text-slate-700 truncate mr-2">{c.name}</div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">${c.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[10px] font-bold text-green-600">Profit: ${c.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                ))}
                {topCustomers.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <User className="w-5 h-5 text-orange-600" />
                <h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Driver</h3>
              </div>
              <div className="space-y-4">
                {topDrivers.map((d, i) => (
                  <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                    <div className="text-xs font-bold text-slate-700 truncate mr-2">{d.name ? d.name : 'Unknown Driver'}</div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">${d.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[10px] font-bold text-green-600">Profit: ${d.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                ))}
                {topDrivers.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <Truck className="w-5 h-5 text-purple-600" />
                <h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Truck</h3>
              </div>
              <div className="space-y-4">
                {topTrucks.map((t, i) => (
                  <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                    <div className="text-xs font-bold text-slate-700 truncate mr-2">{t.name ? `Truck ${t.name}` : 'Unknown Truck'}</div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">${t.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[10px] font-bold text-green-600">Profit: ${t.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                ))}
                {topTrucks.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <MapPin className="w-5 h-5 text-rose-600" />
                <h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Lane</h3>
              </div>
              <div className="space-y-4">
                {topLanes.map((l, i) => (
                  <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                    <div className="text-[10px] font-bold text-slate-600 truncate mr-2 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">{l.name}</div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">${l.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[10px] font-bold text-green-600">Profit: ${l.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                ))}
                {topLanes.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}
              </div>
            </div>
          </div>
        </>
      )}

      {viewType === 'truck' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b">
                <tr className="text-xs font-black text-slate-400 uppercase">
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3">Drivers</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {truckProfitData.map((item) => {
                  const margin = item.revenue > 0 ? ((item.profit / item.revenue) * 100).toFixed(1) : 0;
                  return (
                    <tr key={item.truck} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-800">🚛 {item.truck}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">${item.revenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">${item.cost.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-black ${item.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>${item.profit.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{margin}%</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{item.drivers.join(', ') || 'No drivers'}</td>
                    </tr>
                  );
                })}
                {truckProfitData.length === 0 && (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-400">No data for selected month</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewType === 'driver' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b">
                <tr className="text-xs font-black text-slate-400 uppercase">
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {driverProfitData.map((item) => {
                  const margin = item.revenue > 0 ? ((item.profit / item.revenue) * 100).toFixed(1) : 0;
                  return (
                    <tr key={item.driver} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-800">👤 {item.driver}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{item.truckNo}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">${item.revenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">${item.cost.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-black ${item.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>${item.profit.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{margin}%</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-500">{item.hours.toFixed(1)}h</td>
                    </tr>
                  );
                })}
                {driverProfitData.length === 0 && (
                  <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">No data for selected month</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const ActionRequired = ({ loads, onEdit, onStatusChange }) => {
  const safeLoads = Array.isArray(loads) ? loads : [];
  const pendingTermination = safeLoads.filter(l => {
    const legs = getSafeLegs(l);
    return l?.status === 'Open' && legs.length > 0 && legs.every(leg => leg.status === 'Completed');
  });
  if (pendingTermination.length === 0) return null;
 
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-[32px] p-8 mb-8 animate-in slide-in-from-top-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
        <AlertTriangle className="w-32 h-32 text-amber-600" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-4 mb-6">
          <div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div>
            <h3 className="font-black text-2xl text-amber-900 tracking-tight">Attention: Containers Pending Termination</h3>
            <p className="text-amber-800 font-bold text-sm mt-1">
              {pendingTermination.length} containers have completed all legs but need termination planning.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingTermination.map(load => (
            <div key={load.id} className="bg-white p-5 rounded-2xl border border-amber-100 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-amber-300 transition-all">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-black text-slate-800 text-lg">{load.containerNo || 'N/A'}</div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{load.customerName || 'N/A'}</div>
                </div>
                <div className="bg-green-100 text-green-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase">Delivered</div>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <Truck className="w-3.5 h-3.5" />
                <span className="truncate">Last: {getSafeLegs(load)[getSafeLegs(load).length - 1]?.to || 'Unknown'}</span>
              </div>
              <div className="pt-3 mt-auto flex gap-2 border-t border-slate-50">
                <button
                  onClick={() => onEdit && onEdit(load)}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 shadow-md shadow-blue-200 transition-all active:scale-95"
                >
                  📝 Plan Termination
                </button>
                <button
                  onClick={() => {
                    if (onEdit) onEdit(load);
                  }}
                  className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold text-xs hover:bg-amber-700 shadow-md shadow-amber-200 transition-all active:scale-95"
                >
                  🏗️ Open for Termination
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ========== WORKSPACE MANAGER ==========
const WorkspaceManager = ({ setCompanyId, setUserRole, setAppState, onRegistrationComplete }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ===== NEW: CONTACT SALES STATE =====
  const [isContactSalesOpen, setIsContactSalesOpen] = useState(false);
  const [salesForm, setSalesForm] = useState({
    companyName: "",
    contactName: "",
    workEmail: "",
    phone: "",
    monthlyContainers: "500+",
    message: ""
  });

  const handleLogin = async () => { 
    if (!email.trim() || !password.trim()) { 
      setError("Please enter valid credentials."); 
      return; 
    } 
    setError(""); 
    setLoading(true); 
    try { 
      await handleSignIn(email, password, setCompanyId, setUserRole, setAppState); 
    } 
    catch (err) { 
      setError(err.message || "Login failed"); 
    } 
    finally { 
      setLoading(false); 
    } 
  };

  // ===== NEW: HANDLE CONTACT SALES SUBMISSION =====
  const handleContactSalesSubmit = (e) => {
    e.preventDefault();
    
    // Build the email body
    const subject = `Account Request - ${salesForm.companyName}`;
    const body = `Company Name: ${salesForm.companyName}%0D%0A` +
                 `Contact Name: ${salesForm.contactName}%0D%0A` +
                 `Work Email: ${salesForm.workEmail}%0D%0A` +
                 `Phone: ${salesForm.phone}%0D%0A` +
                 `Monthly Containers: ${salesForm.monthlyContainers}%0D%0A%0D%0A` +
                 `Message:%0D%0A${salesForm.message}`;
                 
    // Open the user's default email client
    window.location.href = `mailto:support@nexdray.com?subject=${encodeURIComponent(subject)}&body=${body}`;
    
    // Close modal and show a thank you message
    setIsContactSalesOpen(false);
    alert("Your email client has been opened. Please send the email to complete your request.");
    
    // Reset form
    setSalesForm({
      companyName: "",
      contactName: "",
      workEmail: "",
      phone: "",
      monthlyContainers: "500+",
      message: ""
    });
  };

  return (
    <div className="h-screen w-full flex bg-[#050814] text-slate-200 selection:bg-purple-500/30 overflow-hidden">
      
      {/* ================= LEFT PANEL (Desktop) ================= */}
      <div className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-8 xl:p-12 overflow-hidden border-r border-slate-800/50">
        {/* Ambient Background Glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />
        
        {/* Brand Wordmark */}
        <div className="relative z-10 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(124,58,237,0.3)]">
            <Truck className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <span className="text-2xl font-black tracking-[0.15em] text-white">NEXDRAY</span>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-lg mt-6 xl:mt-10 shrink-0">
          <h1 className="text-4xl xl:text-5xl font-black tracking-tight text-white leading-[1.1] mb-4">
            Move Freight.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400">
              Master Operations.
            </span>
          </h1>
          <p className="text-base xl:text-lg text-slate-400 font-medium leading-relaxed">
            One intelligent platform to manage dispatch, drayage, deliveries, and billing — all in one place.
          </p>
        </div>

        {/* Custom SVG Logistics Illustration */}
        <div className="relative z-10 w-full flex-1 min-h-[120px] my-4 xl:my-6">
          <svg viewBox="0 0 800 400" className="w-full h-full object-contain" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g opacity="0.05" stroke="#fff" strokeWidth="1">
              <line x1="0" y1="100" x2="800" y2="100" />
              <line x1="0" y1="200" x2="800" y2="200" />
              <line x1="0" y1="300" x2="800" y2="300" />
              <line x1="200" y1="0" x2="200" y2="400" />
              <line x1="400" y1="0" x2="400" y2="400" />
              <line x1="600" y1="0" x2="600" y2="400" />
            </g>
            <path d="M 150 250 Q 300 150 450 200 T 700 100" stroke="url(#routeGradient)" strokeWidth="2" strokeDasharray="6 6" fill="none">
              <animate attributeName="stroke-dashoffset" from="120" to="0" dur="3s" repeatCount="indefinite" />
            </path>
            <path d="M 200 300 Q 400 350 600 250 T 750 300" stroke="url(#routeGradient2)" strokeWidth="2" strokeDasharray="4 8" fill="none">
              <animate attributeName="stroke-dashoffset" from="120" to="0" dur="4s" repeatCount="indefinite" />
            </path>
            <circle cx="150" cy="250" r="6" fill="#8B5CF6" />
            <circle cx="150" cy="250" r="12" fill="#8B5CF6" opacity="0.3">
              <animate attributeName="r" values="12;20;12" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="450" cy="200" r="5" fill="#3B82F6" />
            <circle cx="700" cy="100" r="8" fill="#8B5CF6" />
            <circle cx="700" cy="100" r="16" fill="#8B5CF6" opacity="0.2">
              <animate attributeName="r" values="16;24;16" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.2;0;0.2" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <g transform="translate(450, 240)">
              <rect x="0" y="0" width="180" height="80" rx="4" fill="#1E293B" stroke="#334155" strokeWidth="2" />
              <line x1="20" y1="10" x2="20" y2="70" stroke="#334155" strokeWidth="2" />
              <line x1="40" y1="10" x2="40" y2="70" stroke="#334155" strokeWidth="2" />
              <line x1="60" y1="10" x2="60" y2="70" stroke="#334155" strokeWidth="2" />
              <line x1="80" y1="10" x2="80" y2="70" stroke="#334155" strokeWidth="2" />
              <path d="M 180 20 L 230 20 L 250 50 L 250 80 L 180 80 Z" fill="#0F172A" stroke="#334155" strokeWidth="2" />
              <path d="M 185 25 L 220 25 L 235 45 L 185 45 Z" fill="#1E293B" stroke="#334155" strokeWidth="1" />
              <circle cx="40" cy="85" r="12" fill="#0F172A" stroke="#475569" strokeWidth="2" />
              <circle cx="120" cy="85" r="12" fill="#0F172A" stroke="#475569" strokeWidth="2" />
              <circle cx="210" cy="85" r="12" fill="#0F172A" stroke="#475569" strokeWidth="2" />
              <rect x="245" y="60" width="5" height="10" rx="2" fill="#8B5CF6" />
              <rect x="0" y="0" width="180" height="80" rx="4" fill="url(#trailerGlow)" opacity="0.1" />
            </g>
            <defs>
              <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0" />
                <stop offset="50%" stopColor="#8B5CF6" stopOpacity="1" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="routeGradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0" />
                <stop offset="50%" stopColor="#8B5CF6" stopOpacity="1" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="trailerGlow" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Footer Text */}
        <div className="relative z-10 text-xs font-medium text-slate-600 shrink-0">
          © {new Date().getFullYear()} NexDray Logistics. All rights reserved.
        </div>
      </div>

      {/* ================= RIGHT PANEL (Form) ================= */}
      <div className="w-full lg:w-[45%] flex flex-col items-center justify-center p-6 sm:p-8 xl:p-12 relative overflow-y-auto">
        {/* Mobile Brand Header */}
        <div className="lg:hidden w-full max-w-md flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-xl flex items-center justify-center text-white shadow-[0_0_15px_rgba(124,58,237,0.4)]">
            <Truck className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <span className="text-xl font-black tracking-[0.15em] text-white">NEXDRAY</span>
        </div>

        <div className="w-full max-w-md my-auto">
          {/* Form Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Welcome back</h2>
            <p className="text-sm text-slate-400 font-medium">Sign in to your NexDray workspace.</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-5">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                Work Email
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="email" 
                  required 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  className="w-full pl-11 pr-4 py-3.5 bg-[#0D1117] border border-slate-800 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all hover:border-slate-700" 
                  placeholder="you@company.com" 
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Password
                </label>
                <button 
                  type="button" 
                  onClick={() => { /* Add forgot password logic here if you have it */ alert("Please contact your administrator to reset your password."); }} 
                  className="text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type={showPassword ? "text" : "password"} 
                  required 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  className="w-full pl-11 pr-12 py-3.5 bg-[#0D1117] border border-slate-800 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all hover:border-slate-700" 
                  placeholder="••••••••" 
                  minLength={6} 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)} 
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading} 
              className="w-full mt-2 py-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-xl font-bold text-sm tracking-wide transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in to workspace"
              )}
            </button>
          </form>

          {/* Footer / Support */}
          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500 font-medium">
              Don't have an account?{" "}
              <button 
                type="button"
                onClick={() => setIsContactSalesOpen(true)}
                className="text-purple-400 hover:text-purple-300 font-bold transition-colors underline decoration-purple-400/30 hover:decoration-purple-400"
              >
                Contact Sales
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* ================= CONTACT SALES MODAL ================= */}
      {isContactSalesOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#050814]/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D1117] border border-slate-800 rounded-2xl w-full max-w-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div>
                <h3 className="text-xl font-bold text-white">Contact Sales</h3>
                <p className="text-sm text-slate-400 mt-1">Request an account for NexDray.</p>
              </div>
              <button 
                onClick={() => setIsContactSalesOpen(false)} 
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              
              {/* Eligibility Notice */}
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-purple-300 mb-1">Eligibility Requirement</h4>
                  <p className="text-xs text-purple-200/80 leading-relaxed">
                    Only companies processing <strong>500+ containers per month</strong> are eligible for a NexDray account. 
                    If you meet this requirement, please fill out the form below.
                  </p>
                </div>
              </div>

              <form onSubmit={handleContactSalesSubmit} className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                    Company Name *
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={salesForm.companyName}
                    onChange={e => setSalesForm({...salesForm, companyName: e.target.value})}
                    className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all"
                    placeholder="Your Logistics Company"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                      Contact Name *
                    </label>
                    <input 
                      type="text" 
                      required 
                      value={salesForm.contactName}
                      onChange={e => setSalesForm({...salesForm, contactName: e.target.value})}
                      className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                      Phone Number
                    </label>
                    <input 
                      type="tel" 
                      value={salesForm.phone}
                      onChange={e => setSalesForm({...salesForm, phone: e.target.value})}
                      className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                    Work Email *
                  </label>
                  <input 
                    type="email" 
                    required 
                    value={salesForm.workEmail}
                    onChange={e => setSalesForm({...salesForm, workEmail: e.target.value})}
                    className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all"
                    placeholder="john@yourcompany.com"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                    Estimated Monthly Containers *
                  </label>
                  <select 
                    required
                    value={salesForm.monthlyContainers}
                    onChange={e => setSalesForm({...salesForm, monthlyContainers: e.target.value})}
                    className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all"
                  >
                    <option value="Less than 500">Less than 500</option>
                    <option value="500+">500+ (Eligible)</option>
                    <option value="1000+">1000+</option>
                    <option value="5000+">5000+</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                    Message (Optional)
                  </label>
                  <textarea 
                    rows="3"
                    value={salesForm.message}
                    onChange={e => setSalesForm({...salesForm, message: e.target.value})}
                    className="w-full px-4 py-3 bg-[#050814] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 outline-none transition-all resize-none"
                    placeholder="Tell us about your business needs..."
                  />
                </div>

                <div className="pt-2">
                  <button 
                    type="submit" 
                    className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-xl font-bold text-sm transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Submit Request
                  </button>
                </div>
              </form>
              
              <div className="text-center pt-2">
                <p className="text-xs text-slate-500">
                  Or email us directly at{" "}
                  <a href="mailto:support@nexdray.com" className="text-purple-400 hover:text-purple-300 font-bold">
                    support@nexdray.com
                  </a>
                </p>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const createTeamUser = async (email, password, role, companyId) => {
  try {
    const functions = getFunctions();
    const createTeamMemberFn = httpsCallable(functions, 'createTeamMember');
    const result = await createTeamMemberFn({ email, password, role, companyId });
    return result.data;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const RoleSetup = ({ companyId, ownerUid, onComplete }) => {
  const [teamMembers, setTeamMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("dispatcher");
  const [tempPassword, setTempPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!companyId) return;
    let isMounted = true;
    const fetchTeam = async () => {
      try {
        const companySnap = await getDoc(doc(db, "companies", companyId));
        if (!companySnap.exists() || !isMounted) return;
        const memberUids = companySnap.data().memberUids || [];
        if (memberUids.length === 0) { setTeamMembers([]); return; }
        const members = await Promise.all(memberUids.filter(uid => uid !== ownerUid).map(async (uid) => { const userSnap = await getDoc(doc(db, "users", uid)); return userSnap.exists() ? { id: uid, ...userSnap.data() } : null; }));
        if (isMounted) setTeamMembers(members.filter(Boolean));
      } catch (error) { console.error("Failed to load team members:", error); if (isMounted) setTeamMembers([]); }
    };
    fetchTeam();
    return () => { isMounted = false; };
  }, [companyId, ownerUid]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !tempPassword.trim() || tempPassword.length < 6) { setMessage("Email and password (min. 6 characters) required."); return; }
    setLoading(true);
    const result = await createTeamUser(inviteEmail, tempPassword, inviteRole, companyId);
    if (result.success) { setMessage(`✅ ${inviteEmail} added as ${ROLE_DISPLAY_NAMES[inviteRole] || inviteRole}`); setInviteEmail(""); setTempPassword(""); setInviteRole("dispatcher"); } else { setMessage(`❌ Failed: ${result.error}`); }
    setLoading(false);
  };
  
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl border p-8">
        <div className="text-center mb-8"><h1 className="text-3xl font-black text-slate-900">Team Setup</h1><p className="text-slate-500 mt-2">Add your dispatchers, accounting staff, or admins.</p></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-slate-50 p-6 rounded-xl">
            <h2 className="font-bold text-lg mb-4">Invite new member</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div><label className="block text-xs font-bold uppercase text-slate-500">Email address</label><input type="email" required className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></div>
              <div><label className="block text-xs font-bold uppercase text-slate-500">Temporary password</label><input type="text" required className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={tempPassword} onChange={e => setTempPassword(e.target.value)} placeholder="min. 6 characters" /><p className="text-[10px] text-slate-400 mt-1">The user must change it after first login.</p></div>
              <div><label className="block text-xs font-bold uppercase text-slate-500">Role</label><select className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
  <option value="dispatcher">{ROLE_DISPLAY_NAMES.dispatcher} – Operations only</option>
  <option value="accounting">{ROLE_DISPLAY_NAMES.accounting} – Billing & Financial</option>
  <option value="admin">{ROLE_DISPLAY_NAMES.admin} – Full access</option>
  <option value="customer_service">{ROLE_DISPLAY_NAMES.customer_service} – Customer support</option>
</select></div>
              <button type="submit" disabled={loading} className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition disabled:opacity-50">{loading ? "Creating..." : "Invite user"}</button>
              {message && <div className="text-sm text-center mt-2 font-bold">{message}</div>}
            </form>
          </div>
          <div className="bg-slate-50 p-6 rounded-xl">
            <h2 className="font-bold text-lg mb-4">Team members</h2>
            {teamMembers.length === 0 && (<p className="text-slate-400 text-sm italic">No additional members yet.</p>)}
            <ul className="space-y-2">
              {teamMembers.map(member => (
                <li key={member.id} className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <div><div className="font-medium text-slate-800">{member.email}</div>
<div className="text-xs text-slate-500 capitalize">{ROLE_DISPLAY_NAMES[member.role] || member.role}</div></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <button onClick={onComplete} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-md">Continue to Dashboard →</button>
        </div>
      </div>
    </div>
  );
};

// ========== MAIN APP COMPONENT ==========
const App = () => {
  // ========== ALL useState DECLARATIONS ==========
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('dispatcher');
  const [userEmail, setUserEmail] = useState('');
  const [appState, setAppState] = useState('loading');
  const [pendingCompanyId, setPendingCompanyId] = useState(null);
  const [pendingOwnerUid, setPendingOwnerUid] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [companyDetails, setCompanyDetails] = useState({ address: '', city: '', phone: '', email: '' });
  const [companyLocations, setCompanyLocations] = useState([]);
  const [currentLocation, setCurrentLocation] = useState('');
  const [dataSharingMode, setDataSharingMode] = useState('separate');
  const [userAccessibleLocations, setUserAccessibleLocations] = useState([]);
  const [invoiceStartDate, setInvoiceStartDate] = useState('');
  const [invoiceEndDate, setInvoiceEndDate] = useState('');
 
  const [loadsToday, setLoadsToday] = useState([]);
  const [loadsOpen, setLoadsOpen] = useState([]);
  const [revenueLoads, setRevenueLoads] = useState([]);
  const [assignmentLoads, setAssignmentLoads] = useState([]);

  const [paginatedLoads, setPaginatedLoads] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');
  const [showContainerBoard, setShowContainerBoard] = useState(false);
  const [showDispatchBoard, setShowDispatchBoard] = useState(false);
  const [showTomorrowDispatchBoard, setShowTomorrowDispatchBoard] = useState(false);  // ← ADD THIS
  const [savedCustomers, setSavedCustomers] = useState([]);
  const [savedDestinations, setSavedDestinations] = useState([]);
  const [savedDrivers, setSavedDrivers] = useState([]);
  const [savedTerminals, setSavedTerminals] = useState([]);
  const [savedChassis, setSavedChassis] = useState([]);
  const [savedTrucks, setSavedTrucks] = useState([]);
  const [savedBasePrices, setSavedBasePrices] = useState([]);
  const [newTerminal, setNewTerminal] = useState({
  name: '',
  code: '',
  address: '',
  city: '',
  province: '',
  postalCode: '',
  phone: '',
  email: '',
  contactName: ''
});
const [newCust, setNewCust] = useState({
  name: '', email: '', phone: '', address: '',
  contactName: '', contactTitle: '', fax: '', city: '',
  postalCode: '', defaultTax: '', accountingId: '', division: '',
  prepullRate: '',
  stopOffRate: '',
  yardStorageRate: '',
  chassisRate: '',
  rateCurrency: 'CAD',
  taxStatus: 'GST'
});
const [newLoc, setNewLoc] = useState({ name: '', address: '' });
const [newDriver, setNewDriver] = useState({
  name: '',
  truckNo: '',
  type: 'Company Driver',
  payRate: 0,
  payType: 'flat',
  fuelEfficiency: '',
  email: '',
  password: ''
});
// ✅ ADD THIS MISSING STATE - RIGHT HERE
const [newBasePrice, setNewBasePrice] = useState({
  location: '',
  price: '',
  currency: 'CAD',
  description: ''
});
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
const [editingLoadData, setEditingLoadData] = useState(null); // ✅ ADD THIS LINE
  const [searchTerm, setSearchTerm] = useState("");
  const [copyFeedback, setCopyFeedback] = useFeedback();
  const [assignmentDate, setAssignmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [draftEmail, setDraftEmail] = useState({ isOpen: false, content: "", load: null });
  const [signingContext, setSigningContext] = useState(null);
  const [viewingDoc, setViewingDoc] = useState(null);
  const [trackingLoad, setTrackingLoad] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const isMountedRef = useIsMountedRef();
  const isAuthProcessing = useRef(false);
  const lastEmailTimeRef = useRef(0);
  const EMAIL_COOLDOWN_MS = 10000;
  const inactivityTimerRef = useRef(null);
  const GEMINI_API_KEY = "";
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
const [isImporting, setIsImporting] = useState(false);
const [authReady, setAuthReady] = useState(false);
const [showEmailSettings, setShowEmailSettings] = useState(false);
const [pendingInvoiceLoadId, setPendingInvoiceLoadId] = useState(null);  // ✅ ADD
  const [loadsPage, setLoadsPage] = useState(0);
  const [pageSize] = useState(25);
  const lastDocSnapshotRef = useRef(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [boardView, setBoardView] = useState(null); // 'today', 'tomorrow', or null
    // ===== NEW: SEARCH & BULK DELETE STATE FOR LOADS =====
  const [loadBulkDeleteMode, setLoadBulkDeleteMode] = useState(false);
  const [selectedLoadIds, setSelectedLoadIds] = useState([]);
  const [showLoadBulkDeleteConfirm, setShowLoadBulkDeleteConfirm] = useState(false);
  const [loadBulkDeleteStep, setLoadBulkDeleteStep] = useState(1);
  const [isLoadBulkDeleting, setIsLoadBulkDeleting] = useState(false);

  // ========== COMPUTED VALUES ==========
const summaryLoads = useMemo(() => {
  const combined = [...loadsToday, ...loadsOpen];
  const map = new Map();
  combined.forEach(load => {
    if (load && load.status && !['Completed', 'Paid', 'Closed'].includes(load.status)) {
      map.set(load.id, load);
    }
  });
  return Array.from(map.values());
}, [loadsToday, loadsOpen]);

// ✅ NEW: Clear boardView when switching tabs
useEffect(() => {
  if (boardView) {
    setBoardView(null);
  }
}, [activeTab]);

  const loads = activeTab === 'summary' ? summaryLoads :
                activeTab === 'assignment' ? assignmentLoads :
                activeTab === 'revenue' ? revenueLoads :
                paginatedLoads;

  const loadToEdit = editingId 
  ? (editingLoadData?.id === editingId 
      ? editingLoadData 
      : [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === editingId)) 
  : null;
    const isAdmin = userRole === 'owner' || userRole === 'admin';
  const isDispatcher = userRole === 'dispatcher';
  const isAccounting = userRole === 'accounting';
  const isCustomerService = userRole === 'customer_service';

  // ========== REAL‑TIME LISTENERS ==========
  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const today = new Date().toISOString().split('T')[0];
  
  // ✅ REMOVED: 'status' filter to avoid index requirement
  let constraints = [
    where('appointmentDate', '==', today),
    limit(50)
  ];
  
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q,
    (snapshot) => {
      // ✅ Filter in JavaScript instead of Firestore
      const allLoads = snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id));
      const filteredLoads = allLoads.filter(load => 
        !['Completed', 'Paid', 'Closed'].includes(load.status)
      );
      setLoadsToday(filteredLoads);
    },
    (error) => {
      console.error("loadsToday listener error:", error);
      setCopyFeedback("❌ Unable to load today's loads – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  
  let constraints = [
    where('status', 'in', ['Open', 'Ready for Billing', 'Invoiced', 'Dispatched', 'In Transit', 'Delivered']),
    limit(50)
  ];
  
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q,
    (snapshot) => {
      const loads = snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id));
      setLoadsOpen(loads);
      
      // ✅ UPDATE DRIVER ASSIGNED LOADS
      // This ensures drivers have their assigned loads updated in real-time
      const driversWithLoads = {};
      loads.forEach(load => {
        (load.legs || []).forEach(leg => {
          if (leg.driverName) {
            if (!driversWithLoads[leg.driverName]) {
              driversWithLoads[leg.driverName] = [];
            }
            driversWithLoads[leg.driverName].push({
              ...load,
              driverLeg: leg
            });
          }
        });
      });
      
      // Update savedDrivers with their assigned loads
      setSavedDrivers(prev => prev.map(driver => {
        const assignedLoads = driversWithLoads[driver.name] || [];
        return {
          ...driver,
          assignedLoads: assignedLoads,
          tripStatus: assignedLoads.length > 0 
            ? assignedLoads[0]?.driverLeg?.tripStatus || driver.tripStatus 
            : 'Idle'
        };
      }));
    },
    (error) => {
      console.error("loadsOpen listener error:", error);
      setCopyFeedback("❌ Unable to load open loads – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady || activeTab !== 'revenue') return;
 
  const fetchRevenueData = async () => {
    let constraints = [
      orderBy('createdAt', 'desc'),
      limit(100) // Only fetch recent 100 for dashboard
    ];
    if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
      constraints.push(where('locationId', '==', currentLocation));
    }
    const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
    const snapshot = await getDocs(q);
    setRevenueLoads(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
  };
 
  fetchRevenueData();
 
  // Refresh every 30 seconds when on revenue tab
  const interval = setInterval(fetchRevenueData, 30000);
  return () => clearInterval(interval);
}, [user, companyId, appState, authReady, activeTab, dataSharingMode, userRole, currentLocation]);

  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady || activeTab !== 'assignment') return;
 
  const fetchAssignmentData = async () => {
    let constraints = [
      where('appointmentDate', '==', assignmentDate),
      where('status', '==', 'Open'),
      limit(100) // ✅ Limit added
    ];
    if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
      constraints.push(where('locationId', '==', currentLocation));
    }
    const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
    const snapshot = await getDocs(q);
    setAssignmentLoads(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
  };
 
  fetchAssignmentData();
 
  // Refresh every 30 seconds when on assignment tab
  const interval = setInterval(fetchAssignmentData, 30000);
  return () => clearInterval(interval);
}, [user, companyId, appState, authReady, activeTab, assignmentDate, dataSharingMode, userRole, currentLocation]);

  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'customers'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => { setSavedCustomers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))); });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'locations'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => { setSavedDestinations(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))); });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'drivers'), limit(500)); // ✅ ADDED LIMIT
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const drivers = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        // Ensure all status fields are included with defaults
        tripStatus: data.tripStatus || 'Idle',
        currentContainerNo: data.currentContainerNo || null, // ✅ ADD THIS
        currentLoadId: data.currentLoadId || null, // ✅ ADD THIS
        currentWorkOrderNo: data.currentWorkOrderNo || null, // ✅ ADD THIS (optional but helpful)
        currentCustomerName: data.currentCustomerName || null, // ✅ ADD THIS (optional but helpful)
        tripStartedAt: data.tripStartedAt || null,
        arrivedPickupAt: data.arrivedPickupAt || null,
        loadedAt: data.loadedAt || null,
        inTransitAt: data.inTransitAt || null,
        arrivedDeliveryAt: data.arrivedDeliveryAt || null,
        deliveredAt: data.deliveredAt || null,
        podUploadedAt: data.podUploadedAt || null,
        headingToYardAt: data.headingToYardAt || null,
        arrivedYardAt: data.arrivedYardAt || null,
        completedAt: data.completedAt || null,
        podPhotoUrl: data.podPhotoUrl || null,
        receiverName: data.receiverName || null,
        signature: data.signature || null,
        isTracking: data.isTracking || false,
        lat: data.lat || null,
        lng: data.lng || null,
        lastUpdated: data.lastUpdated || null,
      };
    });
    setSavedDrivers(drivers);
  });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

// ===== TERMINALS LISTENER =====
useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'terminals'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    setSavedTerminals(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

// ===== CHASSIS LISTENER =====
useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'chassis'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    setSavedChassis(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

// ✅ ADD THE TRUCKS LISTENER HERE - After Chassis listener
// ===== TRUCKS LISTENER =====
useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'trucks'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    setSavedTrucks(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

// ===== BASE PRICES LISTENER =====
// ✅ ADD THIS RIGHT AFTER THE TRUCKS LISTENER
useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const q = query(collection(db, 'companies', companyId, 'basePrices'), limit(500));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    setSavedBasePrices(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  });
  return () => unsubscribe();
}, [user, companyId, appState, authReady]);

// ===== BILLING REAL-TIME LISTENER =====
// Add this immediately after the Trucks listener
useEffect(() => {
  // Only run when on the billing tab
  if (!user || !companyId || appState !== 'dashboard' || !authReady || activeTab !== 'billing') return;
  
    // Build query to get loads in billing statuses
  let constraints = [
    where('status', 'in', ['Ready for Billing', 'Waiting for Approval', 'Approved', 'Invoiced']),
    limit(100)
  ];
  
  // Apply location filter if needed
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  // Create the query
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  
  // Set up real-time listener
  const unsubscribe = onSnapshot(q, (snapshot) => {
    // Convert each document to a load object
    const loads = snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id));
    // Update paginatedLoads - this will instantly update the billing table
    setPaginatedLoads(loads);
  }, (error) => {
    console.error("Billing listener error:", error);
    setCopyFeedback("❌ Failed to load billing data");
  });
  
  // Cleanup: unsubscribe when leaving billing tab
  return () => unsubscribe();
}, [user, companyId, appState, authReady, activeTab, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  // ========== PAGINATED FETCH ==========
    const fetchPaginatedLoads = useCallback(async (resetPage = true, searchTermOverride) => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  let currentCursor = resetPage ? null : lastDocSnapshotRef.current;
  if (resetPage) {
    setLoadsPage(0);
    lastDocSnapshotRef.current = null;
  }
  setIsLoadingMore(true);
  try {
        let constraints = [];
    const searchValue = searchTermOverride !== undefined ? searchTermOverride : searchTerm;
    
    // ✅ FIX: Container numbers are stored in UPPERCASE in the database. 
    // We must query them in UPPERCASE to get a match.
    const search = (searchValue || '').trim().toUpperCase(); 
    
    if (search) {
      constraints.push(where('containerNo', '>=', search));
      constraints.push(where('containerNo', '<=', search + '\uf8ff'));
    } else {
      if (activeTab === 'loads') {
  // ✅ Keep this - it already excludes completed/paid loads
  constraints.push(where('status', 'in', ['Open', 'Ready for Billing', 'Invoiced', 'Dispatched', 'In Transit', 'Delivered']));
} else if (activeTab === 'billing') {
  constraints.push(where('status', 'in', ['Ready for Billing', 'Waiting for Approval', 'Approved', 'Invoiced']));
} else if (activeTab === 'history') {
  constraints.push(where('status', 'in', ['Paid', 'Completed']));
}
    }
    if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
      constraints.push(where('locationId', '==', currentLocation));
    }
    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(pageSize));
   
    // ✅ CURSOR-BASED PAGINATION
    if (!resetPage && currentCursor) {
      constraints.push(startAfter(currentCursor));
    }
   
    const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
    const snapshot = await getDocs(q);
   
    const loadedDocs = snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id));
    setPaginatedLoads(loadedDocs);
   
    // Store cursors for pagination
    if (snapshot.docs.length > 0) {
      lastDocSnapshotRef.current = snapshot.docs[snapshot.docs.length - 1];
      setHasMore(snapshot.docs.length === pageSize);
    } else {
      lastDocSnapshotRef.current = null;
      setHasMore(false);
    }
  } catch (error) {
    console.error("Paginated fetch error:", error);
    setCopyFeedback("Failed to load loads. Please refresh.");
  } finally {
    setIsLoadingMore(false);
  }
}, [user, companyId, appState, authReady, activeTab, pageSize, setCopyFeedback, searchTerm, dataSharingMode, userRole, currentLocation]);

  const debouncedSearch = useMemo(() => debounce((term) => {
    setSearchTerm(term);
    if (activeTab !== 'summary' && activeTab !== 'assignment' && activeTab !== 'revenue') {
      fetchPaginatedLoads(true, term);
    }
  }, 300), [activeTab, fetchPaginatedLoads]);

  useEffect(() => {
  if (activeTab === 'summary' || activeTab === 'assignment' || activeTab === 'revenue') return;
  setPaginatedLoads([]);
  fetchPaginatedLoads(true);
}, [activeTab, fetchPaginatedLoads]);

  // ========== HANDLERS ==========
  const handleAddCustomer = useCallback(async (e) => {
  e.preventDefault();
  console.log('🟢 handleAddCustomer called');
  console.log('newCust:', newCust);
  console.log('user:', user?.uid);
  console.log('companyId:', companyId);
  
  if (!newCust.name.trim() || !companyId) {
    console.log('❌ Validation failed: missing name or companyId');
    setCopyFeedback('❌ Missing required fields');
    return;
  }
  
  try {
    console.log('📤 Attempting addDoc...');
    await addDoc(collection(db, 'companies', companyId, 'customers'), {
      name: sanitizeInput(newCust.name),
      email: sanitizeInput(newCust.email),
      phone: sanitizeInput(newCust.phone),
      address: sanitizeInput(newCust.address),
      contactName: sanitizeInput(newCust.contactName),
      contactTitle: sanitizeInput(newCust.contactTitle),
      fax: sanitizeInput(newCust.fax),
      city: sanitizeInput(newCust.city),
      postalCode: sanitizeInput(newCust.postalCode),
      defaultTax: sanitizeInput(newCust.defaultTax),
      accountingId: sanitizeInput(newCust.accountingId),
      division: sanitizeInput(newCust.division),
      prepullRate: sanitizeInput(newCust.prepullRate) || '',
      stopOffRate: sanitizeInput(newCust.stopOffRate) || '',
      yardStorageRate: sanitizeInput(newCust.yardStorageRate) || '',
      chassisRate: sanitizeInput(newCust.chassisRate) || '',
      rateCurrency: newCust.rateCurrency || 'CAD',
      companyId: companyId
    });
    console.log('✅ Customer added');
    if (isMountedRef.current) {
      setNewCust({
        name: '', email: '', phone: '', address: '',
        contactName: '', contactTitle: '', fax: '', city: '',
        postalCode: '', defaultTax: '', accountingId: '', division: '',
        prepullRate: '', stopOffRate: '', yardStorageRate: '', chassisRate: '',
        rateCurrency: 'CAD', taxStatus: 'GST'
      });
      setCopyFeedback("Customer Saved to Cloud");
      console.log('✅ Feedback set');
    }
  } catch (error) {
    console.error('❌ addDoc error:', error);
    if (isMountedRef.current) setCopyFeedback("Failed to save customer");
  }
}, [companyId, newCust, setCopyFeedback, isMountedRef]);

// ✅ ADD THIS RIGHT AFTER handleAddCustomer
const handleUpdateCustomer = useCallback(async (customerId, updatedData) => {
  if (!user || !companyId || !customerId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
 
  try {
    const customerRef = doc(db, 'companies', companyId, 'customers', customerId);
    await updateDoc(customerRef, {
      name: sanitizeInput(updatedData.name),
      email: sanitizeInput(updatedData.email),
      phone: sanitizeInput(updatedData.phone),
      address: sanitizeInput(updatedData.address),
      contactName: sanitizeInput(updatedData.contactName),
      contactTitle: sanitizeInput(updatedData.contactTitle),
      fax: sanitizeInput(updatedData.fax),
      city: sanitizeInput(updatedData.city),
      postalCode: sanitizeInput(updatedData.postalCode),
      defaultTax: sanitizeInput(updatedData.defaultTax),
      accountingId: sanitizeInput(updatedData.accountingId),
      division: sanitizeInput(updatedData.division),
      prepullRate: sanitizeInput(updatedData.prepullRate) || '',
      stopOffRate: sanitizeInput(updatedData.stopOffRate) || '',
      yardStorageRate: sanitizeInput(updatedData.yardStorageRate) || '',
      chassisRate: sanitizeInput(updatedData.chassisRate) || '',
      rateCurrency: updatedData.rateCurrency || 'CAD',
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail || user?.email || 'Unknown'
    });
   
    if (isMountedRef.current) {
      setCopyFeedback("✅ Customer updated successfully");
    }
  } catch (error) {
    console.error("Error updating customer:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to update customer");
  }
}, [user, companyId, userEmail, setCopyFeedback, isMountedRef]);

// ✅ ADD THIS - LOCATION UPDATE HANDLER
const handleUpdateLocation = useCallback(async (locationId, updatedData) => {
  if (!user || !companyId || !locationId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
 
  try {
    const locationRef = doc(db, 'companies', companyId, 'locations', locationId);
    await updateDoc(locationRef, {
      name: sanitizeInput(updatedData.name),
      address: sanitizeInput(updatedData.address),
      city: sanitizeInput(updatedData.city || ''),
      province: sanitizeInput(updatedData.province || ''),
      postalCode: sanitizeInput(updatedData.postalCode || ''),
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail || user?.email || 'Unknown'
    });
   
    if (isMountedRef.current) {
      setCopyFeedback("✅ Location updated successfully");
    }
  } catch (error) {
    console.error("Error updating location:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to update location");
  }
}, [user, companyId, userEmail, setCopyFeedback, isMountedRef]);

// ✅ ADD THIS - DRIVER UPDATE HANDLER
const handleUpdateDriver = useCallback(async (driverId, updatedData) => {
  if (!user || !companyId || !driverId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
 
  try {
    const driverRef = doc(db, 'companies', companyId, 'drivers', driverId);
   
    // Build update object
    const updateData = {
      name: sanitizeInput(updatedData.name),
      truckNo: sanitizeInput(updatedData.truckNo),
      type: updatedData.type || 'Company Driver',
      payRate: updatedData.payRate || 0,
      payType: updatedData.payType || 'flat',
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail || user?.email || 'Unknown'
    };
   
    // Only update fuel efficiency if it's a Company Driver
    if (updatedData.type === 'Company Driver') {
      updateData.fuelEfficiency = updatedData.fuelEfficiency || null;
    } else {
      updateData.fuelEfficiency = null;
    }
   
    // Update email if provided
    if (updatedData.email && updatedData.email.trim()) {
      updateData.email = updatedData.email.trim();
    }
   
    await updateDoc(driverRef, updateData);
   
    // If password is provided, update Firebase Auth
    if (updatedData.password && updatedData.password.length >= 6) {
      try {
        // Get the driver's auth UID
        const driverSnap = await getDoc(driverRef);
        const driverData = driverSnap.data();
        const authUid = driverData.authUid;
       
        if (authUid) {
          // Update password using Firebase Admin SDK (via cloud function)
          const functions = getFunctions();
          const updatePasswordFn = httpsCallable(functions, 'updateUserPassword');
          await updatePasswordFn({
            uid: authUid,
            newPassword: updatedData.password
          });
          console.log("✅ Driver password updated");
        } else {
          // If no authUid, create auth account
          if (updatedData.email && updatedData.email.trim()) {
            const userCredential = await createUserWithEmailAndPassword(
              auth,
              updatedData.email.trim(),
              updatedData.password
            );
            const newAuthUid = userCredential.user.uid;
           
            // Update driver with authUid
            await updateDoc(driverRef, { authUid: newAuthUid });
           
            // Add to company memberUids
            await updateDoc(doc(db, 'companies', companyId), {
              memberUids: arrayUnion(newAuthUid)
            });
           
            // Create user document
            await setDoc(doc(db, 'users', newAuthUid), {
              email: updatedData.email.trim(),
              companyId: companyId,
              role: 'driver',
              setupComplete: true,
              createdAt: new Date().toISOString()
            });
            console.log("✅ Driver auth created");
          }
        }
      } catch (authError) {
        console.error("Error updating auth:", authError);
        // Don't fail the whole update if auth fails
        setCopyFeedback("⚠️ Driver updated but password change failed");
        return;
      }
    }
   
    if (isMountedRef.current) {
      setCopyFeedback("✅ Driver updated successfully");
    }
  } catch (error) {
    console.error("Error updating driver:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to update driver");
  }
}, [user, companyId, userEmail, setCopyFeedback, isMountedRef]);

  const handleAddLocation = useCallback(async (e) => {
  e.preventDefault();
  console.log('🟢 handleAddLocation called');
  console.log('newLoc:', newLoc);
  console.log('companyId:', companyId);
  
  if (!newLoc.name.trim() || !companyId) {
    console.log('❌ Validation failed: missing name or companyId');
    setCopyFeedback('❌ Missing required fields');
    return;
  }
  
  try {
    console.log('📤 Attempting addDoc...');
    await addDoc(collection(db, 'companies', companyId, 'locations'), {
      name: sanitizeInput(newLoc.name),
      address: sanitizeInput(newLoc.address),
      companyId: companyId
    });
    console.log('✅ Location added');
    if (isMountedRef.current) {
      setNewLoc({ name: '', address: '' });
      setCopyFeedback("Location Saved to Cloud");
      console.log('✅ Feedback set');
    }
  } catch (error) {
    console.error('❌ addDoc error:', error);
    if (isMountedRef.current) setCopyFeedback("Failed to save location");
  }
}, [companyId, newLoc, setCopyFeedback, isMountedRef]);

const handleAddDriver = useCallback(async (e) => {
  e.preventDefault();
  if (!newDriver.name.trim() || !companyId) {
    setCopyFeedback('❌ Missing required fields');
    return;
  }

  const isThirdParty = newDriver.type === 'Third-Party Driver';
  const hasCredentials = newDriver.email && newDriver.email.trim() && newDriver.password && newDriver.password.length >= 6;

  setCopyFeedback("⏳ Saving driver...");

  try {
    if (!hasCredentials) {
      // ✅ No email/password provided -> Save directly to Firestore (No App Login)
      await addDoc(collection(db, 'companies', companyId, 'drivers'), {
        name: sanitizeInput(newDriver.name),
        truckNo: sanitizeInput(newDriver.truckNo || ''),
        type: newDriver.type || 'Company Driver',
        payRate: newDriver.payRate || 0,
        payType: newDriver.payType || 'flat',
        fuelEfficiency: newDriver.fuelEfficiency || null,
        email: '',
        authUid: null, // No auth user created
        createdAt: new Date().toISOString(),
        companyId: companyId
      });
      setNewDriver({ name: '', truckNo: '', type: 'Company Driver', payRate: 0, payType: 'flat', fuelEfficiency: '', email: '', password: '' });
      setCopyFeedback("✅ Saved successfully (No app login created)");
    } else {
      // ✅ Email/password provided -> Use Cloud Function to create Auth user
      const functions = getFunctions();
      const createDriverFn = httpsCallable(functions, 'createDriver');
      const result = await createDriverFn({
        name: newDriver.name.trim(),
        truckNo: newDriver.truckNo || '',
        type: newDriver.type || 'Company Driver',
        payRate: newDriver.payRate || 0,
        payType: newDriver.payType || 'flat',
        fuelEfficiency: newDriver.fuelEfficiency || null,
        email: newDriver.email.trim(),
        password: newDriver.password
      });
      
      if (result.data.success) {
        setNewDriver({ name: '', truckNo: '', type: 'Company Driver', payRate: 0, payType: 'flat', fuelEfficiency: '', email: '', password: '' });
        setCopyFeedback("✅ Driver created with app login");
      }
    }
  } catch (error) {
    console.error('❌ createDriver error:', error);
    const errorMsg = error.details?.message || error.message || "Failed to save driver";
    setCopyFeedback(`❌ ${errorMsg}`);
  }
}, [companyId, newDriver, setCopyFeedback]);

// ===== TERMINAL HANDLERS =====
const handleAddTerminal = useCallback(async (e) => {
  e.preventDefault();
  if (!newTerminal.name.trim() || !user || !companyId) return;
  try {
    await addDoc(collection(db, 'companies', companyId, 'terminals'), {
      name: sanitizeInput(newTerminal.name),
      code: sanitizeInput(newTerminal.code) || '',
      address: sanitizeInput(newTerminal.address) || '',
      city: sanitizeInput(newTerminal.city || ''),
      province: sanitizeInput(newTerminal.province || ''),
      postalCode: sanitizeInput(newTerminal.postalCode || ''),
      phone: sanitizeInput(newTerminal.phone || ''),
      email: sanitizeInput(newTerminal.email || ''),
      contactName: sanitizeInput(newTerminal.contactName || ''),
      companyId: companyId,
      createdAt: new Date().toISOString()
    });
    if (isMountedRef.current) {
      setNewTerminal({
        name: '', code: '', address: '', city: '', province: '',
        postalCode: '', phone: '', email: '', contactName: ''
      });
      setCopyFeedback("✅ Terminal saved successfully");
    }
  } catch (error) {
    console.error("Error adding terminal:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to save terminal");
  }
}, [user, companyId, newTerminal, setCopyFeedback, isMountedRef]);

const executeDeleteTerminal = useCallback(async (id) => {
  if (!user || !companyId || !id) return;
  try {
    await deleteDoc(doc(db, 'companies', companyId, 'terminals', id));
    if (isMountedRef.current) setCopyFeedback("✅ Terminal deleted");
  } catch (error) {
    console.error("Error deleting terminal:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to delete terminal");
  }
}, [user, companyId, setCopyFeedback, isMountedRef]);

const handleUpdateTerminal = useCallback(async (terminalId, updatedData) => {
  if (!user || !companyId || !terminalId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
  try {
    const terminalRef = doc(db, 'companies', companyId, 'terminals', terminalId);
    await updateDoc(terminalRef, {
      name: sanitizeInput(updatedData.name),
      code: sanitizeInput(updatedData.code || ''),
      address: sanitizeInput(updatedData.address || ''),
      city: sanitizeInput(updatedData.city || ''),
      province: sanitizeInput(updatedData.province || ''),
      postalCode: sanitizeInput(updatedData.postalCode || ''),
      phone: sanitizeInput(updatedData.phone || ''),
      email: sanitizeInput(updatedData.email || ''),
      contactName: sanitizeInput(updatedData.contactName || ''),
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail || user?.email || 'Unknown'
    });
    if (isMountedRef.current) {
      setCopyFeedback("✅ Terminal updated successfully");
    }
  } catch (error) {
    console.error("Error updating terminal:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to update terminal");
  }
}, [user, companyId, userEmail, setCopyFeedback, isMountedRef]);

// ===== BASE PRICE HANDLERS =====
// ✅ ADD THIS AFTER handleUpdateTerminal
const handleAddBasePrice = useCallback(async (e) => {
  e.preventDefault();
  if (!newBasePrice?.location?.trim() || !user || !companyId) {
    setCopyFeedback("❌ Please enter a location name");
    return;
  }
  try {
    // Check if location already exists
    const existingQuery = query(
      collection(db, 'companies', companyId, 'basePrices'),
      where('location', '==', sanitizeInput(newBasePrice.location.trim()))
    );
    const existingSnap = await getDocs(existingQuery);
    if (!existingSnap.empty) {
      setCopyFeedback("⚠️ This location already exists");
      return;
    }

    await addDoc(collection(db, 'companies', companyId, 'basePrices'), {
      location: sanitizeInput(newBasePrice.location.trim()),
      price: newBasePrice?.price && parseFloat(newBasePrice.price) > 0 
        ? parseFloat(newBasePrice.price) 
        : null,
      currency: newBasePrice.currency || 'CAD',
      description: sanitizeInput(newBasePrice.description || ''),
      companyId: companyId,
      createdAt: new Date().toISOString()
    });
    if (isMountedRef.current) {
      setNewBasePrice({ location: '', price: '', currency: 'CAD', description: '' });
      setCopyFeedback("✅ Location saved successfully");
    }
  } catch (error) {
    console.error("Error adding base price:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to save location");
  }
}, [user, companyId, newBasePrice, setCopyFeedback, isMountedRef]);

// ===== IMPORT BASE PRICES FROM EXCEL =====
const handleImportBasePrices = useCallback(async (file) => {
  if (!file || !companyId) {
    setCopyFeedback("❌ No file selected or company not found");
    return;
  }
  
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(extension)) {
    setCopyFeedback("❌ Please upload .xlsx, .xls, or .csv files only");
    return;
  }
  
  try {
    setIsImporting(true);
    setCopyFeedback("📊 Processing Excel file...");
    
    const ExcelJS = await retryDynamicImport(() => import('exceljs'));
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);
    
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      setCopyFeedback("❌ No worksheet found in file");
      return;
    }
    
    // Find column headers
    let nameColumnIndex = -1;
    let uomColumnIndex = -1;
    let divisionColumnIndex = -1;
    
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const value = cell.value ? String(cell.value).trim().toLowerCase() : '';
      if (value === 'name' || value === 'location') {
        nameColumnIndex = colNumber;
      } else if (value === 'uom') {
        uomColumnIndex = colNumber;
      } else if (value === 'division') {
        divisionColumnIndex = colNumber;
      }
    });
    
    if (nameColumnIndex === -1) {
      nameColumnIndex = 1;
      setCopyFeedback("ℹ️ Using first column as location names");
    }
    
    let importedCount = 0;
    let skippedCount = 0;
    const locations = [];
    
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      
      const nameCell = row.getCell(nameColumnIndex);
      let locationName = nameCell.value ? String(nameCell.value).trim() : '';
      locationName = locationName.replace(/^\d+\.\s*/, '').trim();
      
      if (!locationName) {
        skippedCount++;
        return;
      }
      
      // Try to extract price
      let price = null;
      let currency = 'CAD';
      
      if (uomColumnIndex !== -1) {
        const uomCell = row.getCell(uomColumnIndex);
        const uomValue = uomCell.value ? String(uomCell.value).trim().toUpperCase() : '';
        
        if (uomValue.includes('RATE') || uomValue.includes('FLAT') || uomValue.includes('PER')) {
          row.eachCell((cell, colNumber) => {
            if (colNumber !== nameColumnIndex && colNumber !== uomColumnIndex && colNumber !== divisionColumnIndex) {
              const val = cell.value;
              if (typeof val === 'number' && val > 0) {
                price = val;
              } else if (typeof val === 'string') {
                const numMatch = val.match(/(\d+\.?\d*)/);
                if (numMatch) {
                  price = parseFloat(numMatch[1]);
                }
              }
            }
          });
        }
      }
      
      // Check if location already exists
      const exists = savedBasePrices.some(
        bp => bp.location.toLowerCase() === locationName.toLowerCase()
      );
      
      if (!exists) {
        locations.push({
          location: locationName,
          price: price,
          currency: currency,
          description: divisionColumnIndex !== -1 
            ? String(row.getCell(divisionColumnIndex).value || '').trim() 
            : '',
          importedFromExcel: true
        });
        importedCount++;
      } else {
        skippedCount++;
      }
    });
    
    if (locations.length > 0) {
      const batch = writeBatch(db);
      let savedCount = 0;
      
      for (const loc of locations) {
        const docRef = doc(collection(db, 'companies', companyId, 'basePrices'));
        batch.set(docRef, {
          location: sanitizeInput(loc.location),
          price: loc.price,
          currency: loc.currency,
          description: sanitizeInput(loc.description || ''),
          companyId: companyId,
          importedFromExcel: true,
          createdAt: new Date().toISOString()
        });
        savedCount++;
      }
      
      await batch.commit();
      setCopyFeedback(`✅ Imported ${savedCount} locations! ${skippedCount} duplicates skipped.`);
    } else {
      setCopyFeedback(`⚠️ No new locations found. ${skippedCount} duplicates skipped.`);
    }
    
  } catch (error) {
    console.error("Import error:", error);
    setCopyFeedback(`❌ Import failed: ${error.message}`);
  } finally {
    setIsImporting(false);
  }
}, [companyId, savedBasePrices, setCopyFeedback]);

// ===== IMPORT LOCATIONS FROM EXCEL =====
const handleImportLocations = useCallback(async (file) => {
  if (!file || !companyId) {
    setCopyFeedback("❌ No file selected or company not found");
    return;
  }
  
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(extension)) {
    setCopyFeedback("❌ Please upload .xlsx, .xls, or .csv files only");
    return;
  }
  
  try {
    setIsImporting(true);
    setCopyFeedback("📊 Processing Locations Excel file...");
    
    const ExcelJS = await retryDynamicImport(() => import('exceljs'));
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);
    
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      setCopyFeedback("❌ No worksheet found in file");
      return;
    }
    
    // Find column headers (Case insensitive)
    let nameColumnIndex = 1; // Default to Column A
    let addressColumnIndex = 3; // Default to Column C
    
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const value = cell.value ? String(cell.value).trim().toLowerCase() : '';
      if (value === 'name' || value === 'location name') {
        nameColumnIndex = colNumber;
      } else if (value === 'full address' || value === 'address' || value === 'location address') {
        addressColumnIndex = colNumber;
      }
    });
    
    let importedCount = 0;
    let skippedCount = 0;
    const locationsToSave = [];
    const existingAddresses = new Set(savedDestinations.map(d => d.address?.toLowerCase().trim()));
    
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row
      
      const nameCell = row.getCell(nameColumnIndex);
      const addressCell = row.getCell(addressColumnIndex);
      
      let locationName = nameCell.value ? String(nameCell.value).trim() : '';
      let locationAddress = addressCell.value ? String(addressCell.value).trim() : '';
      
      // If name is empty, use the address as the name
      if (!locationName && locationAddress) {
        locationName = locationAddress;
      }
      
      // Skip if both are empty
      if (!locationName && !locationAddress) {
        skippedCount++;
        return;
      }
      
      // Check for duplicates in the current list
      const addressLower = locationAddress.toLowerCase().trim();
      if (existingAddresses.has(addressLower)) {
        skippedCount++;
        return;
      }
      
      locationsToSave.push({
        name: locationName,
        address: locationAddress,
        companyId: companyId,
        createdAt: new Date().toISOString()
      });
      
      existingAddresses.add(addressLower); // Prevent duplicates within the Excel file itself
      importedCount++;
    });
    
    if (locationsToSave.length > 0) {
      const batch = writeBatch(db);
      
      for (const loc of locationsToSave) {
        const docRef = doc(collection(db, 'companies', companyId, 'locations'));
        batch.set(docRef, loc);
      }
      
      await batch.commit();
      setCopyFeedback(`✅ Imported ${importedCount} locations! ${skippedCount} duplicates/empty rows skipped.`);
    } else {
      setCopyFeedback(`⚠️ No new locations found. ${skippedCount} duplicates or empty rows skipped.`);
    }
    
  } catch (error) {
    console.error("Import error:", error);
    setCopyFeedback(`❌ Import failed: ${error.message}`);
  } finally {
    setIsImporting(false);
  }
}, [companyId, savedDestinations, setCopyFeedback]);

const executeDeleteBasePrice = useCallback(async (id) => {
  if (!user || !companyId || !id) return;
  try {
    await deleteDoc(doc(db, 'companies', companyId, 'basePrices', id));
    if (isMountedRef.current) setCopyFeedback("✅ Base price deleted");
  } catch (error) {
    console.error("Error deleting base price:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to delete base price");
  }
}, [user, companyId, setCopyFeedback, isMountedRef]);

const confirmDeleteBasePrice = useCallback((id) => {
  setConfirmModal({
    isOpen: true,
    title: 'Delete Base Price?',
    message: 'Are you sure you want to delete this base price? This action cannot be undone.',
    onConfirm: () => executeDeleteBasePrice(id)
  });
}, [executeDeleteBasePrice]);

const confirmDeleteTerminal = useCallback((id) => {
  setConfirmModal({
    isOpen: true,
    title: 'Delete Terminal?',
    message: 'Are you sure you want to delete this terminal? This action cannot be undone.',
    onConfirm: () => executeDeleteTerminal(id)
  });
}, [executeDeleteTerminal]);

  const executeDeleteCustomer = useCallback(async (id) => {
    if(!user || !companyId || !id) return;
    try { await deleteDoc(doc(db, 'companies', companyId, 'customers', id)); if (isMountedRef.current) setCopyFeedback("Customer deleted"); }
    catch (error) { console.error("Error deleting customer:", error); if (isMountedRef.current) setCopyFeedback("Failed to delete customer"); }
  }, [user, companyId, setCopyFeedback, isMountedRef]);

  const executeDeleteLocation = useCallback(async (id) => {
    if(!user || !companyId || !id) return;
    try { await deleteDoc(doc(db, 'companies', companyId, 'locations', id)); if (isMountedRef.current) setCopyFeedback("Location deleted"); }
    catch (error) { console.error("Error deleting location:", error); if (isMountedRef.current) setCopyFeedback("Failed to delete location"); }
  }, [user, companyId, setCopyFeedback, isMountedRef]);

  const executeDeleteDriver = useCallback(async (id) => {
    if(!user || !companyId || !id) return;
    try { await deleteDoc(doc(db, 'companies', companyId, 'drivers', id)); if (isMountedRef.current) setCopyFeedback("Driver deleted"); }
    catch (error) { console.error("Error deleting driver:", error); if (isMountedRef.current) setCopyFeedback("Failed to delete driver"); }
  }, [user, companyId, setCopyFeedback, isMountedRef]);

  const executeDeleteLoad = useCallback(async (id) => {
  if (!user || !companyId || !id) return;
  try {
    const loadRef = doc(db, 'companies', companyId, 'loads', id);
    const loadSnap = await getDoc(loadRef);
    
    let driverIds = [];
    
    if (loadSnap.exists()) {
      const loadData = loadSnap.data();
      const legs = loadData.legs || [];
      
      // ✅ CHANGE: Mark as Completed/Closed instead of actually deleting
      await updateDoc(loadRef, {
        status: 'Completed',
        deletedAt: new Date().toISOString(),
        deletedBy: userEmail || user?.email || 'Unknown',
        isDeleted: true  // ✅ NEW FLAG to indicate soft deletion
      });
      
      // Get all drivers assigned to this load
      for (const leg of legs) {
        if (leg.driverName) {
          const driversQuery = query(
            collection(db, 'companies', companyId, 'drivers'),
            where('name', '==', leg.driverName)
          );
          const driversSnap = await getDocs(driversQuery);
          driversSnap.forEach(doc => {
            if (!driverIds.includes(doc.id)) {
              driverIds.push(doc.id);
            }
          });
        }
      }
      
            // ✅ CRITICAL: Reset all assigned drivers AND clean up assignedContainers
      for (const driverId of driverIds) {
        const driverRef = doc(db, 'companies', companyId, 'drivers', driverId);
        const driverSnap = await getDoc(driverRef);
        
        if (driverSnap.exists()) {
          const driverData = driverSnap.data();
          const existingContainers = driverData.assignedContainers || [];
          
          // ✅ Remove the deleted load's container from assignedContainers
          const updatedContainers = existingContainers.filter(
            c => c.loadId !== id  // Filter OUT the deleted load
          );
          
          await updateDoc(driverRef, {
            assignedContainers: updatedContainers,
            tripStatus: updatedContainers.length > 0 ? driverData.tripStatus : 'Idle',
            currentContainerNo: updatedContainers.length > 0 ? (updatedContainers[updatedContainers.length - 1].containerNo) : null,
            currentLoadId: updatedContainers.length > 0 ? (updatedContainers[updatedContainers.length - 1].loadId) : null,
            currentWorkOrderNo: updatedContainers.length > 0 ? (updatedContainers[updatedContainers.length - 1].workOrderNo) : null,
            currentCustomerName: updatedContainers.length > 0 ? (updatedContainers[updatedContainers.length - 1].customerName) : null,
            lastTripUpdate: new Date().toISOString()
          });
          
          console.log(`✅ Removed load ${id} from driver ${driverData.name}'s assignedContainers. Remaining: ${updatedContainers.length}`);
        }
      }
      
      // ✅ Release chassis if assigned
      if (loadData.chassisNumber && loadData.chassisNumber.trim()) {
        try {
          const chassisQuery = query(
            collection(db, 'companies', companyId, 'chassis'),
            where('name', '==', loadData.chassisNumber.trim())
          );
          const chassisSnap = await getDocs(chassisQuery);
          if (!chassisSnap.empty) {
            const chassisDoc = chassisSnap.docs[0];
            await updateDoc(doc(db, 'companies', companyId, 'chassis', chassisDoc.id), {
              status: 'Available',
              location: 'Inside',
              currentLoadId: null,
              lastUpdated: new Date().toISOString()
            });
          }
        } catch (chassisError) {
          console.error('Error releasing chassis:', chassisError);
        }
      }
      
      // ✅ Immediately remove from local state (optimistic update)
      setLoadsToday(prev => prev.filter(l => l.id !== id));
      setLoadsOpen(prev => prev.filter(l => l.id !== id));
      setPaginatedLoads(prev => prev.filter(l => l.id !== id));
      setRevenueLoads(prev => prev.filter(l => l.id !== id));
      setAssignmentLoads(prev => prev.filter(l => l.id !== id));
      
      if (isMountedRef.current) setCopyFeedback("✅ Load closed and drivers reset");
    }
  } catch (error) {
    console.error('Delete error:', error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to close load");
  }
}, [user, companyId, userEmail, setCopyFeedback, isMountedRef, setLoadsToday, setLoadsOpen, setPaginatedLoads, setRevenueLoads, setAssignmentLoads]);
  // ===== FAST BATCH SOFT DELETE FOR LOADS (marks as Completed, 500 per batch) =====
  const batchSoftDeleteLoads = async (ids) => {
    const CHUNK_SIZE = 500;
    let successCount = 0;
    let failCount = 0;
    const now = new Date().toISOString();
    const deletedBy = userEmail || user?.email || 'Unknown';

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      try {
        const batch = writeBatch(db);
        chunk.forEach(id => {
          const ref = doc(db, 'companies', companyId, 'loads', id);
          batch.update(ref, {
            status: 'Completed',
            deletedAt: now,
            deletedBy: deletedBy,
            isDeleted: true
          });
        });
        await batch.commit();
        successCount += chunk.length;
        setCopyFeedback(`⏳ Deleting... ${successCount}/${ids.length}`);
      } catch (err) {
        console.error(`Batch soft-delete failed:`, err);
        failCount += chunk.length;
      }
    }

    return { successCount, failCount };
  };

// Add this after executeDeleteLoad function
const resetOrphanedDrivers = useCallback(async () => {
  if (!user || !companyId) return;
  if (!isAdmin) {
    setCopyFeedback("❌ Only admins can reset orphaned drivers");
    return;
  }
  
  try {
    setCopyFeedback("🔄 Checking for orphaned driver assignments...");
    
    // Get all active loads (including Open, Ready for Billing, etc.)
    const activeLoadsQuery = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', ['Open', 'Ready for Billing', 'Invoiced', 'Dispatched', 'In Transit', 'Delivered']),
      limit(200)
    );
    const activeLoadsSnap = await getDocs(activeLoadsQuery);
    
    // Build a map of active load IDs and also check which drivers are in legs
    const activeLoadIds = new Set();
    const driversInActiveLoads = new Set();
    
    activeLoadsSnap.docs.forEach(doc => {
      const loadData = doc.data();
      activeLoadIds.add(doc.id);
      (loadData.legs || []).forEach(leg => {
        if (leg.driverName) {
          driversInActiveLoads.add(leg.driverName);
        }
      });
    });
    
    // Get all drivers
    const driversQuery = query(collection(db, 'companies', companyId, 'drivers'));
    const driversSnap = await getDocs(driversQuery);
    
    let resetCount = 0;
    for (const driverDoc of driversSnap.docs) {
      const driverData = driverDoc.data();
      
      // Check if driver has a currentLoadId but it's not active
      if (driverData.currentLoadId && !activeLoadIds.has(driverData.currentLoadId)) {
        // Driver is assigned to a load that no longer exists or is closed
        await updateDoc(driverDoc.ref, {
          tripStatus: 'Idle',
          currentContainerNo: null,
          currentLoadId: null,
          currentWorkOrderNo: null,
          currentCustomerName: null,
          lastTripUpdate: new Date().toISOString()
        });
        resetCount++;
        console.log(`✅ Reset orphaned driver: ${driverData.name}`);
      }
      
      // Check if driver has a status but no active loads
      if (driverData.tripStatus !== 'Idle' && !driversInActiveLoads.has(driverData.name)) {
        // Driver is marked as busy but has no active loads
        const activeLoadsForDriver = activeLoadsSnap.docs.some(doc => {
          const loadData = doc.data();
          return (loadData.legs || []).some(leg => leg.driverName === driverData.name);
        });
        
        if (!activeLoadsForDriver) {
          await updateDoc(driverDoc.ref, {
            tripStatus: 'Idle',
            currentContainerNo: null,
            currentLoadId: null,
            currentWorkOrderNo: null,
            currentCustomerName: null,
            lastTripUpdate: new Date().toISOString()
          });
          resetCount++;
          console.log(`✅ Reset driver ${driverData.name} - no active loads found`);
        }
      }
    }
    
    setCopyFeedback(`✅ Reset ${resetCount} orphaned driver(s)`);
  } catch (error) {
    console.error('Error resetting orphaned drivers:', error);
    setCopyFeedback("❌ Failed to reset orphaned drivers");
  }
}, [user, companyId, isAdmin, setCopyFeedback]);

const VALID_STATUS_TRANSITIONS = {
  'Open': ['Planned', 'Dispatched', 'Ready for Billing', 'Invoiced', 'Paid', 'Completed'],
  'Planned': ['Open', 'Dispatched', 'Ready for Billing', 'Invoiced', 'Paid', 'Completed'],
  'Dispatched': ['Open', 'Planned', 'In Transit', 'Ready for Billing', 'Invoiced', 'Paid', 'Completed'],
  'In Transit': ['Open', 'Planned', 'Dispatched', 'Delivered', 'Ready for Billing', 'Invoiced', 'Paid', 'Completed'],
  'Delivered': ['Open', 'Planned', 'Dispatched', 'In Transit', 'Ready for Billing', 'Invoiced', 'Paid', 'Completed'],
  'Ready for Billing': ['Open', 'Invoiced', 'Paid', 'Completed'],
  'Invoiced': ['Open', 'Ready for Billing', 'Paid', 'Completed'],
  'Paid': ['Open', 'Ready for Billing', 'Invoiced', 'Completed'],
  'Completed': ['Open', 'Ready for Billing', 'Invoiced', 'Paid']
};

const quickUpdateStatus = useCallback(async (loadId, newStatus) => {
  if (!user || !companyId || !loadId) return;
  const currentLoad = [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === loadId);
  if (!currentLoad) return;
 
// ✅ ALLOW ANY STATUS CHANGE - No restrictions
// Users can change from any status to any other status anytime
 
  const now = new Date().toISOString();
  const cappedLog = (currentLoad.auditLog || []).slice(-49);
  const newAuditLog = [...cappedLog, { timestamp: now, user: userEmail || user.email || 'Unknown User', role: userRole, action: 'Status Update', changes: [{ field: 'status', from: currentLoad.status, to: newStatus }] }];
  try {
    await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), {
      status: newStatus,
      updatedAt: now,
      auditLog: newAuditLog
    });
    
    // ✅ ADD THIS: Auto-reset drivers if status is "Completed"
    if (newStatus === 'Completed') {
      const loadSnap = await getDoc(doc(db, 'companies', companyId, 'loads', loadId));
      if (loadSnap.exists()) {
        const loadData = loadSnap.data();
        const legs = loadData.legs || [];
        const driverNames = [...new Set(legs.map(l => l.driverName).filter(Boolean))];
        
        for (const driverName of driverNames) {
          try {
            const driverQuery = query(
              collection(db, 'companies', companyId, 'drivers'),
              where('name', '==', driverName)
            );
            const driverSnap = await getDocs(driverQuery);
            if (!driverSnap.empty) {
              const driverDoc = driverSnap.docs[0];
              const driverData = driverDoc.data();
              const existingContainers = driverData.assignedContainers || [];
              
              // Remove this completed load from assignedContainers
              const updatedContainers = existingContainers.filter(
                c => c.loadId !== loadId
              );
              
              await updateDoc(driverDoc.ref, {
                assignedContainers: updatedContainers,
                tripStatus: updatedContainers.length > 0 ? 'Dispatched' : 'Idle',
                currentContainerNo: updatedContainers.length > 0 ? updatedContainers[updatedContainers.length - 1].containerNo : null,
                currentLoadId: updatedContainers.length > 0 ? updatedContainers[updatedContainers.length - 1].loadId : null,
                currentWorkOrderNo: null,
                currentCustomerName: null,
                lastTripUpdate: new Date().toISOString()
              });
              console.log(`✅ Auto-reset driver ${driverName} - load ${loadId} completed. Remaining: ${updatedContainers.length}`);
            }
          } catch (driverResetError) {
            console.error('Error resetting driver:', driverResetError);
          }
        }
        
        // Release chassis if assigned
        if (loadData.chassisNumber && loadData.chassisNumber.trim()) {
          try {
            const chassisQuery = query(
              collection(db, 'companies', companyId, 'chassis'),
              where('name', '==', loadData.chassisNumber.trim())
            );
            const chassisSnap = await getDocs(chassisQuery);
            if (!chassisSnap.empty) {
              const chassisDoc = chassisSnap.docs[0];
              const chassisData = chassisDoc.data();
              const currentHistory = chassisData.history || [];
              const updatedHistory = [
                { 
                  action: 'Released from completed load', 
                  loadId: loadId, 
                  containerNo: loadData.containerNo || 'N/A',
                  timestamp: new Date().toISOString() 
                },
                ...currentHistory
              ].slice(0, 10);
              
              await updateDoc(doc(db, 'companies', companyId, 'chassis', chassisDoc.id), {
                status: 'Available',
                location: 'Inside',
                currentLoadId: null,
                history: updatedHistory,
                lastUpdated: new Date().toISOString()
              });
              console.log(`✅ Chassis ${loadData.chassisNumber} released from completed load ${loadId}`);
            }
          } catch (chassisError) {
            console.error('Error releasing chassis:', chassisError);
          }
        }
      }
    }
    
    // ✅ OPTIMISTIC UI UPDATE: Immediately update local state
    // Update paginatedLoads
    setPaginatedLoads(prev => prev.map(load => 
      load.id === loadId ? { ...load, status: newStatus } : load
    ));
    
    // Also update other states to keep them consistent
    setLoadsToday(prev => prev.map(load => 
      load.id === loadId ? { ...load, status: newStatus } : load
    ));
    setLoadsOpen(prev => prev.map(load => 
      load.id === loadId ? { ...load, status: newStatus } : load
    ));
    setRevenueLoads(prev => prev.map(load => 
      load.id === loadId ? { ...load, status: newStatus } : load
    ));
    setAssignmentLoads(prev => prev.map(load => 
      load.id === loadId ? { ...load, status: newStatus } : load
    ));
    
    // ✅ If we're on the billing tab, refresh the data from Firestore
    // to ensure consistency (but also keep the optimistic update)
    if (activeTab === 'billing') {
      // Use setTimeout to avoid blocking the UI update
      setTimeout(() => {
        fetchPaginatedLoads(true);
      }, 300);
    }
    
    if (isMountedRef.current) setCopyFeedback(`✅ Moved to ${newStatus}`);
  } catch (error) {
    console.error("Error updating status:", error);
    if (isMountedRef.current) setCopyFeedback("❌ Failed to update status");
  }
}, [user, companyId, loadsToday, loadsOpen, paginatedLoads, userEmail, userRole, setCopyFeedback, isMountedRef, activeTab, fetchPaginatedLoads]);

  const handleUpdateStatus = useCallback(async (loadId, newTrackingStatus) => {
    if (!user || !companyId || !loadId) return;
    try { await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), { lastTrackingStatus: newTrackingStatus, updatedAt: new Date().toISOString() }); if (isMountedRef.current) setCopyFeedback("Tracking updated"); }
    catch (error) { console.error("Error updating tracking status:", error); if (isMountedRef.current) setCopyFeedback("Failed to update tracking"); }
  }, [user, companyId, setCopyFeedback, isMountedRef]);

  const handleSignLeg = useCallback(async (signatureData) => {
    if (!user || !signingContext || !companyId) return;
    const { loadId, legId, arrivalTime, departureTime, receiverName } = signingContext;
    const currentLoad = [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === loadId);
    if (!currentLoad) return;
    const updatedLegs = getSafeLegs(currentLoad).map(lg => lg.id === legId ? { ...lg, status: 'Completed', arrivalTime, departureTime, receiverName, signature: signatureData } : lg);
    
    // Check if ALL legs are now completed
    const allLegsCompleted = updatedLegs.length > 0 && updatedLegs.every(leg => 
      leg.status === 'Completed' || leg.status === 'Delivered'
    );
    const newLoadStatus = allLegsCompleted ? 'Ready for Billing' : currentLoad.status;
    
    try { 
      await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), { 
        legs: updatedLegs, 
        status: newLoadStatus,
        updatedAt: new Date().toISOString() 
      }); 
      if (isMountedRef.current) { 
        setSigningContext(null); 
        if (allLegsCompleted) {
          setCopyFeedback("✅ All legs completed! Moved to Ready for Billing");
        } else {
          setCopyFeedback("Leg Signed & Synced!");
        }
      } 
    }
    catch (error) { console.error("Error signing leg:", error); if (isMountedRef.current) setCopyFeedback("Failed to save signature"); }
  }, [user, companyId, signingContext, loadsToday, loadsOpen, paginatedLoads, setCopyFeedback, isMountedRef]);

const handleSubmitLoad = useCallback(async (formData) => {
  // ===== AUTHENTICATION CHECK =====
  if (!user || !companyId) {
    setCopyFeedback("❌ You must be logged in to save a load");
    return;
  }

  // ===== LOCATION VALIDATION =====
  if (dataSharingMode === 'separate') {
    const targetLocation = formData.locationId || currentLocation;
    if (!editingId && !targetLocation) {
      setCopyFeedback("❌ Please select a location for this load");
      return;
    }
    if (targetLocation && !userAccessibleLocations.includes(targetLocation)) {
      setCopyFeedback("❌ You don't have access to this location");
      return;
    }
    if (!formData.locationId && currentLocation) formData.locationId = currentLocation;
  }

  // ===== LOAD TYPE VALIDATION =====
  if (!formData.loadType) {
    setCopyFeedback("❌ Please select LIVE or DROP before saving this load");
    return;
  }

  // ===== FORM VALIDATION =====
  const validation = validateLoadForm(formData);
  if (!validation.valid) {
    setCopyFeedback(validation.error);
    return;
  }

  // ===== DATE FORMATTING =====
  const formatDateForStorage = (dateStr) => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {}
    return dateStr;
  };

  // Format all date fields in formData
  const formattedFormData = {
  ...formData,
  appointmentDate: formatDateForStorage(formData.appointmentDate),
  appointmentTime: formData.appointmentTime || '', // ✅ ADD THIS LINE
  prepullDate: formatDateForStorage(formData.prepullDate),
  returnDate: formatDateForStorage(formData.returnDate),
  erdDate: formatDateForStorage(formData.erdDate),
  cutoffDate: formatDateForStorage(formData.cutoffDate),
  yardStorageStartDate: formatDateForStorage(formData.yardStorageStartDate),
  yardStorageEndDate: formatDateForStorage(formData.yardStorageEndDate),
  chassisStartDate: formatDateForStorage(formData.chassisStartDate),
  chassisEndDate: formatDateForStorage(formData.chassisEndDate),
  legs: (formData.legs || []).map(leg => ({
    ...leg,
    legDate: formatDateForStorage(leg.legDate)
  }))
};

  // ===== PREPARE DATA FOR SAVING =====
  const now = new Date().toISOString();
  const { id: _ignoredId, auditLog, ...restFormData } = formattedFormData || {};
  let migratedData = migrateToLineItems(restFormData);

  if (!migratedData.currency && formattedFormData.currency) {
    migratedData.currency = formattedFormData.currency;
  }

  // Save locations asynchronously (don't wait for it)
  for (const leg of getSafeLegs(formattedFormData)) {
    if (leg.from) saveNewLocationIfNeeded(leg.from, companyId).catch(() => {});
    if (leg.to) saveNewLocationIfNeeded(leg.to, companyId).catch(() => {});
  }

  const cleanedData = {
    ...migratedData,
    legs: getSafeLegs(migratedData),
    loadConfirmation: normalizeFileRef(migratedData.loadConfirmation),
    signedPodDoc: normalizeFileRef(migratedData.signedPodDoc),
    updatedAt: now,
    locationId: dataSharingMode === 'separate' ? (formattedFormData.locationId || currentLocation) : null,
    companyId: companyId,
    loadType: formattedFormData.loadType,
    delivery: formattedFormData.delivery,
    terminal: formattedFormData.terminal,
    chassisNumber: formattedFormData.chassisNumber || '',
    prePullRate: formattedFormData.prePullRate || 0,
    prePullAmount: formattedFormData.prePullAmount || 0,
    prePullChargeAdded: formattedFormData.prePullChargeAdded || false,
    shipmentType: formattedFormData.shipmentType || 'import',
    type: formattedFormData.shipmentType || 'import',
    isGrounded: formattedFormData.isGrounded || false,
    isInYard: formattedFormData.isInYard || false,
    isInYardPrePull: formattedFormData.isInYardPrePull || false,
    isInYardReturn: formattedFormData.isInYardReturn || false,
    isDroppedAtCustomer: formattedFormData.isDroppedAtCustomer || false,
    isReadyForPickup: formattedFormData.isReadyForPickup || false,
    isTerminated: formattedFormData.isTerminated || false,
    isBillingComplete: formattedFormData.isBillingComplete || false,
    readyForPickupDate: formattedFormData.readyForPickupDate || '',
    containerStatusHistory: formattedFormData.containerStatusHistory || [],
  };

  if (!editingId) {
    cleanedData.createdAt = now;
  }

  // Remove legacy fields
  cleanedData.basePrice = "";
  cleanedData.waitingTime = "";
  cleanedData.fuelSurcharge = "";
  cleanedData.driverCost = "";
  cleanedData.fuelCost = "";
  cleanedData.brokerRate = "";

  if (!cleanedData.workOrderNo) {
    cleanedData.workOrderNo = `WO-${Math.floor(100000 + Math.random() * 900000)}`;
  }

    // ===== OPTIMIZED SAVE - INSTANT! =====
  try {
    // ✅ CHECK IF CONTAINER ALREADY EXISTS IN HISTORY (Returning Container Logic)
    let isReturningContainer = false;
    if (cleanedData.containerNo && cleanedData.containerNo !== 'N/A') {
      const containerCheckQuery = query(
        collection(db, 'companies', companyId, 'loads'),
        where('containerNo', '==', cleanedData.containerNo),
        limit(1)
      );
      const containerCheckSnap = await getDocs(containerCheckQuery);
      
      if (!containerCheckSnap.empty && (!editingId || containerCheckSnap.docs[0].id !== editingId)) {
        isReturningContainer = true;
      }
    }
        cleanedData.isReturningContainer = isReturningContainer;

    let loadRef;
    let loadId; // ✅ ADD THIS LINE HERE

    // ✅ STEP 1: SAVE THE LOAD FIRST (INSTANT)
    if (editingId) {
      loadRef = doc(db, 'companies', companyId, 'loads', editingId);
      loadId = editingId;
      await updateDoc(loadRef, cleanedData);
      setCopyFeedback("✅ Load updated instantly");
    } else {
      loadRef = doc(collection(db, 'companies', companyId, 'loads'));
      loadId = loadRef.id;
      await setDoc(loadRef, cleanedData);
      setCopyFeedback(`✅ Load saved instantly as ${cleanedData.shipmentType?.toUpperCase() || 'IMPORT'}`);
    }

    // ✅ STEP 2: IMMEDIATELY UPDATE UI (OPTIMISTIC)
    setIsFormOpen(false);
    setEditingId(null);
    
    // Instantly update local state
    const newLoad = { id: loadId, ...cleanedData };
    setLoadsOpen(prev => [newLoad, ...prev]);
    setPaginatedLoads(prev => [newLoad, ...prev]);
    
    // ✅ STEP 3: DO BACKGROUND UPDATES IN PARALLEL (DON'T WAIT)
    const backgroundTasks = [];

    // Update drivers (don't wait)
    if (cleanedData.legs && cleanedData.legs.length > 0) {
      const driverPromises = [];
      for (const leg of cleanedData.legs) {
        if (leg.driverName && leg.truckNo) {
          const driverQuery = query(
            collection(db, 'companies', companyId, 'drivers'),
            where('name', '==', leg.driverName)
          );
          const driverSnap = await getDocs(driverQuery);
          if (!driverSnap.empty) {
            const driverDoc = driverSnap.docs[0];
            const existingData = driverDoc.data();
            const existingContainers = existingData.assignedContainers || [];
            
            // Check if container already exists
            const containerExists = existingContainers.some(
              c => c.containerNo === cleanedData.containerNo
            );
            
            if (!containerExists) {
              existingContainers.push({
                containerNo: cleanedData.containerNo || 'N/A',
                workOrderNo: cleanedData.workOrderNo || 'N/A',
                customerName: cleanedData.customerName || 'N/A',
                loadId: loadId,
                from: (cleanedData.legs?.[0]?.from || 'N/A'),
                to: (cleanedData.legs?.[0]?.to || 'N/A'),
                assignedAt: new Date().toISOString()
              });
            }
            
            const driverPromise = updateDoc(doc(db, 'companies', companyId, 'drivers', driverDoc.id), {
              assignedContainers: existingContainers,
              currentContainerNo: cleanedData.containerNo || 'N/A',
              currentLoadId: loadId,
              currentWorkOrderNo: cleanedData.workOrderNo || 'N/A',
              currentCustomerName: cleanedData.customerName || 'N/A',
              tripStatus: 'Dispatched',
              lastTripUpdate: new Date().toISOString()
            }).catch(() => {}); // Silent fail in background
            driverPromises.push(driverPromise);
          }
        }
      }
      backgroundTasks.push(Promise.allSettled(driverPromises));
    }

    // ✅ ADD AUDIT ENTRY IN BACKGROUND
    const auditEntry = {
      timestamp: now,
      user: userEmail || user.email || 'Unknown User',
      role: userRole,
      action: editingId ? 'Edited Load' : 'Created Load',
      changes: []
    };
    backgroundTasks.push(
      updateDoc(loadRef, { lastAuditEntry: auditEntry }).catch(() => {})
    );

    // ✅ TRIGGER BACKGROUND REFRESH (async)
    setTimeout(() => {
      fetchPaginatedLoads(true).catch(() => {});
    }, 500);

    // ✅ DON'T WAIT for background tasks - they'll complete silently
    // This ensures the UI is responsive INSTANTLY
    
  } catch (error) {
    console.error("Error saving load:", error);
    const errorMessage = error.message || "Failed to save load";
    setCopyFeedback(`❌ ${errorMessage}`);

    if (errorMessage.includes('permission') || errorMessage.includes('denied')) {
      setCopyFeedback("❌ Permission denied. Please check your Firestore security rules.");
    }
  }
}, [user, companyId, editingId, userEmail, userRole, setCopyFeedback, setIsFormOpen, setEditingId, dataSharingMode, currentLocation, userAccessibleLocations, fetchPaginatedLoads]);

// ========== QUICK DRIVER ASSIGNMENT ==========
const quickAssignDriver = useCallback(async (loadId, legId, driverName, truckNo) => {
  if (!user || !companyId || !loadId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
  
  try {
    const loadRef = doc(db, 'companies', companyId, 'loads', loadId);
    const loadSnap = await getDoc(loadRef);
    
    if (!loadSnap.exists()) {
      setCopyFeedback("❌ Load not found");
      return;
    }
    
    const loadData = loadSnap.data();
    const legs = loadData.legs || [];
    const updatedLegs = legs.map(leg => {
      if (leg.id === legId) {
        return {
          ...leg,
          driverName: driverName,
          truckNo: truckNo,
          status: 'Dispatched' // Auto-set to Dispatched when driver assigned
        };
      }
      return leg;
    });
    
    await updateDoc(loadRef, {
      legs: updatedLegs,
      updatedAt: new Date().toISOString()
    });
    
    // Also update driver status
    if (driverName) {
      const driverQuery = query(
        collection(db, 'companies', companyId, 'drivers'),
        where('name', '==', driverName)
      );
      const driverSnap = await getDocs(driverQuery);
      if (!driverSnap.empty) {
        const driverDoc = driverSnap.docs[0];
        const driverRef = doc(db, 'companies', companyId, 'drivers', driverDoc.id);
        // ✅ Get existing data first
const existingDriverData = driverSnap.docs[0].data();
const existingContainers = existingDriverData.assignedContainers || [];

// ✅ Check if this container already exists
const containerExists = existingContainers.some(
  c => c.containerNo === (loadData.containerNo || 'N/A')
);

if (!containerExists) {
  existingContainers.push({
    containerNo: loadData.containerNo || 'N/A',
    workOrderNo: loadData.workOrderNo || 'N/A',
    customerName: loadData.customerName || 'N/A',
    loadId: loadId,
    from: legId ? (updatedLegs.find(l => l.id === legId)?.from || 'N/A') : 'N/A',
    to: legId ? (updatedLegs.find(l => l.id === legId)?.to || 'N/A') : 'N/A',
    assignedAt: new Date().toISOString()
  });
}

await updateDoc(driverRef, {
  assignedContainers: existingContainers,
  tripStatus: 'Dispatched',
  currentLoadId: loadId,
  currentContainerNo: loadData.containerNo || 'N/A',
  currentWorkOrderNo: loadData.workOrderNo || 'N/A',
  currentCustomerName: loadData.customerName || 'N/A',
  lastTripUpdate: new Date().toISOString()
});
      }
    }
    
    // Refresh data to show changes
    if (activeTab === 'loads' || activeTab === 'summary') {
      await fetchPaginatedLoads(true);
    }
    
    setCopyFeedback(`✅ Driver ${driverName} assigned to ${loadData.containerNo || 'load'}`);
  } catch (error) {
    console.error("Quick assign error:", error);
    setCopyFeedback("❌ Failed to assign driver");
  }
}, [user, companyId, setCopyFeedback, activeTab, fetchPaginatedLoads]);


  const handleImportData = useCallback(async (file, importType) => {
  setIsImporting(true);
  try {
    let imported = 0;
    let errors = [];
   
    if (importType === 'loads') {
      const result = await importExcelData(file, companyId, setCopyFeedback);
     
      // Track unique entries to avoid duplicates
      const uniqueCustomers = new Map();
      const uniqueLocations = new Map();
      const uniqueDrivers = new Map();
     
      for (const load of result.loads) {
        try {
          const cleanedData = { ...load, legs: getSafeLegs(load), loadConfirmation: null, signedPodDoc: null, auditLog: load.auditLog || [], companyId: companyId };
          await addDoc(collection(db, 'companies', companyId, 'loads'), cleanedData);
          imported++;
         
          // Collect unique customers
          if (load.customerName) {
            const key = load.customerName.toLowerCase().trim();
            if (!uniqueCustomers.has(key)) {
              uniqueCustomers.set(key, {
                name: load.customerName,
                email: load.customerEmail || '',
                phone: load.customerPhone || '',
                address: load.customerAddress || '',
                companyId: companyId
              });
            }
          }
         
          // Collect unique locations from legs
          (load.legs || []).forEach(leg => {
            if (leg.from) {
              const key = leg.from.toLowerCase().trim();
              if (!uniqueLocations.has(key)) {
                uniqueLocations.set(key, {
                  name: leg.from.split(' - ')[0],
                  address: leg.from,
                  companyId: companyId
                });
              }
            }
            if (leg.to) {
              const key = leg.to.toLowerCase().trim();
              if (!uniqueLocations.has(key)) {
                uniqueLocations.set(key, {
                  name: leg.to.split(' - ')[0],
                  address: leg.to,
                  companyId: companyId
                });
              }
            }
          });
         
          // Collect unique drivers
          (load.legs || []).forEach(leg => {
            if (leg.driverName) {
              const key = leg.driverName.toLowerCase().trim();
              if (!uniqueDrivers.has(key)) {
                uniqueDrivers.set(key, {
                  name: leg.driverName,
                  truckNo: leg.truckNo || '',
                  companyId: companyId
                });
              }
            }
          });
         
        } catch (err) { errors.push({ error: err.message }); }
      }
     
      // Auto-save unique customers
      let savedCustomers = 0;
      for (const customer of uniqueCustomers.values()) {
        try {
          await addDoc(collection(db, 'companies', companyId, 'customers'), customer);
          savedCustomers++;
        } catch (err) { /* skip duplicates */ }
      }
     
      // Auto-save unique locations
      let savedLocations = 0;
      for (const location of uniqueLocations.values()) {
        try {
          await addDoc(collection(db, 'companies', companyId, 'locations'), location);
          savedLocations++;
        } catch (err) { /* skip duplicates */ }
      }
     
      // Auto-save unique drivers
      let savedDrivers = 0;
      for (const driver of uniqueDrivers.values()) {
        try {
          await addDoc(collection(db, 'companies', companyId, 'drivers'), driver);
          savedDrivers++;
        } catch (err) { /* skip duplicates */ }
      }
     
      setCopyFeedback(`✅ Imported ${imported} loads, ${savedCustomers} customers, ${savedLocations} locations, ${savedDrivers} drivers!`);
    }
   
    setCopyFeedback(`✅ Imported ${imported} ${importType} successfully!`);
    setIsImportModalOpen(false);
    return { success: true, imported, errors: errors.length };
  } catch (error) {
    console.error("Import failed:", error);
    setCopyFeedback(`❌ Import failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    setIsImporting(false);
  }
}, [companyId, setCopyFeedback]);

  // ========== OTHER HANDLERS ==========
  const handleDraftEmail = useCallback((load) => {
    const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
    const total = calculateTotal(load);
    const template = `Dear ${load?.customerName || 'Customer'},\n\nPlease find attached the invoice for the following shipment:\n\nInvoice Details:\n- Container: ${load?.containerNo || 'N/A'}\n- PO Number: ${load?.poNumber || 'N/A'}\n- Reference: ${load?.customerRefNo || 'N/A'}\n- Amount Due: ${currencySymbol}${total}\n\nPlease confirm receipt of this invoice.\n\nThank you for your business.\n\nBest regards,\n${companyName || 'Company'} Dispatch Team`;
    setDraftEmail({ isOpen: true, content: template, load: load });
  }, [companyName]);

  const handleSendEmail = useCallback((finalContent) => {
    const now = Date.now(); if (now - lastEmailTimeRef.current < EMAIL_COOLDOWN_MS) { setCopyFeedback("❌ Please wait before sending another email"); return; }
    lastEmailTimeRef.current = now; const load = draftEmail.load;
    if (!load || !load.customerEmail) { setCopyFeedback("❌ No customer email found"); return; }
    if (!isValidEmail(load.customerEmail)) { setCopyFeedback("❌ Invalid customer email format"); return; }
    if (!["owner", "admin", "accounting"].includes(userRole)) { setCopyFeedback("❌ Only Admin or Accounting can send invoices"); return; }
    const sanitizedContent = sanitizeEmailContent(finalContent);
    let emailContent = sanitizedContent; emailContent += "\n\n" + "─".repeat(60) + "\n📎 SHIPMENT DOCUMENTS\n" + "─".repeat(60) + "\n\n";
    let hasDocuments = false;
    if (load.loadConfirmation?.url) { emailContent += `📄 LOAD CONFIRMATION:\n${load.loadConfirmation.url}\n\n`; hasDocuments = true; }
    if (load.signedPodDoc?.url) { emailContent += `✍️ SIGNED PROOF OF DELIVERY (POD):\n${load.signedPodDoc.url}\n\n`; hasDocuments = true; }
    emailContent += hasDocuments ? "💡 Simply click the links above to view or download the documents.\n\n" : "⚠️ No documents have been uploaded for this shipment yet.\n\n";
    emailContent += "─".repeat(60) + `\nThank you for your business!\n${companyName || 'Nexdray TMS'}`;
    const subject = `Invoice for ${load.containerNo || 'Shipment'} - ${load.workOrderNo || ''}`;
    const fullEmail = `To: ${load.customerEmail}\nSubject: ${subject}\n\n${emailContent}`;
    copyToClipboard(fullEmail);
    setCopyFeedback("📋 Email content copied! Open Gmail/Outlook and paste (Ctrl+V)");
    setDraftEmail({ ...draftEmail, isOpen: false });
  }, [draftEmail, userRole, setCopyFeedback, companyName]);

  // ========== BILLING APPROVAL ==========
const handleApproveBilling = useCallback(async (loadId) => {
  if (!user || !companyId || !loadId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
  try {
    // Reserve an invoice number (don't create invoice doc yet)
    const generateInvoiceNumber = async () => {
      const year = new Date().getFullYear();
      const counterRef = doc(db, 'companies', companyId, 'counters', 'invoices');
      let nextSequence = 1;
      try {
        const counterSnap = await getDoc(counterRef);
        if (counterSnap.exists()) {
          const data = counterSnap.data();
          if (data.year === year) {
            nextSequence = data.sequence + 1;
            await updateDoc(counterRef, { sequence: nextSequence, updatedAt: new Date().toISOString() });
          } else {
            nextSequence = 1;
            await updateDoc(counterRef, { year, sequence: nextSequence, updatedAt: new Date().toISOString() });
          }
        } else {
          await setDoc(counterRef, { year, sequence: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        }
      } catch (error) {
        console.error('Counter error:', error);
        nextSequence = Math.floor(Math.random() * 9000) + 1000;
      }
      return `INV-${year}-${String(nextSequence).padStart(4, '0')}`;
    };

    const invoiceNumber = await generateInvoiceNumber();
    
    // ✅ Just mark as approved — DO NOT create invoice doc here
    const loadRef = doc(db, 'companies', companyId, 'loads', loadId);
    await updateDoc(loadRef, {
      billingApproved: true,
      billingApprovedAt: new Date().toISOString(),
      billingApprovedBy: userEmail || user?.email || 'Unknown',
      invoiceNumber,              // Reserved number
      status: 'Approved',         // ✅ Moves to Approved
      updatedAt: new Date().toISOString()
    });
    
    setCopyFeedback(`✅ Charges approved! Invoice #${invoiceNumber} reserved`);
    if (activeTab === 'billing') await fetchPaginatedLoads(true);
  } catch (error) {
    console.error("Approval error:", error);
    setCopyFeedback("❌ Failed to approve billing");
  }
}, [user, companyId, userEmail, setCopyFeedback, activeTab, fetchPaginatedLoads]);

// ✅ NEW — Creates the FULL invoice from the load's data
const handleGenerateInvoice = useCallback(async (loadId) => {
  if (!user || !companyId || !loadId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
  try {
    const loadSnap = await getDoc(doc(db, 'companies', companyId, 'loads', loadId));
    if (!loadSnap.exists()) {
      setCopyFeedback("❌ Load not found");
      return;
    }
    const load = loadSnap.data();

    // Build items from load's revenue
    const items = (load.revenueItems || []).map(item => ({
      item: item.item || 'Service',
      details: '',
      qty: safeFloat(item.qty || 1),
      uom: 'RATE',
      rate: safeFloat(item.rate),
      amount: safeFloat(item.amount),
      tax: 0,
    }));

    if (items.length === 0) {
      items.push({
        item: 'Freight Charge',
        details: '',
        qty: 1,
        uom: 'RATE',
        rate: safeFloat(calculateTotal(load)),
        amount: safeFloat(calculateTotal(load)),
        tax: 0,
      });
    }

    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const taxes = 0;
    const total = subtotal + taxes;

    const today = new Date().toISOString().split('T')[0];
    const dueObj = new Date(today);
    dueObj.setDate(dueObj.getDate() + 30);
    const dueDate = dueObj.toISOString().split('T')[0];

    // Get customer info
    let customer = null;
    if (load.customerName) {
      const custQuery = query(
        collection(db, 'companies', companyId, 'customers'),
        where('name', '==', load.customerName),
        limit(1)
      );
      const custSnap = await getDocs(custQuery);
      if (!custSnap.empty) customer = custSnap.docs[0].data();
    }

    const invoiceNumber = load.invoiceNumber || `INV-${new Date().getFullYear()}-${Math.floor(Math.random()*9000)+1000}`;

    const invoiceData = {
      companyId,
      invoiceNumber,
      loadId,
      containerNo: load.containerNo || 'N/A',
      workOrderNo: load.workOrderNo || 'N/A',
      customerName: load.customerName || 'N/A',
      customerEmail: customer?.email || load.customerEmail || '',
      customerAddress: customer?.address || load.customerAddress || '',
      billTo: customer?.name || load.customerName || 'N/A',
      salesRep: load.billingApprovedBy || userEmail || 'N/A',
      currency: load.currency || 'CAD',
      paymentTerms: 'NET 30',
      type: 'Invoice',
      items,
      subtotal,
      taxes,
      total,
      status: 'Draft',
      invoiceDate: today,
      dueDate,
      billingApprovedBy: load.billingApprovedBy || 'N/A',
      billingApprovedAt: load.billingApprovedAt || null,
      createdAt: new Date().toISOString(),
      createdBy: userEmail || 'N/A',
    };

    // Check if invoice doc already exists (handles old stub docs)
    const existingQuery = query(
      collection(db, 'companies', companyId, 'invoices'),
      where('loadId', '==', loadId),
      limit(1)
    );
    const existingSnap = await getDocs(existingQuery);

    let invoiceDocId;
    if (!existingSnap.empty) {
      invoiceDocId = existingSnap.docs[0].id;
      await updateDoc(doc(db, 'companies', companyId, 'invoices', invoiceDocId), invoiceData);
    } else {
      const ref = await addDoc(collection(db, 'companies', companyId, 'invoices'), invoiceData);
      invoiceDocId = ref.id;
    }

    // Update load status
    await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), {
      status: 'Invoiced',
      invoiceId: invoiceDocId,
      invoiceNumber,
      updatedAt: new Date().toISOString(),
    });

    setCopyFeedback(`✅ Invoice ${invoiceNumber} generated! Go to Invoices tab to send.`);
    if (activeTab === 'billing') await fetchPaginatedLoads(true);
  } catch (error) {
    console.error('Generate invoice error:', error);
    setCopyFeedback("❌ Failed to generate invoice: " + error.message);
  }
}, [user, companyId, userEmail, setCopyFeedback, activeTab, fetchPaginatedLoads]);

// ✅ NEW — Opens the invoice from History tab
const handleEditInvoiceFromHistory = useCallback((load) => {
  if (!load?.id) return;
  setPendingInvoiceLoadId(load.id);   // Pass load ID; InvoicesModule finds the invoice by loadId
  setActiveTab('invoices');
  setCopyFeedback("📧 Opening invoice...");
}, [setCopyFeedback]);

 const handleSendInvoiceEmail = useCallback(async (load, fromEmail) => {
  // ✅ CHECK: Billing must be approved before sending
  if (!load?.billingApproved) {
    setCopyFeedback("❌ Billing must be approved before sending invoice.");
    return;
  }
  if (!load || !load.customerEmail) { setCopyFeedback("❌ No customer email found"); return; }
  if (!fromEmail) { setCopyFeedback("❌ Please provide your accounting email address"); return; }
  setCopyFeedback("Generating invoice PDF and sending...");
  try {
    // Build location-specific address
    let locationAddress = null;
    if (load.locationId) {
      const location = companyLocations.find(loc => loc.id === load.locationId);
      if (location) {
        const addressParts = [
          location.name,
          location.address,
          location.city,
          location.province,
          location.postalCode
        ].filter(Boolean);
        locationAddress = addressParts.join(', ');
      }
    }
    if (!locationAddress) {
      locationAddress = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    }
   
    // Generate PDF using the same function as downloadInvoice
    const addressStr = locationAddress;
    const currentDate = new Date().toISOString().split('T')[0];
    const currencySymbol = load?.currency === 'USD' ? 'US$' : 'C$';
   
    // Build invoice HTML (same as downloadInvoice)
    let rowsHtml = '';
    if (load.revenueItems && Array.isArray(load.revenueItems) && load.revenueItems.length > 0) {
      load.revenueItems.forEach(item => {
        if (safeFloat(item?.amount) > 0 || safeFloat(item?.rate) > 0) {
          rowsHtml += `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">${sanitizeInput(item.item || 'Service Charge')}</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.qty || 1}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${safeFloat(item.rate).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">${currencySymbol}${safeFloat(item.amount).toFixed(2)}</td></tr>`;
        }
      });
    }
   
    /// Professional invoice HTML (same as downloadInvoice)
    const invoiceContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #111827; background: #fff; line-height: 1.4; box-sizing: border-box; width: 100%;">
        <style>
          * { box-sizing: border-box; }
          .flex { display: flex; }
          .justify-between { justify-content: space-between; }
          .gap-4 { gap: 16px; }
          .w-1-2 { width: 50%; }
          .text-right { text-align: right; }
          .mb-8 { margin-bottom: 32px; }
          .font-bold { font-weight: 700; }
          .font-black { font-weight: 900; }
          .text-blue { color: #1d4ed8; }
          .text-gray { color: #9ca3af; }
          .text-xs { font-size: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; }
          .text-base { font-size: 13px; }
          .text-2xl { font-size: 26px; letter-spacing: -0.5px; }
          .divider { border-bottom: 3px solid #111827; margin: 15px 0 25px 0; }
          .section-title { font-weight: 900; font-size: 12px; color: #1f2937; margin-bottom: 12px; display: flex; align-items: center; }
          .section-title::before { content: ''; display: inline-block; width: 4px; height: 14px; background-color: #1d4ed8; margin-right: 8px; }
          .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; background: #f9fafb; }
          .meta-table { width: auto; margin-left: auto; border-collapse: collapse; }
          .meta-table td { padding: 4px 8px; font-size: 11px; }
          .meta-table .label { font-weight: 800; text-align: right; text-transform: uppercase; color: #4b5563; }
          .meta-table .value { font-weight: 800; text-align: right; color: #111827; }
          .invoice-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          .invoice-table th { background: #f3f4f6; border-bottom: 2px solid #d1d5db; padding: 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #4b5563;}
          .invoice-table td { color: #111827; }
          .totals-box { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
          .totals-row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
          .totals-row.grand { background: #1d4ed8; color: #fff; border-bottom: none; }
          .totals-row.grand .label, .totals-row.grand .value { color: #fff; font-weight: 900; font-size: 16px; }
        </style>
        <div class="flex justify-between" style="align-items: flex-start;">
          <div><div class="text-2xl font-black text-blue mb-2">${sanitizeInput(companyName || 'Company Name')}</div><div style="color: #374151;">${sanitizeInput(addressStr)}</div>${companyDetails?.phone ? `<div style="color: #374151;">Tel: ${sanitizeInput(companyDetails.phone)}</div>` : ''}${companyDetails?.email ? `<div style="color: #374151;">Email: ${sanitizeInput(companyDetails.email)}</div>` : ''}</div>
                    <div class="text-right">
            ${companyDetails?.logoUrl ? `<img src="${sanitizeInput(companyDetails.logoUrl)}" style="max-height: 60px; max-width: 200px; margin-bottom: 10px; margin-left: auto; display: block;" alt="Company Logo" />` : ''}
            <div class="text-2xl font-black text-gray mb-2">INVOICE</div>
            <table class="meta-table"><tr><td class="label">INVOICE #</td><td class="value">${sanitizeInput(load.workOrderNo || String(load.id || '').substring(0,8).toUpperCase())}</td></tr><tr><td class="label">DATE</td><td class="value">${currentDate}</td></tr><tr><td class="label">PO #</td><td class="value">${sanitizeInput(load.poNumber || 'N/A')}</td></tr><tr><td class="label">CURRENCY</td><td class="value">${load.currency || 'CAD'}</td></tr><tr><td class="label">TERMS</td><td class="value">Due on Receipt</td></tr></table></div>
        </div>
        <div class="divider"></div>
        <div class="flex gap-4 mb-8">
          <div class="w-1-2"><div class="section-title">BILL TO</div><div class="card" style="height: 120px; background: #fff;"><div class="font-black text-base mb-1">${sanitizeInput(load.customerName || 'N/A')}</div><div style="color: #374151; line-height: 1.5;">${sanitizeInput(load.customerAddress || 'Address on file')}</div><div style="color: #374151; margin-top: 4px;">${sanitizeInput(load.customerEmail || '')}</div></div></div>
          <div class="w-1-2"><div class="section-title">SHIPMENT SUMMARY</div><div class="card flex" style="height: 120px; flex-wrap: wrap; gap: 15px;"><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">CONTAINER #</div><div class="font-bold">${sanitizeInput(load.containerNo || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">SIZE / TYPE</div><div class="font-bold">${sanitizeInput(load.size || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">WEIGHT</div><div class="font-bold">${sanitizeInput(load.weight || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">REF NO</div><div class="font-bold">${sanitizeInput(load.customerRefNo || 'N/A')}</div></div></div></div>
        </div>
        <table class="invoice-table"><thead><tr><th style="width: 50%;">Description</th><th style="width: 15%; text-align: center;">Qty</th><th style="width: 15%; text-align: right;">Rate</th><th style="width: 20%; text-align: right;">Amount</th></tr></thead><tbody>${rowsHtml || `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">Freight Charge</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">1</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${safeFloat(calculateTotal(load)).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">${currencySymbol}${safeFloat(calculateTotal(load)).toFixed(2)}</td></tr>`}</tbody></table>
        <div class="flex justify-between" style="margin-top: 30px; align-items: flex-start;"><div style="width: 50%; color: #6b7280; font-size: 11px; padding-right: 20px;"><p>Thank you for your business.</p><p>Please include invoice number on your check or remittance advice.</p></div><div style="width: 40%;"><div class="totals-box"><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Subtotal</span><span class="value font-bold">${currencySymbol}${calculateTotal(load)}</span></div><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Tax (0%)</span><span class="value font-bold">${currencySymbol}0.00</span></div><div class="totals-row grand"><span class="label">TOTAL DUE</span><span class="value">${currencySymbol}${calculateTotal(load)}</span></div></div></div></div>
      </div>
    `;
   
    const element = document.createElement('div');
    element.innerHTML = invoiceContent;
    const pdfBlob = await html2pdf().set({ margin: 0.4, filename: `Invoice-${load.workOrderNo || 'load'}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, logging: false, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } }).from(element).outputPdf('blob');
   
    const safeFileName = `Invoice_${load.workOrderNo || 'load'}.pdf`;
    const filePath = `invoices/${companyId}/${load.id}_${Date.now()}_${safeFileName}`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' });
    const invoiceUrl = await getDownloadURL(storageRef);
    const sendFn = httpsCallable(getFunctions(), "sendInvoiceEmail");
    await sendFn({ loadData: load, fromEmail: fromEmail, companyName: companyName, invoiceUrl: invoiceUrl });
    // ✅ ADD INVOICE AUDIT TRAIL
    try {
      const loadRef = doc(db, 'companies', companyId, 'loads', load.id);
      await updateDoc(loadRef, {
        invoiceHistory: arrayUnion({
          sentAt: new Date().toISOString(),
          sentTo: load.customerEmail,
          fromEmail: fromEmail,
          invoiceUrl: invoiceUrl,
          amount: calculateTotal(load),
          status: 'sent',
          invoiceNumber: load.workOrderNo || `INV-${Date.now()}`
        }),
        lastInvoicedAt: new Date().toISOString()
      });
      setCopyFeedback("✅ Invoice email sent and tracked!");
    } catch (trackError) {
      console.error('Failed to track invoice:', trackError);
      // Don't fail - invoice was already sent
      setCopyFeedback("✅ Invoice sent! (Tracking failed - check logs)");
    }
  } catch (error) { console.error("Send invoice failed:", error); setCopyFeedback("❌ Failed to send invoice email: " + (error.message || "Unknown error")); }
}, [companyName, companyDetails, companyLocations, setCopyFeedback, storage, companyId]);

  const resetInactivityTimer = useCallback(() => { if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); if (appState === 'dashboard') { inactivityTimerRef.current = setTimeout(async () => { setCopyFeedback("⚠️ Session expired due to inactivity"); await signOut(auth); setAppState('landing'); }, INACTIVITY_TIMEOUT_MS); } }, [appState, setCopyFeedback]);

  const handleRegistrationComplete = (companyId, uid) => { setPendingCompanyId(companyId); setPendingOwnerUid(uid); setAppState('rolesetup'); };
  const handleRoleSetupComplete = useCallback(async () => {
  if (!user || !pendingCompanyId) {
    setAppState('dashboard');
    setAuthReady(true);
    return;
  }

  setCopyFeedback("");

  try {
    // Update user setupComplete to true
    await updateDoc(doc(db, 'users', user.uid), { setupComplete: true });

    // ✅ Verify the update succeeded
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists() || !userSnap.data().setupComplete) {
      throw new Error("Failed to set setupComplete");
    }

    // Fetch company data
    const companySnap = await getDoc(doc(db, 'companies', pendingCompanyId));
    if (companySnap.exists()) {
      const companyData = companySnap.data();
      setCompanyId(pendingCompanyId);
      setCompanyName(companyData.name || 'Workspace');
      setCompanyLocations(companyData.locations || []);
      setDataSharingMode(companyData.dataSharingMode || 'separate');
                  setCompanyDetails({
        address: companyData.address || '',
        city: companyData.city || '',
        phone: companyData.phone || '',
        email: companyData.email || '',
        logoUrl: companyData.logoUrl || '',
        website: companyData.website || '', // ✅ ADD THIS
        emailTemplate: companyData.emailTemplate || '', // ✅ ADD THIS
      });

      // Fetch user doc for role and locations
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setUserRole(userData.role || 'dispatcher');
        setUserAccessibleLocations(userData.accessibleLocations || []);
        setCurrentLocation(
          userData.defaultLocation ||
          (userData.accessibleLocations && userData.accessibleLocations[0]?.id) ||
          ''
        );
      }
    } else {
      console.warn("Company not found:", pendingCompanyId);
      setCopyFeedback("⚠️ Company not found. Please contact support.");
    }

    // Now mark as ready and go to dashboard
    setAuthReady(true);
    setActiveTab('summary');
    setAppState('dashboard');
    setCopyFeedback("");
  } catch (error) {
    console.error("Setup completion failed:", error);
    setCopyFeedback("❌ Failed to complete setup. Please try again.");
    setAppState('landing');
    setAuthReady(false);
  }
}, [user, pendingCompanyId, db, setCopyFeedback]);

  const confirmDeleteCustomer = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Customer?', message: 'Are you sure you want to delete this customer? This action cannot be undone.', onConfirm: () => executeDeleteCustomer(id) }); }, [executeDeleteCustomer]);
  const confirmDeleteLocation = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Location?', message: 'Are you sure you want to delete this location? This action cannot be undone.', onConfirm: () => executeDeleteLocation(id) }); }, [executeDeleteLocation]);
  const confirmDeleteDriver = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Driver?', message: 'Are you sure you want to delete this driver? This action cannot be undone.', onConfirm: () => executeDeleteDriver(id) }); }, [executeDeleteDriver]);
  const confirmDeleteLoad = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Load?', message: 'Are you sure you want to delete this load record? This action cannot be undone.', onConfirm: () => executeDeleteLoad(id) }); }, [executeDeleteLoad]);

  const handleEdit = useCallback((load) => { 
  if (load?.id) { 
    setEditingId(load.id); 
    setEditingLoadData(load); // ✅ Saves the full data
    setIsFormOpen(true); 
  } 
}, []);
  const handleCopy = useCallback((load, leg) => { copyDispatch(load, leg, setCopyFeedback); }, [setCopyFeedback]);
    const handleDownload = useCallback((load, leg) => {
    let locationAddress = null;
    if (load.locationId) {
      const location = companyLocations.find(loc => loc.id === load.locationId);
      if (location) {
        const addressParts = [
          location.name,
          location.address,
          location.city,
          location.province,
          location.postalCode
        ].filter(Boolean);
        locationAddress = addressParts.join(', ');
      }
    }
    if (!locationAddress) {
      locationAddress = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    }
    // ✅ FALLBACK
    const effectiveDetails = {
      ...companyDetails,
      address: companyDetails?.address || companyLocations?.[0]?.address || '',
      city: companyDetails?.city || companyLocations?.[0]?.city || '',
      province: companyDetails?.province || companyLocations?.[0]?.province || '',
      postalCode: companyDetails?.postalCode || companyLocations?.[0]?.postalCode || '',
    };
    downloadPOD(load, leg, setCopyFeedback, companyName, effectiveDetails, locationAddress);
  }, [setCopyFeedback, companyName, companyDetails, companyLocations]);

  // ========== DOWNLOAD DOCUMENT HELPER ==========
  const downloadDocument = (file, fileName) => {
    if (!file) {
      setCopyFeedback("❌ No document to download");
      return;
    }
   
    try {
      // If file has URL
      if (file.url) {
        const link = document.createElement('a');
        link.href = file.url;
        link.download = fileName || file.name || 'document';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setCopyFeedback(`✅ Downloading: ${fileName || file.name || 'Document'}`);
        return;
      }
     
      // If file is a data URL
      if (typeof file === 'string' && file.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = file;
        link.download = fileName || 'document.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setCopyFeedback(`✅ Downloading document`);
        return;
      }
     
      // If file is a File object
      if (file instanceof File || file.name) {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || file.name || 'document';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setCopyFeedback(`✅ Downloading: ${file.name || 'Document'}`);
        return;
      }
     
      setCopyFeedback("❌ Unable to download this document");
    } catch (error) {
      console.error("Download error:", error);
      setCopyFeedback("❌ Failed to download document");
    }
  };

  // ========== DOWNLOAD LOAD CONFIRMATION ==========
  const handleDownloadLoadConfirmation = (load) => {
    if (!load?.loadConfirmation) {
      setCopyFeedback("❌ No load confirmation uploaded");
      return;
    }
   
    const fileName = `Load_Confirmation_${load.workOrderNo || load.containerNo || 'load'}.pdf`;
    downloadDocument(load.loadConfirmation, fileName);
  };

  // ========== DOWNLOAD POD ==========
  const handleDownloadPOD = (load) => {
    if (!load?.signedPodDoc) {
      setCopyFeedback("❌ No POD uploaded");
      return;
    }
   
    const fileName = `POD_${load.workOrderNo || load.containerNo || 'load'}.pdf`;
    downloadDocument(load.signedPodDoc, fileName);
  };

    const handlePrint = useCallback((load) => {
    // Build full location address from the load's location
    let locationAddress = null;
    if (load.locationId) {
      const location = companyLocations.find(loc => loc.id === load.locationId);
      if (location) {
        const addressParts = [
          location.name,
          location.address,
          location.city,
          location.province,
          location.postalCode
        ].filter(Boolean);
        locationAddress = addressParts.join(', ');
      }
    }
    if (!locationAddress) {
      locationAddress = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    }
    // ✅ FALLBACK: Use first company location if companyDetails.address is empty
    const effectiveDetails = {
      ...companyDetails,
      address: companyDetails?.address || companyLocations?.[0]?.address || '',
      city: companyDetails?.city || companyLocations?.[0]?.city || '',
      province: companyDetails?.province || companyLocations?.[0]?.province || '',
      postalCode: companyDetails?.postalCode || companyLocations?.[0]?.postalCode || '',
    };
    downloadInvoice(load, setCopyFeedback, companyName, effectiveDetails, locationAddress);
  }, [setCopyFeedback, companyName, companyDetails, companyLocations]);


  const handleSign = useCallback((loadId, leg) => {
  if (loadId && leg?.id) {
    const extractTime = (value) => {
      if (!value) return '';
      if (typeof value === 'string' && value.match(/^\d{2}:\d{2}$/)) return value;
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toTimeString().slice(0, 5);
        }
      } catch (e) {}
      return '';
    };
   
    setSigningContext({
      loadId,
      legId: leg.id,
      arrivalTime: extractTime(leg.arrivalTime),
      departureTime: extractTime(leg.departureTime),
      receiverName: leg.receiverName || ''
    });
  }
}, []);
  const handleTrack = useCallback((load) => { if (load) setTrackingLoad(load); }, []);

const handleLeaveWorkspace = useCallback(async () => {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
  }
  if (isMountedRef.current) {
    setCompanyId(null);
    setUserRole('dispatcher');
    setAppState('landing');
    setAuthReady(false);
    setUser(null);
    setUserEmail('');
  }
}, [auth, isMountedRef]);
// ✅ PASTE resetDriverStatus HERE
const resetDriverStatus = useCallback(async (driverId) => {
  if (!user || !companyId || !driverId) {
    setCopyFeedback("❌ Missing required data");
    return;
  }
  if (!isAdmin && !isDispatcher) {
    setCopyFeedback("❌ Only dispatch can reset driver status");
    return;
  }
 
  try {
    const driverRef = doc(db, 'companies', companyId, 'drivers', driverId);
    await updateDoc(driverRef, {
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
      signature: null,
      lastTripUpdate: new Date().toISOString()
    });
    setCopyFeedback("✅ Driver status reset to Idle");
  } catch (error) {
    console.error('Reset driver error:', error);
    setCopyFeedback("❌ Failed to reset driver status");
  }
}, [user, companyId, isAdmin, isDispatcher, setCopyFeedback]);

useEffect(() => { return () => debouncedSearch.cancel && debouncedSearch.cancel(); }, [debouncedSearch]);

  const assignmentSlots = useMemo(() => {
    const slots = [{ id: 'early', label: '00:00 — 07:59', range: [0, 7] }, { id: 'morning', label: '08:00 — 09:59', range: [8, 9] }, { id: 'midday', label: '10:00 — 12:59', range: [10, 12] }, { id: 'afternoon', label: '13:00 — 15:59', range: [13, 15] }, { id: 'late', label: '16:00 — 23:59', range: [16, 23] }];
    return slots.map(slot => ({ ...slot, items: assignmentLoads.filter(l => { const hour = parseInt(String(l?.appointmentTime || '0').split(':')[0] || '0', 10); return hour >= slot.range[0] && hour <= slot.range[1]; }) }));
  }, [assignmentLoads]);

    // ===== SUBSCRIPTION GUARD - Blocks suspended companies =====
  useEffect(() => {
    if (!companyId || appState !== 'dashboard') return;
    
    const checkSubscription = async () => {
      try {
        const companySnap = await getDoc(doc(db, 'companies', companyId));
        if (companySnap.exists()) {
          const data = companySnap.data();
          if (data.paymentStatus === 'suspended' || data.subscriptionActive === false) {
            setCopyFeedback("🚫 Your account has been suspended. Please contact support to reactivate.");
            // Log out after showing the message
            setTimeout(async () => {
              if (isMountedRef.current) {
                await signOut(auth);
                setAppState('landing');
              }
            }, 5000);
          }
        }
      } catch (error) {
        console.error("Subscription check error:", error);
      }
    };
    
    // Check immediately
    checkSubscription();
    
    // Then check every 5 minutes
    const interval = setInterval(checkSubscription, 300000);
    return () => clearInterval(interval);
  }, [companyId, appState]);

    // ========== MANUAL REFRESH SYSTEM ==========
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const manualRefresh = useCallback(async () => {
    if (isRefreshing || !companyId) return;
    setIsRefreshing(true);
    try {
      // Refresh open loads
      let constraints = [
        where('status', '==', 'Open'),
        orderBy('createdAt', 'desc'),
        limit(100)
      ];
      if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
        constraints.push(where('locationId', '==', currentLocation));
      }
      const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
      const snapshot = await getDocs(q);
      setLoadsOpen(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
     
      // Refresh today's loads
      const today = new Date().toISOString().split('T')[0];
      let todayConstraints = [
        where('appointmentDate', '==', today),
        limit(50)
      ];
      if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
        todayConstraints.push(where('locationId', '==', currentLocation));
      }
      const todayQ = query(collection(db, 'companies', companyId, 'loads'), ...todayConstraints);
      const todaySnapshot = await getDocs(todayQ);
      setLoadsToday(todaySnapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
     
      setRefreshKey(prev => prev + 1);
      setCopyFeedback("✅ Data refreshed");
    } catch (error) {
      console.error("Refresh error:", error);
      setCopyFeedback("❌ Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [companyId, userRole, currentLocation, dataSharingMode, isRefreshing, setCopyFeedback]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (appState !== 'dashboard') return;
    const interval = setInterval(() => {
      manualRefresh();
    }, 60000);
    return () => clearInterval(interval);
  }, [appState, manualRefresh]);
 
// ========== AUTH STATE LISTENER (ENHANCED WITH AUTO-RECOVERY) ==========
useEffect(() => {
  let isMounted = true;
  let userDocUnsubscribe = null;
  let loadingTimeout = null;
  let retryTimeout = null;
  let unsubscribe = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  const appStateRef = { current: 'loading' };
  setAppState('loading');

  // Function to handle auth errors gracefully
  const handleAuthError = (error, message) => {
    console.error("Auth error:", error);
    if (!isMounted) return;
   
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔄 Retry ${retryCount}/${MAX_RETRIES} in 2 seconds...`);
      retryTimeout = setTimeout(() => {
        if (isMounted) {
          setCopyFeedback(`Retrying connection... (${retryCount}/${MAX_RETRIES})`);
          initializeAuth();
        }
      }, 2000);
    } else {
      setAppState('landing');
      setCopyFeedback(message || "Unable to connect. Please refresh and try again.");
      appStateRef.current = 'landing';
    }
  };

// Main auth initialization function
const initializeAuth = () => {
  if (!isMounted) return;
 
  // Clear any existing timeouts
  if (loadingTimeout) clearTimeout(loadingTimeout);
  if (retryTimeout) clearTimeout(retryTimeout);
 
  // Set timeout for loading
  loadingTimeout = setTimeout(() => {
    if (isMounted && appStateRef.current === 'loading') {
      console.error("Auth initialization timeout");
      handleAuthError(new Error("Timeout"), "Connection timed out. Please refresh.");
    }
  }, 15000);

  // Check if auth is ready
  auth.authStateReady()
    .then(() => {
      if (!isMounted) return;
      console.log("✅ Auth state ready");
     
    unsubscribe = onAuthStateChanged(auth, async (user) => {
  if (!isMounted) return;

  if (!user) {
    console.log("👤 No user logged in");
    setTimeout(() => {
      if (isMounted && !auth.currentUser) {
        setAppState('landing');
        appStateRef.current = 'landing';
        setAuthReady(false);
      }
    }, 3000);
    return;
  }

  // =====================================================
  // 🛡️ PLATFORM ADMIN ROUTE - CHECK FIRST
  // =====================================================
  // ✅ Don't set isAuthProcessing here - let admin check run first
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userDocRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      
      // ✅ Platform Admin - Grant immediate access
      if (userData.isPlatformAdmin === true || userData.platformRole === 'super_admin') {
        console.log("✅ Platform Admin logged in:", user.email);
        setUser(user);
        setUserEmail(user.email || '');
        setUserRole('admin');
        setCompanyId(null);
        setAuthReady(true);
        setAppState('dashboard');
        appStateRef.current = 'dashboard';
        setCompanyName('Platform Admin');
        setCopyFeedback("");
        return; // ✅ IMPORTANT: Exit completely for admin users
      }
    }
  } catch (error) {
    console.error("Error checking admin status:", error);
    // ✅ Continue to company auth if admin check fails
  }

  // =====================================================
  // NORMAL COMPANY USER AUTHENTICATION
  // =====================================================
  // ✅ Only set isAuthProcessing here for company users
  if (isAuthProcessing.current) return;
  isAuthProcessing.current = true;

  const userDocRef = doc(db, 'users', user.uid);
  let userSnap;
  try {
    userSnap = await getDoc(userDocRef);
  } catch (error) {
    console.error("Error fetching user doc:", error);
    isAuthProcessing.current = false;
    handleAuthError(error, "Unable to load user data. Please try again.");
    return;
  }

  // ✅ If user document doesn't exist and user is NOT a platform admin
  if (!userSnap.exists()) {
    console.warn("⚠️ User document missing, attempting recovery...");
    try {
      const companiesQuery = query(
        collection(db, 'companies'),
        where('memberUids', 'array-contains', user.uid)
      );
      const companiesSnap = await getDocs(companiesQuery);
     
      if (!companiesSnap.empty) {
        const companyDoc = companiesSnap.docs[0];
        const companyData = companyDoc.data();
        const companyId = companyDoc.id;
        const locations = companyData.locations || [];
       
        console.log("✅ Found company, recreating user document...");
       
        await setDoc(userDocRef, {
          email: user.email,
          companyId: companyId,
          role: "owner",
          accessibleLocations: locations.map(l => l.id),
          defaultLocation: locations[0]?.id || null,
          setupComplete: true,
          createdAt: new Date(),
          recoveredAt: new Date()
        });
       
        userSnap = await getDoc(userDocRef);
        setUser(user);                     // ← ADD THIS LINE
        setUserEmail(user.email || '');    // ← ADD THIS LINE
        if (!userSnap.exists()) {
          handleAuthError(new Error("User creation failed"), "Failed to create user profile. Please contact support.");
          isAuthProcessing.current = false;
          return;
        }
      } else {
        console.error("❌ No company found for user:", user.uid);
        setAppState('landing');
        setCopyFeedback("User profile not found. Please register or contact your administrator.");
        isAuthProcessing.current = false;
        return;
      }
    } catch (error) {
      console.error("Error recovering user document:", error);
      handleAuthError(error, "Failed to recover user profile. Please try again.");
      isAuthProcessing.current = false;
      return;
    }
  }

  // Now process the user document
  const userData = userSnap.data();
  let companyId = userData.companyId;

  // Auto-recovery for users with null companyId
  if (!companyId) {
    console.warn("⚠️ User has null companyId. Attempting recovery...");
    try {
      const companiesQuery = query(
        collection(db, 'companies'),
        where('memberUids', 'array-contains', user.uid)
      );
      const companiesSnap = await getDocs(companiesQuery);
     
      if (!companiesSnap.empty) {
        const companyDoc = companiesSnap.docs[0];
        companyId = companyDoc.id;
       
        await updateDoc(userDocRef, {
          companyId: companyId,
          fixedAt: new Date(),
          fixedBy: 'auto-recovery'
        });
       
        console.log("✅ User document fixed with companyId:", companyId);
      } else {
        console.error("❌ No company found for user:", user.uid);
        setAppState('landing');
        setCopyFeedback("Your account is not linked to any company. Please contact support.");
        isAuthProcessing.current = false;
        return;
      }
    } catch (error) {
      console.error("Error recovering companyId:", error);
      setAppState('landing');
      setCopyFeedback("Error recovering your account. Please try again.");
      isAuthProcessing.current = false;
      return;
    }
  }

  // Get the user's role
  const role = userData.role || 'dispatcher';

  // ✅ Additional validation: Check if user is actually in the company's memberUids
  try {
    if (companyId) {
      const companySnap = await getDoc(doc(db, 'companies', companyId));
      if (companySnap.exists()) {
        const companyData = companySnap.data();
        const memberUids = companyData.memberUids || [];
       
        // If user is not in memberUids, add them
        if (!memberUids.includes(user.uid)) {
          console.warn(`⚠️ User ${user.uid} not in memberUids for company ${companyId}, adding...`);
          await updateDoc(doc(db, 'companies', companyId), {
            memberUids: arrayUnion(user.uid)
          });
          console.log("✅ User added to memberUids");
        }
      }
    }
  } catch (error) {
    console.error("Error checking memberUids:", error);
    // Continue anyway - this is a non-critical check
  }

  // Define finishSetup function
  const finishSetup = async (companyId, role, accessibleLocations = [], defaultLocation = null) => {
  setUser(user);                      // ← ADD THIS LINE
  setUserEmail(user.email || '');     // ← ADD THIS LINE
  setCompanyId(companyId);
  setAuthReady(true);
  setUserRole(role || 'dispatcher');
  setUserAccessibleLocations(accessibleLocations);
  setCurrentLocation(defaultLocation || (accessibleLocations[0]?.id || ''));
   
    try {
      const companySnap = await getDoc(doc(db, 'companies', companyId));
      if (companySnap.exists()) {
        const cData = companySnap.data();
        setCompanyName(cData.name || 'Workspace');
        setCompanyLocations(cData.locations || []);
        setDataSharingMode(cData.dataSharingMode || 'separate');
                        setCompanyDetails({
          address: cData.address || '',
          city: cData.city || '',
          phone: cData.phone || '',
          email: cData.email || '',
          logoUrl: cData.logoUrl || '',
          website: cData.website || '', // ✅ ADD THIS
          emailTemplate: cData.emailTemplate || '', // ✅ ADD THIS
        });
      } else {
        setCompanyName('Workspace');
      }
    } catch (err) {
      console.error("Error loading company:", err);
      setCompanyName('Workspace');
      setCopyFeedback("Could not load company details. Some features may be limited.");
    }
   
    setActiveTab('summary');
    setAppState('dashboard');
    appStateRef.current = 'dashboard';
    isAuthProcessing.current = false;
    setCopyFeedback("");
  };

  // Check if owner needs to complete setup
  if (userData.role === 'owner' && userData.setupComplete === false) {
  // ✅ Fallback: Check if the company already has team members
  try {
    const companySnap = await getDoc(doc(db, 'companies', companyId));
    if (companySnap.exists()) {
      const members = companySnap.data().memberUids || [];
      if (members.length > 1) {
        // Team setup was already done; auto-fix the flag
        await updateDoc(userDocRef, { setupComplete: true });
        userData.setupComplete = true; // update local variable
        console.log("✅ Auto-fixed setupComplete for existing team");
        // Continue to normal flow (do NOT go to rolesetup)
      }
    }
  } catch (err) {
    console.error("Error checking company members:", err);
  }

  // If still false after the fallback, redirect to Team Setup
  if (userData.setupComplete === false) {
    setPendingCompanyId(companyId);
    setPendingOwnerUid(user.uid);
    setAppState('rolesetup');
    appStateRef.current = 'rolesetup';
    isAuthProcessing.current = false;
    return;
  }
}

  // Get accessible locations
  const accessibleLocations = userData.accessibleLocations || [];
  const defaultLocation = userData.defaultLocation || null;

  // If no accessibleLocations but company has locations, use those
  if (accessibleLocations.length === 0 && companyId) {
    try {
      const companySnap = await getDoc(doc(db, 'companies', companyId));
      if (companySnap.exists()) {
        const companyData = companySnap.data();
        const locations = companyData.locations || [];
        if (locations.length > 0) {
          const locationIds = locations.map(l => l.id);
          console.log("✅ Setting accessibleLocations from company:", locationIds);
          await updateDoc(userDocRef, {
            accessibleLocations: locationIds,
            defaultLocation: locationIds[0]
          });
          await finishSetup(companyId, role, locationIds, locationIds[0]);
          return;
        }
      }
    } catch (error) {
      console.error("Error fetching company locations:", error);
    }
  }

  await finishSetup(companyId, role, accessibleLocations, defaultLocation);
});
    })
    .catch((err) => {
      console.error("auth.authStateReady() error:", err);
      handleAuthError(err, "Authentication service unavailable. Please try again later.");
    });
};

// Start the auth initialization
initializeAuth();

return () => {
  isMounted = false;
  if (unsubscribe) unsubscribe();
  if (userDocUnsubscribe) userDocUnsubscribe();
  if (loadingTimeout) clearTimeout(loadingTimeout);
  if (retryTimeout) clearTimeout(retryTimeout);
};
}, []);

    useEffect(() => { if (userRole === 'dispatcher' && ['billing', 'revenue'].includes(activeTab)) setActiveTab('loads'); }, [userRole, activeTab]);

  useEffect(() => { if (appState === 'dashboard') { const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove']; events.forEach(event => window.addEventListener(event, resetInactivityTimer)); resetInactivityTimer(); return () => { events.forEach(event => window.removeEventListener(event, resetInactivityTimer)); if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); }; } }, [appState, resetInactivityTimer]);


// ✅ ADD resetDriverStatus HERE (after isAdmin and isDispatcher are defined)

// Driver App Route
if (window.location.pathname.startsWith('/driver')) {
  return <DriverApp />;
}
// Admin Dashboard Route - ONLY for Super Admin
if (window.location.pathname.startsWith('/admin')) {
  return (
    <SuperAdminGuard>
      <AdminDashboard />
    </SuperAdminGuard>
  );
}
  if (appState === 'loading') return (<div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4"><Loader2 className="w-10 h-10 text-purple-600 animate-spin" /><div className="text-sm font-bold text-slate-500 uppercase tracking-widest">Loading Workspace...</div></div>);
  if (appState === 'landing') {
  return (
    <WorkspaceManager
      setCompanyId={setCompanyId}
      setUserRole={setUserRole}
      setAppState={setAppState}
      onRegistrationComplete={handleRegistrationComplete}
    />
  );
}
  if (appState === 'rolesetup') return (<RoleSetup companyId={pendingCompanyId} ownerUid={pendingOwnerUid} onComplete={handleRoleSetupComplete} />);

// ✅ AUTO-RECOVERY DISABLED - Prevents forced logout
if (appState === 'dashboard' && !authReady) {
  // ❌ DISABLED: Auto-recover after 8 seconds
  // setTimeout(() => {
  //   if (appState === 'dashboard' && !authReady) {
  //     console.warn("⚠️ Auto-recovery: Force redirect to landing");
  //     setAppState('landing');
  //     setCopyFeedback("Connection timed out. Please refresh.");
  //   }
  // }, 8000);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-10 h-10 text-purple-600 animate-spin" />
      <div className="text-sm font-bold text-slate-500 uppercase tracking-widest">
        Preparing your workspace...
      </div>
      <div className="text-xs text-slate-400 animate-pulse">
        If this takes too long, try refreshing the page
      </div>
    </div>
  );
}

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
        {copyFeedback && (<div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${copyFeedback.includes('Error') || copyFeedback.includes('Failed') || copyFeedback.includes('❌') ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{copyFeedback.includes('Error') || copyFeedback.includes('Failed') || copyFeedback.includes('❌') ? <AlertTriangle className="w-5 h-5 text-white" /> : <Check className="w-5 h-5 text-green-400" />}<span className="font-bold text-sm">{copyFeedback}</span></div>)}
        {viewingDoc && (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setViewingDoc(null)}></div><div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"><div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-blue-600" /><h2 className="font-black text-slate-900">{viewingDoc.title}</h2></div><button onClick={() => setViewingDoc(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button></div><div className="p-2 bg-slate-100 flex-1 min-h-[500px] overflow-auto flex items-center justify-center">{(viewingDoc.type || "").startsWith('image/') ? (<img src={viewingDoc.url || viewingDoc.data} className="max-w-full shadow-lg rounded" alt="preview" />) : (<div className="bg-white p-12 rounded-2xl text-center"><FileText className="w-16 h-16 text-blue-500 mx-auto mb-4" /><p className="font-bold text-slate-700 mb-6">{viewingDoc.name}</p><a href={viewingDoc.url || viewingDoc.data} target="_blank" rel="noreferrer" download={viewingDoc.name} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold transition-all hover:bg-blue-700">Download to View</a></div>)}</div></div></div>)}
        {trackingLoad && (<TrackingModal load={trackingLoad} onClose={() => setTrackingLoad(null)} onUpdateStatus={handleUpdateStatus} />)}
        <DraftEmailModal isOpen={draftEmail.isOpen} onClose={() => setDraftEmail({ ...draftEmail, isOpen: false })} content={draftEmail.content} onSend={handleSendEmail} />
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} onConfirm={confirmModal.onConfirm} />
        <ImportDataModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImport={(file, type) => handleImportData(file, type)} isLoading={isImporting} />
        {signingContext && (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setSigningContext(null)}></div><div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"><div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><h2 className="font-black text-slate-900">Sign Delivery Leg</h2><button onClick={() => setSigningContext(null)} className="p-2 hover:bg-slate-200 rounded-lg"><X /></button></div><div className="p-6 space-y-6"><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Arrival</label><input type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.arrivalTime} onChange={(e) => setSigningContext({...signingContext, arrivalTime: e.target.value})} /></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Departure</label><input type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.departureTime} onChange={(e) => setSigningContext({...signingContext, departureTime: e.target.value})} /></div></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Receiver Name</label><input type="text" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold placeholder:font-normal" placeholder="Who is receiving this?" value={signingContext.receiverName} onChange={(e) => setSigningContext({...signingContext, receiverName: e.target.value})} /></div><SignaturePad onSave={handleSignLeg} onCancel={() => setSigningContext(null)} /></div></div></div>)}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)]">
  <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

    {/* ===== LEFT: Logo + Nav ===== */}
    <div className="flex items-center gap-4 min-w-0 flex-1">

      {/* Logo + Company Name */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {companyDetails?.logoUrl ? (
          <img
            src={companyDetails.logoUrl}
            alt={companyName || 'Company Logo'}
            className="w-9 h-9 rounded-xl object-contain bg-white border border-slate-200 p-1 shadow-sm"
          />
        ) : (
          <div className="bg-gradient-to-tr from-purple-600 to-indigo-500 p-2 rounded-xl shadow-sm">
            <Truck className="text-white w-5 h-5" strokeWidth={2.5} />
          </div>
        )}
        <h1
          className="text-sm font-bold text-slate-800 tracking-tight leading-tight truncate max-w-[180px]"
          title={companyName || 'Workspace'}
        >
          {companyName || 'Workspace'}
        </h1>
      </div>

      {/* Nav Tabs */}
      <nav className="hidden md:flex gap-1 bg-slate-100/80 p-1 rounded-xl overflow-x-auto min-w-0 border border-slate-200/60">
        {Object.entries(TAB_CONFIG).map(([tabKey, config]) => {
          if (!config.roles.includes(userRole)) return null;
          const isActive = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                isActive
                  ? 'bg-white shadow-sm text-purple-600 border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
              }`}
            >
              {config.label}
            </button>
          );
        })}
      </nav>
    </div>

    {/* ===== RIGHT: All Action Buttons ===== */}
    <div className="flex items-center gap-2 flex-shrink-0">

      {/* Location Selector */}
      <LocationSelector
        userLocations={userAccessibleLocations.map(id => companyLocations.find(l => l.id === id)).filter(Boolean)}
        currentLocation={currentLocation}
        onLocationChange={setCurrentLocation}
        dataSharingMode={dataSharingMode}
      />

      {/* Avatar with role tooltip */}
      <div
        className="relative group flex-shrink-0"
        title={`${userEmail || 'User'}\nRole: ${ROLE_DISPLAY_NAMES[userRole] || userRole}`}
      >
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-600 to-indigo-500 flex items-center justify-center text-white font-black text-xs cursor-help ring-2 ring-white shadow-md">
          {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white"></div>
      </div>

      {/* Team button */}
      {isAdmin && (
        <button
          onClick={() => setIsUserManagementOpen(true)}
          className="flex items-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-2 rounded-xl font-bold text-xs transition-colors"
          title="Team Management"
        >
          <UserPlus className="w-4 h-4" />
          <span className="hidden xl:inline">Team</span>
        </button>
      )}

      {/* Settings button */}
      {isAdmin && (
        <button
          onClick={() => setShowEmailSettings(true)}
          className="flex items-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-2 rounded-xl font-bold text-xs transition-colors"
          title="Company Settings"
        >
          <Mail className="w-4 h-4" />
          <span className="hidden xl:inline">Settings</span>
        </button>
      )}

      {/* New Load button */}
      {(isAdmin || isDispatcher || isCustomerService) && (
        <button
          onClick={() => { setEditingId(null); setIsFormOpen(true); }}
          className="flex items-center gap-1.5 bg-purple-600 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-md shadow-purple-200 transition-all active:scale-95 hover:bg-purple-700"
          title="New Load"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden xl:inline">New Load</span>
        </button>
      )}

      {/* Fix Orphans button (icon-only) */}
      {isAdmin && (
        <button
          onClick={resetOrphanedDrivers}
          className="flex items-center justify-center w-9 h-9 bg-red-50 text-red-600 rounded-xl transition-colors hover:bg-red-100"
          title="Fix Orphaned Drivers"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}

      {/* Logout button */}
      <button
        onClick={handleLeaveWorkspace}
        className="flex items-center justify-center w-9 h-9 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
        title="Log Out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>

  </div>
</header>
        <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
  {boardView === 'today' ? (
  <div>
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-2xl font-black text-slate-900">Today's Board</h2>
      <button
        onClick={() => setBoardView(null)}
        className="bg-white px-4 py-2 rounded-xl shadow-md font-bold text-sm text-slate-600 hover:bg-slate-100 border border-slate-200"
      >
        ← Back to Dashboard
      </button>
    </div>
    <DailyDispatchBoard
      companyId={companyId}
      onEdit={handleEdit}
      onDelete={confirmDeleteLoad}
      onViewDetails={setViewingDoc}
      setFeedback={setCopyFeedback}
      isAdmin={isAdmin}
      isDispatcher={isDispatcher}
      isAccounting={isAccounting}
      selectedDate={new Date().toISOString().split('T')[0]}
    />
  </div>
) : boardView === 'tomorrow' ? (
  <div>
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-2xl font-black text-slate-900">Tomorrow's Board</h2>
      <button
        onClick={() => setBoardView(null)}
        className="bg-white px-4 py-2 rounded-xl shadow-md font-bold text-sm text-slate-600 hover:bg-slate-100 border border-slate-200"
      >
        ← Back to Dashboard
      </button>
    </div>
    <TomorrowDispatchBoard
      companyId={companyId}
      onEdit={handleEdit}
      onDelete={confirmDeleteLoad}
      onViewDetails={setViewingDoc}
      setFeedback={setCopyFeedback}
      isAdmin={isAdmin}
      isDispatcher={isDispatcher}
      isAccounting={isAccounting}
    />
  </div>
) : (
    // ---------- YOUR ORIGINAL MAIN CONTENT GOES HERE ----------
    // Paste everything that was originally inside <main> here.
    // It starts with {activeTab === 'summary' && ...} and ends with all your other tabs.
    <>
      {activeTab === 'summary' && (
        <div className="animate-in fade-in space-y-8">
          {/* Header with buttons */}
          <div>
            <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
              <h2 className="text-2xl font-black text-slate-900">Daily Summary</h2>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    downloadDailyReportCSV(
                      summaryLoads.filter(l => l?.appointmentDate === new Date().toISOString().split('T')[0]),
                      companyName
                    );
                    setCopyFeedback("Daily Report Downloaded");
                  }}
                  className="flex items-center gap-2 bg-green-50 text-green-700 hover:text-green-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-green-200 hover:bg-green-100 transition-all active:scale-95 shadow-sm"
                >
                  <FileDown className="w-4 h-4" />
                  <span className="hidden sm:inline">Export Daily Report</span>
                  <span className="sm:hidden">Daily</span>
                </button>
                {isAdmin && (
                  <button
                    onClick={async () => {
                      await downloadFullCompanyData(
                        companyId,
                        companyName,
                        summaryLoads,
                        savedCustomers,
                        savedDestinations,
                        savedDrivers,
                        setCopyFeedback
                      );
                    }}
                    className="flex items-center gap-2 bg-purple-50 text-purple-700 hover:text-purple-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-purple-200 hover:bg-purple-100 transition-all active:scale-95 shadow-sm"
                  >
                    <Archive className="w-4 h-4" />
                    <span className="hidden sm:inline">Export ALL Company Data</span>
                    <span className="sm:hidden">Full Export</span>
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-2 bg-blue-50 text-blue-700 hover:text-blue-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-blue-200 hover:bg-blue-100 transition-all active:scale-95 shadow-sm"
                  >
                    <Upload className="w-4 h-4" />
                    <span className="hidden sm:inline">Import Old Data</span>
                    <span className="sm:hidden">Import</span>
                  </button>
                )}
                {/* Today's Board and Tomorrow's Board buttons (with setBoardView) */}
                <button
                  onClick={() => setBoardView('today')}
                  className="flex items-center gap-2 bg-blue-50 text-blue-700 hover:text-blue-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-blue-200 hover:bg-blue-100 transition-all active:scale-95 shadow-sm"
                >
                  <Calendar className="w-4 h-4" />
                  <span className="hidden sm:inline">Today's Board</span>
                  <span className="sm:hidden">Today</span>
                </button>
                <button
                  onClick={() => setBoardView('tomorrow')}
                  className="flex items-center gap-2 bg-orange-50 text-orange-700 hover:text-orange-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-orange-200 hover:bg-orange-100 transition-all active:scale-95 shadow-sm"
                >
                  <Calendar className="w-4 h-4" />
                  <span className="hidden sm:inline">Tomorrow's Board</span>
                  <span className="sm:hidden">Tomorrow</span>
                </button>
              </div>
            </div>

            {/* Daily Summary Stats */}
            <DailySummary loads={summaryLoads} />
          </div>

          {/* Pre-Pull Alert */}
<div className="bg-purple-50/50 border border-purple-100 rounded-2xl p-5 animate-in slide-in-from-top-4 relative overflow-hidden">
  <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
    <Clock className="w-48 h-48 text-purple-900" />
  </div>
  <div className="relative z-10">
    <div className="flex items-center gap-3 mb-4">
      <div className="bg-purple-100 p-2 rounded-lg text-purple-700 shadow-sm">
        <Clock className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-black text-lg text-purple-900 tracking-tight">Pre-Pull Required</h3>
        <p className="text-purple-700 font-bold text-xs">
          {summaryLoads.filter(l => l.isPrePull).length} containers marked for pre-pull
        </p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {summaryLoads.filter(l => l.isPrePull).slice(0, 6).map(load => (
        <div
          key={load.id}
          className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm flex flex-col gap-2 group hover:shadow-md hover:border-purple-200 transition-all cursor-pointer"
          onClick={() => handleEdit(load)}
        >
          <div className="flex justify-between items-start">
            <div className="font-black text-slate-800 text-sm">{load.containerNo || 'N/A'}</div>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
              load.prePullDate && new Date(load.prePullDate) < new Date()
                ? 'bg-red-50 text-red-700 border border-red-100'
                : 'bg-amber-50 text-amber-700 border border-amber-100'
            }`}>
              {load.prePullDate && new Date(load.prePullDate) < new Date() ? 'OVERDUE' : 'PENDING'}
            </span>
          </div>
          <div className="text-xs text-slate-500 font-medium truncate">{load.customerName || 'N/A'}</div>
          {load.prePullDate && (
            <div className="text-[11px] font-bold text-purple-600 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(load.prePullDate).toLocaleDateString()}
            </div>
          )}
          <div className="text-[10px] text-slate-400 mt-1 font-medium">
            WO: {load.workOrderNo || 'N/A'}
          </div>
        </div>
      ))}
      {summaryLoads.filter(l => l.isPrePull).length === 0 && (
        <div className="col-span-full text-center text-purple-500 font-bold text-sm py-6 bg-white/50 rounded-xl border border-purple-100 border-dashed">
          ✅ No containers need pre-pull
        </div>
      )}
    </div>
  </div>
</div>

          {/* Action Required - Pending Terminations */}
          <ActionRequired
            loads={summaryLoads}
            onEdit={handleEdit}
            onStatusChange={quickUpdateStatus}
          />

          {/* Today's Active Dispatches Table */}
          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-xl text-white">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="font-black text-lg text-slate-900">Today's Active Dispatches</h3>
            </div>
            <LoadTable
              loads={summaryLoads.filter(l => l?.appointmentDate === new Date().toISOString().split('T')[0] && l?.status === 'Open')}
              onEdit={handleEdit}
              onDelete={confirmDeleteLoad}
              onStatusChange={quickUpdateStatus}
              onViewDoc={setViewingDoc}
              onSign={handleSign}
              onCopy={handleCopy}
              onDownload={handleDownload}
              onDownloadLoadConfirmation={handleDownloadLoadConfirmation}
              onDownloadPOD={handleDownloadPOD}
              onTrack={handleTrack}
              companyName={companyName}
            />
          </div>
        </div>
      )}

      {(activeTab === 'loads' || activeTab === 'billing' || activeTab === 'history') && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search Container #, PO#, WO#, or Customer..."
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              onChange={(e) => debouncedSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {activeTab === 'loads' && (
        <div className="space-y-4">
          {/* FOUR TOGGLE BUTTONS */}
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-blue-600" />
              <span className="font-bold text-slate-700">
                {showDispatchBoard ? '📋 Today\'s Board' : 
                 showTomorrowDispatchBoard ? '📋 Tomorrow\'s Board' :
                 showContainerBoard ? '📦 Container Board View' : 
                 '📋 Operations View'}
              </span>
            </div>
                        <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setShowContainerBoard(false);
                  setShowDispatchBoard(false);
                  setShowTomorrowDispatchBoard(false);
                }}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  !showContainerBoard && !showDispatchBoard && !showTomorrowDispatchBoard
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                📋 Operations
              </button>
              <button
                onClick={() => {
                  setShowContainerBoard(true);
                  setShowDispatchBoard(false);
                  setShowTomorrowDispatchBoard(false);
                }}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  showContainerBoard
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                📦 Container Board
              </button>
              {!showContainerBoard && !showDispatchBoard && !showTomorrowDispatchBoard && (
                !loadBulkDeleteMode ? (
                  <button
                    onClick={() => {
                      setLoadBulkDeleteMode(true);
                      setSelectedLoadIds([]);
                    }}
                    className="px-4 py-2 rounded-xl font-bold text-sm transition-all bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Select & Delete
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setLoadBulkDeleteMode(false);
                      setSelectedLoadIds([]);
                    }}
                    className="px-4 py-2 rounded-xl font-bold text-sm transition-all bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                )
              )}
            </div>
          </div>

                    {/* ===== BULK DELETE ACTION BAR ===== */}
          {loadBulkDeleteMode && !showContainerBoard && !showDispatchBoard && !showTomorrowDispatchBoard && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-red-700 uppercase">
                  {selectedLoadIds.length} selected
                </span>
                <button
                  onClick={() => setSelectedLoadIds((paginatedLoads || []).map(l => l.id))}
                  className="text-[10px] font-bold text-red-600 hover:text-red-800 underline"
                >
                  Select All ({paginatedLoads?.length || 0})
                </button>
                {selectedLoadIds.length > 0 && (
                  <button
                    onClick={() => setSelectedLoadIds([])}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                  >
                    Deselect All
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  if (selectedLoadIds.length === 0) {
                    setCopyFeedback("⚠️ No loads selected");
                    return;
                  }
                  setLoadBulkDeleteStep(1);
                  setShowLoadBulkDeleteConfirm(true);
                }}
                disabled={selectedLoadIds.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected ({selectedLoadIds.length})
              </button>
            </div>
          )}

          {/* Conditional Rendering - FOUR VIEWS */}
          {showDispatchBoard ? (
            <DailyDispatchBoard
              companyId={companyId}
              onEdit={handleEdit}
              onDelete={confirmDeleteLoad}
              onViewDetails={setViewingDoc}
              setFeedback={setCopyFeedback}
              isAdmin={isAdmin}
              isDispatcher={isDispatcher}
              isAccounting={isAccounting}
              selectedDate={new Date().toISOString().split('T')[0]}
            />
          ) : showTomorrowDispatchBoard ? (
            <TomorrowDispatchBoard
              companyId={companyId}
              onEdit={handleEdit}
              onDelete={confirmDeleteLoad}
              onViewDetails={setViewingDoc}
              setFeedback={setCopyFeedback}
              isAdmin={isAdmin}
              isDispatcher={isDispatcher}
              isAccounting={isAccounting}
            />
          ) : showContainerBoard ? (
            <ContainerBoard
              companyId={companyId}
              onEdit={handleEdit}
              onDelete={confirmDeleteLoad}
              onViewDetails={setViewingDoc}
              setFeedback={setCopyFeedback}
              isAdmin={isAdmin}
              isDispatcher={isDispatcher}
              isAccounting={isAccounting}
            />
          ) : (
                        <LoadTable 
              loads={paginatedLoads} 
              onEdit={handleEdit} 
              onDelete={confirmDeleteLoad} 
              onStatusChange={quickUpdateStatus} 
              onViewDoc={setViewingDoc} 
              onSign={handleSign} 
              onCopy={handleCopy} 
              onDownload={handleDownload} 
              onDownloadLoadConfirmation={handleDownloadLoadConfirmation} 
              onDownloadPOD={handleDownloadPOD} 
              onTrack={handleTrack} 
              onQuickAssign={quickAssignDriver}
              companyName={companyName} 
              currentPage={loadsPage} 
              pageSize={pageSize} 
              isLoadingMore={isLoadingMore} 
              onNextPage={() => { 
                if (paginatedLoads.length === pageSize) { 
                  setLoadsPage(p => p + 1); 
                  fetchPaginatedLoads(false); 
                } 
              }} 
              onPrevPage={() => {
                if (loadsPage > 0) {
                  setLoadsPage(p => p - 1);
                  lastDocSnapshotRef.current = null;
                  fetchPaginatedLoads(true);
                }
              }} 
              hasNextPage={paginatedLoads.length === pageSize}
              bulkDeleteMode={loadBulkDeleteMode}
              selectedLoadIds={selectedLoadIds}
              onToggleSelection={(id) => {
                setSelectedLoadIds(prev =>
                  prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                );
              }}
            />
          )}

          {/* ===== DOUBLE CONFIRMATION MODAL ===== */}
          {showLoadBulkDeleteConfirm && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
                onClick={() => {
                  if (!isLoadBulkDeleting) {
                    setShowLoadBulkDeleteConfirm(false);
                    setLoadBulkDeleteStep(1);
                  }
                }}
              ></div>
              <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                {loadBulkDeleteStep === 1 ? (
                  <>
                    <div className="p-6 flex flex-col items-center text-center space-y-4">
                      <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900">
                        Delete {selectedLoadIds.length} Load{selectedLoadIds.length !== 1 ? 's' : ''}?
                      </h3>
                      <p className="text-sm font-medium text-slate-500 leading-relaxed">
                        You are about to close <strong className="text-red-600">{selectedLoadIds.length}</strong> load{selectedLoadIds.length !== 1 ? 's' : ''} and mark them as Completed. This action can be undone from the History tab.
                      </p>
                    </div>
                    <div className="flex border-t border-slate-100">
                      <button
                        onClick={() => { setShowLoadBulkDeleteConfirm(false); setLoadBulkDeleteStep(1); }}
                        className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <div className="w-px bg-slate-100"></div>
                      <button
                        onClick={() => setLoadBulkDeleteStep(2)}
                        className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Continue →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-6 flex flex-col items-center text-center space-y-4">
                      <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center animate-pulse">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900">Are You Absolutely Sure?</h3>
                      <p className="text-sm font-medium text-slate-500 leading-relaxed">
                        This is your <strong className="text-red-600">final confirmation</strong>. Clicking "Delete Forever" will close <strong>{selectedLoadIds.length}</strong> load{selectedLoadIds.length !== 1 ? 's' : ''} and hide them from the Operations tab.
                      </p>
                    </div>
                    <div className="flex border-t border-slate-100">
                      <button
                        onClick={() => setLoadBulkDeleteStep(1)}
                        disabled={isLoadBulkDeleting}
                        className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        ← Back
                      </button>
                      <div className="w-px bg-slate-100"></div>
                      <button
                        onClick={async () => {
                          if (selectedLoadIds.length === 0) return;
                          setIsLoadBulkDeleting(true);
                          const { successCount, failCount } = await batchSoftDeleteLoads(selectedLoadIds);
                          setIsLoadBulkDeleting(false);
                          setSelectedLoadIds([]);
                          setLoadBulkDeleteMode(false);
                          setShowLoadBulkDeleteConfirm(false);
                          setLoadBulkDeleteStep(1);
                          setCopyFeedback(failCount === 0
                            ? `✅ Deleted ${successCount} load${successCount !== 1 ? 's' : ''}`
                            : `⚠️ Deleted ${successCount}, failed ${failCount}`
                          );
                          if (activeTab === 'loads') fetchPaginatedLoads(true);
                        }}
                        disabled={isLoadBulkDeleting}
                        className="flex-1 py-4 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isLoadBulkDeleting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4" />
                            Delete Forever
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

            {activeTab === 'billing' && (
        <BillingTable
          loads={paginatedLoads}
          onStatusChange={quickUpdateStatus}
          onGenerateInvoice={handleGenerateInvoice}
          onDraftEmail={handleDraftEmail}
          onEdit={handleEdit}
          onPrint={handlePrint}
          onViewDoc={setViewingDoc}
          onSendInvoice={handleSendInvoiceEmail}
          onApprove={handleApproveBilling}
          setFeedback={setCopyFeedback}
          companyName={companyName}
          companyEmail={companyDetails.email}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTable
  loads={paginatedLoads.filter(load => !load.isDeleted)}
  onStatusChange={quickUpdateStatus}
  onViewDoc={setViewingDoc}
  onDelete={confirmDeleteLoad}
  onEdit={handleEdit}
  onEditInvoice={handleEditInvoiceFromHistory}
/>
      )}

      {activeTab === 'addressBook' && (
  <AddressBook
    savedCustomers={savedCustomers}
    savedDestinations={savedDestinations}
    savedDrivers={savedDrivers}
    savedChassis={savedChassis}
    savedTrucks={savedTrucks}
    savedBasePrices={savedBasePrices}           // ✅ ADD THIS
    onDeleteCustomer={confirmDeleteCustomer}
    onDeleteLocation={confirmDeleteLocation}
    onDeleteDriver={confirmDeleteDriver}
    onDeleteBasePrice={confirmDeleteBasePrice}  // ✅ ADD THIS
    newCust={newCust}
    setNewCust={setNewCust}
    newLoc={newLoc}
    setNewLoc={setNewLoc}
    newDriver={newDriver}
    setNewDriver={setNewDriver}
    newBasePrice={newBasePrice}                 // ✅ ADD THIS
    setNewBasePrice={setNewBasePrice}           // ✅ ADD THIS
    onAddCustomer={handleAddCustomer}
    onAddLocation={handleAddLocation}
    onImportLocations={handleImportLocations}
    onAddDriver={handleAddDriver}
    onAddBasePrice={handleAddBasePrice}         // ✅ ADD THIS
    onUpdateCustomer={handleUpdateCustomer}
    onUpdateLocation={handleUpdateLocation}
    onUpdateDriver={handleUpdateDriver}
    onImportBasePrices={handleImportBasePrices}  // ✅ ADD THIS LINE
    savedTerminals={savedTerminals}
    onDeleteTerminal={confirmDeleteTerminal}
    newTerminal={newTerminal}
    setNewTerminal={setNewTerminal}
    onAddTerminal={handleAddTerminal}
    onUpdateTerminal={handleUpdateTerminal}
    companyId={companyId}
    setFeedback={setCopyFeedback}
    isAdmin={isAdmin}
    isDispatcher={isDispatcher}
  />
)}

      {activeTab === 'assignment' && (
        <AssignmentView
          loads={summaryLoads}
          assignmentDate={assignmentDate}
          setAssignmentDate={setAssignmentDate}
          assignmentSlots={assignmentSlots}
          onEdit={handleEdit}
        />
      )}

      {activeTab === 'revenue' && (
        <ProfitDashboard 
          loads={revenueLoads}
          drivers={savedDrivers}
        />
      )}

      {activeTab === 'payroll' && (
        <DriverPayroll
          drivers={savedDrivers}
          loads={summaryLoads}
          companyId={companyId}
          onRefresh={manualRefresh}
          isAdmin={isAdmin}
          isAccounting={isAccounting}
          setFeedback={setCopyFeedback}
        />
      )}

            {activeTab === 'driverActivity' && (
        <DriverActivityBoard
          drivers={savedDrivers}
          companyId={companyId}
          onViewPOD={(url) => setViewingDoc({ url, title: "POD Photo" })}
          onResetDriver={resetDriverStatus}
          loads={summaryLoads}
        />
      )}

            {activeTab === 'invoices' && (
        <InvoicesModule
  companyId={companyId}
  companyName={companyName}
  companyDetails={companyDetails}
  companyLocations={companyLocations}
  setFeedback={setCopyFeedback}
  userEmail={userEmail}
  pendingLoadId={pendingInvoiceLoadId}
  onPendingLoadConsumed={() => setPendingInvoiceLoadId(null)}
/>
      )}

      {activeTab === 'exportBatches' && (
        <ExportBatchesModule
          companyId={companyId}
          companyName={companyName}
          userEmail={userEmail}
          setFeedback={setCopyFeedback}
        />
      )}
    </>
  )}
</main>
        <UserManagement isOpen={isUserManagementOpen} onClose={() => setIsUserManagementOpen(false)} companyId={companyId} currentUserUid={user?.uid} userRole={userRole} />
                    <EmailSettingsModal
  isOpen={showEmailSettings}
  onClose={() => setShowEmailSettings(false)}
  companyId={companyId}
  setFeedback={setCopyFeedback}
  companyName={companyName}
  companyDetails={companyDetails}
  currentLogoUrl={companyDetails?.logoUrl || ''}
  onLogoUpdated={(newUrl) =>
    setCompanyDetails(prev => ({ ...prev, logoUrl: newUrl }))
  }
    onCompanyUpdated={(updated) => {
    if (updated.name) setCompanyName(updated.name);
    setCompanyDetails(prev => ({
      ...prev,
      address: updated.address,
      city: updated.city,
      province: updated.province,
      postalCode: updated.postalCode,
      phone: updated.phone,
      email: updated.email,
      website: updated.website, // ✅ ADD THIS
      emailTemplate: updated.emailTemplate, // ✅ ADD THIS
    }));
  }}
/>
        <LoadForm
  isOpen={isFormOpen}
  onClose={() => { 
    setIsFormOpen(false); 
    setEditingId(null); 
    setEditingLoadData(null); // ✅ Clears the data on close
  }}
  onSubmit={handleSubmitLoad}
  initialData={loadToEdit}
  savedCustomers={savedCustomers}
  savedDestinations={savedDestinations}
  savedDrivers={savedDrivers}
  savedBasePrices={savedBasePrices}  // ✅ ADD THIS LINE
  apiKey={GEMINI_API_KEY}
  companyId={companyId}
  userId={user?.uid}
  userRole={userRole}
  userEmail={userEmail}
  setFeedback={setCopyFeedback}
  currentLocation={currentLocation}
  userAccessibleLocations={userAccessibleLocations}
  dataSharingMode={dataSharingMode}
  companyLocations={companyLocations}
  companyTerminals={savedTerminals}
/>
            </div>
    </ErrorBoundary>
  );
};

export default App;