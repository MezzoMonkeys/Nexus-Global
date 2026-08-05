/* ── Nav + Scroll + Motion ─────────────────────────────────────── */
(function(){
  const nav = document.getElementById('nav');
  const menuBtn = document.getElementById('menuBtn');
  const navMenu = document.getElementById('navMenu');
  const navLinksEl = document.getElementById('navLinks');
  const scrollProgress = document.getElementById('scrollProgress');
  const revealEls = document.querySelectorAll('.reveal');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // Scroll reveal
  if (revealEls.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in'); }
      });
    },{threshold:0.12});
    revealEls.forEach(function(el){ io.observe(el); });
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
    var updateNavTheme = function(){
      var probeY = nav.getBoundingClientRect().bottom;
      var front = sections[0];
      sections.forEach(function(s){
        if (s.getBoundingClientRect().top <= probeY) front = s;
      });
      var isDark = front.classList.contains('page--dark');
      nav.classList.toggle('dark', isDark);
      if (scrollProgress) scrollProgress.classList.toggle('dark', isDark);
    };
    window.addEventListener('scroll', updateNavTheme, { passive: true });
    window.addEventListener('resize', updateNavTheme);
    updateNavTheme();
  }

  // Scroll-progress bar
  if (scrollProgress) {
    var updateProgress = function(){
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
      scrollProgress.style.width = pct + '%';
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
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
    var toggleBackToTop = function(){
      backToTop.classList.toggle('visible', window.scrollY > window.innerHeight * 0.6);
    };
    window.addEventListener('scroll', toggleBackToTop, { passive: true });
    toggleBackToTop();
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
      var hTicking = false;
      var updateHero = function(){
        var p = Math.min(Math.max(window.pageYOffset / (window.innerHeight * 0.9), 0), 1);
        var travel = window.innerWidth * 1.15;
        hL.style.transform = 'translateX(' + (p * travel).toFixed(1) + 'px)';   // exits right
        hR.style.transform = 'translateX(' + (-p * travel).toFixed(1) + 'px)';  // exits left
        // The ambient glow was positioned to sit under the globe in its hero
        // (bottom-anchored) position, but it's a static CSS gradient, not tied
        // to the globe's own scroll-scrubbed reposition — left alone it stays
        // put while the globe moves away, then vanishes abruptly once #cover
        // scrolls out. Fade it out over the same scroll range instead, so it
        // reads as leaving deliberately alongside the rest of the hero.
        if (hGlow) hGlow.style.opacity = Math.max(1 - p * 1.4, 0);
        hTicking = false;
      };
      window.addEventListener('scroll', function(){ if(!hTicking){ requestAnimationFrame(updateHero); hTicking = true; } }, { passive: true });
      window.addEventListener('resize', updateHero);
      updateHero();
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
      var lincorTicking = false;
      var updateLincorWave = function(){
        var vh = window.innerHeight || 800;
        var rectTop = lincorSection.getBoundingClientRect().top;
        var settled = 1 - Math.min(Math.max(rectTop / vh, 0), 1);   // 0 arriving -> 1 settled
        var amp = 0.028 * (1 - settled);
        var phase = (1 - settled) * 1.2;
        lincorPath.setAttribute('d', buildWaveD(amp, phase, 2, 24));
        lincorTicking = false;
      };
      window.addEventListener('scroll', function(){ if(!lincorTicking){ requestAnimationFrame(updateLincorWave); lincorTicking = true; } }, { passive: true });
      window.addEventListener('resize', updateLincorWave);
      updateLincorWave();
    }
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
})();
