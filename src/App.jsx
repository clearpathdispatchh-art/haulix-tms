import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  Plus, Search, Trash2, Package, User, Scale, Maximize, Navigation, Hash, 
  FileText, Filter, Download, Edit3, X, MapPin, Building, ChevronDown, 
  CheckCircle2, Mail, ArrowRight, Route, Truck, Copy, Check, UserPlus, 
  FileDown, DollarSign, Calculator, Receipt, Printer, FileCheck, Anchor, 
  Clock, Calendar, ArrowUpRight, Pencil, Eye, RotateCcw, FileUp, Paperclip, 
  ClipboardCheck, BadgeInfo, Layers, ArrowRightLeft, CalendarDays, Send, Loader2, AlertTriangle,
  Globe, Train, Ship, ExternalLink, RefreshCw, Sparkles, MessageSquare, Cloud, Wifi, Briefcase
} from 'lucide-react';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, setDoc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ==========================================
// FIREBASE CONFIG & INIT
// ==========================================
// Use environment variables for configuration
const firebaseConfig = {
apiKey: "AIzaSyCPowkDQ0kk5M1pufy79nL7-832jh0Kw38",
  authDomain: "haulix-tms.firebaseapp.com",
  projectId: "haulix-tms",
  storageBucket: "haulix-tms.firebasestorage.app",
  messagingSenderId: "864718858606",
  appId: "1:864718858606:web:06b843ceaacff879b9f97f"
};
const appId = "haulix-tms";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Optional: Only init functions if needed, error handling wrapper recommended
// const functions = getFunctions(app); 

// ==========================================
// STYLES & ANIMATIONS (Global CSS Injection)
// ==========================================
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    
    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    body {
      font-family: var(--font-sans);
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Animation Polyfills for tailwindcss-animate */
    @keyframes enter {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slide-in-from-bottom {
      from { transform: translateY(1rem); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes slide-in-from-top {
      from { transform: translateY(-1rem); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes zoom-in-95 {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .animate-in { animation-duration: 0.2s; animation-fill-mode: forwards; }
    .fade-in { animation-name: fade-in; }
    .zoom-in-95 { animation-name: zoom-in-95; }
    .slide-in-from-bottom-4 { animation-name: slide-in-from-bottom; }
    .slide-in-from-top-4 { animation-name: slide-in-from-top; }
    
    /* Utilities */
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    
    input[type="date"], input[type="time"] {
      font-family: var(--font-sans);
    }
  `}</style>
);

// ==========================================
// UTILITIES & HELPERS
// ==========================================

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

const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const generateGeminiContent = async (prompt, apiKey) => {
  // Use a fallback key or instruct user if empty
  const keyToUse = apiKey || ""; 
  if (!keyToUse) return "API Key missing. Please provide a Gemini API key.";

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${keyToUse}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No content generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error connecting to AI service. Please try again.";
  }
};

const calculateTotal = (load) => {
  const base = parseFloat(load.basePrice || 0);
  const wait = parseFloat(load.waitingTime || 0);
  const fuel = parseFloat(load.fuelSurcharge || 0);
  const prepull = parseFloat(load.prepull || 0);
  const extras = (load.extraCharges || []).reduce((acc, curr) => acc + parseFloat(curr.amount || 0), 0);
  
  return (base + wait + fuel + prepull + extras).toFixed(2);
};

// Robust Copy to Clipboard function with fallback
const copyToClipboard = async (text) => {
  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // Avoid scrolling to bottom
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      textArea.style.opacity = "0"; // Invisible but interactive
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    }
  };

  try {
    // Try modern API first
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // If not secure context (e.g. some iframes), use fallback
    return fallbackCopy(text);
  } catch (error) {
    // If permission denied or other API error, catch and use fallback
    console.warn('Clipboard API blocked/failed, using fallback:', error);
    return fallbackCopy(text);
  }
};

const copyDispatch = async (load, leg, setFeedback) => {
  const text = `🚛 DISPATCH ASSIGNMENT 🚛
---------------------------
Container: ${load.containerNo}
Line: ${load.shippingLine}
Size/Weight: ${load.size} / ${load.weight || 'N/A'}
PO #: ${load.poNumber || 'N/A'}
Pickup #: ${load.pickupNo || 'N/A'}
Ref #: ${load.customerRefNo || 'N/A'}
Appointment: ${load.appointmentDate} at ${load.appointmentTime}

ROUTING:
📍 From: ${leg.from}
🏁 To: ${leg.to}

DRIVER INFO:
👤 Driver: ${leg.driverName || 'TBD'}
🚛 Truck: ${leg.truckNo || 'TBD'}
---------------------------`;

  const success = await copyToClipboard(text);
  if(setFeedback) {
    setFeedback(success ? "Dispatch Copied!" : "Copy failed");
  }
};

const downloadPOD = (load, leg, setFeedback, companyName) => {
  const podHtml = `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
          body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; line-height: 1.4; font-size: 12px; max-width: 900px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
          .company-info h1 { font-size: 24px; font-weight: 900; margin: 0 0 2px 0; color: #2563eb; }
          .company-slogan { font-size: 10px; font-weight: 700; color: #2563eb; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
          .company-info p { margin: 0; color: #64748b; }
          .wo-details { text-align: right; }
          .wo-title { font-size: 32px; font-weight: 900; color: #e2e8f0; letter-spacing: -1px; line-height: 1; }
          .wo-grid { display: grid; grid-template-columns: auto auto; gap: 8px 20px; margin-top: 10px; text-align: right; }
          .label { font-weight: 700; color: #94a3b8; text-transform: uppercase; font-size: 10px; }
          .value { font-weight: 700; color: #0f172a; }
          
          .section-title { background: #f1f5f9; padding: 8px 12px; font-weight: 900; font-size: 14px; color: #334155; margin-bottom: 15px; border-left: 4px solid #2563eb; display: flex; justify-content: space-between; }
          
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
          .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
          
          .box { border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; }
          .box-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; display: block; }
          .box-value { font-size: 14px; font-weight: 700; color: #0f172a; word-break: break-word; }
          
          .route-section { display: flex; gap: 20px; margin-bottom: 30px; }
          .location-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; position: relative; }
          .location-box.pickup { border-color: #93c5fd; background: #eff6ff; }
          .location-box.delivery { border-color: #86efac; background: #f0fdf4; }
          .loc-type { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; color: #3b82f6; }
          .delivery .loc-type { color: #15803d; }
          .loc-name { font-size: 16px; font-weight: 900; margin-bottom: 5px; }
          .loc-addr { font-size: 12px; color: #475569; margin-bottom: 15px; }
          
          .signatures { margin-top: 50px; border-top: 2px dashed #cbd5e1; padding-top: 30px; }
          .sig-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; }
          .sig-box { text-align: center; }
          .sig-line { height: 60px; border-bottom: 1px solid #94a3b8; margin-bottom: 8px; display: flex; align-items: flex-end; justify-content: center; }
          .sig-img { max-height: 50px; }
          
          .footer { text-align: center; margin-top: 50px; font-size: 10px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>${companyName || 'Haulix'}</h1>
            <div class="company-slogan">Powering the Next Generation of Carriers</div>
            <p>123 Logistics Way, Transport City, TC 90210</p>
            <p>Phone: (555) 123-4567 | Dispatch: dispatch@haulix.com</p>
          </div>
          <div class="wo-details">
            <div class="wo-title">WORK ORDER</div>
            <div class="wo-grid">
              <div class="label">Order #</div><div class="value">${load.id}</div>
              <div class="label">Date</div><div class="value">${new Date().toISOString().split('T')[0]}</div>
              <div class="label">PO #</div><div class="value">${load.poNumber || 'N/A'}</div>
              <div class="label">Ref #</div><div class="value">${load.customerRefNo || 'N/A'}</div>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div>
            <div class="section-title">CUSTOMER</div>
            <div class="box">
              <div class="box-value" style="font-size: 16px;">${load.customerName}</div>
              <div style="margin-top: 5px; color: #64748b;">${load.customerAddress || 'Address on file'}</div>
              <div style="margin-top: 5px; color: #64748b;">${load.customerEmail || ''}</div>
            </div>
          </div>
          <div>
             <div class="section-title">SHIPMENT DETAILS</div>
             <div class="grid-2" style="gap: 10px; margin-bottom: 0;">
                <div class="box">
                  <span class="box-label">Container</span>
                  <div class="box-value">${load.containerNo}</div>
                </div>
                 <div class="box">
                  <span class="box-label">Size / Type</span>
                  <div class="box-value">${load.size}</div>
                </div>
                 <div class="box">
                  <span class="box-label">Weight</span>
                  <div class="box-value">${load.weight || 'N/A'}</div>
                </div>
                 <div class="box">
                  <span class="box-label">Line</span>
                  <div class="box-value">${load.shippingLine}</div>
                </div>
             </div>
          </div>
        </div>

        <div class="section-title">ROUTING INSTRUCTIONS</div>
        <div class="route-section">
          <div class="location-box pickup">
            <div class="loc-type">PICK UP / ORIGIN</div>
            <div class="loc-name">${leg.from}</div>
            <div class="loc-addr">Full Address Provided in Dispatch Link</div>
            <div class="box-label">Instructions</div>
            <div>${load.pickupNo ? `Pickup #: ${load.pickupNo}` : 'Standard Pickup'}</div>
          </div>
          <div style="display: flex; align-items: center; color: #cbd5e1;">&rarr;</div>
          <div class="location-box delivery">
            <div class="loc-type">DELIVERY / DESTINATION</div>
            <div class="loc-name">${leg.to}</div>
            <div class="loc-addr">Full Address Provided in Dispatch Link</div>
            <div class="box-label">Appointment</div>
            <div>${load.appointmentDate} @ ${load.appointmentTime}</div>
          </div>
        </div>

        <div class="section-title">DRIVER INSTRUCTIONS & NOTES</div>
        <div class="box" style="min-height: 80px; background: #f8fafc; font-style: italic;">
          ${load.notes || 'No special instructions. Please drive safely and report any delays immediately.'}
        </div>

        <div class="signatures">
          <div class="sig-grid">
            <div class="sig-box">
              <div class="label" style="text-align: left; margin-bottom: 5px;">DRIVER</div>
              <div class="box">
                <div style="font-size: 12px; font-weight: bold;">${leg.driverName || 'TBD'}</div>
                <div style="font-size: 10px; color: #64748b;">Truck: ${leg.truckNo || 'TBD'}</div>
              </div>
            </div>
            
            <div class="sig-box" style="grid-column: span 2;">
               <div class="label" style="text-align: left; margin-bottom: 5px;">RECEIVER / CONSIGNEE</div>
               <div style="border: 1px solid #94a3b8; border-radius: 8px; padding: 15px;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                      <div>
                        <span class="box-label">Arrival Time</span>
                        <div style="border-bottom: 1px solid #ccc; height: 25px;">${leg.arrivalTime || ''}</div>
                      </div>
                      <div>
                        <span class="box-label">Departure Time</span>
                        <div style="border-bottom: 1px solid #ccc; height: 25px;">${leg.departureTime || ''}</div>
                      </div>
                  </div>
                  <div style="margin-bottom: 15px;">
                      <span class="box-label">Receiver Name</span>
                      <div style="border-bottom: 1px solid #ccc; height: 25px;">${leg.receiverName || ''}</div>
                  </div>
                  <div>
                      <span class="box-label">Signature</span>
                      <div style="height: 60px; border-bottom: 1px solid #ccc; display: flex; align-items: flex-end; justify-content: center;">
                         ${leg.signature ? `<img src="${leg.signature}" style="max-height: 50px;" />` : ''}
                      </div>
                  </div>
               </div>
            </div>
          </div>
        </div>

        <div class="footer">
          Generated by ${companyName || 'Haulix'} • Powering the Next Generation of Carriers • ${new Date().toLocaleString()}
        </div>
      </body>
    </html>
  `;
  
  const blob = new Blob([podHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `POD_${load.containerNo}_${load.poNumber || ''}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  if(setFeedback) {
    setFeedback("POD Downloaded");
  }
};

const downloadInvoice = (load, setFeedback, companyName) => {
  const invoiceHtml = `
    <html>
      <head>
        <title>Invoice - ${load.containerNo}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');
          body { font-family: 'Inter', sans-serif; padding: 0; margin: 0; background: #f8fafc; color: #1e293b; -webkit-print-color-adjust: exact; }
          .invoice-container { max-width: 800px; margin: 40px auto; background: white; padding: 50px; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
          
          /* Header */
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 50px; padding-bottom: 30px; border-bottom: 2px solid #f1f5f9; }
          .company-branding { display: flex; flex-direction: column; gap: 8px; }
          .company-name { font-size: 28px; font-weight: 800; color: #2563eb; letter-spacing: -0.5px; margin: 0; }
          .company-slogan { font-size: 10px; font-weight: 700; color: #2563eb; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
          .company-details { color: #64748b; font-size: 12px; line-height: 1.5; }
          
          .invoice-info { text-align: right; }
          .invoice-title { font-size: 42px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: -1px; line-height: 1; margin: 0 0 10px 0; opacity: 0.1; }
          .invoice-badge { display: inline-block; background: #eff6ff; color: #2563eb; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 15px; }
          
          .meta-grid { display: grid; grid-template-columns: auto auto; gap: 8px 24px; text-align: right; justify-content: flex-end; }
          .meta-label { font-weight: 600; color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
          .meta-value { font-weight: 700; color: #334155; font-size: 13px; }

          /* Sections */
          .bill-to-section { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-bottom: 50px; }
          .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 12px; display: block; }
          
          .client-box { }
          .client-name { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
          .client-details { font-size: 14px; color: #64748b; line-height: 1.6; }

          .shipment-grid { background: #f8fafc; border-radius: 12px; padding: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; border: 1px solid #e2e8f0; }
          .shipment-item { display: flex; flex-direction: column; gap: 4px; }
          .shipment-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
          .shipment-value { font-size: 13px; font-weight: 700; color: #334155; word-break: break-all; }

          /* Table */
          .table-container { margin-bottom: 40px; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; }
          th { text-align: left; padding: 16px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; }
          th:first-child { border-top-left-radius: 8px; }
          th:last-child { border-top-right-radius: 8px; text-align: right; }
          
          td { padding: 20px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #334155; vertical-align: middle; }
          td.desc-col { width: 70%; }
          td strong { display: block; color: #0f172a; margin-bottom: 4px; }
          td span { font-size: 12px; color: #64748b; }
          td.amount-col { text-align: right; font-weight: 700; color: #0f172a; font-feature-settings: 'tnum'; }
          
          tr:last-child td { border-bottom: none; }

          /* Totals */
          .total-section { display: flex; justify-content: flex-end; }
          .total-box { width: 320px; background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; }
          .total-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px; color: #64748b; }
          .total-row.final { margin-top: 16px; padding-top: 16px; border-top: 2px dashed #cbd5e1; margin-bottom: 0; color: #0f172a; align-items: center; }
          .total-label { font-weight: 600; }
          .total-amount { font-weight: 700; }
          .final .total-label { font-size: 16px; font-weight: 800; }
          .final .total-amount { font-size: 24px; font-weight: 800; color: #2563eb; }

          /* Footer */
          .footer { margin-top: 60px; padding-top: 30px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
          .brand-mark { font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 1px; }
        </style>
      </head>
      <body>
        <div class="invoice-container">
            <div class="header">
                <div class="company-branding">
                    <div class="company-name">${companyName || 'Haulix'}</div>
                    <div class="company-slogan">Powering the Next Generation of Carriers</div>
                    <div class="company-details">
                        123 Logistics Way, Suite 100<br>
                        Transport City, TC 90210<br>
                        dispatch@haulix.com • (555) 123-4567
                    </div>
                </div>
                <div class="invoice-info">
                    <div class="invoice-title">INVOICE</div>
                    <div class="invoice-badge">Payment Due Upon Receipt</div>
                    <div class="meta-grid">
                        <div class="meta-label">Invoice Date</div>
                        <div class="meta-value">${new Date().toLocaleDateString()}</div>
                        <div class="meta-label">Invoice #</div>
                        <div class="meta-value">INV-${load.containerNo.slice(-4)}-${Date.now().toString().slice(-4)}</div>
                    </div>
                </div>
            </div>

            <div class="bill-to-section">
                <div>
                    <span class="section-label">Bill To</span>
                    <div class="client-box">
                        <div class="client-name">${load.customerName}</div>
                        <div class="client-details">
                            ${load.customerAddress || 'Address on file'}<br>
                            ${load.customerEmail || ''}
                        </div>
                    </div>
                </div>
                <div>
                    <span class="section-label">Shipment Reference</span>
                    <div class="shipment-grid">
                        <div class="shipment-item">
                            <span class="shipment-label">Container</span>
                            <span class="shipment-value">${load.containerNo}</span>
                        </div>
                        <div class="shipment-item">
                            <span class="shipment-label">PO Number</span>
                            <span class="shipment-value">${load.poNumber || 'N/A'}</span>
                        </div>
                        <div class="shipment-item">
                            <span class="shipment-label">Reference</span>
                            <span class="shipment-value">${load.customerRefNo || 'N/A'}</span>
                        </div>
                        <div class="shipment-item">
                            <span class="shipment-label">Size / Type</span>
                            <span class="shipment-value">${load.size}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <span class="section-label">Service Details</span>
                <table width="100%">
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="desc-col">
                                <strong>Base Drayage Rate</strong>
                                <span>Transportation services for container ${load.containerNo} via ${load.shippingLine}</span>
                            </td>
                            <td class="amount-col">$${parseFloat(load.basePrice || 0).toFixed(2)}</td>
                        </tr>
                        ${parseFloat(load.fuelSurcharge) > 0 ? `
                        <tr>
                            <td class="desc-col">
                                <strong>Fuel Surcharge</strong>
                                <span>FSC applicable at time of shipment</span>
                            </td>
                            <td class="amount-col">$${parseFloat(load.fuelSurcharge).toFixed(2)}</td>
                        </tr>` : ''}
                        ${parseFloat(load.waitingTime) > 0 ? `
                        <tr>
                            <td class="desc-col">
                                <strong>Waiting Time</strong>
                                <span>Detention/Driver waiting time</span>
                            </td>
                            <td class="amount-col">$${parseFloat(load.waitingTime).toFixed(2)}</td>
                        </tr>` : ''}
                        ${parseFloat(load.prepull) > 0 ? `
                        <tr>
                            <td class="desc-col">
                                <strong>Prepull Fee</strong>
                                <span>Terminal/Yard pull out fee</span>
                            </td>
                            <td class="amount-col">$${parseFloat(load.prepull).toFixed(2)}</td>
                        </tr>` : ''}
                        ${(load.extraCharges || []).map(charge => `
                        <tr>
                            <td class="desc-col">
                                <strong>${charge.description}</strong>
                                <span>Additional accessorial charge</span>
                            </td>
                            <td class="amount-col">$${parseFloat(charge.amount || 0).toFixed(2)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            <div class="total-section">
                <div class="total-box">
                    <div class="total-row">
                        <span class="total-label">Subtotal</span>
                        <span class="total-amount">$${calculateTotal(load)}</span>
                    </div>
                    <div class="total-row">
                        <span class="total-label">Tax (0%)</span>
                        <span class="total-amount">$0.00</span>
                    </div>
                    <div class="total-row final">
                        <span class="total-label">Total Due</span>
                        <span class="total-amount">$${calculateTotal(load)}</span>
                    </div>
                </div>
            </div>

            <div class="footer">
                <div>Thank you for your business!</div>
                <div class="brand-mark">Powered by ${companyName || 'Haulix'} • Powering the Next Generation of Carriers</div>
            </div>
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([invoiceHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Invoice_${load.containerNo}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  if (setFeedback) {
    setFeedback("Invoice Downloaded");
  }
};

const getTrackingUrl = (carrier) => {
  const c = carrier.toLowerCase();
  if (c.includes('cn') || c.includes('canadian national')) return 'https://www.cn.ca/en/customer-centre/your-shipment/shipment-tracking/';
  if (c.includes('cp') || c.includes('cpkc')) return 'https://www.cpkcr.com/en/customer-resources/tracking';
  if (c.includes('one')) return 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking';
  if (c.includes('msc')) return 'https://www.msc.com/en/track-a-shipment';
  if (c.includes('maersk')) return 'https://www.maersk.com/tracking/';
  return `https://www.google.com/search?q=${carrier}+container+tracking`;
};

// ==========================================
// SUB-COMPONENTS
// ==========================================

const DraftEmailModal = ({ isOpen, onClose, content, onSend, isLoading }) => {
  const [editedContent, setEditedContent] = useState(content);
  
  useEffect(() => {
    setEditedContent(content);
  }, [content]);

  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 p-6 space-y-4 animate-in zoom-in-95">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
            <div className="bg-purple-100 p-2 rounded-lg"><Sparkles className="w-5 h-5 text-purple-600" /></div>
            AI Drafted Email
          </h3>
          <button onClick={onClose} aria-label="Close modal"><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
        </div>
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            <span className="text-xs font-bold uppercase tracking-wider">Generating Draft...</span>
          </div>
        ) : (
          <textarea 
            className="w-full h-64 p-4 border border-slate-200 rounded-xl text-sm leading-relaxed outline-blue-500 bg-slate-50 font-medium text-slate-700 resize-none"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
          />
        )}
        <div className="flex gap-3 justify-end pt-2">
           <button onClick={onClose} className="px-5 py-2.5 text-slate-500 font-bold text-sm hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
           <button 
             onClick={() => onSend(editedContent)} 
             className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"
           >
             <Send className="w-4 h-4" /> Send Email
           </button>
        </div>
      </div>
    </div>
  )
};

const TrackingModal = ({ load, onClose, onUpdateStatus }) => {
  const [loading, setLoading] = useState(false);
  const [manualStatus, setManualStatus] = useState(load.lastTrackingStatus || "Pending");

  const simulateLiveCheck = () => {
    setLoading(true);
    setTimeout(() => {
      const statuses = [
        "Vessel Arrived at Port",
        "Discharged from Vessel",
        "Loaded on Rail",
        "Rail Departed: Toronto, ON",
        "Rail Arrived: Chicago, IL",
        "Grounded at Terminal",
        "Available for Pickup"
      ];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
      setManualStatus(randomStatus);
      onUpdateStatus(load.id, randomStatus);
      setLoading(false);
    }, 1500);
  };

  const openCarrierSite = () => {
    const textArea = document.createElement("textarea");
    textArea.value = load.containerNo;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    const url = getTrackingUrl(load.shippingLine);
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-3">
             <div className="bg-blue-600 p-2 rounded-xl text-white"><Globe className="w-5 h-5" /></div>
             <div>
               <h2 className="font-black text-slate-900 text-lg">Live Tracking</h2>
               <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{load.shippingLine} • {load.containerNo}</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors" aria-label="Close modal"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="p-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-black uppercase tracking-widest border border-blue-100">
              Current Status
            </div>
            <div className="text-2xl font-black text-slate-800">
              {loading ? " contacting satellite..." : manualStatus}
            </div>
            <p className="text-xs text-slate-400 font-bold">Last Updated: {new Date().toLocaleTimeString()}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <button 
               onClick={simulateLiveCheck}
               disabled={loading}
               className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group"
             >
               <RefreshCw className={`w-6 h-6 text-blue-600 ${loading ? 'animate-spin' : ''}`} />
               <span className="text-xs font-black text-slate-600 group-hover:text-blue-700">REFRESH STATUS</span>
             </button>

             <button 
               onClick={openCarrierSite}
               className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group"
             >
               <ExternalLink className="w-6 h-6 text-blue-600" />
               <span className="text-xs font-black text-slate-600 group-hover:text-blue-700">OPEN {load.shippingLine} SITE</span>
               <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">Auto-Copies Container #</span>
             </button>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-[10px] text-slate-400 font-medium leading-relaxed text-center">
            Note: Direct API tracking requires a paid subscription to Project44 or Vizion. This module provides direct links to carrier portals (CN, CP, ONE) and simulated status updates for this demo.
          </div>
        </div>
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
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  const save = () => {
    const canvas = canvasRef.current;
    onSave(canvas.toDataURL());
  };

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 relative overflow-hidden touch-none">
        <canvas ref={canvasRef} width={500} height={200} className="w-full h-[200px] cursor-crosshair"
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
        />
        <button type="button" onClick={clear} className="absolute bottom-3 right-3 p-2 bg-white shadow-sm border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors" aria-label="Clear signature"><RotateCcw className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 transition-colors hover:bg-slate-200">Cancel</button>
        <button type="button" onClick={save} className="flex-1 py-3 bg-blue-600 rounded-xl font-bold text-white shadow-lg transition-all hover:bg-blue-700">Confirm Signature</button>
      </div>
    </div>
  );
};

const LoadForm = ({ isOpen, onClose, onSubmit, isSubmitting, initialData, savedCustomers, savedDestinations, savedDrivers, apiKey }) => {
  const [formData, setFormData] = useState({
    status: "Open",
    containerNo: "", shippingLine: "", poNumber: "", pickupNo: "", customerRefNo: "",
    size: "40ft", weight: "", customerName: "", customerEmail: "", customerAddress: "",
    appointmentDate: "", appointmentTime: "", loadConfirmation: null, signedPodDoc: null,
    basePrice: "", waitingTime: "", fuelSurcharge: "", prepull: "", extraCharges: [],
    legs: [{ id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null }],
    notes: "",
    lastTrackingStatus: "Pending"
  });
  const [suggestionFocus, setSuggestionFocus] = useState({ type: null, index: null, field: null });
  const [generatingNotes, setGeneratingNotes] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
            ...initialData,
            prepull: initialData.prepull || "",
            extraCharges: initialData.extraCharges || []
        });
      } else {
        setFormData({
          status: "Open",
          containerNo: "", shippingLine: "", poNumber: "", pickupNo: "", customerRefNo: "",
          size: "40ft", weight: "", customerName: "", customerEmail: "", customerAddress: "",
          appointmentDate: "", appointmentTime: "", loadConfirmation: null, signedPodDoc: null,
          basePrice: "", waitingTime: "", fuelSurcharge: "", prepull: "", extraCharges: [],
          legs: [{ id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null }],
          notes: "",
          lastTrackingStatus: "Pending"
        });
      }
    }
  }, [isOpen, initialData]);

  const handleSmartNotes = async () => {
    setGeneratingNotes(true);
    
    const origin = formData.legs[0]?.from || 'Unknown Origin';
    const dest = formData.legs[formData.legs.length - 1]?.to || 'Unknown Destination';
    
    const prompt = `Acting as a professional logistics dispatcher, generate concise but comprehensive shipment notes for the following load:
    - Container: ${formData.containerNo} (${formData.size})
    - Weight: ${formData.weight || 'N/A'}
    - Route: From ${origin} to ${dest}
    - Carrier: ${formData.shippingLine}
    
    Include:
    1. A brief handling instruction based on container size/type.
    2. A placeholder warning for driver safety (e.g., "Check weather/traffic").
    3. A professional reminder about POD requirements.
    
    Keep it text-only, no markdown formatting.`;

    try {
      const notes = await generateGeminiContent(prompt, apiKey);
      setFormData(prev => ({ ...prev, notes: notes }));
    } catch (error) {
      setFormData(prev => ({ ...prev, notes: "Error generating notes. Please add them manually." }));
    }
    setGeneratingNotes(false);
  };

  const addExtraCharge = () => {
    setFormData(prev => ({
        ...prev,
        extraCharges: [...prev.extraCharges, { description: '', amount: '' }]
    }));
  };

  const updateExtraCharge = (index, field, value) => {
    const updatedCharges = [...formData.extraCharges];
    updatedCharges[index][field] = value;
    setFormData(prev => ({ ...prev, extraCharges: updatedCharges }));
  };

  const removeExtraCharge = (index) => {
    const updatedCharges = formData.extraCharges.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, extraCharges: updatedCharges }));
  };

  if (!isOpen) return null;

  const handleChange = (e) => { 
    const { name, value } = e.target; 
    setFormData(prev => ({ ...prev, [name]: value })); 
  };
  
  const updateLeg = (id, field, value) => { 
    setFormData(prev => ({ 
      ...prev, 
      legs: prev.legs.map(leg => leg.id === id ? { ...leg, [field]: value } : leg) 
    })); 
  };
  
  const handleFileUpload = (e, field) => {
    const file = e.target.files[0]; 
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setFormData(prev => ({ 
      ...prev, 
      [field]: { 
        name: file.name, 
        type: file.type, 
        data: event.target.result 
      } 
    }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose}></div>
      <div className="bg-white w-full max-w-6xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-2xl font-black text-slate-900">{initialData ? "Update Load Profile" : "Create New Load"}</h2>
          <div className="flex items-center gap-4">
             <div className="flex flex-col">
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest" htmlFor="statusSelect">Load Status</label>
               <select id="statusSelect" name="status" value={formData.status} onChange={handleChange} className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-black text-xs uppercase text-blue-600 outline-none">
                 <option value="Open">Open</option><option value="Billing">Billing</option>
               </select>
             </div>
             <button onClick={onClose} className="p-3 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-2xl transition-all" aria-label="Close form"><X /></button>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="p-8 overflow-y-auto space-y-12">
          <div className="space-y-4">
            <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" /><h3 className="font-black text-xs uppercase tracking-widest">Shipment Identity</h3></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="containerNo">Container No.*</label><input id="containerNo" required name="containerNo" value={formData.containerNo} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-black focus:ring-4 focus:ring-blue-100 outline-none transition-all" /></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="shippingLine">Shipping Line</label>
                <input 
                   id="shippingLine"
                   required name="shippingLine" 
                   value={formData.shippingLine} 
                   onChange={handleChange} 
                   className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" 
                   list="lines"
                   placeholder="e.g. CN, CP, ONE"
                />
                <datalist id="lines">
                  <option value="CN Rail" />
                  <option value="CP Rail" />
                  <option value="ONE Line" />
                  <option value="MSC" />
                  <option value="Maersk" />
                </datalist>
              </div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="sizeSelect">Size</label><select id="sizeSelect" name="size" value={formData.size} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold transition-all"><option>20ft</option><option>40ft</option><option>40ft HC</option><option>45ft</option><option>Reefer</option></select></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="weightInput">Weight</label><input id="weightInput" name="weight" value={formData.weight} onChange={handleChange} className="w-full px-5 py-3 bg-slate-50 border rounded-2xl font-bold" /></div>
            </div>
          </div>
          
          <div className="space-y-4 bg-slate-50/50 p-6 rounded-[32px] border border-slate-100">
            <div className="flex items-center gap-2"><Hash className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Tracking & Reference Numbers</h3></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="poNumber">PO Number</label><input id="poNumber" name="poNumber" value={formData.poNumber} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="pickupNo">Pick up Number</label><input id="pickupNo" name="pickupNo" value={formData.pickupNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerRefNo">Customer Ref No.</label><input id="customerRefNo" name="customerRefNo" value={formData.customerRefNo} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none" /></div>
            </div>
          </div>

          <div className="space-y-4 bg-slate-50 p-6 rounded-[32px] border border-slate-100">
            <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-600" /><h3 className="font-black text-xs uppercase tracking-widest">Documentation</h3></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                 <label className="text-[10px] font-black text-slate-400 uppercase">Load Confirmation</label>
                 <div className="flex items-center gap-3">
                   <label className="cursor-pointer flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors w-full justify-center border-dashed">
                     <FileUp className="w-4 h-4 text-blue-600" />
                     <span className="text-xs font-bold text-slate-600">Upload PDF / Image</span>
                     <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileUpload(e, 'loadConfirmation')} />
                   </label>
                   {formData.loadConfirmation && <div className="p-2 bg-green-50 text-green-600 rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>}
                 </div>
                 {formData.loadConfirmation && <div className="text-[10px] font-bold text-slate-400 pl-1 truncate">{formData.loadConfirmation.name}</div>}
               </div>

               <div className="space-y-2">
                 <label className="text-[10px] font-black text-slate-400 uppercase">Signed POD</label>
                 <div className="flex items-center gap-3">
                   <label className="cursor-pointer flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors w-full justify-center border-dashed">
                     <FileUp className="w-4 h-4 text-green-600" />
                     <span className="text-xs font-bold text-slate-600">Upload Signed POD</span>
                     <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileUpload(e, 'signedPodDoc')} />
                   </label>
                   {formData.signedPodDoc && <div className="p-2 bg-green-50 text-green-600 rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>}
                 </div>
                 {formData.signedPodDoc && <div className="text-[10px] font-bold text-slate-400 pl-1 truncate">{formData.signedPodDoc.name}</div>}
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="space-y-4">
                <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-orange-600" /><h3 className="font-black text-xs uppercase tracking-widest">Appointment Schedule</h3></div>
                <div className="grid grid-cols-2 gap-4">
                   <input type="date" name="appointmentDate" value={formData.appointmentDate} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" aria-label="Appointment Date" />
                   <input type="time" name="appointmentTime" value={formData.appointmentTime} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" aria-label="Appointment Time" />
                </div>
             </div>
             <div className="space-y-4 relative">
                <div className="flex items-center gap-2"><Building className="text-blue-600 w-4 h-4" /><h3 className="font-black text-xs uppercase tracking-widest">Customer Profile</h3></div>
                <input name="customerName" value={formData.customerName} onChange={handleChange} onFocus={() => setSuggestionFocus({ type: 'cust' })} onBlur={() => setTimeout(() => setSuggestionFocus({ type: null }), 200)} className="w-full px-4 py-3 bg-slate-50 border rounded-2xl font-bold outline-none" placeholder="Search saved customers..." aria-label="Customer Name" />
                {suggestionFocus.type === 'cust' && (
                   <div className="absolute z-50 top-full left-0 w-full mt-2 bg-white border rounded-2xl shadow-2xl max-h-40 overflow-y-auto p-1">
                     {savedCustomers.filter(c => c.name.toLowerCase().includes(formData.customerName.toLowerCase())).map((c, i) => (
                       <button key={i} type="button" onClick={() => setFormData({...formData, customerName: c.name, customerEmail: c.email, customerAddress: c.address})} className="w-full text-left px-4 py-2 hover:bg-blue-50 rounded-xl text-xs font-bold border-b last:border-0">{c.name}</button>
                     ))}
                   </div>
                )}
                <div className="pt-2"><label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="customerEmail">Billing Email</label><input id="customerEmail" name="customerEmail" value={formData.customerEmail} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border rounded-xl font-bold text-sm outline-none" placeholder="email@example.com" /></div>
             </div>
          </div>
          
          <div className="bg-green-50/40 p-8 rounded-[32px] border border-green-100 space-y-6">
             <div className="flex justify-between items-center"><h3 className="font-black text-xs uppercase tracking-widest text-green-700">Customer Rate</h3><div className="text-xl font-black text-green-700 tracking-tighter">Total: ${calculateTotal(formData)}</div></div>
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <input type="number" step="0.01" name="basePrice" value={formData.basePrice} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-black text-green-700 outline-none" placeholder="Base Rate ($)" aria-label="Base Price" />
                <input type="number" step="0.01" name="waitingTime" value={formData.waitingTime} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-bold outline-none" placeholder="Wait Time ($)" aria-label="Waiting Time Cost" />
                <input type="number" step="0.01" name="fuelSurcharge" value={formData.fuelSurcharge} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-bold outline-none" placeholder="Fuel Surcharge ($)" aria-label="Fuel Surcharge" />
                <input type="number" step="0.01" name="prepull" value={formData.prepull} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-bold outline-none" placeholder="Prepull ($)" aria-label="Prepull" />
             </div>

             <div className="space-y-3 pt-4 border-t border-green-100/50">
                 <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-green-600/70 uppercase tracking-widest">Extra Charges</label>
                    <button type="button" onClick={addExtraCharge} className="text-[10px] font-bold text-green-600 hover:text-green-700 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Item
                    </button>
                 </div>
                 {formData.extraCharges.map((charge, index) => (
                     <div key={index} className="flex gap-4 items-center">
                         <input placeholder="Description (e.g. Chassis Split)" value={charge.description} onChange={(e) => updateExtraCharge(index, 'description', e.target.value)} className="flex-1 px-4 py-2 bg-white border border-green-100 rounded-xl text-xs font-bold outline-none" />
                         <input type="number" placeholder="Amount ($)" value={charge.amount} onChange={(e) => updateExtraCharge(index, 'amount', e.target.value)} className="w-32 px-4 py-2 bg-white border border-green-100 rounded-xl text-xs font-bold outline-none" />
                         <button type="button" onClick={() => removeExtraCharge(index)} className="p-2 text-red-400 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                     </div>
                 ))}
             </div>
          </div>
          
          <div className="space-y-6">
             <div className="flex justify-between items-center"><h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Trip Legs & Dispatching</h3><button type="button" onClick={() => setFormData({...formData, legs: [...formData.legs, { id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null }]})} className="text-xs font-black text-blue-600 hover:underline transition-all">+ Add Trip Leg</button></div>
             <div className="space-y-4">
                {formData.legs.map((leg, idx) => (
                   <div key={leg.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-slate-50 p-6 rounded-[24px] border border-slate-100 relative group/leg transition-all hover:bg-slate-100/50">
                      <div className="md:col-span-3 space-y-1 relative">
                          <label className="text-[9px] font-black text-slate-400" htmlFor={`pickup-${leg.id}`}>PICKUP</label>
                          <input id={`pickup-${leg.id}`} placeholder="Origin" value={leg.from} onChange={e => updateLeg(leg.id, 'from', e.target.value)} onFocus={() => setSuggestionFocus({ type: 'leg', index: idx, field: 'from' })} onBlur={() => setTimeout(() => setSuggestionFocus({ type: null }), 200)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" />
                          {suggestionFocus.type === 'leg' && suggestionFocus.index === idx && suggestionFocus.field === 'from' && (
                            <div className="absolute z-50 top-full left-0 w-full mt-1 bg-white border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                                {savedDestinations.filter(d => d.name.toLowerCase().includes(leg.from.toLowerCase())).map((d, i) => (<button key={i} type="button" onClick={() => updateLeg(leg.id, 'from', `${d.name} - ${d.address}`)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-[10px] font-bold border-b last:border-0">{d.name}</button>))}
                            </div>
                          )}
                      </div>
                      <div className="md:col-span-3 space-y-1 relative">
                          <label className="text-[9px] font-black text-slate-400" htmlFor={`dropoff-${leg.id}`}>DESTINATION</label>
                          <input id={`dropoff-${leg.id}`} placeholder="Drop-off" value={leg.to} onChange={e => updateLeg(leg.id, 'to', e.target.value)} onFocus={() => setSuggestionFocus({ type: 'leg', index: idx, field: 'to' })} onBlur={() => setTimeout(() => setSuggestionFocus({ type: null }), 200)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" />
                          {suggestionFocus.type === 'leg' && suggestionFocus.index === idx && suggestionFocus.field === 'to' && (
                            <div className="absolute z-50 top-full left-0 w-full mt-1 bg-white border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                                {savedDestinations.filter(d => d.name.toLowerCase().includes(leg.to.toLowerCase())).map((d, i) => (<button key={i} type="button" onClick={() => updateLeg(leg.id, 'to', `${d.name} - ${d.address}`)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-[10px] font-bold border-b last:border-0">{d.name}</button>))}
                            </div>
                          )}
                      </div>
                      <div className="md:col-span-3 space-y-1 relative">
                          <label className="text-[9px] font-black text-slate-400" htmlFor={`driver-${leg.id}`}>DRIVER</label>
                          <input id={`driver-${leg.id}`} value={leg.driverName} onChange={e => updateLeg(leg.id, 'driverName', e.target.value)} onFocus={() => setSuggestionFocus({ type: 'driver', index: idx })} onBlur={() => setTimeout(() => setSuggestionFocus({ type: null }), 200)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" placeholder="Select driver..." />
                          {suggestionFocus.type === 'driver' && suggestionFocus.index === idx && (
                            <div className="absolute z-50 top-full left-0 w-full mt-1 bg-white border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                                {savedDrivers.filter(d => d.name.toLowerCase().includes((leg.driverName || "").toLowerCase())).map((d, i) => (<button key={i} type="button" onClick={() => { updateLeg(leg.id, 'driverName', d.name); updateLeg(leg.id, 'truckNo', d.truckNo); }} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-[10px] font-bold border-b flex justify-between last:border-0"><span>{d.name}</span><span className="text-slate-400">Truck: {d.truckNo}</span></button>))}
                            </div>
                          )}
                      </div>
                      <div className="md:col-span-2 space-y-1">
                          <label className="text-[9px] font-black text-slate-400" htmlFor={`status-${leg.id}`}>STATUS</label>
                          <select 
                            id={`status-${leg.id}`}
                            value={leg.status} 
                            onChange={e => updateLeg(leg.id, 'status', e.target.value)} 
                            className={`w-full px-3 py-2 border rounded-xl text-[10px] font-black uppercase outline-none transition-colors ${
                              leg.status === 'Planned' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                              leg.status === 'Dispatched' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                              leg.status === 'Completed' ? 'bg-green-50 border-green-200 text-green-700' :
                              'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                             <option value="Planned">Planned</option>
                             <option value="Dispatched">Dispatched</option>
                             <option value="Completed">Completed</option>
                          </select>
                      </div>
                      <div className="md:col-span-1 flex justify-center pb-2"><button type="button" onClick={() => setFormData({...formData, legs: formData.legs.filter(l => l.id !== leg.id)})} className="text-slate-300 hover:text-red-500 transition-all" aria-label="Remove leg"><Trash2 className="w-4 h-4" /></button></div>
                   </div>
                ))}
             </div>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-purple-600" /><h3 className="font-black text-xs uppercase tracking-widest">Notes & Instructions</h3></div>
              <button 
                type="button" 
                onClick={handleSmartNotes}
                disabled={generatingNotes}
                className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-200 transition-colors"
              >
                {generatingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generatingNotes ? "Generating..." : "Generate Smart Notes ✨"}
              </button>
            </div>
            <textarea 
              name="notes" 
              value={formData.notes} 
              onChange={handleChange} 
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-sm min-h-[100px] outline-none focus:ring-2 focus:ring-purple-100 transition-all"
              placeholder="Driver instructions, handling notes, or safety warnings..."
              aria-label="Notes"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="flex-1 py-4 border-2 border-slate-100 rounded-[24px] font-black text-slate-400 uppercase tracking-widest text-xs hover:bg-slate-50 transition-all disabled:opacity-50">Discard</button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className={`flex-[2] py-4 bg-blue-600 text-white rounded-[24px] font-black shadow-xl uppercase tracking-widest text-xs active:scale-[0.98] transition-all hover:bg-blue-700 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isSubmitting ? "Saving..." : "Save Load Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const LoadTable = ({ loads, onEdit, onDelete, onStatusChange, onViewDoc, onSign, onCopy, onDownload, onTrack, companyName }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[1400px]">
        <thead>
          <tr className="bg-slate-50/50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            <th className="px-4 py-3">Container</th>
            <th className="px-4 py-3">Line</th>
            <th className="px-4 py-3">Terminal</th>
            <th className="px-4 py-3">PO #</th>
            <th className="px-4 py-3">Pick Up #</th>
            <th className="px-4 py-3">Cust Ref</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Weight</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3 min-w-[200px]">Trip Legs</th>
            <th className="px-4 py-3">Billing</th>
            <th className="px-4 py-3 text-center">Load Conf</th>
            <th className="px-4 py-3 text-center">Signed POD</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loads.map((load) => (
            <tr key={load.id} className="hover:bg-slate-50/50 transition-colors group text-xs font-bold text-slate-700">
              <td className="px-4 py-3">
                <div className="font-black text-slate-900">{load.containerNo}</div>
                 <div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-slate-400">
                  <Globe className="w-2.5 h-2.5" />
                  <span className="truncate max-w-[100px]">{load.lastTrackingStatus || "Pending"}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                 <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md uppercase whitespace-nowrap">{load.shippingLine}</span>
              </td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.legs[0]?.from}>
                {load.legs[0]?.from || <span className="text-slate-300 italic">N/A</span>}
              </td>
              <td className="px-4 py-3">{load.poNumber || '--'}</td>
              <td className="px-4 py-3">{load.pickupNo || '--'}</td>
              <td className="px-4 py-3">{load.customerRefNo || '--'}</td>
              <td className="px-4 py-3">{load.size}</td>
              <td className="px-4 py-3">{load.weight || '--'}</td>
              <td className="px-4 py-3 truncate max-w-[150px]" title={load.customerName}>{load.customerName}</td>
              <td className="px-4 py-3">
                <div className="space-y-1.5">
                  {load.legs.map((leg) => (
                    <div key={leg.id} className="flex items-center gap-2 text-[10px] bg-slate-100 px-2 py-1 rounded border border-slate-200">
                       <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${leg.status === 'Completed' ? 'bg-green-500' : leg.status === 'Dispatched' ? 'bg-blue-500' : 'bg-yellow-500'}`}></div>
                       <span className="truncate max-w-[120px]">{leg.to}</span>
                       <div className="ml-auto flex gap-1">
                          <button onClick={() => onCopy(load, leg)} className="text-slate-400 hover:text-blue-600" title="Copy Dispatch Info" aria-label="Copy dispatch info"><Copy className="w-2.5 h-2.5" /></button>
                          <button onClick={() => onDownload(load, leg)} className="text-slate-400 hover:text-green-600" title="Download POD" aria-label="Download POD"><FileDown className="w-2.5 h-2.5" /></button>
                          <button onClick={() => onSign(load.id, leg)} className="text-slate-400 hover:text-blue-600" title="Digital Signature" aria-label="Sign leg"><Pencil className="w-2.5 h-2.5" /></button>
                       </div>
                    </div>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <select value={load.status} onChange={(e) => onStatusChange(load.id, e.target.value)} className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase transition-all outline-none ${load.status === 'Open' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-green-200 bg-green-50 text-green-600'}`} aria-label="Change status">
                   <option value="Open">Open</option><option value="Billing">Billing</option>
                </select>
              </td>
              <td className="px-4 py-3 text-center">
                {load.loadConfirmation ? (
                  <button onClick={() => onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" aria-label="View load confirmation"><FileText className="w-4 h-4" /></button>
                ) : <span className="text-slate-300">-</span>}
              </td>
              <td className="px-4 py-3 text-center">
                {load.signedPodDoc ? (
                  <button onClick={() => onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors" aria-label="View signed POD"><ClipboardCheck className="w-4 h-4" /></button>
                ) : <span className="text-slate-300">-</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => onTrack(load)} className="p-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm" aria-label="Track load"><Globe className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onEdit(load)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" aria-label="Edit load"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onDelete(load.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg" aria-label="Delete load"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const BillingTable = ({ loads, onStatusChange, onDraftEmail, onEdit, onPrint, onViewDoc, companyName }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[800px]">
        <thead>
          <tr className="bg-green-50/50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <th className="px-6 py-4">Container & Identity</th>
            <th className="px-6 py-4 text-center">Docs</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4">Customer Rate</th>
            <th className="px-6 py-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loads.map((load) => (
            <tr key={load.id} className="hover:bg-slate-50/50 transition-colors group">
              <td className="px-6 py-4">
                <div className="font-bold text-slate-900 text-sm">{load.containerNo}</div>
                <div className="text-[10px] font-black text-slate-400 mt-1 uppercase">{load.customerName}</div>
              </td>
              <td className="px-6 py-4 text-center">
                <div className="flex justify-center gap-2">
                  {load.loadConfirmation && <button onClick={() => onViewDoc({...load.loadConfirmation, title: "Confirmation"})} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100" aria-label="View load confirmation"><Paperclip className="w-3.5 h-3.5" /></button>}
                  {load.signedPodDoc && <button onClick={() => onViewDoc({...load.signedPodDoc, title: "POD"})} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100" aria-label="View signed POD"><ClipboardCheck className="w-3.5 h-3.5" /></button>}
                </div>
              </td>
              <td className="px-6 py-4">
                  <select value={load.status} onChange={(e) => onStatusChange(load.id, e.target.value)} className="px-3 py-1.5 rounded-xl border border-green-200 bg-green-50 text-green-600 text-[10px] font-black uppercase transition-all" aria-label="Change billing status">
                    <option value="Billing">In Billing</option><option value="Open">Re-open Load</option>
                  </select>
              </td>
              <td className="px-6 py-4 font-black text-green-700 text-lg">${calculateTotal(load)}</td>
              <td className="px-6 py-4 text-right flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => onDraftEmail(load)} className="p-2 rounded-lg transition-colors mr-1 text-purple-600 bg-purple-50 hover:bg-purple-100" title="Draft AI Email" aria-label="Draft AI email">
                   <Sparkles className="w-4 h-4" />
                </button>
                <button onClick={() => onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors" aria-label="Edit load"><Edit3 className="w-4 h-4" /></button>
                <button onClick={() => onPrint(load)} className="p-2 text-slate-400 hover:text-green-600 rounded-lg transition-colors" aria-label="Print invoice"><Printer className="w-4 h-4" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const AddressBook = ({ 
  savedCustomers, savedDestinations, savedDrivers, 
  onDeleteCustomer, onDeleteLocation, onDeleteDriver,
  newCust, setNewCust, newLoc, setNewLoc, newDriver, setNewDriver, 
  onAddCustomer, onAddLocation, onAddDriver 
}) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in">
     <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-[400px]">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><Building className="text-blue-600 w-5 h-5" /> Customers</h3>
          <form onSubmit={onAddCustomer} className="space-y-2">
            <input required className="w-full p-2 border rounded-lg text-xs" placeholder="Name*" value={newCust.name} onChange={e => setNewCust({...newCust, name: e.target.value})} aria-label="Customer Name" />
            <input type="email" className="w-full p-2 border rounded-lg text-xs" placeholder="Email Address" value={newCust.email} onChange={e => setNewCust({...newCust, email: e.target.value})} aria-label="Customer Email" />
            <input className="w-full p-2 border rounded-lg text-xs" placeholder="Billing Address" value={newCust.address} onChange={e => setNewCust({...newCust, address: e.target.value})} aria-label="Customer Address" />
            <button type="submit" className="w-full py-2 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-colors">Save Customer</button>
          </form>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto flex-1">
           {savedCustomers.map((c) => (
             <div key={c.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100">
               <div className="flex flex-col"><span>{c.name}</span>{c.email && <span className="text-[10px] text-slate-400 font-normal">{c.email}</span>}</div>
               <button onClick={() => onDeleteCustomer(c.id)} aria-label={`Delete customer ${c.name}`}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600 transition-colors" /></button>
             </div>
           ))}
        </div>
     </div>
     <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-[400px]">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><MapPin className="text-red-600 w-5 h-5" /> Locations</h3>
          <form onSubmit={onAddLocation} className="space-y-2">
            <input required className="w-full p-2 border rounded-lg text-xs" placeholder="Name*" value={newLoc.name} onChange={e => setNewLoc({...newLoc, name: e.target.value})} aria-label="Location Name" />
            <input className="w-full p-2 border rounded-lg text-xs" placeholder="Address*" value={newLoc.address} onChange={e => setNewLoc({...newLoc, address: e.target.value})} aria-label="Location Address" />
            <button type="submit" className="w-full py-2 bg-red-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-colors">Save Location</button>
          </form>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto flex-1">
           {savedDestinations.map((d) => (
             <div key={d.id} className="flex justify-between p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100">
               <span>{d.name}</span>
               <button onClick={() => onDeleteLocation(d.id)} aria-label={`Delete location ${d.name}`}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" /></button>
             </div>
           ))}
        </div>
     </div>
     <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-[400px]">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><Truck className="text-orange-600 w-5 h-5" /> Drivers</h3>
          <form onSubmit={onAddDriver} className="space-y-2">
            <input required className="w-full p-2 border rounded-lg text-xs" placeholder="Name*" value={newDriver.name} onChange={e => setNewDriver({...newDriver, name: e.target.value})} aria-label="Driver Name" />
            <input className="w-full p-2 border rounded-lg text-xs" placeholder="Truck #*" value={newDriver.truckNo} onChange={e => setNewDriver({...newDriver, truckNo: e.target.value})} aria-label="Driver Truck Number" />
            <button type="submit" className="w-full py-2 bg-orange-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-orange-700 transition-colors">Save Driver</button>
          </form>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto flex-1">
           {savedDrivers.map((d) => (
             <div key={d.id} className="flex justify-between p-2 bg-slate-50 rounded-lg text-xs font-bold text-slate-600 border border-slate-100">
               <span>{d.name} ({d.truckNo})</span>
               <button onClick={() => onDeleteDriver(d.id)} aria-label={`Delete driver ${d.name}`}><Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" /></button>
             </div>
           ))}
        </div>
     </div>
  </div>
);

const AssignmentView = ({ loads, assignmentDate, setAssignmentDate, assignmentSlots }) => (
  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
     <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
       <div><h2 className="text-2xl font-black text-slate-900 tracking-tight">Assignment Schedule</h2><p className="text-slate-400 font-bold text-sm">Review delivery timeline date-wise</p></div>
       <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-2xl border border-slate-100 w-full sm:w-auto">
          <CalendarDays className="w-5 h-5 text-blue-600 ml-2" /><input type="date" className="bg-transparent font-black text-slate-800 outline-none w-full sm:w-auto" value={assignmentDate} onChange={(e) => setAssignmentDate(e.target.value)} aria-label="Select Date" />
       </div>
     </div>
     <div className="space-y-12 pb-20 relative">
       <div className="absolute left-[70px] top-0 bottom-0 w-px bg-slate-200 border-dashed border-l hidden md:block"></div>
       {assignmentSlots.map((slot) => (
         <div key={slot.id} className="relative z-10">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 group">
               <div className="w-full md:w-[140px] md:text-center"><span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[11px] font-black tracking-tight border border-blue-100 whitespace-nowrap">{slot.label}</span></div>
               <div className="hidden md:block flex-1 h-px bg-slate-200 border-dashed border-b"></div>
            </div>
            <div className="md:ml-[140px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {slot.items.length === 0 ? (
                 <div className="col-span-full py-4 text-slate-300 font-bold italic text-sm">No assignments scheduled for this window.</div>
               ) : slot.items.map((item) => (
                 <div key={item.id} className="bg-white border border-slate-200 p-6 rounded-[28px] shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 group">
                    <div className="flex justify-between items-start mb-4">
                       <div className="bg-blue-50 text-blue-600 p-2 rounded-xl"><Package className="w-5 h-5" /></div>
                       <div className="text-right"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Appointment</div><div className="text-sm font-black text-slate-900">{item.appointmentTime}</div></div>
                    </div>
                    <div className="mb-4">
                       <div className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">{item.containerNo}<span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{item.size}</span></div>
                       <div className="text-sm font-bold text-blue-600 mt-1">{item.customerName}</div>
                    </div>
                    <div className="space-y-3 pt-4 border-t border-slate-50">
                       <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-3.5 h-3.5 text-slate-400" /></div><span className="text-xs font-bold text-slate-500 truncate">{item.legs[0]?.to.split(' - ')[0] || "No Location Assigned"}</span></div>
                       <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><Truck className="w-3.5 h-3.5 text-slate-400" /></div><span className="text-xs font-bold text-slate-800">{item.legs[0]?.driverName || "Driver TBD"}</span></div>
                    </div>
                 </div>
               ))}
            </div>
         </div>
       ))}
     </div>
  </div>
);

// ==========================================
// MAIN APP COMPONENT
// ==========================================

const App = () => {
  const [user, setUser] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyName, setCompanyName] = useState("Haulix");
  const [loads, setLoads] = useState([]);
  const [savedCustomers, setSavedCustomers] = useState([]);
  const [savedDestinations, setSavedDestinations] = useState([]);
  const [savedDrivers, setSavedDrivers] = useState([]);
  const [newCust, setNewCust] = useState({ name: '', email: '', address: '' });
  const [newLoc, setNewLoc] = useState({ name: '', address: '' });
  const [newDriver, setNewDriver] = useState({ name: '', truckNo: '' });
  const [activeTab, setActiveTab] = useState('billing');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [copyFeedback, setCopyFeedback] = useFeedback();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignmentDate, setAssignmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [draftEmail, setDraftEmail] = useState({ isOpen: false, content: "", isLoading: false, load: null });
  const [signingContext, setSigningContext] = useState(null); 
  const [viewingDoc, setViewingDoc] = useState(null); 
  const [trackingLoad, setTrackingLoad] = useState(null);
  const apiKey = "";

useEffect(() => {
  const initAuth = async () => {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("Anonymous sign-in failed:", error);
    }
  };

  initAuth();

  const unsubscribe = onAuthStateChanged(auth, (u) => {
    setUser(u);
    if (u) {
      setCompanyId(u.uid);
    }
  });

  return () => unsubscribe();
}, []);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'loads');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLoads(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching loads:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'customers');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedCustomers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching customers:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'locations');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedDestinations(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching locations:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'drivers');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedDrivers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching drivers:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  const handleDraftEmail = useCallback(async (load) => {
    setDraftEmail({ isOpen: true, content: "", isLoading: true, load: load });
    
    const prompt = `Write a polite and professional billing email for the following invoice:
    - Customer: ${load.customerName}
    - Invoice Amount: $${calculateTotal(load)}
    - Container Number: ${load.containerNo}
    - PO Number: ${load.poNumber || 'N/A'}
    
    The email should be concise, thank them for their business, and request confirmation of receipt. Use placeholders like [Your Name] for the sender.`;

    try {
      const content = await generateGeminiContent(prompt, apiKey);
      setDraftEmail(prev => ({ ...prev, content: content, isLoading: false }));
    } catch (error) {
      setDraftEmail(prev => ({ ...prev, content: "Error generating email. Please write it manually.", isLoading: false }));
    }
  }, [apiKey]);

  const handleSendEmail = useCallback(async (finalContent) => {
    const load = draftEmail.load;
    
    if (!load || !load.customerEmail) {
       setCopyFeedback("Error: No customer email found");
       return;
    }

    try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setDraftEmail(prev => ({ ...prev, isOpen: false }));
        setCopyFeedback("Email Sent (Simulated)!");
    } catch (error) {
        console.error("Email simulation error:", error);
        setCopyFeedback("Failed to send email");
    }
  }, [draftEmail.load, setCopyFeedback, appId]);

  const handleUpdateStatus = useCallback(async (loadId, status) => {
    if (!user || !companyId) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'loads', loadId), { lastTrackingStatus: status });
    } catch (error) {
       console.error("Error updating tracking status:", error);
    }
  }, [user, companyId, appId]);

  const handleAddCustomer = useCallback(async (e) => { 
    e.preventDefault(); 
    if (!newCust.name.trim() || !user || !companyId) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'customers'), { ...newCust });
      setNewCust({ name: '', email: '', address: '' }); 
      setCopyFeedback("Customer Saved to Cloud"); 
    } catch (error) {
      console.error("Error adding customer:", error);
      setCopyFeedback("Failed to save customer");
    }
  }, [user, companyId, newCust, setCopyFeedback, appId]);
  
  const handleAddLocation = useCallback(async (e) => { 
    e.preventDefault(); 
    if (!newLoc.name.trim() || !user || !companyId) return; 
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'locations'), { ...newLoc });
      setNewLoc({ name: '', address: '' }); 
      setCopyFeedback("Location Saved to Cloud"); 
    } catch (error) {
      console.error("Error adding location:", error);
      setCopyFeedback("Failed to save location");
    }
  }, [user, companyId, newLoc, setCopyFeedback, appId]);
  
  const handleAddDriver = useCallback(async (e) => { 
    e.preventDefault(); 
    if (!newDriver.name.trim() || !user || !companyId) return; 
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'drivers'), { ...newDriver });
      setNewDriver({ name: '', truckNo: '' }); 
      setCopyFeedback("Driver Saved to Cloud"); 
    } catch (error) {
      console.error("Error adding driver:", error);
      setCopyFeedback("Failed to save driver");
    }
  }, [user, companyId, newDriver, setCopyFeedback, appId]);

  const handleDeleteCustomer = useCallback(async (id) => {
      if(!user || !companyId) return;
      if (!window.confirm('Are you sure you want to delete this customer?')) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'customers', id));
        setCopyFeedback("Customer deleted");
      } catch (error) {
        console.error("Error deleting customer:", error);
        setCopyFeedback("Failed to delete customer");
      }
  }, [user, companyId, setCopyFeedback, appId]);

  const handleDeleteLocation = useCallback(async (id) => {
      if(!user || !companyId) return;
      if (!window.confirm('Are you sure you want to delete this location?')) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'locations', id));
        setCopyFeedback("Location deleted");
      } catch (error) {
        console.error("Error deleting location:", error);
        setCopyFeedback("Failed to delete location");
      }
  }, [user, companyId, setCopyFeedback, appId]);

  const handleDeleteDriver = useCallback(async (id) => {
      if(!user || !companyId) return;
      if (!window.confirm('Are you sure you want to delete this driver?')) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'drivers', id));
        setCopyFeedback("Driver deleted");
      } catch (error) {
        console.error("Error deleting driver:", error);
        setCopyFeedback("Failed to delete driver");
      }
  }, [user, companyId, setCopyFeedback, appId]);
  
  const quickUpdateStatus = useCallback(async (loadId, newStatus) => { 
    if (!user || !companyId) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'loads', loadId), { status: newStatus });
      setCopyFeedback(`Moved to ${newStatus}`); 
    } catch (error) {
       console.error("Error updating status:", error);
       setCopyFeedback("Failed to update status");
    }
  }, [user, companyId, setCopyFeedback, appId]);
  
  const handleSubmitLoad = useCallback(async (formData) => {
    if (!user || !companyId || isSubmitting) return;
    
    setIsSubmitting(true);
    const loadData = { ...formData, dateAdded: new Date().toISOString() };
    
    try {
      if (editingId) {
         await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'loads', editingId), loadData);
         setCopyFeedback("Load Updated");
      } else {
         await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'loads'), loadData);
         setCopyFeedback("Load Created");
      }
      setIsFormOpen(false); setEditingId(null);
    } catch (error) {
      console.error("Error saving load:", error);
      setCopyFeedback("Failed to save load");
    } finally {
      setIsSubmitting(false);
    }
  }, [user, companyId, editingId, setCopyFeedback, appId, isSubmitting]);
  
  const handleEdit = useCallback((load) => { 
    setEditingId(load.id); 
    setIsFormOpen(true); 
  }, []);

  const handleDelete = useCallback(async (id) => {
    if (!user || !companyId) return;
    if (!window.confirm('Are you sure you want to delete this load?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'loads', id));
      setCopyFeedback("Load deleted successfully");
    } catch (error) {
      console.error('Delete error:', error);
      setCopyFeedback("Failed to delete load");
    }
  }, [user, companyId, setCopyFeedback, appId]);

  const handleSignLeg = useCallback(async (signatureData) => {
    if (!user || !signingContext || !companyId) return;
    const { loadId, legId, arrivalTime, departureTime, receiverName } = signingContext;
    const currentLoad = loads.find(l => l.id === loadId);
    if (!currentLoad) return;

    const updatedLegs = currentLoad.legs.map(lg => 
      lg.id === legId ? {
        ...lg, 
        status: 'Completed', 
        arrivalTime, 
        departureTime, 
        receiverName, 
        signature: signatureData
      } : lg
    );
    
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'loads', loadId), { legs: updatedLegs });
      setSigningContext(null); 
      setCopyFeedback("Leg Signed & Synced!");
    } catch (error) {
      console.error("Error signing leg:", error);
      setCopyFeedback("Failed to save signature");
    }
  }, [user, companyId, signingContext, loads, setCopyFeedback, appId]);
  
  const handleCopy = useCallback((load, leg) => {
    copyDispatch(load, leg, setCopyFeedback);
  }, [setCopyFeedback]);

  const handleDownload = useCallback((load, leg) => {
    downloadPOD(load, leg, setCopyFeedback, companyName);
  }, [setCopyFeedback, companyName]);

  const handlePrint = useCallback((load) => {
    downloadInvoice(load, setCopyFeedback, companyName);
  }, [setCopyFeedback, companyName]);

  const handleSign = useCallback((loadId, leg) => {
    setSigningContext({ 
      loadId, 
      legId: leg.id, 
      arrivalTime: leg.arrivalTime || '', 
      departureTime: leg.departureTime || '', 
      receiverName: leg.receiverName || '' 
    });
  }, []);

  const handleTrack = useCallback((load) => {
    setTrackingLoad(load);
  }, []);

  const debouncedSearch = useMemo(() => debounce(setSearchTerm, 300), []);

  const filteredLoads = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return loads.filter(load => {
      const matchesSearch = 
        load.containerNo.toLowerCase().includes(term) || 
        (load.customerName && load.customerName.toLowerCase().includes(term)) || 
        (load.poNumber && load.poNumber.toLowerCase().includes(term)) || 
        (load.pickupNo && load.pickupNo.toLowerCase().includes(term));
      if (!matchesSearch) return false;
      if (activeTab === 'loads') return load.status === 'Open';
      if (activeTab === 'billing') return load.status === 'Billing';
      return true;
    });
  }, [loads, searchTerm, activeTab]);

  const assignmentSlots = useMemo(() => {
    const slots = [ 
      { id: 'early', label: '00:00 — 07:59', range: [0, 7] }, 
      { id: 'morning', label: '08:00 — 09:59', range: [8, 9] }, 
      { id: 'midday', label: '10:00 — 12:59', range: [10, 12] }, 
      { id: 'afternoon', label: '13:00 — 15:59', range: [13, 15] }, 
      { id: 'late', label: '16:00 — 23:59', range: [16, 23] } 
    ];
    const dayLoads = loads.filter(l => l.appointmentDate === assignmentDate && l.status === 'Open');
    return slots.map(slot => ({ 
      ...slot, 
      items: dayLoads.filter(l => { 
        const hour = parseInt(l.appointmentTime?.split(':')[0] || '0'); 
        return hour >= slot.range[0] && hour <= slot.range[1]; 
      }) 
    }));
  }, [loads, assignmentDate]);

  const loadToEdit = editingId ? loads.find(l => l.id === editingId) : null;

  return (
    <>
    <GlobalStyles />
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {copyFeedback && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${copyFeedback.includes('Error') || copyFeedback.includes('Failed') ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>
          {copyFeedback.includes('Error') || copyFeedback.includes('Failed') ? <AlertTriangle className="w-5 h-5 text-white" /> : <Check className="w-5 h-5 text-green-400" />}
          <span className="font-bold text-sm">{copyFeedback}</span>
        </div>
      )}
      
      {viewingDoc && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setViewingDoc(null)}></div>
          <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3"><FileText className="w-5 h-5 text-blue-600" /><h2 className="font-black text-slate-900">{viewingDoc.title}</h2></div>
              <button onClick={() => setViewingDoc(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors" aria-label="Close document"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-2 bg-slate-100 flex-1 min-h-[500px] overflow-auto flex items-center justify-center">
              {viewingDoc.type.startsWith('image/') ? (
                <img src={viewingDoc.data} className="max-w-full shadow-lg rounded" alt="preview" />
              ) : (
                <div className="bg-white p-12 rounded-2xl text-center">
                  <FileText className="w-16 h-16 text-blue-500 mx-auto mb-4" />
                  <p className="font-bold text-slate-700 mb-6">{viewingDoc.name}</p>
                  <a href={viewingDoc.data} download={viewingDoc.name} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold transition-all hover:bg-blue-700">Download to View</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {trackingLoad && (
        <TrackingModal 
          load={trackingLoad} 
          onClose={() => setTrackingLoad(null)} 
          onUpdateStatus={handleUpdateStatus}
        />
      )}
      
      <DraftEmailModal 
        isOpen={draftEmail.isOpen}
        onClose={() => setDraftEmail({ ...draftEmail, isOpen: false })}
        content={draftEmail.content}
        isLoading={draftEmail.isLoading}
        onSend={handleSendEmail}
      />

      {signingContext && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setSigningContext(null)}></div>
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="font-black text-slate-900">Sign Delivery Leg</h2>
              <button onClick={() => setSigningContext(null)} className="p-2 hover:bg-slate-200 rounded-lg" aria-label="Close signing modal"><X /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="arrival-time">Arrival</label>
                  <input id="arrival-time" type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.arrivalTime} onChange={(e) => setSigningContext({...signingContext, arrivalTime: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="departure-time">Departure</label>
                  <input id="departure-time" type="time" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={signingContext.departureTime} onChange={(e) => setSigningContext({...signingContext, departureTime: e.target.value})} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase" htmlFor="receiver-name">Receiver Name</label>
                <input id="receiver-name" type="text" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold placeholder:font-normal" placeholder="Who is receiving this?" value={signingContext.receiverName} onChange={(e) => setSigningContext({...signingContext, receiverName: e.target.value})} />
              </div>
              <SignaturePad onSave={handleSignLeg} onCancel={() => setSigningContext(null)} />
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-2 rounded-lg"><Package className="text-white w-6 h-6" /></div>
              <div>
                <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-none">{companyName}</h1>
                <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wider mt-0.5 hidden sm:block">Powering the Next Generation of Carriers</p>
              </div>
            </div>
            <nav className="hidden md:flex gap-1 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setActiveTab('loads')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'loads' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Operations</button>
              <button onClick={() => setActiveTab('addressBook')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'addressBook' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Database</button>
              <button onClick={() => setActiveTab('billing')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'billing' ? 'bg-white shadow-sm text-green-600' : 'text-slate-500 hover:text-slate-700'}`}>Billing</button>
              <button onClick={() => setActiveTab('assignment')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'assignment' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Assignment</button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
             {user ? (
               <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-200">
                  <Wifi className="w-3 h-3" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Connected</span>
               </div>
             ) : (
               <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 rounded-full border border-red-200">
                  <Wifi className="w-3 h-3" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Offline</span>
               </div>
             )}
             <button onClick={() => { setEditingId(null); setIsFormOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-bold shadow-lg transition-transform active:scale-95 hover:bg-blue-700"><Plus className="w-5 h-5" /> <span className="hidden sm:inline">New Load</span></button>
          </div>
        </div>
        <div className="md:hidden flex overflow-x-auto gap-2 p-2 bg-white border-t border-slate-100 no-scrollbar">
            <button onClick={() => setActiveTab('loads')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'loads' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Operations</button>
            <button onClick={() => setActiveTab('addressBook')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'addressBook' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Database</button>
            <button onClick={() => setActiveTab('billing')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'billing' ? 'bg-slate-100 text-green-600' : 'text-slate-500'}`}>Billing</button>
            <button onClick={() => setActiveTab('assignment')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'assignment' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Assignment</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(activeTab === 'loads' || activeTab === 'billing') && (
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input 
                type="text" 
                placeholder="Search PO#, Container#, or Customer..." 
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                defaultValue=""
                onChange={(e) => debouncedSearch(e.target.value)} 
                aria-label="Search loads" 
              />
            </div>
          </div>
        )}
        
        {activeTab === 'loads' && (
          <LoadTable 
            loads={filteredLoads} 
            onEdit={handleEdit} 
            onDelete={handleDelete} 
            onStatusChange={quickUpdateStatus} 
            onViewDoc={setViewingDoc} 
            onSign={handleSign}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onTrack={handleTrack}
            companyName={companyName}
          />
        )}
        
        {activeTab === 'billing' && (
          <BillingTable 
            loads={filteredLoads} 
            onStatusChange={quickUpdateStatus} 
            onDraftEmail={handleDraftEmail} 
            onEdit={handleEdit} 
            onPrint={handlePrint}
            onViewDoc={setViewingDoc} 
            companyName={companyName}
          />
        )}
        
        {activeTab === 'addressBook' && (
          <AddressBook 
            savedCustomers={savedCustomers} 
            savedDestinations={savedDestinations} 
            savedDrivers={savedDrivers} 
            onDeleteCustomer={handleDeleteCustomer}
            onDeleteLocation={handleDeleteLocation}
            onDeleteDriver={handleDeleteDriver}
            newCust={newCust} 
            setNewCust={setNewCust} 
            newLoc={newLoc} 
            setNewLoc={setNewLoc} 
            newDriver={newDriver} 
            setNewDriver={setNewDriver} 
            onAddCustomer={handleAddCustomer} 
            onAddLocation={handleAddLocation} 
            onAddDriver={handleAddDriver} 
          />
        )}
        
        {activeTab === 'assignment' && (
          <AssignmentView 
            loads={loads} 
            assignmentDate={assignmentDate} 
            setAssignmentDate={setAssignmentDate} 
            assignmentSlots={assignmentSlots} 
          />
        )}
      </main>
      
      <LoadForm 
        isOpen={isFormOpen} 
        onClose={() => { setIsFormOpen(false); setEditingId(null); }} 
        onSubmit={handleSubmitLoad} 
        isSubmitting={isSubmitting}
        initialData={loadToEdit} 
        savedCustomers={savedCustomers} 
        savedDestinations={savedDestinations} 
        savedDrivers={savedDrivers} 
        apiKey={apiKey} 
      />
    </div>
    </>
  );
};

export default App;