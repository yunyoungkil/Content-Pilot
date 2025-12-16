
import { jest } from '@jest/globals';
import { applyDraftResponseToIdea } from '../js/ui/workspaceMode.js';
import { normalizeSeoTitle } from '../js/utils.js';

// Mock Logger
global.Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// Mock Chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn((msg, cb) => {
      if (cb) cb({ success: true });
    }),
  },
  storage: {
    local: {
      get: jest.fn((keys, cb) => cb({})),
      set: jest.fn((data, cb) => {
        if (cb) cb();
      }),
    },
  },
};

describe('Integration Test: Issue #30 SEO Title Duplication', () => {
  const ideaTitle = 'My Great Idea';
  
  // 1. Simulate Idea Creation
  const createIdea = (title) => {
    return {
      id: 'idea-123',
      title: title,
      seoTitle: title, // Default behavior on creation
      publishInfo: {},
      draftContent: '',
    };
  };

  // 2. Simulate AI Draft Generation (mocking aiService logic)
  const generateDraft = (ideaData) => {
    // AI often repeats the title in H1
    const draftContent = `# ${ideaData.title}\n\nHere is the content...`;
    
    // aiService extracts H1 as seoTitle
    const seoTitle = ideaData.title; 
    
    return {
      success: true,
      draft: draftContent,
      seoTitle: seoTitle,
      cleanedDraft: `<h1>${ideaData.title}</h1><p>Here is the content...</p>`
    };
  };

  // 3. Simulate AI Draft Generation with Duplication (Hallucination)
  const generateDraftWithDuplication = (ideaData) => {
    const duplicatedTitle = `${ideaData.title} - ${ideaData.title}`;
    const draftContent = `# ${duplicatedTitle}\n\nHere is the content...`;
    
    return {
      success: true,
      draft: draftContent,
      seoTitle: duplicatedTitle,
      cleanedDraft: `<h1>${duplicatedTitle}</h1><p>Here is the content...</p>`
    };
  };

  test('Full Flow: Create -> Generate -> Apply (Normal)', () => {
    const idea = createIdea(ideaTitle);
    const aiResponse = generateDraft(idea);
    
    applyDraftResponseToIdea(idea, aiResponse);
    
    // Should be normalized to just the title
    expect(idea.publishInfo.seoTitle).toBe(ideaTitle);
  });

  test('Full Flow: Create -> Generate -> Apply (Duplicated)', () => {
    const idea = createIdea(ideaTitle);
    const aiResponse = generateDraftWithDuplication(idea);
    
    applyDraftResponseToIdea(idea, aiResponse);
    
    // Should be normalized to just the title
    expect(idea.publishInfo.seoTitle).toBe(ideaTitle);
  });

  test('Full Flow: Create -> Generate -> Apply (Duplicated with Colon)', () => {
    const idea = createIdea(ideaTitle);
    const aiResponse = {
        success: true,
        draft: `# ${ideaTitle} : ${ideaTitle}\n\nContent`,
        seoTitle: `${ideaTitle} : ${ideaTitle}`
    };
    
    applyDraftResponseToIdea(idea, aiResponse);
    
    // Should be normalized to just the title
    expect(idea.publishInfo.seoTitle).toBe(ideaTitle);
  });
});
