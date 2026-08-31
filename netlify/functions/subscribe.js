// POST /.netlify/functions/subscribe — the only network call the scanner page
// is capable of making.
//
// The scanner runs under `connect-src 'self'`, so this same-origin path is the
// entire list of origins its JavaScript can reach. What arrives here is one
// email address and nothing else: no Define-XML, no study identifiers, no scan
// result. The widget in widget/scanner-capture.js deliberately never puts them in
// the body, and this handler would ignore them if it did.
//
// WHAT THIS IS, AND WHAT IT IS NOT. This is a mailing-list signup. It hands an
// address to an email service provider and stops. It does not compose, render,
// attach or send an email, and it could not personalise one if it wanted to —
// it has never seen the scan. The scanner's report is a local download and
// stays one; docs/email-capture.md is the whole product decision.
//
// So `ok: true` here means a provider accepted the address, and nothing more.
// It is not evidence that any message was delivered, and the copy on the widget
// and on /impact/privacy/ is written never to imply that it is.
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

  // Dev and preview: exercise the round trip without an ESP account attached.
  // It contacts nobody, so it must not be able to look as though it did — it
  // reports `subscribed: false`, and the widget renders that as a warning
  // rather than a confirmation. A deploy that reaches a real visitor in this
  // mode is a misconfiguration, and it now says so on screen.
  if (provider === 'log') {
    return { ok: true, subscribed: false, mode: 'development' };
  }

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
    // Whether a confirmation goes out, and whether an automation then sends the
    // checklist, are MailerLite settings — this request neither triggers nor
    // guarantees either one. docs/email-capture.md names the exact settings.
    body = JSON.stringify(groupId ? { email, groups: [groupId] } : { email });
  } else if (provider === 'buttondown') {
    url = 'https://api.buttondown.com/v1/subscribers';
    headers = {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    };
    // The same shape of promise as above: this adds a subscriber. Whether a
    // confirmation or a welcome email follows is Buttondown's configuration.
    body = JSON.stringify({ email_address: email, type: 'regular' });
  } else {
    return { ok: false, reason: `unknown ESP_PROVIDER: ${provider}` };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ESP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: abort.signal });
    if (response.ok) return { ok: true, subscribed: true };

    // An address already on the list is a success from the caller's side, and
    // saying otherwise would tell a stranger who is already subscribed. What
    // the caller receives is identical either way, which is the point: this
    // endpoint cannot be used to test whether an address is on the list. 409 is
    // the status Buttondown uses for it; MailerLite upserts and never gets here.
    const text = (await response.text()).toLowerCase();
    if (response.status === 409) return { ok: true, subscribed: true };
    if (response.status === 400 && text.includes('already')) return { ok: true, subscribed: true };
    if (response.status === 422 && text.includes('already')) return { ok: true, subscribed: true };

    return { ok: false, reason: `${provider} responded ${response.status}` };
  } catch (error) {
    // An AbortError here is the ESP_TIMEOUT_MS deadline. The provider may or may
    // not have recorded the address, so the caller is told it failed and can try
    // again; a duplicate on the retry is absorbed above.
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
  // captcha and it costs the visitor nothing. The response is exactly what a
  // real subscription returns — same status, same body — so a bot learns
  // nothing from having been caught, and nothing is forwarded anywhere.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return json(200, { ok: true, subscribed: true });
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
    // Not 'delivery_failed': nothing here ever delivered anything. What
    // failed is the subscription.
    return json(502, { ok: false, error: 'subscribe_failed' });
  }

  // The whole record: the address, and the hour it arrived. No IP, no user
  // agent, no referrer, no scan context — the privacy page promises exactly
  // this and it has to stay true.
  console.log(
    JSON.stringify({ event: 'subscribe', email, at: new Date(now).toISOString().slice(0, 13) }),
  );

  // `subscribed` is the only claim this endpoint is entitled to make: true
  // means a provider accepted the address, false means nothing left this
  // process. Neither value says an email arrived, and nothing downstream may
  // read it as though it did.
  if (result.subscribed === false) {
    console.warn('subscribe: ESP_PROVIDER=log — address discarded, nothing sent');
    return json(200, { ok: true, subscribed: false, mode: result.mode });
  }

  return json(200, { ok: true, subscribed: true });
};
