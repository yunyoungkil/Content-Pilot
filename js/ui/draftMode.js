// 초안 작성 모드 UI
// import 제거, window.접근으로 대체

const sampleKanban = {
  아이디어: [
    { id: "1", title: "AI 트렌드 2025", cluster: true },
    { id: "2", title: "UX 디자인 가이드" },
  ],
  "기획 중": [{ id: "3", title: "콘텐츠 마케팅 전략" }],
  "초안 작성": [],
};

function renderDraftingMode() {
  window.__cp_active_mode = "draft";
  const panel = window.state && window.state.panel;
  panel.innerHTML = window.renderPanelHeader ? window.renderPanelHeader() : '';
  panel.innerHTML += `
    <div id="cp-draft-wrap" style="display:flex;min-width:700px;height:420px;background:#f7f8fa;border-radius:8px;margin-top:12px;box-shadow:0 2px 12px rgba(0,0,0,0.10);overflow:hidden;">
      <div id="cp-draft-board" style="width:220px;background:#f2f3f7;border-right:1px solid #e0e0e0;padding:0 0 0 0;overflow-y:auto;">
        <div style="font-weight:700;font-size:16px;color:#4285F4;text-align:center;margin:18px 0 10px 0;">기획 보드</div>
        <div id="cp-draft-board-list"></div>
      </div>
      <div id="cp-draft-editor" style="flex:1;background:#fff;padding:28px 24px 24px 24px;display:flex;flex-direction:column;gap:12px;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;font-weight:700;color:#222;">초안 작성</span>
          <button id="cp-ai-suggest-btn" style="background:#FBBC05;color:#222;border:none;border-radius:4px;padding:7px 14px;font-weight:600;font-size:14px;cursor:pointer;">AI 제안</button>
        </div>
        <textarea id="cp-draft-textarea" style="flex:1;width:100%;min-height:220px;resize:vertical;font-size:15px;padding:14px 12px;border-radius:6px;border:1.5px solid #e0e0e0;background:#f7f8fa;color:#222;line-height:1.7;margin-top:8px;"></textarea>
      </div>
    </div>
  `;
  panel.querySelector("#cp-panel-close").onclick = () => panel.style.display = 'none';
  panel.querySelector("#cp-panel-fullscreen-exit").onclick = () => panel.style.display = 'none';
  // 레이아웃 모드 버튼 이벤트 항상 재바인딩
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderDraftingMode();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
  // 기획 보드 카드 목록
  const boardList = Object.values(sampleKanban)
    .flat()
    .map(
      (card) =>
        `<div style="background:#fff;border-radius:6px;margin:10px 12px 0 12px;padding:10px 10px;font-size:15px;font-weight:500;color:#333;box-shadow:0 1px 4px rgba(66,133,244,0.04);">${card.title}</div>`
    )
    .join("");
  panel.querySelector("#cp-draft-board-list").innerHTML = boardList;
  // AI 제안 버튼 이벤트
  panel.querySelector("#cp-ai-suggest-btn").onclick = () => {
    const textarea = panel.querySelector("#cp-draft-textarea");
    textarea.value +=
      "\n[AI 제안] 예시 문장: 이곳에 AI가 추천하는 문장이나 단락이 추가됩니다.";
    textarea.focus();
  };
}
window.renderDraftingMode = renderDraftingMode;
