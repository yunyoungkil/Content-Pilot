import { Logger } from './js/utils.js';

// Dynamic chunk path: ensure Webpack chunk loader uses chrome extension absolute URL
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
    // Set webpack public path at runtime for dynamic imports
    // eslint-disable-next-line no-undef, no-empty
    __webpack_public_path__ = chrome.runtime.getURL('dist/');
  }
} catch (e) {
  // non-fatal when not in extension runtime
  void 0;
}

// 툴바 커스텀 버튼 렌더링 (Quill 초기화 후)
setTimeout(() => {
  const toolbar = document.querySelector('.ql-toolbar');
  if (toolbar) {
    const tuiBtn = toolbar.querySelector('.ql-tui-edit');
    if (tuiBtn) {
      tuiBtn.innerHTML = '<span style="font-size:16px;vertical-align:middle;">🎨</span>';
      tuiBtn.title = 'TUI 이미지 편집';
    }
  }
}, 100);
// W-17: 이미지 편집 툴팁 오버레이 생성/제거 및 액션 메시지
let __cp_currentImageForControls = null; // 현재 오버레이가 붙은 이미지 참조
let __cp_controlsScrollRoot = null; // 스크롤 이벤트를 구독하는 루트(.ql-editor)

// editor.js - iframe 내에서 동작하는 Quill 에디터 제어 스크립트
// Quill Image Resize 모듈 등록 (최상단에서 전역 등록)
if (window.Quill && window.ImageResize) {
  Quill.register('modules/imageResize', window.ImageResize, true);
}

// TipTap 초기화 함수 (동적 import 기반)
async function initTipTap(initialHtml = '') {
  if (tiptapEditor) return tiptapEditor;
  try {
    const [{ Editor }, StarterKitModule, ImageModule, LinkModule] = await Promise.all([
      import('@tiptap/core'),
      import('@tiptap/starter-kit'),
      import('@tiptap/extension-image'),
      import('@tiptap/extension-link'),
    ]);

    // Normalize import variations (ESM/CJS interop). Some build outputs wrap
    // the actual extension factory under `.default` or as named exports.
    const normalize = (mod, name) => {
      if (!mod) return null;
      // Try named export first (e.g., StarterKit), then default, then module itself
      const candidate = (name && mod[name]) || mod.default || mod;
      if (typeof candidate === 'function') return candidate;
      // handle double-wrapped default (.default.default)
      if (candidate && typeof candidate.default === 'function') return candidate.default;
      // If original mod has named function under .default[name] (e.g., default is object)
      if (mod && mod.default && mod.default[name] && typeof mod.default[name] === 'function') return mod.default[name];
      // if it's an object (extension instance), return as-is
      if (typeof candidate === 'object') return candidate;
      return null;
    };

    const StarterKit = normalize(StarterKitModule, 'StarterKit');
    const Image = normalize(ImageModule, 'Image');
    const Link = normalize(LinkModule, 'Link');
    // store for re-init when lazy-loading extensions
    _StarterKit = StarterKit;
    _Image = Image;
    _Link = Link;
    _EditorClass = Editor;
    // Table extensions will be loaded lazily when the user inserts a table.
    let Table = null;
    let TableRow = null;
    let TableCell = null;
    let TableHeader = null;

    const container = document.createElement('div');
    container.id = 'tiptap-container';
    container.style.height = '100%';
    container.style.boxSizing = 'border-box';
    container.style.padding = '12px';
    container.style.display = 'none';
    document.body.appendChild(container);

    // Add a small button to switch back to Quill
    try {
      const switchBack = document.createElement('button');
      switchBack.innerText = '← Quill';
      switchBack.type = 'button';
      switchBack.title = 'Switch back to Quill';
      switchBack.style.position = 'absolute';
      switchBack.style.left = '8px';
      switchBack.style.top = '8px';
      switchBack.style.zIndex = '9999';
      switchBack.addEventListener('click', () => {
        if (document.querySelector('#tiptap-container')) {
          document.querySelector('#tiptap-container').style.display = 'none';
        }
        if (document.querySelector('#editor-container')) {
          document.querySelector('#editor-container').style.display = 'block';
        }
        activeEditor = 'quill';
      });
      container.appendChild(switchBack);
    } catch (e) {}

    tiptapEditor = new Editor({
      element: container,
      extensions: [
        // StarterKit may be a function factory or an object
        ...(typeof StarterKit === 'function' ? [StarterKit()] : StarterKit ? [StarterKit] : []),
        ...(Image && typeof Image.configure === 'function' ? [Image.configure({ inline: false })] : Image ? [Image] : []),
        ...(Link && typeof Link.configure === 'function' ? [Link.configure({ openOnClick: true })] : Link ? [Link] : []),
        // Table extension intentionally not included initially (lazy loaded)
      ],
      content: initialHtml || '<p></p>',
      editorProps: {
        attributes: { class: 'tiptap-editor' },
      },
      onUpdate: ({ editor }) => {
        window.parent.postMessage(
          { action: 'content-changed', data: { html: editor.getHTML(), text: editor.getText() } },
          '*'
        );
      },
    });

    // Create a simple TipTap toolbar for parity with Quill
    try {
      const toolbarEl = document.createElement('div');
      toolbarEl.id = 'tiptap-toolbar';
      toolbarEl.style.cssText = 'display:flex;gap:6px;padding:8px;border-bottom:1px solid #eee;align-items:center;';
      const makeBtn = (text, title, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.style.cssText = 'padding:6px 8px;border-radius:4px;cursor:pointer;';
        b.addEventListener('click', onClick);
        return b;
      };
      toolbarEl.appendChild(makeBtn('B', '굵게 (Ctrl+B)', () => tiptapEditor.chain().focus().toggleBold().run()));
      toolbarEl.appendChild(makeBtn('I', '기울임 (Ctrl+I)', () => tiptapEditor.chain().focus().toggleItalic().run()));
      toolbarEl.appendChild(makeBtn('H2', 'Heading 2', () => tiptapEditor.chain().focus().setNode('heading', { level: 2 }).run()));
      toolbarEl.appendChild(makeBtn('H3', 'Heading 3', () => tiptapEditor.chain().focus().setNode('heading', { level: 3 }).run()));
      toolbarEl.appendChild(makeBtn('UL', 'Bullet list', () => tiptapEditor.chain().focus().toggleBulletList().run()));
      toolbarEl.appendChild(makeBtn('OL', 'Numbered list', () => tiptapEditor.chain().focus().toggleOrderedList().run()));
      toolbarEl.appendChild(makeBtn('Quote', 'Blockquote', () => tiptapEditor.chain().focus().toggleBlockquote().run()));
      toolbarEl.appendChild(makeBtn('Code', 'Code block', () => tiptapEditor.chain().focus().toggleCodeBlock().run()));
      toolbarEl.appendChild(makeBtn('Undo', 'Undo', () => tiptapEditor.chain().focus().undo().run()));
      toolbarEl.appendChild(makeBtn('Redo', 'Redo', () => tiptapEditor.chain().focus().redo().run()));
      toolbarEl.appendChild(makeBtn('Left', 'Align left', () => {
        try { tiptapEditor.chain().focus().setNode('paragraph', { textAlign: 'left' }).run(); } catch (e) {}
      }));
      toolbarEl.appendChild(makeBtn('Center', 'Align center', () => {
        try { tiptapEditor.chain().focus().setNode('paragraph', { textAlign: 'center' }).run(); } catch (e) {}
      }));
      toolbarEl.appendChild(makeBtn('Right', 'Align right', () => {
        try { tiptapEditor.chain().focus().setNode('paragraph', { textAlign: 'right' }).run(); } catch (e) {}
      }));
      // Color picker
      const colorPicker = makeBtn('Color', 'Text color', () => {});
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.style.marginLeft = '6px';
      colorInput.addEventListener('input', (ev) => {
        const value = ev.target.value;
        try { tiptapEditor.chain().focus().setMark('textStyle', { color: value }).run(); } catch (e) {}
      });
      colorPicker.appendChild(colorInput);
      toolbarEl.appendChild(colorPicker);
      // Font size increase/decrease
      toolbarEl.appendChild(makeBtn('A-', 'Font smaller', () => {
        try { tiptapEditor.chain().focus().setMark('textStyle', { fontSize: '12px' }).run(); } catch (e) {}
      }));
      toolbarEl.appendChild(makeBtn('A+', 'Font larger', () => {
        try { tiptapEditor.chain().focus().setMark('textStyle', { fontSize: '18px' }).run(); } catch (e) {}
      }));

      // Insert Image button + file input
      const insertImageBtn = makeBtn('Img', 'Insert image', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const dataUrl = ev.target.result;
            try {
              const resized = await window.chrome?.runtime?.sendMessage?.({ action: 'resize_image_in_offscreen', data: { imageDataUrl: dataUrl, maxWidth: 1920 } });
              const dataToUpload = resized && resized.success ? resized.dataUrl : dataUrl;
              const filename = `editor-image-${Date.now()}.png`;
              const uploadResp = await window.chrome?.runtime?.sendMessage?.({ action: 'upload_thumbnail_to_storage', data: { dataUrl: dataToUpload, filename } });
              const src = uploadResp && uploadResp.success && uploadResp.url ? uploadResp.url : dataUrl;
              tiptapEditor.chain().focus().setImage({ src }).run();
            } catch (err) {
              tiptapEditor.chain().focus().setImage({ src: dataUrl }).run();
            }
          };
          reader.readAsDataURL(file);
        };
        input.click();
      });
      toolbarEl.appendChild(insertImageBtn);

      toolbarEl.appendChild(makeBtn('Table', 'Insert table 3x3', async () => {
        try {
          // Lazy load TipTap table extensions and reinitialize editor if needed
          if (!window.__cp_tiptap_table_loaded) {
            const [TableModule, TableRowModule, TableCellModule, TableHeaderModule] = await Promise.all([
              import('@tiptap/extension-table'),
              import('@tiptap/extension-table-row'),
              import('@tiptap/extension-table-cell'),
              import('@tiptap/extension-table-header'),
            ]);
            Table = normalize(TableModule, 'Table');
            TableRow = normalize(TableRowModule, 'TableRow');
            TableCell = normalize(TableCellModule, 'TableCell');
            TableHeader = normalize(TableHeaderModule, 'TableHeader');
            const currentHtml = tiptapEditor.getHTML();
            try { tiptapEditor.destroy(); } catch (e) {}
            tiptapEditor = new Editor({
              element: container,
              extensions: [
                ...(typeof StarterKit === 'function' ? [StarterKit()] : StarterKit ? [StarterKit] : []),
                ...(Image && typeof Image.configure === 'function' ? [Image.configure({ inline: false })] : Image ? [Image] : []),
                ...(Link && typeof Link.configure === 'function' ? [Link.configure({ openOnClick: true })] : Link ? [Link] : []),
                ...(Table && typeof Table.configure === 'function' ? [Table.configure({ resizable: true })] : Table ? [Table] : []),
                ...(typeof TableRow === 'function' ? [TableRow()] : TableRow ? [TableRow] : []),
                ...(typeof TableHeader === 'function' ? [TableHeader()] : TableHeader ? [TableHeader] : []),
                ...(typeof TableCell === 'function' ? [TableCell()] : TableCell ? [TableCell] : []),
              ],
              content: currentHtml || '<p></p>',
              editorProps: { attributes: { class: 'tiptap-editor' } },
              onUpdate: ({ editor }) => {
                window.parent.postMessage({ action: 'content-changed', data: { html: editor.getHTML(), text: editor.getText() } }, '*');
              },
            });
            window.__cp_tiptap_table_loaded = true;
          }
          tiptapEditor.chain().focus().insertTable({ rows: 3, cols: 3 }).run();
        } catch (err) {
          console.error('[Editor] Table insert failed:', err);
        }
      }));
      container.insertAdjacentElement('beforebegin', toolbarEl);
    } catch (e) {}


    // paste image handling — upload via background and replace
    tiptapEditor.view.dom.addEventListener('paste', async (ev) => {
      const items = (ev.clipboardData && ev.clipboardData.items) || [];
      for (const item of items) {
        if (item.type && item.type.indexOf('image') === 0) {
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = async (e) => {
            const dataUrl = e.target.result;
            try {
              const resized = await window.chrome?.runtime?.sendMessage?.({
                action: 'resize_image_in_offscreen',
                data: { imageDataUrl: dataUrl, maxWidth: 1920 },
              });
              const dataToUpload = resized && resized.success ? resized.dataUrl : dataUrl;
              const filename = `editor-image-${Date.now()}.png`;
              const uploadResp = await window.chrome?.runtime?.sendMessage?.({
                action: 'upload_thumbnail_to_storage',
                data: { dataUrl: dataToUpload, filename },
              });
              const src = uploadResp && uploadResp.success && uploadResp.url ? uploadResp.url : dataUrl;
              tiptapEditor.chain().focus().setImage({ src }).run();
            } catch (err) {
              tiptapEditor.chain().focus().setImage({ src: dataUrl }).run();
            }
          };
          reader.readAsDataURL(file);
        }
      }
    });

    return tiptapEditor;
  } catch (err) {
    console.error('Failed to initialize TipTap:', err);
    return null;
  }
}
// Export functions for tests
export { initTipTap, ensureTextStyleLoaded };

// Lazy load and enable @tiptap/extension-text-align
async function ensureTextAlignLoaded() {
  if (window.__cp_tiptap_textalign_loaded || !tiptapEditor) return;
  try {
    const TextAlignModule = await import('@tiptap/extension-text-align');
    const TextAlign = (TextAlignModule && (TextAlignModule.default || TextAlignModule.TextAlign || TextAlignModule)) || null;
    const currentHtml = tiptapEditor.getHTML();
    try { tiptapEditor.destroy(); } catch (e) {}
    const Starter = typeof _StarterKit === 'function' ? _StarterKit() : _StarterKit;
    tiptapEditor = new _EditorClass({
      element: document.querySelector('#tiptap-container'),
      extensions: [
        Starter,
        _Image && typeof _Image.configure === 'function' ? _Image.configure({ inline: false }) : _Image,
        _Link && typeof _Link.configure === 'function' ? _Link.configure({ openOnClick: true }) : _Link,
        TextAlign && (typeof TextAlign.configure === 'function' ? TextAlign.configure({ types: ['heading', 'paragraph'] }) : TextAlign),
      ].filter(Boolean),
      content: currentHtml || '<p></p>',
      editorProps: { attributes: { class: 'tiptap-editor' } },
    });
    window.__cp_tiptap_textalign_loaded = true;
    return tiptapEditor;
  } catch (e) {
    console.warn('[Editor] Failed to load textAlign extension', e);
  }
  return null;
}
export { ensureTextAlignLoaded };

// Helper: ensure textStyle extension is loaded by reinitializing editor
async function ensureTextStyleLoaded() {
  if (window.__cp_tiptap_textstyle_loaded || !tiptapEditor) return;
  try {
    const { default: TextStyle } = await import('@tiptap/extension-text-style');
    const currentHtml = tiptapEditor.getHTML();
    try { tiptapEditor.destroy(); } catch (e) {}
    const Starter = typeof _StarterKit === 'function' ? _StarterKit() : _StarterKit;
    tiptapEditor = new _EditorClass({
      element: document.querySelector('#tiptap-container'),
      extensions: [
        Starter,
        _Image && typeof _Image.configure === 'function' ? _Image.configure({ inline: false }) : _Image,
        _Link && typeof _Link.configure === 'function' ? _Link.configure({ openOnClick: true }) : _Link,
        TextStyle && (typeof TextStyle === 'function' ? TextStyle() : TextStyle),
      ].filter(Boolean),
      content: currentHtml || '<p></p>',
      editorProps: { attributes: { class: 'tiptap-editor' } },
    });
    window.__cp_tiptap_textstyle_loaded = true;
  } catch (e) {
    console.warn('[Editor] Failed to load textStyle extension', e);
  }
}
let quillEditor = null;
let tiptapEditor = null;
// Keep module references for re-initialization when lazy-loading extensions
let _StarterKit = null;
let _Image = null;
let _Link = null;
let _EditorClass = null;
let activeEditor = 'quill'; // 'quill' or 'tiptap'

// Guard against duplicate insert-image messages arriving almost simultaneously
// (e.g. from multiple UI contexts). Ignore a duplicate insert for the same URL
// if received within this window.
let __cp_lastInsertedImage = { url: null, ts: 0 };

// W-13: Undo/Redo 아이콘을 단순한 화살표 모양으로 명시적으로 등록합니다.
const Icons = Quill.import('ui/icons');
Icons['undo'] =
  '<svg viewbox="0 0 18 18"><polyline class="ql-stroke" points="11 4 7 9 11 14"></polyline></svg>';
Icons['redo'] =
  '<svg viewbox="0 0 18 18"><polyline class="ql-stroke" points="7 4 11 9 7 14"></polyline></svg>';

function initializeEditor() {
  quillEditor = new Quill('#editor-container', {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, 4, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ script: 'sub' }, { script: 'super' }],
          [{ indent: '-1' }, { indent: '+1' }],
          [{ direction: 'rtl' }],
          [{ size: ['small', false, 'large', 'huge'] }],
          [{ color: [] }, { background: [] }],
          [{ font: [] }],
          [{ align: [] }],
          ['link', 'image', 'video'],
          ['divider'], // 구분선 버튼 추가
          ['tui-edit'], // TUI 편집 버튼만 남김
          ['clean'],
          ['undo', 'redo'],
        ],
        handlers: {
          undo: () => quillEditor.history.undo(),
          redo: () => quillEditor.history.redo(),
          'tui-edit': function () {
            console.log('🎨 [Editor] ========================================');
            console.log('🎨 [Editor] 🖱️ tui-edit 버튼 클릭됨!');
            console.log('🎨 [Editor] ========================================');

            // Quill 문서 내 모든 이미지와 Range 추출
            let allDocumentImages = [];
            const contents = quillEditor.getContents();
            let idx = 0;
            contents.ops.forEach((op) => {
              if (op.insert && op.insert.image) {
                allDocumentImages.push({
                  url: op.insert.image,
                  range: { index: idx, length: 1 },
                });
                idx += 1;
              } else if (typeof op.insert === 'string') {
                idx += op.insert.length;
              }
            });

            console.log(`📸 [Editor] 문서 내 이미지 개수: ${allDocumentImages.length}개`);

            if (allDocumentImages.length === 0) {
              console.warn('⚠️ [Editor] ❌ 문서에 이미지가 없음');
              // [추가] 사용자 피드백 제공
              alert('편집할 이미지가 없습니다. 먼저 이미지를 삽입해주세요.');
              return;
            }

            // 선택된 이미지가 있으면 그것을 사용, 없으면 첫 번째 이미지 사용
            let targetImage = null;
            if (window.__cp_selectedImageUrl && window.__cp_selectedImageRange) {
              // 선택된 이미지가 allDocumentImages에 있는지 확인
              targetImage = allDocumentImages.find(
                (img) => img.url === window.__cp_selectedImageUrl
              );
              if (targetImage) {
                console.log(
                  '✅ [Editor] 선택된 이미지 사용:',
                  window.__cp_selectedImageUrl.substring(0, 50) + '...'
                );
              }
            }

            // 선택된 이미지가 없거나 찾을 수 없으면 첫 번째 이미지 사용
            if (!targetImage) {
              targetImage = allDocumentImages[0];
              console.log(
                '🔄 [Editor] 첫 번째 이미지 사용:',
                targetImage.url.substring(0, 50) + '...'
              );
            }

            window.__cp_editingImageRange = targetImage.range;
            window.__cp_selectedImageRange = targetImage.range;
            window.__cp_selectedImageUrl = targetImage.url;

            console.log('📤 [Editor] 워크스페이스로 메시지 전송 준비 중...');
            console.log('📤 [Editor] window.parent:', window.parent);
            console.log('📤 [Editor] window.parent === window.top:', window.parent === window.top);

            // Shadow DOM 호스트 window 찾기
            let shadowHostWindow = null;
            try {
              const rootNode = document.getRootNode();
              if (rootNode && rootNode.host) {
                const hostElement = rootNode.host;
                if (hostElement.ownerDocument) {
                  shadowHostWindow = hostElement.ownerDocument.defaultView;
                  console.log('🔍 [Editor] Shadow DOM 호스트 window 발견:', shadowHostWindow);
                }
              }
            } catch (e) {
              console.log('⚠️ [Editor] Shadow DOM 호스트 탐색 실패:', e.message);
            }

            // 메시지를 parent window로 전송
            const message = {
              action: 'cp_open_tui_editor',
              currentImageUrl: targetImage.url, // 호환성을 위해 유지
              imageUrl: targetImage.url, // tui-editor.js가 찾는 필드명
              allDocumentImages,
            };

            console.log('📦 [Editor] 메시지 내용:', {
              action: message.action,
              imageUrl: message.imageUrl.substring(0, 50) + '...',
              allDocumentImagesCount: message.allDocumentImages.length,
            });

            // 여러 window로 메시지 전송 (shadow DOM 호환)
            const sendToWindow = (targetWindow, name) => {
              try {
                if (targetWindow && targetWindow.postMessage) {
                  targetWindow.postMessage(message, '*');
                  console.log(`✅ [Editor] ${name}로 메시지 전송 완료 ✨`);
                  return true;
                } else {
                  console.warn(`⚠️ [Editor] ${name}가 유효하지 않습니다`);
                  return false;
                }
              } catch (err) {
                console.error(`❌ [Editor] ${name}로 메시지 전송 실패:`, err);
                return false;
              }
            };

            // Shadow DOM을 고려한 메시지 전송 전략
            // 1. parent window로 전송 (Shadow DOM 내부의 첫 번째 부모)
            console.log('📡 [Editor] 1️⃣ window.parent로 전송 시도...');
            sendToWindow(window.parent, 'window.parent');

            // 1-1. Shadow DOM 호스트 window로 직접 전송 (가장 중요!)
            if (
              shadowHostWindow &&
              shadowHostWindow !== window &&
              shadowHostWindow !== window.parent
            ) {
              console.log('📡 [Editor] 1️⃣-1️⃣ Shadow DOM 호스트 window로 직접 전송 시도...');
              sendToWindow(shadowHostWindow, 'Shadow DOM 호스트 window (직접)');
            }

            // 2. top window로 전송 (Shadow DOM을 통과하여 최상위 window로)
            if (window.top && window.top !== window) {
              console.log('📡 [Editor] 2️⃣ window.top으로 전송 시도...');
              console.log(
                '🔍 [Editor] window.top === window.parent:',
                window.top === window.parent
              );
              sendToWindow(window.top, 'window.top');
            } else {
              console.warn('⚠️ [Editor] window.top이 없거나 현재 window와 같습니다!');
            }

            // 3. 모든 상위 window로 전송 시도 (Shadow DOM 경계 통과)
            try {
              let currentWindow = window.parent;
              let depth = 0;
              const visitedWindows = new Set([window]);

              while (
                currentWindow &&
                currentWindow !== window &&
                depth < 10 &&
                !visitedWindows.has(currentWindow)
              ) {
                visitedWindows.add(currentWindow);
                console.log(`📡 [Editor] 상위 window[${depth}]로 전송 시도...`);
                sendToWindow(currentWindow, `상위 window[${depth}]`);

                // 다음 상위 window로 이동
                if (currentWindow.parent && currentWindow.parent !== currentWindow) {
                  currentWindow = currentWindow.parent;
                } else {
                  break;
                }
                depth++;
              }
            } catch (err) {
              console.warn('⚠️ [Editor] 상위 window 탐색 실패:', err.message);
            }

            // 4. frames를 통해서도 전송 시도
            try {
              if (window.parent && window.parent.frames && window.parent.frames.length > 0) {
                console.log(
                  `📡 [Editor] 4️⃣ window.parent.frames[${window.parent.frames.length}개]로 전송 시도...`
                );
                for (let i = 0; i < window.parent.frames.length; i++) {
                  try {
                    if (window.parent.frames[i] && window.parent.frames[i] !== window) {
                      window.parent.frames[i].postMessage(message, '*');
                      console.log(`✅ [Editor] window.parent.frames[${i}]로 메시지 전송 완료`);
                    }
                  } catch (e) {
                    console.warn(
                      `⚠️ [Editor] window.parent.frames[${i}]로 메시지 전송 실패:`,
                      e.message
                    );
                  }
                }
              }
            } catch (err) {
              console.warn('⚠️ [Editor] frames를 통한 메시지 전송 실패:', err.message);
            }

            // 5. window.top의 frames도 시도
            if (window.top && window.top !== window && window.top !== window.parent) {
              try {
                if (window.top.frames && window.top.frames.length > 0) {
                  console.log(
                    `📡 [Editor] 5️⃣ window.top.frames[${window.top.frames.length}개]로 전송 시도...`
                  );
                  for (let i = 0; i < window.top.frames.length; i++) {
                    try {
                      if (window.top.frames[i] && window.top.frames[i] !== window) {
                        window.top.frames[i].postMessage(message, '*');
                        console.log(`✅ [Editor] window.top.frames[${i}]로 메시지 전송 완료`);
                      }
                    } catch (e) {
                      console.warn(
                        `⚠️ [Editor] window.top.frames[${i}]로 메시지 전송 실패:`,
                        e.message
                      );
                    }
                  }
                }
              } catch (err) {
                console.warn('⚠️ [Editor] window.top.frames를 통한 메시지 전송 실패:', err.message);
              }
            }

            // 6. Shadow DOM 호스트를 통한 전송 시도
            try {
              // 현재 window의 document가 Shadow DOM 내부에 있는지 확인
              let currentDoc = document;
              let depth = 0;
              while (currentDoc && depth < 5) {
                const rootNode = currentDoc.getRootNode();
                if (rootNode && rootNode.host) {
                  // Shadow DOM 호스트를 찾았음
                  const hostElement = rootNode.host;
                  // 호스트 요소의 ownerDocument를 통해 window 접근
                  let hostWindow = null;
                  try {
                    if (hostElement.ownerDocument) {
                      hostWindow = hostElement.ownerDocument.defaultView;
                    } else if (hostElement.getRootNode) {
                      const hostRoot = hostElement.getRootNode();
                      if (
                        hostRoot &&
                        hostRoot !== rootNode &&
                        hostRoot.nodeType === Node.DOCUMENT_NODE
                      ) {
                        hostWindow = hostRoot.defaultView;
                      }
                    }
                  } catch (e) {
                    // cross-origin 접근 시도 실패는 정상
                    console.log(
                      '⚠️ [Editor] Shadow DOM 호스트 window 접근 실패 (cross-origin):',
                      e.message
                    );
                  }

                  if (hostWindow && hostWindow !== window && hostWindow.postMessage) {
                    console.log('📡 [Editor] 6️⃣ Shadow DOM 호스트 window로 전송 시도...');
                    sendToWindow(hostWindow, 'Shadow DOM 호스트 window');

                    // 호스트의 parent window도 시도
                    if (hostWindow.parent && hostWindow.parent !== hostWindow) {
                      console.log(
                        '📡 [Editor] 7️⃣ Shadow DOM 호스트의 parent window로 전송 시도...'
                      );
                      sendToWindow(hostWindow.parent, 'Shadow DOM 호스트 parent window');
                    }

                    // 호스트의 top window도 시도
                    if (
                      hostWindow.top &&
                      hostWindow.top !== hostWindow &&
                      hostWindow.top !== window
                    ) {
                      console.log('📡 [Editor] 8️⃣ Shadow DOM 호스트의 top window로 전송 시도...');
                      sendToWindow(hostWindow.top, 'Shadow DOM 호스트 top window');
                    }
                  } else if (!hostWindow) {
                    // Shadow DOM 호스트는 찾았지만 window 접근 실패
                    // 대신 window.parent를 통해 시도 (이미 시도했지만 다시 한 번)
                    console.log(
                      '📡 [Editor] 6️⃣ Shadow DOM 호스트 발견, window.parent로 재전송 시도...'
                    );
                    if (window.parent && window.parent !== window) {
                      sendToWindow(window.parent, 'window.parent (Shadow DOM 재시도)');
                    }
                  }
                  break;
                }
                // 상위 document로 이동
                if (currentDoc.defaultView && currentDoc.defaultView.parent) {
                  currentDoc = currentDoc.defaultView.parent.document;
                } else {
                  break;
                }
                depth++;
              }
            } catch (err) {
              console.warn('⚠️ [Editor] Shadow DOM 호스트 탐색 실패:', err.message);
            }

            // 7. 모든 가능한 window에 브로드캐스트 (최후의 수단)
            try {
              // window.top부터 시작하여 모든 하위 window에 브로드캐스트
              if (window.top && window.top !== window) {
                console.log('📡 [Editor] 9️⃣ window.top에 브로드캐스트 시도...');
                // window.top 자체에도 전송
                sendToWindow(window.top, 'window.top (브로드캐스트)');

                // window.top의 모든 frames에도 전송
                if (window.top.frames) {
                  for (let i = 0; i < window.top.frames.length; i++) {
                    try {
                      if (window.top.frames[i] && window.top.frames[i] !== window) {
                        window.top.frames[i].postMessage(message, '*');
                        console.log(`✅ [Editor] window.top.frames[${i}]로 브로드캐스트 완료`);
                      }
                    } catch (e) {
                      // 조용히 실패
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('⚠️ [Editor] 브로드캐스트 실패:', err.message);
            }

            console.log('🎨 [Editor] ========================================');
            console.log('🎨 [Editor] 메시지 전송 프로세스 완료');
            console.log('🎨 [Editor] ========================================');
          },
        },
      },
      imageResize: {},
    },
    placeholder: '이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...',
  });

  // 이미지 클릭 시 Range/URL 저장, 툴바 버튼 활성화
  quillEditor.root.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'IMG') {
      const selection = quillEditor.getSelection();
      // 이미지의 index를 계산
      let idx = 0;
      const contents = quillEditor.getContents();
      for (const op of contents.ops) {
        if (op.insert && op.insert.image) {
          if (e.target.src === op.insert.image) {
            window.__cp_selectedImageRange = { index: idx, length: 1 };
            window.__cp_selectedImageUrl = op.insert.image;
            break;
          }
          idx += 1;
        } else if (typeof op.insert === 'string') {
          idx += op.insert.length;
        }
      }
    } else {
      window.__cp_selectedImageRange = null;
      window.__cp_selectedImageUrl = null;
    }
  });

  // --- 통합: 텍스트 변경 시 content-changed, cp_save_draft 모두 처리 ---
  let saveTimeout = null;
  const SAVE_DELAY = 500; // 0.5초
  quillEditor.on('text-change', function (delta, oldDelta, source) {
    if (source === 'user') {
      // 즉시 content-changed 메시지
      const content = quillEditor.getContents();
      const html = quillEditor.root.innerHTML;
      window.parent.postMessage(
        {
          action: 'content-changed',
          data: {
            content,
            html,
            text: quillEditor.getText(),
          },
        },
        '*'
      );
      // 텍스트 변경 시 오버레이가 화면에서 벗어나지 않도록 위치 재계산
      try {
        updateImageControlsPosition();
      } catch (e) {}
      // 디바운스 후 cp_save_draft 메시지
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        window.parent.postMessage(
          {
            action: 'cp_save_draft',
            content: html,
          },
          '*'
        );
      }, SAVE_DELAY);
    }
  });

  quillEditor.on('selection-change', function (range, oldRange, source) {
    let selectedText = '';
    if (range && range.length > 0) {
      selectedText = quillEditor.getText(range.index, range.length).trim();
    }
    window.parent.postMessage(
      {
        action: 'selection-changed',
        data: {
          range,
          hasSelection: range && range.length > 0,
          selectedText: selectedText,
        },
      },
      '*'
    );
  });
  // 툴바 높이에 따라 에디터 높이 자동 조정
  function adjustEditorHeight() {
    const toolbar = document.querySelector('.ql-toolbar');
    const editor = document.querySelector('.ql-editor');
    const root = document.body;
    let linkedSectionHeight = 0;
    let linkedSectionGap = 0;
    let linkedListExtra = 0;
    try {
      const linkedSection = window.parent.document.querySelector('#linked-scraps-section');
      const linkedList = window.parent.document.querySelector('.linked-scraps-list');
      if (linkedSection) {
        linkedSectionHeight = linkedSection.offsetHeight;
        const style = window.parent.getComputedStyle(linkedSection);
        linkedSectionGap =
          (parseInt(style.marginBottom) || 0) + (parseInt(style.paddingBottom) || 0);
      }
      if (linkedList) {
        const listStyle = window.parent.getComputedStyle(linkedList);
        linkedListExtra =
          (parseInt(listStyle.paddingTop) || 0) +
          (parseInt(listStyle.paddingBottom) || 0) +
          (parseInt(listStyle.marginTop) || 0) +
          (parseInt(listStyle.marginBottom) || 0) +
          (parseInt(listStyle.borderTopWidth) || 0) +
          (parseInt(listStyle.borderBottomWidth) || 0);
      }
    } catch (e) {}
    if (toolbar && editor && root) {
      const toolbarHeight = toolbar.offsetHeight;
      const toolbarBorder = parseInt(getComputedStyle(toolbar).borderBottomWidth) || 0;
      const editorBorder = parseInt(getComputedStyle(editor).borderTopWidth) || 0;
      const totalOffset =
        toolbarHeight +
        toolbarBorder +
        editorBorder +
        linkedSectionHeight +
        linkedSectionGap +
        linkedListExtra;
      editor.style.height = root.offsetHeight - totalOffset - 3 + 'px'; // -3px 상수값 적용
    }
  }

  window.addEventListener('resize', adjustEditorHeight);
  // 창 크기 변경 시 오버레이 위치도 재계산
  window.addEventListener('resize', function () {
    try {
      updateImageControlsPosition();
    } catch (e) {}
  });
  setTimeout(adjustEditorHeight, 100); // 초기 렌더링 후 1회 호출

  // 연결된 자료 변경 등 외부에서 요청 시 높이 재조정
  window.addEventListener('message', function (event) {
    if (event.data && event.data.action === 'adjust-editor-height') {
      adjustEditorHeight();
    }
  });

  window.addEventListener('message', function (event) {
    if (!quillEditor) return;
    const { action, data } = event.data;
    switch (action) {
      case 'replace-edited-image': {
        console.log('🔄 [Editor] ========================================');
        console.log('🔄 [Editor] 📨 replace-edited-image 메시지 수신!');
        console.log('🔄 [Editor] ========================================');
        try {
          const range = window.__cp_editingImageRange;
          if (!range || !data || !data.dataUrl) {
            console.error('❌ [Editor] 이미지 교체 실패: Range 또는 Data URL 누락', {
              range,
              hasDataUrl: !!(data && data.dataUrl),
            });
            break;
          }
          console.log('✅ [Editor] Range 및 Data URL 확인 완료');
          console.log('📊 [Editor] Data URL 길이:', data.dataUrl.length, 'bytes');
          const length = typeof range.length === 'number' && range.length > 0 ? range.length : 1;
          // 우선 포맷에서 이미지 여부 확인
          let isImageAtRange = false;
          let prevImgNode = null;
          try {
            const fmt = quillEditor.getFormat(range.index, length);
            if (fmt && fmt.image) isImageAtRange = true;
          } catch (e) {}
          // 포맷으로 확인이 어려울 경우 Leaf로 보조 확인
          if (!isImageAtRange) {
            try {
              const leafTuple = quillEditor.getLeaf(range.index);
              const leaf = Array.isArray(leafTuple) ? leafTuple[0] : null;
              if (leaf && leaf.domNode && leaf.domNode.tagName === 'IMG') {
                isImageAtRange = true;
                prevImgNode = leaf.domNode;
              }
            } catch (e) {}
          } else {
            // 포맷으로 이미지가 맞으면 DOM 노드도 찾아둠
            try {
              const leafTuple = quillEditor.getLeaf(range.index);
              const leaf = Array.isArray(leafTuple) ? leafTuple[0] : null;
              if (leaf && leaf.domNode && leaf.domNode.tagName === 'IMG') {
                prevImgNode = leaf.domNode;
              }
            } catch (e) {}
          }
          if (!isImageAtRange) {
            console.error('❌ [Editor] 이미지 교체 실패: Range 위치가 이미지가 아닙니다.', range);
            window.__cp_editingImageRange = null;
            break;
          }
          console.log('✅ [Editor] Range 위치 이미지 확인 완료');

          // 기존 이미지의 크기 스타일 추출
          let prevWidth = null,
            prevHeight = null;
          if (prevImgNode) {
            // style 우선, 없으면 getBoundingClientRect로 픽셀값
            prevWidth = prevImgNode.style.width || prevImgNode.getAttribute('width');
            prevHeight = prevImgNode.style.height || prevImgNode.getAttribute('height');
            const rect = prevImgNode.getBoundingClientRect();
            if ((!prevWidth || prevWidth === 'auto') && rect.width) prevWidth = rect.width + 'px';
            if ((!prevHeight || prevHeight === 'auto') && rect.height)
              prevHeight = rect.height + 'px';
            console.log('📏 [Editor] 기존 이미지 크기:', {
              width: prevWidth,
              height: prevHeight,
            });
          }

          // 기존 이미지 삭제 및 새 이미지 삽입
          console.log('🗑️ [Editor] 기존 이미지 삭제 중...');
          quillEditor.deleteText(range.index, length);
          console.log('➕ [Editor] 새 이미지 삽입 중...');
          quillEditor.insertEmbed(range.index, 'image', data.dataUrl);
          // 새 이미지 노드에 동일 스타일/속성 적용
          setTimeout(() => {
            const leafTuple = quillEditor.getLeaf(range.index);
            const leaf = Array.isArray(leafTuple) ? leafTuple[0] : null;
            if (leaf && leaf.domNode && leaf.domNode.tagName === 'IMG') {
              if (prevWidth) {
                leaf.domNode.style.width = prevWidth;
                leaf.domNode.setAttribute('width', prevWidth.replace('px', ''));
              }
              if (prevHeight) {
                leaf.domNode.style.height = prevHeight;
                leaf.domNode.setAttribute('height', prevHeight.replace('px', ''));
              }
            }
          }, 0);
          quillEditor.setSelection(range.index + 1, 0);
          window.__cp_editingImageRange = null;
          console.log('✅ [Editor] 이미지 교체 완료!');

          // 저장 트리거 (선택) - 부모에 저장 요청 전달
          console.log('💾 [Editor] 드래프트 저장 요청 전송 중...');
          window.parent.postMessage(
            { action: 'cp_save_draft', content: quillEditor.root.innerHTML },
            '*'
          );
          console.log('✅ [Editor] 드래프트 저장 요청 전송 완료');
          console.log('🔄 [Editor] ========================================');
        } catch (err) {
          console.error('❌ [Editor] 이미지 교체 처리 중 오류:', err);
        }
        break;
      }
      case 'cp_update_editing_range':
        if (data && data.range) {
          window.__cp_editingImageRange = data.range;
        } else if (data && data.url) {
          // URL만 온 경우 현재 문서에서 해당 이미지의 최초 인덱스를 탐색해 Range 설정
          try {
            const contents = quillEditor.getContents();
            let idx = 0;
            for (const op of contents.ops) {
              if (op.insert && op.insert.image) {
                if (op.insert.image === data.url) {
                  window.__cp_editingImageRange = { index: idx, length: 1 };
                  break;
                }
                idx += 1;
              } else if (typeof op.insert === 'string') {
                idx += op.insert.length;
              }
            }
          } catch (e) {}
        }
        break;
      case 'set-content':
        console.log('[Editor] set-content 메시지 수신:', {
          hasDelta: !!data.delta,
          hasHtml: data.html !== undefined,
          hasText: data.text !== undefined,
          html: data.html,
        });
          if (data.delta) {
            if (activeEditor === 'tiptap') {
              import('./js/utils/quillToTiptap.js')
                  .then((util) => util.convertDeltaToTipTapJSON(data.delta))
                  .then((json) => {
                    if (tiptapEditor && json) tiptapEditor.commands.setContent(json);
                    else quillEditor.setContents(data.delta);
                  })
                .catch(() => quillEditor.setContents(data.delta));
            } else {
              quillEditor.setContents(data.delta);
              console.log('[Editor] Delta로 콘텐츠 설정 완료');
            }
        } else if (data.html !== undefined) {
          // 빈 문자열이거나 빈 HTML인 경우 완전히 초기화
          if (
            !data.html ||
            data.html.trim() === '' ||
            data.html === '<p><br></p>' ||
            data.html === '<p></p>'
          ) {
            console.log('[Editor] 빈 HTML 감지, 에디터 완전 초기화');
            if (activeEditor === 'tiptap' && tiptapEditor) {
              tiptapEditor.commands.setContent('<p></p>');
            } else {
              quillEditor.setContents([]);
              quillEditor.setText('');
            }
            console.log('[Editor] 에디터 초기화 완료, 현재 길이:', quillEditor.getLength());
          } else {
            console.log('[Editor] HTML 콘텐츠 설정:', data.html.substring(0, 50) + '...');
            if (activeEditor === 'tiptap') {
              initTipTap(data.html).then(() => {
                if (tiptapEditor) tiptapEditor.commands.setContent(data.html);
              });
            } else {
              quillEditor.setContents([]);
              quillEditor.clipboard.dangerouslyPasteHTML(0, data.html);
              quillEditor.setSelection(quillEditor.getLength(), 0);
            }
          }
        } else if (data.text !== undefined) {
          console.log('[Editor] 텍스트 콘텐츠 설정:', data.text || '');
          if (activeEditor === 'tiptap' && tiptapEditor) {
            tiptapEditor.commands.setContent(`<p>${(data.text || '').replace(/</g, '&lt;')}</p>`);
          } else {
            quillEditor.setText(data.text || '');
          }
        } else {
          // data가 없거나 모든 필드가 undefined인 경우 초기화
          console.log('[Editor] 모든 필드가 undefined, 에디터 초기화');
          if (activeEditor === 'tiptap' && tiptapEditor) {
            tiptapEditor.commands.setContent('<p></p>');
          } else {
            quillEditor.setContents([]);
            quillEditor.setText('');
          }
        }
        break;
      case 'get-content':
        // 요청 ID가 있으면 응답 메시지 전송 (TipTap/Quill 구분)
        if (data && data.requestId) {
          if (activeEditor === 'tiptap' && tiptapEditor) {
            window.parent.postMessage(
              {
                action: 'content-response',
                requestId: data.requestId,
                data: { html: tiptapEditor.getHTML() },
              },
              '*'
            );
          } else {
            window.parent.postMessage(
              {
                action: 'content-response',
                requestId: data.requestId,
                data: { html: quillEditor.root.innerHTML },
              },
              '*'
            );
          }
        }
        // 이미지 삽입 등 외부 요청 시 현재 내용 저장
        window.parent.postMessage(
          {
            action: 'cp_save_draft',
            content: activeEditor === 'tiptap' && tiptapEditor ? tiptapEditor.getHTML() : quillEditor.root.innerHTML,
          },
          '*'
        );
        break;
      case 'clear-selection':
        // 선택 영역 해제
        try {
          const length = quillEditor.getLength();
          quillEditor.setSelection(length, 0);
        } catch (e) {
          // 선택 해제 실패 시 무시
        }
        break;
      case 'apply-format':
        if (activeEditor === 'tiptap' && tiptapEditor) {
          switch (data.format) {
            case 'bold':
              tiptapEditor.chain().focus().toggleBold().run();
              break;
            case 'italic':
              tiptapEditor.chain().focus().toggleItalic().run();
              break;
            case 'link':
              if (data.value) tiptapEditor.chain().focus().setLink({ href: data.value }).run();
              else tiptapEditor.chain().focus().unsetLink().run();
              break;
            default:
              // fallback to Quill for unsupported formats (underline etc.)
              const range = quillEditor.getSelection();
              if (range && range.length > 0) {
                quillEditor.formatText(range.index, range.length, data.format, data.value);
              }
          }
        } else {
          const range = quillEditor.getSelection();
          if (range && range.length > 0) {
            quillEditor.formatText(range.index, range.length, data.format, data.value);
          }
        }
        break;
      case 'insert-text':
        // ▼▼▼ [오류 수정] data가 undefined일 수 있으므로 방어 코드 추가 ▼▼▼
        if (!data || !data.text) {
          console.error('insert-text: data 또는 data.text가 없습니다.', {
            action,
            data,
          });
          break;
        }
        if (activeEditor === 'tiptap' && tiptapEditor) {
          tiptapEditor.commands.insertContent(data.text);
        } else {
          const currentRange = quillEditor.getSelection() || {
            index: quillEditor.getLength(),
            length: 0,
          };
          quillEditor.insertText(currentRange.index, data.text);
          quillEditor.setSelection(currentRange.index + data.text.length);
        }
        // ▲▲▲ [수정 완료] ▲▲▲
        break;
      case 'insert-html':
        // 외부에서 HTML 조각을 삽입할 때 사용합니다.
        if (!data || typeof data.html !== 'string') {
          console.error('insert-html: data 또는 data.html이 없습니다.', {
            action,
            data,
          });
          break;
        }
        try {
          const sel = quillEditor.getSelection() || {
            index: quillEditor.getLength(),
            length: 0,
          };

          // HTML 구조를 유지하기 위해 항상 dangerouslyPasteHTML 사용
          // (affiliate 카드와 같은 복잡한 HTML 구조를 위해)
          console.log('🔄 [Editor] HTML 구조 삽입 시도:', data.html.substring(0, 100) + '...');
          if (activeEditor === 'tiptap' && tiptapEditor) {
            try {
              tiptapEditor.commands.insertContent(data.html);
              console.log('✅ [Editor] TipTap에 HTML 구조 삽입 완료');
            } catch (e) {
              console.warn('❌ [Editor] TipTap insertContent 실패, Quill로 폴백', e);
              quillEditor.clipboard.dangerouslyPasteHTML(sel.index, data.html);
            }
          } else {
            quillEditor.clipboard.dangerouslyPasteHTML(sel.index, data.html);
          }
          setTimeout(() => {
            try {
              quillEditor.setSelection(quillEditor.getLength(), 0);
              console.log('✅ [Editor] HTML 구조 삽입 완료');
            } catch (err) {
              console.warn('❌ [Editor] 커서 설정 실패:', err);
            }
          }, 0);

          console.log('✅ [Editor] insert-html 처리 완료');
        } catch (err) {
          console.error('❌ [Editor] insert-html 처리 중 오류:', err);
          // 폴백: 텍스트로 삽입
          try {
            const sel = quillEditor.getSelection() || {
              index: quillEditor.getLength(),
              length: 0,
            };
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = data.html;
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            if (textContent.trim()) {
              quillEditor.insertText(sel.index, textContent);
              quillEditor.setSelection(sel.index + textContent.length, 0);
              console.log('✅ [Editor] insert-html 폴백 텍스트 삽입 완료');
            }
          } catch (fallbackErr) {
            console.error('❌ [Editor] insert-html 폴백도 실패:', fallbackErr);
          }
        }
        break;
      case 'insert-image':
        console.log('➕ [Editor] ========================================');
        console.log('➕ [Editor] 📨 insert-image 메시지 수신!');
        console.log('➕ [Editor] ========================================');
        // If TipTap is active, handle image insertion via TipTap APIs
        if (activeEditor === 'tiptap' && tiptapEditor) {
          try {
            if (data && data.url) {
              tiptapEditor.chain().focus().setImage({ src: data.url }).run();
              break;
            }
            // If dataUrl provided (base64), upload first
            if (data && data.dataUrl) {
              const filename = `editor-image-${Date.now()}.png`;
              // Use IIFE async wrapper to avoid top-level await in message handler
              (async () => {
                try {
                  const resized = await window.chrome?.runtime?.sendMessage?.({
                    action: 'resize_image_in_offscreen',
                    data: { imageDataUrl: data.dataUrl, maxWidth: 1920 },
                  });
                  const dataToUpload = resized && resized.success ? resized.dataUrl : data.dataUrl;
                  const uploadResp = await window.chrome?.runtime?.sendMessage?.({
                    action: 'upload_thumbnail_to_storage',
                    data: { dataUrl: dataToUpload, filename },
                  });
                  const src = uploadResp && uploadResp.success && uploadResp.url ? uploadResp.url : data.dataUrl;
                  tiptapEditor.chain().focus().setImage({ src }).run();
                } catch (e) {
                  tiptapEditor.chain().focus().setImage({ src: data.dataUrl }).run();
                }
              })();
              break;
            }
          } catch (e) {
            console.error('[Editor] TipTap insert-image handling failed:', e);
          }
          // fallback to quill if tiptap handling didn't run through
        }
        // dedupe: if same URL inserted within 500ms, ignore to avoid double inserts
        try {
          const now = Date.now();
          if (
            data &&
            data.url &&
            __cp_lastInsertedImage.url === data.url &&
            now - __cp_lastInsertedImage.ts < 500
          ) {
            console.debug('[Editor] 중복 이미지 삽입 감지, 무시:', data.url);
            break;
          }
        } catch (e) {}

        const imageRange = quillEditor.getSelection() || {
          index: quillEditor.getLength(),
          length: 0,
        };
        if (data.url) {
          __cp_lastInsertedImage = { url: data.url, ts: Date.now() };
          console.log('📸 [Editor] 이미지 삽입 중...');
          quillEditor.insertEmbed(imageRange.index, 'image', data.url);
          quillEditor.setSelection(imageRange.index + 1);
          console.log('✅ [Editor] 이미지 삽입 완료');

          // 이미지 속성 설정 (비동기 처리)
          setTimeout(() => {
            try {
              // 방금 삽입된 이미지를 찾음 (src가 일치하는)
              const insertedImg = quillEditor.root.querySelector(`img[src="${data.url}"]`);
              if (insertedImg) {
                // 1. [SEO 핵심] Alt 텍스트 및 Title 설정
                if (data.alt) {
                  insertedImg.setAttribute('alt', data.alt);
                  insertedImg.setAttribute('title', data.alt); // 툴팁용
                }

                // 2. (기존 코드) 외부 이미지 정책 설정
                insertedImg.setAttribute('referrerpolicy', 'no-referrer');
                insertedImg.setAttribute('crossorigin', 'anonymous');

                // 3. (기존 코드) 네이버 블로그 호환 처리
                if (data.url.includes('postfiles.pstatic.net')) {
                  // type=w966 같은 파라미터 제거하여 원본 URL 시도
                  const originalUrl = data.url.split('?')[0];
                  if (originalUrl !== data.url) {
                    insertedImg.src = originalUrl;
                  }
                }

                // [디버깅] 설정 확인
                console.log('[Editor] 이미지 삽입 완료:', {
                  src: data.url,
                  alt: insertedImg.getAttribute('alt'),
                });
              }
            } catch (e) {
              console.log('이미지 속성 설정 실패:', e);
            }
          }, 100);
        }
        break;
      case 'switch-editor':
        if (data && data.mode === 'tiptap') {
          const html = quillEditor ? quillEditor.root.innerHTML : '';
          initTipTap(html).then(() => {
            if (tiptapEditor) {
              document.querySelector('#editor-container').style.display = 'none';
              document.querySelector('#tiptap-container').style.display = 'block';
              activeEditor = 'tiptap';
            }
          });
        } else if (data && data.mode === 'quill') {
          document.querySelector('#tiptap-container')?.style?.display && (document.querySelector('#tiptap-container').style.display = 'none');
          document.querySelector('#editor-container')?.style?.display && (document.querySelector('#editor-container').style.display = 'block');
          activeEditor = 'quill';
        }
        break;
      case 'focus':
        quillEditor.focus();
        break;
      case 'tiptap-focus':
        if (tiptapEditor) tiptapEditor.chain().focus().run();
        break;
      case 'blur':
        quillEditor.blur();
        break;
      case 'apply-heading':
        if (activeEditor === 'tiptap' && tiptapEditor) {
          // TipTap: apply heading to selection
          tiptapEditor.chain().focus().toggleHeading({ level: data.level }).run();
        } else {
          const headingRange = quillEditor.getSelection();
          if (headingRange && headingRange.length > 0) {
            quillEditor.formatText(headingRange.index, headingRange.length, 'header', data.level);
          }
        }
        break;
      case 'apply-list':
        if (activeEditor === 'tiptap' && tiptapEditor) {
          if (data.type === 'ordered') tiptapEditor.chain().focus().toggleOrderedList().run();
          else tiptapEditor.chain().focus().toggleBulletList().run();
        } else {
          const listRange = quillEditor.getSelection();
          if (listRange) {
            quillEditor.formatLine(listRange.index, listRange.length, 'list', data.type);
          }
        }
        break;
      case 'clear-formatting':
        if (activeEditor === 'tiptap' && tiptapEditor) {
          // TipTap: remove formatting from selection
          tiptapEditor.chain().focus().unsetAllMarks().clearNodes().run();
        } else {
          const clearRange = quillEditor.getSelection();
          if (clearRange && clearRange.length > 0) {
            quillEditor.removeFormat(clearRange.index, clearRange.length);
          }
        }
        break;
      case 'scroll-to-text':
        if (data.text) {
          const editorContent = quillEditor.getText();
          const textIndex = editorContent.indexOf(data.text);
          if (textIndex !== -1) {
            quillEditor.setSelection(textIndex, data.text.length);
            setTimeout(() => {
              const editorRoot = quillEditor.root;
              const selection = window.getSelection();
              if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const editorRect = editorRoot.getBoundingClientRect();
                const targetScrollTop = editorRoot.scrollTop + (rect.top - editorRect.top) - 20;
                editorRoot.scrollTop = targetScrollTop;
              }
            }, 50);
          } else {
            console.log('Text not found in editor:', data.text);
          }
        }
        break;

      // [신규] 썸네일 생성기 -> TUI 에디터 연결 브릿지
      case 'bridge-tui-edit':
        console.log('🌉 [Editor] ========================================');
        console.log('🌉 [Editor] 📨 bridge-tui-edit 메시지 수신!');
        console.log('🌉 [Editor] ========================================');
        if (data && data.url) {
          console.log('📤 [Editor] 부모 창에 cp_open_tui_editor 메시지 전송');
          console.log('📸 [Editor] 이미지 URL:', data.url.substring(0, 50) + '...');
          // 부모 창(Main)에게 TUI 에디터 열기 요청 전송
          try {
            window.parent.postMessage(
              {
                action: 'cp_open_tui_editor',
                currentImageUrl: data.url, // 호환성을 위해 유지
                imageUrl: data.url, // tui-editor.js가 찾는 필드명
                source: 'thumbnail_maker',
                // TUI 에디터 사이드바에 표시할 단일 이미지 목록 구성
                allDocumentImages: [{ url: data.url, range: null }],
              },
              '*'
            );
            console.log('✅ [Editor] cp_open_tui_editor 메시지 전송 완료');
            console.log('🌉 [Editor] ========================================');
          } catch (err) {
            console.error('❌ [Editor] 메시지 전송 실패:', err);
          }
        } else {
          console.error('❌ [Editor] bridge-tui-edit: data.url이 없음', data);
        }
        break;
      case 'get-content':
        window.parent.postMessage(
          {
            action: 'content-response',
            requestId: data.requestId || null,
            data: {
              content: quillEditor.getContents(),
              html: quillEditor.root.innerHTML,
              text: quillEditor.getText(),
            },
          },
          '*'
        );
        break;
      case 'edit-image': {
        // TUI 에디터 iframe에 이미지 전달
        tuiEditorIframe.contentWindow.postMessage(
          {
            action: 'set-image',
            data: { dataUrl: imageUrl },
          },
          '*'
        );
        // 이미지 set 후 undo/redo 스택에 첫 상태 강제 push
        setTimeout(() => {
          tuiEditorIframe.contentWindow.postMessage(
            {
              action: 'add-undo-stack',
            },
            '*'
          );
        }, 300);
        break;
      }
      default:
        console.log('Unknown action:', action);
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initializeEditor();
  const TOOLBAR_TITLES_KO = {
    bold: '굵게 (Ctrl+B)',
    italic: '기울임꼴 (Ctrl+I)',
    underline: '밑줄 (Ctrl+U)',
    strike: '취소선',
    blockquote: '인용구',
    'code-block': '코드 블록',
    list: '목록',
    ordered: '순서 목록',
    bullet: '글머리 기호',
    sub: '아래 첨자',
    super: '위 첨자',
    indent: '들여쓰기/내어쓰기',
    direction: '텍스트 방향',
    size: '글꼴 크기',
    color: '글꼴 색상',
    background: '배경 색상',
    font: '글꼴',
    align: '정렬',
    link: '링크 삽입 (Ctrl+K)',
    image: '이미지 삽입',
    video: '비디오 삽입',
    clean: '서식 지우기',
    undo: '실행 취소 (Ctrl+Z)',
    redo: '다시 실행 (Ctrl+Y)',
  };
  const toolbarContainer = quillEditor.container.querySelector('.ql-toolbar');
  if (toolbarContainer) {
    toolbarContainer.querySelectorAll('button, span.ql-picker').forEach((element) => {
      const className = Array.from(element.classList).find((cls) => cls.startsWith('ql-'));
      if (className) {
        const formatName = className.substring(3);
        const title = TOOLBAR_TITLES_KO[formatName];
        if (title) {
          element.setAttribute('title', title);
          element.setAttribute('aria-label', title);
        }
      }
      // TipTap 전환 버튼 추가 (POC)
      try {
        const tipTapBtn = document.createElement('button');
        tipTapBtn.type = 'button';
        tipTapBtn.className = 'ql-switch-to-tiptap';
        tipTapBtn.innerText = 'TipTap';
        tipTapBtn.title = 'Switch to TipTap (experimental)';
        tipTapBtn.style.marginLeft = '8px';
        tipTapBtn.addEventListener('click', async () => {
          const html = quillEditor ? quillEditor.root.innerHTML : '';
          await initTipTap(html);
          if (tiptapEditor) {
            document.querySelector('#editor-container').style.display = 'none';
            document.querySelector('#tiptap-container').style.display = 'block';
            activeEditor = 'tiptap';
          }
        });
        toolbarContainer.appendChild(tipTapBtn);
      } catch (e) {}
    });
  }
  window.parent.postMessage({ action: 'editor-ready' }, '*');
});

window.addEventListener('error', function (event) {
  console.error('Editor iframe error:', event.error);
  window.parent.postMessage({ action: 'editor-error', error: event.error.message }, '*');
});
