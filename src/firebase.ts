import { initializeApp, getApps } from "firebase/app";
import { getDatabase } from "firebase/database";

// Database 1: Content DB (posts, stories, comments, likes, settings)
export const contentFirebaseConfig = {
  apiKey: "AIzaSyCldRzhTjtrb8hawkpfZxgZUmdfOiDLS4Y",
  authDomain: "photo-cash-30b8c.firebaseapp.com",
  databaseURL: "https://photo-cash-30b8c-default-rtdb.firebaseio.com",
  projectId: "photo-cash-30b8c",
  storageBucket: "photo-cash-30b8c.firebasestorage.app",
  messagingSenderId: "765815950948",
  appId: "1:765815950948:web:ebdacf74a250a744081971",
  measurementId: "G-JXWM0365JS",
};

// Database 2: User DB (users, balances, referrals, withdrawals, user history)
export const userFirebaseConfig = {
  apiKey: "AIzaSyDZ0aB5bZ3M-YwrESf934Ai3yEZQDsUzU4",
  authDomain: "photo-cash-2.firebaseapp.com",
  databaseURL: "https://photo-cash-2-default-rtdb.firebaseio.com",
  projectId: "photo-cash-2",
  storageBucket: "photo-cash-2.firebasestorage.app",
  messagingSenderId: "85268729419",
  appId: "1:85268729419:web:daa0ff56708ddcce8c47ce",
  measurementId: "G-KXCHR3D10N",
};

const allApps = getApps();

export const contentApp =
  allApps.find((a) => a.name === "contentApp") ||
  initializeApp(contentFirebaseConfig, "contentApp");

export const userApp =
  allApps.find((a) => a.name === "userApp") ||
  initializeApp(userFirebaseConfig, "userApp");

export const contentDb = getDatabase(contentApp);
export const userDb = getDatabase(userApp);

// Default export fallback
export const db = contentDb;
