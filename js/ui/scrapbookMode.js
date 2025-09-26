// 스크랩북 모드 UI 렌더링 및 이벤트 처리
function renderScrapbook(selectedId, sortType = 'latest', filterKeyword = '', filterMode = 'or') {
  const panel = window.state && window.state.panel;
  if (!panel) return;
  // 헤더 렌더링
  panel.innerHTML = window.renderPanelHeader ? window.renderPanelHeader() : '';
  // 샘플 데이터 (실제 구현 시 window.state.firebaseScraps 사용)
  const scraps = window.state && window.state.firebaseScraps && window.state.firebaseScraps.length
    ? window.state.firebaseScraps.slice()
    : [
        { id: '1', text: '예시 스크랩 1', url: 'https://naver.com', tag: '뉴스', image: '', images: [] },
        { id: '2', text: '예시 스크랩 2', url: 'https://google.com', tag: '검색', image: '', images: [] }
      ];
  // 레이아웃: 왼쪽 1열 리스트, 오른쪽 상세
  panel.innerHTML += `
    <div style="display:flex;flex-direction:row;align-items:flex-start;gap:0;min-height:340px;">
      <div id="scrapbook-list" style="width:220px;padding:18px 0 18px 12px;display:flex;flex-direction:column;gap:10px;background:#f7f8fa;border-radius:0 0 0 12px;box-shadow:0 2px 10px rgba(66,133,244,0.06);min-height:340px;">
        ${scraps.map(scrap => `
          <div class="scrap-card" data-id="${scrap.id}" tabindex="0" style="background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(66,133,244,0.08);padding:12px 10px 12px 16px;display:flex;flex-direction:column;gap:6px;position:relative;cursor:pointer;outline:none;${selectedId===scrap.id?'border:2px solid #4285F4;':''}">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${scrap.text}</div>
            <div style="color:#888;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${scrap.url.replace(/^https?:\/\//, '').substring(0, 40)}</div>
            <div style="color:#b0b0b0;font-size:12px;">${scrap.tag || ''}</div>
            <button class="scrap-card-delete-btn" data-id="${scrap.id}" title="삭제" style="position:absolute; left:6px; top:6px; width:22px;height:22px;border:none;background:rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.08);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background 0.15s;z-index:2;">
              <span style="color:#d32f2f;font-size:16px;">✕</span>
            </button>
          </div>
        `).join('')}
      </div>
      <div id="scrapbook-detail-content" style="flex:1;padding:32px 32px 32px 32px;min-width:0;"></div>
    </div>
  `;
  // 카드 클릭 이벤트
  Array.from(panel.getElementsByClassName('scrap-card')).forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('.scrap-card-delete-btn')) return;
      const newId = card.getAttribute('data-id');
      renderScrapbook(newId, sortType, filterKeyword);
    };
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') card.onclick(e);
    };
  });
  // 삭제 버튼 이벤트
  Array.from(panel.getElementsByClassName('scrap-card-delete-btn')).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      // 실제 구현 시 chrome.runtime.sendMessage 등으로 삭제
      window.showToast && window.showToast('삭제되었습니다 (샘플)');
      // 삭제 후 새로고침(샘플)
      renderScrapbook();
    };
  });
  // 상세 패널 렌더링(샘플)
  const detailPanel = panel.querySelector('#scrapbook-detail-content');
  const selected = scraps.find(s => s.id === selectedId) || scraps[0];
  if (selected && detailPanel) {
    detailPanel.innerHTML = `
      <div style="background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(66,133,244,0.10);padding:24px;max-width:420px;">
        <div style="font-size:1.2rem;font-weight:700;color:#1a237e;">${selected.text}</div>
        <div style="color:#4285F4;font-size:1rem;margin:8px 0;">
          <a href="${selected.url}" target="_blank" style="color:#4285F4;text-decoration:underline;">${window.shortenLink(selected.url)}</a>
        </div>
        <div style="color:#b0b0b0;font-size:13px;">${selected.tag || ''}</div>
      </div>
    `;
  }
}
window.renderScrapbook = renderScrapbook;
