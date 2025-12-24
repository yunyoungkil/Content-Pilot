const { applyDraftResponseToIdea } = require('../js/ui/workspaceMode.js');

describe('applyDraftResponseToIdea', () => {
  it('applies draft response into ideaData correctly', () => {
    const idea = { id: 'i1', title: 'T' };
    const resp = {
      draft: '<p>hi</p>',
      permalink: 'p',
      tags: ['a'],
      seoTitle: 'S',
      metaDescription: 'D',
      thumbnailUrls: { url_16x9: 'u' },
      jsonLdSchema: { headline: 'H' },
      thumbnailPrompts: {
        curiosity: ['a','b'],
        info: ['c'],
        empathy: ['d']
      },
      thumbnailInfo: [{ type: 'curiosity', thumbnailText: 'A' }]
    };

    const out = applyDraftResponseToIdea(idea, resp);
    expect(out.publishInfo).toBeTruthy();
    expect(out.publishInfo.permalink).toBe('p');
    expect(out.publishInfo.seoTitle).toBe('S');
    expect(out.publishInfo.description).toBe('D');
    expect(out.publishInfo.thumbnailUrls.url_16x9).toBe('u');
    expect(out.publishInfo.jsonLdSchema.headline).toBe('H');
    expect(out.publishInfo.thumbnailPrompts).toBeTruthy();
    expect(Array.isArray(out.publishInfo.thumbnailPrompts.curiosity)).toBe(true);
    expect(out.publishInfo.thumbnailInfo).toBeTruthy();
    expect(Array.isArray(out.publishInfo.thumbnailInfo)).toBe(true);
  });
});