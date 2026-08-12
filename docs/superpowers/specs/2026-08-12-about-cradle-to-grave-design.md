# Nexus Global — About page: Cradle To Grave

**Date:** 2026-08-12
**Status:** Approved design, ready for implementation planning
**Scope:** `about.html` sections 2–6 only. No other page changes.

---

## 1. Context

`/about` currently runs five sections, every one of them a `.stack` panel: each pins at the
top of the viewport and holds while the next slides up to cover it. The effect is deliberate
and site-wide, but on this page it makes five distinct blocks read as five separate screens
being flicked through rather than one argument being made.

The page also has no material on Cradle to Grave, which is a named Nexus Global service and
currently absent from the site entirely.

Two recent commits (`312c104`, `baf087e`) removed measured scroll fatigue and a pinned-panel
jump caused by that same `.stack` machinery. Removing four pinned panels from this page moves
in the same direction rather than against it.

## 2. Goals

- Sections 2–6 read as one continuous off-white field, scrolled through rather than stepped
  between.
- Introduce Cradle to Grave as the page's substantive middle: a title statement, an
  image-and-text block, and the five lifecycle stages.
- Preserve the hero and the Lincor section exactly as they are.
- Give the capability-card section a real heading for search and AI without adding a visible one.

## 3. Non-goals

- No change to `index.html`, `network.html`, `contact.html` or `404.html`.
- No change to `#cover` (hero) or `#lincor`, including Lincor's push arrival.
- No change to the `.stack` system itself. It stays exactly as it is for every other page and
  for the two sections here that keep it.
- No redesign of the `.card` component.

## 4. Decisions taken (and what was rejected)

| Decision | Chosen | Rejected |
|---|---|---|
| Continuity mechanism | Separate `.page` sections, `.stack` removed, shared `.page--flow` modifier | One giant `<section>` (destroys outline, ids, anchors); keeping `.stack` with matched colours (push still happens) |
| Section 2 treatment | Content unchanged, joins the flow, takes off-white | Left fully untouched; kept `#ededed` |
| Cradle to Grave image | `attivo_freestand_bath_mixer__black_camera_png.jpg` | `our-story-poster.webp` (duplicate on same page); `factory-tap.jpg` |
| Stage row anatomy | Number + name + one static description line | Expandable `<details>`; number + arrow only |
| "Two Commitments" copy | Deleted | Kept below; folded into C2G intro |
| Typing behaviour | Types once on entry, stays complete | Scrubbed to scroll; word-by-word cascade |
| Motif placement | Authored variation, deterministic | Randomised per load; strict alternation |
| Capability cards | Current size, own full section, `.sr-only` heading | Wider container; two-across |

## 5. Page structure

| # | id | Classes | Change |
|---|---|---|---|
| 1 | `#cover` | `page page--dark stack` | none |
| 2 | `#story` | `page page--flow` | drops `.stack`; content identical |
| 3 | `#cradle` | `page page--flow` | new |
| 4 | `#lifecycle` | `page page--flow` | new |
| 5 | `#stages` | `page page--flow` | new |
| 6 | `#capabilities` | `page page--flow` | cards kept; visible heading becomes `.sr-only` |
| 7 | `#lincor` | `page page--dark stack` | none |

`#values` is removed from the markup entirely.

Three rules in the `.stack` z-index ladder become dead and are removed with it:
`#story.stack{z-index:2}`, `#values.stack{z-index:3}` and `#capabilities.stack{z-index:4}`.
`#lincor.stack{z-index:5}` stays. The ladder is left with a gap (1, then 5), which is correct
and should not be renumbered — the stylesheet carries an explicit warning that these are global
id selectors grouped by page in comments only, so renumbering risks colliding with another
page's section.

## 6. Technical approach

### 6.1 `.page--flow`

A modifier on `.page` that:

- sets `background:var(--offwhite)`
- removes `border-bottom` (the hairline that would otherwise draw a rule between every block)
- replaces `min-height:100vh` with content-driven height plus generous block padding

The last point matters beyond aesthetics. `.page{min-height:100vh}` on five consecutive
non-pinned sections would reserve five viewports of height for content that does not fill
them, reintroducing exactly the empty-scroll problem `312c104` removed. Blocks size to their
content.

### 6.2 Why nav colour keeps working

`js/main.js` selects `document.querySelectorAll('.page[id]')` — **not** `.stack` — and picks
the last section whose top has scrolled past the nav. Every block here remains a `.page` with
an `id`, so the existing logic applies unchanged in normal flow: a later section's top passing
the nav still means it is the surface under the bar. No JavaScript change is required for the
nav.

### 6.3 Stacking

`.page` is `z-index:1`. `#cover` is sticky at `z-index:1` and stays pinned behind the whole
run; the flow sections come later in DOM order and therefore paint over it, which is what
`#story` already does today via `.stack`. `#lincor` keeps `z-index:5` and slides over the run
as before.

### 6.4 Effect on `--pin-top`

`updateStackOffsets` targets `.stack:not(#cover)`. After this change the only remaining match
on `/about` is `#lincor`, which fits one viewport and therefore resolves to `0`. The page loses
four pinned panels and the scroll-position recalculation that went with them.

## 7. Block specifications

### 7.1 `#cradle` — title statement

Centred, generous vertical rhythm.

- `<h2>` — "Cradle To Grave", display scale
- `<p>` — "A Nexus Global Added Service", small-caps label treatment

### 7.2 `#lifecycle` — image and typed paragraph

Two columns. Image left, text right. Single column on narrow screens, image first.

**Image:** `attivo_freestand_bath_mixer__black_camera_png.jpg`, 3000×3500. A responsive
AVIF/WebP set is generated at 640/1024/1440 widths and delivered through `<picture>` with the
JPEG as fallback, following the pattern established for `.image-panel`. The 3000px original
is never served. `width`/`height` are declared to reserve the box.

**Alt text:** describes the image, since it is meaningful content rather than decoration —
a black freestanding bath and floor-mounted mixer tap in a concrete bathroom.

**Paragraph text (verbatim):**

> Cradle to Grave framework manages a brand across its full lifecycle, from initial concept
> and positioning through launch preparation, production oversight, post-launch support and
> ongoing growth. It ensures every stage stays aligned across strategy, design, quality,
> marketing and sales, giving clients a structured process that takes a product from idea to
> market and continues building the brand after launch.

**Typing behaviour.** The complete text is present in the DOM from first paint. The animation
reveals the already-present characters progressively; it never inserts or removes text nodes.
This matters for three reasons: crawlers and AI fetchers that do not execute JavaScript read
the paragraph whole; screen readers are not fed a string that mutates under them; and a failed
script leaves readable text rather than an empty column.

Triggered once when the block enters the viewport, via the existing `IntersectionObserver`
pattern, and unobserved after firing. Scrolling back up does not replay or reverse it.

Fallbacks, both of which show the paragraph complete and instantly:
- `prefers-reduced-motion: reduce`
- no JavaScript (`<noscript>` style block, matching the existing pattern in every page head)

### 7.3 `#stages` — five lifecycle rows

Single column. Five items do not divide cleanly into two columns.

Each row: number, stage name, one description line. Separated by thin rules.

| No. | Stage | Description |
|---|---|---|
| 01 | Ideation & proposal | Category review, concept direction and a costed proposal, so the range is defined and priced before anything is committed. |
| 02 | Launch pack development | Packaging, artwork, compliance labelling and the supporting collateral a retailer needs to range the product. |
| 03 | Production & quality oversight | Factory selection, pre-production sign-off, in-line checks and pre-shipment inspection against the approved sample. |
| 04 | Arrival & post-launch support | Freight, documentation and customs through to delivery, with in-market support once the product is on shelf. |
| 05 | Ongoing brand growth | Range extension, repeat production planning and performance review, so the brand keeps building after launch. |

Marked up as an ordered list. The sequence is the meaning, and `<ol>` states it without relying
on the rendered numerals.

### 7.4 `#capabilities` — capability cards

Six existing cards at their current size, unchanged, in their own full section.

No visible heading. A `.sr-only` `<h2>` carries the topic so the section is not headless in the
document outline — the same technique already used for the four page `<h1>`s. The existing
visible heading "A Lean, Senior Team" and its intro paragraph are removed.

## 8. Motifs

One `.motif` per block across the run, hand-placed: alternating sides, varying radius and
offset, positioned clear of text columns. Deterministic, so the distribution is reviewable in
a screenshot and cannot cluster or collide.

`.motif` strokes resolve from `--ink-10` on light surfaces, which already applies — no
per-block colour work needed.

## 9. Colour

`--offwhite:#FDFCF8` added to `:root` beside `--platinum:#ededed`. Consumed only by
`.page--flow`.

**Known risk:** the `.card` gradient was tuned against `#ededed`. Against `#FDFCF8` the cards
will read marginally warmer and lower in contrast. To be checked on render and reported; a
tweak is in scope only if it is visibly wrong.

## 10. SEO / AEO consequences

- Heading count on `/about` changes: "Two Commitments" (h2) and its two h3s are removed;
  "A Lean, Senior Team" (h2) becomes `.sr-only`; "Cradle To Grave" (h2) is added, plus the
  five stage names.
- Cradle to Grave is a named service currently absent from the entire site. It should be
  added to the `Organization` `knowsAbout` array and considered for the `hasOfferCatalog`.
- `dateModified` on the About `AboutPage` node updated to the implementation date.
- `/about` `lastmod` in `sitemap.xml` updated to match.
- The five stage names and descriptions are answer-ready passages and materially increase the
  page's extractable content.

## 11. Files touched

| File | Change |
|---|---|
| `about.html` | Sections 2–6 restructured; `#values` removed; schema `dateModified`; `<noscript>` addition for the typed block |
| `css/styles.css` | `--offwhite`; `.page--flow`; `#cradle`/`#lifecycle`/`#stages` block styles; typed-text styles; three dead `.stack` z-index rules removed (§5) |
| `js/main.js` | Typed-paragraph reveal, guarded by reduced-motion and IntersectionObserver support |
| `IMAGERY/` | Responsive set generated from the Attivo original |
| `sitemap.xml` | `/about` `lastmod` |

## 12. Verification

- Structural comparison before/after at 390×844, 768×1024 and 1440×900: document height,
  section offsets, heading inventory.
- Dead-scroll probe on `/about` at three handset sizes — expect none, and expect the total
  scroll distance to fall.
- `#cover` and `#lincor` rendered output unchanged.
- Nav colour and logo swap correct across every boundary in the new order, including the
  dark → off-white → dark transitions at both ends.
- Typed paragraph: full text present in DOM before JS runs; complete under reduced motion;
  complete with JS disabled.
- Responsive image: correct source chosen per width; no layout shift.
- JSON-LD still parses on all pages.

## 13. Open risks

1. **Card gradient against off-white** (§9). Check on render.
2. **`#story` colour change.** Agreed, but it is the one visible change to a section described
   as staying the same. Worth a deliberate look before sign-off.
3. **Typing rate.** Not specified. Start at a readable pace for a ~65-word paragraph and tune
   on review; too slow is worse than no animation, since it holds the reader on an unfinished
   sentence.
