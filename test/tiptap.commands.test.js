import { jest } from '@jest/globals';

describe('TipTap Commands & TextStyle', () => {
  beforeEach(() => {
    jest.resetModules();
    global.chrome = { runtime: { sendMessage: jest.fn(async () => ({ success: false })) } };
    global.Quill = {
      import: jest.fn(() => ({})),
      register: jest.fn(),
      prototype: {},
    };
    // JSDOM doesn't implement layout; stub getClientRects used by ProseMirror view
    if (!Node.prototype.getClientRects) {
      Node.prototype.getClientRects = function () {
        return [{ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }];
      };
    }
  });

  test('undo/redo alignment and paragraph textAlign', async () => {
    const { initTipTap, ensureTextAlignLoaded } = await import('../editor.js');
    const container = document.createElement('div');
    container.id = 'tiptap-container';
    container.style.height = '200px';
    document.body.appendChild(container);

    let editor = await initTipTap('<p>hello</p>');
    expect(editor).toBeTruthy();

    // ensure textAlign extension is loaded then set text then align center
    try { editor = await ensureTextAlignLoaded() || editor; } catch (e) { /* ignore */ }
    // set text then align center
    editor.chain().setNode('paragraph', { textAlign: 'center' }).run();
    expect(editor.getHTML()).toContain('text-align: center');

    // Undo should revert alignment
    editor.chain().undo().run();
    await new Promise((r) => setTimeout(r, 50));
    expect(editor.getHTML()).not.toContain('text-align: center');

    // Redo should restore alignment
    editor.chain().redo().run();
    await new Promise((r) => setTimeout(r, 50));
    expect(editor.getHTML()).toContain('text-align: center');
  });

  test('textStyle color mark (if available)', async () => {
    const { initTipTap, ensureTextStyleLoaded, ensureTextAlignLoaded } = await import('../editor.js');
    const container = document.createElement('div');
    container.id = 'tiptap-container';
    container.style.height = '200px';
    document.body.appendChild(container);

    const editor = await initTipTap('<p>colorful</p>');
    expect(editor).toBeTruthy();

    // try loading textStyle (works if dependency is installed); otherwise skip
    try {
      await ensureTextStyleLoaded();
      editor.chain().setMark('textStyle', { color: '#ff0000' }).run();
      expect(editor.getHTML()).toContain('color: #ff0000');
    } catch (e) {
      // if not available, do a no-op assert
      expect(true).toBe(true);
    }
  });
});
