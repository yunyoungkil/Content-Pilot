// test/postProcessAffiliateHtml.test.js

import { postProcessAffiliateHtml } from '../js/services/aiService.js';

describe('postProcessAffiliateHtml context-aware insertion', () => {
  it('uses matched phrase as anchor text for affiliate links', () => {
    const html = '<p>2024 최고의 무선이어폰 추천과 비교를 제공합니다.</p>';
    const affiliates = [
      { url: 'https://example.com/earbuds', keywords: ['무선이어폰'], productName: '에어팟' },
    ];

    const out = postProcessAffiliateHtml(html, affiliates, { maxLinks: 1 });
    expect(out).toContain('<a');
    expect(out).toContain('href="https://example.com/earbuds"');
    // anchor text should be the matched phrase '무선이어폰'
    expect(out).toContain('>무선이어폰<');
  });

  it('inserts internal link using post title when it fits', () => {
    const html = '<p>이 글은 스마트홈 설치 가이드를 다룹니다.</p>';
    const affiliates = [];
    const internals = [
      { title: '스마트홈 설치 가이드', url: 'https://myblog.com/smarthome' },
    ];

    const out = postProcessAffiliateHtml(html, affiliates, { maxLinks: 1, internalLinks: internals });
    expect(out).toContain('<a');
    expect(out).toContain('href="https://myblog.com/smarthome"');
    // anchor text should be title or matched phrase
    expect(out).toMatch(/>(스마트홈 설치 가이드|스마트홈 설치)<\/a>/);
  });

  it('does not insert link inside code or existing anchors', () => {
    const html = '<pre>무선이어폰 설치 코드 예시 무선이어폰</pre><p>무선이어폰 정보</p>';
    const affiliates = [{ url: 'https://example.com/earbuds', keywords: ['무선이어폰'] }];

    const out = postProcessAffiliateHtml(html, affiliates, { maxLinks: 1 });
    // should insert only in paragraph, not in pre
    expect(out).toContain('<pre>무선이어폰 설치 코드 예시 무선이어폰</pre>');
    expect(out).toContain('<a');
  });

  it('adds standardized affiliate disclosure HTML when affiliates exist', () => {
    const html = '<p>제품 리뷰</p>';
    const affiliates = [{ url: 'https://shop.example/aff1', keywords: ['제품'] }];
    const out = postProcessAffiliateHtml(html, affiliates, { maxLinks: 1 });
    expect(out).toContain('<p style="text-align: center;" data-ke-size="size16"><span style="color: #9d9d9d;">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</span></p>');
  });
});