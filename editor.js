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
