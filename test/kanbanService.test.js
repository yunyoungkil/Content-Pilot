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

  test('addIdeaToKanban should log raw response when generate_idea_briefing returns failure without error field', async () => {
    jest.resetModules();
    const mockSet = jest.fn().mockResolvedValue();
    const mockPush = jest.fn().mockResolvedValue({ key: 'card-zzz', set: mockSet });
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-zzz', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    // Provide a chrome runtime sendMessage mock that calls callback with an 'unknown' response
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((payload, cb) => cb && cb({ success: false })),
      },
      storage: { local: { get: jest.fn(), set: jest.fn() } },
      tabs: { query: jest.fn((opts, cb) => cb && cb([])) },
    };

    // Spy on console.error so we can assert the message was logged
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');

    const idea = { title: 'Title2', description: 'Desc', keywords: ['#AI-추천'] };
    await addIdeaToKanban(idea, 'ideas', null);

    // Expect at least one call to console.error for the AI briefing failure logging
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('addIdeaToKanban should handle generate_idea_briefing timeout gracefully', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const mockSet = jest.fn().mockResolvedValue();
    const mockPush = jest.fn().mockResolvedValue({ key: 'card-timeout', set: mockSet });
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-timeout', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    // Provide a chrome runtime sendMessage mock that never calls its callback
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
      },
      storage: { local: { get: jest.fn(), set: jest.fn() } },
      tabs: { query: jest.fn((opts, cb) => cb && cb([])) },
    };

    // Spy on console.error so we can assert the message was logged
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');

    const idea = { title: 'TimeoutTitle', description: 'Desc', keywords: ['#AI-추천'] };
    await addIdeaToKanban(idea, 'ideas', null);

    // Fast forward timer to simulate timeout in helper
    jest.advanceTimersByTime(3500);
    // Ensure pending timer callbacks are run and microtasks processed
    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  test('addIdeaToKanban should call generateIdeaBriefing for AI-generated (similar idea) uploads', async () => {
    jest.resetModules();
    const mockSet = jest.fn().mockResolvedValue();
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-sim', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    // Mock sendRuntimeMessageWithTimeout to capture payload
    const sendMessageMock = jest.fn().mockResolvedValue({ success: true });
    jest.doMock('../js/utils.js', () => ({
      Logger: { debug: jest.fn(), biz: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      showToast: jest.fn(),
      sendRuntimeMessageWithTimeout: sendMessageMock,
    }));

    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');
    const idea = { title: 'SimTitle', description: 'SimDesc', keywords: ['tag1', '#유사-아이디어'] };

    const res = await addIdeaToKanban(idea, 'ideas', null);
    expect(res.success).toBe(true);

    // ensure the sendRuntimeMessageWithTimeout was called with a payload that includes generate_idea_briefing
    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.action).toBe('generate_idea_briefing');
    // options should include originType 'ai_generated' or include '#유사-아이디어'
    const ops = callArgs?.options || {};
    expect(ops.originType === 'ai_generated' || ops.origin?.type === 'ai_generated').toBeTruthy();
  });

  test('addIdeaToKanban should call generateIdeaBriefing for renewal suggestions', async () => {
    jest.resetModules();
    const mockSet = jest.fn().mockResolvedValue();
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-renew', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    const sendMessageMock = jest.fn().mockResolvedValue({ success: true });
    jest.doMock('../js/utils.js', () => ({
      Logger: { debug: jest.fn(), biz: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      showToast: jest.fn(),
      sendRuntimeMessageWithTimeout: sendMessageMock,
    }));

    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');
    const idea = { title: 'RenewTitle', description: 'RenewDesc', keywords: ['tag2', '#리뉴얼-제안'] };

    const res = await addIdeaToKanban(idea, 'ideas', null);
    expect(res.success).toBe(true);
    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.action).toBe('generate_idea_briefing');
    const ops = callArgs?.options || {};
    expect(ops.originType === 'ai_generated' || ops.origin?.type === 'ai_generated').toBeTruthy();
  });

  test('addIdeaToKanban should call generateIdeaBriefing for scrap conversions', async () => {
    jest.resetModules();
    const mockSet = jest.fn().mockResolvedValue();
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-scrap', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    const sendMessageMock = jest.fn().mockResolvedValue({ success: true });
    jest.doMock('../js/utils.js', () => ({
      Logger: { debug: jest.fn(), biz: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      showToast: jest.fn(),
      sendRuntimeMessageWithTimeout: sendMessageMock,
    }));

    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');
    const idea = {
      title: 'ScrapTitle',
      description: 'ScrapDesc',
      keywords: ['tag3', '#스크랩-전환'],
      origin: { type: 'scrap', postUrl: 'https://example.com/scrap/123' },
    };

    const res = await addIdeaToKanban(idea, 'ideas', null);
    expect(res.success).toBe(true);

    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.action).toBe('generate_idea_briefing');
    const ops = callArgs?.options || {};
    expect(ops.originType === 'scrap' || ops.origin?.type === 'scrap').toBeTruthy();
  });

  test('addIdeaToKanban should call generateIdeaBriefing for my_post origin', async () => {
    jest.resetModules();
    const mockSet = jest.fn().mockResolvedValue();
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      getDb: jest.fn(),
      ref: jest.fn(),
      push: (ref) => ({ key: 'card-mypost', set: mockSet }),
      set: jest.fn(),
      cleanDataForFirebase: (d) => d,
    }));

    const sendMessageMock = jest.fn().mockResolvedValue({ success: true });
    jest.doMock('../js/utils.js', () => ({
      Logger: { debug: jest.fn(), biz: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      showToast: jest.fn(),
      sendRuntimeMessageWithTimeout: sendMessageMock,
    }));

    const { addIdeaToKanban } = await import('../js/services/kanbanService.js');
    const idea = {
      title: 'MyPostTitle',
      description: 'MyPostDesc',
      origin: { type: 'my_post', postUrl: 'https://example.com/post/789' },
    };

    const res = await addIdeaToKanban(idea, 'ideas', null);
    expect(res.success).toBe(true);

    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.action).toBe('generate_idea_briefing');
    const ops = callArgs?.options || {};
    expect(ops.originType === 'my_post' || ops.origin?.type === 'my_post').toBeTruthy();
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
