import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = window.auth || getAuth();

function getCurrentUser() {
   return auth.currentUser || null;
}

async function getFirebaseToken() {
   try {
      const user = getCurrentUser();
      if (!user) return null;
      return await user.getIdToken(true);
   } catch (error) {
      console.error('Failed to get Firebase token:', error);
      return null;
   }
}

async function login(email, password) {
   return await signInWithEmailAndPassword(auth, email, password);
}

async function registerUser(email, password) {
   return await createUserWithEmailAndPassword(auth, email, password);
}

async function logout() {
   return await signOut(auth);
}

function onAuthStateChangedListener(callback) {
   return onAuthStateChanged(auth, callback);
}

export { getCurrentUser, getFirebaseToken, login, registerUser, logout, onAuthStateChangedListener };
