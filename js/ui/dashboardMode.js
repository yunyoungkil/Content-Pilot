// js/ui/dashboardMode.js (아이디어 목록 초기화 기능 추가)

import { marked } from 'marked';

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

        const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("AI 응답에서 유효한 배열 형식을 찾지 못했습니다.");
        
        const ideas = JSON.parse(jsonMatch[0]);


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
function updateDashboardUI(container) {
    if (!cachedData) return;
    ['myChannels', 'competitorChannels'].forEach(type => {
        const colElement = container.querySelector(`#${type.replace('Channels', '-channels-col')}`);
        if (!colElement) return;
        const filterStatusContainer = colElement.querySelector('.filter-status-container');
        if (filterStatusContainer) {
            if (activeTagFilter) {
                filterStatusContainer.innerHTML = `
                    <div class="active-filter-chip">
                        <span>현재 필터: #${activeTagFilter}</span>
                        <button class="clear-filter-btn">×</button>
                    </div>
                `;
            } else {
                // 필터가 없으면 안내 문구를 표시합니다.
                filterStatusContainer.innerHTML = `<span class="filter-placeholder">태그 클릭 시 필터가 여기에 표시됩니다.</span>`;
            }
        }
        const platformTabs = colElement.querySelector(`.platform-tabs[data-type="${type}"]`);
        const controlsWrapper = colElement.querySelector(`#${type}-controls`);
        const selectElement = colElement.querySelector(`#${type}-select`);
        const contentListElement = colElement.querySelector(`#${type}-content-list`);
        const controlsContainer = colElement.querySelector('.top5-controls-container');
        if (!platformTabs || !controlsWrapper || !selectElement || !contentListElement || !controlsContainer) return;
        if (type === 'myChannels') {
            const analyzeButtons = colElement.querySelector('#myChannels-analyze-buttons');
            if (analyzeButtons) analyzeButtons.style.display = 'flex';
        }
        const selectedPlatform = platformTabs.querySelector('.active').dataset.platform;
        const platformKey = selectedPlatform === 'blog' ? 'blogs' : 'youtubes';
        let channelObjects = cachedData.channels[type]?.[platformKey] || [];
        if (!Array.isArray(channelObjects) && typeof channelObjects === 'object') {
            channelObjects = Object.values(channelObjects);
        }
        if (channelObjects.length > 0) {
            controlsWrapper.style.display = 'flex';
            const currentSelection = selectElement.value;
            selectElement.innerHTML = channelObjects.map(channel => {
                const id = selectedPlatform === 'blog' ? btoa(channel.apiUrl).replace(/=/g, '') : channel.apiUrl;
                const title = cachedData.metas[id]?.title || channel.inputUrl;
                return `<option value="${id}" ${id === currentSelection ? 'selected' : ''}>${title}</option>`;
            }).join('');
            renderPaginatedContent(contentListElement, controlsContainer, selectElement.value, cachedData.content, type, selectedPlatform);
        } else {
            controlsWrapper.style.display = 'none';
            contentListElement.innerHTML = `<p class="loading-placeholder">연동된 ${selectedPlatform === 'blog' ? '블로그' : '유튜브'} 채널이 없습니다.</p>`;
            controlsContainer.innerHTML = '';
        }
    });
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
                  <div class="dashboard-controls" id="myChannels-controls" style="display: none;">
                      <select id="myChannels-select" class="channel-selector"></select>
                      <div class="sub-controls-wrapper">
                          <div class="filter-status-container"></div>
                          <div class="top5-controls-container"></div>
                      </div>
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
                  <div class="dashboard-controls" id="competitorChannels-controls" style="display: none;">
                      <select id="competitorChannels-select" class="channel-selector"></select>
                      <div class="sub-controls-wrapper">
                          <div class="filter-status-container"></div>
                          <div class="top5-controls-container"></div>
                      </div>
                  </div>
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
                // ▼▼▼ [수정] 분석 시작 시, '최근 추가된 아이디어' UI와 캐시를 초기화합니다. ▼▼▼
                chrome.storage.local.set({ [CACHE_KEY]: {} }, () => {
                    const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                    const recentlyAddedList = container.querySelector('#recently-added-list');
                    if (recentlyAddedPanel && recentlyAddedList) {
                        recentlyAddedPanel.style.display = 'none';
                        recentlyAddedList.innerHTML = `<li class="recent-add-placeholder">아이디어를 기획 보드에 추가하면 여기에 표시됩니다.</li>`;
                    }
                });
                // ▲▲▲ 수정 완료 ▲▲▲
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
            const myCol = container.querySelector('#my-channels-col');
            const competitorCol = container.querySelector('#competitor-channels-col');
            const platform = myCol.querySelector('.platform-tab.active').dataset.platform;
            const myChannelId = myCol.querySelector('.channel-selector').value;
            const myChannelName = myCol.querySelector('.channel-selector option:checked').textContent;
            const competitorChannelId = competitorCol.querySelector('.channel-selector').value;
            
            if (!myChannelId || !competitorChannelId) {
                alert("분석을 위해 '내 채널'과 '경쟁 채널'을 모두 선택해주세요.");
                return;
            }

            const myAnalysisAction = platform === 'blog' ? 'analyze_my_blog' : 'analyze_my_channel';
            const contentFilter = item => platform === 'blog' ? !item.videoId : !!item.videoId;
            const myContent = cachedData.content.filter(item => item.sourceId === myChannelId && contentFilter(item));

            if (myContent.length === 0) {
                alert("성과 분석을 위해 내 채널에 데이터가 필요합니다.");
                return;
            }
            
            const myAnalysisContentEl = container.querySelector('#my-analysis-content');
            
            handleAnalysis(myAnalysisAction, { channelName: myChannelName, channelContent: myContent }, true, myAnalysisContentEl, () => {
                const competitorContent = cachedData.content.filter(item => item.sourceId === competitorChannelId && contentFilter(item));
                if (competitorContent.length === 0) {
                    alert("경쟁 비교 분석을 위해 경쟁 채널에 데이터가 필요합니다.");
                    return;
                }
                const competitorAnalysisAction = platform === 'blog' ? 'generate_blog_ideas' : 'generate_content_ideas';
                
                chrome.storage.local.get(CACHE_KEY, (result) => {
                    const myAnalysisSummary = result[CACHE_KEY]?.myAnalysisSummary;
                    const analysisData = { myContent, competitorContent, myAnalysisSummary };
                    const competitorAnalysisContentEl = container.querySelector('#competitor-analysis-content');
                    
                    container.querySelector('#competitor-analysis-section').style.display = 'block';

                    handleAnalysis(competitorAnalysisAction, analysisData, false, competitorAnalysisContentEl, () => {
                        
                    });
                });
            });
            return;
        }

        if (target.closest('.add-to-kanban-btn')) {
                const ideaCard = target.closest('.ai-idea-card');
                const ideaObjectString = ideaCard.dataset.ideaObject;
                const ideaIndex = ideaCard.dataset.ideaIndex;

                chrome.runtime.sendMessage({ action: 'add_idea_to_kanban', data: ideaObjectString }, (response) => {
                    if (response && response.success) {
                    const ideaTitle = JSON.parse(ideaObjectString).title;
                    const newIdea = { ideaIndex, firebaseKey: response.firebaseKey, title: ideaTitle };
                        
                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        let cache = result[CACHE_KEY] || { addedIdeas: [] };
                        if (!cache.addedIdeas) cache.addedIdeas = [];
                        cache.addedIdeas.push(newIdea);
                        chrome.storage.local.set({ [CACHE_KEY]: cache });
                    });
                    
                    const recentlyAddedPanel = container.querySelector('#recently-added-panel');
                    const recentlyAddedList = container.querySelector('#recently-added-list');
                    const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
                    recentlyAddedPanel.style.display = 'block';
                    if (placeholder) placeholder.remove();
                    const newItem = document.createElement('li');
                    newItem.dataset.firebaseKey = response.firebaseKey;
                    newItem.dataset.ideaIndex = ideaIndex;
                    newItem.innerHTML = `<span>${ideaTitle}</span><button class="undo-add-btn">실행 취소</button>`;
                    recentlyAddedList.prepend(newItem);
                    if (recentlyAddedList.children.length > 7) recentlyAddedList.lastChild.remove();
                    target.disabled = true;
                    target.textContent = '✅ 추가됨';

                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        const cache = result[CACHE_KEY] || {};
                        if (!cache.isAnalysisScrapped) {
                            if (cache.myAnalysisResult) {
                               chrome.runtime.sendMessage({ action: 'scrap_entire_analysis', data: cache.myAnalysisResult });
                            }
                            cache.isAnalysisScrapped = true;
                            chrome.storage.local.set({ [CACHE_KEY]: cache });
                        }
                    });
                } else {
                    alert('기획 보드 추가 실패: ' + (response?.error || '알 수 없는 오류'));
                }
            });
            return;
        }

        if (target.closest('.undo-add-btn')) {
            const listItem = target.closest('li');
            const firebaseKey = listItem.dataset.firebaseKey;
            const ideaIndex = listItem.dataset.ideaIndex;
            chrome.runtime.sendMessage({ action: 'remove_idea_from_kanban', key: firebaseKey }, (response) => {
                if (response && response.success) {
                    listItem.remove();
                    chrome.storage.local.get(CACHE_KEY, (result) => {
                        let cache = result[CACHE_KEY] || { addedIdeas: [] };
                        cache.addedIdeas = cache.addedIdeas.filter(idea => idea.ideaIndex !== ideaIndex);
                        chrome.storage.local.set({ [CACHE_KEY]: cache });
                    });
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