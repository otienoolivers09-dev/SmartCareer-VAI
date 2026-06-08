import { login, registerUser, logout, onAuthStateChangedListener, getCurrentUser, getFirebaseToken } from './auth.js';
import { apiUrl, fetchWithAuth, loadAppConfig, loadPayPalSdk, showPaymentStatus, normalizePhoneNumber, updateTotalAmount, downloadTextAsPdf } from './api.js?v=2';

const HISTORY_KEY = 'smartCareerHistory';
let latestCV = '';
let latestCoverLetter = '';
let latestCvId = null;
let hasPaid = false;
let isSignupMode = false;

function setOutputText(text) {
   const output = document.getElementById('output');
   if (!output) return;
   output.textContent = text;
}

function appendOutputNotice(text) {
   const output = document.getElementById('output');
   if (!output) return;
   const note = document.createElement('div');
   note.textContent = text;
   note.style.color = '#b00020';
   note.style.marginTop = '16px';
   output.appendChild(note);
}

function renderHistory() {
   const historyEl = document.getElementById('history');
   if (!historyEl) return;
   
   try {
      const rawData = localStorage.getItem(HISTORY_KEY);
      const histories = rawData ? JSON.parse(rawData) : [];
      
      if (!Array.isArray(histories)) {
         throw new Error('Corrupted history data');
      }
      
      historyEl.innerHTML = histories.length 
         ? histories.map(entry => {
            try {
               const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown date';
               return `<div class="history-item"><strong>${escapeHtml(entry.title)}</strong><div>${escapeHtml(entry.details)}</div><small>${date}</small></div>`;
            } catch (e) {
               console.error('Error rendering history item:', e);
               return '';
            }
         }).join('')
         : '<p>No saved items yet.</p>';
   } catch (err) {
      console.error('History render error:', err);
      historyEl.innerHTML = '<p style="color: #b00020;">Failed to load history. <a href="#" onclick="localStorage.removeItem(\'' + HISTORY_KEY + '\'); location.reload();">Clear History</a></p>';
   }
}

function escapeHtml(text) {
   const div = document.createElement('div');
   div.textContent = text;
   return div.innerHTML;
}

function saveHistory(title, details) {
   try {
      const rawData = localStorage.getItem(HISTORY_KEY) || '[]';
      const histories = JSON.parse(rawData);
      
      if (!Array.isArray(histories)) {
         throw new Error('Corrupted history data');
      }
      
      histories.unshift({ 
         title: String(title), 
         details: String(details), 
         createdAt: new Date().toISOString() 
      });
      
      localStorage.setItem(HISTORY_KEY, JSON.stringify(histories.slice(0, 20)));
      renderHistory();
   } catch (err) {
      console.error('Failed to save history:', err);
      // Don't block user experience, but log the error
      if (err.message && err.message.includes('QuotaExceededError')) {
         console.warn('Local storage full. Clearing old history...');
         try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
            saveHistory(title, details);
         } catch (clearErr) {
            console.error('Cannot save history: local storage unavailable');
         }
      }
   }
}

function setAppVisibility(isSignedIn) {
   const authSection = document.getElementById('authSection');
   const appSection = document.getElementById('appSection');
   const authMessage = document.getElementById('authMessage');
   if (isSignedIn) {
      if (authSection) authSection.classList.add('hidden');
      if (appSection) appSection.classList.remove('hidden');
      if (authMessage) authMessage.textContent = '';
      const user = getCurrentUser();
      const email = user?.email || 'Logged in user';
      if (document.getElementById('userStatus')) {
         document.getElementById('userStatus').textContent = `Signed in as ${email}`;
      }
   } else {
      if (authSection) authSection.classList.remove('hidden');
      if (appSection) appSection.classList.add('hidden');
      if (authMessage) authMessage.textContent = 'Please sign in or register to use the Smart Career VAI tools.';
   }
}

async function handleAuthSubmit() {
   const emailInput = document.getElementById('authEmail');
   const passwordInput = document.getElementById('authPassword');
   const careerInput = document.getElementById('careerField');
   if (!emailInput || !passwordInput) return;

   const email = emailInput.value.trim();
   const password = passwordInput.value.trim();
   if (!email || !password) {
      alert('Please enter both email and password.');
      return;
   }

   try {
      if (isSignupMode) {
         await registerUser(email, password);
         alert('Account created. You are now signed in.');
      } else {
         await login(email, password);
         alert('Signed in successfully.');
      }
      emailInput.value = '';
      passwordInput.value = '';
   } catch (error) {
      console.error('Auth error:', error);
      alert(`Authentication failed: ${error.message}`);
   }
}

function toggleAuthMode() {
   const primaryBtn = document.getElementById('primaryAuthBtn');
   const toggleText = document.getElementById('authToggleText');
   const careerField = document.getElementById('careerField');
   isSignupMode = !isSignupMode;
   if (isSignupMode) {
      primaryBtn.textContent = 'Register';
      toggleText.textContent = 'Already have an account? Login';
      if (careerField) careerField.classList.remove('hidden');
   } else {
      primaryBtn.textContent = 'Login';
      toggleText.textContent = "Don't have an account? Sign up";
      if (careerField) careerField.classList.add('hidden');
   }
}

async function handleLogout() {
   try {
      await logout();
      setAppVisibility(false);
      alert('Signed out successfully.');
   } catch (error) {
      console.error('Logout error:', error);
      alert('Logout failed. See console for details.');
   }
}

async function extractFromImage() {
   const imageInput = document.getElementById('ocrImage');
   const rawDocument = document.getElementById('rawDocument');
   if (!imageInput || !rawDocument) return;
   const file = imageInput.files?.[0];
   if (!file) {
      alert('Please choose an image file to extract text from.');
      return;
   }
   showPaymentStatus('Extracting text from image...');
   try {
      const { data: { text } } = await Tesseract.recognize(file, 'eng');
      rawDocument.value = text;
      showPaymentStatus('Text extraction complete.');
   } catch (err) {
      console.error('OCR error:', err);
      showPaymentStatus('Failed to extract text from image.', true);
   }
}

async function extractInformation() {
   const rawDocument = document.getElementById('rawDocument');
   if (!rawDocument || !rawDocument.value.trim()) {
      alert('Paste your document text or upload an image first.');
      return;
   }
   showPaymentStatus('Extracting professional information...');
   try {
      const response = await fetchWithAuth('/extract-info', {
         method: 'POST',
         body: JSON.stringify({ rawText: rawDocument.value.trim() })
      });
      const data = await response.json();
      if (!response.ok) {
         throw new Error(data.message || 'Extraction failed');
      }
      setOutputText(JSON.stringify(data.result, null, 2));
      saveHistory('Extract Information', data.result.substring ? data.result.substring(0, 200) : 'Extracted information');
      showPaymentStatus('Extraction completed successfully.');
   } catch (error) {
      console.error('Extract information error:', error);
      showPaymentStatus('Failed to extract information.', true);
   }
}

async function generateCv() {
   const fullName = document.getElementById('fullName')?.value.trim();
   const jobTarget = document.getElementById('jobTarget')?.value.trim();
   const skills = document.getElementById('skills')?.value.trim();
   const experience = [
      document.getElementById('experience1')?.value.trim(),
      document.getElementById('experience2')?.value.trim(),
      document.getElementById('experience3')?.value.trim()
   ].filter(Boolean).join('; ');
   const education = document.getElementById('education')?.value.trim();

   if (!fullName || !jobTarget || !skills) {
      alert('Please enter at least Full Name, Target Job, and Skills.');
      return;
   }

   showPaymentStatus('Generating your CV...');
   try {
      const response = await fetchWithAuth('/generate-cv', {
         method: 'POST',
         body: JSON.stringify({ fullName, jobTarget, skills, experience, education })
      });
      const data = await response.json();
      if (!response.ok) {
         throw new Error(data.message || 'CV generation failed');
      }
      latestCvId = data.cvId || latestCvId;
      latestCV = data.cv || '';
      setOutputText(latestCV);
      if (!data.hasPaid) {
         appendOutputNotice('Your CV is partially shown. Complete payment to unlock the full version.');
      }
      saveHistory('CV Generation', `${jobTarget} - ${fullName}`);
      showPaymentStatus('CV generated. You can download or complete payment.');
   } catch (error) {
      console.error('CV generation error:', error);
      showPaymentStatus('Failed to generate CV.', true);
   }
}

async function generateCoverLetter() {
   const fullName = document.getElementById('fullName')?.value.trim();
   const jobTarget = document.getElementById('jobTarget')?.value.trim();
   const skills = document.getElementById('skills')?.value.trim();

   if (!fullName || !jobTarget || !skills) {
      alert('Please enter Full Name, Target Job, and Skills for the cover letter.');
      return;
   }
   showPaymentStatus('Generating your cover letter...');
   try {
      const response = await fetchWithAuth('/generate-cover-letter', {
         method: 'POST',
         body: JSON.stringify({ fullName, jobTarget, skills })
      });
      const data = await response.json();
      if (!response.ok) {
         throw new Error(data.message || 'Cover letter generation failed');
      }
      latestCoverLetter = data.coverLetter || '';
      setOutputText(latestCoverLetter);
      saveHistory('Cover Letter', jobTarget);
      showPaymentStatus('Cover letter generated successfully.');
   } catch (error) {
      console.error('Cover letter error:', error);
      showPaymentStatus('Failed to generate cover letter.', true);
   }
}

async function generateInterviewTips() {
   const jobTarget = document.getElementById('jobTarget')?.value.trim();
   const skills = document.getElementById('skills')?.value.trim();
   const experience = document.getElementById('experience1')?.value.trim();

   if (!jobTarget || !skills) {
      alert('Please enter Target Job and Skills to generate interview tips.');
      return;
   }
   showPaymentStatus('Generating interview tips...');
   try {
      const response = await fetchWithAuth('/generate-interview-tips', {
         method: 'POST',
         body: JSON.stringify({ jobTarget, skills, experience })
      });
      const data = await response.json();
      if (!response.ok) {
         throw new Error(data.message || 'Interview tips generation failed');
      }
      setOutputText(data.interviewTips || '');
      saveHistory('Interview Tips', jobTarget);
      showPaymentStatus('Interview tips generated.');
   } catch (error) {
      console.error('Interview tips error:', error);
      showPaymentStatus('Failed to generate interview tips.', true);
   }
}

function downloadCvPdf() {
   const text = latestCV || document.getElementById('output')?.textContent || '';
   if (!text) {
      alert('No CV content available to download.');
      return;
   }
   downloadTextAsPdf('smart-career-cv.pdf', text);
}

function downloadCoverLetterPdf() {
   const text = latestCoverLetter || document.getElementById('output')?.textContent || '';
   if (!text) {
      alert('No cover letter content available to download.');
      return;
   }
   downloadTextAsPdf('smart-career-cover-letter.pdf', text);
}

async function initPayPalButtonsIfConfigured() {
   try {
      const config = await loadAppConfig();
      const container = document.getElementById('paypal-button-container');
      
      if (!config) {
         showPaymentStatus('Failed to load app configuration. PayPal not available.', true);
         if (container) {
            container.innerHTML = '<p class="payment-disabled">Unable to load PayPal. Please refresh the page or use M-Pesa.</p>';
         }
         return;
      }
      
      if (!config.paypalConfigured) {
         console.warn('PayPal is not configured on backend');
         showPaymentStatus('PayPal is not configured on the backend. Please check the Render environment variables.', true);
         if (container) {
            container.innerHTML = '<p class="payment-disabled">PayPal is not configured on the backend. Please check the server settings or use M-Pesa.</p>';
         }
         return;
      }

      if (config?.paypalClientId) {
         try {
            if (!window.paypal || typeof window.paypal.Buttons !== 'function') {
               await loadPayPalSdk(config.paypalClientId);
            }
            if (window.paypal && typeof window.paypal.Buttons === 'function') {
               await initPayPalButtons();
               return;
            }
         } catch (err) {
            console.error('Failed to load PayPal SDK:', err);
            showPaymentStatus('PayPal SDK failed to load. Using M-Pesa only.', true);
         }
      }
      
      if (container) {
         container.innerHTML = '<p class="payment-disabled">PayPal checkout is unavailable. Please configure PayPal credentials or use M-Pesa.</p>';
      }
   } catch (err) {
      console.error('PayPal initialization error:', err);
      showPaymentStatus('Error initializing payment options.', true);
   }
}

async function initPayPalButtons() {
   if (!(window.paypal && typeof window.paypal.Buttons === 'function')) {
      console.warn('PayPal SDK not available; skipping PayPal button initialization.');
      return;
   }
   paypal.Buttons({
      style: { color: 'gold', shape: 'pill', label: 'paypal', layout: 'vertical' },
      createOrder: async function() {
         const kesAmount = Number(document.getElementById('totalAmount')?.innerText || 0);
         const usdAmount = parseFloat((kesAmount / 130).toFixed(2));
         
         if (kesAmount <= 0) {
            showPaymentStatus('Please select a service before initiating PayPal payment.', true);
            throw new Error('No service selected. Please select at least one service.');
         }
         
         if (usdAmount <= 0 || isNaN(usdAmount)) {
            showPaymentStatus('Invalid payment amount calculated.', true);
            throw new Error('Invalid payment amount. Please try again.');
         }
         
         try {
            const response = await fetchWithAuth('/api/paypal/create-order', {
               method: 'POST',
               body: JSON.stringify({ amount: usdAmount, cvId: latestCvId })
            });
            
            if (!response.ok) {
               const data = await response.json();
               const errorMsg = data.error || data.message || 'PayPal order creation failed';
               showPaymentStatus(`PayPal Error: ${errorMsg}`, true);
               throw new Error(errorMsg);
            }
            
            const data = await response.json();
            
            if (!data.id) {
               const errorMsg = data.error || 'PayPal did not return an order ID';
               console.error('PayPal create order invalid response:', data);
               showPaymentStatus(`PayPal Error: ${errorMsg}`, true);
               throw new Error(errorMsg);
            }
            
            return data.id;
         } catch (err) {
            const errorMsg = err.message || 'Failed to create PayPal order';
            console.error('PayPal createOrder error:', err);
            showPaymentStatus(`Payment Error: ${errorMsg}`, true);
            throw new Error(errorMsg);
         }
      },
      onApprove: async function(data) {
         const orderId = data.orderID;
         try {
            showPaymentStatus('Processing PayPal payment...');
            const response = await fetchWithAuth('/api/paypal/capture-order', {
               method: 'POST',
               body: JSON.stringify({ orderID: orderId })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
               const errorMsg = result.error || result.message || 'PayPal capture failed';
               showPaymentStatus(`Payment Error: ${errorMsg}`, true);
               throw new Error(errorMsg);
            }
            
            if (response.ok && result.success) {
               hasPaid = true;
               showPaymentStatus('PayPal payment captured successfully.');
               alert('PayPal payment successful! Your full CV is unlocked.');
               
               if (latestCvId) {
                  try {
                     const res = await fetchWithAuth(`/cv/full/${encodeURIComponent(latestCvId)}`);
                     const j = await res.json();
                     if (res.ok && j.success) {
                        latestCV = j.cv;
                        setOutputText(latestCV);
                     }
                  } catch (e) {
                     console.error('Failed to fetch full CV:', e);
                  }
               }
               return;
            }
            
            // Capture incomplete; poll for webhook confirmation
            showPaymentStatus('Verifying payment status...');
            await waitForPayment(orderId, { interval: 3000, timeout: 120000 });
            showPaymentStatus('Payment confirmed.');
            
            if (latestCvId) {
               try {
                  const res = await fetchWithAuth(`/cv/full/${encodeURIComponent(latestCvId)}`);
                  const j = await res.json();
                  if (res.ok && j.success) {
                     latestCV = j.cv;
                     setOutputText(latestCV);
                  }
               } catch (e) {
                  console.error('Failed to fetch full CV:', e);
               }
            }
         } catch (err) {
            console.error('PayPal approval error:', err);
            showPaymentStatus(`Payment verification failed: ${err.message || 'Unknown error'}`, true);
         }
      },
      onError: function(err) {
         console.error('PayPal Buttons error:', err);
         showPaymentStatus(`PayPal Error: ${err.message || 'Payment error occurred'}`, true);
      }
   }).render('#paypal-button-container');
}

async function handleMpesaPayment() {
   const totalKes = updateTotalAmount();
   if (!totalKes || totalKes <= 0) {
      alert('Please select a service before paying with M-Pesa.');
      showPaymentStatus('Select at least one service to continue.', true);
      return;
   }

   const phoneInput = document.getElementById('mpesaPhone');
   const rawPhone = phoneInput?.value.trim();
   if (!rawPhone) {
      alert('Please enter your M-Pesa phone number.');
      showPaymentStatus('M-Pesa phone number is required.', true);
      if (phoneInput) phoneInput.focus();
      return;
   }

   const normalizedPhone = normalizePhoneNumber(rawPhone);
   if (!normalizedPhone) {
      alert('Phone number must be in 07XXXXXXXX or 2547XXXXXXXX format.');
      showPaymentStatus('Invalid M-Pesa phone number format.', true);
      if (phoneInput) phoneInput.focus();
      return;
   }

   showPaymentStatus('Initiating M-Pesa payment request...');
   try {
      const response = await fetchWithAuth('/pay-premium', {
         method: 'POST',
         body: JSON.stringify({ amount: Number(totalKes), phone: normalizedPhone, cvId: latestCvId })
      });
      const data = await response.json();
      
      if (!response.ok) {
         const errorMsg = data.message || data.error || 'M-Pesa payment failed';
         throw new Error(errorMsg);
      }
      
      if (!data.success) {
         const errorMsg = data.message || 'M-Pesa request was not successful';
         throw new Error(errorMsg);
      }
      
      showPaymentStatus('M-Pesa STK Push sent. Please approve the payment on your phone.');
      alert('M-Pesa payment request sent. Confirm the payment on your phone.');
      saveHistory('M-Pesa Payment', `KES ${totalKes} to ${normalizedPhone}`);
   } catch (error) {
      console.error('MPesa payment error:', error);
      const errorMsg = error.message || 'M-Pesa request failed.';
      showPaymentStatus(`M-Pesa Error: ${errorMsg}`, true);
      alert(`M-Pesa Payment Failed: ${errorMsg}`);
   }
}

function attachActionEvents() {
   const authBtn = document.getElementById('primaryAuthBtn');
   const authToggle = document.getElementById('authToggleText');
   const logoutBtn = document.getElementById('logoutBtn');
   const extractImageBtn = document.getElementById('extractImageTextBtn');
   const extractInfoBtn = document.getElementById('extractInformationBtn');
   const generateCvBtn = document.getElementById('generateCvBtn');
   const generateCoverBtn = document.getElementById('generateCoverLetterBtn');
   const generateTipsBtn = document.getElementById('generateInterviewTipsBtn');
   const downloadCvBtn = document.getElementById('downloadCvPdfBtn');
   const downloadCoverBtn = document.getElementById('downloadCoverLetterPdfBtn');
   const mpesaButton = document.getElementById('payServiceBtn');
   const checkboxes = document.querySelectorAll('.serviceCheck');

   if (authBtn) authBtn.addEventListener('click', (e) => { e.preventDefault(); handleAuthSubmit(); });
   if (authToggle) authToggle.addEventListener('click', (e) => { e.preventDefault(); toggleAuthMode(); });
   if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
   if (extractImageBtn) extractImageBtn.addEventListener('click', (e) => { e.preventDefault(); extractFromImage(); });
   if (extractInfoBtn) extractInfoBtn.addEventListener('click', (e) => { e.preventDefault(); extractInformation(); });
   if (generateCvBtn) generateCvBtn.addEventListener('click', (e) => { e.preventDefault(); generateCv(); });
   if (generateCoverBtn) generateCoverBtn.addEventListener('click', (e) => { e.preventDefault(); generateCoverLetter(); });
   if (generateTipsBtn) generateTipsBtn.addEventListener('click', (e) => { e.preventDefault(); generateInterviewTips(); });
   if (downloadCvBtn) downloadCvBtn.addEventListener('click', (e) => { e.preventDefault(); downloadCvPdf(); });
   if (downloadCoverBtn) downloadCoverBtn.addEventListener('click', (e) => { e.preventDefault(); downloadCoverLetterPdf(); });
   if (mpesaButton) mpesaButton.addEventListener('click', (e) => { e.preventDefault(); handleMpesaPayment(); });
   checkboxes.forEach(cb => cb.addEventListener('change', updateTotalAmount));
}

async function initializeApp() {
   onAuthStateChangedListener((user) => {
      setAppVisibility(!!user);
   });
   setAppVisibility(!!getCurrentUser());
   attachActionEvents();
   updateTotalAmount();
   renderHistory();
   await initPayPalButtonsIfConfigured();
}

async function waitForPayment(orderId, { interval = 2000, timeout = 120000 } = {}) {
   const start = Date.now();
   showPaymentStatus('Waiting for payment confirmation...');
   while (Date.now() - start < timeout) {
      try {
         const resp = await fetchWithAuth('/verify-payment', {
            method: 'POST',
            body: JSON.stringify({ orderId })
         });
         const j = await resp.json();
         if (j.verified) {
            showPaymentStatus('Payment confirmed.');
            return j.payment;
         }
      } catch (e) {
         console.error('waitForPayment error', e);
      }
      await new Promise(r => setTimeout(r, interval));
   }
   showPaymentStatus('Payment not confirmed (timeout).', true);
   throw new Error('timeout');
}

async function startApp() {
   if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeApp);
   } else {
      await initializeApp();
   }
}

startApp().catch(err => console.error('App startup failed:', err));
