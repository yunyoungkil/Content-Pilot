// js/ui/panel.js (워크스페이스 연동 로직 최종 적용)

import { initDashboardMode, addDashboardEventListeners, renderDashboard } from "./dashboardMode.js";
import { renderPanelHeader } from "./header.js";
import { renderScrapbook } from "./scrapbookMode.js";
import { renderChannelMode } from "./channelMode.js";
import { renderKanban, addKanbanEventListeners } from "./kanbanMode.js"; 
import { renderWorkspace } from "./workspaceMode.js"; 


export function isPanelVisible() {
    const host = document.getElementById("content-pilot-host");
    return host && host.style.display !== 'none';
}


export function createAndShowPanel() {
  let host = document.getElementById("content-pilot-host");
  if (host) {
    host.style.display = "block";
    const mainArea = host.shadowRoot.querySelector('#cp-main-area');
    if (window.__cp_active_mode === 'dashboard' && mainArea) {
        initDashboardMode(mainArea);
    }
  } else {
    // --- 패널 최초 생성 로직 ---
    host = document.createElement("div");
    host.id = "content-pilot-host";
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'stylesheet';
    googleFontsLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    shadowRoot.appendChild(googleFontsLink);

    // 1. 기본 스타일(style.css) 링크
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('css/style.css');
    shadowRoot.appendChild(styleLink);

    // 2. 워크스페이스 스타일(workspace.css) 링크 추가
    const workspaceStyleLink = document.createElement('link');
    workspaceStyleLink.rel = 'stylesheet';
    workspaceStyleLink.href = chrome.runtime.getURL('css/workspace.css');
    shadowRoot.appendChild(workspaceStyleLink);

    // 3. 칸반 보드 스타일(kanban.css) 링크 추가
    const kanbanStyleLink = document.createElement('link');
    kanbanStyleLink.rel = 'stylesheet';
    kanbanStyleLink.href = chrome.runtime.getURL('css/kanban.css');
    shadowRoot.appendChild(kanbanStyleLink);

    // 4. Toast UI Editor CSS 링크 수정
    const tuiEditorStyleLink = document.createElement('link');
    tuiEditorStyleLink.rel = 'stylesheet';
    tuiEditorStyleLink.href = chrome.runtime.getURL('lib/toast-ui/toastui-editor.min.css');
    shadowRoot.appendChild(tuiEditorStyleLink);

    // 5. Toast UI Editor 자바스크립트 라이브러리 수정
    const tuiEditorScript = document.createElement('script');
    tuiEditorScript.src = chrome.runtime.getURL('lib/toast-ui/toastui-editor-all.min.js');
    document.head.appendChild(tuiEditorScript);

    const panel = document.createElement("div");
    panel.id = "content-pilot-panel";
    panel.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background-color: rgba(0, 0, 0, 0.4); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font-family: "Noto Sans KR", "Roboto", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
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
    shadowRoot.appendChild(panel);

    window.__cp_active_mode = 'dashboard'; 
    
    renderHeaderAndTabs(shadowRoot);
    addEventListenersToPanel(shadowRoot); 

    renderDashboard(mainArea); 
    addDashboardEventListeners(mainArea);
  }

  chrome.storage.local.set({ 
    isScrapingActive: true,
    highlightToggleState: false
  });
}


export function closePanel() {
  const host = document.getElementById("content-pilot-host");
  if (host) host.style.display = "none";
  chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
}


export function minimizePanelToCard() {
  const host = document.getElementById("content-pilot-host");
  if (host) host.style.display = "none";
  showCardFloatingButton();
  chrome.storage.local.set({ isScrapingActive: true, highlightToggleState: false });
}


export function hidePanelForScrap() {
  const host = document.getElementById("content-pilot-host");
  if (host && host.style.display !== 'none') {
    host.style.display = 'none';
    return true;
  }
  return false;
}


export function restorePanelAfterScrap(wasVisible) {
  if (wasVisible) {
    const host = document.getElementById("content-pilot-host");
    if (host) {
      host.style.display = 'block';
    }
  }
}


function renderHeaderAndTabs(shadowRoot) {
    const headerArea = shadowRoot.querySelector("#cp-header-area");
    if (headerArea) {
        headerArea.innerHTML = renderPanelHeader();
    }
}


function addEventListenersToPanel(shadowRoot) {
    const mainArea = shadowRoot.querySelector("#cp-main-area");
    const panelContent = shadowRoot.querySelector("#cp-panel-content-wrapper");

    // 이벤트 위임을 사용하여 패널 전체의 클릭 이벤트를 효율적으로 관리합니다.
    panelContent.addEventListener('click', (e) => {
        const target = e.target;

        if (target.closest('#cp-back-to-dashboard')) {
            window.__cp_active_mode = 'kanban'; 
            renderHeaderAndTabs(shadowRoot); 
            renderKanban(mainArea); 
            addKanbanEventListeners(mainArea);
            return;
        }

        // --- 기존 헤더 버튼 및 탭 클릭 로직 ---

        if (target.closest("#cp-panel-close")) {
            closePanel();
            return;
        }

        if (target.closest("#cp-panel-fullscreen-exit")) {
            minimizePanelToCard();
            return;
        }

        const tab = target.closest('.cp-mode-tab');
        if (tab) {
            const activeKey = tab.dataset.key;
            if (window.__cp_active_mode === activeKey) return; 

            window.__cp_active_mode = activeKey;
            renderHeaderAndTabs(shadowRoot);

            if (activeKey === 'dashboard') {
                renderDashboard(mainArea);
            } else if (activeKey === 'scrapbook') {
                renderScrapbook(mainArea);
            } else if (activeKey === 'kanban') {
                renderKanban(mainArea);
                addKanbanEventListeners(mainArea); 
            } else if (activeKey === 'channel') {
                renderChannelMode(mainArea);
            } else {
                mainArea.innerHTML = `<h1 style="text-align:center; margin-top: 50px;">${tab.textContent} 모드는 구현 예정입니다.</h1>`;
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