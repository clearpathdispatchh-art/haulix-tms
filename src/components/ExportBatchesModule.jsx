// src/components/ExportBatchesModule.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText, Plus, X, Download, Trash2, Loader2, CheckCircle,
  AlertCircle, Calendar, Search, Building, FileSpreadsheet,
  ChevronDown, RefreshCw, ShieldCheck, Package, Scissors, Edit3, Layers, ArrowRightLeft
} from 'lucide-react';
import {
  collection, query, onSnapshot, orderBy, limit, doc,
  addDoc, deleteDoc, getDoc, getDocs, where, writeBatch, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import * as XLSX from 'xlsx';

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

// ---------- QUICKBOOKS EXCEL ROW BUILDER ----------
const buildQuickBooksRows = (invoices) => {
  const rows = [];

  invoices.forEach(inv => {
    const items = inv.items && inv.items.length > 0
      ? inv.items
      : [{ item: 'Freight Charge', details: '', qty: 1, rate: safeFloat(inv.total), amount: safeFloat(inv.total), tax: 0 }];

    items.forEach((item, idx) => {
      const isFirst = idx === 0;
      rows.push({
        '*InvoiceNo': inv.invoiceNumber,
        '*Customer': isFirst ? (inv.customerName || 'N/A') : '',
        'InvoiceDate': isFirst ? formatQBDate(inv.invoiceDate) : '',
        '*DueDate': isFirst ? formatQBDate(inv.dueDate) : '',
        'Terms': isFirst ? (inv.paymentTerms || 'NET 30') : '',
        'Item(Product/Service)': item.item || 'Service',
        'ItemDescription': item.details || '',
        'ItemQuantity': safeFloat(item.qty || 1),
        'ItemRate': safeFloat(item.rate).toFixed(2),
        '*ItemAmount': safeFloat(item.amount).toFixed(2),
        'Memo': `Internal ref #${inv.invoiceNumber}`,
        '*ItemTaxCode': item.tax ? (item.tax / 100).toFixed(4) : '0.05'
      });
    });
  });

  return rows;
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
  const [splittingBatchId, setSplittingBatchId] = useState(null);

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

  // ---- Listen to loads ----
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

  // ---- Eligible invoices ----
  const eligibleInvoices = useMemo(() => {
    const batchedIds = new Set();
    batches.forEach(b => {
      (b.invoices || []).forEach(inv => {
        if (inv.invoiceId) batchedIds.add(inv.invoiceId);
      });
    });

    return invoices.filter(inv => {
      if (batchedIds.has(inv.id)) return false;

      // ✅ THE FIX: Only allow invoices that have been sent or paid. 
      // Draft invoices are strictly BLOCKED from being batched.
      const status = (inv.status || 'Draft').toLowerCase();
      if (status === 'cancelled' || status === 'draft' || status === 'pending') {
        return false;
      }

      return true;
    });
  }, [invoices, batches]);

  // ---- Create batch ----
  const handleCreateBatch = async (selectedInvoiceIds, batchDate, notes) => {
    if (!companyId || selectedInvoiceIds.length === 0) return;

    const selectedInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    if (selectedInvoices.length === 0) {
      setFeedback?.('❌ No invoices selected');
      return;
    }

    const currencies = new Set(selectedInvoices.map(inv => inv.currency || 'CAD'));
    if (currencies.size > 1) {
      setFeedback?.('❌ Cannot mix CAD and USD invoices in one batch. Please create separate batches for each currency.');
      return;
    }

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
      const currency = Array.from(currencies)[0];

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

      setFeedback?.(`✅ Batch ${batchNumber} created with ${invoiceSnapshots.length} invoices (${currency})`);
      setShowCreateModal(false);
      return batchRef.id;
    } catch (err) {
      console.error('Create batch error:', err);
      setFeedback?.('❌ Failed to create batch: ' + err.message);
    }
  };

  // ---- 🆕 MERGE BATCHES ----
  const handleMergeBatch = async (sourceBatch) => {
    const targetBatchNumber = window.prompt(
      `Enter the Batch Number you want to merge batch ${sourceBatch.batchNumber} INTO:\n(e.g., 000001008)`
    );
    if (!targetBatchNumber) return;

    const targetBatch = batches.find(b => b.batchNumber === targetBatchNumber.trim());
    if (!targetBatch) {
      alert("❌ Target batch not found. Please check the batch number.");
      return;
    }
    if (targetBatch.id === sourceBatch.id) {
      alert("⚠️ You cannot merge a batch into itself.");
      return;
    }
    if (targetBatch.currency !== sourceBatch.currency) {
      alert(`⚠️ Currency mismatch! Batch ${sourceBatch.batchNumber} is ${sourceBatch.currency}, but batch ${targetBatch.batchNumber} is ${targetBatch.currency}. You can only merge batches of the same currency.`);
      return;
    }

    if (!window.confirm(`Merge ${sourceBatch.invoiceCount} invoice(s) from ${sourceBatch.batchNumber} into ${targetBatch.batchNumber}?\n\nBatch ${sourceBatch.batchNumber} will be permanently deleted.`)) return;

    try {
      setFeedback?.('⏳ Merging batches...');

      const combinedInvoices = [...(targetBatch.invoices || []), ...(sourceBatch.invoices || [])];
      const newSubtotal = combinedInvoices.reduce((s, i) => s + safeFloat(i.subtotal), 0);
      const newTaxes = combinedInvoices.reduce((s, i) => s + safeFloat(i.taxes), 0);
      const newTotal = newSubtotal + newTaxes;

      const targetRef = doc(db, 'companies', companyId, 'exportBatches', targetBatch.id);
      await updateDoc(targetRef, {
        invoices: combinedInvoices,
        invoiceCount: combinedInvoices.length,
        subtotal: newSubtotal,
        taxes: newTaxes,
        total: newTotal,
        updatedAt: new Date().toISOString()
      });

      const loadIdsToUpdate = (sourceBatch.invoices || []).map(i => i.loadId).filter(Boolean);
      if (loadIdsToUpdate.length > 0) {
        const fb = writeBatch(db);
        loadIdsToUpdate.forEach(loadId => {
          fb.update(doc(db, 'companies', companyId, 'loads', loadId), {
            exportBatchId: targetBatch.id,
            exportBatchNumber: targetBatch.batchNumber,
          });
        });
        await fb.commit();
      }

      await deleteDoc(doc(db, 'companies', companyId, 'exportBatches', sourceBatch.id));
      setFeedback?.(`✅ Successfully merged ${sourceBatch.batchNumber} into ${targetBatch.batchNumber}!`);
      if (selectedBatch?.id === sourceBatch.id) setSelectedBatch(null);
    } catch (err) {
      console.error('Merge batch error:', err);
      setFeedback?.('❌ Failed to merge batches: ' + err.message);
    }
  };

  // ---- 🆕 MOVE SINGLE INVOICE ----
  const handleMoveInvoice = async (sourceBatch, invoiceId) => {
    const targetBatchNumber = window.prompt(`Enter the Batch Number to move this invoice INTO:`);
    if (!targetBatchNumber) return;

    const targetBatch = batches.find(b => b.batchNumber === targetBatchNumber.trim());
    if (!targetBatch) return alert("❌ Target batch not found.");
    if (targetBatch.id === sourceBatch.id) return alert("⚠️ Invoice is already in this batch.");
    if (targetBatch.currency !== sourceBatch.currency) {
      return alert(`⚠️ Cannot move to a ${targetBatch.currency} batch because this batch is ${sourceBatch.currency}.`);
    }

    try {
      setFeedback?.('⏳ Moving invoice...');
      
      const invoiceToMove = sourceBatch.invoices.find(i => i.invoiceId === invoiceId);
      if (!invoiceToMove) return;

      const newTargetInvoices = [...(targetBatch.invoices || []), invoiceToMove];
      const newTargetTotal = newTargetInvoices.reduce((s, i) => s + safeFloat(i.total), 0);
      await updateDoc(doc(db, 'companies', companyId, 'exportBatches', targetBatch.id), {
        invoices: newTargetInvoices,
        invoiceCount: newTargetInvoices.length,
        total: newTargetTotal,
        subtotal: newTargetTotal,
        updatedAt: new Date().toISOString()
      });

      const newSourceInvoices = sourceBatch.invoices.filter(i => i.invoiceId !== invoiceId);
      const newSourceTotal = newSourceInvoices.reduce((s, i) => s + safeFloat(i.total), 0);
      await updateDoc(doc(db, 'companies', companyId, 'exportBatches', sourceBatch.id), {
        invoices: newSourceInvoices,
        invoiceCount: newSourceInvoices.length,
        total: newSourceTotal,
        subtotal: newSourceTotal,
        updatedAt: new Date().toISOString()
      });

      if (invoiceToMove.loadId) {
        await updateDoc(doc(db, 'companies', companyId, 'loads', invoiceToMove.loadId), {
          exportBatchId: targetBatch.id,
          exportBatchNumber: targetBatch.batchNumber,
        });
      }

      setFeedback?.(`✅ Invoice moved to ${targetBatch.batchNumber}`);
      setSelectedBatch({...sourceBatch, invoices: newSourceInvoices, invoiceCount: newSourceInvoices.length, total: newSourceTotal, subtotal: newSourceTotal});
    } catch (err) {
      console.error(err);
      setFeedback?.('❌ Failed to move invoice');
    }
  };

  // ---- Sync ----
  const handleSyncBatch = async (batch) => {
    if (!companyId) return;
    setFeedback?.('⏳ Syncing batch with latest invoice data...');

    try {
      let updatedInvoices = [];
      let changed = false;

      for (const invSnapshot of batch.invoices || []) {
        if (!invSnapshot.invoiceId) {
           updatedInvoices.push(invSnapshot);
           continue;
        }

        const invRef = doc(db, 'companies', companyId, 'invoices', invSnapshot.invoiceId);
        const invSnap = await getDoc(invRef);

        if (invSnap.exists()) {
          const latestInv = invSnap.data();
          const newCurrency = latestInv.currency || 'CAD';
          const newSubtotal = safeFloat(latestInv.subtotal);
          const newTaxes = safeFloat(latestInv.taxes);
          const newTotal = safeFloat(latestInv.total);

          if (invSnapshot.currency !== newCurrency || invSnapshot.total !== newTotal) changed = true;

          updatedInvoices.push({
            ...invSnapshot,
            currency: newCurrency,
            subtotal: newSubtotal,
            taxes: newTaxes,
            total: newTotal,
            items: (latestInv.items || []).map(it => ({
              item: it.item || 'Service',
              details: it.details || '',
              qty: safeFloat(it.qty || 1),
              rate: safeFloat(it.rate),
              amount: safeFloat(it.amount),
              tax: safeFloat(it.tax || 0),
              uom: it.uom || 'RATE',
            })),
          });
        } else {
          updatedInvoices.push(invSnapshot);
        }
      }

      if (!changed) {
        setFeedback?.('✅ Batch is already up to date with the latest invoice data.');
        return;
      }

      const newSubtotal = updatedInvoices.reduce((s, i) => s + safeFloat(i.subtotal), 0);
      const newTaxes = updatedInvoices.reduce((s, i) => s + safeFloat(i.taxes), 0);
      const newTotal = newSubtotal + newTaxes;
      const currencies = new Set(updatedInvoices.map(i => i.currency || 'CAD'));
      const newCurrency = currencies.size === 1 ? Array.from(currencies)[0] : 'MIXED';

      const batchRef = doc(db, 'companies', companyId, 'exportBatches', batch.id);
      await updateDoc(batchRef, {
        invoices: updatedInvoices,
        subtotal: newSubtotal,
        taxes: newTaxes,
        total: newTotal,
        currency: newCurrency,
        updatedAt: new Date().toISOString()
      });

      setFeedback?.(`✅ Batch synced! Currency is now ${newCurrency}.`);
      setSelectedBatch(prev => prev ? { ...prev, invoices: updatedInvoices, subtotal: newSubtotal, taxes: newTaxes, total: newTotal, currency: newCurrency } : null);

    } catch (err) {
      console.error('Sync batch error:', err);
      setFeedback?.('❌ Failed to sync batch: ' + err.message);
    }
  };

  // ---- Manual Currency Override ----
  const handleUpdateInvoiceCurrency = async (batch, invoiceId, newCurrency) => {
    try {
      const updatedInvoices = batch.invoices.map(inv => {
        if (inv.invoiceId === invoiceId) {
          return { ...inv, currency: newCurrency };
        }
        return inv;
      });

      const currencies = new Set(updatedInvoices.map(i => i.currency || 'CAD'));
      const newBatchCurrency = currencies.size === 1 ? Array.from(currencies)[0] : 'MIXED';

      const batchRef = doc(db, 'companies', companyId, 'exportBatches', batch.id);
      await updateDoc(batchRef, {
        invoices: updatedInvoices,
        currency: newBatchCurrency,
        updatedAt: new Date().toISOString()
      });

      const invRef = doc(db, 'companies', companyId, 'invoices', invoiceId);
      await updateDoc(invRef, { currency: newCurrency }).catch(console.error);

      const invSnapshot = batch.invoices.find(i => i.invoiceId === invoiceId);
      if (invSnapshot && invSnapshot.loadId) {
        const loadRef = doc(db, 'companies', companyId, 'loads', invSnapshot.loadId);
        await updateDoc(loadRef, { currency: newCurrency }).catch(console.error);
      }

      setFeedback?.(`✅ Changed invoice to ${newCurrency}. Batch is now ${newBatchCurrency}.`);
      setSelectedBatch(prev => ({ ...prev, invoices: updatedInvoices, currency: newBatchCurrency }));
    } catch (err) {
      console.error('Update currency error:', err);
      setFeedback?.('❌ Failed to update currency: ' + err.message);
    }
  };

  // ---- Split ----
  const handleSplitBatch = async (batch) => {
    if (!companyId || !batch) return;

    const allInvoices = batch.invoices || [];
    const cadInvoices = allInvoices.filter(inv => (inv.currency || 'CAD') === 'CAD');
    const usdInvoices = allInvoices.filter(inv => inv.currency === 'USD');

    if (cadInvoices.length === 0 || usdInvoices.length === 0) {
      setFeedback?.('⚠️ This batch contains only one currency — no split needed.');
      return;
    }

    const confirmed = window.confirm(
      `Split batch ${batch.batchNumber} into two separate batches?\n\n` +
      `🇨🇦 CAD Batch: ${cadInvoices.length} invoice(s)\n` +
      `🇺🇸 USD Batch: ${usdInvoices.length} invoice(s)`
    );
    if (!confirmed) return;

    setSplittingBatchId(batch.id);
    try {
      setFeedback?.('⏳ Splitting batch...');

      const counterRef = doc(db, 'companies', companyId, 'counters', 'exportBatches');
      const counterSnap = await getDoc(counterRef);
      let nextSeq = counterSnap.exists() ? (counterSnap.data().lastNumber || 1000) + 1 : 1001;

      const calcTotals = (invoices) => {
        const subtotal = invoices.reduce((s, i) => s + safeFloat(i.subtotal), 0);
        const taxes = invoices.reduce((s, i) => s + safeFloat(i.taxes), 0);
        return { subtotal, taxes, total: subtotal + taxes };
      };

      // CAD
      const cadBatchNumber = padBatchNumber(nextSeq);
      const cadTotals = calcTotals(cadInvoices);
      const cadBatchRef = await addDoc(collection(db, 'companies', companyId, 'exportBatches'), {
          batchNumber: cadBatchNumber, sequence: nextSeq, date: batch.date, currency: 'CAD',
          subtotal: cadTotals.subtotal, taxes: cadTotals.taxes, total: cadTotals.total,
          invoiceCount: cadInvoices.length, notes: `${batch.notes || ''} [Split]`.trim(), division: '',
          invoices: cadInvoices, loadIds: cadInvoices.map(i => i.loadId).filter(Boolean),
          status: 'Exported', createdBy: userEmail || 'N/A',
          createdAt: new Date().toISOString(), exportedAt: new Date().toISOString(),
      });
      nextSeq++;

      // USD
      const usdBatchNumber = padBatchNumber(nextSeq);
      const usdTotals = calcTotals(usdInvoices);
      const usdBatchRef = await addDoc(collection(db, 'companies', companyId, 'exportBatches'), {
          batchNumber: usdBatchNumber, sequence: nextSeq, date: batch.date, currency: 'USD',
          subtotal: usdTotals.subtotal, taxes: usdTotals.taxes, total: usdTotals.total,
          invoiceCount: usdInvoices.length, notes: `${batch.notes || ''} [Split]`.trim(), division: '',
          invoices: usdInvoices, loadIds: usdInvoices.map(i => i.loadId).filter(Boolean),
          status: 'Exported', createdBy: userEmail || 'N/A',
          createdAt: new Date().toISOString(), exportedAt: new Date().toISOString(),
      });

      await updateDoc(counterRef, { lastNumber: nextSeq, updatedAt: new Date().toISOString() });

      const fb = writeBatch(db);
      cadInvoices.forEach(inv => { if (inv.loadId) fb.update(doc(db, 'companies', companyId, 'loads', inv.loadId), { exportBatchId: cadBatchRef.id, exportBatchNumber: cadBatchNumber }); });
      usdInvoices.forEach(inv => { if (inv.loadId) fb.update(doc(db, 'companies', companyId, 'loads', inv.loadId), { exportBatchId: usdBatchRef.id, exportBatchNumber: usdBatchNumber }); });
      await fb.commit();

      await deleteDoc(doc(db, 'companies', companyId, 'exportBatches', batch.id));
      setFeedback?.(`✅ Split complete!`);
      setSelectedBatch(null);
    } catch (err) {
      console.error('Split batch error:', err);
      setFeedback?.('❌ Failed to split batch: ' + err.message);
    } finally {
      setSplittingBatchId(null);
    }
  };

  // ---- Delete ----
  const handleDeleteBatch = async (batch) => {
    if (!window.confirm(`Delete batch ${batch.batchNumber}?`)) return;
    const deleteInvoicesAlso = window.confirm(`Do you ALSO want to permanently DELETE the ${batch.invoiceCount} invoice(s)?`);
    try {
      if (batch.loadIds && batch.loadIds.length > 0) {
        const fb = writeBatch(db);
        batch.loadIds.forEach(loadId => fb.update(doc(db, 'companies', companyId, 'loads', loadId), { exportBatchId: null, exportBatchNumber: null, exportedToQuickBooks: false }));
        await fb.commit();
      }
      await deleteDoc(doc(db, 'companies', companyId, 'exportBatches', batch.id));
      if (deleteInvoicesAlso && batch.invoices) {
        const ib = writeBatch(db);
        batch.invoices.forEach(inv => { if (inv.invoiceId) ib.delete(doc(db, 'companies', companyId, 'invoices', inv.invoiceId)); });
        await ib.commit();
      }
      setFeedback?.(`✅ Batch deleted.`);
    } catch (err) {
      setFeedback?.('❌ Failed to delete batch: ' + err.message);
    }
  };

  // ---- Export ----
  const handleExportQuickBooks = (batch) => {
    try {
      const cadInvoices = (batch.invoices || []).filter(inv => (inv.currency || 'CAD') === 'CAD');
      const usdInvoices = (batch.invoices || []).filter(inv => inv.currency === 'USD');
      const wb = XLSX.utils.book_new();
      if (cadInvoices.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildQuickBooksRows(cadInvoices)), 'CAD Invoices');
      if (usdInvoices.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildQuickBooksRows(usdInvoices)), 'USD Invoices');
      XLSX.writeFile(wb, `Export_Batch_${batch.batchNumber}_QuickBooks.xlsx`);
      setFeedback?.(`✅ Downloaded batch ${batch.batchNumber}`);
    } catch (err) {
      setFeedback?.('❌ Export failed: ' + err.message);
    }
  };

  const isMixedBatch = (batch) => {
    const currencies = new Set((batch.invoices || []).map(i => i.currency || 'CAD'));
    return currencies.size > 1;
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" /> Export Batches
          </h2>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={eligibleInvoices.length === 0}
          className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg hover:bg-emerald-700 disabled:opacity-50 transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Create Batch
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
          <div className="text-2xl font-black text-blue-700">{batches.reduce((s, b) => s + (b.invoiceCount || 0), 0)}</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 shadow-sm flex flex-col justify-center">
          <div className="text-[10px] font-black text-purple-600 uppercase mb-1">Total Value</div>
          {(() => {
            const cad = batches.filter(b => b.currency === 'CAD').reduce((s, b) => s + safeFloat(b.total), 0);
            const usd = batches.filter(b => b.currency === 'USD').reduce((s, b) => s + safeFloat(b.total), 0);
            return (
              <>
                {cad > 0 && <div className="text-lg font-black text-purple-700 leading-none">C${cad.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>}
                {usd > 0 && <div className="text-lg font-black text-green-700 leading-none mt-1">US${usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>}
                {cad === 0 && usd === 0 && <div className="text-lg font-black text-purple-700 leading-none">C$0.00</div>}
              </>
            );
          })()}
        </div>
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Taxes</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center"># Invoices</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.length === 0 ? (
                <tr><td colSpan="8" className="px-4 py-12 text-center text-slate-400 font-bold italic">No export batches yet.</td></tr>
              ) : batches.map(batch => (
                <tr key={batch.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedBatch(batch)}>
                  <td className="px-4 py-3 font-black text-slate-900 font-mono">{batch.batchNumber}</td>
                  <td className="px-4 py-3 text-sm">{formatDate(batch.date)}</td>
                  <td className="px-4 py-3 text-sm font-bold">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${batch.currency === 'USD' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{batch.currency}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatCurrency(batch.subtotal, batch.currency)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{batch.taxes > 0 ? formatCurrency(batch.taxes, batch.currency) : '-'}</td>
                  <td className="px-4 py-3 text-right font-black text-emerald-700">{formatCurrency(batch.total, batch.currency)}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-700">{batch.invoiceCount}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => handleMergeBatch(batch)} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Merge into another batch"><Layers className="w-4 h-4" /></button>
                      <button onClick={() => handleExportQuickBooks(batch)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Export"><Download className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteBatch(batch)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal && (
        <CreateBatchModal eligibleInvoices={eligibleInvoices} onClose={() => setShowCreateModal(false)} onCreate={handleCreateBatch} companyName={companyName} />
      )}
      {selectedBatch && (
        <BatchDetailModal
          batch={selectedBatch}
          onClose={() => setSelectedBatch(null)}
          onExport={handleExportQuickBooks}
          onSplit={handleSplitBatch}
          onSync={handleSyncBatch}
          onUpdateCurrency={handleUpdateInvoiceCurrency}
          onMoveInvoice={handleMoveInvoice}
          isSplitting={splittingBatchId === selectedBatch.id}
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
  const [currencyFilter, setCurrencyFilter] = useState('ALL');

  const filtered = useMemo(() => {
    let list = [...eligibleInvoices];
    if (currencyFilter !== 'ALL') list = list.filter(inv => (inv.currency || 'CAD') === currencyFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(inv => (inv.invoiceNumber || '').toLowerCase().includes(t) || (inv.customerName || '').toLowerCase().includes(t) || (inv.containerNo || '').toLowerCase().includes(t));
    }
    return list;
  }, [eligibleInvoices, search, currencyFilter]);

  const allSelected = filtered.length > 0 && filtered.every(inv => selectedIds.has(inv.id));
  const someSelected = selectedIds.size > 0;

  const selectedCurrencies = useMemo(() => {
    const set = new Set();
    eligibleInvoices.forEach(inv => { if (selectedIds.has(inv.id)) set.add(inv.currency || 'CAD'); });
    return set;
  }, [eligibleInvoices, selectedIds]);

  const isMixed = selectedCurrencies.size > 1;

  const selectedCadTotal = eligibleInvoices.filter(inv => selectedIds.has(inv.id) && (inv.currency || 'CAD') === 'CAD').reduce((s, inv) => s + safeFloat(inv.total), 0);
  const selectedUsdTotal = eligibleInvoices.filter(inv => selectedIds.has(inv.id) && inv.currency === 'USD').reduce((s, inv) => s + safeFloat(inv.total), 0);

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map(i => i.id)));
  };

  const handleCreate = async () => {
    if (selectedIds.size === 0 || isMixed) return;
    setCreating(true);
    try { await onCreate(Array.from(selectedIds), batchDate, notes); } finally { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <div>
            <h2 className="font-black text-slate-900 text-lg">Create Export Batch</h2>
            <p className="text-xs text-slate-500">Group into QuickBooks export. All invoices must share the same currency.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 border-b bg-white grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">Batch Date</label>
            <input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} className="w-full p-2 border rounded-xl text-sm font-bold mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase">Currency Filter</label>
            <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} className="w-full p-2 border rounded-xl text-sm font-bold mt-1 bg-white">
              <option value="ALL">All Currencies</option><option value="CAD">🇨🇦 CAD only</option><option value="USD">🇺🇸 USD only</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-black text-slate-500 uppercase">Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. September month-end batch" className="w-full p-2 border rounded-xl text-sm mt-1" />
          </div>
        </div>
        <div className="p-4 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice #, customer, container..." className="w-full pl-10 pr-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400 italic font-bold"><FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300" />No eligible invoices to batch.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-3 w-10"><button onClick={toggleAll} className="p-1">{allSelected ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <div className="w-4 h-4 border-2 border-slate-300 rounded" />}</button></th>
                  <th className="px-3 py-3">Invoice #</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Container</th><th className="px-3 py-3">Date</th><th className="px-3 py-3 text-center">Currency</th><th className="px-3 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(inv => {
                  const invCurrency = inv.currency || 'CAD';
                  const conflicts = someSelected && selectedCurrencies.size > 0 && !selectedCurrencies.has(invCurrency);
                  return (
                    <tr key={inv.id} className={`cursor-pointer hover:bg-slate-50 ${selectedIds.has(inv.id) ? 'bg-emerald-50' : ''} ${conflicts ? 'opacity-40' : ''}`} onClick={() => toggleSelect(inv.id)}>
                      <td className="px-3 py-3">{selectedIds.has(inv.id) ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <div className="w-4 h-4 border-2 border-slate-300 rounded" />}</td>
                      <td className="px-3 py-3 font-black text-slate-900">#{inv.invoiceNumber}</td>
                      <td className="px-3 py-3 text-sm">{inv.customerName || '—'}</td><td className="px-3 py-3 text-sm font-mono">{inv.containerNo || '—'}</td>
                      <td className="px-3 py-3 text-sm">{formatDate(inv.invoiceDate)}</td>
                      <td className="px-3 py-3 text-center"><span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black ${invCurrency === 'USD' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{invCurrency}</span></td>
                      <td className="px-3 py-3 text-right font-bold text-emerald-700">{formatCurrency(inv.total, invCurrency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {isMixed && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-200 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700"><strong>Cannot create a mixed-currency batch.</strong> Please deselect one currency or use the filter above.</div>
          </div>
        )}
        <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-black text-slate-700">{selectedIds.size}</span> invoices selected · 
            {selectedCadTotal > 0 && <span className="font-black text-blue-700 ml-1">C${selectedCadTotal.toFixed(2)}</span>}
            {selectedCadTotal > 0 && selectedUsdTotal > 0 && <span className="text-slate-400 mx-1">+</span>}
            {selectedUsdTotal > 0 && <span className="font-black text-green-700 ml-1">US${selectedUsdTotal.toFixed(2)}</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-5 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50">Cancel</button>
            <button onClick={handleCreate} disabled={!someSelected || creating || isMixed} className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <>Create Batch ({selectedIds.size})</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- BATCH DETAIL MODAL ----------
const BatchDetailModal = ({ batch, onClose, onExport, onSplit, onSync, onUpdateCurrency, onMoveInvoice, isSplitting }) => {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const allInvoices = batch.invoices || [];
  const mixed = allInvoices.some(i => i.currency === 'CAD') && allInvoices.some(i => i.currency === 'USD');

  const handleSyncClick = async () => {
    setSyncing(true);
    await onSync(batch);
    setSyncing(false);
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-5xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[95vh]">
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-start gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-black text-slate-900">Export batch: <span className="font-mono">{batch.batchNumber}</span></h2>
            <p className="text-xs text-slate-500 mt-1">Created {formatDate(batch.createdAt)} by {batch.createdBy || 'N/A'}</p>
            {mixed && <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-700 border border-amber-200">⚠️ MIXED CURRENCY</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSyncClick} disabled={syncing} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 disabled:opacity-50" title="Sync with latest invoice data">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync Data
            </button>
            {mixed && (
              <button onClick={() => onSplit(batch)} disabled={isSplitting} className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-600 shadow-md disabled:opacity-50" title="Split into separate CAD + USD batches">
                {isSplitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Splitting...</> : <><Scissors className="w-4 h-4" /> Split by Currency</>}
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowExportMenu(!showExportMenu)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md">
                <Download className="w-4 h-4" /> Export <ChevronDown className="w-4 h-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                  <button onClick={() => { onExport(batch); setShowExportMenu(false); }} className="w-full px-4 py-3 text-left hover:bg-emerald-50 text-sm font-bold text-slate-700 border-b border-slate-100">QuickBooks (Excel)</button>
                </div>
              )}
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 md:grid-cols-6 gap-4 bg-white border-b">
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Number</div><div className="font-black text-slate-900 font-mono">{batch.batchNumber}</div></div>
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Date</div><div className="font-bold text-slate-900">{formatDate(batch.date)}</div></div>
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Currency</div><div className="font-bold text-slate-900">{mixed ? 'Mixed' : batch.currency}</div></div>
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Subtotal</div><div className="font-bold text-slate-900">{mixed ? '—' : formatCurrency(batch.subtotal, batch.currency)}</div></div>
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Taxes</div><div className="font-bold text-slate-900">{mixed ? '—' : formatCurrency(batch.taxes, batch.currency)}</div></div>
          <div><div className="text-[10px] font-black text-slate-400 uppercase">Total</div><div className="font-black text-emerald-700">{mixed ? '—' : formatCurrency(batch.total, batch.currency)}</div></div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Client</th><th className="px-4 py-3">Sales invoice</th><th className="px-4 py-3">Container</th><th className="px-4 py-3 text-center">Currency</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-center">Move</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allInvoices.map((inv, i) => {
                const invCurrency = inv.currency || 'CAD';
                return (
                  <tr key={inv.invoiceId || i} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3 text-sm font-bold text-slate-800">{inv.customerName || '—'}</td>
                    <td className="px-4 py-3 text-sm font-mono">#{inv.invoiceNumber} ({formatDate(inv.invoiceDate)})</td>
                    <td className="px-4 py-3 text-sm font-mono">{inv.containerNo || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black ${invCurrency === 'USD' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{invCurrency}</span>
                        <button onClick={() => {
                            const newCurrency = window.prompt(`Change currency for Invoice #${inv.invoiceNumber} (Enter CAD or USD):`, invCurrency);
                            if (newCurrency && ['CAD', 'USD'].includes(newCurrency.toUpperCase()) && newCurrency.toUpperCase() !== invCurrency) {
                              onUpdateCurrency(batch, inv.invoiceId, newCurrency.toUpperCase());
                            }
                          }} className="p-1 text-slate-300 hover:text-blue-600 rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Edit Currency"><Edit3 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-black text-emerald-700">{safeFloat(inv.total).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                       <button onClick={() => onMoveInvoice(batch, inv.invoiceId)} className="p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" title="Move to another batch"><ArrowRightLeft className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExportBatchesModule;