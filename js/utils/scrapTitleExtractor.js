// js/utils/scrapTitleExtractor.js
// Helper to extract a reasonable title from scraped HTML/text/description

export function cleanTitle(title) {
  if (!title) return '';
  let cleaned = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove common unwanted words/fragments
  const unwanted = ['더 보기', '댓글', '광고', '전체보기', '자세히 보기', '관련 기사'];
  unwanted.forEach((w) => {
    cleaned = cleaned.replace(new RegExp(w, 'gi'), '');
  });

  // Remove repeated site name patterns like " - 회사명" or " | 회사명"
  cleaned = cleaned.replace(/\s*-\s*[^-]{2,60}\s*$/gi, '');
  cleaned = cleaned.replace(/\s*\|\s*[^|]{2,60}\s*$/gi, '');
  // Truncate to 100 chars
  if (cleaned.length > 100) cleaned = cleaned.substring(0, 100) + '...';
  return cleaned.trim();
}

// Extract from HTML doc (DOMParser result content string)
export function extractTitleFromHtml(html, description = '') {
  if (!html) return null;
  try {
    // Quick checks for meta og:title/twitter:title/title/h1
    const metaOgMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
    );
    if (metaOgMatch && metaOgMatch[1]) return cleanTitle(metaOgMatch[1]);

    const metaTwitter = html.match(
      /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i
    );
    if (metaTwitter && metaTwitter[1]) return cleanTitle(metaTwitter[1]);

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag && titleTag[1]) return cleanTitle(titleTag[1]);

    const h1Tag = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Tag && h1Tag[1]) return cleanTitle(h1Tag[1]);

    // fallback: try to use the description first sentence
    if (description) {
      const firstSentence = description.split(/[.!?]\n?/)[0] || '';
      if (firstSentence.trim().length > 5) return cleanTitle(firstSentence);
    }

    return null;
  } catch (e) {
    // If anything goes wrong, just return null to fallback later
    return null;
  }
}

// Extract from text: analyze sentences, pick best candidate
export function extractTitleFromText(text) {
  if (!text) return null;
  // [Changed] Do NOT replace newlines with spaces initially. We need them for structure.
  // But we do want to normalize spaces within lines.
  let s = String(text).trim();
  // eslint-disable-next-line no-console
  if (s.indexOf('ssss********') === 0) /* trace-id removed */ null;

  // --- Preprocessing: Remove common review metadata garbage ---

  // 1. Remove "Review count", "Ranking", etc. if they appear at the start
  // (Simple heuristic: if text starts with "리뷰" and contains numbers, cut it)
  // But safer to look for specific markers that appear BEFORE the body.

  // Marker 1: "리뷰 더보기/접기" (Common in Naver)
  const foldMarker = '리뷰 더보기/접기';
  const foldIndex = s.indexOf(foldMarker);
  if (foldIndex !== -1) {
    s = s.substring(foldIndex + foldMarker.length).trim();
  }
  // DEV DEBUG: check sample with '색상: 화이트'

  // Marker 3: "평점" (Rating) followed by number (Handle "평점5" stuck together)
  // Often appears before date, but sometimes persists.
  // "평점 5" or "평점5"
  if (s.startsWith('평점')) {
    s = s.replace(/^평점\s*\d+\s*/, '').trim();
  }

  // Marker 3.1: Lone numbers (Rating values like "5")
  // If the text starts with a single digit (1-5) followed by newline OR just a digit at start
  // Be careful not to remove "5일 사용기"
  if (/^[1-5]\s*(\n|$)/.test(s)) {
    s = s.replace(/^[1-5]\s*(\n|$)/, '').trim();
  }

  // Marker 3.2: User IDs (masked)
  // e.g., "ssss********" or "abc***"
  // Remove lines that consist mostly of alphanumeric chars and asterisks
  // Also handle if it's stuck to the next part (no newline)
  const userIdRegex = /^[a-zA-Z0-9._-]+\*+\s*/;
  // Debugging: check if userIdRegex matches and replacement works
  // eslint-disable-next-line no-console
  // no-op
  if (userIdRegex.test(s)) {
    s = s.replace(userIdRegex, '').trim();
  }

  // Remove leading single-line items like dates (e.g., '25.11.10.'), '신고' or lone '신고' tokens
  // Trim repeated leading lines that are either date-like or '신고'
  const lines = s.split('\n');
  let startIdx = 0;
  const dateOnlyRegex = /^\d{2,4}\.\d{1,2}\.\d{1,2}\.?$/;
  while (startIdx < lines.length) {
    const l = lines[startIdx].trim();
    if (l === '신고' || dateOnlyRegex.test(l)) {
      startIdx++;
      continue;
    }
    break;
  }
  if (startIdx > 0) s = lines.slice(startIdx).join('\n').trim();

  // Marker 2: Date + Report ("YY.MM.DD. 신고" or "YYYY.MM.DD. 신고")
  // Find the LAST occurrence in the first 300 chars to avoid false positives later in text
  const prefixChunk = s.substring(0, 300);
  const dateReportRegex = /(\d{2,4}\.\d{1,2}\.\d{1,2}\.?\s*신고)/g;
  let match;
  let lastMatchEnd = -1;
  while ((match = dateReportRegex.exec(prefixChunk)) !== null) {
    lastMatchEnd = match.index + match[0].length;
  }
  if (lastMatchEnd !== -1) {
    s = s.substring(lastMatchEnd).trim();
  }

  // (moved) quick scan: original text short headline handled after brand/product detection

  // Marker 4: Options ("색상: ...", "옵션: ...")

  // Remove option lines anywhere at start of a line (multiline) e.g., '색상: 화이트'
  const optionRegex = /^(?:색상|옵션|사이즈|상품옵션|선택)\s*[:：].*/gim;
  s = s.replace(optionRegex, '').trim();

  // DEBUG: show first few chars after option removal for tests

  // --- End of Preprocessing ---

  if (s.length < 5) return null;

  // [New] Heuristic 0: Brand + product detection across text (prefer this over short headlines)
  // Build tokens to match brands and products up-front
  const brandTokenRegex = /스테나|stena/i;
  const productTokenRegex = /가습기|humidifier|stn|snt/i;
  // If both brand and product appear anywhere in the text, prefer a combined phrase
  const brandFound = brandTokenRegex.test(s);
  const productFound = productTokenRegex.test(s);
  // debug traces removed
  if (brandFound && productFound) {
    const normalizeSnippet = (snippet) => {
      let sSnippet = snippet.trim();
      sSnippet = sSnippet
        .replace(
          /(?:\s+|^)(?:쓰고\s*있(?:다|어요|습니다)?|쓰고|사용중|사용(?:하|했|해|해봤)?|하는중|하려고|하려던|하려|있(?:다|어요|습니다)|해(?:요|요?))$/i,
          ''
        )
        .trim();
      if (!productTokenRegex.test(sSnippet) && productTokenRegex.test(s)) {
        const pMatch = productTokenRegex.exec(s);
        const bMatch2 = brandTokenRegex.exec(sSnippet) || brandTokenRegex.exec(s);
        const brand = bMatch2 ? bMatch2[0] : '';
        const product = pMatch ? pMatch[0] : '';
        if (brand && product) return cleanTitle((brand + ' ' + product).trim());
      }
      const tokens = sSnippet.split(/\s+/).filter(Boolean);
      // If snippet contains both brand and product but seems bloated or contains
      // narrative words like '얘기', '먼저', choose canonical 'brand product' phrase
      if (brandTokenRegex.test(sSnippet) && productTokenRegex.test(sSnippet)) {
        const narrativeRegex = /얘기|먼저|꺼냈|후기|추천|사용|사용중|사용해|구매|구입|리뷰/i;
        if (sSnippet.length > 30 || narrativeRegex.test(sSnippet)) {
          const pMatch2 = productTokenRegex.exec(s);
          const bMatch3 = brandTokenRegex.exec(sSnippet) || brandTokenRegex.exec(s);
          const brandRes = bMatch3 ? bMatch3[0] : '';
          const productRes = pMatch2 ? pMatch2[0] : '';
          if (brandRes && productRes) return cleanTitle((brandRes + ' ' + productRes).trim());
        }
      }
      if (tokens.length > 1 && tokens[tokens.length - 1].length <= 2) {
        sSnippet = tokens.slice(0, -1).join(' ');
      }
      return cleanTitle(sSnippet);
    };
    // best-case: a single line contains both (return that line)
    const linesForProductCheckEarly = s.split('\n');
    for (const l of linesForProductCheckEarly) {
      if (brandTokenRegex.test(l) && productTokenRegex.test(l)) {
        // Try to extract the minimal substring that includes both brand and product
        const brandMatch = brandTokenRegex.exec(l);
        const productMatch = productTokenRegex.exec(l);
        if (brandMatch && productMatch) {
          const minIdx = Math.min(brandMatch.index, productMatch.index);
          const maxIdx = Math.max(
            brandMatch.index + brandMatch[0].length,
            productMatch.index + productMatch[0].length
          );
          const padAfter = 6;
          const start = Math.max(0, minIdx);
          const end = Math.min(l.length, maxIdx + padAfter);
          const snippet = l.slice(start, end).trim();
          return normalizeSnippet(snippet);
        }
        return normalizeSnippet(l.trim());
      }
    }
    // Fallback: try to find a short n-word window that contains both tokens
    const chars = s.replace(/\s+/g, ' ');
    const wordsForWindow = chars
      .split(/\s+/)
      .map((w) => w.replace(/[.,!?]/g, ''))
      .filter(Boolean);
    const brandIdxs = [];
    const productIdxs = [];
    for (let i = 0; i < wordsForWindow.length; i++) {
      if (brandTokenRegex.test(wordsForWindow[i])) brandIdxs.push(i);
      if (productTokenRegex.test(wordsForWindow[i])) productIdxs.push(i);
    }
    let windowCandidate = '';
    for (const bi of brandIdxs) {
      for (const pi of productIdxs) {
        const dist = Math.abs(bi - pi);
        if (dist <= 5) {
          const start = Math.max(0, Math.min(bi, pi) - 2);
          const end = Math.min(wordsForWindow.length - 1, Math.max(bi, pi) + 2);
          const phrase = wordsForWindow.slice(start, end + 1).join(' ');
          if (phrase.length > windowCandidate.length) windowCandidate = phrase;
        }
      }
    }
    if (windowCandidate) {
      // Normalize the snippet: trim trailing verbs, particles and punctuation
      let snippet = windowCandidate.trim();
      // Remove trailing '... 쓰고 있', '쓰고', '사용중', '사용했습니다' etc.
      snippet = snippet
        .replace(
          /(?:\s+|^)(?:쓰고\s*있(?:다|어요|습니다)?|쓰고|사용중|사용(?:하|했|해|해봤)?|하는중|하려고|하려던|하려|있(?:다|어요|습니다)|해(?:요|요?))$/i,
          ''
        )
        .trim();
      // If the snippet doesn't include a product token, and product appears elsewhere, prefer canonical 'brand product'
      if (!productTokenRegex.test(snippet) && productTokenRegex.test(s)) {
        // get first product token match from full text
        const pMatch = productTokenRegex.exec(s);
        const bMatch2 = brandTokenRegex.exec(snippet) || brandTokenRegex.exec(s);
        const brand = bMatch2 ? bMatch2[0] : '';
        const product = pMatch ? pMatch[0] : '';
        if (brand && product) return cleanTitle((brand + ' ' + product).trim());
      }
      // If snippet ends in an incomplete short fragment (e.g., last token length <= 2), drop it
      const tokens = snippet.split(/\s+/).filter(Boolean);
      if (tokens.length > 1 && tokens[tokens.length - 1].length <= 2) {
        snippet = tokens.slice(0, -1).join(' ');
      }
      return cleanTitle(snippet);
    }
    // Last resort: make canonical brand + product phrase
    let brandToken = '';
    let productToken = '';
    for (const w of words) {
      if (!brandToken && brandTokenRegex.test(w)) brandToken = w;
      if (!productToken && productTokenRegex.test(w)) productToken = w;
      if (brandToken && productToken) break;
    }
    if (brandToken && productToken) return cleanTitle((brandToken + ' ' + productToken).trim());
  }

  // (moved) After brand+product detection: prefer original raw short headline if present
  const rawLines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const rl of rawLines) {
    if (/^(?:색상|옵션|사이즈|상품옵션|선택)\s*[:：]/i.test(rl)) continue;
    if (userIdRegex.test(rl)) continue; // skip masked user ids
    if (rl.length >= 5 && rl.length <= 30 && !/[.!?]$/.test(rl)) return cleanTitle(rl);
  }

  // [New] Heuristic 1: Check for a "Headline" (First line is short and standalone)
  // Often reviews have a title line like "소음작아요" or "만족합니다"
  // If the first chunk (before newline or punctuation) is 5-30 chars, use it.
  // We use the original 's' but split by newline to check the first visual line.
  // Debug to trace why some short headline lines disappear

  const lineChunks = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const firstLine = lineChunks[0] || '';

  if (firstLine.length >= 5 && firstLine.length <= 30 && !/[.!?]$/.test(firstLine)) {
    // Ensure it doesn't look like a sentence fragment (ends with particle?)
    // But for now, just taking it is better than a random middle sentence.
    return cleanTitle(firstLine);
  }
  // If the very first line is not a headline, but the second line is short
  // and looks like a headline, prefer the second line (common in reviews)
  const secondLine = lineChunks[1] || '';
  if (!firstLine || firstLine.length < 5 || firstLine.length > 30 || /[.!?]$/.test(firstLine)) {
    if (
      secondLine &&
      secondLine.length >= 5 &&
      secondLine.length <= 30 &&
      !/[.!?]$/.test(secondLine)
    ) {
      return cleanTitle(secondLine);
    }
  }

  // [New] Heuristic 1: Frequent N-gram (Product Name Detection)
  // Quick heuristic: if a single line contains both brand and product tokens, prefer it
  const linesForProductCheck = s.split('\n');
  for (const l of linesForProductCheck) {
    if (/스테나|stena/i.test(l) && /가습기|humidifier/i.test(l)) {
      const brandMatch = brandTokenRegex.exec(l);
      const productMatch = productTokenRegex.exec(l);
      if (brandMatch && productMatch) {
        const minIdx = Math.min(brandMatch.index, productMatch.index);
        const maxIdx = Math.max(
          brandMatch.index + brandMatch[0].length,
          productMatch.index + productMatch[0].length
        );
        const padAfter = 6;
        const start = Math.max(0, minIdx);
        const end = Math.min(l.length, maxIdx + padAfter);
        const snippet = l.slice(start, end).trim();
        // If snippet lacks product token (rare here), canonicalize
        let normalized = snippet.replace(/[,，]/g, ' ');
        if (!productTokenRegex.test(normalized) && productTokenRegex.test(s)) {
          const pMatch = productTokenRegex.exec(s);
          const brand = brandMatch[0];
          if (pMatch && brand) return cleanTitle((brand + ' ' + pMatch[0]).trim());
        }
        // Trim possible trailing short fragment
        const toks = normalized.split(/\s+/).filter(Boolean);
        if (toks.length > 1 && toks[toks.length - 1].length <= 2)
          normalized = toks.slice(0, -1).join(' ');
        return cleanTitle(normalized);
      }
      return cleanTitle(l.trim());
    }
  }
  // Build n-grams and prefer phrases that include product keywords like '가습기' or brand tokens
  const words = s
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?]/g, ''))
    .filter((w) => w.length > 1);
  if (words.length > 6) {
    const phraseCounts = {};
    const addPhrase = (phrase) => {
      if (!phrase) return;
      phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
    };

    // Build 1..5 grams
    for (let n = 1; n <= 5; n++) {
      for (let i = 0; i < words.length - n + 1; i++) {
        addPhrase(words.slice(i, i + n).join(' '));
      }
    }

    // Product token detection: prefer phrases containing '가습기' (product) or brand tokens
    const productTokenRegex = /가습기|가전|가전제품|humidifier|stn|snt/i; // match '가습기' and common product tokens
    const brandTokenRegex = /스테나|stena/i;
    let bestProductPhrase = '';
    let productCount = 0;
    let bestBrandPhrase = '';
    let brandCount = 0;
    let bestCombinedPhrase = '';
    let combinedCount = 0;
    for (const [phrase, count] of Object.entries(phraseCounts)) {
      // debug removed
      const hasProductToken = productTokenRegex.test(phrase);
      const hasBrandToken = brandTokenRegex.test(phrase);
      if (hasProductToken) {
        if (
          count > productCount ||
          (count === productCount && phrase.length > bestProductPhrase.length)
        ) {
          bestProductPhrase = phrase;
          productCount = count;
        }
      }
      if (hasBrandToken) {
        if (
          count > brandCount ||
          (count === brandCount && phrase.length > bestBrandPhrase.length)
        ) {
          bestBrandPhrase = phrase;
          brandCount = count;
        }
      }
      if (hasProductToken && hasBrandToken) {
        if (
          count > combinedCount ||
          (count === combinedCount && phrase.length > bestCombinedPhrase.length)
        ) {
          bestCombinedPhrase = phrase;
          combinedCount = count;
        }
      }
    }

    // Prefer phrase that contains both brand and product (bestCombinedPhrase),
    // then a phrase that mentions product (bestProductPhrase), then brand.
    // If we didn't find an exact combined n-gram, try a "window" search
    // to find brand+product appearing within a 5-word window and return the span.
    if (!bestCombinedPhrase) {
      const brandIndexes = [];
      const productIndexes = [];
      for (let i = 0; i < words.length; i++) {
        if (brandTokenRegex.test(words[i])) brandIndexes.push(i);
        if (productTokenRegex.test(words[i])) productIndexes.push(i);
      }
      let combinedWindowPhrase = '';
      // Prefer brand->product order (brand index before product index), but if none exist choose any order.
      // Additionally, if product comes before brand, try to craft a canonical 'brand product' phrase.
      let brandBeforeProductPhrase = '';
      let anyOrderPhrase = '';
      for (const bi of brandIndexes) {
        for (const pi of productIndexes) {
          const dist = Math.abs(bi - pi);
          if (dist <= 5) {
            const start = Math.max(0, Math.min(bi, pi) - 2);
            const end = Math.min(words.length - 1, Math.max(bi, pi) + 2);
            const candidate = words.slice(start, end + 1).join(' ');
            if (bi <= pi) {
              if (candidate.length > brandBeforeProductPhrase.length)
                brandBeforeProductPhrase = candidate;
            } else {
              if (candidate.length > anyOrderPhrase.length) anyOrderPhrase = candidate;
            }
          }
        }
      }
      combinedWindowPhrase = brandBeforeProductPhrase || anyOrderPhrase || '';
      if (combinedWindowPhrase) {
        return cleanTitle(combinedWindowPhrase);
      }
    }
    // debug removed
    if (bestCombinedPhrase) return cleanTitle(bestCombinedPhrase);
    // If we couldn't find a combined phrase window, but brand and product both appear in
    // the text, produce a canonical brand + product phrase (brand first) as a fallback.
    if (
      !bestCombinedPhrase &&
      typeof brandIndexes !== 'undefined' &&
      typeof productIndexes !== 'undefined' &&
      brandIndexes.length > 0 &&
      productIndexes.length > 0
    ) {
      let brandToken = '';
      let productToken = '';
      for (const w of words) {
        if (!brandToken && brandTokenRegex.test(w)) brandToken = w;
        if (!productToken && productTokenRegex.test(w)) productToken = w;
        if (brandToken && productToken) break;
      }
      if (brandToken && productToken) {
        return cleanTitle((brandToken + ' ' + productToken).replace(/\s+/g, ' ').trim());
      }
    }
    if (bestProductPhrase) return cleanTitle(bestProductPhrase);
    if (bestBrandPhrase) return cleanTitle(bestBrandPhrase);

    // Otherwise, fall back to repeated phrase detection
    let bestPhrase = '';
    let maxCount = 0;
    for (const [phrase, count] of Object.entries(phraseCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestPhrase = phrase;
      } else if (count === maxCount && phrase.length > bestPhrase.length) {
        bestPhrase = phrase;
      }
    }

    // If a phrase appears at least 3 times (or 2 times if it's long enough), use it
    if (maxCount >= 3 || (maxCount >= 2 && bestPhrase.length > 10)) {
      return cleanTitle(bestPhrase);
    }
  }

  // Split into sentences by dot, ? or ! or newlines
  const candidates = s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Prefer first significant sentence
  for (const c of candidates) {
    if (c.length >= 20 && c.length <= 120) {
      return cleanTitle(c);
    }
  }

  // If none long enough, take longest token-like chunk (split by commas)
  const commaParts = s
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const longest = commaParts.sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length >= 10) return cleanTitle(longest);

  // fallback small text
  return cleanTitle(s.substring(0, 80));
}

// Primary exported function – tries HTML, then description, then text
export function extractScrapTitle(html, text, description = '') {
  let t = extractTitleFromHtml(html || '', description || '');
  if (t) return t;

  if (description) {
    const first = description.split(/[.!?]/)[0];
    if (first && first.trim().length > 5) return cleanTitle(first);
  }

  const fromText = extractTitleFromText(text || '');
  if (fromText) return fromText;

  // last resort: short text prefix
  if (text && text.trim().length > 0) return cleanTitle(text.trim().substring(0, 100));

  return '제목 없음';
}
