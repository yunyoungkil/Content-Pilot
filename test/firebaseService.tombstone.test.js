import { jest } from '@jest/globals';

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
});
