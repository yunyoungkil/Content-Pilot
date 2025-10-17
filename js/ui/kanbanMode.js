// js/ui/kanbanMode.js (수정 완료된 최종 버전)

import { renderWorkspace } from './workspaceMode.js';
import { showToast } from '../utils.js';
import { renderPanelHeader } from './header.js';

let allKanbanData = {};
let currentlyDragging = { cardId: null, originalStatus: null };
let kanbanContainer = null;
let sortOrder = 'desc'; 

export { renderKanban, updateKanbanUI, addKanbanEventListeners };
/**
 * 칸반 보드 UI의 기본 골격을 렌더링하는 함수
 */
function renderKanban(container) {
  kanbanContainer = container;
  container.innerHTML = `
    <div class="kanban-board-container">
      <div class="kanban-controls-header">
        <div class="kanban-sort-controls">
          <span class="kanban-sort-label">정렬:</span>
          <button class="kanban-sort-btn ${sortOrder === 'desc' ? 'active' : ''}" data-sort="desc">최신순</button>
          <button class="kanban-sort-btn ${sortOrder === 'asc' ? 'active' : ''}" data-sort="asc">오래된순</button>
        </div>
      </div>
      <div id="cp-kanban-board-root">
        <div class="cp-kanban-col" data-status="ideas">
          <h2 class="cp-kanban-col-title">💡 아이디어</h2>
          <div class="kanban-col-cards"><p class="loading-scraps">데이터 로딩 중...</p></div>
        </div>
        <div class="cp-kanban-col" data-status="in-progress">
          <h2 class="cp-kanban-col-title">✍️ 기획/작성 중</h2>
          <div class="kanban-col-cards"></div>
        </div>
        <div class="cp-kanban-col" data-status="done">
          <h2 class="cp-kanban-col-title">✅ 발행 완료</h2>
          <div class="kanban-col-cards"></div>
        </div>
      </div>
    </div>
  `;

  chrome.runtime.sendMessage({ action: 'get_kanban_data' });

  if (!window.kanbanListenersAttached) {
    addRealtimeUpdateListener();
    window.kanbanListenersAttached = true;
  }
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
        }
    });
}


/**
 * 전체 칸반 UI를 데이터에 따라 다시 그리는 함수
 */
function updateKanbanUI(allCards) {
    if (!kanbanContainer) return;
    const rootEl = kanbanContainer.querySelector("#cp-kanban-board-root");
    if (!rootEl) return;

    // 각 컬럼의 카드 목록을 비움
    rootEl.querySelectorAll('.kanban-col-cards').forEach(col => col.innerHTML = '');

    if (!allCards || Object.keys(allCards).length === 0) {
        const ideasCol = rootEl.querySelector('[data-status="ideas"] .kanban-col-cards');
        if(ideasCol) ideasCol.innerHTML = '<p style="text-align: center; color: #888; padding: 20px;">기획 보드에 아이디어를 추가해주세요.</p>';
        return;
    }

    for (const status in allCards) {
      const colContainer = rootEl.querySelector(`.cp-kanban-col[data-status="${status}"] .kanban-col-cards`);
      if (colContainer) {
        renderCardsInColumn(colContainer, status, allCards[status] || {});
      }
    }
}

function renderCardsInColumn(columnEl, status, cards) {

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
        columnEl.appendChild(cardEl);
    }
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
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
      topTagsHtml = data.tags.map(tag => {
          const cleanTag = tag.replace(/^#/, '');
          const tagClass = cleanTag === 'AI-추천' ? 'kanban-card-tag ai-tag' : 'kanban-card-tag default-tag';
          return `<span class="${tagClass}">#${cleanTag}</span>`;
      }).join('');
  }
  
    if (data.longTailKeywords && Array.isArray(data.longTailKeywords) && data.longTailKeywords.length > 0) {
      topTagsHtml += data.longTailKeywords.map(keyword => {
          // 롱테일 키워드는 보통 길기 때문에 '#' 없이 그대로 표시합니다.
          return `<span class="kanban-card-tag long-tail-tag">${keyword}</span>`;
      }).join('');
  }
  
  const hasOutline = data.outline && data.outline.length > 0;
  if (hasOutline) {
      topTagsHtml += `<span class="kanban-card-tag outline-tag">📄 목차</span>`;
  }

  const linkedScrapsCount = data.linkedScraps ? Object.keys(data.linkedScraps).length : 0;
  let metaInfoHtml = '';
  if (linkedScrapsCount > 0) {
    metaInfoHtml += `<span class="kanban-card-meta linked-scraps-count">🔗 ${linkedScrapsCount}개</span>`;
  }
    // K-1: draftContent가 있으면 초안 완료 표시
    if (data.draftContent) {
      metaInfoHtml += `<span class="kanban-card-meta draft-status-count">📝 초안 완료</span>`;
    }

  let actionButtons = ``;
  const hasDraft = !!data.draftContent;
  // K-3: 초안 삭제 버튼 추가
  if (hasDraft) {
    actionButtons += `<button class="kanban-action-btn delete-draft-btn" data-card-id="${id}" title="작성된 초안을 삭제하고 아이디어를 초기화합니다.">❌ 초안 삭제</button>`;
  }
  if (status === 'done' && !data.publishedUrl) {
    actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
  } else if  (data.publishedUrl) {
    const performance = data.performance;
    const earnings = performance ? `$${(performance.estimatedEarnings || 0).toFixed(2)}` : '대기중';
    actionButtons += `<a href="${data.publishedUrl}" target="_blank" class="performance-link">수익: ${earnings}</a>`;
  }
  card.innerHTML = `
    <div class="kanban-card-body">
      <div class="card-top-tags">${topTagsHtml}</div>
      <span class="kanban-card-title">${data.title || '제목 없음'}</span>
    </div>
    <div class="kanban-card-footer">
      <div class="kanban-card-meta">${metaInfoHtml}</div>
      <div class="kanban-card-actions">${actionButtons}</div>
    </div>
  `;
  return card;
}

function addKanbanEventListeners(container) {
  // K-3: 초안 삭제 버튼 클릭 이벤트 리스너
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-draft-btn')) {
      const cardId = e.target.dataset.cardId;
      if (confirm("정말로 작성된 초안을 삭제하고 이 아이디어의 기획 상태를 초기화하시겠습니까?")) {
        chrome.runtime.sendMessage({
          action: 'delete_draft_content',
          data: { cardId: cardId }
        }, (response) => {
          if (response?.success) {
            import('../utils.js').then(({ showToast }) => {
              showToast("✅ 초안 내용이 삭제되었습니다. 카드를 '아이디어'로 되돌릴 수 있습니다.");
            });
            // UI 새로고침 (전체 데이터를 다시 로드하여 상태 업데이트)
            updateKanbanUI(allKanbanData);
          } else {
            import('../utils.js').then(({ showToast }) => {
              showToast("❌ 초안 삭제 중 오류가 발생했습니다.");
            });
          }
        });
      }
    }
  });
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

    const root = container.querySelector('#cp-kanban-board-root');
    if(!root) return;

    root.addEventListener('click', (e) => {
        const card = e.target.closest('.cp-kanban-card');
        if (!card) return;

       if (e.target.closest('.track-performance-btn')) {
            e.stopPropagation();
            const url = prompt("발행된 콘텐츠의 전체 URL을 입력하세요:", "https://");
            if (url && url.startsWith('http')) {
                chrome.runtime.sendMessage({
                    action: 'link_published_url',
                    data: { cardId: card.dataset.id, url: url, status: card.dataset.status }
                });
            }
        } else {
            const cardId = card.dataset.id;
            const status = card.dataset.status;
            const cardData = allKanbanData[status]?.[cardId];
            if (cardData) {

                window.__cp_active_mode = 'workspace';
                
                const shadowRoot = container.getRootNode();
                renderHeaderAndTabs(shadowRoot);

                renderWorkspace(kanbanContainer, { ...cardData, id: cardId, status: status });
            }
        }
    });

    root.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.cp-kanban-card');
        if (card) {
            currentlyDragging.cardId = card.dataset.id;
            currentlyDragging.originalStatus = card.dataset.status;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => card.style.opacity = '0.5', 0);
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
      // K-5: 초안이 존재할 때만 이동 제한
      const cardData = allKanbanData[originalStatus]?.[cardId];
      const hasDraft = !!cardData?.draftContent;
      if (hasDraft && newStatus === 'ideas') {
        import('../utils.js').then(({ showToast }) => {
          showToast("⚠️ 초안이 작성된 아이디어는 '아이디어' 단계로 되돌릴 수 없습니다. (초안 삭제 후 복귀 가능)");
        });
        return;
      }
      chrome.runtime.sendMessage({
        action: 'move_kanban_card',
        data: { cardId, originalStatus, newStatus }
      });
    }
    });
}

function renderHeaderAndTabs(shadowRoot) {
    const headerArea = shadowRoot.querySelector("#cp-header-area");
    if (headerArea) {
        headerArea.innerHTML = renderPanelHeader();
    }
}





