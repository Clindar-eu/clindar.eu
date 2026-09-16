# Mounting the signup link in the scanner

Nothing in `Clindar.impact` needs changing for this. The scanner already renders
the container and already announces a scan; both were added for the capture
widget that used to live here, and the link that replaced it uses the same two
hooks. The scanner keeps working unchanged when served from anywhere that is not
this site, where the container simply stays empty.

The link, its stylesheet and its `<script>` tag all come from `Clindar.eu`.
`scripts/build.mjs` copies `widget/scanner-signup-link.{js,css}` into
`dist/scanner/` and links them from the built `index.html`, because those URLs
are `/scanner/`-absolute — a fact about how this site serves the build, not
about the scanner. Your dev server has no link, which is correct for it.

---

## Why this is a link and not a form

The scanner page is served with `connect-src 'none'` (see the `/scanner/*`
headers block in `netlify.toml`). The browser permits it no network connection
at all — not to a third party, and not back to this domain either.

That directive is the whole privacy claim in one line, and it is only sendable
because the page has nothing to send. It used to read `'self'`, for exactly one
reason: the email capture form was injected here and had to POST somewhere. A
policy that permits one same-origin destination permits every same-origin
destination, so the claim needed a second half — *the header bounds where a
request may go, and the scanner's own code is what keeps your Define-XML out of
the one place left* — and only a code review settled that second half.

Moving the form to `/impact/subscribe/` collapsed that to one half. A reader now
confirms the claim from the response headers instead of from a source audit. The
cost is a click, and the click is a plain anchor carrying nothing.

**So a form may never come back to this page.** Not the capture widget, not a
newsletter box, not an "email me this report" field. Any of them would need
`connect-src` reopened, which changes what `/impact/privacy/` is able to tell a
DPO. `scripts/check-scanner-csp.mjs` fails the build if the built scanner names
an endpoint at all, so this is enforced rather than remembered.

---

## The contract, both halves of which the scanner already keeps

### The container

An empty element with `data-clindar-capture`, rendered unconditionally. In the
scanner it sits after the portfolio and before the per-study detail:

```tsx
      {/*
        Email capture mounts here, from the site that serves this build - see
        docs/scanner-integration.md in Clindar.eu. Empty on purpose: this app
        has no idea what goes in it, and served anywhere else it stays empty.
      */}
      <div data-clindar-capture />
```

The attribute keeps its name even though what mounts into it is no longer a
capture form. Renaming it would mean a scanner release for a cosmetic change,
and the container not caring what goes in it is precisely the property that let
the form move in one repo instead of two.

Two things about that element:

- **Render it unconditionally.** Do not put it inside a conditional on the
  result. React would unmount it on a reset and take the link's DOM with it. The
  link hides itself until there is a result, which is the same outcome without
  the sharp edge.
- **Leave it empty and never render children into it.** Whatever mounts there
  owns everything inside it.

### The event

After a scan finishes with at least one study parsed, dispatch one event on
`document`:

```tsx
    // A result is on screen. Announced, not acted on: this app does not know
    // or care whether anything is listening, and the event carries no detail
    // because nothing about the scan is any listener's business.
    if (scanned.length > 0) document.dispatchEvent(new CustomEvent('clindar:scanned'));
```

That is the whole contract. Optionally dispatch `clindar:reset` if a "start
over" control is ever added, and the link hides again.

**On the name.** This event was `clindar:scored` until the v4.1 report redesign
renamed it to `clindar:scanned`, and the widget in this repo was not updated in
the same change — so for one submodule bump the funnel would have mounted,
waited for an event that no longer fired, and never appeared. Nothing would have
failed; it would simply have been invisible. `scanner-signup-link.js` therefore
listens for both names, and this paragraph is here so the next rename comes with
a grep of this repo.

---

## What the link does

- Mounts itself into `[data-clindar-capture]`, waiting for the element with a
  `MutationObserver` if React has not rendered it yet, and stops watching once
  it finds it. One per page.
- Stays `hidden` until the scan event has fired. Order does not matter: an event
  that fires before it mounts is remembered, and it shows on mount.
- Renders a heading, a sentence, and an `<a href="/impact/subscribe/">`.

If you would rather mount it by hand, the API is
`window.ClindarSignupLink.mount(element)`, which returns `{ show, hide, element }`.

## What the link sends

Nothing. It cannot: the policy forbids it, and the file contains no `fetch`, no
`XMLHttpRequest`, no `sendBeacon` and no form.

It also passes nothing along. The href is a bare path with no query string and
no fragment, identical for every visitor and every scan. It does not read
`event.detail` — the scanner deliberately sends none — and no file name, study
identifier, category, count or result is available to it in the first place.

That matters beyond the scanner page. `/impact/subscribe/` tells a reader that
it has never seen a scan, which is only true while the link carries nothing.
`tests/capture-copy.test.js` fails if the link grows a network primitive, reads
the event detail, or builds its href at runtime.

## What the form does, on the page that has it

`/impact/subscribe/` mounts `widget/scanner-capture.{js,css}` with
`data-clindar-capture="open"`, which shows it immediately — the visitor got
there by clicking "Join the list", and a form they have to wait for would be a
page that does nothing.

That page is under the ordinary site baseline, where a same-origin POST is
permitted. On submit the widget POSTs one field to
`/.netlify/functions/subscribe`:

```json
{ "email": "you@sponsor.com" }
```

No file name, no study identifier, no score, no rule ids, no referrer data, no
cookie, no storage of any kind. `docs/email-capture.md` has the provider
configuration this depends on and the deployment checklist.

## What the offer is

A mailing list: the SDTMIG v4.0 change checklist, and a note when a rule in the
catalogue changes. Not the report.

The confirmation says the address was added, not that anything is on its way.
The endpoint knows a provider accepted an address; it does not know that an
email was ever delivered. An endpoint that receives no scan cannot send a
personalised anything either, so the copy may only promise what a configured
provider demonstrably sends to everyone on the list —
`tests/capture-copy.test.js` fails if a report promise reappears in the widget or
on any of the pages describing it.

## What it does not do

It does not gate anything. The result, the per-study detail and every export —
HTML, Markdown, PDF, JSON and the Excel checklist — stay free and unblocked. The
link is an offer sitting under a result, not a paywall in front of one, and it
is now on a different page from the result entirely, which makes that harder to
get wrong rather than easier.
