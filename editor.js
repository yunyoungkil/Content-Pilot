// editor.js - iframe 내에서 동작하는 Quill 에디터 제어 스크립트

let quillEditor = null;

// Quill 에디터 초기화 (툴바 없음)
function initializeEditor() {
  quillEditor = new Quill("#editor-container", {
    theme: "snow",
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
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
      ],
    },
    placeholder:
      "이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...",
  });

  // 텍스트 변경 이벤트 리스너
  quillEditor.on("text-change", function (delta, oldDelta, source) {
    if (source === "user") {
      // 부모 창에 콘텐츠 변경 알림
      const content = quillEditor.getContents();
      const html = quillEditor.root.innerHTML;

      window.parent.postMessage(
        {
          action: "content-changed",
          data: {
            content: content,
            html: html,
            text: quillEditor.getText(),
          },
        },
        "*"
      );
    }
  });

  // 선택 영역 변경 이벤트
  quillEditor.on("selection-change", function (range, oldRange, source) {
    window.parent.postMessage(
      {
        action: "selection-changed",
        data: {
          range: range,
          hasSelection: range && range.length > 0,
        },
      },
      "*"
    );
  });

  console.log("Quill Editor initialized in iframe");
}

// 부모 창으로부터 메시지 수신 처리
window.addEventListener("message", function (event) {
  if (!quillEditor) return;

  const { action, data } = event.data;

  switch (action) {
    case "set-content":
      // 초기 콘텐츠 설정 (HTML/Delta/Text 지원)
      if (data.delta) {
        quillEditor.setContents(data.delta);
      } else if (data.html) {
        // Quill 권장 방식으로 HTML 붙여넣기
        quillEditor.setContents([]);
        quillEditor.clipboard.dangerouslyPasteHTML(0, data.html);
        quillEditor.setSelection(quillEditor.getLength(), 0);
      } else if (data.text) {
        quillEditor.setText(data.text);
      }
      break;

    case "apply-format":
      // 서식 적용 (굵게, 기울임꼴 등)
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
      // 텍스트 삽입 (키워드 등)
      const currentRange = quillEditor.getSelection() || {
        index: quillEditor.getLength(),
        length: 0,
      };
      quillEditor.insertText(currentRange.index, data.text);
      // 삽입 후 커서를 텍스트 끝으로 이동
      quillEditor.setSelection(currentRange.index + data.text.length);
      break;

    case "get-content":
      // 콘텐츠 요청에 대한 응답
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

    case "focus":
      // 포커스 설정
      quillEditor.focus();
      break;

    case "blur":
      // 포커스 해제
      quillEditor.blur();
      break;

    case "apply-heading":
      // 제목 서식 적용
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
      // 목록 서식 적용
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
      // 서식 제거
      const clearRange = quillEditor.getSelection();
      if (clearRange && clearRange.length > 0) {
        quillEditor.removeFormat(clearRange.index, clearRange.length);
      }
      break;

    default:
      console.log("Unknown action:", action);
  }
});

// DOM이 로드되면 에디터 초기화
document.addEventListener("DOMContentLoaded", function () {
  initializeEditor();

  // 부모 창에 에디터 준비 완료 알림
  window.parent.postMessage(
    {
      action: "editor-ready",
    },
    "*"
  );
});

// 전역 에러 핸들링
window.addEventListener("error", function (event) {
  console.error("Editor iframe error:", event.error);
  window.parent.postMessage(
    {
      action: "editor-error",
      error: event.error.message,
    },
    "*"
  );
});
