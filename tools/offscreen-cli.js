#!/usr/bin/env node
'use strict';

/**
 * tools/offscreen-cli.js
 * Minimal console tool that mimics offscreen sanitization + parsing
 * Uses jsdom + DOMPurify + marked so you can run in Node for debugging.
 *
 * Usage:
 *   node tools/offscreen-cli.js --mode sanitize --file path/to/input.html
 *   node tools/offscreen-cli.js --mode parse --file path/to/input.html
 *   cat input.html | node tools/offscreen-cli.js --mode sanitize
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const marked = require('marked');

function usage() {
  console.log('Usage: offscreen-cli.js --mode <sanitize|parse> [--file <path>]');
}

function loadInputFromArgs() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) {
      args.mode = argv[++i];
    } else if ((a === '--file' || a === '-f') && argv[i + 1]) {
      args.file = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve(null);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data || null), 20);
  });
}

function sanitizeHtml(rawHtml) {
  // Build a JSDOM + DOMPurify instance each run (safe and simple)
  const dom = new JSDOM(`<!doctype html><html><body>${rawHtml}</body></html>`);
  const window = dom.window;
  const DOMPurify = createDOMPurify(window);

  // Basic allow-list: keep common elements used by content.
  const clean = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: false,
    ALLOWED_TAGS: [
      'b',
      'i',
      'em',
      'strong',
      'a',
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'pre',
      'code',
      'blockquote',
      'span',
      'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'style', 'loading'],
  });

  return clean;
}

function parseHtml(html, baseUrl = '') {
  const dom = new JSDOM(html, { url: baseUrl || 'http://localhost/' });
  const document = dom.window.document;

  const metaOg = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  const firstImg = document.querySelector('img')?.getAttribute('src') || '';
  const thumbnail = metaOg || firstImg || '';

  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  // Extract clean text (remove scripts, styles, collapse whitespace)
  const cloned = document.cloneNode(true);
  // remove scripts and styles
  cloned.querySelectorAll('script,style').forEach((n) => n.remove());
  let cleanText = cloned.body.textContent || '';
  cleanText = cleanText
    .replace(/[\n\t\r]+/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();

  // metrics: wordCount and approx reading time
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMin = Math.max(1, Math.round(wordCount / 200));

  // meta tags and keywords
  const metaTags = [];
  const keywordsMeta =
    document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
  if (keywordsMeta) {
    keywordsMeta
      .split(/[,，、;；\s]+/)
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => metaTags.push(k));
  }

  return {
    thumbnail: thumbnail ? new URL(thumbnail, baseUrl || 'http://localhost/').href : '',
    description,
    metrics: { wordCount, readingTimeMin },
    cleanText,
    metaTags: metaTags.length ? metaTags : null,
  };
}

async function main() {
  const args = loadInputFromArgs();
  if (args.help || !args.mode) return usage();

  let input = null;
  if (args.file) {
    const p = path.resolve(process.cwd(), args.file);
    input = fs.readFileSync(p, 'utf8');
  } else {
    input = await readStdin();
  }

  if (!input) {
    console.error('No input provided. Use --file or pipe HTML to stdin.');
    process.exit(2);
  }

  if (args.mode === 'sanitize') {
    const sanitized = sanitizeHtml(input);
    console.log(sanitized);
    return;
  }

  if (args.mode === 'parse') {
    const parsed = parseHtml(input);
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  console.error('Unknown mode:', args.mode);
  usage();
}

main().catch((err) => {
  console.error('offscreen-cli error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
