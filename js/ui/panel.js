// js/ui/panel.js (워크스페이스 연동 로직 최종 적용)

import { initDashboardMode, addDashboardEventListeners, renderDashboard } from "./dashboardMode.js";
import { renderPanelHeader, renderHeaderAndTabs, addHeaderEventListeners } from "./header.js";
import { renderScrapbook } from "./scrapbookMode.js";
import { renderChannelMode } from "./channelMode.js";
import { renderKanban, addKanbanEventListeners } from "./kanbanMode.js"; 
import { renderWorkspace } from "./workspaceMode.js";
import { renderPerformanceDashboard } from "./performanceDashboardMode.js";
import { renderPerformanceReport } from "./performanceReportMode.js";
import { renderAdminMode } from "./adminMode.js"; 


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
    mainArea.style.overflowY = 'auto';

    panelContent.appendChild(headerArea);
    panelContent.appendChild(mainArea);
    panel.appendChild(panelContent);
    shadowRoot.appendChild(panel);

    window.__cp_active_mode = 'dashboard'; 
    
    renderHeaderAndTabs(shadowRoot);
    addEventListenersToPanel(shadowRoot); 

    // [수정] 초기 로드 로직 (온보딩 체크)
    chrome.storage.local.get("activeChannelId", (res) => {
      // 1. 활성 채널 ID가 있으면 -> 대시보드로 정상 진입
      if (res.activeChannelId) {
        renderDashboard(mainArea); 
        addDashboardEventListeners(mainArea);
        
        // 헤더 이벤트 리스너 초기화 (채널 선택기 등)
        import("./header.js").then(module => {
          module.addHeaderEventListeners(shadowRoot);
        });
        return;
      }

      // 2. 활성 채널 ID가 없으면 -> 채널 목록 확인 (비동기)
      chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (response) => {
        const myBlogs = response?.data?.myChannels?.blogs || [];

        if (myBlogs.length > 0) {
          // 2-A. 채널은 있는데 선택이 안 된 경우 -> 첫 번째 채널 자동 선택 후 대시보드 이동
          const firstId = myBlogs[0].id || (myBlogs[0].apiUrl ? btoa(myBlogs[0].apiUrl).replace(/=/g, "") : "");
          chrome.storage.local.set({ activeChannelId: firstId }, () => {
            // 헤더의 선택기 UI도 갱신해야 하므로 새로고침 메시지 전송 등 필요할 수 있음
            // 여기서는 일단 대시보드로 이동
            renderDashboard(mainArea); 
            addDashboardEventListeners(mainArea);
            
            // 헤더 이벤트 리스너 초기화 (채널 선택기 등)
            import("./header.js").then(module => {
              module.addHeaderEventListeners(shadowRoot);
            });
          });
        } else {
          // 2-B. 채널이 하나도 없는 '찐' 신규 사용자 -> '채널 관리' 화면 강제 표시
          console.log("[Panel] 신규 사용자 감지: 채널 관리 화면으로 이동");
          
          // 탭 UI 선택 해제
          const navItems = shadowRoot.querySelectorAll(".cp-mode-tab");
          navItems.forEach(item => item.classList.remove("active"));
          
          // 채널 모드 로드 및 안내 메시지 표시
          renderChannelMode(mainArea);
          // (선택) 안내 토스트 메시지 띄우기
          // showToast("👋 환영합니다! 먼저 '채널 추가'를 진행해주세요."); 
        }
      });
    });

    // [신규] 글로벌 채널 변경 감지 -> 현재 탭 새로고침
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "local" && changes.activeChannelId) {
        console.log("[Panel] 채널 변경 감지, 현재 탭 새로고침");
        
        // 현재 활성화된 탭 찾기
        const activeTabBtn = shadowRoot.querySelector(".cp-mode-tab.active");
        if (activeTabBtn) {
          const tabName = activeTabBtn.dataset.key;
          
          // 탭별 새로고침 로직
          if (tabName === "kanban") {
            // 칸반은 데이터 다시 그리기만 호출 (전체 리로드 불필요)
            chrome.runtime.sendMessage({ action: "get_kanban_data" });
          } else if (tabName === "dashboard") {
            // 대시보드 새로고침
            import("./dashboardMode.js").then(module => {
              module.renderDashboard(mainArea);
              module.addDashboardEventListeners(mainArea);
            });
          } else if (tabName === "scrapbook") {
            // 스크랩북 새로고침
            import("./scrapbookMode.js").then(module => {
              module.renderScrapbook(mainArea);
            });
          }
        }
      }
    });
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


// renderHeaderAndTabs는 header.js에서 import하여 사용


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

        // 설정 메뉴 토글
        if (target.closest("#cp-settings-btn")) {
            const menu = shadowRoot.querySelector("#cp-settings-menu");
            if (menu) {
                menu.style.display = menu.style.display === "none" ? "block" : "none";
            }
            return;
        }

        // 설정 메뉴 항목 클릭
        const menuItem = target.closest('.cp-settings-menu-item');
        if (menuItem) {
            const action = menuItem.dataset.action;
            const menu = shadowRoot.querySelector("#cp-settings-menu");
            if (menu) menu.style.display = "none";
            
            if (action === "diagnosis") {
                window.__cp_active_mode = 'admin';
                renderHeaderAndTabs(shadowRoot);
                renderAdminMode(mainArea);
            }
            return;
        }

        // 설정 메뉴 외부 클릭 시 닫기
        if (!target.closest("#cp-settings-btn") && !target.closest("#cp-settings-menu")) {
            const menu = shadowRoot.querySelector("#cp-settings-menu");
            if (menu) menu.style.display = "none";
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
            } else if (activeKey === 'performance') {
                renderPerformanceDashboard(mainArea);
            } else if (activeKey === 'report') {
                renderPerformanceReport(mainArea);
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