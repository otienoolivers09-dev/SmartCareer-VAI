import { getFirebaseToken } from './auth.js';

const LOCAL_API_PORTS = [3000, 3001, 3002];
let API_BASE_URL = (() => {
   if (window.__API_BASE_URL) {
      return window.__API_BASE_URL;
   }
   const host = window.location.hostname;
   const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
   
   // Prefer the current origin when the app and API are served from the same local server.
   if (isLocal) {
      return window.location.origin || 'http://localhost:3000';
   }

   // Prefer the current origin for deployed frontend hosts so requests do not fail on an unreachable API hostname.
   const apiHostMap = {
      'smart-career-vai.vercel.app': window.location.origin,
      'www.smartcareervai.com': window.location.origin,
      'smartcareervai.com': window.location.origin,
      'smartcareer-vai.onrender.com': window.location.origin,
      'smartcareervai.onrender.com': window.location.origin
   };
   if (apiHostMap[host]) {
      return apiHostMap[host];
   }

   const backendHosts = [
      'api.smartcareervai.com'
   ];
   if (backendHosts.includes(host)) {
      return window.location.origin;
   }
   return window.location.origin || 'https://api.smartcareervai.com';
})();

function isLocalHost() {
   const host = window.location.hostname;
   return host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
}

function getLocalApiCandidates() {
   const hosts = ['http://localhost', 'http://127.0.0.1'];
   const ports = [3000, 3001, 3002, 3003, 3004, 3005];
   const candidates = [];

   hosts.forEach(host => {
      ports.forEach(port => {
         candidates.push(`${host}:${port}`);
      });
   });

   return candidates;
}

function normalizeBaseUrl(url) {
   return (url || '').replace(/\/+$/, '');
}

export function apiUrl(path) {
   const base = normalizeBaseUrl(API_BASE_URL || window.location.origin || 'http://localhost:3000');
   return base ? `${base}${path}` : path;
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
   const targetUrl = apiUrl(url);
   console.log('API request ->', targetUrl);
   return fetch(targetUrl, { ...options, headers });
}

export async function loadAppConfig() {
   const baseUrls = [];
   if (isLocalHost()) {
      const currentOrigin = window.location.origin;
      if (currentOrigin && !baseUrls.includes(currentOrigin)) {
         baseUrls.push(currentOrigin);
      }
      getLocalApiCandidates().forEach(candidate => {
         if (!baseUrls.includes(candidate)) {
            baseUrls.push(candidate);
         }
      });
   }
   if (API_BASE_URL && !baseUrls.includes(API_BASE_URL)) {
      baseUrls.push(API_BASE_URL);
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
   const pageHeight = doc.internal.pageSize.getHeight();
   const margin = 50; // Give the document a professional white margin

   const baseFont = 'Helvetica';
   const baseFontSize = 11; // 11pt body text
   const headingFontSize = 13;
   const lineHeight = Math.round(baseFontSize * 1.5); // generous line-height
   const usableWidth = pageWidth - margin * 2;

   doc.setFont(baseFont);
   doc.setFontSize(baseFontSize);
   doc.setTextColor('#111111');

   // Split input into paragraphs to preserve spacing and detect headings
   const paragraphs = String(text || '').replace(/\r/g, '').split(/\n{2,}/g);
   let y = margin;

   function addPageIfNeeded(additionalHeight = 0) {
      if (y + additionalHeight > pageHeight - margin) {
         doc.addPage();
         y = margin;
         doc.setFont(baseFont);
         doc.setFontSize(baseFontSize);
      }
   }

   paragraphs.forEach((para) => {
      const lines = doc.splitTextToSize(para.trim(), usableWidth);
      const firstLine = lines[0] || '';
      const isHeader = /^([A-Z][A-Za-z' ]{2,}|[A-Z\s]+)$/.test(firstLine.trim()) && firstLine.trim().length <= 35;

      if (isHeader) {
         addPageIfNeeded(lineHeight * 1.5);
         doc.setFont(baseFont, 'bold');
         doc.setFontSize(headingFontSize);
         doc.text(firstLine.trim(), margin, y);
         y += lineHeight;
         doc.setFont(baseFont);
         doc.setFontSize(baseFontSize);
         if (lines.length > 1) {
            const subLines = lines.slice(1);
            addPageIfNeeded(subLines.length * lineHeight);
            subLines.forEach((line) => {
               doc.text(line, margin, y);
               y += lineHeight;
            });
         }
      } else {
         addPageIfNeeded(lines.length * lineHeight);
         lines.forEach((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
               const bullet = trimmed.startsWith('- ') ? '•' : '•';
               const bulletText = trimmed.replace(/^[-•]\s*/, '');
               const bulletLines = doc.splitTextToSize(bulletText, usableWidth - 15);
               doc.text(bullet, margin, y);
               bulletLines.forEach((subLine, index) => {
                  const x = margin + 15;
                  doc.text(subLine, x, y);
                  y += lineHeight;
               });
            } else {
               doc.text(trimmed, margin, y);
               y += lineHeight;
            }
         });
      }
      y += Math.round(lineHeight / 2);
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

