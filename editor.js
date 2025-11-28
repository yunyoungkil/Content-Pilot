import { Logger } from "./js/utils.js";

// 툴바 커스텀 버튼 렌더링 (Quill 초기화 후)
setTimeout(() => {
  const toolbar = document.querySelector(".ql-toolbar");
  if (toolbar) {
    const tuiBtn = toolbar.querySelector(".ql-tui-edit");
    if (tuiBtn) {
      tuiBtn.innerHTML =
        '<span style="font-size:16px;vertical-align:middle;">🎨</span>';
      tuiBtn.title = "TUI 이미지 편집";
    }
  }
}, 100);
// W-17: 이미지 편집 툴팁 오버레이 생성/제거 및 액션 메시지
let __cp_currentImageForControls = null; // 현재 오버레이가 붙은 이미지 참조
let __cp_controlsScrollRoot = null; // 스크롤 이벤트를 구독하는 루트(.ql-editor)

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
          ["divider"], // 구분선 버튼 추가
          ["tui-edit"], // TUI 편집 버튼만 남김
          ["clean"],
          ["undo", "redo"],
        ],
        handlers: {
          undo: () => quillEditor.history.undo(),
          redo: () => quillEditor.history.redo(),
          "tui-edit": function () {
            console.log("🎨 [Editor] ========================================");
            console.log("🎨 [Editor] 🖱️ tui-edit 버튼 클릭됨!");
            console.log("🎨 [Editor] ========================================");

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
              } else if (typeof op.insert === "string") {
                idx += op.insert.length;
              }
            });

            console.log(
              `📸 [Editor] 문서 내 이미지 개수: ${allDocumentImages.length}개`
            );

            if (allDocumentImages.length === 0) {
              console.warn("⚠️ [Editor] ❌ 문서에 이미지가 없음");
              // [추가] 사용자 피드백 제공
              alert("편집할 이미지가 없습니다. 먼저 이미지를 삽입해주세요.");
              return;
            }

            // 선택된 이미지가 있으면 그것을 사용, 없으면 첫 번째 이미지 사용
            let targetImage = null;
            if (
              window.__cp_selectedImageUrl &&
              window.__cp_selectedImageRange
            ) {
              // 선택된 이미지가 allDocumentImages에 있는지 확인
              targetImage = allDocumentImages.find(
                (img) => img.url === window.__cp_selectedImageUrl
              );
              if (targetImage) {
                console.log(
                  "✅ [Editor] 선택된 이미지 사용:",
                  window.__cp_selectedImageUrl.substring(0, 50) + "..."
                );
              }
            }

            // 선택된 이미지가 없거나 찾을 수 없으면 첫 번째 이미지 사용
            if (!targetImage) {
              targetImage = allDocumentImages[0];
              console.log(
                "🔄 [Editor] 첫 번째 이미지 사용:",
                targetImage.url.substring(0, 50) + "..."
              );
            }

            window.__cp_editingImageRange = targetImage.range;
            window.__cp_selectedImageRange = targetImage.range;
            window.__cp_selectedImageUrl = targetImage.url;

            console.log("📤 [Editor] 워크스페이스로 메시지 전송 준비 중...");
            console.log("📤 [Editor] window.parent:", window.parent);
            console.log(
              "📤 [Editor] window.parent === window.top:",
              window.parent === window.top
            );

            // Shadow DOM 호스트 window 찾기
            let shadowHostWindow = null;
            try {
              const rootNode = document.getRootNode();
              if (rootNode && rootNode.host) {
                const hostElement = rootNode.host;
                if (hostElement.ownerDocument) {
                  shadowHostWindow = hostElement.ownerDocument.defaultView;
                  console.log(
                    "🔍 [Editor] Shadow DOM 호스트 window 발견:",
                    shadowHostWindow
                  );
                }
              }
            } catch (e) {
              console.log(
                "⚠️ [Editor] Shadow DOM 호스트 탐색 실패:",
                e.message
              );
            }

            // 메시지를 parent window로 전송
            const message = {
              action: "cp_open_tui_editor",
              currentImageUrl: targetImage.url, // 호환성을 위해 유지
              imageUrl: targetImage.url, // tui-editor.js가 찾는 필드명
              allDocumentImages,
            };

            console.log("📦 [Editor] 메시지 내용:", {
              action: message.action,
              imageUrl: message.imageUrl.substring(0, 50) + "...",
              allDocumentImagesCount: message.allDocumentImages.length,
            });

            // 여러 window로 메시지 전송 (shadow DOM 호환)
            const sendToWindow = (targetWindow, name) => {
              try {
                if (targetWindow && targetWindow.postMessage) {
                  targetWindow.postMessage(message, "*");
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
            console.log("📡 [Editor] 1️⃣ window.parent로 전송 시도...");
            sendToWindow(window.parent, "window.parent");

            // 1-1. Shadow DOM 호스트 window로 직접 전송 (가장 중요!)
            if (
              shadowHostWindow &&
              shadowHostWindow !== window &&
              shadowHostWindow !== window.parent
            ) {
              console.log(
                "📡 [Editor] 1️⃣-1️⃣ Shadow DOM 호스트 window로 직접 전송 시도..."
              );
              sendToWindow(shadowHostWindow, "Shadow DOM 호스트 window (직접)");
            }

            // 2. top window로 전송 (Shadow DOM을 통과하여 최상위 window로)
            if (window.top && window.top !== window) {
              console.log("📡 [Editor] 2️⃣ window.top으로 전송 시도...");
              console.log(
                "🔍 [Editor] window.top === window.parent:",
                window.top === window.parent
              );
              sendToWindow(window.top, "window.top");
            } else {
              console.warn(
                "⚠️ [Editor] window.top이 없거나 현재 window와 같습니다!"
              );
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
                if (
                  currentWindow.parent &&
                  currentWindow.parent !== currentWindow
                ) {
                  currentWindow = currentWindow.parent;
                } else {
                  break;
                }
                depth++;
              }
            } catch (err) {
              console.warn("⚠️ [Editor] 상위 window 탐색 실패:", err.message);
            }

            // 4. frames를 통해서도 전송 시도
            try {
              if (
                window.parent &&
                window.parent.frames &&
                window.parent.frames.length > 0
              ) {
                console.log(
                  `📡 [Editor] 4️⃣ window.parent.frames[${window.parent.frames.length}개]로 전송 시도...`
                );
                for (let i = 0; i < window.parent.frames.length; i++) {
                  try {
                    if (
                      window.parent.frames[i] &&
                      window.parent.frames[i] !== window
                    ) {
                      window.parent.frames[i].postMessage(message, "*");
                      console.log(
                        `✅ [Editor] window.parent.frames[${i}]로 메시지 전송 완료`
                      );
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
              console.warn(
                "⚠️ [Editor] frames를 통한 메시지 전송 실패:",
                err.message
              );
            }

            // 5. window.top의 frames도 시도
            if (
              window.top &&
              window.top !== window &&
              window.top !== window.parent
            ) {
              try {
                if (window.top.frames && window.top.frames.length > 0) {
                  console.log(
                    `📡 [Editor] 5️⃣ window.top.frames[${window.top.frames.length}개]로 전송 시도...`
                  );
                  for (let i = 0; i < window.top.frames.length; i++) {
                    try {
                      if (
                        window.top.frames[i] &&
                        window.top.frames[i] !== window
                      ) {
                        window.top.frames[i].postMessage(message, "*");
                        console.log(
                          `✅ [Editor] window.top.frames[${i}]로 메시지 전송 완료`
                        );
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
                console.warn(
                  "⚠️ [Editor] window.top.frames를 통한 메시지 전송 실패:",
                  err.message
                );
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
                      "⚠️ [Editor] Shadow DOM 호스트 window 접근 실패 (cross-origin):",
                      e.message
                    );
                  }

                  if (
                    hostWindow &&
                    hostWindow !== window &&
                    hostWindow.postMessage
                  ) {
                    console.log(
                      "📡 [Editor] 6️⃣ Shadow DOM 호스트 window로 전송 시도..."
                    );
                    sendToWindow(hostWindow, "Shadow DOM 호스트 window");

                    // 호스트의 parent window도 시도
                    if (hostWindow.parent && hostWindow.parent !== hostWindow) {
                      console.log(
                        "📡 [Editor] 7️⃣ Shadow DOM 호스트의 parent window로 전송 시도..."
                      );
                      sendToWindow(
                        hostWindow.parent,
                        "Shadow DOM 호스트 parent window"
                      );
                    }

                    // 호스트의 top window도 시도
                    if (
                      hostWindow.top &&
                      hostWindow.top !== hostWindow &&
                      hostWindow.top !== window
                    ) {
                      console.log(
                        "📡 [Editor] 8️⃣ Shadow DOM 호스트의 top window로 전송 시도..."
                      );
                      sendToWindow(
                        hostWindow.top,
                        "Shadow DOM 호스트 top window"
                      );
                    }
                  } else if (!hostWindow) {
                    // Shadow DOM 호스트는 찾았지만 window 접근 실패
                    // 대신 window.parent를 통해 시도 (이미 시도했지만 다시 한 번)
                    console.log(
                      "📡 [Editor] 6️⃣ Shadow DOM 호스트 발견, window.parent로 재전송 시도..."
                    );
                    if (window.parent && window.parent !== window) {
                      sendToWindow(
                        window.parent,
                        "window.parent (Shadow DOM 재시도)"
                      );
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
              console.warn(
                "⚠️ [Editor] Shadow DOM 호스트 탐색 실패:",
                err.message
              );
            }

            // 7. 모든 가능한 window에 브로드캐스트 (최후의 수단)
            try {
              // window.top부터 시작하여 모든 하위 window에 브로드캐스트
              if (window.top && window.top !== window) {
                console.log("📡 [Editor] 9️⃣ window.top에 브로드캐스트 시도...");
                // window.top 자체에도 전송
                sendToWindow(window.top, "window.top (브로드캐스트)");

                // window.top의 모든 frames에도 전송
                if (window.top.frames) {
                  for (let i = 0; i < window.top.frames.length; i++) {
                    try {
                      if (
                        window.top.frames[i] &&
                        window.top.frames[i] !== window
                      ) {
                        window.top.frames[i].postMessage(message, "*");
                        console.log(
                          `✅ [Editor] window.top.frames[${i}]로 브로드캐스트 완료`
                        );
                      }
                    } catch (e) {
                      // 조용히 실패
                    }
                  }
                }
              }
            } catch (err) {
              console.warn("⚠️ [Editor] 브로드캐스트 실패:", err.message);
            }

            console.log("🎨 [Editor] ========================================");
            console.log("🎨 [Editor] 메시지 전송 프로세스 완료");
            console.log("🎨 [Editor] ========================================");
          },
        },
      },
      imageResize: {},
    },
    placeholder:
      "이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...",
  });

  // 이미지 클릭 시 Range/URL 저장, 툴바 버튼 활성화
  quillEditor.root.addEventListener("click", function (e) {
    if (e.target && e.target.tagName === "IMG") {
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
        } else if (typeof op.insert === "string") {
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
    let selectedText = "";
    if (range && range.length > 0) {
      selectedText = quillEditor.getText(range.index, range.length).trim();
    }
    window.parent.postMessage(
      {
        action: "selection-changed",
        data: {
          range,
          hasSelection: range && range.length > 0,
          selectedText: selectedText,
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
      case "replace-edited-image": {
        console.log("🔄 [Editor] ========================================");
        console.log("🔄 [Editor] 📨 replace-edited-image 메시지 수신!");
        console.log("🔄 [Editor] ========================================");
        try {
          const range = window.__cp_editingImageRange;
          if (!range || !data || !data.dataUrl) {
            console.error(
              "❌ [Editor] 이미지 교체 실패: Range 또는 Data URL 누락",
              { range, hasDataUrl: !!(data && data.dataUrl) }
            );
            break;
          }
          console.log("✅ [Editor] Range 및 Data URL 확인 완료");
          console.log(
            "📊 [Editor] Data URL 길이:",
            data.dataUrl.length,
            "bytes"
          );
          const length =
            typeof range.length === "number" && range.length > 0
              ? range.length
              : 1;
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
              if (leaf && leaf.domNode && leaf.domNode.tagName === "IMG") {
                isImageAtRange = true;
                prevImgNode = leaf.domNode;
              }
            } catch (e) {}
          } else {
            // 포맷으로 이미지가 맞으면 DOM 노드도 찾아둠
            try {
              const leafTuple = quillEditor.getLeaf(range.index);
              const leaf = Array.isArray(leafTuple) ? leafTuple[0] : null;
              if (leaf && leaf.domNode && leaf.domNode.tagName === "IMG") {
                prevImgNode = leaf.domNode;
              }
            } catch (e) {}
          }
          if (!isImageAtRange) {
            console.error(
              "❌ [Editor] 이미지 교체 실패: Range 위치가 이미지가 아닙니다.",
              range
            );
            window.__cp_editingImageRange = null;
            break;
          }
          console.log("✅ [Editor] Range 위치 이미지 확인 완료");

          // 기존 이미지의 크기 스타일 추출
          let prevWidth = null,
            prevHeight = null;
          if (prevImgNode) {
            // style 우선, 없으면 getBoundingClientRect로 픽셀값
            prevWidth =
              prevImgNode.style.width || prevImgNode.getAttribute("width");
            prevHeight =
              prevImgNode.style.height || prevImgNode.getAttribute("height");
            const rect = prevImgNode.getBoundingClientRect();
            if ((!prevWidth || prevWidth === "auto") && rect.width)
              prevWidth = rect.width + "px";
            if ((!prevHeight || prevHeight === "auto") && rect.height)
              prevHeight = rect.height + "px";
            console.log("📏 [Editor] 기존 이미지 크기:", {
              width: prevWidth,
              height: prevHeight,
            });
          }

          // 기존 이미지 삭제 및 새 이미지 삽입
          console.log("🗑️ [Editor] 기존 이미지 삭제 중...");
          quillEditor.deleteText(range.index, length);
          console.log("➕ [Editor] 새 이미지 삽입 중...");
          quillEditor.insertEmbed(range.index, "image", data.dataUrl);
          // 새 이미지 노드에 동일 스타일/속성 적용
          setTimeout(() => {
            const leafTuple = quillEditor.getLeaf(range.index);
            const leaf = Array.isArray(leafTuple) ? leafTuple[0] : null;
            if (leaf && leaf.domNode && leaf.domNode.tagName === "IMG") {
              if (prevWidth) {
                leaf.domNode.style.width = prevWidth;
                leaf.domNode.setAttribute("width", prevWidth.replace("px", ""));
              }
              if (prevHeight) {
                leaf.domNode.style.height = prevHeight;
                leaf.domNode.setAttribute(
                  "height",
                  prevHeight.replace("px", "")
                );
              }
            }
          }, 0);
          quillEditor.setSelection(range.index + 1, 0);
          window.__cp_editingImageRange = null;
          console.log("✅ [Editor] 이미지 교체 완료!");

          // 저장 트리거 (선택) - 부모에 저장 요청 전달
          console.log("💾 [Editor] 드래프트 저장 요청 전송 중...");
          window.parent.postMessage(
            { action: "cp_save_draft", content: quillEditor.root.innerHTML },
            "*"
          );
          console.log("✅ [Editor] 드래프트 저장 요청 전송 완료");
          console.log("🔄 [Editor] ========================================");
        } catch (err) {
          console.error("❌ [Editor] 이미지 교체 처리 중 오류:", err);
        }
        break;
      }
      case "cp_update_editing_range":
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
              } else if (typeof op.insert === "string") {
                idx += op.insert.length;
              }
            }
          } catch (e) {}
        }
        break;
      case "set-content":
        console.log("[Editor] set-content 메시지 수신:", {
          hasDelta: !!data.delta,
          hasHtml: data.html !== undefined,
          hasText: data.text !== undefined,
          html: data.html,
        });
        if (data.delta) {
          quillEditor.setContents(data.delta);
          console.log("[Editor] Delta로 콘텐츠 설정 완료");
        } else if (data.html !== undefined) {
          // 빈 문자열이거나 빈 HTML인 경우 완전히 초기화
          if (
            !data.html ||
            data.html.trim() === "" ||
            data.html === "<p><br></p>" ||
            data.html === "<p></p>"
          ) {
            console.log("[Editor] 빈 HTML 감지, 에디터 완전 초기화");
            quillEditor.setContents([]);
            quillEditor.setText("");
            console.log(
              "[Editor] 에디터 초기화 완료, 현재 길이:",
              quillEditor.getLength()
            );
          } else {
            console.log(
              "[Editor] HTML 콘텐츠 설정:",
              data.html.substring(0, 50) + "..."
            );
            quillEditor.setContents([]);
            quillEditor.clipboard.dangerouslyPasteHTML(0, data.html);
            quillEditor.setSelection(quillEditor.getLength(), 0);
          }
        } else if (data.text !== undefined) {
          console.log("[Editor] 텍스트 콘텐츠 설정:", data.text || "");
          quillEditor.setText(data.text || "");
        } else {
          // data가 없거나 모든 필드가 undefined인 경우 초기화
          console.log("[Editor] 모든 필드가 undefined, 에디터 초기화");
          quillEditor.setContents([]);
          quillEditor.setText("");
        }
        break;
      case "get-content":
        // 요청 ID가 있으면 응답 메시지 전송
        if (data && data.requestId) {
          window.parent.postMessage(
            {
              action: "content-response",
              requestId: data.requestId,
              data: { html: quillEditor.root.innerHTML },
            },
            "*"
          );
        }
        // 이미지 삽입 등 외부 요청 시 현재 내용 저장
        window.parent.postMessage(
          {
            action: "cp_save_draft",
            content: quillEditor.root.innerHTML,
          },
          "*"
        );
        break;
      case "clear-selection":
        // 선택 영역 해제
        try {
          const length = quillEditor.getLength();
          quillEditor.setSelection(length, 0);
        } catch (e) {
          // 선택 해제 실패 시 무시
        }
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
        // ▼▼▼ [오류 수정] data가 undefined일 수 있으므로 방어 코드 추가 ▼▼▼
        if (!data || !data.text) {
          console.error("insert-text: data 또는 data.text가 없습니다.", {
            action,
            data,
          });
          break;
        }
        const currentRange = quillEditor.getSelection() || {
          index: quillEditor.getLength(),
          length: 0,
        };
        quillEditor.insertText(currentRange.index, data.text);
        quillEditor.setSelection(currentRange.index + data.text.length);
        // ▲▲▲ [수정 완료] ▲▲▲
        break;
      case "insert-html":
        // 외부에서 HTML 조각을 삽입할 때 사용합니다.
        if (!data || typeof data.html !== "string") {
          console.error("insert-html: data 또는 data.html이 없습니다.", {
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
          // Quill clipboard API를 이용해 안전하게 HTML을 삽입
          quillEditor.clipboard.dangerouslyPasteHTML(sel.index, data.html);
          // 삽입 후 커서를 콘텐츠 끝으로 이동시킴
          setTimeout(() => {
            try {
              quillEditor.setSelection(quillEditor.getLength(), 0);
            } catch (err) {}
          }, 0);
          console.log("✅ [Editor] insert-html 처리 완료");
        } catch (err) {
          console.error("❌ [Editor] insert-html 처리 중 오류:", err);
        }
        break;
      case "insert-image":
        console.log("➕ [Editor] ========================================");
        console.log("➕ [Editor] 📨 insert-image 메시지 수신!");
        console.log("➕ [Editor] ========================================");
        const imageRange = quillEditor.getSelection() || {
          index: quillEditor.getLength(),
          length: 0,
        };
        if (data.url) {
          console.log("📸 [Editor] 이미지 삽입 중...");
          quillEditor.insertEmbed(imageRange.index, "image", data.url);
          quillEditor.setSelection(imageRange.index + 1);
          console.log("✅ [Editor] 이미지 삽입 완료");

          // 이미지 속성 설정 (비동기 처리)
          setTimeout(() => {
            try {
              // 방금 삽입된 이미지를 찾음 (src가 일치하는)
              const insertedImg = quillEditor.root.querySelector(
                `img[src="${data.url}"]`
              );
              if (insertedImg) {
                // 1. [SEO 핵심] Alt 텍스트 및 Title 설정
                if (data.alt) {
                  insertedImg.setAttribute("alt", data.alt);
                  insertedImg.setAttribute("title", data.alt); // 툴팁용
                }

                // 2. (기존 코드) 외부 이미지 정책 설정
                insertedImg.setAttribute("referrerpolicy", "no-referrer");
                insertedImg.setAttribute("crossorigin", "anonymous");

                // 3. (기존 코드) 네이버 블로그 호환 처리
                if (data.url.includes("postfiles.pstatic.net")) {
                  // type=w966 같은 파라미터 제거하여 원본 URL 시도
                  const originalUrl = data.url.split("?")[0];
                  if (originalUrl !== data.url) {
                    insertedImg.src = originalUrl;
                  }
                }

                // [디버깅] 설정 확인
                console.log("[Editor] 이미지 삽입 완료:", {
                  src: data.url,
                  alt: insertedImg.getAttribute("alt"),
                });
              }
            } catch (e) {
              console.log("이미지 속성 설정 실패:", e);
            }
          }, 100);
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

      // [신규] 썸네일 생성기 -> TUI 에디터 연결 브릿지
      case "bridge-tui-edit":
        console.log("🌉 [Editor] ========================================");
        console.log("🌉 [Editor] 📨 bridge-tui-edit 메시지 수신!");
        console.log("🌉 [Editor] ========================================");
        if (data && data.url) {
          console.log("📤 [Editor] 부모 창에 cp_open_tui_editor 메시지 전송");
          console.log(
            "📸 [Editor] 이미지 URL:",
            data.url.substring(0, 50) + "..."
          );
          // 부모 창(Main)에게 TUI 에디터 열기 요청 전송
          try {
            window.parent.postMessage(
              {
                action: "cp_open_tui_editor",
                currentImageUrl: data.url, // 호환성을 위해 유지
                imageUrl: data.url, // tui-editor.js가 찾는 필드명
                source: "thumbnail_maker",
                // TUI 에디터 사이드바에 표시할 단일 이미지 목록 구성
                allDocumentImages: [{ url: data.url, range: null }],
              },
              "*"
            );
            console.log("✅ [Editor] cp_open_tui_editor 메시지 전송 완료");
            console.log("🌉 [Editor] ========================================");
          } catch (err) {
            console.error("❌ [Editor] 메시지 전송 실패:", err);
          }
        } else {
          console.error("❌ [Editor] bridge-tui-edit: data.url이 없음", data);
        }
        break;
      case "get-content":
        window.parent.postMessage(
          {
            action: "content-response",
            requestId: data.requestId || null,
            data: {
              content: quillEditor.getContents(),
              html: quillEditor.root.innerHTML,
              text: quillEditor.getText(),
            },
          },
          "*"
        );
        break;
      case "edit-image": {
        // TUI 에디터 iframe에 이미지 전달
        tuiEditorIframe.contentWindow.postMessage(
          {
            action: "set-image",
            data: { dataUrl: imageUrl },
          },
          "*"
        );
        // 이미지 set 후 undo/redo 스택에 첫 상태 강제 push
        setTimeout(() => {
          tuiEditorIframe.contentWindow.postMessage(
            {
              action: "add-undo-stack",
            },
            "*"
          );
        }, 300);
        break;
      }
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
