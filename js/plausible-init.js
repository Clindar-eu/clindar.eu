// Plausible's queue shim, kept in a file rather than inline so the site's
// Content-Security-Policy can be script-src 'self' https://plausible.io with
// no 'unsafe-inline' and no hash to keep in sync with netlify.toml.
window.plausible = window.plausible || function () { (plausible.q = plausible.q || []).push(arguments) };
plausible.init = plausible.init || function (i) { plausible.o = i || {} };
plausible.init();
