// js/ui/kanbanMode.js (수정 완료된 최종 버전)

import { renderWorkspace } from './workspaceMode.js';
import { showToast } from '../utils.js';

let allKanbanData = {};
let currentlyDragging = { cardId: null, originalStatus: null };
let kanbanContainer = null;

export { renderKanban, updateKanbanUI, showLoadingModal, showKeywordsModal };
/**
 * 칸반 보드 UI의 기본 골격을 렌더링하는 함수
 */
function renderKanban(container) {
  kanbanContainer = container;
  container.innerHTML = `
    <div id="cp-kanban-board-root">
      <div class="cp-kanban-col" data-status="ideas">
        <h2 class="cp-kanban-col-title">💡 아이디어</h2>
        <div class="kanban-col-cards"><p class="loading-scraps">데이터 로딩 중...</p></div>
      </div>
      <div class="cp-kanban-col" data-status="scrap">
        <h2 class="cp-kanban-col-title">📋 스크랩 리스트</h2>
        <div class="kanban-col-cards"></div>
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
  `;

  chrome.runtime.sendMessage({ action: 'get_kanban_data' });

  if (!window.kanbanListenersAttached) {
    addRealtimeUpdateListener();
    addKanbanEventListeners(container);
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
        } else if (msg.action === 'search_queries_recommended') {
            const modal = kanbanContainer.querySelector('.cp-modal-backdrop');
            if (modal) modal.remove();

            if (msg.success) {
                showKeywordsModal(msg.data, msg.cardId, msg.status, msg.cardTitle);
            } else {
                showToast("오류: 검색어 추천에 실패했습니다.");
            }
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
    const sortedCards = Object.entries(cards).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    
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

  const isAiIdea = data.tags && data.tags.includes('#AI-추천');
  if (isAiIdea) card.classList.add('cluster');

  const hasKeywords = data.recommendedKeywords && Array.isArray(data.recommendedKeywords) && data.recommendedKeywords.length > 0;
  
  let topTagsHtml = '';
  if (isAiIdea) topTagsHtml += '<span class="kanban-card-tag ai-tag">AI 추천</span>';
  if (hasKeywords) topTagsHtml += '<span class="kanban-card-tag keyword-tag">🔍 키워드</span>';

  let actionButtons = `<button class="kanban-action-btn recommend-search-btn" title="AI 검색어 추천">🔍</button>`;
  if (status === 'done' && !data.publishedUrl) {
    actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
  } else if (data.publishedUrl) {
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
      <div class="kanban-card-actions">${actionButtons}</div>
    </div>
  `;
  return card;
}

function addKanbanEventListeners(container) {
    const root = container.querySelector('#cp-kanban-board-root');
    if(!root) return;

    root.addEventListener('click', (e) => {
        const card = e.target.closest('.cp-kanban-card');
        if (!card) return;

        if (e.target.closest('.recommend-search-btn')) {
            e.stopPropagation();
            showLoadingModal('AI가 추천 검색어를 찾고 있습니다...');
            chrome.runtime.sendMessage({
                action: 'request_search_keywords',
                data: {
                    cardId: card.dataset.id,
                    status: card.dataset.status,
                    title: card.dataset.title,
                    description: card.dataset.description
                }
            });
        } else if (e.target.closest('.track-performance-btn')) {
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
                renderWorkspace(document.querySelector('#cp-main-area'), { ...cardData, id: cardId, status: status });
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
            chrome.runtime.sendMessage({
                action: 'move_kanban_card',
                data: { cardId, originalStatus, newStatus }
            });
        }
    });
}

// --- 모달 관련 함수들 ---
function showLoadingModal(message) {
    const container = document.querySelector('#cp-main-area');
    if (!container) return;
    
    let modal = container.querySelector('.cp-modal-backdrop');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'cp-modal-backdrop';
        container.appendChild(modal);
    }
    modal.innerHTML = `<div class="cp-modal-content" style="text-align: center;"><p>${message}</p><div class="spinner"></div></div>`;
}

function showKeywordsModal(keywords, cardId, status, cardTitle) {
    const container = document.querySelector('#cp-main-area');
    if (!container) return;

    let modal = container.querySelector('.cp-modal-backdrop');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'cp-modal-backdrop';
        container.appendChild(modal);
    }

    const keywordsHtml = keywords.map(k => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(k)}" target="_blank">${k}</a></li>`).join('');

    modal.innerHTML = `
        <div class="cp-modal-content">
            <button class="cp-modal-close">×</button>
            <h3>'${cardTitle}' 관련 AI 추천 검색어</h3>
            <ul class="keyword-list">${keywordsHtml}</ul>
            <div style="text-align: right; margin-top: 20px;"><button id="regenerate-keywords-btn" class="kanban-action-btn">🔄 다시 추천받기</button></div>
        </div>`;

    modal.querySelector('.cp-modal-close').addEventListener('click', () => modal.remove());

    modal.querySelector('#regenerate-keywords-btn').addEventListener('click', () => {
        showLoadingModal('AI가 새로운 검색어를 찾고 있습니다...');
        const cardData = allKanbanData[status]?.[cardId];
        chrome.runtime.sendMessage({
            action: 'regenerate_search_keywords', 
            data: {
                cardId: cardId,
                status: status,
                title: cardData.title,
                description: cardData.description
            }
        });
    });
}