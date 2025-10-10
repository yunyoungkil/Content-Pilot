// content.js (수정 완료된 최종 버전)

import { setupHighlighter } from './js/core/highlighter.js';
import { createAndShowPanel, isPanelVisible } from './js/ui/panel.js';
import { showRecentScrapPreview, showToast } from './js/ui/preview.js';
import { renderDashboard } from './js/ui/dashboardMode.js';

// 1. 스크랩 기능은 항상 모든 프레임에서 활성화 준비
setupHighlighter();

// 2. UI 및 상태 제어 관련 기능은 최상위 창(top frame)에서만 실행
if (window.self === window.top) {
  window.__CP_HIGHLIGHT_TOGGLE_STATE = false;

  // background.js로부터의 메시지 수신
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case "open_content_pilot_panel":
        createAndShowPanel();
        break;

      // 데이터 새로고침 메시지를 수신하여 대시보드를 다시 렌더링
      case 'cp_data_refreshed': {
        const host = document.getElementById("content-pilot-host");
        if (isPanelVisible() && host?.shadowRoot) {
            const mainArea = host.shadowRoot.querySelector('#cp-main-area');
            if (mainArea && window.__cp_active_mode === 'dashboard') {
                renderDashboard(mainArea);
            }
        }
        break;
      }
    }
  });

  // 아이프레임으로부터 미리보기/토스트 메시지 요청 수신
  window.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'cp_show_preview') {
          showRecentScrapPreview(event.data.data);
      }
      if (event.data && event.data.action === 'cp_show_toast') {
          showToast(event.data.message);
      }
  });


  // Alt 키 토글 리스너
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      if (!isPanelVisible()) {
        e.preventDefault();

        chrome.storage.local.get(["isScrapingActive", "highlightToggleState"], (result) => {
          if (result.isScrapingActive) {
            const newState = !result.highlightToggleState;
            chrome.storage.local.set({ highlightToggleState: newState });
            showToast(newState ? "✅ 하이라이트 모드 ON" : "☑️ 하이라이트 모드 OFF");
            
            const cardBtn = document.getElementById("cp-card-float-btn");
            if (cardBtn) {
              const cardBtnText = cardBtn.querySelector('span');
              cardBtn.style.borderColor = newState ? '#4285F4' : '#e0e0e0';
              cardBtn.style.boxShadow = newState
                ? '0 4px 16px rgba(66, 133, 244, 0.35)'
                : '0 2px 12px rgba(0,0,0,0.15)';

              if (cardBtnText) {
                cardBtnText.textContent = newState ? '모드 ON' : '열기';
                cardBtnText.style.color = newState ? '#4285F4' : '#333';
              }
            }
          }
        });
      }
    }
  }, true);

  console.log("✅ Content Pilot UI Initialized (Top Frame).");
}