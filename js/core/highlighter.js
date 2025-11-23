// js/core/highlighter.js (최종 수정본)

import { enrichScrapWithHighlights } from './scrapbook.js';
import { showToast } from '../utils.js';

export function setupHighlighter() {
  if (window.__pilotHighlightInitialized) return;
  window.__pilotHighlightInitialized = true;

  let lastHighlightedElement = null;
  
  // 로컬 변수로 상태 동기화 (성능 최적화)
  let isScrapingActive = false;
  let highlightToggleState = false;

  // 헬퍼 함수: 하이라이트 제거
  function clearHighlight() {
    if (lastHighlightedElement) {
      lastHighlightedElement.classList.remove("pilot-highlight");
      lastHighlightedElement = null;
    }
  }

  // 초기 상태 로드 (한 번만 호출)
  chrome.storage.local.get(
    ["isScrapingActive", "highlightToggleState"],
    function (result) {
      isScrapingActive = result.isScrapingActive || false;
      highlightToggleState = result.highlightToggleState || false;
    }
  );

  // chrome.storage.onChanged 리스너로 상태 동기화
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      if (changes.isScrapingActive) {
        isScrapingActive = changes.isScrapingActive.newValue || false;
      }
      if (changes.highlightToggleState) {
        highlightToggleState = changes.highlightToggleState.newValue || false;
      }
    }
  });

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

  // 1. 하이라이트 표시 (mouseover) - 로컬 변수만 참조 (성능 최적화)
  document.addEventListener(
    "mouseover",
    function (e) {
      // 로컬 변수만 참조하여 비동기 IPC 호출 제거
      if (isScrapingActive && highlightToggleState) {
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

  // 스크랩 저장 모달 인라인 구현 (chunk 로딩 오류 방지)
  function showScrapSaveModalInline(scrapData, activeChannelId, activeChannelName) {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById("scrap-save-modal");
    if (existingModal) {
      existingModal.remove();
    }

    // 모달 생성
    const modal = document.createElement("div");
    modal.id = "scrap-save-modal";
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      font-family: "Noto Sans KR", "Roboto", Arial, sans-serif;
    `;

    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
    `;

    const scrapPreview = scrapData.text 
      ? scrapData.text.substring(0, 100) + (scrapData.text.length > 100 ? "..." : "")
      : "스크랩 내용";

    modalContent.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #333; font-weight: 600;">
          📝 스크랩 저장
        </h3>
        <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">
          ${scrapPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </p>
      </div>
      
      <div style="padding: 16px; background: #f8f9fa; border-radius: 8px; margin-bottom: 20px;">
        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
          <input type="checkbox" id="scrap-save-channel-only" style="width: 18px; height: 18px; cursor: pointer;">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #333; font-size: 14px; margin-bottom: 4px;">
              ${activeChannelName ? `'${activeChannelName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}'에서만 사용` : "현재 채널에만 저장"}
            </div>
            <div style="font-size: 12px; color: #666; line-height: 1.4;">
              체크하지 않으면 <strong>공용 스크랩</strong>으로 저장되어<br>
              모든 채널에서 사용할 수 있습니다.
            </div>
          </div>
        </label>
      </div>
      
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="scrap-save-cancel-btn" style="padding: 10px 20px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 14px;">
          취소
        </button>
        <button id="scrap-save-confirm-btn" style="padding: 10px 20px; border-radius: 6px; border: none; background: #2d8cf0; color: white; cursor: pointer; font-size: 14px; font-weight: 500;">
          저장
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // 이벤트 리스너
    const confirmBtn = modalContent.querySelector("#scrap-save-confirm-btn");
    const cancelBtn = modalContent.querySelector("#scrap-save-cancel-btn");
    const checkbox = modalContent.querySelector("#scrap-save-channel-only");
    
    // 체크박스 기본값 설정
    if (activeChannelId && activeChannelName) {
      checkbox.checked = true;
      checkbox.disabled = false;
      updateSaveButtonText(confirmBtn, true, activeChannelName);
    } else {
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.style.opacity = "0.5";
      checkbox.style.cursor = "not-allowed";
      updateSaveButtonText(confirmBtn, false, null);
    }
    
    checkbox.addEventListener("change", () => {
      if (!checkbox.disabled) {
        updateSaveButtonText(confirmBtn, checkbox.checked, activeChannelName);
      }
    });

    function updateSaveButtonText(btn, isChannelOnly, channelName) {
      if (isChannelOnly && channelName) {
        btn.textContent = `전용 저장 (${channelName})`;
        btn.title = `이 스크랩을 '${channelName}' 채널에만 저장합니다`;
      } else {
        btn.textContent = "공용 저장";
        btn.title = "이 스크랩을 모든 채널에서 사용할 수 있도록 공용으로 저장합니다";
      }
    }

    confirmBtn.addEventListener("click", () => {
      const isChannelOnly = checkbox.checked && !checkbox.disabled;
      const targetChannelId = isChannelOnly ? activeChannelId : null;

      confirmBtn.disabled = true;
      confirmBtn.textContent = "저장 중...";

      // background.js로 스크랩 저장 요청
      chrome.runtime.sendMessage({
        action: "scrap_element",
        data: scrapData,
        channelId: targetChannelId
      }, (response) => {
        modal.remove();
        
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          showToast(`❌ 스크랩 저장 실패: ${errorMsg}`);
          return;
        }

        if (response && response.success) {
          const feedbackMessage = isChannelOnly && activeChannelName
            ? `✅ 스크랩이 '${activeChannelName}'에 저장되었습니다.`
            : "✅ 공용 스크랩으로 저장되었습니다.";
          showToast(feedbackMessage);
          
          // 미리보기 표시
          window.postMessage({
            action: "cp_show_preview",
            data: { ...scrapData, channelId: targetChannelId }
          }, "*");
        } else {
          showToast("❌ 스크랩 저장 실패");
        }
      });
    });

    cancelBtn.addEventListener("click", () => {
      modal.remove();
    });

    // 백드롭 클릭 시 닫기
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    // ESC 키로 닫기
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        modal.remove();
        document.removeEventListener("keydown", handleEsc);
      }
    };
    document.addEventListener("keydown", handleEsc);
  }

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

          // 기본 스크랩 데이터 생성
          let scrapData = {
            text: targetElement.innerText || targetElement.textContent || '',
            html: targetElement.outerHTML || '',
            tag: targetElement.tagName,
            url: location.href,
            image,
            images,
            _sourceElement: targetElement // DOM 요소 직접 전달
          };

          // [신규] 문맥 추출 강화 - 핵심 문장 하이라이트 메타데이터 추가
          try {
            scrapData = enrichScrapWithHighlights(scrapData);
            if (scrapData.hasHighlights && scrapData.highlights && scrapData.highlights.length > 0) {
              console.log(`%c📌 [Scrap] 핵심 문장 ${scrapData.highlights.length}개 식별됨`, 'color: #ff9800; font-weight: bold;');
              console.log('[Scrap] 하이라이트 상세:', scrapData.highlights.map(h => ({
                text: h.text.substring(0, 50) + '...',
                score: h.score
              })));
            } else {
              console.log('[Scrap] 하이라이트된 문장 없음 (텍스트 길이:', scrapData.text?.length || 0, ')');
            }
          } catch (error) {
            console.error('[Highlighter] 하이라이트 추출 실패:', error);
            console.error('[Highlighter] 에러 스택:', error.stack);
            // 오류 시 원본 데이터 사용
          }
          
          // _sourceElement는 전송하지 않음 (직렬화 불가)
          delete scrapData._sourceElement;

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
                
                // 모달 표시 (인라인으로 직접 구현하여 chunk 로딩 오류 방지)
                showScrapSaveModalInline(scrapData, activeChannelId, activeChannelName);
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
