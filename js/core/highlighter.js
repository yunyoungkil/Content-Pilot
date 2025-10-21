// js/core/highlighter.js (최종 수정본)

export function setupHighlighter() {
  if (window.__pilotHighlightInitialized) return;
  window.__pilotHighlightInitialized = true;

  let lastHighlightedElement = null;

  // 헬퍼 함수: 하이라이트 제거
  function clearHighlight() {
    if (lastHighlightedElement) {
      lastHighlightedElement.classList.remove("pilot-highlight");
      lastHighlightedElement = null;
    }
  }

  document.addEventListener(
    "mouseout",
    (e) => {
      // relatedTarget이 null이면 마우스가 창(프레임) 밖으로 나갔다는 의미입니다.
      if (e.relatedTarget === null) {
        clearHighlight();
      }
    },
    true
  );

  // 1. 하이라이트 표시 (mouseover)
  document.addEventListener(
    "mouseover",
    function (e) {
      // isScrapingActive와 highlightToggleState 값을 모두 가져옴
      chrome.storage.local.get(
        ["isScrapingActive", "highlightToggleState"],
        function (result) {
          // e.altKey 대신 result.highlightToggleState를 확인
          if (result.isScrapingActive && result.highlightToggleState) {
            const target = e.target;
            if (
              target &&
              !target.closest("#content-pilot-panel") &&
              target !== document.body &&
              lastHighlightedElement !== target
            ) {
              clearHighlight();
              target.classList.add("pilot-highlight");
              lastHighlightedElement = target;
            }
          }
        }
      );
    },
    true
  );

  // 2. Alt 키를 떼거나 창 포커스를 잃으면 하이라이트 제거
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Alt") clearHighlight();
    },
    true
  );

  window.addEventListener("blur", clearHighlight, true);

  // 3. 스크랩 실행 (click)
  document.addEventListener(
    "click",
    function (e) {
      // isScrapingActive와 highlightToggleState 값을 모두 가져옴
      chrome.storage.local.get(
        ["isScrapingActive", "highlightToggleState"],
        function (result) {
          // !e.altKey 대신 !result.highlightToggleState를 확인
          if (
            !result.isScrapingActive ||
            !result.highlightToggleState ||
            !lastHighlightedElement
          )
            return;

          e.preventDefault();
          e.stopPropagation();
          const targetElement = lastHighlightedElement;

          // ... (기존 스크랩 데이터 생성 및 전송 로직은 동일)
          let images = [];
          if (targetElement.tagName === "IMG") images.push(targetElement.src);
          const imgEls = targetElement.querySelectorAll("img");
          images = images.concat(
            Array.from(imgEls)
              .map((img) => img.src)
              .filter(Boolean)
          );
          images = [...new Set(images)];
          const image = images.length > 0 ? images[0] : null;

          const scrapData = {
            text: targetElement.innerText,
            html: targetElement.outerHTML,
            tag: targetElement.tagName,
            url: location.href,
            image,
            images,
          };

          // [PRD v3.2] Extension context 무효화 안전 처리
          try {
            chrome.runtime.sendMessage(
              { action: "scrap_element", data: scrapData },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "[Highlighter] Chrome runtime error:",
                    chrome.runtime.lastError
                  );
                  window.top.postMessage(
                    {
                      action: "cp_show_toast",
                      data: {
                        message:
                          "❌ 확장 프로그램 오류. 페이지를 새로고침하세요.",
                      },
                    },
                    "*"
                  );
                  return;
                }

                const messageAction =
                  response && response.success
                    ? "cp_show_preview"
                    : "cp_show_toast";
                const messageData =
                  response && response.success
                    ? scrapData
                    : { message: "❌ 스크랩 실패" };
                window.top.postMessage(
                  { action: messageAction, data: messageData },
                  "*"
                );
              }
            );
          } catch (error) {
            console.error("[Highlighter] Failed to send message:", error);
            if (error.message.includes("Extension context invalidated")) {
              window.top.postMessage(
                {
                  action: "cp_show_toast",
                  data: {
                    message:
                      "⚠️ 확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요.",
                  },
                },
                "*"
              );
            }
          }

          clearHighlight();
        }
      );
    },
    true
  );
}
