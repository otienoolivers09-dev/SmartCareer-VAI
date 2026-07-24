function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

function isLocalHost(hostname, protocol) {
  const normalizedHost = (hostname || '').toLowerCase();
  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '0.0.0.0' || protocol === 'file:';
}

function getDefaultApiCandidates({ hostname = '', protocol = 'http:', origin = '' } = {}) {
  const candidates = [];
  const addCandidate = (candidate) => {
    const normalized = normalizeBaseUrl(candidate);
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  if (origin) {
    addCandidate(origin);
  }

  if (isLocalHost(hostname, protocol)) {
    addCandidate('http://localhost:3000');
    addCandidate('http://localhost:3001');
    addCandidate('http://localhost:3002');
    addCandidate('http://127.0.0.1:3000');
    addCandidate('http://127.0.0.1:3001');
    addCandidate('http://127.0.0.1:3002');
  }

  const normalizedHost = (hostname || '').toLowerCase();
  if (normalizedHost === 'api.smartcareervai.com') {
    addCandidate('https://api.smartcareervai.com');
  }

  if (normalizedHost.endsWith('.vercel.app')) {
    addCandidate('https://api.smartcareervai.com');
  }

  if (normalizedHost.endsWith('.onrender.com')) {
    addCandidate(`https://${normalizedHost}`);
    addCandidate('https://smartcareer-vai.onrender.com');
    addCandidate('https://smartcareervai.onrender.com');
  }

  addCandidate('https://api.smartcareervai.com');
  addCandidate('https://smart-career-vai.vercel.app');
  addCandidate('https://smartcareer-vai.onrender.com');
  addCandidate('https://smartcareervai.onrender.com');
  addCandidate('https://www.smartcareervai.com');
  addCandidate('https://smartcareervai.com');

  return candidates;
}

export function resolveApiBaseUrl(options = {}) {
  const { override } = options;
  if (override) {
    return normalizeBaseUrl(override);
  }

  const hostname = options.hostname || '';
  const protocol = options.protocol || 'http:';
  const origin = options.origin || '';
  const isLocal = isLocalHost(hostname, protocol);

  if (isLocal) {
    return 'http://localhost:3000';
  }

  const normalizedHost = (hostname || '').toLowerCase();
  if (normalizedHost === 'smart-career-vai.vercel.app' || normalizedHost.endsWith('.vercel.app')) {
    return 'https://api.smartcareervai.com';
  }

  if (normalizedHost === 'smartcareer-vai.onrender.com' || normalizedHost === 'smartcareervai.onrender.com' || normalizedHost.endsWith('.onrender.com')) {
    return 'https://api.smartcareervai.com';
  }

  if (normalizedHost === 'www.smartcareervai.com' || normalizedHost === 'smartcareervai.com') {
    return 'https://api.smartcareervai.com';
  }

  if (normalizedHost === 'api.smartcareervai.com') {
    return 'https://api.smartcareervai.com';
  }

  return 'https://api.smartcareervai.com';
}

export { normalizeBaseUrl, getDefaultApiCandidates };
