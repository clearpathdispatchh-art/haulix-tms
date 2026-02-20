const attachments = [];

// 📎 Add Load Confirmation
if (request.data.loadConfirmationUrl) {
  attachments.push({
    filename: "Load-Confirmation.pdf",
    path: request.data.loadConfirmationUrl
  });
}

// 📎 Add POD
if (request.data.podUrl) {
  attachments.push({
    filename: "Signed-POD.pdf",
    path: request.data.podUrl
  });
}

// 📎 Add Invoice
if (request.data.invoiceUrl) {
  attachments.push({
    filename: "Invoice.pdf",
    path: request.data.invoiceUrl
  });
}

const info = await transporter.sendMail({
  from: `Haulix Dispatch <${process.env.GMAIL_EMAIL}>`,
  to: request.data.to,
  subject: request.data.subject || "No subject",
  text: request.data.text || "",
  html: request.data.html || "",
  attachments: attachments
});