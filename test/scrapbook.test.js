// test/scrapbook.test.js

import {
  extractContextualContent,
  applyHighlightsToHTML,
  enrichScrapWithHighlights,
} from '../js/core/scrapbook.js';

describe('scrapbook.extractContextualContent', () => {
  test('removes unwanted selectors and extracts sentences + highlights', () => {
    const html = `
      <div>
        <header>site header should be removed</header>
        <h1 class="title">핵심 제목입니다.</h1>
        <p>이 문장은 매우 중요합니다. 결론: 결과는 42입니다!</p>
        <nav>nav content</nav>
        <script>const a = 1;</script>
      </div>
    `;

    const res = extractContextualContent(html);

    // ensure unwanted parts are not present in extracted text
    expect(res.text).not.toMatch(/site header|nav content|const a/);

    // highlights non-empty and top highlight has score >= 1
    expect(Array.isArray(res.highlights)).toBe(true);
    expect(res.highlights.length).toBeGreaterThanOrEqual(1);
    expect(res.highlights[0].score).toBeGreaterThanOrEqual(1);

    // ensure extracted text contains our visible content
    expect(res.text).toMatch(/핵심 제목입니다/);
    expect(res.text).toMatch(/결과는 42입니다/);
  });

  test('returns empty highlights for empty text or missing root', () => {
    expect(extractContextualContent('')).toEqual({ text: '', highlights: [] });

    expect(extractContextualContent(null)).toEqual({ text: '', highlights: [] });
  });
});

describe('scrapbook.applyHighlightsToHTML', () => {
  test('wraps specified ranges with mark elements without changing other content', () => {
    const text = '첫번째 문장. 두번째 문장. 세번째 문장.';
    const highlights = [
      { startIndex: 0, endIndex: 6, text: '첫번째 문장', score: 3 },
      { startIndex: 8, endIndex: 14, text: '두번째 문장', score: 2 },
    ];

    const html = applyHighlightsToHTML(text, highlights);
    expect(html).toContain('<mark class="scrap-highlight" data-score="3">첫번째 문장</mark>');
    expect(html).toContain('<mark class="scrap-highlight" data-score="2">두번째 문장</mark>');
    // ensure remainder of text remains
    expect(html).toMatch(/세번째 문장/);
  });

  test('returns original text when highlights empty', () => {
    const text = '그냥 텍스트';
    expect(applyHighlightsToHTML(text, [])).toBe(text);
  });
});

describe('scrapbook.enrichScrapWithHighlights', () => {
  test('adds highlights & highlightedHtml when html provided', () => {
    const sampleHtml = '<div><h2 class="heading">중요한 타이틀입니다.</h2><p>요약: 이 텍스트는 테스트용입니다. 숫자 123이 포함됩니다.</p></div>';

    const input = { html: sampleHtml };
    const out = enrichScrapWithHighlights(input);

    expect(out).toHaveProperty('highlights');
    expect(Array.isArray(out.highlights)).toBe(true);
    expect(out.hasHighlights).toBe(out.highlights.length > 0);

    if (out.highlights.length > 0) {
      // highlightedHtml should exist and contain mark
      expect(typeof out.highlightedHtml).toBe('string');
      expect(out.highlightedHtml).toMatch(/<mark class="scrap-highlight"/);
    }
  });

  test('works when _sourceElement DOM node is provided', () => {
    // Create a DOM element directly
    const el = document.createElement('div');
    el.innerHTML = '<div><strong>핵심</strong> 문장입니다. 다른 문장입니다.</div>';

    const input = { _sourceElement: el };
    const out = enrichScrapWithHighlights(input);

    expect(out.highlights).toBeDefined();
    expect(out.text).toBeTruthy();
    expect(out.hasHighlights).toBe(out.highlights.length > 0);
  });
});

describe('scrapbook.extractContextualContent - scoring rules', () => {
  test('applies keyword scoring and length based scoring correctly', () => {
    const html = `
      <div>
        <p>짧</p>
        <p>중간길이의 문장입니다.</p>
        <p>이 문장에는 핵심 키워드가 포함되어 있고 숫자 2025를 포함합니다.</p>
        <p>이 문장은 질문인가요? 어떻게 해야 하나요?</p>
      </div>
    `;

    const res = extractContextualContent(html);
    // must extract at least the mid and keyword sentences
    expect(res.highlights.some((h) => h.text.includes('중간길이의'))).toBeTruthy();
    const hasKeyword = res.highlights.some((h) => h.text.includes('핵심 키워드'));
    expect(hasKeyword).toBeTruthy();

    // ensure question text appears in the full extracted text
    expect(res.text).toMatch(/어떻게/);
  });

  test('penalizes very short and very long sentences', () => {
    const short = '짧';
    const long = 'A'.repeat(600); // long > 500
    const html = `<div><p>${short}</p><p>${long}</p><p>적절한 길이의 문장입니다.</p></div>`;
    const res = extractContextualContent(html);
    // There should be highlights, and the long sentence should be penalized (score lower than the normal one)
    const longItem = res.highlights.find((h) => h.text.includes('A'));
    const normalItem = res.highlights.find((h) => h.text.includes('적절한 길이'));
    expect(longItem).toBeDefined();
    expect(normalItem).toBeDefined();
    expect(longItem.score).toBeLessThanOrEqual(normalItem.score + 1); // long is penalized (not too high)
  });
});

describe('scrapbook.applyHighlightsToHTML - overlap and bounds', () => {
  test('handles overlapping highlight ranges by inserting markup for both', () => {
    const text = 'ABCDEFGHIJ';
    // overlapping: [2,6) and [4,8)
    const highlights = [
      { startIndex: 2, endIndex: 6, text: 'CDEF', score: 2 },
      { startIndex: 4, endIndex: 8, text: 'EFGH', score: 3 },
    ];

    const html = applyHighlightsToHTML(text, highlights);
    // overlaps are merged into a single marked region covering the union
    expect(html).toMatch(/<mark[^>]*>CDEFGH<\/mark>/);
    // ensure original letters also remain (A,B etc.)
    expect(html).toMatch(/AB/);
    expect(html).toMatch(/IJ/);
  });

  test('ignores highlights with out-of-range indices gracefully', () => {
    const text = '12345';
    const highlights = [
      { startIndex: -5, endIndex: 2, text: '1', score: 1 },
      { startIndex: 1, endIndex: 100, text: '2345', score: 2 },
    ];

    const html = applyHighlightsToHTML(text, highlights);
    // After clamping and merging, the whole string should be wrapped in a single mark
    expect(html).toBe('<mark class="scrap-highlight" data-score="2">12345</mark>');
  });
});
