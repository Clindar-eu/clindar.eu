// POST /.netlify/functions/subscribe — the only network call the scanner page
// is capable of making.
//
// The scanner runs under `connect-src 'self'`, so this same-origin path is the
// entire list of origins its JavaScript can reach. What arrives here is one
// email address and nothing else: no Define-XML, no study identifiers, no scan
// result. The widget in widget/scanner-capture.js deliberately never puts them in
// the body, and this handler would ignore them if it did.
//
// Dependency-free on purpose: global fetch, global crypto, nothing installed.

const crypto = require('node:crypto');

// Rate limiting, crudely. This is per warm function instance, not global — an
// attacker with patience gets around it. It exists to stop a stuck retry loop
// or a bored script, and the ESP is the real duplicate defence.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_TRACKED_CLIENTS = 5000;
const hits = new Map();

// RFC 5321 caps the whole address at 254 and the local part at 64. The pattern
// is deliberately conservative rather than exhaustive: the ESP and the
// confirmation email are what actually prove an address works.
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_BODY_BYTES = 2048;
const EMAIL_RE =
  /^[^\s@,;:<>"()[\]\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const ESP_TIMEOUT_MS = 8000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Rate-limit key. The IP is hashed with a per-instance salt and never leaves
 * memory: we need to tell callers apart for an hour, not to know who they are.
 */
const salt = crypto.randomBytes(16);
function clientKey(headers) {
  const ip =
    headers['x-nf-client-connection-ip'] ||
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';
  return crypto.createHash('sha256').update(salt).update(ip).digest('base64').slice(0, 16);
}

function rateLimited(key, now) {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);

  // Bound memory on a long-lived instance: drop whoever is furthest from the
  // window. Losing a counter costs an attacker one extra request, not access.
  if (hits.size > MAX_TRACKED_CLIENTS) {
    for (const [k, times] of hits) {
      if (now - times[times.length - 1] >= WINDOW_MS) hits.delete(k);
      if (hits.size <= MAX_TRACKED_CLIENTS) break;
    }
  }
  return false;
}

function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  if (email.split('@')[0].length > MAX_LOCAL_LENGTH) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Same-origin only. The page that posts here is served from this domain, so a
 * cross-origin Origin header is either a mistake or someone else's form.
 * No CORS headers are sent either, which is the other half of the same rule.
 */
function foreignOrigin(headers) {
  const origin = headers.origin;
  if (!origin) return false;
  const host = headers['x-forwarded-host'] || headers.host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function forwardToEsp(email) {
  const provider = (process.env.ESP_PROVIDER || '').toLowerCase();
  const apiKey = process.env.ESP_API_KEY;
  const groupId = process.env.ESP_GROUP_ID;

  // Dev and preview: prove the round trip without an ESP account attached.
  if (provider === 'log') return { ok: true };

  if (!provider || !apiKey) {
    return { ok: false, reason: 'ESP_PROVIDER or ESP_API_KEY is not set' };
  }

  let url;
  let headers;
  let body;

  if (provider === 'mailerlite') {
    url = 'https://connect.mailerlite.com/api/subscribers';
    headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // Upsert: an address already on the list comes back 200, not an error.
    // Whether a confirmation email goes out is MailerLite's double opt-in
    // setting, which is where that decision belongs.
    body = JSON.stringify(groupId ? { email, groups: [groupId] } : { email });
  } else if (provider === 'buttondown') {
    url = 'https://api.buttondown.com/v1/subscribers';
    headers = {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    };
    body = JSON.stringify({ email_address: email, type: 'regular' });
  } else {
    return { ok: false, reason: `unknown ESP_PROVIDER: ${provider}` };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ESP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: abort.signal });
    if (response.ok) return { ok: true };

    // An address already on the list is a success from the caller's side, and
    // saying otherwise would tell a stranger who is already subscribed.
    const text = (await response.text()).toLowerCase();
    if (response.status === 400 && text.includes('already')) return { ok: true };
    if (response.status === 422 && text.includes('already')) return { ok: true };

    return { ok: false, reason: `${provider} responded ${response.status}` };
  } catch (error) {
    return { ok: false, reason: `${provider} request failed: ${error.name}` };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }
  if (foreignOrigin(headers)) {
    return json(403, { ok: false, error: 'forbidden' });
  }
  if (!(headers['content-type'] || '').includes('application/json')) {
    return json(415, { ok: false, error: 'unsupported_media_type' });
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'payload_too_large' });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  if (payload === null || typeof payload !== 'object') {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  // Honeypot: a field no human sees and no real widget fills. Cheaper than a
  // captcha and it costs the visitor nothing.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return json(200, { ok: true });
  }

  const email = normaliseEmail(payload.email);
  if (!email) {
    return json(400, { ok: false, error: 'invalid_email' });
  }

  const now = Date.now();
  if (rateLimited(clientKey(headers), now)) {
    return json(429, { ok: false, error: 'too_many_requests' });
  }

  const result = await forwardToEsp(email);
  if (!result.ok) {
    // The reason names our own misconfiguration or the ESP's status, never the
    // caller. It goes to the function log; the caller gets a bare failure.
    console.error(`subscribe: ${result.reason}`);
    return json(502, { ok: false, error: 'delivery_failed' });
  }

  // The whole record: the address, and the hour it arrived. No IP, no user
  // agent, no referrer, no scan context — the privacy page promises exactly
  // this and it has to stay true.
  console.log(
    JSON.stringify({ event: 'subscribe', email, at: new Date(now).toISOString().slice(0, 13) }),
  );

  return json(200, { ok: true });
};
