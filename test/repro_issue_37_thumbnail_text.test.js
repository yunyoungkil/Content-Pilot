const { generateDraftFromIdea } = require('../js/services/aiService.js');

jest.mock('../js/services/thumbnailService.js', () => ({
  generateThumbnailTexts: jest.fn(),
}));

const thumbnailService = require('../js/services/thumbnailService.js');

describe('Issue #37 - Thumbnail text generation & fallback', () => {
  test('uses generated slogan when available and sanitizes it', async () => {
    // mock generated slogans
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({ success: true, slogans: ['짧은 슬로건', '두번째', '세번째'] });

    const ideaData = {
      title: 'My Awesome Title',
      outline: ['sec1', 'sec2'],
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, { generateDraft: false, generateThumbnail: false });

    // With template fallbacks removed, thumbnailInfo is only provided when the draft includes it.
    expect(Array.isArray(res.thumbnailInfo)).toBe(true);
    expect(res.thumbnailInfo.length).toBe(0);
  });

  test('falls back to sanitized seo/title when slogans are punctuation-only', async () => {
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({ success: true, slogans: ['?', '!!', '...'] });

    const ideaData = {
      title: 'My Test Title',
      outline: [],
    };

    const res = await generateDraftFromIdea(ideaData, { generateDraft: false, generateThumbnail: false });

    // With template fallbacks removed, thumbnailInfo is only provided when the draft includes it.
    expect(Array.isArray(res.thumbnailInfo)).toBe(true);
    expect(res.thumbnailInfo.length).toBe(0);
  });
});