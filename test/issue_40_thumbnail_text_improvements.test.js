// Test for Issue #40 - Thumbnail text improvements
const { generateDraftFromIdea } = require('../js/services/aiService.js');

jest.mock('../js/services/thumbnailService.js', () => ({
  generateThumbnailTexts: jest.fn(),
}));

const thumbnailService = require('../js/services/thumbnailService.js');

describe('Issue #40 - Thumbnail text generation improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sanitizes punctuation-only slogan to meaningful fallback text', async () => {
    // Mock AI returning punctuation-only slogans
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({
      success: true,
      slogans: ['?', '!!', '...'],
    });

    const ideaData = {
      title: '스마트홈 완벽 가이드',
      outline: ['소개', '설치 방법', '사용 팁'],
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, {
      generateDraft: false,
      generateThumbnail: false,
    });

    expect(res.thumbnailInfo).toBeDefined();
    expect(Array.isArray(res.thumbnailInfo)).toBe(true);
    expect(res.thumbnailInfo.length).toBeGreaterThan(0);

    // Should not use punctuation-only text, should use sanitized title instead
    res.thumbnailInfo.forEach((thumb) => {
      expect(thumb.thumbnailText).toBeDefined();
      expect(thumb.thumbnailText).not.toBe('?');
      expect(thumb.thumbnailText).not.toBe('!!');
      expect(thumb.thumbnailText).not.toBe('...');
      // Should contain at least one letter or number
      expect(/[\p{L}\p{N}]/u.test(thumb.thumbnailText)).toBe(true);
      // Should be 12 chars or less
      expect(thumb.thumbnailText.length).toBeLessThanOrEqual(12);
    });
  });

  test('does not use full title as thumbnailText when title is long', async () => {
    // Mock AI returning empty slogans (fallback scenario)
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({
      success: true,
      slogans: ['', '', ''],
    });

    const ideaData = {
      title: '이것은 매우 긴 제목으로 썸네일 텍스트로 그대로 사용하면 안됩니다',
      outline: ['섹션1', '섹션2', '섹션3'],
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, {
      generateDraft: false,
      generateThumbnail: false,
    });

    expect(res.thumbnailInfo).toBeDefined();
    expect(Array.isArray(res.thumbnailInfo)).toBe(true);

    // Should truncate to 12 chars max and remove punctuation
    res.thumbnailInfo.forEach((thumb) => {
      expect(thumb.thumbnailText).toBeDefined();
      expect(thumb.thumbnailText.length).toBeLessThanOrEqual(12);
      expect(thumb.thumbnailText).not.toBe(ideaData.title); // Should not be the full title
      // Should not have only punctuation
      expect(/[\p{L}\p{N}]/u.test(thumb.thumbnailText)).toBe(true);
    });
  });

  test('uses generated slogan when AI returns meaningful text', async () => {
    // Mock AI returning good slogans
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({
      success: true,
      slogans: ['집 전체를 손끝으로', '미래가 온다', '완벽 제어'],
    });

    const ideaData = {
      title: '스마트홈 가이드',
      outline: ['소개', '설치', '사용'],
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, {
      generateDraft: false,
      generateThumbnail: false,
    });

    expect(res.thumbnailInfo).toBeDefined();
    expect(res.thumbnailInfo.length).toBeGreaterThan(0);

    // First thumbnail should use the first slogan
    expect(res.thumbnailInfo[0].thumbnailText).toBe('집 전체를 손끝으로');
  });

  test('strips punctuation from meaningful text while keeping the core message', async () => {
    // Mock AI returning text with trailing punctuation
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({
      success: true,
      slogans: ['이거 실화냐?!', '완벽 정리!!!', '...미래가 온다...'],
    });

    const ideaData = {
      title: '테스트 제목',
      outline: ['섹션1', '섹션2', '섹션3'],
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, {
      generateDraft: false,
      generateThumbnail: false,
    });

    expect(res.thumbnailInfo).toBeDefined();

    // Should strip trailing/leading punctuation but keep core text
    expect(res.thumbnailInfo[0].thumbnailText).toBe('이거 실화냐');
    expect(res.thumbnailInfo[1].thumbnailText).toBe('완벽 정리');
    expect(res.thumbnailInfo[2].thumbnailText).toBe('미래가 온다');
  });

  test('handles empty outline array gracefully', async () => {
    // Mock should not be called when outline is empty
    thumbnailService.generateThumbnailTexts.mockResolvedValueOnce({
      success: false,
      error: '목차 배열이 필요합니다.',
      slogans: [],
    });

    const ideaData = {
      title: '기본 제목',
      outline: [], // Empty outline
      publishInfo: {},
    };

    const res = await generateDraftFromIdea(ideaData, {
      generateDraft: false,
      generateThumbnail: false,
    });

    expect(res.thumbnailInfo).toBeDefined();

    // Should still generate default thumbnail candidates with sanitized fallback
    res.thumbnailInfo.forEach((thumb) => {
      expect(thumb.thumbnailText).toBeDefined();
      expect(/[\p{L}\p{N}]/u.test(thumb.thumbnailText)).toBe(true);
      expect(thumb.thumbnailText.length).toBeLessThanOrEqual(12);
    });
  });
});
