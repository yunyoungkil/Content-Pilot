describe('ensureInternalLinkSection', () => {
  beforeEach(() => {
    // Reset module cache so module-level warned flag is reset
    jest.resetModules();
  });

  test('keeps existing internal link', () => {
    const ai = require('../js/services/aiService.js');
    const prompt = '제목\n[내 과거 포스팅 목록 (내부 링크 추천용)]\n1. 제목: 예시\n   URL: https://example.com/post';
    const res = ai.ensureInternalLinkSection(prompt);
    expect(res.hadInternalLinks).toBe(true);
    expect(res.addedPlaceholder).toBe(false);
    expect(res.prompt).toBe(prompt);
  });

  test('adds placeholder when missing and warns only once', () => {
    const ai = require('../js/services/aiService.js');
    const prompt = '이 프롬프트에는 내부 링크가 없습니다.';
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res1 = ai.ensureInternalLinkSection(prompt);
    const res2 = ai.ensureInternalLinkSection(prompt);

    expect(res1.addedPlaceholder).toBe(true);
    expect(res2.addedPlaceholder).toBe(true);
    // The warn should only be called once due to the module-level flag
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});