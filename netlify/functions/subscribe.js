// POST /.netlify/functions/subscribe — the only network call the scanner page
// is capable of making.
//
// The scanner runs under `connect-src 'self'`, so the browser blocks its
// JavaScript from reaching any third-party origin and this same-origin path is
// the only destination the policy leaves standing. The policy permits it; what
// keeps scan context out of it is code, not the header. What arrives here is one
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
// WHAT IT WRITES DOWN. One structured line per request: the event, which
// provider was used, which category the request fell into, and the hour. No
// address, no request body, no IP, no user agent, no referrer, no API key. The
// address is personal data whose only necessary home is the email provider, and
// a function log is not a place it needs a second copy. docs/data-handling.md
// carries the retention and access checklist that surrounds this.
//
// Dependency-free on purpose: global fetch, global crypto, nothing installed.

const crypto = require('node:crypto');

// Rate limiting, crudely, and DEFENCE IN DEPTH RATHER THAN A CONTROL.
//
// This counter lives in one warm function instance's memory. It is not shared,
// so it is not global: a cold start hands the caller a clean slate, two
// instances running at once give them two budgets, and scaling out multiplies
// that by however many instances the platform decides to run. Nothing here can
// see any of that, and nothing here should be described as though it could.
//
// What it is actually for is the honest short list: a stuck retry loop, a bored
// script, a widget bug that fires on every keystroke. The shared limit that
// would bound a determined caller has to be applied in front of this function
// by the platform - docs/subscribe-abuse-controls.md has the configuration and
// says plainly which parts of it are not in this repository. The provider's own
// duplicate handling is the last line, and it is the one that actually holds.
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
 * Rate-limit key: a per-instance pseudonym for the caller, never an address.
 *
 * TRUSTED: `x-nf-client-connection-ip`, and nothing else. Netlify's edge sets it
 * on the way in, so it describes the connection this request actually arrived
 * on rather than the caller's opinion of it.
 *
 * NOT TRUSTED, AND NO LONGER READ: `x-forwarded-for`. It is a caller-supplied
 * list, and nothing in this process can tell an entry the platform appended from
 * one the client wrote. Taking its leftmost entry - which this did whenever the
 * Netlify header was absent - handed every request a fresh bucket for the price
 * of one header, which is the limiter below defeated in its entirety by anyone
 * who thought to try. A header is trusted here only if the platform is
 * documented to set it; "usually contains the right thing" is not that.
 *
 * THE ASSUMPTION, and the thing to re-check if this ever leaves Netlify:
 * requests reach this function through an edge that sets that header. Where it
 * is absent every caller shares the one `unknown` bucket, so the failure mode is
 * a single shared limit rather than no limit at all - closed, not open.
 *
 * The IP is hashed with a salt made at instance start and never written down.
 * Telling callers apart for an hour does not require knowing who they are, and a
 * salt that dies with the instance cannot outlive the counter it exists for.
 */
const salt = crypto.randomBytes(16);
function clientKey(headers) {
  const ip = headers['x-nf-client-connection-ip'] || 'unknown';
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

// ---------------------------------------------------------------------------
// Logging.
//
// Everything written here is aggregate by construction. The rule is not "redact
// the address before logging it" — it is that the address is never handed to a
// logging call in the first place, so there is no redaction step to get wrong.
// ---------------------------------------------------------------------------

const LOG_HMAC_ENV = 'SUBSCRIBE_LOG_HMAC_KEY';

/** The provider name for logs. Configuration, never personal data. */
function providerName() {
  return (process.env.ESP_PROVIDER || '').toLowerCase() || 'unset';
}

/** The hour a request arrived, which is as precise as any log line here gets. */
function hourOf(now) {
  return new Date(now).toISOString().slice(0, 13);
}

/**
 * A stable pseudonym for one address, or null when none is configured.
 *
 * OFF BY DEFAULT, AND THAT IS THE RIGHT DEFAULT. Aggregate counts answer every
 * question this endpoint normally raises — how many subscribed, how many failed,
 * how many were rate-limited. Set SUBSCRIBE_LOG_HMAC_KEY only when you actually
 * need to tell "one address retrying forty times" from "forty addresses", and
 * unset it again when you are done.
 *
 * WHY HMAC AND NOT A HASH. Email addresses are enumerable: anyone with a list of
 * candidates and sha256 can invert a bare digest by trying them. A keyed HMAC
 * cannot be inverted without the key, which is why the key is a dedicated secret
 * rather than the API key, is never logged, and never leaves this process.
 *
 * ROTATION. The identifier is stable only for the life of the key. Rotate it and
 * the same address produces a different pseudonym, so correlation does not span
 * the rotation — which is a feature when the key leaks, and a nuisance when you
 * are mid-investigation. Rotating is therefore also the way to sever every
 * pseudonym already written to a log you cannot edit.
 *
 * Lowercased first, because a provider treats Reader@ and reader@ as one
 * subscriber and a pseudonym that disagreed would be useless for the one job it
 * has.
 */
function pseudonym(email) {
  const key = process.env[LOG_HMAC_ENV];
  if (!key) return null;
  return crypto
    .createHmac('sha256', key)
    .update(email.toLowerCase())
    .digest('base64url')
    .slice(0, 16);
}

/**
 * The single structured line per request.
 *
 * Callers pass categories, never content. If a future field is not obviously
 * safe to print beside a hostname in a shared log viewer, it does not belong
 * here — see the "never logged" list in docs/data-handling.md.
 */
function logEvent(fields) {
  console.log(JSON.stringify({ event: 'subscribe', ...fields }));
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
 * The hosts a browser may post here from.
 *
 * TRUSTED: `host`. It is the name the platform routed this request on, so it is
 * a name this deploy answers to; a request carrying somebody else's hostname is
 * served by somebody else's site, or by nothing.
 *
 * NOT TRUSTED, AND NO LONGER READ: `x-forwarded-host`. It is caller-supplied,
 * nothing upstream is documented to overwrite it, and it used to take precedence
 * over `host` here - so `Origin: https://evil.example` sent with
 * `X-Forwarded-Host: evil.example` agreed with itself and walked through the
 * same-origin check unchallenged.
 *
 * The deploy's own addresses are added from Netlify's read-only environment
 * variables, which are configuration and not request data: `URL` is the
 * production address, `DEPLOY_PRIME_URL` the branch or preview one. That keeps
 * deploy previews working without widening anything in production, and it means
 * the allowlist does not depend on `host` alone.
 */
function allowedHosts(headers) {
  const hosts = new Set();
  if (headers.host) hosts.add(headers.host);
  for (const name of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    const configured = process.env[name];
    if (!configured) continue;
    try {
      hosts.add(new URL(configured).host);
    } catch {
      // A malformed deploy URL is our configuration problem, not the caller's,
      // and it must not be allowed to widen anything. Skipped in silence.
    }
  }
  return hosts;
}

/**
 * Whether to refuse this request on origin grounds. No CORS headers are ever
 * sent either, which is the other half of the same rule.
 *
 * A MISSING ORIGIN IS NOW REFUSED, and that is a decision rather than an
 * oversight. The only intended caller is a fetch from a page this site served,
 * and a browser attaches Origin to every POST it makes - same-origin included,
 * and regardless of `credentials: 'omit'`, which is how the widget calls this.
 * So requiring the header costs a real subscriber nothing, and it removes the
 * cheapest shape of abuse there is: the curl loop and the scripted client that
 * send no headers they were not made to send.
 *
 * What it does not do is stop anyone who has read this file. `Origin:
 * https://clindar.eu` is one more flag on the command line. This raises the
 * floor; it is not a boundary, and nothing downstream may treat it as one.
 *
 * It also settles what this endpoint is: browser-only, on purpose. There is no
 * non-browser client today - the widget is the only caller - and if one is ever
 * wanted it gets a route and a credential of its own rather than this one
 * loosening to admit it. Reverting the decision is deleting the two lines
 * marked below, and it should be a deliberate act with a reason attached.
 */
function disallowedOrigin(headers) {
  const origin = headers.origin;
  // The two lines: no Origin, no service.
  if (!origin) return true;

  let host;
  try {
    host = new URL(origin).host;
  } catch {
    // Unparseable, and also the literal `null` origin a sandboxed frame or an
    // opaque redirect sends. Neither is this site.
    return true;
  }
  if (!host) return true;
  return !allowedHosts(headers).has(host);
}

async function forwardToEsp(email) {
  const provider = providerName();
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

  if (provider === 'unset' || !apiKey) {
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
    // Read to classify a duplicate, and for nothing else. A provider that
    // echoes the submitted address back in an error body is common; putting
    // that body in `reason` would put the address in a log by the back door,
    // so `reason` gets the status code and never the text.
    const text = (await response.text()).toLowerCase();
    if (response.status === 409) return { ok: true, subscribed: true };
    if (response.status === 400 && text.includes('already')) return { ok: true, subscribed: true };
    if (response.status === 422 && text.includes('already')) return { ok: true, subscribed: true };

    return { ok: false, reason: `${provider} responded ${response.status}` };
  } catch (error) {
    // An AbortError here is the ESP_TIMEOUT_MS deadline. The provider may or may
    // not have recorded the address, so the caller is told it failed and can try
    // again; a duplicate on the retry is absorbed above.
    //
    // `error.name`, not `error.message`: a message can quote the request URL or
    // whatever the provider sent back. The name is a fixed vocabulary.
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
  if (disallowedOrigin(headers)) {
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

  const now = Date.now();
  const at = hourOf(now);
  const client = clientKey(headers);

  // Honeypot: a field no human sees and no real widget fills. Cheaper than a
  // captcha and it costs the visitor nothing. The response is exactly what a
  // real subscription returns — same status, same body — so a bot learns
  // nothing from having been caught, and nothing is forwarded anywhere.
  //
  // The hit is counted against the caller's budget on the way past, because a
  // filled honeypot is abuse by definition and should cost what any other
  // request costs. The answer never changes because of it: a honeypot that
  // started returning 429 would be telling a bot that something is counting,
  // which is the one thing this response exists not to say.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    rateLimited(client, now);
    logEvent({ outcome: 'honeypot', at });
    return json(200, { ok: true, subscribed: true });
  }

  // Counted before the address is judged, not after. The other order let a
  // caller hold the limiter at zero for as long as they liked by never sending
  // a valid address: every malformed submission returned 400 without ever
  // reaching the counter, so the budget was only ever spent by people using the
  // endpoint properly.
  if (rateLimited(client, now)) {
    logEvent({ outcome: 'rate_limited', at });
    return json(429, { ok: false, error: 'too_many_requests' });
  }

  const email = normaliseEmail(payload.email);
  if (!email) {
    // The address that failed is not written down. It was rejected precisely
    // because we could not tell what it was; keeping a copy to look at later
    // would be collecting the one thing we just declined to accept.
    logEvent({ outcome: 'invalid_email', at });
    return json(400, { ok: false, error: 'invalid_email' });
  }

  const provider = providerName();
  // null unless SUBSCRIBE_LOG_HMAC_KEY is set, and omitted from the line
  // entirely when it is null rather than logged as an empty field.
  const sid = pseudonym(email);
  const identified = sid ? { sid } : {};

  const result = await forwardToEsp(email);
  if (!result.ok) {
    // The reason names our own misconfiguration or the provider's status code,
    // never the caller and never a response body. It goes to the function log;
    // the caller gets a bare failure.
    console.error(`subscribe: ${result.reason}`);
    logEvent({ provider, outcome: 'failed', at, ...identified });
    // Not 'delivery_failed': nothing here ever delivered anything. What
    // failed is the subscription.
    return json(502, { ok: false, error: 'subscribe_failed' });
  }

  // `subscribed` is the only claim this endpoint is entitled to make: true
  // means a provider accepted the address, false means nothing left this
  // process. Neither value says an email arrived, and nothing downstream may
  // read it as though it did.
  if (result.subscribed === false) {
    console.warn('subscribe: ESP_PROVIDER=log — address discarded, nothing sent');
    logEvent({ provider, outcome: 'not_sent', at });
    return json(200, { ok: true, subscribed: false, mode: result.mode });
  }

  logEvent({ provider, outcome: 'subscribed', at, ...identified });
  return json(200, { ok: true, subscribed: true });
};
