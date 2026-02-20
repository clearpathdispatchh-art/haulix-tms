import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ICONS (restore this — fixes "Package not defined")
import {
  Plus, Search, Trash2, Package, User, Scale, Maximize, Navigation, Hash,
  FileText, Filter, Download, Edit3, X, MapPin, Building, ChevronDown,
  CheckCircle2, Mail, ArrowRight, Route, Truck, Copy, Check, UserPlus,
  FileDown, DollarSign, Calculator, Receipt, Printer, FileCheck, Anchor,
  Clock, Calendar, ArrowUpRight, Pencil, Eye, RotateCcw, FileUp, Paperclip,
  ClipboardCheck, BadgeInfo, Layers, ArrowRightLeft, CalendarDays, Send, Loader2, AlertTriangle,
  Globe, Train, Ship, ExternalLink, RefreshCw, Sparkles, MessageSquare, Cloud, Wifi, Briefcase,
  TrendingUp, BarChart3, Activity, Wallet, AlertCircle, History, Archive
} from "lucide-react";

// Firebase services from our config file
import app, { storage } from "./firebase";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getAuth, signOut, onAuthStateChanged, signInAnonymously } from "firebase/auth";

import {
  initializeFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  setDoc,
  getDoc
} from "firebase/firestore";

import { getFunctions, httpsCallable } from "firebase/functions";


// 🔹 Auth
const auth = getAuth(app);

// 🔹 Firestore (fixed initialization for network/browser issues)
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

// 🔹 Functions
const functions = getFunctions(app, "us-central1");

// 🔹 App ID
const appId = "haulix-tms-default";

export { auth, db, storage, functions, appId };

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

const calculateTotal = (load) => {
  return (parseFloat(load.basePrice || 0) + parseFloat(load.waitingTime || 0) + parseFloat(load.fuelSurcharge || 0)).toFixed(2);
};

const calculateCost = (load) => {
  const legCost = (load.legs || []).reduce((sum, leg) => {
    return sum +
      parseFloat(leg.driverPay || 0) +
      parseFloat(leg.fuelCost || 0) +
      parseFloat(leg.detentionPay || 0);
  }, 0);

  const manualCosts =
    parseFloat(load.driverCost || 0) +
    parseFloat(load.fuelCost || 0) +
    parseFloat(load.brokerRate || 0);

  return (legCost + manualCosts).toFixed(2);
};

const calculateProfit = (load) => {
  return (parseFloat(calculateTotal(load)) - parseFloat(calculateCost(load))).toFixed(2);
};

const copyToClipboard = async (text) => {
  let success = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch (err) {
      console.warn("Clipboard API failed, trying fallback...", err);
    }
  }

  if (!success) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "0";
      textArea.style.top = "0";
      textArea.style.opacity = "0";
      textArea.style.pointerEvents = "none";
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      success = document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) {
      console.error("Fallback copy failed:", err);
      success = false;
    }
  }
  
  return success;
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
          .company-info h1 { font-size: 24px; font-weight: 900; margin: 0 0 5px 0; color: #2563eb; }
          .company-info p { margin: 0; color: #64748b; }
          .wo-details { text-align: right; }
          .wo-title { font-size: 32px; font-weight: 900; color: #e2e8f0; letter-spacing: -1px; line-height: 1; }
          .wo-grid { display: grid; grid-template-columns: auto auto; gap: 8px 20px; margin-top: 10px; text-align: right; }
          .label { font-weight: 700; color: #94a3b8; text-transform: uppercase; font-size: 10px; }
          .value { font-weight: 700; color: #0f172a; }
          .section-title { background: #f1f5f9; padding: 8px 12px; font-weight: 900; font-size: 14px; color: #334155; margin-bottom: 15px; border-left: 4px solid #2563eb; display: flex; justify-content: space-between; }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
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
          .footer { text-align: center; margin-top: 50px; font-size: 10px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>${companyName || 'Haulix'}</h1>
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
          Generated by ${companyName || 'Haulix'} • ${new Date().toLocaleString()}
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
  // Safe helpers for values
  const freightAmount = parseFloat(load.basePrice) || 0;
  const fuelAmount = parseFloat(load.fuelSurcharge) || 0;
  const waitingAmount = parseFloat(load.waitingTime) || 0;
  
  // Safe helper for description
  const getFreightDesc = () => {
    if (load.legs && load.legs.length > 0) {
      const origin = load.legs[0].from || 'Origin';
      const dest = load.legs[load.legs.length - 1].to || 'Destination';
      return `${origin} to ${dest}`;
    }
    return 'Transport Services';
  };

  // Build rows individually to avoid complex nesting
  let rowsHtml = '';
  
  if (freightAmount > 0) {
    rowsHtml += `
      <tr>
        <td>
          <strong>Freight Charge</strong>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
            ${getFreightDesc()}
          </div>
        </td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$${freightAmount.toFixed(2)}</td>
        <td class="amount">$${freightAmount.toFixed(2)}</td>
      </tr>`;
  }

  if (fuelAmount > 0) {
    rowsHtml += `
      <tr>
        <td><strong>Fuel Surcharge</strong></td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$${fuelAmount.toFixed(2)}</td>
        <td class="amount">$${fuelAmount.toFixed(2)}</td>
      </tr>`;
  }

  if (waitingAmount > 0) {
    rowsHtml += `
      <tr>
        <td><strong>Waiting Time / Detention</strong></td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$${waitingAmount.toFixed(2)}</td>
        <td class="amount">$${waitingAmount.toFixed(2)}</td>
      </tr>`;
  }

  const invoiceHtml = `
    <html>
      <head>
        <title>Invoice - ${load.containerNo}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
          body { font-family: 'Inter', sans-serif; color: #1e293b; line-height: 1.5; padding: 0; margin: 0; background: #fff; }
          .invoice-container { max-width: 800px; margin: 0 auto; padding: 40px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
          .logo-area h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -1px; }
          .logo-area p { color: #64748b; font-size: 12px; margin: 5px 0 0; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { font-size: 32px; font-weight: 800; color: #e2e8f0; margin: 0 0 10px; letter-spacing: -1px; text-transform: uppercase; }
          .meta-grid { display: grid; grid-template-columns: auto auto; gap: 4px 20px; text-align: right; }
          .meta-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; }
          .meta-value { font-size: 13px; font-weight: 600; color: #0f172a; }
          .addresses { display: flex; justify-content: space-between; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 1px solid #f1f5f9; }
          .addr-col { width: 48%; }
          .addr-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; display: block; }
          .addr-name { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
          .addr-text { font-size: 13px; color: #64748b; margin: 0; }
          .shipment-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 40px; }
          .shipment-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
          .sg-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
          .sg-value { font-size: 13px; font-weight: 700; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { text-align: left; padding: 12px 0; border-bottom: 2px solid #0f172a; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; }
          td { padding: 16px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; }
          td.amount { text-align: right; font-weight: 600; color: #0f172a; }
          th.amount { text-align: right; }
          .totals-section { display: flex; justify-content: flex-end; margin-bottom: 40px; }
          .totals-box { width: 250px; }
          .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; color: #64748b; }
          .total-row.final { font-size: 16px; font-weight: 800; color: #0f172a; border-top: 2px solid #0f172a; margin-top: 10px; padding-top: 15px; }
          .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 60px; padding-top: 20px; border-top: 1px dashed #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header">
            <div class="logo-area">
              <h1>${companyName || 'Haulix'}</h1>
              <p>123 Logistics Way, Transport City, TC 90210<br>dispatch@haulix.com | (555) 123-4567</p>
            </div>
            <div class="invoice-meta">
              <h2>INVOICE</h2>
              <div class="meta-grid">
                <div class="meta-label">Invoice #</div><div class="meta-value">${load.id.slice(0, 8).toUpperCase()}</div>
                <div class="meta-label">Date</div><div class="meta-value">${new Date().toLocaleDateString()}</div>
                <div class="meta-label">PO #</div><div class="meta-value">${load.poNumber || 'N/A'}</div>
              </div>
            </div>
          </div>

          <div class="addresses">
            <div class="addr-col">
              <span class="addr-label">Bill To</span>
              <div class="addr-name">${load.customerName}</div>
              <p class="addr-text">${load.customerAddress || 'Address on file'}</p>
              <p class="addr-text">${load.customerEmail || ''}</p>
            </div>
            <div class="addr-col">
              <span class="addr-label">Service For</span>
              <div class="addr-name">Logistics Services</div>
              <p class="addr-text">Reference: ${load.customerRefNo || 'N/A'}</p>
              <p class="addr-text">Term: Due on Receipt</p>
            </div>
          </div>

          <div class="shipment-box">
            <div class="shipment-grid">
              <div><div class="sg-label">Container</div><div class="sg-value">${load.containerNo}</div></div>
              <div><div class="sg-label">Type/Size</div><div class="sg-value">${load.size}</div></div>
              <div><div class="sg-label">Weight</div><div class="sg-value">${load.weight || '-'}</div></div>
              <div><div class="sg-label">Pickup #</div><div class="sg-value">${load.pickupNo || '-'}</div></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 50%">Description</th>
                <th style="width: 15%; text-align: center;">Qty</th>
                <th style="width: 15%; text-align: right;">Rate</th>
                <th style="width: 20%" class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="totals-section">
            <div class="totals-box">
              <div class="total-row">
                <span>Subtotal</span>
                <span>$${calculateTotal(load)}</span>
              </div>
              <div class="total-row">
                <span>Tax (0%)</span>
                <span>$0.00</span>
              </div>
              <div class="total-row final">
                <span>Total Due</span>
                <span>$${calculateTotal(load)}</span>
              </div>
            </div>
          </div>

          <div class="footer">
            <p>Thank you for your business. Please make checks payable to ${companyName || 'Haulix'}.<br>
            For questions regarding this invoice, please contact dispatch@haulix.com</p>
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

const downloadDailyReportCSV = (loads, companyName) => {
  const today = new Date().toISOString().split('T')[0];
  const todayLoads = loads.filter(l => l.appointmentDate === today);

  const headers = [
    "Container No", "Customer", "Shipping Line", "Size", "Weight",
    "PO Number", "Pickup No", "Origin", "Destination",
    "Driver(s)", "Truck(s)", "Appointment Time", "Status", "Total Revenue", "Driver Cost", "Fuel Cost", "Broker Rate", "Net Profit"
  ];

  const rows = todayLoads.map(load => {
    const origin = load.legs?.[0]?.from || 'N/A';
    const dest = load.legs?.[load.legs.length - 1]?.to || 'N/A';
    const drivers = [...new Set(load.legs?.map(l => l.driverName).filter(Boolean))].join(' / ') || 'TBD';
    const trucks = [...new Set(load.legs?.map(l => l.truckNo).filter(Boolean))].join(' / ') || 'TBD';
    const rate = calculateTotal(load);
    const cost = calculateCost(load);
    const profit = calculateProfit(load);

    const rowData = [
      `"${load.containerNo || ''}"`,
      `"${load.customerName || ''}"`,
      `"${load.shippingLine || ''}"`,
      `"${load.size || ''}"`,
      `"${load.weight || ''}"`,
      `"${load.poNumber || ''}"`,
      `"${load.pickupNo || ''}"`,
      `"${origin}"`,
      `"${dest}"`,
      `"${drivers}"`,
      `"${trucks}"`,
      `"${load.appointmentTime || ''}"`,
      `"${load.status || ''}"`,
      `"$${rate}"`,
      `"$${cost}"`,
      `"$${profit}"`
    ];
    
    return rowData.join(',');
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

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-2">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-xl font-black text-slate-900">{title}</h3>
          <p className="text-sm font-medium text-slate-500 leading-relaxed">{message}</p>
        </div>
        <div className="flex border-t border-slate-100">
          <button
            onClick={onClose}
            className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <div className="w-px bg-slate-100"></div>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const DraftEmailModal = ({ isOpen, onClose, content, onSend }) => {
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
            <div className="bg-purple-100 p-2 rounded-lg"><Mail className="w-5 h-5 text-purple-600" /></div>
            Compose Invoice Email
          </h3>
          <button onClick={onClose} aria-label="Close modal"><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
        </div>
        <textarea
            className="w-full h-64 p-4 border border-slate-200 rounded-xl text-sm leading-relaxed outline-blue-500 bg-slate-50 font-medium text-slate-700 resize-none"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
        />
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
  );
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

const LoadForm = ({ isOpen, onClose, onSubmit, initialData, savedCustomers, savedDestinations, savedDrivers, apiKey }) => {
  const [formData, setFormData] = useState({
    status: "Open",
    containerNo: "", shippingLine: "", poNumber: "", pickupNo: "", customerRefNo: "",
    size: "40ft", weight: "", customerName: "", customerEmail: "", customerAddress: "",
    appointmentDate: "", appointmentTime: "", loadConfirmation: null, signedPodDoc: null,
    basePrice: "", waitingTime: "", fuelSurcharge: "",
    driverCost: "", fuelCost: "", brokerRate: "",
    legs: [{ id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null, driverPay: "", fuelCost: "", detentionPay: "" }],
    notes: "",
    lastTrackingStatus: "Pending"
  });
  const [suggestionFocus, setSuggestionFocus] = useState({ type: null, index: null, field: null });
  const [generatingNotes, setGeneratingNotes] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) setFormData({
         ...initialData,
         driverCost: initialData.driverCost || "",
         fuelCost: initialData.fuelCost || "",
         brokerRate: initialData.brokerRate || "",
      });
      else setFormData({
        status: "Open",
        containerNo: "", shippingLine: "", poNumber: "", pickupNo: "", customerRefNo: "",
        size: "40ft", weight: "", customerName: "", customerEmail: "", customerAddress: "",
        appointmentDate: "", appointmentTime: "", loadConfirmation: null, signedPodDoc: null,
        basePrice: "", waitingTime: "", fuelSurcharge: "",
        driverCost: "", fuelCost: "", brokerRate: "",
        legs: [{ id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null, driverPay: "", fuelCost: "", detentionPay: "" }],
        notes: "",
        lastTrackingStatus: "Pending"
      });
    }
  }, [isOpen, initialData]);

  const handleSmartNotes = () => {
    setGeneratingNotes(true);
    setTimeout(() => {
      const origin = formData.legs[0]?.from || '[Origin Not Set]';
      const dest = formData.legs[formData.legs.length - 1]?.to || '[Destination Not Set]';
      const carrier = formData.shippingLine || '[Carrier Not Set]';
      const size = formData.size || 'Container';
      const weight = formData.weight ? ` at ${formData.weight}` : '';

      let autoNotes = `=== DISPATCH & HANDLING INSTRUCTIONS ===\n\n`;
      autoNotes += `ROUTE SUMMARY:\n- From: ${origin}\n- To: ${dest}\n- Carrier: ${carrier}\n\n`;
      autoNotes += `EQUIPMENT DETAILS:\n- Size/Type: ${size}${weight}\n`;

      if (size.includes('Reefer')) {
        autoNotes += `- Handling: ACTIVE REEFER. Driver must verify temperature settings and fuel levels prior to departure.\n`;
      } else if (size.includes('HC') || size.includes('45ft')) {
        autoNotes += `- Handling: HIGH CUBE / OVERSIZED. Driver must verify bridge and route clearances.\n`;
      } else {
        autoNotes += `- Handling: Standard dry freight transport rules apply.\n`;
      }

      autoNotes += `\nSAFETY & COMPLIANCE:\n`;
      autoNotes += `- Weather/Traffic: Please monitor conditions along the route.\n`;
      autoNotes += `- Documentation: ALL stops require a signed POD with clear arrival/departure times.\n`;

      setFormData(prev => ({ ...prev, notes: autoNotes }));
      setGeneratingNotes(false);
    }, 600);
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
  
  const handleFileUpload = async (e, field) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const filePath = `loads/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, filePath);

    // upload to firebase
    await uploadBytes(storageRef, file);

    // get public URL
    const url = await getDownloadURL(storageRef);

    // save URL + name
    setFormData(prev => ({
      ...prev,
      [field]: {
        name: file.name,
        type: file.type,
        url: url   // 👈 THIS IS WHAT EMAIL NEEDS
      }
    }));

  } catch (err) {
    console.error("Upload failed:", err);
  }
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
          
          <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 space-y-8">
             <div className="flex justify-between items-center border-b border-slate-200 pb-4">
               <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-slate-800"><Wallet className="w-5 h-5 text-green-600"/> Financials (Rate & Cost)</h3>
               <div className="text-right flex items-center gap-6">
                 <div>
                   <div className="text-[10px] font-bold text-slate-400 uppercase">Total Revenue</div>
                   <div className="text-sm font-black text-slate-800">${calculateTotal(formData)}</div>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-slate-400 uppercase">Total Cost</div>
                   <div className="text-sm font-black text-red-500">${calculateCost(formData)}</div>
                 </div>
                 <div className="bg-green-100 px-4 py-2 rounded-xl">
                   <div className="text-[10px] font-black text-green-600 uppercase">Net Profit</div>
                   <div className="text-xl font-black text-green-700 tracking-tighter">${calculateProfit(formData)}</div>
                 </div>
               </div>
             </div>
             
             <div className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">1. Revenue Breakdown (Charged to Customer)</label>
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <input type="number" step="0.01" name="basePrice" value={formData.basePrice} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-black text-green-700 outline-none" placeholder="Base Rate ($)" aria-label="Base Price" />
                      <input type="number" step="0.01" name="waitingTime" value={formData.waitingTime} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-bold outline-none" placeholder="Wait Time ($)" aria-label="Waiting Time Cost" />
                      <input type="number" step="0.01" name="fuelSurcharge" value={formData.fuelSurcharge} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-green-200 rounded-2xl font-bold outline-none" placeholder="Fuel Surcharge ($)" aria-label="Fuel Surcharge" />
                   </div>
                 </div>

                 <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">2. Cost Breakdown (Expenses)</label>
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <input type="number" step="0.01" name="driverCost" value={formData.driverCost} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-red-200 rounded-2xl font-black text-red-700 outline-none" placeholder="Driver Pay / Cost ($)" aria-label="Driver Cost" />
                      <input type="number" step="0.01" name="fuelCost" value={formData.fuelCost} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-red-200 rounded-2xl font-bold outline-none" placeholder="Fuel Deduction / Cost ($)" aria-label="Fuel Cost" />
                      <input type="number" step="0.01" name="brokerRate" value={formData.brokerRate} onChange={handleChange} className="w-full px-5 py-3 bg-white border border-red-200 rounded-2xl font-bold outline-none" placeholder="Broker / Other Deductions ($)" aria-label="Broker Rate" />
                   </div>
                 </div>
             </div>
          </div>
          
          <div className="space-y-6">
             <div className="flex justify-between items-center"><h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Trip Legs & Dispatching</h3><button type="button" onClick={() => setFormData({...formData, legs: [...formData.legs, { id: Date.now(), from: "", to: "", driverName: "", truckNo: "", status: "Planned", arrivalTime: "", departureTime: "", signature: null, driverPay: "", fuelCost: "", detentionPay: "" }]})} className="text-xs font-black text-blue-600 hover:underline transition-all">+ Add Trip Leg</button></div>
             <div className="space-y-4">
                {formData.legs.map((leg, idx) => (
                   <div key={leg.id} className="bg-slate-50 p-6 rounded-[24px] border border-slate-100 relative group/leg transition-all hover:bg-slate-100/50">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end mb-4">
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
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                          <div className="space-y-1">
                             <label className="text-[9px] font-black text-slate-400" htmlFor={`driverPay-${leg.id}`}>DRIVER PAY ($)</label>
                             <input id={`driverPay-${leg.id}`} type="number" step="0.01" value={leg.driverPay || ''} onChange={e => updateLeg(leg.id, 'driverPay', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" />
                          </div>
                          <div className="space-y-1">
                             <label className="text-[9px] font-black text-slate-400" htmlFor={`fuelCost-${leg.id}`}>FUEL COST ($)</label>
                             <input id={`fuelCost-${leg.id}`} type="number" step="0.01" value={leg.fuelCost || ''} onChange={e => updateLeg(leg.id, 'fuelCost', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" />
                          </div>
                          <div className="space-y-1">
                             <label className="text-[9px] font-black text-slate-400" htmlFor={`detentionPay-${leg.id}`}>DETENTION PAY ($)</label>
                             <input id={`detentionPay-${leg.id}`} type="number" step="0.01" value={leg.detentionPay || ''} onChange={e => updateLeg(leg.id, 'detentionPay', e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none" />
                          </div>
                      </div>
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
            <button type="button" onClick={onClose} className="flex-1 py-4 border-2 border-slate-100 rounded-[24px] font-black text-slate-400 uppercase tracking-widest text-xs hover:bg-slate-50 transition-all">Discard</button>
            <button type="submit" className="flex-[2] py-4 bg-blue-600 text-white rounded-[24px] font-black shadow-xl uppercase tracking-widest text-xs active:scale-[0.98] transition-all hover:bg-blue-700">Save Load Record</button>
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
            <th className="px-6 py-4">Financials</th>
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
                    <option value="Billing">In Billing</option>
                    <option value="Completed">Mark Complete</option>
                    <option value="Open">Re-open Load</option>
                  </select>
              </td>
              <td className="px-6 py-4">
                 <div className="font-black text-slate-900 text-sm">Rev: ${calculateTotal(load)}</div>
                 <div className="font-bold text-red-500 text-[10px] mt-0.5 uppercase">Cost: ${calculateCost(load)}</div>
                 <div className="font-black text-green-600 text-[11px] mt-0.5 uppercase">Profit: ${calculateProfit(load)}</div>
              </td>
              <td className="px-6 py-4 text-right flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => onDraftEmail(load)} className="p-2 rounded-lg transition-colors mr-1 text-purple-600 bg-purple-50 hover:bg-purple-100" title="Compose Email" aria-label="Compose Email">
                   <Mail className="w-4 h-4" />
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

const HistoryTable = ({ loads, onStatusChange, onViewDoc, onDelete, onEdit }) => (
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
          {loads.map((load) => (
            <tr key={load.id} className="hover:bg-slate-50/50 transition-colors group opacity-75 hover:opacity-100">
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
                  <select value={load.status} onChange={(e) => onStatusChange(load.id, e.target.value)} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-black uppercase transition-all" aria-label="Change status">
                    <option value="Completed">Completed</option>
                    <option value="Billing">Return to Billing</option>
                  </select>
              </td>
              <td className="px-6 py-4">
                 <div className="font-black text-slate-900 text-sm">Profit: ${calculateProfit(load)}</div>
                 <div className="font-bold text-slate-400 text-[10px] mt-0.5 uppercase">Closed: {new Date().toLocaleDateString()}</div>
              </td>
              <td className="px-6 py-4 text-right flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => onEdit(load)} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg transition-colors" aria-label="Edit load"><Edit3 className="w-4 h-4" /></button>
                <button onClick={() => onDelete(load.id)} className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors" aria-label="Delete history"><Trash2 className="w-4 h-4" /></button>
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

const DailySummary = ({ loads }) => {
  const today = new Date().toISOString().split('T')[0];
  
  const loadsToday = loads.filter(l => l.appointmentDate === today);
  const workToday = loadsToday.length;
  
  const activeTrucks = new Set();
  loadsToday.forEach(l => {
      l.legs.forEach(leg => {
          if (leg.truckNo) activeTrucks.add(leg.truckNo);
      });
  });
  const numActiveTrucks = activeTrucks.size;
  
  const needToBill = loads.filter(l => l.status === 'Open' && l.legs.length > 0 && l.legs.every(leg => leg.status === 'Completed')).length;
  
  const needToTerminate = loads.filter(l => {
     if(l.status !== 'Open') return false;
     const hasCompleted = l.legs.some(leg => leg.status === 'Completed');
     const hasPending = l.legs.some(leg => leg.status !== 'Completed');
     return hasCompleted && hasPending;
  }).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
         <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center"><Package className="w-7 h-7 text-blue-600" /></div>
         <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loads Today</div>
            <div className="text-3xl font-black text-slate-900">{workToday}</div>
         </div>
      </div>
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
         <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center"><Truck className="w-7 h-7 text-orange-600" /></div>
         <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Trucks</div>
            <div className="text-3xl font-black text-slate-900">{numActiveTrucks}</div>
         </div>
      </div>
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
         <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center"><Receipt className="w-7 h-7 text-green-600" /></div>
         <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Need to Bill</div>
            <div className="text-3xl font-black text-slate-900">{needToBill}</div>
         </div>
      </div>
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
         <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center"><Anchor className="w-7 h-7 text-rose-600" /></div>
         <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending Terminations</div>
            <div className="text-3xl font-black text-slate-900">{needToTerminate}</div>
         </div>
      </div>
    </div>
  );
};

const ProfitDashboard = ({ loads }) => {
  const getLoadTotal = (load) => parseFloat(calculateTotal(load) || 0);
  const getLoadCost = (load) => parseFloat(calculateCost(load) || 0);

  const totalRevenue = loads.reduce((sum, load) => sum + getLoadTotal(load), 0);
  const totalCost = loads.reduce((sum, load) => sum + getLoadCost(load), 0);
  const totalProfit = totalRevenue - totalCost;
  const grossMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0;

  const customerData = {};
  const laneData = {};
  const truckData = {};
  const driverData = {};

  loads.forEach(load => {
    const rev = getLoadTotal(load);
    const cost = getLoadCost(load);
    const profit = rev - cost;
    
    // Customer
    const cName = load.customerName || 'Unknown';
    if (!customerData[cName]) customerData[cName] = { rev: 0, profit: 0 };
    customerData[cName].rev += rev;
    customerData[cName].profit += profit;

    // Lane & Truck & Driver
    if (load.legs && load.legs.length > 0) {
      const from = load.legs[0].from.split(' - ')[0] || 'Unknown Origin';
      const to = load.legs[load.legs.length - 1].to.split(' - ')[0] || 'Unknown Dest';
      const lane = `${from} → ${to}`;
      if (!laneData[lane]) laneData[lane] = { rev: 0, profit: 0 };
      laneData[lane].rev += rev;
      laneData[lane].profit += profit;

      const trucks = [...new Set(load.legs.map(l => l.truckNo).filter(Boolean))];
      if (trucks.length > 0) {
        const splitRev = rev / trucks.length;
        const splitProfit = profit / trucks.length;
        trucks.forEach(t => {
          if (!truckData[t]) truckData[t] = { rev: 0, profit: 0 };
          truckData[t].rev += splitRev;
          truckData[t].profit += splitProfit;
        });
      }

      const drivers = [...new Set(load.legs.map(l => l.driverName).filter(Boolean))];
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

  loads.forEach(load => {
    const dateSource = load.appointmentDate || load.dateAdded;
    if (!dateSource) return;

    const loadDate = new Date(dateSource);
    const m = loadDate.getMonth();
    const y = loadDate.getFullYear();

    const monthObj = months.find(x => x.month === m && x.year === y);
    if (!monthObj) return;

    // calculate once (important)
    const revenue = Number(getLoadTotal(load)) || 0;
    const cost = Number(getLoadCost(load)) || 0;
    const profit = revenue - cost;

    // update month totals
    monthObj.revenue += revenue;
    monthObj.profit += profit;
  });

  const maxRev = Math.max(...months.map(m => m.revenue), 1000);

  return (
    <div className="animate-in fade-in space-y-8">
       {/* Top Stats */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
             <div className="w-14 h-14 rounded-2xl bg-purple-50 flex items-center justify-center"><DollarSign className="w-7 h-7 text-purple-600" /></div>
             <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Revenue</div>
                <div className="text-2xl font-black text-slate-900">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
             </div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
             <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center"><Receipt className="w-7 h-7 text-red-600" /></div>
             <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Cost</div>
                <div className="text-2xl font-black text-slate-900">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
             </div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
             <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center"><Wallet className="w-7 h-7 text-green-600" /></div>
             <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Profit</div>
                <div className="text-2xl font-black text-slate-900">${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
             </div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
             <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center"><Activity className="w-7 h-7 text-blue-600" /></div>
             <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross Margin</div>
                <div className="text-2xl font-black text-slate-900">{grossMargin}%</div>
             </div>
          </div>
       </div>

       {/* Trend Chart */}
       <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-8"><TrendingUp className="w-5 h-5 text-purple-600" /><h3 className="font-black text-lg text-slate-900">Revenue & Profit Trend (6 Months)</h3></div>
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
                )
             })}
          </div>
       </div>

       {/* Breakdowns */}
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 mb-6"><Building className="w-5 h-5 text-blue-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Customer</h3></div>
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
             <div className="flex items-center gap-2 mb-6"><User className="w-5 h-5 text-orange-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Driver</h3></div>
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
             <div className="flex items-center gap-2 mb-6"><Truck className="w-5 h-5 text-purple-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Truck</h3></div>
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
             <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-rose-600" /><h3 className="font-black text-sm text-slate-900 uppercase">Revenue & Profit by Lane</h3></div>
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
    </div>
  );
};

const ActionRequired = ({ loads, onEdit, onStatusChange }) => {
  const pendingTermination = loads.filter(l => 
    l.status === 'Open' && 
    l.legs.length > 0 && 
    l.legs.every(leg => leg.status === 'Completed')
  );

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
               {pendingTermination.length} containers have completed all legs but have not been closed/billed.
             </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {pendingTermination.map(load => (
              <div key={load.id} className="bg-white p-5 rounded-2xl border border-amber-100 shadow-sm flex flex-col gap-3 group hover:shadow-md hover:border-amber-300 transition-all">
                 <div className="flex justify-between items-start">
                    <div>
                       <div className="font-black text-slate-800 text-lg">{load.containerNo}</div>
                       <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{load.customerName}</div>
                    </div>
                    <div className="bg-green-100 text-green-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase">
                       Done
                    </div>
                 </div>
                 
                 <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <Truck className="w-3.5 h-3.5" />
                    <span className="truncate">Last: {load.legs[load.legs.length-1]?.to || 'Unknown'}</span>
                 </div>

                 <div className="pt-3 mt-auto flex gap-2 border-t border-slate-50">
                    <button 
                      onClick={() => onEdit(load)} 
                      className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors"
                    >
                      Review
                    </button>
                    <button 
                      onClick={() => onStatusChange(load.id, 'Billing')} 
                      className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 shadow-md shadow-green-200 transition-all active:scale-95"
                    >
                      Terminate & Bill
                    </button>
                 </div>
              </div>
           ))}
        </div>
      </div>
    </div>
  );
};

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
  const [activeTab, setActiveTab] = useState('summary');
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
  const GEMINI_API_KEY = "";

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userRef = doc(db, 'artifacts', appId, 'users', u.uid);
          const userSnap = await getDoc(userRef);

          let cId = u.uid;
          let cName = "Haulix";

          if (userSnap.exists()) {
              const data = userSnap.data();
              if (data.companyId) cId = data.companyId;
          } else {
              await setDoc(userRef, {
                email: u.email,
                companyId: cId,
                role: 'owner',
                createdAt: new Date().toISOString()
              });
              
              const companyRef = doc(db, 'artifacts', appId, 'public', 'data', 'companies', cId);
              await setDoc(companyRef, {
                name: "Haulix",
                address: "123 Logistics Way",
                email: "dispatch@haulix.com",
                createdAt: new Date().toISOString()
              });
          }
          
          const companySnap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'companies', cId));
          if(companySnap.exists()) {
              cName = companySnap.data().name || "Haulix";
          }

          setCompanyId(cId);
          setCompanyName(cName);
        } catch (error) {
          console.error("Error resolving company:", error);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLoads(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching loads:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', `customers_${companyId}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedCustomers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching customers:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', `locations_${companyId}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedDestinations(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching locations:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  useEffect(() => {
    if (!user || !companyId) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', `drivers_${companyId}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSavedDrivers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    }, (error) => console.error("Error fetching drivers:", error));
    return () => unsubscribe();
  }, [user, companyId]);

  const handleDraftEmail = useCallback((load) => {
    const total = calculateTotal(load);
    const template = `Dear ${load.customerName || 'Customer'},

Please find attached the invoice for the following shipment:

Invoice Details:
- Container: ${load.containerNo}
- PO Number: ${load.poNumber || 'N/A'}
- Reference: ${load.customerRefNo || 'N/A'}
- Amount Due: $${total}

Please confirm receipt of this invoice.

Thank you for your business.

Best regards,
${companyName || 'Haulix'} Dispatch Team`;

    setDraftEmail({ isOpen: true, content: template, load: load });
  }, [companyName]);

  const handleSendEmail = useCallback(async (finalContent) => {
  const load = draftEmail.load;

  if (!load || !load.customerEmail) {
    setCopyFeedback("❌ No customer email found");
    return;
  }

  try {
  const sendEmailFn = httpsCallable(functions, "sendEmail");

  await sendEmailFn({
    to: load.customerEmail,
    subject: `Invoice: ${load.containerNo}`,
    text: finalContent,
    html: finalContent.replace(/\n/g, "<br>"),

    // ✅ ADD THESE 3 LINES
    loadConfirmationUrl: load.loadConfirmation?.url || null,
    podUrl: load.signedPodDoc?.url || null,
    invoiceUrl: load.invoiceDoc?.url || null
  });

  setCopyFeedback("✅ Email Sent!");
  setDraftEmail(prev => ({ ...prev, isOpen: false }));

} catch (error) {
  console.error("Cloud function error:", error);
  setCopyFeedback("❌ EMAIL FAILED — CHECK CONSOLE");
  setDraftEmail(prev => ({ ...prev, isOpen: false }));
}

}, [draftEmail.load, setCopyFeedback]);

const handleAddCustomer = useCallback(async (e) => {
  e.preventDefault();

  if (!newCust.name.trim() || !user || !companyId) return;

  try {
    await addDoc(
      collection(db, 'artifacts', appId, 'public', 'data', `customers_${companyId}`),
      { ...newCust }
    );

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
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', `locations_${companyId}`), { ...newLoc });
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
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', `drivers_${companyId}`), { ...newDriver });
      setNewDriver({ name: '', truckNo: '' });
      setCopyFeedback("Driver Saved to Cloud");
    } catch (error) {
      console.error("Error adding driver:", error);
      setCopyFeedback("Failed to save driver");
    }
  }, [user, companyId, newDriver, setCopyFeedback, appId]);

  const executeDeleteCustomer = useCallback(async (id) => {
      if(!user || !companyId) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `customers_${companyId}`, id));
        setCopyFeedback("Customer deleted");
      } catch (error) {
        console.error("Error deleting customer:", error);
        setCopyFeedback("Failed to delete customer");
      }
  }, [user, companyId, setCopyFeedback, appId]);

  const confirmDeleteCustomer = useCallback((id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Customer?',
      message: 'Are you sure you want to delete this customer? This action cannot be undone.',
      onConfirm: () => executeDeleteCustomer(id)
    });
  }, [executeDeleteCustomer]);

  const executeDeleteLocation = useCallback(async (id) => {
      if(!user || !companyId) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `locations_${companyId}`, id));
        setCopyFeedback("Location deleted");
      } catch (error) {
        console.error("Error deleting location:", error);
        setCopyFeedback("Failed to delete location");
      }
  }, [user, companyId, setCopyFeedback, appId]);

  const confirmDeleteLocation = useCallback((id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Location?',
      message: 'Are you sure you want to delete this location? This action cannot be undone.',
      onConfirm: () => executeDeleteLocation(id)
    });
  }, [executeDeleteLocation]);

  const executeDeleteDriver = useCallback(async (id) => {
      if(!user || !companyId) return;
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `drivers_${companyId}`, id));
        setCopyFeedback("Driver deleted");
      } catch (error) {
        console.error("Error deleting driver:", error);
        setCopyFeedback("Failed to delete driver");
      }
  }, [user, companyId, setCopyFeedback, appId]);

  const confirmDeleteDriver = useCallback((id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Driver?',
      message: 'Are you sure you want to delete this driver? This action cannot be undone.',
      onConfirm: () => executeDeleteDriver(id)
    });
  }, [executeDeleteDriver]);

  const executeDeleteLoad = useCallback(async (id) => {
    if (!user || !companyId) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`, id));
      setCopyFeedback("Load deleted successfully");
    } catch (error) {
      console.error('Delete error:', error);
      setCopyFeedback("Failed to delete load");
    }
  }, [user, companyId, setCopyFeedback, appId]);

  const confirmDeleteLoad = useCallback((id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Load?',
      message: 'Are you sure you want to delete this load record? This action cannot be undone.',
      onConfirm: () => executeDeleteLoad(id)
    });
  }, [executeDeleteLoad]);
  
  const quickUpdateStatus = useCallback(async (loadId, newStatus) => {
    if (!user || !companyId) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`, loadId), { status: newStatus });
      setCopyFeedback(`Moved to ${newStatus}`);
    } catch (error) {
       console.error("Error updating status:", error);
       setCopyFeedback("Failed to update status");
    }
  }, [user, companyId, setCopyFeedback, appId]);
  
  const handleSubmitLoad = useCallback(async (formData) => {
  if (!user || !companyId) return;

  const cleanedData = {
  ...formData,
  dateAdded: new Date().toISOString(),

  // ✅ KEEP FULL FILE OBJECT (WITH URL)
  loadConfirmation: formData.loadConfirmation || null,
  signedPodDoc: formData.signedPodDoc || null
};

  try {
    if (editingId) {
      await updateDoc(
        doc(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`, editingId),
        cleanedData
      );
      setCopyFeedback("Load Updated");
    } else {
      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`),
        cleanedData
      );
      setCopyFeedback("✅ Load Created Successfully");
    }

    setIsFormOpen(false);
    setEditingId(null);
  } catch (error) {
    console.error("Error saving load:", error);
    setCopyFeedback("Failed to save load");
  }
}, [user, companyId, editingId, setCopyFeedback, appId]);
  
  const handleEdit = useCallback((load) => {
    setEditingId(load.id);
    setIsFormOpen(true);
  }, []);

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
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', `loads_${companyId}`, loadId), { legs: updatedLegs });
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
      if (activeTab === 'history') return load.status === 'Completed';
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
        onSend={handleSendEmail}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm}
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
            <div className="flex items-center gap-2"><div className="bg-blue-600 p-2 rounded-lg"><Package className="text-white w-6 h-6" /></div><h1 className="text-xl font-bold text-slate-800 tracking-tight">{companyName}</h1></div>
            <nav className="hidden md:flex gap-1 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setActiveTab('summary')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'summary' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Summary</button>
              <button onClick={() => setActiveTab('loads')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'loads' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Operations</button>
              <button onClick={() => setActiveTab('addressBook')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'addressBook' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Database</button>
              <button onClick={() => setActiveTab('billing')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'billing' ? 'bg-white shadow-sm text-green-600' : 'text-slate-500 hover:text-slate-700'}`}>Billing</button>
              <button onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>History</button>
              <button onClick={() => setActiveTab('assignment')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'assignment' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Assignment</button>
              <button onClick={() => setActiveTab('revenue')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'revenue' ? 'bg-white shadow-sm text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}>Profit</button>
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
            <button onClick={() => setActiveTab('summary')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'summary' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Summary</button>
            <button onClick={() => setActiveTab('loads')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'loads' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Operations</button>
            <button onClick={() => setActiveTab('addressBook')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'addressBook' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Database</button>
            <button onClick={() => setActiveTab('billing')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'billing' ? 'bg-slate-100 text-green-600' : 'text-slate-500'}`}>Billing</button>
            <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'history' ? 'bg-slate-100 text-slate-800' : 'text-slate-500'}`}>History</button>
            <button onClick={() => setActiveTab('assignment')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'assignment' ? 'bg-slate-100 text-blue-600' : 'text-slate-500'}`}>Assignment</button>
            <button onClick={() => setActiveTab('revenue')} className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-semibold ${activeTab === 'revenue' ? 'bg-slate-100 text-purple-600' : 'text-slate-500'}`}>Profit</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'summary' && (
          <div className="animate-in fade-in space-y-8">
             <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-black text-slate-900">Daily Summary</h2>
                  <button
                    onClick={() => {
                       downloadDailyReportCSV(loads, companyName);
                       setCopyFeedback("Daily Report Downloaded");
                    }}
                    className="flex items-center gap-2 bg-green-50 text-green-700 hover:text-green-800 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest border border-green-200 hover:bg-green-100 transition-all active:scale-95 shadow-sm"
                  >
                    <FileDown className="w-4 h-4" />
                    <span className="hidden sm:inline">Export Excel / CSV</span>
                  </button>
                </div>
                <DailySummary loads={loads} />
             </div>

             <ActionRequired loads={loads} onEdit={handleEdit} onStatusChange={quickUpdateStatus} />

             <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                   <div className="bg-blue-600 p-2 rounded-xl text-white"><Clock className="w-5 h-5" /></div>
                   <h3 className="font-black text-lg text-slate-900">Today's Active Dispatches</h3>
                </div>
                <LoadTable
                  loads={loads.filter(l => l.appointmentDate === new Date().toISOString().split('T')[0] && l.status === 'Open')}
                  onEdit={handleEdit}
                  onDelete={confirmDeleteLoad}
                  onStatusChange={quickUpdateStatus}
                  onViewDoc={setViewingDoc}
                  onSign={handleSign}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
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
            onDelete={confirmDeleteLoad}
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

        {activeTab === 'history' && (
          <HistoryTable
             loads={filteredLoads}
             onStatusChange={quickUpdateStatus}
             onViewDoc={setViewingDoc}
             onDelete={confirmDeleteLoad}
             onEdit={handleEdit}
          />
        )}
        
        {activeTab === 'addressBook' && (
          <AddressBook
            savedCustomers={savedCustomers}
            savedDestinations={savedDestinations}
            savedDrivers={savedDrivers}
            onDeleteCustomer={confirmDeleteCustomer}
            onDeleteLocation={confirmDeleteLocation}
            onDeleteDriver={confirmDeleteDriver}
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
        
        {activeTab === 'revenue' && (
          <ProfitDashboard loads={loads} />
        )}
      </main>
      
      <LoadForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingId(null); }}
        onSubmit={handleSubmitLoad}
        initialData={loadToEdit}
        savedCustomers={savedCustomers}
        savedDestinations={savedDestinations}
        savedDrivers={savedDrivers}
        apiKey={GEMINI_API_KEY}
      />
    </div>
  );
};

export default App;