// functions/index.js — Force node22 redeploy
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

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
  };
  for (const [field, label] of Object.entries(requiredFields)) {
    if (!data[field] || String(data[field]).trim() === "") {
      return { valid: false, error: `${label} is required.` };
    }
  }
  if (!Array.isArray(data.legs) || data.legs.length === 0) {
    return { valid: false, error: "At least one trip leg is required." };
  }

  if (data.currency && !['CAD', 'USD'].includes(data.currency)) {
    return { valid: false, error: "Invalid currency. Must be CAD or USD." };
  }

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

// ====== Input sanitization helpers (XSS prevention) ======
const sanitizeString = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    .trim();
};

const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      sanitized[key] = sanitizeString(obj[key]);
    } else if (Array.isArray(obj[key])) {
      sanitized[key] = obj[key].map(item => sanitizeObject(item));
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitized[key] = sanitizeObject(obj[key]);
    } else {
      sanitized[key] = obj[key];
    }
  }
  return sanitized;
};

// ============================================================
// SMTP Credentials Helper
// ============================================================
async function getCompanySMTPCredentials(companyId) {
  try {
    const doc = await admin.firestore()
      .collection('companies').doc(companyId)
      .collection('emailSettings').doc('smtp')
      .get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data.email || !data.appPassword) return null;
    return {
      email: data.email,
      appPassword: data.appPassword,
      provider: data.provider || 'gmail',
      smtpHost: data.smtpHost || 'smtp.gmail.com',
      smtpPort: data.smtpPort || 587,
    };
  } catch (err) {
    console.error('getCompanySMTPCredentials error:', err);
    return null;
  }
}

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

  if (!['dispatcher', 'accounting', 'admin', 'customer_service'].includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role specified.");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError("invalid-argument", "Invalid email format.");
  }

  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists) throw new HttpsError("not-found", "Caller account not found.");
  const callerData = callerDoc.data();
  if (callerData.companyId !== companyId || !["owner", "admin"].includes(callerData.role))
    throw new HttpsError("permission-denied", "You are not allowed to add team members.");

  let newUser;
  try {
    newUser = await admin.auth().createUser({ email, password });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError("already-exists", "A user with this email already exists.");
    }
    if (error.code === 'auth/invalid-email') {
      throw new HttpsError("invalid-argument", "Invalid email format.");
    }
    if (error.code === 'auth/weak-password') {
      throw new HttpsError("invalid-argument", "Password is too weak. Must be at least 6 characters.");
    }
    throw new HttpsError("internal", error.message);
  }

  await admin.auth().setCustomUserClaims(newUser.uid, {
    companyId: companyId,
    role: role
  });

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

  console.log(`Team member created: ${email} (${role}) by ${callerData.email || callerUid}`);

  return { success: true, uid: newUser.uid };
});

// ---------- 3. Validate & Write Load function ----------
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

    const loadData = request.data.load || {};
    if (loadData.locationId) {
      const userAccessibleLocations = user.accessibleLocations || [];
      if (userAccessibleLocations.length > 0 && !userAccessibleLocations.includes(loadData.locationId)) {
        throw new HttpsError("permission-denied", "You don't have access to this location.");
      }
    }

    const rateDocRef = admin.firestore().collection(`rateLimits_${userCompany}`).doc(uid);
    const rateDoc = await rateDocRef.get();
    const now = Date.now();
    const COOLDOWN_MS = 5000;
    const MAX_PER_MINUTE = 10;

    if (rateDoc.exists) {
      const data = rateDoc.data();
      const lastWrite = data.lastWrite?.toMillis() || 0;

      if (now - lastWrite < COOLDOWN_MS) {
        throw new HttpsError("resource-exhausted", "Please wait a few seconds before creating another load.");
      }

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
      await rateDocRef.set({
        lastWrite: admin.firestore.FieldValue.serverTimestamp(),
        timestamps: [admin.firestore.Timestamp.now()],
      });
    }

    const loadId = request.data.loadId || null;

    if (loadId) {
      const loadSnap = await admin.firestore()
        .collection('companies').doc(userCompany)
        .collection('loads').doc(loadId).get();

      if (!loadSnap.exists) throw new HttpsError("not-found", "Load not found.");
      const existingStatus = loadSnap.data().status;

      const isAdminOrAccounting = userRole === 'owner' || userRole === 'admin' || userRole === 'accounting';
      const lockedStatuses = ['Invoiced', 'Paid', 'Completed'];

      if (lockedStatuses.includes(existingStatus) && !isAdminOrAccounting) {
        throw new HttpsError("permission-denied",
          "This load has been financially locked and can only be edited by an Admin or Accounting role.");
      }
    }

    const validation = validateLoadForm(loadData);
    if (!validation.valid) throw new HttpsError("invalid-argument", validation.error);

    loadData.companyId = userCompany;

    const sanitizedData = sanitizeObject(loadData);

    const loadRef = loadId
      ? admin.firestore().collection('companies').doc(userCompany).collection('loads').doc(loadId)
      : admin.firestore().collection('companies').doc(userCompany).collection('loads').doc();

    const writePayload = {
      ...sanitizedData,
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

    const MY_STORAGE_BUCKET = process.env.STORAGE_BUCKET || "haulix-tms.firebasestorage.app";
    const isValidStorageUrl = (url) => {
      return url && (url.includes(`firebasestorage.googleapis.com/v0/b/${MY_STORAGE_BUCKET}`)
                      || url.includes(`${MY_STORAGE_BUCKET}/`));
    };

    if (!isValidStorageUrl(fileUrl)) {
      throw new HttpsError("invalid-argument", "Invalid file URL. Must be from our storage.");
    }

    try {
      const fetch = (await import("node-fetch")).default;

      const headResponse = await fetch(fileUrl, { method: 'HEAD' });
      const contentLength = parseInt(headResponse.headers.get('content-length') || '0', 10);
      if (contentLength > 10 * 1024 * 1024) {
        throw new HttpsError("invalid-argument", "File too large. Maximum size is 10MB.");
      }

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

      if (process.env.NODE_ENV === 'development') {
        console.log("Gemini API response:", JSON.stringify(aiData).slice(0, 500));
      }

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
        console.error("No text in response");
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

// ============================================================
// 5. Send Invoice Email via SMTP (customer's own email)
// ============================================================
exports.sendInvoiceEmail = onCall(
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

    const {
      companyId,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      attachments
    } = request.data;

    if (!to || !Array.isArray(to) || to.length === 0) {
      throw new HttpsError("invalid-argument", "Missing 'to' recipients.");
    }

    // Determine company
    let targetCompanyId = companyId;
    if (!targetCompanyId) {
      const userDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
      if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");
      targetCompanyId = userDoc.data().companyId;
    }
    if (!targetCompanyId) {
      throw new HttpsError("failed-precondition", "No company associated.");
    }

    // Verify access
    const userDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data().companyId !== targetCompanyId) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    // Get SMTP credentials
    const creds = await getCompanySMTPCredentials(targetCompanyId);
    if (!creds) {
      throw new HttpsError(
        "failed-precondition",
        "Email not configured. Please go to Settings → Email Setup and enter your accounting email and app password."
      );
    }

    // Build attachments
    const MY_STORAGE_BUCKET = process.env.STORAGE_BUCKET || "haulix-tms.firebasestorage.app";
    const isValidStorageUrl = (url) =>
      url && (url.includes(`firebasestorage.googleapis.com/v0/b/${MY_STORAGE_BUCKET}`)
           || url.includes(`${MY_STORAGE_BUCKET}/`));

    const finalAttachments = [];
    if (Array.isArray(attachments)) {
      const fetch = (await import("node-fetch")).default;
      for (const att of attachments) {
        if (!att?.url || !isValidStorageUrl(att.url)) continue;
        try {
          const res = await fetch(att.url);
          if (!res.ok) continue;
          const buffer = await res.arrayBuffer();
          finalAttachments.push({
            filename: att.filename || "attachment.pdf",
            content: Buffer.from(buffer),
          });
        } catch (e) {
          console.warn("Attachment fetch error:", e.message);
        }
      }
    }

    // Nodemailer transport
    const transport = nodemailer.createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpPort === 465,
      auth: {
        user: creds.email,
        pass: creds.appPassword,
      },
    });

    const ccList = Array.isArray(cc) ? [...cc] : [];
    const bccList = Array.isArray(bcc) ? [...bcc] : [];

    try {
      const info = await transport.sendMail({
        from: creds.email,
        to: to.join(', '),
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
        subject: subject || "Invoice",
        text: text || "",
        html: html || "",
        attachments: finalAttachments.length > 0 ? finalAttachments : undefined,
      });

      try {
        await admin.firestore()
          .collection('companies').doc(targetCompanyId)
          .collection('emailLog').add({
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            sentBy: request.auth.uid,
            sentByEmail: userDoc.data().email || '',
            from: creds.email,
            to, cc: ccList, bcc: bccList,
            subject,
            messageId: info.messageId,
            type: 'invoice',
          });
      } catch (logErr) {
        console.warn('Audit log failed:', logErr.message);
      }

      return { success: true, messageId: info.messageId, from: creds.email };
    } catch (error) {
      console.error("SMTP send error:", error);
      if (error.code === 'EAUTH' || error.responseCode === 535) {
        throw new HttpsError(
          "permission-denied",
          "Email authentication failed. Please verify the app password in Settings."
        );
      }
      throw new HttpsError("internal", error.message || "Failed to send email via SMTP.");
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

  const loadRef = admin.firestore()
    .collection('companies').doc(companyId)
    .collection('loads').doc(loadId);

  const loadSnap = await loadRef.get();
  if (!loadSnap.exists) throw new HttpsError("not-found", "Load not found.");

  const loadData = loadSnap.data();

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
    user: request.auth.token?.email || uid,
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

// ---------- 7. Delete Team Member ----------
exports.deleteTeamMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { targetUid, companyId } = request.data;
  const callerUid = request.auth.uid;

  if (!targetUid || !companyId) {
    throw new HttpsError("invalid-argument", "Missing targetUid or companyId.");
  }

  try {
    const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
    if (!callerDoc.exists) {
      throw new HttpsError("not-found", "Caller not found");
    }

    const callerData = callerDoc.data();
    if (!["owner", "admin"].includes(callerData.role)) {
      throw new HttpsError("permission-denied", "Only owners and admins can delete users");
    }

    if (callerData.companyId !== companyId) {
      throw new HttpsError("permission-denied", "Not in the same company");
    }

    if (targetUid === callerUid) {
      throw new HttpsError("permission-denied", "Cannot delete yourself");
    }

    const targetDoc = await admin.firestore().collection("users").doc(targetUid).get();
    if (!targetDoc.exists) {
      throw new HttpsError("not-found", "Target user not found");
    }

    const targetData = targetDoc.data();

    if (targetData.role === "owner") {
      throw new HttpsError("permission-denied", "Cannot delete the company owner");
    }

    console.log(`Team member deleted: ${targetData.email || targetUid} (${targetData.role}) by ${callerData.email || callerUid}`);

    const companyRef = admin.firestore().collection("companies").doc(companyId);
    await companyRef.update({
      memberUids: admin.firestore.FieldValue.arrayRemove(targetUid)
    });

    await admin.firestore().collection("users").doc(targetUid).delete();
    await admin.auth().deleteUser(targetUid);

    return { success: true, message: "User deleted successfully" };
  } catch (error) {
    console.error("Error deleting team member:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to delete user");
  }
});

// ---------- 8. Get Team Members ----------
exports.getTeamMembers = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { companyId } = request.data;
  const callerUid = request.auth.uid;

  if (!companyId) {
    throw new HttpsError("invalid-argument", "Missing companyId.");
  }

  try {
    const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data().companyId !== companyId) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const companyDoc = await admin.firestore().collection("companies").doc(companyId).get();
    if (!companyDoc.exists) {
      throw new HttpsError("not-found", "Company not found");
    }

    const memberUids = companyDoc.data().memberUids || [];
    const members = [];

    for (const uid of memberUids) {
      try {
        const userDoc = await admin.firestore().collection("users").doc(uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          members.push({
            uid: uid,
            email: userData.email || "Unknown",
            role: userData.role || "dispatcher",
            setupComplete: userData.setupComplete || false
          });
        }
      } catch (err) {
        console.warn(`Could not fetch user ${uid}:`, err.message);
      }
    }

    return { success: true, members };
  } catch (error) {
    console.error("Error getting team members:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to get team members");
  }
});

// ---------- 9. Create Company (Super Admin only) ----------
exports.createCompany = onCall(async (request) => {
  const SUPER_ADMIN_UID = "UFbOqd1GElPJnrTZiJrhZEwB5uz1";
  if (!request.auth || request.auth.uid !== SUPER_ADMIN_UID) {
    throw new HttpsError("permission-denied", "Only super admin can create companies.");
  }

  const { companyName, adminEmail, adminPassword, locations, dataSharingMode } = request.data;

  if (!companyName || !adminEmail || !adminPassword) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }
  if (adminPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  let newUser;
  try {
    newUser = await admin.auth().createUser({
      email: adminEmail,
      password: adminPassword,
    });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError("already-exists", "A user with this email already exists.");
    }
    if (error.code === 'auth/invalid-email') {
      throw new HttpsError("invalid-argument", "Invalid email format.");
    }
    throw new HttpsError("internal", error.message);
  }

  const uid = newUser.uid;

  const companyRef = admin.firestore().collection("companies").doc();
  const companyId = companyRef.id;

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 30);

  await companyRef.set({
    name: companyName,
    dataSharingMode: dataSharingMode || "separate",
    locations: locations || [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
    memberUids: [uid],
    setupComplete: false,
    paymentStatus: "trial",
    trialEndsAt: trialEnd.toISOString(),
    subscriptionActive: true,
    monthlyAmount: 200,
    currency: "USD",
    createdBySuperAdmin: request.auth.uid,
    createdAtFormatted: new Date().toISOString(),
  });

  await admin.firestore().collection("users").doc(uid).set({
    email: adminEmail,
    companyId: companyId,
    role: "owner",
    accessibleLocations: locations.map(l => l.id),
    defaultLocation: locations[0]?.id || null,
    setupComplete: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await admin.auth().setCustomUserClaims(uid, {
    companyId: companyId,
    role: "owner"
  });

  return { success: true, companyId, uid };
});

// ---------- 10. Create Driver (with custom claims) ----------
exports.createDriver = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

  const callerUid = request.auth.uid;
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists) throw new HttpsError("not-found", "Caller account not found.");

  const callerData = callerDoc.data();
  const companyId = callerData.companyId;

  if (!["owner", "admin", "dispatcher"].includes(callerData.role)) {
    throw new HttpsError("permission-denied", "You are not allowed to create drivers.");
  }

  const { name, truckNo, type, payRate, payType, fuelEfficiency, email, password } = request.data;

  if (!name || !email || !password) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  let newUser;
  try {
    newUser = await admin.auth().createUser({ email, password });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError("already-exists", "A user with this email already exists.");
    }
    throw new HttpsError("internal", error.message);
  }

  await admin.auth().setCustomUserClaims(newUser.uid, {
    companyId: companyId,
    role: "driver"
  });

  const driverRef = admin.firestore()
    .collection("companies").doc(companyId)
    .collection("drivers").doc();

  await driverRef.set({
    name,
    truckNo: truckNo || "",
    type: type || "Company Driver",
    payRate: payRate || 0,
    payType: payType || "flat",
    fuelEfficiency: fuelEfficiency || null,
    email: email,
    authUid: newUser.uid,
    companyId: companyId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await admin.firestore().collection("companies").doc(companyId).update({
    memberUids: admin.firestore.FieldValue.arrayUnion(newUser.uid)
  });

  await admin.firestore().collection("users").doc(newUser.uid).set({
    email: email,
    companyId: companyId,
    role: "driver",
    setupComplete: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`Driver created: ${email} for company ${companyId}`);
  return { success: true, driverId: driverRef.id, uid: newUser.uid };
});

// ---------- 11. Update Driver Password ----------
exports.updateUserPassword = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const { uid, newPassword } = request.data;
  if (!uid || !newPassword || newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Invalid UID or password.");
  }

  const callerDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
  const targetDoc = await admin.firestore().collection("users").doc(uid).get();
  if (!callerDoc.exists || !targetDoc.exists) throw new HttpsError("not-found", "User not found.");
  if (callerDoc.data().companyId !== targetDoc.data().companyId) {
    throw new HttpsError("permission-denied", "Cannot update password for another company.");
  }

  await admin.auth().updateUser(uid, { password: newPassword });
  return { success: true };
});

// ============================================================
// 12. Save Company SMTP Settings
// ============================================================
exports.saveCompanySMTP = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { companyId, email, appPassword, provider, smtpHost, smtpPort } = request.data;

  if (!companyId || !email || !appPassword) {
    throw new HttpsError("invalid-argument", "companyId, email, and appPassword are required.");
  }

  const userDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User not found.");
  const userData = userDoc.data();

  if (userData.companyId !== companyId) {
    throw new HttpsError("permission-denied", "Not your company.");
  }
  if (!["owner", "admin"].includes(userData.role)) {
    throw new HttpsError("permission-denied", "Only owners and admins can configure email.");
  }

  await admin.firestore()
    .collection('companies').doc(companyId)
    .collection('emailSettings').doc('smtp')
    .set({
      email,
      appPassword,
      provider: provider || 'gmail',
      smtpHost: smtpHost || 'smtp.gmail.com',
      smtpPort: smtpPort || 587,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    }, { merge: true });

  return { success: true };
});

// ============================================================
// 13. Test Company SMTP Connection
// ============================================================
exports.testCompanySMTP = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const { companyId } = request.data;

  const userDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
  if (!userDoc.exists || userDoc.data().companyId !== companyId) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  const creds = await getCompanySMTPCredentials(companyId);
  if (!creds) throw new HttpsError("failed-precondition", "No SMTP configured.");

  try {
    const transport = nodemailer.createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpPort === 465,
      auth: { user: creds.email, pass: creds.appPassword },
    });
    await transport.verify();
    return { success: true, message: "Connection OK" };
  } catch (err) {
    throw new HttpsError("internal", "Connection failed: " + err.message);
  }
});

// Helper functions
function calculateTotalServer(loadData) {
  const items = loadData.revenueItems || [];
  if (items.length === 0) return "0.00";
  return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0).toFixed(2);
}

function sanitizeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}