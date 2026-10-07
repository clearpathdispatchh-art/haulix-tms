// src/components/InvoicesModule.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText, Search, Plus, X, Send, Printer, Trash2, Edit3,
  Loader2, AlertCircle, CheckCircle, DollarSign, Mail, Paperclip,
  Calendar, User, Building, Download, RefreshCw, Filter, ChevronDown,
  ShieldCheck, Clock, CheckSquare, Square
} from 'lucide-react';
import {
  collection, query, onSnapshot, where, orderBy, getDocs,
  doc, updateDoc, addDoc, deleteDoc, getDoc, limit, setDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import html2pdf from 'html2pdf.js';
import DOMPurify from 'dompurify';

// ========== HELPERS ==========
const safeFloat = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const formatCurrency = (amount, currency = 'CAD') => {
  const sym = currency === 'USD' ? 'US$' : 'C$';
  return `${sym}${safeFloat(amount).toFixed(2)}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
};

const formatDateTime = (dateStr) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch { return dateStr; }
};

const getTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const STATUS_STYLES = {
  'Draft':     'bg-slate-100 text-slate-700 border-slate-300',
  'Sent':      'bg-blue-100 text-blue-700 border-blue-300',
  'Paid':      'bg-green-100 text-green-700 border-green-300',
  'Overdue':   'bg-red-100 text-red-700 border-red-300',
  'Cancelled': 'bg-gray-200 text-gray-500 border-gray-300',
};

// ========== PDF GENERATION ==========
const buildInvoiceHTML = (invoice, companyName, companyDetails, locationAddress, currencySymbol) => {
  const addressStr = locationAddress
    || [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode].filter(Boolean).join(', ');

  const rowsHtml = (invoice.items || []).map(item =>
    `<tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;"><div style="font-weight: 700;">${item.item || 'Service'}</div>${item.details ? `<div style="font-size: 10px; color:#6b7280;">${item.details}</div>` : ''}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.qty || 1}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.uom || ''}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${safeFloat(item.rate).toFixed(2)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 700;">${currencySymbol}${safeFloat(item.amount).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #111827; line-height: 1.4; width: 100%; box-sizing: border-box;">
      <style>* { box-sizing: border-box; }</style>
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 26px; font-weight: 900; color: #1d4ed8; margin-bottom: 8px;">${companyName || 'Company'}</div>
          <div style="color: #374151;">${addressStr}</div>
          ${companyDetails?.phone ? `<div style="color: #374151;">Tel: ${companyDetails.phone}</div>` : ''}
          ${companyDetails?.email ? `<div style="color: #374151;">Email: ${companyDetails.email}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <div style="font-size: 26px; font-weight: 900; color: #9ca3af; margin-bottom: 8px;">INVOICE</div>
          <table style="border-collapse: collapse; margin-left: auto;">
            <tr><td style="padding: 3px 8px; font-weight: 800; text-transform: uppercase; color: #4b5563;">INVOICE #</td><td style="padding: 3px 8px; font-weight: 800; text-align: right;">${invoice.invoiceNumber}</td></tr>
            <tr><td style="padding: 3px 8px; font-weight: 800; text-transform: uppercase; color: #4b5563;">DATE</td><td style="padding: 3px 8px; font-weight: 800; text-align: right;">${invoice.invoiceDate}</td></tr>
            <tr><td style="padding: 3px 8px; font-weight: 800; text-transform: uppercase; color: #4b5563;">DUE</td><td style="padding: 3px 8px; font-weight: 800; text-align: right;">${invoice.dueDate || 'On Receipt'}</td></tr>
            <tr><td style="padding: 3px 8px; font-weight: 800; text-transform: uppercase; color: #4b5563;">TERMS</td><td style="padding: 3px 8px; font-weight: 800; text-align: right;">${invoice.paymentTerms || 'NET 30'}</td></tr>
          </table>
        </div>
      </div>
      <div style="border-bottom: 3px solid #111827; margin: 15px 0 25px;"></div>
      <div style="display: flex; gap: 16px; margin-bottom: 32px;">
        <div style="width: 50%;">
          <div style="font-weight: 900; font-size: 12px; color: #1f2937; margin-bottom: 8px;">BILL TO</div>
          <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; background: #f9fafb;">
            <div style="font-weight: 900; font-size: 14px;">${invoice.billTo || invoice.customerName || 'N/A'}</div>
            <div style="color: #374151; line-height: 1.5; margin-top: 4px;">${invoice.customerAddress || ''}</div>
          </div>
        </div>
        <div style="width: 50%;">
          <div style="font-weight: 900; font-size: 12px; color: #1f2937; margin-bottom: 8px;">SHIPMENT</div>
          <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; background: #f9fafb; display: flex; gap: 12px; flex-wrap: wrap;">
            <div style="width: 45%;"><div style="font-size: 10px; color:#6b7280; text-transform: uppercase; font-weight: 800;">Container</div><div style="font-weight: 700;">${invoice.containerNo || '—'}</div></div>
            <div style="width: 45%;"><div style="font-size: 10px; color:#6b7280; text-transform: uppercase; font-weight: 800;">WO #</div><div style="font-weight: 700;">${invoice.workOrderNo || '—'}</div></div>
          </div>
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background: #f3f4f6; border-bottom: 2px solid #d1d5db;">
            <th style="padding: 12px; text-align: left; font-size: 10px; text-transform: uppercase; color: #4b5563;">Description</th>
            <th style="padding: 12px; text-align: center; font-size: 10px; text-transform: uppercase; color: #4b5563;">Qty</th>
            <th style="padding: 12px; text-align: center; font-size: 10px; text-transform: uppercase; color: #4b5563;">UOM</th>
            <th style="padding: 12px; text-align: right; font-size: 10px; text-transform: uppercase; color: #4b5563;">Rate</th>
            <th style="padding: 12px; text-align: right; font-size: 10px; text-transform: uppercase; color: #4b5563;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
        <div style="width: 260px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
          <div style="display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e5e7eb;"><span style="font-weight: 700; color:#4b5563;">Subtotal</span><span style="font-weight: 700;">${currencySymbol}${safeFloat(invoice.subtotal).toFixed(2)}</span></div>
          <div style="display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e5e7eb;"><span style="font-weight: 700; color:#4b5563;">Taxes</span><span style="font-weight: 700;">${currencySymbol}${safeFloat(invoice.taxes).toFixed(2)}</span></div>
          <div style="display: flex; justify-content: space-between; padding: 10px 16px; background: #1d4ed8; color: #fff;"><span style="font-weight: 900; font-size: 16px;">TOTAL DUE</span><span style="font-weight: 900; font-size: 16px;">${currencySymbol}${safeFloat(invoice.total).toFixed(2)}</span></div>
        </div>
      </div>
      <div style="margin-top: 40px; text-align: center; font-size: 10px; color: #9ca3af;">${companyName || ''} — ${new Date().toLocaleString()}</div>
    </div>
  `;
};

const generateInvoicePDFBlob = async (invoice, companyName, companyDetails, locationAddress) => {
  const currencySymbol = invoice.currency === 'USD' ? 'US$' : 'C$';
  const html = buildInvoiceHTML(invoice, companyName, companyDetails, locationAddress, currencySymbol);
  const element = document.createElement('div');
  element.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['div','span','style','table','thead','tbody','tr','td','th','p','strong','b','i','em','br','hr'],
    ALLOWED_ATTR: ['style','colspan','rowspan','align','border','cellpadding']
  });
  const opt = {
    margin: 0.4,
    image: { type: 'jpeg', quality: 0.85 },
    html2canvas: { scale: 1.5, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css'] },
  };
  return await html2pdf().set(opt).from(element).outputPdf('blob');
};

// ========== MAIN COMPONENT ==========
const InvoicesModule = ({
  companyId,
  companyName,
  companyDetails,
  companyLocations = [],
  setFeedback,
  userEmail,
  pendingLoadId,
  onPendingLoadConsumed,
}) => {
  const [invoices, setInvoices] = useState([]);
  const [loads, setLoads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');

  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInvoice, setEmailInvoice] = useState(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkProgress, setBulkProgress] = useState(null);
  const [sendingBatchFor, setSendingBatchFor] = useState(null);

  // ---- Listen to invoices ----
  useEffect(() => {
    if (!companyId) return;
    const q = query(
      collection(db, 'companies', companyId, 'invoices'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error('Invoices listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [companyId]);

  // ---- Listen to loads (approved + invoiced only, for NewInvoiceModal) ----
  useEffect(() => {
    if (!companyId) return;
    const q = query(
      collection(db, 'companies', companyId, 'loads'),
      where('status', 'in', ['Approved', 'Invoiced']),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      setLoads(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Loads listener error:', err));
    return () => unsub();
  }, [companyId]);

  // ---- Listen to customers ----
  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'companies', companyId, 'customers'), limit(500));
    const unsub = onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [companyId]);

  // ✅ Auto-open invoice when navigating from History tab
  useEffect(() => {
    if (!pendingLoadId || invoices.length === 0) return;
    const inv = invoices.find(i => i.loadId === pendingLoadId);
    if (inv) {
      setSelectedInvoice(inv);
      onPendingLoadConsumed?.();
    }
  }, [pendingLoadId, invoices, onPendingLoadConsumed]);

  const filtered = useMemo(() => {
    let list = [...invoices];

    if (statusFilter === 'pending') {
      list = list.filter(inv => ['Draft', 'Overdue'].includes(inv.status || 'Draft'));
    } else if (statusFilter === 'all') {
      // show everything
    } else {
      list = list.filter(inv => (inv.status || 'Draft') === statusFilter);
    }

    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      list = list.filter(inv =>
        String(inv.invoiceNumber || '').toLowerCase().includes(t) ||
        (inv.containerNo || '').toLowerCase().includes(t) ||
        (inv.customerName || '').toLowerCase().includes(t)
      );
    }
    return list;
  }, [invoices, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const total = invoices.length;
    const draft = invoices.filter(i => (i.status || 'Draft') === 'Draft').length;
    const sent = invoices.filter(i => i.status === 'Sent').length;
    const paid = invoices.filter(i => i.status === 'Paid').length;
    const overdue = invoices.filter(i => i.status === 'Overdue').length;
    const totalAmount = invoices.reduce((s, i) => s + safeFloat(i.total), 0);
    return { total, draft, sent, paid, overdue, totalAmount };
  }, [invoices]);

  // ✅ Group pending invoices by customer (only customers with 2+ pending)
  const customerBatches = useMemo(() => {
    const groups = {};
    invoices
      .filter(inv => ['Draft', 'Overdue'].includes(inv.status || 'Draft'))
      .forEach(inv => {
        const key = (inv.customerName || 'Unknown').trim();
        if (!groups[key]) {
          groups[key] = {
            customerName: key,
            customerEmail: inv.customerEmail || '',
            invoices: [],
            totalAmount: 0,
          };
        }
        groups[key].invoices.push(inv);
        groups[key].totalAmount += safeFloat(inv.total);
        if (!groups[key].customerEmail && inv.customerEmail) {
          groups[key].customerEmail = inv.customerEmail;
        }
      });
    return Object.values(groups)
      .filter(g => g.invoices.length >= 2)
      .sort((a, b) => b.invoices.length - a.invoices.length);
  }, [invoices]);

  const allSelected = filtered.length > 0 && filtered.every(inv => selectedIds.has(inv.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(i => i.id)));
  };

  const handleCreateInvoice = async (loadId) => {
    const load = loads.find(l => l.id === loadId);
    if (!load) { setFeedback?.('❌ Load not found'); return; }
    if (!load.billingApproved) {
      setFeedback?.('❌ Billing must be approved before creating an invoice');
      return;
    }

    try {
      const counterRef = doc(db, 'companies', companyId, 'counters', 'invoices');
      let counterSnap = await getDoc(counterRef);
      let nextSeq = 7001;
      if (counterSnap.exists()) {
        const data = counterSnap.data();
        nextSeq = (data.lastNumber || 7000) + 1;
        await updateDoc(counterRef, { lastNumber: nextSeq, updatedAt: new Date().toISOString() });
      } else {
        await setDoc(counterRef, { lastNumber: nextSeq, createdAt: new Date().toISOString() });
      }

      const items = (load.revenueItems || []).map(item => ({
        item: item.item || 'Service',
        details: item.details || '',
        qty: safeFloat(item.qty || 1),
        uom: item.uom || 'RATE',
        rate: safeFloat(item.rate),
        amount: safeFloat(item.amount),
        tax: safeFloat(item.tax || 0),
      }));

      const subtotal = items.reduce((s, i) => s + i.amount, 0);
      const taxes = items.reduce((s, i) => s + (i.amount * i.tax / 100), 0);
      const total = subtotal + taxes;

      const today = getTodayStr();
      const dueObj = new Date(today + 'T00:00:00');
      dueObj.setDate(dueObj.getDate() + 30);
      const dueDate = dueObj.toISOString().split('T')[0];

      const customer = customers.find(c => c.name === load.customerName);

      const newInvoice = {
        companyId,
        invoiceNumber: String(nextSeq),
        sequence: nextSeq,
        year: new Date().getFullYear(),
        loadId,
        containerNo: load.containerNo || 'N/A',
        workOrderNo: load.workOrderNo || 'N/A',
        customerName: load.customerName || 'N/A',
        customerEmail: customer?.email || load.customerEmail || '',
        customerAddress: customer?.address || load.customerAddress || '',
        billTo: customer?.name || load.customerName || 'N/A',
        salesRep: userEmail || 'N/A',
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
        internalComments: '',
        billingApprovedBy: load.billingApprovedBy || 'N/A',
        billingApprovedAt: load.billingApprovedAt || null,
        createdAt: new Date().toISOString(),
        createdBy: userEmail || 'N/A',
      };

      const ref = await addDoc(collection(db, 'companies', companyId, 'invoices'), newInvoice);

      await updateDoc(doc(db, 'companies', companyId, 'loads', loadId), {
        status: 'Invoiced',
        invoiceNumber: String(nextSeq),
        invoiceId: ref.id,
        updatedAt: new Date().toISOString(),
      });

      setFeedback?.(`✅ Invoice #${nextSeq} created`);
      setShowNewModal(false);
      return ref.id;
    } catch (err) {
      console.error('Create invoice error:', err);
      setFeedback?.('❌ Failed to create invoice: ' + err.message);
    }
  };

  const handleDeleteInvoice = async (inv) => {
    if (!window.confirm(`Delete invoice #${inv.invoiceNumber}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'invoices', inv.id));
      if (inv.loadId) {
        await updateDoc(doc(db, 'companies', companyId, 'loads', inv.loadId), {
          status: 'Ready for Billing',
          invoiceNumber: '',
          invoiceId: '',
        }).catch(() => {});
      }
      setFeedback?.('✅ Invoice deleted');
      const next = new Set(selectedIds);
      next.delete(inv.id);
      setSelectedIds(next);
    } catch (err) {
      console.error('Delete error:', err);
      setFeedback?.('❌ Failed to delete invoice');
    }
  };

  const handleSaveInvoice = async (invoice) => {
    try {
      const { id, ...data } = invoice;
      const subtotal = (data.items || []).reduce((s, i) => s + safeFloat(i.amount), 0);
      const taxes = (data.items || []).reduce((s, i) => s + (safeFloat(i.amount) * safeFloat(i.tax) / 100), 0);
      const total = subtotal + taxes;

      await updateDoc(doc(db, 'companies', companyId, 'invoices', id), {
        ...data,
        subtotal,
        taxes,
        total,
        updatedAt: new Date().toISOString(),
      });
      setFeedback?.('✅ Invoice saved');
      setSelectedInvoice(null);
    } catch (err) {
      console.error('Save error:', err);
      setFeedback?.('❌ Failed to save invoice');
    }
  };

  // ---- SEND SINGLE INVOICE (used by both single + bulk) ----
  const sendSingleInvoice = async (inv, { silent = false } = {}) => {
    let locationAddress = null;
    if (inv.loadId) {
      const load = loads.find(l => l.id === inv.loadId);
      if (load?.locationId) {
        const loc = companyLocations.find(l => l.id === load.locationId);
        if (loc) {
          locationAddress = [loc.name, loc.address, loc.city, loc.province, loc.postalCode]
            .filter(Boolean).join(', ');
        }
      }
    }
    if (!locationAddress) {
      locationAddress = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode]
        .filter(Boolean).join(', ');
    }

    const pdfBlob = await generateInvoicePDFBlob(inv, companyName, companyDetails, locationAddress);

    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../firebase');
    const safeFileName = `Invoice_${inv.invoiceNumber}.pdf`;
    const filePath = `invoices/${companyId}/${inv.id}_${Date.now()}_${safeFileName}`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' });
    const invoiceUrl = await getDownloadURL(storageRef);

    let load = null;
    if (inv.loadId) {
      const loadSnap = await getDoc(doc(db, 'companies', companyId, 'loads', inv.loadId));
      if (loadSnap.exists()) load = loadSnap.data();
    }

    const attachments = [];
    if (load?.signedPodDoc?.url) {
      attachments.push({ url: load.signedPodDoc.url, filename: `POD_${inv.containerNo}.pdf` });
    }
    attachments.push({ url: invoiceUrl, filename: safeFileName });

    const toList = (inv.customerEmail || '').split(',').map(s => s.trim()).filter(Boolean);
    if (toList.length === 0) {
      throw new Error(`No customer email for invoice #${inv.invoiceNumber}`);
    }

    const subject = `Invoice: ${inv.invoiceNumber}, Container: ${inv.containerNo}, LC #: ${inv.workOrderNo || ''}`;
    const body = `Hello,

Please see attached invoice ${inv.invoiceNumber} and POD for your reference for container ${inv.containerNo}.
Amount Due: ${formatCurrency(inv.total, inv.currency)}.

Should you have any questions please feel free to reach out.

Thank you,
${companyName || ''}
${companyDetails?.email || ''}
${companyDetails?.phone || ''}

This email contains confidential information and is for the exclusive use of the addressee/s. Any unauthorized copying, distribution or use of information contained in this email is prohibited.`;

    const sendFn = httpsCallable(getFunctions(), 'sendInvoiceEmail');
    await sendFn({
      companyId,
      to: toList,
      cc: [],
      bcc: [],
      subject,
      text: body,
      html: `<pre style="font-family: Arial; white-space: pre-wrap;">${DOMPurify.sanitize(body)}</pre>`,
      attachments,
    });

    await updateDoc(doc(db, 'companies', companyId, 'invoices', inv.id), {
      status: 'Sent',
      sentAt: new Date().toISOString(),
      sentTo: toList,
      sentCc: [],
      invoiceUrl,
      updatedAt: new Date().toISOString(),
    });

    if (inv.loadId) {
      await updateDoc(doc(db, 'companies', companyId, 'loads', inv.loadId), {
        status: 'Paid',
        sentToCustomerAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).catch((e) => console.warn('Load status update failed:', e));
    }

    if (!silent) setFeedback?.(`✅ Invoice #${inv.invoiceNumber} sent — Load moved to History`);
    return { success: true, invoiceNumber: inv.invoiceNumber };
  };

  // ---- BULK SEND (parallel) ----
  const handleBulkSend = async () => {
    const selected = invoices.filter(inv => selectedIds.has(inv.id));
    if (selected.length === 0) {
      setFeedback?.('⚠️ No invoices selected');
      return;
    }

    const total = selected.length;
    setBulkProgress({ current: 0, total, currentInvoice: null, results: [] });

    const results = [];
    let completed = 0;

    const promises = selected.map(async (inv, index) => {
      if (index > 0) await new Promise(r => setTimeout(r, index * 200));

      try {
        await sendSingleInvoice(inv, { silent: true });
        results.push({
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          status: 'sent',
        });
      } catch (err) {
        console.error(`Invoice #${inv.invoiceNumber} failed:`, err);
        results.push({
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          status: 'failed',
          error: err.message || 'Unknown error',
        });
      }

      completed++;
      setBulkProgress(prev => ({
        current: completed,
        total,
        currentInvoice: inv,
        results: [...results],
      }));
    });

    await Promise.allSettled(promises);

    setBulkProgress(prev => ({
      current: total,
      total,
      currentInvoice: null,
      results: [...results],
      isComplete: true,
    }));

    setSelectedIds(new Set());

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    setFeedback?.(`✅ Bulk send complete: ${sent} sent, ${failed} failed`);
  };

  // ✅ FAST — Send every pending invoice for one customer in parallel
  const sendAllForCustomer = async (batch) => {
    const customerName = batch.customerName;

    if (!batch.customerEmail) {
      setFeedback?.(`❌ ${customerName} has no email address on file`);
      return;
    }

    const total = batch.invoices.length;

    const confirmMsg =
      `Send ${total} separate invoices to ${customerName}?\n\n` +
      `Email: ${batch.customerEmail}\n` +
      `Total: C$${batch.totalAmount.toFixed(2)}\n\n` +
      `Each invoice will be emailed individually with its own PDF and POD attachment.`;

    if (!window.confirm(confirmMsg)) return;

    setSendingBatchFor(customerName);
    setBulkProgress({ current: 0, total, currentInvoice: null, results: [] });

    const results = [];
    let completed = 0;

    const promises = batch.invoices.map(async (inv, index) => {
      if (index > 0) await new Promise(r => setTimeout(r, index * 200));

      try {
        await sendSingleInvoice(inv, { silent: true });
        results.push({
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          status: 'sent',
        });
      } catch (err) {
        console.error(`Invoice #${inv.invoiceNumber} failed:`, err);
        results.push({
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          status: 'failed',
          error: err.message || 'Unknown error',
        });
      }

      completed++;
      setBulkProgress(prev => ({
        current: completed,
        total,
        currentInvoice: inv,
        results: [...results],
      }));
    });

    await Promise.allSettled(promises);

    setBulkProgress(prev => ({
      current: total,
      total,
      currentInvoice: null,
      results: [...results],
      isComplete: true,
    }));

    setSendingBatchFor(null);

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    setFeedback?.(
      `✅ Sent ${sent} of ${total} invoices to ${customerName}` +
      (failed > 0 ? ` (${failed} failed)` : '')
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Invoices
          </h2>
          <p className="text-sm text-slate-500">Manage all customer invoices</p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create Invoice
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase">Total</div>
          <div className="text-2xl font-black text-slate-900">{stats.total}</div>
        </div>
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-500 uppercase">Draft</div>
          <div className="text-2xl font-black text-slate-700">{stats.draft}</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
          <div className="text-[10px] font-black text-blue-600 uppercase">Sent</div>
          <div className="text-2xl font-black text-blue-700">{stats.sent}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-2xl border border-green-200 shadow-sm">
          <div className="text-[10px] font-black text-green-600 uppercase">Paid</div>
          <div className="text-2xl font-black text-green-700">{stats.paid}</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 shadow-sm">
          <div className="text-[10px] font-black text-purple-600 uppercase">Total Value</div>
          <div className="text-2xl font-black text-purple-700">C${stats.totalAmount.toFixed(2)}</div>
        </div>
      </div>

      {/* Quick Send by Customer */}
      {customerBatches.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-md">
              <Building className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-black text-indigo-900 text-sm uppercase tracking-wide">
                Quick Send by Customer
              </h3>
              <p className="text-xs text-indigo-600 font-medium">
                Send every pending invoice for a customer in one click — each invoice is emailed separately with its own PDF and POD.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {customerBatches.map(batch => {
              const isSending = sendingBatchFor === batch.customerName;
              const isDisabled = sendingBatchFor !== null || !batch.customerEmail;

              return (
                <div
                  key={batch.customerName}
                  className="bg-white rounded-xl border border-indigo-200 p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-black text-slate-800 text-sm truncate"
                        title={batch.customerName}
                      >
                        {batch.customerName}
                      </div>
                      <div
                        className="text-[10px] text-slate-500 truncate mt-0.5"
                        title={batch.customerEmail}
                      >
                        {batch.customerEmail || '⚠️ No email on file'}
                      </div>
                    </div>
                    <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-1 rounded-full border border-indigo-300 whitespace-nowrap">
                      {batch.invoices.length} inv
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs border-t border-slate-100 pt-2">
                    <span className="text-slate-500 font-medium truncate" title={batch.invoices.map(i => `#${i.invoiceNumber}`).join(', ')}>
                      #{batch.invoices.map(i => i.invoiceNumber).join(', #')}
                    </span>
                    <span className="font-black text-green-600 whitespace-nowrap ml-2">
                      C${batch.totalAmount.toFixed(2)}
                    </span>
                  </div>

                  <button
                    onClick={() => sendAllForCustomer(batch)}
                    disabled={isDisabled}
                    className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-95"
                    title={!batch.customerEmail ? 'Customer has no email' : `Send all ${batch.invoices.length} invoices`}
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send All ({batch.invoices.length})
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BULK ACTION BAR */}
      {someSelected && (
        <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 animate-in slide-in-from-top">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white rounded-lg w-8 h-8 flex items-center justify-center font-black">
              {selectedIds.size}
            </div>
            <div>
              <div className="font-black text-blue-900 text-sm">
                {selectedIds.size} invoice{selectedIds.size > 1 ? 's' : ''} selected
              </div>
              <div className="text-xs text-blue-700">
                {(() => {
                  const customers = new Set(invoices.filter(i => selectedIds.has(i.id)).map(i => i.customerName));
                  return customers.size === 1
                    ? `All for ${Array.from(customers)[0]}`
                    : `${customers.size} different customers`;
                })()}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleBulkSend}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
              Send All ({selectedIds.size})
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search invoice #, container, customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="pending">📝 Pending ({stats.draft + stats.overdue})</option>
          <option value="all">📋 Audit Log (all)</option>
        </select>

        {statusFilter === 'pending' && stats.sent > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl font-bold text-xs text-green-700 whitespace-nowrap">
            <CheckCircle className="w-4 h-4" />
            {stats.sent} sent → History tab
          </div>
        )}
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-3 py-3 w-10">
                  <button onClick={toggleSelectAll} className="p-1">
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Approved By</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Taxes</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="11" className="px-4 py-16 text-center">
                    {statusFilter === 'pending' ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                          <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <div className="text-lg font-black text-slate-800">All caught up!</div>
                        <div className="text-sm text-slate-500">No pending invoices to send.</div>
                        {stats.sent > 0 && (
                          <div className="text-xs text-slate-400 mt-2">
                            {stats.sent} invoice{stats.sent > 1 ? 's' : ''} previously sent — see the History tab
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-400 font-bold italic">No invoices found.</div>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map(inv => (
                  <tr
                    key={inv.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      selectedIds.has(inv.id) ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => toggleSelect(inv.id)} className="p-1">
                        {selectedIds.has(inv.id) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-black text-slate-900 cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      #{inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-sm cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {formatDate(inv.invoiceDate)}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {inv.containerNo}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {inv.customerName}
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${STATUS_STYLES[inv.status || 'Draft']}`}>
                        {inv.status || 'Draft'}
                      </span>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {inv.billingApprovedBy ? (
                        <div className="flex items-center gap-1 text-[10px]">
                          <ShieldCheck className="w-3 h-3 text-green-600" />
                          <span className="font-bold text-slate-700 truncate max-w-[100px]" title={inv.billingApprovedBy}>
                            {inv.billingApprovedBy}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {formatCurrency(inv.subtotal, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-500 cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {formatCurrency(inv.taxes, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-green-600 cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEmailInvoice(inv); setShowEmailModal(true); }}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"
                          title="Email this invoice"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteInvoice(inv); }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALS */}
      {showNewModal && (
        <NewInvoiceModal
          loads={loads}
          invoices={invoices}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreateInvoice}
        />
      )}

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          customers={customers}
          onSave={handleSaveInvoice}
          onClose={() => setSelectedInvoice(null)}
          onEmail={(inv) => { setSelectedInvoice(null); setEmailInvoice(inv); setShowEmailModal(true); }}
        />
      )}

      {showEmailModal && emailInvoice && (
        <EmailInvoiceModal
          invoice={emailInvoice}
          companyId={companyId}
          companyName={companyName}
          companyDetails={companyDetails}
          companyLocations={companyLocations}
          setFeedback={setFeedback}
          onClose={() => { setShowEmailModal(false); setEmailInvoice(null); }}
        />
      )}

      {bulkProgress && (
        <BulkSendProgressModal
          progress={bulkProgress}
          onClose={() => setBulkProgress(null)}
        />
      )}
    </div>
  );
};

// ========== NEW INVOICE MODAL ==========
const NewInvoiceModal = ({ loads, invoices, onClose, onCreate }) => {
  const [search, setSearch] = useState('');
  const [selectedLoadId, setSelectedLoadId] = useState(null);
  const [creating, setCreating] = useState(false);

  const eligibleLoads = useMemo(() => {
    const invoicedLoadIds = new Set(invoices.map(i => i.loadId).filter(Boolean));
    let list = loads.filter(l =>
      l.billingApproved === true &&
      (l.status === 'Approved' || (l.status === 'Invoiced' && !invoicedLoadIds.has(l.id)))
    );
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(l =>
        (l.containerNo || '').toLowerCase().includes(t) ||
        (l.customerName || '').toLowerCase().includes(t)
      );
    }
    return list;
  }, [loads, invoices, search]);

  const handleCreate = async () => {
    if (!selectedLoadId) return;
    setCreating(true);
    try {
      await onCreate(selectedLoadId);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <div>
            <h2 className="font-black text-slate-900 text-lg">Create New Invoice</h2>
            <p className="text-xs text-slate-500">
              Only <span className="font-bold text-green-700">approved</span> loads appear here
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search container or customer..."
              className="w-full pl-10 pr-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {eligibleLoads.length === 0 ? (
            <div className="text-center py-12 text-slate-400 italic font-bold">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              No approved loads are ready for invoicing.
              <div className="text-xs font-normal mt-2">
                Go to <strong>Billing</strong> tab and click <strong>Approve</strong> first.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {eligibleLoads.map(load => (
                <label
                  key={load.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedLoadId === load.id
                      ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="load"
                    checked={selectedLoadId === load.id}
                    onChange={() => setSelectedLoadId(load.id)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="font-black text-slate-900">{load.containerNo || 'N/A'}</div>
                    <div className="text-xs text-slate-500">{load.customerName}</div>
                    {load.billingApprovedBy && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-green-700 font-bold">
                        <ShieldCheck className="w-3 h-3" />
                        Approved by {load.billingApprovedBy}
                        {load.billingApprovedAt && (
                          <span className="text-slate-400 font-normal ml-1">
                            · {formatDateTime(load.billingApprovedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">WO#</div>
                    <div className="text-xs font-bold text-slate-700">{load.workOrderNo || '—'}</div>
                  </div>
                  <span className="px-2 py-1 rounded-full text-[10px] font-black bg-green-100 text-green-700 border border-green-300 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Approved
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedLoadId || creating}
            className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== INVOICE DETAIL MODAL ==========
const InvoiceDetailModal = ({ invoice, customers, onSave, onClose, onEmail }) => {
  const [data, setData] = useState({ ...invoice });
  const [activeTab, setActiveTab] = useState('items');
  const [saving, setSaving] = useState(false);

  const updateField = (field, value) => setData(prev => ({ ...prev, [field]: value }));

  const updateItem = (index, field, value) => {
    setData(prev => {
      const items = [...(prev.items || [])];
      items[index] = { ...items[index], [field]: value };
      if (field === 'qty' || field === 'rate') {
        items[index].amount = safeFloat(items[index].qty) * safeFloat(items[index].rate);
      }
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setData(prev => ({
      ...prev,
      items: [...(prev.items || []), { item: '', details: '', qty: 1, uom: 'RATE', rate: 0, amount: 0, tax: 0 }]
    }));
  };

  const removeItem = (index) => {
    setData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const subtotal = (data.items || []).reduce((s, i) => s + safeFloat(i.amount), 0);
  const taxes = (data.items || []).reduce((s, i) => s + (safeFloat(i.amount) * safeFloat(i.tax) / 100), 0);
  const total = subtotal + taxes;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...data, subtotal, taxes, total });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[95vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <div>
            <h2 className="font-black text-slate-900 text-xl">Invoice #{data.invoiceNumber}</h2>
            <p className="text-xs text-slate-500">Edit invoice details below</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEmail(data)}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 flex items-center gap-2"
            >
              <Mail className="w-4 h-4" /> Email
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {data.billingApprovedBy && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-black text-green-800">Billing Approved</span>
                <span className="text-green-700 ml-2">
                  by <strong>{data.billingApprovedBy}</strong>
                  {data.billingApprovedAt && <> · {formatDateTime(data.billingApprovedAt)}</>}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Date</label>
              <input
                type="date"
                value={data.invoiceDate || ''}
                onChange={(e) => updateField('invoiceDate', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Status</label>
              <select
                value={data.status || 'Draft'}
                onChange={(e) => updateField('status', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1 bg-white"
              >
                <option value="Draft">Draft</option>
                <option value="Sent">Sent</option>
                <option value="Paid">Paid</option>
                <option value="Overdue">Overdue</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Type</label>
              <select
                value={data.type || 'Invoice'}
                onChange={(e) => updateField('type', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1 bg-white"
              >
                <option value="Invoice">Invoice</option>
                <option value="Credit Note">Credit Note</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Container</label>
              <input
                value={data.containerNo || ''}
                onChange={(e) => updateField('containerNo', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-mono mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Bill To</label>
              <input
                value={data.billTo || data.customerName || ''}
                onChange={(e) => updateField('billTo', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Sales Rep</label>
              <input
                value={data.salesRep || ''}
                onChange={(e) => updateField('salesRep', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Currency</label>
              <select
                value={data.currency || 'CAD'}
                onChange={(e) => updateField('currency', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1 bg-white"
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Payment Terms</label>
              <select
                value={data.paymentTerms || 'NET 30'}
                onChange={(e) => updateField('paymentTerms', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm font-bold mt-1 bg-white"
              >
                <option>Due on Receipt</option>
                <option>NET 15</option>
                <option>NET 30</option>
                <option>NET 45</option>
                <option>NET 60</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Due Date</label>
              <input
                type="date"
                value={data.dueDate || ''}
                onChange={(e) => updateField('dueDate', e.target.value)}
                className="w-full p-2 border rounded-xl text-sm mt-1"
              />
            </div>
          </div>

          <div className="flex gap-2 border-b">
            {['items', 'comments'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'items' ? 'Items' : 'Internal Comments'}
              </button>
            ))}
          </div>

          {activeTab === 'items' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-slate-800 text-sm">Line Items</h3>
                <button onClick={addItem} className="text-xs font-bold text-blue-600 hover:underline">
                  + Add Item
                </button>
              </div>
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Details</th>
                      <th className="px-3 py-2 text-center w-20">Qty</th>
                      <th className="px-3 py-2 text-center w-20">UOM</th>
                      <th className="px-3 py-2 text-right w-24">Rate</th>
                      <th className="px-3 py-2 text-right w-28">Amount</th>
                      <th className="px-3 py-2 text-center w-20">Tax %</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(data.items || []).map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <input
                            value={item.item || ''}
                            onChange={(e) => updateItem(i, 'item', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={item.details || ''}
                            onChange={(e) => updateItem(i, 'details', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs"
                            placeholder="Optional"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.qty || 1}
                            onChange={(e) => updateItem(i, 'qty', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs text-center"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={item.uom || ''}
                            onChange={(e) => updateItem(i, 'uom', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs text-center"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={item.rate || 0}
                            onChange={(e) => updateItem(i, 'rate', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs text-right"
                          />
                        </td>
                        <td className="px-3 py-2 font-bold text-right">
                          {formatCurrency(item.amount, data.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={item.tax || 0}
                            onChange={(e) => updateItem(i, 'tax', e.target.value)}
                            className="w-full border rounded-lg px-2 py-1 text-xs text-center"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeItem(i)} className="p-1 text-slate-400 hover:text-red-600">
                            <X className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Internal Comments</label>
              <textarea
                value={data.internalComments || ''}
                onChange={(e) => updateField('internalComments', e.target.value)}
                className="w-full mt-1 p-3 border rounded-xl text-sm min-h-[120px]"
                placeholder="Notes for your team (not visible to customer)..."
              />
            </div>
          )}

          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex justify-between text-sm font-bold">
                <span className="text-slate-500">Subtotal</span>
                <span>{formatCurrency(subtotal, data.currency)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-slate-500">Taxes</span>
                <span>{formatCurrency(taxes, data.currency)}</span>
              </div>
              <div className="flex justify-between text-lg font-black border-t pt-2">
                <span>Total</span>
                <span className="text-green-600">{formatCurrency(total, data.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== EMAIL INVOICE MODAL ==========
const EmailInvoiceModal = ({ invoice, companyId, companyName, companyDetails, companyLocations, setFeedback, onClose }) => {
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState(invoice.customerEmail || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(
    `Invoice: ${invoice.invoiceNumber}, Container: ${invoice.containerNo}, LC #: ${invoice.workOrderNo || ''}`
  );
  const [body, setBody] = useState(
    `Hello,

Please see attached invoice ${invoice.invoiceNumber} and POD for your reference for container ${invoice.containerNo}.

Should you have any questions please feel free to reach out.

Thank you,
${companyName || ''}
${companyDetails?.email || ''}
${companyDetails?.phone || ''}

This email contains confidential information and is for the exclusive use of the addressee/s. Any unauthorized copying, distribution or use of information contained in this email is prohibited.`
  );

  const handleSend = async () => {
    if (!to.trim()) { setFeedback?.('❌ Please enter recipient email'); return; }

    setSending(true);
    try {
      let locationAddress = null;
      if (invoice.locationId) {
        const loc = companyLocations.find(l => l.id === invoice.locationId);
        if (loc) {
          locationAddress = [loc.name, loc.address, loc.city, loc.province, loc.postalCode]
            .filter(Boolean).join(', ');
        }
      }
      if (!locationAddress) {
        locationAddress = [companyDetails?.address, companyDetails?.city, companyDetails?.postalCode]
          .filter(Boolean).join(', ');
      }

      const pdfBlob = await generateInvoicePDFBlob(invoice, companyName, companyDetails, locationAddress);
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('../firebase');
      const safeFileName = `Invoice_${invoice.invoiceNumber}.pdf`;
      const filePath = `invoices/${companyId}/${invoice.id}_${Date.now()}_${safeFileName}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' });
      const invoiceUrl = await getDownloadURL(storageRef);

      const attachments = [{ url: invoiceUrl, filename: safeFileName }];

      if (invoice.loadId) {
        try {
          const loadSnap = await getDoc(doc(db, 'companies', companyId, 'loads', invoice.loadId));
          if (loadSnap.exists()) {
            const load = loadSnap.data();
            if (load.signedPodDoc?.url) {
              attachments.push({ url: load.signedPodDoc.url, filename: `POD_${invoice.containerNo}.pdf` });
            }
          }
        } catch (e) { /* ignore */ }
      }

      const toList = to.split(',').map(s => s.trim()).filter(Boolean);
      const ccList = cc.split(',').map(s => s.trim()).filter(Boolean);
      const bccList = bcc.split(',').map(s => s.trim()).filter(Boolean);

      const sendFn = httpsCallable(getFunctions(), 'sendInvoiceEmail');
      await sendFn({
        companyId,
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        text: body,
        html: `<pre style="font-family: Arial; white-space: pre-wrap;">${DOMPurify.sanitize(body)}</pre>`,
        attachments,
      });

      await updateDoc(doc(db, 'companies', companyId, 'invoices', invoice.id), {
        status: 'Sent',
        sentAt: new Date().toISOString(),
        sentTo: toList,
        sentCc: ccList,
        sentBcc: bccList,
        invoiceUrl,
      }).catch(() => {});

      if (invoice.loadId) {
        await updateDoc(doc(db, 'companies', companyId, 'loads', invoice.loadId), {
          status: 'Paid',
          sentToCustomerAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).catch((e) => console.warn('Load status update failed:', e));
      }

      setFeedback?.('✅ Invoice sent — Load moved to History');
      onClose();
    } catch (err) {
      console.error('Send email error:', err);
      setFeedback?.('❌ Failed to send email: ' + (err.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <h2 className="font-black text-slate-900 text-lg">Send Invoice #{invoice.invoiceNumber}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
            <strong>From:</strong> {companyDetails?.email || 'Your configured accounting email'}
            <div className="text-[10px] mt-1">Configured in Settings → Email Setup</div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">To *</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer1@example.com, customer2@example.com"
              className="w-full p-3 border rounded-xl text-sm mt-1"
            />
            <p className="text-[10px] text-slate-400 mt-1">Separate multiple emails with commas</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">CC</label>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="w-full p-3 border rounded-xl text-sm mt-1"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">BCC</label>
              <input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                className="w-full p-3 border rounded-xl text-sm mt-1"
                placeholder="Optional"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full p-3 border rounded-xl text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full p-3 border rounded-xl text-sm mt-1 min-h-[200px] font-mono"
            />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
            <strong>Attachments:</strong> Invoice PDF (auto-generated) + Signed POD (if available)
          </div>
        </div>
        <div className="p-4 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send Email</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== BULK SEND PROGRESS MODAL (NaN% fixed + always-dismissible) ==========
const BulkSendProgressModal = ({ progress, onClose }) => {
  const total = Number(progress?.total) || 0;
  const current = Number(progress?.current) || 0;
  const isDone = progress?.isComplete === true || (total > 0 && current >= total);
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const sent = (progress?.results || []).filter(r => r.status === 'sent').length;
  const failed = (progress?.results || []).filter(r => r.status === 'failed').length;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"></div>
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden">
        <div className={`p-6 border-b ${isDone ? 'bg-green-50' : 'bg-blue-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDone ? 'bg-green-100' : 'bg-blue-100'}`}>
              {isDone ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <Send className="w-5 h-5 text-blue-600 animate-pulse" />
              )}
            </div>
            <div className="flex-1">
              <h2 className="font-black text-slate-900 text-lg">
                {isDone ? 'Bulk Send Complete' : 'Sending Invoices...'}
              </h2>
              <p className="text-xs text-slate-500">
                {current} of {total} processed
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              title={isDone ? 'Close' : 'Hide (sending continues in background)'}
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <div className="flex justify-between text-xs font-bold mb-2">
              <span className="text-slate-500">Progress</span>
              <span className="text-blue-600">{percent}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  isDone ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {!isDone && progress?.currentInvoice && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
              <div className="text-sm">
                <div className="font-bold text-blue-900">
                  Sending #{progress.currentInvoice.invoiceNumber}
                </div>
                <div className="text-xs text-blue-700">
                  {progress.currentInvoice.customerName} — {progress.currentInvoice.containerNo}
                </div>
              </div>
            </div>
          )}

          {isDone && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-green-700">{sent}</div>
                  <div className="text-[10px] font-black text-green-600 uppercase">Sent</div>
                </div>
                <div className={`${failed > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'} border rounded-xl p-3 text-center`}>
                  <div className={`text-2xl font-black ${failed > 0 ? 'text-red-700' : 'text-slate-400'}`}>{failed}</div>
                  <div className={`text-[10px] font-black uppercase ${failed > 0 ? 'text-red-600' : 'text-slate-400'}`}>Failed</div>
                </div>
              </div>

              {progress.results?.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
                  <div className="text-[10px] font-black text-slate-500 uppercase p-3 border-b">
                    Results
                  </div>
                  <div className="divide-y">
                    {progress.results.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          {r.status === 'sent' ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                          )}
                          <span className="font-bold text-slate-700">#{r.invoiceNumber}</span>
                          <span className="text-slate-500">· {r.customerName}</span>
                        </div>
                        {r.status === 'failed' && (
                          <span className="text-[10px] text-red-600 italic truncate max-w-[120px]" title={r.error}>
                            {r.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
              >
                Done
              </button>
            </>
          )}

          {!isDone && (
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 transition-colors"
            >
              Hide (sending continues in background)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InvoicesModule;