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

    // also test that published badge renders when image item contains published flag
    // simulate response that includes published metadata for one of the images
    const uploadedStub = [
      {
        id: 'u1',
        downloadURL: 'https://images.test/u1.png',
        originData: { storagePath: 'gs://b/u1.png' },
        published: true,
      },
    ];
    // open my images modal via internal button flow
    const myImagesBtn = document.querySelector('#tm-my-images');
    if (myImagesBtn) {
      // stub runtime for get_uploaded_images_log
      global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
        if (msg && msg.action === 'get_uploaded_images_log') {
          if (typeof cb === 'function') cb({ success: true, images: uploadedStub });
          return;
        }
        if (typeof cb === 'function')
          cb({ success: true, images: ['https://images.test/generated.png'] });
      });

      myImagesBtn.click();
      await new Promise((r) => setTimeout(r, 50));

      // published badge should be present in modal item
      const badge = document.querySelector('.tm-my-img-item .tm-published-badge');
      expect(badge).toBeTruthy();
      expect(badge.title).toBe('발행됨');

      // published checkbox should be disabled so it cannot be selected in batch delete
      const checkbox = document.querySelector('.tm-my-img-checkbox');
      expect(checkbox).toBeTruthy();
      expect(checkbox.disabled).toBe(true);

      // per-item delete button should be disabled for published images
      const deleteBtn = document.querySelector('.tm-my-img-item .tm-my-img-delete-btn');
      expect(deleteBtn).toBeTruthy();
      expect(deleteBtn.disabled).toBe(true);

      // attempt to delete the published image: should be prevented (no delete message)
      // clear previous sendMessage calls
      global.chrome.runtime.sendMessage.mockClear();
      deleteBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      const delCalls = global.chrome.runtime.sendMessage.mock.calls.filter(
        (c) => c[0] && c[0].action === 'delete_storage_image'
      );
      expect(delCalls.length).toBe(0);
    }

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

  test('applies selected ratio to prompt and payload', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Text <img src="https://images.test/ref1.png"/></p>',
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

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    // set ratio to 9:16 and generate
    const ratioSelect = document.querySelector('#tm-ratio');
    expect(ratioSelect).toBeTruthy();
    ratioSelect.value = '9:16';

    // reset mock and click generate
    global.chrome.runtime.sendMessage.mockClear();

    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    await new Promise((r) => setTimeout(r, 200));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
    const aiCallEntry = global.chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'ai_generate_images');
    expect(aiCallEntry).toBeTruthy();
    const aiCall = aiCallEntry[0];
    expect(aiCall.data.aspect).toBe('9:16');
    expect(aiCall.data.prompt).toMatch(/9:16 aspect ratio/);
  });

  test('updates prompt display when ratio changed', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = { formattedDraft: '<p>Hi</p>' };

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

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    const promptDisplay = document.querySelector('#tm-prompt-display');
    expect(promptDisplay).toBeTruthy();

    // set ratio to 9:16 and generate
    const ratioSelect = document.querySelector('#tm-ratio');
    expect(ratioSelect).toBeTruthy();
    ratioSelect.value = '9:16';

    // reset mock and click generate
    global.chrome.runtime.sendMessage.mockClear();

    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    await new Promise((r) => setTimeout(r, 200));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
    const aiCallEntry = global.chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'ai_generate_images');
    expect(aiCallEntry).toBeTruthy();
    const aiCall = aiCallEntry[0];
    expect(aiCall.data.aspect).toBe('9:16');
    expect(aiCall.data.prompt).toMatch(/9:16 aspect ratio/);
  });

  test('prefers AI-provided curiosity prompt when available', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft: '<p>Hi</p>',
      publishInfo: {
        thumbnailPrompts: {
          curiosity: ['AI가 제공한 호기심형 프롬프트 예시'],
          info: [],
          empathy: [],
        },
      },
    };

    // mock canvas context
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

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    const promptDisplay = document.querySelector('#tm-prompt-display');
    expect(promptDisplay).toBeTruthy();
    // Should contain the AI-provided curiosity prompt
    expect(promptDisplay.textContent).toMatch(/AI가 제공한 호기심형 프롬프트 예시/);
  });
  test('shows failed reference URLs in diagnostics', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = {
      formattedDraft:
        '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
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

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    // override runtime sendMessage to return diagnostics with a failed URL
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'ai_generate_images') {
        if (typeof cb === 'function')
          cb({
            success: true,
            diagnostics: {
              inputCount: 2,
              converted: 1,
              failed: [{ url: 'https://images.test/ref2.png', error: '404' }],
            },
          });
        return;
      }
      if (typeof cb === 'function')
        cb({ success: true, images: ['https://images.test/generated.png'] });
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
      formattedDraft:
        '<p>Text <img src="https://images.test/ref1.png"/> <img src="https://images.test/ref2.png"/></p>',
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

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    // simulate timeout first, then success on retry
    let call = 0;
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'ai_generate_images') {
        call++;
        if (call === 1) {
          if (typeof cb === 'function') cb({ success: false, error: 'timeout' });
          return;
        }
        if (typeof cb === 'function')
          cb({ success: true, images: ['https://images.test/generated_after_retry.png'] });
        return;
      }
      if (typeof cb === 'function')
        cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    const genBtn = document.querySelector('#tm-gen-bg');
    genBtn.click();

    // wait longer for retry path
    await new Promise((r) => setTimeout(r, 700));

    // ensure we attempted at least twice and eventually succeeded
    const aiCalls = global.chrome.runtime.sendMessage.mock.calls.filter(
      (c) => c[0] && c[0].action === 'ai_generate_images'
    );
    expect(aiCalls.length).toBeGreaterThanOrEqual(2);

    // diagnostics or preview UI should be present without errors
    const preview = document.querySelector('#tm-preview');
    expect(preview).toBeTruthy();
  });

  test('shows my uploaded images modal and applies selection', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const draftData = { formattedDraft: '<p>Hi</p>' };

    // mock canvas context
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

    // mock get_uploaded_images_log response
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_uploaded_images_log') {
        if (typeof cb === 'function')
          cb({
            success: true,
            images: [{ id: '1', downloadURL: 'https://images.test/u1.png', timestamp: 123 }],
          });
        return;
      }
      if (typeof cb === 'function')
        cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    const myBtn = document.querySelector('#tm-my-images');
    expect(myBtn).toBeTruthy();

    myBtn.click();

    // wait for async handler
    await new Promise((r) => setTimeout(r, 100));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'get_uploaded_images_log' },
      expect.any(Function)
    );

    const gallery = document.querySelector('#tm-my-images-modal');
    expect(gallery).toBeTruthy();
    const img = gallery.querySelector('img');
    expect(img.src).toBe('https://images.test/u1.png');

    // simulate clicking the image to apply it
    const item = gallery.querySelector('.tm-my-img-item');
    item.click();

    // after selection, gallery should be removed
    expect(document.querySelector('#tm-my-images-modal')).toBeFalsy();
  });

  test('allows deleting single uploaded image via X button', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    // mock get_uploaded_images_log response and delete handler
    global.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_uploaded_images_log') {
        if (typeof cb === 'function')
          cb({
            success: true,
            images: [{ id: '1', downloadURL: 'https://images.test/u1.png', timestamp: 123 }],
          });
        return;
      }
      if (msg && msg.action === 'delete_storage_image') {
        if (typeof cb === 'function') cb({ success: true });
        return;
      }
      if (typeof cb === 'function')
        cb({ success: true, images: ['https://images.test/generated.png'] });
    });

    openThumbnailMaker(
      { formattedDraft: '<p>Hi</p>' },
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );
    const myBtn = document.querySelector('#tm-my-images');
    myBtn.click();
    // wait for modal
    await new Promise((r) => setTimeout(r, 50));

    const gallery = document.querySelector('#tm-my-images-modal');
    expect(gallery).toBeTruthy();

    const deleteBtn = gallery.querySelector('.tm-my-img-delete-btn');
    expect(deleteBtn).toBeTruthy();

    // mock confirm to avoid jsdom not implemented error and auto-confirm
    global.confirm = jest.fn(() => true);

    // simulate clicking delete
    deleteBtn.click();

    // wait for async handler
    await new Promise((r) => setTimeout(r, 50));

    // should have removed the item from DOM
    expect(gallery.querySelector('.tm-my-img-item')).toBeFalsy();

    // cleanup mock
    global.confirm = undefined;
  });

  test('overlay UI removed', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    // Provide a thumbnailInfo with overlayOpacity preset
    const draftData = { formattedDraft: '<p>Hi</p>', thumbnailInfo: { overlayOpacity: 0.5 } };

    openThumbnailMaker(
      draftData,
      () => {},
      () => {},
      null,
      { showText: true },
      document.body
    );

    // wait for initialization to finish
    await new Promise((r) => setTimeout(r, 10));

    // overlay-related UI should be removed
    expect(document.querySelector('#tm-overlay-opacity')).toBeFalsy();
    expect(document.querySelector('#tm-overlay-opacity-value')).toBeFalsy();
    expect(document.querySelector('#tm-visual-overlay')).toBeFalsy();

    // upload UI and drag/drop overlay removed
    expect(document.querySelector('#tm-upload-btn')).toBeFalsy();
    expect(document.querySelector('#tm-file-input')).toBeFalsy();
    expect(document.querySelector('#tm-drag-overlay')).toBeFalsy();
  });

  test('template selector removed', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    openThumbnailMaker({ formattedDraft: '<p>Hi</p>' }, () => {}, () => {}, null, { showText: true }, document.body);

    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('#tm-template-type')).toBeFalsy();
  });

  test('bg style selector removed', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    openThumbnailMaker({ formattedDraft: '<p>Hi</p>' }, () => {}, () => {}, null, { showText: true }, document.body);

    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('#tm-bg-style')).toBeFalsy();
  });

  test('uses metaDescription to generate template prompts and displays them', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    const meta = 'This is a concise meta description about AI thumbnail generation and best practices.';
    const draftData = { formattedDraft: '<p>Hi</p>', metaDescription: meta };

    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);

    // allow async init
    await new Promise((r) => setTimeout(r, 20));

    const promptDisplay = document.querySelector('#tm-prompt-display');
    expect(promptDisplay).toBeTruthy();
    // should include a snippet of metaDescription in at least one of the visible prompts
    expect(promptDisplay.textContent).toContain('This is a concise meta');
  });

  test('gen-from-meta button regenerates prompts and updates UI', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');
    const draftData = { formattedDraft: '<p>Hi</p>', metaDescription: 'Original meta' };

    openThumbnailMaker(draftData, () => {}, () => {}, null, { showText: true }, document.body);
    // allow async init
    await new Promise((r) => setTimeout(r, 20));

    // simulate meta change (user updated meta elsewhere before clicking)
    draftData.metaDescription = 'New meta description for re-gen';

    const btn = document.querySelector('#tm-gen-from-meta');
    expect(btn).toBeTruthy();
    btn.click();

    // allow regeneration handler to finish
    await new Promise((r) => setTimeout(r, 30));

    const promptDisplay = document.querySelector('#tm-prompt-display');
    expect(promptDisplay.textContent).toContain('New meta description');
  });

  test('does not include subtitle input or label', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    openThumbnailMaker({}, () => {}, () => {}, null, { showText: true }, document.body);
    await new Promise((r) => setTimeout(r, 10));

    const modal = document.querySelector('#cp-thumbnail-modal');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('#tm-subtitle')).toBeNull();
    expect(modal.innerHTML).not.toContain('서브 타이틀');

    modal.remove();
  });

  test('does not include font family or text color inputs', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    openThumbnailMaker({}, () => {}, () => {}, null, { showText: true }, document.body);
    await new Promise((r) => setTimeout(r, 10));

    const modal = document.querySelector('#cp-thumbnail-modal');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('#tm-font-family')).toBeNull();
    expect(modal.querySelector('#tm-text-color')).toBeNull();
    expect(modal.innerHTML).not.toContain('글꼴 (Font)');
    expect(modal.innerHTML).not.toContain('글자 색상');

    modal.remove();
  });

  test('does not include main title input or show-text toggle', async () => {
    const { openThumbnailMaker } = require('../js/ui/thumbnailMaker.js');

    openThumbnailMaker({}, () => {}, () => {}, null, { showText: true }, document.body);
    await new Promise((r) => setTimeout(r, 10));

    const modal = document.querySelector('#cp-thumbnail-modal');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('#tm-title')).toBeNull();
    expect(modal.querySelector('#tm-show-text')).toBeNull();
    expect(modal.innerHTML).not.toContain('메인 타이틀');
    expect(modal.innerHTML).not.toContain('텍스트 표시');

    modal.remove();
  });
});
