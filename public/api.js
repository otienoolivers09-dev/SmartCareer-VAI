import { getFirebaseToken } from './auth.js';

const API_BASE_URL = (() => {
   const host = window.location.host;
   if (host === 'localhost:5500' || host === '127.0.0.1:5500' || host === 'localhost:5501' || host === '127.0.0.1:5501') {
      return 'http://127.0.0.1:3000';
   }
   if (window.location.protocol === 'file:') {
      return 'http://127.0.0.1:3000';
   }
   return 'https://smartcareervai.onrender.com';
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
      return Promise.resolve();
   }
   
   return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD`;
      
      script.onload = () => {
         if (window.paypal && typeof window.paypal.Buttons === 'function') {
            resolve();
         } else {
            reject(new Error('PayPal SDK loaded but Buttons function not available'));
         }
      };
      
      script.onerror = () => {
         reject(new Error('Failed to load PayPal SDK from CDN. Check your internet connection and client ID.'));
      };
      
      // Add timeout fallback
      const timeout = setTimeout(() => {
         reject(new Error('PayPal SDK load timeout. Please try refreshing the page.'));
      }, 10000);
      
      script.addEventListener('load', () => clearTimeout(timeout));
      script.addEventListener('error', () => clearTimeout(timeout));
      
      document.head.appendChild(script);
   });
}

export async function loadAppConfig() {
   try {
      const configUrl = apiUrl('/config');
      const response = await fetch(configUrl);
      
      if (!response.ok) {
         const status = response.status;
         if (status === 0) {
            console.error('Failed to reach config server (CORS or network issue)', configUrl);
            return null;
         }
         console.warn(`Config load failed with status ${status}`, configUrl);
         return null;
      }
      
      const config = await response.json();
      
      if (config.paypalClientId) {
         try {
            await loadPayPalSdk(config.paypalClientId);
         } catch (sdkErr) {
            console.error('PayPal SDK load failed:', sdkErr.message);
            config.paypalClientId = null;
         }
      }
      
      return config;
   } catch (err) {
      console.error('App config load failed:', err.message);
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
         console.error('This is likely a CORS or network connectivity issue. Ensure the backend URL is accessible.');
      }
      return null;
   }
}
