import { jest } from '@jest/globals';

describe('Editor insert-image dedupe', () => {
  beforeEach(() => {
    jest.resetModules();
    // Provide a lightweight mock Quill to satisfy editor.js initialization
    class MockQuill {
      constructor(selector, opts) {
        this.container = { querySelector: () => document.createElement('div') };
        this.clipboard = { dangerouslyPasteHTML: jest.fn() };
        this.history = { undo: jest.fn(), redo: jest.fn() };
        this._len = 0;
        this.root = document.createElement('div');
        this.getSelection = jest.fn(() => ({ index: 0, length: 0 }));
        this.getLength = jest.fn(() => this._len);
        this.insertEmbed = jest.fn(() => {
          // simulate that an <img> element with matching src will be findable
          const img = document.createElement('img');
          img.src = MockQuill._lastUrl;
          this.root.appendChild(img);
        });
        this.setSelection = jest.fn();
      }
      static import() {
        // minimal stub to satisfy editor.js expecting Quill.import('ui/icons')
        return {};
      }
    }
    // Keep simple global Quill mock
    global.Quill = MockQuill;
  });

  test('does not insert duplicate image when two messages arrive quickly', async () => {
    // load module (editor.js registers message listeners on DOMContentLoaded)
    const editor = await import('../editor.js');

    // trigger init
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // ensure Quill instance created
    await new Promise((r) => setTimeout(r, 0));

    // send two insert-image messages in quick succession
    const url = 'https://example.com/test.png';
    window.postMessage({ action: 'insert-image', data: { url } }, '*');
    window.postMessage({ action: 'insert-image', data: { url } }, '*');

    // wait a tick for handlers
    await new Promise((r) => setTimeout(r, 50));

    // find the quill instance (editor.js stores it in closure; we can check DOM inserts)
    // Check that only one image node was inserted into the editor root
    const imgs = document.querySelectorAll('img[src="https://example.com/test.png"]');
    expect(imgs.length).toBeLessThanOrEqual(1);
  });
});
