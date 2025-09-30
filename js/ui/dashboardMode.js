// js/ui/dashboardMode.js (수정 완료)

// --- 상태 관리 변수 ---
let cachedData = null; // 데이터 캐싱
const ITEMS_PER_PAGE = 5;

// 각 목록의 정렬 기준과 페이지를 독립적으로 관리하는 객체
let viewState = {
    myChannels: { sortOrder: 'pubDate', currentPage: 0 },
    competitorChannels: { sortOrder: 'pubDate', currentPage: 0 }
};

// --- UI 렌더링 함수 ---

function createContentCard(item, type) {
    if (!item || !item.title) return '';
    const isVideo = !!item.videoId;
    const link = isVideo ? `https://www.youtube.com/watch?v=${item.videoId}` : item.link;
    const thumbnail = item.thumbnail || '';
    
    const dateSource = item.publishedAt || item.pubDate;
    const date = dateSource && !isNaN(Number(dateSource)) ? new Date(Number(dateSource)) : null;
    const dateString = date ? date.toLocaleDateString() : '날짜 정보 없음';
    
    const metrics = isVideo ? `
        <div class="card-metrics">
            <span>조회수: ${item.viewCount || 0}</span>
            <span>좋아요: ${item.likeCount || 0}</span>
            <span>댓글: ${item.commentCount || 0}</span>
        </div>
    ` : '';
    
    const commentAnalysisButton = isVideo ? `<button class="comment-analyze-btn" data-video-id="${item.videoId}">댓글 분석 💡</button>` : '';

    return `
        <a href="${link}" target="_blank" class="content-card">
            <div class="card-thumbnail">
                ${thumbnail ? `<img src="${thumbnail}" alt="Thumbnail" referrerpolicy="no-referrer">` : `<div class="no-image">${isVideo ? '▶' : '📄'}</div>`}
            </div>
            <div class="card-info">
                <div class="card-title">${item.title}</div>
                <div class="card-meta">${dateString}</div>
                ${metrics}
            </div>
            ${commentAnalysisButton}
        </a>
    `;
}

// 콘텐츠 목록을 그리는 통합 렌더링 함수
function renderContentForType(container, sourceId, allContent, type, platform) {
    if (platform === 'youtube') {
        renderKeyContent(container, sourceId, allContent, type);
    } else {
        renderBlogContent(container, sourceId, allContent, type);
    }
}

// 유튜브 콘텐츠 (정렬, 페이징 기능 포함)
function renderKeyContent(container, sourceId, allContent, type) {
    const state = viewState[type];
    const filteredContent = allContent.filter(item => item.sourceId === sourceId && item.videoId);
    
    // 유튜브는 publishedAt 기준으로 정렬
    const sortKey = state.sortOrder === 'pubDate' ? 'publishedAt' : state.sortOrder;
    filteredContent.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

    const totalPages = Math.ceil(filteredContent.length / ITEMS_PER_PAGE);
    if (state.currentPage >= totalPages && totalPages > 0) state.currentPage = totalPages - 1;
    if (state.currentPage < 0) state.currentPage = 0;

    const startIndex = state.currentPage * ITEMS_PER_PAGE;
    const paginatedContent = filteredContent.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    if (paginatedContent.length > 0) {
        container.innerHTML = `
            <div class="top5-controls">
                <select class="top5-sort-select" data-type="${type}">
                    <option value="pubDate" ${state.sortOrder === 'pubDate' ? 'selected' : ''}>최신 순</option>
                    <option value="viewCount" ${state.sortOrder === 'viewCount' ? 'selected' : ''}>조회수 높은 순</option>
                    <option value="likeCount" ${state.sortOrder === 'likeCount' ? 'selected' : ''}>좋아요 높은 순</option>
                    <option value="commentCount" ${state.sortOrder === 'commentCount' ? 'selected' : ''}>댓글 많은 순</option>
                </select>
                <div class="top5-pagination">
                    <button class="pagination-btn" data-direction="prev" ${state.currentPage === 0 ? 'disabled' : ''}>&lt;</button>
                    <span>${state.currentPage + 1} / ${totalPages}</span>
                    <button class="pagination-btn" data-direction="next" ${state.currentPage >= totalPages - 1 ? 'disabled' : ''}>&gt;</button>
                </div>
            </div>
            <div class="content-list">${paginatedContent.map(item => createContentCard(item, type)).join('')}</div>
        `;
    } else {
        container.innerHTML = '<p class="loading-placeholder">표시할 유튜브 영상이 없습니다.</p>';
    }
}

// 블로그 콘텐츠 (단순 목록, 정렬 기준 수정)
function renderBlogContent(container, sourceId, allContent, type) {
    const filteredContent = allContent.filter(item => item.sourceId === sourceId && !item.videoId);
    // [버그 수정] 블로그는 pubDate 기준으로 정렬
    filteredContent.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
    
    if (filteredContent.length > 0) {
        container.innerHTML = `<div class="content-list">${filteredContent.map(item => createContentCard(item, type)).join('')}</div>`;
    } else {
        container.innerHTML = '<p class="loading-placeholder">표시할 블로그 게시물이 없습니다.</p>';
    }
}

// UI 업데이트 통합 함수 (데이터 구조 처리 로직 수정)
function updateDashboardUI(container) {
    if (!cachedData) return;
    
    ['myChannels', 'competitorChannels'].forEach(type => {
        const platformTabs = container.querySelector(`.platform-tabs[data-type="${type}"]`);
        const selectElement = container.querySelector(`#${type}-select`);
        const contentListElement = container.querySelector(`#${type}-content-list`);
        const analyzeButtonsWrapper = container.querySelector(`#myChannels-analyze-buttons`);

        if (!platformTabs || !selectElement || !contentListElement) return;

        const selectedPlatform = platformTabs.querySelector('.active').dataset.platform;
        const platformKey = selectedPlatform === 'blog' ? 'blogs' : 'youtubes';
        
        // [수정] 채널 '객체' 배열 가져오기
        const channelObjects = cachedData.channels[type]?.[platformKey] || [];

        const header = container.querySelector(`#${type}-col .dashboard-col-header`);
        if (header) { // 헤더 업데이트 로직은 항상 실행하도록 개선
            const currentSourceId = selectElement.value;
            const meta = cachedData.metas[currentSourceId];
            if (meta && meta.fetchedAt) {
                const now = Date.now();
                const fetchedAt = meta.fetchedAt;
                const minutesAgo = Math.floor((now - fetchedAt) / 60000);
                const updateInfoHtml = `
                    <div style="font-size: 12px; color: #888; display: flex; align-items: center; gap: 4px;">
                        <span>업데이트: ${minutesAgo}분 전</span>
                        <button class="refresh-btn" data-type="${type}" data-platform="${selectedPlatform}" data-source-id="${currentSourceId}" style="background:none; border:none; color:#1a73e8; cursor:pointer; padding:0; font-size: 12px; line-height: 1;">↻</button>
                    </div>
                `;
                let existingInfo = header.querySelector('.refresh-btn')?.parentElement;
                if(existingInfo) {
                    existingInfo.innerHTML = `
                        <span>업데이트: ${minutesAgo}분 전</span>
                        <button class="refresh-btn" data-type="${type}" data-platform="${selectedPlatform}" data-source-id="${currentSourceId}" style="background:none; border:none; color:#1a73e8; cursor:pointer; padding:0; font-size: 12px; line-height: 1;">↻</button>
                    `;
                } else {
                    const infoWrapper = document.createElement('div');
                    infoWrapper.innerHTML = updateInfoHtml;
                    header.appendChild(infoWrapper.firstElementChild);
                }
            }
        }

        if (type === 'myChannels' && analyzeButtonsWrapper) {
            analyzeButtonsWrapper.style.display = (selectedPlatform === 'youtube' && channelObjects.length > 0) ? 'flex' : 'none';
        }

        if (channelObjects.length > 0) {
            selectElement.style.display = 'block';
            
            // [수정] 채널 객체 배열을 순회하며 <option> 생성
            selectElement.innerHTML = channelObjects.map(channel => {
                const id = selectedPlatform === 'blog' ? btoa(channel.apiUrl).replace(/=/g, '') : channel.apiUrl;
                const title = cachedData.metas[id]?.title || channel.inputUrl; // 제목 없으면 inputUrl 사용
                return `<option value="${id}">${title}</option>`;
            }).join('');

            // 올바르게 생성된 selectElement의 현재 값으로 콘텐츠 렌더링
            renderContentForType(contentListElement, selectElement.value, cachedData.content, type, selectedPlatform);
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
            .dashboard-col-header { display: flex; justify-content: space-between; align-items: center; }
            .dashboard-col h2 { margin-top: 0; font-size: 18px; color: #333; }
            .analyze-buttons-wrapper { display: none; gap: 8px; }
            .analyze-btn { background: #1a73e8; color: white; border: none; padding: 6px 12px; border-radius: 5px; font-size: 13px; font-weight: 600; cursor: pointer; }
            .platform-tabs { display: flex; gap: 8px; margin: 10px 0; border-bottom: 2px solid #eee; }
            .platform-tab { padding: 8px 12px; cursor: pointer; color: #888; font-weight: 600; border-bottom: 2px solid transparent; }
            .platform-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
            .channel-selector { width: 100%; padding: 8px; font-size: 14px; border-radius: 6px; border: 1px solid #ccc; margin-bottom: 15px; }
            .content-list { display: flex; flex-direction: column; gap: 12px; }
            .content-card-wrapper { position: relative; }
            .content-card { display: flex; gap: 12px; background: #fff; border-radius: 8px; padding: 10px; text-decoration: none; color: inherit; box-shadow: 0 1px 3px rgba(0,0,0,0.08); width: 100%; box-sizing: border-box; height: 110px; }
            .comment-analyze-btn { position: absolute; bottom: 10px; right: 10px; background: #34A853; color: white; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; opacity: 0; transform: translateY(5px); transition: all 0.2s ease-out; z-index: 2; }

            .content-card {
                position: relative;
                display: flex;
                align-items: center;
                gap: 12px;
                background: #fff;
                border-radius: 8px;
                padding: 10px;
                text-decoration: none;
                color: inherit;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                width: 100%;
                box-sizing: border-box;
                height: 110px;
                overflow: hidden; 
                opacity: 1;
                transform: translateY(0);
            }
            .content-card:hover .comment-analyze-btn {
                opacity: 1;
                transform: translateY(0);
            }
            .card-thumbnail {
                width: 100px;
                height: 80px;
                flex-shrink: 0;
            }
            .card-thumbnail img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 4px;
                background: #f0f0f0;
            }
            .card-info {
                flex: 1;
                min-width: 0;
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            .card-title {
                font-weight: 600;
                font-size: 15px;
                line-height: 1.4;
                flex-grow: 1;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
                word-break: break-all;
            }
            .card-meta {
                font-size: 12px;
                color: #888;
                margin-top: 4px;
            }
            .card-metrics {
                font-size: 11px;
                color: #555;
                display: flex;
                gap: 8px;
                margin-top: 4px;
                flex-wrap: wrap;
            }

            .loading-placeholder { text-align: center; color: #888; margin-top: 40px; }
            .ai-ideas-section { grid-column: 1 / 3; background: #fff; border-radius: 8px; padding: 20px 24px; margin-top: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
            .top5-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
            .top5-sort-select { padding: 6px; font-size: 13px; border-radius: 4px; border: 1px solid #ccc; }
            .top5-pagination { display: flex; align-items: center; gap: 8px; }
            .pagination-btn { background: #f1f3f5; border: 1px solid #ddd; border-radius: 4px; width: 28px; height: 28px; cursor: pointer; }
            .pagination-btn:disabled { cursor: not-allowed; opacity: 0.5; }
        </style>
        <div class="dashboard-container">
            <div class="dashboard-grid">
                <div id="my-channels-col" class="dashboard-col">
                    <div class="dashboard-col-header">
                        <h2>🚀 내 주요 콘텐츠</h2>
                        <div id="myChannels-analyze-buttons" class="analyze-buttons-wrapper">
                            <button id="myChannels-analyze-btn" class="analyze-btn">성과 분석</button>
                            <button id="competitor-compare-btn" class="analyze-btn">경쟁 비교 분석</button>
                        </div>
                    </div>
                    <div class="platform-tabs" data-type="myChannels">
                        <div class="platform-tab active" data-platform="youtube">유튜브</div>
                        <div class="platform-tab" data-platform="blog">블로그</div>
                    </div>
                    <select id="myChannels-select" class="channel-selector" style="display: none;"></select>
                    <div id="myChannels-content-list" class="content-list"><p class="loading-placeholder">채널 정보를 불러오는 중...</p></div>
                </div>
                <div id="competitor-channels-col" class="dashboard-col">
                    <div class="dashboard-col-header">
                        <h2>⚔️ 경쟁사 주요 콘텐츠</h2>
                    </div>
                    <div class="platform-tabs" data-type="competitorChannels">
                        <div class="platform-tab active" data-platform="youtube">유튜브</div>
                        <div class="platform-tab" data-platform="blog">블로그</div>
                    </div>
                    <select id="competitorChannels-select" class="channel-selector" style="display: none;"></select>
                    <div id="competitorChannels-content-list" class="content-list"></div>
                </div>
                <div class="ai-ideas-section">
                    <h2>✨ AI 콘텐츠 아이디어 제안</h2>
                    <div id="ai-ideas-content"><p class="ai-ideas-placeholder">분석을 실행하여 새로운 아이디어를 얻어보세요.</p></div>
                </div>
            </div>
        </div>
    `;

    addDashboardEventListeners(container);

    chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
        const dashboardGrid = container.querySelector('.dashboard-grid');
        if (!dashboardGrid) return;
        if (!response || !response.success) {
            container.querySelectorAll('.content-list').forEach(list => list.innerHTML = '<p class="loading-placeholder">콘텐츠를 불러오지 못했습니다.</p>');
            return;
        }
        cachedData = response.data;
        updateDashboardUI(container);
    });
}

// 이벤트 리스너를 한 곳에서 관리
function addDashboardEventListeners(container) {
    if (container.dataset.listenersAttached) return;
    container.dataset.listenersAttached = 'true';

    container.addEventListener('click', e => {
        const target = e.target;
        const ideasContent = container.querySelector('#ai-ideas-content');

        if (target.closest('.platform-tab') && !target.classList.contains('active')) {
            const tab = target.closest('.platform-tab');
            const tabGroup = tab.parentElement;
            tabGroup.querySelector('.active').classList.remove('active');
            tab.classList.add('active');
            const type = tabGroup.dataset.type;
            viewState[type] = { sortOrder: 'pubDate', currentPage: 0 };
            updateDashboardUI(container);
            return;
        }

        if (target.closest('.pagination-btn')) {
            const btn = target.closest('.pagination-btn');
            const col = btn.closest('.dashboard-col');
            const type = col.id.includes('myChannels') ? 'myChannels' : 'competitorChannels';
            const direction = btn.dataset.direction;
            if (direction === 'prev') viewState[type].currentPage--;
            if (direction === 'next') viewState[type].currentPage++;
            const contentListElement = col.querySelector('.content-list');
            const sourceId = col.querySelector('.channel-selector').value;
            const platform = col.querySelector('.platform-tab.active').dataset.platform;
            renderContentForType(contentListElement, sourceId, cachedData.content, type, platform);
            return;
        }

        if (target.closest('.comment-analyze-btn')) {
            e.preventDefault();
            const btn = target.closest('.comment-analyze-btn');
            const videoId = btn.dataset.videoId;
            if (!videoId) return;
            ideasContent.innerHTML = `<p class="ai-ideas-placeholder">"${videoId}" 영상의 댓글을 분석 중입니다... 🕵️‍♂️</p>`;
            chrome.runtime.sendMessage({ action: 'analyze_video_comments', videoId: videoId }, response => {
                if (response && response.success) {
                    const formattedHtml = response.analysis.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/### (.*?)/g, '<h3>$1</h3>').replace(/\* (.*?)(<br>|$)/g, '<li>$1</li>');
                    ideasContent.innerHTML = `<ul class="ai-ideas-list">${formattedHtml}</ul>`;
                } else {
                    ideasContent.innerHTML = `<p class="ai-ideas-placeholder">댓글 분석 중 오류가 발생했습니다: ${response.error || '알 수 없는 오류'}</p>`;
                }
            });
            return;
        }
        
        if (target.closest('#myChannels-analyze-btn')) {
            if (!cachedData) return;
            const selectedChannelId = container.querySelector('#myChannels-select').value;
            const channelContent = cachedData.content.filter(item => item.sourceId === selectedChannelId && item.videoId);
            
            if (channelContent.length > 0) {
                const ideasContent = container.querySelector('#ai-ideas-content');
                ideasContent.innerHTML = `<p class="ai-ideas-placeholder">AI가 채널 성과를 분석하는 중... 📈</p>`;

                chrome.runtime.sendMessage({ action: 'analyze_my_channel', data: channelContent }, (response) => {
                    if (response && response.success) {
                        const formattedHtml = response.analysis
                            .replace(/\n/g, '<br>')
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/### (.*?)/g, '<h3>$1</h3>')
                            .replace(/\* (.*?)(<br>|$)/g, '<li>$1</li>');
                        
                        container.querySelector('.ai-ideas-section h2').textContent = '✨ AI 채널 성과 분석';
                        ideasContent.innerHTML = `<ul class="ai-ideas-list">${formattedHtml}</ul>`;
                    } else {
                        ideasContent.innerHTML = `<p class="ai-ideas-placeholder">성과 분석 중 오류가 발생했습니다.</p>`;
                    }
                });
            } else {
                alert("분석할 유튜브 영상 데이터가 없습니다.");
            }
            return;
        }
        
        if (target.closest('#competitor-compare-btn')) {
            if (!cachedData) return;
            const myChannelId = container.querySelector('#myChannels-select').value;
            const competitorChannelId = container.querySelector('#competitorChannels-select').value;

            if (!myChannelId || !competitorChannelId) {
                alert("내 채널과 경쟁 채널을 모두 선택해주세요.");
                return;
            }
            const myContent = cachedData.content.filter(item => item.sourceId === myChannelId && item.videoId);
            const competitorContent = cachedData.content.filter(item => item.sourceId === competitorChannelId && item.videoId);

            if (myContent.length === 0 || competitorContent.length === 0) {
                alert("분석을 위해 내 채널과 경쟁 채널 모두에 영상 데이터가 필요합니다.");
                return;
            }
            ideasContent.innerHTML = '<p class="ai-ideas-placeholder">AI가 아이디어를 생성하는 중... 🧠</p>';
            chrome.runtime.sendMessage({
                action: 'generate_content_ideas',
                data: { myContent, competitorContent }
            }, (response) => {
                if (response && response.success) {
                    const formattedHtml = response.ideas.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/### (.*?)/g, '<h3>$1</h3>').replace(/\* (.*?)(<br>|$)/g, '<li>$1</li>');
                    ideasContent.innerHTML = `<ul class="ai-ideas-list">${formattedHtml}</ul>`;
                } else {
                    ideasContent.innerHTML = '<p class="ai-ideas-placeholder">아이디어 생성 중 오류가 발생했습니다.</p>';
                }
            });
            return;
        }

        if (target.closest('.refresh-btn')) {
            e.preventDefault();
            const btn = target.closest('.refresh-btn');
            const type = btn.dataset.type;
            const platform = btn.dataset.platform;
            const sourceId = btn.dataset.sourceId;

            const col = btn.closest('.dashboard-col');
            const contentListElement = col.querySelector('.content-list');
            contentListElement.innerHTML = `<p class="loading-placeholder">데이터를 새로고침 중입니다... 잠시만 기다려주세요.</p>`;
            
            chrome.runtime.sendMessage({ 
                action: 'refresh_channel_data', 
                sourceId: sourceId,
                platform: platform 
            }, (response) => {
                if (response && response.success) {
                    setTimeout(() => {
                        chrome.runtime.sendMessage({ action: 'get_channel_content' }, (newResponse) => {
                            if (newResponse && newResponse.success) {
                                cachedData = newResponse.data;
                                updateDashboardUI(container);
                            } else {
                                contentListElement.innerHTML = `<p class="loading-placeholder">새로고침된 데이터를 불러오지 못했습니다.</p>`;
                            }
                        });
                    }, 1500);
                } else {
                    alert(`새로고침 실패: ${response.error || '백그라운드 오류'}`);
                    updateDashboardUI(container);
                }
            });
            return;
        }

    });

    container.addEventListener('change', e => {
        const target = e.target;

        if (target.classList.contains('channel-selector')) {
            const col = target.closest('.dashboard-col');
            const type = col.id.includes('myChannels') ? 'myChannels' : 'competitorChannels';
            
            viewState[type] = { sortOrder: 'pubDate', currentPage: 0 };
            
            const contentListElement = col.querySelector('.content-list');
            const sourceId = target.value;
            const platform = col.querySelector('.platform-tab.active').dataset.platform;
            renderContentForType(contentListElement, sourceId, cachedData.content, type, platform);
            return;
        }

        if (target.classList.contains('top5-sort-select')) {
            const col = target.closest('.dashboard-col');
            const type = col.id.includes('myChannels') ? 'myChannels' : 'competitorChannels';
            
            viewState[type].sortOrder = target.value;
            viewState[type].currentPage = 0;

            const contentListElement = col.querySelector('.content-list');
            const sourceId = col.querySelector('.channel-selector').value;
            const platform = col.querySelector('.platform-tab.active').dataset.platform;
            renderContentForType(contentListElement, sourceId, cachedData.content, type, platform);
            return;
        }
    });
}