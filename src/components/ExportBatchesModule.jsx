// src/components/ExportBatchesModule.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText, Plus, X, Download, Trash2, Loader2, CheckCircle,
  AlertCircle, Calendar, Search, Building, FileSpreadsheet,
  ChevronDown, RefreshCw, ShieldCheck, Package
} from 'lucide-react';
import {
  collection, query, onSnapshot, orderBy, limit, doc,
  addDoc, deleteDoc, getDoc, getDocs, where, writeBatch, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';

// ---------- HELPERS ----------
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

const padBatchNumber = (n) => String(n).padStart(9, '0');

// QuickBooks CSV date format: DD/MM/YYYY
const formatQBDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const getTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ---------- CSV ESCAPING ----------
const csvEscape = (val) => {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

// ---------- QUICKBOOKS CSV BUILDER ----------
const buildQuickBooksCSV = (batch) => {
  const headers = [
    '*InvoiceNo',
    '*Customer',
    'InvoiceDate',
    '*DueDate',
    'Terms',
    'Item(Product/Service)',
    'ItemDescription',
    'ItemQuantity',
    'ItemRate',
    '*ItemAmount',
    'Memo',
    '*ItemTaxCode',
  ];

  const rows = [headers.join(',')];

  (batch.invoices || []).forEach(inv => {
    const items = inv.items && inv.items.length > 0
      ? inv.items
      : [{ item: 'Freight Charge', details: '', qty: 1, rate: safeFloat(inv.total), amount: safeFloat(inv.total), tax: 0 }];

    items.forEach((item, idx) => {
      const isFirst = idx === 0;
      const row = [
        csvEscape(inv.invoiceNumber),
        csvEscape(isFirst ? inv.customerName : ''),
        csvEscape(isFirst ? formatQBDate(inv.invoiceDate) : ''),
        csvEscape(isFirst ? formatQBDate(inv.dueDate) : ''),
        csvEscape(isFirst ? (inv.paymentTerms || 'NET 30') : ''),
        csvEscape(item.item || 'Service'),
        csvEscape(item.details || ''),
        csvEscape(safeFloat(item.qty || 1)),
        csvEscape(safeFloat(item.rate).toFixed(2)),
        csvEscape(safeFloat(item.amount).toFixed(2)),
        csvEscape(`Internal ref #${inv.invoiceNumber}`),
        csvEscape(item.tax ? (item.tax / 100).toFixed(4) : '0.05'),
      ];
      rows.push(row.join(','));
    });
  });

  return rows.join('\n');
};

// ---------- MAIN COMPONENT ----------
const ExportBatchesModule = ({
  companyId,
  companyName,
  userEmail,
  setFeedback,
}) => {
  const [batches, setBatches] = useState([]);
  const [loads, setLoads] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);

  // ---- Listen to batches ----
  useEffect(() => {
    if (!companyId) return;
    const q = query(
      collection(db, 'companies', companyId, 'exportBatches'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error('Batches listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [companyId]);

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
    }, (err) => console.error('Invoices listener error:', err));
    return () => unsub();
  }, [companyId]);

  // ---- Listen to loads (to know their exportBatchId) ----
  useEffect(() => {
    if (!companyId) return;
    const q = query(
      collection(db, 'companies', companyId, 'loads'),
      where('billingApproved', '==', true),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      setLoads(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Loads listener error:', err));
    return () => unsub();
  }, [companyId]);

  // ---- Eligible invoices: any invoice that hasn't been batched yet ----
  // ✅ Includes Draft, Sent, Paid, Overdue — everything except Cancelled.
  const eligibleInvoices = useMemo(() => {
    const batchedIds = new Set();
    batches.forEach(b => {
      (b.invoices || []).forEach(inv => {
        if (inv.invoiceId) batchedIds.add(inv.invoiceId);
      });
    });

    return invoices.filter(inv => {
      if (batchedIds.has(inv.id)) return false;
      const status = inv.status || 'Draft';
      if (status === 'Cancelled') return false;
      return true;
    });
  }, [invoices, batches]);

  // ---- Create batch ----
  const handleCreateBatch = async (selectedInvoiceIds, batchDate, notes) => {
    if (!companyId || selectedInvoiceIds.length === 0) return;

    try {
      setFeedback?.('⏳ Creating export batch...');

      const counterRef = doc(db, 'companies', companyId, 'counters', 'exportBatches');
      const counterSnap = await getDoc(counterRef);
      let nextSeq = 1001;
      if (counterSnap.exists()) {
        nextSeq = (counterSnap.data().lastNumber || 1000) + 1;
        await updateDoc(counterRef, { lastNumber: nextSeq, updatedAt: new Date().toISOString() });
      } else {
        await setDoc(counterRef, { lastNumber: nextSeq, createdAt: new Date().toISOString() });
      }

      const batchNumber = padBatchNumber(nextSeq);

      const selectedInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
      if (selectedInvoices.length === 0) {
        setFeedback?.('❌ No invoices selected');
        return;
      }

      const currency = selectedInvoices[0].currency || 'CAD';
      const invoiceSnapshots = selectedInvoices.map(inv => ({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName || inv.billTo || 'N/A',
        customerEmail: inv.customerEmail || '',
        containerNo: inv.containerNo || '',
        workOrderNo: inv.workOrderNo || '',
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        paymentTerms: inv.paymentTerms || 'NET 30',
        currency: inv.currency || 'CAD',
        subtotal: safeFloat(inv.subtotal),
        taxes: safeFloat(inv.taxes),
        total: safeFloat(inv.total),
        loadId: inv.loadId || null,
        items: (inv.items || []).map(it => ({
          item: it.item || 'Service',
          details: it.details || '',
          qty: safeFloat(it.qty || 1),
          rate: safeFloat(it.rate),
          amount: safeFloat(it.amount),
          tax: safeFloat(it.tax || 0),
          uom: it.uom || 'RATE',
        })),
      }));

      const subtotal = invoiceSnapshots.reduce((s, i) => s + i.subtotal, 0);
      const taxes = invoiceSnapshots.reduce((s, i) => s + i.taxes, 0);
      const total = subtotal + taxes;
      const loadIds = invoiceSnapshots.map(i => i.loadId).filter(Boolean);

      const batchRef = await addDoc(collection(db, 'companies', companyId, 'exportBatches'), {
        batchNumber,
        sequence: nextSeq,
        date: batchDate || getTodayStr(),
        currency,
        subtotal,
        taxes,
        total,
        invoiceCount: invoiceSnapshots.length,
        notes: notes || '',
        division: '',
        invoices: invoiceSnapshots,
        loadIds,
        status: 'Exported',
        createdBy: userEmail || 'N/A',
        createdAt: new Date().toISOString(),
        exportedAt: new Date().toISOString(),
      });

      const firestoreBatch = writeBatch(db);
      loadIds.forEach(loadId => {
        const loadRef = doc(db, 'companies', companyId, 'loads', loadId);
        firestoreBatch.update(loadRef, {
          exportBatchId: batchRef.id,
          exportBatchNumber: batchNumber,
          exportedToQuickBooks: true,
          exportedAt: new Date().toISOString(),
        });
      });
      await firestoreBatch.commit();

      setFeedback?.(`✅ Batch ${batchNumber} created with ${invoiceSnapshots.length} invoices`);
      setShowCreateModal(false);
      return batchRef.id;
    } catch (err) {
      console.error('Create batch error:', err);
      setFeedback?.('❌ Failed to create batch: ' + err.message);
    }
  };

  // ---- Delete batch ----
  const handleDeleteBatch = async (batch) => {
    if (!window.confirm(
      `Delete batch ${batch.batchNumber}?\n\n` +
      `This will UN-mark the ${batch.invoiceCount} invoices in it, so they can be re-batched.\n` +
      `This does NOT delete the invoices themselves.`
    )) return;

    try {
      if (batch.loadIds && batch.loadIds.length > 0) {
        const firestoreBatch = writeBatch(db);
        batch.loadIds.forEach(loadId => {
          const loadRef = doc(db, 'companies', companyId, 'loads', loadId);
          firestoreBatch.update(loadRef, {
            exportBatchId: null,
            exportBatchNumber: null,
            exportedToQuickBooks: false,
          });
        });
        await firestoreBatch.commit();
      }

      await deleteDoc(doc(db, 'companies', companyId, 'exportBatches', batch.id));
      setFeedback?.(`✅ Batch ${batch.batchNumber} deleted`);
    } catch (err) {
      console.error('Delete batch error:', err);
      setFeedback?.('❌ Failed to delete batch: ' + err.message);
    }
  };

  // ---- Export batch as QuickBooks CSV ----
  const handleExportQuickBooks = (batch) => {
    try {
      const csv = buildQuickBooksCSV(batch);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Export_Batch_${batch.batchNumber}_QuickBooks.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedback?.(`✅ Downloaded batch ${batch.batchNumber} for QuickBooks`);
    } catch (err) {
      console.error('Export error:', err);
      setFeedback?.('❌ Export failed: ' + err.message);
    }
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
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            Export Batches
          </h2>
          <p className="text-sm text-slate-500">
            Group invoices into batches and export to QuickBooks — never export the same invoice twice
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={eligibleInvoices.length === 0}
          className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create Batch
          {eligibleInvoices.length > 0 && (
            <span className="ml-1 bg-white text-emerald-700 text-xs font-black px-2 py-0.5 rounded-full">
              {eligibleInvoices.length}
            </span>
          )}
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase">Total Batches</div>
          <div className="text-2xl font-black text-slate-900">{batches.length}</div>
        </div>
        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-sm">
          <div className="text-[10px] font-black text-emerald-600 uppercase">Eligible to Batch</div>
          <div className="text-2xl font-black text-emerald-700">{eligibleInvoices.length}</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
          <div className="text-[10px] font-black text-blue-600 uppercase">Total Exported</div>
          <div className="text-2xl font-black text-blue-700">
            {batches.reduce((s, b) => s + (b.invoiceCount || 0), 0)}
          </div>
        </div>
        <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 shadow-sm">
          <div className="text-[10px] font-black text-purple-600 uppercase">Total Value</div>
          <div className="text-2xl font-black text-purple-700">
            C${batches.reduce((s, b) => s + safeFloat(b.total), 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* BATCH LIST */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Taxes</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center"># Invoices</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-12 text-center text-slate-400 font-bold italic">
                    No export batches yet. Click "Create Batch" to get started.
                  </td>
                </tr>
              ) : (
                batches.map(batch => (
                  <tr
                    key={batch.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedBatch(batch)}
                  >
                    <td className="px-4 py-3 font-black text-slate-900 font-mono">
                      {batch.batchNumber}
                    </td>
                    <td className="px-4 py-3 text-sm">{formatDate(batch.date)}</td>
                    <td className="px-4 py-3 text-sm font-bold">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                        batch.currency === 'USD' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {batch.currency || 'CAD'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {formatCurrency(batch.subtotal, batch.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {batch.taxes > 0 ? formatCurrency(batch.taxes, batch.currency) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-emerald-700">
                      {formatCurrency(batch.total, batch.currency)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-700">
                      {batch.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 italic">
                      {batch.notes || '—'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleExportQuickBooks(batch)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                          title="Export to QuickBooks CSV"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBatch(batch)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete batch"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* CREATE BATCH MODAL */}
      {showCreateModal && (
        <CreateBatchModal
          eligibleInvoices={eligibleInvoices}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateBatch}
          companyName={companyName}
        />
      )}

      {/* BATCH DETAIL MODAL */}
      {selectedBatch && (
        <BatchDetailModal
          batch={selectedBatch}
          onClose={() => setSelectedBatch(null)}
          onExport={handleExportQuickBooks}
        />
      )}
    </div>
  );
};

// ---------- CREATE BATCH MODAL ----------
const CreateBatchModal = ({ eligibleInvoices, onClose, onCreate, companyName }) => {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchDate, setBatchDate] = useState(getTodayStr());
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = [...eligibleInvoices];
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(inv =>
        (inv.invoiceNumber || '').toLowerCase().includes(t) ||
        (inv.customerName || '').toLowerCase().includes(t) ||
        (inv.containerNo || '').toLowerCase().includes(t)
      );
    }
    return list;
  }, [eligibleInvoices, search]);

  const allSelected = filtered.length > 0 && filtered.every(inv => selectedIds.has(inv.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(i => i.id)));
  };

  const selectedTotal = eligibleInvoices
    .filter(inv => selectedIds.has(inv.id))
    .reduce((s, inv) => s + safeFloat(inv.total), 0);

  const handleCreate = async () => {
    if (selectedIds.size === 0) return;
    setCreating(true);
    try {
      await onCreate(Array.from(selectedIds), batchDate, notes);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <div>
            <h2 className="font-black text-slate-900 text-lg">Create Export Batch</h2>
            <p className="text-xs text-slate-500">
              Select invoices to group into a QuickBooks export batch. Once batched, they can't be batched again.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b bg-white grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">Batch Date</label>
            <input
              type="date"
              value={batchDate}
              onChange={(e) => setBatchDate(e.target.value)}
              className="w-full p-2 border rounded-xl text-sm font-bold mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-black text-slate-500 uppercase">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. September month-end batch"
              className="w-full p-2 border rounded-xl text-sm mt-1"
            />
          </div>
        </div>

        <div className="p-4 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice #, customer, container..."
              className="w-full pl-10 pr-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400 italic font-bold">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              No eligible invoices to batch.
              <div className="text-xs font-normal mt-2">
                All invoices have already been batched, or none are approved yet.
              </div>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <button onClick={toggleAll} className="p-1">
                      {allSelected ? (
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <div className="w-4 h-4 border-2 border-slate-300 rounded" />
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Container</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(inv => (
                  <tr
                    key={inv.id}
                    className={`cursor-pointer hover:bg-slate-50 ${selectedIds.has(inv.id) ? 'bg-emerald-50' : ''}`}
                    onClick={() => toggleSelect(inv.id)}
                  >
                    <td className="px-3 py-3">
                      {selectedIds.has(inv.id) ? (
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <div className="w-4 h-4 border-2 border-slate-300 rounded" />
                      )}
                    </td>
                    <td className="px-3 py-3 font-black text-slate-900">#{inv.invoiceNumber}</td>
                    <td className="px-3 py-3 text-sm">{inv.customerName || '—'}</td>
                    <td className="px-3 py-3 text-sm font-mono">{inv.containerNo || '—'}</td>
                    <td className="px-3 py-3 text-sm">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                        inv.status === 'Sent'      ? 'bg-blue-100 text-blue-700 border-blue-300' :
                        inv.status === 'Paid'      ? 'bg-green-100 text-green-700 border-green-300' :
                        inv.status === 'Overdue'   ? 'bg-red-100 text-red-700 border-red-300' :
                                                     'bg-slate-100 text-slate-700 border-slate-300'
                      }`}>
                        {inv.status || 'Draft'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-emerald-700">
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-black text-slate-700">{selectedIds.size}</span>
            <span className="text-slate-500"> invoices selected · </span>
            <span className="font-black text-emerald-700">C${selectedTotal.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!someSelected || creating}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              ) : (
                <>Create Batch ({selectedIds.size})</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- BATCH DETAIL MODAL ----------
const BatchDetailModal = ({ batch, onClose, onExport }) => {
  const [showExportMenu, setShowExportMenu] = useState(false);

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-5xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[95vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-start gap-4 flex-wrap">
          <div>
            <h2 className="font-black text-slate-900 text-xl">
              Export batch: <span className="font-mono">{batch.batchNumber}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Created {formatDate(batch.createdAt)} by {batch.createdBy || 'N/A'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md"
              >
                <Download className="w-4 h-4" />
                Export
                <ChevronDown className="w-4 h-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                  <button
                    onClick={() => { onExport(batch); setShowExportMenu(false); }}
                    className="w-full px-4 py-3 text-left hover:bg-emerald-50 transition-colors text-sm font-bold text-slate-700 border-b border-slate-100"
                  >
                    QuickBooks (CSV)
                  </button>
                  <button
                    onClick={() => { alert('Sage 50 export coming soon'); setShowExportMenu(false); }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors text-sm text-slate-500 border-b border-slate-100"
                    disabled
                  >
                    Sage 50 (coming soon)
                  </button>
                  <button
                    onClick={() => { alert('QuickBooks IIF export coming soon'); setShowExportMenu(false); }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors text-sm text-slate-500"
                    disabled
                  >
                    QuickBooks (IIF) (coming soon)
                  </button>
                </div>
              )}
            </div>

            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 md:grid-cols-6 gap-4 bg-white border-b">
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Number</div>
            <div className="font-black text-slate-900 font-mono">{batch.batchNumber}</div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Date</div>
            <div className="font-bold text-slate-900">{formatDate(batch.date)}</div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Currency</div>
            <div className="font-bold text-slate-900">{batch.currency}</div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Subtotal</div>
            <div className="font-bold text-slate-900">{formatCurrency(batch.subtotal, batch.currency)}</div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Taxes</div>
            <div className="font-bold text-slate-900">{formatCurrency(batch.taxes, batch.currency)}</div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">Total</div>
            <div className="font-black text-emerald-700">{formatCurrency(batch.total, batch.currency)}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Sales invoice</th>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Taxes</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(batch.invoices || []).map((inv, i) => (
                <tr key={inv.invoiceId || i} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">
                    {inv.customerName || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono">
                    #{inv.invoiceNumber} ({formatDate(inv.invoiceDate)})
                  </td>
                  <td className="px-4 py-3 text-sm font-mono">{inv.containerNo || '—'}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold">
                    {safeFloat(inv.subtotal).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-slate-500">
                    {safeFloat(inv.taxes).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-black text-emerald-700">
                    {safeFloat(inv.total).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExportBatchesModule;