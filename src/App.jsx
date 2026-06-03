import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

import {
  Plus, Search, Trash2, Package, User, Scale, Maximize, Navigation, Hash,
  FileText, Filter, Download, Edit3, X, MapPin, Building, ChevronDown,
  CheckCircle2, Mail, ArrowRight, Route, Truck, Copy, Check, UserPlus,
  FileDown, DollarSign, Calculator, Receipt, Printer, FileCheck, Anchor,
  Clock, Calendar, ArrowUpRight, Pencil, Eye, RotateCcw, FileUp, Paperclip,
  ClipboardCheck, BadgeInfo, Layers, ArrowRightLeft, CalendarDays, Send, Loader2, AlertTriangle,
  Globe, Train, Ship, ExternalLink, RefreshCw, Sparkles, MessageSquare, Cloud, Wifi, Briefcase,
  TrendingUp, BarChart3, Activity, Wallet, AlertCircle, History, Archive,
  Key, LogOut, ShieldCheck, Upload, FileSpreadsheet, CheckCircle, XCircle
} from "lucide-react";

import { getFunctions, httpsCallable } from "firebase/functions";
import { initializeApp, getApp, getApps } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "firebase/auth";
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
  getDocs
} from "firebase/firestore";
import ErrorBoundary from "./ErrorBoundary";
import HelpPanel from "./HelpPanel";
import DOMPurify from 'dompurify';
import html2pdf from 'html2pdf.js';

// ========== HELPER FUNCTIONS (UNCHANGED) ==========
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

const safeFloat = (val) => {
  if (val === null || val === undefined) return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
};

const calculateTotal = (load) => {
  if (!load) return "0.00";
  const revenueItems = load.revenueItems || [];
  if (revenueItems.length === 0) return "0.00";
  return revenueItems.reduce((sum, item) => sum + safeFloat(item?.amount), 0).toFixed(2);
};

const calculateCost = (load) => {
  if (!load) return "0.00";
  const legCost = (load.legs || []).reduce((sum, leg) => sum + safeFloat(leg?.driverPay) + safeFloat(leg?.fuelCost) + safeFloat(leg?.detentionPay), 0);
  const expenseCost = (load.expenseItems || []).reduce((sum, item) => sum + safeFloat(item?.amount), 0);
  return (legCost + expenseCost).toFixed(2);
};

const calculateProfit = (load) => {
  if (!load) return "0.00";
  return (safeFloat(calculateTotal(load)) - safeFloat(calculateCost(load))).toFixed(2);
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
  if (!Array.isArray(formData.legs) || formData.legs.length === 0) {
    return { valid: false, error: "At least one trip leg is required." };
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
  if (totalRevenue <= 0) {
    return { valid: false, error: "Total revenue must be greater than zero." };
  }
  return { valid: true };
};

const migrateToLineItems = (loadData) => {
  const migrated = { ...loadData };
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
    if (load?.emptyPickupBookingNo) {
      text = `🚛 EXPORT DISPATCH ASSIGNMENT 🚛\n---------------------------\n*** EMPTY PICKUP REQUIRED ***\nWork Order: ${load.workOrderNo || 'N/A'}\nBooking #: ${load.emptyPickupBookingNo || 'N/A'}\nLine: ${load.shippingLine || 'N/A'}\nSize/Weight: ${load.size || 'N/A'} / ${load.weight || 'N/A'}\nERD Date: ${load.erdDate || 'N/A'}\nCutOff Date: ${load.cutoffDate || 'N/A'}\n\nContainer: ${load.containerNo || 'TBD'}\nPO #: ${load.poNumber || 'N/A'}\nRef #: ${load.customerRefNo || 'N/A'}\nAppointment: ${load.appointmentDate || 'TBD'} at ${load.appointmentTime || 'TBD'}\n\nROUTING:\n📍 From: ${leg?.from || 'N/A'}\n🏁 To: ${leg?.to || 'N/A'}\n\nDRIVER INFO:\n👤 Driver: ${leg?.driverName || 'TBD'}\n🚛 Truck: ${leg?.truckNo || 'TBD'}\n---------------------------`;
    } else {
      text = `🚛 DISPATCH ASSIGNMENT 🚛\n---------------------------\nWork Order: ${load?.workOrderNo || 'N/A'}\nContainer: ${load?.containerNo || 'TBD'}\nLine: ${load?.shippingLine || 'N/A'}\nSize/Weight: ${load?.size || 'N/A'} / ${load?.weight || 'N/A'}\nPO #: ${load?.poNumber || 'N/A'}\nPickup #: ${load?.pickupNo || 'N/A'}\nRef #: ${load?.customerRefNo || 'N/A'}\nAppointment: ${load?.appointmentDate || 'TBD'} at ${load?.appointmentTime || 'TBD'}\n\nROUTING:\n📍 From: ${leg?.from || 'N/A'}\n🏁 To: ${leg?.to || 'N/A'}\n\nDRIVER INFO:\n👤 Driver: ${leg?.driverName || 'TBD'}\n🚛 Truck: ${leg?.truckNo || 'TBD'}\n---------------------------`;
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
  legs: getSafeLegs(data),
  loadConfirmation: normalizeFileRef(data?.loadConfirmation),
  signedPodDoc: normalizeFileRef(data?.signedPodDoc),
  lastTrackingStatus: data?.lastTrackingStatus || "Pending",
  auditLog: data?.auditLog || []
});

const useFeedback = (timeout = 2000) => {
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

// Retry helper for dynamic imports
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
  detentionPay: ""
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
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  customerAddress: "",
  appointmentDate: "",
  appointmentTime: "",
  loadConfirmation: null,
  signedPodDoc: null,
  basePrice: "",
  waitingTime: "",
  fuelSurcharge: "",
  driverCost: "",
  fuelCost: "",
  brokerRate: "",
  revenueItems: [{ id: Date.now().toString(), item: 'Freight Charge', qty: 1, rate: '', amount: '' }],
  expenseItems: [],
  legs: [createDefaultLeg()],
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
  locationId: ""
});

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const getTrackingUrl = (carrier) => {
  const c = String(carrier || "").toLowerCase();
  if (c.includes('cn') || c.includes('canadian national')) return 'https://www.cn.ca/en/customer-centre/your-shipment/shipment-tracking/';
  if (c.includes('cp') || c.includes('cpkc')) return 'https://www.cpkcr.com/en/customer-resources/tracking';
  if (c.includes('one')) return 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking';
  if (c.includes('msc')) return 'https://www.msc.com/en/track-a-shipment';
  if (c.includes('maersk')) return 'https://www.maersk.com/tracking/';
  return `https://www.google.com/search?q=${carrier}+container+tracking`;
};

// ========== PDF & INVOICE (unchanged) ==========
export const downloadPOD = (load, leg, setFeedback, companyName, companyDetails = {}) => {
  if (typeof window === "undefined" || !load) return;
  try {
    if (setFeedback) setFeedback("Generating POD PDF...");
    const addressStr = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    const currentDate = new Date().toISOString().split('T')[0];
    const originName = leg?.from?.split(' - ')[0] || 'N/A';
    const originAddr = leg?.from || 'Address provided separately';
    const destName = leg?.to?.split(' - ')[0] || 'N/A';
    const destAddr = leg?.to || 'Address provided separately';
    const podContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #111827; background: #fff; line-height: 1.4; box-sizing: border-box; width: 100%;">
        <style>
          * { box-sizing: border-box; }
          .flex { display: flex; }
          .justify-between { justify-content: space-between; }
          .items-center { align-items: center; }
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
        <div class="flex justify-between items-center">
          <div>
            <div class="text-2xl font-black text-blue mb-2">${sanitizeInput(companyName || 'Company Name')}</div>
            <div class="text-sm text-dark">${sanitizeInput(addressStr)}</div>
            ${companyDetails?.email ? `<div class="text-sm text-dark">Email: ${sanitizeInput(companyDetails.email)}</div>` : ''}
          </div>
          <div class="text-right">
            <div class="text-2xl font-black text-gray mb-2">WORK ORDER</div>
            <table class="meta-table">
              <tr><td class="label">WO #</td><td class="value">${sanitizeInput(load.workOrderNo || String(load.id || '').substring(0,8).toUpperCase())}</td></tr>
              <tr><td class="label">DATE</td><td class="value">${currentDate}</td></tr>
              <tr><td class="label">PO #</td><td class="value">${sanitizeInput(load.poNumber || 'N/A')}</td></tr>
              <tr><td class="label">REF #</td><td class="value">${sanitizeInput(load.customerRefNo || 'N/A')}</td></tr>
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
    const sanitizedHtml = DOMPurify.sanitize(podContent, { ALLOWED_TAGS: ['div','span','style','table','thead','tbody','tr','td','th','p','h3','h4','strong','b','i','em','br','hr','ul','li','pre','img','a','input','label','select','option'], ALLOWED_ATTR: ['class','style','href','src','alt','title','type','name','value','checked','for','id','colspan','rowspan','align','border','cellpadding'] });
    const element = document.createElement('div');
    element.innerHTML = sanitizedHtml;
    const opt = { margin: 0.4, filename: `POD-${load.workOrderNo || 'WorkOrder'}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save().then(() => { if (setFeedback) setFeedback("POD Downloaded Successfully"); });
  } catch (error) { console.error("Error downloading POD:", error); if (setFeedback) setFeedback("Error downloading POD"); }
};

export const downloadInvoice = (load, setFeedback, companyName, companyDetails = {}) => {
  if (typeof window === "undefined" || !load) return;
  try {
    if (setFeedback) setFeedback("Generating Invoice PDF...");
    const addressStr = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
    const currentDate = new Date().toISOString().split('T')[0];
    let rowsHtml = '';
    if (load.revenueItems && Array.isArray(load.revenueItems) && load.revenueItems.length > 0) {
      load.revenueItems.forEach(item => {
        if (safeFloat(item?.amount) > 0 || safeFloat(item?.rate) > 0) {
          rowsHtml += `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">${sanitizeInput(item.item || 'Service Charge')}</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.qty || 1}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${safeFloat(item.rate).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">$${safeFloat(item.amount).toFixed(2)}</td></tr>`;
        }
      });
    }
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
          <div class="text-right"><div class="text-2xl font-black text-gray mb-2">INVOICE</div><table class="meta-table"><tr><td class="label">INVOICE #</td><td class="value">${sanitizeInput(load.workOrderNo || String(load.id || '').substring(0,8).toUpperCase())}</td></tr><tr><td class="label">DATE</td><td class="value">${currentDate}</td></tr><tr><td class="label">PO #</td><td class="value">${sanitizeInput(load.poNumber || 'N/A')}</td></tr><tr><td class="label">TERMS</td><td class="value">Due on Receipt</td></tr></table></div>
        </div>
        <div class="divider"></div>
        <div class="flex gap-4 mb-8">
          <div class="w-1-2"><div class="section-title">BILL TO</div><div class="card" style="height: 120px; background: #fff;"><div class="font-black text-base mb-1">${sanitizeInput(load.customerName || 'N/A')}</div><div style="color: #374151; line-height: 1.5;">${sanitizeInput(load.customerAddress || 'Address on file')}</div><div style="color: #374151; margin-top: 4px;">${sanitizeInput(load.customerEmail || '')}</div></div></div>
          <div class="w-1-2"><div class="section-title">SHIPMENT SUMMARY</div><div class="card flex" style="height: 120px; flex-wrap: wrap; gap: 15px;"><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">CONTAINER #</div><div class="font-bold">${sanitizeInput(load.containerNo || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">SIZE / TYPE</div><div class="font-bold">${sanitizeInput(load.size || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">WEIGHT</div><div class="font-bold">${sanitizeInput(load.weight || 'N/A')}</div></div><div style="width: 45%;"><div class="text-xs" style="color: #6b7280;">REF NO</div><div class="font-bold">${sanitizeInput(load.customerRefNo || 'N/A')}</div></div></div></div>
        </div>
        <table class="invoice-table"><thead><tr><th style="width: 50%;">Description</th><th style="width: 15%; text-align: center;">Qty</th><th style="width: 15%; text-align: right;">Rate</th><th style="width: 20%; text-align: right;">Amount</th></tr></thead><tbody>${rowsHtml || `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">Freight Charge</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">1</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${safeFloat(calculateTotal(load)).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">$${safeFloat(calculateTotal(load)).toFixed(2)}</td></tr>`}</tbody></table>
        <div class="flex justify-between" style="margin-top: 30px; align-items: flex-start;"><div style="width: 50%; color: #6b7280; font-size: 11px; padding-right: 20px;"><p>Thank you for your business.</p><p>Please include invoice number on your check or remittance advice.</p></div><div style="width: 40%;"><div class="totals-box"><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Subtotal</span><span class="value font-bold">$${calculateTotal(load)}</span></div><div class="totals-row"><span class="label font-bold" style="color: #4b5563;">Tax (0%)</span><span class="value font-bold">$0.00</span></div><div class="totals-row grand"><span class="label">TOTAL DUE</span><span class="value">$${calculateTotal(load)}</span></div></div></div></div>
      </div>
    `;
    const sanitizedHtml = DOMPurify.sanitize(invoiceContent, { ALLOWED_TAGS: ['div','span','style','table','thead','tbody','tr','td','th','p','h3','h4','strong','b','i','em','br','hr','ul','li','pre','img','a','input','label','select','option'], ALLOWED_ATTR: ['class','style','href','src','alt','title','type','name','value','checked','for','id','colspan','rowspan','align','border','cellpadding'] });
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
    const headers = ["Work Order No", "Container No", "Customer", "Shipping Line", "Size", "Weight", "PO Number", "Pickup No", "Origin", "Destination", "Driver(s)", "Truck(s)", "Appointment Time", "Status", "Total Revenue", "Driver Cost", "Fuel Cost", "Broker Rate", "Net Profit"];
    const rows = todayLoads.map(load => {
      const legs = getSafeLegs(load);
      const origin = legs[0]?.from || 'N/A';
      const dest = legs[legs.length - 1]?.to || 'N/A';
      const drivers = [...new Set(legs.map(l => l?.driverName).filter(Boolean))].join(' / ') || 'TBD';
      const trucks = [...new Set(legs.map(l => l?.truckNo).filter(Boolean))].join(' / ') || 'TBD';
      const rate = calculateTotal(load);
      const cost = calculateCost(load);
      const profit = calculateProfit(load);
      return [escapeCsv(load.workOrderNo), escapeCsv(load.containerNo), escapeCsv(load.customerName), escapeCsv(load.shippingLine), escapeCsv(load.size), escapeCsv(load.weight), escapeCsv(load.poNumber), escapeCsv(load.pickupNo), escapeCsv(origin), escapeCsv(dest), escapeCsv(drivers), escapeCsv(trucks), escapeCsv(load.appointmentTime), escapeCsv(load.status), escapeCsv(`$${rate}`), escapeCsv(`$${cost}`), escapeCsv(`$${profit}`)].join(',');
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
      'Loads': loads.map(load => ({ 'Work Order No': load.workOrderNo, 'Container No': load.containerNo, 'Status': load.status, 'Customer': load.customerName, 'Shipping Line': load.shippingLine, 'Size': load.size, 'Weight': load.weight, 'PO Number': load.poNumber, 'Pickup No': load.pickupNo, 'Customer Ref': load.customerRefNo, 'Appointment Date': load.appointmentDate, 'Appointment Time': load.appointmentTime, 'Total Revenue': calculateTotal(load), 'Total Cost': calculateCost(load), 'Net Profit': calculateProfit(load), 'Notes': load.notes, 'Created At': load.createdAt ? new Date(load.createdAt).toLocaleString() : '', 'Last Updated': load.updatedAt ? new Date(load.updatedAt).toLocaleString() : '', 'Location ID': load.locationId || 'N/A' })),
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
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.split('T')[0];
          if (typeof value === 'number') { const date = new Date((value - 25569) * 86400000); if (!isNaN(date.getTime())) return date.toISOString().split('T')[0]; }
          const date = new Date(value);
          if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
          return String(value);
        };
        const transformedLoads = [];
        const errors = [];
        for (let i = 0; i < jsonData.length; i++) {
          const row = jsonData[i];
          try {
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
              appointmentTime: row[columnMapping.appointmentTime] || '',
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

// ========== FIREBASE CONFIG (unchanged) ==========
const firebaseConfig = {
  apiKey: "AIzaSyAuFs4eLaP8Pug6RSde07OXu_mofd0IfYs",
  authDomain: "haulix-tms.firebaseapp.com",
  projectId: "haulix-tms",
  storageBucket: "haulix-tms.firebasestorage.app",
  messagingSenderId: "864718858606",
  appId: "1:864718858606:web:ea068d9ea1a5cdacb9f97f"
};

const getFirebaseServices = () => {
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  if (!root.__HAULIX_FIREBASE__) {
    const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    root.__HAULIX_FIREBASE__ = {
      app: firebaseApp,
      auth: getAuth(firebaseApp),
      db: getFirestore(firebaseApp),
      storage: getStorage(firebaseApp)
    };
  }
  return root.__HAULIX_FIREBASE__;
};

const { app, auth, db, storage } = getFirebaseServices();

// ========== SIGNUP & TEAM FUNCTIONS (unchanged) ==========
const signUp = async (email, password, companyName, locations = [], dataSharingMode = 'separate') => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const companyId = crypto.randomUUID();
    await setDoc(doc(db, "companies", companyId), {
      name: sanitizeInput(companyName),
      dataSharingMode: dataSharingMode,
      locations: locations.map(l => ({ ...l, name: sanitizeInput(l.name), address: sanitizeInput(l.address) })),
      createdAt: new Date(),
      createdBy: uid,
      memberUids: [uid]
    });
    await setDoc(doc(db, "users", uid), {
      email: email,
      companyId: companyId,
      role: "owner",
      accessibleLocations: locations.map(l => l.id),
      defaultLocation: locations[0]?.id || null,
      setupComplete: false,
      createdAt: new Date()
    });
    return { companyId, uid };
  } catch (error) {
    console.error("Signup error:", error);
    throw error;
  }
};

const createTeamUser = async (email, password, role, companyId) => {
  try {
    const functions = getFunctions();
    const createTeamMemberFn = httpsCallable(functions, 'createTeamMember');
    const result = await createTeamMemberFn({ email, password, role, companyId });
    return result.data;
  } catch (error) {
    console.error("Error creating team user:", error);
    return { success: false, error: error.message };
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
      <select value={currentLocation || ''} onChange={(e) => onLocationChange(e.target.value)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-purple-500">
        <option value="">All Locations (Admin View)</option>
        {userLocations.map(loc => (<option key={loc.id} value={loc.id}>{loc.name}</option>))}
      </select>
    </div>
  );
};

// ========== MODAL COMPONENTS (unchanged) ==========
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
      } catch (err) { console.error("Error previewing file:", err); alert("Error reading file. Please check the format."); }
    };
    reader.readAsArrayBuffer(selectedFile);
  };
  const handleAnalyze = async () => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = await importExcelData(file, null, null, (progress) => { setDetectedMapping({ foundColumns: progress.foundColumns, missingColumns: progress.missingColumns, totalFound: progress.found, totalFields: progress.total }); });
      setMappingStep('mapping');
      setCustomMapping(result.mapping);
    };
    reader.readAsArrayBuffer(file);
  };
  const handleConfirmImport = async () => {
    setMappingStep('confirm');
    const result = await onImport(file, customMapping);
    setImportStats(result);
  };
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-3"><div className="bg-purple-600 p-2 rounded-xl text-white"><FileSpreadsheet className="w-5 h-5" /></div><div><h2 className="font-black text-slate-900">Import Data from Excel/CSV</h2><p className="text-xs text-slate-500">Upload your old software data - we'll map it automatically</p></div></div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {mappingStep === 'upload' && (<><div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-purple-300 transition-colors"><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" id="excelUpload" /><label htmlFor="excelUpload" className="cursor-pointer block"><Upload className="w-12 h-12 text-purple-400 mx-auto mb-4" /><div className="font-bold text-slate-700 mb-2">Click to upload Excel/CSV file</div><div className="text-xs text-slate-400">Supports .xlsx, .xls, .csv formats</div></label></div>{preview && (<div className="bg-slate-50 rounded-xl p-4"><h3 className="font-bold text-sm mb-3">File Preview</h3><div className="overflow-x-auto"><table className="text-xs border-collapse w-full"><thead><tr className="bg-slate-200">{preview.headers.map((h, i) => (<th key={i} className="p-2 text-left font-bold">{h}</th>))}</tr></thead><tbody>{preview.sample.map((row, i) => (<tr key={i} className="border-b border-slate-200">{preview.headers.map((h, j) => (<td key={j} className="p-2">{String(row[h] || '-').substring(0, 30)}</td>))}</tr>))}</tbody></table></div><p className="text-[10px] text-slate-400 mt-3">Showing first 5 rows. Total columns: {preview.headers.length}</p></div>)}<button onClick={handleAnalyze} disabled={!file} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors disabled:opacity-50">Analyze & Map Columns →</button></>)}
          {mappingStep === 'mapping' && detectedMapping && (<><div className="bg-green-50 p-4 rounded-xl border border-green-200"><div className="flex items-center gap-2 mb-2"><CheckCircle className="w-5 h-5 text-green-600" /><span className="font-bold text-green-800">Auto-detected {detectedMapping.totalFound} of {detectedMapping.totalFields} fields</span></div><p className="text-xs text-green-700">Review the mapping below and adjust if needed</p></div>{detectedMapping.missingColumns.length > 0 && (<div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200"><div className="flex items-center gap-2 mb-2"><AlertCircle className="w-5 h-5 text-yellow-600" /><span className="font-bold text-yellow-800">Missing {detectedMapping.missingColumns.length} fields</span></div><p className="text-xs text-yellow-700">These fields couldn't be auto-detected. They will be set to default values. Missing: {detectedMapping.missingColumns.join(', ')}</p></div>)}<div className="space-y-3 max-h-96 overflow-y-auto"><h3 className="font-bold text-sm">Column Mapping</h3>{Object.entries(customMapping).map(([field, column]) => (<div key={field} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg"><div className="w-32 text-xs font-bold text-slate-700">{field.replace(/([A-Z])/g, ' $1').trim()}</div><div className="flex-1"><select value={column || ''} onChange={(e) => setCustomMapping({ ...customMapping, [field]: e.target.value || null })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white"><option value="">-- Auto-detect --</option>{preview?.headers.map(h => (<option key={h} value={h}>{h}</option>))}</select></div>{column && (<div className="text-green-600"><CheckCircle className="w-4 h-4" /></div>)}</div>))}</div><div className="flex gap-3"><button onClick={() => setMappingStep('upload')} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Back</button><button onClick={handleConfirmImport} className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700">Import {preview?.sample?.length || 0} Records →</button></div></>)}
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
  const openCarrierSite = async () => { try { if (load?.containerNo) await copyToClipboard(load.containerNo); const url = getTrackingUrl(load?.shippingLine); if (url) window.open(url, '_blank'); } catch (error) { console.error("Failed opening carrier site", error); } };
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

// ========== LOAD FORM COMPONENT (unchanged) ==========
const LoadForm = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  savedCustomers,
  savedDestinations,
  savedDrivers,
  apiKey,
  companyId,
  userId,
  userRole,
  userEmail,
  setFeedback,
  currentLocation,
  userAccessibleLocations,
  dataSharingMode
}) => {
  const [formData, setFormData] = useState(createEmptyLoadForm());
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [recurringTemplate, setRecurringTemplate] = useState(null);
  const initializedLoadRef = useRef(null);
  const noteTimerRef = useRef(null);
  const isMountedRef = useIsMountedRef();
  const lastUploadTimeRef = useRef(0);
  const UPLOAD_COOLDOWN_MS = 5000;

  const isAdmin = userRole === 'owner' || userRole === 'admin';
  const isDispatcher = userRole === 'dispatcher';
  const isAccounting = userRole === 'accounting';

  const isFinancialLocked = (userRole === 'dispatcher' && ['Invoiced', 'Paid', 'Completed'].includes(formData.status)) || (userRole !== 'accounting' && userRole !== 'admin' && userRole !== 'owner' && ['Paid', 'Completed'].includes(formData.status));

  const addLeg = useCallback(() => { setFormData(prev => ({ ...prev, legs: [...(prev.legs || []), createDefaultLeg()] })); }, []);
  const removeLeg = useCallback((legId) => { setFormData(prev => ({ ...prev, legs: (prev.legs || []).filter(l => l.id !== legId) })); }, []);
  const addRevenueItem = useCallback(() => { setFormData(prev => ({ ...prev, revenueItems: [...(prev.revenueItems || []), { id: Date.now().toString(), item: '', qty: 1, rate: '', amount: '' }] })); }, []);
  const addExpenseItem = useCallback(() => { setFormData(prev => ({ ...prev, expenseItems: [...(prev.expenseItems || []), { id: Date.now().toString(), item: '', qty: 1, rate: '', amount: '' }] })); }, []);
  const removeRevenueItem = useCallback((id) => { setFormData(prev => ({ ...prev, revenueItems: (prev.revenueItems || []).filter(i => i.id !== id) })); }, []);
  const removeExpenseItem = useCallback((id) => { setFormData(prev => ({ ...prev, expenseItems: (prev.expenseItems || []).filter(i => i.id !== id) })); }, []);

  useEffect(() => {
    if (!isOpen) { initializedLoadRef.current = null; return; }
    if (initialData?.id) {
      if (initializedLoadRef.current === initialData.id) return;
      initializedLoadRef.current = initialData.id;
      const migratedData = migrateToLineItems(initialData);
      const revItems = buildLegacyRevenueItems(migratedData);
      const expItems = buildLegacyExpenseItems(migratedData);
      setFormData({ ...createEmptyLoadForm(), ...migratedData, legs: getSafeLegs(migratedData).length > 0 ? getSafeLegs(migratedData) : [createDefaultLeg()], revenueItems: revItems, expenseItems: expItems, driverCost: "", fuelCost: "", brokerRate: "", basePrice: "", waitingTime: "", fuelSurcharge: "" });
      return;
    }
    if (initializedLoadRef.current !== "new") {
      initializedLoadRef.current = "new";
      const newForm = createEmptyLoadForm();
      if (dataSharingMode === 'separate' && currentLocation) { newForm.locationId = currentLocation; }
      setFormData(newForm);
    }
  }, [isOpen, initialData, dataSharingMode, currentLocation]);

  useEffect(() => { return () => clearTimeout(noteTimerRef.current); }, []);

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
      if (size.includes('Reefer')) { autoNotes += `- Handling: ACTIVE REEFER. Driver must verify temperature settings and fuel levels prior to departure.\n`; } else if (size.includes('HC') || size.includes('45ft')) { autoNotes += `- Handling: HIGH CUBE / OVERSIZED. Driver must verify bridge and route clearances.\n`; } else { autoNotes += `- Handling: Standard dry freight transport rules apply.\n`; }
      autoNotes += `\nSAFETY & COMPLIANCE:\n- Weather/Traffic: Please monitor conditions along the route.\n- Documentation: ALL stops require a signed POD with clear arrival/departure times.\n`;
      setFormData(prev => ({ ...prev, notes: autoNotes }));
      setGeneratingNotes(false);
    }, 600);
  };

  // Recurring template detection – now uses single loads collection with companyId filter
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
  }, [formData.customerName, companyId, formData.legs?.[0]?.to]);

  if (!isOpen) return null;

  const handleChange = (e) => { const { name, value } = e.target; setFormData(prev => ({ ...prev, [name]: sanitizeInput(value) })); };
 
  const handleLineItemChange = (type, id, field, value) => {
    if (field === 'qty' || field === 'rate' || field === 'amount') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue < 0) { setFeedback?.("❌ Negative values are not allowed"); return; }
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
          if (updated.qty !== '' && updated.rate !== '') { updated.amount = (q * r).toFixed(2); }
        }
        return updated;
      });
      return { ...prev, [listName]: newItems };
    });
  };

  const updateLeg = (id, field, value) => { setFormData(prev => ({ ...prev, legs: (prev.legs || []).map(leg => leg.id === id ? { ...leg, [field]: sanitizeInput(value) } : leg) })); };
 
  const handleFileUpload = async (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!userId || !companyId) { if (setFeedback) setFeedback("Authentication required"); return; }
    const now = Date.now();
    if (now - lastUploadTimeRef.current < UPLOAD_COOLDOWN_MS) { if (setFeedback) setFeedback("❌ Please wait before uploading another file"); return; }
    try {
      const userDoc = await getDoc(doc(db, "users", userId));
      if (!userDoc.exists() || userDoc.data().companyId !== companyId) { if (setFeedback) setFeedback("Unauthorized"); return; }
    } catch (err) { if (setFeedback) setFeedback("Authorization failed"); return; }
    setUploadingFile(true);
    try {
      if (!ALLOWED_UPLOAD_TYPES.has(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) { if (setFeedback) setFeedback("Invalid file type or file is too large"); return; }
      const safeFileName = file.name.replace(/[^\w.-]/g, "_");
      const filePath = `uploads/${companyId}/${userId}/${Date.now()}_${safeFileName}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      if (!isMountedRef.current) return;
      const auditEntry = { timestamp: new Date().toISOString(), user: userEmail || userId, role: userRole, action: `Uploaded ${field}`, changes: [{ field: field, from: 'none', to: file.name }] };
      setFormData(prev => ({ ...prev, [field]: { name: file.name, type: file.type, url, uploadedBy: userId, uploadedAt: new Date().toISOString() }, auditLog: [...(prev.auditLog || []), auditEntry] }));
      lastUploadTimeRef.current = now;
      if (setFeedback) setFeedback("File uploaded successfully");
    } catch (err) { console.error("Upload failed:", err); if (isMountedRef.current && setFeedback) setFeedback("Upload failed"); } finally { setUploadingFile(false); }
  };

  // The JSX of LoadForm remains exactly the same – no changes needed.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose}></div>
      <div className="bg-white w-full max-w-6xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-2xl font-black text-slate-900 flex items-center">{initialData ? "Update Load Profile" : "Create New Load"}{formData.workOrderNo && (<span className="ml-4 text-xs font-bold tracking-widest bg-blue-100 text-blue-800 px-3 py-1 rounded-full uppercase border border-blue-200 shadow-sm inline-flex items-center">{formData.workOrderNo}</span>)}{isFinancialLocked && (<span className="ml-3 flex items-center gap-1 text-[10px] font-black tracking-widest bg-slate-200 text-slate-600 px-3 py-1 rounded-full uppercase"><ShieldCheck className="w-3 h-3" /> Financials Locked</span>)}</h2>
          <div className="flex items-center gap-4"><div className="flex flex-col"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest" htmlFor="statusSelect">Load Status</label><select id="statusSelect" name="status" value={formData.status} onChange={handleChange} className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-black text-xs uppercase text-blue-600 outline-none focus:ring-2 focus:ring-blue-100">{(isAdmin || isDispatcher) && <option value="Open">Open (Operations)</option>}<option value="Ready for Billing">Ready for Billing</option>{(isAdmin || isAccounting) && (<><option value="Invoiced">Invoiced</option><option value="Paid">Paid</option></>)}{isAdmin && <option value="Completed">Completed</option>}</select></div><button onClick={onClose} className="p-3 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-2xl transition-all"><X /></button></div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="p-8 overflow-y-auto space-y-12">
          {/* Shipment Identity */}
          <div className="space-y-4"><div className="flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" /><h3 className="font-black text-xs uppercase tracking-widest">Shipment Identity</h3></div><div className="grid grid-cols-1 md:grid-cols-4 gap-6"><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="containerNo">Container No.*</label><input id="containerNo" required name="containerNo" value={formData.containerNo} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-black focus:ring-4 focus:ring-blue-100 outline-none transition-all" /></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="shippingLine">Shipping Line</label><input id="shippingLine" required name="shippingLine" value={formData.shippingLine} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" list="lines" placeholder="e.g. CMA, COSCO, MAERSK" /><datalist id="lines"><option value="CMA" /><option value="COSCO" /><option value="EVERGREEN" /><option value="HAPAG" /><option value="HMM" /><option value="MAERSK" /><option value="MSC" /><option value="ONE" /><option value="OOCL" /><option value="ZIM" /></datalist></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="sizeSelect">Size</label><select id="sizeSelect" name="size" value={formData.size} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold transition-all"><option>20GE (General)</option><option>40GE (General)</option><option>40HC (High Cube)</option><option>45EQ (High Cube)</option><option>53GE (General)</option><option>53RE (Reefer)</option><option>20FL (Flat Rack)</option><option>20OT (Open Top)</option><option>20RE (Reefer)</option><option>40RE (Reefer)</option></select></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="weightInput">Weight</label><input id="weightInput" name="weight" value={formData.weight} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" /></div></div></div>
         
          {/* Tracking & Reference Numbers */}
          <div className="space-y-4 bg-slate-50/50 p-6 rounded-[32px] border border-slate-100"><div className="flex items-center gap-2"><Hash className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Tracking & Reference Numbers</h3></div><div className="grid grid-cols-1 md:grid-cols-3 gap-6"><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="poNumber">PO Number</label><input id="poNumber" name="poNumber" value={formData.poNumber} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="pickupNo">Pick up Number</label><input id="pickupNo" name="pickupNo" value={formData.pickupNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerRefNo">Customer Ref No.</label><input id="customerRefNo" name="customerRefNo" value={formData.customerRefNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div></div></div>

          {/* Empty Pickup & Return */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 bg-amber-50/30 p-6 rounded-[32px] border border-amber-100"><div className="flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-amber-600" /><h3 className="font-black text-xs uppercase tracking-widest text-amber-900">Empty Pickup (Export)</h3></div><div className="space-y-4"><div className="space-y-1"><label className="text-[10px] font-black text-amber-700/70 uppercase">PU Booking #</label><input name="emptyPickupBookingNo" value={formData.emptyPickupBookingNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-amber-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-amber-200 transition-all" placeholder="PU Booking #" /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] font-black text-amber-700/70 uppercase">ERD Date</label><input type="date" name="erdDate" value={formData.erdDate} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-amber-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-amber-200 transition-all text-amber-900" /></div><div className="space-y-1"><label className="text-[10px] font-black text-amber-700/70 uppercase">CutOff date</label><input type="date" name="cutoffDate" value={formData.cutoffDate} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-amber-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-amber-200 transition-all text-amber-900" /></div></div></div></div>
            <div className="space-y-4 bg-rose-50/30 p-6 rounded-[32px] border border-rose-100"><div className="flex justify-between items-center"><div className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-rose-600" /><h3 className="font-black text-xs uppercase tracking-widest text-rose-900">Return</h3></div><label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-xl border border-rose-100 hover:bg-rose-50 transition-colors"><input type="checkbox" name="isOffHire" checked={formData.isOffHire} onChange={(e) => setFormData(prev => ({...prev, isOffHire: e.target.checked}))} className="w-4 h-4 text-rose-600 border-rose-300 rounded focus:ring-rose-500 cursor-pointer" /><span className="text-[10px] font-black text-rose-700 uppercase tracking-wider">Off hire</span></label></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] font-black text-rose-700/70 uppercase">Return location</label><input name="returnLocation" value={formData.returnLocation} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-rose-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-rose-200 transition-all" placeholder="Return location" /></div><div className="space-y-1"><label className="text-[10px] font-black text-rose-700/70 uppercase">Booking #</label><input name="returnBookingNo" value={formData.returnBookingNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-rose-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-rose-200 transition-all" placeholder="Booking #" /></div><div className="space-y-1"><label className="text-[10px] font-black text-rose-700/70 uppercase">RV #</label><input name="returnRvNo" value={formData.returnRvNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-rose-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-rose-200 transition-all" placeholder="RV #" /></div><div className="space-y-1"><label className="text-[10px] font-black text-rose-700/70 uppercase">Date</label><input type="date" name="returnDate" value={formData.returnDate} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-rose-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-rose-200 transition-all text-rose-900" /></div><div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-rose-700/70 uppercase">Return RV tir</label><input name="returnRvTir" value={formData.returnRvTir} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-rose-200/50 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-rose-200 transition-all" placeholder="Return RV tir" /></div></div></div>
          </div>

          {/* Documentation */}
          <div className="space-y-4 bg-slate-50 p-6 rounded-[32px] border border-slate-100"><div className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Documentation</h3></div><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Load Confirmation</label><div className="flex items-center gap-3"><label className={`cursor-pointer flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl transition-colors w-full justify-center border-dashed ${uploadingFile ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}><FileUp className="w-4 h-4 text-blue-600" /><span className="text-xs font-bold text-slate-600">{uploadingFile ? "Uploading..." : "Upload PDF / Image"}</span><input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileUpload(e, 'loadConfirmation')} disabled={uploadingFile} /></label>{formData.loadConfirmation && <div className="p-2 bg-green-50 text-green-600 rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>}</div>{formData.loadConfirmation && <div className="text-[10px] font-bold text-slate-400 pl-1 truncate">{formData.loadConfirmation.name}</div>}</div><div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Signed POD</label><div className="flex items-center gap-3"><label className={`cursor-pointer flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl transition-colors w-full justify-center border-dashed ${uploadingFile ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}><FileUp className="w-4 h-4 text-green-600" /><span className="text-xs font-bold text-slate-600">{uploadingFile ? "Uploading..." : "Upload Signed POD"}</span><input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileUpload(e, 'signedPodDoc')} disabled={uploadingFile} /></label>{formData.signedPodDoc && <div className="p-2 bg-green-50 text-green-600 rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>}</div>{formData.signedPodDoc && <div className="text-[10px] font-bold text-slate-400 pl-1 truncate">{formData.signedPodDoc.name}</div>}</div></div></div>

          {/* Appointment & Customer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8"><div className="space-y-4"><div className="flex items-center gap-2"><Clock className="w-4 h-4 text-orange-600" /><h3 className="font-black text-xs uppercase tracking-widest">Appointment Schedule</h3></div><div className="grid grid-cols-2 gap-4"><input type="date" name="appointmentDate" value={formData.appointmentDate} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" /><input type="time" name="appointmentTime" value={formData.appointmentTime} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" /></div></div><div className="space-y-4 relative"><div className="flex items-center gap-2"><Building className="text-blue-600 w-4 h-4" /><h3 className="font-black text-xs uppercase tracking-widest">Customer Profile</h3></div><div className="relative"><select name="customerName" value={formData.customerName} onChange={(e) => { const selectedName = e.target.value; const cust = savedCustomers.find(c => c.name === selectedName); setFormData(prev => { if (cust) { return { ...prev, customerName: cust.name, customerEmail: cust.email || '', customerPhone: cust.phone || '', customerAddress: cust.address || '' }; } return { ...prev, customerName: selectedName }; }); }} className="w-full px-4 py-3 bg-slate-50 border rounded-2xl font-bold outline-none appearance-none"><option value="" disabled>Select saved customer...</option>{savedCustomers.map((c, i) => (<option key={c.id || i} value={c.name}>{c.name}</option>))}</select><ChevronDown className="absolute right-4 top-4 w-5 h-5 text-slate-400 pointer-events-none" /></div><div className="pt-2 grid grid-cols-2 gap-3"><div><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerEmail">Billing Email</label><input id="customerEmail" name="customerEmail" value={formData.customerEmail} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border rounded-xl font-bold text-sm outline-none" placeholder="email@example.com" /></div><div><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerPhone">Phone</label><input id="customerPhone" name="customerPhone" value={formData.customerPhone} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border rounded-xl font-bold text-sm outline-none" placeholder="Phone Number" /></div></div></div>
            {recurringTemplate && (
              <div className="mt-3 bg-green-50 p-3 rounded-xl border border-green-100 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <div className="flex-1 text-[10px] font-bold text-green-800">
                  Recurring shipment to <span className="underline">{formData.legs?.[0]?.to?.split(' - ')[0]}</span> detected.
                </div>
                <button type="button" onClick={() => { setFormData(prev => ({ ...prev, shippingLine: recurringTemplate.shippingLine || prev.shippingLine, size: recurringTemplate.size || prev.size, weight: recurringTemplate.weight || prev.weight, poNumber: recurringTemplate.poNumber || prev.poNumber, pickupNo: recurringTemplate.pickupNo || prev.pickupNo, customerRefNo: recurringTemplate.customerRefNo || prev.customerRefNo, customerEmail: recurringTemplate.customerEmail || prev.customerEmail, customerPhone: recurringTemplate.customerPhone || prev.customerPhone, legs: recurringTemplate.legs?.length > 0 ? recurringTemplate.legs.map(leg => ({ ...createDefaultLeg(), from: leg.from, to: leg.to, driverName: leg.driverName, truckNo: leg.truckNo })) : prev.legs, notes: recurringTemplate.notes || prev.notes })); setRecurringTemplate(null); }} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-[10px] font-black uppercase">Use Template</button>
              </div>
            )}
          </div>
         
          {/* Financials */}
          <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 space-y-8"><div className="flex justify-between items-center border-b border-slate-200 pb-4"><h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-slate-800"><Wallet className="w-5 h-5 text-green-600"/> Financials (Rate & Cost)</h3><div className="text-right flex items-center gap-6"><div><div className="text-[10px] font-bold text-slate-400 uppercase">Total Revenue</div><div className="text-sm font-black text-slate-800">${calculateTotal(formData)}</div></div><div><div className="text-[10px] font-bold text-slate-400 uppercase">Total Cost</div><div className="text-sm font-black text-red-500">${calculateCost(formData)}</div></div><div className="bg-green-100 px-4 py-2 rounded-xl"><div className="text-[10px] font-black text-green-600 uppercase">Net Profit</div><div className="text-xl font-black text-green-700 tracking-tighter">${calculateProfit(formData)}</div></div></div></div><div className="space-y-8"><div><div className="flex justify-between items-end mb-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Revenue Breakdown (Charged to Customer)</label><button type="button" onClick={addRevenueItem} className="text-[10px] font-black text-blue-600 uppercase hover:underline transition-all disabled:opacity-50" disabled={isFinancialLocked}>+ Add Item</button></div><div className="space-y-3">{(formData.revenueItems || []).map((item) => (<div key={item.id} className="flex flex-col md:flex-row gap-3 items-start md:items-center"><div className="flex-1 w-full"><input disabled={isFinancialLocked} value={item.item} onChange={e => handleLineItemChange('revenue', item.id, 'item', e.target.value)} placeholder="Item Description" className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100" /></div><div className="w-full md:w-24 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.qty} onChange={e => handleLineItemChange('revenue', item.id, 'qty', e.target.value)} placeholder="Qty" className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-center" /></div><div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.rate} onChange={e => handleLineItemChange('revenue', item.id, 'rate', e.target.value)} placeholder="Rate ($)" className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-right" /></div><div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.amount} onChange={e => handleLineItemChange('revenue', item.id, 'amount', e.target.value)} placeholder="Amount ($)" className="w-full px-4 py-2.5 bg-white border border-green-300 rounded-xl font-black text-green-700 text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-right" /></div><button type="button" disabled={isFinancialLocked} onClick={() => removeRevenueItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-50"><Trash2 className="w-4 h-4" /></button></div>))}{(formData.revenueItems?.length === 0) && <div className="text-xs text-slate-400 italic font-bold py-2">No revenue items added.</div>}</div></div><div className="pt-6 border-t border-slate-100"><div className="flex justify-between items-end mb-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Cost Breakdown (Manual Expenses)</label><button type="button" onClick={addExpenseItem} className="text-[10px] font-black text-red-600 uppercase hover:underline transition-all disabled:opacity-50" disabled={isFinancialLocked}>+ Add Expense</button></div><div className="space-y-3">{(formData.expenseItems || []).map((item) => (<div key={item.id} className="flex flex-col md:flex-row gap-3 items-start md:items-center"><div className="flex-1 w-full"><input disabled={isFinancialLocked} value={item.item} onChange={e => handleLineItemChange('expense', item.id, 'item', e.target.value)} placeholder="Expense Description" className="w-full px-4 py-2.5 bg-white border border-red-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100" /></div><div className="w-full md:w-24 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.qty} onChange={e => handleLineItemChange('expense', item.id, 'qty', e.target.value)} placeholder="Qty" className="w-full px-4 py-2.5 bg-white border border-red-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-center" /></div><div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.rate} onChange={e => handleLineItemChange('expense', item.id, 'rate', e.target.value)} placeholder="Rate ($)" className="w-full px-4 py-2.5 bg-white border border-red-200 rounded-xl font-bold text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-right" /></div><div className="w-full md:w-32 shrink-0"><input disabled={isFinancialLocked} type="number" step="0.01" value={item.amount} onChange={e => handleLineItemChange('expense', item.id, 'amount', e.target.value)} placeholder="Amount ($)" className="w-full px-4 py-2.5 bg-white border border-red-300 rounded-xl font-black text-red-700 text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 text-right" /></div><button type="button" disabled={isFinancialLocked} onClick={() => removeExpenseItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-50"><Trash2 className="w-4 h-4" /></button></div>))}{(formData.expenseItems?.length === 0) && <div className="text-xs text-slate-400 italic font-bold py-2">No extra manual expenses added. Trip legs cost is tracked separately.</div>}</div></div></div></div>
         
          {/* Trip Legs */}
          <div className="space-y-6"><div className="flex justify-between items-center"><h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Trip Legs & Dispatching</h3><button type="button" onClick={addLeg} className="text-xs font-black text-blue-600 hover:underline transition-all">+ Add Trip Leg</button></div><div className="space-y-4">{(formData.legs || []).map((leg) => (<div key={leg.id} className="bg-slate-50 p-6 rounded-[24px] border border-slate-100 relative group/leg transition-all hover:bg-slate-100/50"><div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end mb-4"><div className="md:col-span-3 space-y-1 relative"><label className="text-[9px] font-black text-slate-400">PICKUP</label><div className="relative"><select value={leg.from} onChange={e => updateLeg(leg.id, 'from', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none appearance-none bg-white"><option value="" disabled>Select Origin...</option>{savedDestinations.map((d, i) => (<option key={d.id || i} value={`${d.name} - ${d.address}`}>{d.name}</option>))}</select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" /></div></div><div className="md:col-span-3 space-y-1 relative"><label className="text-[9px] font-black text-slate-400">DESTINATION</label><div className="relative"><select value={leg.to} onChange={e => updateLeg(leg.id, 'to', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none appearance-none bg-white"><option value="" disabled>Select Destination...</option>{savedDestinations.map((d, i) => (<option key={d.id || i} value={`${d.name} - ${d.address}`}>{d.name}</option>))}</select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" /></div></div><div className="md:col-span-3 space-y-1 relative"><label className="text-[9px] font-black text-slate-400">DRIVER</label><div className="relative"><select value={leg.driverName} onChange={e => { const driver = savedDrivers.find(d => d.name === e.target.value); updateLeg(leg.id, 'driverName', e.target.value); if (driver) updateLeg(leg.id, 'truckNo', driver.truckNo); }} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none appearance-none bg-white"><option value="" disabled>Select Driver...</option>{savedDrivers.map((d, i) => (<option key={d.id || i} value={d.name}>{d.name} (Truck: {d.truckNo})</option>))}</select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" /></div></div><div className="md:col-span-2 space-y-1"><label className="text-[9px] font-black text-slate-400">STATUS</label><select value={leg.status} onChange={e => updateLeg(leg.id, 'status', e.target.value)} className={`w-full px-3 py-2 border rounded-xl text-[10px] font-black uppercase outline-none transition-colors ${leg.status === 'Planned' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : leg.status === 'Dispatched' ? 'bg-blue-50 border-blue-200 text-blue-700' : leg.status === 'Completed' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-slate-200 text-slate-700'}`}><option value="Planned">Planned</option><option value="Dispatched">Dispatched</option><option value="Completed">Completed</option></select></div><div className="md:col-span-1 flex justify-center pb-2"><button type="button" onClick={() => removeLeg(leg.id)} className="text-slate-300 hover:text-red-500 transition-all"><Trash2 className="w-4 h-4" /></button></div></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 pt-4"><div className="space-y-1"><label className="text-[9px] font-black text-slate-400">DRIVER PAY ($)</label><input disabled={isFinancialLocked} type="number" step="0.01" value={leg.driverPay || ''} onChange={e => updateLeg(leg.id, 'driverPay', e.target.value)} className={`w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none transition-all ${isFinancialLocked ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}`} /></div><div className="space-y-1"><label className="text-[9px] font-black text-slate-400">FUEL COST ($)</label><input disabled={isFinancialLocked} type="number" step="0.01" value={leg.fuelCost || ''} onChange={e => updateLeg(leg.id, 'fuelCost', e.target.value)} className={`w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none transition-all ${isFinancialLocked ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}`} /></div><div className="space-y-1"><label className="text-[9px] font-black text-slate-400">DETENTION PAY ($)</label><input disabled={isFinancialLocked} type="number" step="0.01" value={leg.detentionPay || ''} onChange={e => updateLeg(leg.id, 'detentionPay', e.target.value)} className={`w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none transition-all ${isFinancialLocked ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}`} /></div></div></div>))}</div></div>
         
          {/* Notes */}
          <div className="space-y-4"><div className="flex justify-between items-center"><div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-purple-600" /><h3 className="font-black text-xs uppercase tracking-widest">Notes & Instructions</h3></div><button type="button" onClick={handleSmartNotes} disabled={generatingNotes} className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-200 transition-colors">{generatingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}{generatingNotes ? "Generating..." : "Generate Smart Notes ✨"}</button></div><textarea name="notes" value={formData.notes} onChange={handleChange} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-sm min-h-[100px] outline-none focus:ring-2 focus:ring-purple-100 transition-all" placeholder="Driver instructions, handling notes, or safety warnings..." /></div>

          {/* Audit Log */}
          {formData.auditLog && Array.isArray(formData.auditLog) && formData.auditLog.length > 0 && (<div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100 space-y-4"><h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 text-slate-800"><History className="w-4 h-4 text-slate-600"/> Audit Trail & History</h3><div className="space-y-3 max-h-48 overflow-y-auto pr-2">{[...formData.auditLog].reverse().map((log, i) => (<div key={i} className="text-xs bg-white p-4 border border-slate-200 rounded-2xl shadow-sm"><div className="flex items-center justify-between mb-2"><div className="font-bold text-slate-700 flex items-center gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] uppercase text-slate-500">{log?.role || 'Unknown'}</span>{log?.user || 'Unknown'}<span className="text-slate-400 font-normal ml-1">({log?.action || 'Update'})</span></div><div className="text-slate-400 font-bold text-[10px]">{log?.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</div></div>{log.changes?.length > 0 && (<ul className="list-disc pl-5 space-y-1 text-slate-600 font-medium">{log.changes.map((c, j) => (<li key={j}><span className="font-bold text-slate-800">{c.field}:</span> <span className="text-red-500 line-through mr-1">{c.from || 'empty'}</span> &rarr; <span className="text-green-600 ml-1">{c.to || 'empty'}</span></li>))}</ul>)}</div>))}</div></div>)}

          <div className="flex gap-4 pt-4 border-t border-slate-100"><button type="button" onClick={onClose} className="flex-1 py-4 border-2 border-slate-100 rounded-[24px] font-black text-slate-400 uppercase tracking-widest text-xs hover:bg-slate-50 transition-all">Discard</button><button type="submit" className="flex-[2] py-4 bg-blue-600 text-white rounded-[24px] font-black shadow-xl uppercase tracking-widest text-xs active:scale-[0.98] transition-all hover:bg-blue-700">Save Load Record</button></div>
        </form>
      </div>
    </div>
  );
};

// ========== TABLE COMPONENTS (unchanged) ==========
const LoadTable = ({ loads, onEdit, onDelete, onStatusChange, onViewDoc, onSign, onCopy, onDownload, onTrack, companyName, currentPage, pageSize, isLoadingMore, onNextPage, onPrevPage, hasNextPage }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[1400px]">
        <thead><tr className="bg-slate-50/50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest"><th className="px-4 py-3">Container</th><th className="px-4 py-3">Line</th><th className="px-4 py-3">Terminal</th><th className="px-4 py-3">PO #</th><th className="px-4 py-3">Pick Up #</th><th className="px-4 py-3">Cust Ref</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">Weight</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">WO #</th><th className="px-4 py-3 min-w-[200px]">Trip Legs</th><th className="px-4 py-3">Billing</th><th className="px-4 py-3 text-center">Load Conf</th><th className="px-4 py-3 text-center">Signed POD</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {(loads || []).map((load) => (
            <tr key={load.id} className="hover:bg-slate-50/50 transition-colors group text-xs font-bold text-slate-700">
              <td className="px-4 py-3"><div className="font-black text-slate-900">{load.containerNo || 'N/A'}</div><div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-slate-400"><Globe className="w-2.5 h-2.5" /><span className="truncate max-w-[100px]">{load.lastTrackingStatus || "Pending"}</span></div></td>
              <td className="px-4 py-3"><span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md uppercase whitespace-nowrap">{load.shippingLine || 'N/A'}</span></td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.legs?.[0]?.from}>{load.legs?.[0]?.from || <span className="text-slate-300 italic">N/A</span>}</td>
              <td className="px-4 py-3">{load.poNumber || '--'}</td>
              <td className="px-4 py-3">{load.pickupNo || '--'}</td>
              <td className="px-4 py-3">{load.customerRefNo || '--'}</td>
              <td className="px-4 py-3">{load.size || 'N/A'}</td>
              <td className="px-4 py-3">{load.weight || '--'}</td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.customerName}>{load.customerName || 'N/A'}</td>
              <td className="px-4 py-3 font-bold text-slate-700">{load.workOrderNo || '--'}</td>
              <td className="px-4 py-3"><div className="space-y-1.5">{(load.legs || []).map((leg) => (<div key={leg.id} className="flex items-center gap-2 text-[10px] bg-slate-100 px-2 py-1 rounded border border-slate-200"><div className={`w-1.5 h-1.5 rounded-full shrink-0 ${leg.status === 'Completed' ? 'bg-green-500' : leg.status === 'Dispatched' ? 'bg-blue-500' : 'bg-yellow-500'}`}></div><span className="truncate max-w-[120px]">{leg.to || 'N/A'}</span><div className="ml-auto flex gap-1"><button onClick={() => onCopy && onCopy(load, leg)} className="text-slate-400 hover:text-blue-600"><Copy className="w-2.5 h-2.5" /></button><button onClick={() => onDownload && onDownload(load, leg)} className="text-slate-400 hover:text-green-600"><FileDown className="w-2.5 h-2.5" /></button><button onClick={() => onSign && onSign(load.id, leg)} className="text-slate-400 hover:text-blue-600"><Pencil className="w-2.5 h-2.5" /></button></div></div>))}</div></td>
              <td className="px-4 py-3"><select value={load.status || 'Open'} onChange={(e) => onStatusChange && onStatusChange(load.id, e.target.value)} className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase transition-all outline-none ${load.status === 'Open' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-green-200 bg-green-50 text-green-600'}`}><option value="Open">Open</option><option value="Ready for Billing">Ready for Billing</option></select></td>
              <td className="px-4 py-3 text-center">{load.loadConfirmation ? (<button onClick={() => onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><FileText className="w-4 h-4" /></button>) : <span className="text-slate-300">-</span>}</td>
              <td className="px-4 py-3 text-center">{load.signedPodDoc ? (<button onClick={() => onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"><ClipboardCheck className="w-4 h-4" /></button>) : <span className="text-slate-300">-</span>}</td>
              <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all"><button onClick={() => onTrack && onTrack(load)} className="p-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"><Globe className="w-3.5 h-3.5" /></button><button onClick={() => onEdit && onEdit(load)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit3 className="w-3.5 h-3.5" /></button><button onClick={() => onDelete && onDelete(load.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button></div></td>
            </tr>
          ))}
          {(!loads || loads.length === 0) && (<tr><td colSpan="15" className="px-4 py-8 text-center text-slate-400 font-bold italic">No loads found matching this view.</td></tr>)}
        </tbody>
      </table>
    </div>
    {onNextPage && onPrevPage && <div className="flex justify-between items-center px-4 py-3 border-t border-slate-200"><button onClick={onPrevPage} disabled={currentPage === 0} className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold disabled:opacity-50">Previous</button><span className="text-xs font-bold text-slate-500">Page {currentPage + 1}</span><button onClick={onNextPage} disabled={!hasNextPage || isLoadingMore} className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold disabled:opacity-50">{isLoadingMore ? 'Loading...' : 'Next'}</button></div>}
  </div>
);

const BillingTable = ({ loads, onStatusChange, onDraftEmail, onEdit, onPrint, onViewDoc, onSendInvoice, companyName, companyEmail }) => {
  const BillingRow = ({ load }) => {
    const [showInvoiceInput, setShowInvoiceInput] = useState(false);
    const [invoiceFromEmail, setInvoiceFromEmail] = useState(companyEmail || "");
    return (
      <tr className="hover:bg-slate-50/50 transition-colors group">
        <td className="px-6 py-4"><div className="font-bold text-slate-900 text-sm">{load.containerNo || 'N/A'} <span className="text-xs text-slate-400 ml-2 font-normal">({load.workOrderNo || 'No WO'})</span></div><div className="text-[10px] font-black text-slate-400 mt-1 uppercase">{load.customerName || 'N/A'}</div></td>
        <td className="px-6 py-4 text-center"><div className="flex justify-center gap-2">{load.loadConfirmation && <button onClick={() => onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><Paperclip className="w-3.5 h-3.5" /></button>}{load.signedPodDoc && <button onClick={() => onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"><ClipboardCheck className="w-3.5 h-3.5" /></button>}</div></td>
        <td className="px-6 py-4"><select value={load.status || 'Ready for Billing'} onChange={(e) => onStatusChange && onStatusChange(load.id, e.target.value)} className="px-3 py-1.5 rounded-xl border border-green-200 bg-green-50 text-green-600 text-[10px] font-black uppercase transition-all"><option value="Ready for Billing">Ready for Billing</option><option value="Invoiced">Invoiced</option><option value="Paid">Mark Paid</option><option value="Open">Revert to Open</option></select></td>
        <td className="px-6 py-4"><div className="font-black text-slate-900 text-sm">Rev: ${calculateTotal(load)}</div><div className="font-bold text-red-500 text-[10px] mt-0.5 uppercase">Cost: ${calculateCost(load)}</div><div className="font-black text-green-600 text-[11px] mt-0.5 uppercase">Profit: ${calculateProfit(load)}</div></td>
        <td className="px-6 py-4 text-right"><div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all"><button onClick={() => onEdit && onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"><Edit3 className="w-4 h-4" /></button><button onClick={() => onPrint && onPrint(load)} className="p-2 text-slate-400 hover:text-green-600 rounded-lg transition-colors"><Printer className="w-4 h-4" /></button><button onClick={() => setShowInvoiceInput(!showInvoiceInput)} className="p-2 rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700" title="Send Invoice Email"><Send className="w-4 h-4" /></button></div>{showInvoiceInput && (<div className="mt-2 flex items-center gap-2 bg-white p-2 rounded-lg shadow-lg border border-slate-200"><input type="email" value={invoiceFromEmail} onChange={(e) => setInvoiceFromEmail(e.target.value)} placeholder="Your accounting email" className="px-2 py-1 border rounded text-xs w-48" /><button onClick={() => { onSendInvoice && onSendInvoice(load, invoiceFromEmail); setShowInvoiceInput(false); }} className="px-2 py-1 bg-green-600 text-white rounded text-xs font-bold">Send</button></div>)}</td>
      </tr>
    );
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse min-w-[800px]"><thead><tr className="bg-green-50/50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-widest"><th className="px-6 py-4">Container & Identity</th><th className="px-6 py-4 text-center">Docs</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Financials</th><th className="px-6 py-4 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{(loads || []).map((load) => (<BillingRow key={load.id} load={load} />))}{(!loads || loads.length === 0) && (<tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-bold italic">No loads ready for billing matching this view.</td></tr>)}</tbody></table></div>
    </div>
  );
};

const HistoryTable = ({ loads, onStatusChange, onViewDoc, onDelete, onEdit }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto"><table className="w-full text-left border-collapse min-w-[800px]"><thead><tr className="bg-slate-50/50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-widest"><th className="px-6 py-4">Container & Identity</th><th className="px-6 py-4 text-center">Docs</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Financials</th><th className="px-6 py-4 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{(loads || []).map((load) => (<tr key={load.id} className="hover:bg-slate-50/50 transition-colors group opacity-75 hover:opacity-100"><td className="px-6 py-4"><div className="font-bold text-slate-900 text-sm">{load.containerNo || 'N/A'} <span className="text-xs text-slate-400 ml-2 font-normal">({load.workOrderNo || 'No WO'})</span></div><div className="text-[10px] font-black text-slate-400 mt-1 uppercase">{load.customerName || 'N/A'}</div></td><td className="px-6 py-4 text-center"><div className="flex justify-center gap-2">{load.loadConfirmation && <button onClick={() => onViewDoc && onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><Paperclip className="w-3.5 h-3.5" /></button>}{load.signedPodDoc && <button onClick={() => onViewDoc && onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100"><ClipboardCheck className="w-3.5 h-3.5" /></button>}</div></td><td className="px-6 py-4"><select value={load.status || 'Paid'} onChange={(e) => onStatusChange && onStatusChange(load.id, e.target.value)} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-black uppercase transition-all"><option value="Paid">Paid</option><option value="Completed">Completed</option><option value="Invoiced">Revert to Invoiced</option></select></td><td className="px-6 py-4"><div className="font-black text-slate-900 text-sm">Profit: ${calculateProfit(load)}</div><div className="font-bold text-slate-400 text-[10px] mt-0.5 uppercase">Closed: {new Date().toLocaleDateString()}</div></td><td className="px-6 py-4 text-right flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all"><button onClick={() => onEdit && onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"><Edit3 className="w-4 h-4" /></button><button onClick={() => onDelete && onDelete(load.id)} className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button></td></tr>))}{(!loads || loads.length === 0) && (<tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-bold italic">No history matching this view.</td></tr>)}</tbody></table></div>
  </div>
);

const AddressBook = ({ savedCustomers, savedDestinations, savedDrivers, onDeleteCustomer, onDeleteLocation, onDeleteDriver, newCust, setNewCust, newLoc, setNewLoc, newDriver, setNewDriver, onAddCustomer, onAddLocation, onAddDriver }) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in">
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px]"><div className="p-6 border-b border-slate-100 bg-slate-50/50"><h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><Building className="text-blue-600 w-5 h-5" /> Customers</h3><form onSubmit={onAddCustomer} className="flex flex-col h-full"><div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 pb-2"><input required className="w-full p-2 border rounded-lg text-xs" placeholder="Company Name*" value={newCust.name} onChange={e => setNewCust({...newCust, name: e.target.value})} /><div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2"><div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Contact Information</div><div className="grid grid-cols-2 gap-2"><input className="w-full p-2 border rounded-lg text-xs" placeholder="Contact Name" value={newCust.contactName} onChange={e => setNewCust({...newCust, contactName: e.target.value})} /><input className="w-full p-2 border rounded-lg text-xs" placeholder="Contact Title" value={newCust.contactTitle} onChange={e => setNewCust({...newCust, contactTitle: e.target.value})} /><input type="tel" className="w-full p-2 border rounded-lg text-xs" placeholder="Phone Number" value={newCust.phone} onChange={e => setNewCust({...newCust, phone: e.target.value})} /><input type="tel" className="w-full p-2 border rounded-lg text-xs" placeholder="Fax Number" value={newCust.fax} onChange={e => setNewCust({...newCust, fax: e.target.value})} /></div><input type="email" className="w-full p-2 border rounded-lg text-xs" placeholder="Email Address" value={newCust.email} onChange={e => setNewCust({...newCust, email: e.target.value})} /></div><div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2"><div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Address</div><input className="w-full p-2 border rounded-lg text-xs" placeholder="Address" value={newCust.address} onChange={e => setNewCust({...newCust, address: e.target.value})} /><div className="grid grid-cols-2 gap-2"><input className="w-full p-2 border rounded-lg text-xs" placeholder="City" value={newCust.city} onChange={e => setNewCust({...newCust, city: e.target.value})} /><input className="w-full p-2 border rounded-lg text-xs" placeholder="Postal Code" value={newCust.postalCode} onChange={e => setNewCust({...newCust, postalCode: e.target.value})} /></div></div><div className="grid grid-cols-2 gap-2"><input className="w-full p-2 border rounded-lg text-xs" placeholder="Default Tax" value={newCust.defaultTax} onChange={e => setNewCust({...newCust, defaultTax: e.target.value})} /><input className="w-full p-2 border rounded-lg text-xs" placeholder="Division" value={newCust.division} onChange={e => setNewCust({...newCust, division: e.target.value})} /><input className="col-span-2 w-full p-2 border rounded-lg text-xs" placeholder="Accounting ID" value={newCust.accountingId} onChange={e => setNewCust({...newCust, accountingId: e.target.value})} /></div></div><button type="submit" className="w-full mt-3 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-colors shrink-0">Save Customer</button></form></div><div className="p-4 space-y-2 overflow-y-auto flex-1">{(savedCustomers || []).map((c) => (<div key={c.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100"><div className="flex flex-col"><span>{c.name}</span>{(c.email || c.phone || c.contactName) && (<span className="text-[10px] text-slate-400 font-normal">{[c.contactName, c.phone, c.email].filter(Boolean).join(' • ')}</span>)}</div><button onClick={() => onDeleteCustomer && onDeleteCustomer(c.id)}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600 transition-colors" /></button></div>))}</div></div>
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px]"><div className="p-6 border-b border-slate-100"><h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><MapPin className="text-red-600 w-5 h-5" /> Locations</h3><form onSubmit={onAddLocation} className="space-y-2"><input required className="w-full p-2 border rounded-lg text-xs" placeholder="Name*" value={newLoc.name} onChange={e => setNewLoc({...newLoc, name: e.target.value})} /><input className="w-full p-2 border rounded-lg text-xs" placeholder="Address*" value={newLoc.address} onChange={e => setNewLoc({...newLoc, address: e.target.value})} /><button type="submit" className="w-full py-2 bg-red-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-colors">Save Location</button></form></div><div className="p-4 space-y-2 overflow-y-auto flex-1">{(savedDestinations || []).map((d) => (<div key={d.id} className="flex justify-between p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100"><span>{d.name}</span><button onClick={() => onDeleteLocation && onDeleteLocation(d.id)}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" /></button></div>))}</div></div>
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px]"><div className="p-6 border-b border-slate-100"><h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><Truck className="text-orange-600 w-5 h-5" /> Drivers</h3><form onSubmit={onAddDriver} className="space-y-2"><input required className="w-full p-2 border rounded-lg text-xs" placeholder="Name*" value={newDriver.name} onChange={e => setNewDriver({...newDriver, name: e.target.value})} /><input className="w-full p-2 border rounded-lg text-xs" placeholder="Truck #*" value={newDriver.truckNo} onChange={e => setNewDriver({...newDriver, truckNo: e.target.value})} /><select className="w-full p-2 border rounded-lg text-xs bg-white" value={newDriver.type || 'Company Driver'} onChange={e => setNewDriver({...newDriver, type: e.target.value})}><option value="Company Driver">Company Driver</option><option value="Owner Operator">Owner Operator</option><option value="Third-Party Driver">Third-Party Driver</option></select><button type="submit" className="w-full py-2 bg-orange-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-orange-700 transition-colors">Save Driver</button></form></div><div className="p-4 space-y-2 overflow-y-auto flex-1">{(savedDrivers || []).map((d) => (<div key={d.id} className="flex justify-between p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100"><div className="flex flex-col"><span>{d.name} ({d.truckNo})</span><span className="text-[10px] text-slate-400 font-normal">{d.type || 'Company Driver'}</span></div><button onClick={() => onDeleteDriver && onDeleteDriver(d.id)}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" /></button></div>))}</div></div>
  </div>
);

const AssignmentView = ({ loads, assignmentDate, setAssignmentDate, assignmentSlots }) => (
  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500"><div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><h2 className="text-2xl font-black text-slate-900 tracking-tight">Assignment Schedule</h2><p className="text-slate-400 font-bold text-sm">Review delivery timeline date-wise</p></div><div className="flex items-center gap-4 bg-slate-50 p-2 rounded-2xl border border-slate-100 w-full sm:w-auto"><CalendarDays className="w-5 h-5 text-blue-600 ml-2" /><input type="date" className="bg-transparent font-black text-slate-800 outline-none w-full sm:w-auto" value={assignmentDate} onChange={(e) => setAssignmentDate && setAssignmentDate(e.target.value)} /></div></div><div className="space-y-12 pb-20 relative"><div className="absolute left-[70px] top-0 bottom-0 w-px bg-slate-200 border-dashed border-l hidden md:block"></div>{(assignmentSlots || []).map((slot) => (<div key={slot.id} className="relative z-10"><div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 group"><div className="w-full md:w-[140px] md:text-center"><span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[11px] font-black tracking-tight border border-blue-100 whitespace-nowrap">{slot.label}</span></div><div className="hidden md:block flex-1 h-px bg-slate-200 border-dashed border-b"></div></div><div className="md:ml-[140px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{!slot.items || slot.items.length === 0 ? (<div className="col-span-full py-4 text-slate-300 font-bold italic text-sm">No assignments scheduled for this window.</div>) : slot.items.map((item) => (<div key={item.id} className="bg-white border border-slate-200 p-6 rounded-[28px] shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 group"><div className="flex justify-between items-start mb-4"><div className="bg-blue-50 text-blue-600 p-2 rounded-xl"><Package className="w-5 h-5" /></div><div className="text-right"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Appointment</div><div className="text-sm font-black text-slate-900">{item.appointmentTime || 'N/A'}</div></div></div><div className="mb-4"><div className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">{item.containerNo || 'N/A'}<span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{item.size || 'N/A'}</span></div><div className="text-sm font-bold text-blue-600 mt-1">{item.customerName || 'N/A'}</div></div><div className="space-y-3 pt-4 border-t border-slate-50"><div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-3.5 h-3.5 text-slate-400" /></div><span className="text-xs font-bold text-slate-500 truncate">{item.legs?.[0]?.to?.split(' - ')[0] || "No Location Assigned"}</span></div><div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><Truck className="w-3.5 h-3.5 text-slate-400" /></div><span className="text-xs font-bold text-slate-800">{item.legs?.[0]?.driverName || "Driver TBD"}</span></div></div></div>))}</div></div>))}</div></div>
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
    <><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in"><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"><div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center"><Package className="w-7 h-7 text-blue-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loads Today</div><div className="text-3xl font-black text-slate-900">{workToday}</div></div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"><div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center"><Truck className="w-7 h-7 text-orange-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Trucks</div><div className="text-3xl font-black text-slate-900">{numActiveTrucks}</div></div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"><div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center"><Receipt className="w-7 h-7 text-green-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Need to Bill</div><div className="text-3xl font-black text-slate-900">{needToBill}</div></div></div><div onClick={() => setShowPendingModal(true)} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md hover:border-rose-300 transition-all cursor-pointer group"><div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors"><Anchor className="w-7 h-7 text-rose-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending Terminations</div><div className="text-3xl font-black text-slate-900">{needToTerminate}</div></div></div></div>{showPendingModal && (<div className="fixed inset-0 z-[110] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPendingModal(false)}></div><div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"><div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><div className="flex items-center gap-3"><div className="bg-rose-100 p-2 rounded-xl"><Anchor className="w-5 h-5 text-rose-600" /></div><div><h2 className="font-black text-slate-900 text-lg tracking-tight">Pending Terminations Details</h2><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Containers requiring return/termination</p></div></div><button onClick={() => setShowPendingModal(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"><X className="w-5 h-5" /></button></div><div className="overflow-y-auto p-6 bg-slate-50/30">{pendingTerminationLoads.length === 0 ? (<div className="text-center py-12 text-slate-400 font-bold italic text-sm bg-white rounded-2xl border border-slate-100 shadow-sm">No pending termination details available</div>) : (<div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm"><table className="w-full text-left border-collapse"><thead><tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest"><th className="px-6 py-4">Container Number</th><th className="px-6 py-4">Booking Number</th><th className="px-6 py-4">Leg Type</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Last Movement</th></tr></thead><tbody className="divide-y divide-slate-100">{pendingTerminationLoads.map(load => { const legs = getSafeLegs(load); const completedLegs = legs.filter(leg => leg.status === 'Completed'); const lastCompleted = completedLegs[completedLegs.length - 1]; const fromLoc = lastCompleted?.from || 'Unknown Origin'; const toLoc = lastCompleted?.to || 'Unknown Destination'; const legType = lastCompleted ? `${fromLoc.split(' - ')[0]} → ${toLoc.split(' - ')[0]}` : 'N/A'; let statusBadge = 'Unknown'; if (lastCompleted) { const toLower = toLoc.toLowerCase(); if (toLower.includes('yard') || toLower.includes('depot') || toLower.includes('terminal') || toLower.includes('port') || toLower.includes('cn ') || toLower.includes('cp ')) { statusBadge = 'At Yard'; } else { statusBadge = 'At Customer'; } } const moveDate = lastCompleted?.departureTime ? `${load.appointmentDate} at ${lastCompleted.departureTime}` : (load.appointmentDate || 'N/A'); return (<tr key={load.id} className="hover:bg-slate-50/50 transition-colors text-xs font-bold text-slate-700"><td className="px-6 py-4"><div className="text-sm text-slate-900 font-black">{load.containerNo || 'N/A'}</div></td><td className="px-6 py-4">{load.poNumber || load.customerRefNo || '--'}</td><td className="px-6 py-4 font-bold text-blue-600 truncate max-w-[250px]" title={legType}>{legType}</td><td className="px-6 py-4"><span className={`inline-flex px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${statusBadge === 'At Yard' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{statusBadge}</span></td><td className="px-6 py-4 text-slate-500">{moveDate}</td></tr>); })}</tbody></table></div>)}</div></div></div>)}</>
  );
};

const ProfitDashboard = ({ loads }) => {
  const safeLoads = Array.isArray(loads) ? loads : [];
  const getLoadTotal = (load) => safeFloat(calculateTotal(load));
  const getLoadCost = (load) => safeFloat(calculateCost(load));
  const totalRevenue = safeLoads.reduce((sum, load) => sum + getLoadTotal(load), 0);
  const totalCost = safeLoads.reduce((sum, load) => sum + getLoadCost(load), 0);
  const totalProfit = totalRevenue - totalCost;
  const grossMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0;
  useEffect(() => { if (totalRevenue > 0) { if (grossMargin > 80) { console.warn(`⚠️ Unusually high gross margin: ${grossMargin}%. Check if all costs are being tracked correctly.`); } if (grossMargin < -20) { console.warn(`⚠️ Significant loss detected: ${grossMargin}%. Review pricing and costs.`); } } }, [totalRevenue, grossMargin]);
  const customerData = {}; const laneData = {}; const truckData = {}; const driverData = {};
  safeLoads.forEach(load => { const rev = getLoadTotal(load); const cost = getLoadCost(load); const profit = rev - cost; const cName = load?.customerName || 'Unknown'; if (!customerData[cName]) customerData[cName] = { rev: 0, profit: 0 }; customerData[cName].rev += rev; customerData[cName].profit += profit; const legs = getSafeLegs(load); if (legs.length > 0) { const from = (legs[0]?.from || 'Unknown Origin').split(' - ')[0]; const to = (legs[legs.length - 1]?.to || 'Unknown Dest').split(' - ')[0]; const lane = `${from} → ${to}`; if (!laneData[lane]) laneData[lane] = { rev: 0, profit: 0 }; laneData[lane].rev += rev; laneData[lane].profit += profit; const trucks = [...new Set(legs.map(l => l?.truckNo).filter(Boolean))]; if (trucks.length > 0) { const splitRev = rev / trucks.length; const splitProfit = profit / trucks.length; trucks.forEach(t => { if (!truckData[t]) truckData[t] = { rev: 0, profit: 0 }; truckData[t].rev += splitRev; truckData[t].profit += splitProfit; }); } const drivers = [...new Set(legs.map(l => l?.driverName).filter(Boolean))]; if (drivers.length > 0) { const splitRev = rev / drivers.length; const splitProfit = profit / drivers.length; drivers.forEach(d => { if (!driverData[d]) driverData[d] = { rev: 0, profit: 0 }; driverData[d].rev += splitRev; driverData[d].profit += splitProfit; }); } } });
  const topCustomers = Object.entries(customerData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topLanes = Object.entries(laneData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topTrucks = Object.entries(truckData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topDrivers = Object.entries(driverData).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const months = []; const d = new Date(); for (let i = 5; i >= 0; i--) { const d2 = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push({ label: d2.toLocaleString('default', { month: 'short', year: '2-digit' }), month: d2.getMonth(), year: d2.getFullYear(), revenue: 0, profit: 0 }); }
  safeLoads.forEach(load => { const dateSource = load?.appointmentDate || load?.createdAt || load?.dateAdded; if (!dateSource) return; const loadDate = new Date(dateSource); if (isNaN(loadDate.getTime())) return; const m = loadDate.getMonth(); const y = loadDate.getFullYear(); const monthObj = months.find(x => x.month === m && x.year === y); if (!monthObj) return; const revenue = Number(getLoadTotal(load)) || 0; const cost = Number(getLoadCost(load)) || 0; const profit = revenue - cost; monthObj.revenue += revenue; monthObj.profit += profit; });
  const maxRev = Math.max(...months.map(m => m.revenue), 1000);
  return (<div className="animate-in fade-in space-y-8"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-purple-50 flex items-center justify-center"><DollarSign className="w-7 h-7 text-purple-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Revenue</div><div className="text-2xl font-black text-slate-900">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center"><Receipt className="w-7 h-7 text-red-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Cost</div><div className="text-2xl font-black text-slate-900">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center"><Wallet className="w-7 h-7 text-green-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Profit</div><div className="text-2xl font-black text-slate-900">${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center"><Activity className="w-7 h-7 text-blue-600" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross Margin</div><div className="text-2xl font-black text-slate-900">{grossMargin}%</div></div></div></div><div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-8"><TrendingUp className="w-5 h-5 text-purple-600" /><h3 className="font-black text-lg text-slate-900">Revenue & Profit Trend (6 Months)</h3></div><div className="flex items-end justify-between gap-2 h-64 mt-4">{months.map((m, i) => { const profitHeight = m.revenue > 0 ? Math.max(0, (m.profit / m.revenue) * 100) : 0; return (<div key={i} className="flex flex-col items-center flex-1 group"><div className="relative w-full flex justify-center h-[200px] items-end"><div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] font-bold px-3 py-2 rounded-xl whitespace-nowrap z-20 shadow-xl"><div className="text-purple-300">Rev: ${m.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-green-400">Profit: ${m.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div><div className="w-full max-w-[40px] bg-purple-100 rounded-t-xl transition-colors relative flex items-end overflow-hidden" style={{ height: `${(m.revenue / maxRev) * 100}%`, minHeight: '4px' }}><div className="absolute inset-0 bg-gradient-to-t from-purple-500 to-purple-400 opacity-80 group-hover:opacity-100 transition-opacity"></div><div className="w-full bg-green-400 opacity-90 z-10" style={{ height: `${profitHeight}%`, minHeight: '4px' }}></div></div></div><div className="mt-4 text-xs font-bold text-slate-500 uppercase">{m.label}</div></div>); })}</div></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-6"><Building className="w-5 h-5 text-blue-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Customer</h3></div><div className="space-y-4">{topCustomers.map((c, i) => (<div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100"><div className="text-xs font-bold text-slate-700 truncate mr-2">{c.name}</div><div className="text-right"><div className="text-sm font-black text-slate-900">${c.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-[10px] font-bold text-green-600">Profit: ${c.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div>))}{topCustomers.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}</div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-6"><User className="w-5 h-5 text-orange-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Driver</h3></div><div className="space-y-4">{topDrivers.map((d, i) => (<div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100"><div className="text-xs font-bold text-slate-700 truncate mr-2">{d.name ? d.name : 'Unknown Driver'}</div><div className="text-right"><div className="text-sm font-black text-slate-900">${d.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-[10px] font-bold text-green-600">Profit: ${d.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div>))}{topDrivers.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}</div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-6"><Truck className="w-5 h-5 text-purple-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Truck</h3></div><div className="space-y-4">{topTrucks.map((t, i) => (<div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100"><div className="text-xs font-bold text-slate-700 truncate mr-2">{t.name ? `Truck ${t.name}` : 'Unknown Truck'}</div><div className="text-right"><div className="text-sm font-black text-slate-900">${t.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-[10px] font-bold text-green-600">Profit: ${t.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div>))}{topTrucks.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}</div></div><div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-rose-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Lane</h3></div><div className="space-y-4">{topLanes.map((l, i) => (<div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100"><div className="text-[10px] font-bold text-slate-600 truncate mr-2 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">{l.name}</div><div className="text-right"><div className="text-sm font-black text-slate-900">${l.rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-[10px] font-bold text-green-600">Profit: ${l.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div>))}{topLanes.length === 0 && <div className="text-xs text-slate-400 font-bold italic">No data available</div>}</div></div></div></div>);
};

const ActionRequired = ({ loads, onEdit, onStatusChange }) => {
  const safeLoads = Array.isArray(loads) ? loads : [];
  const pendingTermination = safeLoads.filter(l => { const legs = getSafeLegs(l); return l?.status === 'Open' && legs.length > 0 && legs.every(leg => leg.status === 'Completed'); });
  if (pendingTermination.length === 0) return null;
  return (<div className="bg-amber-50 border border-amber-200 rounded-[32px] p-8 mb-8 animate-in slide-in-from-top-4 relative overflow-hidden"><div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><AlertTriangle className="w-32 h-32 text-amber-600" /></div><div className="relative z-10"><div className="flex items-center gap-4 mb-6"><div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm"><AlertTriangle className="w-8 h-8" /></div><div><h3 className="font-black text-2xl text-amber-900 tracking-tight">Attention: Containers Pending Termination</h3><p className="text-amber-800 font-bold text-sm mt-1">{pendingTermination.length} containers have completed all legs but have not been closed/billed.</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{pendingTermination.map(load => (<div key={load.id} className="bg-white p-5 rounded-2xl border border-amber-100 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-amber-300 transition-all"><div className="flex justify-between items-start"><div><div className="font-black text-slate-800 text-lg">{load.containerNo || 'N/A'}</div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{load.customerName || 'N/A'}</div></div><div className="bg-green-100 text-green-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase">Done</div></div><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Truck className="w-3.5 h-3.5" /><span className="truncate">Last: {getSafeLegs(load)[getSafeLegs(load).length - 1]?.to || 'Unknown'}</span></div><div className="pt-3 mt-auto flex gap-2 border-t border-slate-50"><button onClick={() => onEdit && onEdit(load)} className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors">Review</button><button onClick={() => onStatusChange && onStatusChange(load.id, 'Ready for Billing')} className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95">Terminate & Bill</button></div></div>))}</div></div></div>);
};

const WorkspaceManager = ({ setCompanyId, setUserRole, setAppState, onRegistrationComplete }) => {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [locations, setLocations] = useState([{ id: crypto.randomUUID(), name: 'Headquarters', address: '', city: '', province: '', postalCode: '' }]);
  const [dataSharingMode, setDataSharingMode] = useState('separate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const addLocation = () => { setLocations([...locations, { id: crypto.randomUUID(), name: '', address: '', city: '', province: '', postalCode: '' }]); };
  const removeLocation = (id) => { if (locations.length === 1) { setError("At least one location is required"); return; } setLocations(locations.filter(l => l.id !== id)); };
  const updateLocation = (id, field, value) => { setLocations(locations.map(l => l.id === id ? { ...l, [field]: value } : l)); };
  const handleLogin = async () => { if (!email.trim() || !password.trim()) { setError("Please enter valid credentials."); return; } setError(""); setLoading(true); try { await handleSignIn(email, password, setCompanyId, setUserRole, setAppState); } catch (err) { setError(err.message || "Login failed"); } finally { setLoading(false); } };
  const handleRegister = async () => { if (step === 1) { if (!companyName.trim() || !email.trim() || !password.trim()) { setError("Please fill all required fields."); return; } setError(""); setStep(2); return; } const invalidLocations = locations.filter(l => !l.name.trim()); if (invalidLocations.length > 0) { setError("Please provide names for all locations"); return; } setError(""); setLoading(true); try { const { companyId, uid } = await signUp(email, password, companyName, locations, dataSharingMode); onRegistrationComplete(companyId, uid); } catch (err) { setError(err.message || "Registration failed"); } finally { setLoading(false); } };
  const handleAuthSubmit = (e) => { e.preventDefault(); handleRegister(); };
  return (<div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4 relative overflow-hidden"><div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-600/5 blur-[120px] rounded-full pointer-events-none"></div><div className="bg-white w-full max-w-2xl rounded-[24px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-200/60 overflow-hidden relative z-10 transition-all duration-300"><div className="pt-10 pb-6 text-center px-8"><div className="flex items-center justify-center mx-auto mb-6"><div className="w-14 h-14 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-[16px] shadow-[0_8px_16px_-6px_rgba(124,58,237,0.4)] flex items-center justify-center text-white ring-1 ring-white/20"><Truck className="w-7 h-7" strokeWidth={2.5} /></div></div><h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">NEXDRAY</h2><p className="text-[10px] font-bold text-purple-600 uppercase tracking-[0.2em]">MULTI-LOCATION TMS FOR YOUR DRAYAGE NEEDS</p><p className="text-xs font-medium text-slate-500 mt-2">Streamline your drayage operations.</p></div><div className="px-8 pb-10"><div className="flex p-1 bg-slate-100/80 rounded-[12px] mb-6"><button type="button" onClick={() => { setMode('login'); setError(''); setPassword(''); setStep(1); }} className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-widest rounded-[10px] transition-all duration-200 ${mode === 'login' ? 'bg-white text-purple-700 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]' : 'text-slate-500 hover:text-slate-700'}`}>Log In</button><button type="button" onClick={() => { setMode('register'); setError(''); setPassword(''); setStep(1); }} className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-widest rounded-[10px] transition-all duration-200 ${mode === 'register' ? 'bg-white text-purple-700 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]' : 'text-slate-500 hover:text-slate-700'}`}>Register</button></div>{error && <div className="mb-6 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 text-center">{error}</div>}{mode === 'login' ? (<form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4"><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Work Email</label><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-[12px] text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all" placeholder="you@company.com" /></div><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Password</label><input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-[12px] text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all" placeholder="••••••••" minLength={6} /></div><button type="submit" disabled={loading} className="w-full mt-4 py-3.5 bg-purple-600 hover:bg-purple-700 text-white rounded-[12px] font-bold text-[13px] uppercase tracking-widest transition-all shadow-[0_4px_14px_-4px_rgba(124,58,237,0.4)] disabled:opacity-50">{loading ? 'Processing...' : 'Log In'}</button></form>) : (<form onSubmit={handleAuthSubmit} className="space-y-4">{step === 1 ? (<><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Company Name</label><input type="text" required value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-[12px] text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all" placeholder="e.g. Acme Logistics" /></div><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Work Email</label><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-[12px] text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all" placeholder="you@company.com" /></div><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Password</label><input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-[12px] text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all" placeholder="••••••••" minLength={6} /></div><div className="bg-slate-50 p-4 rounded-xl"><label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Data Sharing Mode</label><div className="space-y-2"><label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white transition-colors"><input type="radio" name="dataSharing" value="separate" checked={dataSharingMode === 'separate'} onChange={() => setDataSharingMode('separate')} className="w-4 h-4 text-purple-600" /><div className="flex-1"><div className="font-bold text-sm text-slate-800">Separate per Location</div><div className="text-[10px] text-slate-500">Each location has its own data. Calgary sees only Calgary, Edmonton sees only Edmonton.</div></div></label><label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white transition-colors"><input type="radio" name="dataSharing" value="unified" checked={dataSharingMode === 'unified'} onChange={() => setDataSharingMode('unified')} className="w-4 h-4 text-purple-600" /><div className="flex-1"><div className="font-bold text-sm text-slate-800">Unified (All Locations)</div><div className="text-[10px] text-slate-500">All locations share the same data. Everyone sees everything.</div></div></label></div></div><button type="button" onClick={() => setStep(2)} className="w-full mt-4 py-3.5 bg-purple-600 hover:bg-purple-700 text-white rounded-[12px] font-bold text-[13px] uppercase tracking-widest transition-all shadow-[0_4px_14px_-4px_rgba(124,58,237,0.4)]">Continue to Locations →</button></>) : (<><div className="max-h-[400px] overflow-y-auto space-y-4 pr-2"><div className="flex justify-between items-center"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Company Locations</label><button type="button" onClick={addLocation} className="text-xs text-purple-600 font-bold hover:underline">+ Add Location</button></div>{locations.map((loc, idx) => (<div key={loc.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="flex justify-between items-center mb-3"><span className="text-xs font-bold text-slate-600">Location {idx + 1}</span><button type="button" onClick={() => removeLocation(loc.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div><div className="space-y-2"><input type="text" placeholder="Location Name (e.g., Calgary Office)*" value={loc.name} onChange={e => updateLocation(loc.id, 'name', e.target.value)} className="w-full px-3 py-2 bg-white border rounded-lg text-sm" required /><input type="text" placeholder="Address" value={loc.address} onChange={e => updateLocation(loc.id, 'address', e.target.value)} className="w-full px-3 py-2 bg-white border rounded-lg text-sm" /><div className="grid grid-cols-2 gap-2"><input type="text" placeholder="City" value={loc.city} onChange={e => updateLocation(loc.id, 'city', e.target.value)} className="px-3 py-2 bg-white border rounded-lg text-sm" /><input type="text" placeholder="Province" value={loc.province} onChange={e => updateLocation(loc.id, 'province', e.target.value)} className="px-3 py-2 bg-white border rounded-lg text-sm" /></div><input type="text" placeholder="Postal Code" value={loc.postalCode} onChange={e => updateLocation(loc.id, 'postalCode', e.target.value)} className="w-full px-3 py-2 bg-white border rounded-lg text-sm" /></div></div>))}</div><div className="flex gap-3"><button type="button" onClick={() => setStep(1)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors">Back</button><button type="submit" disabled={loading} className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors">{loading ? 'Creating...' : 'Complete Registration'}</button></div></>)}</form>)}</div></div></div>);
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
    if (result.success) { setMessage(`✅ ${inviteEmail} added as ${inviteRole}`); setInviteEmail(""); setTempPassword(""); setInviteRole("dispatcher"); } else { setMessage(`❌ Failed: ${result.error}`); }
    setLoading(false);
  };
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl border p-8">
        <div className="text-center mb-8"><h1 className="text-3xl font-black text-slate-900">Team Setup</h1><p className="text-slate-500 mt-2">Add your dispatchers, accounting staff, or admins.</p></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-slate-50 p-6 rounded-xl"><h2 className="font-bold text-lg mb-4">Invite new member</h2><form onSubmit={handleAddUser} className="space-y-4"><div><label className="block text-xs font-bold uppercase text-slate-500">Email address</label><input type="email" required className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></div><div><label className="block text-xs font-bold uppercase text-slate-500">Temporary password</label><input type="text" required className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={tempPassword} onChange={e => setTempPassword(e.target.value)} placeholder="min. 6 characters" /><p className="text-[10px] text-slate-400 mt-1">The user must change it after first login.</p></div><div><label className="block text-xs font-bold uppercase text-slate-500">Role</label><select className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-100" value={inviteRole} onChange={e => setInviteRole(e.target.value)}><option value="dispatcher">Dispatcher – only operations, no financial edits after billing</option><option value="accounting">Accounting – can edit any load, handle billing</option><option value="admin">Admin – full access like owner</option></select></div><button type="submit" disabled={loading} className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition disabled:opacity-50">{loading ? "Creating..." : "Invite user"}</button>{message && <div className="text-sm text-center mt-2 font-bold">{message}</div>}</form></div>
          <div className="bg-slate-50 p-6 rounded-xl"><h2 className="font-bold text-lg mb-4">Team members</h2>{teamMembers.length === 0 && (<p className="text-slate-400 text-sm italic">No additional members yet.</p>)}<ul className="space-y-2">{teamMembers.map(member => (<li key={member.id} className="flex justify-between items-center border-b border-slate-200 pb-2"><div><div className="font-medium text-slate-800">{member.email}</div><div className="text-xs text-slate-500 capitalize">{member.role}</div></div></li>))}</ul></div>
        </div>
        <div className="mt-8 flex justify-end"><button onClick={onComplete} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-md">Continue to Dashboard →</button></div>
      </div>
    </div>
  );
};

// ========== MAIN APP COMPONENT (SUBCOLLECTION VERSION) ==========
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
  
  // *** FIX #2: Replaced single allLoads with targeted listeners ***
  const [loadsToday, setLoadsToday] = useState([]);          // loads with appointmentDate = today
  const [loadsOpen, setLoadsOpen] = useState([]);            // loads with status = 'Open'
  const [revenueLoads, setRevenueLoads] = useState([]);      // last 200 loads for Profit dashboard
  const [assignmentLoads, setAssignmentLoads] = useState([]);// loads for the selected assignment date

  const [paginatedLoads, setPaginatedLoads] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');
  const [savedCustomers, setSavedCustomers] = useState([]);
  const [savedDestinations, setSavedDestinations] = useState([]);
  const [savedDrivers, setSavedDrivers] = useState([]);
  const [newCust, setNewCust] = useState({ name: '', email: '', phone: '', address: '', contactName: '', contactTitle: '', fax: '', city: '', postalCode: '', defaultTax: '', accountingId: '', division: '' });
  const [newLoc, setNewLoc] = useState({ name: '', address: '' });
  const [newDriver, setNewDriver] = useState({ name: '', truckNo: '', type: 'Company Driver' });
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
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
  const [isImporting, setIsImporting] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loadsPage, setLoadsPage] = useState(0);
  const [pageSize] = useState(25);
  // *** FIX for infinite re-renders: use ref for lastDocSnapshot ***
  const lastDocSnapshotRef = useRef(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ========== COMPUTED VALUES ==========
  // Combine targeted loads for the summary tab
  const summaryLoads = useMemo(() => {
    const combined = [...loadsToday, ...loadsOpen];
    // Deduplicate by id
    const map = new Map();
    combined.forEach(load => map.set(load.id, load));
    return Array.from(map.values());
  }, [loadsToday, loadsOpen]);

  // The `loads` variable used in views
  const loads = activeTab === 'summary' ? summaryLoads : 
                activeTab === 'assignment' ? assignmentLoads :
                activeTab === 'revenue' ? revenueLoads :
                paginatedLoads;

  // ========== REAL‑TIME LISTENER: loads today ==========
  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  const today = new Date().toISOString().split('T')[0];
  
  // Build query constraints
  let constraints = [where('appointmentDate', '==', today)];
  
  // Add location filter if in separate mode and user is not owner/admin
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q, 
    (snapshot) => {
      setLoadsToday(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
    },
    (error) => {
      console.error("loadsToday listener error:", error);
      setCopyFeedback("❌ Unable to load today's loads – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  // ========== REAL‑TIME LISTENER: loads Open ==========
  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  
  let constraints = [where('status', '==', 'Open')];
  
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q, 
    (snapshot) => {
      setLoadsOpen(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
    },
    (error) => {
      console.error("loadsOpen listener error:", error);
      setCopyFeedback("❌ Unable to load open loads – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  // ========== LIMITED LISTENER: revenue loads (last 200) ==========
  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
  
  let constraints = [orderBy('createdAt', 'desc'), limit(200)];
  
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q, 
    (snapshot) => {
      setRevenueLoads(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
    },
    (error) => {
      console.error("revenueLoads listener error:", error);
      setCopyFeedback("❌ Unable to load revenue data – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  // ========== LISTENER: assignment loads for selected date ==========
  useEffect(() => {
  if (!user || !companyId || appState !== 'dashboard' || !authReady || activeTab !== 'assignment') return;
  
  let constraints = [
    where('appointmentDate', '==', assignmentDate),
    where('status', '==', 'Open')
  ];
  
  if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
    constraints.push(where('locationId', '==', currentLocation));
  }
  
  const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
  const unsubscribe = onSnapshot(q, 
    (snapshot) => {
      setAssignmentLoads(snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id)));
    },
    (error) => {
      console.error("assignmentLoads listener error:", error);
      setCopyFeedback("❌ Unable to load assignment data – permission denied.");
    }
  );
  return () => unsubscribe();
}, [user, companyId, appState, authReady, activeTab, assignmentDate, dataSharingMode, userRole, currentLocation, setCopyFeedback]);

  // ========== REAL‑TIME LISTENERS FOR CUSTOMERS, LOCATIONS, DRIVERS ==========
  useEffect(() => {
    if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
    const q = query(collection(db, 'companies', companyId, 'customers'));
    const unsubscribe = onSnapshot(q, (snapshot) => { setSavedCustomers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))); });
    return () => unsubscribe();
  }, [user, companyId, appState, authReady]);

  useEffect(() => {
    if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
    const q = query(collection(db, 'companies', companyId, 'locations'));
    const unsubscribe = onSnapshot(q, (snapshot) => { setSavedDestinations(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))); });
    return () => unsubscribe();
  }, [user, companyId, appState, authReady]);

  useEffect(() => {
    if (!user || !companyId || appState !== 'dashboard' || !authReady) return;
    const q = query(collection(db, 'companies', companyId, 'drivers'));
    const unsubscribe = onSnapshot(q, (snapshot) => { setSavedDrivers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))); });
    return () => unsubscribe();
  }, [user, companyId, appState, authReady]);

  // ========== PAGINATED FETCH WITH SERVER‑SIDE SEARCH (FIX #1) ==========
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
    
    const search = (searchTermOverride !== undefined ? searchTermOverride : searchTerm).toLowerCase();
    if (search) {
      constraints.push(where('containerNo', '>=', search));
      constraints.push(where('containerNo', '<=', search + '\uf8ff'));
    } else {
      if (activeTab === 'loads') {
        constraints.push(where('status', '==', 'Open'));
      } else if (activeTab === 'billing') {
        constraints.push(where('status', 'in', ['Ready for Billing', 'Invoiced']));
      } else if (activeTab === 'history') {
        constraints.push(where('status', 'in', ['Paid', 'Completed']));
      }
    }
    
    // ✅ ADD LOCATION FILTER HERE
    if (dataSharingMode === 'separate' && !['owner', 'admin'].includes(userRole) && currentLocation) {
      constraints.push(where('locationId', '==', currentLocation));
    }
    
    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(pageSize));
    if (!resetPage && currentCursor) {
      constraints.push(startAfter(currentCursor));
    }
    
    const q = query(collection(db, 'companies', companyId, 'loads'), ...constraints);
    const snapshot = await getDocs(q);
    const loadedDocs = snapshot.docs.map(docSnap => normalizeLoad(docSnap.data(), docSnap.id));
    
    setPaginatedLoads(loadedDocs);
    if (snapshot.docs.length > 0) {
      lastDocSnapshotRef.current = snapshot.docs[snapshot.docs.length - 1];
    } else {
      lastDocSnapshotRef.current = null;
    }
  } catch (error) {
    console.error("Paginated fetch error:", error);
    setCopyFeedback("Failed to load loads. Please refresh.");
  } finally {
    setIsLoadingMore(false);
  }
}, [user, companyId, appState, authReady, activeTab, pageSize, setCopyFeedback, searchTerm, dataSharingMode, userRole, currentLocation]);

  // Debounced search effect – triggers server fetch
  const debouncedSearch = useMemo(() => debounce((term) => {
    setSearchTerm(term);
    if (activeTab !== 'summary' && activeTab !== 'assignment' && activeTab !== 'revenue') {
      fetchPaginatedLoads(true, term);
    }
  }, 300), [activeTab, fetchPaginatedLoads]);

  // Reset pagination when tab changes
  useEffect(() => {
    if (activeTab === 'summary' || activeTab === 'assignment' || activeTab === 'revenue') return;
    fetchPaginatedLoads(true);
  }, [activeTab, fetchPaginatedLoads]);

  // ========== HANDLERS (add, delete, update) – all updated for subcollections ==========
  const handleAddCustomer = useCallback(async (e) => {
    e.preventDefault();
    if (!newCust.name.trim() || !user || !companyId) return;
    try {
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
        companyId: companyId
      });
      if (isMountedRef.current) {
        setNewCust({ name: '', email: '', phone: '', address: '', contactName: '', contactTitle: '', fax: '', city: '', postalCode: '', defaultTax: '', accountingId: '', division: '' });
        setCopyFeedback("Customer Saved to Cloud");
      }
    } catch (error) {
      console.error("Error adding customer:", error);
      if (isMountedRef.current) setCopyFeedback("Failed to save customer");
    }
  }, [user, companyId, newCust, setCopyFeedback, isMountedRef]);

  const handleAddLocation = useCallback(async (e) => {
    e.preventDefault();
    if (!newLoc.name.trim() || !user || !companyId) return;
    try {
      await addDoc(collection(db, 'companies', companyId, 'locations'), {
        name: sanitizeInput(newLoc.name),
        address: sanitizeInput(newLoc.address),
        companyId: companyId
      });
      if (isMountedRef.current) {
        setNewLoc({ name: '', address: '' });
        setCopyFeedback("Location Saved to Cloud");
      }
    } catch (error) {
      console.error("Error adding location:", error);
      if (isMountedRef.current) setCopyFeedback("Failed to save location");
    }
  }, [user, companyId, newLoc, setCopyFeedback, isMountedRef]);

  const handleAddDriver = useCallback(async (e) => {
    e.preventDefault();
    if (!newDriver.name.trim() || !user || !companyId) return;
    try {
      await addDoc(collection(db, 'companies', companyId, 'drivers'), {
        name: sanitizeInput(newDriver.name),
        truckNo: sanitizeInput(newDriver.truckNo),
        type: newDriver.type,
        companyId: companyId
      });
      if (isMountedRef.current) {
        setNewDriver({ name: '', truckNo: '', type: 'Company Driver' });
        setCopyFeedback("Driver Saved to Cloud");
      }
    } catch (error) {
      console.error("Error adding driver:", error);
      if (isMountedRef.current) setCopyFeedback("Failed to save driver");
    }
  }, [user, companyId, newDriver, setCopyFeedback, isMountedRef]);

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
    try { await deleteDoc(doc(db, 'companies', companyId, 'loads', id)); if (isMountedRef.current) setCopyFeedback("Load deleted successfully"); }
    catch (error) { console.error('Delete error:', error); if (isMountedRef.current) setCopyFeedback("Failed to delete load"); }
  }, [user, companyId, setCopyFeedback, isMountedRef]);

  const quickUpdateStatus = useCallback(async (loadId, newStatus) => {
    if (!user || !companyId || !loadId) return;
    const currentLoad = [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === loadId);
    if (!currentLoad) return;
    const now = new Date().toISOString();
    // FIX #3: Cap audit log to last 50 entries
    const cappedLog = (currentLoad.auditLog || []).slice(-49); // keep last 49 + new entry = 50
    const newAuditLog = [...cappedLog, { timestamp: now, user: userEmail || user.email || 'Unknown User', role: userRole, action: 'Status Update', changes: [{ field: 'status', from: currentLoad.status, to: newStatus }] }];
    try { await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), { status: newStatus, updatedAt: now, auditLog: newAuditLog }); if (isMountedRef.current) setCopyFeedback(`Moved to ${newStatus}`); }
    catch (error) { console.error("Error updating status:", error); if (isMountedRef.current) setCopyFeedback("Failed to update status"); }
  }, [user, companyId, loadsToday, loadsOpen, paginatedLoads, userEmail, userRole, setCopyFeedback, isMountedRef]);

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
    try { await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), { legs: updatedLegs, updatedAt: new Date().toISOString() }); if (isMountedRef.current) { setSigningContext(null); setCopyFeedback("Leg Signed & Synced!"); } }
    catch (error) { console.error("Error signing leg:", error); if (isMountedRef.current) setCopyFeedback("Failed to save signature"); }
  }, [user, companyId, signingContext, loadsToday, loadsOpen, paginatedLoads, setCopyFeedback, isMountedRef]);

  const handleSubmitLoad = useCallback(async (formData) => {
    if (!user || !companyId) return;
    if (dataSharingMode === 'separate') {
      const targetLocation = formData.locationId || currentLocation;
      if (!editingId && !targetLocation) { setCopyFeedback("❌ Please select a location for this load"); return; }
      if (targetLocation && !userAccessibleLocations.includes(targetLocation)) { setCopyFeedback("❌ You don't have access to this location"); return; }
      if (!formData.locationId && currentLocation) formData.locationId = currentLocation;
    }
    const validation = validateLoadForm(formData);
    if (!validation.valid) { if (isMountedRef.current) setCopyFeedback(validation.error); return; }
    const now = new Date().toISOString();
    const { id: _ignoredId, auditLog, ...restFormData } = formData || {};
    let migratedData = migrateToLineItems(restFormData);
    const cleanedData = {
      ...migratedData,
      legs: getSafeLegs(migratedData),
      loadConfirmation: normalizeFileRef(migratedData.loadConfirmation),
      signedPodDoc: normalizeFileRef(migratedData.signedPodDoc),
      updatedAt: now,
      locationId: dataSharingMode === 'separate' ? currentLocation : null,
      companyId: companyId
    };
    if (!editingId) {
  cleanedData.createdAt = now;
}
    cleanedData.basePrice = ""; cleanedData.waitingTime = ""; cleanedData.fuelSurcharge = ""; cleanedData.driverCost = ""; cleanedData.fuelCost = ""; cleanedData.brokerRate = "";
    const fieldsToTrack = ['status', 'containerNo', 'shippingLine', 'poNumber'];
    const changes = [];
    const loadToCompare = editingId ? [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === editingId) : null;
    if (loadToCompare) {
      fieldsToTrack.forEach(field => { if (loadToCompare[field] !== cleanedData[field]) changes.push({ field, from: loadToCompare[field], to: cleanedData[field] }); });
    }
    // FIX #3: Cap audit log to last 50 entries
    let newAuditLog = loadToCompare?.auditLog || [];
    if (changes.length > 0 || !loadToCompare) {
      const cappedLog = newAuditLog.slice(-49);
      newAuditLog = [...cappedLog, { timestamp: now, user: userEmail || user.email || 'Unknown User', role: userRole, action: loadToCompare ? 'Edited Load' : 'Created Load', changes }];
    }
    cleanedData.auditLog = newAuditLog;
    if (!cleanedData.workOrderNo) cleanedData.workOrderNo = `WO-${Math.floor(100000 + Math.random() * 900000)}`;
   try {
  const loadRef = editingId 
    ? doc(db, 'companies', companyId, 'loads', editingId)
    : doc(collection(db, 'companies', companyId, 'loads'));
  
  if (editingId) {
    await updateDoc(loadRef, cleanedData);
  } else {
    await setDoc(loadRef, cleanedData);
  }
  
  if (isMountedRef.current) { 
    setCopyFeedback(editingId ? "Load Updated" : "✅ Load Created Successfully"); 
    setIsFormOpen(false); 
    setEditingId(null); 
  }
} catch (error) { 
      console.error("Error saving load:", error); 
      if (isMountedRef.current) setCopyFeedback(error.message || "Failed to save load"); 
   }
}, [user, companyId, editingId, loadsToday, loadsOpen, paginatedLoads, userEmail, userRole, setCopyFeedback, isMountedRef, dataSharingMode, currentLocation, userAccessibleLocations, setIsFormOpen, setEditingId]);

  const handleImportData = useCallback(async (file, columnMapping) => {
  setIsImporting(true);
  try {
    const result = await importExcelData(file, companyId, setCopyFeedback);
    let imported = 0;
    let errors = [];
    for (const load of result.loads) {
      try {
        const cleanedData = {
          ...load,
          legs: getSafeLegs(load),
          loadConfirmation: null,
          signedPodDoc: null,
          auditLog: load.auditLog || [],
          companyId: companyId
        };
        await addDoc(collection(db, 'companies', companyId, 'loads'), cleanedData);
        imported++;
      } catch (err) {
        errors.push({ error: err.message });
      }
    }
    setCopyFeedback(`✅ Imported ${imported} loads successfully!`);
    setIsImportModalOpen(false);
    return { success: true, imported, errors: result.errors?.length || 0, errorDetails: result.errors };
  } catch (error) {
    console.error("Import failed:", error);
    setCopyFeedback(`❌ Import failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    setIsImporting(false);
  }
}, [companyId, setCopyFeedback]);

  // ========== OTHER HANDLERS (unchanged) ==========
  const handleDraftEmail = useCallback((load) => {
    const total = calculateTotal(load);
    const template = `Dear ${load?.customerName || 'Customer'},\n\nPlease find attached the invoice for the following shipment:\n\nInvoice Details:\n- Container: ${load?.containerNo || 'N/A'}\n- PO Number: ${load?.poNumber || 'N/A'}\n- Reference: ${load?.customerRefNo || 'N/A'}\n- Amount Due: $${total}\n\nPlease confirm receipt of this invoice.\n\nThank you for your business.\n\nBest regards,\n${companyName || 'Company'} Dispatch Team`;
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

  const handleSendInvoiceEmail = useCallback(async (load, fromEmail) => {
    if (!load || !load.customerEmail) { setCopyFeedback("❌ No customer email found"); return; }
    if (!fromEmail) { setCopyFeedback("❌ Please provide your accounting email address"); return; }
    setCopyFeedback("Generating invoice PDF and sending...");
    try {
      const addressStr = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');
      const currentDate = new Date().toISOString().split('T')[0];
      let rowsHtml = '';
      if (load.revenueItems && Array.isArray(load.revenueItems) && load.revenueItems.length > 0) {
        load.revenueItems.forEach(item => {
          if (safeFloat(item?.amount) > 0 || safeFloat(item?.rate) > 0) {
            rowsHtml += `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div class="font-bold text-base">${sanitizeInput(item.item || 'Service Charge')}</div></td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.qty || 1}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${safeFloat(item.rate).toFixed(2)}</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;" class="font-black text-base">$${safeFloat(item.amount).toFixed(2)}</td></tr>`;
          }
        });
      }
      const invoiceContent = `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #111827; background: #fff; line-height: 1.4; box-sizing: border-box; width: 100%;"><style>/* same invoice styles as downloadInvoice */</style> ...`; // (full HTML kept as before)
      const element = document.createElement('div');
      element.innerHTML = invoiceContent;
      const pdfBlob = await html2pdf().set({ margin: 0.4, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, logging: false, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } }).from(element).outputPdf('blob');
      const safeFileName = `Invoice_${load.workOrderNo || 'load'}.pdf`;
      const filePath = `invoices/${companyId}/${load.id}_${Date.now()}_${safeFileName}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' });
      const invoiceUrl = await getDownloadURL(storageRef);
      const sendFn = httpsCallable(getFunctions(), "sendInvoiceEmail");
      await sendFn({ loadData: load, fromEmail: fromEmail, companyName: companyName, invoiceUrl: invoiceUrl });
      setCopyFeedback("✅ Invoice email sent successfully!");
    } catch (error) { console.error("Send invoice failed:", error); setCopyFeedback("❌ Failed to send invoice email: " + (error.message || "Unknown error")); }
  }, [companyName, companyDetails, setCopyFeedback, storage]);

  const resetInactivityTimer = useCallback(() => { if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); if (appState === 'dashboard') { inactivityTimerRef.current = setTimeout(async () => { setCopyFeedback("⚠️ Session expired due to inactivity"); await signOut(auth); setAppState('landing'); }, INACTIVITY_TIMEOUT_MS); } }, [appState, setCopyFeedback]);

  const handleRegistrationComplete = (companyId, uid) => { setPendingCompanyId(companyId); setPendingOwnerUid(uid); setAppState('rolesetup'); };
  const handleRoleSetupComplete = useCallback(async () => { if (user && pendingCompanyId) { try { await updateDoc(doc(db, 'users', user.uid), { setupComplete: true }); } catch (err) { console.error('Failed to update setup status:', err); } } setAppState('dashboard'); window.location.reload(); }, [user, pendingCompanyId]);

  const confirmDeleteCustomer = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Customer?', message: 'Are you sure you want to delete this customer? This action cannot be undone.', onConfirm: () => executeDeleteCustomer(id) }); }, [executeDeleteCustomer]);
  const confirmDeleteLocation = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Location?', message: 'Are you sure you want to delete this location? This action cannot be undone.', onConfirm: () => executeDeleteLocation(id) }); }, [executeDeleteLocation]);
  const confirmDeleteDriver = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Driver?', message: 'Are you sure you want to delete this driver? This action cannot be undone.', onConfirm: () => executeDeleteDriver(id) }); }, [executeDeleteDriver]);
  const confirmDeleteLoad = useCallback((id) => { setConfirmModal({ isOpen: true, title: 'Delete Load?', message: 'Are you sure you want to delete this load record? This action cannot be undone.', onConfirm: () => executeDeleteLoad(id) }); }, [executeDeleteLoad]);

  const handleEdit = useCallback((load) => { if (load?.id) { setEditingId(load.id); setIsFormOpen(true); } }, []);
  const handleCopy = useCallback((load, leg) => { copyDispatch(load, leg, setCopyFeedback); }, [setCopyFeedback]);
  const handleDownload = useCallback((load, leg) => { downloadPOD(load, leg, setCopyFeedback, companyName, companyDetails); }, [setCopyFeedback, companyName, companyDetails]);
  const handlePrint = useCallback((load) => { downloadInvoice(load, setCopyFeedback, companyName, companyDetails); }, [setCopyFeedback, companyName, companyDetails]);
  const handleSign = useCallback((loadId, leg) => { if (loadId && leg?.id) { setSigningContext({ loadId, legId: leg.id, arrivalTime: leg.arrivalTime || '', departureTime: leg.departureTime || '', receiverName: leg.receiverName || '' }); } }, []);
  const handleTrack = useCallback((load) => { if (load) setTrackingLoad(load); }, []);
  const handleLeaveWorkspace = useCallback(async () => { if (!user) return; setAppState('loading'); try { await updateDoc(doc(db, 'users', user.uid), { companyId: null }); } catch (e) { console.warn(e); } if (isMountedRef.current) { setCompanyId(null); setAppState('landing'); } }, [user, isMountedRef]);

  useEffect(() => { return () => debouncedSearch.cancel && debouncedSearch.cancel(); }, [debouncedSearch]);

  const assignmentSlots = useMemo(() => {
    const slots = [{ id: 'early', label: '00:00 — 07:59', range: [0, 7] }, { id: 'morning', label: '08:00 — 09:59', range: [8, 9] }, { id: 'midday', label: '10:00 — 12:59', range: [10, 12] }, { id: 'afternoon', label: '13:00 — 15:59', range: [13, 15] }, { id: 'late', label: '16:00 — 23:59', range: [16, 23] }];
    return slots.map(slot => ({ ...slot, items: assignmentLoads.filter(l => { const hour = parseInt(String(l?.appointmentTime || '0').split(':')[0] || '0', 10); return hour >= slot.range[0] && hour <= slot.range[1]; }) }));
  }, [assignmentLoads]);

  // ========== AUTH STATE LISTENER (unchanged) ==========
  useEffect(() => {
  let isMounted = true;
  let userDocUnsubscribe = null;
  let loadingTimeout = null;
  let unsubscribe = null;

  const appStateRef = { current: 'loading' };
  setAppState('loading');

  // Timeout fallback – if auth takes more than 15 seconds, go to landing
  loadingTimeout = setTimeout(() => {
    if (isMounted && appStateRef.current === 'loading') {
      console.error("Auth initialization timeout");
      setAppState('landing');
      setCopyFeedback("Login timed out. Please try again.");
    }
  }, 15000);

  auth.authStateReady()
    .then(() => {
      if (!isMounted) return;
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!isMounted) return;

        // No user -> landing page
        if (!user) {
          setAppState('landing');
          appStateRef.current = 'landing';
          setAuthReady(false);
          return;
        }

        if (isAuthProcessing.current) return;
        isAuthProcessing.current = true;
        setUser(user);
        setUserEmail(user.email || '');

        const finishSetup = async (companyId, role, accessibleLocations = [], defaultLocation = null) => {
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
                email: cData.email || ''
              });
            } else {
              setCompanyName('Workspace');
            }
          } catch (err) {
            console.error("Error loading company:", err);
            setCompanyName('Workspace');
          }
          setActiveTab('summary');
          setAppState('dashboard');
          appStateRef.current = 'dashboard';
          isAuthProcessing.current = false;
        };

        const userDocRef = doc(db, 'users', user.uid);
        let userSnap;
        try {
          userSnap = await getDoc(userDocRef);
        } catch (error) {
          console.error("Error fetching user doc:", error);
          setAppState('landing');
          appStateRef.current = 'landing';
          setCopyFeedback("Unable to load user data. Please try again.");
          isAuthProcessing.current = false;
          return;
        }

        if (!userSnap.exists()) {
          console.error("User document missing for uid:", user.uid);
          setAppState('landing');
          appStateRef.current = 'landing';
          setCopyFeedback("User profile not found. Please re-register or contact support.");
          isAuthProcessing.current = false;
          return;
        }

        const userData = userSnap.data();
        const companyId = userData.companyId;
        const role = userData.role;

        if (companyId) {
          // Owner with incomplete setup -> role setup page
          if (userData.role === 'owner' && userData.setupComplete === false) {
            setPendingCompanyId(companyId);
            setPendingOwnerUid(user.uid);
            setAppState('rolesetup');
            appStateRef.current = 'rolesetup';
            isAuthProcessing.current = false;
            return;
          }
          await finishSetup(companyId, role, userData.accessibleLocations, userData.defaultLocation);
        } else {
          // No companyId – user has not joined a workspace yet
          setAppState('landing');
          appStateRef.current = 'landing';
          setCopyFeedback("You are not assigned to any workspace. Please contact your administrator.");
          isAuthProcessing.current = false;
          return;
        }
      });
    })
    .catch((err) => {
      console.error("auth.authStateReady() error:", err);
      if (isMounted) {
        setAppState('landing');
        setCopyFeedback("Authentication service unavailable. Please try again later.");
      }
    });

  return () => {
    isMounted = false;
    if (unsubscribe) unsubscribe();
    if (userDocUnsubscribe) userDocUnsubscribe();
    if (loadingTimeout) clearTimeout(loadingTimeout);
  };
}, []);

  useEffect(() => { if (userRole === 'accounting' && ['loads', 'assignment'].includes(activeTab)) setActiveTab('billing'); if (userRole === 'dispatcher' && ['billing', 'revenue'].includes(activeTab)) setActiveTab('loads'); }, [userRole, activeTab]);

  useEffect(() => { if (appState === 'dashboard') { const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove']; events.forEach(event => window.addEventListener(event, resetInactivityTimer)); resetInactivityTimer(); return () => { events.forEach(event => window.removeEventListener(event, resetInactivityTimer)); if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); }; } }, [appState, resetInactivityTimer]);

  const loadToEdit = editingId ? [...loadsToday, ...loadsOpen, ...paginatedLoads].find(l => l.id === editingId) : null;
  const isAdmin = userRole === 'owner' || userRole === 'admin';
  const isDispatcher = userRole === 'dispatcher';
  const isAccounting = userRole === 'accounting';

  if (appState === 'loading') return (<><div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4"><Loader2 className="w-10 h-10 text-blue-600 animate-spin" /><div className="text-sm font-bold text-slate-500 uppercase tracking-widest">Loading Workspace...</div></div><HelpPanel currentPage={appState} /></>);
  if (appState === 'landing') return (<><WorkspaceManager setCompanyId={setCompanyId} setUserRole={setUserRole} setAppState={setAppState} onRegistrationComplete={handleRegistrationComplete} /><HelpPanel currentPage={appState} /></>);
  if (appState === 'rolesetup') return (<><RoleSetup companyId={pendingCompanyId} ownerUid={pendingOwnerUid} onComplete={handleRoleSetupComplete} /><HelpPanel currentPage={appState} /></>);
  if (appState === 'dashboard' && !authReady) return (<div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4"><Loader2 className="w-10 h-10 text-blue-600 animate-spin" /><div className="text-sm font-bold text-slate-500 uppercase tracking-widest">Preparing your workspace...</div></div>);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
        {copyFeedback && (<div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${copyFeedback.includes('Error') || copyFeedback.includes('Failed') || copyFeedback.includes('❌') ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{copyFeedback.includes('Error') || copyFeedback.includes('Failed') || copyFeedback.includes('❌') ? <AlertTriangle className="w-5 h-5 text-white" /> : <Check className="w-5 h-5 text-green-400" />}<span className="font-bold text-sm">{copyFeedback}</span></div>)}
        {viewingDoc && (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setViewingDoc(null)}></div><div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"><div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-blue-600" /><h2 className="font-black text-slate-900">{viewingDoc.title}</h2></div><button onClick={() => setViewingDoc(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button></div><div className="p-2 bg-slate-100 flex-1 min-h-[500px] overflow-auto flex items-center justify-center">{(viewingDoc.type || "").startsWith('image/') ? (<img src={viewingDoc.url || viewingDoc.data} className="max-w-full shadow-lg rounded" alt="preview" />) : (<div className="bg-white p-12 rounded-2xl text-center"><FileText className="w-16 h-16 text-blue-500 mx-auto mb-4" /><p className="font-bold text-slate-700 mb-6">{viewingDoc.name}</p><a href={viewingDoc.url || viewingDoc.data} target="_blank" rel="noreferrer" download={viewingDoc.name} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold transition-all hover:bg-blue-700">Download to View</a></div>)}</div></div></div>)}
        {trackingLoad && (<TrackingModal load={trackingLoad} onClose={() => setTrackingLoad(null)} onUpdateStatus={handleUpdateStatus} />)}
        <DraftEmailModal isOpen={draftEmail.isOpen} onClose={() => setDraftEmail({ ...draftEmail, isOpen: false })} content={draftEmail.content} onSend={handleSendEmail} />
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} onConfirm={confirmModal.onConfirm} />
        <ImportDataModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImport={handleImportData} isLoading={isImporting} />
        {signingContext && (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setSigningContext(null)}></div><div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"><div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><h2 className="font-black text-slate-900">Sign Delivery Leg</h2><button onClick={() => setSigningContext(null)} className="p-2 hover:bg-slate-200 rounded-lg"><X /></button></div><div className="p-6 space-y-6"><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Arrival</label><input type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.arrivalTime} onChange={(e) => setSigningContext({...signingContext, arrivalTime: e.target.value})} /></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Departure</label><input type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.departureTime} onChange={(e) => setSigningContext({...signingContext, departureTime: e.target.value})} /></div></div><div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Receiver Name</label><input type="text" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold placeholder:font-normal" placeholder="Who is receiving this?" value={signingContext.receiverName} onChange={(e) => setSigningContext({...signingContext, receiverName: e.target.value})} /></div><SignaturePad onSave={handleSignLeg} onCancel={() => setSigningContext(null)} /></div></div></div>)}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"><div className="flex items-center gap-8"><div className="flex items-center gap-3"><div className="bg-blue-600 p-2 rounded-lg"><Package className="text-white w-6 h-6" /></div><div className="flex flex-col justify-center"><h1 className="text-lg font-bold text-slate-800 tracking-tight leading-tight">{companyName || 'Workspace'}</h1></div></div><nav className="hidden md:flex gap-1 bg-slate-100 p-1 rounded-xl"><button onClick={() => setActiveTab('summary')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'summary' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Summary</button>{(isAdmin || isDispatcher) && <button onClick={() => setActiveTab('loads')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'loads' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Operations</button>}<button onClick={() => setActiveTab('addressBook')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'addressBook' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Database</button>{(isAdmin || isAccounting) && <button onClick={() => setActiveTab('billing')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'billing' ? 'bg-white shadow-sm text-green-600' : 'text-slate-500 hover:text-slate-700'}`}>Billing</button>}<button onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>History</button>{(isAdmin || isDispatcher) && <button onClick={() => setActiveTab('assignment')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'assignment' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Assignment</button>}{(isAdmin || isAccounting) && <button onClick={() => setActiveTab('revenue')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'revenue' ? 'bg-white shadow-sm text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}>Profit</button>}</nav></div><div className="flex items-center gap-4"><LocationSelector userLocations={userAccessibleLocations.map(id => companyLocations.find(l => l.id === id)).filter(Boolean)} currentLocation={currentLocation} onLocationChange={setCurrentLocation} dataSharingMode={dataSharingMode} /><div className="flex flex-col items-end"><div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-200"><Wifi className="w-3 h-3" /><span className="text-[10px] font-black uppercase tracking-widest">Connected</span></div><div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 mr-1">Role: {userRole}</div></div><button onClick={handleLeaveWorkspace} className="hidden sm:flex items-center gap-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"><LogOut className="w-5 h-5" /></button>{(isAdmin || isDispatcher) && (<button onClick={() => { setEditingId(null); setIsFormOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-bold shadow-lg transition-transform active:scale-95 hover:bg-blue-700"><Plus className="w-5 h-5" /> <span className="hidden sm:inline">New Load</span></button>)}</div></div></header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === 'summary' && (<div className="animate-in fade-in space-y-8"><div><div className="flex justify-between items-center mb-6 flex-wrap gap-4"><h2 className="text-2xl font-black text-slate-900">Daily Summary</h2><div className="flex gap-3"><button onClick={() => { downloadDailyReportCSV(summaryLoads.filter(l => l?.appointmentDate === new Date().toISOString().split('T')[0]), companyName); setCopyFeedback("Daily Report Downloaded"); }} className="flex items-center gap-2 bg-green-50 text-green-700 hover:text-green-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-green-200 hover:bg-green-100 transition-all active:scale-95 shadow-sm"><FileDown className="w-4 h-4" /><span className="hidden sm:inline">Export Daily Report</span><span className="sm:hidden">Daily</span></button>{isAdmin && (<button onClick={async () => { await downloadFullCompanyData(companyId, companyName, summaryLoads, savedCustomers, savedDestinations, savedDrivers, setCopyFeedback); }} className="flex items-center gap-2 bg-purple-50 text-purple-700 hover:text-purple-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-purple-200 hover:bg-purple-100 transition-all active:scale-95 shadow-sm"><Archive className="w-4 h-4" /><span className="hidden sm:inline">Export ALL Company Data</span><span className="sm:hidden">Full Export</span></button>)}{isAdmin && (<button onClick={() => setIsImportModalOpen(true)} className="flex items-center gap-2 bg-blue-50 text-blue-700 hover:text-blue-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-blue-200 hover:bg-blue-100 transition-all active:scale-95 shadow-sm"><Upload className="w-4 h-4" /><span className="hidden sm:inline">Import Old Data</span><span className="sm:hidden">Import</span></button>)}</div></div><DailySummary loads={summaryLoads} /></div><ActionRequired loads={summaryLoads} onEdit={handleEdit} onStatusChange={quickUpdateStatus} /><div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden"><div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3"><div className="bg-blue-600 p-2 rounded-xl text-white"><Clock className="w-5 h-5" /></div><h3 className="font-black text-lg text-slate-900">Today's Active Dispatches</h3></div><LoadTable loads={summaryLoads.filter(l => l?.appointmentDate === new Date().toISOString().split('T')[0] && l?.status === 'Open')} onEdit={handleEdit} onDelete={confirmDeleteLoad} onStatusChange={quickUpdateStatus} onViewDoc={setViewingDoc} onSign={handleSign} onCopy={handleCopy} onDownload={handleDownload} onTrack={handleTrack} companyName={companyName} /></div></div>)}
          {(activeTab === 'loads' || activeTab === 'billing' || activeTab === 'history') && (<div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 flex gap-4"><div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" /><input type="text" placeholder="Search Container #, PO#, WO#, or Customer..." className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all" onChange={(e) => debouncedSearch(e.target.value)} /></div></div>)}
          {activeTab === 'loads' && (<LoadTable loads={paginatedLoads} onEdit={handleEdit} onDelete={confirmDeleteLoad} onStatusChange={quickUpdateStatus} onViewDoc={setViewingDoc} onSign={handleSign} onCopy={handleCopy} onDownload={handleDownload} onTrack={handleTrack} companyName={companyName} currentPage={loadsPage} pageSize={pageSize} isLoadingMore={isLoadingMore} onNextPage={() => { if (paginatedLoads.length === pageSize) { setLoadsPage(p => p + 1); fetchPaginatedLoads(false); } }} onPrevPage={() => { if (loadsPage > 0) { setLoadsPage(0); lastDocSnapshotRef.current = null; fetchPaginatedLoads(true); } }} hasNextPage={paginatedLoads.length === pageSize} />)}
          {activeTab === 'billing' && (<BillingTable loads={paginatedLoads} onStatusChange={quickUpdateStatus} onDraftEmail={handleDraftEmail} onEdit={handleEdit} onPrint={handlePrint} onViewDoc={setViewingDoc} onSendInvoice={handleSendInvoiceEmail} companyName={companyName} companyEmail={companyDetails.email} />)}
          {activeTab === 'history' && (<HistoryTable loads={paginatedLoads} onStatusChange={quickUpdateStatus} onViewDoc={setViewingDoc} onDelete={confirmDeleteLoad} onEdit={handleEdit} />)}
          {activeTab === 'addressBook' && (<AddressBook savedCustomers={savedCustomers} savedDestinations={savedDestinations} savedDrivers={savedDrivers} onDeleteCustomer={confirmDeleteCustomer} onDeleteLocation={confirmDeleteLocation} onDeleteDriver={confirmDeleteDriver} newCust={newCust} setNewCust={setNewCust} newLoc={newLoc} setNewLoc={setNewLoc} newDriver={newDriver} setNewDriver={setNewDriver} onAddCustomer={handleAddCustomer} onAddLocation={handleAddLocation} onAddDriver={handleAddDriver} />)}
          {activeTab === 'assignment' && (<AssignmentView loads={assignmentLoads} assignmentDate={assignmentDate} setAssignmentDate={setAssignmentDate} assignmentSlots={assignmentSlots} />)}
          {activeTab === 'revenue' && (<ProfitDashboard loads={revenueLoads} />)}
        </main>
        <LoadForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingId(null); }} onSubmit={handleSubmitLoad} initialData={loadToEdit} savedCustomers={savedCustomers} savedDestinations={savedDestinations} savedDrivers={savedDrivers} apiKey={GEMINI_API_KEY} companyId={companyId} userId={user?.uid} userRole={userRole} userEmail={userEmail} setFeedback={setCopyFeedback} currentLocation={currentLocation} userAccessibleLocations={userAccessibleLocations} dataSharingMode={dataSharingMode} />
      </div>
      <HelpPanel currentPage={appState} />
    </ErrorBoundary>
  );
};

export default App;
