const { generateDraftFromIdea } = require('../js/services/aiService.js');

describe('Issue #37 - Thumbnail alt text sanitization', () => {
  test('replaces punctuation-only altText with title fallback', async () => {
    const ideaData = {
      title: 'My Test Title',
      publishInfo: {
        thumbnailUrls: { url_16x9: 'https://img.test/16x9.png', altText: '?' },
      },
    };

    const res = await generateDraftFromIdea(ideaData, { generateThumbnail: false, generateDraft: false });

    expect(res.thumbnailUrls).toBeDefined();
    expect(res.thumbnailUrls.altText).toBe('My Test Title 썸네일 이미지');
  });

  test('preserves meaningful altText that contains letters even with question mark', async () => {
    const ideaData = {
      title: 'Other Title',
      publishInfo: {
        thumbnailUrls: { url_16x9: 'https://img.test/16x9.png', altText: '이거 실화냐?' },
      },
    };

    const res = await generateDraftFromIdea(ideaData, { generateThumbnail: false, generateDraft: false });

    expect(res.thumbnailUrls).toBeDefined();
    expect(res.thumbnailUrls.altText).toBe('이거 실화냐?');
  });
});
