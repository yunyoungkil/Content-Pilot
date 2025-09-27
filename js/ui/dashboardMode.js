// js/ui/dashboardMode.js (새 파일)

// 콘텐츠 카드 하나를 렌더링하는 함수
function createContentCard(item) {
  const isVideo = !!item.videoId;
  const link = isVideo ? `https://www.youtube.com/watch?v=${item.videoId}` : item.link;
  
  // RSS 설명에서 이미지 태그 추출 시도
  const descImgMatch = item.description?.match(/<img src="(.*?)"/);
  const thumbnail = isVideo ? item.thumbnail : (descImgMatch ? descImgMatch[1] : '');

  return `
    <a href="${link}" target="_blank" class="content-card ${item.channelType === 'competitorChannels' ? 'competitor' : ''}">
      <div class="card-thumbnail">
        ${thumbnail ? `<img src="${thumbnail}" alt="Thumbnail" referrerpolicy="no-referrer">` : `<div class="no-image">${isVideo ? '▶' : '📄'}</div>`}
      </div>
      <div class="card-info">
        <div class="card-title">${item.title}</div>
        <div class="card-meta">${new Date(item.publishedAt).toLocaleDateString()}</div>
      </div>
    </a>
  `;
}

export function renderDashboard(container) {
  // 대시보드 UI의 HTML과 CSS
  container.innerHTML = `
    <style>
      .dashboard-container { height: 100%; display: flex; flex-direction: column; }
      .dashboard-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 24px; overflow-y: auto; }
      .dashboard-col h2 { margin-top: 0; font-size: 18px; color: #333; padding-bottom: 10px; border-bottom: 1px solid #eee; }
      .content-list { display: flex; flex-direction: column; gap: 12px; }
      .content-card { display: flex; gap: 12px; background: #fff; border-radius: 8px; padding: 10px; text-decoration: none; color: inherit; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: box-shadow 0.2s, transform 0.2s; }
      .content-card:hover { box-shadow: 0 4px 10px rgba(0,0,0,0.12); transform: translateY(-2px); }
      .content-card.competitor { border-left: 4px solid #EA4335; padding-left: 8px;}
      .card-thumbnail { width: 80px; height: 60px; flex-shrink: 0; }
      .card-thumbnail img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; background: #f0f0f0; }
      .card-thumbnail .no-image { width: 100%; height: 100%; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #aaa; }
      .card-info { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
      .card-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .card-meta { font-size: 12px; color: #888; }
      .loading-placeholder { text-align: center; color: #888; margin-top: 40px; }
    </style>
    <div class="dashboard-container">
        <div class="dashboard-grid">
            <div class="dashboard-col">
                <h2>🚀 내 콘텐츠</h2>
                <div id="my-content-list" class="content-list"><p class="loading-placeholder">콘텐츠를 불러오는 중...</p></div>
            </div>
            <div class="dashboard-col">
                <h2>⚔️ 경쟁사 콘텐츠</h2>
                <div id="competitor-content-list" class="content-list"></div>
            </div>
        </div>
    </div>
  `;

  // background.js에 수집된 콘텐츠 데이터 요청
 chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
    // ▼▼▼ [핵심 수정] 데이터를 렌더링할 요소가 현재 DOM에 존재하는지 먼저 확인합니다. ▼▼▼
    const myContentList = document.getElementById('my-content-list');
    const competitorContentList = document.getElementById('competitor-content-list');

    // 두 요소가 모두 존재할 때만 아래 로직을 실행합니다.
    if (myContentList && competitorContentList) {
      myContentList.innerHTML = ''; // 로딩 메시지 제거

      if (response && response.success && response.data) {
        const allContent = response.data;
        allContent.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)); // 최신순 정렬
        
        let myContentCount = 0;
        let competitorContentCount = 0;

        allContent.forEach(item => {
          const cardHtml = createContentCard(item);
          if (item.channelType === 'myChannels') {
            myContentList.innerHTML += cardHtml;
            myContentCount++;
          } else {
            competitorContentList.innerHTML += cardHtml;
            competitorContentCount++;
          }
        });
        
        if(myContentCount === 0) myContentList.innerHTML = '<p class="loading-placeholder">표시할 콘텐츠가 없습니다.</p>';
        if(competitorContentCount === 0) competitorContentList.innerHTML = '<p class="loading-placeholder">표시할 콘텐츠가 없습니다.</p>';

      } else {
          myContentList.innerHTML = '<p class="loading-placeholder">콘텐츠를 불러오지 못했습니다.</p>';
          console.error("Failed to get channel content:", response?.error);
      }
    } else {
      // 사용자가 다른 뷰로 전환했으므로 아무 작업도 하지 않고 조용히 종료합니다.
      console.log("Dashboard view is not active. Skipping render.");
    }
  });
}