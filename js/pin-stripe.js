/* ── Pin-stripe scroll line ───────────────────────────────────────────────
   A single #660007 line threaded through specific sections on Home only —
   About and Network & Markets use plain static seam bars instead (see
   css/styles.css's .pin-stripe-bar--seam and each page's own markup;
   they need no JS at all, which is the point: a scroll-captured, path-
   drawing line responds to section height/content changes across
   viewports in ways that took a lot of iteration to get right even once,
   so it stayed exclusive to Home rather than multiplying that surface
   area across every page). Shared engine below, Home's own wiring (which
   elements, which paths) at the bottom.

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

  // Plain, capture-free "reached the bottom" fill bar for a page's last
  // section — no scroll-jacking, just a passive listener toggling a CSS
  // width transition. There's often a site-footer after the last section,
  // so the section's own rect.top:0 isn't "the bottom of the page"; this
  // checks the real document bottom instead. Continuous toggle, not a
  // one-shot latch, so scrolling back away from the bottom un-fills it.
  function wireBottomCtaBar(barEl){
    if (!barEl) return;
    if (reduceMotion){ barEl.classList.add('is-filling'); return; }
    function update(){
      var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
      barEl.classList.toggle('is-filling', atBottom);
    }
    var ticking = false;
    window.addEventListener('scroll', function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){ update(); ticking = false; });
    }, { passive: true });
    update();
  }

  // Rebuilds a path's `d` from a Y coordinate measured off a real content
  // element's bottom edge (as a % of hostEl's own height), for a path whose
  // entry/turn point needs to clear a block that reflows dramatically
  // across widths (e.g. a 3-column card grid that stacks to 1 column at
  // narrow viewports) rather than staying at some small, fairly stable
  // fraction of the section. Recomputes on load/resize; the ongoing render
  // loop already calls each chapter's onDraw (hence drawPath) every frame
  // regardless, so updating path._len here is enough for the next frame to
  // redraw at the new length — no need to also re-push current progress.
  function anchorPathToContent(path, hostEl, landmarkEl, buildD, extraPx, minPct, maxPct){
    if (!path || !hostEl || !landmarkEl) return;
    var hostRect = hostEl.getBoundingClientRect();
    if (hostRect.height <= 0) return;
    var landRect = landmarkEl.getBoundingClientRect();
    var pct = ((landRect.bottom - hostRect.top) + (extraPx || 0)) / hostRect.height * 100;
    pct = Math.min(Math.max(pct, minPct), maxPct);
    path.setAttribute('d', buildD(pct));
    var len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path._len = len;
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
    var ctaBar = document.getElementById('pinStripeCtaBar');
    if (!svg1 || !svg2 || !svg3 || !ctaBar) return;

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

    // path3Main enters behind #teasers' own .teaser-grid card row before
    // turning downward — at narrower widths that grid stacks from 3
    // columns to 1, making the row (and hence the safe entry height) much
    // taller, so a fixed percentage tuned for the 3-column layout ends up
    // entering mid-grid once it stacks. Anchor the entry to the grid's
    // real rendered bottom edge instead (same fix as Home's #stats line
    // needed earlier, moved here along with the chapter itself).
    var teaserGridEl = teasersEl.querySelector('.teaser-grid');
    function refreshPath3Entry(){
      anchorPathToContent(path3Main, teasersEl, teaserGridEl, function(entryY){
        return 'M 100 ' + entryY.toFixed(2) + ' L 54 ' + entryY.toFixed(2) +
          ' Q 50 ' + entryY.toFixed(2) + ' 50 ' + (entryY + 4).toFixed(2) + ' L 50 99';
      }, 30, 35, 93);
    }
    if (teaserGridEl){
      refreshPath3Entry();
      window.addEventListener('resize', refreshPath3Entry);
    }

    var chapters = [
      makeChapter(statsEl, valueTeaserEl, function(p){ drawPath(path1, p); }),
      makeChapter(valueTeaserEl, networkTeaserEl, function(p){ drawPath(path2, p); }),
      // Now hosted by #teasers instead of #network-teaser (which lost its
      // chapter entirely to make room for the image placeholder below its
      // text — that transition is a plain free scroll now, same as About/
      // Network elsewhere). Main line draws first (right edge → centre →
      // down), then the two spill paths reveal TOGETHER off the same
      // remapped value — growing left and right simultaneously from the
      // centre, not one side then the other. They're separate elements
      // (SVG can't branch one path in two directions from an interior
      // point) but stroke-linecap:butt on both (see .pin-stripe-path--butt)
      // keeps the shared joint from reading as a seam — only the main
      // path's own round end-cap shows. Its spill now marks the #teasers→
      // #cta seam, so there's no separate static seam bar needed here.
      makeChapter(teasersEl, ctaEl, function(p){
        drawPath(path3Main, remap(p, 0, 0.5));
        var spillP = remap(p, 0.5, 1);
        drawPath(path3SpillL, spillP);
        drawPath(path3SpillR, spillP);
      })
    ];

    function onPassiveScroll(forceStatic){
      if (forceStatic){
        ctaBar.classList.add('is-filling');
        return;
      }
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
  // Just the bottom-of-page fill bar in the last section (#lincor) — the
  // seam bars themselves are static (see about.html), no JS needed.
  (function(){
    wireBottomCtaBar(document.getElementById('pinStripeAboutCtaBar'));
  })();

  // ── Network wiring ───────────────────────────────────────────────────
  // Same: just the bottom-of-page fill bar in the last section (#spotlight).
  (function(){
    wireBottomCtaBar(document.getElementById('pinStripeNetCtaBar'));
  })();

  // ── Contact wiring ───────────────────────────────────────────────────
  // No preceding captured chapter on this page, just a plain seam bar
  // riding along as #faq slides up over #contact — same visual language
  // as the Home/About seam bars, but with nothing upstream to wait on, so
  // this skips initLineSequence()/the whole capture engine entirely and
  // is just a standalone scroll-position toggle. Plus the same
  // bottom-of-page fill bar as every other page's last section.
  (function(){
    wireBottomCtaBar(document.getElementById('pinStripeContactCtaBar'));

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
