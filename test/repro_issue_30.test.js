
import { jest } from '@jest/globals';
import { normalizeSeoTitle, applyDraftResponseToIdea } from '../js/ui/workspaceMode.js';

// Mock Logger
global.Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('Issue #30 Reproduction: SEO Title Duplication', () => {
  const ideaTitle = 'My Great Idea';

  test('normalizeSeoTitle should collapse exact duplicates', () => {
    expect(normalizeSeoTitle('My Great Idea My Great Idea', ideaTitle)).toBe(ideaTitle);
    expect(normalizeSeoTitle('My Great Idea - My Great Idea', ideaTitle)).toBe(ideaTitle);
    expect(normalizeSeoTitle('My Great Idea | My Great Idea', ideaTitle)).toBe(ideaTitle);
    expect(normalizeSeoTitle('My Great Idea : My Great Idea', ideaTitle)).toBe(ideaTitle);
  });

  test('normalizeSeoTitle should NOT collapse if different', () => {
    expect(normalizeSeoTitle('My Great Idea - Subtitle', ideaTitle)).toBe('My Great Idea - Subtitle');
    expect(normalizeSeoTitle('Prefix - My Great Idea', ideaTitle)).toBe('Prefix - My Great Idea');
  });

  test('applyDraftResponseToIdea should normalize seoTitle from response', () => {
    const ideaData = {
      id: 'test-id',
      title: ideaTitle,
      publishInfo: {}
    };
    
    // Simulate AI returning duplicated title
    const response = {
      seoTitle: 'My Great Idea - My Great Idea',
      draft: '# My Great Idea\n\nContent...'
    };

    applyDraftResponseToIdea(ideaData, response);

    expect(ideaData.publishInfo.seoTitle).toBe(ideaTitle);
  });

  test('applyDraftResponseToIdea should handle case where seoTitle equals title', () => {
    const ideaData = {
      id: 'test-id',
      title: ideaTitle,
      publishInfo: {}
    };
    
    const response = {
      seoTitle: ideaTitle,
      draft: '# My Great Idea\n\nContent...'
    };

    applyDraftResponseToIdea(ideaData, response);

    expect(ideaData.publishInfo.seoTitle).toBe(ideaTitle);
  });

  test('applyDraftResponseToIdea should handle case where seoTitle is missing in response', () => {
    const ideaData = {
      id: 'test-id',
      title: ideaTitle,
      publishInfo: {
        seoTitle: 'Existing SEO Title'
      }
    };
    
    const response = {
      draft: '# My Great Idea\n\nContent...'
    };

    applyDraftResponseToIdea(ideaData, response);

    // Should preserve existing if not provided? 
    // Actually applyDraftResponseToIdea might overwrite it if it extracts from draft?
    // Let's check implementation.
  });
});
