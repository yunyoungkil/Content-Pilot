// js/ui/dashboardMode.js (수정 완료)

// --- 상태 관리 변수 ---
let cachedData = null; // 데이터 캐싱
const ITEMS_PER_PAGE = 10;

// 각 목록의 정렬 기준과 페이지를 독립적으로 관리하는 객체
let viewState = {
    myChannels: { sortOrder: 'pubDate', currentPage: 0 },
    competitorChannels: { sortOrder: 'pubDate', currentPage: 0 }
};

// --- UI 렌더링 함수 ---

function createContentCard(item, type) {
    console.log('createContentCard에 전달된 item:', item);
    if (!item || !item.title) return '';
    const isVideo = !!item.videoId;
    const link = isVideo ? `https://www.youtube.com/watch?v=${item.videoId}` : item.fullLink || item.link || '#';
    const thumbnail = item.thumbnail || '';

    // ▼▼▼ [핵심 수정] 제목이 40자를 초과하면 잘라내고 "..."를 붙입니다. ▼▼▼
    const title = item.title.length > 40
        ? `${item.title.substring(0, 40)} ...` 
        : item.title;


    const dateSource = item.publishedAt || item.pubDate;
    const date = dateSource && !isNaN(Number(dateSource)) ? new Date(Number(dateSource)) : null;
    const dateString = date ? date.toLocaleDateString() : '날짜 정보 없음';

    let tagsContent = '';
    if (item.tags === undefined) {
        // 1. 아직 추출 시도 전
        tagsContent = `<span class="tag-placeholder">태그 분석 예정...</span>`;
    } else if (item.tags === null) {
        // 2. 추출 실패
        tagsContent = `<span class="tag-placeholder error">태그 분석 실패 (API 오류)</span>`;
    } else if (Array.isArray(item.tags) && item.tags.length > 0) {
        // 3. 추출 성공 및 태그 있음
        tagsContent = item.tags.map(tag => `<span class="tag">#${tag}</span>`).join('');
    } else {
        // 4. 추출 성공했으나 관련 태그 없음
        tagsContent = `<span class="tag-placeholder">관련 태그 없음</span>`;
    }
    
    const tagsHtml = `<div class="card-tags">${tagsContent}</div>`;

    let imagesPreviewHtml = '';
    if (item.allImages) {
        // 1. 객체를 실제 배열로 변환합니다.
        const imagesArray = Array.isArray(item.allImages) ? item.allImages : Object.values(item.allImages);

        if (imagesArray.length > 0) {
            imagesPreviewHtml = `
                <div class="card-images-preview">
                    ${imagesArray.slice(0, 4).map(image => `
                        <img src="${image.src}" alt="${image.alt}" class="preview-img" loading="lazy" 
                             onerror="this.style.display='none'">
                    `).join('')}
                </div>
            `;
        }
    }

    let metricsSpans = '';
    if (isVideo) {
        metricsSpans = `
             <span class="card-metric-item">조회수: ${item.viewCount || 0}</span>
            <span class="card-metric-item">좋아요: ${item.likeCount || 0}</span>
            <span class="card-metric-item">댓글: ${item.commentCount || 0}</span>
        `;
    } else { // 블로그 게시물일 경우
        // ▼▼▼ [핵심 수정] 초 단위를 'X분 Y초' 형식으로 변환합니다. ▼▼▼
        const totalSeconds = item.readTimeInSeconds || 0;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        let readTimeText = '';
        if (minutes > 0) {
            readTimeText += `${minutes}분 `;
        }
        // 초가 0보다 크거나, 분이 0일 때만 초를 표시합니다. (예: 0분 36초 -> 36초)
        if (seconds > 0 || minutes === 0) {
            readTimeText += `${seconds}초`;
        }
        readTimeText = readTimeText.trim();
        if (readTimeText === '') readTimeText = '1초 미만';

        const readTimeFullText = `약 ${readTimeText} (${(item.textLength || 0).toLocaleString()}자)`;
        const videoIcon = item.hasVideo ? `<span class="card-metric-item">동영상: 포함</span>` : '';
        
        metricsSpans = `
            <span class="card-metric-item">시간: ${readTimeFullText}</span>
            <span class="card-metric-item">좋아요: ${item.likeCount || 0}</span>
            <span class="card-metric-item">댓글: ${item.commentCount || 0}</span>
            <span class="card-metric-item">링크: ${item.linkCount || 0}</span>
            <span class="card-metric-item">이미지: ${item.imageCount || 0}</span>
            ${videoIcon}
        `;
        // ▲▲▲ 수정 완료 ▲▲▲
    }
    
    const commentAnalysisButton = isVideo ? `<button class="comment-analyze-btn" data-video-id="${item.videoId}">댓글 분석 💡</button>` : '';

    return `
        <a href="${link}" target="_blank" class="content-card">
            <div class="card-thumbnail">
                ${thumbnail ? `<img src="${thumbnail}" alt="Thumbnail" referrerpolicy="no-referrer">` : `<div class="no-image">${isVideo ? '▶' : '📄'}</div>`}
            </div>
            <div class="card-info">
                <div class="card-title">${title}</div>
                ${tagsHtml}
                ${imagesPreviewHtml}
                <div class="card-footer">
                    <span class="card-meta">${dateString}</span>
                    ${metricsSpans}
                </div>
            </div>
            ${commentAnalysisButton}
        </a>
    `;
}


function renderPaginatedContent(container, sourceId, allContent, type, platform) {
    const state = viewState[type];
    const isVideo = platform === 'youtube';

    const filteredContent = allContent.filter(item => {
        return item.sourceId === sourceId && (isVideo ? !!item.videoId : !item.videoId);
    });
    
    const sortKey = state.sortOrder;
    filteredContent.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

    const totalPages = Math.ceil(filteredContent.length / ITEMS_PER_PAGE);
    if (state.currentPage >= totalPages && totalPages > 0) state.currentPage = totalPages - 1;
    if (state.currentPage < 0) state.currentPage = 0;

    const startIndex = state.currentPage * ITEMS_PER_PAGE;
    const paginatedContent = filteredContent.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const sortOptions = isVideo ? `
        <option value="publishedAt" ${sortKey === 'publishedAt' ? 'selected' : ''}>최신 순</option>
        <option value="viewCount" ${sortKey === 'viewCount' ? 'selected' : ''}>조회수 높은 순</option>
        <option value="likeCount" ${sortKey === 'likeCount' ? 'selected' : ''}>좋아요 높은 순</option>
        <option value="commentCount" ${sortKey === 'commentCount' ? 'selected' : ''}>댓글 많은 순</option>
    ` : `
        <option value="pubDate" ${sortKey === 'pubDate' ? 'selected' : ''}>최신 순</option>
        <option value="commentCount" ${sortKey === 'commentCount' ? 'selected' : ''}>댓글 많은 순</option>
        <option value="likeCount" ${sortKey === 'likeCount' ? 'selected' : ''}>좋아요 높은 순</option>
        <option value="textLength" ${sortKey === 'textLength' ? 'selected' : ''}>분량 많은 순</option>
    `;

    if (paginatedContent.length > 0) {
        container.innerHTML = `
            <div class="top5-controls">
                <select class="top5-sort-select" data-type="${type}">
                    ${sortOptions}
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
        container.innerHTML = `<p class="loading-placeholder">표시할 ${isVideo ? '유튜브 영상이' : '블로그 게시물이'} 없습니다.</p>`;
    }
}

// UI 업데이트 통합 함수
function updateDashboardUI(container) {
    if (!cachedData) return;
    
    ['myChannels', 'competitorChannels'].forEach(type => {
        const platformTabs = container.querySelector(`.platform-tabs[data-type="${type}"]`);
        const selectElement = container.querySelector(`#${type}-select`);
        const contentListElement = container.querySelector(`#${type}-content-list`);
        if (!platformTabs || !selectElement || !contentListElement) return;

        const selectedPlatform = platformTabs.querySelector('.active').dataset.platform;
        const platformKey = selectedPlatform === 'blog' ? 'blogs' : 'youtubes';
        
        let channelObjects = cachedData.channels[type]?.[platformKey] || [];
        if (!Array.isArray(channelObjects) && typeof channelObjects === 'object') {
            channelObjects = Object.values(channelObjects);
        }

        if (channelObjects.length > 0) {
            selectElement.style.display = 'block';
            const currentSelection = selectElement.value;
            
            selectElement.innerHTML = channelObjects.map(channel => {
                const id = selectedPlatform === 'blog' ? btoa(channel.apiUrl).replace(/=/g, '') : channel.apiUrl;
                const title = cachedData.metas[id]?.title || channel.inputUrl;
                return `<option value="${id}" ${id === currentSelection ? 'selected' : ''}>${title}</option>`;
            }).join('');
            
            // [수정] 분리되었던 함수 호출을 통합된 함수 호출로 변경
            renderPaginatedContent(contentListElement, selectElement.value, cachedData.content, type, selectedPlatform);
        } else {
            selectElement.style.display = 'none';
            contentListElement.innerHTML = `<p class="loading-placeholder">연동된 ${selectedPlatform === 'blog' ? '블로그' : '유튜브'} 채널이 없습니다.</p>`;
        }
    });
}

// 대시보드 메인 렌더링 함수
export function renderDashboard(container) {
    container.innerHTML = `
        <div class="dashboard-container">
            <div class="dashboard-grid">
                <div id="my-channels-col" class="dashboard-col">
                    <div class="dashboard-col-header">
                        <h2>🚀 내 주요 콘텐츠</h2>
                        <div class="loading-indicator" id="myChannels-loading" style="display: none;">
                            <span>수집 중...</span>
                        </div>
                        <div id="myChannels-analyze-buttons" class="analyze-buttons-wrapper">
                            <button id="myChannels-analyze-btn" class="analyze-btn">성과 분석</button>
                            <button id="competitor-compare-btn" class="analyze-btn">경쟁 비교 분석</button>
                        </div>
                    </div>
                    <div class="platform-tabs" data-type="myChannels">
                        <div class="platform-tab" data-platform="blog">블로그</div>
                        <div class="platform-tab active" data-platform="youtube">유튜브</div>

                    </div>
                    <select id="myChannels-select" class="channel-selector" style="display: none;"></select>
                    <div id="myChannels-content-list" class="content-list"><p class="loading-placeholder">채널 정보를 불러오는 중...</p></div>
                </div>
                <div id="competitor-channels-col" class="dashboard-col">
                    <div class="dashboard-col-header">
                        <h2>⚔️ 경쟁사 주요 콘텐츠</h2>
                    </div>
                    <div class="platform-tabs" data-type="competitorChannels">
                        <div class="platform-tab" data-platform="blog">블로그</div>
                        <div class="platform-tab active" data-platform="youtube">유튜브</div>
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

    // ▼▼▼ [추가] 백그라운드로부터 데이터 새로고침 메시지를 수신하는 리스너 ▼▼▼
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'cp_data_refreshed') {
            // 대시보드 UI가 현재 화면에 보이는 경우에만 데이터를 다시 불러옵니다.
            const dashboardGrid = container.querySelector('.dashboard-grid');
            if (dashboardGrid) {
                console.log("대시보드: 백그라운드로부터 데이터 새로고침 신호를 수신했습니다. UI를 업데이트합니다.");
                
                // 데이터를 다시 요청하고 UI를 새로 그리는 로직
                chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
                    if (!response || !response.success) {
                        container.querySelectorAll('.content-list').forEach(list => list.innerHTML = '<p class="loading-placeholder">콘텐츠를 새로고침하지 못했습니다.</p>');
                        return;
                    }
                    cachedData = response.data;
                    updateDashboardUI(container);
                });
            }
        }
    });

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
            renderPaginatedContent(contentListElement, sourceId, cachedData.content, type, platform);
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
            viewState[type] = { sortOrder: platform === 'youtube' ? 'publishedAt' : 'pubDate', currentPage: 0 };
            updateDashboardUI(container);
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
            renderPaginatedContent(contentListElement, sourceId, cachedData.content, type, platform);
            return;
        }
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'cp_sync_started') {
        // 데이터 수집 시작 신호를 받으면 로딩 UI를 보여줍니다.
        container.querySelectorAll('.loading-indicator').forEach(el => el.style.display = 'flex');
    } 
    else if (msg.action === 'cp_item_updated') {
        // 개별 아이템이 수집될 때마다 UI에 실시간으로 추가합니다.
        const newItem = msg.data;
        const listId = `${newItem.channelType}-content-list`;
        const listElement = container.querySelector(`#${listId}`);

        if (listElement) {
            const cardHtml = createContentCard(newItem);
            listElement.insertAdjacentHTML('afterbegin', cardHtml); // 새 항목을 목록 맨 위에 추가
            
            // "표시할 콘텐츠가 없습니다" 같은 플레이스홀더가 있다면 제거
            const placeholder = listElement.querySelector('.loading-placeholder');
            if (placeholder) placeholder.remove();
        }
    }
    else if (msg.action === 'cp_sync_finished') {
        // 데이터 수집 완료 신호를 받으면 로딩 UI를 숨깁니다.
        container.querySelectorAll('.loading-indicator').forEach(el => el.style.display = 'none');
    }
});
