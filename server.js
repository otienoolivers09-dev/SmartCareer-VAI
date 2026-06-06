import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import OpenAI from "openai";
import axios from "axios";
import paypal from "@paypal/checkout-server-sdk";
import crypto from "crypto";
import path from "path";
import admin from "firebase-admin";
import payments from "./payments-firebase.js";

dotenv.config();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

/* =========================
   FIREBASE ADMIN INITIALIZATION
========================= */
const firebaseConfigJson = process.env.FIREBASE_CONFIG_JSON;
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;

try {
    if (firebaseConfigJson) {
        let config;
        try {
            // Try parsing as base64 first (for backwards compatibility)
            config = JSON.parse(Buffer.from(firebaseConfigJson, 'base64').toString('utf8'));
        } catch (e) {
            // If base64 fails, try parsing as direct JSON
            config = JSON.parse(firebaseConfigJson);
        }
        admin.initializeApp({
            credential: admin.credential.cert(config),
            projectId: firebaseProjectId || config.project_id
        });
    } else if (firebaseServiceAccountPath) {
        admin.initializeApp({
            credential: admin.credential.cert(firebaseServiceAccountPath),
            projectId: firebaseProjectId
        });
    } else if (firebaseProjectId) {
        console.warn('⚠️ FIREBASE_PROJECT_ID is set but no service account credentials are configured. Skipping Firebase initialization to avoid default credential fallback.');
    } else {
        console.warn('⚠️ Firebase Admin SDK not configured. Set FIREBASE_CONFIG_JSON, FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS in .env');
    }
} catch (err) {
    console.error('Firebase Admin initialization failed:', err.message);
}

const firebaseInitialized = !!admin.apps.length;
let paymentsAvailable = false;

/* =========================
   SECURITY MIDDLEWARE
========================= */

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
    const nonce = res.locals.nonce;
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://www.paypal.com https://www.paypalobjects.com https://sb.paypal.com https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
        "style-src 'self'",
        "img-src 'self' data: https://images.unsplash.com",
        "connect-src 'self' https://api-m.sandbox.paypal.com https://api-m.paypal.com https://sandbox.safaricom.co.ke https://www.googleapis.com https://firestore.googleapis.com",
        "font-src 'self'",
        "object-src 'none'",
        "frame-src 'self' https://www.paypal.com https://www.paypalobjects.com",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; '));
    next();
});

app.use(helmet.hsts({
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
}));

app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

// HTTPS redirect in production
if (isProduction) {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}

// CORS - restrict to allowed origins only
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500').split(',');
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS not allowed'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Request size limits
app.use(express.json({ 
    limit: '100kb',
    verify: (req, res, buf) => {
        try {
            req.rawBody = buf && buf.toString('utf8');
        } catch (e) {
            req.rawBody = undefined;
        }
    }
}));

app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Rate limiting - API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limiter for payment endpoints
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // max 10 payment requests per minute
    message: 'Too many payment requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Serve only public folder
app.use(express.static(path.join(process.cwd(), 'public'), { dotfiles: 'ignore' }));
app.use('/admin', express.static(path.join(process.cwd(), 'admin'), { dotfiles: 'ignore' }));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function isPayPalConfigured() {
    return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function isOpenAIConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
}

function isMpesaConfigured() {
    return Boolean(
        process.env.MPESA_CONSUMER_KEY &&
        process.env.MPESA_CONSUMER_SECRET &&
        process.env.MPESA_SHORTCODE &&
        process.env.MPESA_PASSKEY &&
        process.env.MPESA_CALLBACK_URL
    );
}

app.get('/config', (req, res) => {
    res.json({
        paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
        paypalMode: process.env.PAYPAL_MODE || 'sandbox',
        mpesaConfigured: isMpesaConfigured(),
        firebaseConfigured: firebaseInitialized,
        openAIConfigured: isOpenAIConfigured()
    });
});

/* =========================
   VALIDATION SCHEMAS
========================= */

const paymentAmountSchema = Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    cvId: Joi.string().max(200).optional().allow(null),
    maxUses: Joi.number().integer().min(1).max(10).optional().default(1)
});

const mpesaPaymentSchema = Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    phone: Joi.string().pattern(/^254\d{9}$/).required().messages({
        'string.pattern.base': 'Phone must be 254XXXXXXXXX format'
    }),
    cvId: Joi.string().max(200).optional().allow(null),
    maxUses: Joi.number().integer().min(1).max(10).optional().default(1)
});

const extractInfoSchema = Joi.object({
    rawText: Joi.string().max(50000).required()
});

const cvGenerationSchema = Joi.object({
    fullName: Joi.string().max(100),
    jobTarget: Joi.string().max(200),
    skills: Joi.string().max(1000),
    experience: Joi.string().max(2000),
    education: Joi.string().max(1000)
});

/* =========================
   AUTH HELPERS
========================= */

// Simple token validation (use JWT in production)
function validateApiToken(req) {
    const token = req.headers['x-api-key'] || req.query.token;
    return token === process.env.API_ADMIN_TOKEN;
}

// Check whether request is an admin request: either server API token or Firebase ID token with admin claim
async function isAdminRequest(req) {
    try {
        // server-to-server API token
        if (validateApiToken(req)) return true;

        // Firebase ID token with admin claim
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
        const token = authHeader.substring(7);
        const decoded = await admin.auth().verifyIdToken(token);
        // Accept either custom claim `admin: true`, `isAdmin: true`, or role === 'admin'
        if (decoded && (decoded.admin === true || decoded.isAdmin === true || decoded.role === 'admin' || decoded.roles && decoded.roles.includes && decoded.roles.includes('admin'))) {
            // attach user info for downstream
            req.user = decoded;
            req.userId = decoded.uid;
            return true;
        }
        return false;
    } catch (e) {
        // verification failed
        return false;
    }
}

// Firebase token verification middleware
async function verifyFirebaseToken(req, res, next) {
    if (!firebaseInitialized) {
        return res.status(503).json({ success: false, message: 'Firebase authentication is not configured on this server' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Missing or invalid authorization header' });
        }

        const token = authHeader.substring(7);
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        req.userId = decodedToken.uid;
        next();
    } catch (error) {
        console.error('Firebase token verification failed:', error.message);
        res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
    }
}

async function getFirebaseUid(req) {
    if (!firebaseInitialized) {
        throw new Error('Firebase is not configured');
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing Firebase bearer token');
    }
    const token = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
}

// Payment verification middleware - checks if user has paid
// If a cvId is present in params/body/query, require payment tied to that CV.
async function verifyPaymentStatus(req, res, next) {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, message: 'User ID required' });
        }

        const cvId = req.params.cvId || req.query.cvId || req.body.cvId || null;

        // Prefer payment tied to specific CV
        let userPayments;
        if (cvId) {
            userPayments = await payments.listPayments({ limit: 1, user_id: req.userId, cv_id: cvId });
        } else {
            userPayments = await payments.listPayments({ limit: 1, user_id: req.userId });
        }

        const hasValidPayment = userPayments && userPayments.length > 0 &&
                               (userPayments[0].status === 'COMPLETED' || userPayments[0].status === 'PAID');

        if (!hasValidPayment) {
            const msg = cvId ? 'Payment required for this CV: complete payment to access full CV' : 'Payment required: Please complete payment to access this service';
            return res.status(403).json({ 
                success: false, 
                message: msg,
                paymentRequired: true 
            });
        }

        req.payment = userPayments[0];
        next();
    } catch (error) {
        console.error('Payment verification error:', error.message);
        res.status(500).json({ success: false, message: 'Payment verification failed' });
    }
}

/* =========================
   PAYPAL CONFIG
========================= */
function paypalEnvironment() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    return process.env.PAYPAL_MODE === "live" 
        ? new paypal.core.LiveEnvironment(clientId, clientSecret)
        : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment());

// initialize payments DB only when Firebase is ready
if (firebaseInitialized) {
    payments.initDB()
        .then(() => {
            paymentsAvailable = true;
        })
        .catch(err => {
            console.warn("Payments DB initialization failed. PayPal payment persistence is disabled.", err.message || err);
            paymentsAvailable = false;
        });
} else {
    console.warn('Skipping Firestore init because Firebase is not configured. Payment persistence will be unavailable.');
}

// helper to get PayPal access token for REST calls
async function getPaypalAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const base = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    try {
        const resp = await axios({
            method: 'post',
            url: `${base}/v1/oauth2/token`,
            auth: { username: clientId, password: clientSecret },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: 'grant_type=client_credentials',
            timeout: 10000
        });
        return { token: resp.data.access_token, base };
    } catch (err) {
        console.error('PayPal token fetch error:', err.message);
        throw new Error('Failed to get PayPal access token');
    }
}

/* =========================
   AI GENERATION ROUTES
========================= */
app.post("/extract-info", apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }
    try {
        const { error, value } = extractInfoSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Extract professional info. Return ONLY JSON." },
                { role: "user", content: value.rawText }
            ],
            max_tokens: 1000
        });
        res.json({ success: true, result: completion.choices[0].message.content });
    } catch (error) {
        console.error("Extraction Error:", error.message);
        res.status(500).json({ success: false, message: "Extraction failed" });
    }
});

app.post("/generate-cv", apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }
    try {
        const { error, value } = cvGenerationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Generate a modern ATS optimized CV." },
                { role: "user", content: JSON.stringify(value) }
            ],
            max_tokens: 2000
        });

        const fullCv = completion.choices[0].message.content || "";
        const cvId = `cv_${Date.now()}`;

        // Persist the generated CV server-side (so full content can be unlocked after payment)
        try {
            await payments.createCV({ cv_id: cvId, user_id: req.userId, content: fullCv });
        } catch (e) {
            console.error('Failed to persist CV:', e.message);
        }

        // Check whether the user has a completed payment
        const userPayments = await payments.listPayments({ limit: 1, user_id: req.userId });
        const hasPaid = userPayments && userPayments.length > 0 && (userPayments[0].status === 'COMPLETED' || userPayments[0].status === 'PAID');

        if (hasPaid) {
            return res.json({ success: true, cv: fullCv, hasPaid: true, cvId });
        }

        // Otherwise, return only the first 700 words
        const words = fullCv.split(/\s+/).filter(Boolean);
        const truncated = words.slice(0, 700).join(' ');
        return res.json({ success: true, cv: truncated, hasPaid: false, cvId, totalWords: words.length });

    } catch (error) {
        console.error("CV Generation Error:", error.message);
        res.status(500).json({ success: false, message: "CV generation failed" });
    }
});

// Endpoint to retrieve full CV after payment OR with a valid one-time token
app.get('/cv/full/:cvId', apiLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await payments.getCVById(cvId);
        if (!record) return res.status(404).json({ success: false, message: 'CV not found' });

        const authHeader = req.headers.authorization;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        // First, try token-based access
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7).trim();
            try {
                const tokRec = await payments.getTokenRecord(token);
                if (tokRec && tokRec.cv_id === cvId) {
                    const now = new Date();
                    if (tokRec.used) {
                        await payments.logAccess({ cv_id: cvId, user_id: tokRec.user_id, token, ip, success: false, reason: 'token_used' });
                        return res.status(403).json({ success: false, message: 'Token already used' });
                    }
                    if (tokRec.expires_at && new Date(tokRec.expires_at) < now) {
                        await payments.logAccess({ cv_id: cvId, user_id: tokRec.user_id, token, ip, success: false, reason: 'token_expired' });
                        return res.status(403).json({ success: false, message: 'Token expired' });
                    }
                    try {
                        const newCount = await payments.incrementTokenUsage(token);
                        await payments.logAccess({ cv_id: cvId, user_id: tokRec.user_id, token, ip, success: true });
                        return res.json({ success: true, cv: record.content, usageCount: newCount, maxUses: tokRec.max_uses || 1 });
                    } catch (usageErr) {
                        const msg = usageErr.message || 'Token usage error';
                        const reason = msg === 'Token expired' ? 'token_expired' : (msg === 'Token usage limit reached' ? 'token_limit' : 'token_error');
                        await payments.logAccess({ cv_id: cvId, user_id: tokRec.user_id, token, ip, success: false, reason });
                        return res.status(403).json({ success: false, message: msg });
                    }
                }
            } catch (e) {
                console.error('Token validation error:', e.message);
            }
        }

        if (!firebaseInitialized) {
            return res.status(403).json({ success: false, message: 'Firebase authentication is required to unlock this CV' });
        }

        try {
            const userId = await getFirebaseUid(req);
            const userPayments = await payments.listPayments({ limit: 1, user_id: userId, cv_id: cvId });
            const hasValidPayment = userPayments && userPayments.length > 0 && (userPayments[0].status === 'COMPLETED' || userPayments[0].status === 'PAID');
            if (!hasValidPayment) {
                await payments.logAccess({ cv_id: cvId, user_id: userId, token: null, ip, success: false, reason: 'no_payment' });
                return res.status(403).json({ success: false, message: 'Payment required for this CV' });
            }
            await payments.logAccess({ cv_id: cvId, user_id: userId, token: null, ip, success: true });
            return res.json({ success: true, cv: record.content });
        } catch (err) {
            if (err.message && err.message.includes('Missing Firebase')) {
                return res.status(401).json({ success: false, message: 'Missing Firebase token' });
            }
            console.error('Get full CV error:', err.message);
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

    } catch (err) {
        console.error('Get full CV outer error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch CV' });
    }
});

app.post("/generate-cover-letter", apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }
    try {
        const { fullName, jobTarget, skills } = req.body;
        if (!fullName || !jobTarget || !skills) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Generate a professional cover letter. Return only the cover letter text." },
                { role: "user", content: `Full Name: ${fullName}\nJob Target: ${jobTarget}\nSkills: ${skills}` }
            ],
            max_tokens: 1500
        });
        res.json({ success: true, coverLetter: completion.choices[0].message.content });
    } catch (error) {
        console.error("Cover Letter Generation Error:", error.message);
        res.status(500).json({ success: false, message: "Cover letter generation failed" });
    }
});

app.post("/generate-interview-tips", apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }
    try {
        const { jobTarget, skills, experience } = req.body;
        if (!jobTarget || !skills) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert career coach. Generate interview tips for this role." },
                { role: "user", content: `Job: ${jobTarget}\nSkills: ${skills}\nExp: ${experience || 'N/A'}` }
            ],
            max_tokens: 1500
        });
        res.json({ success: true, interviewTips: completion.choices[0].message.content });
    } catch (error) {
        console.error("Interview Tips Error:", error.message);
        res.status(500).json({ success: false, message: "Interview tips generation failed" });
    }
});

/* =========================
   MPESA LOGIC
========================= */
function getMpesaCallbackPath() {
    const rawPath = process.env.MPESA_CALLBACK_URL || '/webhook/mpesa';
    try {
        const parsed = new URL(rawPath);
        return parsed.pathname || '/webhook/mpesa';
    } catch (e) {
        return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    }
}

const mpesaCallbackPath = getMpesaCallbackPath();

async function getMpesaAccessToken() {
    // Ensure required credentials exist
    if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET) {
        console.warn('M-Pesa credentials missing (MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET)');
        throw new Error('M-Pesa not configured');
    }

    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
    try {
        const baseUrl = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        const response = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` },
            timeout: 10000
        });
        return response.data.access_token;
    } catch (err) {
        console.error('M-Pesa token fetch error:', err.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

app.post("/pay-premium", paymentLimiter, async (req, res) => {
    try {
        const { error, value } = mpesaPaymentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        // Get user ID from Firebase token if available
        let userId = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decodedToken = await admin.auth().verifyIdToken(token);
                userId = decodedToken.uid;
            } catch (tokenErr) {
                console.warn('Firebase token not provided for M-Pesa payment, using phone as ID');
            }
        }

        let accessToken;
        try {
            accessToken = await getMpesaAccessToken();
        } catch (e) {
            // If M-Pesa not configured, respond gracefully
            if (e && e.message && e.message.toLowerCase().includes('m-pesa not configured')) {
                console.warn('M-Pesa configuration missing, rejecting request');
                return res.status(503).json({ success: false, message: 'M-Pesa payments are not configured on this server' });
            }
            console.error('M-Pesa Error:', e.message);
            return res.status(502).json({ success: false, message: 'M-Pesa service unavailable' });
        }
        // Ensure merchant configuration present
        if (!process.env.MPESA_SHORTCODE || !process.env.MPESA_PASSKEY || !process.env.MPESA_CALLBACK_URL) {
            console.warn('M-Pesa merchant config missing (MPESA_SHORTCODE/MPESA_PASSKEY/MPESA_CALLBACK_URL)');
            return res.status(503).json({ success: false, message: 'M-Pesa merchant configuration incomplete on server' });
        }

        const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        const password = Buffer.from(process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp).toString("base64");

        const baseUrl = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        const response = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(value.amount),
            PartyA: value.phone,
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: value.phone,
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: "Smart CV AI",
            TransactionDesc: "CV Payment"
        }, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000
        });

        // persist pending mpesa payment with user ID if available
        try {
            const payload = response.data || {};
            const orderId = payload.CheckoutRequestID || payload.MerchantRequestID || (`mpesa_${Date.now()}`);
            await payments.createPayment({ 
                order_id: orderId, 
                cv_id: value.cvId || null,
                method: 'mpesa', 
                user_id: userId || value.phone,
                amount: value.amount, 
                currency: 'KES', 
                status: 'PENDING', 
                raw: payload,
                max_uses: value.maxUses || 1
            });
        } catch (e) {
            console.error('Failed to persist mpesa payment:', e.message);
        }
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error("M-Pesa Error:", error.message);
        res.status(500).json({ success: false, message: "M-Pesa failed" });
    }
});

/* =========================
   PAYPAL ROUTES
========================= */
app.post("/api/paypal/create-order", paymentLimiter, async (req, res) => {
    if (!isPayPalConfigured()) {
        return res.status(503).json({ error: 'PayPal credentials are not configured' });
    }
    try {
        const { error, value } = paymentAmountSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        // Get user ID from Firebase token if available
        let userId = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decodedToken = await admin.auth().verifyIdToken(token);
                userId = decodedToken.uid;
            } catch (tokenErr) {
                console.warn('Firebase token not provided for PayPal order');
            }
        }

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: "CAPTURE",
            purchase_units: [{
                amount: { currency_code: "USD", value: value.amount.toFixed(2) }
            }],
            application_context: {
                brand_name: "Smart CV AI",
                landing_page: "NO_PREFERENCE",
                user_action: "PAY_NOW"
            }
        });

        const order = await paypalClient.execute(request);
        
        if (paymentsAvailable) {
            try {
                await payments.createPayment({ 
                    order_id: order.result.id, 
                    cv_id: value.cvId || null,
                    method: 'paypal', 
                    user_id: userId,
                    amount: value.amount, 
                    currency: 'USD', 
                    status: 'PENDING', 
                    raw: order.result,
                    max_uses: value.maxUses || 1
                });
            } catch (e) {
                console.error('Failed to create payment record:', e.message);
            }
        } else {
            console.warn('Firebase is not configured; skipping PayPal payment persistence.');
        }
        
        res.json({ id: order.result.id });
    } catch (error) {
        console.error("PayPal Create Order Error:", error.message);
        res.status(500).json({ error: "PayPal order failed" });
    }
});

app.post("/api/paypal/capture-order", paymentLimiter, async (req, res) => {
    if (!isPayPalConfigured()) {
        return res.status(503).json({ success: false, error: 'PayPal credentials are not configured' });
    }
    try {
        const orderId = req.body.orderID;
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'Missing orderID' });
        }

        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await paypalClient.execute(request);

        let paymentRecord = null;
        let tokenInfo = null;

        if (paymentsAvailable) {
            try {
                const status = (capture.result && capture.result.status) || 'COMPLETED';
                const payerEmail = capture.result && capture.result.payer && capture.result.payer.email_address;
                await payments.updatePaymentByOrderId(orderId, { status, payer_email: payerEmail, raw: capture.result });
                paymentRecord = await payments.getPaymentByOrderId(orderId);
            } catch (e) {
                console.error('Failed to update payment after capture:', e.message);
            }

            // Create a single-use token for CV access tied to this payment (ttl 24h)
            try {
                tokenInfo = await payments.createTokenForPayment(orderId, 24 * 3600, {
                    cv_id: paymentRecord?.cv_id || null,
                    user_id: paymentRecord?.user_id || null,
                    maxUses: (paymentRecord?.max_uses || 1)
                });
            } catch (e) {
                console.warn('Failed to create access token:', e.message);
            }
        } else {
            console.warn('Firebase is not configured; skipping payment persistence and token generation.');
        }

        res.json({ success: true, data: capture.result, token: tokenInfo });
    } catch (error) {
        console.error("PayPal Capture Error:", error.message);
        res.status(500).json({ success: false, error: 'PayPal capture failed' });
    }
});

// PayPal webhook receiver - verify and update payment records
app.post('/webhook/paypal', async (req, res) => {
    try {
        // verify webhook signature
        const transmissionId = req.headers['paypal-transmission-id'];
        const transmissionTime = req.headers['paypal-transmission-time'];
        const transmissionSig = req.headers['paypal-transmission-sig'];
        const certUrl = req.headers['paypal-cert-url'];
        const authAlgo = req.headers['paypal-auth-algo'];
        const webhookId = process.env.PAYPAL_WEBHOOK_ID;

        if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo || !webhookId) {
            console.error('Missing PayPal webhook headers');
            return res.status(400).json({ error: 'Missing webhook headers' });
        }

        const { token, base } = await getPaypalAccessToken();
        const verifyUrl = `${base}/v1/notifications/verify-webhook-signature`;
        let webhookEvent;
        try {
            webhookEvent = req.rawBody ? JSON.parse(req.rawBody) : req.body;
        } catch (e) {
            webhookEvent = req.body;
        }

        const verifyBody = {
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: webhookId,
            webhook_event: webhookEvent
        };

        const verifyResp = await axios.post(verifyUrl, verifyBody, { 
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 10000
        });

        if (!verifyResp.data || verifyResp.data.verification_status !== 'SUCCESS') {
            console.error('PayPal webhook verification failed');
            return res.status(400).json({ verified: false });
        }

        const event = req.body;
        const et = event.event_type;
        const resource = event.resource || {};
        
        let orderId = resource.id || resource.order_id || (resource.invoice_id ? resource.invoice_id : null);
        if (!orderId && resource.links) {
            const ord = resource.links.find(l => l.rel === 'upstream' || l.rel === 'self');
            if (ord && ord.href) orderId = ord.href.split('/').pop();
        }

        if (orderId) {
            if (et === 'PAYMENT.CAPTURE.COMPLETED' || et === 'CHECKOUT.ORDER.COMPLETED') {
                await payments.updatePaymentByOrderId(orderId, { status: 'COMPLETED', raw: resource });
                try {
                    const paymentRecord = await payments.getPaymentByOrderId(orderId);
                    await payments.createTokenForPayment(orderId, 24 * 3600, {
                        cv_id: paymentRecord?.cv_id || null,
                        user_id: paymentRecord?.user_id || null,
                        maxUses: (paymentRecord?.max_uses || 1)
                    });
                } catch (e) {
                    console.warn('Failed to create token on webhook completion:', e.message);
                }
            } else if (et === 'CHECKOUT.ORDER.APPROVED') {
                        try {
                            const captureReq = new paypal.orders.OrdersCaptureRequest(orderId);
                            captureReq.requestBody({});
                            const captureResp = await paypalClient.execute(captureReq);
                            const cap = captureResp.result;
                            const status = (cap && cap.status) || 'COMPLETED';
                            await payments.updatePaymentByOrderId(orderId, { status, raw: cap });
                            const paymentRecord = await payments.getPaymentByOrderId(orderId);
                            try {
                                await payments.createTokenForPayment(orderId, 24 * 3600, {
                                    cv_id: paymentRecord?.cv_id || null,
                                    user_id: paymentRecord?.user_id || null,
                                    maxUses: (paymentRecord?.max_uses || 1)
                                });
                            } catch (e) {
                                console.warn('Failed to create token after capture-on-webhook:', e.message);
                            }
                        } catch (e) {
                            console.error('PayPal capture-on-webhook error:', e.message);
                            await payments.updatePaymentByOrderId(orderId, { status: 'COMPLETED', raw: resource });
                            const paymentRecord = await payments.getPaymentByOrderId(orderId);
                            try {
                                await payments.createTokenForPayment(orderId, 24 * 3600, {
                                    cv_id: paymentRecord?.cv_id || null,
                                    user_id: paymentRecord?.user_id || null,
                                    maxUses: (paymentRecord?.max_uses || 1)
                                });
                            } catch (e2) {
                                console.warn('Failed to create token after fallback:', e2.message);
                            }
                        }
                    } else if (et === 'PAYMENT.CAPTURE.DENIED' || et === 'PAYMENT.CAPTURE.REFUNDED') {
                        await payments.updatePaymentByOrderId(orderId, { status: 'FAILED', raw: resource });
                    } else {
                        await payments.updatePaymentByOrderId(orderId, { raw: resource });
                    }
                }
        
        res.status(200).json({ received: true, verified: true });
    } catch (err) {
        console.error('PayPal webhook error:', err.message);
        res.status(500).end();
    }
});

// MPESA webhook receiver (STK Push callback)
app.post(mpesaCallbackPath, async (req, res) => {
    try {
        const body = req.body;
        // The callback contains CheckoutRequestID and ResultCode inside body.Body.stkCallback
        const cb = (body && body.Body && body.Body.stkCallback) || body;
        const checkoutId = cb && (cb.CheckoutRequestID || cb.CheckoutRequestID) ;
        const resultCode = cb && cb.ResultCode;
        const raw = cb;
        if (checkoutId) {
            const status = resultCode === 0 ? 'COMPLETED' : 'FAILED';
            await payments.updatePaymentByOrderId(checkoutId, { status, raw });
            if (status === 'COMPLETED') {
                try {
                    const paymentRecord = await payments.getPaymentByOrderId(checkoutId);
                    await payments.createTokenForPayment(checkoutId, 24 * 3600, {
                        cv_id: paymentRecord?.cv_id || null,
                        user_id: paymentRecord?.user_id || null,
                        maxUses: (paymentRecord?.max_uses || 1)
                    });
                } catch (e) {
                    console.warn('Failed to create token for mpesa payment:', e.message);
                }
            }
        }
                res.json({ received: true });
    } catch (err) {
        console.error('MPESA webhook error:', err);
        res.status(500).end();
    }
});

// Verify payment endpoint: accept { orderId } or use Firebase token
app.post('/verify-payment', async (req, res) => {
    try {
        const { orderId } = req.body;
        const authHeader = req.headers.authorization;
        
        // If orderId provided, check that payment
        if (orderId) {
            const p = await payments.getPaymentByOrderId(orderId);
            return res.json({ verified: !!p && (p.status === 'COMPLETED' || p.status === 'PAID'), payment: p || null });
        }
        
        // Otherwise, verify via Firebase token
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decodedToken = await admin.auth().verifyIdToken(token);
                const userId = decodedToken.uid;
                
                const list = await payments.listPayments({ limit: 1, user_id: userId });
                const p = list && list[0];
                return res.json({ verified: !!p && (p.status === 'COMPLETED' || p.status === 'PAID'), payment: p || null });
            } catch (tokenErr) {
                console.error('Firebase token verification failed:', tokenErr.message);
            }
        }
        
        res.status(400).json({ error: 'Provide orderId or Firebase token in Authorization header' });
    } catch (err) {
        console.error('Verify payment error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Payment history - SECURED with API key
app.get('/payments/history', async (req, res) => {
    try {
        // In production, require admin: either server token or Firebase admin user
            if (isProduction && !(await isAdminRequest(req))) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { userId, limit = 50, offset = 0 } = req.query;
        const validatedLimit = Math.min(parseInt(limit, 10) || 50, 100); // cap at 100
        const validatedOffset = Math.max(parseInt(offset, 10) || 0, 0);
        
        const data = await payments.listPayments({ 
            limit: validatedLimit, 
            offset: validatedOffset, 
            user_id: userId 
        });
        
        res.json({ success: true, payments: data });
    } catch (err) {
        console.error('Payments history error:', err.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Admin endpoints (protected: allow server API token OR Firebase admin users)
app.get('/admin/access-logs', async (req, res) => {
    try {
        if (!(await isAdminRequest(req))) return res.status(403).json({ error: 'Unauthorized' });
        const { cvId } = req.query;
        if (!cvId) return res.status(400).json({ error: 'cvId query parameter required' });
        const logs = await payments.getAccessLogsByCv(cvId);
        res.json({ success: true, logs });
    } catch (err) {
        console.error('Admin access logs error:', err.message);
        res.status(500).json({ error: 'Failed to fetch access logs' });
    }
});

// Admin payments proxy (optional)
app.get('/admin/payments', async (req, res) => {
    try {
        if (!(await isAdminRequest(req))) return res.status(403).json({ error: 'Unauthorized' });
        const { userId, limit = 50, offset = 0 } = req.query;
        const data = await payments.listPayments({ limit: Math.min(parseInt(limit,10)||50,100), offset: Math.max(parseInt(offset,10)||0,0), user_id: userId });
        res.json({ success: true, payments: data });
    } catch (err) {
        console.error('Admin payments error:', err.message);
        res.status(500).json({ error: 'Failed to fetch payments' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', environment: process.env.NODE_ENV || 'development' });
});

/* =========================
   STARTUP
========================= */
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const MAX_PORT = DEFAULT_PORT + 5;

function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < MAX_PORT) {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
            process.exit(1);
        }
    });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    startServer(DEFAULT_PORT);
}

export default app;
