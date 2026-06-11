import { getFirebaseToken } from './auth.js';

const LOCAL_API_PORTS = [3000, 3001, 3002];
let API_BASE_URL = (() => {
   if (window.__API_BASE_URL) {
      return window.__API_BASE_URL;
   }
   const host = window.location.hostname;
   const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
   if (isLocal && window.__TRY_LOCAL_API) {
      return 'http://127.0.0.1:3000';
   }
   const backendHosts = [
      'smartcareervai.onrender.com',
      'api.smartcareervai.com'
   ];
   if (backendHosts.includes(host)) {
      return window.location.origin;
   }
   return 'https://api.smartcareervai.com';
})();

function isLocalHost() {
   const host = window.location.hostname;
   return host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
}

function normalizeBaseUrl(url) {
   return url.replace(/\/+$/, '');
}

export function apiUrl(path) {
   return API_BASE_URL ? `${normalizeBaseUrl(API_BASE_URL)}${path}` : path;
}

async function tryLoadConfig(baseUrl) {
   const url = `${normalizeBaseUrl(baseUrl)}/config`;
   const response = await fetch(url, { cache: 'no-store' });
   if (!response.ok) {
      throw new Error(`Config fetch failed with status ${response.status}`);
   }
   const config = await response.json();
   API_BASE_URL = normalizeBaseUrl(baseUrl);
   return config;
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

export async function loadAppConfig() {
   const baseUrls = [API_BASE_URL];
   if (isLocalHost() && window.__TRY_LOCAL_API) {
      const localHost = 'http://127.0.0.1';
      LOCAL_API_PORTS.forEach(port => {
         const candidate = `${localHost}:${port}`;
         if (!baseUrls.includes(candidate)) {
            baseUrls.push(candidate);
         }
      });
   }

   for (const baseUrl of baseUrls) {
      try {
         const config = await tryLoadConfig(baseUrl);
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
         console.warn(`App config load failed for ${baseUrl}:`, err.message);
      }
   }

   console.error('App config load failed on all candidate local backend addresses.');
   return null;
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
   const mpesaButton = document.getElementById('payServiceBtn');
   if (mpesaButton) {
      mpesaButton.disabled = total <= 0;
      mpesaButton.classList.toggle('disabled', total <= 0);
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

