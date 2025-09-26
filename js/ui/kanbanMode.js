// 칸반 보드 모드 UI
// import 제거, window.접근으로 대체

const sampleKanban = {
  아이디어: [
    { id: "1", title: "AI 트렌드 2025", cluster: true },
    { id: "2", title: "UX 디자인 가이드" },
  ],
  "기획 중": [{ id: "3", title: "콘텐츠 마케팅 전략" }],
  "초안 작성": [],
};

const aiClusters = [
  {
    id: "c1",
    title: "AI+UX 융합 아이디어",
    color: "#34A853",
    items: ["1", "2"],
  },
];

function renderKanban() {
  window.__cp_active_mode = "kanban";
  const panel = window.state && window.state.panel;
  panel.innerHTML = window.renderPanelHeader ? window.renderPanelHeader() : '';
  panel.innerHTML += `
    <div id="cp-kanban-wrap">
      ${Object.keys(sampleKanban)
        .map(
          (col) => `
        <div class="cp-kanban-col" data-col="${col}">
          <div class="cp-kanban-col-title">${col}</div>
          <div class="cp-kanban-cards" data-col="${col}"></div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
  panel.querySelector("#cp-panel-close").onclick = () => panel.style.display = 'none';
  panel.querySelector("#cp-panel-fullscreen-exit").onclick = () => panel.style.display = 'none';
  // 레이아웃 모드 버튼 이벤트 항상 재바인딩
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderKanban();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
  bindTabClickEvents();
  // 카드 렌더링
  Object.entries(sampleKanban).forEach(([col, cards]) => {
    const colEl = panel.querySelector(`.cp-kanban-cards[data-col="${col}"]`);
    colEl.innerHTML = cards
      .map((card) => {
        const isCluster = aiClusters.some((c) => c.items.includes(card.id));
        return `<div class="cp-kanban-card${
          isCluster ? " cluster" : ""
        }" draggable="true" data-id="${card.id}">${card.title}</div>`;
      })
      .join("");
  });
  // 드래그 앤 드롭 이벤트
  let dragId = null;
  panel.querySelectorAll(".cp-kanban-card").forEach((card) => {
    card.ondragstart = (e) => {
      dragId = card.getAttribute("data-id");
      e.dataTransfer.effectAllowed = "move";
    };
  });
  panel.querySelectorAll(".cp-kanban-col").forEach((col) => {
    col.ondragover = (e) => {
      e.preventDefault();
    };
    col.ondrop = (e) => {
      e.preventDefault();
      if (!dragId) return;
      alert("카드 이동: 실제 구현 필요");
      dragId = null;
    };
  });
}
window.renderKanban = renderKanban;

function renderModeTabs(active) {
  const panel = state.panel;
  if (!panel) return;
  const tabs = [
    { key: "scrapbook", label: "스크랩북", color: "#4285F4" },
    { key: "kanban", label: "기획 보드", color: "#34A853" },
    { key: "draft", label: "초안 작성", color: "#FBBC05" },
  ];
  panel.innerHTML += `
    <div id="cp-mode-tabs" style="display:flex;gap:8px;margin-bottom:8px;">
      ${tabs
        .map(
          (tab) => `
            <div class="cp-mode-tab${active === tab.key ? " active" : ""}" data-key="${
            tab.key
          }" style="
            padding:7px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:15px;
            color:${active === tab.key ? tab.color : "#888"};
            background:${active === tab.key ? "#f2f3f7" : "transparent"};
            border:2px solid ${active === tab.key ? tab.color : "transparent"};
            transition:all 0.2s;
          ">${tab.label}</div>
        `
        )
        .join("")}
    </div>
  `;
  setTimeout(() => {
    panel.querySelectorAll(".cp-mode-tab").forEach((tabEl) => {
      tabEl.onclick = () => {
        window.__cp_active_mode = tabEl.getAttribute("data-key");
        if (tabEl.getAttribute("data-key") === "scrapbook") window.renderScrapbook();
        if (tabEl.getAttribute("data-key") === "kanban") renderKanban();
        if (tabEl.getAttribute("data-key") === "draft") window.renderDraftingMode();
      };
    });
  }, 10);
}
window.renderModeTabs = renderModeTabs;

function bindTabClickEvents() {
  setTimeout(() => {
    document.querySelectorAll(".cp-mode-tab").forEach((tabEl) => {
      tabEl.onclick = () => {
        window.__cp_active_mode = tabEl.getAttribute("data-key");
        if (tabEl.getAttribute("data-key") === "scrapbook") window.renderScrapbook();
        if (tabEl.getAttribute("data-key") === "kanban") renderKanban();
        if (tabEl.getAttribute("data-key") === "draft") window.renderDraftingMode();
      };
    });
  }, 10);
}
window.bindTabClickEvents = bindTabClickEvents;
