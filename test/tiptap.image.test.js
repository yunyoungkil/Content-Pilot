import { jest } from '@jest/globals';

describe('TipTap Image Handling', () => {
  beforeEach(() => {
    jest.resetModules();
    // Mock chrome.runtime.sendMessage to support resize/upload flows
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(async (message) => {
          if (message && message.action === 'resize_image_in_offscreen') {
            return { success: true, dataUrl: message.data.imageDataUrl }; // echo back
          }
          if (message && message.action === 'upload_thumbnail_to_storage') {
            return { success: true, url: 'https://storage.test/uploaded.png' };
          }
          return { success: false };
        }),
      },
    };
    // Minimal Quill stub for editor.js module initialization
    global.Quill = {
      import: jest.fn(() => ({})),
      register: jest.fn(),
      // a very small constructor for tests - not used by initTipTap
      prototype: {},
    };
    if (!Node.prototype.getClientRects) {
      Node.prototype.getClientRects = function () {
        return [{ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }];
      };
    }
  });

  test('pasting image uploads via offscreen and inserts image node', async () => {
    const { initTipTap } = await import('../editor.js');
    // set up container
    const container = document.createElement('div');
    container.id = 'tiptap-container';
    container.style.height = '200px';
    document.body.appendChild(container);

    const editor = await initTipTap('<p></p>');
    expect(editor).toBeTruthy();

    // Create a fake File for image
    const blob = new Blob(['fake'], { type: 'image/png' });
    const file = new File([blob], 'a.png', { type: 'image/png' });
    const item = { type: 'image/png', getAsFile: () => file };

    const pasteEvent = new Event('paste');
    pasteEvent.clipboardData = { items: [item] };

    editor.view.dom.dispatchEvent(pasteEvent);

    // Wait for async handlers
    await new Promise((resolve) => setTimeout(resolve, 200));

    const html = editor.getHTML();
    expect(html).toContain('<img');
    expect(html).toContain('https://storage.test/uploaded.png');
  });

  test('insert-image command inserts the image', async () => {
    const { initTipTap } = await import('../editor.js');
    const container = document.createElement('div');
    container.id = 'tiptap-container';
    container.style.height = '200px';
    document.body.appendChild(container);

    const editor = await initTipTap('<p></p>');
    expect(editor).toBeTruthy();

    editor.chain().focus().setImage({ src: 'https://example.test/img.png' }).run();
    const h = editor.getHTML();
    expect(h).toContain('https://example.test/img.png');
  });
});
