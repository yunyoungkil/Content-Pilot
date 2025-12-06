// js/ui/kanbanMode.js (수정 완료된 최종 버전)

import { renderWorkspace } from './workspaceMode.js';
import { showToast, Logger, debounce } from '../utils.js';
import { renderHeaderAndTabs } from './header.js';

let allKanbanData = {};
let currentlyDragging = { cardId: null, originalStatus: null };
let kanbanContainer = null;
let sortOrder = 'desc';

/**
 * Kanban 모드 정리 함수
 * 모드 전환 시 호출되어 메모리 누수 방지
 */
function destroyKanbanMode() {
  // 드래그 중이 아닐 때만 초기화 (드래그 중에는 데이터 보존)
  if (!currentlyDragging.cardId) {
    allKanbanData = {};
  }
  // 드래그 상태는 유지 (드래그 완료 후 초기화)
  // currentlyDragging은 dragend에서 초기화됨
  kanbanContainer = null;
  // sortOrder는 유지 (사용자 설정 보존)

  // 등록된 이벤트 리스너는 DOM이 제거되면 자동으로 정리됨
}

export { renderKanban, updateKanbanUI, addKanbanEventListeners, destroyKanbanMode };
/**
 * 칸반 보드 UI의 기본 골격을 렌더링하는 함수
 */
function renderKanban(container) {
  kanbanContainer = container;

  // [체크리스트 3-4] 입력창 닫기: 열려있던 카드 추가 입력창이나 상세 메뉴 닫기
  const existingInputs = container.querySelectorAll(
    '.kanban-card-input, .kanban-card-detail-modal'
  );
  existingInputs.forEach((el) => el.remove());

  // [체크리스트 3-1] 완전 초기화: 이전 채널의 모든 카드 제거
  container.innerHTML = '';

  container.innerHTML = `
    <div class="kanban-board-container">
      <div class="kanban-controls-header">
        <div class="kanban-sort-controls">
          <span class="kanban-sort-label">정렬:</span>
          <button class="kanban-sort-btn ${
            sortOrder === 'desc' ? 'active' : ''
          }" data-sort="desc">최신순</button>
          <button class="kanban-sort-btn ${
            sortOrder === 'asc' ? 'active' : ''
          }" data-sort="asc">오래된순</button>
        </div>
      </div>
      <div id="cp-kanban-board-root">
        <div class="cp-kanban-col" data-status="ideas">
          <div class="cp-kanban-col-header">
            <h2 class="cp-kanban-col-title">💡 아이디어</h2>
            <button class="kanban-add-card-btn" data-status="ideas" title="카드 추가">+ 카드 추가</button>
          </div>
          <div class="kanban-col-cards"><p class="loading-scraps">데이터 로딩 중...</p></div>
        </div>
        <div class="cp-kanban-col" data-status="in-progress">
          <div class="cp-kanban-col-header">
            <h2 class="cp-kanban-col-title">✍️ 기획/작성 중</h2>
            <button class="kanban-add-card-btn" data-status="in-progress" title="카드 추가">+ 카드 추가</button>
          </div>
          <div class="kanban-col-cards"></div>
        </div>
        <div class="cp-kanban-col" data-status="done">
          <div class="cp-kanban-col-header">
            <h2 class="cp-kanban-col-title">✅ 발행 완료</h2>
            <button class="kanban-add-card-btn" data-status="done" title="카드 추가">+ 카드 추가</button>
          </div>
          <div class="kanban-col-cards"></div>
        </div>
      </div>
    </div>
  `;

  // 인증 상태 확인 후 데이터 로드
  loadKanbanData();

  if (!window.kanbanListenersAttached) {
    addRealtimeUpdateListener();
    window.kanbanListenersAttached = true;
  }

  // 칸반 데이터 업데이트 메시지 리스너 (콜백이 실행되지 않는 경우 대비)
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.action === 'kanban_data_updated') {
      console.log(
        '[KanbanMode] 칸반 데이터 업데이트 메시지 수신:',
        Object.keys(msg.data || {}).length,
        '개 카드'
      );

      // container가 유효한지 확인 (다른 모드로 전환된 경우 대비)
      if (!kanbanContainer || !kanbanContainer.querySelector('#cp-kanban-board-root')) {
        console.log('[KanbanMode] 칸반 모드가 아닌 상태에서 메시지 수신, 무시');
        return false;
      }

      if (msg.data) {
        console.log('[KanbanMode] updateKanbanUI 호출 시작');
        allKanbanData = msg.data || {};
        updateKanbanUI(allKanbanData);
        console.log('[KanbanMode] updateKanbanUI 호출 완료');
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
        console.log('[KanbanMode] 로그인 감지, 데이터 재로드');
        loadKanbanData();
      } else if (!newValue && oldValue) {
        // 로그아웃: 로그아웃한 경우 데이터 초기화
        console.log('[KanbanMode] 로그아웃 감지, 데이터 초기화');
        allKanbanData = {};
        updateKanbanUI({});
      }
    }
  });
}

// 칸반 데이터 로드 함수 (인증 상태 확인 후 실행)
function loadKanbanData(retryCount = 0) {
  const MAX_RETRIES = 10;

  chrome.storage.local.get(['googleUserEmail'], (authResult) => {
    if (!authResult.googleUserEmail) {
      if (retryCount < MAX_RETRIES) {
        console.log(`[KanbanMode] 인증 대기 중... (${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          loadKanbanData(retryCount + 1);
        }, 1000);
      } else {
        console.warn('[KanbanMode] 인증 대기 시간 초과');
        // 로그아웃 상태이므로 데이터 초기화
        allKanbanData = {};
        updateKanbanUI({});
      }
      return;
    }

    // 인증 완료 후 데이터 로드
    console.log('[KanbanMode] 인증 확인 완료, 칸반 데이터 로드');
    chrome.runtime.sendMessage({ action: 'get_kanban_data' }, (response) => {
      console.log('[KanbanMode] loadKanbanData - 응답 받음:', response);
      if (response && response.success && response.data) {
        updateKanbanUI(response.data);
      }
    });

    // 콜백이 실행되지 않는 경우를 대비하여 짧은 지연 후 재요청
    setTimeout(() => {
      if (Object.keys(allKanbanData).length === 0) {
        console.log('[KanbanMode] 콜백 미실행 감지, 재요청');
        chrome.runtime.sendMessage({ action: 'get_kanban_data' });
      }
    }, 1000);
  });
}

/**
 * background.js로부터 실시간 업데이트를 받아 UI를 갱신하는 리스너
 */
function addRealtimeUpdateListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!kanbanContainer || !kanbanContainer.querySelector('#cp-kanban-board-root')) return;

    if (msg.action === 'kanban_data_updated') {
      allKanbanData = msg.data || {};
      updateKanbanUI(allKanbanData);

      // 워크스페이스가 열려있고 해당 아이디어 데이터가 업데이트된 경우 워크스페이스 갱신
      if (window.__cp_active_mode === 'workspace' && window.__cp_workspace_idea_id) {
        const ideaId = window.__cp_workspace_idea_id;
        // 모든 상태에서 아이디어 찾기
        let ideaData = null;
        let foundStatus = null;
        for (const status in allKanbanData) {
          if (allKanbanData[status]?.[ideaId]) {
            ideaData = allKanbanData[status][ideaId];
            foundStatus = status;
            break;
          }
        }
        if (ideaData) {
          const shadowRoot = kanbanContainer.getRootNode();
          const container = shadowRoot.querySelector('#cp-main-content');
          if (container) {
            renderHeaderAndTabs(shadowRoot);
            // ▼▼▼ [수정] 기본값 할당 ▼▼▼
            // renderWorkspace로 넘기기 전에 데이터 구조를 한 번 더 보장합니다.
            const ideaDataForWorkspace = {
              ...ideaData,
              id: ideaId,
              status: foundStatus,
              // workspace 객체가 없으면(null/undefined) 빈 값으로 초기화
              workspace: ideaData.workspace || {
                keywords: [],
                outline: [],
                draft: '',
                linkedScraps: {},
              },
            };
            // 전역 ideaData 업데이트 (실시간 업데이트를 위해)
            window.__cp_workspace_idea_data = ideaDataForWorkspace;
            // ▲▲▲ [수정 완료] ▲▲▲
            renderWorkspace(kanbanContainer, ideaDataForWorkspace); // 수정된 객체 전달
          }
        }
      }
    }
  });
}

/**
 * 전체 칸반 UI를 데이터에 따라 다시 그리는 함수
 * [최적화] 증분 업데이트 방식으로 변경
 */
async function updateKanbanUI(allCards) {
  console.log('[KanbanMode] updateKanbanUI 호출:', {
    hasKanbanContainer: !!kanbanContainer,
    cardsCount: Object.keys(allCards || {}).length,
    allCards: allCards,
  });

  if (!kanbanContainer) {
    console.warn('[KanbanMode] updateKanbanUI - kanbanContainer 없음');
    return;
  }

  const rootEl = kanbanContainer.querySelector('#cp-kanban-board-root');
  if (!rootEl) {
    console.warn('[KanbanMode] updateKanbanUI - rootEl 없음');
    return;
  }

  console.log('[KanbanMode] updateKanbanUI - rootEl 확인 완료, activeChannelId 가져오기 시작');

  // [신규] 현재 활성 채널 ID 가져오기
  let activeChannelId;
  try {
    const result = await chrome.storage.local.get('activeChannelId');
    activeChannelId = result.activeChannelId;
    console.log('[KanbanMode] updateKanbanUI - activeChannelId:', activeChannelId);
  } catch (error) {
    console.error('[KanbanMode] updateKanbanUI - activeChannelId 가져오기 실패:', error);
    activeChannelId = null;
  }

  // [최적화] 증분 업데이트: 이전 데이터와 비교하여 변경된 부분만 업데이트
  const previousData = allKanbanData || {};
  allKanbanData = allCards || {};

  // 채널이 선택되지 않았을 때 온보딩 메시지 표시
  if (!activeChannelId) {
    console.log('[KanbanMode] updateKanbanUI - activeChannelId 없음, 온보딩 메시지 표시');
    const ideasCol = rootEl.querySelector('[data-status="ideas"] .kanban-col-cards');
    if (ideasCol) {
      ideasCol.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: #f8f9fa; border-radius: 8px; margin: 20px;">
          <div style="font-size: 48px; margin-bottom: 16px;">📺</div>
          <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #333; font-weight: 600;">
            채널을 선택해주세요
          </h3>
          <p style="margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;">
            상단의 <strong>글로벌 채널 선택기</strong>에서 채널을 선택하거나<br>
            <strong>'⚙️ 채널 관리'</strong>에서 새 채널을 추가해주세요.
          </p>
          <button id="kanban-onboarding-manage-btn" style="padding: 10px 20px; background: #2d8cf0; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">
            채널 관리로 이동
          </button>
        </div>
      `;

      // 채널 관리 버튼 이벤트
      const manageBtn = ideasCol.querySelector('#kanban-onboarding-manage-btn');
      if (manageBtn) {
        manageBtn.addEventListener('click', () => {
          const shadowRoot = kanbanContainer.getRootNode();
          const header = shadowRoot.querySelector('#cp-header-area');
          if (header) {
            const channelSelector = shadowRoot.querySelector('#global-channel-selector');
            if (channelSelector) {
              channelSelector.value = '__MANAGE__';
              channelSelector.dispatchEvent(new Event('change'));
            }
          }
        });
      }
    }
    return;
  }

  // 데이터가 없을 때 처리
  if (!allCards || Object.keys(allCards).length === 0) {
    console.log('[KanbanMode] updateKanbanUI - 데이터 없음');
    const ideasCol = rootEl.querySelector('[data-status="ideas"] .kanban-col-cards');
    if (ideasCol)
      ideasCol.innerHTML =
        '<p style="text-align: center; color: #888; padding: 20px;">기획 보드에 아이디어를 추가해주세요.</p>';
    return;
  }

  console.log(
    '[KanbanMode] updateKanbanUI - 카드 렌더링 시작, status 개수:',
    Object.keys(allCards).length
  );

  // [최적화] 각 컬럼별로 증분 업데이트 수행
  for (const status of ['ideas', 'in-progress', 'done']) {
    const colContainer = rootEl.querySelector(
      `.cp-kanban-col[data-status="${status}"] .kanban-col-cards`
    );
    if (colContainer) {
      await updateColumnIncremental(
        colContainer,
        status,
        allCards[status] || {},
        previousData[status] || {},
        activeChannelId
      );
    }
  }

  console.log('[KanbanMode] updateKanbanUI 완료');
}

/**
 * [최적화] 컬럼별 증분 업데이트 함수
 * 변경된 카드만 업데이트하여 성능 개선
 */
async function updateColumnIncremental(
  columnEl,
  status,
  currentCards,
  previousCards,
  activeChannelId
) {
  // [버그 수정] 로딩 메시지 제거 로직 추가
  // 데이터가 0개여도 로딩 메시지는 반드시 지워져야 합니다.
  const loadingEl = columnEl.querySelector('.loading-scraps');
  if (loadingEl) {
    loadingEl.remove();
    // 로딩 메시지가 있었다면, 초기화 상태이므로 강제로 모든 카드를 다시 렌더링하도록 유도하기 위해
    // previousCards를 비워서 '모두 추가됨'으로 인식하게 만듭니다.
    previousCards = {};
  }

  const currentFiltered = {};
  const previousFiltered = {};

  // 현재 데이터 필터링
  for (const [cardId, cardData] of Object.entries(currentCards)) {
    if (shouldIncludeCard(cardData, activeChannelId)) {
      currentFiltered[cardId] = cardData;
    }
  }

  // 이전 데이터 필터링
  for (const [cardId, cardData] of Object.entries(previousCards)) {
    if (shouldIncludeCard(cardData, activeChannelId)) {
      previousFiltered[cardId] = cardData;
    }
  }

  // 변경 감지
  const added = Object.keys(currentFiltered).filter((id) => !previousFiltered[id]);
  const removed = Object.keys(previousFiltered).filter((id) => !currentFiltered[id]);
  const updated = Object.keys(currentFiltered).filter(
    (id) =>
      previousFiltered[id] &&
      JSON.stringify(currentFiltered[id]) !== JSON.stringify(previousFiltered[id])
  );

  console.log(`[KanbanMode] ${status} 컬럼 증분 업데이트:`, {
    added: added.length,
    removed: removed.length,
    updated: updated.length,
  });

  // [최적화] 변경된 카드만 DOM 조작
  if (added.length === 0 && removed.length === 0 && updated.length === 0) {
    // 변경사항 없음 - 정렬만 확인
    const needsResort = checkIfNeedsResort(currentFiltered, columnEl);
    if (needsResort) {
      await renderCardsInColumnIncremental(columnEl, status, currentFiltered);
    }
    return;
  }

  // 제거된 카드 삭제
  removed.forEach((cardId) => {
    const cardEl = columnEl.querySelector(`[data-id="${cardId}"]`);
    if (cardEl) {
      cardEl.remove();
    }
  });

  // 추가/업데이트된 카드 처리
  const cardsToRender = [...added, ...updated];
  if (cardsToRender.length > 0) {
    // 기존 카드들을 Map으로 저장
    const existingCards = new Map();
    columnEl.querySelectorAll('.cp-kanban-card').forEach((card) => {
      existingCards.set(card.dataset.id, card);
    });

    // 변경된 카드들만 다시 렌더링
    for (const cardId of cardsToRender) {
      const cardData = currentFiltered[cardId];
      const existingCard = existingCards.get(cardId);

      if (existingCard) {
        // 업데이트: 기존 카드 교체
        const newCard = createKanbanCard(cardId, cardData, status);
        existingCard.replaceWith(newCard);
      } else {
        // 추가: 새로운 카드 삽입
        const newCard = createKanbanCard(cardId, cardData, status);
        columnEl.appendChild(newCard);
      }
    }
  }

  // 정렬 적용
  await applySortingToColumn(columnEl, currentFiltered);
}

/**
 * [최적화] 증분 카드 렌더링 함수
 */
async function renderCardsInColumnIncremental(columnEl, status, cards) {
  // DocumentFragment를 사용하여 효율적으로 렌더링
  const fragment = document.createDocumentFragment();

  for (const [cardId, cardData] of Object.entries(cards)) {
    const cardEl = createKanbanCard(cardId, cardData, status);
    fragment.appendChild(cardEl);
  }

  // 한 번에 DOM 업데이트
  columnEl.innerHTML = '';
  columnEl.appendChild(fragment);
}

/**
 * [최적화] 카드가 포함되어야 하는지 확인
 */
function shouldIncludeCard(cardData, activeChannelId) {
  if (!cardData) return false;

  if (cardData.channelId === undefined && activeChannelId) {
    return true; // 구버전 데이터
  } else if (cardData.channelId && activeChannelId) {
    if (cardData.channelId === activeChannelId) {
      return true;
    }
    // URL origin 비교
    try {
      const cardUrl = atob(cardData.channelId.replace(/=/g, ''));
      const activeUrl = atob(activeChannelId.replace(/=/g, ''));
      const cardUrlObj = new URL(cardUrl);
      const activeUrlObj = new URL(activeUrl);
      return cardUrlObj.origin === activeUrlObj.origin;
    } catch (e) {
      return cardData.channelId === activeChannelId;
    }
  }
  return false;
}

/**
 * [최적화] 정렬이 필요한지 확인
 */
function checkIfNeedsResort(cards, columnEl) {
  const currentOrder = Array.from(columnEl.querySelectorAll('.cp-kanban-card')).map(
    (card) => card.dataset.id
  );
  const sortedOrder = Object.entries(cards)
    .sort((a, b) => {
      const timeA = a[1].createdAt || 0;
      const timeB = b[1].createdAt || 0;
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    })
    .map(([id]) => id);

  return JSON.stringify(currentOrder) !== JSON.stringify(sortedOrder);
}

/**
 * [최적화] 컬럼에 정렬 적용
 */
async function applySortingToColumn(columnEl, cards) {
  const sortedCards = Object.entries(cards).sort((a, b) => {
    const timeA = a[1].createdAt || 0;
    const timeB = b[1].createdAt || 0;
    return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
  });

  // DocumentFragment를 사용하여 효율적으로 재정렬
  const fragment = document.createDocumentFragment();
  const existingCards = new Map();

  columnEl.querySelectorAll('.cp-kanban-card').forEach((card) => {
    existingCards.set(card.dataset.id, card);
  });

  for (const [cardId] of sortedCards) {
    const cardEl = existingCards.get(cardId);
    if (cardEl) {
      fragment.appendChild(cardEl);
    }
  }

  // 한 번에 DOM 업데이트
  columnEl.innerHTML = '';
  columnEl.appendChild(fragment);
}

function renderCardsInColumn(columnEl, status, cards) {
  // 성능 최적화: DocumentFragment를 사용하여 DOM 조작 최소화
  const fragment = document.createDocumentFragment();
  const sortedCards = Object.entries(cards).sort((a, b) => {
    const timeA = a[1].createdAt || 0;
    const timeB = b[1].createdAt || 0;
    if (sortOrder === 'asc') {
      return timeA - timeB;
    } else {
      return timeB - timeA;
    }
  });

  for (const [cardId, cardData] of sortedCards) {
    const cardEl = createKanbanCard(cardId, cardData, status);
    fragment.appendChild(cardEl);
  }

  // 한 번에 DOM에 추가하여 리플로우/리페인트 최소화
  columnEl.appendChild(fragment);
}

function createKanbanCard(id, data, status) {
  const card = document.createElement('div');
  card.className = 'cp-kanban-card';
  card.dataset.id = id;
  card.dataset.status = status;
  card.dataset.title = data.title || '';
  card.dataset.description = data.description || '';
  card.draggable = true;

  card.title = data.description || '';

  // 1. AI 추천 아이디어인 경우 cluster 클래스를 추가하여 왼쪽 테두리를 표시합니다.
  const isAiIdea = data.tags && data.tags.includes('#AI-추천');
  if (isAiIdea) {
    card.classList.add('cluster');
  }

  let topTagsHtml = '';
  // outline-tag를 가장 앞에 위치시키기
  const hasOutline = data.outline && data.outline.length > 0;
  if (hasOutline) {
    topTagsHtml += `<span class="kanban-card-tag outline-tag">📄 목차</span>`;
  }
  // 주요 키워드 표시
  if (data.mainKeywords && Array.isArray(data.mainKeywords) && data.mainKeywords.length > 0) {
    topTagsHtml += data.mainKeywords
      .map((keyword) => {
        return `<span class="kanban-card-tag main-keyword-tag">🔑 ${keyword}</span>`;
      })
      .join('');
  }
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    topTagsHtml += data.tags
      .map((tag) => {
        const cleanTag = tag.replace(/^#/, '');
        const tagClass =
          cleanTag === 'AI-추천' ? 'kanban-card-tag ai-tag' : 'kanban-card-tag default-tag';
        return `<span class="${tagClass}">#${cleanTag}</span>`;
      })
      .join('');
  }
  if (
    data.longTailKeywords &&
    Array.isArray(data.longTailKeywords) &&
    data.longTailKeywords.length > 0
  ) {
    topTagsHtml += data.longTailKeywords
      .map((keyword) => {
        return `<span class="kanban-card-tag long-tail-tag">${keyword}</span>`;
      })
      .join('');
  }

  // [체크리스트 2] 연결된 스크랩 개수 확인 (workspace.linkedScraps 우선, 없으면 linkedScraps)
  const linkedScraps = data.workspace?.linkedScraps || data.linkedScraps || {};
  const linkedScrapsCount =
    typeof linkedScraps === 'object' && !Array.isArray(linkedScraps)
      ? Object.keys(linkedScraps).length
      : Array.isArray(linkedScraps)
        ? linkedScraps.length
        : 0;
  let metaInfoHtml = '';

  // ▼▼▼ [1] 애드센스 배지 HTML 생성 (조건 없이 독립적으로 생성) ▼▼▼
  let adsenseBadgeHtml = '';
  if (data.adSenseRegistered) {
    adsenseBadgeHtml = `<span class="adsense-badge" title="애드센스 URL 채널에 정식 등록됨 (데이터 2중 백업)">A</span>`;
  }
  // ▲▲▲ 생성 끝 ▲▲▲

  // ▼▼▼ [수정] 모든 아이디어 카드의 출처 라벨을 명확히 정의 ▼▼▼
  // 출처 정보 표시 (모든 origin 타입에 대해 명확한 라벨 정의)
  if (data.origin && data.origin.type) {
    let originIcon = '';
    let originText = '';
    let originClass = data.origin.type;

    switch (data.origin.type) {
      case 'my_post':
        originIcon = '🔄';
        originText = '내 글 리뉴얼';
        break;
      case 'competitor_post':
        originIcon = '🎯';
        originText = `출처: ${data.origin.channelName || '경쟁사'}`;
        break;
      case 'my_post_renewal':
        originIcon = '🔄';
        originText = '자동 리뉴얼 제안';
        break;
      case 'ai_generated':
        originIcon = '🤖';
        originText = 'AI 생성';
        break;
      case 'manual_entry':
        originIcon = '✏️';
        originText = '수동 입력';
        break;
      case 'tracking_only':
        originIcon = '📊';
        // tracking_only인 경우 채널 정보를 가져와서 블로그 이름 표시
        chrome.storage.local.get('activeChannelId', (res) => {
          const activeChannelId = res.activeChannelId;
          if (activeChannelId) {
            chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
              if (response && response.channels && response.channels[activeChannelId]) {
                const channelData = response.channels[activeChannelId];
                const blogName = channelData.name || channelData.blogName || '블로그';
                // DOM 요소를 찾아서 텍스트 업데이트
                const cardElement = document.querySelector(`[data-id="${id}"]`);
                if (cardElement) {
                  const originTag = cardElement.querySelector(
                    '.kanban-card-meta.origin-tag.tracking_only'
                  );
                  if (originTag) {
                    originTag.innerHTML = `📊 ${blogName}`;
                    originTag.title = `성과 추적 전용: ${blogName}`;
                  }
                }
              }
            });
          }
        });
        originText = '성과 추적 전용'; // 기본값
        break;
      default:
        // 알 수 없는 타입
        originIcon = '📌';
        originText = `출처: ${data.origin.type}`;
        break;
    }

    if (originIcon || originText) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag ${originClass}" title="아이디어 출처: ${originText}">${originIcon} ${originText}</span>`;
    }
  } else {
    // origin이 없지만 태그로 출처를 추론할 수 있는 경우
    const tags = data.tags || [];
    if (tags.includes('#스크랩-전환')) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag scrap-converted" title="스크랩에서 전환된 아이디어">📎 스크랩 전환</span>`;
    } else if (tags.includes('#스핀오프')) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag spin-off" title="워크스페이스에서 생성된 스핀오프 아이디어">💡 스핀오프</span>`;
    } else if (tags.includes('#유사-아이디어')) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag similar-idea" title="AI가 생성한 유사 아이디어">🔄 유사 아이디어</span>`;
    } else if (tags.includes('#리뉴얼-제안')) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag renewal-suggestion" title="AI가 제안한 리뉴얼 아이디어">🔄 리뉴얼 제안</span>`;
    } else if (tags.includes('#AI-추천')) {
      metaInfoHtml += `<span class="kanban-card-meta origin-tag ai-recommended" title="AI가 추천한 아이디어">🤖 AI 추천</span>`;
    }
  }
  // ▲▲▲ [수정 완료] ▲▲▲

  if (linkedScrapsCount > 0) {
    metaInfoHtml += `<span class="kanban-card-meta linked-scraps-count">🔗 ${linkedScrapsCount}개</span>`;
  }
  // K-1: draftContent 또는 workspace.draft가 있으면 초안 완료 표시
  // null, 빈 문자열, 빈 객체는 제외
  const hasDraftContent =
    data.draftContent &&
    data.draftContent !== null &&
    data.draftContent !== '' &&
    data.draftContent !== '<p><br></p>' &&
    data.draftContent !== '<p></p>';
  const hasWorkspaceDraft =
    data.workspace?.draft &&
    data.workspace.draft !== null &&
    data.workspace.draft !== '' &&
    data.workspace.draft !== '<p><br></p>' &&
    data.workspace.draft !== '<p></p>';

  if (hasDraftContent || hasWorkspaceDraft) {
    metaInfoHtml += `<span class="kanban-card-meta draft-status-count">📝 초안 완료</span>`;
  }

  // 성과 지표가 있으면 카드에 시각적 표시 추가
  const performance = data.performance;
  // [수정] performance 필드가 있고 collecting이 false이며 collectingCompletedAt이 있으면 수집 완료로 간주
  const isCollectionCompleted =
    performance && performance.collecting === false && performance.collectingCompletedAt;
  // 데이터 없음(0 값)은 오류가 아님 - error 필드가 없고, collectionErrors도 없어야 함
  const hasPerformance =
    performance &&
    !performance.error &&
    (performance.pageviews > 0 ||
      performance.estimatedEarnings > 0 ||
      performance.sessions > 0 ||
      performance.avgSessionDuration > 0);
  const isCollecting = performance && performance.collecting === true;
  // 실제 오류인지 확인: error 필드가 있거나, collectionErrors와 errorType이 모두 있는 경우
  // 단, error 필드가 "데이터 없음" 관련 메시지면 오류가 아님
  const hasError =
    performance &&
    ((performance.error &&
      !performance.error.includes('데이터 없음') &&
      !performance.error.includes('데이터가 없을 수 있습니다')) ||
      (performance.collectionErrors && performance.errorType));
  const errorType = performance?.errorType;
  const collectionErrors = performance?.collectionErrors;

  // 발행 완료 카드에 성과 추적 상태 및 해지 성과 태그 추가
  if (status === 'done') {
    // 성과 추적 연결 상태 태그
    if (data.publishedUrl) {
      if (isCollecting) {
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag collecting">🔄 수집 중...</span>`;
      } else if (hasError) {
        // 에러 타입에 따른 메시지
        let errorMessage = '❌ 수집 실패';
        let errorTooltip = performance.error || '알 수 없는 오류';

        if (errorType === 'AUTH_MISSING') {
          errorMessage = '🔑 인증 필요';
          errorTooltip = 'Google 계정 연동이 필요합니다. 채널 연동 설정에서 연동해주세요.';
        } else if (errorType === 'ID_MISSING') {
          errorMessage = '⚙️ 설정 필요';
          errorTooltip =
            'GA4 속성 ID 또는 AdSense 계정 ID가 설정되지 않았습니다. 채널 연동 설정을 확인해주세요.';
        } else if (errorType === 'API_ERROR') {
          errorMessage = '⚠️ API 오류';
          // collectionErrors가 있으면 더 자세한 정보 표시
          if (collectionErrors) {
            const errors = [];
            if (collectionErrors.analytics) errors.push(`GA4: ${collectionErrors.analytics}`);
            if (collectionErrors.adsense) errors.push(`AdSense: ${collectionErrors.adsense}`);
            errorTooltip = errors.length > 0 ? errors.join('\n') : errorTooltip;
          } else {
            errorTooltip = `API 호출 중 오류가 발생했습니다: ${errorTooltip}`;
          }
        } else if (collectionErrors && errorType) {
          // collectionErrors와 errorType이 모두 있는 경우만 실제 오류로 처리
          const errors = [];
          if (collectionErrors.analytics) errors.push(`GA4: ${collectionErrors.analytics}`);
          if (collectionErrors.adsense) errors.push(`AdSense: ${collectionErrors.adsense}`);
          errorTooltip = errors.length > 0 ? errors.join('\n') : errorTooltip;
          // errorType이 없으면 데이터 없음으로 처리 (오류 아님)
        }
        // collectionErrors만 있고 errorType이 없으면 데이터 없음으로 처리 (오류 표시하지 않음)

        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag error" title="${errorTooltip}">${errorMessage}</span>`;
      } else if (hasPerformance) {
        // 데이터가 있는 경우 (실제 성과 데이터 있음)
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag connected">✅ 추적 중</span>`;
      } else if (isCollectionCompleted) {
        // [수정] 수집이 완료되었지만 데이터가 0인 경우 - 다른 스타일 적용
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag connected-no-data" title="수집 완료되었으나 아직 데이터가 없습니다">📊 추적 중 (데이터 없음)</span>`;
      } else if (performance) {
        // [수정] performance 필드가 있지만 수집이 아직 완료되지 않은 경우
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag waiting">⏳ 추적 대기</span>`;
      } else {
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag waiting">⏳ 추적 대기</span>`;
      }
    } else {
      metaInfoHtml += `<span class="kanban-card-meta performance-status-tag not-connected">❌ 미연결</span>`;
    }

    // 해지 성과 태그 (성과 데이터가 있을 때만)
    if (hasPerformance) {
      const pageviews = performance.pageviews || 0;
      const earnings = performance.estimatedEarnings || 0;
      const avgDuration = performance.avgSessionDuration || 0;

      metaInfoHtml += `
        <span class="kanban-card-meta performance-summary-tag" title="페이지뷰: ${pageviews.toLocaleString()}, 수익: $${earnings.toFixed(2)}, 체류: ${Math.round(avgDuration)}초">
          📊 ${pageviews.toLocaleString()}회 / $${earnings.toFixed(2)} ${adsenseBadgeHtml}
        </span>
      `;
    }

    // ▼▼▼ [2] 메타 정보(metaInfoHtml)에 배지 추가하기 ▼▼▼
    // [수정 포인트] 기존에는 hasPerformance 안에서만 배지를 넣었을 수 있습니다.
    // 아래와 같이 '발행 완료(done)' 컬럼이면 성과가 없어도 배지가 보이게 하세요.
    // [추가] 배지가 있고, 아직 메타 정보에 추가되지 않았다면 추가
    if (adsenseBadgeHtml && !hasPerformance) {
      // 성과 태그 옆이나, 별도의 줄에 추가
      metaInfoHtml += `<span class="kanban-card-meta" style="margin-left:4px;">${adsenseBadgeHtml} 인증됨</span>`;
    }
    // ▲▲▲ 추가 완료 ▲▲▲

    // 데이터 수집 상태 표시 (GA4, AdSense 개별 상태)
    // 실제 오류가 있거나 수집 중이거나 성과 데이터가 있을 때만 표시
    if (data.publishedUrl && (hasPerformance || hasError || isCollecting)) {
      // collectionErrors가 있어도 errorType이 없으면 데이터 없음으로 처리 (오류 아님)
      const hasRealCollectionError = collectionErrors && errorType;
      const gaStatus =
        hasPerformance && !hasRealCollectionError
          ? '✅'
          : hasRealCollectionError && collectionErrors?.analytics
            ? '❌'
            : '⏳';
      const adsenseStatus =
        hasPerformance && !hasRealCollectionError
          ? '✅'
          : hasRealCollectionError && collectionErrors?.adsense
            ? '❌'
            : '⏳';

      // 수집 중이거나 실제 오류가 있을 때만 표시 (데이터 없음은 표시하지 않음)
      if (isCollecting || hasError) {
        metaInfoHtml += `
          <span class="kanban-card-meta data-source-status" title="GA4: ${gaStatus === '✅' ? '정상' : gaStatus === '❌' ? '오류' : '대기'} | AdSense: ${adsenseStatus === '✅' ? '정상' : adsenseStatus === '❌' ? '오류' : '대기'}">
            📡 ${gaStatus} GA4 ${adsenseStatus} AdSense
          </span>
        `;
      }
    }
  }

  if (hasPerformance) {
    card.classList.add('has-performance');
    const pageviews = performance.pageviews || 0;
    const earnings = performance.estimatedEarnings || 0;
    const avgDuration = performance.avgSessionDuration || 0;

    // 성과 지표 미리보기
    const pageRPM = performance.pageRPM || 0; // [추가]
    const pageCTR = performance.pageCTR || 0; // [추가]

    const performancePreview = `
      <div class="performance-preview">
        <span class="perf-metric" title="페이지뷰">👁️ ${pageviews.toLocaleString()}</span>
        <span class="perf-metric" title="수익">💰 $${earnings.toFixed(2)}</span>
        ${avgDuration > 0 ? `<span class="perf-metric" title="평균 체류 시간">⏱️ ${Math.round(avgDuration)}초</span>` : ''}
      </div>
      ${
        pageRPM > 0 || pageCTR > 0
          ? `
        <div class="metric-detail-row">
          <span class="metric-sub-tag" title="1,000회 노출당 수익">RPM $${pageRPM.toFixed(2)}</span>
          <span class="metric-sub-tag" title="광고 클릭률">CTR ${pageCTR.toFixed(1)}%</span>
        </div>
      `
          : ''
      }
    `;
    metaInfoHtml += performancePreview;
  } else if (hasError) {
    // 에러가 있는 경우 카드에 에러 스타일 적용
    card.classList.add('has-error');
  }

  let actionButtons = ``;
  // 컨텍스트 메뉴 버튼 추가 (모든 상태에서)
  actionButtons += `<button class="card-context-menu-btn" title="더보기" data-card-id="${id}">⋯</button>`;
  // 삭제 버튼은 "ideas" 단계에서만 표시
  if (status === 'ideas') {
    actionButtons += `<button class="delete-card-btn" title="카드 삭제" data-card-id="${id}">🗑️</button>`;
  }

  if (status === 'done') {
    if (!data.publishedUrl) {
      actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
    } else {
      const earnings = hasPerformance
        ? `$${(performance.estimatedEarnings || 0).toFixed(2)}`
        : '대기중';
      actionButtons += `
        <a href="${data.publishedUrl}" target="_blank" class="performance-link">수익: ${earnings}</a>
        <button class="change-url-btn" title="링크 변경">✏️ 변경</button>
        ${hasPerformance ? `<button class="view-performance-detail-btn" data-card-id="${id}">📊 상세</button>` : ''}
      `;
    }
  }
  // SEO 제목이 있으면 표시
  const seoTitleHtml =
    data.seoTitle
      ? `<div style="font-size: 11px; color: #666; margin-top: 4px; font-weight: normal; line-height: 1.3;">
        <span style="color: #4285f4;">SEO:</span> ${data.seoTitle}
      </div>`
      : '';

  card.innerHTML = `
    <div class="kanban-card-body">
      <span class="kanban-card-title">${data.title || '제목 없음'}</span>
      ${seoTitleHtml}
      <div class="card-top-tags">${topTagsHtml}</div>
    </div>
    <div class="kanban-card-footer">
      <div class="kanban-card-meta">${metaInfoHtml}</div>
      <div class="kanban-card-actions">${actionButtons}</div>
    </div>
  `;
  return card;
}

// 이벤트 리스너 핸들러를 저장하여 중복 등록 방지
let kanbanClickHandler = null;
let kanbanAddCardHandler = null;

function addKanbanEventListeners(container) {
  const root = container.querySelector('#cp-kanban-board-root');
  if (!root) return;

  // [UI 모듈 독립성 강화] 중복 등록 방지
  if (root.dataset.listenersAttached === 'true') {
    return; // 이미 등록됨
  }
  root.dataset.listenersAttached = 'true';

  // 기존 리스너가 있다면 제거 (안전장치)
  if (kanbanClickHandler) {
    root.removeEventListener('click', kanbanClickHandler);
  }
  if (kanbanAddCardHandler) {
    root.removeEventListener('click', kanbanAddCardHandler);
  }

  // K-3: 초안 삭제 버튼 클릭 이벤트 리스너 완전 제거
  const sortControls = container.querySelector('.kanban-sort-controls');
  if (sortControls) {
    sortControls.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('kanban-sort-btn')) {
        const newSortOrder = target.dataset.sort;
        if (newSortOrder !== sortOrder) {
          // 상태 변수 업데이트
          sortOrder = newSortOrder;

          // 버튼 활성 상태 업데이트
          sortControls.querySelector('.active').classList.remove('active');
          target.classList.add('active');

          // 변경된 정렬 순서로 UI 전체를 다시 렌더링
          updateKanbanUI(allKanbanData);
        }
      }
    });
  }

  // [신규] 채널 변경 감지 -> 칸반 UI 새로고침
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.activeChannelId) {
      console.log('[Kanban] 채널 변경 감지, 데이터 다시 로드 및 UI 새로고침');
      // 채널이 변경되면 항상 데이터를 다시 로드하여 최신 상태 보장
      chrome.runtime.sendMessage({ action: 'get_kanban_data' });
    }
  });

  // ▼▼▼ [추가] "+ 카드 추가" 버튼 클릭 이벤트 리스너 ▼▼▼
  kanbanAddCardHandler = (e) => {
    const addCardBtn = e.target.closest('.kanban-add-card-btn');
    if (addCardBtn) {
      e.stopPropagation();
      const status = addCardBtn.dataset.status;
      showAddCardInput(container, status, addCardBtn);
      return;
    }
  };
  root.addEventListener('click', kanbanAddCardHandler);

  kanbanClickHandler = (e) => {
    const card = e.target.closest('.cp-kanban-card');
    if (!card) return;

    if (e.target.closest('.card-context-menu-btn')) {
      e.stopPropagation();
      const menuBtn = e.target.closest('.card-context-menu-btn');
      const cardId = menuBtn.dataset.cardId;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      showCardContextMenu(container, card, cardId, status, cardData, menuBtn);
      return;
    } else if (e.target.closest('.delete-card-btn')) {
      e.stopPropagation();
      const cardId = e.target.closest('.delete-card-btn').dataset.cardId;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      const cardTitle = cardData?.title || '제목 없음';

      if (confirm(`"${cardTitle}" 카드를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
        chrome.runtime.sendMessage(
          {
            action: 'delete_kanban_card',
            data: { cardId, status },
          },
          (response) => {
            if (response && response.success) {
              showToast('✅ 카드가 삭제되었습니다.');

              // 로컬 데이터에서 카드 제거
              if (allKanbanData[status] && allKanbanData[status][cardId]) {
                delete allKanbanData[status][cardId];
              }

              // UI 즉시 업데이트
              updateKanbanUI(allKanbanData);

              // ▼▼▼ [수정] 대시보드의 addedIdeas에서도 제거 ▼▼▼
              // 모든 캐시 키를 확인하여 해당 firebaseKey를 가진 아이디어 제거
              chrome.storage.local.get(null, (allStorage) => {
                const updates = {};
                for (const key in allStorage) {
                  if (key.startsWith('analysisCache_')) {
                    const cache = allStorage[key];
                    if (cache && cache.addedIdeas && Array.isArray(cache.addedIdeas)) {
                      const filteredIdeas = cache.addedIdeas.filter(
                        (idea) => idea.firebaseKey !== cardId
                      );
                      if (filteredIdeas.length !== cache.addedIdeas.length) {
                        updates[key] = { ...cache, addedIdeas: filteredIdeas };
                      }
                    }
                  }
                }
                if (Object.keys(updates).length > 0) {
                  chrome.storage.local.set(updates);
                }
              });
              // ▲▲▲ [수정 완료] ▲▲▲
            } else {
              showToast('❌ 삭제 실패: ' + (response?.error || '알 수 없는 오류'));
            }
          }
        );
      }
    } else if (e.target.closest('.track-performance-btn') || e.target.closest('.change-url-btn')) {
      e.stopPropagation();
      const cardId = card.dataset.id;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      showPublishUrlModal(
        container,
        cardId,
        status,
        cardData?.title || '',
        cardData?.publishedUrl || ''
      );
    } else if (e.target.closest('.view-performance-detail-btn')) {
      e.stopPropagation();
      const cardId = e.target.closest('.view-performance-detail-btn').dataset.cardId;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      if (cardData && cardData.performance) {
        showPerformanceDetailModal(container, cardId, cardData);
      }
    } else {
      const cardId = card.dataset.id;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      if (cardData) {
        window.__cp_active_mode = 'workspace';

        const shadowRoot = container.getRootNode();
        renderHeaderAndTabs(shadowRoot);

        // ▼▼▼ [수정] 기본값 할당 ▼▼▼
        // renderWorkspace로 넘기기 전에 데이터 구조를 한 번 더 보장합니다.
        const ideaDataForWorkspace = {
          ...cardData,
          id: cardId,
          status: status,
          // workspace 객체가 없으면(null/undefined) 빈 값으로 초기화
          workspace: cardData.workspace || {
            keywords: [],
            outline: [],
            draft: '',
            linkedScraps: {},
          },
        };
        // 전역 ideaData 업데이트 (실시간 업데이트를 위해)
        window.__cp_workspace_idea_data = ideaDataForWorkspace;
        // ▲▲▲ [수정 완료] ▲▲▲

        renderWorkspace(kanbanContainer, ideaDataForWorkspace); // 수정된 객체 전달
      }
    }
  };

  root.addEventListener('click', kanbanClickHandler);

  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.cp-kanban-card');
    if (card) {
      currentlyDragging.cardId = card.dataset.id;
      currentlyDragging.originalStatus = card.dataset.status;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => (card.style.opacity = '0.5'), 0);
    }
  });

  root.addEventListener('dragend', (e) => {
    const card = e.target.closest('.cp-kanban-card');
    if (card) card.style.opacity = '1';
    currentlyDragging = { cardId: null, originalStatus: null };
  });

  root.addEventListener('dragover', (e) => {
    if (e.target.closest('.cp-kanban-col')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });

  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetColumn = e.target.closest('.cp-kanban-col');
    const newStatus = targetColumn?.dataset.status;
    const { cardId, originalStatus } = currentlyDragging;
    if (newStatus && cardId && originalStatus && newStatus !== originalStatus) {
      const cardData = allKanbanData[originalStatus]?.[cardId];
      const hasDraft = !!cardData?.draftContent;
      // K-7: 아이디어 컬럼에서 초안 없는 카드 이동 제한
      if (originalStatus === 'ideas' && !hasDraft) {
        showToast(
          '⚠️ 기획을 시작하려면 카드를 클릭하여 워크스페이스에서 초안을 생성하거나, 자료를 연결해야 합니다.'
        );
        return;
      }
      // 기존 K-5: 초안이 존재하는 상태에서 'ideas' 컬럼으로 복귀 시 제한
      if (hasDraft && newStatus === 'ideas') {
        showToast(
          "⚠️ 초안이 작성된 아이디어는 '아이디어' 단계로 되돌릴 수 없습니다. (초안 삭제 후 복귀 가능)"
        );
        return;
      }
      // 모든 제한을 통과하면 이동 허용
      chrome.runtime.sendMessage({
        action: 'move_kanban_card',
        data: { cardId, originalStatus, newStatus },
      });
    }
  });
}

/**
 * 카드 추가 입력 필드를 표시하는 함수 (Trello 스타일)
 */
function showAddCardInput(container, status, addCardBtn) {
  // 이미 입력 필드가 열려있으면 닫기
  const existingInput = container.querySelector('.kanban-add-card-input-wrapper');
  if (existingInput) {
    existingInput.remove();
    return;
  }

  // 입력 필드 HTML 생성
  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'kanban-add-card-input-wrapper';
  inputWrapper.style.cssText = `
    padding: 8px;
    background: #f8f9fa;
    border-radius: 8px;
    margin-top: 8px;
  `;

  inputWrapper.innerHTML = `
    <textarea 
      class="kanban-add-card-input" 
      placeholder="제목을 입력하고 Enter를 눌러 저장하세요..."
      rows="2"
      style="
        width: 100%;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        resize: none;
        box-sizing: border-box;
      "
    ></textarea>
    <div style="display: flex; gap: 8px; margin-top: 8px;">
      <button class="kanban-add-card-ai-btn" style="
        padding: 6px 12px;
        background: #2e7d32;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
      ">AI 제안</button>
      <button class="kanban-add-card-submit-btn" style="
        padding: 6px 12px;
        background: #4285f4;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
      ">추가</button>
      <button class="kanban-add-card-cancel-btn" style="
        padding: 6px 12px;
        background: transparent;
        color: #666;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
      ">취소</button>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button class="kanban-add-card-ai-btn" style="
          padding: 6px 12px;
          background: #2e7d32;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        ">AI 제안</button>
        <button class="kanban-add-card-submit-btn" style="
          padding: 6px 12px;
          background: #4285f4;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        ">추가</button>
        <button class="kanban-add-card-cancel-btn" style="
          padding: 6px 12px;
          background: transparent;
          color: #666;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        ">취소</button>
      </div>

      <div class="kanban-add-card-ai-suggestions" style="display:none; margin-top:10px; padding:8px; border-radius:6px; background:#fff; border:1px solid #eee;">
        <div class="kanban-ai-suggestions-loading" style="display:none; color:#666; font-size:13px;">🤖 AI 제안 생성 중...</div>
        <div class="kanban-ai-suggestions-content" style="display:none;">
          <div style="font-weight:600; margin-bottom:6px;">AI 추천 검색어</div>
          <div class="kanban-ai-recommended-searches" style="margin-bottom:8px; color:#333"></div>
          <div style="font-weight:600; margin-bottom:6px;">롱테일 키워드</div>
          <div class="kanban-ai-longtail" style="margin-bottom:8px; color:#333"></div>
          <div style="font-weight:600; margin-bottom:6px;">추천 목차 (outline)</div>
          <div class="kanban-ai-outline" style="color:#333; white-space:pre-wrap"></div>
        </div>
      </div>
  `;

  // 버튼 다음에 입력 필드 삽입
  const column = addCardBtn.closest('.cp-kanban-col');
  const cardsContainer = column.querySelector('.kanban-col-cards');
  cardsContainer.insertBefore(inputWrapper, cardsContainer.firstChild);

  const textarea = inputWrapper.querySelector('.kanban-add-card-input');
  const submitBtn = inputWrapper.querySelector('.kanban-add-card-submit-btn');
  const aiBtn = inputWrapper.querySelector('.kanban-add-card-ai-btn');
  const suggestionsWrap = inputWrapper.querySelector('.kanban-add-card-ai-suggestions');
  const suggestionsLoading = inputWrapper.querySelector('.kanban-ai-suggestions-loading');
  const suggestionsContent = inputWrapper.querySelector('.kanban-ai-suggestions-content');
  const suggestionsSearchesEl = inputWrapper.querySelector('.kanban-ai-recommended-searches');
  const suggestionsLongTailEl = inputWrapper.querySelector('.kanban-ai-longtail');
  const suggestionsOutlineEl = inputWrapper.querySelector('.kanban-ai-outline');
  const cancelBtn = inputWrapper.querySelector('.kanban-add-card-cancel-btn');

  // 포커스 및 자동 포커스
  textarea.focus();

  // Enter 키로 제출 (Shift+Enter는 줄바꿈)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCard(container, status, textarea.value.trim(), inputWrapper);
    } else if (e.key === 'Escape') {
      inputWrapper.remove();
    }
  });

  // 제출 버튼 클릭
  submitBtn.addEventListener('click', () => {
    submitCard(container, status, textarea.value.trim(), inputWrapper);
  });

  // AI 제안 버튼 클릭
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      const title = textarea.value.trim();
      if (!title) {
        showToast('⚠️ 제목을 입력한 뒤 AI 제안을 실행해주세요.');
        return;
      }

      // UI 상태 변경
      aiBtn.disabled = true;
      const prevText = aiBtn.textContent;
      aiBtn.textContent = '생성 중...';
      if (suggestionsWrap) {
        suggestionsWrap.style.display = 'block';
        suggestionsLoading.style.display = 'block';
        suggestionsContent.style.display = 'none';
      }

      const data = await fetchSeoSuggestionsForTitle(title);

      // restore UI
      aiBtn.disabled = false;
      aiBtn.textContent = prevText;
      if (!data) {
        if (suggestionsWrap) {
          suggestionsLoading.style.display = 'none';
          suggestionsContent.style.display = 'block';
          suggestionsSearchesEl.textContent = 'AI 응답을 파싱할 수 없습니다.';
        }
        return;
      }

      // Attach parsed suggestions to input wrapper for submit use
      inputWrapper._aiSuggestions = data;

      // Render suggestions
      if (suggestionsWrap) {
        suggestionsLoading.style.display = 'none';
        suggestionsContent.style.display = 'block';
        suggestionsSearchesEl.innerHTML = Array.isArray(data.recommendedSearches)
          ? data.recommendedSearches.map((s) => `<span style="display:inline-block;padding:3px 6px;margin:3px;background:#f1f3f5;border-radius:4px;font-size:12px;">${s}</span>`).join('')
          : '없음';

        suggestionsLongTailEl.innerHTML = Array.isArray(data.longTailKeywords)
          ? data.longTailKeywords.map((s) => `<div style="font-size:13px;padding:3px 0;">• ${s}</div>`).join('')
          : '없음';

        suggestionsOutlineEl.innerHTML = Array.isArray(data.outline)
          ? data.outline.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
          : (data.outline || '없음');
      }
    });
  }

  // 취소 버튼 클릭
  cancelBtn.addEventListener('click', () => {
    inputWrapper.remove();
  });

  // 외부 클릭 시 닫기 (이벤트 버블링 방지)
  setTimeout(() => {
    const closeOnOutsideClick = (e) => {
      if (!inputWrapper.contains(e.target) && !addCardBtn.contains(e.target)) {
        inputWrapper.remove();
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    document.addEventListener('click', closeOnOutsideClick);
  }, 100);
}

  // AI 제안 생성 함수
  async function fetchSeoSuggestionsForTitle(title) {
    try {
      const prompt = `아이디어 제목을 바탕으로 SEO에 적합한 추천 검색어(recommendedSearches), 롱테일 키워드(longTailKeywords), 그리고 글의 목차(outline)를 JSON 형식으로 반환해 주세요.\n\nTitle: ${title}\n\n출력 형식: {\n  \"recommendedSearches\": ["..."],\n  \"longTailKeywords\": ["..."],\n  \"outline\": ["챕터 1", "챕터 2", ...]\n}`;

      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'call_gemini', prompt }, (resp) => {
            if (!resp || !resp.text) return resolve(null);
            let text = String(resp.text || '').trim();

            // Remove fenced code blocks if present
            if (text.startsWith('```json')) text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            else if (text.startsWith('```')) text = text.replace(/```\n?/g, '').trim();

            try {
              const parsed = JSON.parse(text);
              resolve(parsed);
            } catch (e) {
              // If JSON parse failed, attempt to extract arrays by regex
              resolve(null);
            }
          });
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  }

/**
 * 카드를 제출하는 함수
 */
function submitCard(container, status, title, inputWrapper) {
  if (!title || title.trim() === '') {
    showToast('⚠️ 제목을 입력해주세요.');
    return;
  }

  // 입력 필드 제거
  inputWrapper.remove();

  // 카드 데이터 생성
  const ideaData = {
    title: title.trim(),
    description: '',
    tags: [],
    createdAt: Date.now(),
  };

  // AI 제안이 있을 경우 페이로드에 포함
  try {
    if (inputWrapper && inputWrapper._aiSuggestions) {
      const s = inputWrapper._aiSuggestions;
      if (s.recommendedSearches) ideaData.recommendedSearches = Array.isArray(s.recommendedSearches) ? s.recommendedSearches : [];
      if (s.longTailKeywords) ideaData.longTailKeywords = Array.isArray(s.longTailKeywords) ? s.longTailKeywords : [];
      if (s.outline) ideaData.outline = Array.isArray(s.outline) ? s.outline : (typeof s.outline === 'string' ? [s.outline] : []);
    }
  } catch (e) {
    // 안전하게 무시
    console.warn('[KanbanMode] AI suggestions parse error', e);
  }

  // [수정] 활성 채널 ID를 가져와서 함께 전송
  chrome.storage.local.get('activeChannelId', (res) => {
    const activeChannelId = res.activeChannelId || null;

    // background.js에 카드 추가 요청 (상태 지정)
    chrome.runtime.sendMessage(
      {
        action: 'add_idea_to_kanban',
        data: JSON.stringify(ideaData),
        status: status, // 카드를 추가할 상태 지정
        channelId: activeChannelId, // 👈 추가됨
      },
      (response) => {
        if (response && response.success) {
          showToast('✅ 카드가 추가되었습니다.');
          // 카드 목록이 자동으로 업데이트됨 (실시간 리스너)
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
              `⚠️ 이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${response.cardInfo?.title || '알 수 없음'}`
            );
          } else {
            showToast(
              '❌ 카드 추가에 실패했습니다: ' +
                (response?.error || response?.message || '알 수 없는 오류')
            );
          }
        }
      }
    );
  });
}

/**
 * 카드 컨텍스트 메뉴를 표시하는 함수
 */
function showCardContextMenu(container, card, cardId, status, cardData, menuBtn) {
  // 기존 메뉴 제거
  const existingMenu = container.querySelector('.card-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  // 메뉴 생성
  const menu = document.createElement('div');
  menu.className = 'card-context-menu';
  menu.style.cssText = `
    position: absolute;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 180px;
    padding: 4px 0;
  `;

  // 메뉴 버튼 위치 계산
  const btnRect = menuBtn.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  menu.style.top = `${btnRect.bottom - cardRect.top + 4}px`;
  menu.style.right = `${cardRect.right - btnRect.right}px`;

  // 메뉴 항목 생성
  const menuItems = [];

  // 유사 아이디어 생성 (모든 상태에서 가능)
  menuItems.push(`
    <button class="context-menu-item" data-action="generate-similar-idea" style="
      width: 100%;
      padding: 10px 16px;
      text-align: left;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      color: #333;
      transition: background 0.2s;
    ">
      💡 유사 아이디어 생성
    </button>
  `);

  // 콘텐츠 리뉴얼 제안 (발행 완료된 카드만)
  if (status === 'done' && cardData?.publishedUrl) {
    menuItems.push(`
      <button class="context-menu-item" data-action="suggest-renewal" style="
        width: 100%;
        padding: 10px 16px;
        text-align: left;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 14px;
        color: #333;
        transition: background 0.2s;
      ">
        🔄 콘텐츠 리뉴얼 제안
      </button>
    `);
  }

  menu.innerHTML = menuItems.join('');

  // 메뉴 항목 hover 효과
  menu.querySelectorAll('.context-menu-item').forEach((item) => {
    item.addEventListener('mouseenter', () => {
      item.style.background = '#f5f5f5';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
  });

  // 메뉴 항목 클릭 이벤트
  menu.addEventListener('click', (e) => {
    const menuItem = e.target.closest('.context-menu-item');
    if (!menuItem) return;

    e.stopPropagation();
    const action = menuItem.dataset.action;

    if (action === 'generate-similar-idea') {
      generateSimilarIdea(cardId, status, cardData);
    } else if (action === 'suggest-renewal') {
      suggestContentRenewal(cardId, status, cardData);
    }

    menu.remove();
  });

  // 카드에 메뉴 추가
  card.style.position = 'relative';
  card.appendChild(menu);

  // 외부 클릭 시 메뉴 닫기
  setTimeout(() => {
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    document.addEventListener('click', closeMenu);
  }, 100);
}

/**
 * 유사 아이디어 생성 함수
 */
function generateSimilarIdea(cardId, status, cardData) {
  if (!cardData) {
    showToast('❌ 카드 데이터를 찾을 수 없습니다.');
    return;
  }

  showToast('🤖 AI가 유사 아이디어를 생성 중입니다...');

  // 카드 정보를 기반으로 AI에게 유사 아이디어 생성 요청
  const prompt = `
당신은 블로그 콘텐츠 전략가입니다. 아래 기존 콘텐츠를 기반으로 유사하지만 차별화된 새로운 아이디어를 제안해주세요.

[기존 콘텐츠]
- 제목: ${cardData.title || '제목 없음'}
- 설명: ${cardData.description || '설명 없음'}
- 태그: ${(cardData.tags || []).join(', ') || '없음'}

[요청]
- 기존 콘텐츠와 유사한 주제이지만 다른 각도나 접근 방식으로 차별화된 아이디어 3개를 제안해주세요.
- 스핀오프, 후속편, 심화 버전 등 다양한 형태로 제안 가능합니다.

[출력 형식]
반드시 다음 JSON 배열 형식으로만 응답해주세요:
[
  {
    "title": "아이디어 제목",
    "description": "이 아이디어가 기존 콘텐츠와 어떻게 차별화되는지 설명"
  }
]
`;

  chrome.runtime.sendMessage(
    {
      action: 'call_gemini',
      prompt: prompt,
    },
    (response) => {
      if (
        response &&
        response.text &&
        !response.text.trim().startsWith('오류:') &&
        !response.text.trim().startsWith('오류：')
      ) {
        try {
          // JSON 파싱
          let ideasText = response.text.trim();
          if (ideasText.startsWith('```json')) {
            ideasText = ideasText
              .replace(/```json\n?/g, '')
              .replace(/```\n?/g, '')
              .trim();
          } else if (ideasText.startsWith('```')) {
            ideasText = ideasText.replace(/```\n?/g, '').trim();
          }
          const ideas = JSON.parse(ideasText);

          if (Array.isArray(ideas) && ideas.length > 0) {
            // 첫 번째 아이디어를 자동으로 추가
            const firstIdea = ideas[0];
            const ideaData = {
              title: firstIdea.title || '유사 아이디어',
              description: firstIdea.description || '',
              keywords: [...(cardData.tags || []), '#유사-아이디어'],
              createdAt: Date.now(),
            };

            // [수정] 활성 채널 ID를 가져와서 함께 전송
            chrome.storage.local.get('activeChannelId', (res) => {
              const activeChannelId = res.activeChannelId || null;

              chrome.runtime.sendMessage(
                {
                  action: 'add_idea_to_kanban',
                  data: JSON.stringify(ideaData),
                  status: 'ideas',
                  channelId: activeChannelId, // 👈 추가됨
                },
                (addResponse) => {
                  if (addResponse && addResponse.success) {
                    showToast(`✅ "${firstIdea.title}" 아이디어가 추가되었습니다!`);
                  } else {
                    showToast('❌ 아이디어 추가에 실패했습니다.');
                  }
                }
              );
            });
          } else {
            showToast('❌ 생성된 아이디어 형식이 올바르지 않습니다.');
          }
        } catch (e) {
          console.error('아이디어 파싱 오류:', e);
          showToast('❌ AI 응답을 파싱하는 중 오류가 발생했습니다.');
        }
      } else {
        showToast('❌ AI 아이디어 생성에 실패했습니다.');
      }
    }
  );
}

/**
 * 콘텐츠 리뉴얼 제안 함수
 */
function suggestContentRenewal(cardId, status, cardData) {
  if (!cardData || !cardData.publishedUrl) {
    showToast('❌ 발행된 콘텐츠가 아닙니다.');
    return;
  }

  showToast('🤖 AI가 리뉴얼 제안을 생성 중입니다...');

  const performance = cardData.performance || {};
  const prompt = `
당신은 콘텐츠 최적화 전문가입니다. 아래 기존 콘텐츠를 분석하여 리뉴얼 제안을 해주세요.

[기존 콘텐츠]
- 제목: ${cardData.title || '제목 없음'}
- 설명: ${cardData.description || '설명 없음'}
- 발행 URL: ${cardData.publishedUrl}
${performance.pageviews ? `- 페이지뷰: ${performance.pageviews.toLocaleString()}회` : ''}
${performance.estimatedEarnings ? `- 수익: $${performance.estimatedEarnings.toFixed(2)}` : ''}

[요청]
이 콘텐츠를 업데이트하여 새로운 트래픽을 유입시킬 수 있는 리뉴얼 방안을 제안해주세요.
- 최신 정보로 업데이트할 부분
- 추가할 수 있는 새로운 섹션
- SEO 개선 방안
- 사용자 경험 개선 제안

[출력 형식]
다음 형식으로 응답해주세요:
**리뉴얼 제안:**

1. [제안 항목 1]
   - 구체적인 개선 방안 설명

2. [제안 항목 2]
   - 구체적인 개선 방안 설명
`;

  chrome.runtime.sendMessage(
    {
      action: 'call_gemini',
      prompt: prompt,
    },
    (response) => {
      if (response && response.text && !response.text.includes('오류')) {
        // 리뉴얼 제안을 새 아이디어로 저장
        const ideaData = {
          title: `[리뉴얼] ${cardData.title || '제목 없음'}`,
          description: `원본: ${cardData.publishedUrl}\n\n${response.text}`,
          keywords: [...(cardData.tags || []), '#리뉴얼-제안'],
          createdAt: Date.now(),
        };

        // [수정] 활성 채널 ID를 가져와서 함께 전송
        chrome.storage.local.get('activeChannelId', (res) => {
          const activeChannelId = res.activeChannelId || null;

          chrome.runtime.sendMessage(
            {
              action: 'add_idea_to_kanban',
              data: JSON.stringify(ideaData),
              status: 'ideas',
              channelId: activeChannelId, // 👈 추가됨
            },
            (addResponse) => {
              if (addResponse && addResponse.success) {
                showToast('✅ 리뉴얼 제안이 아이디어로 저장되었습니다!');
              } else {
                showToast('❌ 리뉴얼 제안 저장에 실패했습니다.');
              }
            }
          );
        });
      } else {
        showToast('❌ 리뉴얼 제안 생성에 실패했습니다.');
      }
    }
  );
}

// renderHeaderAndTabs는 header.js에서 import하여 사용

/**
 * 발행 URL 연결 모달을 표시하는 함수
 */
// 모달이 이미 열려있는지 추적하는 플래그
let isPublishUrlModalOpen = false;

function showPublishUrlModal(container, cardId, status, cardTitle, existingUrl = '') {
  // 이미 모달이 열려있으면 무시 (중복 호출 방지)
  if (isPublishUrlModalOpen) {
    Logger.debug('[KanbanMode] 발행 URL 모달이 이미 열려있음, 중복 호출 무시');
    return;
  }

  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector('.cp-publish-url-modal-wrap');
  if (existingModal) {
    existingModal.remove();
  }

  // 모달 열림 플래그 설정
  isPublishUrlModalOpen = true;

  // URL 히스토리 가져오기
  chrome.storage.local.get(['publishUrlHistory'], (result) => {
    const urlHistory = result.publishUrlHistory || [];
    const isEditing = !!existingUrl;

    // 모달 생성
    const modalWrap = document.createElement('div');
    modalWrap.className = 'cp-publish-url-modal-wrap';
    modalWrap.innerHTML = `
      <div class="cp-modal-backdrop"></div>
      <div class="cp-publish-url-modal">
        <div class="cp-modal-header">
          <div class="cp-modal-title">${isEditing ? '✏️ 발행 URL 변경' : '🔗 발행 URL 연결'}</div>
          <button class="cp-modal-close" title="닫기">×</button>
        </div>
        <div class="cp-modal-body">
          <div class="publish-url-form">
            <label class="form-label">
              <span>콘텐츠 제목</span>
              <input type="text" class="form-input" value="${cardTitle || ''}" readonly disabled>
            </label>
            <label class="form-label">
              <span>발행 URL <span class="required">*</span></span>
              <input type="url" id="publish-url-input" class="form-input" placeholder="https://example.com/article" value="${existingUrl}" autocomplete="off">
              <div id="url-history-list" class="url-history-list" style="display: none;"></div>
            </label>
            <div id="platform-detection" class="platform-detection" style="display: none;">
              <span class="platform-badge"></span>
            </div>
            <div id="url-error" class="url-error" style="display: none;"></div>
          </div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary" id="cancel-btn">취소</button>
          <button class="cp-btn cp-btn-primary" id="submit-btn">${isEditing ? '변경하기' : '연결하기'}</button>
        </div>
      </div>
    `;

    container.appendChild(modalWrap);

    const urlInput = modalWrap.querySelector('#publish-url-input');
    const urlHistoryList = modalWrap.querySelector('#url-history-list');
    const platformDetection = modalWrap.querySelector('#platform-detection');
    const platformBadge = platformDetection.querySelector('.platform-badge');
    const urlError = modalWrap.querySelector('#url-error');
    const submitBtn = modalWrap.querySelector('#submit-btn');
    const cancelBtn = modalWrap.querySelector('#cancel-btn');
    const closeBtn = modalWrap.querySelector('.cp-modal-close');
    const backdrop = modalWrap.querySelector('.cp-modal-backdrop');

    // 버튼 텍스트 동적 변경
    if (isEditing) {
      submitBtn.textContent = '변경하기';
    }

    // URL 유효성 검증 및 플랫폼 감지
    function validateAndDetectPlatform(url) {
      urlError.style.display = 'none';
      platformDetection.style.display = 'none';

      if (!url || url.trim() === '') {
        return false;
      }

      // URL 형식 검증
      try {
        const urlObj = new URL(url);
        if (!urlObj.protocol.startsWith('http')) {
          urlError.textContent = '올바른 HTTP/HTTPS URL을 입력해주세요.';
          urlError.style.display = 'block';
          return false;
        }

        // 플랫폼 자동 감지
        const hostname = urlObj.hostname.toLowerCase();
        let platform = '';
        let platformIcon = '';

        if (hostname.includes('blog.naver.com') || hostname.includes('blog.me')) {
          platform = '네이버 블로그';
          platformIcon = '📝';
        } else if (hostname.includes('brunch.co.kr')) {
          platform = '브런치';
          platformIcon = '✍️';
        } else if (hostname.includes('medium.com')) {
          platform = 'Medium';
          platformIcon = '📄';
        } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
          platform = '유튜브';
          platformIcon = '▶️';
        } else if (hostname.includes('tistory.com')) {
          platform = '티스토리';
          platformIcon = '📚';
        } else if (hostname.includes('velog.io')) {
          platform = '벨로그';
          platformIcon = '💻';
        } else {
          platform = '기타';
          platformIcon = '🌐';
        }

        platformBadge.textContent = `${platformIcon} ${platform}`;
        platformDetection.style.display = 'block';
        return true;
      } catch (e) {
        urlError.textContent = '올바른 URL 형식이 아닙니다.';
        urlError.style.display = 'block';
        return false;
      }
    }

    // URL 히스토리 표시
    function showUrlHistory() {
      if (urlHistory.length === 0) {
        urlHistoryList.style.display = 'none';
        return;
      }

      const filteredHistory = urlHistory
        .filter((url) => url.toLowerCase().includes(urlInput.value.toLowerCase()))
        .slice(0, 5);

      if (filteredHistory.length === 0 || !urlInput.value) {
        urlHistoryList.style.display = 'none';
        return;
      }

      urlHistoryList.innerHTML = filteredHistory
        .map((url) => `<div class="url-history-item">${url}</div>`)
        .join('');

      urlHistoryList.style.display = 'block';

      // 히스토리 항목 클릭 이벤트
      urlHistoryList.querySelectorAll('.url-history-item').forEach((item) => {
        item.addEventListener('click', () => {
          urlInput.value = item.textContent;
          urlHistoryList.style.display = 'none';
          validateAndDetectPlatform(urlInput.value);
        });
      });
    }

    // 이벤트 리스너 (디바운싱 적용으로 성능 최적화)
    const debouncedUrlValidation = debounce((value) => {
      validateAndDetectPlatform(value);
      showUrlHistory();
    }, 300);

    urlInput.addEventListener('input', (e) => {
      debouncedUrlValidation(e.target.value);
    });

    urlInput.addEventListener('focus', () => {
      if (urlInput.value) {
        showUrlHistory();
      }
    });

    document.addEventListener('click', (e) => {
      if (!modalWrap.contains(e.target)) {
        urlHistoryList.style.display = 'none';
      }
    });

    const cleanup = () => {
      modalWrap.remove();
      isPublishUrlModalOpen = false; // 모달 닫힘 플래그 리셋
    };

    submitBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!validateAndDetectPlatform(url)) {
        return;
      }

      // [UX 개선] 즉시 로딩 상태 표시 (사용자 피드백)
      submitBtn.disabled = true;
      const originalBtnText = submitBtn.textContent;
      submitBtn.innerHTML =
        '<span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 6px; vertical-align: middle;"></span>처리 중...';
      submitBtn.style.opacity = '0.7';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.style.pointerEvents = 'none';

      // URL 히스토리 리스트 즉시 숨기기 (딜레이 제거)
      urlHistoryList.style.display = 'none';

      // 입력 필드 비활성화
      urlInput.disabled = true;
      urlInput.style.opacity = '0.6';
      urlInput.style.cursor = 'not-allowed';

      // 취소 버튼도 비활성화 (일관성)
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.6';
      cancelBtn.style.cursor = 'not-allowed';

      // URL 히스토리에 추가 (중복 제거)
      const newHistory = [url, ...urlHistory.filter((h) => h !== url)].slice(0, 10);
      chrome.storage.local.set({ publishUrlHistory: newHistory });

      // 성과 추적 시작 (기존 URL이 있으면 변경, 없으면 새로 연결)
      chrome.runtime.sendMessage(
        {
          action: 'link_published_url',
          data: {
            cardId: cardId,
            url: url,
            status: status,
          },
        },
        (response) => {
          // 버튼 상태 복원 (에러 발생 시에도)
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
          submitBtn.style.opacity = '1';
          submitBtn.style.cursor = 'pointer';
          submitBtn.style.pointerEvents = 'auto';
          urlInput.disabled = false;
          urlInput.style.opacity = '1';
          urlInput.style.cursor = 'text';
          cancelBtn.disabled = false;
          cancelBtn.style.opacity = '1';
          cancelBtn.style.cursor = 'pointer';

          if (response && response.success) {
            showToast(
              isEditing
                ? '✅ 발행 URL이 변경되었습니다. 성과 추적이 다시 시작됩니다.'
                : '✅ 발행 URL이 연결되었습니다. 성과 추적이 시작됩니다.'
            );
            cleanup();
          } else {
            showToast(
              '❌ URL ' +
                (isEditing ? '변경' : '연결') +
                ' 실패: ' +
                (response?.error || '알 수 없는 오류')
            );
          }
        }
      );
    });

    cancelBtn.addEventListener('click', cleanup);
    closeBtn.addEventListener('click', cleanup);
    backdrop.addEventListener('click', cleanup);

    // ESC 키로 닫기
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    // 모달 표시 후 입력 필드에 포커스
    setTimeout(() => {
      urlInput.focus();
    }, 100);
  });
}

/**
 * 성과 상세 보기 모달을 표시하는 함수
 */
function showPerformanceDetailModal(container, cardId, cardData) {
  const performance = cardData.performance;
  if (!performance || performance.error) {
    showToast('성과 데이터가 없습니다.');
    return;
  }

  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector('.cp-performance-detail-modal-wrap');
  if (existingModal) {
    existingModal.remove();
  }

  const modalWrap = document.createElement('div');
  modalWrap.className = 'cp-performance-detail-modal-wrap';

  // 시간대별 데이터 준비
  const hourlyData = performance.hourlyViews || [];
  const hourlyChartData = Array(24).fill(0);
  hourlyData.forEach((item) => {
    if (item.hour >= 0 && item.hour < 24) {
      hourlyChartData[item.hour] = item.views;
    }
  });

  // 유입 경로 데이터 준비
  const topSources = performance.topSources || [];

  // 초기 최대값 (현재 성과 데이터 기준)
  let maxEarnings = performance.estimatedEarnings || 1;
  let maxPageviews = performance.pageviews || 1;
  let maxDuration = performance.avgSessionDuration || 1;

  modalWrap.innerHTML = `
    <div class="cp-modal-backdrop"></div>
    <div class="cp-performance-detail-modal">
      <div class="cp-modal-header">
        <div class="cp-modal-title">📊 성과 상세 분석</div>
        <button class="cp-modal-close" title="닫기">×</button>
      </div>
      <div class="cp-modal-body">
        <div class="performance-detail-content">
          <div class="perf-header">
            <h3>${cardData.title || '제목 없음'}</h3>
            ${cardData.publishedUrl ? `<a href="${cardData.publishedUrl}" target="_blank" class="perf-url-link">🔗 발행 URL 보기</a>` : ''}
          </div>

          <div class="perf-metrics-grid">
            <div class="perf-metric-card">
              <div class="metric-label">페이지뷰</div>
              <div class="metric-value">${(performance.pageviews || 0).toLocaleString()}</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">세션 수</div>
              <div class="metric-value">${(performance.sessions || 0).toLocaleString()}</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">평균 체류 시간</div>
              <div class="metric-value">${Math.round(performance.avgSessionDuration || 0)}초</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">평균 페이지 수</div>
              <div class="metric-value">${(performance.pagesPerSession || 0).toFixed(1)}</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">이탈률</div>
              <div class="metric-value">${((performance.bounceRate || 0) * 100).toFixed(1)}%</div>
            </div>
            <div class="perf-metric-card highlight">
              <div class="metric-label">예상 수익</div>
              <div class="metric-value">$${(performance.estimatedEarnings || 0).toFixed(2)}</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">페이지 RPM</div>
              <div class="metric-value">$${(performance.pageRPM || 0).toFixed(2)}</div>
            </div>
            <div class="perf-metric-card">
              <div class="metric-label">클릭률 (CTR)</div>
              <div class="metric-value">${(performance.ctr || 0).toFixed(2)}%</div>
            </div>
          </div>

          ${
            hourlyData.length > 0
              ? `
            <div class="perf-chart-section">
              <h4>시간대별 페이지뷰 추이</h4>
              <div class="hourly-chart">
                ${hourlyChartData
                  .map((views, hour) => {
                    const maxViews = Math.max(...hourlyChartData, 1);
                    const height = maxViews > 0 ? (views / maxViews) * 100 : 0;
                    return `
                    <div class="hourly-bar" style="height: ${height}%">
                      <div class="bar-value">${views > 0 ? views : ''}</div>
                      <div class="bar-fill"></div>
                      <div class="bar-label">${hour}시</div>
                    </div>
                  `;
                  })
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          <div class="perf-chart-section">
            <h4>주요 성과 지표 비교</h4>
            <div class="metrics-comparison-chart" id="metrics-comparison-chart">
              <div class="comparison-item">
                <div class="comparison-label">수익</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar earnings-comparison" style="width: ${Math.min(((performance.estimatedEarnings || 0) / Math.max(maxEarnings || 1, 1)) * 100, 100)}%">
                    <span class="comparison-value">$${(performance.estimatedEarnings || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">페이지뷰</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar pageviews-comparison" style="width: ${Math.min(((performance.pageviews || 0) / Math.max(maxPageviews || 1, 1)) * 100, 100)}%">
                    <span class="comparison-value">${(performance.pageviews || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">체류 시간</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar duration-comparison" style="width: ${Math.min(((performance.avgSessionDuration || 0) / Math.max(maxDuration || 1, 1)) * 100, 100)}%">
                    <span class="comparison-value">${Math.round(performance.avgSessionDuration || 0)}초</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          ${
            topSources.length > 0
              ? `
            <div class="perf-traffic-section">
              <h4>주요 유입 경로</h4>
              <div class="traffic-sources-list">
                ${topSources
                  .map(
                    (source, idx) => `
                  <div class="traffic-source-item">
                    <span class="source-rank">${idx + 1}</span>
                    <div class="source-info">
                      <div class="source-name">${source.source === '(direct)' ? '직접 방문' : source.source}</div>
                      <div class="source-medium">${source.medium || 'none'}</div>
                    </div>
                    <div class="source-sessions">${source.sessions.toLocaleString()} 세션</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          ${
            performance.lastUpdatedAt
              ? `
            <div class="perf-footer">
              <span class="last-updated">마지막 업데이트: ${new Date(performance.lastUpdatedAt).toLocaleString('ko-KR')}</span>
            </div>
          `
              : ''
          }
        </div>
      </div>
      <div class="cp-modal-footer">
        <button class="cp-btn cp-btn-secondary" id="close-detail-btn">닫기</button>
      </div>
    </div>
  `;

  container.appendChild(modalWrap);

  // [최적화] 전체 데이터에서 최대값 계산 (비교 차트용)
  (async () => {
    try {
      const { loadKanbanData } = await import('../services/kanbanService.js');
      const allCards = await loadKanbanData();

      let allEarnings = [performance.estimatedEarnings || 0];
      let allPageviews = [performance.pageviews || 0];
      let allDurations = [performance.avgSessionDuration || 0];

      for (const status in allCards) {
        for (const cardId in allCards[status]) {
          const card = allCards[status][cardId];
          if (card.performance && !card.performance.error) {
            allEarnings.push(card.performance.estimatedEarnings || 0);
            allPageviews.push(card.performance.pageviews || 0);
            allDurations.push(card.performance.avgSessionDuration || 0);
          }
        }
      }

      const maxEarnings = Math.max(...allEarnings, 1);
      const maxPageviews = Math.max(...allPageviews, 1);
      const maxDuration = Math.max(...allDurations, 1);

      // 차트 업데이트
      updateComparisonChart(modalWrap, performance, maxEarnings, maxPageviews, maxDuration);
    } catch (error) {
      console.error('[KanbanMode] 전체 데이터 로드 실패:', error);
      // 기본값으로 차트 업데이트
      updateComparisonChart(
        modalWrap,
        performance,
        Math.max(performance.estimatedEarnings || 0, 1),
        Math.max(performance.pageviews || 0, 1),
        Math.max(performance.avgSessionDuration || 0, 1)
      );
    }
  })();

  const closeBtn = modalWrap.querySelector('.cp-modal-close');
  const cancelBtn = modalWrap.querySelector('#close-detail-btn');
  const backdrop = modalWrap.querySelector('.cp-modal-backdrop');

  const cleanup = () => {
    modalWrap.remove();
    isPublishUrlModalOpen = false; // 모달 닫힘 플래그 리셋
  };

  closeBtn.addEventListener('click', cleanup);
  cancelBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', cleanup);

  // ESC 키로 닫기
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);
}

/**
 * 비교 차트 업데이트 함수
 */
function updateComparisonChart(modalWrap, performance, maxEarnings, maxPageviews, maxDuration) {
  const chartContainer = modalWrap.querySelector('#metrics-comparison-chart');
  if (!chartContainer) return;

  const earningsWidth = Math.min(
    ((performance.estimatedEarnings || 0) / Math.max(maxEarnings, 1)) * 100,
    100
  );
  const pageviewsWidth = Math.min(
    ((performance.pageviews || 0) / Math.max(maxPageviews, 1)) * 100,
    100
  );
  const durationWidth = Math.min(
    ((performance.avgSessionDuration || 0) / Math.max(maxDuration, 1)) * 100,
    100
  );

  const earningsBar = chartContainer.querySelector('.earnings-comparison');
  const pageviewsBar = chartContainer.querySelector('.pageviews-comparison');
  const durationBar = chartContainer.querySelector('.duration-comparison');

  if (earningsBar) {
    earningsBar.style.width = `${earningsWidth}%`;
  }
  if (pageviewsBar) {
    pageviewsBar.style.width = `${pageviewsWidth}%`;
  }
  if (durationBar) {
    durationBar.style.width = `${durationWidth}%`;
  }
}
