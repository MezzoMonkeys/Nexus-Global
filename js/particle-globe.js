/* ── Particle globe on a full-screen stage ──────────────────────────────────
   ON LOAD  : dots start scattered OFF-SCREEN (full viewport) and spiral inward to
              assemble the dotted-continents globe, which emerges from the bottom.
   SETTLED  : slow spin + per-dot drift + twinkle + subtle cursor bulge.
   ON SCROLL: the globe first EXPLODES (expands outward), then its dots disperse back
              off-screen as the page scrolls down. All scroll-position driven. */
(function(){
  var stage = document.getElementById('heroGlobe');
  if (!stage || typeof THREE === 'undefined' || typeof d3 === 'undefined' || typeof topojson === 'undefined') return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = 2.0;
  var GRID_STEP = 1.1;
  var SPHERE_Y_HOME1 = -2.8;    // hero: pushed down so it emerges from the bottom
  var SPHERE_Y_HOME2 = 2.0;     // second panel: pushed up so it crests off the top,
                                 // clearing the vertical center before the copy begins
  var ASSEMBLE_SECONDS = 1.9;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 6.4;

  var renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
  catch (e) { return; }
  var PIX = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PIX);
  stage.appendChild(renderer.domElement);

  function resize(){
    var w = stage.clientWidth || window.innerWidth;
    var h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  requestAnimationFrame(resize);
  window.addEventListener('load', resize);
  window.addEventListener('resize', resize);

  var vertexShader = [
    'attribute float aRand;',
    'attribute vec3 aField;',
    'uniform float uTime;',
    'uniform float uSize;',
    'uniform float uPix;',
    'uniform float uAssemble;',   // load intro: 0 scattered -> 1 globe
    'uniform float uMorph;',      // scroll: 0 globe -> 1 dispersed (explodes first)
    'uniform float uSphereY;',
    'uniform mat3 uRot;',
    'uniform vec2 uMouse;',
    'uniform float uMouseStr;',
    'varying float vAlpha;',
    'void main(){',
    '  float t = uTime;',
    '  float w = sin(t * 0.8 + aRand * 6.2831) * 0.6 + sin(t * 1.7 + aRand * 21.0) * 0.4;',
    '  vec3 sphereP = position * (1.0 + w * 0.02);',
    // scroll phase 1 (0 -> 0.45): the globe expands outward = EXPLODE
    '  float expand = 1.0 + smoothstep(0.0, 0.45, uMorph) * 1.35;',
    '  vec3 sph = (uRot * sphereP) * expand;',
    '  sph.y += uSphereY;',
    // scattered field (off-screen), gently drifting, the start AND the dispersed end state
    '  vec3 fld = aField;',
    '  fld.x += sin(t * 0.3 + aRand * 10.0) * 0.16;',
    '  fld.y += cos(t * 0.25 + aRand * 7.0) * 0.16;',
    // scroll phase 2 (0.45 -> 1): dots leave the exploded shell and disperse to the field
    '  float disperse = smoothstep(0.45, 1.0, uMorph);',
    '  vec3 formed = mix(fld, sph, uAssemble);',   // load assemble
    '  vec3 pos = mix(formed, fld, disperse);',    // scroll disperse
    '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
    '  float depth = smoothstep(-11.0, -3.2, mv.z);',
    '  vec4 clip = projectionMatrix * mv;',
    '  vec2 ndc = clip.xy / clip.w;',
    '  float infl = uMouseStr * uAssemble * (1.0 - uMorph) * depth * smoothstep(0.20, 0.0, distance(ndc, uMouse));',
    '  pos += normalize(sphereP) * infl * 0.045;',
    '  mv = modelViewMatrix * vec4(pos, 1.0);',
    '  float tw = 0.55 + 0.45 * sin(t * 1.6 + aRand * 6.2831);',
    '  vAlpha = clamp((0.12 + 0.88 * depth) * tw + infl * 0.6, 0.0, 1.0);',
    '  vAlpha *= smoothstep(0.0, 0.12, uAssemble);',
    // Fade to fully invisible as dots finish dispersing, rather than leaving them
    // visible wherever they land — the explode/expand burst (0 -> 0.45) stays at
    // full brightness, then fades out through the disperse phase (0.45 -> 1) so
    // the end state is solid black, not a scattered star field.
    '  vAlpha *= (1.0 - disperse);',
    '  gl_PointSize = uSize * uPix * (0.5 + 0.9 * depth) * (1.0 + infl * 1.6);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var fragmentShader = [
    'precision mediump float;',
    'uniform vec3 uColor;',
    'varying float vAlpha;',
    'void main(){',
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  if (length(c) > 0.5) discard;',
    '  gl_FragColor = vec4(uColor, clamp(vAlpha, 0.0, 1.0));',
    '}'
  ].join('\n');

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(function(r){ return r.json(); })
    .then(function(world){
      var landF = topojson.feature(world, world.objects.countries);
      var MW = 720, MH = 360;
      var cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
      var cx = cv.getContext('2d');
      var proj = d3.geoEquirectangular().translate([MW/2, MH/2]).scale(MW/(2*Math.PI));
      var path = d3.geoPath(proj, cx);
      cx.fillStyle = '#000'; cx.fillRect(0, 0, MW, MH);
      cx.fillStyle = '#fff'; cx.beginPath(); path(landF); cx.fill();
      var mask = cx.getImageData(0, 0, MW, MH).data;
      function isLand(lon, lat){
        var p = proj([lon, lat]); if (!p) return false;
        var x = Math.round(p[0]), y = Math.round(p[1]);
        if (x < 0 || x >= MW || y < 0 || y >= MH) return false;
        return mask[(y * MW + x) * 4] > 100;
      }

      var positions = [], rands = [], field = [];
      for (var lat = -84; lat <= 84; lat += GRID_STEP){
        var lonStep = GRID_STEP / Math.max(0.25, Math.cos(lat * Math.PI/180));
        for (var lon = -180; lon <= 180; lon += lonStep){
          if (!isLand(lon, lat)) continue;
          var phi = (90 - lat) * Math.PI/180, theta = (lon + 180) * Math.PI/180;
          positions.push(-R * Math.sin(phi) * Math.cos(theta), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta));
          rands.push(Math.random());
          // scattered start/end position, pushed well beyond the viewport so dots enter/leave off-screen
          field.push((Math.random() - 0.5) * 13.0, (Math.random() - 0.5) * 10.0, (Math.random() - 0.5) * 6.0);
        }
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rands, 1));
      geo.setAttribute('aField', new THREE.Float32BufferAttribute(field, 3));

      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:     { value: 0 },
          uSize:     { value: 1.8 },
          uPix:      { value: PIX },
          uColor:    { value: new THREE.Color(0xededed) },
          uAssemble: { value: reduceMotion ? 1 : 0 },
          uMorph:    { value: 0 },
          uSphereY:  { value: SPHERE_Y_HOME1 },
          uRot:      { value: new THREE.Matrix3() },
          uMouse:    { value: new THREE.Vector2(0, 0) },
          uMouseStr: { value: 0 }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
      });

      scene.add(new THREE.Points(geo, mat));
      resize();

      var targetMouse = new THREE.Vector2(0, 0), targetStr = 0;
      if (!reduceMotion){
        window.addEventListener('mousemove', function(e){
          var rect = renderer.domElement.getBoundingClientRect();
          var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          var ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
          targetMouse.set(nx, ny);
          targetStr = 1;
        });
      }

      var rot4 = new THREE.Matrix4();
      var tilt = new THREE.Matrix4().makeRotationX(0.16);
      var angle = -1.15;
      var t0 = 0;

      // ── Scroll GATE ────────────────────────────────────────────────────────
      // Phase 1 ('pre'): free, native scroll from the hero into the second pinned
      // panel — the globe stays assembled and visible through both, nothing is
      // locked yet. Phase 2 ('armed'): once that second panel has fully taken over
      // the viewport, scroll locks and the next downward gesture fires a timed
      // explosion (page stays put); when it finishes, scrolling releases and the
      // page continues normally. Returning all the way back to the hero re-arms
      // phase 1 so the sequence can replay.
      var EXPLODE_SECONDS = 1.15;
      var STATS_VH = 1;   // fallback viewport-heights, used only if #stats can't be measured
      var gate = reduceMotion ? 'done' : 'pre';   // 'pre' | 'armed' | 'playing' | 'done'
      var morph = 0, explodeStart = 0;

      // The gate boundary is measured from the real DOM (#stats' actual document
      // position) rather than assumed to be exactly one viewport-height — #cover's
      // rendered height can shift slightly (e.g. once a swapped-in webfont settles
      // with different metrics), and an assumed boundary would drift out of sync
      // with where the section visually actually starts, reading as a layout jump.
      var releaseY = (window.innerHeight || 800) * STATS_VH;
      function computeReleaseY(){
        var statsEl = document.getElementById('stats');
        if (statsEl) releaseY = statsEl.getBoundingClientRect().top + (window.pageYOffset || 0);
      }
      computeReleaseY();
      window.addEventListener('resize', computeReleaseY);
      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(computeReleaseY); }

      function lockScroll(){ document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; }
      function unlockScroll(){ document.documentElement.style.overflow = ''; document.body.style.overflow = ''; }

      if (!reduceMotion){
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        window.scrollTo(0, 0);
      }

      function armGate(){
        if (gate !== 'pre') return;
        gate = 'armed';
        lockScroll();
      }
      // Scrolling back up while armed releases the lock and returns to free-scroll,
      // rather than swallowing the gesture with nowhere to go — otherwise a user who
      // changes their mind and tries to scroll back to the hero reads as stuck/glitchy.
      function unarmGate(){
        if (gate !== 'armed') return;
        gate = 'pre';
        unlockScroll();
      }
      function fireExplode(){
        if (gate !== 'armed') return;
        if (mat.uniforms.uAssemble.value < 0.9) return;   // ignore until the globe has assembled
        gate = 'playing';
        explodeStart = 0;
      }
      function releaseGate(){ gate = 'done'; unlockScroll(); }

      if (!reduceMotion){
        // Phase 1: let the page scroll natively from the hero into the second panel;
        // once its top has reached the top of the viewport, arm — at WHATEVER scrollY
        // that happens to be, no forced snap. #stats holds its own stuck/visible phase
        // for roughly a further viewport-height beyond this point (its own height),
        // so a scroll gesture landing a little past the boundary is still safely
        // within that window; forcing scrollY back to an exact value here previously
        // showed up as a visible downward jump whenever a gesture overshot it.
        window.addEventListener('scroll', function(){
          if (gate !== 'pre') return;
          computeReleaseY();   // keep the boundary in sync with the live DOM on every
                                // tick, not just at load/resize/fonts-ready — if anything
                                // else nudges #stats' position mid-scroll, the threshold
                                // never goes stale against it.
          var y = window.pageYOffset || 0;
          if (y >= releaseY - 2){
            armGate();
          }
        }, { passive: true });
        // Phase 2: while gated, scroll inputs are swallowed; a downward intent fires the
        // explosion, an upward intent un-arms and returns control to free scroll. Blocked
        // for 'playing' too, not just 'armed' — otherwise a fast/continuous gesture that
        // keeps sending events through the explosion itself could leak scroll through.
        window.addEventListener('wheel', function(e){
          if (gate !== 'armed' && gate !== 'playing') return;
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // let horizontal gestures (the card-row scroller) through
          e.preventDefault();
          if (gate === 'armed'){ if (e.deltaY > 0) fireExplode(); else if (e.deltaY < 0) unarmGate(); }
        }, { passive: false });
        var tX = null, tY = null, tAxis = null;
        window.addEventListener('touchstart', function(e){
          if (gate !== 'armed') return;
          tX = e.touches[0].clientX; tY = e.touches[0].clientY; tAxis = null;
        }, { passive: true });
        window.addEventListener('touchmove', function(e){
          if (gate !== 'armed' && gate !== 'playing') return;
          if (tX == null || tY == null) return;
          var dx = tX - e.touches[0].clientX, dy = tY - e.touches[0].clientY;
          if (!tAxis) tAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (tAxis === 'x') return;   // let horizontal swipes (the card-row scroller) through
          e.preventDefault();
          if (gate === 'armed'){ if (dy > 12) fireExplode(); else if (dy < -12) unarmGate(); }
        }, { passive: false });
        window.addEventListener('keydown', function(e){
          if (gate === 'playing' && (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'PageUp')){ e.preventDefault(); return; }
          if (gate !== 'armed') return;
          if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Spacebar'){ e.preventDefault(); fireExplode(); }
          else if (e.key === 'ArrowUp' || e.key === 'PageUp'){ e.preventDefault(); unarmGate(); }
        });
        // Re-arm once scrolled all the way back to the very top. Release happens at
        // releaseY, not near the top, so there's no risk of this instantly re-firing
        // right after a release the way it would if release and reset shared the same
        // position — safe to reset unconditionally, no "has the user gone far enough
        // away first" guard needed. Resets to 'pre' (free scroll), not straight back to
        // 'armed', so the hero-to-second-panel scroll replays too.
        window.addEventListener('scroll', function(){
          if (gate !== 'done') return;
          if ((window.pageYOffset || 0) <= 1) gate = 'pre';
        }, { passive: true });
        // Accessibility: never trap the skip-link.
        var skip = document.querySelector('.skip-link');
        if (skip) skip.addEventListener('click', releaseGate);
      }

      function easeInOut(p){ return p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2; }

      function animate(ts){
        var vh = window.innerHeight || 800;
        if ((window.pageYOffset || 0) < vh * 2.4 || gate !== 'done') {
          if (!t0) t0 = ts;
          var el = (ts - t0) / 1000;
          var a = reduceMotion ? 1 : Math.min(el / ASSEMBLE_SECONDS, 1);
          a = 1 - Math.pow(1 - a, 3);              // easeOutCubic
          if (!reduceMotion){
            mat.uniforms.uTime.value = el;
            mat.uniforms.uAssemble.value = a;
            if (gate === 'playing'){
              if (!explodeStart) explodeStart = ts;
              var p = Math.min((ts - explodeStart) / (EXPLODE_SECONDS * 1000), 1);
              morph = easeInOut(p);
              if (p >= 1) releaseGate();
            } else if (gate === 'armed' || gate === 'pre'){
              // Always stay fully assembled through 'pre'/'armed', on every pass —
              // whether this is the very first approach or a replay after a prior
              // explosion, position on the way TO the boundary should never itself
              // disperse the globe. Only reaching 'done' does that (below).
              morph += (0 - morph) * 0.09;
              if (morph < 0.001) morph = 0;
            } else {
              // 'done': scroll-scrubbed and fully reversible — dispersed at/past the
              // release boundary, reforming progressively as the user scrolls back up
              // above it, same as any other scroll-driven parallax. Only the explosion
              // itself (above) is time-based; this is purely position-driven.
              var y2 = window.pageYOffset || 0;
              morph = y2 >= releaseY ? 1 : Math.min(Math.max(1 - (releaseY - y2) / releaseY, 0), 1);
            }
            mat.uniforms.uMorph.value = morph;
            // Scroll-scrubbed reposition: as the page scrolls natively from the hero
            // into the second panel, the globe glides from bottom-anchored to
            // top-anchored in lockstep with the scroll, same as any normal parallax.
            var scrubP = Math.min(Math.max((window.pageYOffset || 0) / releaseY, 0), 1);
            mat.uniforms.uSphereY.value = SPHERE_Y_HOME1 + (SPHERE_Y_HOME2 - SPHERE_Y_HOME1) * scrubP;
            angle += (a < 1) ? (0.006 * (1 - a) + 0.0016) : 0.0016;   // spins faster while assembling (spiral)
            mat.uniforms.uMouse.value.lerp(targetMouse, 0.14);
            mat.uniforms.uMouseStr.value += (targetStr - mat.uniforms.uMouseStr.value) * 0.08;
          } else {
            mat.uniforms.uMorph.value = 0;
          }
          rot4.makeRotationY(angle); rot4.multiply(tilt);
          mat.uniforms.uRot.value.setFromMatrix4(rot4);
          renderer.render(scene, camera);
        }
        requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    })
    .catch(function(){ /* offline / blocked, no globe */ });
})();
