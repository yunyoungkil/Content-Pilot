// js/ui/dashboardMode.js (아이디어 목록 초기화 기능 추가)

import { marked } from 'marked';
import { showToast } from '../utils.js';

// --- 전역 변수 및 캐시 관련 함수 (이전과 동일) ---
let cachedData = null;
const ITEMS_PER_PAGE = 5;
let viewState = {
    myChannels: { sortOrder: 'pubDate', currentPage: 0 },
    competitorChannels: { sortOrder: 'pubDate', currentPage: 0 }
};
let activeTagFilter = null;
const getCacheKey = () => `analysisCache_${location.href}`;


function initDashboardMode(container) {
    const CACHE_KEY = getCacheKey();
    chrome.storage.local.get(CACHE_KEY, (result) => {
        const cache = result[CACHE_KEY];
        if (!cache) return;
        if (cache.myAnalysisResult) {
            const myAnalysisContent = container.querySelector('#my-analysis-content');
            if (myAnalysisContent) renderAnalysisResult(myAnalysisContent, cache.myAnalysisResult, true);
        }
        if (cache.competitorAnalysisResult) {
            const competitorAnalysisContent = container.querySelector('#competitor-analysis-content');
            const competitorSection = container.querySelector('#competitor-analysis-section');
            if (competitorAnalysisContent) renderAnalysisResult(competitorAnalysisContent, cache.competitorAnalysisResult, false);
            if (competitorSection) {
                competitorSection.style.display = 'block';
                container.querySelector('#my-analysis-section')?.classList.add('docked');
            }
        }
        if (cache.addedIdeas && cache.addedIdeas.length > 0) {
            // ▼▼▼ [수정] Firebase와 동기화하여 실제로 존재하는 아이디어만 표시 ▼▼▼
            // Firebase에서 모든 칸반 데이터를 가져와서 실제로 존재하는 아이디어만 필터링
            chrome.runtime.sendMessage({ action: 'get_all_kanban_data' }, (kanbanResponse) => {
                if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
                    // 모든 상태의 칸반 데이터에서 firebaseKey 수집
                    const existingKeys = new Set();
                    const allKanbanData = kanbanResponse.data;
                    for (const status in allKanbanData) {
                        if (allKanbanData[status]) {
                            Object.keys(allKanbanData[status]).forEach(key => existingKeys.add(key));
                        }
                    }
                    
                    // 실제로 존재하는 아이디어만 필터링
                    const validIdeas = cache.addedIdeas.filter(idea => existingKeys.has(idea.firebaseKey));
                    
                    // 캐시 업데이트 (삭제된 아이디어 제거)
                    if (validIdeas.length !== cache.addedIdeas.length) {
                        cache.addedIdeas = validIdeas;
                        chrome.storage.local.set({ [CACHE_KEY]: cache });
                    }
                    
                    // 유효한 아이디어만 표시
                    if (validIdeas.length > 0) {
                        const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                        const recentlyAddedList = container.querySelector('#recently-added-list');
                        if (recentlyAddedPanel && recentlyAddedList) {
                            const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
                            recentlyAddedPanel.style.display = 'block';
                            if (placeholder) placeholder.remove();
                            recentlyAddedList.innerHTML = '';
                            validIdeas.forEach(idea => {
                                const newItem = document.createElement('li');
                                newItem.dataset.firebaseKey = idea.firebaseKey;
                                newItem.dataset.ideaIndex = idea.ideaIndex;
                                newItem.innerHTML = `<span>${idea.title}</span><button class="undo-add-btn">실행 취소</button>`;
                                recentlyAddedList.prepend(newItem);
                                const ideaCard = container.querySelector(`.ai-idea-card[data-idea-index="${idea.ideaIndex}"]`);
                                if (ideaCard) {
                                    const button = ideaCard.querySelector('.add-to-kanban-btn');
                                    if (button) {
                                        button.disabled = true;
                                        button.textContent = '✅ 추가됨';
                                    }
                                }
                            });
                        }
                    }
                } else {
                    // Firebase 조회 실패 시 기존 로직 사용 (하위 호환성)
                    const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                    const recentlyAddedList = container.querySelector('#recently-added-list');
                    if (recentlyAddedPanel && recentlyAddedList) {
                        const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
                        recentlyAddedPanel.style.display = 'block';
                        if (placeholder) placeholder.remove();
                        recentlyAddedList.innerHTML = '';
                        cache.addedIdeas.forEach(idea => {
                            const newItem = document.createElement('li');
                            newItem.dataset.firebaseKey = idea.firebaseKey;
                            newItem.dataset.ideaIndex = idea.ideaIndex;
                            newItem.innerHTML = `<span>${idea.title}</span><button class="undo-add-btn">실행 취소</button>`;
                            recentlyAddedList.prepend(newItem);
                            const ideaCard = container.querySelector(`.ai-idea-card[data-idea-index="${idea.ideaIndex}"]`);
                            if (ideaCard) {
                                const button = ideaCard.querySelector('.add-to-kanban-btn');
                                if (button) {
                                    button.disabled = true;
                                    button.textContent = '✅ 추가됨';
                                }
                            }
                        });
                    }
                }
            });
            // ▲▲▲ [수정 완료] ▲▲▲
        }
    });
}
function renderAnalysisResult(container, analysisText, isMyChannelAnalysis = false) {
    if (!analysisText || !analysisText.trim()) {
        container.innerHTML = `<p class="ai-ideas-placeholder">분석 결과에서 제안할 아이디어를 찾지 못했습니다.</p>`;
        return;
    }

    const rawHtml = marked.parse(analysisText);
    container.innerHTML = `<div class="ai-ideas-list">${rawHtml}</div>`;
    if (isMyChannelAnalysis) {
        // 내 채널 분석은 기존 방식 유지
        const rawHtml = marked.parse(analysisText);
        container.innerHTML = `<div class="ai-ideas-list">${rawHtml}</div>`;
        return;
    }


    try {
        // JSON 코드 블록에서 추출 시도
        let jsonText = analysisText;
        const codeBlockMatch = analysisText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (codeBlockMatch) {
            jsonText = codeBlockMatch[1];
        } else {
            // 코드 블록이 없으면 배열 패턴 찾기
            const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                jsonText = jsonMatch[0];
            } else {
                throw new Error("AI 응답에서 유효한 배열 형식을 찾지 못했습니다.");
            }
        }
        
        const ideas = JSON.parse(jsonText);


        if (!Array.isArray(ideas) || ideas.length === 0) {
            container.innerHTML = `<p class="ai-ideas-placeholder">분석 결과에서 제안할 아이디어를 찾지 못했습니다.</p>`;
            return;
        }

        const ideasHtml = ideas.map((idea, index) => {

            const ideaString = JSON.stringify(idea);
            const escapedIdeaString = ideaString.replace(/'/g, "&#39;");

            return `
                <div class="ai-idea-card" 
                     data-idea-index="${index}" 
                     data-idea-object='${escapedIdeaString}'>
                    <div class="idea-content">
                        <h3>${idea.title}</h3>
                        <p>${idea.description}</p>
                    </div>
                    <button class="add-to-kanban-btn">📌 기획 보드에 추가</button>
                </div>
            `;
        }).join('');

        container.innerHTML = `<div class="ai-ideas-list">${ideasHtml}</div>`;

    } catch (e) {
        console.error("AI 아이디어 파싱 오류:", e, "원본 텍스트:", analysisText);
        container.innerHTML = `<p class="ai-ideas-placeholder">AI가 제안한 아이디어 형식이 올바르지 않습니다.</p>`;
    }
}

function createContentCard(item, type) {
    if (!item || !item.title) return '';
    const isVideo = !!item.videoId;
    const link = isVideo ? `https://www.youtube.com/watch?v=${item.videoId}` : item.fullLink || item.link || '#';
    const thumbnail = item.thumbnail || '';
    const title = item.title.length > 40 ? `${item.title.substring(0, 30)} ...` : item.title;
    const dateSource = item.publishedAt || item.pubDate;
    const date = dateSource && !isNaN(Number(dateSource)) ? new Date(Number(dateSource)) : null;
    const dateString = date ? date.toLocaleDateString() : '날짜 정보 없음';
    let tagsContent = '';
    if (item.tags === undefined) {
        tagsContent = `<span class="tag-placeholder">태그 분석 예정...</span>`;
    } else if (item.tags === null) {
        tagsContent = `<span class="tag-placeholder error">태그 분석 실패 (API 오류)</span>`;
    } else if (Array.isArray(item.tags) && item.tags.length > 0) {
        tagsContent = item.tags.map(tag => `<span class="tag">#${tag}</span>`).join('');
    } else {
        tagsContent = `<span class="tag-placeholder">관련 태그 없음</span>`;
    }
    const tagsHtml = `<div class="card-tags">${tagsContent}</div>`;
    let imagesPreviewHtml = '';
    if (item.allImages) {
        const imagesArray = Array.isArray(item.allImages) ? item.allImages : Object.values(item.allImages);
        if (imagesArray.length > 0) {
            imagesPreviewHtml = `
                <div class="card-images-preview">
                    ${imagesArray.slice(0, 8).map(image => `
                        <img src="${image.src}" alt="${image.alt || ''}" class="preview-img" loading="lazy" referrerpolicy="no-referrer">
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
    } else {
        const totalSeconds = item.readTimeInSeconds || 0;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        let readTimeText = '';
        if (minutes > 0) readTimeText += `${minutes}분 `;
        if (seconds > 0 || minutes === 0) readTimeText += `${seconds}초`;
        readTimeText = readTimeText.trim() || '1초 미만';
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
    }
    const commentAnalysisButton = isVideo ? `<button class="comment-analyze-btn" data-video-id="${item.videoId}" title="댓글 분석">💡</button>` : '';
    const postObjectString = JSON.stringify(item).replace(/'/g, "&#39;");
    const addToKanbanButton = `<button class="add-post-to-kanban-btn" data-post-object='${postObjectString}' data-channel-type="${type}" title="${type === 'myChannels' ? '리뉴얼 아이디어로 추가' : '벤치마킹 아이디어로 추가'}">
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
        </svg>
    </button>`;
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
            ${addToKanbanButton}
            ${commentAnalysisButton}
        </a>
    `;
}
function renderPaginatedContent(listContainer, controlsContainer, sourceId, allContent, type, platform) {
    const state = viewState[type];
    const isVideo = platform === 'youtube';
    let filteredContent = allContent.filter(item => item.sourceId === sourceId && (isVideo ? !!item.videoId : !item.videoId));
    if (activeTagFilter) {
        filteredContent = filteredContent.filter(item => item.tags && item.tags.includes(activeTagFilter));
    }
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
    controlsContainer.innerHTML = `
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
    `;
    if (paginatedContent.length > 0) {
        listContainer.innerHTML = `<div class="content-list">${paginatedContent.map(item => createContentCard(item, type)).join('')}</div>`;
        listContainer.querySelectorAll('.preview-img').forEach(img => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
            img.addEventListener('load', () => { if (img.naturalWidth === 0) { img.style.display = 'none'; } });
        });
    } else {
        listContainer.innerHTML = `<p class="loading-placeholder">표시할 ${isVideo ? '유튜브 영상이' : '블로그 게시물이'} 없습니다.</p>`;
        controlsContainer.innerHTML = '';
    }
}
async function updateDashboardUI(container) {
    if (!cachedData) return;

    // [신규] 활성 채널 ID 가져오기
    const { activeChannelId } = await chrome.storage.local.get("activeChannelId");

    // 1. 내 채널 설정 ('myChannels')
    const myCol = container.querySelector('#my-channels-col');
    if (myCol) {
        // 기존 드롭다운 제어 UI 숨김/제거
        const controlsWrapper = myCol.querySelector('#myChannels-controls');
        if (controlsWrapper) controlsWrapper.style.display = 'none'; // 드롭다운 숨김

        const contentListElement = myCol.querySelector('#myChannels-content-list');
        const controlsContainer = myCol.querySelector('.top5-controls-container'); // 페이징 컨트롤 등

        // 활성 채널 찾기 (API URL 매칭 또는 ID 매칭)
        // cachedData.channels.myChannels.blogs 배열에서 찾음
        const myBlogs = cachedData.channels.myChannels?.blogs || [];
        const currentChannel = myBlogs.find(blog => {
            const id = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : "");
            return id === activeChannelId;
        });

        if (currentChannel) {
            // 헤더에 현재 채널명 표시
            const headerEl = myCol.querySelector('.dashboard-col-header h2');
            if (headerEl) {
                headerEl.textContent = `🚀 ${currentChannel.inputUrl || '내 채널'}`;
            }
            
            // 데이터 렌더링
            const sourceId = btoa(currentChannel.apiUrl).replace(/=/g, "");
            renderPaginatedContent(contentListElement, controlsContainer, sourceId, cachedData.content, 'myChannels', 'blog');
        } else {
            contentListElement.innerHTML = `<p class="loading-placeholder">선택된 채널 데이터를 찾을 수 없습니다.<br>글로벌 채널 선택기를 확인해주세요.</p>`;
        }
    }

    // 2. 경쟁 채널 설정 ('competitorChannels')
    const compCol = container.querySelector('#competitor-channels-col');
    if (compCol) {
        const controlsWrapper = compCol.querySelector('#competitorChannels-controls');
        if (controlsWrapper) controlsWrapper.style.display = 'none'; // 드롭다운 숨김
        
        const contentListElement = compCol.querySelector('#competitorChannels-content-list');
        // 경쟁사는 여러 개일 수 있으므로 리스트 형태로 보여주거나, 합쳐서 보여줘야 함
        // 여기서는 "내 채널에 소속된 모든 경쟁사"의 데이터를 합쳐서 보여주는 방식으로 구현
        
        const myBlogs = cachedData.channels.myChannels?.blogs || [];
        const currentChannel = myBlogs.find(blog => {
            const id = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : "");
            return id === activeChannelId;
        });

        if (currentChannel && currentChannel.competitors && currentChannel.competitors.length > 0) {
            // 경쟁사들의 sourceId 목록 추출
            const compSourceIds = currentChannel.competitors.map(c => btoa(c.apiUrl).replace(/=/g, ""));
            
            // cachedData.content에서 해당 경쟁사들의 데이터만 필터링
            const compContent = cachedData.content.filter(item => compSourceIds.includes(item.sourceId));
            
            // (임시) renderPaginatedContent는 단일 sourceId만 처리하므로, 
            // 여기서는 커스텀 렌더링을 하거나 첫 번째 경쟁사만 보여주는 방식을 선택해야 함.
            // V2에서는 '통합 리스트' 렌더링 함수가 필요하지만, 일단 간단히 목록을 렌더링
            
            if (compContent.length > 0) {
                contentListElement.innerHTML = `<div class="content-list">${compContent.slice(0, 5).map(item => createContentCard(item, 'competitorChannels')).join('')}</div>`;
            } else {
                 contentListElement.innerHTML = `<p class="loading-placeholder">경쟁사 데이터가 아직 수집되지 않았습니다.</p>`;
            }

        } else {
            contentListElement.innerHTML = `<p class="loading-placeholder">등록된 경쟁 채널이 없습니다.<br>채널 관리에서 경쟁사를 추가하세요.</p>`;
        }
    }

    // 태그 필터 상태 표시 (기존 로직 유지)
    container.querySelectorAll('.card-tags .tag').forEach(tagEl => {
        if (activeTagFilter && tagEl.textContent.replace('#', '') === activeTagFilter) {
            tagEl.classList.add('active');
        } else {
            tagEl.classList.remove('active');
        }
    });
}
function renderDashboard(container) {
    container.innerHTML = `
      <div class="dashboard-container">
          <div class="dashboard-grid">
              <div id="my-channels-col" class="dashboard-col">
                  <div class="dashboard-col-header">
                      <h2>🚀 내 주요 콘텐츠</h2>
                  </div>
                  <div class="platform-tabs" data-type="myChannels">
                      <div class="platform-tab active" data-platform="blog">블로그</div>
                      <div class="platform-tab" data-platform="youtube">유튜브</div>
                  </div>
                  <div class="dashboard-controls" id="myChannels-controls" style="display: none;"></div>
                  <div class="sub-controls-wrapper">
                      <div class="top5-controls-container"></div>
                  </div>
                  <div id="myChannels-content-list" class="content-list-area"><p class="loading-placeholder">채널 정보를 불러오는 중...</p></div>
              </div>
              <div id="competitor-channels-col" class="dashboard-col">
                  <div class="dashboard-col-header">
                      <h2>⚔️ 경쟁사 주요 콘텐츠</h2>
                  </div>
                  <div class="platform-tabs" data-type="competitorChannels">
                      <div class="platform-tab active" data-platform="blog">블로그</div>
                      <div class="platform-tab" data-platform="youtube">유튜브</div>
                  </div>
                  <div class="dashboard-controls" id="competitorChannels-controls" style="display: none;"></div>
                  <div id="competitorChannels-content-list" class="content-list-area"></div>
              </div>
              <div class="ai-section-wrapper">
                  <div class="ai-analysis-panels-wrapper">
                      <div id="my-analysis-section" class="ai-ideas-section">
                          <div class="ai-section-header">
                              <h2>✨ 성과 분석 결과</h2>
                              <button id="unified-analyze-btn" class="analyze-btn primary">🚀 통합 분석 실행하기</button>
                          </div>
                          <div id="my-analysis-content">
                              <p class="ai-ideas-placeholder">버튼을 눌러 내 채널과 경쟁 채널을 한 번에 분석하고 새로운 아이디어를 얻어보세요.</p>
                          </div>
                      </div>
                      <div id="competitor-analysis-section" class="ai-ideas-section" style="display: none;">
                          <div class="ai-section-header">
                              <h2>💡 AI 아이디어 제안</h2>
                          </div>
                          <div id="competitor-analysis-content">
                              <p class="ai-ideas-placeholder">'통합 분석'을 실행하면 여기에 새로운 아이디어가 제안됩니다.</p>
                          </div>
                      </div>
                  </div>
                  <div id="recently-added-panel" class="recently-added-section" style="display: none;">
                      <h2>✅ 최근 추가된 아이디어</h2>
                      <ul id="recently-added-list">
                          <li class="recent-add-placeholder">아이디어를 기획 보드에 추가하면 여기에 표시됩니다.</li>
                      </ul>
                  </div>
              </div>
          </div>
      </div>
    `;
    chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
        if (!response || !response.success) {
            container.querySelectorAll('.content-list-area').forEach(list => list.innerHTML = '<p>콘텐츠를 불러오지 못했습니다.</p>');
            return;
        }
        cachedData = response.data;
        updateDashboardUI(container);
        initDashboardMode(container);
    });
}


function addDashboardEventListeners(container) {
    if (container.dataset.listenersAttached) return;
    container.dataset.listenersAttached = 'true';

    const CACHE_KEY = getCacheKey();

    chrome.runtime.onMessage.addListener((msg) => {
        const dashboardGrid = container.querySelector('.dashboard-grid');
        if (!dashboardGrid) return;

        if (msg.action === 'cp_data_refreshed') {
            chrome.runtime.sendMessage({ action: 'get_channel_content' }, (response) => {
                if (response && response.success) {
                    cachedData = response.data;
                    updateDashboardUI(container);
                }
            });
        } else if (msg.action === 'cp_item_updated') {
            const newItem = msg.data;
            if (!newItem || !cachedData) return;
            const contentIndex = cachedData.content.findIndex(item => (item.videoId || item.fullLink) === (newItem.videoId || newItem.fullLink));
            if (contentIndex > -1) {
                cachedData.content[contentIndex] = newItem;
            } else {
                cachedData.content.unshift(newItem);
            }
            updateDashboardUI(container);
        }
    });

    container.addEventListener('click', e => {
        const target = e.target;

        if (target.classList.contains('tag')) {
            e.preventDefault();
            e.stopPropagation();
            const clickedTag = target.textContent.replace('#', '');
            activeTagFilter = (activeTagFilter === clickedTag) ? null : clickedTag;
            Object.keys(viewState).forEach(key => viewState[key].currentPage = 0);
            updateDashboardUI(container);
            return;
        }

        if (target.classList.contains('clear-filter-btn')) {
            activeTagFilter = null;
            updateDashboardUI(container);
            return;
        }


        const handleAnalysis = (action, content, isMyChannel, ideasContent, callback) => {
            const message = isMyChannel ? 'AI가 내 채널의 성공 요인을 분석 중입니다... 📈' : 'AI가 경쟁 채널을 분석하여 새로운 아이디어를 생성 중입니다... 🧠';
            ideasContent.innerHTML = `<p class="ai-ideas-placeholder">${message}</p>`;

            if (isMyChannel) {
                chrome.storage.local.get(CACHE_KEY, (result) => {
                    let cache = result[CACHE_KEY] || {};
                    // 2. 'addedIdeas'를 제외한 분석 관련 캐시만 삭제합니다.
                    delete cache.myAnalysisResult;
                    delete cache.myAnalysisSummary;
                    delete cache.competitorAnalysisResult;
                    delete cache.isAnalysisScrapped;
                    
                    // 3. 수정된 캐시를 다시 저장합니다.
                    chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                        // UI 초기화 로직은 그대로 유지합니다.
                        const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                        const recentlyAddedList = container.querySelector('#recently-added-list');
                        if (recentlyAddedPanel && recentlyAddedList) {
                            recentlyAddedPanel.style.display = 'none';
                            recentlyAddedList.innerHTML = `<li class="recent-add-placeholder">아이디어를 기획 보드에 추가하면 여기에 표시됩니다.</li>`;
                        }
                    });
                });
            }

            chrome.runtime.sendMessage({ action, data: content }, (response) => {
                if (response && response.success) {
                    const analysisText = response.analysis || response.ideas;
                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        let cache = result[CACHE_KEY] || {};
                        if (isMyChannel) {
                            cache.myAnalysisResult = analysisText;
                            cache.myAnalysisSummary = analysisText.split(/###|\n##|\n\d\./)[0].trim();
                        } else {
                            cache.competitorAnalysisResult = analysisText;
                        }
                        chrome.storage.local.set({ [CACHE_KEY]: cache });
                    });
                    renderAnalysisResult(ideasContent, analysisText, isMyChannel);
                    if (callback) callback(response);
                } else {
                    ideasContent.innerHTML = `<p class="ai-ideas-placeholder">분석 중 오류: ${response.error || ''}</p>`;
                }
            });
        };

        if (target.closest('#unified-analyze-btn')) {
            // [수정] 복잡한 데이터 수집 로직 제거 -> activeChannelId만 전송
            chrome.storage.local.get("activeChannelId", (res) => {
                const activeChannelId = res.activeChannelId;
                
                if (!activeChannelId) {
                    alert("분석할 채널이 선택되지 않았습니다. 상단의 글로벌 채널 선택기를 확인해주세요.");
                    return;
                }

                // UI 업데이트 (로딩 표시)
                const myAnalysisContentEl = container.querySelector('#my-analysis-content');
                const competitorAnalysisContentEl = container.querySelector('#competitor-analysis-content');
                
                myAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder">AI가 현재 채널의 성과를 분석 중입니다... 📈</p>`;
                container.querySelector('#competitor-analysis-section').style.display = 'block';
                competitorAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder">경쟁 채널 데이터를 수집하고 있습니다...</p>`;

                // 백그라운드에 분석 요청 (채널 ID만 전달)
                chrome.runtime.sendMessage({ 
                    action: 'generate_blog_ideas',
                    activeChannelId: activeChannelId 
                }, (response) => {
                    if (response && response.success) {
                        // 1. 성과 분석 결과 렌더링
                        renderAnalysisResult(myAnalysisContentEl, response.analysis, true);
                        
                        // 2. 아이디어 제안 결과 렌더링
                        renderAnalysisResult(competitorAnalysisContentEl, response.ideas, false);
                    } else {
                        const errorMsg = response?.error || "알 수 없는 오류";
                        myAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder error">분석 실패: ${errorMsg}</p>`;
                        competitorAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder error">분석 실패</p>`;
                    }
                });
            });
            return;
        }

        if (target.closest('.add-post-to-kanban-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const button = target.closest('.add-post-to-kanban-btn');
            const post = JSON.parse(button.dataset.postObject);
            const channelType = button.dataset.channelType;
            const channelName = cachedData?.metas[post.sourceId]?.title || '알 수 없는 채널';
            
            const ideaForKanban = {
                title: channelType === "myChannels" ? `[리뉴얼] ${post.title}` : `[벤치마킹] ${post.title}`,
                description: post.cleanText || post.description || "",
                keywords: post.tags || [],
                origin: {
                    type: channelType === "myChannels" ? "my_post" : "competitor_post",
                    channelName: channelName,
                    postUrl: post.fullLink || post.link
                }
            };

            // [수정] 현재 활성 채널 ID를 가져와서 함께 전송
            chrome.storage.local.get("activeChannelId", (res) => {
                const channelId = res.activeChannelId || null;

                chrome.runtime.sendMessage({ 
                    action: 'add_idea_to_kanban', 
                    data: JSON.stringify(ideaForKanban),
                    channelId: channelId // 👈 추가됨
                }, (response) => {
                    if (response && response.success) {
                        showToast(`"${post.title}"이(가) 기획 보드에 추가되었습니다.`, 'success');
                        button.disabled = true;
                        button.style.opacity = '0.5';
                        button.style.cursor = 'not-allowed';
                        // SVG를 체크 아이콘으로 변경
                        button.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                                <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
                            </svg>
                        `;
                    } else {
                        alert('기획 보드 추가 실패: ' + (response?.error || '알 수 없는 오류'));
                    }
                });
            });
            return;
        }

        if (target.closest('.add-to-kanban-btn')) {
            const ideaCard = target.closest('.ai-idea-card');
            const ideaObjectString = ideaCard.dataset.ideaObject;
            const ideaIndex = ideaCard.dataset.ideaIndex;

            // ▼▼▼ [수정] AI 아이디어 제안에 origin 필드 추가 ▼▼▼
            // AI 아이디어 제안은 ai_generated로 분류하여 브리핑 자동 생성되도록 함
            let ideaData = JSON.parse(ideaObjectString);
            if (!ideaData.origin) {
                ideaData.origin = { type: "ai_generated" };
            }
            if (!ideaData.keywords && !ideaData.tags) {
                ideaData.keywords = ["#AI-추천"];
            }
            const modifiedIdeaString = JSON.stringify(ideaData);
            // ▲▲▲ [수정 완료] ▲▲▲

            // [수정] 현재 활성 채널 ID를 가져와서 함께 전송
            chrome.storage.local.get("activeChannelId", (res) => {
                const channelId = res.activeChannelId || null;

                chrome.runtime.sendMessage({ 
                    action: 'add_idea_to_kanban', 
                    data: modifiedIdeaString,
                    channelId: channelId // 👈 추가됨 (AI 아이디어는 현재 활성 채널에 귀속)
                }, (response) => {
                if (response && response.success) {
                    const ideaTitle = JSON.parse(ideaObjectString).title;
                    const newIdea = { ideaIndex, firebaseKey: response.firebaseKey, title: ideaTitle };

                    // ▼▼▼ 수정된 상태 관리 로직 ▼▼▼
                    // 1. 항상 storage에서 최신 데이터를 가져옵니다.
                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        let cache = result[CACHE_KEY] || {};
                        let ideas = cache.addedIdeas || [];

                        // 2. 중복을 확인하고 아이디어를 추가합니다.
                        if (!ideas.some(idea => idea.ideaIndex === ideaIndex)) {
                            ideas.push(newIdea);
                        }
                        cache.addedIdeas = ideas;

                        // 3. storage에 데이터를 저장하고, 저장이 완료된 후 UI를 업데이트합니다.
                        chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                            // UI 업데이트 로직
                            target.disabled = true;
                            target.textContent = '✅ 추가됨';

                            const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                            const recentlyAddedList = container.querySelector('#recently-added-list');
                            if (recentlyAddedPanel && recentlyAddedList) {
                                recentlyAddedPanel.style.display = 'block';
                                const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
                                if (placeholder) placeholder.remove();

                                const newItem = document.createElement('li');
                                newItem.dataset.firebaseKey = response.firebaseKey;
                                newItem.dataset.ideaIndex = ideaIndex;
                                newItem.innerHTML = `<span>${ideaTitle}</span><button class="undo-add-btn">실행 취소</button>`;
                                recentlyAddedList.prepend(newItem);
                            }
                        });
                    });
                } else {
                    alert('기획 보드 추가 실패: ' + (response?.error || '알 수 없는 오류'));
                }
                });
            });
            return;
        }

        if (target.closest('.undo-add-btn')) {
            const listItem = target.closest('li');
            const firebaseKey = listItem.dataset.firebaseKey;
            const ideaIndex = listItem.dataset.ideaIndex;

            chrome.runtime.sendMessage({ action: 'remove_idea_from_kanban', key: firebaseKey }, (response) => {
                if (response && response.success) {
                    // ▼▼▼ 수정된 상태 관리 로직 ▼▼▼
                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        let cache = result[CACHE_KEY] || {};
                        let ideas = cache.addedIdeas || [];
                        
                        // 아이디어를 배열에서 제거
                        cache.addedIdeas = ideas.filter(idea => idea.ideaIndex !== ideaIndex);

                        // 데이터를 저장하고, 저장이 완료된 후 UI를 업데이트합니다.
                        chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                            // UI 업데이트 로직
                            listItem.remove();
                            
                            const originalCard = container.querySelector(`.ai-idea-card[data-idea-index="${ideaIndex}"]`);
                            if (originalCard) {
                                const button = originalCard.querySelector('.add-to-kanban-btn');
                                if (button) {
                                    button.disabled = false;
                                    button.textContent = '📌 기획 보드에 추가';
                                }
                            }
                            
                            const recentlyAddedList = container.querySelector('#recently-added-list');
                            if (recentlyAddedList.children.length === 0) {
                                recentlyAddedList.innerHTML = `<li class="recent-add-placeholder">아이디어를 기획 보드에 추가하면 여기에 표시됩니다.</li>`;
                            }
                        });
                    });
                } else {
                    alert('아이디어 삭제 실패: ' + (response?.error || '알 수 없는 오류'));
                }
            });
            return;
        }

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
            const type = col.id.includes('my-channels') ? 'myChannels' : 'competitorChannels';
            const direction = btn.dataset.direction;
            if (direction === 'prev') viewState[type].currentPage--;
            if (direction === 'next') viewState[type].currentPage++;
            updateDashboardUI(container);
            return;
        }
    });

    container.addEventListener('change', e => {
        const target = e.target;
        if (target.classList.contains('channel-selector') || target.classList.contains('top5-sort-select')) {
            const col = target.closest('.dashboard-col');
            const type = col.id.includes('my-channels') ? 'myChannels' : 'competitorChannels';
            if (target.classList.contains('top5-sort-select')) {
                viewState[type].sortOrder = target.value;
            }
            viewState[type].currentPage = 0;
            updateDashboardUI(container);
        }
    });
}

export { initDashboardMode, renderDashboard, addDashboardEventListeners };