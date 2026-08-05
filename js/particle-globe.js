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
  // Reset scroll to the top IMMEDIATELY, synchronously, before the world-map fetch
  // below even starts — that fetch can take anywhere from milliseconds to several
  // seconds, and this used to run only inside its .then() callback. A user who
  // started scrolling right away (a completely normal, deliberate scroll) could get
  // several sections deep before the fetch resolved, at which point this call fired
  // late and yanked scrollY back to 0 out from under them — precisely the "jump back
  // to the top mid-scroll" bug. Doing it here, before any async work, means it can
  // only ever run at the very start of the page visit, never mid-interaction.
  if (!reduceMotion){
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }
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

      // ── Scroll response ──────────────────────────────────────────────────────
      // Entirely position-driven. Scroll is never locked and no wheel/touch/key
      // event is ever swallowed — the page scrolls normally at all times.
      //
      // The explosion is still here. It lives in the shader, where uMorph runs a
      // two-stage exit: 0 -> 0.45 EXPANDS the globe outward (that's the burst) and
      // 0.45 -> 1 disperses the dots off-screen. Driving that uniform from scroll
      // position rather than from a timer means the burst is scrubbed by the user
      // and is fully reversible — scrolling back up reassembles the globe — where
      // before it was a fixed 1.15s animation played behind a scroll lock.
      //
      // SCROLL_SPAN is the distance the whole exit plays out over, and it also
      // normalises the vertical reposition below, so it is the denominator for the
      // entire effect rather than incidental bookkeeping. It used to be measured
      // from #stats' document position; that section no longer exists, and the hero
      // it belonged to is exactly one viewport tall, so viewport height is the
      // direct equivalent. Recomputed on resize because innerHeight shifts as
      // mobile browser chrome collapses.
      var scrollSpan = window.innerHeight || 800;
      window.addEventListener('resize', function(){ scrollSpan = window.innerHeight || 800; });

      function animate(ts){
        var vh = window.innerHeight || 800;
        if ((window.pageYOffset || 0) < vh * 2.4) {
          if (!t0) t0 = ts;
          var el = (ts - t0) / 1000;
          var a = reduceMotion ? 1 : Math.min(el / ASSEMBLE_SECONDS, 1);
          a = 1 - Math.pow(1 - a, 3);              // easeOutCubic
          if (!reduceMotion){
            mat.uniforms.uTime.value = el;
            mat.uniforms.uAssemble.value = a;
            var scrubP = Math.min(Math.max((window.pageYOffset || 0) / scrollSpan, 0), 1);
            // Scaled by the assemble progress so a scroll during the 1.9s intro
            // can't have the dots forming and flying apart at the same time. The
            // old scroll gate got this for free by pinning morph to 0 until it
            // released; multiplying by `a` is the equivalent without the lock, and
            // eases in rather than popping. easeOutCubic puts `a` past 0.87 within
            // half the intro, so the suppression window is brief.
            mat.uniforms.uMorph.value = scrubP * a;
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
