import { jest } from '@jest/globals';

describe('kanbanService workspace fields', () => {
  beforeEach(() => {
    // common firebaseService mocks
    jest.resetModules();
  });

  test('addIdeaToKanban should prefer recommendedSearches for workspace.keywords and store longTail/recommended', async () => {
    const mockSet = jest.fn().mockResolvedValue();
    const mockPush = jest.fn().mockResolvedValue({ key: 'card-xyz', set: mockSet });
    const mockGetDb = jest.fn();

    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: mockGetDb,
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-xyz', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');

    const idea = {
      title: 'Title',
      description: 'Desc',
      tags: ['tag1', 'tag2'],
      recommendedSearches: ['optA', 'optB'],
      longTailKeywords: ['lt1', 'lt2'],
    };

    const res = await addIdeaToKanban(idea, 'ideas', null);

    expect(res.success).toBe(true);
    // pushResult.set should have been called and data should include workspace.* fields
    expect(mockSet).toHaveBeenCalled();
    const saved = mockSet.mock.calls[0][0];
    expect(saved.workspace).toBeDefined();
    expect(saved.workspace.keywords).toEqual(['optA', 'optB']);
    expect(saved.workspace.recommendedKeywords).toEqual(['optA', 'optB']);
    expect(saved.workspace.longTailKeywords).toEqual(['lt1', 'lt2']);
  });

  test('createAndSaveNewIdea should also prefer recommendedSearches for workspace.keywords', async () => {
    const mockPush = jest.fn().mockResolvedValue({ key: 'card-abc', set: jest.fn() });
    const mockSetTop = jest.fn().mockResolvedValue();
    jest.resetModules();

    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: mockPush,
      set: mockSetTop,
      cleanDataForFirebase: (d) => d,
    }));

    const { createAndSaveNewIdea } = await import('../js/services/kanbanService.js');

    const idea = {
      title: 'NewTitle',
      description: 'desc',
      keywords: ['k1', 'k2'],
      recommendedSearches: ['seo-1'],
      longTailKeywords: ['long-tail-1'],
    };

    const res = await createAndSaveNewIdea(idea, 'ideas', null);
    expect(res.success).toBe(true);

    expect(mockSetTop).toHaveBeenCalled();
    const saved = mockSetTop.mock.calls[0][1] ? mockSetTop.mock.calls[0][1] : mockSetTop.mock.calls[0][0];
    expect(saved.workspace.keywords).toEqual(['seo-1']);
    expect(saved.workspace.recommendedKeywords).toEqual(['seo-1']);
    expect(saved.workspace.longTailKeywords).toEqual(['long-tail-1']);
  });
});
