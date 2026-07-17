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
import fs from 'fs';
import { truncateToFirstWords } from './public/payment-utils.js';

dotenv.config();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

/* =========================
   FIREBASE ADMIN INITIALIZATION
========================= */
const firebaseConfigJson = process.env.FIREBASE_CONFIG_JSON;
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;

function formatFirebasePrivateKey(key) {
    if (!key) return key;
    return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function parseFirebaseConfigJson(rawValue) {
    if (!rawValue) return null;

    let parsed = null;
    try {
        parsed = JSON.parse(Buffer.from(rawValue, 'base64').toString('utf8'));
    } catch (e) {
        try {
            parsed = JSON.parse(rawValue);
        } catch (innerErr) {
            console.error('Failed to parse FIREBASE_CONFIG_JSON:', innerErr.message);
            parsed = null;
        }
    }
    return parsed;
}

function parseFirebaseServiceAccount(rawValue) {
    if (!rawValue) return null;
    const trimmed = rawValue.trim();
    // Attempt multiple parse strategies:
    // 1. If it looks like JSON, parse it (and attempt to decode if it's base64 encoded JSON).
    // 2. If it looks like base64, decode then parse.
    // 3. Otherwise assume it's a file path to a service account JSON file.
    try {
        if (trimmed.startsWith('{')) {
            // Plain JSON string
            return JSON.parse(trimmed);
        }

        // If it only contains base64 characters (and maybe padding), try decoding
        const base64Candidate = /^[A-Za-z0-9+/=\s]+$/.test(trimmed.replace(/\r?\n/g, ''));
        if (base64Candidate) {
            try {
                const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                return parsed;
            } catch (e) {
                // Not base64 JSON — fall through to treat as path
            }
        }
    } catch (e) {
        // parsing attempt failed; we'll treat as file path below
    }

    // Fallback: assume this is a file path to the service account
    return rawValue;
}

let paymentsAvailable = false;

try {
    const envServiceAccount = (firebaseProjectId && firebaseClientEmail && firebasePrivateKey)
        ? {
            projectId: firebaseProjectId,
            clientEmail: firebaseClientEmail,
            privateKey: formatFirebasePrivateKey(firebasePrivateKey)
        }
        : null;

    const parsedConfig = parseFirebaseConfigJson(firebaseConfigJson);
    if (parsedConfig) {
        console.log('Initializing Firebase using FIREBASE_CONFIG_JSON');
        admin.initializeApp({
            credential: admin.credential.cert(parsedConfig),
            projectId: firebaseProjectId || parsedConfig.project_id
        });
    } else if (envServiceAccount) {
        console.log('Initializing Firebase using explicit env service account values');
        admin.initializeApp({
            credential: admin.credential.cert(envServiceAccount),
            projectId: firebaseProjectId
        });
    } else if (firebaseServiceAccountPath) {
        // The service account value may be a JSON string, a base64-encoded JSON string, or a file path.
        const parsedServiceAccount = parseFirebaseServiceAccount(firebaseServiceAccountPath);
        if (typeof parsedServiceAccount === 'string') {
            // treat as file path if exists
            if (fs.existsSync(parsedServiceAccount)) {
                try {
                    const fileContents = fs.readFileSync(parsedServiceAccount, 'utf8');
                    const json = JSON.parse(fileContents);
                    // Ensure private_key formatting
                    if (json && json.private_key) json.private_key = formatFirebasePrivateKey(json.private_key);
                    console.log('Initializing Firebase using service account file from path');
                    admin.initializeApp({ credential: admin.credential.cert(json), projectId: firebaseProjectId });
                } catch (e) {
                    console.error('Failed to read or parse Firebase service account file:', e.stack || e.message || e);
                    throw e;
                }
            } else {
                // If it is a path-like string but does not exist, pass through to admin which may attempt to read it.
                console.log('Initializing Firebase using service account path (file not found locally):', parsedServiceAccount);
                admin.initializeApp({ credential: admin.credential.cert(parsedServiceAccount), projectId: firebaseProjectId });
            }
        } else {
            // If parsedServiceAccount is a JSON object, ensure private_key formatting before initializing
            if (parsedServiceAccount && parsedServiceAccount.private_key) {
                parsedServiceAccount.private_key = formatFirebasePrivateKey(parsedServiceAccount.private_key);
            }
            console.log('Initializing Firebase using parsed service account JSON from env');
            admin.initializeApp({ credential: admin.credential.cert(parsedServiceAccount), projectId: firebaseProjectId });
        }
    } else if (firebaseProjectId && !firebaseServiceAccountPath) {
        console.warn('⚠️ FIREBASE_PROJECT_ID is set but no service account credentials are configured. Skipping Firebase initialization to avoid default credential fallback.');
    } else {
        console.warn('⚠️ No Firebase configuration found. Set FIREBASE_CONFIG_JSON, FIREBASE_SERVICE_ACCOUNT_PATH, or explicit Firebase env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).');
    }
} catch (err) {
    const message = err && err.stack ? err.stack : (err && err.message) ? err.message : String(err);
    console.error('Firebase Admin initialization failed:', message);
    // Detect common OpenSSL decoder error and provide actionable hint
    if (message && message.includes('DECODER')) {
        console.error('Detected OpenSSL DECODER error when initializing Firebase. Likely causes:');
        console.error('- The private_key value is encrypted or in an unsupported format. Use an unencrypted PEM private key.');
        console.error('- Newlines in the private key should be encoded as "\\n" in environment variables; this code will convert them automatically, but double-check the value.');
        console.error('- If using a file path, ensure the file is valid JSON and accessible to the process.');
    }
}

const firebaseInitialized = !!admin.apps.length;
console.log(`Firebase initialized: ${firebaseInitialized}`);
console.log(`Firebase project id: ${firebaseProjectId || '<none>'}`);
console.log(`Firebase client email set: ${Boolean(firebaseClientEmail)}`);
console.log(`Firebase private key set: ${Boolean(firebasePrivateKey)}`);

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
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://www.paypal.com https://www.paypalobjects.com https://sb.paypal.com https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; connect-src 'self' https://www.gstatic.com https://api.smartcareervai.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https://www.sandbox.paypal.com https://www.paypalobjects.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://images.unsplash.com https://www.paypalobjects.com https://www.paypal.com https://www.sandbox.paypal.com; font-src 'self' https://fonts.gstatic.com; frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://www.paypalobjects.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
});

app.use(helmet.hsts({
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
}));

app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

// Enable proxy trust so forwarded proto works behind Render/other proxies.
app.set('trust proxy', true);

// HTTPS redirect in production, but do not force HTTPS for local development.
if (isProduction) {
    app.use((req, res, next) => {
        const host = (req.headers.host || '').toLowerCase();
        const localHostPattern = /^(localhost|127\.0\.0\.1|::1)(:\d+)?$/;
        const isLocalHost = localHostPattern.test(host);
        const remoteAddress = (req.ip || req.connection.remoteAddress || '').toString();
        const isLocalAddress = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remoteAddress);
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const isSecure = req.secure || protocol === 'https';

        if (!isSecure && !isLocalHost && !isLocalAddress) {
            res.redirect(`https://${req.headers.host}${req.url}`);
            return;
        }

        next();
    });
}

// CORS - restrict to allowed origins only
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || 'https://smart-career-vai.vercel.app,https://smartcareer-vai.onrender.com,https://www.smartcareervai.com,https://smartcareervai.com,https://api.smartcareervai.com,https://*.vercel.app';
const allowedOrigins = rawAllowedOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const defaultLocalOrigins = [
    'http://localhost:*',
    'http://127.0.0.1:*'
];

const requiredOrigins = [
    ...defaultLocalOrigins,
    'https://smart-career-vai.vercel.app',
    'https://smartcareer-vai.onrender.com',
    'https://www.smartcareervai.com',
    'https://smartcareervai.com',
    'https://api.smartcareervai.com',
    'https://smartcareervai.onrender.com',
    'https://*.vercel.app',
    'https://*.onrender.com'
];
requiredOrigins.forEach(origin => {
    if (!allowedOrigins.includes(origin)) {
        allowedOrigins.push(origin);
    }
});

const allowedOriginPatterns = allowedOrigins.map(origin => {
    if (origin.includes('*')) {
        return new RegExp(`^${escapeRegExp(origin).replace(/\\\*/g, '.*')}$`);
    }
    return origin;
});

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        const isAllowed = allowedOriginPatterns.some(pattern =>
            typeof pattern === 'string'
                ? pattern === origin
                : pattern.test(origin)
        );
        if (isAllowed) {
            callback(null, true);
        } else {
            callback(new Error(`CORS origin not allowed: ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Request size limits
// Increase body size limits to allow uploaded CVs / larger payloads while still protecting other endpoints.
app.use(express.json({ 
    limit: '1mb',
    verify: (req, res, buf) => {
        try {
            req.rawBody = buf && buf.toString('utf8');
        } catch (e) {
            req.rawBody = undefined;
        }
    }
}));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Rate limiting - API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
});

// Stricter rate limiter for payment endpoints
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // max 10 payment requests per minute
    message: 'Too many payment requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
});

// Serve only public folder
app.use(express.static(path.join(process.cwd(), 'public'), { dotfiles: 'ignore' }));
app.use('/admin', express.static(path.join(process.cwd(), 'admin'), { dotfiles: 'ignore' }));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function getEnvString(name) {
    const value = process.env[name];
    return typeof value === 'string' ? value.trim() : '';
}

function isPayPalConfigured() {
    const clientId = getEnvString('PAYPAL_CLIENT_ID');
    const clientSecret = getEnvString('PAYPAL_CLIENT_SECRET');
    return Boolean(clientId && clientSecret);
}

function isOpenAIConfigured() {
    return Boolean(getEnvString('OPENAI_API_KEY'));
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
        paypalClientId: getEnvString('PAYPAL_CLIENT_ID') || null,
        paypalConfigured: isPayPalConfigured(),
        paypalMode: getEnvString('PAYPAL_MODE') || 'sandbox',
        paypalReturnUrl: getEnvString('PAYPAL_RETURN_URL') || 'https://smartcareervai.onrender.com/success.html',
        paypalCancelUrl: getEnvString('PAYPAL_CANCEL_URL') || 'https://smartcareervai.onrender.com/cancel.html',
        paypalWebhookId: getEnvString('PAYPAL_WEBHOOK_ID') || null,
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
    cvType: Joi.string().valid('standard', 'international', 'cover_letter', 'premium').optional().allow(null),
    plan: Joi.string().valid('standard', 'international', 'cover_letter', 'premium').optional().allow(null),
    maxUses: Joi.number().integer().min(1).max(10).optional().default(1)
});

const mpesaPaymentSchema = Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    phone: Joi.string().pattern(/^254\d{9}$/).required().messages({
        'string.pattern.base': 'Phone must be 254XXXXXXXXX format'
    }),
    cvId: Joi.string().max(200).optional().allow(null),
    cvType: Joi.string().valid('standard', 'international', 'cover_letter', 'premium').optional().allow(null),
    plan: Joi.string().valid('standard', 'international', 'cover_letter', 'premium').optional().allow(null),
    maxUses: Joi.number().integer().min(1).max(10).optional().default(1)
});

const extractInfoSchema = Joi.object({
    rawText: Joi.string().max(50000).required()
});

const cvGenerationSchema = Joi.object().unknown(true);

function getCvTypeInstructions(cvType) {
    const type = (cvType || 'standard').toString().toLowerCase();
    if (type.includes('international')) {
        return 'Follow international CV standards with clear section headings, transferable skills, concise professional English, and ATS-friendly formatting. Use strong section separators (lines of dashes) between major sections. Avoid tables, emojis, graphics, and non-standard formatting.';
    }
    return 'Follow a polished professional CV structure with standard section headings, concise achievement-based bullet points, strong action verbs, and ATS-friendly formatting. Use strong section separators (lines of dashes) between major sections. Avoid tables, emojis, graphics, and non-standard formatting.';
}

const summaryGenerateSchema = Joi.object({
    careerGoal: Joi.string().max(200).required(),
    fullName: Joi.string().max(100).optional().allow('', null),
    skills: Joi.alternatives().try(Joi.string().max(1000), Joi.array().items(Joi.string().max(100)).max(50)).optional(),
    experience: Joi.alternatives().try(Joi.string().max(4000), Joi.array().items(Joi.string().max(1200)).max(50)).optional(),
    education: Joi.alternatives().try(Joi.string().max(4000), Joi.array().items(Joi.string().max(500)).max(50)).optional(),
    summary: Joi.string().max(2000).optional().allow('', null)
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
    const clientId = getEnvString('PAYPAL_CLIENT_ID');
    const clientSecret = getEnvString('PAYPAL_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
        throw new Error('PayPal credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your environment.');
    }

    return getEnvString('PAYPAL_MODE') === 'live'
        ? new paypal.core.LiveEnvironment(clientId, clientSecret)
        : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

function getPaypalClient() {
    return new paypal.core.PayPalHttpClient(paypalEnvironment());
}

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
    const clientId = getEnvString('PAYPAL_CLIENT_ID');
    const clientSecret = getEnvString('PAYPAL_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
        throw new Error('PayPal credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your environment.');
    }
    const base = getEnvString('PAYPAL_MODE') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
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
        console.error('PayPal token fetch error:', err.response?.data || err.message || err);
        const details = err.response?.data || { message: err.message };
        const e = new Error('Failed to get PayPal access token');
        e.details = details;
        throw e;
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
                { role: "system", content: "Extract professional resume details and ATS optimization recommendations from the supplied text. Return ONLY valid JSON with keys: fullName, careerGoal, summary, skills, experience, education, certifications, languages, achievements, atsScore, recommendations." },
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

// Job description analyzer - public trial endpoint (no auth required)
app.post('/analyze-job', apiLimiter, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }
    try {
        const jobText = (req.body && (req.body.jobText || req.body.text || req.body.jobDescription)) || '';
        if (!jobText || String(jobText).trim().length < 20) {
            return res.status(400).json({ success: false, message: 'Please provide a job advert or description (at least 20 characters).' });
        }

        const systemPrompt = `You are an expert career advisor and ATS specialist. Analyze the supplied job advert and produce ONLY valid JSON with the following keys: matchScore (number 0-100), strengths (array of short strings), weaknesses (array of short strings), chanceOfInterview (one of Low, Medium, High), suggestedImprovements (array of short actionable suggestions). Keep responses concise and focused.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: jobText }
            ],
            max_tokens: 800
        });

        const raw = completion.choices?.[0]?.message?.content || '';
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try { parsed = JSON.parse(jsonMatch[0]); } catch (e2) { parsed = null; }
            }
        }

        if (!parsed) {
            return res.json({ success: true, parsed: null, raw: raw, message: 'Model returned non-JSON output; see raw text.' });
        }

        const result = {
            matchScore: Number(parsed.matchScore ?? parsed.score ?? 0),
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths : (parsed.positives || []),
            weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : (parsed.negatives || []),
            chanceOfInterview: parsed.chanceOfInterview || parsed.chance || 'Medium',
            suggestedImprovements: Array.isArray(parsed.suggestedImprovements) ? parsed.suggestedImprovements : (parsed.suggestions || [])
        };

        res.json({ success: true, parsed: result });
    } catch (error) {
        console.error('Job analysis error:', error.message || error);
        res.status(500).json({ success: false, message: 'Job analysis failed' });
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

        const cvType = (value.cvType || value.plan || 'standard').toString().toLowerCase();
        const systemPrompt = cvType === 'international'
            ? `You are a Certified International Resume Writer and Career Coach with expertise in ATS optimization.
Create a world-class professional CV with CLEAR VISUAL SECTION SEPARATORS that meets hiring standards globally.

CRITICAL FORMATTING REQUIREMENTS:
- Use "=======================================" to separate major sections for visual clarity
- Structure must be immediately scannable
- Each section header should be on its own line followed by section separator line
- Use bullet points (-) for achievements under each role
- Include dates and locations for each position
- Quantify ALL achievements (numbers, %, $, time saved, growth metrics)
- Start each bullet with STRONG ACTION VERBS (Led, Increased, Achieved, Delivered, Developed, Managed, etc.)
- NO weak phrases (Responsible for, Duties included, Worked on, Assisted with)
- Professional, modern business English for international audience
- ATS-friendly: clean text, no symbols, no graphics, no tables

STRUCTURE (exactly as shown):
FULL NAME
Email | Phone | LinkedIn Profile URL | City, Country

PROFESSIONAL SUMMARY
[2-3 compelling lines about value proposition and career trajectory]

CORE COMPETENCIES
- Skill 1
- Skill 2
- Skill 3
[key industry keywords for ATS]

PROFESSIONAL EXPERIENCE

Company Name | Job Title | Location | Month Year - Month Year
- Achievement with quantified result (numbers/% if possible)
- Key responsibility with measurable impact
- Recognition or award if applicable

EDUCATION

University Name | Degree & Field | Graduation Year | Distinction (if applicable)

CERTIFICATIONS & LANGUAGES

Certification Name | Issuing Body | Year
Language: Proficiency Level

REFERENCES AVAILABLE UPON REQUEST

OUTPUT INSTRUCTIONS:
- Return ONLY the formatted CV text - nothing else
- NO markdown syntax, NO JSON, NO HTML tags, NO code fences, NO explanations
- Make it visually clear with section separators
- Ensure immediate readability for both ATS systems and recruiters
- Keep to 1-2 pages of content`
            : `You are an experienced Professional CV Writer specializing in job-winning resume creation.
Create a professional, well-structured CV with CLEAR VISUAL SECTION SEPARATORS that wins interviews.

CRITICAL FORMATTING REQUIREMENTS:
- Use "=======================================" to separate major sections for visual clarity
- Structure must be immediately scannable and easy to read
- Each section header should be on its own line followed by section separator line
- Use bullet points (-) for achievements under each role
- Include dates and locations for each position
- Quantify achievements where possible (numbers, %, $, time, growth metrics)
- Start each bullet with STRONG ACTION VERBS (Led, Increased, Achieved, Delivered, Developed, Managed, etc.)
- NO weak language (Responsible for, Duties included, Worked on, Assisted with)
- Professional, clear language suitable for your target industry
- ATS-friendly: clean text, no symbols, no graphics, no tables

STRUCTURE (exactly as shown):
FULL NAME
Email | Phone | LinkedIn Profile URL | City, Country

PROFESSIONAL SUMMARY
[2-3 compelling lines about your value and career goals]

CORE COMPETENCIES
- Skill 1
- Skill 2
- Skill 3
[key industry keywords for ATS]

PROFESSIONAL EXPERIENCE

Company Name | Job Title | Location | Month Year - Month Year
- Key achievement with quantified result (numbers/% if possible)
- Major responsibility with measurable impact
- Special recognition or award if applicable

EDUCATION

University/College Name | Degree & Field | Graduation Year | Distinction (if applicable)

PROFESSIONAL CERTIFICATIONS

Certification Name | Issuing Body | Year

REFERENCES AVAILABLE UPON REQUEST

OUTPUT INSTRUCTIONS:
- Return ONLY the formatted CV text - nothing else
- NO markdown syntax, NO JSON, NO HTML tags, NO code fences, NO explanations
- Make it visually clear with section separators
- Ensure immediate readability for both ATS systems and hiring managers
- Keep to 1-2 pages of content`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `Applicant details:\n${JSON.stringify(value, null, 2)}\n\nCreate a single polished CV using the structure above and tailor it for ${cvType === 'international' ? 'international' : 'standard'} job applications. Only return a plain text resume without markdown, JSON, HTML tags, or code fences.`
                }
            ],
            max_tokens: 2500
        });

        if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message || !completion.choices[0].message.content) {
            console.error('OpenAI returned unexpected response for /generate-cv:', JSON.stringify(completion));
            throw new Error('OpenAI returned no content');
        }

        // Log request diagnostic info to help debug client 500s (avoid printing user data)
        try {
            const rawLen = req.rawBody ? req.rawBody.length : undefined;
            console.log('generate-cv request', {
                userId: req.userId || null,
                bodyKeys: Object.keys(value || {}),
                rawBodyLength: rawLen
            });
        } catch (e) {
            // ignore logging errors
        }

        const fullCv = completion.choices[0].message.content || "";
        const cvId = `cv_${Date.now()}`;

        // Persist the generated CV server-side (so full content can be unlocked after payment)
        try {
            await payments.createCV({ cv_id: cvId, user_id: req.userId, content: fullCv });
            console.log('Persisted CV metadata', { cvId, userId: req.userId, contentLength: fullCv.length });
        } catch (e) {
            console.error('Failed to persist CV:', e && e.message ? e.message : e);
        }

        // Check whether the user has a completed payment
        const userPayments = await payments.listPayments({ limit: 1, user_id: req.userId });
        const hasPaid = userPayments && userPayments.length > 0 && (userPayments[0].status === 'COMPLETED' || userPayments[0].status === 'PAID');

        if (hasPaid) {
            return res.json({ success: true, cv: fullCv, hasPaid: true, cvId });
        }

        // Return a short preview while keeping the structure readable.
        const truncated = `${truncateToFirstWords(fullCv, 100)}\n\n[... Preview truncated. Unlock full CV with payment ...]`;
        const previewCharacters = truncated.length;
        
        return res.json({ 
            success: true, 
            cv: truncated, 
            hasPaid: false, 
            cvId, 
            totalCharacters: fullCv.length,
            previewCharacters,
            message: 'Your CV has been generated! Unlock the full version with payment to download.'
        });

    } catch (error) {
        // Log full error with stack and any response payload for easier debugging (avoid leaking secrets)
        console.error("CV Generation Error:", error.stack || error.message, error.response?.data || error);
        // Return a clearer message to the frontend while keeping details out of the response body
        res.status(500).json({ success: false, message: "CV generation failed" });
    }
});

app.post('/generate-summary', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { error, value } = summaryGenerateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const details = [];
        if (value.careerGoal) details.push(`Target role: ${value.careerGoal}`);
        if (value.skills) details.push(`Skills: ${Array.isArray(value.skills) ? value.skills.join(', ') : value.skills}`);
        if (value.experience) details.push(`Experience: ${Array.isArray(value.experience) ? value.experience.join('; ') : value.experience}`);
        if (value.education) details.push(`Education: ${Array.isArray(value.education) ? value.education.join('; ') : value.education}`);

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Generate a concise professional CV summary for the provided profile information. Return only the summary text." },
                { role: "user", content: `Profile details:\n${details.join('\n')}` }
            ],
            max_tokens: 300
        });

        res.json({ success: true, summary: completion.choices[0].message.content.trim() });
    } catch (error) {
        console.error("Summary Generation Error:", error.message);
        res.status(500).json({ success: false, message: "Summary generation failed" });
    }
});

app.post('/analyze-cv-health', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { cv } = req.body;
        if (!cv) {
            return res.status(400).json({ success: false, message: 'CV content required' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Analyze the provided CV and score different sections out of 100. Return a JSON object with keys: overall, summary, skills, experience, education, ats_compatibility, and an array of improvements." },
                { role: "user", content: `Analyze this CV:\n${cv}` }
            ],
            max_tokens: 800
        });

        let healthData = null;
        try {
            healthData = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            healthData = {
                overall: 75,
                summary: 70,
                skills: 80,
                experience: 75,
                education: 85,
                ats_compatibility: 72,
                improvements: ["Add quantifiable achievements", "Include action verbs", "Improve keyword density"]
            };
        }

        res.json({ success: true, health: healthData });
    } catch (error) {
        console.error("CV Health Analysis Error:", error.message);
        res.status(500).json({ success: false, message: "CV analysis failed" });
    }
});

app.post('/find-missing-skills', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { cv, jobRole } = req.body;
        if (!cv || !jobRole) {
            return res.status(400).json({ success: false, message: 'CV content and job role required' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Compare the provided CV with a target job role. Return a JSON object with keys: user_skills (array of skills found in CV), required_skills (array of skills needed for the role), missing_skills (skills needed but not in CV), learning_path (recommended courses/certifications)." },
                { role: "user", content: `CV:\n${cv}\n\nTarget Job: ${jobRole}` }
            ],
            max_tokens: 800
        });

        let skillsData = null;
        try {
            skillsData = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            skillsData = {
                user_skills: ["Communication", "Leadership"],
                required_skills: ["Technical Skills", "Project Management", "Analytics"],
                missing_skills: ["Project Management", "Analytics"],
                learning_path: ["Enroll in Project Management certification", "Take Analytics course"]
            };
        }

        res.json({ success: true, skills: skillsData });
    } catch (error) {
        console.error("Missing Skills Analysis Error:", error.message);
        res.status(500).json({ success: false, message: "Skills analysis failed" });
    }
});

app.post('/estimate-salary', apiLimiter, async (req, res) => {
    try {
        const { country, industry, experience } = req.body;
        if (!country || !industry || !experience) {
            return res.status(400).json({ success: false, message: 'Country, industry, and experience level required' });
        }

        const salaryRanges = {
            'Kenya': {
                'Technology': { 'Entry Level': [40000, 80000], 'Mid Level': [80000, 150000], 'Senior': [150000, 300000], 'Executive': [300000, 600000] },
                'Finance': { 'Entry Level': [35000, 70000], 'Mid Level': [70000, 140000], 'Senior': [140000, 280000], 'Executive': [280000, 500000] },
                'Healthcare': { 'Entry Level': [30000, 60000], 'Mid Level': [60000, 120000], 'Senior': [120000, 250000], 'Executive': [250000, 450000] }
            },
            'Uganda': {
                'Technology': { 'Entry Level': [25000, 50000], 'Mid Level': [50000, 100000], 'Senior': [100000, 200000], 'Executive': [200000, 400000] },
                'Finance': { 'Entry Level': [20000, 40000], 'Mid Level': [40000, 80000], 'Senior': [80000, 160000], 'Executive': [160000, 300000] }
            },
            'Nigeria': {
                'Technology': { 'Entry Level': [1000000, 2000000], 'Mid Level': [2000000, 4000000], 'Senior': [4000000, 8000000], 'Executive': [8000000, 15000000] },
                'Finance': { 'Entry Level': [800000, 1500000], 'Mid Level': [1500000, 3000000], 'Senior': [3000000, 6000000], 'Executive': [6000000, 12000000] }
            },
            'USA': {
                'Technology': { 'Entry Level': [60000, 100000], 'Mid Level': [100000, 180000], 'Senior': [180000, 300000], 'Executive': [300000, 600000] },
                'Finance': { 'Entry Level': [50000, 90000], 'Mid Level': [90000, 160000], 'Senior': [160000, 280000], 'Executive': [280000, 500000] }
            }
        };

        const ranges = salaryRanges[country]?.[industry] || salaryRanges['Kenya']['Technology'];
        const selectedRange = ranges[experience] || ranges['Mid Level'];

        res.json({
            success: true,
            salary: {
                country,
                industry,
                experience,
                min: selectedRange[0],
                max: selectedRange[1],
                currency: country === 'USA' ? 'USD' : (country === 'Nigeria' ? 'NGN' : 'KES'),
                note: `Estimated salary range for ${experience} ${industry} role in ${country}`
            }
        });
    } catch (error) {
        console.error("Salary Estimation Error:", error.message);
        res.status(500).json({ success: false, message: "Salary estimation failed" });
    }
});

app.post('/recruiter-view', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { cv, jobRole } = req.body;
        if (!cv) {
            return res.status(400).json({ success: false, message: 'CV content required' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `You are a busy recruiter reviewing a CV. You have 6 seconds to scan it and decide if you'd interview this candidate${jobRole ? ` for a ${jobRole} role` : ''}. Provide a quick assessment with: would_interview (YES/NO), key_strengths (array, max 3), weaknesses (array, max 2), and brief reason.` },
                { role: "user", content: `CV to review:\n${cv}` }
            ],
            max_tokens: 500
        });

        let recruiterData = null;
        try {
            recruiterData = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            recruiterData = {
                would_interview: "YES",
                key_strengths: ["Relevant experience", "Clear skills"],
                weaknesses: ["Missing certifications"],
                reason: "Candidate shows promise but needs minor improvements"
            };
        }

        res.json({ success: true, view: recruiterData });
    } catch (error) {
        console.error("Recruiter View Error:", error.message);
        res.status(500).json({ success: false, message: "Recruiter view generation failed" });
    }
});

app.post('/resume-roast', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { cv } = req.body;
        if (!cv) {
            return res.status(400).json({ success: false, message: 'CV content required' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a witty CV reviewer who provides humorous but constructive feedback. Identify weak language, clichés, and common mistakes in the provided CV. For each issue, provide both the criticism and a better suggestion. Format as JSON with keys: issues (array of {bad: string, good: string, feedback: string}), overall_vibe (string), and shareability_score (0-100)." },
                { role: "user", content: `Review this CV for weak language and clichés:\n${cv}` }
            ],
            max_tokens: 800
        });

        let roastData = null;
        try {
            roastData = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            roastData = {
                issues: [
                    { bad: "Hardworking individual seeking opportunities", good: "Results-driven professional with proven track record", feedback: "This is too generic. Add specific achievements instead." },
                    { bad: "Team player who thinks outside the box", good: "Led cross-functional initiatives resulting in X% improvement", feedback: "Show, don't tell. Use concrete examples." }
                ],
                overall_vibe: "Good structure but could use more specific achievements",
                shareability_score: 65
            };
        }

        res.json({ success: true, roast: roastData });
    } catch (error) {
        console.error("Resume Roast Error:", error.message);
        res.status(500).json({ success: false, message: "Resume roast generation failed" });
    }
});

app.post('/career-match', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { cv, jobTitles } = req.body;
        if (!cv || !jobTitles || !Array.isArray(jobTitles) || jobTitles.length === 0) {
            return res.status(400).json({ success: false, message: 'CV and job titles required' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert career matching algorithm. For each job title provided, analyze how well the provided CV matches that role. Return a JSON object with keys being the job titles and values being objects with: match_score (0-100), match_reason (string explaining why), and top_matching_skills (array of skills that match)." },
                { role: "user", content: `CV:\n${cv}\n\nJob titles to match: ${jobTitles.join(', ')}` }
            ],
            max_tokens: 1000
        });

        let matchData = null;
        try {
            matchData = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            const defaultMatches = {};
            jobTitles.forEach(job => {
                defaultMatches[job] = {
                    match_score: 70,
                    match_reason: "Good potential match based on skills and experience",
                    top_matching_skills: ["Communication", "Leadership", "Problem Solving"]
                };
            });
            matchData = defaultMatches;
        }

        res.json({ success: true, matches: matchData });
    } catch (error) {
        console.error("Career Match Error:", error.message);
        res.status(500).json({ success: false, message: "Career matching failed" });
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

app.post('/generate-linkedin-summary', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { fullName, jobTarget, skills, summary } = req.body;
        if (!fullName || !jobTarget || !skills) {
            return res.status(400).json({ success: false, message: 'Missing required fields for LinkedIn summary generation' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: 'system', content: 'You are an expert LinkedIn profile writer. Generate a professional LinkedIn headline and summary based on the candidate profile. Return only the summary text.' },
                { role: 'user', content: `Name: ${fullName}\nTarget role: ${jobTarget}\nSkills: ${skills}\nProfessional summary: ${summary || 'No summary provided'}` }
            ],
            max_tokens: 700
        });

        res.json({ success: true, linkedInSummary: completion.choices[0].message.content.trim() });
    } catch (error) {
        console.error('LinkedIn Summary Generation Error:', error.message);
        res.status(500).json({ success: false, message: 'LinkedIn summary generation failed' });
    }
});

app.post('/generate-career-roadmap', apiLimiter, verifyFirebaseToken, async (req, res) => {
    if (!isOpenAIConfigured()) {
        return res.status(503).json({ success: false, message: 'OpenAI API key is not configured' });
    }

    try {
        const { careerGoal, skills, experience } = req.body;
        if (!careerGoal || !skills) {
            return res.status(400).json({ success: false, message: 'Missing required fields for career roadmap generation' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: 'system', content: 'You are a career coach. Create a practical 3-month career roadmap with goal steps, skills development, networking, and interview readiness for the target role.' },
                { role: 'user', content: `Target role: ${careerGoal}\nSkills: ${skills}\nExperience details: ${experience || 'No details provided'}` }
            ],
            max_tokens: 800
        });

        res.json({ success: true, roadmap: completion.choices[0].message.content.trim() });
    } catch (error) {
        console.error('Career Roadmap Generation Error:', error.message);
        res.status(500).json({ success: false, message: 'Career roadmap generation failed' });
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

        // Validate amount is within reasonable bounds (min 10 KES, max 500,000 KES)
        if (value.amount < 10 || value.amount > 500000) {
            return res.status(400).json({ success: false, message: 'Amount must be between KES 10 and KES 500,000' });
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
            if (e && e.message && e.message.toLowerCase().includes('m-pesa not configured')) {
                console.warn('M-Pesa configuration missing, rejecting request');
                return res.status(503).json({ success: false, message: 'M-Pesa payments are not configured on this server' });
            }
            console.error('M-Pesa Access Token Error:', e.message);
            return res.status(502).json({ success: false, message: 'M-Pesa authentication failed. Please try again later.' });
        }

        // Ensure merchant configuration present
        if (!process.env.MPESA_SHORTCODE || !process.env.MPESA_PASSKEY || !process.env.MPESA_CALLBACK_URL) {
            console.warn('M-Pesa merchant config missing');
            return res.status(503).json({ success: false, message: 'M-Pesa merchant configuration incomplete on server' });
        }

        const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        const password = Buffer.from(process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp).toString("base64");

        const baseUrl = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        
        let response;
        try {
            response = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
                BusinessShortCode: process.env.MPESA_SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: Math.round(value.amount),
                PartyA: value.phone,
                PartyB: process.env.MPESA_SHORTCODE,
                PhoneNumber: value.phone,
                CallBackURL: process.env.MPESA_CALLBACK_URL,
                AccountReference: "SmartCVAI",
                TransactionDesc: "CV Payment"
            }, {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 10000
            });
        } catch (axiosErr) {
            console.error('M-Pesa STK Push API Error:', axiosErr.message);
            const statusCode = axiosErr.response?.status || 502;
            const errorMsg = axiosErr.response?.data?.errorMessage || 'M-Pesa service error';
            return res.status(statusCode).json({ success: false, message: `M-Pesa Error: ${errorMsg}` });
        }

        // Validate response
        if (!response.data) {
            console.error('Invalid M-Pesa response:', response);
            return res.status(502).json({ success: false, message: 'Invalid response from M-Pesa' });
        }

        // Check for success indicators
        const payload = response.data;
        const isSuccess = payload.CheckoutRequestID || payload.MerchantRequestID;
        
        if (!isSuccess) {
            console.error('M-Pesa returned error response:', payload);
            return res.status(400).json({ success: false, message: payload.errorMessage || 'M-Pesa request failed' });
        }

        // Persist pending mpesa payment with user ID if available
        try {
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
                plan: value.plan || value.cvType || null,
                cv_type: value.cvType || value.plan || null,
                max_uses: value.maxUses || 1
            });
        } catch (e) {
            console.error('Failed to persist mpesa payment:', e.message);
            // Continue - payment was initiated successfully
        }
        
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error("M-Pesa Error:", error.message);
        res.status(500).json({ success: false, message: "M-Pesa payment initiation failed. Please try again." });
    }
});

/* =========================
   PAYPAL ROUTES
========================= */
app.post("/api/paypal/create-order", paymentLimiter, async (req, res) => {
    if (!isPayPalConfigured()) {
        return res.status(503).json({ success: false, error: 'PayPal credentials are not configured' });
    }
    try {
        const { error, value } = paymentAmountSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, error: error.details[0].message });
        }

        // Validate amount is within reasonable bounds (min $1, max $10,000)
        if (value.amount < 1 || value.amount > 10000) {
            return res.status(400).json({ success: false, error: 'Amount must be between $1 and $10,000' });
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
                user_action: "PAY_NOW",
                return_url: getEnvString('PAYPAL_RETURN_URL') || "https://smartcareervai.onrender.com/success.html",
                cancel_url: getEnvString('PAYPAL_CANCEL_URL') || "https://smartcareervai.onrender.com/cancel.html"
            }
        });

        const order = await getPaypalClient().execute(request);
        
        // Validate response
        if (!order || !order.result || !order.result.id) {
            console.error('Invalid PayPal response:', order);
            return res.status(502).json({ success: false, error: 'Invalid response from PayPal' });
        }
        
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
                    plan: value.plan || value.cvType || null,
                    cv_type: value.cvType || value.plan || null,
                    max_uses: value.maxUses || 1
                });
            } catch (e) {
                console.error('Failed to create payment record:', e.message);
                // Continue anyway - payment tracking is secondary
            }
        }
        
        res.json({ success: true, id: order.result.id });
    } catch (error) {
        // Log detailed PayPal error for debugging (avoid logging secrets)
        console.error("PayPal Create Order Error:", error.response?.data || error.message || error);
        const details = error.response?.data || { message: error.message };
        res.status(502).json({ success: false, error: 'PayPal order creation failed. Check server logs for details.', details });
    }
});

app.post("/api/paypal/capture-order", paymentLimiter, async (req, res) => {
    if (!isPayPalConfigured()) {
        return res.status(503).json({ success: false, error: 'PayPal credentials are not configured' });
    }
    try {
        const orderId = req.body.orderID;
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'Missing orderID in request body' });
        }

        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        
        let capture;
        try {
            capture = await getPaypalClient().execute(request);
        } catch (paypalErr) {
            console.error('PayPal capture API error:', paypalErr.response?.data || paypalErr.message || paypalErr);
            const details = paypalErr.response?.data || { message: paypalErr.message };
            return res.status(502).json({ success: false, error: 'PayPal capture API error. Order may have already been captured.', details });
        }

        // Validate capture response
        if (!capture || !capture.result) {
            console.error('Invalid PayPal capture response:', capture);
            return res.status(502).json({ success: false, error: 'Invalid response from PayPal' });
        }

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
        }

        res.json({ success: true, data: capture.result, token: tokenInfo });
    } catch (error) {
        console.error("PayPal Capture Error:", error.message);
        res.status(502).json({ success: false, error: 'PayPal capture failed. Please contact support if the issue persists.' });
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
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime_seconds: process.uptime(),
        services: {
            firebase: firebaseInitialized,
            openai: isOpenAIConfigured(),
            paypal: isPayPalConfigured(),
            mpesa: isMpesaConfigured()
        }
    });
});

app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime_seconds: process.uptime()
    });
});

function analyzeCvHealthText(rawText) {
    const text = String(rawText || '').trim();
    const metrics = {
        overall: 0,
        completeness: 0,
        formatting: 0,
        keywords: 0
    };
    const feedback = [];

    const hasName = /^[A-Z][a-z]+ [A-Z][a-z]+/m.test(text);
    const hasEmail = /@/.test(text);
    const hasPhone = /\d{7,}/.test(text);
    const hasExperience = /experience|worked|employed|role|position/i.test(text);
    const hasEducation = /education|degree|university|college|school|certificate/i.test(text);
    const hasSkills = /skills|technical|proficient|expertise/i.test(text);

    const completeness = [hasName, hasEmail, hasPhone, hasExperience, hasEducation, hasSkills].filter(Boolean).length / 6 * 100;
    metrics.completeness = Math.round(completeness);

    if (completeness < 50) feedback.push({ type: 'critical', text: '❌ Missing key sections: name, email, phone, experience, education or skills.' });
    else if (completeness < 80) feedback.push({ type: 'warning', text: '⚠️ Some important sections are missing. Complete your profile for a stronger CV.' });
    else feedback.push({ type: 'good', text: '✓ All major sections are present.' });

    const lines = text.split('\n').length;
    const avgLineLength = text.length / Math.max(lines, 1);
    const formatting = (lines > 5 && avgLineLength < 100) ? 80 : (lines > 3 ? 60 : 40);
    metrics.formatting = Math.min(100, formatting);

    if (formatting < 50) feedback.push({ type: 'warning', text: '⚠️ Formatting needs improvement. Add line breaks and section headings.' });
    else feedback.push({ type: 'good', text: '✓ Formatting is on the right track.' });

    const keywords = (text.match(/[a-z]+/gi) || []).length;
    const uniqueKeywords = new Set(text.toLowerCase().match(/[a-z]+/gi) || []).size;
    const keywordScore = (uniqueKeywords / 100) * 100;
    metrics.keywords = Math.min(100, Math.round(keywordScore));

    if (metrics.keywords < 30) feedback.push({ type: 'critical', text: '❌ Not enough unique keywords. Add industry-specific terms and achievements.' });
    else if (metrics.keywords < 60) feedback.push({ type: 'warning', text: '⚠️ Add more varied keywords to improve ATS detection.' });
    else feedback.push({ type: 'good', text: '✓ Strong keyword variety detected.' });

    metrics.overall = Math.round((metrics.completeness + metrics.formatting + metrics.keywords) / 3);

    return { metrics, feedback };
}

function analyzeAtsScore(text) {
    const source = String(text || '').trim();
    let score = 100;
    const issues = [];
    const recommendations = [];

    if (source.length < 200) {
        score -= 20;
        issues.push('CV seems too short (less than 200 words).');
    }
    if (!/\d{4}/.test(source)) {
        issues.push('⚠️ No years or dates detected. Dates help provide context.');
    }
    if (!/@/.test(source)) {
        issues.push('⚠️ No email address found. Add contact details.');
    }
    if (!/\+\d|\(\d{3}\)\s?|\d{3}[\-\s]\d{3}|07\d{8}/.test(source)) {
        issues.push('⚠️ No clear phone number found.');
    }

    const keywordCount = (source.match(/[A-Z][a-z]+/g) || []).length;
    if (keywordCount < 20) {
        score -= 15;
        issues.push('⚠️ Limited keyword variety. Use more role-related terms.');
    }

    if (source.includes('Experience') || source.includes('Skills')) {
        recommendations.push('✓ Clear section headers detected.');
    }
    if (!/[\t\|]/.test(source.slice(0, 100))) {
        recommendations.push('✓ Simple formatting detected.');
    }
    if (recommendations.length === 0) {
        recommendations.push('📌 Add specific job keywords and structure with headings.');
    }

    return {
        score: Math.max(0, score),
        issues: issues.length > 0 ? issues : ['✓ No major ATS issues detected.'],
        recommendations
    };
}

app.post('/free/cv-health', apiLimiter, async (req, res) => {
    try {
        const { cvText, rawText, text } = req.body || {};
        const payload = String(cvText || rawText || text || '').trim();
        if (!payload) {
            return res.status(400).json({ success: false, message: 'Please provide CV text for analysis.' });
        }
        const result = analyzeCvHealthText(payload);
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Free CV health endpoint error:', error.message || error);
        res.status(500).json({ success: false, message: 'Failed to analyze CV health.' });
    }
});

app.post('/free/ats-score', apiLimiter, async (req, res) => {
    try {
        const { cvText, text } = req.body || {};
        const payload = String(cvText || text || '').trim();
        if (!payload) {
            return res.status(400).json({ success: false, message: 'Please paste your CV text first.' });
        }
        const result = analyzeAtsScore(payload);
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Free ATS endpoint error:', error.message || error);
        res.status(500).json({ success: false, message: 'Failed to score CV for ATS.' });
    }
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
