const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteCollection(collectionPath, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const snapshot = await collectionRef.limit(batchSize).get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`Deleted ${snapshot.size} docs from ${collectionPath}`);
  await deleteCollection(collectionPath, batchSize);
}

async function wipeAll() {
  // Delete all company documents (subcollections auto‑deleted)
  const companies = await db.collection('companies').listDocuments();
  for (const doc of companies) {
    await doc.delete();
    console.log(`Deleted company ${doc.id}`);
  }
  // Delete top‑level collections
  const collections = ['users', 'customers', 'drivers', 'locations', 'companyIndex', 'artifacts'];
  for (const col of collections) {
    try { await deleteCollection(col); } catch(e) { console.log(`${col} not found or error`); }
  }
  console.log('All test data deleted.');
}

wipeAll().catch(console.error);