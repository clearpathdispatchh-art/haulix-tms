const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // ← ensure this file exists

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateCollection(type) {
  const collections = await db.listCollections();
  for (const collection of collections) {
    const name = collection.id;
    if (!name.startsWith(`${type}_`)) continue;
    const companyId = name.replace(`${type}_`, '');
    console.log(`Migrating ${name} → companies/${companyId}/${type}`);
    const snapshot = await collection.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      await db
        .collection('companies')
        .doc(companyId)
        .collection(type)
        .doc(doc.id)
        .set(data);
      console.log(`  Moved ${doc.id}`);
    }
    console.log(`Finished ${name}`);
  }
}

async function run() {
  await migrateCollection('loads');
  await migrateCollection('customers');
  await migrateCollection('drivers');
  await migrateCollection('locations');
  console.log('✅ Migration complete!');
}

run().catch(console.error);