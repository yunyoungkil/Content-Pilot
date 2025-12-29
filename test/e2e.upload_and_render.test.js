import { jest } from '@jest/globals';

// End-to-end style test: uploadImageToFirebaseStorage -> getUploadedImagesLog -> thumbnail maker UI render

describe('E2E: upload -> DB metadata -> UI render', () => {
  const USER_ID = '113959899989339493619';
  const TS = 1766221585603;
  const filename = '1766221584307_0.png';
  const path = `thumbnails/${USER_ID}/${filename}`;
  const permalink = 'post-xyz';

  beforeEach(() => {
    jest.resetModules();
    // stub Date.now
    jest.spyOn(Date, 'now').mockReturnValue(TS);

    // chrome.storage.local.get mock for getCurrentUserId
    global.chrome = global.chrome || {};
    global.chrome.storage = global.chrome.storage || {};
    global.chrome.storage.local = global.chrome.storage.local || {};
    global.chrome.storage.local.get = jest.fn().mockImplementation((keys) => {
      // Support both array and single-key calls
      if (Array.isArray(keys)) {
        return Promise.resolve({
          googleUserId: USER_ID,
          googleUserEmail: 'test@example.test',
          googleAuthToken: 'fake-token',
          googleAuthTokenExpiry: Date.now() + 3600000,
          googleAuthTokenIssued: Date.now(),
        });
      }
      if (typeof keys === 'string' && keys === 'googleAuthToken') {
        return Promise.resolve({ googleAuthToken: 'fake-token' });
      }
      return Promise.resolve({});
    });

    // Minimal canvas getContext stub (thumbnail maker will query canvas)
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        canvas: { width: 640, height: 360 },
        save: () => {},
        restore: () => {},
        measureText: (txt) => ({ width: (txt || '').length * 6 }),
        fillRect: () => {},
        drawImage: () => {},
        clearRect: () => {},
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        strokeText: () => {},
        fillText: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        getImageData: () => ({ data: new Uint8ClampedArray(4 * 10) }),
        putImageData: () => {},
      };
    };

    // fetch mock: userinfo -> storage upload -> DB PUT -> DB GET
    global.fetch = jest.fn((url, opts) => {
      // Google userinfo validation
      if (String(url).includes('www.googleapis.com/oauth2/v3/userinfo')) {
        return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.test', sub: 'uid-1' }) });
      }

      // storage upload call
      if (String(url).includes('firebasestorage.googleapis.com')) {
        return Promise.resolve({ ok: true, json: async () => ({ downloadTokens: 'tok' }) });
      }

      // DB PUT (set) to thumbnail_images/{userId}/{TS}.json
      if (String(url).includes(`/thumbnail_images/${USER_ID}/${TS}.json`)) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }

      // DB GET to thumbnail_images/{userId}.json
      if (String(url).includes(`/thumbnail_images/${USER_ID}.json`)) {
        const downloadURL = `https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=tok`;
        const data = {};
        data[TS] = {
          path,
          storagePath: `gs://content-pilot-7eb03.firebasestorage.app/${path}`,
          downloadURL,
          timestamp: TS,
          size: 12345,
          permalink,
        };
        return Promise.resolve({ ok: true, json: async () => data });
      }

      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('uploadImageToFirebaseStorage stores metadata and thumbnail maker UI shows it', async () => {
    const firebaseSvc = require('../js/services/firebaseService.js');
    const download = await firebaseSvc.uploadImageToFirebaseStorage('data:image/png;base64,AAA', path, USER_ID, { permalink });

    expect(typeof download === 'string').toBe(true);
    expect(download).toContain(filename);

    // Now get uploaded images via service
    const images = await firebaseSvc.getUploadedImagesLog();
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBeGreaterThanOrEqual(1);
    const found = images.some((i) => i.permalink === permalink && i.downloadURL && i.path === path);
    expect(found).toBe(true);

    // Wire chrome.runtime.sendMessage to use firebase service's getUploadedImagesLog for 'get_uploaded_images_log'
    global.chrome.runtime = global.chrome.runtime || {};
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (msg && msg.action === 'get_uploaded_images_log') {
        firebaseSvc.getUploadedImagesLog().then((imgs) => cb({ success: true, images: imgs }));
        return;
      }
      if (typeof cb === 'function') cb({ success: true });
    });

    // render UI and assert image appears
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');
    const draftData = { formattedDraft: '<p></p>', permalink };

    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // wait for async renderReferenceImages
    await new Promise((r) => setTimeout(r, 300));

    const aiWrapper = document.querySelector('#tm-ref-images-below');
    expect(aiWrapper).toBeTruthy();
    const imgs = Array.from(aiWrapper.querySelectorAll('img'));
    const uiFound = imgs.some((i) => i.src === images[0].downloadURL);
    expect(uiFound).toBe(true);
  }, 10000);
});