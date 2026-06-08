# Smart Career VAI - Deployment & Configuration Guide

## Summary of Changes

All systems have been configured and optimized for production deployment on Render.com with Vercel frontend. Below is a comprehensive guide for deployment and setup.

---

## 1. Backend Configuration (Render.com)

### Environment Variables (.env)
Set these variables in your Render project:

```
NODE_ENV=production
PORT=3000

# Frontend CORS Origins
ALLOWED_ORIGINS=https://smart-career-d3c6ayaqi-olivers-otieno-s-projects.vercel.app,https://smartcareervai.onrender.com,http://localhost:5500,http://127.0.0.1:5500

# Firebase Admin SDK
FIREBASE_CONFIG_JSON=<base64-encoded-service-account-json>
FIREBASE_PROJECT_ID=your-project-id

# OpenAI
OPENAI_API_KEY=sk-...

# PayPal (Sandbox or Live)
PAYPAL_CLIENT_ID=your-client-id
PAYPAL_CLIENT_SECRET=your-secret
PAYPAL_MODE=sandbox
PAYPAL_WEBHOOK_ID=your-webhook-id
PAYPAL_RETURN_URL=https://smartcareervai.onrender.com/success.html
PAYPAL_CANCEL_URL=https://smartcareervai.onrender.com/cancel.html

# M-Pesa (Safaricom)
MPESA_CONSUMER_KEY=your-key
MPESA_CONSUMER_SECRET=your-secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your-passkey
MPESA_CALLBACK_URL=https://smartcareervai.onrender.com/webhook/mpesa
MPESA_ENV=sandbox

# Security
API_ADMIN_TOKEN=generate-a-random-secure-token
```

### Port Configuration
- The server automatically uses port 3000 from `process.env.PORT`
- It will increment to the next available port (up to 3005) if the port is in use
- Render.com will assign the PORT environment variable automatically

---

## 2. Frontend Configuration (Vercel)

The frontend is pre-configured to use the backend URL:
- **Backend URL**: `https://smartcareervai.onrender.com`
- **CORS Headers**: Automatically included in all API calls

No additional configuration needed on the frontend for the backend URL.

---

## 3. Firebase Setup

### Firestore Security Rules
1. Go to Firebase Console: https://console.firebase.google.com
2. Select your project
3. Navigate to **Firestore Database > Rules**
4. Replace the rules with content from `firestore-security-rules.txt`
5. Click **Publish** to deploy

**Important**: These rules enforce:
- ✅ Authenticated users can read/write their own data
- ✅ Admins can read all payment and access logs
- ❌ Unauthenticated users cannot access data
- ❌ Users cannot access others' data

### Setting Admin Claims (Optional)
To grant admin access, set custom claims in Firebase:

```javascript
// Using Firebase Admin SDK
admin.auth().setCustomUserClaims(uid, { admin: true });
```

---

## 4. PayPal Integration

### Endpoint: `POST /api/paypal/create-order`
**Request:**
```json
{
  "amount": 10.50,
  "cvId": "cv_123456",
  "maxUses": 1
}
```

**Response (Success):**
```json
{
  "success": true,
  "id": "PAYPAL_ORDER_ID"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message"
}
```

### Endpoint: `POST /api/paypal/capture-order`
**Request:**
```json
{
  "orderID": "PAYPAL_ORDER_ID"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": { /* PayPal capture details */ },
  "token": { /* Access token */ }
}
```

### Key Improvements:
- ✅ Validates amount bounds ($1 - $10,000)
- ✅ Validates response structure before returning
- ✅ Proper error messages for all failure scenarios
- ✅ Creates payment records in Firestore
- ✅ Generates access tokens for CV unlocking

---

## 5. M-Pesa Integration

### Endpoint: `POST /pay-premium`
**Request:**
```json
{
  "amount": 500,
  "phone": "254712345678",
  "cvId": "cv_123456",
  "maxUses": 1
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": { /* M-Pesa response */ }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Error message"
}
```

### Key Improvements:
- ✅ Validates phone number format
- ✅ Validates amount bounds (KES 10 - 500,000)
- ✅ Better error handling for Safaricom API
- ✅ Creates payment records in Firestore
- ✅ Handles STK Push responses properly

---

## 6. Frontend Improvements

### Error Handling
1. **PayPal SDK Loading**
   - Validates SDK is properly loaded before rendering buttons
   - Shows user-friendly error if SDK fails
   - Displays fallback message for M-Pesa

2. **Payment Status Messages**
   - Real-time status updates during payment
   - Clear error messages instead of alerts
   - Validation before payment initiation

3. **History Management**
   - Handles corrupted local storage gracefully
   - Provides error recovery options
   - HTML escaping to prevent XSS

4. **M-Pesa Payments**
   - Validates phone number format
   - Shows detailed error messages
   - Confirms payment request was sent

### Updated Files:
- `public/script.js` - Enhanced error handling and validation
- `public/api.js` - Better PayPal SDK loading with timeouts

---

## 7. Deployment Checklist

### Before Deploying to Render:

- [ ] Firebase Admin SDK initialized with credentials
- [ ] Firestore security rules deployed
- [ ] PayPal API credentials configured
- [ ] M-Pesa API credentials configured (optional)
- [ ] OpenAI API key configured
- [ ] Allowed origins updated in CORS settings
- [ ] Admin token generated for security
- [ ] Service account JSON converted to base64 (if using FIREBASE_CONFIG_JSON)

### Render Deployment:
1. Push code to GitHub
2. Connect Render to your GitHub repository
3. Set all environment variables in Render dashboard
4. Deploy the application
5. Test PayPal/M-Pesa endpoints

### Vercel Frontend:
1. Ensure backend URL is set to `https://smartcareervai.onrender.com`
2. Verify CORS headers are being sent
3. Test payment flows end-to-end

---

## 8. Testing Endpoints

### Test PayPal Create Order:
```bash
curl -X POST https://smartcareervai.onrender.com/api/paypal/create-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"amount": 5.00, "cvId": "test_123"}'
```

### Test M-Pesa Payment:
```bash
curl -X POST https://smartcareervai.onrender.com/pay-premium \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"amount": 500, "phone": "254712345678"}'
```

### Test Health Check:
```bash
curl https://smartcareervai.onrender.com/health
```

---

## 9. Monitoring & Logs

### Check Server Logs:
- View in Render Dashboard under "Logs"
- Look for startup messages confirming configuration loaded

### Common Issues:

**Issue**: CORS errors in browser console
- **Solution**: Verify `ALLOWED_ORIGINS` includes your frontend URL

**Issue**: PayPal SDK not loading
- **Solution**: Check PayPal client ID is valid and PAYPAL_MODE is set correctly

**Issue**: M-Pesa errors
- **Solution**: Verify Safaricom credentials and callback URL are accessible

**Issue**: Firebase not initialized
- **Solution**: Ensure FIREBASE_CONFIG_JSON or FIREBASE_SERVICE_ACCOUNT_PATH is set

---

## 10. Production Best Practices

1. **Keep credentials secure**
   - Never commit .env files
   - Use Render's environment variables
   - Rotate API keys periodically

2. **Monitor payment transactions**
   - Check PayPal webhooks are receiving events
   - Monitor M-Pesa callback endpoint
   - Review payment records in Firestore

3. **Rate limiting**
   - Payment endpoints: max 10 requests/minute per IP
   - API endpoints: max 100 requests/15 minutes per IP

4. **HTTPS enforced**
   - Server redirects HTTP to HTTPS in production
   - All external APIs use HTTPS
   - Webhooks must be HTTPS

---

## 11. Support & Troubleshooting

If you encounter issues:

1. Check the Render logs for error messages
2. Verify all environment variables are set
3. Test connectivity to PayPal and M-Pesa APIs
4. Ensure Firebase project is active and has data
5. Verify CORS origins match exactly

---

**Configuration Complete! Your Smart Career VAI application is ready for production.**
