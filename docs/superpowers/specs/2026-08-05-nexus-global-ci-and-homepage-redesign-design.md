# Nexus Global — CI Shift & Homepage Restructure

**Date:** 2026-08-05
**Status:** Approved design, ready for implementation planning
**Scope:** Global colour system + nav across all pages; section layout restructure on `index.html` only

---

## 1. Context

The Nexus Global site is a four-page static site (`index`, `about`, `network`, `contact`) deployed on Vercel, sharing one 593-line stylesheet and three JavaScript files. Its current identity is platinum `#ededed` over near-black `#0a0a0a` with a deep maroon `#660007` accent used sparingly.

Two problems drive this work:

1. **The palette reads as too dark and has no ownable brand colour.** The maroon accent is used so sparingly, and is so close to black in value, that nothing on the page says "Nexus Global" chromatically.
2. **The homepage layout is card-and-text dominant.** It reads as a generic corporate template rather than a considered piece of design, and it under-uses photography.

## 2. Goals

- Establish Forest Grove green as an unmistakable brand colour, distributed systematically rather than dropped in one place.
- Lift the overall value of the site away from flat near-black toward a green-tinted dark.
- Restructure the homepage into an image-led, generously spaced layout with strong typographic moments.
- Preserve the particle globe hero, which is the site's most distinctive asset.

## 3. Non-goals

- **No layout changes to `about.html`, `network.html`, or `contact.html`.** They receive the new colour system and nav automatically through the shared stylesheet, and lose their scroll-line markup, but their section structure is untouched.
- **No adoption of the Arc reference's own identity.** Arc supplies layout and rhythm only. Its colours (bone/charcoal/deep-current), its Soehne/Inter typeface, its weight-300 display voice, and its 5px/32px radius pair are all explicitly rejected in favour of the existing Nexus Global brand.
- No new build tooling, framework, or dependency. The site stays hand-authored static HTML/CSS/JS.
- No backend. The contact form remains a `mailto:` builder.

## 4. Decisions

Every item below was explicitly decided during design and should not be re-litigated during implementation.

| # | Decision |
|---|---|
| D1 | The globe's scroll-locked particle explosion is **retired**. The globe still assembles on load and scroll-exits. |
| D2 | Light canvas stays **platinum `#ededed`**. Not white, not warmed. |
| D3 | Green is an **accent used relentlessly**, never a full section background. |
| D4 | Scope is **global CI + nav everywhere, layout restructure on the homepage only**. |
| D5 | The threaded scroll line (`pin-stripe.js`) is **deleted site-wide**, markup and all. |
| D6 | Section 2's animation is the **existing masked slide-up** (`.line-reveal`). No new animation code. |
| D7 | Section 3's pills use the **"More Than a Trading Company" card copy** (industry knowledge / market knowledge / full-spectrum reach). |
| D8 | The market trio is **China / South Africa / Africa**, drawn as **monoline map silhouettes**. Not flags. |
| D9 | Nav is **logo mark only on the left, glass link pill centred, nothing on the right**. Wordmark and tagline dropped. |
| D10 | The About headline is **"A Century of Combined Experience in China"** — "combined" is load-bearing for accuracy. |
| D11 | The closing section is **heading + single CTA over a full-bleed image**. No form, no contact details. |
| D12 | The hero display text becomes **"NEXUS GLOBAL"** carrying the kinetic fly-in; "Built to Be Partnered With" demotes to a tagline line. |
| D13 | Images for sections 3 and 6 are **AI-generated photographs**, committed locally. Sections 4 and 5 reuse existing photos. |
| D14 | Section 2's statement carries **green on the word "Trading"**. |

## 5. Colour system

### 5.1 Base tokens

Replace the values in the `:root` block of `css/styles.css`.

| Token | Value | Role |
|---|---|---|
| `--ink` | `#1c1c1e` | Body text, borders, separators. Was `#0a0a0a`. |
| `--platinum` | `#ededed` | Light canvas. Unchanged. |
| `--pine` | `#1c2b27` | **All dark section surfaces.** New. |
| `--graphite` | `#303033` | Secondary text, dividers. New. |
| `--slate` | `#676768` | Muted helper text, tertiary metadata. New. |
| `--smoke` | `#bfbfbf` | Shadow base behind elevated cards. New. |

The `--ink-*` alpha ramp regenerates against `rgb(28,28,30)`, and `--ink-rgb` becomes `28,28,30`.

**Add the missing `--plat-12` step.** `styles.css:107` references `var(--plat-12)` for the decorative arc motif's stroke on dark pages, but the ramp only defines `06/10/18/30/40/55/70/85`. The reference resolves to an invalid value, so that stroke currently renders unintentionally. Define `--plat-12: rgba(237,237,237,.12)`.

**Retire `--accent-glow-rgb`.** It holds a red glow value (`255,42,58`), is documented in the stylesheet as deliberately unused, and has no place in a green system.

### 5.2 The green ramp

Forest Grove `#0b835c` **cannot be used for small text on either background**:

- On platinum `#ededed`: **4.06:1** — fails the 4.5:1 AA requirement.
- On Pine Shadow `#1c2b27`: **3.03:1** — fails badly.

So one brand colour derives three accessible tones:

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--accent-deep` | `#075c40` | Green **text and icons on light surfaces** | 6.66:1 on platinum — AA |
| `--accent` | `#0b835c` | **The brand green.** Fills, surfaces, active states, selection | 4.82:1 with white text — AA |
| `--accent-light` | `#12b37d` | Green **text and strokes on dark surfaces** | 5.41:1 on Pine Shadow — AA |

**System rule:** `--accent` is a *surface and fill* colour. When green must be text or a fine stroke, use the variant matched to the background behind it. This rule is what keeps the green legible everywhere instead of only where it happens to work.

### 5.3 Green distribution

Fourteen touchpoints, so green recurs on every screen without becoming a background.

**Persistent chrome**
- Nav active-link indicator — `--accent` fill, platinum text
- Scroll-progress bar — `--accent`
- `::selection` — `--accent` background, platinum text
- `:focus-visible` outline — `--accent`, 2px
- Back-to-top button hover — `--accent`
- Arrow-button hover — `--accent`

**Content**
- Eyebrow labels — `--accent-deep` on light sections, `--accent-light` on dark
- Card icon strokes — same light/dark pairing
- Information-pill borders — `--accent`
- Map silhouette strokes — `--accent-light` (they sit on dark image overlays)
- The signature word **"Trading"** in section 2's statement — `--accent-deep`

**The signature-word treatment applies to section 2 only.** Headlines in sections 1, 4, 5 and 6 stay monochrome. Colouring a word in every headline turns a deliberate emphasis into a tic and cheapens the one place it matters most.

**Actions**
- `.btn-pill--fill` primary button — `--accent` fill, platinum text
- `.btn-pill` hover — converges on `--accent`, matching the pattern already used for the maroon
- Filled-button hover — `--accent-deep`, since a green button hovering to the same green would be a dead state

**Surfaces**
- `.page--dark` background — `--pine` instead of `--ink`
- `.globe-stage` background — `--pine`

Note the palette's own instruction that Ink Black must not become the primary CTA colour. Making `.btn-pill--fill` green satisfies this.

## 6. Navigation

### 6.1 Structure

`.nav` stops being the pill and becomes a transparent three-column grid. The frosted capsule moves inward to `.nav__links`.

```
◉                  ╭─────────────────────────────────╮
                   │ HOME  ABOUT  NETWORK  CONTACT   │
                   ╰─────────────────────────────────╯
logo mark            frosted glass                      (empty)
```

Markup changes in all four HTML files:
- Remove the `NEXUS GLOBAL` wordmark span from `.nav__brand`; the logo mark alone becomes the home link. Keep its `aria-label`.
- Remove the `INTERNATIONAL TRADING & PRIVATE LABEL` tagline.
- Remove the `.nav__right` wrapper. `#menuBtn` becomes a direct grid child with `justify-self: end`.

### 6.2 Glass treatment

`.nav__links` gains `backdrop-filter: blur(20px) saturate(140%)` (with `-webkit-` prefix), a low-alpha tint, a hairline border, `border-radius: 999px`, and its own padding.

The capsule tints to **match** the section behind it rather than contrast with it, reusing the existing `.nav.dark` toggle that `main.js` already drives from the in-view section:

| Context | Tint | Border | Link text |
|---|---|---|---|
| Over light sections | `--ink-06` | `--ink-10` | `--ink` |
| Over dark sections (`.nav.dark`) | `--plat-10` | `--plat-18` | `--platinum` |

The two stacked favicon images already cross-fade on the same `.dark` signal, so the logo mark keeps adapting with no new JavaScript.

### 6.3 Knock-on fixes

- **Mobile dropdown.** `.nav__menu` is hard-coded to `background: var(--platinum)` and would flash as a bright panel over the dark globe. Give it the same tonal switch.
- **Unbacked logo.** With a transparent bar the mark sits directly on whatever is behind it. Safe here — the globe is dark and every image section carries a darkening overlay — but a very bright replacement photograph later could reduce contrast. Documented, not fixed.

## 7. Homepage sections

Six sections, unchanged in count, so total scroll length does not grow.

Every section remains a `.page.stack` with `min-height: 100vh`, `position: sticky`, and an explicit ascending `z-index`, preserving the sticky panel-stacking behaviour. A full-bleed image background is as opaque as a flat colour, so photographic panels stack over each other using that mechanism rather than fighting it.

### Section IDs — collision warning

The stylesheet assigns `z-index` per section via **global** ID selectors (`#story.stack { z-index: 2 }`), grouped by page in comments but not scoped to a page in the CSS itself. Reusing an ID that another page already claims silently applies that page's `z-index` to the new section and corrupts the stacking order.

New homepage IDs, all verified free:

| Section | ID | `z-index` |
|---|---|---|
| 1 Globe hero | `#cover` | 1 |
| 2 Statement | `#statement` | 2 |
| 3 Advantage pills | `#advantage` | 3 |
| 4 Network & markets | `#network` | 4 |
| 5 About | `#about` | 5 |
| 6 Closing contact | `#contact-cta` | 6 |

`#cover` is intentionally shared across all pages — it is the hero everywhere, and `#cover.stack { z-index: 1 }` is correct for all of them.

Three IDs were rejected as already taken: **`#capabilities`** (About, `z-index: 4`), **`#contact`** (Contact, `z-index: 1`), and **`#values`** (About). Do not use them on the homepage. Verify with `grep -oE '^#[a-z-]+\.stack' css/styles.css` before introducing any further section ID.

### Section 1 — `#cover`, globe hero

Preserved, with the display text restructured into three tiers:

| Tier | Content | Treatment |
|---|---|---|
| Display | `NEXUS GLOBAL` | Archivo 900, carries the kinetic fly-in: "NEXUS" from the left, "GLOBAL" from the right |
| Tagline | `Built to Be Partnered With` | Mid-weight, roughly `clamp(18px, 2vw, 26px)` |
| Support | Existing sourcing paragraph | Unchanged |

The two-word display text suits the existing two-directional fly-in exactly. Globe stage background moves to `--pine`.

### Section 2 — `#statement`, the statement

Platinum, full viewport, type only. No image, no supporting paragraph — the statement stands alone, per the reference.

- "More Than a Trading Company" at roughly `clamp(48px, 8vw, 104px)`, Archivo 900, tracking `-0.02em`, max-width ~18ch
- The word **"Trading"** in `--accent-deep`
- Animated by the existing `.line-reveal` masked slide-up with its per-line stagger (D6)
- The current "Sourcing is table stakes…" paragraph **moves to section 3** rather than being deleted

### Section 3 — `#advantage`, pills over image

Full-bleed AI-generated photograph with a Pine Shadow darkening overlay. Type is never placed directly on a photograph.

Opens with the relocated "Sourcing is table stakes…" paragraph, then three information pills, each with its existing body copy beneath in a three-column grid:

- Deep industry knowledge
- Intimate market knowledge
- Full-spectrum reach

Pills are `999px` radius, translucent, `--accent` border, platinum text.

### Section 4 — `#network`, Our Network & Markets

Full-bleed `IMAGERY/our-network.jpg` with darkening overlay.

Heading "Our Network & Markets", then three market blocks, each pairing a monoline map silhouette stroked in `--accent-light` with copy adapted from `network.html`:

| Market | Copy source |
|---|---|
| China | Manufacturing and sourcing corridors — adapted from the OEM manufacturers and sourcing copy |
| South Africa | Anchor market — existing "South Africa (primary market)" copy |
| Africa | Growth markets — existing "Africa (growth markets)" copy |

CTA: **"Explore Our Network"** → `/network`. Singular, matching the page name, the existing link, and the "one network, many routes" framing.

**Silhouette generation.** `d3` and `topojson-client` are already loaded for the globe. Generate the three outlines from that same world topojson **offline**, then inline the resulting paths as static SVG. This yields geographically accurate shapes with no runtime cost and no dependency on a fetch succeeding.

### Section 5 — `#about`, About over image

Full-bleed `IMAGERY/our-story.jpg` with darkening overlay. Centred: **"A Century of Combined Experience in China"** (D10). CTA "Learn About Us" → `/about`.

### Section 6 — `#contact-cta`, closing

Full-bleed AI-generated lifestyle photograph with darkening overlay. Centred: "Ready to Put Our Network to Work in Your Category?" (existing copy). Single CTA "Get In Touch" → `/contact`.

### Sections removed

| Section | Content | CSS removed with it |
|---|---|---|
| `#stats` | "Why This Network Exists" + 3 compact cards | `.stats-inner`, `.stats-h`, the `#stats` height media queries, `#stats.stack` overrides |
| `#teasers` | "Why Partner With Us" + 3 teaser cards | `.teaser-grid`, `.teaser-card` and descendants |

Both are homepage-only, so their styles leave with them.

## 8. JavaScript changes

### 8.1 `js/pin-stripe.js` — delete

Delete the file. Remove its `<script>` tag and **all** `.pin-stripe-*` markup from all four HTML files, and all `.pin-stripe-*` rules from the stylesheet. Affected elements include `#pinStripe1/2/3`, the spill paths, and every `.pin-stripe-bar` variant across home, about, network and contact.

### 8.2 `js/particle-globe.js` — remove the scroll gate

Remove, per D1:

- The `gate` state machine and its `'pre' | 'armed' | 'playing' | 'done'` states
- `lockScroll()` / `unlockScroll()` and the `overflow: hidden` manipulation
- `armGate()`, `unarmGate()`, `fireExplode()`, `releaseGate()`
- `computeReleaseY()`, `releaseY`, `STATS_VH` — all of which measure the now-deleted `#stats`
- The `wheel`, `touchstart`, `touchmove` and `keydown` listeners that swallow scroll input
- The skip-link `releaseGate` workaround, which only existed because the gate could trap focus
- `EXPLODE_SECONDS`, `morph`, `explodeStart` and the explosion branch of the animation loop

**Care required in `animate()`.** The render condition at line 309 reads `if ((window.pageYOffset || 0) < vh * 2.4 || gate !== 'done')`. With `gate` gone this must reduce to the scroll-position check alone, keeping the existing behaviour of pausing render once the globe is well out of view. Verify the assemble animation and its `uAssemble` uniform still complete correctly, since the explosion previously gated on `uAssemble.value < 0.9`.

### 8.3 `js/main.js` — three updates

- `darkSections` array updates to the new homepage IDs.
- `document.querySelectorAll('.stack:not(#stats):not(#cover)')` simplifies to `.stack:not(#cover)`. `#stats` no longer exists; `#cover` stays excluded because it is designed to fit one viewport.
- The comment block at lines 27–34 explaining the `#stats` exclusion and its relationship to the scroll gate is now obsolete and should be rewritten to describe only the `#cover` exclusion.

Everything else — the reveal observer, nav indicator, spotlight tracking, magnetic buttons, back-to-top, hero kinetic scroll, count-up, enquiry form — is unchanged.

## 9. New CSS components

| Component | Purpose |
|---|---|
| `.statement` | Centred full-viewport type-only band (section 2) |
| `.image-panel` + `__bg` / `__overlay` / `__inner` | Full-bleed photographic section with darkening overlay |
| `.info-pill` | Green-bordered translucent pill (section 3) |
| `.market-row` | Map silhouette paired with market copy (section 4) |
| `.map-outline` | SVG stroke styling for the silhouettes |
| `.nav__links` (reworked) | The frosted glass capsule |

The existing `.image-bleed` component is a short punctuating band, not a full-viewport panel, so `.image-panel` is a new component rather than a modifier of it. `.image-bleed` remains in use elsewhere and is not touched.

## 10. Image assets

| Section | Asset | Source |
|---|---|---|
| 3 | Manufacturing / sourcing / container-port scene | AI-generated, committed to `IMAGERY/` |
| 4 | `IMAGERY/our-network.jpg` | Existing |
| 5 | `IMAGERY/our-story.jpg` | Existing |
| 6 | Retail / lifestyle scene | AI-generated, committed to `IMAGERY/` |

Generated images are committed as local files. No hotlinking to an external image host: a static site should not depend on a third party that can rate-limit, change URLs, or disappear. Both new images are placeholders the client will replace, so filenames should make that obvious.

All four need `loading="lazy"` except section 3's, which sits close enough to the fold to load eagerly, and descriptive `alt` text.

## 11. Accessibility

- Every green tone is contrast-checked against the surface it appears on (§5.2). The three-step ramp exists specifically to satisfy this.
- Removing the scroll gate is a net accessibility gain: it previously hijacked wheel, touch and keyboard input and needed a dedicated skip-link workaround to avoid trapping users.
- `prefers-reduced-motion` handling must survive on the hero kinetic lines and the `.line-reveal` statement.
- Decorative map silhouettes take `aria-hidden="true"`; the market name is conveyed by the adjacent heading text.
- The nav's `aria-label` on the logo link must be retained when the wordmark is removed, since the mark alone carries no accessible name.
- Every image needs meaningful `alt` text, not filler.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Removing the globe gate breaks the assemble animation, since the explosion shared its uniforms and render condition | Isolate the gate removal as its own change and verify the globe visually before touching layout |
| `backdrop-filter` over a WebGL canvas renders inconsistently on older Safari | Supply a solid low-alpha tint as the base so the capsule stays legible without the blur |
| Four stacked full-viewport photographs hurt load performance | Lazy-load below-fold images; keep generated assets reasonably compressed |
| Stripping scroll-line markup from three out-of-scope pages accidentally damages them | Deletion only, no restructuring; verify each page renders before and after |
| Green-on-green dead hover state on the primary button | Explicitly specified: filled buttons hover to `--accent-deep` |

## 13. Verification

Before the work is considered complete:

1. All four pages render with no console errors and no unstyled or broken elements.
2. The globe still assembles on load and scroll-exits; scroll is never locked, and wheel/touch/keyboard input is never swallowed.
3. The nav capsule tints correctly in both light and dark contexts, and the logo mark cross-fades between them.
4. No `.pin-stripe-*` selector or markup remains anywhere in the repository.
5. No reference to `#stats` or `#teasers` remains in any HTML, CSS or JS.
6. The masked slide-up fires on the section 2 statement.
7. Mobile behaviour holds at the 1080px and 780px breakpoints: links pill hides, menu button appears and opens.
8. `prefers-reduced-motion: reduce` suppresses the hero fly-in and the statement slide-up.
9. Every green text instance sits on the background its variant was chosen for.
