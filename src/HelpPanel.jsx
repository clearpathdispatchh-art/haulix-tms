// HelpPanel.jsx - PRODUCTION-READY

import React, { useState, useCallback } from "react";
import { HelpCircle, X, MessageSquare, Send, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from './firebase.js';
import DOMPurify from 'dompurify';

// ========== HELPERS ==========
const logError = (context, error, metadata = {}) => {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[HelpPanel][${context}]`, {
      message: error?.message || error,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  } else {
    console.error(`[HelpPanel][${context}]`, error, metadata);
  }
};

const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return emailRegex.test(email);
};

// FIXED: Renders help text with bold markdown-like syntax safely using React
const renderHelpText = (text) => {
  // Parse **bold** syntax into React elements instead of using dangerouslySetInnerHTML
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

// ========== HELP CONTENT ==========
const HELP_CONTENT = {
  landing: {
    title: "Welcome to Nexdray!",
    steps: [
      "Click **Register** to create your company account.",
      "Enter your company name, the **customer‑service email** (this is the shared inbox for the whole team), and a secure password. Later you'll add each team member with their own email – dispatcher, operations manager, accounting – and assign their role.",
      "**Data sharing mode:**  \n• **Separate per Location** – best if you have multiple offices (e.g., Calgary & Edmonton). Each office sees only its own loads and dispatchers. Data stays isolated.  \n• **Unified (All Locations)** – all locations share the same data. Everyone sees everything. Ideal for smaller teams or a single office.",
      "Add at least one physical location (e.g., your main yard or office address).",
      "Complete registration and then invite your team on the next screen."
    ]
  },
  rolesetup: {
    title: "Team Setup",
    steps: [
      "Add your dispatchers, accountants, or admins.",
      "Enter their email, a temporary password, and role.",
      "They can change their password after first login.",
      "Click **Continue to Dashboard** when finished."
    ]
  },
  dashboard: {
    title: "Getting Started",
    steps: [
      "Use the **New Load** button to create your first shipment.",
      "Fill in container details, customer, and trip legs.",
      "Upload load confirmations and signed PODs.",
      "Track loads, manage billing, and view profit reports."
    ]
  }
};

// ========== COMPONENT ==========
const HelpPanel = ({ currentPage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const content = HELP_CONTENT[currentPage] || HELP_CONTENT.dashboard;

  // FIXED: Reset form when switching panels
  const handleTogglePanel = () => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setShowContact(false);
      setSent(false);
      setError("");
    }
  };

  const handleSendMessage = async () => {
    // FIXED: Validation
    setError("");
    
    if (!contactName.trim()) {
      setError("Please enter your name.");
      return;
    }
    
    if (!contactEmail.trim()) {
      setError("Please enter your email.");
      return;
    }
    
    if (!isValidEmail(contactEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    
    if (!contactMessage.trim()) {
      setError("Please describe your issue.");
      return;
    }
    
    setSending(true);
    
    try {
      // FIXED: Use app instance
      const functions = getFunctions(app);
      const sendEmailFn = httpsCallable(functions, "sendEmail");
      
      await sendEmailFn({
        to: "support@nexdray.com",
        subject: `Support request from ${contactName.trim()}`,
        text: `From: ${contactName.trim()} (${contactEmail.trim()})\n\n${contactMessage.trim()}`,
        html: `<p><strong>From:</strong> ${DOMPurify.sanitize(contactName.trim())} (${DOMPurify.sanitize(contactEmail.trim())})</p><p>${DOMPurify.sanitize(contactMessage.trim().replace(/\n/g, '<br>'))}</p>`
      });
      
      setSent(true);
      setContactName("");
      setContactEmail("");
      setContactMessage("");
    } catch (error) {
      logError('handleSendMessage', error);
      setError("Failed to send message. Please try again or email support@nexdray.com directly.");
    } finally {
      setSending(false);
    }
  };

  // FIXED: Close button handler
  const handleClose = () => {
    setIsOpen(false);
    setShowContact(false);
    setSent(false);
    setError("");
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={handleTogglePanel}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-blue-700 transition-all"
        title="Help"
        aria-label={isOpen ? "Close help panel" : "Open help panel"}
      >
        {isOpen ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-80 max-h-[500px] bg-white border border-slate-200 shadow-2xl rounded-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-100 bg-blue-50 flex items-center justify-between">
            <h3 className="font-bold text-blue-900 flex items-center gap-2">
              <HelpCircle className="w-5 h-5" /> {content.title}
            </h3>
            <button 
              onClick={handleClose}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-blue-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!showContact ? (
            <>
              {/* FIXED: Safe rendering without dangerouslySetInnerHTML */}
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                {content.steps.map((step, idx) => (
                  <div key={idx} className="flex gap-2 text-sm text-slate-700">
                    <span className="font-bold text-blue-600 flex-shrink-0">{idx + 1}.</span>
                    <span>{renderHelpText(step)}</span>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-slate-100">
                <button
                  onClick={() => setShowContact(true)}
                  className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
                >
                  <MessageSquare className="w-4 h-4" /> Contact Support
                </button>
              </div>
            </>
          ) : (
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              {sent ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
                  <p className="text-green-600 font-bold text-sm">Message sent!</p>
                  <p className="text-xs text-slate-400 mt-1">We'll get back to you soon.</p>
                </div>
              ) : (
                <>
                  {/* FIXED: Error display */}
                  {error && (
                    <div className="p-2 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <p className="text-xs text-red-600">{error}</p>
                    </div>
                  )}
                  
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Name</label>
                    <input
                      className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Your name"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      maxLength={100}
                    />
                  </div>
                  
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Email</label>
                    <input
                      type="email"
                      className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Your email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      maxLength={254}
                    />
                  </div>
                  
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Message</label>
                    <textarea
                      className="w-full p-2 border border-slate-200 rounded-lg text-sm h-24 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      placeholder="Describe your issue..."
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      maxLength={2000}
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{contactMessage.length}/2000</p>
                  </div>
                  
                  <button
                    onClick={handleSendMessage}
                    disabled={sending}
                    className="w-full py-2 bg-green-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {sending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                    ) : (
                      <><Send className="w-4 h-4" /> Send Message</>
                    )}
                  </button>
                </>
              )}
              
              <button
                onClick={() => { setShowContact(false); setSent(false); setError(""); }}
                className="w-full py-2 text-slate-500 text-sm underline hover:text-slate-700"
              >
                ← Back to help
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default HelpPanel;