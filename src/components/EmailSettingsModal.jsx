// src/components/EmailSettingsModal.jsx
import React, { useState, useEffect } from 'react';
import { Mail, X, Loader2, CheckCircle, Upload, Trash2, Image as ImageIcon } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

const EmailSettingsModal = ({
  isOpen,
  onClose,
  companyId,
  setFeedback,
  companyName,
  currentLogoUrl,
  onLogoUpdated,
}) => {
  // ===== SMTP STATE =====
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({
    email: '',
    appPassword: '',
    provider: 'gmail',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
  });

  // ===== LOGO STATE =====
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl || '');

  // ===== SYNC LOGO FROM PROPS =====
  useEffect(() => {
    setLogoUrl(currentLogoUrl || '');
  }, [currentLogoUrl, isOpen]);

  // ===== LOAD EXISTING SMTP SETTINGS =====
  useEffect(() => {
    if (!isOpen || !companyId) return;
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, 'companies', companyId, 'emailSettings', 'smtp')
        );
        if (snap.exists()) {
          const data = snap.data();
          setExisting({ email: data.email, provider: data.provider });
          setForm(prev => ({
            ...prev,
            email: data.email || '',
            provider: data.provider || 'gmail',
            smtpHost: data.smtpHost || 'smtp.gmail.com',
            smtpPort: data.smtpPort || 587,
          }));
        }
      } catch (err) {
        console.warn('Could not read email settings:', err.message);
      }
    })();
  }, [isOpen, companyId]);

  // ===== SAVE SMTP =====
  const handleSave = async () => {
    if (!form.email || !form.appPassword) {
      setFeedback?.('❌ Email and App Password are required');
      return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable(getFunctions(), 'saveCompanySMTP');
      await fn({ companyId, ...form });
      setFeedback?.('✅ Email settings saved');
      setExisting({ email: form.email, provider: form.provider });
      setForm(prev => ({ ...prev, appPassword: '' }));
    } catch (err) {
      setFeedback?.('❌ ' + (err.message || 'Save failed'));
    } finally {
      setLoading(false);
    }
  };

  // ===== TEST SMTP =====
  const handleTest = async () => {
    setTesting(true);
    try {
      const fn = httpsCallable(getFunctions(), 'testCompanySMTP');
      await fn({ companyId });
      setFeedback?.('✅ Connection verified. Ready to send.');
    } catch (err) {
      setFeedback?.('❌ ' + (err.message || 'Test failed'));
    } finally {
      setTesting(false);
    }
  };

  // ===== UPLOAD LOGO =====
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;

    // Validate file type
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setFeedback?.('❌ Please upload PNG, JPG, WEBP, or SVG');
      return;
    }
    // Validate file size
    if (file.size > MAX_LOGO_SIZE) {
      setFeedback?.('❌ Logo must be smaller than 2 MB');
      return;
    }

    setUploadingLogo(true);
    try {
      // Build a unique file path to avoid browser caching
      const ext = file.name.split('.').pop().toLowerCase();
      const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext) ? ext : 'png';
      const filePath = `companies/${companyId}/logo/logo_${Date.now()}.${safeExt}`;

      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);

      // Save URL to company doc
      await updateDoc(doc(db, 'companies', companyId), {
        logoUrl: url,
        logoFileName: file.name,
        logoUploadedAt: new Date().toISOString(),
      });

      setLogoUrl(url);
      onLogoUpdated?.(url);
      setFeedback?.('✅ Company logo updated');
    } catch (err) {
      console.error('Logo upload error:', err);
      setFeedback?.('❌ Logo upload failed: ' + (err.message || 'Unknown error'));
    } finally {
      setUploadingLogo(false);
      // Reset input so the same file can be selected again if needed
      e.target.value = '';
    }
  };

  // ===== REMOVE LOGO =====
  const handleRemoveLogo = async () => {
    if (!companyId) return;
    if (!window.confirm('Remove the company logo? The default icon will be shown instead.')) return;

    try {
      await updateDoc(doc(db, 'companies', companyId), {
        logoUrl: '',
        logoFileName: '',
        logoRemovedAt: new Date().toISOString(),
      });
      setLogoUrl('');
      onLogoUpdated?.('');
      setFeedback?.('✅ Company logo removed');
    } catch (err) {
      console.error('Logo remove error:', err);
      setFeedback?.('❌ Failed to remove logo');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">

        {/* HEADER */}
        <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl text-white">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-900 text-lg">Settings</h2>
              <p className="text-xs text-slate-500">Company logo & invoice email configuration</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ============ COMPANY LOGO SECTION ============ */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-purple-600" />
              <h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Company Logo</h3>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-4">
                {/* Preview */}
                <div className="w-20 h-20 rounded-xl bg-white border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Company Logo"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  )}
                </div>

                {/* Upload / Remove buttons */}
                <div className="flex-1 space-y-2">
                  <label className={`cursor-pointer flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
                    uploadingLogo
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700 active:scale-95'
                  }`}>
                    {uploadingLogo ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="w-4 h-4" /> {logoUrl ? 'Replace Logo' : 'Upload Logo'}</>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                    />
                  </label>

                  {logoUrl && (
                    <button
                      onClick={handleRemoveLogo}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove Logo
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[10px] text-slate-500 mt-3">
                Recommended: Square image, 200×200px or larger. Max 2 MB. Supports PNG, JPG, WEBP, SVG.
              </p>
            </div>
          </div>

          {/* ============ DIVIDER ============ */}
          <div className="border-t border-slate-200"></div>

          {/* ============ EMAIL SETTINGS SECTION ============ */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <h3 className="font-black text-xs uppercase tracking-widest text-slate-700">Invoice Email</h3>
            </div>

            {existing && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-xs text-green-800">
                <CheckCircle className="w-4 h-4" />
                <span>Currently sending from <strong>{existing.email}</strong></span>
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">Accounting Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full p-3 border rounded-xl text-sm mt-1"
                placeholder="ap@yourcompany.com"
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase">App Password</label>
              <input
                type="password"
                value={form.appPassword}
                onChange={e => setForm({ ...form, appPassword: e.target.value })}
                className="w-full p-3 border rounded-xl text-sm mt-1"
                placeholder="16-character code from Google/Microsoft"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Get this from myaccount.google.com/apppasswords (Google Workspace).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">SMTP Host</label>
                <input
                  value={form.smtpHost}
                  onChange={e => setForm({ ...form, smtpHost: e.target.value })}
                  className="w-full p-3 border rounded-xl text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase">Port</label>
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={e => setForm({ ...form, smtpPort: parseInt(e.target.value) || 587 })}
                  className="w-full p-3 border rounded-xl text-sm mt-1"
                />
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl text-[10px] text-slate-500">
              <strong className="text-slate-700">Common SMTP settings:</strong>
              <div>Google Workspace: smtp.gmail.com / 587</div>
              <div>Microsoft 365: smtp.office365.com / 587</div>
              <div>Zoho: smtp.zoho.com / 587</div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTest}
                disabled={testing || !existing}
                className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Email Settings'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default EmailSettingsModal;