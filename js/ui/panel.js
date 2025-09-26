// 메인 패널 생성 및 관리
// import 제거, window.state 사용

function createPanel() {
  if (window.state && window.state.panel) return;
  let panel = document.getElementById('content-pilot-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'content-pilot-panel';
    panel.style.position = 'fixed';
    panel.style.right = '32px';
    panel.style.bottom = '32px';
    panel.style.zIndex = '2147483647';
    panel.style.boxShadow = '0px 4px 24px rgba(0,0,0,0.13)';
    panel.style.borderRadius = '12px';
    panel.style.background = '#fff';
    panel.style.minWidth = 'fit-content';
    panel.style.overflow = 'auto';
    panel.style.top = '0';
    panel.style.left = '0';
    document.body.appendChild(panel);
  }
  if (window.state) window.state.panel = panel;
}
window.createPanel = createPanel;

function closePanel() {
  if (!(window.state && window.state.panel)) return;
  window.state.panel.style.display = 'none';
}
window.closePanel = closePanel;

function minimizePanelToCard() {
  if (!(window.state && window.state.panel)) return;
  window.state.panel.style.display = 'none';
  showCardFloatingButton();
}
window.minimizePanelToCard = minimizePanelToCard;

function showCardFloatingButton() {
  if (!document.getElementById('cp-material-symbols-font')) {
    const link = document.createElement('link');
    link.id = 'cp-material-symbols-font';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    document.head.appendChild(link);
  }
  if (!document.getElementById('cp-material-symbols-style-48')) {
    const style = document.createElement('style');
    style.id = 'cp-material-symbols-style-48';
    style.textContent = `.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 48; }`;
    document.head.appendChild(style);
  }
  let cardBtn = document.getElementById('cp-card-float-btn');
  if (!cardBtn) {
    cardBtn = document.createElement('button');
    cardBtn.id = 'cp-card-float-btn';
    cardBtn.style.position = 'fixed';
    cardBtn.style.left = '36px';
    cardBtn.style.bottom = '36px';
    cardBtn.style.zIndex = '2147483648';
    cardBtn.style.width = '64px';
    cardBtn.style.height = '64px';
    cardBtn.style.borderRadius = '18px';
    cardBtn.style.background = '#fff';
    cardBtn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
    cardBtn.style.border = '1.5px solid #e0e0e0';
    cardBtn.style.display = 'flex';
    cardBtn.style.flexDirection = 'column';
    cardBtn.style.alignItems = 'center';
    cardBtn.style.justifyContent = 'center';
    cardBtn.style.cursor = 'pointer';
    cardBtn.style.padding = '0';
    cardBtn.style.transition = 'box-shadow 0.18s';
    cardBtn.onmouseenter = () => {
      cardBtn.style.boxShadow = '0 4px 20px rgba(66,133,244,0.18)';
    };
    cardBtn.onmouseleave = () => {
      cardBtn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
    };
    cardBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:48px;margin-top:8px;color:#434343;">widget_width</span>
    `;
    cardBtn.onclick = () => {
      if (state.panel) state.panel.style.display = '';
      cardBtn.remove();
    };
    document.body.appendChild(cardBtn);
  }
}
