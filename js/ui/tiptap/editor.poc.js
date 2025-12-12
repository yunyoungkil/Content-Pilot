import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';

// Minimal TipTap POC editor initialization (vanilla JS, non-framework)
export function initTiptapEditor({ elementId = 'tiptap-editor', content = '' } = {}) {
  const el = document.getElementById(elementId);
  if (!el) {
    console.warn('initTiptapEditor: target element not found:', elementId);
    return null;
  }

  const editor = new Editor({
    element: el,
    content: content || '<p>Hello TipTap!</p>',
    extensions: [StarterKit, Image],
    onUpdate({ editor }) {
      // For POC: write to data attribute (or integrate with app state)
      el.setAttribute('data-content', editor.getHTML());
    },
  });

  return editor;
}

export function insertImage(editor, src) {
  if (!editor) return;
  editor.chain().focus().setImage({ src }).run();
}
