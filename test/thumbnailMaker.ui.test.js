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

    // wait for async reference render to complete
    await new Promise((r) => setTimeout(r, 200));

    // check that top tm-ref-images contains img elements
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

  test('retries on timeout and succeeds and refreshes uploaded AI images', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
      affiliateLinks: [],
      permalink: 'post-xyz'
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
        if (typeof cb === 'function') cb({ success: true, images: ['https://storage.test/generated_after_retry.png'] });
        return;
      }

      if (msg && msg.action === 'get_uploaded_images_log') {
        if (typeof cb === 'function') cb({ success: true, images: [
          { id: 'G1', path: 'thumbnails/AI/post-xyz-16x9.png', downloadURL: 'https://storage.test/generated_after_retry.png', storagePath: 'thumbnails/AI/post-xyz-16x9.png', timestamp: 999, permalink: 'post-xyz' }
        ] });
        return;
      }

      if (typeof cb === 'function') cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    // wait longer for retry path and refresh
    await new Promise((r) => setTimeout(r, 1200));

    // ensure we attempted at least twice and eventually succeeded
    const aiCalls = global.chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'ai_generate_images');
    expect(aiCalls.length).toBeGreaterThanOrEqual(2);

    // Ensure retry call included the draft permalink so uploaded image metadata will be persisted against the draft
    expect(aiCalls[1][0].data.permalink).toBe('post-xyz');

    // AI uploaded image should appear in the ai wrapper at some point (allow transient refresh timing)
    const aiWrapper = document.querySelector('#tm-ref-images-below');
    expect(aiWrapper).toBeTruthy();

    // Poll for up to 1500ms for the image to appear (avoid flappy timing)
    const targetUrl = 'https://storage.test/generated_after_retry.png';
    let found = false;
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const imgs = Array.from(aiWrapper.querySelectorAll('img'));
      found = imgs.some((i) => i.src === targetUrl);
      if (found) break;
      // small delay
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBe(true);

    // diagnostics or preview UI should be present without errors
    const preview = document.querySelector('#tm-preview');
    expect(preview).toBeTruthy();
  });

  test('shows AI uploaded thumbnails and allows storage deletion', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Text <img src="https://images.test/ref1.png"/> </p>',
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

    // Setup mock responses: get_uploaded_images_log returns an AI thumbnail for this draft permalink and another unrelated item
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_uploaded_images_log') {
        if (typeof cb === 'function') cb({ success: true, images: [
          { id: 'AI1', path: 'thumbnails/AI/post-123-16x9.png', downloadURL: 'https://storage.test/ai1.png', storagePath: 'thumbnails/AI/post-123-16x9.png', timestamp: 123, permalink: 'post-123' },
          { id: 'AI2', path: 'thumbnails/Other/thumbnail-bg-1.png', downloadURL: 'https://storage.test/other.png', storagePath: 'thumbnails/Other/thumbnail-bg-1.png', timestamp: 120 }
        ] });
        return;
      }

      if (msg && msg.action === 'delete_storage_image') {
        if (typeof cb === 'function') cb({ success: true });
        return;
      }

      // default response
      if (typeof cb === 'function') cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    // render modal with permalink set (only matching uploaded image should appear)
    draftData.permalink = 'post-123';

    // render modal
    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // wait for async renderReferenceImages to fetch uploaded log
    await new Promise((r) => setTimeout(r, 200));

    // AI uploaded images should be rendered below the canvas wrapper
    const aiWrapper = document.querySelector('#tm-ref-images-below');
    expect(aiWrapper).toBeTruthy();

    // there should be an image with the storage URL inside AI wrapper
    const imgs = Array.from(aiWrapper.querySelectorAll('img'));
    const found = imgs.some((i) => i.src === 'https://storage.test/ai1.png');
    expect(found).toBe(true);

    // AI badge should exist (look for span with 'AI' inside the AI wrapper)
    const badge = Array.from(aiWrapper.querySelectorAll('span')).some((s) => s.textContent === 'AI');
    expect(badge).toBe(true);

    // delete button should be present in AI wrapper
    const delBtn = Array.from(aiWrapper.querySelectorAll('button')).find((b) => b.title === '영구 삭제');
    expect(delBtn).toBeTruthy();

    // mock confirm to automatically accept
    global.confirm = jest.fn(() => true);

    // simulate click
    delBtn.click();

    // wait for delete handler
    await new Promise((r) => setTimeout(r, 200));

    // ensure delete_storage_image was called
    const deleteCalls = global.chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'delete_storage_image');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });
});
