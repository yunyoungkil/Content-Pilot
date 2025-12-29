import { jest } from '@jest/globals';

// Ensure getValidToken returns a fake token in tests that exercise upload flow
jest.mock('../js/services/authService.js', () => ({
  getValidToken: jest.fn().mockResolvedValue('FAKE_TOKEN'),
}));

describe('firebaseService tombstone behavior', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('uploadImageToFirebaseStorage throws when path is tombstoned', async () => {
    // import module and spy on isThumbnailDeleted
    const svc = await import('../js/services/firebaseService.js');

    // minimal valid data URL (small png header)
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
    const path = 'thumbnails/user/tombstone-test.png';

    // set in-memory test tombstone to simulate an existing tombstone entry
    svc.__TEST_markTombstone('test-user', path);

    await expect(svc.uploadImageToFirebaseStorage(dataUrl, path, 'test-user')).rejects.toThrow(
      'upload blocked: tombstoned path'
    );

    // cleanup in-memory test tombstones to avoid leaking state between tests
    svc.__TEST_tombstones = {};
  });

  test('markDeletedThumbnail and isThumbnailDeleted use DB-safe keys (no % or / in path)', async () => {
    const svc = await import('../js/services/firebaseService.js');

    // Mock fetch to capture the DB URL used by set/get
    const originalFetch = global.fetch;
    const fakeFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) , text: async () => '{}' });
    global.fetch = fakeFetch;

    const path = 'thumbnails/113959899989339493619/1766813169308_0.png';
    await svc.markDeletedThumbnail('test-user', path);
    expect(fakeFetch).toHaveBeenCalled();
    const urlUsed = fakeFetch.mock.calls[0][0];
    // The URL should include deleted_thumbnails/test-user/<key>.json
    expect(urlUsed).toContain('deleted_thumbnails/test-user/');
    const keyPart = urlUsed.split('deleted_thumbnails/test-user/')[1].split('.json')[0];

    // URL-decoded key should not contain '%' or raw '/'
    expect(decodeURIComponent(keyPart).includes('%')).toBe(false);
    expect(decodeURIComponent(keyPart).includes('/')).toBe(false);

    // isThumbnailDeleted should also call fetch with the same safe key
    fakeFetch.mockClear();
    await svc.isThumbnailDeleted('test-user', path);
    expect(fakeFetch).toHaveBeenCalled();
    const urlUsed2 = fakeFetch.mock.calls[0][0];
    const keyPart2 = urlUsed2.split('deleted_thumbnails/test-user/')[1].split('.json')[0];
    expect(decodeURIComponent(keyPart2).includes('%')).toBe(false);
    expect(decodeURIComponent(keyPart2).includes('/')).toBe(false);

    // restore
    global.fetch = originalFetch;
  });

  test('uploadImageToFirebaseStorage updates existing thumbnail_images entry instead of creating new one', async () => {
    const svc = await import('../js/services/firebaseService.js');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
    const path = 'thumbnails/test-user/foo.png';
    const userId = 'test-user';

    // Prepare fetch mock to handle sequence: tombstone GET -> storage POST -> get thumbnail_images -> PATCH
    const fakeFetch = jest.fn().mockImplementation((url, opts) => {
      // tombstone check GET to deleted_thumbnails
      if (url.includes('/deleted_thumbnails/')) {
        return Promise.resolve({ ok: true, json: async () => null, text: async () => 'null' });
      }
      // storage upload POST to firebasestorage
      if (url.startsWith('https://firebasestorage.googleapis.com/')) {
        return Promise.resolve({ ok: true, json: async () => ({ downloadTokens: 'tok' }) });
      }
      // GET thumbnail_images for user
      if (url.includes(`/thumbnail_images/${userId}.json`)) {
        const bucket = svc.firebaseConfig.storageBucket;
        const storagePath = `gs://${bucket}/${path}`;
        return Promise.resolve({ ok: true, json: async () => ({ existingKey: { storagePath, downloadURL: 'https://old', path } }) });
      }
      // PATCH to existing entry - simulate success
      if (opts && opts.method === 'PATCH' && url.includes('/thumbnail_images/')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      // Fallback for set etc
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const originalFetch = global.fetch;
    global.fetch = fakeFetch;

    await svc.uploadImageToFirebaseStorage(dataUrl, path, userId);

    // Find a call with method PATCH to thumbnail_images/{userId}/existingKey.json
    const patchCalled = fakeFetch.mock.calls.some((call) => {
      const [callUrl, callOpts] = call;
      return callOpts && callOpts.method === 'PATCH' && callUrl.includes(`/thumbnail_images/${userId}/existingKey.json`);
    });
    expect(patchCalled).toBe(true);

    global.fetch = originalFetch;
  });
});
