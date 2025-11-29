// js/ui/dashboardMode.js (아이디어 목록 초기화 기능 추가)

import { marked } from 'marked';
import { showToast } from '../utils.js';

// --- 전역 변수 및 캐시 관련 함수 (이전과 동일) ---
let cachedData = null;
const ITEMS_PER_PAGE = 5;
let viewState = {
  myChannels: { sortOrder: 'pubDate', currentPage: 0 },
  competitorChannels: { sortOrder: 'pubDate', currentPage: 0 },
};
let activeTagFilter = null;
let activeChannelFilter = null; // 경쟁 채널 필터
const getCacheKey = async () => {
  const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
  return `analysisCache_${activeChannelId || 'default'}`;
};

/**
 * [체크리스트 2] 제목 정규화 함수 (AI 아이디어 매칭용)
 * 공백 제거, 소문자 변환하여 비교
 */
function normalizeTitleForMatching(title) {
  if (!title) return '';
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * [체크리스트 1] URL 정규화 함수 (칸반 보드 추적용)
 * background.js의 normalizeUrlForComparison과 동일한 로직
 */
function normalizeUrlForTracking(url) {
  if (!url) return '';

  try {
    // URL 객체로 변환 (http/https가 없는 경우 임의로 붙여서 시도)
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);

    // 호스트: www. 제거, 소문자 변환
    const host = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    // 경로: 끝의 슬래시(/) 제거
    const pathname = urlObj.pathname.replace(/\/$/, '');

    // 유튜브의 경우 영상 ID만 비교하는 것이 가장 정확함
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      // 1. 짧은 주소 (youtu.be/VIDEO_ID)
      if (host.includes('youtu.be')) {
        const videoId = pathname.substring(1); // 첫 번째 슬래시 제거
        if (videoId) return `youtube:${videoId}`;
      }
      // 2. 긴 주소 (youtube.com/watch?v=VIDEO_ID 또는 youtube.com/embed/VIDEO_ID)
      const videoId = urlObj.searchParams.get('v') || pathname.split('/embed/')[1]?.split('?')[0];
      if (videoId) return `youtube:${videoId}`;
    }

    // 일반적인 경우: 호스트 + 경로 조합 반환 (쿼리 파라미터 제거)
    return `${host}${pathname}`;
  } catch (e) {
    // URL 파싱 실패 시, 단순 문자열 처리 (공백 제거, 소문자 변환)
    return url
      .trim()
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .split('?')[0]
      .replace(/\/$/, '');
  }
}

async function initDashboardMode(container) {
  const CACHE_KEY = await getCacheKey();
  chrome.storage.local.get(CACHE_KEY, (result) => {
    const cache = result[CACHE_KEY];
    if (!cache) return;

    // DOM이 준비될 때까지 대기
    const checkAndRestore = () => {
      const myAnalysisContent = container.querySelector('#my-analysis-content');
      const competitorAnalysisContent = container.querySelector('#competitor-analysis-content');
      const competitorSection = container.querySelector('#competitor-analysis-section');

      if (cache.myAnalysisResult && myAnalysisContent) {
        renderAnalysisResult(myAnalysisContent, cache.myAnalysisResult, true);
      }
      if (cache.competitorAnalysisResult && competitorAnalysisContent) {
        renderAnalysisResult(
          competitorAnalysisContent,
          cache.competitorAnalysisResult,
          false,
          cache.keywordGap || null
        );
        if (competitorSection) {
          competitorSection.style.display = 'block';
          container.querySelector('#my-analysis-section')?.classList.add('docked');
        }
      }
    };

    // addedIdeas 복원 함수
    const restoreAddedIdeas = () => {
      if (!cache.addedIdeas || cache.addedIdeas.length === 0) return;

      const recentlyAddedPanel = container.querySelector('#recently-added-panel');
      const recentlyAddedList = container.querySelector('#recently-added-list');

      // DOM이 없으면 나중에 재시도
      if (!recentlyAddedPanel || !recentlyAddedList) {
        return false;
      }

      // Firebase와 동기화하여 실제로 존재하는 아이디어만 표시
      chrome.runtime.sendMessage({ action: 'get_all_kanban_data' }, (kanbanResponse) => {
        if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
          // 모든 상태의 칸반 데이터에서 firebaseKey 수집
          const existingKeys = new Set();
          const allKanbanData = kanbanResponse.data;
          for (const status in allKanbanData) {
            if (allKanbanData[status]) {
              Object.keys(allKanbanData[status]).forEach((key) => existingKeys.add(key));
            }
          }

          // 실제로 존재하는 아이디어만 필터링
          const validIdeas = cache.addedIdeas.filter((idea) => existingKeys.has(idea.firebaseKey));

          // 캐시 업데이트 (삭제된 아이디어 제거)
          if (validIdeas.length !== cache.addedIdeas.length) {
            cache.addedIdeas = validIdeas;
            chrome.storage.local.set({ [CACHE_KEY]: cache });
          }

          // 유효한 아이디어만 표시
          if (validIdeas.length > 0) {
            const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
            recentlyAddedPanel.style.display = 'block';
            if (placeholder) placeholder.remove();
            recentlyAddedList.innerHTML = '';
            validIdeas.forEach((idea) => {
              const newItem = document.createElement('li');
              newItem.dataset.firebaseKey = idea.firebaseKey;
              newItem.dataset.ideaTitle = (idea.title || '').replace(/"/g, '&quot;');
              newItem.innerHTML = `<span>${idea.title}</span><button class="undo-add-btn">실행 취소</button>`;
              recentlyAddedList.prepend(newItem);

              // [체크리스트 2] 제목 기반 매칭으로 변경
              const normalizedTitle = normalizeTitleForMatching(idea.title);
              if (normalizedTitle) {
                const allIdeaCards = container.querySelectorAll('.ai-idea-card');
                allIdeaCards.forEach((card) => {
                  const cardTitle = card.dataset.ideaTitle || '';
                  const normalizedCardTitle = normalizeTitleForMatching(cardTitle);
                  if (normalizedCardTitle === normalizedTitle) {
                    const button = card.querySelector('.add-to-kanban-btn');
                    if (button) {
                      button.disabled = true;
                      button.textContent = '✅ 추가됨';
                    }
                  }
                });
              }
            });
          }
        } else {
          // Firebase 조회 실패 시 기존 로직 사용 (하위 호환성)
          const placeholder = recentlyAddedList.querySelector('.recent-add-placeholder');
          recentlyAddedPanel.style.display = 'block';
          if (placeholder) placeholder.remove();
          recentlyAddedList.innerHTML = '';
          cache.addedIdeas.forEach((idea) => {
            const newItem = document.createElement('li');
            newItem.dataset.firebaseKey = idea.firebaseKey;
            newItem.dataset.ideaTitle = (idea.title || '').replace(/"/g, '&quot;');
            newItem.innerHTML = `<span>${idea.title}</span><button class="undo-add-btn">실행 취소</button>`;
            recentlyAddedList.prepend(newItem);

            // [체크리스트 2] 제목 기반 매칭으로 변경
            const normalizedTitle = normalizeTitleForMatching(idea.title);
            if (normalizedTitle) {
              const allIdeaCards = container.querySelectorAll('.ai-idea-card');
              allIdeaCards.forEach((card) => {
                const cardTitle = card.dataset.ideaTitle || '';
                const normalizedCardTitle = normalizeTitleForMatching(cardTitle);
                if (normalizedCardTitle === normalizedTitle) {
                  const button = card.querySelector('.add-to-kanban-btn');
                  if (button) {
                    button.disabled = true;
                    button.textContent = '✅ 추가됨';
                  }
                }
              });
            }
          });
        }
      });
      return true;
    };

    // 즉시 시도하고, DOM이 없으면 약간의 지연 후 재시도
    checkAndRestore();
    const restored = restoreAddedIdeas();

    if (!container.querySelector('#my-analysis-content') || !restored) {
      setTimeout(() => {
        checkAndRestore();
        restoreAddedIdeas();
      }, 100);
    }

    // 추가 재시도 (DOM이 늦게 로드될 수 있음)
    setTimeout(() => {
      if (cache.addedIdeas && cache.addedIdeas.length > 0) {
        restoreAddedIdeas();
      }
    }, 300);
  });
}
async function renderAnalysisResult(
  container,
  analysisText,
  isMyChannelAnalysis = false,
  keywordGap = null
) {
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

  // [체크리스트 3] Firebase 데이터와 교차 검증: 칸반 보드에 있는 제목 목록 가져오기
  const existingTitles = new Set();
  try {
    const kanbanResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get_all_kanban_data' }, (response) => {
        resolve(response);
      });
    });

    if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
      const kanbanData = kanbanResponse.data;
      const statuses = ['ideas', 'in-progress', 'done'];

      for (const status of statuses) {
        const cards = kanbanData[status] || {};
        for (const cardData of Object.values(cards)) {
          // AI 아이디어 제안: origin.type === "ai_generated"인 경우 제목으로 추적
          if (cardData.origin?.type === 'ai_generated' && cardData.title) {
            const normalizedTitle = normalizeTitleForMatching(cardData.title);
            if (normalizedTitle) existingTitles.add(normalizedTitle);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[renderAnalysisResult] 칸반 데이터 조회 실패:', error);
  }

  try {
    // 에러 메시지인 경우 파싱 시도하지 않음
    if (
      analysisText &&
      (analysisText.trim().startsWith('오류:') || analysisText.trim().startsWith('오류：'))
    ) {
      console.warn(
        '[renderAnalysisResult] API 오류 응답 감지, 파싱 건너뜀:',
        analysisText.substring(0, 100)
      );
      container.innerHTML = `<p class="ai-ideas-placeholder">API 호출 중 오류가 발생했습니다. API 키를 확인해주세요.</p>`;
      return;
    }

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
        throw new Error('AI 응답에서 유효한 배열 형식을 찾지 못했습니다.');
      }
    }

    const ideas = JSON.parse(jsonText);

    if (!Array.isArray(ideas) || ideas.length === 0) {
      container.innerHTML = `<p class="ai-ideas-placeholder">분석 결과에서 제안할 아이디어를 찾지 못했습니다.</p>`;
      return;
    }

    const ideasHtml = ideas
      .map((idea, index) => {
        // [체크리스트 3] 제목 기반으로 이미 추가된 아이디어 확인
        const normalizedTitle = normalizeTitleForMatching(idea.title);
        const isAlreadyAdded = normalizedTitle && existingTitles.has(normalizedTitle);

        const ideaString = JSON.stringify(idea);
        const escapedIdeaString = ideaString.replace(/'/g, '&#39;');

        return `
                <div class="ai-idea-card" 
                     data-idea-index="${index}" 
                     data-idea-title="${(idea.title || '').replace(/"/g, '&quot;')}"
                     data-idea-object='${escapedIdeaString}'>
                    <div class="idea-content">
                        <h3>${idea.title}</h3>
                        <p>${idea.description}</p>
                    </div>
                    ${
                      isAlreadyAdded
                        ? `<button class="add-to-kanban-btn" disabled>✅ 기획 보드에 있음</button>`
                        : `<button class="add-to-kanban-btn">📌 기획 보드에 추가</button>`
                    }
                </div>
            `;
      })
      .join('');

    // 키워드 갭 정보 표시
    let keywordGapHtml = '';
    if (keywordGap && keywordGap.gapKeywords && keywordGap.gapKeywords.length > 0) {
      keywordGapHtml = `
                <div class="keyword-gap-section" style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #856404; display: flex; align-items: center; gap: 8px;">
                        🔑 경쟁사 독점 키워드 (놓치고 있는 황금 키워드)
                    </h3>
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #856404;">
                        경쟁사는 다음 키워드로 콘텐츠를 제작하고 있지만, 나는 아직 다루지 않은 키워드입니다. 이 키워드들을 활용하면 경쟁사보다 먼저 해당 주제를 선점할 수 있는 기회입니다.
                    </p>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${keywordGap.gapKeywords
                          .map(
                            (kw) => `
                            <span style="background: #fff; color: #856404; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; border: 1px solid #ffc107;">
                                ${kw}
                            </span>
                        `
                          )
                          .join('')}
                    </div>
                    <p style="margin: 12px 0 0 0; font-size: 12px; color: #856404; opacity: 0.8;">
                        총 ${keywordGap.gapCount}개의 갭 키워드 발견
                    </p>
                </div>
            `;
    }

    container.innerHTML = `${keywordGapHtml}<div class="ai-ideas-list">${ideasHtml}</div>`;
  } catch (e) {
    console.error('AI 아이디어 파싱 오류:', e, '원본 텍스트:', analysisText);
    container.innerHTML = `<p class="ai-ideas-placeholder">AI가 제안한 아이디어 형식이 올바르지 않습니다.</p>`;
  }
}

function createContentCard(item, type, sourceName = null, trackedUrls = new Map()) {
  if (!item || !item.title) return '';
  const isVideo = !!item.videoId;
  const link = isVideo
    ? `https://www.youtube.com/watch?v=${item.videoId}`
    : item.fullLink || item.link || '#';
  const thumbnail = item.thumbnail || '';
  const title = item.title.length > 40 ? `${item.title.substring(0, 30)} ...` : item.title;
  const dateSource = item.publishedAt || item.pubDate;
  const date = dateSource && !isNaN(Number(dateSource)) ? new Date(Number(dateSource)) : null;
  const dateString = date ? date.toLocaleDateString() : '날짜 정보 없음';

  // 필터 적용 상태 확인 (경쟁 채널만)
  const isFiltered =
    type === 'competitorChannels' && activeChannelFilter && sourceName === activeChannelFilter;

  // [체크리스트 3] 버튼 조건부 렌더링: 이미 등록된 포스팅인지 확인
  const itemUrl = item.fullLink || item.link || '';
  const normalizedItemUrl = normalizeUrlForTracking(itemUrl);
  const trackingInfo = normalizedItemUrl ? trackedUrls.get(normalizedItemUrl) : null;
  const isTracked = !!trackingInfo;

  // 상태에 따라 다른 배지 표시
  let statusBadgeHtml = '';
  if (trackingInfo) {
    const { status, hasPerformance, publishedUrl } = trackingInfo;
    let badgeText = '';
    let badgeColor = '';
    let badgeBg = '';
    let badgeTitle = '';

    if (status === 'ideas') {
      badgeText = '📝 기획 중';
      badgeColor = '#1976d2';
      badgeBg = '#e3f2fd';
      badgeTitle = '기획 보드에 등록되어 있습니다';
    } else if (status === 'in-progress') {
      badgeText = '✍️ 작성 중';
      badgeColor = '#f57c00';
      badgeBg = '#fff3e0';
      badgeTitle = '작성 중인 아이디어입니다';
    } else if (status === 'done') {
      if (hasPerformance && publishedUrl) {
        badgeText = '✅ 추적 중';
        badgeColor = '#2e7d32';
        badgeBg = '#e8f5e9';
        badgeTitle = '발행 완료 및 성과 추적 중입니다';
      } else if (publishedUrl) {
        badgeText = '📤 발행 완료';
        badgeColor = '#7b1fa2';
        badgeBg = '#f3e5f5';
        badgeTitle = '발행 완료되었습니다 (성과 추적 미설정)';
      } else {
        badgeText = '📤 발행 완료';
        badgeColor = '#7b1fa2';
        badgeBg = '#f3e5f5';
        badgeTitle = '발행 완료되었습니다';
      }
    }

    if (badgeText) {
      statusBadgeHtml = `<div class="status-badge" style="
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                background: ${badgeBg};
                color: ${badgeColor};
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                line-height: 1.2;
                margin-left: auto;
                height: 18px;
            " title="${badgeTitle}">${badgeText}</div>`;
    }
  }

  // [신규] 채널 이름 표시 (제목 위에 표시) - 경쟁 채널은 클릭 가능, 추적 중 배지 포함
  const channelNameHtml =
    sourceName || isTracked
      ? `
        <div class="card-channel-name ${
          type === 'competitorChannels' ? 'channel-name-clickable' : ''
        }" 
             ${
               type === 'competitorChannels'
                 ? `data-channel-name="${(sourceName || '').replace(/"/g, '&quot;')}"`
                 : ''
             }
             style="
            margin-bottom: 6px;
            font-size: 12px;
            font-weight: 600;
            color: ${
              isFiltered ? '#1a73e8' : type === 'competitorChannels' ? '#ff5722' : '#4285f4'
            };
            display: flex;
            align-items: center;
            gap: 4px;
            height: 18px;
            ${type === 'competitorChannels' ? 'cursor: pointer; text-decoration: underline;' : ''}
            ${
              isFiltered
                ? 'background: rgba(26, 115, 232, 0.1); padding: 2px 6px; border-radius: 4px;'
                : ''
            }
        ">
            ${
              sourceName
                ? `<span>${type === 'competitorChannels' ? '⚔️' : '🚀'}</span>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${(
              sourceName || ''
            ).replace(/&amp;/g, '&')}</span>`
                : ''
            }
            ${statusBadgeHtml}
        </div>
    `
      : isTracked
        ? `
        <div class="card-channel-name" style="
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 18px;
        ">
            ${statusBadgeHtml}
        </div>
    `
        : '';
  let tagsContent = '';
  if (item.tags === undefined) {
    tagsContent = `<span class="tag-placeholder">태그 분석 예정...</span>`;
  } else if (item.tags === null) {
    tagsContent = `<span class="tag-placeholder error">태그 분석 실패 (API 오류)</span>`;
  } else if (Array.isArray(item.tags) && item.tags.length > 0) {
    tagsContent = item.tags
      .map((tag) => `<span class="tag">#${tag.replace(/&amp;/g, '&')}</span>`)
      .join('');
  } else {
    tagsContent = `<span class="tag-placeholder">관련 태그 없음</span>`;
  }
  const tagsHtml = `<div class="card-tags">${tagsContent}</div>`;
  let imagesPreviewHtml = '';
  if (item.allImages) {
    const imagesArray = Array.isArray(item.allImages)
      ? item.allImages
      : Object.values(item.allImages);
    if (imagesArray.length > 0) {
      imagesPreviewHtml = `
                <div class="card-images-preview">
                    ${imagesArray
                      .slice(0, 8)
                      .map((image) => {
                        // [체크리스트 1] chrome-extension://invalid/ 방지: 이미지 src 유효성 검사
                        const imageSrc = image?.src || (typeof image === 'string' ? image : '');
                        if (
                          !imageSrc ||
                          imageSrc === 'undefined' ||
                          imageSrc.startsWith('chrome-extension://invalid')
                        ) {
                          return ''; // 유효하지 않은 이미지는 렌더링하지 않음
                        }
                        // [체크리스트 2-A] referrerpolicy 적용
                        return `<img src="${imageSrc.replace(/&amp;/g, '&')}" alt="${(
                          image?.alt || ''
                        ).replace(
                          /"/g,
                          '&quot;'
                        )}" class="preview-img" loading="lazy" referrerpolicy="no-referrer" data-original-src="${imageSrc.replace(
                          /"/g,
                          '&quot;'
                        )}">`;
                      })
                      .filter((html) => html)
                      .join('')}
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
  const commentAnalysisButton = isVideo
    ? `<button class="comment-analyze-btn" data-video-id="${item.videoId}" title="댓글 분석">💡</button>`
    : '';

  // 미등록 상태일 때만 리뉴얼 버튼과 성과 등록 버튼 표시
  // [수정] 경쟁 채널에는 성과 등록 버튼을 표시하지 않음
  let actionButtonHtml = '';
  if (!isTracked) {
    // 미등록 -> 리뉴얼 버튼과 성과 등록 버튼 표시
    const postObjectString = JSON.stringify(item).replace(/'/g, '&#39;');
    const isMyChannel = type === 'myChannels';
    actionButtonHtml = `
            <button class="add-post-to-kanban-btn" data-post-object='${postObjectString}' data-channel-type="${type}" data-item-url="${itemUrl.replace(
              /"/g,
              '&quot;'
            )}" title="${
              isMyChannel ? '리뉴얼 아이디어로 추가' : '벤치마킹 아이디어로 추가'
            }" style="margin-right: 4px;">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                    <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
                </svg>
            </button>
            ${
              isMyChannel
                ? `
            <button class="track-post-btn" data-post-object='${postObjectString}' data-channel-type="${type}" data-item-url="${itemUrl.replace(
              /"/g,
              '&quot;'
            )}" title="성과 추적 시작 (발행 완료 컬럼에 추가)" style="background: #4285f4; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; font-weight: 500;">
                📊 성과 등록
            </button>
            `
                : ''
            }
        `;
  }
  // [체크리스트 1] chrome-extension://invalid/ 방지: 썸네일 URL 유효성 검사
  // [체크리스트 2-A] referrerpolicy 적용
  // [체크리스트 2-B] 썸네일 이미지 에러 핸들링을 위한 데이터 속성 추가
  let thumbnailWithErrorHandling = '';
  if (
    thumbnail &&
    thumbnail !== 'undefined' &&
    !thumbnail.startsWith('chrome-extension://invalid')
  ) {
    const cleanedThumbnail = thumbnail.replace(/&amp;/g, '&');
    thumbnailWithErrorHandling = `<img src="${cleanedThumbnail}" alt="Thumbnail" referrerpolicy="no-referrer" class="card-thumbnail-img" data-original-src="${cleanedThumbnail.replace(
      /"/g,
      '&quot;'
    )}">`;
  } else {
    thumbnailWithErrorHandling = `<div class="no-image">${isVideo ? '▶' : '📄'}</div>`;
  }

  return `
        <a href="${link}" target="_blank" class="content-card" data-content-id="${
          isVideo ? item.videoId : btoa(item.fullLink || item.link || '').replace(/=/g, '')
        }" style="position: relative;">
            <div class="card-thumbnail">
                ${thumbnailWithErrorHandling}
            </div>
            <div class="card-info">
                ${channelNameHtml}
                <div class="card-title">${title}</div>
                ${tagsHtml}
                ${imagesPreviewHtml}
                <div class="card-footer">
                    <span class="card-meta">${dateString}</span>
                    ${metricsSpans}
                </div>
            </div>
            ${actionButtonHtml}
            ${commentAnalysisButton}
        </a>
    `;
}
/**
 * 경쟁사 콘텐츠 통합 렌더링 (여러 경쟁사의 데이터를 합쳐서 필터링, 정렬, 페이징)
 */
function renderCompetitorPaginatedContent(
  listContainer,
  controlsContainer,
  sourceIds,
  allContent,
  platform,
  competitorMap = null,
  trackedUrls = new Map()
) {
  const type = 'competitorChannels';
  const state = viewState[type];
  const isVideo = platform === 'youtube';

  // 여러 경쟁사의 데이터를 합쳐서 필터링
  let filteredContent = allContent.filter(
    (item) => sourceIds.includes(item.sourceId) && (isVideo ? !!item.videoId : !item.videoId)
  );

  // 경쟁 채널 필터 적용
  if (activeChannelFilter) {
    filteredContent = filteredContent.filter((item) => {
      const itemSourceName =
        competitorMap && competitorMap[item.sourceId] ? competitorMap[item.sourceId] : null;
      return itemSourceName === activeChannelFilter;
    });
  }

  // 태그 필터 적용
  if (activeTagFilter) {
    filteredContent = filteredContent.filter(
      (item) => item.tags && item.tags.includes(activeTagFilter)
    );
  }

  // 정렬
  const sortKey = state.sortOrder;
  // [체크리스트 2] 정렬 키(fetchedAt) 누락 방지: Fallback 로직 추가
  filteredContent.sort((a, b) => {
    const timeA = a[sortKey] || a.fetchedAt || a.pubDate || a.publishedAt || 0;
    const timeB = b[sortKey] || b.fetchedAt || b.pubDate || b.publishedAt || 0;
    return timeB - timeA;
  });

  // 페이징
  const totalPages = Math.ceil(filteredContent.length / ITEMS_PER_PAGE);
  if (state.currentPage >= totalPages && totalPages > 0) state.currentPage = totalPages - 1;
  if (state.currentPage < 0) state.currentPage = 0;
  const startIndex = state.currentPage * ITEMS_PER_PAGE;
  const paginatedContent = filteredContent.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // 정렬 옵션
  const sortOptions = isVideo
    ? `
        <option value="fetchedAt" ${
          sortKey === 'fetchedAt' ? 'selected' : ''
        }>최근 수집 순 ✨</option>
        <option value="publishedAt" ${sortKey === 'publishedAt' ? 'selected' : ''}>최신 순</option>
        <option value="viewCount" ${
          sortKey === 'viewCount' ? 'selected' : ''
        }>조회수 높은 순</option>
        <option value="likeCount" ${
          sortKey === 'likeCount' ? 'selected' : ''
        }>좋아요 높은 순</option>
        <option value="commentCount" ${
          sortKey === 'commentCount' ? 'selected' : ''
        }>댓글 많은 순</option>
    `
    : `
        <option value="fetchedAt" ${
          sortKey === 'fetchedAt' ? 'selected' : ''
        }>최근 수집 순 ✨</option>
        <option value="pubDate" ${sortKey === 'pubDate' ? 'selected' : ''}>최신 순</option>
        <option value="commentCount" ${
          sortKey === 'commentCount' ? 'selected' : ''
        }>댓글 많은 순</option>
        <option value="likeCount" ${
          sortKey === 'likeCount' ? 'selected' : ''
        }>좋아요 높은 순</option>
        <option value="textLength" ${
          sortKey === 'textLength' ? 'selected' : ''
        }>분량 많은 순</option>
    `;

  // 경쟁 채널 필터 옵션 생성
  const uniqueChannelNames = competitorMap ? [...new Set(Object.values(competitorMap))].sort() : [];
  const channelFilterOptions =
    uniqueChannelNames.length > 1
      ? `
        <select class="channel-filter-select" data-type="${type}" style="
            padding: 6px 12px;
            border: 1px solid #dadce0;
            border-radius: 6px;
            font-size: 13px;
            background: #fff;
            cursor: pointer;
            margin-right: 8px;
        ">
            <option value="">전체 채널</option>
            ${uniqueChannelNames
              .map(
                (name) => `
                <option value="${name}" ${
                  activeChannelFilter === name ? 'selected' : ''
                }>${name}</option>
            `
              )
              .join('')}
        </select>
    `
      : '';

  // 컨트롤 UI 렌더링
  if (controlsContainer) {
    controlsContainer.innerHTML = `
            <div class="top5-controls" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${channelFilterOptions}
                <select class="top5-sort-select" data-type="${type}">
                    ${sortOptions}
                </select>
                <div class="top5-pagination">
                    <button class="pagination-btn" data-direction="prev" ${
                      state.currentPage === 0 ? 'disabled' : ''
                    }>&lt;</button>
                    <span>${state.currentPage + 1} / ${totalPages}</span>
                    <button class="pagination-btn" data-direction="next" ${
                      state.currentPage >= totalPages - 1 ? 'disabled' : ''
                    }>&gt;</button>
                </div>
            </div>
        `;
  }

  // 콘텐츠 렌더링 (출처 배지 포함)
  if (paginatedContent.length > 0) {
    listContainer.innerHTML = `<div class="content-list">${paginatedContent
      .map((item) => {
        // sourceId를 경쟁사 이름으로 매핑
        const sourceName =
          competitorMap && competitorMap[item.sourceId] ? competitorMap[item.sourceId] : null;
        return createContentCard(item, type, sourceName, trackedUrls);
      })
      .join('')}</div>`;
    listContainer.querySelectorAll('.preview-img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
      img.addEventListener('load', () => {
        if (img.naturalWidth === 0) {
          img.style.display = 'none';
        }
      });
    });

    // [체크리스트 2-C] 모든 외부 이미지 에러 핸들링 (Daum CDN 포함)
    listContainer.querySelectorAll('img').forEach((img) => {
      const imgSrc = img.src || img.dataset.originalSrc || '';

      // [체크리스트 1] chrome-extension://invalid/ 방지: 유효하지 않은 이미지 숨김
      if (!imgSrc || imgSrc === 'undefined' || imgSrc.startsWith('chrome-extension://invalid')) {
        img.style.display = 'none';
        return;
      }

      // 외부 이미지(HTTP/HTTPS)에 대해 에러 핸들링 적용
      if (imgSrc.startsWith('http://') || imgSrc.startsWith('https://')) {
        img.addEventListener(
          'error',
          function (e) {
            const imgEl = e.target;
            // 무한 루프 방지
            if (imgEl.dataset.retry === 'true') {
              imgEl.style.display = 'none';
              return;
            }
            imgEl.dataset.retry = 'true';

            // 원본 URL 가져오기
            const originalUrl = imgEl.dataset.originalSrc || imgEl.src;
            if (!originalUrl || originalUrl.startsWith('data:')) {
              // Base64 이미지는 재시도하지 않음
              imgEl.style.display = 'none';
              return;
            }

            // [체크리스트 2-C] 백그라운드에 Base64 변환 요청
            // [수정] originalUrl 유효성 검사 추가
            if (
              !originalUrl ||
              originalUrl.trim() === '' ||
              originalUrl.startsWith('chrome-extension://invalid')
            ) {
              imgEl.style.display = 'none';
              return;
            }

            chrome.runtime.sendMessage(
              {
                action: 'fetch_image_as_base64',
                url: originalUrl,
              },
              (response) => {
                if (
                  response &&
                  response.success &&
                  response.dataUrl &&
                  response.dataUrl.startsWith('data:')
                ) {
                  imgEl.src = response.dataUrl; // Base64로 교체
                } else {
                  // 실패 시 기본 이미지로 대체 또는 숨김
                  imgEl.style.display = 'none';
                }
              }
            );
          },
          { once: true }
        );
      }
    });
  } else {
    listContainer.innerHTML = `<p class="loading-placeholder">표시할 ${
      isVideo ? '유튜브 영상이' : '블로그 게시물이'
    } 없습니다.</p>`;
    if (controlsContainer) controlsContainer.innerHTML = '';
  }
}

function renderPaginatedContent(
  listContainer,
  controlsContainer,
  sourceId,
  allContent,
  type,
  platform,
  channelName = null,
  trackedUrls = new Map()
) {
  const state = viewState[type];
  const isVideo = platform === 'youtube';

  // 디버깅: 필터링 전 데이터 확인
  console.log(
    `[renderPaginatedContent] 필터링 전 - sourceId: ${sourceId}, allContent.length: ${allContent.length}, platform: ${platform}`
  );

  // sourceId를 URL origin으로 비교 (칸반/스크랩과 동일한 로직)
  let targetUrlOrigin = null;
  try {
    const decodedTargetUrl = atob(sourceId.replace(/=/g, ''));
    targetUrlOrigin = new URL(decodedTargetUrl).origin;
  } catch (e) {
    console.warn(`[renderPaginatedContent] targetSourceId 디코딩 실패:`, e);
  }

  let filteredContent = allContent.filter((item) => {
    if (!item.sourceId) {
      return false;
    }

    // 1. 정확히 일치하는 경우
    if (item.sourceId === sourceId) {
      const videoIdCheck = isVideo ? !!item.videoId : !item.videoId;
      return videoIdCheck;
    }

    // 2. URL origin이 일치하는 경우 (칸반/스크랩과 동일한 로직)
    if (targetUrlOrigin && item.sourceId) {
      try {
        const decodedItemUrl = atob(item.sourceId.replace(/=/g, ''));
        const itemUrlOrigin = new URL(decodedItemUrl).origin;

        if (itemUrlOrigin === targetUrlOrigin) {
          const videoIdCheck = isVideo ? !!item.videoId : !item.videoId;
          if (videoIdCheck) {
            console.debug(`[renderPaginatedContent] URL origin 일치로 포함:`, {
              itemSourceId: item.sourceId.substring(0, 30),
              targetSourceId: sourceId.substring(0, 30),
              origin: itemUrlOrigin,
              title: item.title?.substring(0, 30),
            });
          }
          return videoIdCheck;
        }
      } catch (e) {
        // base64 디코딩 실패 시 무시
      }
    }

    return false;
  });

  console.log(
    `[renderPaginatedContent] 필터링 후 - filteredContent.length: ${filteredContent.length}`
  );
  if (activeTagFilter) {
    filteredContent = filteredContent.filter(
      (item) => item.tags && item.tags.includes(activeTagFilter)
    );
  }
  const sortKey = state.sortOrder;
  // [체크리스트 2] 정렬 키(fetchedAt) 누락 방지: Fallback 로직 추가
  filteredContent.sort((a, b) => {
    const timeA = a[sortKey] || a.fetchedAt || a.pubDate || a.publishedAt || 0;
    const timeB = b[sortKey] || b.fetchedAt || b.pubDate || b.publishedAt || 0;
    return timeB - timeA;
  });
  const totalPages = Math.ceil(filteredContent.length / ITEMS_PER_PAGE);
  if (state.currentPage >= totalPages && totalPages > 0) state.currentPage = totalPages - 1;
  if (state.currentPage < 0) state.currentPage = 0;
  const startIndex = state.currentPage * ITEMS_PER_PAGE;
  const paginatedContent = filteredContent.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const sortOptions = isVideo
    ? `
        <option value="fetchedAt" ${
          sortKey === 'fetchedAt' ? 'selected' : ''
        }>최근 수집 순 ✨</option>
        <option value="publishedAt" ${sortKey === 'publishedAt' ? 'selected' : ''}>최신 순</option>
        <option value="viewCount" ${
          sortKey === 'viewCount' ? 'selected' : ''
        }>조회수 높은 순</option>
        <option value="likeCount" ${
          sortKey === 'likeCount' ? 'selected' : ''
        }>좋아요 높은 순</option>
        <option value="commentCount" ${
          sortKey === 'commentCount' ? 'selected' : ''
        }>댓글 많은 순</option>
    `
    : `
        <option value="fetchedAt" ${
          sortKey === 'fetchedAt' ? 'selected' : ''
        }>최근 수집 순 ✨</option>
        <option value="pubDate" ${sortKey === 'pubDate' ? 'selected' : ''}>최신 순</option>
        <option value="commentCount" ${
          sortKey === 'commentCount' ? 'selected' : ''
        }>댓글 많은 순</option>
        <option value="likeCount" ${
          sortKey === 'likeCount' ? 'selected' : ''
        }>좋아요 높은 순</option>
        <option value="textLength" ${
          sortKey === 'textLength' ? 'selected' : ''
        }>분량 많은 순</option>
    `;
  controlsContainer.innerHTML = `
        <div class="top5-controls">
            <select class="top5-sort-select" data-type="${type}">
                ${sortOptions}
            </select>
            <div class="top5-pagination">
                <button class="pagination-btn" data-direction="prev" ${
                  state.currentPage === 0 ? 'disabled' : ''
                }>&lt;</button>
                <span>${state.currentPage + 1} / ${totalPages}</span>
                <button class="pagination-btn" data-direction="next" ${
                  state.currentPage >= totalPages - 1 ? 'disabled' : ''
                }>&gt;</button>
            </div>
        </div>
    `;
  if (paginatedContent.length > 0) {
    listContainer.innerHTML = `<div class="content-list">${paginatedContent
      .map((item) => createContentCard(item, type, channelName, trackedUrls))
      .join('')}</div>`;
    listContainer.querySelectorAll('.preview-img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
      img.addEventListener('load', () => {
        if (img.naturalWidth === 0) {
          img.style.display = 'none';
        }
      });
    });

    // [체크리스트 2-C] 모든 외부 이미지 에러 핸들링 (Daum CDN 포함)
    listContainer.querySelectorAll('img').forEach((img) => {
      const imgSrc = img.src || img.dataset.originalSrc || '';

      // [체크리스트 1] chrome-extension://invalid/ 방지: 유효하지 않은 이미지 숨김
      if (!imgSrc || imgSrc === 'undefined' || imgSrc.startsWith('chrome-extension://invalid')) {
        img.style.display = 'none';
        return;
      }

      // 외부 이미지(HTTP/HTTPS)에 대해 에러 핸들링 적용
      if (imgSrc.startsWith('http://') || imgSrc.startsWith('https://')) {
        img.addEventListener(
          'error',
          function (e) {
            const imgEl = e.target;
            // 무한 루프 방지
            if (imgEl.dataset.retry === 'true') {
              imgEl.style.display = 'none';
              return;
            }
            imgEl.dataset.retry = 'true';

            // 원본 URL 가져오기
            const originalUrl = imgEl.dataset.originalSrc || imgEl.src;
            if (!originalUrl || originalUrl.startsWith('data:')) {
              // Base64 이미지는 재시도하지 않음
              imgEl.style.display = 'none';
              return;
            }

            // [체크리스트 2-C] 백그라운드에 Base64 변환 요청
            // [수정] originalUrl 유효성 검사 추가
            if (
              !originalUrl ||
              originalUrl.trim() === '' ||
              originalUrl.startsWith('chrome-extension://invalid')
            ) {
              imgEl.style.display = 'none';
              return;
            }

            chrome.runtime.sendMessage(
              {
                action: 'fetch_image_as_base64',
                url: originalUrl,
              },
              (response) => {
                if (
                  response &&
                  response.success &&
                  response.dataUrl &&
                  response.dataUrl.startsWith('data:')
                ) {
                  imgEl.src = response.dataUrl; // Base64로 교체
                } else {
                  // 실패 시 기본 이미지로 대체 또는 숨김
                  imgEl.style.display = 'none';
                }
              }
            );
          },
          { once: true }
        );
      }
    });
  } else {
    listContainer.innerHTML = `<p class="loading-placeholder">표시할 ${
      isVideo ? '유튜브 영상이' : '블로그 게시물이'
    } 없습니다.</p>`;
    controlsContainer.innerHTML = '';
  }
}

// [수정] 중복 렌더링 방지를 위한 디바운싱
let updateDashboardUITimeout = null;
async function updateDashboardUI(container) {
  if (!cachedData) return;

  // [수정] 디바운싱: 100ms 내에 여러 번 호출되면 마지막 호출만 실행
  if (updateDashboardUITimeout) {
    clearTimeout(updateDashboardUITimeout);
  }

  return new Promise((resolve) => {
    updateDashboardUITimeout = setTimeout(async () => {
      await updateDashboardUIInternal(container);
      resolve();
    }, 100);
  });
}

async function updateDashboardUIInternal(container) {
  if (!cachedData) return;

  // [체크리스트 1] 추적 중인 URL 목록 확보 (상태 정보 포함)
  // Map<normalizedUrl, { status, hasPerformance, publishedUrl }>
  const trackedUrls = new Map();
  try {
    const kanbanResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get_all_kanban_data' }, (response) => {
        resolve(response);
      });
    });

    if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
      const kanbanData = kanbanResponse.data;
      const statuses = ['ideas', 'in-progress', 'done'];

      for (const status of statuses) {
        const cards = kanbanData[status] || {};
        for (const cardData of Object.values(cards)) {
          // origin.postUrl: 리뉴얼 원본 URL
          if (cardData.origin?.postUrl) {
            const normalizedUrl = normalizeUrlForTracking(cardData.origin.postUrl);
            if (normalizedUrl) {
              // [수정] performanceTracked 체크 추가: 데이터가 아직 없어도 추적 설정되어 있으면 '추적 중' 표시
              const isTracking = !!(
                cardData.publishedUrl &&
                (cardData.performanceTracked || cardData.performance)
              );
              trackedUrls.set(normalizedUrl, {
                status: status,
                hasPerformance: isTracking, // 변수명은 hasPerformance 유지 (createContentCard 호환성)
                publishedUrl: cardData.publishedUrl || null,
              });
            }
          }
          // publishedUrl: 발행 완료된 URL (origin.postUrl과 다를 수 있음)
          if (cardData.publishedUrl) {
            const normalizedUrl = normalizeUrlForTracking(cardData.publishedUrl);
            if (normalizedUrl) {
              // [수정] performanceTracked 체크 추가
              const isTracking = !!(cardData.performanceTracked || cardData.performance);
              // publishedUrl이 이미 있으면 업데이트, 없으면 추가
              const existing = trackedUrls.get(normalizedUrl);
              if (!existing || status === 'done') {
                trackedUrls.set(normalizedUrl, {
                  status: status,
                  hasPerformance: isTracking,
                  publishedUrl: cardData.publishedUrl,
                });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Dashboard] 칸반 데이터 조회 실패:', error);
  }

  // [신규] 활성 채널 ID 가져오기
  const { activeChannelId } = await chrome.storage.local.get('activeChannelId');

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
    const generateChannelId = (channel) => {
      if (channel.id) return channel.id;
      if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, '');
      if (channel.url) return btoa(channel.url).replace(/=/g, '');
      return null;
    };

    const myBlogs = cachedData.channels.myChannels?.blogs || [];
    const currentChannel = myBlogs.find((blog) => {
      const id = generateChannelId(blog);
      return id && id === activeChannelId;
    });

    if (currentChannel) {
      // 헤더에 현재 채널명 표시
      const headerEl = myCol.querySelector('.dashboard-col-header h2');
      if (headerEl) {
        const channelName = (currentChannel.inputUrl || currentChannel.url || '내 채널').replace(
          /&amp;/g,
          '&'
        );
        headerEl.innerHTML = `🚀 ${channelName}`;
      }

      // sourceId 생성: 실제 저장된 콘텐츠의 sourceId를 찾기
      let sourceId = null;

      // 1. apiUrl이 있으면 직접 사용
      if (currentChannel.apiUrl) {
        sourceId = btoa(currentChannel.apiUrl).replace(/=/g, '');
      }
      // 2. url만 있으면 RSS URL로 변환 후 시도
      else if (currentChannel.url) {
        // RSS URL 변환 (collectorService의 resolveBlogUrlToRss와 동일한 로직)
        const urlObj = new URL(currentChannel.url);
        const host = urlObj.hostname.toLowerCase();
        let rssUrl = null;

        if (host.includes('tistory.com')) {
          rssUrl = `${urlObj.origin}/rss`;
        } else if (host.includes('blog.naver.com')) {
          const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
          if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
            rssUrl = `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
          } else {
            rssUrl = `${urlObj.origin}/rss`;
          }
        } else if (host.includes('wordpress.com') || host.includes('medium.com')) {
          rssUrl = currentChannel.url.endsWith('/')
            ? `${currentChannel.url}feed`
            : `${currentChannel.url}/feed`;
        } else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
          rssUrl = `${urlObj.origin}/feeds/posts/default?alt=rss`;
        } else {
          // 기본값: /feed 추가
          rssUrl = currentChannel.url.endsWith('/')
            ? `${currentChannel.url}feed`
            : `${currentChannel.url}/feed`;
        }

        // RSS URL을 base64 인코딩
        sourceId = btoa(rssUrl).replace(/=/g, '');
      }

      // 3. 실제 콘텐츠에서 sourceId 확인 (fallback)
      // [수정] sourceId가 매칭되지 않는 경우, 모든 콘텐츠의 sourceId를 확인하여 가장 많이 사용된 것을 사용
      if (sourceId && cachedData.content.length > 0) {
        const foundItem = cachedData.content.find((item) => item.sourceId === sourceId);
        if (!foundItem) {
          // sourceId가 매칭되지 않으면, 실제 콘텐츠의 sourceId를 확인
          // 같은 채널의 콘텐츠들 중 가장 많이 사용된 sourceId 찾기
          const sourceIdCounts = {};
          cachedData.content.forEach((item) => {
            if (item.sourceId) {
              sourceIdCounts[item.sourceId] = (sourceIdCounts[item.sourceId] || 0) + 1;
            }
          });

          // 가장 많이 사용된 sourceId 찾기
          let maxCount = 0;
          let mostUsedSourceId = null;
          Object.entries(sourceIdCounts).forEach(([sid, count]) => {
            if (count > maxCount) {
              maxCount = count;
              mostUsedSourceId = sid;
            }
          });

          if (mostUsedSourceId) {
            console.log(
              `[Dashboard] sourceId 매칭 실패, 가장 많이 사용된 sourceId 사용: ${mostUsedSourceId.substring(
                0,
                20
              )}... (예상: ${sourceId?.substring(0, 20) || 'null'}...)`
            );
            sourceId = mostUsedSourceId;
          } else if (cachedData.content.length > 0 && cachedData.content[0].sourceId) {
            // fallback: 첫 번째 콘텐츠의 sourceId 사용
            const actualSourceId = cachedData.content[0].sourceId;
            console.log(
              `[Dashboard] sourceId 매칭 실패, 첫 번째 콘텐츠의 sourceId 사용: ${actualSourceId.substring(
                0,
                20
              )}...`
            );
            sourceId = actualSourceId;
          }
        }
      }

      if (!sourceId) {
        console.error('[Dashboard] sourceId를 생성할 수 없습니다:', currentChannel);
        contentListElement.innerHTML = `<p class="loading-placeholder">채널의 sourceId를 찾을 수 없습니다.<br>채널 설정을 확인해주세요.</p>`;
        return;
      }

      console.log(`[Dashboard] sourceId: ${sourceId}, 콘텐츠 개수: ${cachedData.content.length}`);

      let channelName = null;
      if (cachedData.metas && cachedData.metas[sourceId] && cachedData.metas[sourceId].title) {
        channelName = cachedData.metas[sourceId].title;
      } else {
        channelName =
          currentChannel.inputUrl || currentChannel.url || currentChannel.apiUrl || '내 채널';
      }

      // 데이터 렌더링 (trackedUrls 전달)
      const filteredContent = cachedData.content.filter((item) => item.sourceId === sourceId);
      console.log(`[Dashboard] 필터링된 콘텐츠 개수: ${filteredContent.length}`);
      renderPaginatedContent(
        contentListElement,
        controlsContainer,
        sourceId,
        cachedData.content,
        'myChannels',
        'blog',
        channelName,
        trackedUrls
      );
    } else {
      console.warn(
        '[Dashboard] currentChannel을 찾을 수 없습니다. activeChannelId:',
        activeChannelId
      );
      contentListElement.innerHTML = `<p class="loading-placeholder">선택된 채널 데이터를 찾을 수 없습니다.<br>글로벌 채널 선택기를 확인해주세요.</p>`;
    }
  }

  // 2. 경쟁 채널 설정 ('competitorChannels')
  const compCol = container.querySelector('#competitor-channels-col');
  if (compCol) {
    const controlsWrapper = compCol.querySelector('#competitorChannels-controls');
    if (controlsWrapper) controlsWrapper.style.display = 'none'; // 드롭다운 숨김

    const contentListElement = compCol.querySelector('#competitorChannels-content-list');
    const controlsContainer = compCol.querySelector('#competitorChannels-controls-container');

    const generateChannelId = (channel) => {
      if (channel.id) return channel.id;
      if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, '');
      if (channel.url) return btoa(channel.url).replace(/=/g, '');
      return null;
    };

    const myBlogs = cachedData.channels.myChannels?.blogs || [];
    const currentChannel = myBlogs.find((blog) => {
      const id = generateChannelId(blog);
      return id && id === activeChannelId;
    });

    if (currentChannel && currentChannel.competitors && currentChannel.competitors.length > 0) {
      // 경쟁사들의 sourceId 목록 추출
      // competitors는 URL 문자열 배열이므로, 각 URL을 RSS URL로 변환 후 base64 인코딩
      const compSourceIds = [];
      const competitorMap = {};

      currentChannel.competitors.forEach((compUrl) => {
        // compUrl은 문자열 (URL)
        if (!compUrl || typeof compUrl !== 'string') return;

        // URL을 RSS URL로 변환 (collectorService의 resolveBlogUrlToRss와 동일한 로직)
        let rssUrl = null;
        try {
          const urlObj = new URL(compUrl.startsWith('http') ? compUrl : `https://${compUrl}`);
          const host = urlObj.hostname.toLowerCase();

          if (host.includes('tistory.com')) {
            rssUrl = `${urlObj.origin}/rss`;
          } else if (host.includes('blog.naver.com')) {
            const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
            if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
              rssUrl = `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
            } else {
              rssUrl = `${urlObj.origin}/rss`;
            }
          } else if (host.includes('wordpress.com') || host.includes('medium.com')) {
            rssUrl = compUrl.endsWith('/') ? `${compUrl}feed` : `${compUrl}/feed`;
          } else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
            rssUrl = `${urlObj.origin}/feeds/posts/default?alt=rss`;
          } else {
            // 기본값: /feed 추가
            rssUrl = compUrl.endsWith('/') ? `${compUrl}feed` : `${compUrl}/feed`;
          }
        } catch (e) {
          console.warn('[Dashboard] 경쟁 채널 URL 파싱 실패:', compUrl, e);
          // URL 파싱 실패 시 원본 URL 사용
          rssUrl = compUrl;
        }

        if (rssUrl) {
          const sourceId = btoa(rssUrl).replace(/=/g, '');
          compSourceIds.push(sourceId);

          // 경쟁사 이름: channel_meta의 title 우선, 없으면 도메인 사용
          let compName = null;
          if (cachedData.metas && cachedData.metas[sourceId] && cachedData.metas[sourceId].title) {
            compName = cachedData.metas[sourceId].title;
          } else {
            // title이 없으면 도메인 추출
            try {
              const urlObj = new URL(compUrl.startsWith('http') ? compUrl : `https://${compUrl}`);
              compName = urlObj.hostname.replace('www.', '');
            } catch (e) {
              compName = compUrl;
            }
          }
          competitorMap[sourceId] = compName || '알 수 없는 경쟁사';
          console.log(
            '[Dashboard] 경쟁 채널 파싱 - 이름:',
            compName,
            'sourceId:',
            sourceId,
            'URL:',
            compUrl
          );
        }
      });

      console.log(`[Dashboard] 경쟁 채널 sourceIds: ${compSourceIds.length}개`, compSourceIds);

      // [신규] 현재 활성화된 플랫폼 탭 확인
      const platformTabs = compCol.querySelectorAll('.platform-tab');
      let activePlatform = 'blog'; // 기본값
      platformTabs.forEach((tab) => {
        if (tab.classList.contains('active')) {
          activePlatform = tab.dataset.platform || 'blog';
        }
      });

      // [신규] 경쟁사 통합 렌더링 함수 호출 (필터, 정렬, 페이징, 출처 배지 포함, trackedUrls 전달)
      renderCompetitorPaginatedContent(
        contentListElement,
        controlsContainer,
        compSourceIds,
        cachedData.content,
        activePlatform,
        competitorMap,
        trackedUrls
      );
    } else {
      contentListElement.innerHTML = `<p class="loading-placeholder">등록된 경쟁 채널이 없습니다.<br>채널 관리에서 경쟁사를 추가하세요.</p>`;
      if (controlsContainer) controlsContainer.innerHTML = '';
    }
  }

  // 태그 필터 상태 표시 (기존 로직 유지)
  container.querySelectorAll('.card-tags .tag').forEach((tagEl) => {
    if (activeTagFilter && tagEl.textContent.replace('#', '') === activeTagFilter) {
      tagEl.classList.add('active');
    } else {
      tagEl.classList.remove('active');
    }
  });
}
function renderDashboard(container) {
  // [체크리스트 2-1] 완전 초기화: 이전 채널의 모든 데이터 제거
  container.innerHTML = '';

  // [체크리스트 2-5] AI 분석 리셋: 캐시 초기화
  chrome.storage.local.get(null, (items) => {
    const cacheKeys = Object.keys(items).filter((key) => key.startsWith('dashboard_cache_'));
    cacheKeys.forEach((key) => chrome.storage.local.remove(key));
  });

  container.innerHTML = `
      <div class="dashboard-container">
          <div class="dashboard-grid">
              <div id="my-channels-col" class="dashboard-col">
                  <div class="dashboard-col-header" style="display: flex; align-items: center; justify-content: space-between;">
                      <h2>🚀 내 주요 콘텐츠</h2>
                      <div style="display: flex; align-items: center; gap: 8px;">
                          <button id="refresh-my-channels-btn" class="refresh-channel-btn" title="RSS/채널 데이터 새로고침" style="background: #f8f9fa; color: #5f6368; border: 1px solid #dadce0; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
                              <span>🔄</span>
                              <span>새로고침</span>
                          </button>
                          <button id="add-url-btn" class="add-url-btn" title="URL로 콘텐츠 추가" style="background: #4285f4; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 4px; transition: background 0.2s;">
                              <span>🔗</span>
                              <span>URL로 추가</span>
                          </button>
                      </div>
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
                  <div class="dashboard-col-header" style="display: flex; align-items: center; justify-content: space-between;">
                      <h2>⚔️ 경쟁사 주요 콘텐츠</h2>
                      <button id="refresh-competitor-channels-btn" class="refresh-channel-btn" title="RSS/채널 데이터 새로고침" style="background: #f8f9fa; color: #5f6368; border: 1px solid #dadce0; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
                          <span>🔄</span>
                          <span>새로고침</span>
                      </button>
                  </div>
                  <div class="platform-tabs" data-type="competitorChannels">
                      <div class="platform-tab active" data-platform="blog">블로그</div>
                      <div class="platform-tab" data-platform="youtube">유튜브</div>
                  </div>
                  <div class="dashboard-controls" id="competitorChannels-controls" style="display: none;"></div>
                  <div class="sub-controls-wrapper">
                      <div class="top5-controls-container" id="competitorChannels-controls-container"></div>
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
  chrome.runtime.sendMessage({ action: 'get_channel_content' }, async (response) => {
    if (!response || !response.success) {
      container
        .querySelectorAll('.content-list-area')
        .forEach((list) => (list.innerHTML = '<p>콘텐츠를 불러오지 못했습니다.</p>'));
      return;
    }
    cachedData = response.data;
    await updateDashboardUI(container);
    // DOM이 완전히 렌더링된 후 캐시 복원
    setTimeout(() => {
      initDashboardMode(container);
    }, 100);
  });
}

function addDashboardEventListeners(container) {
  if (container.dataset.listenersAttached) return;
  container.dataset.listenersAttached = 'true';

  // const CACHE_KEY removed: not used in this function to avoid lint warning

  // [수정] 중복 리스너 등록 방지
  if (!container.dataset.messageListenerAttached) {
    container.dataset.messageListenerAttached = 'true';
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
        const contentIndex = cachedData.content.findIndex(
          (item) => (item.videoId || item.fullLink) === (newItem.videoId || newItem.fullLink)
        );
        if (contentIndex > -1) {
          cachedData.content[contentIndex] = newItem;
        } else {
          cachedData.content.unshift(newItem);
        }
        updateDashboardUI(container);
      }
    });
  }

  // [신규] 채널 변경 감지 -> 대시보드 UI 새로고침 및 캐시 복원
  // [수정] 중복 리스너 등록 방지
  if (!container.dataset.storageListenerAttached) {
    container.dataset.storageListenerAttached = 'true';
    chrome.storage.onChanged.addListener(async (changes, namespace) => {
      if (namespace === 'local' && changes.activeChannelId) {
        console.log('[Dashboard] 채널 변경 감지, UI 새로고침');
        // cachedData가 있으면 바로 업데이트, 없으면 데이터 다시 로드
        if (cachedData) {
          await updateDashboardUI(container);
        } else {
          chrome.runtime.sendMessage({ action: 'get_channel_content' }, async (response) => {
            if (response && response.success) {
              cachedData = response.data;
              await updateDashboardUI(container);
            }
          });
        }
        // 채널 변경 시 새로운 채널의 캐시 복원
        setTimeout(() => {
          initDashboardMode(container);
        }, 200);
      }
    });
  }

  // [Phase 2] URL 추가 버튼 클릭 이벤트 (이벤트 위임 사용)
  // 버튼이 동적으로 생성될 수 있으므로 이벤트 위임 사용

  // [신규] RSS/채널 데이터 새로고침 버튼 이벤트
  const refreshMyChannelsBtn = container.querySelector('#refresh-my-channels-btn');
  const refreshCompetitorChannelsBtn = container.querySelector('#refresh-competitor-channels-btn');

  const handleRefreshChannels = async (btn) => {
    if (btn.disabled) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>🔄</span><span>수집 중...</span>';
    btn.style.opacity = '0.6';
    btn.style.cursor = 'not-allowed';

    showToast('RSS/채널 데이터 수집을 시작합니다...');

    try {
      chrome.runtime.sendMessage({ action: 'fetch_all_channel_data' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Dashboard] 새로고침 요청 실패:', chrome.runtime.lastError);
          showToast(`❌ 데이터 수집 요청에 실패했습니다: ${chrome.runtime.lastError.message}`);
          return;
        }
        if (response && response.success !== false) {
          showToast('✅ 데이터 수집이 시작되었습니다. 완료되면 자동으로 업데이트됩니다.');
        } else {
          console.error('[Dashboard] 새로고침 응답 실패:', response);
          showToast(`❌ 데이터 수집 요청에 실패했습니다: ${response?.error || '알 수 없는 오류'}`);
        }
      });
    } catch (error) {
      console.error('[Dashboard] 새로고침 요청 실패:', error);
      showToast(`❌ 데이터 수집 요청에 실패했습니다: ${error.message}`);
    } finally {
      // 3초 후 버튼 상태 복원
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      }, 3000);
    }
  };

  if (refreshMyChannelsBtn) {
    refreshMyChannelsBtn.addEventListener('click', () =>
      handleRefreshChannels(refreshMyChannelsBtn)
    );
    // 호버 효과
    refreshMyChannelsBtn.addEventListener('mouseenter', () => {
      if (!refreshMyChannelsBtn.disabled) {
        refreshMyChannelsBtn.style.background = '#e8f0fe';
        refreshMyChannelsBtn.style.borderColor = '#1a73e8';
      }
    });
    refreshMyChannelsBtn.addEventListener('mouseleave', () => {
      if (!refreshMyChannelsBtn.disabled) {
        refreshMyChannelsBtn.style.background = '#f8f9fa';
        refreshMyChannelsBtn.style.borderColor = '#dadce0';
      }
    });
  }

  if (refreshCompetitorChannelsBtn) {
    refreshCompetitorChannelsBtn.addEventListener('click', () =>
      handleRefreshChannels(refreshCompetitorChannelsBtn)
    );
    // 호버 효과
    refreshCompetitorChannelsBtn.addEventListener('mouseenter', () => {
      if (!refreshCompetitorChannelsBtn.disabled) {
        refreshCompetitorChannelsBtn.style.background = '#e8f0fe';
        refreshCompetitorChannelsBtn.style.borderColor = '#1a73e8';
      }
    });
    refreshCompetitorChannelsBtn.addEventListener('mouseleave', () => {
      if (!refreshCompetitorChannelsBtn.disabled) {
        refreshCompetitorChannelsBtn.style.background = '#f8f9fa';
        refreshCompetitorChannelsBtn.style.borderColor = '#dadce0';
      }
    });
  }

  container.addEventListener('click', (e) => {
    const target = e.target;

    // 새로고침 버튼 클릭 (이벤트 위임)
    if (target.id === 'refresh-my-channels-btn' || target.closest('#refresh-my-channels-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = target.closest('#refresh-my-channels-btn') || target;
      if (btn && !btn.disabled) {
        handleRefreshChannels(btn);
      }
      return;
    }

    if (
      target.id === 'refresh-competitor-channels-btn' ||
      target.closest('#refresh-competitor-channels-btn')
    ) {
      e.preventDefault();
      e.stopPropagation();
      const btn = target.closest('#refresh-competitor-channels-btn') || target;
      if (btn && !btn.disabled) {
        handleRefreshChannels(btn);
      }
      return;
    }

    // URL 추가 버튼 클릭
    if (target.id === 'add-url-btn' || target.closest('#add-url-btn')) {
      e.preventDefault();
      e.stopPropagation();
      showUrlAddModal(container);
      return;
    }

    // URL 추가 모달 닫기
    if (
      target.classList.contains('url-modal-close') ||
      target.classList.contains('url-modal-backdrop')
    ) {
      e.preventDefault();
      e.stopPropagation(); // [피해야 할 동작 방지 2] 이벤트 버블링 방지
      const modal = container.querySelector('#url-add-modal');
      if (modal) {
        // [피해야 할 동작 방지 3] 모달 제거 시 이벤트 리스너 정리
        const urlInput = modal.querySelector('#url-input');
        if (urlInput && modal.dataset.enterKeyHandler === 'attached') {
          // Enter 키 이벤트 리스너는 이미 모달 내부에서 정리됨
        }
        modal.remove();
      }
      return;
    }

    // URL 추가 모달의 가져오기 버튼
    if (target.id === 'url-fetch-btn' || target.closest('#url-fetch-btn')) {
      e.preventDefault();
      e.stopPropagation(); // [피해야 할 동작 방지 2] 이벤트 버블링 방지
      handleUrlFetch(container);
      return;
    }

    // 경쟁 채널 이름 클릭 시 필터 적용
    const channelNameEl = target.closest('.channel-name-clickable');
    if (channelNameEl) {
      e.preventDefault();
      e.stopPropagation();
      const channelName = channelNameEl.dataset.channelName;
      if (channelName) {
        activeChannelFilter = activeChannelFilter === channelName ? null : channelName;
        viewState.competitorChannels.currentPage = 0;
        updateDashboardUI(container);
        return;
      }
    }

    if (target.classList.contains('tag')) {
      e.preventDefault();
      e.stopPropagation();
      const clickedTag = target.textContent.replace('#', '');
      activeTagFilter = activeTagFilter === clickedTag ? null : clickedTag;
      Object.keys(viewState).forEach((key) => (viewState[key].currentPage = 0));
      updateDashboardUI(container);
      return;
    }

    if (target.classList.contains('clear-filter-btn')) {
      activeTagFilter = null;
      updateDashboardUI(container);
      return;
    }

    const handleAnalysis = async (action, content, isMyChannel, ideasContent, callback) => {
      const message = isMyChannel
        ? 'AI가 내 채널의 성공 요인을 분석 중입니다... 📈'
        : 'AI가 경쟁 채널을 분석하여 새로운 아이디어를 생성 중입니다... 🧠';
      ideasContent.innerHTML = `<p class="ai-ideas-placeholder">${message}</p>`;

      const CACHE_KEY = await getCacheKey();

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
            chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
              console.log('[Dashboard] 캐시 저장 완료:', CACHE_KEY);
            });
          });
          renderAnalysisResult(ideasContent, analysisText, isMyChannel);
          if (callback) callback(response);
        } else {
          ideasContent.innerHTML = `<p class="ai-ideas-placeholder">분석 중 오류: ${
            response.error || ''
          }</p>`;
        }
      });
    };

    if (target.closest('#unified-analyze-btn')) {
      // [수정] 복잡한 데이터 수집 로직 제거 -> activeChannelId만 전송
      chrome.storage.local.get('activeChannelId', (res) => {
        const activeChannelId = res.activeChannelId;

        if (!activeChannelId) {
          alert('분석할 채널이 선택되지 않았습니다. 상단의 글로벌 채널 선택기를 확인해주세요.');
          return;
        }

        // UI 업데이트 (로딩 표시)
        const myAnalysisContentEl = container.querySelector('#my-analysis-content');
        const competitorAnalysisContentEl = container.querySelector('#competitor-analysis-content');

        myAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder">AI가 현재 채널의 성과를 분석 중입니다... 📈</p>`;
        container.querySelector('#competitor-analysis-section').style.display = 'block';
        competitorAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder">경쟁 채널 데이터를 수집하고 있습니다...</p>`;

        // 백그라운드에 분석 요청 (채널 ID만 전달)
        chrome.runtime.sendMessage(
          {
            action: 'generate_blog_ideas',
            activeChannelId: activeChannelId,
          },
          async (response) => {
            if (response && response.success) {
              // 캐시에 저장
              const CACHE_KEY = await getCacheKey();
              chrome.storage.local.get(CACHE_KEY, (result) => {
                let cache = result[CACHE_KEY] || {};
                cache.myAnalysisResult = response.analysis;
                cache.competitorAnalysisResult = response.ideas;
                if (response.keywordGap) {
                  cache.keywordGap = response.keywordGap;
                }
                if (response.analysis) {
                  cache.myAnalysisSummary = response.analysis.split(/###|\n##|\n\d\./)[0].trim();
                }
                chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                  console.log('[Dashboard] 통합 분석 결과 캐시 저장 완료:', CACHE_KEY);
                });
              });

              // 1. 성과 분석 결과 렌더링
              renderAnalysisResult(myAnalysisContentEl, response.analysis, true);

              // 2. 아이디어 제안 결과 렌더링 (키워드 갭 정보 포함)
              renderAnalysisResult(
                competitorAnalysisContentEl,
                response.ideas,
                false,
                response.keywordGap
              );
            } else {
              const errorMsg = response?.error || '알 수 없는 오류';
              myAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder error">분석 실패: ${errorMsg}</p>`;
              competitorAnalysisContentEl.innerHTML = `<p class="ai-ideas-placeholder error">분석 실패</p>`;
            }
          }
        );
      });
      return;
    }

    // 성과 등록 버튼 클릭 (바로 발행 완료 컬럼에 추가)
    if (target.closest('.track-post-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const button = target.closest('.track-post-btn');
      const post = JSON.parse(button.dataset.postObject);
      // const channelType = button.dataset.channelType; // unused

      // 채널 이름 추출: 메타데이터 우선, 없으면 도메인 사용
      let channelName = null;
      if (
        cachedData?.metas &&
        cachedData.metas[post.sourceId] &&
        cachedData.metas[post.sourceId].title
      ) {
        channelName = cachedData.metas[post.sourceId].title;
      } else if (post.fullLink || post.link) {
        try {
          const urlObj = new URL(post.fullLink || post.link);
          channelName = urlObj.hostname.replace('www.', '');
        } catch (e) {
          channelName = '알 수 없는 채널';
        }
      } else {
        channelName = '알 수 없는 채널';
      }

      console.log(
        '[Dashboard] 성과 추적 추가 - 채널 이름:',
        channelName,
        'sourceId:',
        post.sourceId
      );

      const ideaForTracking = {
        title: post.title, // [리뉴얼] 접두어 없이 원본 제목 그대로
        description: post.cleanText || post.description || '', // 내용은 참고용
        publishedUrl: post.fullLink || post.link, // 👈 핵심: 원본 URL을 발행 URL로 설정
        keywords: post.tags || [],
        origin: {
          type: 'tracking_only', // 성과 추적 전용
          channelName: channelName,
          postUrl: post.fullLink || post.link,
        },
      };

      // [수정] 현재 활성 채널 ID를 가져와서 함께 전송
      chrome.storage.local.get('activeChannelId', (res) => {
        const channelId = res.activeChannelId || null;

        chrome.runtime.sendMessage(
          {
            action: 'add_idea_to_kanban',
            data: JSON.stringify(ideaForTracking),
            status: 'done', // 👈 핵심: 바로 '발행 완료'로 보냄
            channelId: channelId,
          },
          (response) => {
            if (response && response.success) {
              showToast(`"${post.title}"이(가) 성과 추적 목록에 추가되었습니다.`, 'success');

              // [체크리스트 4] 추가 직후 UI 업데이트: 버튼 제거하고 card-channel-name 영역에 배지 추가
              const card = button.closest('.content-card');
              if (card) {
                // 모든 버튼 제거 (리뉴얼 버튼도 함께)
                const addBtn = card.querySelector('.add-post-to-kanban-btn');
                if (addBtn) addBtn.remove();
                button.remove();

                // card-channel-name 영역 찾기 또는 생성
                let channelNameDiv = card.querySelector('.card-channel-name');
                if (!channelNameDiv) {
                  const cardInfo = card.querySelector('.card-info');
                  if (cardInfo) {
                    channelNameDiv = document.createElement('div');
                    channelNameDiv.className = 'card-channel-name';
                    channelNameDiv.style.cssText = `
                                        margin-bottom: 6px;
                                        display: flex;
                                        align-items: center;
                                        justify-content: flex-end;
                                        height: 18px;
                                    `;
                    const cardTitle = cardInfo.querySelector('.card-title');
                    if (cardTitle) {
                      cardInfo.insertBefore(channelNameDiv, cardTitle);
                    } else {
                      cardInfo.insertBefore(channelNameDiv, cardInfo.firstChild);
                    }
                  }
                }

                // 상태 배지 추가 (성과 추적 중)
                if (channelNameDiv) {
                  const statusBadge = document.createElement('div');
                  statusBadge.className = 'status-badge';
                  statusBadge.style.cssText = `
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 2px;
                                    padding: 1px 4px;
                                    background: #e8f5e9;
                                    color: #2e7d32;
                                    border-radius: 3px;
                                    font-size: 10px;
                                    font-weight: 500;
                                    line-height: 1.2;
                                    margin-left: auto;
                                    height: 18px;
                                `;
                  statusBadge.textContent = '✅ 추적 중';
                  statusBadge.title = '발행 완료 및 성과 추적 중입니다';
                  channelNameDiv.appendChild(statusBadge);
                }
              }

              // trackedUrls에 추가 (다음 렌더링 시 반영)
              setTimeout(() => {
                updateDashboardUI(container);
              }, 300);
            } else {
              // 중복 검사 실패 시 친절한 메시지 표시
              if (response?.code === 'DUPLICATE_FOUND') {
                const statusText =
                  response.cardInfo?.status === 'ideas'
                    ? '기획'
                    : response.cardInfo?.status === 'in-progress'
                      ? '작성 중'
                      : response.cardInfo?.status === 'done'
                        ? '발행 완료'
                        : response.cardInfo?.status || '알 수 없음';
                showToast(
                  `⚠️ 이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${
                    response.cardInfo?.title || '알 수 없음'
                  }`,
                  'warning'
                );
              } else {
                showToast(
                  `❌ 성과 등록 실패: ${response?.error || response?.message || '알 수 없는 오류'}`,
                  'error'
                );
              }
            }
          }
        );
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
        title: channelType === 'myChannels' ? `[리뉴얼] ${post.title}` : `[벤치마킹] ${post.title}`,
        description: post.cleanText || post.description || '',
        keywords: post.tags || [],
        origin: {
          type: channelType === 'myChannels' ? 'my_post' : 'competitor_post',
          channelName: channelName,
          postUrl: post.fullLink || post.link,
        },
      };

      // [수정] 현재 활성 채널 ID를 가져와서 함께 전송
      chrome.storage.local.get('activeChannelId', (res) => {
        const channelId = res.activeChannelId || null;

        chrome.runtime.sendMessage(
          {
            action: 'add_idea_to_kanban',
            data: JSON.stringify(ideaForKanban),
            channelId: channelId, // 👈 추가됨
          },
          (response) => {
            if (response && response.success) {
              showToast(`"${post.title}"이(가) 기획 보드에 추가되었습니다.`, 'success');

              // [체크리스트 4] 추가 직후 UI 업데이트: 버튼 제거하고 card-channel-name 영역에 배지 추가
              const card = button.closest('.content-card');
              if (card) {
                // 버튼 제거
                button.remove();

                // card-channel-name 영역 찾기 또는 생성
                let channelNameDiv = card.querySelector('.card-channel-name');
                if (!channelNameDiv) {
                  // card-channel-name이 없으면 생성
                  const cardInfo = card.querySelector('.card-info');
                  if (cardInfo) {
                    channelNameDiv = document.createElement('div');
                    channelNameDiv.className = 'card-channel-name';
                    channelNameDiv.style.cssText = `
                                        margin-bottom: 6px;
                                        display: flex;
                                        align-items: center;
                                        justify-content: flex-end;
                                        height: 18px;
                                    `;
                    const cardTitle = cardInfo.querySelector('.card-title');
                    if (cardTitle) {
                      cardInfo.insertBefore(channelNameDiv, cardTitle);
                    } else {
                      cardInfo.insertBefore(channelNameDiv, cardInfo.firstChild);
                    }
                  }
                }

                // 상태 배지 추가 (아이디어 추가 직후이므로 "기획 중"으로 표시)
                if (channelNameDiv) {
                  const statusBadge = document.createElement('div');
                  statusBadge.className = 'status-badge';
                  statusBadge.style.cssText = `
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 2px;
                                    padding: 1px 4px;
                                    background: #e3f2fd;
                                    color: #1976d2;
                                    border-radius: 3px;
                                    font-size: 10px;
                                    font-weight: 500;
                                    line-height: 1.2;
                                    margin-left: auto;
                                    height: 18px;
                                `;
                  statusBadge.textContent = '📝 기획 중';
                  statusBadge.title = '기획 보드에 등록되어 있습니다';
                  channelNameDiv.appendChild(statusBadge);
                }
              }

              // trackedUrls에 추가 (다음 렌더링 시 반영)
              // 또는 즉시 updateDashboardUI 호출하여 전체 새로고침
              setTimeout(() => {
                updateDashboardUI(container);
              }, 300);
            } else {
              // 중복 검사 실패 시 친절한 메시지 표시
              if (response?.code === 'DUPLICATE_FOUND') {
                const statusText =
                  response.cardInfo?.status === 'ideas'
                    ? '기획'
                    : response.cardInfo?.status === 'in-progress'
                      ? '작성 중'
                      : response.cardInfo?.status === 'done'
                        ? '발행 완료'
                        : response.cardInfo?.status || '알 수 없음';
                showToast(
                  `⚠️ 이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${
                    response.cardInfo?.title || '알 수 없음'
                  }`,
                  'warning'
                );
              } else {
                showToast(
                  `❌ 기획 보드 추가 실패: ${
                    response?.error || response?.message || '알 수 없는 오류'
                  }`,
                  'error'
                );
              }
            }
          }
        );
      });
      return;
    }

    if (target.closest('.add-to-kanban-btn')) {
      const ideaCard = target.closest('.ai-idea-card');
      const ideaObjectString = ideaCard.dataset.ideaObject;
      const ideaIndex = ideaCard.dataset.ideaIndex; // index may be used later

      // ▼▼▼ [수정] AI 아이디어 제안에 origin 필드 추가 ▼▼▼
      // AI 아이디어 제안은 ai_generated로 분류하여 브리핑 자동 생성되도록 함
      let ideaData = JSON.parse(ideaObjectString);
      if (!ideaData.origin) {
        ideaData.origin = { type: 'ai_generated' };
      }
      if (!ideaData.keywords && !ideaData.tags) {
        ideaData.keywords = ['#AI-추천'];
      }
      const modifiedIdeaString = JSON.stringify(ideaData);
      // ▲▲▲ [수정 완료] ▲▲▲

      // [수정] 현재 활성 채널 ID를 가져와서 함께 전송
      (async () => {
        const channelId =
          (await chrome.storage.local.get('activeChannelId')).activeChannelId || null;
        const CACHE_KEY = await getCacheKey();

        chrome.runtime.sendMessage(
          {
            action: 'add_idea_to_kanban',
            data: modifiedIdeaString,
            channelId: channelId, // 👈 추가됨 (AI 아이디어는 현재 활성 채널에 귀속)
          },
          (response) => {
            if (response && response.success) {
              const ideaData = JSON.parse(ideaObjectString);
              const ideaTitle = ideaData.title;
              // [체크리스트 2] 제목 기반 저장 (ideaIndex 제거)
              const newIdea = {
                firebaseKey: response.firebaseKey,
                title: ideaTitle,
              };
              const normalizedTitle = normalizeTitleForMatching(ideaTitle);

              // ▼▼▼ 수정된 상태 관리 로직 ▼▼▼
              // 1. 항상 storage에서 최신 데이터를 가져옵니다.
              chrome.storage.local.get(CACHE_KEY, (result) => {
                let cache = result[CACHE_KEY] || {};
                let ideas = cache.addedIdeas || [];

                // 2. [체크리스트 2] 제목 기반 중복 확인
                if (
                  !ideas.some((idea) => {
                    const existingTitle = normalizeTitleForMatching(idea.title);
                    return existingTitle === normalizedTitle;
                  })
                ) {
                  ideas.push(newIdea);
                }
                cache.addedIdeas = ideas;

                // 3. storage에 데이터를 저장하고, 저장이 완료된 후 UI를 업데이트합니다.
                chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                  console.log('[Dashboard] addedIdeas 캐시 저장 완료:', CACHE_KEY);
                  // [체크리스트 4] UI 상태 즉시 반영
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
                    newItem.dataset.ideaTitle = ideaTitle.replace(/"/g, '&quot;');
                    newItem.innerHTML = `<span>${ideaTitle}</span><button class="undo-add-btn">실행 취소</button>`;
                    recentlyAddedList.prepend(newItem);
                  }
                });
              });
            } else {
              // 중복 검사 실패 시 친절한 메시지 표시
              if (response?.code === 'DUPLICATE_FOUND') {
                const statusText =
                  response.cardInfo?.status === 'ideas'
                    ? '기획'
                    : response.cardInfo?.status === 'in-progress'
                      ? '작성 중'
                      : response.cardInfo?.status === 'done'
                        ? '발행 완료'
                        : response.cardInfo?.status || '알 수 없음';
                showToast(
                  `⚠️ 이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${
                    response.cardInfo?.title || '알 수 없음'
                  }`,
                  'warning'
                );
              } else {
                showToast(
                  '❌ 기획 보드 추가 실패: ' +
                    (response?.error || response?.message || '알 수 없는 오류'),
                  'error'
                );
              }
            }
          }
        );
      })();
      return;
    }

    if (target.closest('.undo-add-btn')) {
      const listItem = target.closest('li');
      const firebaseKey = listItem.dataset.firebaseKey;
      const ideaTitle =
        listItem.dataset.ideaTitle || listItem.querySelector('span')?.textContent || '';

      (async () => {
        const CACHE_KEY = await getCacheKey();

        chrome.runtime.sendMessage(
          { action: 'remove_idea_from_kanban', key: firebaseKey },
          (response) => {
            if (response && response.success) {
              // ▼▼▼ 수정된 상태 관리 로직 ▼▼▼
              chrome.storage.local.get(CACHE_KEY, (result) => {
                let cache = result[CACHE_KEY] || {};
                let ideas = cache.addedIdeas || [];

                // [체크리스트 2] 제목 기반으로 아이디어를 배열에서 제거
                const normalizedTitle = normalizeTitleForMatching(ideaTitle);
                cache.addedIdeas = ideas.filter((idea) => {
                  const existingTitle = normalizeTitleForMatching(idea.title);
                  return existingTitle !== normalizedTitle;
                });

                // 데이터를 저장하고, 저장이 완료된 후 UI를 업데이트합니다.
                chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
                  console.log('[Dashboard] addedIdeas 캐시 업데이트 완료:', CACHE_KEY);
                  // UI 업데이트 로직
                  listItem.remove();

                  // [체크리스트 2] 제목 기반으로 원본 카드 찾기
                  if (normalizedTitle) {
                    const allIdeaCards = container.querySelectorAll('.ai-idea-card');
                    allIdeaCards.forEach((card) => {
                      const cardTitle = card.dataset.ideaTitle || '';
                      const normalizedCardTitle = normalizeTitleForMatching(cardTitle);
                      if (normalizedCardTitle === normalizedTitle) {
                        const button = card.querySelector('.add-to-kanban-btn');
                        if (button) {
                          button.disabled = false;
                          button.textContent = '📌 기획 보드에 추가';
                        }
                      }
                    });
                  }

                  const recentlyAddedList = container.querySelector('#recently-added-list');
                  if (recentlyAddedList && recentlyAddedList.children.length === 0) {
                    recentlyAddedList.innerHTML = `<li class="recent-add-placeholder">아이디어를 기획 보드에 추가하면 여기에 표시됩니다.</li>`;
                  }
                });
              });
            } else {
              alert('아이디어 삭제 실패: ' + (response?.error || '알 수 없는 오류'));
            }
          }
        );
      })();
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

  container.addEventListener('change', (e) => {
    const target = e.target;
    if (
      target.classList.contains('channel-selector') ||
      target.classList.contains('top5-sort-select') ||
      target.classList.contains('channel-filter-select')
    ) {
      const col = target.closest('.dashboard-col');
      const type = col.id.includes('my-channels') ? 'myChannels' : 'competitorChannels';
      if (target.classList.contains('top5-sort-select')) {
        viewState[type].sortOrder = target.value;
      } else if (target.classList.contains('channel-filter-select')) {
        activeChannelFilter = target.value || null;
      }
      viewState[type].currentPage = 0;
      updateDashboardUI(container);
    }
  });
}

/**
 * [Phase 2] URL 추가 모달 표시
 */
function showUrlAddModal(container) {
  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector('#url-add-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'url-add-modal';
  modal.innerHTML = `
        <div class="url-modal-backdrop"></div>
        <div class="url-modal-content">
            <div class="url-modal-header">
                <h3>🔗 URL로 콘텐츠 추가</h3>
                <button class="url-modal-close">×</button>
            </div>
            <div class="url-modal-body">
                <div class="url-input-wrapper">
                    <input type="text" id="url-input" class="url-input" placeholder="블로그 포스팅 또는 YouTube 영상 URL을 입력하세요..." autofocus>
                    <button id="url-fetch-btn" class="url-fetch-btn">가져오기</button>
                </div>
                <div id="url-preview-area" class="url-preview-area" style="display: none;"></div>
                <div id="url-error-area" class="url-error-area" style="display: none;"></div>
            </div>
        </div>
    `;

  // 스타일 추가 (인라인으로)
  modal.style.cssText =
    'position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;';
  const backdrop = modal.querySelector('.url-modal-backdrop');
  backdrop.style.cssText = 'position: absolute; inset: 0; background: rgba(0,0,0,0.5);';
  const modalContent = modal.querySelector('.url-modal-content');
  modalContent.style.cssText =
    'position: relative; background: white; border-radius: 12px; width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 12px 40px rgba(0,0,0,0.25); z-index: 1;';
  const modalHeader = modal.querySelector('.url-modal-header');
  modalHeader.style.cssText =
    'display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #e0e0e0;';
  modalHeader.querySelector('h3').style.cssText = 'margin: 0; font-size: 18px; font-weight: 600;';
  const closeBtn = modal.querySelector('.url-modal-close');
  closeBtn.style.cssText =
    'background: none; border: none; font-size: 24px; cursor: pointer; color: #666; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;';
  closeBtn.addEventListener('mouseover', () => (closeBtn.style.background = '#f0f0f0'));
  closeBtn.addEventListener('mouseout', () => (closeBtn.style.background = 'none'));
  const modalBody = modal.querySelector('.url-modal-body');
  modalBody.style.cssText = 'padding: 20px;';
  const inputWrapper = modal.querySelector('.url-input-wrapper');
  inputWrapper.style.cssText = 'display: flex; gap: 8px; margin-bottom: 16px;';
  const urlInput = modal.querySelector('#url-input');
  urlInput.style.cssText =
    'flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;';
  const fetchBtn = modal.querySelector('#url-fetch-btn');
  fetchBtn.style.cssText =
    'padding: 12px 24px; background: #4285f4; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;';
  fetchBtn.addEventListener('mouseover', () => (fetchBtn.style.background = '#357ae8'));
  fetchBtn.addEventListener('mouseout', () => (fetchBtn.style.background = '#4285f4'));

  container.appendChild(modal);

  // [Phase 2] 클립보드 감지 또는 포커스
  urlInput.focus();
  navigator.clipboard
    .readText()
    .then((text) => {
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        urlInput.value = text;
      }
    })
    .catch(() => {});

  // [피해야 할 동작 방지] Enter 키 이벤트 리스너 (모달 제거 시 자동 정리되도록 모달에 저장)
  const enterKeyHandler = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleUrlFetch(container);
    }
  };
  urlInput.addEventListener('keypress', enterKeyHandler);
  modal.dataset.enterKeyHandler = 'attached'; // 플래그로 표시

  // [피해야 할 동작 방지] 모달 닫기 시 이벤트 리스너 정리 함수
  const cleanupModal = () => {
    urlInput.removeEventListener('keypress', enterKeyHandler);
    modal.remove();
  };
  modal.dataset.cleanup = 'true';

  // 모달 닫기 버튼에 정리 함수 연결
  closeBtn.addEventListener('click', cleanupModal);
  backdrop.addEventListener('click', cleanupModal);
}

/**
 * [Phase 2] URL 가져오기 처리
 */
function handleUrlFetch(container) {
  const modal = container.querySelector('#url-add-modal');
  if (!modal) {
    console.error('[Dashboard] URL 추가 모달을 찾을 수 없습니다.');
    return; // 모달이 없으면 종료
  }

  const urlInput = modal.querySelector('#url-input');
  const fetchBtn = modal.querySelector('#url-fetch-btn');
  const previewArea = modal.querySelector('#url-preview-area');
  const errorArea = modal.querySelector('#url-error-area');

  if (!urlInput || !fetchBtn || !previewArea || !errorArea) {
    console.error('[Dashboard] URL 추가 모달의 필수 요소를 찾을 수 없습니다.', {
      urlInput,
      fetchBtn,
      previewArea,
      errorArea,
    });
    return;
  }

  // [피해야 할 동작 방지 1] 중복 요청 방지: 이미 진행 중인 요청이 있으면 차단
  if (fetchBtn.disabled || modal.dataset.fetching === 'true') {
    return;
  }

  const url = urlInput.value.trim();

  // 유효성 검사
  if (!url) {
    errorArea.style.display = 'block';
    errorArea.innerHTML =
      '<div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px;">URL을 입력해주세요.</div>';
    previewArea.style.display = 'none';
    return;
  }

  try {
    new URL(url);
  } catch (e) {
    errorArea.style.display = 'block';
    errorArea.innerHTML =
      '<div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px;">유효한 URL 형식이 아닙니다.</div>';
    previewArea.style.display = 'none';
    return;
  }

  // [피해야 할 동작 방지 1] 요청 진행 중 플래그 설정
  modal.dataset.fetching = 'true';

  // 로딩 상태
  fetchBtn.disabled = true;
  fetchBtn.textContent = '수집 중...';
  previewArea.style.display = 'none';
  errorArea.style.display = 'none';

  // [체크리스트 1] 현재 활성 채널의 sourceId 가져오기
  chrome.storage.local.get('activeChannelId', async (res) => {
    const activeChannelId = res.activeChannelId;
    let channelSourceId = null;

    // [체크리스트 2] 채널이 선택되지 않았을 때 에러 표시
    if (!activeChannelId) {
      modal.dataset.fetching = 'false';
      fetchBtn.disabled = false;
      fetchBtn.textContent = '가져오기';
      errorArea.style.display = 'block';
      errorArea.innerHTML =
        '<div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px;">활성 채널이 선택되지 않았습니다. 상단의 글로벌 채널 선택기에서 채널을 선택한 후 다시 시도해주세요.</div>';
      return;
    }

    if (activeChannelId && cachedData && cachedData.channels) {
      const generateChannelId = (channel) => {
        if (channel.id) return channel.id;
        if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, '');
        if (channel.url) return btoa(channel.url).replace(/=/g, '');
        return null;
      };

      const myBlogs = cachedData.channels.myChannels?.blogs || [];
      const currentChannel = myBlogs.find((blog) => {
        const id = generateChannelId(blog);
        return id && id === activeChannelId;
      });

      if (currentChannel && currentChannel.apiUrl) {
        channelSourceId = btoa(currentChannel.apiUrl).replace(/=/g, '');
      } else if (currentChannel && currentChannel.url) {
        // apiUrl이 없으면 url을 RSS URL로 변환 후 인코딩
        const urlObj = new URL(currentChannel.url);
        const host = urlObj.hostname.toLowerCase();
        let rssUrl = null;

        if (host.includes('tistory.com')) {
          rssUrl = `${urlObj.origin}/rss`;
        } else if (host.includes('blog.naver.com')) {
          const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
          if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
            rssUrl = `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
          } else {
            rssUrl = `${urlObj.origin}/rss`;
          }
        } else {
          rssUrl = currentChannel.url.endsWith('/')
            ? `${currentChannel.url}feed`
            : `${currentChannel.url}/feed`;
        }

        channelSourceId = btoa(rssUrl).replace(/=/g, '');
      }
    }

    // [체크리스트 2] sourceId를 찾지 못했을 때 경고 (하지만 channelId는 있으므로 계속 진행)
    if (!channelSourceId && activeChannelId) {
      console.warn('[URL 추가] sourceId를 찾지 못했지만 channelId로 진행합니다:', activeChannelId);
    } else {
      console.log(`[URL 추가] 계산된 sourceId: ${channelSourceId?.substring(0, 20) || 'null'}...`);
    }

    // 백엔드로 요청 (channelId 포함)
    chrome.runtime.sendMessage(
      {
        action: 'fetch_and_save_single_post',
        url,
        channelId: activeChannelId,
        sourceId: channelSourceId, // 현재 채널의 sourceId 전달
      },
      (response) => {
        // [피해야 할 동작 방지 1] 요청 완료 플래그 해제
        if (modal) modal.dataset.fetching = 'false';

        fetchBtn.disabled = false;
        fetchBtn.textContent = '가져오기';

        if (!response) {
          errorArea.style.display = 'block';
          errorArea.innerHTML =
            '<div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px;">응답을 받을 수 없습니다.</div>';
          return;
        }

        if (response.success) {
          // [Phase 2] 미리보기 표시
          const data = response.data;
          previewArea.style.display = 'block';
          previewArea.innerHTML = `
                <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-top: 16px;">
                    <div style="display: flex; gap: 12px;">
                        ${
                          data.thumbnail &&
                          data.thumbnail !== 'undefined' &&
                          !data.thumbnail.startsWith('chrome-extension://invalid')
                            ? `<img src="${data.thumbnail.replace(
                                /&amp;/g,
                                '&'
                              )}" style="width: 120px; height: 90px; object-fit: cover; border-radius: 6px;" alt="썸네일" referrerpolicy="no-referrer" data-original-src="${data.thumbnail.replace(
                                /"/g,
                                '&quot;'
                              )}" onerror="this.style.display='none';">`
                            : ''
                        }
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">${
                              data.title || '제목 없음'
                            }</h4>
                            <p style="margin: 0; color: #666; font-size: 13px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${
                              data.description || data.cleanText?.substring(0, 100) || ''
                            }</p>
                        </div>
                    </div>
                </div>
            `;

          // [Phase 2] 리스트 갱신 및 피드백
          // [수정] 로컬 캐시에 추가하는 대신 서버에서 최신 데이터를 다시 가져오기
          // 이렇게 하면 sourceId가 정확히 일치하여 필터링 문제를 방지할 수 있음
          // 약간의 지연을 두어 Firebase에 데이터가 완전히 저장되도록 함
          setTimeout(() => {
            chrome.runtime.sendMessage(
              { action: 'get_channel_content' },
              async (refreshResponse) => {
                if (refreshResponse && refreshResponse.success) {
                  cachedData = refreshResponse.data;

                  // 디버깅: 저장된 데이터의 sourceId 확인
                  const savedItem = refreshResponse.data.content.find((item) => {
                    const itemUrl = item.fullLink || item.link || '';
                    return itemUrl === url || itemUrl === data.fullLink;
                  });
                  if (savedItem) {
                    console.log(
                      `[URL 추가] 저장된 데이터의 sourceId: ${
                        savedItem.sourceId?.substring(0, 20) || 'null'
                      }...`
                    );
                  } else {
                    console.warn(`[URL 추가] 저장된 데이터를 찾을 수 없습니다. URL: ${url}`);
                  }

                  // [체크리스트] URL 추가 성공 시 자동 정렬 전환
                  const type = 'myChannels';
                  viewState[type].sortOrder = 'fetchedAt'; // 최근 수집 순으로 정렬 기준 변경
                  viewState[type].currentPage = 0; // 1페이지로 이동

                  await updateDashboardUI(container);

                  // 시각적 강조 (Flash 효과)
                  setTimeout(() => {
                    const contentId = data.videoId || btoa(data.fullLink || url).replace(/=/g, '');
                    const newCard = container.querySelector(`[data-content-id="${contentId}"]`);
                    if (!newCard) {
                      // contentId 속성이 없을 수 있으므로 다른 방법으로 찾기
                      const allCards = container.querySelectorAll('.content-card');
                      if (allCards.length > 0) {
                        const firstCard = allCards[0];
                        firstCard.style.transition = 'background-color 0.3s';
                        firstCard.style.backgroundColor = '#e8f5e9';
                        setTimeout(() => {
                          firstCard.style.backgroundColor = '';
                        }, 2000);
                      }
                    } else {
                      newCard.style.transition = 'background-color 0.3s';
                      newCard.style.backgroundColor = '#e8f5e9';
                      setTimeout(() => {
                        newCard.style.backgroundColor = '';
                      }, 2000);
                    }
                  }, 100);
                } else {
                  // 데이터 새로고침 실패 시 로컬 캐시에 추가 (fallback)
                  console.warn('[URL 추가] 데이터 새로고침 실패, 로컬 캐시에 추가');
                  if (cachedData && cachedData.content) {
                    cachedData.content.unshift(data);
                    updateDashboardUI(container);
                  }
                }
              }
            );
          }, 500); // Firebase 저장 완료 대기

          showToast('✅ 콘텐츠가 추가되었습니다.');

          // 모달 닫기
          setTimeout(() => {
            const modal = container.querySelector('#url-add-modal');
            if (modal) {
              // [피해야 할 동작 방지 3] 모달 제거 시 이벤트 리스너 정리
              modal.remove();
            }
          }, 1500);
        } else if (response.code === 'DUPLICATE_FOUND') {
          // [Phase 2] 중복 에러 핸들링
          const cardInfo = response.cardInfo;
          errorArea.style.display = 'block';
          errorArea.innerHTML = `
                <div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px; margin-bottom: 8px;">
                    이미 <strong>[${cardInfo.statusLabel}]</strong> 탭에 등록된 포스팅입니다.
                </div>
                <button id="go-to-card-btn" style="padding: 8px 16px; background: #4285f4; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    해당 카드로 이동
                </button>
            `;

          // 해당 카드로 이동 버튼
          const goToCardBtn = errorArea.querySelector('#go-to-card-btn');
          goToCardBtn.addEventListener('click', () => {
            // 기획 보드로 이동하고 해당 카드 선택
            const shadowRoot =
              container.closest('#content-pilot-host')?.shadowRoot ||
              document.querySelector('#content-pilot-host')?.shadowRoot;
            if (shadowRoot) {
              const kanbanTab = shadowRoot.querySelector('[data-key="kanban"]');
              if (kanbanTab) {
                kanbanTab.click();
                // 카드 선택 로직은 kanbanMode.js에서 처리
                setTimeout(() => {
                  chrome.runtime.sendMessage({
                    action: 'highlight_kanban_card',
                    cardId: cardInfo.cardId,
                    status: cardInfo.status,
                  });
                }, 300);
              }
            }
            const modal = container.querySelector('#url-add-modal');
            if (modal) modal.remove();
          });
        } else {
          errorArea.style.display = 'block';
          errorArea.innerHTML = `<div style="color: #ea4335; padding: 12px; background: #fce8e6; border-radius: 6px;">${
            response.error || '데이터 수집에 실패했습니다.'
          }</div>`;
        }
      }
    );
  });
}

/**
 * Dashboard 모드 정리 함수
 * 모드 전환 시 호출되어 메모리 누수 방지
 */
function destroyDashboardMode() {
  // 전역 변수 초기화
  cachedData = null;
  viewState = {
    myChannels: { sortOrder: 'pubDate', currentPage: 0 },
    competitorChannels: { sortOrder: 'pubDate', currentPage: 0 },
  };
  activeTagFilter = null;
  activeChannelFilter = null;

  // 등록된 이벤트 리스너는 DOM이 제거되면 자동으로 정리됨
  // (container.innerHTML = ''로 인해)
}

export { initDashboardMode, renderDashboard, addDashboardEventListeners, destroyDashboardMode };
