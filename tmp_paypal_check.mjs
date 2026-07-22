import http from 'node:http';

const payload = JSON.stringify({ amount: 2.99, cvId: 'test-paypal', cvType: 'standard', plan: 'standard' });

const req = http.request({ host: '127.0.0.1', port: 3000, path: '/api/paypal/create-order', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`STATUS ${res.statusCode}`);
    console.log(data);
  });
});

req.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
req.write(payload);
req.end();
