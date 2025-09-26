// js/ui/panel.js

import { renderPanelHeader } from "./header.js";
import { renderScrapbook } from "./scrapbookMode.js";

// --- ▼▼▼ 패널 상태 및 UI 제어 함수 ▼▼▼ ---

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

    renderHeaderAndTabs(panel);
    renderScrapbook(mainArea);
  }
  
  // 패널을 열 때 스크랩 기능 활성화 상태를 저장
    chrome.storage.local.set({ 
    isScrapingActive: true,
    highlightToggleState: false // 토글 상태를 항상 꺼짐으로 초기화
  });
}

// 패널을 닫을 때 스크랩 기능 비활성화 상태를 저장
export function closePanel() {
  const panel = document.getElementById("content-pilot-panel");
  if (panel) panel.style.display = "none";
  // isScrapingActive 와 highlightToggleState 를 모두 false로 설정 (완전 종료)
  chrome.storage.local.set({ 
    isScrapingActive: false,
    highlightToggleState: false 
  });
}

// 패널을 최소화할 때 스크랩 기능 비활성화 상태를 저장
export function minimizePanelToCard() {
  const panel = document.getElementById("content-pilot-panel");
  if (panel) panel.style.display = "none";
  showCardFloatingButton();
  // isScrapingActive는 true로, highlightToggleState는 false(초기상태)로 설정
  chrome.storage.local.set({ 
    isScrapingActive: true,
    highlightToggleState: false 
  });
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

// --- ▼▼▼ UI 렌더링 및 이벤트 연결 함수 ▼▼▼ ---

// 헤더와 탭 영역만 다시 렌더링하고 이벤트를 연결하는 함수
function renderHeaderAndTabs(panel) {
    const headerArea = panel.querySelector("#cp-header-area");
    if (!headerArea) return;

    headerArea.innerHTML = renderPanelHeader();
    addEventListenersToPanel(panel);
}

// 패널에 이벤트 리스너를 추가하는 함수
function addEventListenersToPanel(panel) {
    const closeBtn = panel.querySelector("#cp-panel-close");
    if (closeBtn) closeBtn.onclick = () => closePanel();

    const fullscreenExitBtn = panel.querySelector("#cp-panel-fullscreen-exit");
    if (fullscreenExitBtn) fullscreenExitBtn.onclick = () => minimizePanelToCard();

    const tabs = panel.querySelectorAll(".cp-mode-tab");
    const mainArea = panel.querySelector("#cp-main-area");
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const activeKey = tab.dataset.key;
            window.__cp_active_mode = activeKey;
            renderHeaderAndTabs(panel);

            if (activeKey === 'scrapbook') {
                renderScrapbook(mainArea);
            } else if (activeKey === 'kanban') {
                mainArea.innerHTML = '<h1 style="text-align:center; margin-top: 50px;">기획 보드 모드는 구현 예정입니다.</h1>';
            } else if (activeKey === 'draft') {
                mainArea.innerHTML = '<h1 style="text-align:center; margin-top: 50px;">초안 작성 모드는 구현 예정입니다.</h1>';
            }
        });
    });
}

// 좌하단 카드 버튼 표시 함수
function showCardFloatingButton() {
  // 만약 컨테이너가 이미 있다면 함수 종료
  if (document.getElementById("cp-dock-container")) return;

  // 1. 부모 컨테이너 생성
  const container = document.createElement("div");
  container.id = "cp-dock-container";
  container.style.cssText = `
    position: fixed;
    left: 0;
    bottom: 36px;
    z-index: 2147483648;
    display: flex; /* 내부 요소들을 가로로 나란히 배치 */
    align-items: center;
  `;

  // 2. 최소화 버튼 생성 (기존과 거의 동일)
  const cardBtn = document.createElement("button");
  cardBtn.id = "cp-card-float-btn";
  cardBtn.style.cssText = `
    height: 72px;
    width: 72px;
    background: #f8f9fa; /* 순백색(#fff) 대신 아주 연한 회색으로 변경 */
    box-shadow: 0 4px 12px rgba(0,0,0,0.1); /* 그림자를 더 부드럽게 */
    border: 1px solid #e9ecef; /* 테두리도 배경에 맞게 살짝 어둡게 */
    border-left: none;
    border-radius: 0; 
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    z-index: 2;
  `;
  // --- ▼▼▼ 내용(innerHTML) 수정: 아이콘을 반투명하게 ▼▼▼ ---
  const iconUrl = chrome.runtime.getURL("images/icon-48.png");
  cardBtn.innerHTML = `
    <img src="${iconUrl}" alt="Content Pilot" style="width: 32px; height: 32px; pointer-events: none; opacity: 0.65;">
  `;

  const iconImg = cardBtn.querySelector('img');

  // --- ▼▼▼ 마우스 호버 이벤트 추가 ▼▼▼ ---
  cardBtn.onmouseover = () => {
    cardBtn.style.background = '#ffffff'; // 호버 시 순백색으로
    cardBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)'; // 그림자를 더 선명하게
    if(iconImg) iconImg.style.opacity = '1'; // 아이콘을 선명하게
  };

  cardBtn.onmouseout = () => {
    cardBtn.style.background = '#f8f9fa'; // 원래의 연한 회색으로
    cardBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; // 그림자도 원래대로
    if(iconImg) iconImg.style.opacity = '0.65'; // 아이콘도 원래대로
  };

  cardBtn.onclick = () => {
    createAndShowPanel();
    container.remove(); // 컨테이너 전체를 삭제
  };

  // 3. 컨테이너에 버튼을 추가하고, 컨테이너를 body에 추가
  container.appendChild(cardBtn);
  document.body.appendChild(container);
}