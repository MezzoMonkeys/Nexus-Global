/**
 * Google Tag Manager loader (container GTM-5776TSSC).
 *
 * This is Google's standard GTM head snippet, moved into a file. It cannot be
 * inline in the page: the CSP is script-src 'self' with no 'unsafe-inline', so
 * an inline <script> would be refused. vercel.json allows googletagmanager.com
 * and the Google Analytics endpoints for the same reason.
 *
 * The 'gtm.start' / 'gtm.js' push is what fires GTM's Initialization and
 * All Pages triggers - without it the container loads but page-view tags
 * never fire.
 *
 * Note: under this CSP, GTM "Custom HTML" tags and custom JavaScript variables
 * will not run (they need 'unsafe-inline' / 'unsafe-eval'). Built-in tag
 * templates such as the Google tag / GA4 work normally.
 */
(function (w, d, s, l, i) {
  w[l] = w[l] || [];
  w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  var f = d.getElementsByTagName(s)[0],
    j = d.createElement(s),
    dl = l != 'dataLayer' ? '&l=' + l : '';
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
  f.parentNode.insertBefore(j, f);
})(window, document, 'script', 'dataLayer', 'GTM-5776TSSC');
