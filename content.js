// content.js (수정 완료된 최종 버전)

import { setupHighlighter } from "./js/core/highlighter.js";
import { createAndShowPanel, isPanelVisible } from "./js/ui/panel.js";
import { showRecentScrapPreview, showToast } from "./js/ui/preview.js";
import { renderDashboard } from "./js/ui/dashboardMode.js";

// [PRD v3.2] Extension context 무효화 감지 및 자동 페이지 새로고침
try {
  chrome.runtime.id; // 확장 프로그램이 유효한지 체크
} catch (error) {
  console.warn(
    "[Content Pilot] Extension context invalidated. Reloading page..."
  );
  window.location.reload();
  throw error; // 추가 실행 방지
}

// Extension context 무효화 감지 (런타임 중)
const checkExtensionContext = () => {
  try {
    chrome.runtime.id;
    return true;
  } catch (error) {
    console.warn(
      "[Content Pilot] Extension context invalidated during runtime. Reloading page..."
    );
    window.location.reload();
    return false;
  }
};

// chrome.runtime API 호출을 래핑하여 안전하게 처리
const safeRuntimeSendMessage = (...args) => {
  if (!checkExtensionContext()) return;
  try {
    chrome.runtime.sendMessage(...args);
  } catch (error) {
    console.error("[Content Pilot] Failed to send message:", error);
    if (error.message.includes("Extension context invalidated")) {
      window.location.reload();
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
      // AI 이미지 분석 진행 상태 콘솔 로고 표시
      case "ai_analysis_started":
        console.log("🟢 [Content Pilot] AI 이미지 분석이 시작되었습니다.");
        break;
      case "ai_analysis_finished":
        console.log("⚪ [Content Pilot] AI 이미지 분석이 완료되었습니다.");
        break;
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
