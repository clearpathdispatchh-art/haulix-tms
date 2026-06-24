const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc, writeBatch } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAuFs4eLaP8Pug6RSde07OXu_mofd0IfYs",
  authDomain: "haulix-tms.firebaseapp.com",
  projectId: "haulix-tms",
  storageBucket: "haulix-tms.firebasestorage.app",
  messagingSenderId: "864718858606",
  appId: "1:864718858606:web:ea068d9ea1a5cdacb9f97f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function deleteAll() {
  console.log('Deleting all companies and data...\n');
  
  const companiesSnap = await getDocs(collection(db, 'companies'));
  
  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    const companyName = companyDoc.data().name || companyId;
    
    const subcollections = ['loads', 'customers', 'locations', 'drivers', 'messages'];
    for (const sub of subcollections) {
      const subSnap = await getDocs(collection(db, 'companies', companyId, sub));
      for (const subDoc of subSnap.docs) {
        await deleteDoc(doc(db, 'companies', companyId, sub, subDoc.id));
      }
      console.log(`  ${sub}: ${subSnap.docs.length} deleted`);
    }
    
    await deleteDoc(doc(db, 'companies', companyId));
    console.log(`✅ Company deleted: ${companyName}\n`);
  }
  
  const usersSnap = await getDocs(collection(db, 'users'));
  for (const userDoc of usersSnap.docs) {
    await deleteDoc(doc(db, 'users', userDoc.id));
  }
  console.log(`✅ ${usersSnap.docs.length} users deleted`);
  
  console.log('\n🎉 ALL DATA DELETED SUCCESSFULLY!');
}

deleteAll().catch(err => {
  console.error('Error:', err.message);
});