import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
getAuth
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
getFirestore
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
getStorage
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {

apiKey: "AIzaSyBzbbN07LFnu8SdurhORHMh1cqtKrFcAJg",

authDomain: "smart-cv-ai-c1de9.firebaseapp.com",

projectId: "smart-cv-ai-c1de9",

storageBucket: "smart-cv-ai-c1de9.firebasestorage.app",

messagingSenderId: "922420790895",

appId: "1:922420790895:web:b845a631310cc9bf312f9a"

};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const storage = getStorage(app);

window.auth = auth;
window.db = db;
window.storage = storage;