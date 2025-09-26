// content.js (최종 수정본)

import { setupHighlighter } from './js/core/highlighter.js';
import { createAndShowPanel, hidePanelForScrap, restorePanelAfterScrap, isPanelVisible } from './js/ui/panel.js';
import { showRecentScrapPreview, showToast } from './js/ui/preview.js';

// 1. 스크랩 기능은 항상 모든 프레임에서 활성화 준비
setupHighlighter();

// 2. UI 및 상태 제어 관련 기능은 최상위 창(top frame)에서만 실행
if (window.self === window.top) {
  window.__CP_HIGHLIGHT_TOGGLE_STATE = false; 
  let panelWasVisible = false;

  // background.js로부터 UI 열기 요청 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "open_content_pilot_panel") {
      createAndShowPanel();
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


  // Alt 키를 눌렀을 때 하이라이트 모드를 켜고 끄는 토글 리스너 추가
document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') {
    if (!isPanelVisible()) { 
      e.preventDefault();

      chrome.storage.local.get(["isScrapingActive", "highlightToggleState"], (result) => {
        if (result.isScrapingActive) {
          const newState = !result.highlightToggleState;
          chrome.storage.local.set({ highlightToggleState: newState });
          showToast(newState ? "✅ 하이라이트 모드 ON" : "☑️ 하이라이트 모드 OFF");

          // --- ▼▼▼ 2번 아이디어: 상태에 따라 디자인 변경 로직 ▼▼▼ ---
          const cardBtn = document.getElementById("cp-card-float-btn");
          if (cardBtn) {
            const cardBtnText = cardBtn.querySelector('span');

            // newState가 true(ON)일 때와 false(OFF)일 때 스타일과 텍스트를 변경
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