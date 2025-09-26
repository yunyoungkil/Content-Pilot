// 패널 헤더 렌더링

// 공통 헤더 렌더링 함수
export function renderPanelHeader() {
  // 구글 머티리얼 심볼 폰트가 없으면 동적으로 head에 추가
  if (!document.getElementById("cp-material-symbols-font")) {
    const link = document.createElement("link");
    link.id = "cp-material-symbols-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(link);
  }
  // 스타일은 항상 한 번만 추가
  if (!document.getElementById("cp-material-symbols-style")) {
    const style = document.createElement("style");
    style.id = "cp-material-symbols-style";
    style.textContent = `.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }`;
    document.head.appendChild(style);
  }
  const iconUrl = chrome.runtime.getURL("images/icon-32.png");
  let activeMode = window.__cp_active_mode || "scrapbook";
  const tabs = [
    { key: "scrapbook", label: "스크랩북 모드", color: "#4285F4" },
    { key: "kanban", label: "기획 보드 모드", color: "#34A853" },
    { key: "draft", label: "초안 작성 모드", color: "#FBBC05" },
  ];
  // 레이아웃 모드 상태를 window 전역에 저장
  const isLayoutMode = !!window.__cp_layout_mode_active;
  return `
    <div id="cp-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px 18px;border-bottom:1.5px solid #f0f0f0;background:#fff;border-radius:12px 12px 0 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${iconUrl}" alt="Content Pilot" style="height:26px;width:26px;">
        <span style="font-size:18px;font-weight:700;color:#222;letter-spacing:0.5px;">Content Pilot</span>
      </div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="cp-panel-fullscreen-exit" style="background:none;border:none;font-size:22px;color:#888;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <span class="material-symbols-outlined">fullscreen_exit</span>
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
        <button id="cp-panel-close" style="background:none;border:none;font-size:22px;color:#888;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div id="cp-mode-tabs" style="display:flex;gap:8px;margin-bottom:8px;padding:0 18px 0 18px;">
      ${tabs
        .map(
          (tab) => `
            <div class="cp-mode-tab${
              activeMode === tab.key ? " active" : ""
            }" data-key="${tab.key}" style="
              padding:7px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:15px;
              color:${activeMode === tab.key ? tab.color : "#888"};
              background:${activeMode === tab.key ? "#f2f3f7" : "transparent"};
              border:2px solid ${
                activeMode === tab.key ? tab.color : "transparent"
              };
              transition:all 0.2s;
            ">${tab.label}</div>
          `
        )
        .join("")}
    </div>
  `;
}
