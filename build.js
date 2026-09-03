#!/usr/bin/env node
/**
 * Strips comments from the browser assets at deploy time.
 *
 * WHY THIS EXISTS
 * The stylesheet and main.js are heavily commented on purpose - the sticky/flow
 * layout and the scroll machinery are full of decisions that are not recoverable
 * from the code alone, and those comments are the only record of them. But the
 * site is served verbatim, so every visitor downloads the prose too: measured at
 * 60% of styles.css and 46% of main.js, which is ~27KB of brotli on a page whose
 * CSS is render-blocking.
 *
 * So the source stays authoritative and fully commented, and this runs on Vercel
 * between checkout and serve. Nothing in git is ever modified by a deploy -
 * Vercel builds from a fresh clone, so editing files in place here only touches
 * that throwaway copy.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * This is not a minifier. It does not rename, collapse whitespace, reorder, or
 * touch a single token of code. Comments are replaced by an equal number of
 * newlines, which means:
 *   - line numbers survive, so a stack trace from production still points at the
 *     right line of the source you have open;
 *   - no automatic-semicolon-insertion hazard, because no two lines are ever
 *     joined that were not joined before;
 *   - blank lines cost effectively nothing once compressed, which is where the
 *     saving is measured anyway.
 * The remaining ~30% saving a real minifier would add is not worth taking a
 * dependency and a class of silent-breakage bugs for on a four-page site.
 *
 * api/ is NOT processed. Those are serverless functions, not browser assets,
 * they are never on the critical path, and they are the only files here that
 * contain regex literals - the hardest thing for a comment scanner to get
 * right. No reason to take the risk for no gain.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const TARGETS = [
  { file: 'css/styles.css', kind: 'css' },
  { file: 'css/fonts.css', kind: 'css' },
  { file: 'js/main.js', kind: 'js' },
  { file: 'js/particle-globe.js', kind: 'js' },
];

// Every one of these must survive the strip. They are picked to be things whose
// loss would be invisible in a smoke test but fatal in production: the custom
// properties everything else resolves through, the sticky offset the pinned
// panels read, the entry points main.js hangs the page on.
const CANARIES = {
  'css/styles.css': ['--accent:', '--pin-top', '.stack{position:sticky', '.page--flow', '.surface::before'],
  'css/fonts.css': ['@font-face', 'font-display', 'unicode-range'],
  'js/main.js': ['IntersectionObserver', 'requestAnimationFrame', 'updateStackOffsets', 'addEventListener'],
  'js/particle-globe.js': ['gl_Position', 'function animate'],
};

/**
 * Refuse to run in a working copy.
 *
 * The header above says "nothing in git is ever modified by a deploy", and that
 * is true of a deploy - but this script edits files IN PLACE, so running it by
 * hand in a checkout does exactly what it does on Vercel: it deletes every
 * comment from four source files, permanently, in the tree you are working in.
 * That has now happened once, mid-edit, and only `git checkout --` on files
 * that happened to be committed got them back. Uncommitted work would have gone
 * with them.
 *
 * A CI environment variable is the discriminator because Vercel sets both VERCEL
 * and CI, and neither is set in a terminal. `--force` is there for anyone who
 * genuinely wants the in-place strip locally, and prints what it is about to do.
 */
const FORCED = process.argv.includes('--force');
if (!process.env.VERCEL && !process.env.CI && !FORCED) {
  console.error(
    'build.js rewrites css/ and js/ IN PLACE, stripping every comment.\n' +
    'That is correct on Vercel (throwaway clone) and destructive here.\n\n' +
    'To check the output without touching your files, deploy a preview.\n' +
    'To strip this working copy anyway: node build.js --force\n' +
    '(commit first - the comments are not recoverable otherwise.)'
  );
  process.exit(1);
}
if (FORCED) console.log('--force: stripping comments from the working copy in place.\n');

const nlOnly = s => s.replace(/[^\n]/g, '');

/**
 * Removes /* *\/ comments, skipping anything inside a string. CSS strings can
 * hold a literal /* - the data: URIs in this file are exactly the kind of place
 * that would happen - so a plain regex is not safe here.
 */
function stripCss(src) {
  let out = '', i = 0, quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated CSS comment');
      const body = src.slice(i, end + 2);
      // A space, not nothing: a comment can legally separate two tokens, and
      // joining them would change what the rule means.
      out += body.includes('\n') ? nlOnly(body) : ' ';
      i = end + 2; continue;
    }
    out += c; i++;
  }
  if (quote) throw new Error('unterminated CSS string');
  return out;
}

/**
 * Same idea for JS, plus regex literals - which look exactly like the start of a
 * comment and are the classic way a stripper like this corrupts a file silently.
 * A `/` is a regex only when it appears where a value is expected, so the last
 * significant character before it decides: if that character could end an
 * expression, the slash is division.
 */
function stripJs(src) {
  let out = '', i = 0, prev = '';
  const canPrecedeDivision = ch => /[)\]}\w$]/.test(ch);
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) break;
        j++;
      }
      if (j >= src.length) throw new Error('unterminated JS string');
      out += src.slice(i, j + 1); prev = q; i = j + 1; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;   // newline itself is kept: ASI depends on it
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated JS comment');
      const body = src.slice(i, end + 2);
      out += body.includes('\n') ? nlOnly(body) : ' ';
      i = end + 2; continue;
    }
    if (c === '/' && !canPrecedeDivision(prev)) {
      // Regex literal. Copy it through untouched, minding escapes and the fact
      // that a `/` inside a [...] class does not close it.
      let j = i + 1, cls = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        else if (src[j] === '\n') throw new Error('newline inside what looked like a regex literal at offset ' + i);
        j++;
      }
      while (j + 1 < src.length && /[a-z]/.test(src[j + 1])) j++;   // flags
      out += src.slice(i, j + 1); prev = '/'; i = j + 1; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function bracesBalanced(css) {
  let d = 0, q = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{') d++;
    if (c === '}') { d--; if (d < 0) return false; }
  }
  return d === 0;
}

let totalBefore = 0, totalAfter = 0, changed = 0;
for (const { file, kind } of TARGETS) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) throw new Error('build target missing: ' + file);
  const src = fs.readFileSync(p, 'utf8');
  const out = kind === 'css' ? stripCss(src) : stripJs(src);

  // Every check below is a refusal, not a warning. A build that half-works here
  // ships a broken site, and the failure mode - a stylesheet that parses but has
  // lost a rule - is not something a deploy would otherwise notice.
  if (!out.trim()) throw new Error(file + ': stripped to nothing');
  if (out.length > src.length) throw new Error(file + ': grew');
  if (out.split('\n').length !== src.split('\n').length) {
    throw new Error(file + ': line count changed, so comments were not replaced 1:1');
  }
  for (const token of CANARIES[file]) {
    if (!out.includes(token)) throw new Error(file + ': lost "' + token + '"');
  }
  if (kind === 'css' && !bracesBalanced(out)) throw new Error(file + ': unbalanced braces');
  if (kind === 'js') {
    try { new vm.Script(out, { filename: file }); }
    catch (e) { throw new Error(file + ': no longer parses -- ' + e.message); }
  }

  fs.writeFileSync(p, out);
  totalBefore += src.length; totalAfter += out.length;
  if (out.length !== src.length) changed++;
  console.log(
    '  ' + file.padEnd(24) +
    String(src.length).padStart(7) + ' -> ' + String(out.length).padStart(7) + ' bytes' +
    (src.length ? '  (-' + Math.round((1 - out.length / src.length) * 100) + '%)' : '')
  );
}

console.log(
  changed
    ? 'stripped ' + changed + ' file(s): ' + totalBefore + ' -> ' + totalAfter + ' bytes'
    : 'nothing to strip (already clean) -- this run was a no-op'
);
