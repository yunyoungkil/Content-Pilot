import { jest } from '@jest/globals';

describe('E2E: AI generate -> DB metadata visible -> UI render', () => {
  const USER_ID = '113959899989339493619';
  const TS = 1766221585603;
  const generatedUrl = 'https://storage.test/generated_from_ai.png';
  const permalink = 'post-ai-123';

  beforeEach(() => {
    jest.resetModules();

    // chrome.storage mock returning user id and token
    global.chrome = global.chrome || {};
    global.chrome.storage = global.chrome.storage || {};
    global.chrome.storage.local = global.chrome.storage.local || {};
    global.chrome.storage.local.get = jest.fn((keys) => {
      return Promise.resolve({
        googleUserId: USER_ID,
        googleUserEmail: 'ai@test.test',
        googleAuthToken: 'fake-token',
        googleAuthTokenExpiry: Date.now() + 3600000,
        googleAuthTokenIssued: Date.now(),
      });
    });

    // canvas stub
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

    // chrome.runtime.sendMessage mock
    global.chrome.runtime = global.chrome.runtime || {};
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (msg && msg.action === 'ai_generate_images') {
        // Simulate background generation returning a storage URL
        const resp = { success: true, images: [generatedUrl], diagnostics: { inputCount: 0, converted: 0 } };
        if (typeof cb === 'function') cb(resp);
        return;
      }

      if (msg && msg.action === 'get_uploaded_images_log') {
        // After generation, DB log contains an entry with permalink
        const data = [
          {
            id: 'AI_GEN_1',
            path: `thumbnails/${USER_ID}/ai-${Date.now()}.png`,
            downloadURL: generatedUrl,
            storagePath: `gs://content-pilot-7eb03.firebasestorage.app/thumbnails/${USER_ID}/ai-${Date.now()}.png`,
            timestamp: TS,
            permalink,
          },
        ];
        if (typeof cb === 'function') cb({ success: true, images: data });
        return;
      }

      // default
      if (typeof cb === 'function') cb({ success: true });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.chrome.runtime;
  });

  test('AI generation flow shows immediate image and later DB-backed image in UI', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    // open modal with permalink set
    const draftData = { formattedDraft: '<p></p>', permalink };
    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // click generate button
    const genBtn = document.querySelector('#tm-gen-bg');
    expect(genBtn).toBeTruthy();
    genBtn.click();

    // Wait briefly for immediate insert
    await new Promise((r) => setTimeout(r, 200));

    const aiWrapper = document.querySelector('#tm-ref-images-below');
    expect(aiWrapper).toBeTruthy();

    const imgs = Array.from(aiWrapper.querySelectorAll('img'));
    const foundImmediate = imgs.some((i) => i.src === generatedUrl);
    expect(foundImmediate).toBe(true);

    // Wait for renderReferenceImages refresh that queries DB log
    await new Promise((r) => setTimeout(r, 300));

    const imgsAfter = Array.from(aiWrapper.querySelectorAll('img'));
    const foundPersist = imgsAfter.some((i) => i.src === generatedUrl);
    expect(foundPersist).toBe(true);

    // Ensure ai_generate_images was called at least once
    const aiCalls = global.chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'ai_generate_images');
    expect(aiCalls.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});