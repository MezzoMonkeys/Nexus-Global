/* ── Nav + Scroll + Motion ─────────────────────────────────────── */
(function(){
  const nav = document.getElementById('nav');
  const menuBtn = document.getElementById('menuBtn');
  const navMenu = document.getElementById('navMenu');
  const navLinksEl = document.getElementById('navLinks');
  const scrollProgress = document.getElementById('scrollProgress');
  const revealEls = document.querySelectorAll('.reveal');
  const darkSections = ['cover','contact','cta'];
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var setNavHeight = function(){
    document.documentElement.style.setProperty('--nav-h', nav.getBoundingClientRect().height + 'px');
  };
  setNavHeight();
  window.addEventListener('resize', setNavHeight);

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

  // Dark/light nav toggle, keyed off whichever section is in view
  var sections = document.querySelectorAll('.page[id]');
  if (sections.length && 'IntersectionObserver' in window) {
    var sectionObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var isDark = darkSections.includes(e.target.id) || e.target.classList.contains('page--dark');
        nav.classList.toggle('dark', isDark);
        if (scrollProgress) scrollProgress.classList.toggle('dark', isDark);
      });
    },{threshold:0.4});
    sections.forEach(function(s){ sectionObserver.observe(s); });
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

  // Count-up numbers: animate from 0 to the printed value once scrolled into view.
  var countEls = document.querySelectorAll('.stat-strip__num, .count-up');
  if (countEls.length && 'IntersectionObserver' in window) {
    var countObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        animateStatNumber(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    countEls.forEach(function(el){ countObserver.observe(el); });
  }

  function animateStatNumber(el){
    var match = el.textContent.trim().match(/^([^\d]*)([\d,]+)(.*)$/);
    if (!match) return;
    var prefix = match[1], target = parseInt(match[2].replace(/,/g, ''), 10), suffix = match[3];
    var duration = parseInt(el.dataset.duration, 10) || 1400, start = null;
    function step(ts){
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
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
    var hRest = heroAu.querySelectorAll('.hero-au__eyebrow, .hero-au__sub');
    hRest.forEach(function(el){ el.style.transition = 'none'; });   // instant, 1:1 with scroll, no chase/lag
    if (hL && hR && !reduceMotion) {
      var hTicking = false;
      var updateHero = function(){
        var p = Math.min(Math.max(window.pageYOffset / (window.innerHeight * 0.9), 0), 1);
        var travel = window.innerWidth * 1.15;
        hL.style.transform = 'translateX(' + (p * travel).toFixed(1) + 'px)';   // exits right
        hR.style.transform = 'translateX(' + (-p * travel).toFixed(1) + 'px)';  // exits left
        // The eyebrow/subhead don't fly off sideways like the kinetic headline;
        // they scroll straight up and off, same direction the globe is
        // travelling, so the panel is clear before the next section's own
        // content slides up over it.
        var exitY = -p * window.innerHeight * 1.1;
        hRest.forEach(function(el){
          el.style.transform = 'translateY(' + exitY.toFixed(1) + 'px)';
        });
        hTicking = false;
      };
      window.addEventListener('scroll', function(){ if(!hTicking){ requestAnimationFrame(updateHero); hTicking = true; } }, { passive: true });
      window.addEventListener('resize', updateHero);
      updateHero();
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
      var role = enquiryForm.role ? enquiryForm.role.value.trim() : '';
      var subject = enquiryForm.subject ? enquiryForm.subject.value.trim() : '';
      var message = enquiryForm.message.value.trim();
      var body = 'Name: ' + name + '\nCompany: ' + company + '\nEmail: ' + email
        + (role ? '\nI am a: ' + role : '') + '\n\n' + message;
      window.location.href = 'mailto:enquiries@nexusglobal.com'
        + '?subject=' + encodeURIComponent('Enquiry: ' + (subject || 'General Partnership'))
        + '&body=' + encodeURIComponent(body);
    });
  }
})();
