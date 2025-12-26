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
    // debug: ensure the in-memory tombstone was set
    // eslint-disable-next-line no-console
    console.debug('DBG: tombstones:', svc.__TEST_tombstones);

    await expect(svc.uploadImageToFirebaseStorage(dataUrl, path, 'test-user')).rejects.toThrow('upload blocked: tombstoned path');

    // cleanup in-memory test tombstones to avoid leaking state between tests
    svc.__TEST_tombstones = {};
  });
});