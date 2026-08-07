import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let db = null;
let initialized = false;

export function initFirebase() {
  if (initialized) return { db, success: true };

  try {
    const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (saEnv) {
      // Allow loading service account JSON directly from environment variable
      let serviceAccount;
      if (saEnv.trim().startsWith('{')) {
        serviceAccount = JSON.parse(saEnv);
      } else {
        // Base64 encoded JSON string fallback
        const decoded = Buffer.from(saEnv, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase initialized successfully with Service Account from env.');
    } else {
      // Fallback for local development if default credentials exist, or warning
      admin.initializeApp();
      console.log('Firebase initialized with Application Default Credentials.');
    }
    db = admin.firestore();
    initialized = true;
    return { db, success: true };
  } catch (error) {
    console.error('Firebase Admin SDK initialization failed:', error.message);
    return { db: null, success: false, error: error.message };
  }
}

export async function runStartupHealthCheck() {
  const { db, success } = initFirebase();
  if (!success || !db) {
    console.error('Firebase healthcheck skipped: Firestore DB not initialized.');
    return false;
  }

  try {
    const testDocRef = db.collection('_healthcheck').doc('startup');
    const timestamp = new Date().toISOString();
    
    // Write test document
    await testDocRef.set({
      status: 'healthy',
      checkedAt: timestamp
    });
    
    // Read back test document
    const snapshot = await testDocRef.get();
    if (snapshot.exists && snapshot.data().status === 'healthy') {
      console.log(`[Firebase Healthcheck] Success! Wrote and read back document at ${timestamp}`);
      return true;
    } else {
      console.error('[Firebase Healthcheck] Failed: Document read back did not match expected content.');
      return false;
    }
  } catch (error) {
    console.error('[Firebase Healthcheck] Exception occurred:', error.message);
    return false;
  }
}

export { db };
