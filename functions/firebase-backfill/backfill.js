const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function backfillMemberships() {
  const appId = 'haulix-tms'; // ⚠️ we will confirm this

  const usersRef = db.collection('artifacts').doc(appId).collection('users');
  const snapshot = await usersRef.get();

  for (const userDoc of snapshot.docs) {
    const userId = userDoc.id;

    const profileSnap = await userDoc.ref.collection('profile').doc('info').get();
    const companyId = profileSnap.data()?.companyId;

    if (companyId) {
      await userDoc.ref.collection('memberships').doc('active').set({
        companyId: companyId,
        role: 'admin'
      });
      console.log(`✓ Created membership for user ${userId}`);
    } else {
      console.log(`⚠ No companyId for user ${userId}`);
    }
  }

  console.log('Backfill complete.');
}

backfillMemberships().catch(console.error);