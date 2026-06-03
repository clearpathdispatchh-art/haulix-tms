const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Initialize Admin SDK once
admin.initializeApp();

// ---------- Helper functions ----------
const safeFloat = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : Math.max(0, n);
};

const validateLoadForm = (data) => {
  const requiredFields = {
    containerNo: "Container Number",
    shippingLine: "Shipping Line",
    customerName: "Customer Name",
    status: "Status"
    // appointmentDate is NOT required – loads can be created before an appointment is booked
  };
  for (const [field, label] of Object.entries(requiredFields)) {
    if (!data[field] || String(data[field]).trim() === "") {
      return { valid: false, error: `${label} is required.` };
    }
  }
  if (!Array.isArray(data.legs) || data.legs.length === 0) {
    return { valid: false, error: "At least one trip leg is required." };
  }
  // Financial validation (line items)
  const revenueItems = data.revenueItems || [];
  const hasBasePrice = safeFloat(data.basePrice) > 0 || safeFloat(data.waitingTime) > 0 || safeFloat(data.fuelSurcharge) > 0;
  const hasLineItems = revenueItems.length > 0;
  if (!hasBasePrice && !hasLineItems) {
    return { valid: false, error: "At least one revenue item or base price is required." };
  }
  if (hasBasePrice && hasLineItems) {
    return { valid: false, error: "Cannot mix legacy pricing and line items." };
  }
  const totalRevenue = hasLineItems
    ? revenueItems.reduce((sum, item) => sum + safeFloat(item.amount), 0)
    : safeFloat(data.basePrice) + safeFloat(data.waitingTime) + safeFloat(data.fuelSurcharge);
  if (totalRevenue <= 0) {
    return { valid: false, error: "Total revenue must be greater than zero." };
  }
  return { valid: true };
};

// ====== NEW: Input sanitization helpers (XSS prevention) ======
const sanitizeString = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
};

const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) return;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeString(obj[key]);
    } else if (Array.isArray(obj[key])) {
      obj[key].forEach(item => sanitizeObject(item));
    } else if (typeof obj[key] === 'object') {
      sanitizeObject(obj[key]);
    }
  }
};

// ---------- 1. Send Email (Support & Contact Form) [Resend] ----------
exports.sendEmail = onCall(
  { secrets: ["RESEND_API_KEY"] },
  async (request) => {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { to, subject, text, html, companyEmail } = request.data;
    if (!to) throw new HttpsError("invalid-argument", "Missing recipient email");
    try {
      const response = await resend.emails.send({
        from: "Nexdray Support <support@nexdray.com>",
        to: [to],
        ...(companyEmail && { cc: [companyEmail] }),
        subject: subject || "Support Request",
        text: text || "",
        html: html || "",
        ...(companyEmail && { reply_to: companyEmail }),
      });
      if (response?.error) throw new Error(response.error.message);
      return { success: true };
    } catch (error) {
      console.error("RESEND ERROR:", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

// ---------- 2. Create Team Member function ----------
exports.createTeamMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const callerUid = request.auth.uid;
  const { email, password, role, companyId } = request.data;
  if (!email || !password || !role || !companyId)
    throw new HttpsError("invalid-argument", "Missing required fields.");

  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists) throw new HttpsError("not-found", "Caller account not found.");
  const callerData = callerDoc.data();
  if (callerData.companyId !== companyId || !["owner", "admin"].includes(callerData.role))
    throw new HttpsError("permission-denied", "You are not allowed to add team members.");

  let newUser;
  try {
    newUser = await admin.auth().createUser({ email, password });
  } catch (error) {
    throw new HttpsError("already-exists", error.message);
  }

  const companySnap = await admin.firestore().collection("companies").doc(companyId).get();
  const companyData = companySnap.data();
  const accessibleLocations = companyData?.locations?.map(l => l.id) || [];
  const defaultLocation = accessibleLocations[0] || null;

  await admin.firestore().collection("users").doc(newUser.uid).set({
    email,
    companyId,
    role,
    accessibleLocations,
    defaultLocation,
    setupComplete: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await admin.firestore().collection("companies").doc(companyId).update({
    memberUids: admin.firestore.FieldValue.arrayUnion(newUser.uid)
  });

  return { success: true, uid: newUser.uid };
});

// ---------- 3. Validate & Write Load function (with role enforcement & sanitization) ----------
exports.validateAndWriteLoad = onCall(async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
    const uid = request.auth.uid;
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");
    const user = userDoc.data();
    const userCompany = user.companyId;
    const userRole = user.role;
    if (!userCompany) throw new HttpsError("failed-precondition", "User has no company.");

    // ---------------------------------------------------------------
// Rate limiting (rolling window – server side)
const rateDocRef = admin.firestore().collection(`rateLimits_${userCompany}`).doc(uid);
const rateDoc = await rateDocRef.get();
const now = Date.now();
const COOLDOWN_MS = 5000;          // 5 seconds between individual writes
const MAX_PER_MINUTE = 10;         // max 10 loads per rolling minute

if (rateDoc.exists) {
  const data = rateDoc.data();
  const lastWrite = data.lastWrite?.toMillis() || 0;

  // 1. Cooldown between writes (prevents rapid clicking)
  if (now - lastWrite < COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Please wait a few seconds before creating another load.");
  }

  // 2. Rolling window: keep an array of timestamps for the last minute
  let timestamps = data.timestamps || [];
  const oneMinuteAgo = admin.firestore.Timestamp.fromMillis(now - 60_000);
  timestamps = timestamps.filter(ts => ts >= oneMinuteAgo);

  if (timestamps.length >= MAX_PER_MINUTE) {
    throw new HttpsError("resource-exhausted", `Too many loads created. Please wait a minute. (max ${MAX_PER_MINUTE} per minute)`);
  }

  timestamps.push(admin.firestore.Timestamp.now());

  await rateDocRef.set({
    lastWrite: admin.firestore.FieldValue.serverTimestamp(),
    timestamps,
  }, { merge: true });
} else {
  // First write for this user
  await rateDocRef.set({
    lastWrite: admin.firestore.FieldValue.serverTimestamp(),
    timestamps: [admin.firestore.Timestamp.now()],
  });
}
// ---------------------------------------------------------------

    const loadData = request.data.load;
    const loadId = request.data.loadId || null;

    // --- Role‑based locking check (only when updating an existing load) ---
    if (loadId) {
      const loadSnap = await admin.firestore().collection(`loads_${userCompany}`).doc(loadId).get();
      if (!loadSnap.exists) throw new HttpsError("not-found", "Load not found.");
      const existingStatus = loadSnap.data().status;

      const isAdminOrAccounting = userRole === 'owner' || userRole === 'admin' || userRole === 'accounting';
      const lockedStatuses = ['Invoiced', 'Paid', 'Completed'];

      if (lockedStatuses.includes(existingStatus) && !isAdminOrAccounting) {
        throw new HttpsError("permission-denied",
          "This load has been financially locked and can only be edited by an Admin or Accounting role.");
      }
    }

    // --- Input validation ---
    const validation = validateLoadForm(loadData);
    if (!validation.valid) throw new HttpsError("invalid-argument", validation.error);

    loadData.companyId = userCompany;

    // --- Sanitize all string inputs to prevent stored XSS ---
    sanitizeObject(loadData);

    // --- Write to Firestore ---
    const loadRef = loadId
      ? admin.firestore().collection(`loads_${userCompany}`).doc(loadId)
      : admin.firestore().collection(`loads_${userCompany}`).doc();

    const writePayload = {
      ...loadData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!loadId) {
      writePayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      writePayload.dateAdded = admin.firestore.FieldValue.serverTimestamp();
    }

    await loadRef.set(writePayload, { merge: !!loadId });

    return { success: true, loadId: loadRef.id };
  } catch (error) {
    console.error("validateAndWriteLoad CRASH:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Unknown error");
  }
});

// ---------- 4. Extract Load Data from Document (OCR) ----------
exports.extractLoadDataFromDocument = onCall(
  { secrets: ["GEMINI_API_KEY"] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
    
    const { fileUrl } = request.data;
    if (!fileUrl) throw new HttpsError("invalid-argument", "Missing fileUrl.");

    try {
      const fetch = (await import("node-fetch")).default;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Failed to fetch document: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      const base64Content = Buffer.from(buffer).toString("base64");

      const urlLower = fileUrl.toLowerCase();
      let mimeType = "application/pdf";
      if (urlLower.endsWith(".png")) mimeType = "image/png";
      else if (urlLower.endsWith(".jpg") || urlLower.endsWith(".jpeg")) mimeType = "image/jpeg";
      else if (urlLower.endsWith(".webp")) mimeType = "image/webp";

      const geminiKey = process.env.GEMINI_API_KEY;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      
      const prompt = `Extract the following fields from this shipping load confirmation. Return ONLY a valid JSON object with these keys:
- containerNo (string)
- shippingLine (string)
- size (string, e.g., "40GE (General)")
- weight (string)
- poNumber (string)
- pickupNo (string)
- customerRefNo (string)
- customerName (string, if identifiable)
- customerEmail (string)
- customerPhone (string)
- appointmentDate (string in YYYY-MM-DD format)
- appointmentTime (string in HH:MM format)
- notes (string, any special instructions)

If a field is not found, set its value to an empty string "".
Do not include any other text or explanation.`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Content } }
          ]
        }]
      };

      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const aiData = await aiResponse.json();

      console.log("Gemini API response:", JSON.stringify(aiData).slice(0, 500));

      if (aiData.error) {
        console.error("Gemini API error:", aiData.error);
        throw new Error(`Gemini API error: ${aiData.error.message}`);
      }

      let rawText = null;
      if (aiData.candidates && aiData.candidates.length > 0) {
        const candidate = aiData.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          rawText = candidate.content.parts[0].text;
        }
      }

      if (!rawText) {
        console.error("No text in response. Full response:", JSON.stringify(aiData));
        if (aiData.contents) {
          rawText = aiData.contents[0]?.parts?.[0]?.text;
        }
        if (!rawText) throw new Error("No response from AI.");
      }

      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/(\{[\s\S]*\})/);
      const jsonString = jsonMatch ? jsonMatch[1] : rawText;
      const extractedData = JSON.parse(jsonString.trim());

      return { success: true, data: extractedData };
    } catch (error) {
      console.error("Extraction error:", error);
      throw new HttpsError("internal", error.message || "Failed to extract data");
    }
  }
);

// ---------- 5. Send Invoice Email (Resend – with SSRF protection) ----------
exports.sendInvoiceEmail = onCall(
  { secrets: ["RESEND_API_KEY"] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

    const { loadData, fromEmail, companyName, invoiceUrl } = request.data;
    if (!loadData || !loadData.customerEmail || !fromEmail) {
      throw new HttpsError("invalid-argument", "Missing required fields.");
    }

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      // ====== NEW: SSRF protection – only allow URLs from our own storage bucket ======
      const MY_STORAGE_BUCKET = process.env.STORAGE_BUCKET || "haulix-tms.firebasestorage.app";
      const isValidStorageUrl = (url) => {
        return url && (url.includes(`firebasestorage.googleapis.com/v0/b/${MY_STORAGE_BUCKET}`) 
                        || url.includes(`${MY_STORAGE_BUCKET}/`));
      };

      const attachments = [];

      const fetchAndAttach = async (fileRef, filename) => {
        if (!fileRef || !fileRef.url) return;
        // Skip if URL is not from our storage (prevents SSRF)
        if (!isValidStorageUrl(fileRef.url)) {
          console.warn(`Rejected unsafe URL: ${fileRef.url}`);
          return;
        }
        try {
          const fetch = (await import("node-fetch")).default;
          const res = await fetch(fileRef.url);
          if (!res.ok) return;
          const buffer = await res.arrayBuffer();
          attachments.push({
            filename: filename,
            content: Buffer.from(buffer).toString("base64"),
          });
        } catch (e) {
          console.warn(`Failed to attach ${filename}:`, e.message);
        }
      };

      // Attach Load Confirmation & Signed POD (if they exist)
      await fetchAndAttach(loadData.loadConfirmation,
        `${loadData.workOrderNo || "load"}_confirmation.pdf`);
      await fetchAndAttach(loadData.signedPodDoc,
        `${loadData.workOrderNo || "load"}_POD.pdf`);

      // Attach the invoice PDF (only if it's a valid storage URL)
      if (invoiceUrl) {
        if (isValidStorageUrl(invoiceUrl)) {
          await fetchAndAttach({ url: invoiceUrl },
            `Invoice_${loadData.workOrderNo || "load"}.pdf`);
        } else {
          console.warn(`Invoice URL rejected (not from our storage): ${invoiceUrl}`);
        }
      }

      // 2. Prepare email content
      const customerName = loadData.customerName || "Valued Customer";
      const woNumber = loadData.workOrderNo || "N/A";
      const containerNo = loadData.containerNo || "N/A";
      const customerRef = loadData.customerRefNo || "N/A";

      const textBody = `Hello,

Please see attached invoice ${woNumber} and POD for your reference for container ${containerNo}.
Should you have any questions, please contact us at ${fromEmail}.

${companyName || "Nexdray"}

This email contains confidential information…`;

      const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1e293b;">
<p>Hello,</p>
<p>Please see attached invoice <strong>${woNumber}</strong> and POD for your reference for container <strong>${containerNo}</strong>.</p>
<p>Should you have any questions, please contact us at <a href="mailto:${fromEmail}">${fromEmail}</a>.</p>
<p>${companyName || "Nexdray"}</p>
<br>
<p style="font-size:11px;color:#64748b;">This email contains confidential information…</p>
</body></html>`;

      // 3. Send via Resend – CC to accounting email, reply-to the same
      const response = await resend.emails.send({
        from: `${companyName || "Nexdray"} <invoices@nexdray.com>`,
        to: [loadData.customerEmail],
        cc: [fromEmail],               // accounting team gets a copy
        reply_to: fromEmail,           // replies go to accounting
        subject: `Invoice: ${woNumber}, Container: ${containerNo}, Customer Ref: ${customerRef}`,
        text: textBody,
        html: htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (response.error) throw new Error(response.error.message);
      return { success: true, messageId: response.id };
    } catch (error) {
      console.error("Invoice email error:", error);
      throw new HttpsError("internal", error.message || "Failed to send invoice email");
    }
  }
);

// ---------- 6. Update Load Status ----------
exports.updateLoadStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { loadId, newStatus } = request.data;
  if (!loadId || !newStatus) {
    throw new HttpsError("invalid-argument", "Missing loadId or newStatus.");
  }

  const uid = request.auth.uid;
  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User not found.");

  const { companyId, role } = userDoc.data();

  const loadRef = admin.firestore().collection(`loads_${companyId}`).doc(loadId);
  const loadSnap = await loadRef.get();
  if (!loadSnap.exists) throw new HttpsError("not-found", "Load not found.");

  const loadData = loadSnap.data();

  // Permission check
  const isAdmin = role === "owner" || role === "admin";
  const isAccounting = role === "accounting";
  const allowed = new Set();
  if (isAdmin || role === "dispatcher") allowed.add("Open");
  allowed.add("Ready for Billing");
  if (isAdmin || isAccounting) {
    allowed.add("Invoiced");
    allowed.add("Paid");
  }
  if (isAdmin) allowed.add("Completed");

  if (!allowed.has(newStatus)) {
    throw new HttpsError("permission-denied", `Cannot set status to ${newStatus}.`);
  }

  const auditEntry = {
    timestamp: new Date().toISOString(),
    user: request.auth.token?.email || "unknown",
    role,
    action: "Status Update",
    changes: [{ field: "status", from: loadData.status, to: newStatus }],
  };

  await loadRef.update({
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    auditLog: admin.firestore.FieldValue.arrayUnion(auditEntry),
  });

  return { success: true, newStatus };
});

// Helper: build invoice HTML (simple, printer-friendly)
function buildInvoiceHtml(loadData, companyName) {
  let rows = "";
  const items = loadData.revenueItems || [];
  items.forEach(item => {
    if (parseFloat(item.amount) > 0 || parseFloat(item.rate) > 0) {
      rows += `<tr><td style="padding:8px;border-bottom:1px solid #ddd;">${sanitizeHtml(item.item || "Service")}</td><td style="padding:8px;text-align:center;border-bottom:1px solid #ddd;">${item.qty || 1}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #ddd;">$${parseFloat(item.rate||0).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #ddd;">$${parseFloat(item.amount||0).toFixed(2)}</td></tr>`;
    }
  });
  const total = calculateTotalServer(loadData);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;padding:40px;color:#1e293b;}</style></head><body>
<h1>${sanitizeHtml(companyName||"Nexdray")}</h1><h2>INVOICE</h2>
<table style="width:100%;margin-bottom:20px;"><tr><td><strong>Invoice #:</strong> ${sanitizeHtml(loadData.workOrderNo||"N/A")}<br><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Container:</strong> ${sanitizeHtml(loadData.containerNo||"N/A")}</td><td><strong>Bill To:</strong><br>${sanitizeHtml(loadData.customerName||"")}<br>${sanitizeHtml(loadData.customerEmail||"")}</td></tr></table>
<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px;">Description</th><th style="text-align:center;padding:8px;">Qty</th><th style="text-align:right;padding:8px;">Rate</th><th style="text-align:right;padding:8px;">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div style="text-align:right;margin-top:20px;font-size:18px;font-weight:800;">TOTAL DUE: $${parseFloat(total).toLocaleString("en-US",{minimumFractionDigits:2})}</div>
</body></html>`;
}

function calculateTotalServer(loadData) {
  const items = loadData.revenueItems || [];
  if (items.length === 0) return "0.00";
  return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0).toFixed(2);
}

function sanitizeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}