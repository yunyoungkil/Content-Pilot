// js/ui/dashboardMode.js (최종 수정본)

// 카드 UI를 만드는 템플릿 함수
// 카드 UI를 만드는 템플릿 함수
function createContentCard(item) {
    if (!item || !item.title) return '';
    const isVideo = !!item.videoId;
    const link = isVideo ? `https://www.youtube.com/watch?v=${item.videoId}` : item.link;
    const thumbnail = item.thumbnail || '';
    const date = item.publishedAt && !isNaN(Number(item.publishedAt)) ? new Date(Number(item.publishedAt)) : null;
    const dateString = date ? date.toLocaleDateString() : '날짜 정보 없음';

    return `
        <a href="${link}" target="_blank" class="content-card">
            <div class="card-thumbnail">
                ${thumbnail ? `<img src="${thumbnail}" alt="Thumbnail" referrerpolicy="no-referrer">` : `<div class="no-image">${isVideo ? '▶' : '📄'}</div>`}
            </div>
            <div class="card-info">
                <div class="card-title">${item.title}</div>
                <div class="card-meta">${dateString}</div>
            </div>
        </a>
    `;
}

// 특정 채널의 콘텐츠 목록을 화면에 그리는 함수
function renderContentForChannel(containerId, sourceId, allContent) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const filteredContent = allContent.filter(item => item.sourceId === sourceId);
    filteredContent.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

    if (filteredContent.length > 0) {
        container.innerHTML = filteredContent.map(createContentCard).join('');
    } else {
        container.innerHTML = '<p class="loading-placeholder">표시할 콘텐츠가 없습니다.</p>';
    }
}

// 플랫폼 탭과 채널 선택 메뉴를 데이터에 맞게 업데이트하는 함수
function updateSelectors(container, allContent, metas, channels) {
    ['myChannels', 'competitorChannels'].forEach(type => {
        const platformTabs = container.querySelector(`.platform-tabs[data-type="${type}"]`);
        const selectElement = container.querySelector(`#${type}-select`);
        const contentListElement = container.querySelector(`#${type}-content-list`);
        
        if (!platformTabs || !selectElement || !contentListElement) return;

        const selectedPlatform = platformTabs.querySelector('.active').dataset.platform;
        const sourceUrls = channels[type]?.[selectedPlatform === 'blog' ? 'blogs' : 'youtubes'] || [];
        const sourceIds = sourceUrls.map(source => selectedPlatform === 'blog' ? btoa(source).replace(/=/g, '') : source);

        if (sourceIds.length > 0) {
            selectElement.style.display = 'block';
            selectElement.innerHTML = sourceIds.map(id => `<option value="${id}">${metas[id]?.title || id}</option>`).join('');
            renderContentForChannel(`${type}-content-list`, selectElement.value, allContent);
        } else {
            selectElement.style.display = 'none';
            contentListElement.innerHTML = `<p class="loading-placeholder">연동된 ${selectedPlatform === 'blog' ? '블로그' : '유튜브'} 채널이 없습니다.</p>`;
        }
    });
}

// 대시보드 메인 렌더링 함수
export function renderDashboard(container) {
    container.innerHTML = `
        <style>
            .dashboard-container { height: 100%; display: flex; flex-direction: column; }
            .dashboard-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 24px; overflow-y: auto; align-content: start; }
            .dashboard-col h2 { margin-top: 0; font-size: 18px; color: #333; }
            .platform-tabs { display: flex; gap: 8px; margin: 10px 0; border-bottom: 2px solid #eee; }
            .platform-tab { padding: 8px 12px; cursor: pointer; color: #888; font-weight: 600; border-bottom: 2px solid transparent; }
            .platform-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
            .channel-selector { width: 100%; padding: 8px; font-size: 14px; border-radius: 6px; border: 1px solid #ccc; margin-bottom: 15px; }
            .content-list { display: flex; flex-direction: column; gap: 12px; }
            .content-card { display: flex; gap: 12px; background: #fff; border-radius: 8px; padding: 10px; text-decoration: none; color: inherit; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: box-shadow 0.2s, transform 0.2s; }
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
                <div id="my-channels-col" class="dashboard-col">
                    <h2>🚀 내 콘텐츠</h2>
                    <div class="platform-tabs" data-type="myChannels">
                        <div class="platform-tab active" data-platform="blog">블로그</div>
                        <div class="platform-tab" data-platform="youtube">유튜브</div>
                    </div>
                    <select id="myChannels-select" class="channel-selector" style="display: none;"></select>
                    <div id="myChannels-content-list" class="content-list"><p class="loading-placeholder">채널 정보를 불러오는 중...</p></div>
                </div>
                <div id="competitor-channels-col" class="dashboard-col">
                    <h2>⚔️ 경쟁사 콘텐츠</h2>
                    <div class="platform-tabs" data-type="competitorChannels">
                        <div class="platform-tab active" data-platform="blog">블로그</div>
                        <div class="platform-tab" data-platform="youtube">유튜브</div>
                    </div>
                    <select id="competitorChannels-select" class="channel-selector" style="display: none;"></select>
                    <div id="competitorChannels-content-list" class="content-list"></div>
                </div>
            </div>
        </div>
    `;

    let cachedData = null;

    // 이벤트 리스너를 먼저 설정합니다.
    container.querySelectorAll('.platform-tabs').forEach(tabGroup => {
        tabGroup.addEventListener('click', e => {
            if (e.target.classList.contains('platform-tab') && !e.target.classList.contains('active') && cachedData) {
                tabGroup.querySelector('.active').classList.remove('active');
                e.target.classList.add('active');
                updateSelectors(container, cachedData.content, cachedData.metas, cachedData.channels);
            }
        });
    });

    container.querySelectorAll('.channel-selector').forEach(selector => {
        selector.addEventListener('change', e => {
            if (cachedData) {
                const type = selector.id.includes('myChannels') ? 'myChannels' : 'competitorChannels';
                renderContentForChannel(`${type}-content-list`, e.target.value, cachedData.content);
            }
        });
    });

    // 데이터 요청 및 UI 업데이트
    chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
        // ▼▼▼ [핵심 수정] UI가 여전히 대시보드 뷰인지 확인 ▼▼▼
        const dashboardGrid = container.querySelector('.dashboard-grid');
        if (!dashboardGrid) {
            console.log("Dashboard view is not active. Skipping update.");
            return;
        }

        if (!response || !response.success) {
            console.error("Failed to get channel content:", response?.error);
            container.querySelector('#myChannels-content-list').innerHTML = '<p class="loading-placeholder">콘텐츠를 불러오지 못했습니다.</p>';
            return;
        }

        cachedData = response.data; // 받아온 데이터를 캐싱
        updateSelectors(container, cachedData.content, cachedData.metas, cachedData.channels);
    });
}