import { extractScrapTitle, extractTitleFromText } from '../js/utils/scrapTitleExtractor.js';

describe('scrapTitleExtractor', () => {
  test('extracts og:title', () => {
    const html = `<html><head><meta property="og:title" content="OG Title Test"></head><body></body></html>`;
    const title = extractScrapTitle(html, '', '');
    expect(title).toBe('OG Title Test');
  });

  test('extracts title tag', () => {
    const html = `<html><head><title>Page Title</title></head><body></body></html>`;
    const title = extractScrapTitle(html, '', '');
    expect(title).toBe('Page Title');
  });

  test('extracts h1 when title absent', () => {
    const html = `<html><body><h1>Main Heading</h1><p>...</p></body></html>`;
    const title = extractScrapTitle(html, '', '');
    expect(title).toBe('Main Heading');
  });

  test('uses description first sentence if available', () => {
    const html = `<html><head></head><body></body></html>`;
    const desc = 'This is the description. Rest of description.';
    const title = extractScrapTitle(html, '', desc);
    expect(title).toBe('This is the description');
  });

  test('extracts longest sentence from text', () => {
    const text = 'Short. This is the longest sentence that should be chosen as title. Tiny.';
    const title = extractScrapTitle('', text, '');
    expect(title).toBe('This is the longest sentence that should be chosen as title.');
  });

  test('fallback to short prefix when nothing else', () => {
    const text = 'Short sample';
    const title = extractScrapTitle('', text, '');
    expect(title).toBe('Short sample');
  });

  test('short headline is extracted as title', () => {
    const text = `ssss********\n25.11.10.\n신고\n색상: 화이트\n소음작아요\n올해 아기가 태어나고 가을이 되니 집안 공기가...`;
    // Recreate initial steps to inspect firstLine manually
    let s = String(text).trim();
    const userIdRegex = /^[a-zA-Z0-9._-]+\*+\s*/;
    if (userIdRegex.test(s)) s = s.replace(userIdRegex, '').trim();
    const lines = s.split('\n');
    const dateOnlyRegex = /^\d{2,4}\.\d{1,2}\.\d{1,2}\.?$/;
    let startIdx = 0;
    while (startIdx < lines.length) {
      const l = lines[startIdx].trim();
      if (l === '신고' || dateOnlyRegex.test(l)) {
        startIdx++;
        continue;
      }
      break;
    }
    s = lines.slice(startIdx).join('\n').trim();
    // debug prints

    const optionRegex = /^(색상|옵션|사이즈|상품옵션|선택)\s*[:]\s*[^ \r\n]+(?:[ \t][^ \r\n]+)?\s*/;
    let oldS = '';
    while (s !== oldS) {
      oldS = s;
      s = s.replace(optionRegex, '').trim();
    }
    const firstLine = s.split('\n')[0].trim();
    // debug logs removed
    expect(firstLine).toBe('소음작아요');
    const title = extractTitleFromText(text);
    expect(title).toBe('소음작아요');
  });

  test('repeated product name appears as title (product name detection)', () => {
    const text = `이것은 스테나 풀스텐 아키텍 가습기를 사용한 후기입니다.\n스테나 풀스텐 아키텍 가습기는 정말 좋습니다.\n제가 추천합니다.`;
    const title = extractTitleFromText(text);
    // The returned title should include the product name '스테나' and '가습기'
    expect(title).toMatch(/스테나[\s\S]*가습기/);
  });

  test('sample HTML: prefer brand+product phrase over generic short headline', () => {
    const userHtml = `
<div class="AlfkEF45qI"><div class="uyooaw19E8"><div class="HakaEZ240l"><div class="KqJ8Qqw082 KI9_Ra6pje"><span class="MX91DFZo2F">올해 아기가 태어나고 가을이 되니 집안 공기가 점점 건조해지는것 같아 습도에 신경이 쓰였습니다.
디자인도 깔끔하고, 내부가 풀스텐이라 위생적이고, 무슨말이 더있다.. 스테나 풀스텐 아키텍 가습기를 쓰고 있는데 "가습기를 세 번 바꾸고 결국 이걸로 정착했다"라더라고요.
`;
    const title = extractScrapTitle(userHtml, userHtml);
    expect(title).toMatch(/스테나/i);
    expect(title).toMatch(/가습기|STN|SNT|stn|snt/i);
  });

  test('short brand fragment: product token earlier in text and brand fragment later', () => {
    const t = '가습기 얘기를 먼저 꺼냈고 스테나 풀스텐 아';
    const title = extractScrapTitle('', t);
    // debug removed
    // We should get at least canonical '스테나 가습기'
    expect(title).toMatch(/스테나/i);
    expect(title).toMatch(/가습기|stn|snt/i);
    expect(/아$/.test(title)).toBe(false); // Should not end with '아' (truncated)
  });
});
