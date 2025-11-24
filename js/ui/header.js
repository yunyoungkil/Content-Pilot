// js/ui/header.js

// 공통 헤더 렌더링 함수
export function renderPanelHeader() {
  const iconUrl = chrome.runtime.getURL("images/icon-32.png");
  const activeMode = window.__cp_active_mode || "scrapbook";
  const isWorkspaceMode = activeMode === 'workspace';
  const isLayoutMode = !!window.__cp_layout_mode_active;

  const tabs = [
     { key: "dashboard", label: "대시보드", color: "#1a73e8" }, 
     { key: "scrapbook", label: "스크랩북", color: "#4285F4" },
     { key: "kanban", label: "기획 보드", color: "#34A853" },
     { key: "performance", label: "성과 대시보드", color: "#9C27B0" },
     { key: "report", label: "성과 리포트", color: "#FF6B6B" },
     { key: "draft", label: "초안 작성", color: "#FBBC05" },
     // 채널 연동 탭 제거됨 - 헤더의 글로벌 선택기로 대체
  ];

  return `
    <div id="cp-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px 18px;border-bottom:1.5px solid #f0f0f0;background:#fff;border-radius:12px 12px 0 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${iconUrl}" alt="Content Pilot" style="height:26px;width:26px;">
        <span style="font-size:18px;font-weight:700;color:#222;letter-spacing:0.5px;">Content Pilot</span>
      </div>
      <div style="flex:1;display:flex;justify-content:center;padding:0 16px;">
        <div class="global-channel-wrapper" style="position:relative;min-width:200px;max-width:300px;width:100%;">
          <select id="global-channel-selector" class="channel-select" title="작업할 채널 선택" style="width:100%;padding:6px 32px 6px 12px;font-size:14px;border:1px solid #dadce0;border-radius:18px;background-color:#f8f9fa;color:#3c4043;cursor:pointer;appearance:none;background-image:url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%235F6368%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E');background-repeat:no-repeat;background-position:right 12px center;background-size:10px;transition:all 0.2s;">
            <option value="" disabled selected>채널 로딩 중...</option>
          </select>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="cp-panel-fullscreen-exit" class="cp-panel-icon-btn">
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M220-160v-280h60v220h220v60H220Zm0-320v-280h280v60H280v220h-60Zm320 320v-60h220v-220h60v280H540Zm220-320v-220H540v-60h280v280h-60Z"/></svg>
        </button>
        <label id="cp-layout-mode-btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <input type="checkbox" id="cp-layout-mode-switch" style="display:none;" ${
            isLayoutMode ? "checked" : ""
          }>
          <span style="width:34px;height:20px;display:inline-block;position:relative;">
            <span style="position:absolute;left:0;top:0;width:34px;height:20px;background:${
              isLayoutMode ? "#e3f2fd" : "#e0e0e0"
            };border-radius:12px;transition:background 0.2s;"></span>
            <span style="position:absolute;top:2px;left:${
              isLayoutMode ? "16px" : "2px"
            };width:16px;height:16px;background:${
    isLayoutMode ? "#1976d2" : "#888"
  };border-radius:50%;transition:left 0.2s,background 0.2s;"></span>
          </span>
          <span style="font-size:14px;font-weight:600;color:${
            isLayoutMode ? "#1976d2" : "#888"
          };user-select:none;">레이아웃</span>
        </label>
        <button id="open-diagnostics-btn" class="cp-panel-icon-btn" title="시스템 진단" style="font-size:18px;padding:4px;border-radius:50%;transition:background 0.2s;">🛠️</button>
        <div style="position:relative;">
          <button id="cp-settings-btn" class="cp-panel-icon-btn" title="설정">
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z"/></svg>
          </button>
          <div id="cp-settings-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:8px;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:200px;z-index:1000;overflow:hidden;">
            <button class="cp-settings-menu-item" data-action="diagnosis" style="width:100%;padding:12px 16px;text-align:left;background:none;border:none;cursor:pointer;font-size:14px;color:#333;display:flex;align-items:center;gap:8px;transition:background 0.2s;">
              <span>🛠️</span>
              <span>시스템 진단</span>
            </button>
          </div>
        </div>
        <button id="cp-panel-close" class="cp-panel-icon-btn">
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
        </button>
      </div>
    </div>
    
    ${/* 워크스페이스 모드일 경우 '뒤로가기' 버튼을, 아닐 경우 기존 탭을 보여줍니다. */''}
    ${isWorkspaceMode ? `
    <div id="cp-navigation-bar" style="display:flex; align-items:center; padding: 0 18px 8px 18px; border-bottom: 1.5px solid #f0f0f0; margin-bottom: 8px;">
      <button id="cp-back-to-dashboard" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; gap: 4px; font-size: 15px; font-weight: 600; color: #555;">
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="#555"><path d="M400-80 0-480l400-400 56 56-344 344 344 344-56 56Z"/></svg>
        <span>대시보드로 돌아가기</span>
      </button>
    </div>
    ` : `
    <div id="cp-mode-tabs" style="display:flex;gap:8px;margin-bottom:8px;padding:0 18px 0 18px;">
      ${tabs.map(tab => `
        <div class="cp-mode-tab ${activeMode === tab.key ? " active" : ""}" data-key="${tab.key}" style="padding:7px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:15px;color:${activeMode === tab.key ? tab.color : "#888"};background:${activeMode === tab.key ? "#f2f3f7" : "transparent"};border:2px solid ${activeMode === tab.key ? tab.color : "transparent"};transition:all 0.2s;">
          ${tab.label}
        </div>
      `).join("")}
    </div>
    `}
  `;
}

// 헤더 이벤트 리스너 추가 함수
export function addHeaderEventListeners(shadowRoot) {
  // 글로벌 채널 선택기 초기화
  initGlobalChannelSelector(shadowRoot);
  
  // 시스템 진단 버튼
  const diagBtn = shadowRoot.querySelector("#open-diagnostics-btn");
  if (diagBtn) {
    diagBtn.addEventListener("click", () => {
      const mainArea = shadowRoot.querySelector("#cp-main-area");
      if (mainArea) {
        window.__cp_active_mode = 'admin';
        renderHeaderAndTabs(shadowRoot);
        import("./adminMode.js").then(module => module.renderAdminMode(mainArea));
      }
    });
  }
}

// 글로벌 채널 선택기 초기화
async function initGlobalChannelSelector(shadowRoot) {
  const selector = shadowRoot.querySelector("#global-channel-selector");
  if (!selector) return;

  // 1. 저장된 활성 채널 ID 가져오기
  const { activeChannelId } = await chrome.storage.local.get("activeChannelId");

  // 2. 채널 목록 가져오기
  chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (response) => {
    if (response && response.success) {
      const myBlogs = response.data.myChannels?.blogs || [];
      
      // 옵션 초기화
      selector.innerHTML = "";

      if (myBlogs.length === 0) {
        // [체크리스트 3-🅱️] 채널이 없을 때
        const option = document.createElement("option");
        option.value = "__MANAGE__";
        option.textContent = "👉 채널을 추가해주세요";
        selector.appendChild(option);
        selector.style.borderColor = "#ea4335"; // 빨간색 테두리로 강조
        selector.style.color = "#ea4335"; // 빨간색 텍스트로 강조
        selector.style.fontWeight = "500";
        // openChannelManager(); // panel.js에서 처리하므로 여기선 생략 가능
      } else {
        // 채널 목록 추가
        let foundActive = false;
        const generateChannelId = (channel) => {
          if (channel.id) return channel.id;
          if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, "");
          if (channel.url) return btoa(channel.url).replace(/=/g, "");
          return null;
        };
        
        myBlogs.forEach(blog => {
          const option = document.createElement("option");
          // ID 생성 (id > apiUrl > url 순서)
          const id = generateChannelId(blog);
          if (!id) {
            console.warn("[Header] 채널 ID를 생성할 수 없습니다:", blog);
            return;
          }
          option.value = id;
          option.textContent = `📺 ${blog.inputUrl || blog.url || blog.apiUrl || '알 수 없음'}`;
          selector.appendChild(option);

          if (id === activeChannelId) foundActive = true;
        });

        // 저장된 채널이 유효하면 선택, 아니면 첫 번째 자동 선택
        if (foundActive) {
          selector.value = activeChannelId;
        } else if (selector.options.length > 0) {
          selector.value = selector.options[0].value;
          // 변경된 첫 번째 채널을 자동 저장
          chrome.storage.local.set({ activeChannelId: selector.value });
        }

        // 구분선 및 관리 메뉴 추가
        const separator = document.createElement("option");
        separator.disabled = true;
        separator.textContent = "──────────";
        selector.appendChild(separator);

        const manageOption = document.createElement("option");
        manageOption.value = "__MANAGE__";
        manageOption.textContent = "⚙️ 채널 관리...";
        selector.appendChild(manageOption);
      }
    }
  });

  // 3. 변경 이벤트 리스너
  selector.addEventListener("change", (e) => {
    const selectedValue = e.target.value;

    if (selectedValue === "__MANAGE__") {
      // '채널 관리' 선택 시
      openChannelManager(shadowRoot);
      
      // UI 상으로는 다시 원래 채널(또는 첫번째)로 돌려놓기 (UX)
      chrome.storage.local.get("activeChannelId", (res) => {
        if (res.activeChannelId) {
          // 목록에 해당 ID가 있는지 확인 후 복구
          const exists = Array.from(selector.options).some(opt => opt.value === res.activeChannelId);
          if (exists) selector.value = res.activeChannelId;
        }
      });
    } else {
      // 일반 채널 선택 시 -> 상태 저장 및 새로고침
      chrome.storage.local.set({ activeChannelId: selectedValue }, () => {
        console.log(`[Global] 활성 채널 변경됨: ${selectedValue}`);
        
        // [체크리스트 4-1] 헤더 반응성: 로딩 표시 추가
        const mainArea = shadowRoot.querySelector("#cp-main-area");
        if (!mainArea) return;
        
        // 로딩 오버레이 표시
        const loadingOverlay = document.createElement("div");
        loadingOverlay.id = "channel-switch-loading";
        loadingOverlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          font-size: 14px;
          color: #666;
        `;
        loadingOverlay.innerHTML = `<div style="text-align: center;"><div style="margin-bottom: 8px;">⏳ 채널 데이터 로딩 중...</div></div>`;
        mainArea.style.position = "relative";
        mainArea.appendChild(loadingOverlay);
        
        const activeTab = shadowRoot.querySelector(".cp-mode-tab.active");
        if (activeTab) {
          const tabName = activeTab.dataset.key;
          
          // 약간의 지연 후 리로드 (storage 저장 보장)
          setTimeout(() => {
            // 탭별 새로고침 로직
            Promise.all([
              tabName === "dashboard" ? import("./dashboardMode.js").then(module => {
                module.renderDashboard(mainArea);
                module.addDashboardEventListeners(mainArea);
              }) : null,
              tabName === "scrapbook" ? import("./scrapbookMode.js").then(module => {
                module.renderScrapbook(mainArea);
              }) : null,
              tabName === "kanban" ? import("./kanbanMode.js").then(module => {
                module.renderKanban(mainArea);
                module.addKanbanEventListeners(mainArea);
              }) : null,
              tabName === "performance" ? import("./performanceDashboardMode.js").then(module => {
                module.renderPerformanceDashboard(mainArea);
              }) : null,
              tabName === "report" ? import("./performanceReportMode.js").then(module => {
                module.renderPerformanceReport(mainArea);
              }) : null
            ].filter(Boolean)).then(() => {
              // 로딩 오버레이 제거
              const loading = mainArea.querySelector("#channel-switch-loading");
              if (loading) loading.remove();
            });
          }, 100);
        } else {
          // 로딩 오버레이 제거 (탭이 없는 경우)
          setTimeout(() => {
            const loading = mainArea.querySelector("#channel-switch-loading");
            if (loading) loading.remove();
          }, 500);
        }
      });
    }
  });
}

// 채널 관리 화면으로 전환하는 헬퍼
function openChannelManager(shadowRoot) {
  const mainArea = shadowRoot.querySelector("#cp-main-area");
  if (mainArea) {
    // 탭 스타일 초기화
    shadowRoot.querySelectorAll(".cp-mode-tab").forEach(btn => btn.classList.remove("active"));
    
    // 채널 관리 UI 렌더링
    window.__cp_active_mode = 'channel';
    import("./channelMode.js").then(module => {
      module.renderChannelMode(mainArea);
      renderHeaderAndTabs(shadowRoot);
    });
  }
}

// renderHeaderAndTabs 함수 (panel.js에서 사용)
export function renderHeaderAndTabs(shadowRoot) {
  const headerArea = shadowRoot.querySelector("#cp-header-area");
  if (headerArea) {
    headerArea.innerHTML = renderPanelHeader();
    addHeaderEventListeners(shadowRoot);
  }
}