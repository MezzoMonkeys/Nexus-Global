/* ── Pin-stripe scroll line ───────────────────────────────────────────────
   A single #660007 line threaded through specific sections on Home and
   About, entirely scroll-scrubbed. Shared engine below, page-specific
   wiring (which elements, which paths) at the bottom — only one wiring
   block's element-existence guard will ever pass on a given page, since
   each page's HTML only contains its own pin-stripe markup, so there's
   no risk of two instances fighting over the same lock/listeners.

   Scroll-CAPTURE per segment, same pattern as particle-globe.js's own gate:
   once a chapter's host section becomes the topmost pinned panel, further
   scroll input is captured (preventDefault) and instead drives that
   chapter's draw progress directly — the page itself does not move while a
   segment is drawing. Once fully drawn, it holds for a short pause, then
   releases the capture so normal scrolling resumes and the next section
   slides up (which will arm the next chapter in turn once IT becomes
   topmost). This deliberately mirrors the globe's own lock/capture/release
   shape rather than inventing a different interaction language for it.

   Coexisting with the globe's gate (frozen, not touched, per
   js/particle-globe.js, and only present on Home anyway): a chapter is
   only allowed to arm+lock when document.documentElement.style.overflow
   is NOT already 'hidden' from something else. weOwnLock tracks whether
   *this* file is the one currently holding it, so its own release never
   clobbers a lock some other script still needs (or vice versa). */
(function(){
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp01(v){ return Math.min(Math.max(v, 0), 1); }
  function remap(v, a, b){ return clamp01((v - a) / (b - a)); }
  // main.js's updateStackOffsets() sets --pin-top to a NEGATIVE offset on
  // any .stack section taller than one viewport, so that section scrolls
  // fully into view before it holds — meaning it settles at rect.top:
  // pinTop, not rect.top:0. A hardcoded "<=2" check for "has this section
  // arrived" is only correct for sections short enough that pinTop is 0;
  // for a taller one it's satisfied while the section is still mid-way
  // through scrolling its own content into view, arming/locking too early
  // and freezing it there until the section finishes settling on its own.
  function pinTopPx(el){
    var v = parseFloat(getComputedStyle(el).getPropertyValue('--pin-top'));
    return isNaN(v) ? 0 : v;
  }
  // 0 while el is still fully below the viewport, 1 once its top has
  // reached the viewport top — how far a section has slid up so far.
  function incomingRaw(el){
    var vh = window.innerHeight || 800;
    var top = el.getBoundingClientRect().top;
    return clamp01(1 - (top / vh));
  }
  function drawPath(path, progress){
    if (!path) return;
    path.style.strokeDashoffset = path._len * (1 - clamp01(progress));
  }
  function makeChapter(hostEl, nextEl, onDraw){
    return { hostEl: hostEl, nextEl: nextEl, onDraw: onDraw, state: 'pre', target: 0, displayed: 0, pauseSince: null, armedSince: null };
  }

  var weOwnLock = false;
  function lock(){ weOwnLock = true; document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; }
  function unlock(){ weOwnLock = false; document.documentElement.style.overflow = ''; document.body.style.overflow = ''; }
  function lockedByOther(){ return document.documentElement.style.overflow === 'hidden' && !weOwnLock; }

  var DRAW_DISTANCE = 480;   // wheel-delta-equivalent px to fully draw a chapter
  var PAUSE_MS = 550;        // rest beat once fully drawn, before releasing
  var SMOOTH = 0.15;         // per-frame lerp factor from displayed toward target
  var IDLE_TIMEOUT_MS = 4000; // see armedSince handling in renderLoop below

  // Wires one page's chapter sequence into the engine. allPaths is every
  // SVG path used across that page's chapters (for the one-time
  // getTotalLength()/dasharray setup); onPassiveScroll is an optional
  // hook for anything driven by plain scroll position rather than the
  // capture engine (Home's seam bar + CTA progress bar) — pass null if
  // a page has nothing like that.
  function initLineSequence(chapters, allPaths, onPassiveScroll){
    // getTotalLength() is in the SVG's own user-coordinate space (the
    // 0-100 percentage viewBox), which stays fixed regardless of the
    // section's actual rendered pixel size — this only needs to run once.
    allPaths.forEach(function(p){
      if (!p) return;
      var len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = reduceMotion ? 0 : len;
      p._len = len;
    });

    if (reduceMotion){
      // Scroll-jacking is itself a motion pattern reduced-motion users are
      // opting out of — show the finished state plainly instead of
      // animating or locking anything.
      if (onPassiveScroll) onPassiveScroll(true);
      return;
    }

    var activeIndex = 0;

    function beginPause(chapter){
      chapter.state = 'paused';
      chapter.pauseSince = null; // set once `displayed` actually catches up to target, in the render loop
    }

    // Unconditional escape hatch: a chapter can be left 'armed' with
    // partial progress indefinitely if the user stops mid-gesture (got
    // distracted, switched to dragging the scrollbar instead of
    // continuing to scroll) — nothing else here ever resolves that on its
    // own, so overflow:hidden stays applied and every scroll method,
    // including Home/End and the scrollbar itself, stops working.
    // Home/End unambiguously mean "take me to an extreme", so they always
    // resolve every chapter outright and unlock, regardless of whatever
    // state things were in.
    function resolveAll(toEnd){
      chapters.forEach(function(c){
        c.target = toEnd ? 1 : 0;
        c.displayed = c.target;
        c.onDraw(c.displayed);
        c.state = toEnd ? 'done' : 'pre';
      });
      activeIndex = toEnd ? chapters.length : 0;
      unlock();
    }

    // amount is a signed px-equivalent delta: positive advances the
    // current chapter, negative reverses it (interrupting a pause if one
    // is running), and reversing all the way back to 0 un-arms and
    // releases the lock so a change-of-mind scroll back up never leaves
    // the user stuck. This only ever touches target — the render loop
    // below is what moves displayed (and hence the actual line) smoothly.
    function drive(amount){
      var chapter = chapters[activeIndex];

      // Reversing back past an already-finished chapter: only hand
      // control back to it once its OWN successor section has retreated
      // almost all the way back to the very start of its slide-in
      // (incomingRaw≈0) — not the instant you nudge backward anywhere in
      // the free-scroll gap that follows it. A short section stays
      // topmost (rect.top:0) for the ENTIRE time the next one is sliding
      // up over it — that slide is a normal in-flow scroll rising past a
      // higher z-index sticky panel, not the next section itself being
      // sticky yet — so hostEl.rect.top can't tell "just barely reversed"
      // from "deep into the gap"; only the successor's own incoming
      // position can.
      // For the very last chapter on a page there's no successor to check
      // (nextEl is null) — fall back to the chapter's OWN settle position
      // instead, mirroring the forward arm-check, so reversing back into
      // it from whatever follows (footer, or nothing) still works instead
      // of silently never re-arming.
      if (amount < 0 && activeIndex > 0 && (!chapter || chapter.state === 'pre') && !lockedByOther()){
        var prev = chapters[activeIndex - 1];
        var readyToReenter = prev.nextEl
          ? incomingRaw(prev.nextEl) <= 0.02
          : prev.hostEl.getBoundingClientRect().top <= pinTopPx(prev.hostEl) + 2;
        if (prev.target > 0 && readyToReenter){
          activeIndex--;
          chapter = prev;
          chapter.state = 'armed';
          if (!weOwnLock) lock();
        }
      }
      if (!chapter) return false; // every chapter done — nothing left to capture

      if (chapter.state === 'pre'){
        if (lockedByOther()) return false;               // defer to another script's own gate
        var armThreshold = pinTopPx(chapter.hostEl) + 2;
        var rectTop = chapter.hostEl.getBoundingClientRect().top;
        var remaining = rectTop - armThreshold;
        if (remaining > 0){
          // Not fully settled yet. The arm-check only ever looks at
          // rect.top AFTER a scroll already happened — a single wheel or
          // trackpad tick can easily be larger than the remaining
          // distance to the settle point, and letting that tick's full
          // native scroll through would overshoot past it by however
          // much extra the tick provided, freezing the section further
          // scrolled than its true resting position for the whole locked
          // duration (the settled content, e.g. a heading, ends up
          // partway behind the fixed nav). Applying only the exact
          // remainder here — and preventing the rest of this same tick's
          // native scroll — means arming always lands precisely at the
          // settle point regardless of how large the triggering gesture was.
          if (amount <= 0) return false;
          if (amount < remaining) return false; // this tick alone doesn't reach it yet
          window.scrollBy(0, remaining);
        } else if (amount <= 0){
          return false;
        }
        chapter.state = 'armed';
        lock();
      }

      if (chapter.state === 'paused'){
        if (amount >= 0) return true;   // holding the pause; still capture the gesture
        chapter.state = 'armed';
      }

      // Any live input while armed resets the idle clock the renderLoop
      // watches below — only genuine silence counts as "stuck".
      if (chapter.state === 'armed') chapter.armedSince = performance.now();

      chapter.target = clamp01(chapter.target + amount / DRAW_DISTANCE);

      if (chapter.target <= 0){
        chapter.state = 'pre';
        chapter.armedSince = null;
        unlock();
        return false; // let this gesture fall through to a normal scroll
      }
      if (chapter.target >= 1 && chapter.state === 'armed'){
        beginPause(chapter);
      }
      return true;
    }

    // Runs continuously (not just on input events) so displayed keeps
    // easing toward target — and keeps easing for the few frames right
    // after a wheel/touch burst ends, which is exactly the part a purely
    // event-driven update would miss. The 'paused' → 'done' → unlock
    // handoff is timed off here too, not off a fixed setTimeout started
    // when target hit 1 — target reaching 1 only means input says the
    // segment SHOULD be fully drawn, displayed is what's actually on
    // screen, and a timer racing the lerp is exactly what let an earlier
    // version of one handoff fire before the line visually arrived. Only
    // once displayed has genuinely caught up does the pause clock start.
    function renderLoop(){
      chapters.forEach(function(chapter){
        // Self-healing timeout: 'paused' already resolves on its own via
        // pauseSince below, but 'armed' does not — if the user stops
        // scrolling mid-gesture (distracted, switched to the scrollbar,
        // whatever) with the section only partly drawn, nothing else here
        // ever moves target again, so overflow:hidden would stay applied
        // forever with no forward AND no backward scroll working. Rather
        // than depend on the user knowing Home/End is an escape hatch,
        // just finish the draw on its own after a few seconds of true
        // silence — armedSince is reset on every live input in drive()
        // above, so this only fires once input has genuinely stopped.
        if (chapter.state === 'armed' && chapter.armedSince != null
            && performance.now() - chapter.armedSince >= IDLE_TIMEOUT_MS){
          chapter.target = 1;
          beginPause(chapter);
        }

        chapter.displayed += (chapter.target - chapter.displayed) * SMOOTH;
        if (Math.abs(chapter.target - chapter.displayed) < 0.0005) chapter.displayed = chapter.target;
        chapter.onDraw(chapter.displayed);

        if (chapter.state === 'paused' && chapter.displayed >= chapter.target - 0.0005){
          if (chapter.pauseSince == null) chapter.pauseSince = performance.now();
          else if (performance.now() - chapter.pauseSince >= PAUSE_MS){
            chapter.state = 'done';
            unlock();
            activeIndex++;
          }
        }
      });
      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    window.addEventListener('wheel', function(e){
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // let horizontal gestures through
      if (drive(e.deltaY)) e.preventDefault();
    }, { passive: false });

    var touchY = null;
    window.addEventListener('touchstart', function(e){ touchY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', function(e){
      if (touchY == null) return;
      var dy = touchY - e.touches[0].clientY;
      touchY = e.touches[0].clientY;
      if (drive(dy)) e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', function(e){
      if (e.key === 'Home' || e.key === 'End'){
        resolveAll(e.key === 'End');
        return; // don't preventDefault — let the native jump proceed
      }
      // Don't hijack these keys from whatever's actually focused — Space
      // on a focused button/link should activate it, not get eaten here.
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
      var down = e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Spacebar';
      var up = e.key === 'ArrowUp' || e.key === 'PageUp';
      if (!down && !up) return;
      if (drive(down ? 80 : -80)) e.preventDefault();
    });

    if (onPassiveScroll){
      var ticking = false;
      window.addEventListener('scroll', function(){
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function(){ onPassiveScroll(false); ticking = false; });
      }, { passive: true });
      onPassiveScroll(false);
    }
  }

  // ── Home wiring ──────────────────────────────────────────────────────
  (function(){
    var svg1 = document.getElementById('pinStripe1');
    var svg2 = document.getElementById('pinStripe2');
    var svg3 = document.getElementById('pinStripe3');
    var seamBar = document.getElementById('pinStripeSeamBar');
    var ctaBar = document.getElementById('pinStripeCtaBar');
    if (!svg1 || !svg2 || !svg3 || !seamBar || !ctaBar) return;

    var statsEl = document.getElementById('stats');
    var valueTeaserEl = document.getElementById('value-teaser');
    var networkTeaserEl = document.getElementById('network-teaser');
    var teasersEl = document.getElementById('teasers');
    var ctaEl = document.getElementById('cta');
    if (!statsEl || !valueTeaserEl || !networkTeaserEl || !teasersEl || !ctaEl) return;

    var path1 = svg1.querySelector('.pin-stripe-path');
    var path2 = svg2.querySelector('.pin-stripe-path');
    var path3Main = document.getElementById('pinStripe3Main');
    var path3SpillL = document.getElementById('pinStripe3SpillL');
    var path3SpillR = document.getElementById('pinStripe3SpillR');

    var chapters = [
      makeChapter(statsEl, valueTeaserEl, function(p){ drawPath(path1, p); }),
      makeChapter(valueTeaserEl, networkTeaserEl, function(p){ drawPath(path2, p); }),
      // Main line draws first (right edge → centre → down), then the two
      // spill paths reveal TOGETHER off the same remapped value — growing
      // left and right simultaneously from the centre, not one side then
      // the other. They're separate elements (SVG can't branch one path
      // in two directions from an interior point) but stroke-linecap:
      // butt on both (see .pin-stripe-path--butt) keeps the shared joint
      // from reading as a seam — only the main path's own round end-cap
      // shows.
      makeChapter(networkTeaserEl, teasersEl, function(p){
        drawPath(path3Main, remap(p, 0, 0.5));
        var spillP = remap(p, 0.5, 1);
        drawPath(path3SpillL, spillP);
        drawPath(path3SpillR, spillP);
      })
    ];

    function onPassiveScroll(forceStatic){
      if (forceStatic){
        seamBar.classList.add('is-visible');
        ctaBar.classList.add('is-filling');
        return;
      }
      // Delayed past the very start of #teasers' slide-in (not just >0) —
      // chapter 3's own bottom bar sits right at #network-teaser's bottom
      // edge, so fading this in the instant #teasers begins rising put it
      // visible just a few pixels above that still-visible static bar:
      // two lines at once for a moment. Waiting until #teasers has risen
      // enough to have actually covered that area first means there's
      // nothing left showing through underneath by the time this fades in.
      var teasersRaw = incomingRaw(teasersEl);
      seamBar.classList.toggle('is-visible', teasersRaw > 0.08 && teasersRaw < 0.97);

      // Continuous toggle, not a one-shot latch — scrolling back away
      // from the true bottom un-fills it symmetrically. There's a
      // site-footer after #cta, so #cta reaching rect.top:0 is NOT the
      // bottom of the page — this has to check the real document bottom.
      var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
      ctaBar.classList.toggle('is-filling', atBottom);
    }

    initLineSequence(chapters, [path1, path2, path3Main, path3SpillL, path3SpillR], onPassiveScroll);
  })();

  // ── About wiring ─────────────────────────────────────────────────────
  (function(){
    var svgA = document.getElementById('pinStripeAboutA');
    var svgB = document.getElementById('pinStripeAboutB');
    var svgC = document.getElementById('pinStripeAboutC');
    var seamBar = document.getElementById('pinStripeAboutSeamBar');
    if (!svgA || !svgB || !svgC || !seamBar) return;

    var storyEl = document.getElementById('story');
    var valuesEl = document.getElementById('values');
    var capabilitiesEl = document.getElementById('capabilities');
    var lincorEl = document.getElementById('lincor');
    if (!storyEl || !valuesEl || !capabilitiesEl || !lincorEl) return;

    var pathA = svgA.querySelector('.pin-stripe-path');
    var pathB = svgB.querySelector('.pin-stripe-path');
    var pathC = svgC.querySelector('.pin-stripe-path');

    var chapters = [
      makeChapter(storyEl, valuesEl, function(p){ drawPath(pathA, p); }),
      // Chapter B is just the bar itself (right edge → left edge), not an
      // entry-plus-turn shape — it's what "reintroduces" chapter A's line
      // (which exited #story off the right edge) as a progress-bar sweep
      // rather than a curved path, landing at the seam above #capabilities.
      makeChapter(valuesEl, capabilitiesEl, function(p){ drawPath(pathB, p); }),
      // Last chapter on the page — nextEl is null since there's no
      // further section to gate reverse-reentry on past this one.
      makeChapter(lincorEl, null, function(p){ drawPath(pathC, p); })
    ];

    // Same seam-bar pattern as Home: lives inside #capabilities, pinned
    // to ITS OWN top edge, so it rides along for free as #capabilities
    // physically slides up over #values once chapter B's bar has fully
    // filled. Delayed past the very start of the slide-in (not just >0)
    // for the same reason as Home's — chapter B's own bar sits right at
    // #values' bottom edge, so fading this in immediately would show two
    // lines a few pixels apart for a moment.
    function onPassiveScroll(forceStatic){
      if (forceStatic){ seamBar.classList.add('is-visible'); return; }
      // Explicit completion check, not just the scroll-position delay
      // below — chapters[1] is chapter B (#values); as long as it hasn't
      // reached 'done' this can never show, regardless of what incomingRaw
      // happens to read (belt-and-suspenders against #capabilities ever
      // appearing to move before chapter B's bar has actually finished).
      if (chapters[1].state !== 'done') { seamBar.classList.remove('is-visible'); return; }
      var raw = incomingRaw(capabilitiesEl);
      seamBar.classList.toggle('is-visible', raw > 0.08 && raw < 0.97);
    }

    initLineSequence(chapters, [pathA, pathB, pathC], onPassiveScroll);
  })();

  // ── Network wiring ───────────────────────────────────────────────────
  (function(){
    var svgA = document.getElementById('pinStripeNetA');
    var svgB = document.getElementById('pinStripeNetB');
    var svgC = document.getElementById('pinStripeNetC');
    var svgD = document.getElementById('pinStripeNetD');
    if (!svgA || !svgB || !svgC || !svgD) return;

    var coverEl = document.getElementById('cover');
    var footprintEl = document.getElementById('footprint');
    var whereWeWorkEl = document.getElementById('where-we-work');
    var spotlightEl = document.getElementById('spotlight');
    if (!coverEl || !footprintEl || !whereWeWorkEl || !spotlightEl) return;

    var pathA = svgA.querySelector('.pin-stripe-path');
    var pathB = svgB.querySelector('.pin-stripe-path');
    var pathC = svgC.querySelector('.pin-stripe-path');
    var pathD = svgD.querySelector('.pin-stripe-path');

    var chapters = [
      // Straight vertical line, no turn — runs the full height of #cover
      // behind the hero-feature "Where we operate" list block, continuing
      // at the same x into chapter B's entry at the top of #footprint.
      makeChapter(coverEl, footprintEl, function(p){ drawPath(pathA, p); }),
      makeChapter(footprintEl, whereWeWorkEl, function(p){ drawPath(pathB, p); }),
      // Fresh entry from the right (not a continuation of B's exit point)
      // — same pattern as About's chapter C re-entering from a different
      // edge. Runs down to near the very bottom so it continues visually
      // into chapter D's top-centre entry on #spotlight.
      makeChapter(whereWeWorkEl, spotlightEl, function(p){ drawPath(pathC, p); }),
      // Last chapter on the page — nextEl null, nothing further to gate
      // reverse-reentry on.
      makeChapter(spotlightEl, null, function(p){ drawPath(pathD, p); })
    ];

    initLineSequence(chapters, [pathA, pathB, pathC, pathD], null);
  })();

  // ── Contact wiring ───────────────────────────────────────────────────
  // No preceding captured chapter on this page, just a plain seam bar
  // riding along as #faq slides up over #contact — same visual language
  // as the Home/About seam bars, but with nothing upstream to wait on, so
  // this skips initLineSequence()/the whole capture engine entirely and
  // is just a standalone scroll-position toggle.
  (function(){
    var seamBar = document.getElementById('pinStripeContactSeamBar');
    var faqEl = document.getElementById('faq');
    if (!seamBar || !faqEl) return;

    if (reduceMotion){
      seamBar.classList.add('is-visible');
      return;
    }

    function update(){
      var raw = incomingRaw(faqEl);
      seamBar.classList.toggle('is-visible', raw > 0.01 && raw < 0.97);
    }
    var ticking = false;
    window.addEventListener('scroll', function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){ update(); ticking = false; });
    }, { passive: true });
    update();
  })();
})();
