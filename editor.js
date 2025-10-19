// W-17: 이미지 편집 툴팁 오버레이 생성/제거 및 액션 메시지
let __cp_currentImageForControls = null; // 현재 오버레이가 붙은 이미지 참조
let __cp_controlsScrollRoot = null; // 스크롤 이벤트를 구독하는 루트(.ql-editor)

function removeImageControls() {
  const doc = document;
  const controls = doc.querySelector(".editor-image-controls");
  if (controls) controls.parentNode.removeChild(controls);
  __cp_currentImageForControls = null;
  if (__cp_controlsScrollRoot) {
    try {
      __cp_controlsScrollRoot.removeEventListener(
        "scroll",
        updateImageControlsPosition
      );
    } catch (e) {}
    __cp_controlsScrollRoot = null;
  }
}

function updateImageControlsPosition() {
  const doc = document;
  const controls = doc.querySelector(".editor-image-controls");
  const img = __cp_currentImageForControls;
  if (!controls || !img || !img.isConnected) return;
  const container =
    doc.querySelector(".ql-container") ||
    img.closest(".ql-container") ||
    doc.body;
  const imgRect = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  // 이미지 중앙 상단 30px 위에 배치
  const top = imgRect.top - containerRect.top - 30;
  const left = imgRect.left - containerRect.left + imgRect.width / 2;
  controls.style.top = top + "px";
  controls.style.left = left + "px";
}

function showImageControls(img) {
  removeImageControls();
  const doc = document;
  // 태그형 스몰 버튼 스타일을 문서에 1회 주입
  if (!doc.getElementById("cp-image-controls-style")) {
    const style = doc.createElement("style");
    style.id = "cp-image-controls-style";
    style.textContent = `
      .editor-image-controls{ 
        padding: 6px 8px; 
        background: rgba(255,255,255,0.96);
        border: 1px solid #E5EAF0; 
        border-radius: 10px; 
        box-shadow: 0 6px 16px rgba(16,24,40,0.12); 
        backdrop-filter: saturate(160%) blur(8px);
        pointer-events: auto;
      }
      .editor-image-controls .tag-btn{ 
        display: inline-flex; 
        align-items: center; 
        justify-content: center;
        gap: 0; 
        width: 28px;
        height: 28px; 
        padding: 0; 
        font-size: 16px; 
        line-height: 1; 
        color: #111827; 
        background: #F9FAFB; 
        border: 1px solid #E5EAF0; 
        border-radius: 999px; 
        cursor: pointer; 
        transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease; 
        box-shadow: 0 1px 2px rgba(16,24,40,0.06);
      }
      .editor-image-controls .tag-btn:hover{ 
        background: #F3F4F6; 
        border-color: #CBD5E1;
        transform: scale(1.05);
      }
      .editor-image-controls .tag-btn:active{ 
        background: #E5E7EB; 
        box-shadow: 0 0 0 2px rgba(45,140,240,0.15) inset;
        transform: scale(0.95);
      }
      .editor-image-controls .tag-btn + .tag-btn{ margin-left: 6px; }
    `;
    doc.head.appendChild(style);
  }
  const controls = doc.createElement("div");
  controls.className = "editor-image-controls";
  controls.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
        <circle cx="12" cy="12" r="12" fill="#2D8CF0"/>
        <text x="12" y="16" text-anchor="middle" fill="#fff" font-size="12" font-family="Arial" font-weight="bold">CP</text>
      </svg>
      <button type="button" class="tag-btn ai-edit-btn" title="AI 이미지 수정">🧠</button>
      <button type="button" class="tag-btn tui-edit-btn" title="TUI 편집기 열기">🎨</button>
    </span>
  `;
  // 위치 계산: .ql-container 기준으로 오버레이를 붙이고, 이미지 위치는 getBoundingClientRect()로 계산
  const container =
    doc.querySelector(".ql-container") ||
    img.closest(".ql-container") ||
    doc.body;
  const imgRect = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  console.log("이미지 클릭됨", img);
  console.log("오버레이 위치 계산:", imgRect);
  controls.style.position = "absolute";
  controls.style.top = imgRect.top - containerRect.top - 30 + "px";
  controls.style.left =
    imgRect.left - containerRect.left + imgRect.width / 2 + "px";
  controls.style.transform = "translateX(-50%)";
  controls.style.zIndex = 10001;
  // 컨테이너가 position 기준이 되도록 보정
  try {
    const cs = window.getComputedStyle(container);
    if (cs && cs.position === "static") {
      container.style.position = "relative";
    }
  } catch (e) {}
  container.appendChild(controls);
  console.log("[Content Pilot] editor-image-controls 추가 위치:", container);
  console.log("[Content Pilot] 오버레이 innerHTML:", controls.innerHTML);
  __cp_currentImageForControls = img;
  // 안전을 위해 최초 추가 직후 한 번 더 위치 재계산
  updateImageControlsPosition();
  // 에디터 내부 스크롤에 반응하여 위치 업데이트
  __cp_controlsScrollRoot =
    (window.quillEditor && window.quillEditor.root) ||
    doc.querySelector(".ql-editor");
  if (__cp_controlsScrollRoot) {
    try {
      __cp_controlsScrollRoot.addEventListener(
        "scroll",
        updateImageControlsPosition,
        { passive: true }
      );
    } catch (e) {
      __cp_controlsScrollRoot.addEventListener(
        "scroll",
        updateImageControlsPosition
      );
    }
  }

  controls.querySelector(".ai-edit-btn").onclick = function (e) {
    e.stopPropagation();
    window.parent.postMessage(
      { action: "cp_open_ai_editor", imgSrc: img.src },
      "*"
    );
    removeImageControls();
  };
  controls.querySelector(".tui-edit-btn").onclick = function (e) {
    e.stopPropagation();
    window.parent.postMessage(
      { action: "cp_open_tui_editor", imageUrl: img.src },
      "*"
    );
    removeImageControls();
  };
}
// editor.js - iframe 내에서 동작하는 Quill 에디터 제어 스크립트
// Quill Image Resize 모듈 등록 (최상단에서 전역 등록)
if (window.Quill && window.ImageResize) {
  Quill.register("modules/imageResize", window.ImageResize, true);
}
let quillEditor = null;

// W-13: Undo/Redo 아이콘을 단순한 화살표 모양으로 명시적으로 등록합니다.
const Icons = Quill.import("ui/icons");
Icons["undo"] =
  '<svg viewbox="0 0 18 18"><polyline class="ql-stroke" points="11 4 7 9 11 14"></polyline></svg>';
Icons["redo"] =
  '<svg viewbox="0 0 18 18"><polyline class="ql-stroke" points="7 4 11 9 7 14"></polyline></svg>';

function initializeEditor() {
  quillEditor = new Quill("#editor-container", {
    theme: "snow",
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, 4, false] }],
          ["bold", "italic", "underline", "strike"],
          ["blockquote", "code-block"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ script: "sub" }, { script: "super" }],
          [{ indent: "-1" }, { indent: "+1" }],
          [{ direction: "rtl" }],
          [{ size: ["small", false, "large", "huge"] }],
          [{ color: [] }, { background: [] }],
          [{ font: [] }],
          [{ align: [] }],
          ["link", "image", "video"],
          ["clean"],
          ["undo", "redo"],
        ],
        handlers: {
          undo: () => quillEditor.history.undo(),
          redo: () => quillEditor.history.redo(),
        },
      },
      imageResize: {}, // 이미지 리사이즈 모듈 활성화
    },
    placeholder:
      "이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...",
  });

  // W-17: 이미지 클릭 시 커스텀 오버레이 생성
  quillEditor.root.addEventListener("click", function (e) {
    if (e.target && e.target.tagName === "IMG") {
      showImageControls(e.target);
    } else {
      removeImageControls();
    }
  });

  // --- 통합: 텍스트 변경 시 content-changed, cp_save_draft 모두 처리 ---
  let saveTimeout = null;
  const SAVE_DELAY = 500; // 0.5초
  quillEditor.on("text-change", function (delta, oldDelta, source) {
    if (source === "user") {
      // 즉시 content-changed 메시지
      const content = quillEditor.getContents();
      const html = quillEditor.root.innerHTML;
      window.parent.postMessage(
        {
          action: "content-changed",
          data: {
            content,
            html,
            text: quillEditor.getText(),
          },
        },
        "*"
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
            action: "cp_save_draft",
            content: html,
          },
          "*"
        );
      }, SAVE_DELAY);
    }
  });

  quillEditor.on("selection-change", function (range, oldRange, source) {
    window.parent.postMessage(
      {
        action: "selection-changed",
        data: {
          range,
          hasSelection: range && range.length > 0,
        },
      },
      "*"
    );
  });
  // 툴바 높이에 따라 에디터 높이 자동 조정
  function adjustEditorHeight() {
    const toolbar = document.querySelector(".ql-toolbar");
    const editor = document.querySelector(".ql-editor");
    const root = document.body;
    let linkedSectionHeight = 0;
    let linkedSectionGap = 0;
    let linkedListExtra = 0;
    try {
      const linkedSection = window.parent.document.querySelector(
        "#linked-scraps-section"
      );
      const linkedList = window.parent.document.querySelector(
        ".linked-scraps-list"
      );
      if (linkedSection) {
        linkedSectionHeight = linkedSection.offsetHeight;
        const style = window.parent.getComputedStyle(linkedSection);
        linkedSectionGap =
          (parseInt(style.marginBottom) || 0) +
          (parseInt(style.paddingBottom) || 0);
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
      const toolbarBorder =
        parseInt(getComputedStyle(toolbar).borderBottomWidth) || 0;
      const editorBorder =
        parseInt(getComputedStyle(editor).borderTopWidth) || 0;
      const totalOffset =
        toolbarHeight +
        toolbarBorder +
        editorBorder +
        linkedSectionHeight +
        linkedSectionGap +
        linkedListExtra;
      editor.style.height = root.offsetHeight - totalOffset - 3 + "px"; // -3px 상수값 적용
    }
  }

  window.addEventListener("resize", adjustEditorHeight);
  // 창 크기 변경 시 오버레이 위치도 재계산
  window.addEventListener("resize", function () {
    try {
      updateImageControlsPosition();
    } catch (e) {}
  });
  setTimeout(adjustEditorHeight, 100); // 초기 렌더링 후 1회 호출

  // 연결된 자료 변경 등 외부에서 요청 시 높이 재조정
  window.addEventListener("message", function (event) {
    if (event.data && event.data.action === "adjust-editor-height") {
      adjustEditorHeight();
    }
  });

  window.addEventListener("message", function (event) {
    if (!quillEditor) return;
    const { action, data } = event.data;
    switch (action) {
      case "set-content":
        if (data.delta) {
          quillEditor.setContents(data.delta);
        } else if (data.html) {
          quillEditor.setContents([]);
          quillEditor.clipboard.dangerouslyPasteHTML(0, data.html);
          quillEditor.setSelection(quillEditor.getLength(), 0);
        } else if (data.text) {
          quillEditor.setText(data.text);
        }
        break;
      case "get-content":
        // 이미지 삽입 등 외부 요청 시 현재 내용 저장
        window.parent.postMessage(
          {
            action: "cp_save_draft",
            content: quillEditor.root.innerHTML,
          },
          "*"
        );
        break;
      case "apply-format":
        const range = quillEditor.getSelection();
        if (range && range.length > 0) {
          quillEditor.formatText(
            range.index,
            range.length,
            data.format,
            data.value
          );
        }
        break;
      case "insert-text":
        const currentRange = quillEditor.getSelection() || {
          index: quillEditor.getLength(),
          length: 0,
        };
        quillEditor.insertText(currentRange.index, data.text);
        quillEditor.setSelection(currentRange.index + data.text.length);
        break;
      case "insert-image":
        const imageRange = quillEditor.getSelection() || {
          index: quillEditor.getLength(),
          length: 0,
        };
        if (data.url) {
          quillEditor.insertEmbed(imageRange.index, "image", data.url);
          quillEditor.setSelection(imageRange.index + 1);
        }
        break;
      case "focus":
        quillEditor.focus();
        break;
      case "blur":
        quillEditor.blur();
        break;
      case "apply-heading":
        const headingRange = quillEditor.getSelection();
        if (headingRange && headingRange.length > 0) {
          quillEditor.formatText(
            headingRange.index,
            headingRange.length,
            "header",
            data.level
          );
        }
        break;
      case "apply-list":
        const listRange = quillEditor.getSelection();
        if (listRange) {
          quillEditor.formatLine(
            listRange.index,
            listRange.length,
            "list",
            data.type
          );
        }
        break;
      case "clear-formatting":
        const clearRange = quillEditor.getSelection();
        if (clearRange && clearRange.length > 0) {
          quillEditor.removeFormat(clearRange.index, clearRange.length);
        }
        break;
      case "scroll-to-text":
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
                const targetScrollTop =
                  editorRoot.scrollTop + (rect.top - editorRect.top) - 20;
                editorRoot.scrollTop = targetScrollTop;
              }
            }, 50);
          } else {
            console.log("Text not found in editor:", data.text);
          }
        }
        break;
      case "get-content":
        window.parent.postMessage(
          {
            action: "content-response",
            data: {
              content: quillEditor.getContents(),
              html: quillEditor.root.innerHTML,
              text: quillEditor.getText(),
            },
          },
          "*"
        );
        break;
      default:
        console.log("Unknown action:", action);
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  initializeEditor();
  const TOOLBAR_TITLES_KO = {
    bold: "굵게 (Ctrl+B)",
    italic: "기울임꼴 (Ctrl+I)",
    underline: "밑줄 (Ctrl+U)",
    strike: "취소선",
    blockquote: "인용구",
    "code-block": "코드 블록",
    list: "목록",
    ordered: "순서 목록",
    bullet: "글머리 기호",
    sub: "아래 첨자",
    super: "위 첨자",
    indent: "들여쓰기/내어쓰기",
    direction: "텍스트 방향",
    size: "글꼴 크기",
    color: "글꼴 색상",
    background: "배경 색상",
    font: "글꼴",
    align: "정렬",
    link: "링크 삽입 (Ctrl+K)",
    image: "이미지 삽입",
    video: "비디오 삽입",
    clean: "서식 지우기",
    undo: "실행 취소 (Ctrl+Z)",
    redo: "다시 실행 (Ctrl+Y)",
  };
  const toolbarContainer = quillEditor.container.querySelector(".ql-toolbar");
  if (toolbarContainer) {
    toolbarContainer
      .querySelectorAll("button, span.ql-picker")
      .forEach((element) => {
        const className = Array.from(element.classList).find((cls) =>
          cls.startsWith("ql-")
        );
        if (className) {
          const formatName = className.substring(3);
          const title = TOOLBAR_TITLES_KO[formatName];
          if (title) {
            element.setAttribute("title", title);
            element.setAttribute("aria-label", title);
          }
        }
      });
  }
  window.parent.postMessage({ action: "editor-ready" }, "*");
});

window.addEventListener("error", function (event) {
  console.error("Editor iframe error:", event.error);
  window.parent.postMessage(
    { action: "editor-error", error: event.error.message },
    "*"
  );
});
