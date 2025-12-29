import { jest } from '@jest/globals';

describe('generateAiImage meta forwarding', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('passes permalink to uploadImageToFirebaseStorage', async () => {
    // mock fetch to return a candidate with inlineData
    global.fetch = jest.fn((url, opts) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        return Promise.resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'R0lGODdhAQABAIAAAAUEBA==', mimeType: 'image/png' } }] } }] }) });
      }
      if (String(url).includes('firebasestorage.googleapis.com')) {
        return Promise.resolve({ ok: true, json: async () => ({ downloadTokens: 'tok' }) });
      }
      // DB calls
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    // mock chrome.storage for geminiApiKey
    global.chrome = global.chrome || {};
    global.chrome.storage = global.chrome.storage || {};
    global.chrome.storage.local = global.chrome.storage.local || {};
    global.chrome.storage.local.get = jest.fn().mockResolvedValue({ geminiApiKey: 'fake-key' });

    const svc = require('../js/services/aiService.js');
    const firebaseSvc = require('../js/services/firebaseService.js');

    const spy = jest.spyOn(firebaseSvc, 'uploadImageToFirebaseStorage').mockResolvedValue('https://storage.test/uploaded.png');

    const permalink = 'p-test-123';
    const res = await svc.generateAiImage('prompt', 1, null, permalink);

    expect(Array.isArray(res)).toBe(true);
    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    // 4th arg (meta) should be present and include permalink
    expect(lastCall[3]).toBeTruthy();
    expect(lastCall[3].permalink).toBe(permalink);

    jest.restoreAllMocks();
    delete global.fetch;
  });
});