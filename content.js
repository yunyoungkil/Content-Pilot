// content.js (수정 완료된 최종 버전)

// [CSP Fix] webpack publicPath를 Chrome Extension URL로 설정
// 동적 import로 생성된 청크 파일이 올바른 경로에서 로드되도록 함
// webpack이 이 변수를 인식하도록 파일 최상단에 배치
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
  // eslint-disable-next-line no-undef
  if (typeof __webpack_public_path__ !== 'undefined') {
    // eslint-disable-next-line no-undef
    __webpack_public_path__ = chrome.runtime.getURL('dist/');
  }
}

import { setupHighlighter } from "./js/core/highlighter.js";
import { createAndShowPanel, isPanelVisible } from "./js/ui/panel.js";
import { showRecentScrapPreview } from "./js/ui/preview.js";
import { showToast } from "./js/utils.js";
import { renderDashboard } from "./js/ui/dashboardMode.js";

// [PRD v3.2] Extension context 무효화 감지 (자동 새로고침 제거 - 사용자 컨펌으로 변경)
let extensionContextInvalidated = false;

try {
  chrome.runtime.id; // 확장 프로그램이 유효한지 체크
} catch (error) {
  console.warn(
    "[Content Pilot] Extension context invalidated. Please reload the page manually."
  );
  extensionContextInvalidated = true;
  // 사용자에게 알림 표시 (자동 새로고침 제거)
  if (window.self === window.top) {
    showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.", 5000);
  }
}

// Extension context 무효화 감지 (런타임 중) - 자동 새로고침 제거
const checkExtensionContext = () => {
  try {
    chrome.runtime.id;
    return true;
  } catch (error) {
    if (!extensionContextInvalidated) {
      console.warn(
        "[Content Pilot] Extension context invalidated during runtime. Please reload the page manually."
      );
      extensionContextInvalidated = true;
      // 사용자에게 알림 표시 (자동 새로고침 제거)
      if (window.self === window.top) {
        showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.", 5000);
      }
    }
    return false;
  }
};

// chrome.runtime API 호출을 래핑하여 안전하게 처리 (자동 새로고침 제거)
const safeRuntimeSendMessage = (...args) => {
  if (!checkExtensionContext()) return;
  try {
    chrome.runtime.sendMessage(...args);
  } catch (error) {
    console.error("[Content Pilot] Failed to send message:", error);
    if (error.message.includes("Extension context invalidated")) {
      if (!extensionContextInvalidated) {
        extensionContextInvalidated = true;
        // 사용자에게 알림 표시 (자동 새로고침 제거)
        if (window.self === window.top) {
          showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.", 5000);
        }
      }
    }
  }
};

// 1. 스크랩 기능은 항상 모든 프레임에서 활성화 준비
setupHighlighter();

// 2. UI 및 상태 제어 관련 기능은 최상위 창(top frame)에서만 실행
if (window.self === window.top) {
  window.__CP_HIGHLIGHT_TOGGLE_STATE = false;

  // background.js로부터의 메시지 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (!checkExtensionContext()) return;

    switch (msg.action) {
      case "open_content_pilot_panel":
        createAndShowPanel();
        break;

      // 데이터 새로고침 메시지를 수신하여 대시보드를 다시 렌더링
      case "cp_data_refreshed": {
        const host = document.getElementById("content-pilot-host");
        if (isPanelVisible() && host?.shadowRoot) {
          const mainArea = host.shadowRoot.querySelector("#cp-main-area");
          if (mainArea && window.__cp_active_mode === "dashboard") {
            renderDashboard(mainArea);
          }
        }
        break;
      }

      // [체크리스트 1-A] 스크랩 저장 후 프리뷰 UI 표시
      case "cp_show_preview": {
        if (msg.data) {
          showRecentScrapPreview(msg.data);
        }
        break;
      }

      // [체크리스트 1-A] 스크랩 저장 실패 시 토스트 메시지
      case "cp_show_toast": {
        if (msg.message) {
          showToast(msg.message);
        }
        break;
      }
    }
  });

  // 아이프레임으로부터 미리보기/토스트 메시지 요청 수신
  window.addEventListener("message", (event) => {
    if (event.data && event.data.action === "cp_show_preview") {
      showRecentScrapPreview(event.data.data);
    }
    if (event.data && event.data.action === "cp_show_toast") {
      showToast(event.data.message);
    }
  });

  // Alt 키 토글 리스너
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Alt") {
        if (!isPanelVisible()) {
          e.preventDefault();

          chrome.storage.local.get(
            ["isScrapingActive", "highlightToggleState"],
            (result) => {
              if (result.isScrapingActive) {
                const newState = !result.highlightToggleState;
                chrome.storage.local.set({ highlightToggleState: newState });
                showToast(
                  newState ? "✅ 하이라이트 모드 ON" : "☑️ 하이라이트 모드 OFF"
                );

                const cardBtn = document.getElementById("cp-card-float-btn");
                if (cardBtn) {
                  const cardBtnText = cardBtn.querySelector("span");
                  cardBtn.style.borderColor = newState ? "#4285F4" : "#e0e0e0";
                  cardBtn.style.boxShadow = newState
                    ? "0 4px 16px rgba(66, 133, 244, 0.35)"
                    : "0 2px 12px rgba(0,0,0,0.15)";

                  if (cardBtnText) {
                    cardBtnText.textContent = newState ? "모드 ON" : "열기";
                    cardBtnText.style.color = newState ? "#4285F4" : "#333";
                  }
                }
              }
            }
          );
        }
      }
    },
    true
  );

  console.log("✅ Content Pilot UI Initialized (Top Frame).");
}
