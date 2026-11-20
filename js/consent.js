/**
 * Cookie consent + Google Tag Manager (container GTM-5776TSSC).
 *
 * WHAT THIS DOES
 * Google Tag Manager, and through it Google Analytics, does not load at all
 * until the visitor clicks "Accept" on the cookie banner. Before that, no
 * request goes to Google and no _ga cookie is set. That is the conservative
 * reading of UK PECR / EU ePrivacy, POPIA and the ICO's guidance, and it is
 * what privacy.html promises, so the two must stay in step: if this file
 * changes what loads or when, the "Cookies" section of privacy.html changes
 * with it.
 *
 * - Consent Mode v2 defaults are pushed first, every page view. Advertising
 *   storage is always denied (the site runs no advertising); analytics storage
 *   is granted only when a stored "accept" exists.
 * - The choice is kept in localStorage under "ng-consent" with a timestamp,
 *   and is asked again after 12 months or if CONSENT_VERSION is bumped (bump
 *   it when the categories or the purposes on the banner change).
 * - Withdrawing consent after GTM has loaded: a running GTM cannot be unloaded,
 *   so the _ga cookies are deleted and the page reloads without it.
 * - Any element with a data-cookie-settings attribute (the footer link on every
 *   page) reopens the banner.
 *
 * WHY IT IS A FILE AND NOT INLINE
 * The CSP is script-src 'self' with no 'unsafe-inline', so an inline snippet
 * would be refused. vercel.json allows googletagmanager.com and the Google
 * Analytics endpoints. Under that CSP, GTM "Custom HTML" tags and custom
 * JavaScript variables will not run; built-in tag templates (GA4) do.
 *
 * Banner styles live in css/styles.css under "Cookie consent banner".
 */
(function (w, d) {
  'use strict';

  var GTM_ID = 'GTM-5776TSSC';
  var KEY = 'ng-consent';
  var CONSENT_VERSION = 1;
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }

  function readChoice() {
    try {
      var v = JSON.parse(w.localStorage.getItem(KEY));
      if (v && v.v === CONSENT_VERSION && typeof v.analytics === 'boolean' &&
          Date.now() - v.t < MAX_AGE_MS) return v;
    } catch (e) { /* storage blocked or unparseable: treat as no choice */ }
    return null;
  }

  function saveChoice(analytics) {
    try {
      w.localStorage.setItem(KEY, JSON.stringify({ v: CONSENT_VERSION, analytics: analytics, t: Date.now() }));
    } catch (e) { /* private mode etc: the choice holds for this page only */ }
  }

  var choice = readChoice();

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: choice && choice.analytics ? 'granted' : 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted'
  });

  var gtmLoaded = false;
  function loadGtm() {
    if (gtmLoaded) return;
    gtmLoaded = true;
    // The gtm.start / gtm.js event is what fires GTM's Initialization and
    // All Pages triggers; without it page-view tags never fire.
    w.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = d.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    d.head.appendChild(s);
  }

  if (choice && choice.analytics) loadGtm();

  function clearAnalyticsCookies() {
    var host = w.location.hostname;
    var domains = ['', host, '.' + host.replace(/^www\./, '')];
    d.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (/^_ga($|_)|^_gid$|^_gat/.test(name)) {
        domains.forEach(function (dom) {
          d.cookie = name + '=; Max-Age=0; path=/' + (dom ? '; domain=' + dom : '');
        });
      }
    });
  }

  function decide(analytics) {
    var hadGranted = gtmLoaded;
    saveChoice(analytics);
    choice = { analytics: analytics };
    hideBanner();
    if (analytics) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      loadGtm();
    } else {
      gtag('consent', 'update', { analytics_storage: 'denied' });
      clearAnalyticsCookies();
      if (hadGranted) w.location.reload();
    }
  }

  // ---- Banner ----------------------------------------------------------

  var banner = null;
  var returnFocusTo = null;

  function buildBanner() {
    banner = d.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.hidden = true;

    var title = d.createElement('p');
    title.className = 'consent__title';
    title.id = 'consent-title';
    title.textContent = 'Cookies';

    var text = d.createElement('p');
    text.className = 'consent__text';
    text.appendChild(d.createTextNode(
      'With your permission we use Google Analytics cookies to see how visitors use this site, so we can improve it. ' +
      'Nothing is set until you accept, and you can change your mind at any time. '));
    var link = d.createElement('a');
    link.href = '/privacy#cookies';
    link.textContent = 'Privacy & cookies';
    text.appendChild(link);

    var status = d.createElement('p');
    status.className = 'consent__status';
    status.setAttribute('aria-live', 'polite');

    var actions = d.createElement('div');
    actions.className = 'consent__actions';
    var decline = d.createElement('button');
    decline.type = 'button';
    decline.className = 'btn-pill consent__btn consent__btn--decline';
    decline.textContent = 'Decline';
    decline.addEventListener('click', function () { decide(false); });
    var accept = d.createElement('button');
    accept.type = 'button';
    accept.className = 'btn-pill btn-pill--fill consent__btn';
    accept.textContent = 'Accept';
    accept.addEventListener('click', function () { decide(true); });
    actions.appendChild(decline);
    actions.appendChild(accept);

    banner.appendChild(title);
    banner.appendChild(text);
    banner.appendChild(status);
    banner.appendChild(actions);
    d.body.appendChild(banner);
  }

  function showBanner(fromSettings) {
    if (!banner) buildBanner();
    var status = banner.querySelector('.consent__status');
    if (choice) {
      status.textContent = 'Analytics cookies are currently ' + (choice.analytics ? 'on.' : 'off.');
      status.hidden = false;
    } else {
      status.textContent = '';
      status.hidden = true;
    }
    banner.hidden = false;
    // Only move focus when the visitor asked for the banner; on first load it
    // must not steal focus from the page.
    if (fromSettings) {
      returnFocusTo = d.activeElement;
      banner.querySelector('.consent__btn').focus();
    }
  }

  function hideBanner() {
    if (!banner) return;
    banner.hidden = true;
    if (returnFocusTo && returnFocusTo.focus) returnFocusTo.focus();
    returnFocusTo = null;
  }

  // Delegated, so it works for footer links whether or not this script ran
  // before they were parsed.
  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!t) return;
    e.preventDefault();
    showBanner(true);
  });

  function onReady() { if (!choice) showBanner(false); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})(window, document);
