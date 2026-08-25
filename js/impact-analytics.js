/**
 * Funnel analytics for the impact scanner landing page.
 *
 * What this measures: how many people who land on /impact/ go on to open the
 * scanner, and where on the page they clicked to do it. That is the whole of
 * it. Conversions at the other end are counted from the subscribe function's
 * own log, not from the browser.
 *
 * What it deliberately does not measure: anything on /scanner/. Reporting a
 * scan — the count, the band, which rules fired — would mean the scanner page
 * making a request that carries facts about somebody's portfolio, and no
 * wording makes that compatible with what /impact/privacy/ tells a DPO to look
 * for in their network panel. Plausible is also a third-party origin, which
 * `connect-src 'self'` puts out of reach there by design.
 *
 * Plausible is cookieless and stores nothing per visitor. Events fire on the
 * landing page only; the privacy page loads no analytics at all.
 */
(function () {
  'use strict';

  // If the event never comes back — Plausible blocked, offline, slow — the
  // click still has to navigate. Nobody waits on a counter.
  var NAVIGATE_FALLBACK_MS = 400;

  function isPlainLeftClick(event) {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.defaultPrevented
    );
  }

  function track(name, from, done) {
    if (typeof window.plausible !== 'function') {
      done();
      return;
    }

    var finished = false;
    function once() {
      if (finished) return;
      finished = true;
      done();
    }

    window.plausible(name, { props: { from: from }, callback: once });
    window.setTimeout(once, NAVIGATE_FALLBACK_MS);
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('[data-plausible-event]');
    if (!link) return;

    var name = link.getAttribute('data-plausible-event');
    var from = link.getAttribute('data-plausible-from') || 'unknown';

    // Modified clicks open a new tab and never leave this page: record the
    // event, then get out of the way.
    if (!isPlainLeftClick(event) || !link.href || link.target === '_blank') {
      track(name, from, function () {});
      return;
    }

    event.preventDefault();
    var href = link.href;
    track(name, from, function () {
      window.location.href = href;
    });
  });
})();
