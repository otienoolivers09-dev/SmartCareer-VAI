# 🚀 Pre-Deployment Checklist

Complete this checklist before deploying to Render.com and Vercel.

## ✅ Firebase Setup

- [ ] Firebase project created at console.firebase.google.com
- [ ] Firestore Database enabled
- [ ] Authentication enabled (Email/Password)
- [ ] Service account JSON generated
- [ ] Service account JSON converted to base64 (for FIREBASE_CONFIG_JSON)
- [ ] Firestore security rules deployed (from firestore-security-rules.txt)
- [ ] Test user created for testing

## ✅ PayPal Setup

- [ ] PayPal Business account created
- [ ] PayPal app created in developer dashboard
- [ ] Client ID obtained
- [ ] Secret obtained
- [ ] Mode selected (sandbox for testing, live for production)
- [ ] Webhook ID created
- [ ] Webhook registered at Render URL: `https://smartcareervai.onrender.com/webhook/paypal`
- [ ] Return URL configured: `https://smartcareervai.onrender.com/success.html`
- [ ] Cancel URL configured: `https://smartcareervai.onrender.com/cancel.html`

## ✅ M-Pesa Setup (Optional)

- [ ] Safaricom Daraja API account created
- [ ] Consumer Key obtained
- [ ] Consumer Secret obtained
- [ ] Business short code obtained
- [ ] M-Pesa passkey obtained
- [ ] Callback URL registered: `https://smartcareervai.onrender.com/webhook/mpesa`
- [ ] Environment set to sandbox or production
- [ ] Tested in sandbox environment

## ✅ OpenAI Setup

- [ ] OpenAI API key obtained from platform.openai.com
- [ ] API key has sufficient credits
- [ ] API key has access to GPT-4 mini model

## ✅ Vercel Frontend Setup

- [ ] GitHub repository connected
- [ ] Environment variable verified (not needed, backend URL is hardcoded)
- [ ] Domain configured (if custom domain)
- [ ] Frontend deployed successfully
- [ ] Homepage loads without errors

## ✅ Render Backend Setup

- [ ] GitHub repository connected to Render
- [ ] Environment variables configured:
  - [ ] NODE_ENV=production
  - [ ] PORT (auto-assigned by Render)
  - [ ] ALLOWED_ORIGINS (with Vercel frontend URL)
  - [ ] FIREBASE_CONFIG_JSON
  - [ ] FIREBASE_PROJECT_ID
  - [ ] OPENAI_API_KEY
  - [ ] PAYPAL_CLIENT_ID
  - [ ] PAYPAL_CLIENT_SECRET
  - [ ] PAYPAL_MODE
  - [ ] PAYPAL_WEBHOOK_ID
  - [ ] MPESA_CONSUMER_KEY (if using M-Pesa)
  - [ ] MPESA_CONSUMER_SECRET (if using M-Pesa)
  - [ ] MPESA_SHORTCODE (if using M-Pesa)
  - [ ] MPESA_PASSKEY (if using M-Pesa)
  - [ ] MPESA_CALLBACK_URL (if using M-Pesa)
  - [ ] MPESA_ENV (if using M-Pesa)
  - [ ] API_ADMIN_TOKEN (generate random token)

## ✅ Testing Endpoints

### Test Backend Health
```bash
curl https://smartcareervai.onrender.com/health
```
Expected response: `{"status":"ok","environment":"production"}`

### Test Config Endpoint
```bash
curl https://smartcareervai.onrender.com/config
```
Expected response: JSON with paypalClientId, mpesaConfigured, etc.

### Test PayPal Create Order (with Firebase token)
```bash
curl -X POST https://smartcareervai.onrender.com/api/paypal/create-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"amount": 5.00}'
```
Expected response: `{"success":true,"id":"PAYPAL_ORDER_ID"}`

### Test M-Pesa Payment (with Firebase token)
```bash
curl -X POST https://smartcareervai.onrender.com/pay-premium \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"amount": 500, "phone": "254712345678"}'
```
Expected response: `{"success":true,"data":{...}}`

## ✅ Frontend Testing

- [ ] Login/Register works with Firebase
- [ ] CV generation works
- [ ] PayPal button appears and is clickable
- [ ] M-Pesa payment form appears
- [ ] History saves correctly
- [ ] Error messages display correctly
- [ ] Payment status messages show during transactions

## ✅ Production Safety

- [ ] HTTPS is enforced
- [ ] All API endpoints use proper authentication
- [ ] Rate limiting is active
- [ ] CORS origins are restricted
- [ ] Sensitive data is not logged
- [ ] Admin endpoints are protected
- [ ] Firestore rules are restrictive
- [ ] No hardcoded secrets in code

## ✅ Monitoring Setup

- [ ] Render logs being monitored
- [ ] Firebase Analytics enabled (optional)
- [ ] PayPal transaction monitoring setup
- [ ] M-Pesa transaction monitoring setup
- [ ] Error notifications configured

## ✅ Documentation

- [ ] Team has access to DEPLOYMENT_GUIDE.md
- [ ] Team has access to IMPLEMENTATION_SUMMARY.md
- [ ] Environment variables documented (securely)
- [ ] Backup of service account JSON stored safely
- [ ] Backup of API keys stored safely

---

## Quick Troubleshooting

### Issue: CORS Error
**Solution**: Check ALLOWED_ORIGINS in Render environment variables

### Issue: PayPal SDK Not Loading
**Solution**: Verify PAYPAL_CLIENT_ID is correct and valid

### Issue: Firebase Errors
**Solution**: Check FIREBASE_CONFIG_JSON encoding and validity

### Issue: M-Pesa Not Working
**Solution**: Verify all M-Pesa credentials are correct and endpoint is accessible

### Issue: 404 on Endpoints
**Solution**: Ensure Render app has restarted after environment changes

---

## Post-Deployment

1. Monitor logs for first 24 hours
2. Perform end-to-end payment test
3. Verify webhook handling works
4. Check Firestore records for first transaction
5. Monitor performance and error rates

---

**When all items are checked, you're ready to go live! 🎉**
