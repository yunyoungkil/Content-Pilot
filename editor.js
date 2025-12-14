import { Logger } from './js/utils.js';

// Send a message to parent to confirm loading
try {
  window.parent.postMessage({ action: 'editor-loaded-signal', source: 'editor.js' }, '*');
} catch(e) {
  // ignore
}

// [Removed] Backward-compat id alias: We keep #editor-container as is to match CSS.
// if (typeof document !== 'undefined' && document && document.querySelector && document.querySelector('#editor-container')) {
//   if (!document.querySelector('#tiptap-container')) document.querySelector('#editor-container').id = 'tiptap-container';
// }

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
// Quill removed; TipTap uses its own image handling (no Quill.register needed)


let tiptapEditor = null;
let _initPromise = null;

// TipTap 초기화 함수 (동적 import 기반)
async function initTipTap(initialHtml = '') {
  console.log('[Editor] initTipTap called');
  console.debug('[Editor] initTipTap starting');
  if (tiptapEditor) return tiptapEditor;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const [{ Editor }, StarterKitModule, ImageModule, LinkModule, TaskListModule, TaskItemModule, UnderlineModule, TextAlignModule, PlaceholderModule, HighlightModule, TextStyleModule, ColorModule] = await Promise.all([
        import(/* webpackChunkName: "tiptap-core" */ '@tiptap/core'),
        import(/* webpackChunkName: "tiptap-starter" */ '@tiptap/starter-kit'),
        import(/* webpackChunkName: "tiptap-image" */ '@tiptap/extension-image'),
        import(/* webpackChunkName: "tiptap-link" */ '@tiptap/extension-link'),
        import(/* webpackChunkName: "tiptap-task-list" */ '@tiptap/extension-task-list'),
        import(/* webpackChunkName: "tiptap-task-item" */ '@tiptap/extension-task-item'),
        import(/* webpackChunkName: "tiptap-underline" */ '@tiptap/extension-underline'),
        import(/* webpackChunkName: "tiptap-text-align" */ '@tiptap/extension-text-align'),
        import(/* webpackChunkName: "tiptap-placeholder" */ '@tiptap/extension-placeholder'),
        import(/* webpackChunkName: "tiptap-highlight" */ '@tiptap/extension-highlight'),
        import(/* webpackChunkName: "tiptap-text-style" */ '@tiptap/extension-text-style'),
        import(/* webpackChunkName: "tiptap-color" */ '@tiptap/extension-color'),
      ]);
      // ... (rest of initialization)
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
      const TaskList = normalize(TaskListModule, 'TaskList');
      const TaskItem = normalize(TaskItemModule, 'TaskItem');
      const Underline = normalize(UnderlineModule, 'Underline');
      const TextAlign = normalize(TextAlignModule, 'TextAlign');
      const Placeholder = normalize(PlaceholderModule, 'Placeholder');
      const Highlight = normalize(HighlightModule, 'Highlight');
      const TextStyle = normalize(TextStyleModule, 'TextStyle');
      const Color = normalize(ColorModule, 'Color');

      // Custom Image Extension with Resize
      let CustomImage = null;
      try {
        if (Image && typeof Image.extend === 'function') {
          CustomImage = Image.extend({
            addAttributes() {
              return {
                src: { default: null },
                alt: { default: null },
                title: { default: null },
                width: {
                  default: null,
                  parseHTML: element => element.style.width,
                  renderHTML: attributes => {
                    if (!attributes.width) return {};
                    return { style: `width: ${attributes.width}` };
                  },
                },
                textAlign: {
                  default: 'center',
                  parseHTML: element => element.getAttribute('data-align'),
                  renderHTML: attributes => {
                    if (!attributes.textAlign) return {};
                    return { 'data-align': attributes.textAlign };
                  },
                }
              };
            },
            addKeyboardShortcuts() {
              return {
                'Alt-Shift-l': () => this.editor.commands.updateAttributes('image', { textAlign: 'left' }),
                'Alt-Shift-e': () => this.editor.commands.updateAttributes('image', { textAlign: 'center' }),
                'Alt-Shift-r': () => this.editor.commands.updateAttributes('image', { textAlign: 'right' }),
              };
            },
            addNodeView() {
              return ({ node, editor, getPos }) => {
                const { view } = editor;
                let currentNode = node;
                
                // Outer container for alignment
                const container = document.createElement('div');
                container.classList.add('image-resizer-container');
                container.style.display = 'flex';
                
                // Inner wrapper for resizing context
                const wrapper = document.createElement('div');
                wrapper.classList.add('image-resizer'); // Keep class for CSS hooks
                wrapper.style.position = 'relative';
                wrapper.style.display = 'inline-block';
                wrapper.style.lineHeight = '0';
                
                container.appendChild(wrapper);
                
                const img = document.createElement('img');
                img.src = node.attrs.src;
                img.alt = node.attrs.alt;
                if (node.attrs.title) img.title = node.attrs.title;
                if (node.attrs.width) img.style.width = node.attrs.width;
                
                wrapper.appendChild(img);
                
                // Alignment Actions
                const actions = document.createElement('div');
                actions.classList.add('image-actions');
                
                const createBtn = (align, path) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.title = `Align ${align}`;
                    btn.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
                    
                    btn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof getPos === 'function') {
                            const pos = getPos();
                            if (pos !== undefined) {
                                view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                                    ...currentNode.attrs,
                                    textAlign: align
                                }));
                            }
                        }
                    });
                    return btn;
                };
                
                const leftBtn = createBtn('left', '<path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z" fill="currentColor"/>');
                const centerBtn = createBtn('center', '<path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" fill="currentColor"/>');
                const rightBtn = createBtn('right', '<path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z" fill="currentColor"/>');
                
                actions.appendChild(leftBtn);
                actions.appendChild(centerBtn);
                actions.appendChild(rightBtn);
                wrapper.appendChild(actions);

                // Left Handle
                const handleLeft = document.createElement('div');
                handleLeft.classList.add('resize-handle', 'left');
                wrapper.appendChild(handleLeft);

                // Right Handle
                const handleRight = document.createElement('div');
                handleRight.classList.add('resize-handle', 'right');
                wrapper.appendChild(handleRight);
                
                let startX, startWidth;
                let activeHandle = null; // 'left' or 'right'
                
                const onMouseMove = (e) => {
                    let currentWidth;
                    if (activeHandle === 'right') {
                        currentWidth = Math.max(50, startWidth + (e.clientX - startX));
                    } else {
                        // Dragging left handle left (negative delta) increases width
                        currentWidth = Math.max(50, startWidth - (e.clientX - startX));
                    }
                    img.style.width = `${currentWidth}px`;
                };
                
                const onMouseUp = (e) => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    let currentWidth;
                    if (activeHandle === 'right') {
                        currentWidth = Math.max(50, startWidth + (e.clientX - startX));
                    } else {
                        currentWidth = Math.max(50, startWidth - (e.clientX - startX));
                    }

                    if (typeof getPos === 'function') {
                        const pos = getPos();
                        if (pos !== undefined) {
                            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                                ...currentNode.attrs,
                                width: `${currentWidth}px`
                            }));
                        }
                    }
                    activeHandle = null;
                };
                
                const startDrag = (e, direction) => {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent editor selection changes
                    activeHandle = direction;
                    startX = e.clientX;
                    startWidth = img.offsetWidth;
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                };

                handleLeft.addEventListener('mousedown', (e) => startDrag(e, 'left'));
                handleRight.addEventListener('mousedown', (e) => startDrag(e, 'right'));
                
                const updateState = (n) => {
                    currentNode = n;
                    // Update Image
                    img.src = n.attrs.src;
                    img.alt = n.attrs.alt;
                    if (n.attrs.title) img.title = n.attrs.title;
                    if (n.attrs.width) img.style.width = n.attrs.width;
                    
                    // Update Alignment
                    const align = n.attrs.textAlign || 'center';
                    if (align === 'left') container.style.justifyContent = 'flex-start';
                    else if (align === 'right') container.style.justifyContent = 'flex-end';
                    else container.style.justifyContent = 'center';
                    
                    // Update Buttons
                    leftBtn.classList.toggle('active', align === 'left');
                    centerBtn.classList.toggle('active', align === 'center');
                    rightBtn.classList.toggle('active', align === 'right');
                };
                
                updateState(node);
                
                return {
                  dom: container,
                  update: (updatedNode) => {
                    if (updatedNode.type.name !== 'image') return false;
                    updateState(updatedNode);
                    return true;
                  },
                  selectNode: () => {
                      wrapper.classList.add('ProseMirror-selectednode');
                  },
                  deselectNode: () => {
                      wrapper.classList.remove('ProseMirror-selectednode');
                  }
                };
              };
            },
          });
        }
      } catch (e) {
        console.error('CustomImage creation failed', e);
        CustomImage = null;
      }
      console.log('[Editor] CustomImage initialized:', !!CustomImage);

      // store for re-init when lazy-loading extensions
      _StarterKit = StarterKit;
      _Image = CustomImage || Image;
      _Link = Link;
      _EditorClass = Editor;
      // Table extensions will be loaded lazily when the user inserts a table.
      let Table = null;
      let TableRow = null;
      let TableCell = null;
      let TableHeader = null;

      const container = document.querySelector('#editor-container') || document.querySelector('#tiptap-container');
      if (!container) throw new Error('Editor container not found');
      
      // Visual feedback for loading
      if (!container.hasChildNodes()) {
          container.innerHTML = '<div style="padding:20px; color:#888;">Loading Editor...</div>';
      }

      container.setAttribute('tabindex', '0');

      tiptapEditor = new Editor({
        element: container,
        extensions: [
          // StarterKit may be a function factory or an object
          ...(typeof StarterKit === 'function' ? [StarterKit()] : StarterKit ? [StarterKit] : []),
          ...(CustomImage ? [CustomImage.configure({ inline: false })] : Image ? [Image.configure({ inline: false })] : []),
          ...(Link && typeof Link.configure === 'function' ? [Link.configure({ openOnClick: true })] : Link ? [Link] : []),
          ...(TaskList ? [TaskList] : []),
          ...(TaskItem ? [TaskItem.configure({ nested: true })] : []),
          ...(Underline ? [Underline] : []),
          ...(TextAlign ? [TextAlign.configure({ types: ['heading', 'paragraph', 'image'] })] : []),
          ...(Placeholder ? [Placeholder.configure({ placeholder: 'Write something...' })] : []),
          ...(Highlight ? [Highlight.configure({ multicolor: true })] : []),
          ...(TextStyle ? [TextStyle] : []),
          ...(Color ? [Color] : []),
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
      console.debug('[Editor] TipTap initialized', tiptapEditor);

      // Clear loading message if present (TipTap appends to container, so we might need to clean up)
      const loadingDiv = Array.from(container.children).find(c => c.textContent === 'Loading Editor...');
      if (loadingDiv) container.removeChild(loadingDiv);

      // Bind TipTap toolbar
      try {
        const toolbar = document.getElementById('tiptap-toolbar');
        if (toolbar) {
            const bind = (id, callback) => {
                const btn = document.getElementById(id);
                if (btn) btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    callback();
                });
            };

            bind('undo', () => tiptapEditor.chain().focus().undo().run());
            bind('redo', () => tiptapEditor.chain().focus().redo().run());
            bind('bold', () => tiptapEditor.chain().focus().toggleBold().run());
            bind('italic', () => tiptapEditor.chain().focus().toggleItalic().run());
            bind('underline', () => tiptapEditor.chain().focus().toggleUnderline().run());
            bind('strike', () => tiptapEditor.chain().focus().toggleStrike().run());
            
            // Highlight Popup Logic
            const highlightBtn = document.getElementById('highlight');
            const colorPopup = document.getElementById('color-popup');
            if (highlightBtn && colorPopup) {
                highlightBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = highlightBtn.getBoundingClientRect();
                    colorPopup.style.top = `${rect.bottom + 4}px`;
                    colorPopup.style.left = `${rect.left}px`;
                    colorPopup.classList.toggle('is-visible');
                    document.getElementById('link-popup')?.classList.remove('is-visible');
                });
                
                // Close popup when clicking outside
                document.addEventListener('click', (e) => {
                    if (!highlightBtn.contains(e.target) && !colorPopup.contains(e.target)) {
                        colorPopup.classList.remove('is-visible');
                    }
                });

                // Color options
                colorPopup.querySelectorAll('.color-option').forEach(opt => {
                    opt.addEventListener('click', (e) => {
                        e.preventDefault();
                        const color = opt.getAttribute('data-color');
                        tiptapEditor.chain().focus().toggleHighlight({ color }).run();
                        colorPopup.classList.remove('is-visible');
                    });
                });

                // Remove highlight
                document.getElementById('remove-highlight')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    tiptapEditor.chain().focus().unsetHighlight().run();
                    colorPopup.classList.remove('is-visible');
                });
            }
            
            const listSelect = document.getElementById('list-select');
            if (listSelect) {
                listSelect.addEventListener('change', (e) => {
                    const type = e.target.value;
                    // Reset lists first if needed, or just toggle
                    if (type === 'bullet') tiptapEditor.chain().focus().toggleBulletList().run();
                    else if (type === 'ordered') tiptapEditor.chain().focus().toggleOrderedList().run();
                    else if (type === 'task') tiptapEditor.chain().focus().toggleTaskList().run();
                    
                    // Reset select to default label if toggled off? 
                    // Actually, toggle behavior might be tricky with a select. 
                    // If I select "Bullet", it becomes bullet. If I select it again... select doesn't fire change if value is same.
                    // So we should probably reset the select value to default after action, or handle it differently.
                    // But for now, let's just run the command.
                    // Better UX: If I select "Bullet", it turns into bullet list.
                    // If I want to turn it off, I might need to select "Lists" (default) or toggle another one.
                    // Let's make the default option selectable to clear lists?
                    // Or just rely on the fact that toggling another list type switches it.
                    // To toggle OFF, user might need to click the active button in a button group, but here we have a select.
                    // Let's assume selecting the same type again isn't possible with standard select change event.
                    // We can reset the value to '' after execution so user can select it again?
                    // Let's try keeping the value as the active state.
                });
            }

            bind('blockquote', () => tiptapEditor.chain().focus().toggleBlockquote().run());
            bind('code-block', () => tiptapEditor.chain().focus().toggleCodeBlock().run());
            bind('align-left', () => tiptapEditor.chain().focus().setTextAlign('left').run());
            bind('align-center', () => tiptapEditor.chain().focus().setTextAlign('center').run());
            bind('align-right', () => tiptapEditor.chain().focus().setTextAlign('right').run());
            bind('align-justify', () => tiptapEditor.chain().focus().setTextAlign('justify').run());
            
            // Link Popup Logic
            const linkBtn = document.getElementById('add-link');
            const linkPopup = document.getElementById('link-popup');
            const linkInput = document.getElementById('link-url-input');
            
            if (linkBtn && linkPopup && linkInput) {
                linkBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (linkPopup.classList.contains('is-visible')) {
                        linkPopup.classList.remove('is-visible');
                        return;
                    }

                    const previousUrl = tiptapEditor.getAttributes('link').href;
                    linkInput.value = previousUrl || '';
                    
                    const rect = linkBtn.getBoundingClientRect();
                    linkPopup.style.top = `${rect.bottom + 4}px`;
                    linkPopup.style.left = `${rect.left - 100}px`; // Shift left slightly
                    linkPopup.classList.add('is-visible');
                    document.getElementById('color-popup')?.classList.remove('is-visible');
                    setTimeout(() => linkInput.focus(), 50);
                });

                const applyLink = () => {
                    const url = linkInput.value;
                    if (url === '') {
                        tiptapEditor.chain().focus().extendMarkRange('link').unsetLink().run();
                    } else {
                        tiptapEditor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                    }
                    linkPopup.classList.remove('is-visible');
                };

                document.getElementById('apply-link')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    applyLink();
                });

                document.getElementById('remove-link')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    tiptapEditor.chain().focus().extendMarkRange('link').unsetLink().run();
                    linkPopup.classList.remove('is-visible');
                });

                linkInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        applyLink();
                    }
                });

                // Close popup when clicking outside
                document.addEventListener('click', (e) => {
                    if (!linkBtn.contains(e.target) && !linkPopup.contains(e.target)) {
                        linkPopup.classList.remove('is-visible');
                    }
                });
            }

            // Image Upload Modal Logic
            const imageBtn = document.getElementById('add-image');
            const imageModal = document.getElementById('image-modal');
            const dropZone = document.getElementById('drop-zone');
            
            if (imageBtn && imageModal && dropZone) {
                imageBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    imageModal.classList.add('is-visible');
                });

                imageModal.addEventListener('click', (e) => {
                    if (e.target === imageModal) {
                        imageModal.classList.remove('is-visible');
                    }
                });

                const handleImageUpload = async (file) => {
                    if (!file || !file.type.startsWith('image/')) return;
                    
                    imageModal.classList.remove('is-visible');
                    
                    // Show loading placeholder or similar if needed
                    // For now, just reuse the existing logic
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

                // Click to upload
                dropZone.addEventListener('click', () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                        const file = e.target.files && e.target.files[0];
                        handleImageUpload(file);
                    };
                    input.click();
                });

                // Drag and Drop
                dropZone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dropZone.classList.add('drag-over');
                });

                dropZone.addEventListener('dragleave', () => {
                    dropZone.classList.remove('drag-over');
                });

                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('drag-over');
                    const file = e.dataTransfer.files && e.dataTransfer.files[0];
                    handleImageUpload(file);
                });
            }

            const headingSelect = document.getElementById('heading-select');
            if (headingSelect) {
                headingSelect.addEventListener('change', (e) => {
                    const level = e.target.value;
                    if (level === 'p') {
                        tiptapEditor.chain().focus().setParagraph().run();
                    } else {
                        tiptapEditor.chain().focus().toggleHeading({ level: parseInt(level) }).run();
                    }
                });
            }
            
            // Update toolbar state on selection update
            tiptapEditor.on('selectionUpdate', ({ editor }) => {
                const updateActive = (id, isActive) => {
                    const btn = document.getElementById(id);
                    if (btn) btn.classList.toggle('is-active', isActive);
                };
                
                updateActive('bold', editor.isActive('bold'));
                updateActive('italic', editor.isActive('italic'));
                updateActive('underline', editor.isActive('underline'));
                updateActive('strike', editor.isActive('strike'));
                updateActive('highlight', editor.isActive('highlight'));
                
                if (listSelect) {
                    if (editor.isActive('bulletList')) listSelect.value = 'bullet';
                    else if (editor.isActive('orderedList')) listSelect.value = 'ordered';
                    else if (editor.isActive('taskList')) listSelect.value = 'task';
                    else listSelect.value = ''; // Reset to default "Lists" option
                }

                updateActive('blockquote', editor.isActive('blockquote'));
                updateActive('code-block', editor.isActive('codeBlock'));
                updateActive('align-left', editor.isActive({ textAlign: 'left' }));
                updateActive('align-center', editor.isActive({ textAlign: 'center' }));
                updateActive('align-right', editor.isActive({ textAlign: 'right' }));
                updateActive('align-justify', editor.isActive({ textAlign: 'justify' }));
                
                if (headingSelect) {
                    if (editor.isActive('heading', { level: 1 })) headingSelect.value = '1';
                    else if (editor.isActive('heading', { level: 2 })) headingSelect.value = '2';
                    else if (editor.isActive('heading', { level: 3 })) headingSelect.value = '3';
                    else headingSelect.value = 'p';
                }
            });
        }
      } catch (e) {
        console.error('Toolbar setup failed', e);
      }


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
      const container = document.querySelector('#editor-container') || document.querySelector('#tiptap-container');
      if (container) {
          container.innerHTML = `<div style="color:red; padding:20px;">
              <h3>Editor Error</h3>
              <p>Failed to load editor.</p>
              <pre>${err.message}</pre>
          </div>`;
      }
      return null;
    } finally {
      _initPromise = null;
    }
  })();
  return _initPromise;
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

// Auto initialize TipTap when iframe loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initTipTap().catch(e => console.error('[Editor] initTipTap async error at DOMContentLoaded:', e));
  });
} else {
  initTipTap().catch(e => console.error('[Editor] initTipTap async error on immediate init:', e));
}

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
// Quill shim: provide minimal API surface used elsewhere so legacy calls don't error
const quillEditor = {
  root: { 
    get innerHTML() { return tiptapEditor ? tiptapEditor.getHTML() : ''; } 
  },
  getText: (index, length) => {
    if (!tiptapEditor) return '';
    if (typeof index === 'undefined') return tiptapEditor.getText();
    try {
      const from = index;
      const to = index + (length || 0);
      return tiptapEditor.state.doc.textBetween(from, to);
    } catch (e) { return tiptapEditor.getText(); }
  },
  getLength: () => (tiptapEditor ? tiptapEditor.getText().length : 0),
  getContents: () => (tiptapEditor ? tiptapEditor.getJSON() : null),
  setContents: (data) => { 
    if (tiptapEditor) {
      try { 
        if (typeof data === 'string') {
          tiptapEditor.commands.setContent(data); 
        } else {
          // Fallback for Delta objects: try to extract text or show error
          console.warn('[Editor] Received Delta but converter failed or not loaded. Attempting plain text extraction.');
          let text = '';
          if (data && data.ops) {
            data.ops.forEach(op => {
              if (typeof op.insert === 'string') text += op.insert;
            });
          }
          if (text) {
            // Simple text to HTML conversion
            const html = text.split('\n').map(line => `<p>${line}</p>`).join('');
            tiptapEditor.commands.setContent(html);
          } else {
            tiptapEditor.commands.setContent('<p><i>(Content format not supported or empty)</i></p>');
          }
        } 
      } catch (e) {
        console.error('[Editor] setContents failed', e);
      } 
    }
  },
  setText: (text) => { if (tiptapEditor) try { tiptapEditor.commands.setContent(`<p>${(text||'').replace(/</g,'&lt;')}</p>`); } catch (e) {} },
  deleteText: (index, length) => { if (tiptapEditor) try { const from = index; const to = index + (length || 0); tiptapEditor.chain().focus().deleteRange({ from, to }).run(); } catch (e) {} },
  insertEmbed: (index, type, data) => { if (type === 'image' && tiptapEditor) try { tiptapEditor.chain().focus().setImage({ src: data }).run(); } catch (e) {} },
  insertText: (index, text) => { if (tiptapEditor) try { tiptapEditor.chain().focus().insertContent(text).run(); } catch (e) {} },
  getFormat: () => ({}),
  getLeaf: () => null,
  setSelection: () => {},
  formatText: () => {},
  history: { undo: () => { if (tiptapEditor) try { tiptapEditor.chain().focus().undo().run(); } catch (e) {} }, redo: () => { if (tiptapEditor) try { tiptapEditor.chain().focus().redo().run(); } catch (e) {} } },
  clipboard: { dangerouslyPasteHTML: (index, html) => { if (tiptapEditor) try { tiptapEditor.commands.insertContent(html); } catch (e) {} } }
};

// Keep module references for re-initialization when lazy-loading extensions
let _StarterKit = null;
let _Image = null;
let _Link = null;
let _EditorClass = null;
let activeEditor = 'tiptap'; // only TipTap now

// Guard against duplicate insert-image messages arriving almost simultaneously
// (e.g. from multiple UI contexts). Ignore a duplicate insert for the same URL
// if received within this window.
let __cp_lastInsertedImage = { url: null, ts: 0 };

// Undo/Redo icons are handled by TipTap or CSS; Quill Icons stub removed.

function initializeEditor() {
  console.warn('Quill removed.');
}



  window.addEventListener('message', function (event) {
    if (!quillEditor) return;
    const { action, data } = event.data;
    switch (action) {
      case 'replace-edited-image': {
        console.log('🔄 [Editor] replace-edited-image (TipTap) 메시지 수신!');
        try {
          if (!data || !data.dataUrl) {
            console.error('❌ [Editor] 이미지 교체 실패: Data URL 누락', { data });
            break;
          }
          const newUrl = data.dataUrl;
          const selectedUrl = window.__cp_selectedImageUrl;
          if (!selectedUrl) {
            console.warn('[Editor] no selected image URL to replace');
          }
          if (tiptapEditor && selectedUrl) {
            const html = tiptapEditor.getHTML();
            if (html && html.indexOf(selectedUrl) !== -1) {
              const newHtml = html.replace(selectedUrl, newUrl);
              tiptapEditor.commands.setContent(newHtml);
              window.__cp_editingImageRange = null;
              try {
                const _ts = Date.now();
                Logger.debug('[Editor] Sending cp_save_draft (replace-image)', { ts: _ts, length: (tiptapEditor?.getHTML?.() || '').length });
                window.parent.postMessage({ action: 'cp_save_draft', content: tiptapEditor.getHTML(), ts: _ts }, '*');
              } catch (e) {
                console.error('[Editor] Failed to post cp_save_draft (replace-image):', e);
              }
              console.log('✅ [Editor] 이미지 교체 완료 (TipTap)');
            } else {
              console.warn('[Editor] 선택된 이미지가 TipTap 콘텐츠에서 발견되지 않음');
            }
          }
        } catch (err) {
          console.error('❌ [Editor] 이미지 교체 처리 중 오류 (TipTap):', err);
        }
        break;
      }
      case 'cp_update_editing_range':
        if (data && data.range) {
          window.__cp_editingImageRange = data.range;
        } else if (data && data.url) {
          // URL만 온 경우 TipTap의 HTML에서 해당 이미지의 첫 텍스트 위치를 대략 계산하여 Range 설정 (간단한 폴백)
          try {
            const url = data.url;
            window.__cp_selectedImageUrl = url;
            if (tiptapEditor) {
              const html = tiptapEditor.getHTML();
              const idx = html.indexOf(url);
              if (idx !== -1) {
                window.__cp_editingImageRange = { index: idx, length: 1 };
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
                .catch((err) => {
                    console.error('[Editor] Failed to load quillToTiptap converter:', err);
                    quillEditor.setContents(data.delta);
                });
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
            if (activeEditor === 'tiptap') {
              initTipTap().then((editor) => {
                if (editor) editor.commands.setContent('<p></p>');
              });
            } else {
              if (tiptapEditor) { try { tiptapEditor.commands.setContent('<p></p>'); } catch (e) {} }
            }
            console.log('[Editor] 에디터 초기화 완료');
          } else {
            console.log('[Editor] HTML 콘텐츠 설정:', data.html.substring(0, 50) + '...');
            if (activeEditor === 'tiptap') {
              initTipTap(data.html).then((editor) => {
                if (editor) editor.commands.setContent(data.html);
              });
            } else {
              quillEditor.setContents([]);
              quillEditor.clipboard.dangerouslyPasteHTML(0, data.html);
              quillEditor.setSelection(quillEditor.getLength(), 0);
            }
          }
        } else if (data.text !== undefined) {
          console.log('[Editor] 텍스트 콘텐츠 설정:', data.text || '');
          if (activeEditor === 'tiptap') {
            initTipTap().then((editor) => {
                if (editor) editor.commands.setContent(`<p>${(data.text || '').replace(/</g, '&lt;')}</p>`);
            });
          } else {
            quillEditor.setText(data.text || '');
          }
        } else {
          // data가 없거나 모든 필드가 undefined인 경우 초기화
          console.log('[Editor] 모든 필드가 undefined, 에디터 초기화');
          if (activeEditor === 'tiptap') {
            initTipTap().then((editor) => {
                if (editor) editor.commands.setContent('<p></p>');
            });
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
                data: { html: (tiptapEditor ? tiptapEditor.getHTML() : '') },
              },
              '*'
            );
          }
        }
        // 이미지 삽입 등 외부 요청 시 현재 내용 저장
        try {
          const _ts = Date.now();
          Logger.debug('[Editor] Sending cp_save_draft (get-content)', { ts: _ts, length: (tiptapEditor ? tiptapEditor.getHTML() : '').length });
          window.parent.postMessage(
            {
              action: 'cp_save_draft',
              content: (tiptapEditor ? tiptapEditor.getHTML() : ''),
              ts: _ts,
            },
            '*'
          );
        } catch (e) {
          console.error('[Editor] Failed to post cp_save_draft (get-content):', e);
        }
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
              document.querySelector('#editor-container').style.display = 'block';
              activeEditor = 'tiptap';
            }
          });
        } else if (data && data.mode === 'quill') {
          document.querySelector('#editor-container')?.style?.display && (document.querySelector('#editor-container').style.display = 'none');
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
          const editorContent = (tiptapEditor ? tiptapEditor.getText() : '');
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
              content: (tiptapEditor ? tiptapEditor.getJSON() : null),
              html: quillEditor.root.innerHTML,
              text: (tiptapEditor ? tiptapEditor.getText() : ''),
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

document.addEventListener('DOMContentLoaded', async function () {
  await initTipTap();
  window.parent.postMessage({ action: 'editor-ready' }, '*');
});

window.addEventListener('error', function (event) {
  console.error('Editor iframe error:', event.error);
  window.parent.postMessage({ action: 'editor-error', error: event.error.message }, '*');
});
