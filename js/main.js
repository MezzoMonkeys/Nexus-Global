/* ── Nav + Scroll + Motion ─────────────────────────────────────── */
(function(){
  const nav = document.getElementById('nav');
  const menuBtn = document.getElementById('menuBtn');
  const navMenu = document.getElementById('navMenu');
  const navLinksEl = document.getElementById('navLinks');
  const scrollProgress = document.getElementById('scrollProgress');
  const revealEls = document.querySelectorAll('.reveal');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Does the browser drive animations from scroll itself? Where it does, the
  // progress bar below is animated entirely in CSS, off the main thread, and the
  // JS task for it is never registered at all.
  const nativeScrollTimeline = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));

  // ── One scroll bus ───────────────────────────────────────────────────────
  // Every scroll-driven effect on this page used to own its own listener — five
  // of them — and three wrote to the DOM straight out of the event with no rAF
  // throttle at all, so on a trackpad they ran at the event rate rather than the
  // frame rate. The bigger cost was the ORDER: the nav theme measured every
  // section's rect and then wrote classes, the progress bar then wrote a width,
  // the hero then read pageYOffset and wrote transforms. Each write invalidated
  // layout for the read behind it, so one scroll could force several full
  // layouts — read/write thrash, on the same frames the globe is rendering.
  //
  // This is one passive listener and one rAF. A task registers a `measure`
  // (reads only, returns a value) and an `apply` (writes only, receives it); the
  // bus runs EVERY measure, then EVERY apply, so a frame costs one layout no
  // matter how many effects are registered. The values each effect used to read
  // for itself — scroll position, viewport height, document progress — are read
  // once here and handed round.
  var scrollTasks = [];
  var scrollQueued = false;
  var view = { y: 0, vh: 0, max: 0, progress: 0 };

  function runScrollFrame(){
    scrollQueued = false;
    var doc = document.documentElement;
    view.y = window.pageYOffset || doc.scrollTop || 0;
    view.vh = window.innerHeight || doc.clientHeight || 800;
    view.max = doc.scrollHeight - doc.clientHeight;
    view.progress = view.max > 0 ? Math.min(Math.max(view.y / view.max, 0), 1) : 0;
    var i;
    for (i = 0; i < scrollTasks.length; i++) scrollTasks[i].value = scrollTasks[i].measure(view);
    for (i = 0; i < scrollTasks.length; i++) scrollTasks[i].apply(scrollTasks[i].value, view);
  }
  function queueScrollFrame(){
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(runScrollFrame); }
  }
  function onScroll(measure, apply){
    scrollTasks.push({ measure: measure, apply: apply, value: null });
  }
  window.addEventListener('scroll', queueScrollFrame, { passive: true });
  window.addEventListener('resize', queueScrollFrame);
  // Web fonts swap after first paint and move things by a few pixels; re-run once
  // the page is fully loaded so every task is working from settled geometry.
  window.addEventListener('load', queueScrollFrame);

  var setNavHeight = function(){
    document.documentElement.style.setProperty('--nav-h', nav.getBoundingClientRect().height + 'px');
  };
  setNavHeight();
  window.addEventListener('resize', setNavHeight);

  // Pinned-panel offsets: a .stack section taller than one viewport shouldn't
  // freeze the moment it reaches the top (that would hide everything past the
  // first screenful) or need an internal/nested scroll region to reveal the
  // rest (that's a second, competing scroll stream). Instead, delay its sticky
  // lock with a negative top offset sized to its own real height, so it keeps
  // scrolling normally — full height, single scroll stream — until its own
  // last screenful has come into view, and only that final frame holds while
  // the next section covers it. Sections that already fit in one viewport get
  // 0 (unchanged, locks immediately as before).
  // #cover is excluded: it's the globe hero, whose scroll response in
  // particle-globe.js normalises against a one-viewport span and so depends on
  // its sticky position staying stable and predictable. This function re-measures
  // on 'load', which can fire after a web-font swap shifts a section's rendered
  // height by a pixel or two — if that recalculation landed while #cover was
  // actively stuck mid-transition, its offset would change out from under it and
  // read as a jump. #cover is designed to fit one viewport and needs no offset
  // anyway, so excluding it costs nothing.
  var stackEls = document.querySelectorAll('.stack:not(#cover)');
  var updateStackOffsets = function(){
    var vh = window.innerHeight || 800;
    stackEls.forEach(function(el){
      var h = el.getBoundingClientRect().height;
      el.style.setProperty('--pin-top', (h > vh ? -(h - vh) : 0) + 'px');
    });
  };
  if (stackEls.length) {
    updateStackOffsets();
    window.addEventListener('load', updateStackOffsets);
    window.addEventListener('resize', updateStackOffsets);
  }

  // Mobile menu
  if (menuBtn && navMenu) {
    menuBtn.addEventListener('click', function(){
      const open = navMenu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open);
      navMenu.setAttribute('aria-hidden', !open);
    });
    navMenu.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){
        navMenu.classList.remove('open');
        menuBtn.setAttribute('aria-expanded','false');
        navMenu.setAttribute('aria-hidden','true');
      });
    });
  }

  // Scroll reveal.
  //
  // The trigger is a line across the viewport, not a fraction of the element.
  // threshold:0.12 asked for 12% OF THE ELEMENT to be visible, which means a
  // one-line eyebrow fires the moment its top edge clears the bottom of the
  // screen while a full-height image panel has to be an eighth of the way up
  // before it does — the same authored intent going off at different places on
  // screen depending only on how tall the thing happens to be. Shrinking the
  // root's bottom edge by 12% of the VIEWPORT instead gives one trigger line at
  // 88% of screen height that everything crosses alike, so a column of mixed
  // content reveals in the order you read it and always just above the fold.
  //
  // Each element is unobserved once shown: these are one-shot entrances, and
  // re-running the callback on every later crossing was work for a class that
  // was already set.
  if (revealEls.length && 'IntersectionObserver' in window) {
    var pending = revealEls.length;
    var showReveal = function(el){
      if (el.classList.contains('in')) return;
      el.classList.add('in');
      pending--;
    };
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (!e.isIntersecting) return;
        showReveal(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
    revealEls.forEach(function(el){ io.observe(el); });

    // Safety net for the tail of the document. An element that comes to rest
    // inside that bottom 12% at maximum scroll can never cross the trigger line —
    // there is no scroll left to lift it — and would sit at opacity 0 forever,
    // which is a blank hole in the page, not a missed animation. Once the page is
    // scrolled to the end, show whatever is left.
    onScroll(function(v){ return pending > 0 && v.progress > 0.995; }, function(atEnd){
      if (!atEnd) return;
      revealEls.forEach(function(el){ if (!el.classList.contains('in')) { showReveal(el); io.unobserve(el); } });
    });
  }

  // Dark/light nav toggle. .stack sections are position:sticky with z-index
  // increasing in DOM order (see .stack in styles.css): earlier sections stay
  // pinned full-screen behind later ones as those slide up to cover them, so
  // at any scroll position several sections' bounding boxes overlap the
  // viewport at once. IntersectionObserver's isIntersecting can't tell which
  // one is actually painted on top in that situation — whichever entry's
  // callback happened to fire last won, regardless of z-index, which is what
  // let the nav pick the wrong section's colour and vanish against its own
  // background. Instead, walk the sections in DOM order (== z-index order)
  // and keep the last one whose top has scrolled up past the nav: a later
  // section only visually covers earlier ones once it's slid that far up, so
  // that's the one actually behind the nav right now.
  var sections = document.querySelectorAll('.page[id]');
  if (sections.length) {
    var navIsDark = null;
    onScroll(function(){
      var probeY = nav.getBoundingClientRect().bottom;
      var front = sections[0];
      sections.forEach(function(s){
        if (s.getBoundingClientRect().top <= probeY) front = s;
      });
      return front.classList.contains('page--dark');
    }, function(isDark){
      // The class toggle is skipped unless the answer actually changed. Writing
      // the same class back every frame is not free: it invalidates style for the
      // nav and the progress bar, and both carry .35s colour transitions that a
      // re-set can restart.
      if (isDark === navIsDark) return;
      navIsDark = isDark;
      nav.classList.toggle('dark', isDark);
      if (scrollProgress) scrollProgress.classList.toggle('dark', isDark);
    });
  }

  // Scroll-progress bar. Where the browser can drive an animation from scroll
  // position itself the bar is animated in CSS against scroll(root) and runs on
  // the compositor — nothing here participates at all. This is the fallback for
  // browsers without scroll-driven animations, and it scales the fill rather than
  // setting its width so it stays a composited transform in both paths.
  var progressBar = scrollProgress && scrollProgress.querySelector('.scroll-progress__bar');
  if (progressBar && !nativeScrollTimeline) {
    var lastProgress = -1;
    onScroll(function(v){ return v.progress; }, function(p){
      if (Math.abs(p - lastProgress) < 0.0004) return;   // sub-pixel on a 4K screen
      lastProgress = p;
      progressBar.style.transform = 'scaleX(' + p.toFixed(5) + ')';
    });
  }

  // Sliding nav indicator
  if (navLinksEl) {
    var navIndicator = navLinksEl.querySelector('.nav__indicator');
    var navAnchors = navLinksEl.querySelectorAll('a');
    var activeLink = navLinksEl.querySelector('a.active');
    function moveIndicatorTo(link){
      if (!navIndicator) return;
      if (!link) { navIndicator.style.width = '0px'; return; }
      navIndicator.style.width = link.offsetWidth + 'px';
      navIndicator.style.height = link.offsetHeight + 'px';
      navIndicator.style.transform = 'translate(' + link.offsetLeft + 'px,' + link.offsetTop + 'px)';
    }
    function setInverted(link){
      navAnchors.forEach(function(a){ a.classList.toggle('pill-active', a === link); });
    }
    if (navIndicator) {
      moveIndicatorTo(activeLink);
      setInverted(activeLink);
      navAnchors.forEach(function(a){
        a.addEventListener('mouseenter', function(){ moveIndicatorTo(a); setInverted(a); });
      });
      navLinksEl.addEventListener('mouseleave', function(){ moveIndicatorTo(activeLink); setInverted(activeLink); });
      window.addEventListener('resize', function(){
        moveIndicatorTo(navLinksEl.querySelector('a.pill-active') || activeLink);
      });
    }
  }

  // Cursor-spotlight glow
  var spotlightEls = document.querySelectorAll('.spotlight');
  spotlightEls.forEach(function(card){
    card.addEventListener('mousemove', function(e){
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--spot-x', ((e.clientX - rect.left) / rect.width * 100) + '%');
      card.style.setProperty('--spot-y', ((e.clientY - rect.top) / rect.height * 100) + '%');
    });
  });

  // Magnetic pull on arrow buttons
  var magneticBtns = document.querySelectorAll('.arrow-btn');
  if (magneticBtns.length && !reduceMotion) {
    var MAGNETIC_RADIUS = 70, MAGNETIC_STRENGTH = 0.35;
    var btnHovering = new WeakMap();
    magneticBtns.forEach(function(btn){
      btn.addEventListener('mouseenter', function(){ btnHovering.set(btn, true); });
      btn.addEventListener('mouseleave', function(){ btnHovering.set(btn, false); });
    });
    document.addEventListener('mousemove', function(e){
      magneticBtns.forEach(function(btn){
        var rect = btn.getBoundingClientRect();
        var dx = e.clientX - (rect.left + rect.width / 2);
        var dy = e.clientY - (rect.top + rect.height / 2);
        var dist = Math.sqrt(dx * dx + dy * dy);
        var flourish = btnHovering.get(btn) ? ' rotate(-12deg) scale(1.05)' : '';
        btn.style.transform = dist < MAGNETIC_RADIUS
          ? 'translate(' + (dx * MAGNETIC_STRENGTH).toFixed(1) + 'px,' + (dy * MAGNETIC_STRENGTH).toFixed(1) + 'px)' + flourish
          : flourish.trim();
      });
    });
  }

  // Sticky back-to-top button
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    var backToTopShown = null;
    onScroll(function(v){ return v.y > v.vh * 0.6; }, function(show){
      if (show === backToTopShown) return;
      backToTopShown = show;
      backToTop.classList.toggle('visible', show);
    });
    backToTop.addEventListener('click', function(){
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  // Hero headline motion: on load the two lines fly in from opposite sides and meet to form the
  // phrase (CSS transition, triggered by adding .hero-loaded). On scroll they continue in their
  // own directions and exit the page, kept in the hero position, the memorable part scroll-driven.
  var heroAu = document.querySelector('.hero-au');
  if (heroAu) {
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ heroAu.classList.add('hero-loaded'); }); });
    var hL = heroAu.querySelector('.kinetic-line--l');
    var hR = heroAu.querySelector('.kinetic-line--r');
    var hGlow = heroAu.querySelector('.hero-au__glow');
    if (hGlow) hGlow.style.transition = 'none';
    if (hL && hR && !reduceMotion) {
      var lastHeroP = -1, lastHeroTravel = -1;
      onScroll(function(v){
        // Travel is measured here, in the read phase, and carried through to the
        // write — not read again inside it. It also has to be part of what the
        // cache below compares: p saturates at 1 for the whole rest of the page,
        // so a window resize while the hero is off-screen would leave the lines
        // parked at the old viewport's distance if only p were checked.
        return {
          p: Math.min(Math.max(v.y / (v.vh * 0.9), 0), 1),
          travel: window.innerWidth * 1.15
        };
      }, function(m){
        // Both ends of the range are flat: once the hero has fully exited, every
        // further frame was rewriting an identical transform for the rest of the
        // page. Bail unless something actually moved.
        if (m.p === lastHeroP && m.travel === lastHeroTravel) return;
        lastHeroP = m.p; lastHeroTravel = m.travel;
        var p = m.p;
        hL.style.transform = 'translateX(' + (p * m.travel).toFixed(1) + 'px)';   // exits right
        hR.style.transform = 'translateX(' + (-p * m.travel).toFixed(1) + 'px)';  // exits left
        // The ambient glow was positioned to sit under the globe in its hero
        // (bottom-anchored) position, but it's a static CSS gradient, not tied
        // to the globe's own scroll-scrubbed reposition — left alone it stays
        // put while the globe moves away, then vanishes abruptly once #cover
        // scrolls out. Fade it out over the same scroll range instead, so it
        // reads as leaving deliberately alongside the rest of the hero.
        if (hGlow) hGlow.style.opacity = Math.max(1 - p * 1.4, 0);
      });
    }
  }

  // Lincor section: wavy top/bottom edge that straightens once the section is
  // settled. #lincor is a .stack card (position:sticky + z-index, see styles.css)
  // that slides up over #capabilities as the page scrolls - its own top edge IS
  // that seam. Its clip-path (id="lincorWaveClip" in about.html) starts as a
  // wave with amplitude tied to how far the section still has to travel: full
  // amplitude while its top is still down at the bottom of the viewport (just
  // arriving), shrinking to a flat rectangle once that top edge reaches 0 (fully
  // settled/stuck). Coordinates are in objectBoundingBox units (0-1), so the
  // path never needs the section's actual pixel size.
  var lincorPath = document.getElementById('lincorWavePath');
  var lincorSection = document.getElementById('lincor');
  if (lincorPath && lincorSection) {
    if (reduceMotion) {
      lincorPath.setAttribute('d', 'M0,0 L1,0 L1,1 L0,1 Z');
    } else {
      var buildWaveD = function(amp, phase, freq, n){
        var top = [], bottom = [];
        for (var i = 0; i <= n; i++) {
          var x = i / n;
          var s = Math.sin(2 * Math.PI * freq * x + phase);
          top.push(x.toFixed(4) + ',' + (amp + amp * s).toFixed(4));
        }
        for (var j = n; j >= 0; j--) {
          var xb = j / n;
          var sb = Math.sin(2 * Math.PI * freq * xb + phase);
          bottom.push(xb.toFixed(4) + ',' + (1 - amp - amp * sb).toFixed(4));
        }
        return 'M' + top.join('L') + 'L' + bottom.join('L') + 'Z';
      };
      var lastSettled = -1;
      onScroll(function(v){
        var rectTop = lincorSection.getBoundingClientRect().top;
        var settled = 1 - Math.min(Math.max(rectTop / v.vh, 0), 1);   // 0 arriving -> 1 settled
        // Quantised to 200 steps. Rebuilding the path means 50 sines, 50 toFixed
        // calls and a ~700-character string, and the section spends most of the
        // page pinned at settled === 1 where the answer is a flat rectangle that
        // never changes. Rounding also means an unrelated scroll further down the
        // page can't churn the path over differences too small to see.
        return Math.round(settled * 200) / 200;
      }, function(settled){
        if (settled === lastSettled) return;
        lastSettled = settled;
        var amp = 0.028 * (1 - settled);
        var phase = (1 - settled) * 1.2;
        lincorPath.setAttribute('d', buildWaveD(amp, phase, 2, 24));
      });
    }
  }

  // About "Our story" background video. The <source> elements ship with
  // data-src rather than src, so the initial page load fetches no video at all -
  // only the poster. They are promoted, loaded and played when the section comes
  // within 400px, and paused again when it leaves, so an off-screen video is
  // never being decoded.
  // Skipped entirely - poster only - for reduced motion, for Data Saver, and on
  // 2g-class connections, where a 0.5-1.2MB autoplaying background is a cost the
  // visitor did not ask for. Promoting the sources on demand is also what lets
  // the media attribute pick the half-resolution pair for phones, since load()
  // re-runs resource selection at that moment.
  var storyVideo = document.querySelector('.content-split__video');
  if (storyVideo && 'IntersectionObserver' in window) {
    var conn = navigator.connection || {};
    var frugal = conn.saveData === true || /(^|\-)2g$/.test(conn.effectiveType || '');
    if (!reduceMotion && !frugal) {
      var storyLoaded = false;
      var storyObserver = new IntersectionObserver(function(entries){
        var near = entries[0].isIntersecting;
        if (near && !storyLoaded) {
          storyLoaded = true;
          var srcs = storyVideo.querySelectorAll('source[data-src]');
          for (var i = 0; i < srcs.length; i++) {
            srcs[i].setAttribute('src', srcs[i].getAttribute('data-src'));
            srcs[i].removeAttribute('data-src');
          }
          storyVideo.load();
        }
        if (!storyLoaded) return;
        if (near) {
          // a refused autoplay simply leaves the poster showing
          var played = storyVideo.play();
          if (played && played.catch) played.catch(function(){});
        } else {
          storyVideo.pause();
        }
      }, { rootMargin: '400px 0px' });

      // Arming is deferred until the page has finished loading. On a 900px-tall
      // desktop viewport #story begins within a few pixels of the fold, so the
      // observer fires immediately on load at any useful rootMargin and the
      // video ends up competing with the critical path for bandwidth. Waiting
      // for the load event keeps the first paint clear and still has the video
      // ready well before it is scrolled to.
      var armStoryVideo = function(){ storyObserver.observe(storyVideo); };
      if (document.readyState === 'complete') armStoryVideo();
      else window.addEventListener('load', armStoryVideo, { once: true });
    }
  }

  // Footer flow: the caustic lines drift on their own in CSS. This adds a
  // second, pointer-led offset on top of that, so moving the cursor over the
  // footer nudges the lines. Only two custom properties are written here; the
  // per-group travel distance and the easing live in the stylesheet, and the
  // CSS keyframe drift keeps running underneath on the inner group. The two
  // groups read --mx/--my with opposite signs, which is what makes it read as
  // depth rather than as one sheet sliding.
  var footerEl = document.querySelector('.site-footer');
  var footerFlow = footerEl && footerEl.querySelector('.footer-flow');

  // The flow only needs to run while it is on screen. Left unchecked the
  // animations tick for the whole visit, keeping compositor layers alive behind
  // content nobody has scrolled to. The rootMargin starts it just before the
  // footer appears, so it is already in motion by the time it is visible.
  if (footerFlow && 'IntersectionObserver' in window) {
    footerFlow.classList.add('footer-flow--idle');
    new IntersectionObserver(function(entries){
      footerFlow.classList.toggle('footer-flow--idle', !entries[0].isIntersecting);
    }, { rootMargin: '200px 0px' }).observe(footerEl);
  }

  if (footerFlow && !reduceMotion) {
    var fmx = 0, fmy = 0, flowTicking = false;
    var applyFlow = function(){
      footerFlow.style.setProperty('--mx', fmx.toFixed(3));
      footerFlow.style.setProperty('--my', fmy.toFixed(3));
      flowTicking = false;
    };
    footerEl.addEventListener('pointermove', function(e){
      var r = footerEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      fmx = ((e.clientX - r.left) / r.width - 0.5) * 2;    // -1 .. 1
      fmy = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!flowTicking) { requestAnimationFrame(applyFlow); flowTicking = true; }
    }, { passive: true });
    // ease back to centre when the cursor leaves, rather than freezing off-axis
    footerEl.addEventListener('pointerleave', function(){
      fmx = 0; fmy = 0;
      if (!flowTicking) { requestAnimationFrame(applyFlow); flowTicking = true; }
    }, { passive: true });
  }

  // General enquiry form: static site, no backend, builds a pre-filled mailto: link.
  var enquiryForm = document.getElementById('enquiryForm');
  if (enquiryForm) {
    enquiryForm.addEventListener('submit', function(e){
      e.preventDefault();
      var name = enquiryForm.name.value.trim();
      var company = enquiryForm.company.value.trim();
      var email = enquiryForm.email.value.trim();
      var phone = enquiryForm.phone ? enquiryForm.phone.value.trim() : '';
      var role = enquiryForm.role ? enquiryForm.role.value.trim() : '';
      var subject = enquiryForm.subject ? enquiryForm.subject.value.trim() : '';
      var message = enquiryForm.message.value.trim();
      var body = 'Name: ' + name + '\nCompany: ' + company + '\nEmail: ' + email
        + (phone ? '\nPhone: ' + phone : '') + (role ? '\nI am a: ' + role : '') + '\n\n' + message;
      window.location.href = 'mailto:enquiries@nexusglobal.com'
        + '?subject=' + encodeURIComponent('Enquiry: ' + (subject || 'General Partnership'))
        + '&body=' + encodeURIComponent(body);
    });
  }

  // Every effect above registered with the bus rather than priming itself. This
  // is the one first run, and it has to be last: it puts all of them into the
  // right state for the scroll position the page actually opened at, which is not
  // necessarily the top — a reload part-way down or a #hash landing both start
  // mid-document, and each task used to have to remember to call itself once.
  runScrollFrame();
})();
