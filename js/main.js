// js/main.js (수정 후)

import { createAndShowPanel, hidePanelForScrap, restorePanelAfterScrap } from './ui/panel.js';
import { showRecentScrapPreview, showToast } from './ui/preview.js';

export function initialize() {
  // 이 코드는 최상위 창(top frame)에서만 실행됩니다.
  if (window.self === window.top) {
    // 아이콘 클릭으로 활성화되면 바로 초기화 진행
    initializeContentPilot();
  }
}

function initializeContentPilot() {
  let panelWasVisible = false;

  // background.js로부터 오는 메시지 처리
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'open_content_pilot_panel') {
      createAndShowPanel();
    } else if (msg.action === 'show_error_toast') {
      // 에러 타입별 아이콘 매핑
      const iconMap = {
        TOKEN_EXPIRED: '🔑',
        QUOTA_EXCEEDED: '📊',
        API_KEY_MISSING: '🔑',
        UNAUTHORIZED: '🔐',
        FORBIDDEN: '🚫',
        API_ERROR: '⚠️',
      };

      const icon = msg.icon || iconMap[msg.errorType] || '⚠️';
      const message = msg.message || '오류가 발생했습니다.';

      // 아이콘과 메시지를 함께 표시
      showToast(`${icon} ${message}`);
    }
  });

  // 아이프레임으로부터 오는 미리보기/토스트 메시지 요청 처리
  window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cp_show_preview') {
      showRecentScrapPreview(event.data.data);
    }
    if (event.data && event.data.action === 'cp_show_toast') {
      showToast(event.data.message);
    }
  });

  // --- ▼▼▼ Alt 키 누를 때 패널 숨김/복원 기능 추가 ▼▼▼ ---
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Alt') {
        // 다른 입력창에 타이핑 중일 때는 패널 숨김 비활성화
        if (
          e.target.isContentEditable ||
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA'
        ) {
          return;
        }
        panelWasVisible = hidePanelForScrap();
      }
    },
    true
  );

  document.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Alt') {
        restorePanelAfterScrap(panelWasVisible);
      }
    },
    true
  );
  // --- ▲▲▲ 기능 추가 완료 ▲▲▲ ---

  console.log('Content Pilot UI Initialized.');
}
