import { applyDraftResponseToIdea } from '../js/ui/workspaceMode.js';

describe('workspaceMode.applyDraftResponseToIdea', () => {
  test('applies seoTitle into publishInfo and top-level', () => {
    const idea = { id: 'card-1', title: 'Idea Title', publishInfo: {} };
    const resp = {
      draft: '# New SEO Title\n\nContent here',
      seoTitle: 'New SEO Title',
      permalink: 'new-seo-title',
      tags: ['tag1', 'tag2'],
      jsonLdSchema: { headline: 'New SEO Title', description: 'desc' },
      thumbnailUrls: { url_16x9: 'https://img.test/16x9.png' },
    };

    const updated = applyDraftResponseToIdea(idea, resp);

    expect(updated.draftContent).toBe(resp.draft);
    expect(updated.workspace.draft).toBe(resp.draft);
    expect(updated.seoTitle).toBe('New SEO Title');
    expect(updated.publishInfo.seoTitle).toBe('New SEO Title');
    expect(updated.publishInfo.permalink).toBe('new-seo-title');
    expect(updated.publishInfo.tags).toEqual(['tag1', 'tag2']);
    expect(updated.publishInfo.jsonLdSchema).toEqual(resp.jsonLdSchema);
    expect(updated.publishInfo.thumbnailUrls).toEqual(resp.thumbnailUrls);
  });

  test('normalizes duplicated seoTitle that repeats the idea title', () => {
    const idea = { id: 'card-2', title: 'Idea Title', publishInfo: {} };
    const resp = { seoTitle: 'Idea Title Idea Title', draft: '# Draft' };

    const updated = applyDraftResponseToIdea(idea, resp);
    expect(updated.seoTitle).toBe('Idea Title');
    expect(updated.publishInfo.seoTitle).toBe('Idea Title');
  });

  test('normalizes duplicated seoTitle with separator', () => {
    const idea = { id: 'card-3', title: 'Cool Idea', publishInfo: {} };
    const resp = { seoTitle: 'Cool Idea - Cool Idea', draft: '# Draft' };

    const updated = applyDraftResponseToIdea(idea, resp);
    expect(updated.seoTitle).toBe('Cool Idea');
    expect(updated.publishInfo.seoTitle).toBe('Cool Idea');
  });
});
