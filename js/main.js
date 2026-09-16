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
  const nativeViewTimeline = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));

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

  // The same rAF coalescing for resize, and for the same reason the scroll bus
  // above exists. resize fires many times a second during a window drag, and
  // every handler registered here measures - which forces synchronous layout on
  // each call. Measured before this: 20 resize steps ran ~200
  // getBoundingClientRect calls. Coalesced, a burst of any density costs one
  // batch per frame.
  // It matters most on a phone, where the thing firing resize is the URL bar
  // sliding in and out DURING a scroll - so the unthrottled version was doing
  // forced layout on the exact hot path the pin-offset work was written to keep
  // clear.
  var resizeTasks = [];
  var resizeQueued = false;
  function runResizeFrame(){
    resizeQueued = false;
    for (var i = 0; i < resizeTasks.length; i++) resizeTasks[i]();
  }
  function onResize(fn){ resizeTasks.push(fn); }
  window.addEventListener('resize', function(){
    if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(runResizeFrame); }
  });

  var setNavHeight = function(){
    document.documentElement.style.setProperty('--nav-h', nav.getBoundingClientRect().height + 'px');
  };
  setNavHeight();
  onResize(setNavHeight);

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

  // BOTH SIDES OF THIS SUBTRACTION MUST BE THE SAME UNIT, and that is the whole
  // bug this replaces. The sections are sized by CSS: .page is min-height:100vh.
  // On a phone 100vh is the LARGE viewport - the height with the URL bar
  // collapsed - and it deliberately does not change when that bar slides in and
  // out. window.innerHeight is the VISUAL viewport and does change, by 60-100px,
  // every time the bar moves, which on a phone is constantly and in both
  // directions as you scroll.
  // Mixing them meant -(height - innerHeight) was recomputed against a number
  // that moved on its own, so --pin-top was rewritten mid-scroll and every
  // stuck panel stepped vertically by exactly the URL bar's height with no
  // scrolling involved. Measured on network.html: a 60px viewport change moved
  // #footprint, #where-we-work and #spotlight 60px each, instantly. Because the
  // bar collapses scrolling down and returns scrolling up, it read as a repeated
  // catch-and-step rather than a one-off.
  // Reading 100vh through a probe element gives exactly the value the CSS used,
  // so the arithmetic is stable and a URL-bar resize now computes an identical
  // result and writes nothing.
  var vhProbe = document.createElement('div');
  vhProbe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
  var readVh = function(){
    document.body.appendChild(vhProbe);
    var h = vhProbe.getBoundingClientRect().height;
    vhProbe.parentNode.removeChild(vhProbe);
    return h || window.innerHeight || 800;
  };

  var updateStackOffsets = function(){
    var vh = readVh();
    stackEls.forEach(function(el){
      var h = el.getBoundingClientRect().height;
      var next = (h > vh ? -(h - vh) : 0) + 'px';
      // Write only on a real change. A no-op write is harmless in itself, but
      // this keeps a stray resize from ever touching a panel that is currently
      // stuck, which is the state where any change to top is visible as a jump.
      if (el.style.getPropertyValue('--pin-top') !== next) {
        el.style.setProperty('--pin-top', next);
      }
    });
  };
  if (stackEls.length) {
    updateStackOffsets();
    window.addEventListener('load', updateStackOffsets);
    onResize(updateStackOffsets);
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
    // A .curtain section (see styles.css) does not arrive as its own box: six
    // columns rise ahead of it and reach the top of the screen well before its
    // top edge does. Measuring the box would leave the bar in its dark treatment
    // against platinum that has already covered it — light text on a light
    // surface for most of a screen of scrolling. Measure the column sitting
    // under the middle of the bar instead, since that is the surface the capsule
    // is actually being read against. Falls back to the section's own top
    // wherever the columns are not running — no scroll-timeline support, or
    // reduced motion — because there they are display:none and have no box.
    // Because the columns arrive one at a time, the bar can genuinely be over two
    // different surfaces at once, so it is sampled at an x position rather than
    // globally: the column under that point is the one being read against.
    var frontEdgeOf = function(s, x){
      if (s.classList.contains('curtain')) {
        var cols = s.querySelectorAll('.curtain__col');
        for (var i = 0; i < cols.length; i++) {
          var cr = cols[i].getBoundingClientRect();
          if (cr.width && cr.left <= x && cr.right >= x) return cr.top;
        }
      }
      return s.getBoundingClientRect().top;
    };
    var frontIsDarkAt = function(probeY, x){
      var front = sections[0];
      sections.forEach(function(s){
        if (frontEdgeOf(s, x) <= probeY) front = s;
      });
      return front.classList.contains('page--dark');
    };

    // The logo is sampled separately from everything else. The capsule is centred
    // and the menu button sits right, so the middle of the bar speaks for both,
    // but the mark is hard left — and on a phone, where the curtain is three wide
    // columns, the leftmost one covers the mark while the middle of the bar is
    // still over the dark hero. One reading for the whole bar leaves the mark in
    // its light-on-dark form against platinum, which all but erases it. Only the
    // curtain can produce that split, so the second probe is skipped entirely on
    // pages without one.
    var navBrand = nav.querySelector('.nav__brand');
    var hasCurtain = !!document.querySelector('.page.curtain');
    var navIsDark = null, brandIsDark = null;
    onScroll(function(){
      var probeY = nav.getBoundingClientRect().bottom;
      var main = frontIsDarkAt(probeY, (window.innerWidth || 0) / 2);
      var brand = main;
      if (hasCurtain && navBrand) {
        var br = navBrand.getBoundingClientRect();
        brand = frontIsDarkAt(probeY, br.left + br.width / 2);
      }
      return { main: main, brand: brand };
    }, function(m){
      // Each toggle is skipped unless its own answer actually changed. Writing
      // the same class back every frame is not free: it invalidates style for the
      // nav and the progress bar, and both carry .35s colour transitions that a
      // re-set can restart.
      if (m.main !== navIsDark) {
        navIsDark = m.main;
        nav.classList.toggle('dark', m.main);
        if (scrollProgress) scrollProgress.classList.toggle('dark', m.main);
      }
      if (m.brand !== brandIsDark) {
        brandIsDark = m.brand;
        nav.classList.toggle('dark-brand', m.brand);
      }
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
      onResize(function(){
        moveIndicatorTo(navLinksEl.querySelector('a.pill-active') || activeLink);
      });
    }
  }

  // The cursor-spotlight tracker used to live here: a mousemove listener on
  // every .spotlight element writing --spot-x/--spot-y so a radial glow could
  // follow the pointer. The glow was removed when the containers moved to the
  // dark surface - a second light appearing under the cursor competed with the
  // one that shifts on hover - and nothing has read those two properties since.
  // The listener kept running regardless: measured at 2 style writes per pointer
  // move, on each of 14 elements, every value discarded.
  // Removed rather than left in place. Restoring it is a dozen lines, and it is
  // not worth paying for a mousemove handler on the chance the effect comes
  // back. (The class it hung off is now .surface, for the same reason.)

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

  // ── Curtain momentum (network.html) ──────────────────────────────────────
  // The curtain is authored in CSS against the section's own view timeline, so
  // it tracks scroll position exactly: stop scrolling and it stops in the same
  // frame. That is honest, and it reads as abrupt — the columns arrive with no
  // weight to them. This gives the sequence a little inertia, so releasing the
  // wheel lets the columns carry a fraction further and settle.
  //
  // NOTHING HERE TOUCHES SCROLLING. The page still scrolls natively at its own
  // speed; the only thing that lags is the animation's own clock, so there is no
  // input latency, no swallowed wheel events, and Ctrl+F, PageDown and scrollbar
  // dragging all behave exactly as before. This is the narrow version of scroll
  // easing that costs nothing: it is applied to one decorative sequence, not to
  // the document.
  //
  // The keyframes and ranges stay in the stylesheet and are read back off the
  // animations rather than restated here — this moves each CSS animation onto a
  // JS clock and drives its currentTime, so the stylesheet remains the only
  // place the motion is defined. If any of that fails the original timelines are
  // put back and the effect carries on exactly as it does without this.
  var curtainSec = document.querySelector('.page.curtain');
  if (curtainSec && nativeViewTimeline && !reduceMotion && typeof ViewTimeline !== 'undefined') {
    var armCurtainMomentum = function(){
      var CLOCK_SPAN = 200;   // the clock's range, in % of `entry` (see styles.css)
      var DUR = 1000;         // arbitrary scale for the retimed animations
      // Time constant for the carry. The columns cross a screen in half the
      // range, so they travel at twice the scroll rate and any lag reads twice
      // as far on screen as it does in scroll distance — 0.07 puts an ordinary
      // reading scroll at about a tenth of a screen of carry, settled inside
      // 200ms. Raising this past ~0.1 stops reading as weight and starts
      // reading as the page being behind you.
      var TAU = 0.07;
      var MAX_LAG = 14;       // % of `entry` the sequence may ever trail by
      var SETTLED = 0.02;     // % of `entry` at which we call it arrived

      var clockEl = curtainSec.querySelector('.curtain__clock');
      var clock = clockEl && clockEl.getAnimations()[0];
      if (!clock || !(clock.timeline instanceof ViewTimeline)) return;

      // Every scroll-driven animation in the section except the clock itself,
      // with the range each one was authored with.
      var tracked = [];
      curtainSec.getAnimations({ subtree: true }).forEach(function(a){
        if (a === clock || !(a.timeline instanceof ViewTimeline)) return;
        var s = a.rangeStart, e = a.rangeEnd;
        if (!s || !e || !s.offset || !e.offset) return;
        var from = s.offset.value, to = e.offset.value;
        if (typeof from !== 'number' || typeof to !== 'number' || !(to > from)) return;
        tracked.push({ anim: a, from: from, to: to, timeline: a.timeline });
      });
      if (!tracked.length) return;

      try {
        tracked.forEach(function(t){
          t.anim.timeline = document.timeline;
          t.anim.effect.updateTiming({ duration: DUR, fill: 'both' });
          t.anim.pause();
        });
      } catch (err) {
        // Hand the sequence back to the browser untouched rather than leave it
        // half-converted and frozen.
        tracked.forEach(function(t){
          try { t.anim.timeline = t.timeline; } catch (e2) {}
        });
        return;
      }

      var targetPct = function(){
        var p = clock.effect.getComputedTiming().progress;
        return (p == null ? 0 : p) * CLOCK_SPAN;
      };
      var write = function(pct){
        for (var i = 0; i < tracked.length; i++) {
          var t = tracked[i];
          var local = (pct - t.from) / (t.to - t.from);
          t.anim.currentTime = (local < 0 ? 0 : local > 1 ? 1 : local) * DUR;
        }
      };

      var shown = null, lastTs = 0, running = false;
      var step = function(ts){
        var target = targetPct();
        // Frame-rate independent, and capped: a hard fling would otherwise leave
        // the columns most of a screen behind, which stops reading as weight and
        // starts reading as broken.
        var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 1 / 60;
        lastTs = ts;
        var gap = target - shown;
        if (gap > MAX_LAG) shown = target - MAX_LAG;
        else if (gap < -MAX_LAG) shown = target + MAX_LAG;
        shown += (target - shown) * (1 - Math.exp(-dt / TAU));
        write(shown);
        // The columns are still moving here with no scroll happening, so nothing
        // else would re-run: the nav reads which column is under it to decide
        // its own colour, and would hold a stale answer for the whole carry.
        queueScrollFrame();
        if (Math.abs(target - shown) > SETTLED) { requestAnimationFrame(step); return; }
        // Arrived: land exactly on the true position and stop. No idle loop.
        shown = target; write(shown); queueScrollFrame(); running = false; lastTs = 0;
      };
      var kick = function(){
        if (shown === null) { shown = targetPct(); write(shown); }   // no catch-up on load
        if (running) return;
        // The gap check is what keeps this from free-running. step() asks the bus
        // for a frame so the nav can follow the columns during the carry, and the
        // bus calls back here — without this, those two would keep waking each
        // other for the rest of the visit at a solid 60fps.
        if (Math.abs(targetPct() - shown) <= SETTLED) return;
        running = true; lastTs = 0; requestAnimationFrame(step);
      };
      kick();
      onScroll(function(){ return null; }, kick);
    };
    if (document.readyState === 'complete') armCurtainMomentum();
    else window.addEventListener('load', armCurtainMomentum, { once: true });
  }

  // Cradle to Grave: the paragraph types itself in.
  //
  // The text is already in the markup and is never inserted or removed. This
  // wraps the characters that are there and reveals them in order, which is what
  // keeps the effect from costing anything real: a crawler that does not run
  // scripts reads the paragraph whole, a screen reader is handed a static string
  // rather than one mutating under it, and the line breaks are computed once
  // from the full text so the block never reflows while it fills in.
  //
  // Spaces are deliberately NOT wrapped. Leaving them as bare text nodes keeps
  // every line-break opportunity exactly where the browser would put it anyway,
  // and an invisible space is invisible either way, so wrapping them would be
  // work with a layout risk and no payoff.
  var typeEl = document.getElementById('c2gType');
  if (typeEl && typeEl.textContent.trim()) {
    // Walks the tree rather than flattening textContent. The paragraph contains a
    // .c2g-hl span around the phrase that gets highlighted at the end, and reading
    // textContent then rewriting it would throw that span away - the characters
    // would survive and the structure would not. Descending instead wraps the
    // characters inside each text node and leaves every element where it was.
    var chars = [];
    var wrapChars = function(node){
      var kids = [].slice.call(node.childNodes);
      for (var k = 0; k < kids.length; k++) {
        var n = kids[k];
        if (n.nodeType === 3) {
          var t = n.nodeValue, frag = document.createDocumentFragment();
          for (var ci = 0; ci < t.length; ci++) {
            var ch = t.charAt(ci);
            if (ch === ' ' || ch === '\n' || ch === '\t') {
              frag.appendChild(document.createTextNode(ch));
            } else {
              var sp = document.createElement('span');
              sp.className = 'c2g-type__c';
              sp.textContent = ch;
              frag.appendChild(sp);
              chars.push(sp);
            }
          }
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) {
          wrapChars(n);
        }
      }
    };
    wrapChars(typeEl);

    // Hand assistive technology the sentence, not the letters.
    //
    // Splitting a paragraph into one span per character does not just look like
    // a rendering detail to a screen reader - it changes what the accessibility
    // tree contains. Measured on this paragraph before this block existed: 353
    // single-character StaticText nodes and NOT ONE node carrying the sentence,
    // so anything reading the tree gets the text letter by letter.
    //
    // aria-label on the <p> is not the fix. ARIA prohibits naming role=paragraph
    // and browsers ignore it there, so it would look correct in the markup and
    // do nothing. Instead the split characters are marked presentational and a
    // visually-hidden copy of the original text carries the meaning - the same
    // arrangement text-splitting libraries settle on, for the same reason.
    //
    // Built here rather than written into about.html so the served HTML stays a
    // single clean paragraph: a crawler that does not run scripts, and the
    // no-JS reader, both still get exactly one copy of the text.
    var plainText = typeEl.textContent;
    var visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    while (typeEl.firstChild) { visual.appendChild(typeEl.firstChild); }
    var srCopy = document.createElement('span');
    srCopy.className = 'sr-only';
    srCopy.textContent = plainText;
    typeEl.appendChild(srCopy);
    typeEl.appendChild(visual);

    // Queried after the move, not before: the node is the same one either way,
    // but reading it from its final home is what keeps this correct if the
    // structure above is ever rearranged again.
    var highlight = typeEl.querySelector('.c2g-hl');

    // ~165 characters a second puts this paragraph at about 2.6s. Slower reads
    // as a gimmick holding the reader on an unfinished sentence; faster stops
    // registering as typing at all.
    var CPS = 165;
    var runType = function(){
      typeEl.classList.add('is-armed', 'is-typing');
      var t0 = 0, shown = 0, caret = null;
      var step = function(ts){
        if (!t0) t0 = ts;
        var target = Math.min(chars.length, Math.floor((ts - t0) / 1000 * CPS));
        // One pass per frame over only the newly-due characters, rather than a
        // timer per character: the whole run is O(n) writes and one rAF chain.
        while (shown < target) { chars[shown++].setAttribute('data-on', ''); }
        // The caret hangs off the last revealed character so it sits where the
        // typing is. Exactly one element carries it at a time - moved, not
        // re-created - so this stays two attribute writes a frame.
        var head = chars[shown - 1];
        if (head && head !== caret) {
          if (caret) { caret.removeAttribute('data-caret'); }
          head.setAttribute('data-caret', '');
          caret = head;
        }
        if (shown < chars.length) { requestAnimationFrame(step); return; }
        if (caret) { caret.removeAttribute('data-caret'); }
        typeEl.classList.remove('is-typing');
        // The marker runs only once the sentence it marks is fully readable.
        // Sweeping it while characters were still arriving would highlight a
        // phrase the reader has not been given yet.
        if (highlight) {
          setTimeout(function(){ highlight.classList.add('is-lit'); }, 420);
        }
      };
      requestAnimationFrame(step);
    };

    // Anyone who has asked for less motion, and any browser without an observer
    // to trigger on, keeps the paragraph exactly as it was: whole, immediately.
    // .is-armed is never added in that case, so nothing is ever hidden.
    if (!reduceMotion && 'IntersectionObserver' in window) {
      var typeIo = new IntersectionObserver(function(entries){
        if (!entries[0].isIntersecting) return;
        typeIo.disconnect();
        runType();
      }, { threshold: 0.35 });
      typeIo.observe(typeEl);
    } else if (highlight) {
      // No typing here, but the phrase should still end up green - the colour is
      // part of how the sentence reads, not part of the animation. The CSS
      // reduced-motion rule drops the sweep and leaves the end state.
      highlight.classList.add('is-lit');
    }
  }

  // General enquiry form. Posts to /api/enquiry.
  //
  // This used to hand the browser a mailto: link, which looks like it worked and
  // frequently did nothing: no configured mail client, no send, no error, no
  // record. The mailto is still here, but only as the last resort when the
  // endpoint is unreachable, and it is now offered as a visible link the sender
  // can choose rather than a navigation that happens to them.
  var enquiryForm = document.getElementById('enquiryForm');
  var enquiryStatus = document.getElementById('enquiryStatus');
  if (enquiryForm) {
    var submitBtn = enquiryForm.querySelector('[type="submit"]');
    var FIELDS = ['name','company','email','phone','role','subject','message','website'];

    // Timing trap. Stamped the moment the form is ready rather than on first
    // keystroke, so the server's minimum-elapsed check measures the whole time
    // a person had the form in front of them, not just their typing speed.
    var tsField = document.getElementById('f-ts');
    if (tsField) { tsField.value = String(Date.now()); }

    var say = function(msg, kind){
      if (!enquiryStatus) return;
      enquiryStatus.textContent = msg;
      enquiryStatus.setAttribute('data-state', kind || '');
    };

    // Turnstile issues a fresh, single-use token per solve. A widget rendered
    // with a form-associated input is picked up by name, so this reads
    // whatever the widget currently holds rather than caching a stale token.
    var turnstileToken = function(){
      var el = enquiryForm.querySelector('[name="cf-turnstile-response"]');
      return el ? el.value : '';
    };
    // Resetting after every attempt, success or failure, is what makes the
    // widget hand out a new token for the next submit - Cloudflare rejects a
    // reused one, so without this a retry after a failed send would silently
    // fail Turnstile a second time.
    var resetTurnstile = function(){
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        window.turnstile.reset();
      }
    };

    enquiryForm.addEventListener('submit', function(e){
      e.preventDefault();
      var d = {};
      FIELDS.forEach(function(f){ d[f] = enquiryForm[f] ? String(enquiryForm[f].value).trim() : ''; });
      d.ts = tsField ? tsField.value : '';
      d['cf-turnstile-response'] = turnstileToken();

      if (submitBtn) { submitBtn.disabled = true; }
      say('Sending your enquiry…');

      fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
      }).then(function(r){
        return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, body: j }; });
      }).then(function(res){
        if (res.ok && res.body.ok) {
          enquiryForm.reset();
          if (tsField) { tsField.value = String(Date.now()); }
          say('Thank you, we’ve got your enquiry and will respond as soon as possible.', 'ok');
        } else {
          throw new Error((res.body && res.body.error) || 'Request failed');
        }
      }).catch(function(){
        // Endpoint unreachable or not yet configured. Keep what they typed, and
        // give them a working route out instead of a dead end.
        say('');
        if (enquiryStatus) {
          enquiryStatus.setAttribute('data-state', 'error');
          enquiryStatus.textContent = 'We couldn’t send that just now. Your message is still here, so please try again in a moment, or call us on ';
          var hk = document.createElement('a');
          hk.href = 'tel:+85221512260';
          hk.textContent = '+852 2151 2260';
          enquiryStatus.appendChild(hk);
          enquiryStatus.appendChild(document.createTextNode(' or '));
          var za = document.createElement('a');
          za.href = 'tel:+27761083699';
          za.textContent = '+27 76 108 3699';
          enquiryStatus.appendChild(za);
          enquiryStatus.appendChild(document.createTextNode('.'));
        }
      }).then(function(){
        if (submitBtn) { submitBtn.disabled = false; }
        resetTurnstile();
      });
    });
  }

  // Every effect above registered with the bus rather than priming itself. This
  // is the one first run, and it has to be last: it puts all of them into the
  // right state for the scroll position the page actually opened at, which is not
  // necessarily the top — a reload part-way down or a #hash landing both start
  // mid-document, and each task used to have to remember to call itself once.
  runScrollFrame();
})();
