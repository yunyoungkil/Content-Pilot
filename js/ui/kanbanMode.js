// js/ui/kanbanMode.js (Firebase 접근 코드 완전 제거)

let kanbanContainer = null; // UI를 다시 그릴 때 참조할 컨테이너 변수

// content.js에서 호출할 수 있도록 함수들을 export 합니다.
export function updateKanbanUI(allCards) {
    if (!kanbanContainer) return;
    const rootEl = kanbanContainer.querySelector("#cp-kanban-board-root");
    if (!rootEl) return;

    rootEl.querySelectorAll('.kanban-col-cards').forEach(col => col.innerHTML = '');

    if (!allCards || Object.keys(allCards).length === 0) {
        const ideasCol = rootEl.querySelector('[data-status="ideas"] .kanban-col-cards');
        if(ideasCol) ideasCol.innerHTML = '<p style="text-align: center; color: #888; padding: 20px;">기획 보드에 아이디어를 추가해주세요.</p>';
        return;
    }

    for (const status in allCards) {
      const colContainer = rootEl.querySelector(`.cp-kanban-col[data-status="${status}"] .kanban-col-cards`);
      if (colContainer) {
        for (const cardId in allCards[status]) {
          const cardData = allCards[status][cardId];
          colContainer.appendChild(createKanbanCard(cardId, cardData, status));
        }
      }
    }
}

export function showLoadingModal(message) {
    if (!kanbanContainer) return;
    const existingModal = kanbanContainer.querySelector('.cp-modal-backdrop');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'cp-modal-backdrop';
    modal.innerHTML = `<div class="cp-modal-content" style="text-align: center;"><p>${message}</p><div class="spinner"></div></div>`;
    kanbanContainer.appendChild(modal);
}

export function showKeywordsModal(keywords, cardId, status, cardTitle) {
    if (!kanbanContainer) return;
    const modalBackdrop = kanbanContainer.querySelector('.cp-modal-backdrop');
        if (!modalBackdrop) {
        modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'cp-modal-backdrop';
        kanbanContainer.appendChild(modalBackdrop);
        }

    const keywordsHtml = keywords.map(k => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(k)}" target="_blank">${k}</a></li>`).join('');

    modalBackdrop.innerHTML = `
        <div class="cp-modal-content">
            <button class="cp-modal-close">×</button>
            <h3>'${cardTitle}' 관련 AI 추천 검색어</h3>
            <ul class="keyword-list">${keywordsHtml}</ul>
            <div style="text-align: right; margin-top: 20px;"><button id="regenerate-keywords-btn" class="kanban-action-btn">🔄 다시 추천받기</button></div>
        </div>`;

    modalBackdrop.querySelector('.cp-modal-close').addEventListener('click', () => modalBackdrop.remove());

    // ▼▼▼ [수정] '다시 추천받기' 버튼 이벤트 리스너 ▼▼▼
    modalBackdrop.querySelector('#regenerate-keywords-btn').addEventListener('click', () => {
        const card = kanbanContainer.querySelector(`.cp-kanban-card[data-id="${cardId}"]`);
        if (card) {
            showLoadingModal('AI가 새로운 검색어를 찾고 있습니다...');
            chrome.runtime.sendMessage({
                // '다시 추천받기' 전용 액션으로 변경
                action: 'regenerate_search_keywords', 
                data: {
                    cardId: cardId,
                    status: status,
                    title: card.dataset.title,
                    description: card.dataset.description
                }
            });
        }
    });
}



/**
 * 칸반 보드 모드 UI 렌더링 함수
 */
export function renderKanban(container) {
  kanbanContainer = container;
  container.innerHTML = `
    <div id="cp-kanban-board-root">
      <div class="cp-kanban-col" data-status="ideas">
        <h3 class="cp-kanban-col-title">💡 아이디어</h3>
        <div class="kanban-col-cards"><p class="kanban-loading">데이터 로딩 중...</p></div>
      </div>
      <div class="cp-kanban-col" data-status="inProgress"><h3 class="cp-kanban-col-title">✍️ 진행 중</h3><div class="kanban-col-cards"></div></div>
      <div class="cp-kanban-col" data-status="done"><h3 class="cp-kanban-col-title">✅ 발행 완료</h3><div class="kanban-col-cards"></div></div>
    </div>`;
  
  chrome.runtime.sendMessage({ action: 'get_kanban_data' });

  if (!container.dataset.kanbanListenerAttached) {
    container.addEventListener('click', handleKanbanClick);
    container.dataset.kanbanListenerAttached = 'true';
  }
}

/**
 * 칸반 카드 DOM 요소를 생성하는 함수 (디자인 개선 최종 버전)
 */
function createKanbanCard(id, data, status) {
  const card = document.createElement('div');
  card.className = 'cp-kanban-card';
  card.dataset.id = id;
  card.dataset.status = status;
  card.dataset.title = data.title || '';
  card.dataset.description = data.description || '';

  // "AI 추천" 아이디어일 경우 'cluster' 클래스 추가
  const isAiIdea = data.tags && data.tags.includes('#AI-추천');
  if (isAiIdea) {
    card.classList.add('cluster');
  }

  // 상단 태그 영역 HTML 생성
  let topTagsHtml = '';
  if (isAiIdea) {
    topTagsHtml += '<span class="kanban-card-tag ai-tag">AI 추천</span>';
  }
  
  // 검색 키워드 태그 생성
  const hasKeywords = data.recommendedKeywords && Array.isArray(data.recommendedKeywords) && data.recommendedKeywords.length > 0;
  if (hasKeywords) {
    topTagsHtml += '<span class="kanban-card-tag keyword-tag">🔍 키워드</span>';
  }

  // 하단 액션 버튼 영역 HTML 생성
  let actionButtons = `<button class="kanban-action-btn recommend-search-btn" title="AI 검색어 추천">🔍</button>`;
  if (status === 'done' && !data.publishedUrl) {
    actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
  } else if (data.publishedUrl) {
    const performance = data.performance;
    const earnings = performance ? `$${(performance.estimatedEarnings || 0).toFixed(2)}` : '대기중';
    actionButtons += `<a href="${data.publishedUrl}" target="_blank" class="performance-link">수익: ${earnings}</a>`;
  }

  // 최종 HTML 구조 조합
  card.innerHTML = `
    <div class="kanban-card-body">
      <div class="card-top-tags">${topTagsHtml}</div>
      <span class="kanban-card-title">${data.title || '제목 없음'}</span>
    </div>
    <div class="kanban-card-footer">
      <div class="kanban-card-actions">${actionButtons}</div>
    </div>
  `;

  return card;
}


/**
 * 칸반 보드 내 클릭 이벤트를 처리하는 함수
 */
function handleKanbanClick(e) {
  const card = e.target.closest('.cp-kanban-card');
  if (!card) return;

  // ▼▼▼ [수정] Firebase 직접 호출을 메시지 전송으로 변경 ▼▼▼
  if (e.target.classList.contains('recommend-search-btn')) {
      e.stopPropagation();
      showLoadingModal('저장된 검색어 확인 중...');
      // background.js에 메시지를 보내 데이터 확인 및 생성을 모두 위임
      chrome.runtime.sendMessage({
          action: 'request_search_keywords',
          data: {
              cardId: card.dataset.id,
              status: card.dataset.status,
              title: card.dataset.title,
              description: card.dataset.description
          }
      });
  } else if (e.target.classList.contains('track-performance-btn')) {
      // 성과 추적 버튼 클릭 로직 (이전과 동일)
      const url = prompt("발행된 콘텐츠의 전체 URL을 입력하세요:", "https://");
      if (url && url.startsWith('http')) {
          chrome.runtime.sendMessage({
              action: 'link_published_url',
              data: { cardId: card.dataset.id, url: url, status: card.dataset.status }
          });
      }
  }
}
