import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDcwhIEVpgKS1ArEWh6QWp0WBXjQQB4RHM",
  authDomain: "ssif-app.firebaseapp.com",
  projectId: "ssif-app",
  storageBucket: "ssif-app.firebasestorage.app",
  messagingSenderId: "152071726664",
  appId: "1:152071726664:web:295552fda118fbd7211a7d",
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
