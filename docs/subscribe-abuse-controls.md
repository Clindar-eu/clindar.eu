# Abuse resistance on the subscribe endpoint: what the code does, what Netlify has to do, and what still gets through

`/.netlify/functions/subscribe` is the only endpoint this site exposes and the
only network call the scanner page can make. It takes one email address and
hands it to an email provider. This document is the abuse story around it: the
threat model, the parts implemented in this repository, the parts that have to
be configured in Netlify and cannot be tested here, and the bypasses that remain
after both.

Companion documents: `docs/email-capture.md` for the product decision,
`docs/data-handling.md` for what happens to the address itself,
`/impact/privacy/` for what a reader is told.

**Nothing here uses a CAPTCHA, a fingerprint, a cookie, a third-party script or
any telemetry on the scanner page.** That is a constraint, not an oversight: the
scanner's whole claim is that the page talks to nobody, and a bot-detection
script would be the first thing to make that claim false. If abuse ever forces
the question, the evidence for it goes in this document first.

---

## Threat model

Who would attack a mailing-list signup, and for what.

| # | Threat | What the attacker gets | What it costs us |
| --- | --- | --- | --- |
| 1 | **List poisoning** — bulk submission of addresses the submitter does not own | a poisoned list, and our sending domain in spam folders | reputation, and the provider's deliverability |
| 2 | **Mail bombing a third party** — submitting one victim's address repeatedly so the provider mails them | a victim buried in confirmation mail, sent by us | reputation, and a complaint that names us |
| 3 | **Provider quota burn** — enough accepted addresses to exhaust the plan | a bill, or a suspended list | money, and an outage of the signup |
| 4 | **Function invocation burn** — traffic that never reaches the provider but does run the function | a bill | money |
| 5 | **Account enumeration** — using the response to learn whether an address is already subscribed | a membership oracle | a privacy failure, and a reportable one |
| 6 | **Scan-context exfiltration** — persuading the endpoint to accept or log something from the scan | the thing the whole product promises never leaves the tab | the product |

Threats 5 and 6 are closed in code and stay closed: the response is identical
for a new address and one already on the list, and the handler reads exactly two
fields from the body and forwards exactly one. Both are covered by tests that
predate this document.

Threats 1 to 4 are volume problems. Volume is the thing this repository cannot
solve on its own, and the rest of this document is about where the line falls.

---

## What is implemented in this repository

All of it is in `netlify/functions/subscribe.js` and asserted in
`tests/subscribe.test.js`.

### The request has to look like the request the widget makes

- **POST only.** Anything else is 405.
- **Origin required, and same-origin.** See the decision below.
- **JSON only.** No content type, or any other content type, is 415. There is no
  form-encoded path, so there is no cross-origin HTML form that can reach this.
- **No CORS headers, ever.** A browser will not hand a cross-origin response to
  the caller's script even if the request itself is made.
- **2048 bytes.** Measured after base64 decoding, so the encoded form is not a
  way around it.
- **Conservative address validation**, capped at RFC 5321's 254 and 64.

### The Origin decision, on the record

**A request with no `Origin` header is refused.**

The only intended caller is a `fetch` from a page this site served, and a
browser attaches `Origin` to every POST it makes — same-origin included, and
regardless of `credentials: 'omit'`, which is how `widget/scanner-capture.js`
calls it. Requiring the header therefore costs a real subscriber nothing, and it
removes the cheapest shape of abuse there is: the curl loop and the scripted
client that send no headers they were not made to send.

It does not stop anyone who has read the source. `Origin: https://clindar.eu` is
one more flag on the command line. This raises the floor; it is not a boundary,
and nothing downstream treats it as one.

The consequence is that **this endpoint is browser-only by design**. There is no
non-browser client today. If one is ever wanted it gets a route and a credential
of its own rather than this one loosening to admit it. Reverting the decision is
two lines in `disallowedOrigin`, and it should be a deliberate act with a reason
attached; a test pins it so it cannot drift back by accident.

### The trust boundary on forwarding headers

The rule: **a header decides something here only if the platform is documented
to set it.** "Usually contains the right thing" is not that.

| Header | Trusted? | Why |
| --- | --- | --- |
| `x-nf-client-connection-ip` | **yes** | Netlify's edge sets it on the way in. It describes the connection, not the caller's opinion of the connection. It is the only input to the rate-limit key. |
| `x-forwarded-for` | **no, and no longer read** | A caller-supplied list. Nothing in the function can tell an entry the platform appended from one the client wrote. The old code read its leftmost entry whenever the Netlify header was absent, which handed every request a fresh rate-limit bucket for the price of one header. |
| `host` | **yes** | The name the platform routed the request on, so it is a name this deploy answers to. A request carrying someone else's hostname is served by someone else's site, or by nothing. |
| `x-forwarded-host` | **no, and no longer read** | Caller-supplied, and nothing upstream is documented to overwrite it. It used to take precedence over `host`, so `Origin: https://evil.example` sent with `X-Forwarded-Host: evil.example` agreed with itself and passed the same-origin check. |
| `origin` | **as evidence, not as identity** | Caller-supplied and trivially set by a non-browser. It is checked because a browser sends it honestly and most abuse is not a browser, not because it cannot be forged. |

**The assumption behind the first row**, and the thing to re-check if this ever
leaves Netlify: requests reach the function through an edge that sets
`x-nf-client-connection-ip`. Where it is absent, every caller falls into one
shared `unknown` bucket — a single shared limit rather than no limit. The
failure is closed, not open, which is the direction it has to fail in.

The allowed hosts are `host` plus whatever `URL`, `DEPLOY_PRIME_URL` and
`DEPLOY_URL` name. Those are Netlify's read-only deploy variables: configuration
rather than request data, which is the whole reason they are allowed to widen
the list when a request header is not.

### The in-memory rate limiter, and what it is not

Five submissions per caller per hour, counted in one warm function instance's
memory, keyed by a salted hash of the connection IP that never leaves the
process.

**It is not shared, so it is not global.** A cold start hands the caller a clean
slate. Two instances running at once give them two budgets. Scaling out
multiplies that by however many instances Netlify decides to run, and nothing in
the function can see any of it. Treat it as what it is: a brake on a stuck retry
loop, a bored script, or a widget bug that fires on every keystroke.

Two things about it did change, and both are worth keeping:

- **A honeypot hit is counted, and the honeypot still answers 200.** A filled
  honeypot is abuse by definition and should cost what any other request costs.
  The answer never changes because of it — a honeypot that started returning 429
  would be telling a bot that something upstream is counting, which is the one
  thing that response exists not to say.
- **The counter runs before the address is validated.** In the other order a
  caller could hold the limiter at zero indefinitely by never sending a valid
  address: every malformed submission returned 400 without reaching the counter,
  so the budget was only ever spent by people using the endpoint properly.

---

## What has to be configured in Netlify

**None of this is in this repository, and no test here can check any of it.**
The shared limit that would bound a determined caller has to be applied in front
of the function by the platform.

Netlify's rate limiting is the platform-native control, and it is the right one
here: it runs at the edge, before the function is invoked, so it also answers
threat 4; it is configured by rule rather than by code; and **it stores no IP
address in this application** — the aggregation happens in Netlify's
infrastructure, not in ours.

### The rule to apply

| Setting | Value | Note |
| --- | --- | --- |
| `windowSize` | `60` | seconds; the documented maximum is 180 |
| `windowLimit` | `5` | matches the in-memory limiter, so the two agree |
| `aggregateBy` | `["ip", "domain"]` | per visitor. `["domain"]` alone pools every visitor into one bucket and is Enterprise with High-Performance Edge only |
| `action` | `rate_limit` (default) | returns 429, which is what the widget already handles |

Plan limits on code-based rules, at the time of writing: 2 per project on
Free/Starter, 5 on Pro, 100 on Enterprise with High-Performance Edge. One rule
is enough here.

### Route A — the function's own config (recommended, and not yet possible here)

Netlify reads a `rateLimit` block from a function's exported `config`, and
applies it to the function rather than to a path, which is what makes it cover
every route into the function including the default one:

```js
export const config = {
  path: '/.netlify/functions/subscribe',
  rateLimit: { windowSize: 60, windowLimit: 5, aggregateBy: ['ip', 'domain'] },
};
```

**The blocker:** the `config` export is documented for the v2 function syntax
(`export default async (req, context) => Response`). `subscribe.js` is a v1
Lambda-compatible handler (`exports.handler = async (event) => ({ statusCode })`).
Adopting this means rewriting the handler's entire input and output layer and
every test that builds an `event` object — a change to the request-handling code
of a live endpoint, made to enable a control, with no way to verify the result
short of a deploy. It is the right next step and it is deliberately not bundled
into a hardening pass. Do it on its own, behind a deploy preview.

### Route B — a redirect rule in `netlify.toml`

Rate limits are supported on redirects in `netlify.toml`, so an aliased path can
carry one:

```toml
[[redirects]]
  from = "/api/subscribe"
  to = "/.netlify/functions/subscribe"
  status = 200

  [redirects.rate_limit]
    window_limit = 5
    window_size = 60
    aggregate_by = ["ip", "domain"]
```

**Why this is not in `netlify.toml` today.** It limits the alias and nothing
else. `/.netlify/functions/subscribe` stays open, and it is the path the widget
uses and the path `/impact/privacy/` publishes to readers. Pointing the widget
at the alias would put every legitimate visitor behind the limit and leave every
attacker in front of it — strictly worse than no rule. Netlify's redirect engine
is documented to leave `/.netlify/functions/*` alone (which is why a catch-all
SPA rewrite does not break functions), so a rule cannot be aimed at the real
path either. **Verify that in a deploy preview before relying on either half of
this paragraph**; if a rule can be aimed at the function path, this becomes the
cheapest fix available and Route A can wait.

### Verification, in a deploy preview and never in production

1. Open the preview and subscribe once through the widget. Expect the normal
   confirmation, and one `outcome: subscribed` line in the function log.
2. From a shell, post six times in under a minute to the **published** path:

   ```
   for i in $(seq 1 6); do
     curl -s -o /dev/null -w '%{http_code}\n' \
       -X POST https://<preview-host>/.netlify/functions/subscribe \
       -H 'content-type: application/json' \
       -H 'origin: https://<preview-host>' \
       -d '{"email":"nobody+'"$i"'@example.invalid"}'
   done
   ```

   Use `example.invalid` — it cannot receive mail, and this must never be run
   with an address a real person owns. Expect `200 200 200 200 200 429`.
3. Repeat without the `origin` header. Expect `403` on the first request.
4. Repeat with `-H 'origin: https://evil.example'`. Expect `403`.
5. Repeat with `-H 'x-forwarded-for: 192.0.2.1'` varying per request. Expect the
   429 to arrive on the sixth request regardless.
6. Confirm the function log shows `outcome: rate_limited` and **no address, no
   IP, no user agent** on any line.
7. If a platform rule is in place, confirm the 429 arrives without a matching
   function log line — that is how you know the request was stopped at the edge
   rather than by the in-memory counter.

Also confirm, once, that the ESP account is set to **double opt-in**. It is the
single most effective control against threats 1 and 2 and it lives entirely in
the provider's settings: an address that never confirms never joins the list,
and a mail-bombed victim receives one confirmation rather than a stream.
`docs/email-capture.md` names the exact settings.

---

## Remaining bypasses

Named rather than left for a reader to discover.

1. **The in-memory limiter resets on a cold start and is per-instance.** A
   caller who paces themselves, or who simply arrives at a moment when Netlify
   has spun up a second instance, gets a fresh budget. Nothing in this
   repository can fix this; it is what the platform rule above is for.
2. **`/.netlify/functions/subscribe` is reachable directly** and is published in
   `/impact/privacy/`. Any control attached to an aliased path does not cover
   it. Until Route A lands, a platform rule aimed at an alias is decoration.
3. **`Origin` is caller-supplied.** Anyone who reads this file can set it. The
   check filters unsophisticated traffic and nothing else.
4. **One IP is one bucket.** A caller with a proxy pool has as many budgets as
   they have addresses, at both layers, because both key on the connection.
   Defeating that needs either a proof-of-work, a CAPTCHA or an account, and all
   three cost the visitor something this endpoint has decided not to charge.
5. **The provider is the last line and the real one.** Double opt-in is what
   makes a poisoned submission worthless; the endpoint can only make poisoning
   slower.
6. **No alerting.** Nothing here notices sustained abuse. The log carries
   `outcome` counts per hour and `SUBSCRIBE_LOG_HMAC_KEY` can distinguish one
   address retrying from many addresses arriving, but somebody has to go and
   look.

## Running the tests

```
node --test "tests/*.test.js"
```
