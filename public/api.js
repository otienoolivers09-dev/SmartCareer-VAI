import { getFirebaseToken } from './auth.js';

const API_BASE_URL = (() => {
   const host = window.location.host;
   if (host === 'localhost:5500' || host === '127.0.0.1:5500' || host === 'localhost:5501' || host === '127.0.0.1:5501') {
      return 'http://127.0.0.1:3000';
   }
   if (window.location.protocol === 'file:') {
      return 'http://127.0.0.1:3000';
   }
   return '';
})();

export function apiUrl(path) {
   return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export async function fetchWithAuth(url, options = {}) {
   const token = await getFirebaseToken();
   const headers = {
      'Content-Type': 'application/json',
      ...options.headers
   };
   if (token) headers.Authorization = `Bearer ${token}`;
   return fetch(apiUrl(url), { ...options, headers });
}

export function showPaymentStatus(msg, isError = false) {
   const el = document.getElementById('paymentStatus');
   if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#b00020' : '#1a73e8';
   } else {
      console.log('PaymentStatus:', msg);
   }
}

export function normalizePhoneNumber(input) {
   const cleaned = (input || '').replace(/\D/g, '');
   if (cleaned.length === 10 && cleaned.startsWith('07')) {
      return `254${cleaned.slice(1)}`;
   }
   if (cleaned.length === 12 && cleaned.startsWith('254')) {
      return cleaned;
   }
   return null;
}

export function updateTotalAmount() {
   const checkboxes = document.querySelectorAll('.serviceCheck');
   let total = 0;
   checkboxes.forEach(cb => {
      if (cb.checked) {
         total += Number(cb.value || 0);
      }
   });
   const display = document.getElementById('totalAmount');
   if (display) {
      display.textContent = total.toString();
   }
   return total;
}

export function downloadTextAsPdf(filename, text) {
   const { jsPDF } = window.jspdf || {};
   if (!jsPDF) {
      alert('PDF download is unavailable because jsPDF failed to load.');
      return;
   }
   const doc = new jsPDF({ unit: 'pt', format: 'a4' });
   const pageWidth = doc.internal.pageSize.getWidth();
   const margin = 40;
   const lineHeight = 14;
   const usableWidth = pageWidth - margin * 2;
   const lines = doc.splitTextToSize(text, usableWidth);
   let y = margin;
   lines.forEach(line => {
      if (y > doc.internal.pageSize.getHeight() - margin) {
         doc.addPage();
         y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
   });
   doc.save(filename);
}

export async function loadPayPalSdk(clientId) {
   if (window.paypal && typeof window.paypal.Buttons === 'function') {
      return;
   }
   return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
      document.head.appendChild(script);
   });
}

export async function loadAppConfig() {
   try {
      const response = await fetch(apiUrl('/config'));
      const config = await response.json();
      if (!response.ok) {
         console.warn('Failed to load app config', config);
         return config;
      }
      if (config.paypalClientId) {
         await loadPayPalSdk(config.paypalClientId);
      }
      return config;
   } catch (err) {
      console.error('App config load failed', err);
      return null;
   }
}
