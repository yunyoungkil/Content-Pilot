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
     { key: "draft", label: "초안 작성", color: "#FBBC05" },
     { key: "channel", label: "채널 연동", color: "#EA4335" },
  ];

  return `
    <div id="cp-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px 18px;border-bottom:1.5px solid #f0f0f0;background:#fff;border-radius:12px 12px 0 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${iconUrl}" alt="Content Pilot" style="height:26px;width:26px;">
        <span style="font-size:18px;font-weight:700;color:#222;letter-spacing:0.5px;">Content Pilot</span>
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