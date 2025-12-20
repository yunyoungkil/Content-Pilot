/* test/thumbnailMaker.ui.test.js */

const fs = require('fs');
const path = require('path');

jest.dontMock('fs');

describe('ThumbnailMaker UI - reference images', () => {
  beforeAll(() => {
    // Jest runs with jsdom environment, ensure globals exist
    global.chrome = global.chrome || {};
    global.chrome.runtime = global.chrome.runtime || {};
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      // default mock: call callback with a fake success
      if (typeof cb === 'function')
        cb({ success: true, images: ['https://images.test/generated.png'] });
    });
    // stub window.alert to avoid jsdom not-implemented error
    global.alert = global.alert || jest.fn();
  });

  afterAll(() => {
    delete global.chrome;
  });

  test('renders reference images from formattedDraft and includes references when generating', async () => {
    // load module under test
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    // draftData with inline images
    const draftData = {
      formattedDraft:
        '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
      affiliateLinks: [],
    };

    // mock canvas.getContext to avoid jsdom not-implemented errors
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

    // render into body
    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    // check that tm-ref-images contains img elements
    const refWrapper = document.querySelector('#tm-ref-images');
    expect(refWrapper).toBeTruthy();
    const imgs = refWrapper.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThanOrEqual(1);

    // click generate and assert runtime.sendMessage called with references
    const genBtn = document.querySelector('#tm-gen-bg');
    expect(genBtn).toBeTruthy();

    // reset mock
    global.chrome.runtime.sendMessage.mockClear();

    // simulate click
    genBtn.click();

    // allow for async handler to run
    await new Promise((r) => setTimeout(r, 200));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
    const firstCall = global.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(firstCall.action).toBe('ai_generate_images');
    expect(Array.isArray(firstCall.data.references)).toBe(true);
    expect(firstCall.data.references.length).toBeGreaterThanOrEqual(1);
  });

  test('shows failed reference URLs in diagnostics', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
      affiliateLinks: [],
    };

    // mock canvas context as above
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

    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // override runtime sendMessage to return diagnostics with a failed URL
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'ai_generate_images') {
        if (typeof cb === 'function')
          cb({ success: true, diagnostics: { inputCount: 2, converted: 1, failed: [{ url: 'https://images.test/ref2.png', error: '404' }] } });
        return;
      }
      if (typeof cb === 'function') cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    // spy on console.error to ensure no uncaught errors bubble up
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // click generate
    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    // wait for async UI update
    await new Promise((r) => setTimeout(r, 200));

    const diagEl = document.querySelector('#tm-diagnostics');
    expect(diagEl).toBeTruthy();
    expect(diagEl.textContent).toContain('참조 이미지 변환');
    expect(diagEl.textContent).toContain('ref2.png');

    // ensure no uncaught console errors occurred
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('retries on timeout and succeeds', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
      affiliateLinks: [],
    };

    // mock canvas context as above
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

    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // simulate timeout first, then success on retry
    let call = 0;
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'ai_generate_images') {
        call++;
        if (call === 1) {
          if (typeof cb === 'function') cb({ success: false, error: 'timeout' });
          return;
        }
        if (typeof cb === 'function') cb({ success: true, images: ['https://images.test/generated_after_retry.png'] });
        return;
      }
      if (typeof cb === 'function') cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    // wait longer for retry path
    await new Promise((r) => setTimeout(r, 700));

    // ensure we attempted at least twice and eventually succeeded
    const aiCalls = global.chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'ai_generate_images');
    expect(aiCalls.length).toBeGreaterThanOrEqual(2);

    // diagnostics or preview UI should be present without errors
    const preview = document.querySelector('#tm-preview');
    expect(preview).toBeTruthy();
  });
});
