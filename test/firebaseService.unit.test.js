import { jest } from '@jest/globals';

// Mock authService.getValidToken to avoid external auth calls
jest.mock('../js/services/authService.js', () => ({
  getValidToken: jest.fn().mockResolvedValue(null),
}));

// Ensure we import the real firebaseService module (not mocked)
const svc = require('../js/services/firebaseService.js');

describe('firebaseService core helpers (unit)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // default chrome.storage mock
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}) } } };
  });

  test('internal URL generation used by requests produces expected path', async () => {
    const base = svc.firebaseConfig.databaseURL;

    // mock fetch used by push to capture constructed URL
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'k' }) });
    await svc.push('/a/b', { hello: 'world' });
    // first arg of fetch should include base and clean path (no leading slash) and .json
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain(`${base}/a/b.json`);

    // non-string path still throws (validation inside push)
    await expect(svc.push(123)).rejects.toThrow();
  });

  test('cleanDataForFirebase - removes undefined and preserves nested structures', () => {
    expect(svc.cleanDataForFirebase(undefined)).toBeNull();
    expect(svc.cleanDataForFirebase(null)).toBeNull();
    expect(svc.cleanDataForFirebase(42)).toBe(42);

    const input = {
      a: 1,
      b: undefined,
      c: { d: undefined, e: 'x' },
      arr: [1, undefined, { z: undefined, k: 2 }],
    };

    const cleaned = svc.cleanDataForFirebase(input);
    expect(cleaned).toEqual({ a: 1, c: { e: 'x' }, arr: [1, null, { k: 2 }] });
  });

  test('getCurrentUserId - returns googleUserId when present', async () => {
    global.chrome.storage.local.get.mockResolvedValue({ googleUserId: 'id-123' });
    const uid = await svc.getCurrentUserId();
    expect(uid).toBe('id-123');
  });

  test('getCurrentUserId - generates safe id from email', async () => {
    global.chrome.storage.local.get.mockResolvedValue({ googleUserEmail: 'User.Name+X@Example.COM' });
    const uid = await svc.getCurrentUserId();
    expect(uid).toBe('user_name_x_example_com');
  });

  test('getCurrentUserId - falls back to default on missing values or errors', async () => {
    global.chrome.storage.local.get.mockResolvedValue({});
    expect(await svc.getCurrentUserId()).toBe(svc.CONSTANTS.USER_ID);

    global.chrome.storage.local.get.mockRejectedValue(new Error('uh-oh'));
    expect(await svc.getCurrentUserId()).toBe(svc.CONSTANTS.USER_ID);
  });

  test('push - POST flow returns key and set function, rejects for non-string path', async () => {
    // mock fetch for push
    const fakeName = 'newKey123';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ name: fakeName }) });

    const res = await svc.push('some/path', { foo: 'bar' });
    expect(res).toHaveProperty('key', fakeName);
    expect(typeof res.set).toBe('function');

    await expect(svc.push(123)).rejects.toThrow();
  });

  test('set/get basic roundtrip uses fetch and returns expected shapes', async () => {
    // mock fetch response for set (PUT) and for get (GET)
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const setRes = await svc.set('path/one', { a: 1 });
    expect(setRes).toBe(true);

    const expectedData = { a: 1 };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => expectedData });
    const snap = await svc.get('path/one');
    expect(snap.exists()).toBe(true);
    expect(snap.val()).toEqual(expectedData);
  });
});
