// js/ui/panel.js

import { renderPanelHeader } from "./header.js";
import { renderScrapbook } from "./scrapbookMode.js";
import { renderChannelMode } from "./channelMode.js";
import { renderDashboard } from "./dashboardMode.js";

// --- 패널 상태 및 UI 제어 함수 ---

// 패널이 현재 보이는지 확인하는 함수
export function isPanelVisible() {
    const panel = document.getElementById("content-pilot-panel");
    return panel && panel.style.display !== 'none';
}

// 메인 패널을 생성하고 화면에 표시하는 함수
export function createAndShowPanel() {
  let panel = document.getElementById("content-pilot-panel");
  if (panel) {
    panel.style.display = "flex";
  } else {
    panel = document.createElement("div");
    panel.id = "content-pilot-panel";
    panel.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background-color: rgba(0, 0, 0, 0.4); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
    `;
    const panelContent = document.createElement("div");
    panelContent.id = "cp-panel-content-wrapper";
    panelContent.style.cssText = `
      width: 90%; height: 90%; max-width: 1400px; max-height: 900px;
      background: #f7f8fa; border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      display: flex; flex-direction: column; overflow: hidden;
    `;
    const headerArea = document.createElement('div');
    headerArea.id = 'cp-header-area';
    const mainArea = document.createElement('div');
    mainArea.id = 'cp-main-area';
    mainArea.style.flex = '1';
    mainArea.style.minHeight = '0';

    panelContent.appendChild(headerArea);
    panelContent.appendChild(mainArea);
    panel.appendChild(panelContent);
    document.body.appendChild(panel);

    // 최초 렌더링 및 이벤트 리스너 설정
    renderHeaderAndTabs(panel);
    addEventListenersToPanel(panel); // 이벤트 리스너는 한 번만 등록
    renderDashboard(mainArea); // 기본으로 대시보드 표시
  }
}

// 패널을 닫는 함수
export function closePanel() {
  const panel = document.getElementById("content-pilot-panel");
  if (panel) panel.style.display = "none";
  chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
}

// 패널을 최소화하는 함수
export function minimizePanelToCard() {
  const panel = document.getElementById("content-pilot-panel");
  if (panel) panel.style.display = "none";
  showCardFloatingButton();
  chrome.storage.local.set({ isScrapingActive: true, highlightToggleState: false });
}

// 스크랩을 위해 패널을 잠시 숨기는 함수
export function hidePanelForScrap() {
  const panel = document.getElementById("content-pilot-panel");
  if (panel && panel.style.display !== 'none') {
    panel.style.display = 'none';
    return true;
  }
  return false;
}

// 스크랩 후 패널을 원래 상태로 복원하는 함수
export function restorePanelAfterScrap(wasVisible) {
  if (wasVisible) {
    const panel = document.getElementById("content-pilot-panel");
    if (panel) {
      panel.style.display = 'flex';
    }
  }
}

// --- UI 렌더링 및 이벤트 연결 함수 ---

// 헤더와 탭 영역만 다시 렌더링하는 함수
function renderHeaderAndTabs(panel) {
    const headerArea = panel.querySelector("#cp-header-area");
    if (headerArea) {
        headerArea.innerHTML = renderPanelHeader();
    }
}

// ▼▼▼ [핵심 수정] 이벤트 위임 방식으로 이벤트 리스너를 한 번만 등록 ▼▼▼
function addEventListenersToPanel(panel) {
    const mainArea = panel.querySelector("#cp-main-area");
    const headerArea = panel.querySelector("#cp-header-area");

    // 헤더 영역에서 발생하는 클릭 이벤트를 감지
    headerArea.addEventListener('click', (e) => {
        const target = e.target;
        
        // 1. 닫기 버튼 클릭 처리
        if (target.closest("#cp-panel-close")) {
            closePanel();
            return;
        }

        // 2. 최소화 버튼 클릭 처리
        if (target.closest("#cp-panel-fullscreen-exit")) {
            minimizePanelToCard();
            return;
        }

        // 3. 탭 클릭 처리
        const tab = target.closest('.cp-mode-tab');
        if (tab) {
            const activeKey = tab.dataset.key;
            window.__cp_active_mode = activeKey; // 현재 활성화된 모드 저장
            renderHeaderAndTabs(panel); // 헤더를 다시 그려서 활성 탭 스타일 업데이트

            // activeKey에 따라 메인 컨텐츠 영역을 다시 그림
            if (activeKey === 'dashboard') {
                renderDashboard(mainArea);
            } else if (activeKey === 'scrapbook') {
                renderScrapbook(mainArea);
            } else if (activeKey === 'channel') {
                renderChannelMode(mainArea);
            } else if (activeKey === 'kanban') {
                mainArea.innerHTML = '<h1 style="text-align:center; margin-top: 50px;">기획 보드 모드는 구현 예정입니다.</h1>';
            } else if (activeKey === 'draft') {
                mainArea.innerHTML = '<h1 style="text-align:center; margin-top: 50px;">초안 작성 모드는 구현 예정입니다.</h1>';
            }
        }
    });
}


// 좌하단 카드 버튼 표시 함수
function showCardFloatingButton() {
  if (document.getElementById("cp-dock-container")) return;

  const container = document.createElement("div");
  container.id = "cp-dock-container";
  container.style.cssText = `
    position: fixed; left: 0; bottom: 36px;
    z-index: 2147483648; display: flex; align-items: center;
  `;

  const cardBtn = document.createElement("button");
  cardBtn.id = "cp-card-float-btn";
  cardBtn.style.cssText = `
    height: 72px; width: 72px; background: #f8f9fa;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #e9ecef;
    border-left: none; border-radius: 0; display: flex;
    align-items: center; justify-content: center; cursor: pointer;
    transition: all 0.2s ease-in-out; z-index: 2;
  `;
  const iconUrl = chrome.runtime.getURL("images/icon-48.png");
  cardBtn.innerHTML = `<img src="${iconUrl}" alt="Content Pilot" style="width: 32px; height: 32px; pointer-events: none; opacity: 0.65;">`;

  const iconImg = cardBtn.querySelector('img');

  cardBtn.onmouseover = () => {
    cardBtn.style.background = '#ffffff';
    cardBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    if(iconImg) iconImg.style.opacity = '1';
  };
  cardBtn.onmouseout = () => {
    cardBtn.style.background = '#f8f9fa';
    cardBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    if(iconImg) iconImg.style.opacity = '0.65';
  };

  cardBtn.onclick = () => {
    createAndShowPanel();
    container.remove();
  };

  container.appendChild(cardBtn);
  document.body.appendChild(container);
}