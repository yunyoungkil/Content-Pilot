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

          // [신규] 스크랩 저장 전 모달 표시 (최상위 프레임에서만)
          if (window.self === window.top) {
            // 현재 활성 채널 정보 가져오기
            chrome.storage.local.get("activeChannelId", (storage) => {
              const activeChannelId = storage.activeChannelId || null;
              
              // 채널 이름 가져오기
              chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (response) => {
                let activeChannelName = null;
                if (response && response.success && activeChannelId) {
                  const myBlogs = response.data?.myChannels?.blogs || [];
                  const currentChannel = myBlogs.find(blog => {
                    const id = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : "");
                    return id === activeChannelId;
                  });
                  activeChannelName = currentChannel?.inputUrl || currentChannel?.url || null;
                }
                
                // 모달 표시 (동적 import)
                import("../ui/scrapSaveModal.js").then(module => {
                  module.showScrapSaveModal(scrapData, activeChannelId, activeChannelName);
                }).catch(err => {
                  console.error("[Highlighter] Failed to load scrap save modal:", err);
                  // 모달 로드 실패 시 기본 동작 (공용 스크랩으로 저장)
                  chrome.runtime.sendMessage({
                    action: "scrap_element",
                    data: scrapData,
                    channelId: null
                  });
                });
              });
            });
          } else {
            // iframe 내부에서는 모달을 표시할 수 없으므로 기본 동작 (공용 스크랩으로 저장)
            try {
              chrome.runtime.sendMessage(
                { action: "scrap_element", data: scrapData, channelId: null },
                (response) => {
                  if (chrome.runtime.lastError) {
                    console.error("[Highlighter] Chrome runtime error:", chrome.runtime.lastError);
                    return;
                  }
                  if (response && response.success) {
                    window.top.postMessage(
                      { action: "cp_show_preview", data: { ...scrapData, channelId: null } },
                      "*"
                    );
                  }
                }
              );
            } catch (error) {
              console.error("[Highlighter] Failed to send message:", error);
            }
          }

          clearHighlight();
        }
      );
    },
    true
  );
}
