# Mounting the capture widget in the scanner

Two edits in `Clindar.impact`, both in `apps/web/src/App.tsx`, both a line long.
Nothing else in that repo changes, and the scanner keeps working unchanged when
served from anywhere that is not this site.

The widget itself, its stylesheet and its `<script>` tag all come from
`Clindar.eu`. `scripts/build.mjs` copies `widget/scanner-capture.{js,css}` into
`dist/scanner/` and links them from the built `index.html`, because those URLs
are `/scanner/`-absolute — a fact about how this site serves the build, not
about the scanner. Your dev server has no widget, which is correct for it.

---

## Edit 1 — the container

Put an empty element with `data-clindar-capture` where the widget should
appear. Recommended position: immediately after the portfolio `</section>`, so
it sits under the score and above the per-study detail.

```tsx
      </section>
    )}

    {/* Email capture, injected by the site build. Empty here on purpose:
        the scanner has no idea what goes in it. */}
    <div data-clindar-capture />

    {active && (
      <section className="detail">
```

Two things about that element:

- **Render it unconditionally.** Do not put it inside `{pf && …}`. React would
  unmount it on a reset and take the widget's DOM with it. The widget hides
  itself until there is a score, which is the same outcome without the sharp
  edge.
- **Leave it empty and never render children into it.** The widget owns
  everything inside it. React will not touch children it did not create.

## Edit 2 — announce the score

After the scan finishes and at least one study parsed, dispatch a single event
on `document`. In `handleFiles`, right after `setEntries`:

```tsx
    setEntries((prev) => [...prev, ...nextEntries]);
    setFailures((prev) => [...prev, ...nextFailures]);
    if (nextEntries.length > 0) {
      document.dispatchEvent(new CustomEvent('clindar:scored'));
    }
    setBusy(false);
```

That is the whole contract. The event may carry a `detail` payload; the widget
ignores it, deliberately — see "What the widget sends" below.

Optional: dispatch `clindar:reset` if you ever add a "start over" control, and
the widget hides again.

---

## What the widget does

- Mounts itself into `[data-clindar-capture]`, waiting for the element with a
  `MutationObserver` if React has not rendered it yet, and stops watching once
  it finds it. One widget per page.
- Stays `hidden` until `clindar:scored` has fired. Order does not matter: an
  event that fires before the widget mounts is remembered, and the widget shows
  on mount.
- On submit, POSTs to `/.netlify/functions/subscribe`, then replaces itself
  with a confirmation. On failure it shows the reason and stays submittable.

If you would rather mount it by hand — a ref and a `useEffect` — the API is
`window.ClindarCapture.mount(element, { focus })`, which returns
`{ show, hide, element }`. The auto-mount path exists so you do not have to.
`onSuccess` is called as `onSuccess({ subscribed })`; `subscribed` is `false`
when the endpoint reached no provider, which on a configured deploy never
happens.

## What the widget offers

A mailing list: the SDTMIG v4.0 change checklist, and a note when a rule in the
catalogue changes. Not the report.

It used to offer the report — "Get the full written report", "The report is on
its way" — over an endpoint that has never received a scan and cannot compose an
email. The report is rendered in the scanner tab by `renderHtml` and
`renderMarkdown` and downloaded from it; that is where it stays. Nothing in this
integration gates those buttons, and the widget sits under the score rather than
in front of it.

The confirmation therefore says the address was added, not that anything is on
its way. The endpoint knows a provider accepted an address; it does not know
that an email was ever delivered. `docs/email-capture.md` has the provider
configuration this depends on, and the deployment checklist.

## What the widget sends

One field: the email address typed into the input. That is the entire body.

```json
{ "email": "you@sponsor.com" }
```

No file name, no study identifier, no score, no band, no rule ids, no referrer,
no cookie, no storage of any kind, and no third-party script anywhere near it.
The scanner runs under `connect-src 'self'`, so this same-origin path is the
only endpoint its JavaScript can reach at all — and this is the only request it
makes.

That restraint is load-bearing. `/impact/privacy/` tells a DPO that the only
thing that leaves the browser is the address they typed, and invites them to
confirm it in the network panel. Adding scan context to this payload would make
that page a lie, so if a future version needs it, the privacy page changes in
the same commit or the change does not land.

It also bounds what can ever be offered here. An endpoint that receives no scan
cannot send a personalised anything, so the copy may only promise what a
configured provider demonstrably sends to everyone on the list.
`tests/capture-copy.test.js` fails if a report promise reappears in the widget
or on either page.

## What it does not do

It does not gate anything. The score, the per-study detail and the report
downloads all stay free and unblocked — the widget is an offer sitting under a
result, not a paywall in front of one. Gating the downloads is a separate
decision; the widget's `onSuccess` option is where that would hook in.
