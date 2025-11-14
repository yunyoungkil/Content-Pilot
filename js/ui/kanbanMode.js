// js/ui/kanbanMode.js (수정 완료된 최종 버전)

import { renderWorkspace } from "./workspaceMode.js";
import { showToast } from "../utils.js";
import { renderPanelHeader } from "./header.js";

let allKanbanData = {};
let currentlyDragging = { cardId: null, originalStatus: null };
let kanbanContainer = null;
let sortOrder = "desc";

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
          <button class="kanban-sort-btn ${
            sortOrder === "desc" ? "active" : ""
          }" data-sort="desc">최신순</button>
          <button class="kanban-sort-btn ${
            sortOrder === "asc" ? "active" : ""
          }" data-sort="asc">오래된순</button>
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

  chrome.runtime.sendMessage({ action: "get_kanban_data" });

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
    if (
      !kanbanContainer ||
      !kanbanContainer.querySelector("#cp-kanban-board-root")
    )
      return;

    if (msg.action === "kanban_data_updated") {
      allKanbanData = msg.data || {};
      updateKanbanUI(allKanbanData);
      
      // 워크스페이스가 열려있고 해당 아이디어 데이터가 업데이트된 경우 워크스페이스 갱신
      if (window.__cp_active_mode === "workspace" && window.__cp_workspace_idea_id) {
        const ideaId = window.__cp_workspace_idea_id;
        const ideaData = allKanbanData.ideas?.[ideaId];
        if (ideaData) {
          const shadowRoot = kanbanContainer.getRootNode();
          const container = shadowRoot.querySelector("#cp-main-content");
          if (container) {
            renderHeaderAndTabs(shadowRoot);
            renderWorkspace(kanbanContainer, {
              ...ideaData,
              id: ideaId,
              status: "ideas",
            });
          }
        }
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
  rootEl
    .querySelectorAll(".kanban-col-cards")
    .forEach((col) => (col.innerHTML = ""));

  if (!allCards || Object.keys(allCards).length === 0) {
    const ideasCol = rootEl.querySelector(
      '[data-status="ideas"] .kanban-col-cards'
    );
    if (ideasCol)
      ideasCol.innerHTML =
        '<p style="text-align: center; color: #888; padding: 20px;">기획 보드에 아이디어를 추가해주세요.</p>';
    return;
  }

  for (const status in allCards) {
    const colContainer = rootEl.querySelector(
      `.cp-kanban-col[data-status="${status}"] .kanban-col-cards`
    );
    if (colContainer) {
      renderCardsInColumn(colContainer, status, allCards[status] || {});
    }
  }
}

function renderCardsInColumn(columnEl, status, cards) {
  const sortedCards = Object.entries(cards).sort((a, b) => {
    const timeA = a[1].createdAt || 0;
    const timeB = b[1].createdAt || 0;
    if (sortOrder === "asc") {
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
  const card = document.createElement("div");
  card.className = "cp-kanban-card";
  card.dataset.id = id;
  card.dataset.status = status;
  card.dataset.title = data.title || "";
  card.dataset.description = data.description || "";
  card.draggable = true;

  card.title = data.description || "";

  // 1. AI 추천 아이디어인 경우 cluster 클래스를 추가하여 왼쪽 테두리를 표시합니다.
  const isAiIdea = data.tags && data.tags.includes("#AI-추천");
  if (isAiIdea) {
    card.classList.add("cluster");
  }

  let topTagsHtml = "";
  // outline-tag를 가장 앞에 위치시키기
  const hasOutline = data.outline && data.outline.length > 0;
  if (hasOutline) {
    topTagsHtml += `<span class="kanban-card-tag outline-tag">📄 목차</span>`;
  }
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    topTagsHtml += data.tags
      .map((tag) => {
        const cleanTag = tag.replace(/^#/, "");
        const tagClass =
          cleanTag === "AI-추천"
            ? "kanban-card-tag ai-tag"
            : "kanban-card-tag default-tag";
        return `<span class="${tagClass}">#${cleanTag}</span>`;
      })
      .join("");
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
      .join("");
  }

  const linkedScrapsCount = data.linkedScraps
    ? Object.keys(data.linkedScraps).length
    : 0;
  let metaInfoHtml = "";
  if (linkedScrapsCount > 0) {
    metaInfoHtml += `<span class="kanban-card-meta linked-scraps-count">🔗 ${linkedScrapsCount}개</span>`;
  }
  // K-1: draftContent가 있으면 초안 완료 표시
  if (data.draftContent) {
    metaInfoHtml += `<span class="kanban-card-meta draft-status-count">📝 초안 완료</span>`;
  }

  let actionButtons = ``;
  // K-3: 초안 삭제 버튼 제거됨
  if (status === "done" && !data.publishedUrl) {
    actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
  } else if (data.publishedUrl) {
    const performance = data.performance;
    const earnings = performance
      ? `$${(performance.estimatedEarnings || 0).toFixed(2)}`
      : "대기중";
    actionButtons += `<a href="${data.publishedUrl}" target="_blank" class="performance-link">수익: ${earnings}</a>`;
  }
  card.innerHTML = `
    <div class="kanban-card-body">
      <span class="kanban-card-title">${data.title || "제목 없음"}</span>
      <div class="card-top-tags">${topTagsHtml}</div>
    </div>
    <div class="kanban-card-footer">
      <div class="kanban-card-meta">${metaInfoHtml}</div>
      <div class="kanban-card-actions">${actionButtons}</div>
    </div>
  `;
  return card;
}

function addKanbanEventListeners(container) {
  // K-3: 초안 삭제 버튼 클릭 이벤트 리스너 완전 제거
  const sortControls = container.querySelector(".kanban-sort-controls");
  if (sortControls) {
    sortControls.addEventListener("click", (e) => {
      const target = e.target;
      if (target.classList.contains("kanban-sort-btn")) {
        const newSortOrder = target.dataset.sort;
        if (newSortOrder !== sortOrder) {
          // 상태 변수 업데이트
          sortOrder = newSortOrder;

          // 버튼 활성 상태 업데이트
          sortControls.querySelector(".active").classList.remove("active");
          target.classList.add("active");

          // 변경된 정렬 순서로 UI 전체를 다시 렌더링
          updateKanbanUI(allKanbanData);
        }
      }
    });
  }

  const root = container.querySelector("#cp-kanban-board-root");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const card = e.target.closest(".cp-kanban-card");
    if (!card) return;

    if (e.target.closest(".track-performance-btn")) {
      e.stopPropagation();
      const cardId = card.dataset.id;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      showPublishUrlModal(container, cardId, status, cardData?.title || "");
    } else {
      const cardId = card.dataset.id;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      if (cardData) {
        window.__cp_active_mode = "workspace";

        const shadowRoot = container.getRootNode();
        renderHeaderAndTabs(shadowRoot);

        renderWorkspace(kanbanContainer, {
          ...cardData,
          id: cardId,
          status: status,
        });
      }
    }
  });

  root.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".cp-kanban-card");
    if (card) {
      currentlyDragging.cardId = card.dataset.id;
      currentlyDragging.originalStatus = card.dataset.status;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => (card.style.opacity = "0.5"), 0);
    }
  });

  root.addEventListener("dragend", (e) => {
    const card = e.target.closest(".cp-kanban-card");
    if (card) card.style.opacity = "1";
    currentlyDragging = { cardId: null, originalStatus: null };
  });

  root.addEventListener("dragover", (e) => {
    if (e.target.closest(".cp-kanban-col")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  });

  root.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetColumn = e.target.closest(".cp-kanban-col");
    const newStatus = targetColumn?.dataset.status;
    const { cardId, originalStatus } = currentlyDragging;
    if (newStatus && cardId && originalStatus && newStatus !== originalStatus) {
      const cardData = allKanbanData[originalStatus]?.[cardId];
      const hasDraft = !!cardData?.draftContent;
      // K-7: 아이디어 컬럼에서 초안 없는 카드 이동 제한
      if (originalStatus === "ideas" && !hasDraft) {
        showToast(
          "⚠️ 기획을 시작하려면 카드를 클릭하여 워크스페이스에서 초안을 생성하거나, 자료를 연결해야 합니다."
        );
        return;
      }
      // 기존 K-5: 초안이 존재하는 상태에서 'ideas' 컬럼으로 복귀 시 제한
      if (hasDraft && newStatus === "ideas") {
        showToast(
          "⚠️ 초안이 작성된 아이디어는 '아이디어' 단계로 되돌릴 수 없습니다. (초안 삭제 후 복귀 가능)"
        );
        return;
      }
      // 모든 제한을 통과하면 이동 허용
      chrome.runtime.sendMessage({
        action: "move_kanban_card",
        data: { cardId, originalStatus, newStatus },
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

/**
 * 발행 URL 연결 모달을 표시하는 함수
 */
function showPublishUrlModal(container, cardId, status, cardTitle) {
  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector(".cp-publish-url-modal-wrap");
  if (existingModal) {
    existingModal.remove();
  }

  // URL 히스토리 가져오기
  chrome.storage.local.get(["publishUrlHistory"], (result) => {
    const urlHistory = result.publishUrlHistory || [];

    // 모달 생성
    const modalWrap = document.createElement("div");
    modalWrap.className = "cp-publish-url-modal-wrap";
    modalWrap.innerHTML = `
      <div class="cp-modal-backdrop"></div>
      <div class="cp-publish-url-modal">
        <div class="cp-modal-header">
          <div class="cp-modal-title">🔗 발행 URL 연결</div>
          <button class="cp-modal-close" title="닫기">×</button>
        </div>
        <div class="cp-modal-body">
          <div class="publish-url-form">
            <label class="form-label">
              <span>콘텐츠 제목</span>
              <input type="text" class="form-input" value="${cardTitle || ""}" readonly disabled>
            </label>
            <label class="form-label">
              <span>발행 URL <span class="required">*</span></span>
              <input type="url" id="publish-url-input" class="form-input" placeholder="https://example.com/article" autocomplete="off">
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
          <button class="cp-btn cp-btn-primary" id="submit-btn">연결하기</button>
        </div>
      </div>
    `;

    container.appendChild(modalWrap);

    const urlInput = modalWrap.querySelector("#publish-url-input");
    const urlHistoryList = modalWrap.querySelector("#url-history-list");
    const platformDetection = modalWrap.querySelector("#platform-detection");
    const platformBadge = platformDetection.querySelector(".platform-badge");
    const urlError = modalWrap.querySelector("#url-error");
    const submitBtn = modalWrap.querySelector("#submit-btn");
    const cancelBtn = modalWrap.querySelector("#cancel-btn");
    const closeBtn = modalWrap.querySelector(".cp-modal-close");
    const backdrop = modalWrap.querySelector(".cp-modal-backdrop");

    // URL 유효성 검증 및 플랫폼 감지
    function validateAndDetectPlatform(url) {
      urlError.style.display = "none";
      platformDetection.style.display = "none";

      if (!url || url.trim() === "") {
        return false;
      }

      // URL 형식 검증
      try {
        const urlObj = new URL(url);
        if (!urlObj.protocol.startsWith("http")) {
          urlError.textContent = "올바른 HTTP/HTTPS URL을 입력해주세요.";
          urlError.style.display = "block";
          return false;
        }

        // 플랫폼 자동 감지
        const hostname = urlObj.hostname.toLowerCase();
        let platform = "";
        let platformIcon = "";

        if (hostname.includes("blog.naver.com") || hostname.includes("blog.me")) {
          platform = "네이버 블로그";
          platformIcon = "📝";
        } else if (hostname.includes("brunch.co.kr")) {
          platform = "브런치";
          platformIcon = "✍️";
        } else if (hostname.includes("medium.com")) {
          platform = "Medium";
          platformIcon = "📄";
        } else if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
          platform = "유튜브";
          platformIcon = "▶️";
        } else if (hostname.includes("tistory.com")) {
          platform = "티스토리";
          platformIcon = "📚";
        } else if (hostname.includes("velog.io")) {
          platform = "벨로그";
          platformIcon = "💻";
        } else {
          platform = "기타";
          platformIcon = "🌐";
        }

        platformBadge.textContent = `${platformIcon} ${platform}`;
        platformDetection.style.display = "block";
        return true;
      } catch (e) {
        urlError.textContent = "올바른 URL 형식이 아닙니다.";
        urlError.style.display = "block";
        return false;
      }
    }

    // URL 히스토리 표시
    function showUrlHistory() {
      if (urlHistory.length === 0) {
        urlHistoryList.style.display = "none";
        return;
      }

      const filteredHistory = urlHistory
        .filter(url => url.toLowerCase().includes(urlInput.value.toLowerCase()))
        .slice(0, 5);

      if (filteredHistory.length === 0 || !urlInput.value) {
        urlHistoryList.style.display = "none";
        return;
      }

      urlHistoryList.innerHTML = filteredHistory
        .map(url => `<div class="url-history-item">${url}</div>`)
        .join("");

      urlHistoryList.style.display = "block";

      // 히스토리 항목 클릭 이벤트
      urlHistoryList.querySelectorAll(".url-history-item").forEach(item => {
        item.addEventListener("click", () => {
          urlInput.value = item.textContent;
          urlHistoryList.style.display = "none";
          validateAndDetectPlatform(urlInput.value);
        });
      });
    }

    // 이벤트 리스너
    urlInput.addEventListener("input", (e) => {
      validateAndDetectPlatform(e.target.value);
      showUrlHistory();
    });

    urlInput.addEventListener("focus", () => {
      if (urlInput.value) {
        showUrlHistory();
      }
    });

    document.addEventListener("click", (e) => {
      if (!modalWrap.contains(e.target)) {
        urlHistoryList.style.display = "none";
      }
    });

    const cleanup = () => {
      modalWrap.remove();
    };

    submitBtn.addEventListener("click", () => {
      const url = urlInput.value.trim();
      if (!validateAndDetectPlatform(url)) {
        return;
      }

      // URL 히스토리에 추가 (중복 제거)
      const newHistory = [url, ...urlHistory.filter(h => h !== url)].slice(0, 10);
      chrome.storage.local.set({ publishUrlHistory: newHistory });

      // 성과 추적 시작
      chrome.runtime.sendMessage({
        action: "link_published_url",
        data: {
          cardId: cardId,
          url: url,
          status: status,
        },
      }, (response) => {
        if (response && response.success) {
          showToast("✅ 발행 URL이 연결되었습니다. 성과 추적이 시작됩니다.");
          cleanup();
        } else {
          showToast("❌ URL 연결 실패: " + (response?.error || "알 수 없는 오류"));
        }
      });
    });

    cancelBtn.addEventListener("click", cleanup);
    closeBtn.addEventListener("click", cleanup);
    backdrop.addEventListener("click", cleanup);

    // ESC 키로 닫기
    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", handleKeydown);
      }
    };
    document.addEventListener("keydown", handleKeydown);

    // 모달 표시 후 입력 필드에 포커스
    setTimeout(() => {
      urlInput.focus();
    }, 100);
  });
}
