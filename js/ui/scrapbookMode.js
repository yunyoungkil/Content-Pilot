// js/ui/scrapbookMode.js (필터링 로직 분리)
import { shortenLink, showConfirmationToast, showToast } from '../utils.js';
import { renderKanban, addKanbanEventListeners } from './kanbanMode.js';
import { renderHeaderAndTabs } from './header.js';

let selectedScrapId = null;
let allScraps = [];
// ▼▼▼ [추가] 스크랩북만의 독립적인 태그 필터 변수 ▼▼▼
let activeScrapbookTagFilter = null;

/**
 * Scrapbook 모드 정리 함수
 * 모드 전환 시 호출되어 메모리 누수 방지
 */
export function destroyScrapbookMode() {
  // 전역 변수 초기화
  selectedScrapId = null;
  allScraps = [];
  activeScrapbookTagFilter = null;

  // 등록된 이벤트 리스너는 DOM이 제거되면 자동으로 정리됨
}

// 스크랩북 모드 UI 렌더링 함수
export function renderScrapbook(container) {
  // [체크리스트 4-1] 완전 초기화: 이전 채널의 모든 스크랩 제거
  container.innerHTML = '';

  // [체크리스트 4-3] 검색 초기화: 검색어 및 필터 초기화
  if (typeof activeScrapbookTagFilter !== 'undefined') {
    activeScrapbookTagFilter = null;
  }

  container.innerHTML = `
    <div class="scrapbook-root">
      <div class="scrapbook-list-section">
        <div class="scrapbook-list-header"><div class="scrapbook-list-title">스크랩 목록</div></div>
        <div class="scrapbook-controls">
            <div class="filter-status-container">
                <span class="filter-placeholder">태그 클릭 시 필터가 여기에 표시됩니다.</span>
            </div>
            <input type="text" id="scrapbook-keyword-input" class="scrapbook-keyword-input" placeholder="키워드로 검색..." value="">
        </div>
        <div class="scrapbook-list-cards"><p style="text-align:center;color:#888;margin-top:20px;">스크랩을 불러오는 중...</p></div>
      </div>
      <div class="scrapbook-detail-section">
        <div class="scrapbook-detail-header">상세 정보</div>
        <div class="scrapbook-detail-content" id="scrapbook-detail-content-area"><div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div></div>
      </div>
    </div>
  `;

  requestScrapsAndRender(container);

  const keywordInput = container.querySelector('#scrapbook-keyword-input');
  keywordInput.addEventListener('keyup', () => {
    renderScrapList(allScraps, container); // 키워드 입력 시에도 전체 목록을 다시 렌더링하여 필터링
  });

  // 스크랩 데이터 업데이트 메시지 리스너 (콜백이 실행되지 않는 경우 대비)
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.action === 'scraps_data_updated') {
      console.log(
        '[ScrapbookMode] 스크랩 데이터 업데이트 메시지 수신:',
        msg.scraps?.length || 0,
        '개'
      );

      // container가 유효한지 확인 (다른 모드로 전환된 경우 대비)
      const listContainer = container.querySelector('.scrapbook-list-cards');
      if (!listContainer) {
        console.log('[ScrapbookMode] 스크랩 모드가 아닌 상태에서 메시지 수신, 무시');
        return false;
      }

      if (msg.scraps && Array.isArray(msg.scraps)) {
        allScraps = msg.scraps.sort((a, b) => b.timestamp - a.timestamp);
        renderScrapList(allScraps, container);
      }
    }
    return false;
  });

  // 인증 상태 변경 감지하여 데이터 재로드
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.googleUserEmail) {
      const newValue = changes.googleUserEmail.newValue;
      const oldValue = changes.googleUserEmail.oldValue;

      if (newValue && !oldValue) {
        // 로그인: 새로 로그인한 경우 데이터 로드
        console.log('[ScrapbookMode] 로그인 감지, 데이터 재로드');
        requestScrapsAndRender(container);
      } else if (!newValue && oldValue) {
        // 로그아웃: 로그아웃한 경우 데이터 초기화
        console.log('[ScrapbookMode] 로그아웃 감지, 데이터 초기화');
        allScraps = [];
        const listContainer = container.querySelector('.scrapbook-list-cards');
        if (listContainer)
          listContainer.innerHTML =
            '<p style="text-align:center;color:#888;margin-top:20px;">로그인이 필요합니다.</p>';
      }
    }
  });
}

function requestScrapsAndRender(container, retryCount = 0) {
  const MAX_RETRY_COUNT = 10;

  // 인증 상태 확인
  chrome.storage.local.get(['googleUserEmail', 'activeChannelId'], (res) => {
    // 인증이 완료되지 않았으면 재시도
    if (!res.googleUserEmail) {
      if (retryCount < MAX_RETRY_COUNT) {
        console.log(`[ScrapbookMode] 인증 대기 중... (${retryCount + 1}/${MAX_RETRY_COUNT})`);
        setTimeout(() => {
          requestScrapsAndRender(container, retryCount + 1);
        }, 1000);
      } else {
        console.warn('[ScrapbookMode] 인증 대기 시간 초과');
        const listContainer = container.querySelector('.scrapbook-list-cards');
        if (listContainer)
          listContainer.innerHTML =
            '<p style="text-align:center;color:#888;margin-top:20px;">로그인이 필요합니다.</p>';
      }
      return;
    }

    // 인증 완료 후 데이터 로드
    const activeChannelId = res.activeChannelId || null;
    console.log('[ScrapbookMode] 인증 확인 완료, 스크랩 데이터 로드');

    chrome.runtime.sendMessage(
      {
        action: 'cp_get_firebase_scraps',
        channelId: activeChannelId,
      },
      (response) => {
        console.log('[ScrapbookMode] requestScrapsAndRender - 응답 받음:', response);
        if (response && response.data) {
          allScraps = response.data.sort((a, b) => b.timestamp - a.timestamp);
          console.log('[ScrapbookMode] 스크랩 데이터 로드 완료:', allScraps.length, '개');
          renderScrapList(allScraps, container);
        } else {
          console.log('[ScrapbookMode] 스크랩 데이터 없음 또는 응답 실패');
          const listContainer = container.querySelector('.scrapbook-list-cards');
          if (listContainer)
            listContainer.innerHTML =
              '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        }
      }
    );

    // 콜백이 실행되지 않는 경우를 대비하여 짧은 지연 후 재요청
    setTimeout(() => {
      if (allScraps.length === 0) {
        console.log('[ScrapbookMode] 콜백 미실행 감지, 재요청');
        chrome.runtime.sendMessage({
          action: 'cp_get_firebase_scraps',
          channelId: activeChannelId,
        });
      }
    }, 1000);
  });
}

/**
 * [Performance Optimization] 스크랩 카드 HTML 생성 헬퍼 함수
 * 청크 렌더링을 위해 별도 함수로 분리
 */
function createScrapCardHTML(scrap) {
  const tagsHtml =
    scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
      ? `<div class="card-tags">${scrap.tags.map((tag) => `<span class="tag">#${tag}</span>`).join('')}</div>`
      : '';
  const cleanedTitle = scrap.text ? scrap.text.replace(/\s+/g, ' ').trim() : '제목 없음';

  // [체크리스트 2] 전용/공용 토글 버튼 생성 (배지 제거, 토글 버튼만 유지)
  // [CSP 준수] 인라인 이벤트 핸들러 제거, CSS :hover 사용
  const isDedicated = scrap.channelId !== null && scrap.channelId !== undefined;
  const toggleBtn = `<button class="scrap-share-toggle-btn ${isDedicated ? 'scrap-toggle-dedicated' : 'scrap-toggle-public'}" data-scrap-id="${scrap.id}" data-current-channel-id="${scrap.channelId || ''}" 
      style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 10; transition: all 0.2s;"
      title="${isDedicated ? '공용으로 변경' : '전용으로 변경'}">
      ${isDedicated ? '🔒' : '🌐'}
    </button>`;

  return `
        <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}" style="position: relative;">
          ${toggleBtn}
          <button class="scrap-card-delete-btn" data-id="${scrap.id}"><svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg></button>
          ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` : ''}
          <div class="scrap-card-info">
            <div class="scrap-card-title" style="display: flex; align-items: center; gap: 4px; min-width: 0;">
              <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanedTitle.substring(0, 20)}...</span>
            </div>
            <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
            ${tagsHtml}
          </div>
        </div>
    `;
}

/**
 * [Performance Optimization] 청크 렌더링 함수
 * requestAnimationFrame을 사용하여 UI 블로킹을 방지
 */
function renderScrapListChunked(scrapsToRender, listContainer, container) {
  const CHUNK_SIZE = 20; // 한 번에 렌더링할 아이템 수
  let currentIndex = 0;
  const totalItems = scrapsToRender.length;

  // 초기 상태: 로딩 메시지 제거하고 빈 컨테이너 준비
  listContainer.innerHTML = '';

  // 진행 상태 표시 (선택적)
  const progressIndicator = document.createElement('div');
  progressIndicator.style.cssText =
    'text-align: center; color: #888; padding: 10px; font-size: 12px;';
  progressIndicator.textContent = `로딩 중... (0/${totalItems})`;
  listContainer.appendChild(progressIndicator);

  /**
   * 다음 청크를 렌더링하는 함수
   */
  function renderNextChunk() {
    const endIndex = Math.min(currentIndex + CHUNK_SIZE, totalItems);
    const chunk = scrapsToRender.slice(currentIndex, endIndex);

    // 청크 HTML 생성
    const chunkHTML = chunk.map((scrap) => createScrapCardHTML(scrap)).join('');

    // 임시 컨테이너에 추가 (DOM 조작 최소화)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = chunkHTML;

    // 실제 DOM에 추가
    while (tempDiv.firstChild) {
      listContainer.insertBefore(tempDiv.firstChild, progressIndicator);
    }

    currentIndex = endIndex;

    // 진행 상태 업데이트
    if (currentIndex < totalItems) {
      progressIndicator.textContent = `로딩 중... (${currentIndex}/${totalItems})`;

      // 다음 청크를 requestAnimationFrame으로 예약
      requestAnimationFrame(renderNextChunk);
    } else {
      // 모든 아이템 렌더링 완료
      progressIndicator.remove();

      // 이벤트 리스너 연결 (기존 로직 유지)
      // `scraps`는 렌더링 파라미터가 아닌 내부 변수이므로 여기서는 `scrapsToRender`를 전달합니다.
      attachScrapListEventListeners(listContainer, container, scrapsToRender);
    }
  }

  // 첫 번째 청크 렌더링 시작
  requestAnimationFrame(renderNextChunk);
}

function renderScrapList(scraps, container) {
  const listContainer = container.querySelector('.scrapbook-list-cards');
  const keywordInput = container.querySelector('#scrapbook-keyword-input');
  if (!listContainer || !keywordInput) return;

  // ▼▼▼ [추가] 필터 상태 UI 업데이트 로직 ▼▼▼
  const filterStatusContainer = container.querySelector('.filter-status-container');
  if (filterStatusContainer) {
    if (activeScrapbookTagFilter) {
      filterStatusContainer.innerHTML = `
                <div class="active-filter-chip">
                    <span>#${activeScrapbookTagFilter}</span>
                    <button class="clear-filter-btn">×</button>
                </div>
            `;
    } else {
      filterStatusContainer.innerHTML = `<span class="filter-placeholder">태그 클릭 시 필터가 여기에 표시됩니다.</span>`;
    }
  }

  // ▼▼▼ [수정] 키워드와 태그 필터를 모두 적용하여 보여줄 스크랩을 결정 ▼▼▼
  const keyword = keywordInput.value.toLowerCase();
  let scrapsToRender = scraps;

  if (activeScrapbookTagFilter) {
    scrapsToRender = scrapsToRender.filter(
      (s) => s.tags && s.tags.includes(activeScrapbookTagFilter)
    );
  }

  if (keyword) {
    scrapsToRender = scrapsToRender.filter((s) => s.text && s.text.toLowerCase().includes(keyword));
  }
  // ▲▲▲ 수정 완료 ▲▲▲

  if (scrapsToRender.length === 0) {
    listContainer.innerHTML =
      '<p style="text-align:center;color:#888;margin-top:20px;">일치하는 스크랩이 없습니다.</p>';
  } else {
    // [Performance Optimization] 청크 렌더링 사용
    // 스크랩이 30개 이상일 때만 청크 렌더링 사용 (작은 목록은 즉시 렌더링)
    if (scrapsToRender.length >= 30) {
      renderScrapListChunked(scrapsToRender, listContainer, container);
    } else {
      // 작은 목록은 기존 방식으로 즉시 렌더링
      listContainer.innerHTML = scrapsToRender.map((scrap) => createScrapCardHTML(scrap)).join('');
      attachScrapListEventListeners(listContainer, container, scraps);
    }
  }

  // 이벤트 리스너는 attachScrapListEventListeners에서 처리
  if (scrapsToRender.length < 30) {
    attachScrapListEventListeners(listContainer, container, scraps);
  }
}

/**
 * [Performance Optimization] 스크랩 목록 이벤트 리스너 연결 함수
 * 청크 렌더링과 즉시 렌더링 모두에서 사용
 */
function attachScrapListEventListeners(listContainer, container, scraps) {
  // ▼▼▼ [추가] 활성화된 태그 하이라이팅 ▼▼▼
  listContainer.querySelectorAll('.card-tags .tag').forEach((tagEl) => {
    if (
      activeScrapbookTagFilter &&
      tagEl.textContent.replace('#', '') === activeScrapbookTagFilter
    ) {
      tagEl.classList.add('active');
    } else {
      tagEl.classList.remove('active');
    }
  });

  // --- 이벤트 리스너 재연결 ---
  listContainer.querySelectorAll('.scrap-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // [체크리스트 2] 토글 버튼 클릭은 제외
      if (
        e.target.closest('.scrap-share-toggle-btn') ||
        e.target.classList.contains('scrap-share-toggle-btn')
      )
        return;
      if (e.target.closest('.scrap-card-delete-btn') || e.target.classList.contains('tag')) return;
      selectedScrapId = card.dataset.id;
      renderScrapList(scraps, container);
      renderDetailView(selectedScrapId, container);
    });
  });

  // [체크리스트 2] 스크랩 공유 토글 버튼 클릭 처리 (스크랩북)
  listContainer.querySelectorAll('.scrap-share-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const scrapId = btn.dataset.scrapId;
      const currentChannelId = btn.dataset.currentChannelId;

      // 현재 활성 채널 ID 가져오기
      chrome.storage.local.get('activeChannelId', (res) => {
        const activeChannelId = res.activeChannelId || null;

        // 버튼 비활성화 및 로딩 표시
        btn.disabled = true;
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '⏳';

        chrome.runtime.sendMessage(
          {
            action: 'toggle_scrap_sharing',
            scrapId: scrapId,
            currentChannelId: activeChannelId,
          },
          (response) => {
            btn.disabled = false;

            if (response && response.success) {
              // 성공 시 버튼 아이콘과 툴팁 업데이트
              const isNowDedicated = response.newChannelId !== null;
              btn.innerHTML = isNowDedicated ? '🔒' : '🌐';
              btn.title = isNowDedicated ? '공용으로 변경' : '전용으로 변경';
              // [CSP 준수] 클래스로 스타일 변경
              btn.classList.remove('scrap-toggle-dedicated', 'scrap-toggle-public');
              btn.classList.add(isNowDedicated ? 'scrap-toggle-dedicated' : 'scrap-toggle-public');
              btn.dataset.currentChannelId = response.newChannelId || '';

              // 배지 제거됨 (토글 버튼만 사용)

              // 스크랩 목록 새로고침
              requestScrapsAndRender(container);

              showToast(
                response.message ||
                  (isNowDedicated
                    ? '전용 스크랩으로 변경되었습니다.'
                    : '공용 스크랩으로 변경되었습니다.')
              );
            } else {
              btn.innerHTML = originalIcon;
              showToast('❌ 변경 실패: ' + (response?.error || '알 수 없는 오류'));
            }
          }
        );
      });
    });
  });

  listContainer.querySelectorAll('.scrap-card-delete-btn').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const scrapIdToDelete = button.dataset.id;
      if (!scrapIdToDelete) {
        console.error('[Scrapbook] 스크랩 ID가 없습니다.');
        return;
      }
      showConfirmationToast('정말로 삭제하시겠습니까?', () => {
        chrome.runtime.sendMessage({ action: 'delete_scrap', id: scrapIdToDelete }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Scrapbook] 스크랩 삭제 오류:', chrome.runtime.lastError);
            showToast(`❌ 삭제 실패: ${chrome.runtime.lastError.message}`, 'error');
            return;
          }
          if (response && response.success) {
            showToast('✅ 스크랩이 삭제되었습니다.');
            requestScrapsAndRender(container);
            if (selectedScrapId === scrapIdToDelete) {
              renderDetailView(null, container);
            }
          } else {
            const errorMsg = response?.error || '알 수 없는 오류';
            console.error('[Scrapbook] 스크랩 삭제 실패:', errorMsg);
            showToast(`❌ 삭제 실패: ${errorMsg}`, 'error');
          }
        });
      });
    });
  });

  // ▼▼▼ [추가] 태그 클릭 이벤트 리스너 ▼▼▼
  listContainer.querySelectorAll('.card-tags .tag').forEach((tagEl) => {
    tagEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const clickedTag = tagEl.textContent.replace('#', '');
      activeScrapbookTagFilter = activeScrapbookTagFilter === clickedTag ? null : clickedTag;
      renderScrapList(allScraps, container); // 필터 변경 후 목록 다시 렌더링
    });
  });

  // ▼▼▼ [추가] 필터 지우기 버튼 리스너 ▼▼▼
  const clearFilterBtn = container.querySelector('.clear-filter-btn');
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      activeScrapbookTagFilter = null;
      renderScrapList(allScraps, container);
    });
  }
}

// ▼▼▼ [수정] container를 인자로 받도록 변경 ▼▼▼
function renderDetailView(scrapId, container) {
  // ▼▼▼ [수정] document 대신 container에서 요소를 찾습니다. ▼▼▼
  const detailContainer = container.querySelector('#scrapbook-detail-content-area');
  if (!detailContainer) return;

  const scrap = allScraps.find((s) => s.id === scrapId);
  if (!scrap) {
    detailContainer.innerHTML = `<div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div>`;
    selectedScrapId = null; // 선택된 ID 초기화
    return;
  }

  const formatDetailText = (text) => {
    if (!text) return '내용 없음';
    // 1. 3개 이상의 연속된 줄바꿈을 2개(하나의 빈 줄)로 줄입니다.
    let cleaned = text.replace(/(\r\n|\n|\r){3,}/g, '\n\n');
    // 2. 각 줄의 양 끝 불필요한 공백을 제거하고, 중간의 여러 공백은 하나로 합칩니다.
    cleaned = cleaned
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .join('\n');
    return cleaned.trim();
  };

  // 하이라이트 메타데이터가 있으면 적용
  let detailText = formatDetailText(scrap.text);
  let highlightedText = detailText;

  // 정규식 이스케이프 헬퍼 함수 (현재 사용되지 않음, 필요 시 재도입)
  // function escapeRegex(str) {
  //   return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // }

  // 하이라이트 데이터 확인 및 디버깅
  console.log('[ScrapbookMode] 스크랩 데이터 확인:', {
    hasHighlights: !!scrap.highlights,
    highlightsType: typeof scrap.highlights,
    highlightsIsArray: Array.isArray(scrap.highlights),
    highlightsLength: scrap.highlights?.length || 0,
    textLength: detailText.length,
  });

  if (scrap.highlights && Array.isArray(scrap.highlights) && scrap.highlights.length > 0) {
    console.log('[ScrapbookMode] 하이라이트 적용 시작:', scrap.highlights.length, '개');
    console.log('[ScrapbookMode] 하이라이트 상세:', scrap.highlights);

    // 뒤에서부터 처리하여 인덱스 변경 방지
    const sortedHighlights = [...scrap.highlights].sort(
      (a, b) => (b.startIndex || 0) - (a.startIndex || 0)
    );

    sortedHighlights.forEach((highlight, idx) => {
      const highlightText = highlight.text ? highlight.text.trim() : '';
      if (!highlightText || highlightText.length < 3) {
        console.warn(`[ScrapbookMode] 하이라이트 ${idx + 1} 건너뜀: 텍스트 없음`);
        return;
      }

      // 텍스트에서 해당 문장 찾기
      let found = false;
      const searchText = highlightText;

      // 정확한 매칭 시도
      if (detailText.includes(searchText)) {
        const startIdx = highlightedText.indexOf(searchText);
        if (startIdx !== -1) {
          const endIdx = startIdx + searchText.length;

          // 이미 하이라이트가 적용되지 않은 경우만 처리
          const before = highlightedText.substring(0, startIdx);
          const target = highlightedText.substring(startIdx, endIdx);
          const after = highlightedText.substring(endIdx);

          // 이미 마크 태그로 감싸져 있지 않은 경우만 처리
          if (
            !target.includes('<mark') &&
            !before.endsWith('<mark') &&
            !after.startsWith('</mark>')
          ) {
            const highlighted = `<mark class="scrap-highlight" style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px; font-weight: 500; display: inline;" data-score="${highlight.score || 0}">${target}</mark>`;
            highlightedText = before + highlighted + after;
            found = true;
            console.log(
              `[ScrapbookMode] ✅ 하이라이트 적용됨 (${idx + 1}/${sortedHighlights.length}):`,
              searchText.substring(0, 40) + '...'
            );
          }
        }
      }

      // 정확한 매칭 실패 시 부분 매칭 시도 (처음 15자만)
      if (!found && searchText.length > 15) {
        const partialText = searchText.substring(0, 15);
        const partialIndex = highlightedText.indexOf(partialText);

        if (partialIndex !== -1) {
          // 부분 매칭된 위치에서 문장 끝까지 찾기
          let endIdx = partialIndex + partialText.length;
          const maxLength = Math.min(searchText.length + 30, detailText.length - partialIndex);

          while (endIdx < partialIndex + maxLength && endIdx < highlightedText.length) {
            const char = highlightedText[endIdx];
            if (char === '.' || char === '!' || char === '?') {
              if (endIdx + 1 < highlightedText.length && highlightedText[endIdx + 1] === ' ') {
                endIdx++;
                break;
              }
            }
            endIdx++;
          }

          const before = highlightedText.substring(0, partialIndex);
          const target = highlightedText.substring(partialIndex, endIdx);
          const after = highlightedText.substring(endIdx);

          if (
            !target.includes('<mark') &&
            !before.endsWith('<mark') &&
            !after.startsWith('</mark>') &&
            target.trim().length > 10
          ) {
            const highlighted = `<mark class="scrap-highlight" style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px; font-weight: 500; display: inline;" data-score="${highlight.score || 0}">${target}</mark>`;
            highlightedText = before + highlighted + after;
            console.log(
              `[ScrapbookMode] ✅ 부분 하이라이트 적용됨 (${idx + 1}/${sortedHighlights.length}):`,
              target.substring(0, 40) + '...'
            );
          }
        } else {
          console.warn(
            `[ScrapbookMode] ❌ 하이라이트 ${idx + 1} 매칭 실패:`,
            searchText.substring(0, 30) + '...'
          );
        }
      } else if (!found) {
        console.warn(
          `[ScrapbookMode] ❌ 하이라이트 ${idx + 1} 매칭 실패 (텍스트 너무 짧음):`,
          searchText
        );
      }
    });

    console.log('[ScrapbookMode] 하이라이트 적용 완료. 최종 텍스트 길이:', highlightedText.length);
    console.log(
      '[ScrapbookMode] 하이라이트 태그 개수:',
      (highlightedText.match(/<mark/g) || []).length
    );
  } else {
    console.log('[ScrapbookMode] 하이라이트 데이터 없음. scrap 객체:', Object.keys(scrap));
  }

  const detailTitle = (scrap.text || '제목 없음').replace(/\s+/g, ' ').trim().substring(0, 50);

  // 이미지 수집 (image, allImages, images 모두 확인 - 하위 호환성)
  // 유효한 이미지 URL만 필터링 및 정규화
  const normalizeImageUrl = (url, baseUrl) => {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.length === 0) return null;

    // 이미 절대 경로인 경우
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    ) {
      return trimmed;
    }

    // 상대 경로인 경우 절대 경로로 변환
    if (trimmed.startsWith('//')) {
      return 'https:' + trimmed;
    }

    if (trimmed.startsWith('/')) {
      // baseUrl에서 origin 추출
      try {
        const base = new URL(baseUrl || scrap.url || window.location.href);
        return base.origin + trimmed;
      } catch (e) {
        return null;
      }
    }

    // 상대 경로 (./ 또는 ../ 없이 시작)
    if (!trimmed.startsWith('http') && baseUrl) {
      try {
        return new URL(trimmed, baseUrl).href;
      } catch (e) {
        return null;
      }
    }

    return null;
  };

  const isValidImageUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    return (
      trimmed.length > 0 &&
      (trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('data:image/'))
    );
  };

  const allImageUrls = [];
  const baseUrl = scrap.url || window.location.href;

  if (scrap.image) {
    const normalized = normalizeImageUrl(scrap.image, baseUrl);
    if (normalized && isValidImageUrl(normalized)) {
      allImageUrls.push(normalized);
    }
  }

  if (Array.isArray(scrap.allImages)) {
    scrap.allImages.forEach((url) => {
      const normalized = normalizeImageUrl(url, baseUrl);
      if (normalized && isValidImageUrl(normalized) && !allImageUrls.includes(normalized)) {
        allImageUrls.push(normalized);
      }
    });
  }

  // 하위 호환성: images 배열도 확인 (구버전 데이터)
  if (Array.isArray(scrap.images)) {
    scrap.images.forEach((url) => {
      const normalized = normalizeImageUrl(url, baseUrl);
      if (normalized && isValidImageUrl(normalized) && !allImageUrls.includes(normalized)) {
        allImageUrls.push(normalized);
      }
    });
  }

  // 이미지 HTML 생성 (별도 카드로)
  // 이미지 URL 정규화 및 에스케이프
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const imagesHtml =
    allImageUrls.length > 0
      ? `<div class="scrapbook-detail-images-grid" style="width: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; max-height: calc(100vh - 200px); overflow-y: auto;">
          ${allImageUrls
            .map((imgUrl, idx) => {
              const escapedUrl = escapeHtml(imgUrl);
              return `
            <div class="scrapbook-detail-image-item" style="position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0; background: #f5f5f5;">
              <img class="scrapbook-detail-img-item" 
                src="${escapedUrl}" 
                style="width: 100%; height: 100%; object-fit: cover; display: block; opacity: 1;" 
                alt="스크랩 이미지 ${idx + 1}" 
                loading="lazy"
                decoding="async">
              <div class="image-error" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; color: #999; font-size: 11px; text-align: center; padding: 4px; position: absolute; inset: 0; background: #f5f5f5; z-index: 1;">로드 실패</div>
              <button class="scrapbook-image-delete-btn" data-scrap-id="${scrap.id}" data-image-url="${escapedUrl}" 
                style="position: absolute; top: 4px; right: 4px; background: rgba(234,67,53,0.9); color: #fff; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; z-index: 10; opacity: 0; transition: opacity 0.2s;"
                title="이미지 삭제">
                ×
              </button>
            </div>
          `;
            })
            .join('')}
        </div>`
      : '<div style="text-align: center; color: #999; padding: 40px; font-size: 14px;">이미지가 없습니다</div>';

  // 2열 레이아웃: 왼쪽 텍스트 카드, 오른쪽 이미지 카드
  detailContainer.innerHTML = `
        <div style="display: flex; gap: 16px; width: 100%; align-items: flex-start;">
            <div class="scrapbook-detail-card" style="flex: 1; min-width: 300px; max-width: 420px;">
                <div class="scrapbook-detail-title">${detailTitle}</div>
                <div class="scrapbook-detail-meta"><span>URL: <a href="${scrap.url}" target="_blank">${shortenLink(scrap.url)}</a></span></div>
                <p class="scrapbook-detail-desc" style="white-space: pre-wrap; word-wrap: break-word; line-height: 1.6;">${highlightedText}</p>
                <button class="scrap-to-idea-btn" data-scrap-id="${scrap.id}" style="margin-top: 16px; padding: 10px 16px; background: #4285f4; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; transition: background 0.2s;">
                    💡 아이디어로 전환
                </button>
            </div>
            <div class="scrapbook-detail-images-card" style="flex: 1; min-width: 300px; max-width: 420px; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(66, 133, 244, 0.08); padding: 20px;">
                <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px;">이미지 (${allImageUrls.length}개)</div>
                ${imagesHtml}
            </div>
        </div>
    `;

  // 이미지 로드 확인 및 에러 처리 (워크스페이스 갤러리와 동일한 방식)
  detailContainer.querySelectorAll('.scrapbook-detail-img-item').forEach((img) => {
    // 이미지가 이미 로드 완료된 경우 확인
    if (img.complete) {
      if (img.naturalHeight === 0 || img.naturalWidth === 0) {
        // 이미지 로드 실패
        img.style.display = 'none';
        const errorDiv = img.parentElement.querySelector('.image-error');
        if (errorDiv) {
          errorDiv.style.display = 'flex';
        }
      } else {
        // 이미지 로드 성공
        img.style.display = 'block';
      }
    }

    // 이미지 로드 성공 이벤트
    img.addEventListener(
      'load',
      function () {
        this.style.display = 'block';
        this.style.opacity = '1';
        const errorDiv = this.parentElement.querySelector('.image-error');
        if (errorDiv) {
          errorDiv.style.display = 'none';
        }
      },
      { once: true }
    );

    // 이미지 로드 실패 이벤트
    img.addEventListener(
      'error',
      function () {
        const originalSrc = this.src;
        if (!originalSrc) {
          this.style.display = 'none';
          const errorDiv = this.parentElement.querySelector('.image-error');
          if (errorDiv) {
            errorDiv.style.display = 'flex';
          }
          return;
        }

        // 이미 재시도한 경우는 에러 메시지 표시
        if (this.dataset.retried === 'true') {
          this.style.display = 'none';
          const errorDiv = this.parentElement.querySelector('.image-error');
          if (errorDiv) {
            errorDiv.style.display = 'flex';
          }
          return;
        }

        this.dataset.retried = 'true';

        // 재시도: Image 객체로 먼저 테스트
        const testImg = new Image();
        testImg.onload = () => {
          // 테스트 성공 시 실제 img에 적용
          this.src = originalSrc;
          this.style.display = 'block';
        };
        testImg.onerror = () => {
          // 최종 실패
          this.style.display = 'none';
          const errorDiv = this.parentElement.querySelector('.image-error');
          if (errorDiv) {
            errorDiv.style.display = 'flex';
          }
        };
        testImg.src = originalSrc;
      },
      { once: true }
    );
  });

  // 이미지 삭제 버튼 이벤트 리스너 (이미지 카드 내부)
  detailContainer.querySelectorAll('.scrapbook-image-delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scrapId = btn.dataset.scrapId;
      const imageUrl = btn.dataset.imageUrl;

      // Normalize image URL selection: prefer DB-stored/original URL from the scrap object
      const normalizeForMatch = (u) => {
        if (!u) return '';
        try {
          if (u.startsWith('data:')) return u;
          const clean = u.replace(/&amp;/g, '&');
          const parsed = new URL(clean);
          let p = parsed.pathname || '';
          try {
            p = decodeURIComponent(p);
          } catch (e) {}
          return (parsed.hostname + p).replace(/\/$/, '').toLowerCase();
        } catch (e) {
          return u.replace(/&amp;/g, '&').replace(/\/$/, '').toLowerCase();
        }
      };

      // try to find canonical URL from local allScraps cache
      let canonicalDeleteUrl = imageUrl;
      const targetScrap = allScraps.find((s) => s.id === scrapId);
      if (targetScrap) {
        const originList = [];
        if (targetScrap.image) originList.push(targetScrap.image);
        if (Array.isArray(targetScrap.allImages)) originList.push(...targetScrap.allImages);
        if (Array.isArray(targetScrap.images)) originList.push(...targetScrap.images);
        const matched = originList.find(
          (o) => normalizeForMatch(o) === normalizeForMatch(imageUrl)
        );
        if (matched) canonicalDeleteUrl = matched;
      }

      if (confirm('이 이미지를 삭제하시겠습니까?')) {
        chrome.runtime.sendMessage(
          {
            action: 'remove_scrap_image',
            data: { scrapId, imageUrl },
          },
          (response) => {
            if (response && response.success && response.changed) {
              // ▼▼▼ [수정 시작] UI 즉시 갱신 로직 추가 ▼▼▼

              // 1. 현재 로컬 메모리(allScraps)에서 해당 이미지를 즉시 제거
              const targetScrap = allScraps.find((s) => s.id === scrapId);
              if (targetScrap) {
                // (A) allImages 배열에서 제거
                if (Array.isArray(targetScrap.allImages)) {
                  targetScrap.allImages = targetScrap.allImages.filter((url) => url !== imageUrl);
                }
                // (B) images 배열에서 제거 (구버전 호환)
                if (Array.isArray(targetScrap.images)) {
                  targetScrap.images = targetScrap.images.filter((url) => url !== imageUrl);
                }
                // (C) image 필드 제거 (단일 이미지)
                if (targetScrap.image === imageUrl) {
                  targetScrap.image = null;
                }
              }

              // 2. 수정된 로컬 데이터를 기반으로 상세 화면 다시 그리기 (즉시 반영됨)
              renderDetailView(scrapId, container);

              // 3. 서버 데이터 동기화는 뒤에서 조용히 수행 (나중에 완료되면 덮어씌움)
              requestScrapsAndRender(container);

              // ▲▲▲ [수정 끝] ▲▲▲
            } else if (response && response.success && !response.changed) {
              alert('삭제 대상이 데이터베이스에서 발견되지 않았습니다.');
            } else {
              alert('이미지 삭제에 실패했습니다: ' + (response?.error || '알 수 없는 오류'));
            }
          }
        );
      }
    });

    // 삭제 버튼 hover 시 표시
    const imageItem = btn.closest('.scrapbook-detail-image-item');
    if (imageItem) {
      imageItem.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
      });
      imageItem.addEventListener('mouseleave', () => {
        btn.style.opacity = '0';
      });
    }
  });

  // 이미지 클릭 시 확대 보기 (이미지 카드 내부)
  // 외부에서 삭제 이벤트가 발생한 경우(다른 창/패널에서 삭제)에도 상세 뷰를 동기화
  if (!detailContainer.dataset.scrapListenerAttached) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'scrap_image_removed') {
        const { scrapId: removedScrapId, imageUrl: removedImageUrl } = msg.data || {};
        if (removedScrapId !== scrap.id) return; // 다른 스크랩이면 무시

        // 로컬 캐시(allScraps)에서 즉시 반영
        const targetScrap = allScraps.find((s) => s.id === removedScrapId);
        if (targetScrap) {
          if (Array.isArray(targetScrap.allImages)) {
            targetScrap.allImages = targetScrap.allImages.filter((u) => u !== removedImageUrl);
          }
          if (Array.isArray(targetScrap.images)) {
            targetScrap.images = targetScrap.images.filter((u) => u !== removedImageUrl);
          }
          if (targetScrap.image === removedImageUrl) targetScrap.image = null;

          // 현재 상세화면을 다시 렌더
          renderDetailView(removedScrapId, container);
        }
      }
    });
    detailContainer.dataset.scrapListenerAttached = '1';
  }
  detailContainer.querySelectorAll('.scrapbook-detail-image-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.scrapbook-image-delete-btn')) return;

      const img = item.querySelector('img');
      if (!img || !img.src) return;

      const modal = document.createElement('div');
      modal.style.cssText =
        'position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 10000; display: flex; align-items: center; justify-content: center; cursor: pointer;';
      modal.innerHTML = `
          <img src="${img.src.replace(/"/g, '&quot;')}" style="max-width: 90vw; max-height: 90vh; object-fit: contain;">
        `;

      // [수정] document.body 대신 Shadow DOM 내부 컨테이너에 추가
      // container는 renderDetailView의 인자로 전달된 Shadow DOM 내부 요소입니다.
      container.appendChild(modal);

      modal.addEventListener('click', () => {
        // [수정] 부모 요소에서 제거
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      });
    });
  });

  // ▼▼▼ [추가] 아이디어로 전환 버튼 이벤트 리스너 ▼▼▼
  const convertToIdeaBtn = detailContainer.querySelector('.scrap-to-idea-btn');
  if (convertToIdeaBtn) {
    convertToIdeaBtn.addEventListener('click', () => {
      const scrapId = convertToIdeaBtn.dataset.scrapId;
      const scrap = allScraps.find((s) => s.id === scrapId);

      if (!scrap) {
        showConfirmationToast('스크랩을 찾을 수 없습니다.', null);
        return;
      }

      // 스크랩 데이터를 아이디어 형식으로 변환
      const ideaTitle = scrap.text
        ? scrap.text.replace(/\s+/g, ' ').trim().substring(0, 100)
        : '제목 없음';
      const ideaDescription = scrap.text || '';
      const ideaTags =
        scrap.tags && Array.isArray(scrap.tags)
          ? [...scrap.tags, '#스크랩-전환']
          : ['#스크랩-전환'];

      const ideaData = {
        title: ideaTitle,
        description: ideaDescription,
        keywords: ideaTags.filter((tag) => tag !== '#스크랩-전환'), // 스크랩 태그는 keywords로
        origin: {
          type: 'scrap',
          postUrl: scrap.url || '', // 중복 검사를 위해 origin.postUrl로 저장
          sourceScrapId: scrapId, // 원본 스크랩 ID 저장 (나중에 연결 가능)
        },
        sourceScrapId: scrapId, // 하위 호환성을 위해 유지
      };

      // background.js에 아이디어 추가 요청
      // [수정] 활성 채널 ID를 가져와서 함께 전송
      chrome.storage.local.get('activeChannelId', (res) => {
        const activeChannelId = res.activeChannelId || null;

        chrome.runtime.sendMessage(
          {
            action: 'add_idea_to_kanban',
            data: JSON.stringify(ideaData),
            channelId: activeChannelId, // 👈 추가됨
          },
          (response) => {
            if (response && response.success) {
              showConfirmationToast(
                '✅ 아이디어로 전환되었습니다! 기획 보드에서 확인하세요.',
                null
              );

              // 기획 보드로 이동 (선택적)
              const host = document.getElementById('content-pilot-host');
              if (host && host.shadowRoot) {
                const mainArea = host.shadowRoot.querySelector('#cp-main-area');
                if (mainArea) {
                  // kanban 모드로 전환
                  window.__cp_active_mode = 'kanban';
                  renderKanban(mainArea);
                  addKanbanEventListeners(mainArea);

                  // 헤더도 업데이트
                  renderHeaderAndTabs(host.shadowRoot);
                }
              }
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
                showConfirmationToast(
                  `⚠️ 이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${response.cardInfo?.title || '알 수 없음'}`,
                  null
                );
              } else {
                showConfirmationToast(
                  '❌ 아이디어 전환에 실패했습니다: ' +
                    (response?.error || response?.message || '알 수 없는 오류'),
                  null
                );
              }
            }
          }
        );
      });
    });

    // 버튼 hover 효과
    convertToIdeaBtn.addEventListener('mouseenter', () => {
      convertToIdeaBtn.style.background = '#3367d6';
    });
    convertToIdeaBtn.addEventListener('mouseleave', () => {
      convertToIdeaBtn.style.background = '#4285f4';
    });
  }
  // ▲▲▲ 추가 완료 ▲▲▲
}

// background.js로부터 실시간 업데이트 수신 (이제 Shadow DOM 내부를 찾도록 수정)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'cp_scraps_updated') {
    const host = document.getElementById('content-pilot-host');
    if (host && host.shadowRoot) {
      const container = host.shadowRoot.querySelector('#cp-main-area');
      if (container && container.querySelector('.scrapbook-root')) {
        requestScrapsAndRender(container);
      }
    }
  }
});
