import React, { useState } from "react";
import { HelpCircle, X, MessageSquare, Send, Loader2 } from "lucide-react";
import { getFunctions, httpsCallable } from "firebase/functions";

const HELP_CONTENT = {
  landing: {
    title: "Welcome to Nexdray!",
    steps: [
      "Click **Register** to create your company account.",
      "Enter your company name, the **customer‑service email** (this is the shared inbox for the whole team), and a secure password. Later you’ll add each team member with their own email – dispatcher, operations manager, accounting – and assign their role.",
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

const HelpPanel = ({ currentPage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const content = HELP_CONTENT[currentPage] || HELP_CONTENT.dashboard;

  const handleSendMessage = async () => {
    if (!contactName || !contactEmail || !contactMessage) return;
    setSending(true);
    try {
      const sendEmailFn = httpsCallable(getFunctions(), "sendEmail");
      await sendEmailFn({
        to: "support@nexdray.com",
        subject: `Support request from ${contactName}`,
        text: `From: ${contactName} (${contactEmail})\n\n${contactMessage}`,
        html: `<p><strong>From:</strong> ${contactName} (${contactEmail})</p><p>${contactMessage}</p>`
      });
      setSent(true);
    } catch (error) {
      console.error("Failed to send support message", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-blue-700 transition-all"
        title="Help"
      >
        {isOpen ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-80 max-h-[500px] bg-white border border-slate-200 shadow-2xl rounded-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
          <div className="p-4 border-b border-slate-100 bg-blue-50">
            <h3 className="font-bold text-blue-900 flex items-center gap-2">
              <HelpCircle className="w-5 h-5" /> {content.title}
            </h3>
          </div>

          {!showContact ? (
            <>
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                {content.steps.map((step, idx) => (
                  <div key={idx} className="flex gap-2 text-sm text-slate-700">
                    <span className="font-bold text-blue-600">{idx + 1}.</span>
                    <span dangerouslySetInnerHTML={{ __html: step.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-slate-100">
                <button
                  onClick={() => setShowContact(true)}
                  className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" /> Contact Support
                </button>
              </div>
            </>
          ) : (
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              {sent ? (
                <p className="text-green-600 font-bold text-sm">Message sent! We'll get back to you soon.</p>
              ) : (
                <>
                  <input
                    className="w-full p-2 border rounded-lg text-sm"
                    placeholder="Your name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                  <input
                    className="w-full p-2 border rounded-lg text-sm"
                    placeholder="Your email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                  <textarea
                    className="w-full p-2 border rounded-lg text-sm h-24"
                    placeholder="Describe your issue..."
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending}
                    className="w-full py-2 bg-green-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send Message
                  </button>
                </>
              )}
              <button
                onClick={() => { setShowContact(false); setSent(false); }}
                className="w-full py-2 text-slate-500 text-sm underline"
              >
                Back to help
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default HelpPanel;