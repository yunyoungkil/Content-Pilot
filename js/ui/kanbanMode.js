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
          const container = shadowRoot.querySelector("#cp-main-content");
          if (container) {
            renderHeaderAndTabs(shadowRoot);
            renderWorkspace(kanbanContainer, {
              ...ideaData,
              id: ideaId,
              status: foundStatus,
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

  // 성과 지표가 있으면 카드에 시각적 표시 추가
  const performance = data.performance;
  // 데이터 없음(0 값)은 오류가 아님 - error 필드가 없고, collectionErrors도 없어야 함
  const hasPerformance = performance && !performance.error && 
    (performance.pageviews > 0 || performance.estimatedEarnings > 0 || 
     performance.sessions > 0 || performance.avgSessionDuration > 0);
  const isCollecting = performance && performance.collecting === true;
  // 실제 오류인지 확인: error 필드가 있거나, collectionErrors와 errorType이 모두 있는 경우
  // 단, error 필드가 "데이터 없음" 관련 메시지면 오류가 아님
  const hasError = performance && (
    (performance.error && !performance.error.includes('데이터 없음') && !performance.error.includes('데이터가 없을 수 있습니다')) ||
    (performance.collectionErrors && performance.errorType)
  );
  const errorType = performance?.errorType;
  const collectionErrors = performance?.collectionErrors;
  
  // 발행 완료 카드에 성과 추적 상태 및 해지 성과 태그 추가
  if (status === "done") {
    // 성과 추적 연결 상태 태그
    if (data.publishedUrl) {
      if (isCollecting) {
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag collecting">🔄 수집 중...</span>`;
      } else if (hasError) {
        // 에러 타입에 따른 메시지
        let errorMessage = "❌ 수집 실패";
        let errorTooltip = performance.error || "알 수 없는 오류";
        
        if (errorType === "AUTH_MISSING") {
          errorMessage = "🔑 인증 필요";
          errorTooltip = "Google 계정 연동이 필요합니다. 채널 연동 설정에서 연동해주세요.";
        } else if (errorType === "ID_MISSING") {
          errorMessage = "⚙️ 설정 필요";
          errorTooltip = "GA4 속성 ID 또는 AdSense 계정 ID가 설정되지 않았습니다. 채널 연동 설정을 확인해주세요.";
        } else if (errorType === "API_ERROR") {
          errorMessage = "⚠️ API 오류";
          // collectionErrors가 있으면 더 자세한 정보 표시
          if (collectionErrors) {
            const errors = [];
            if (collectionErrors.analytics) errors.push(`GA4: ${collectionErrors.analytics}`);
            if (collectionErrors.adsense) errors.push(`AdSense: ${collectionErrors.adsense}`);
            errorTooltip = errors.length > 0 ? errors.join("\n") : errorTooltip;
          } else {
            errorTooltip = `API 호출 중 오류가 발생했습니다: ${errorTooltip}`;
          }
        } else if (collectionErrors && errorType) {
          // collectionErrors와 errorType이 모두 있는 경우만 실제 오류로 처리
          const errors = [];
          if (collectionErrors.analytics) errors.push(`GA4: ${collectionErrors.analytics}`);
          if (collectionErrors.adsense) errors.push(`AdSense: ${collectionErrors.adsense}`);
          errorTooltip = errors.length > 0 ? errors.join("\n") : errorTooltip;
          // errorType이 없으면 데이터 없음으로 처리 (오류 아님)
        }
        // collectionErrors만 있고 errorType이 없으면 데이터 없음으로 처리 (오류 표시하지 않음)
        
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag error" title="${errorTooltip}">${errorMessage}</span>`;
      } else if (hasPerformance) {
        metaInfoHtml += `<span class="kanban-card-meta performance-status-tag connected">✅ 추적 중</span>`;
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
          📊 ${pageviews.toLocaleString()}회 / $${earnings.toFixed(2)}
        </span>
      `;
    }
    
    // 데이터 수집 상태 표시 (GA4, AdSense 개별 상태)
    // 실제 오류가 있거나 수집 중이거나 성과 데이터가 있을 때만 표시
    if (data.publishedUrl && (hasPerformance || hasError || isCollecting)) {
      // collectionErrors가 있어도 errorType이 없으면 데이터 없음으로 처리 (오류 아님)
      const hasRealCollectionError = collectionErrors && errorType;
      const gaStatus = hasPerformance && !hasRealCollectionError ? "✅" : 
                      (hasRealCollectionError && collectionErrors?.analytics ? "❌" : "⏳");
      const adsenseStatus = hasPerformance && !hasRealCollectionError ? "✅" : 
                           (hasRealCollectionError && collectionErrors?.adsense ? "❌" : "⏳");
      
      // 수집 중이거나 실제 오류가 있을 때만 표시 (데이터 없음은 표시하지 않음)
      if (isCollecting || hasError) {
        metaInfoHtml += `
          <span class="kanban-card-meta data-source-status" title="GA4: ${gaStatus === "✅" ? "정상" : gaStatus === "❌" ? "오류" : "대기"} | AdSense: ${adsenseStatus === "✅" ? "정상" : adsenseStatus === "❌" ? "오류" : "대기"}">
            📡 ${gaStatus} GA4 ${adsenseStatus} AdSense
          </span>
        `;
      }
    }
  }
  
  if (hasPerformance) {
    card.classList.add("has-performance");
    const pageviews = performance.pageviews || 0;
    const earnings = performance.estimatedEarnings || 0;
    const avgDuration = performance.avgSessionDuration || 0;
    
    // 성과 지표 미리보기
    const performancePreview = `
      <div class="performance-preview">
        <span class="perf-metric" title="페이지뷰">👁️ ${pageviews.toLocaleString()}</span>
        <span class="perf-metric" title="수익">💰 $${earnings.toFixed(2)}</span>
        ${avgDuration > 0 ? `<span class="perf-metric" title="평균 체류 시간">⏱️ ${Math.round(avgDuration)}초</span>` : ''}
      </div>
    `;
    metaInfoHtml += performancePreview;
  } else if (hasError) {
    // 에러가 있는 경우 카드에 에러 스타일 적용
    card.classList.add("has-error");
  }

  let actionButtons = ``;
  // 모든 상태에서 삭제 버튼 추가
  actionButtons += `<button class="delete-card-btn" title="카드 삭제" data-card-id="${id}">🗑️</button>`;
  
  if (status === "done") {
    if (!data.publishedUrl) {
      actionButtons += `<button class="track-performance-btn">🔗 성과 추적</button>`;
    } else {
      const earnings = hasPerformance
        ? `$${(performance.estimatedEarnings || 0).toFixed(2)}`
        : "대기중";
      actionButtons += `
        <a href="${data.publishedUrl}" target="_blank" class="performance-link">수익: ${earnings}</a>
        <button class="change-url-btn" title="링크 변경">✏️ 변경</button>
        ${hasPerformance ? `<button class="view-performance-detail-btn" data-card-id="${id}">📊 상세</button>` : ''}
      `;
    }
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

    if (e.target.closest(".delete-card-btn")) {
      e.stopPropagation();
      const cardId = e.target.closest(".delete-card-btn").dataset.cardId;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      const cardTitle = cardData?.title || "제목 없음";
      
      if (confirm(`"${cardTitle}" 카드를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
        chrome.runtime.sendMessage({
          action: "delete_kanban_card",
          data: { cardId, status }
        }, (response) => {
          if (response && response.success) {
            showToast("✅ 카드가 삭제되었습니다.");
          } else {
            showToast("❌ 삭제 실패: " + (response?.error || "알 수 없는 오류"));
          }
        });
      }
    } else if (e.target.closest(".track-performance-btn") || e.target.closest(".change-url-btn")) {
      e.stopPropagation();
      const cardId = card.dataset.id;
      const status = card.dataset.status;
      const cardData = allKanbanData[status]?.[cardId];
      showPublishUrlModal(container, cardId, status, cardData?.title || "", cardData?.publishedUrl || "");
    } else if (e.target.closest(".view-performance-detail-btn")) {
      e.stopPropagation();
      const cardId = e.target.closest(".view-performance-detail-btn").dataset.cardId;
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
function showPublishUrlModal(container, cardId, status, cardTitle, existingUrl = "") {
  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector(".cp-publish-url-modal-wrap");
  if (existingModal) {
    existingModal.remove();
  }

  // URL 히스토리 가져오기
  chrome.storage.local.get(["publishUrlHistory"], (result) => {
    const urlHistory = result.publishUrlHistory || [];
    const isEditing = !!existingUrl;

    // 모달 생성
    const modalWrap = document.createElement("div");
    modalWrap.className = "cp-publish-url-modal-wrap";
    modalWrap.innerHTML = `
      <div class="cp-modal-backdrop"></div>
      <div class="cp-publish-url-modal">
        <div class="cp-modal-header">
          <div class="cp-modal-title">${isEditing ? "✏️ 발행 URL 변경" : "🔗 발행 URL 연결"}</div>
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
    
    // 버튼 텍스트 동적 변경
    if (isEditing) {
      submitBtn.textContent = "변경하기";
    }

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

      // 성과 추적 시작 (기존 URL이 있으면 변경, 없으면 새로 연결)
      chrome.runtime.sendMessage({
        action: "link_published_url",
        data: {
          cardId: cardId,
          url: url,
          status: status,
        },
      }, (response) => {
        if (response && response.success) {
          showToast(isEditing 
            ? "✅ 발행 URL이 변경되었습니다. 성과 추적이 다시 시작됩니다." 
            : "✅ 발행 URL이 연결되었습니다. 성과 추적이 시작됩니다.");
          cleanup();
        } else {
          showToast("❌ URL " + (isEditing ? "변경" : "연결") + " 실패: " + (response?.error || "알 수 없는 오류"));
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

/**
 * 성과 상세 보기 모달을 표시하는 함수
 */
function showPerformanceDetailModal(container, cardId, cardData) {
  const performance = cardData.performance;
  if (!performance || performance.error) {
    showToast("성과 데이터가 없습니다.");
    return;
  }

  // 기존 모달이 있으면 제거
  const existingModal = container.querySelector(".cp-performance-detail-modal-wrap");
  if (existingModal) {
    existingModal.remove();
  }

  const modalWrap = document.createElement("div");
  modalWrap.className = "cp-performance-detail-modal-wrap";
  
  // 시간대별 데이터 준비
  const hourlyData = performance.hourlyViews || [];
  const hourlyChartData = Array(24).fill(0);
  hourlyData.forEach(item => {
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
            <h3>${cardData.title || "제목 없음"}</h3>
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

          ${hourlyData.length > 0 ? `
            <div class="perf-chart-section">
              <h4>시간대별 페이지뷰 추이</h4>
              <div class="hourly-chart">
                ${hourlyChartData.map((views, hour) => {
                  const maxViews = Math.max(...hourlyChartData, 1);
                  const height = maxViews > 0 ? (views / maxViews) * 100 : 0;
                  return `
                    <div class="hourly-bar" style="height: ${height}%">
                      <div class="bar-value">${views > 0 ? views : ''}</div>
                      <div class="bar-fill"></div>
                      <div class="bar-label">${hour}시</div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <div class="perf-chart-section">
            <h4>주요 성과 지표 비교</h4>
            <div class="metrics-comparison-chart" id="metrics-comparison-chart">
              <div class="comparison-item">
                <div class="comparison-label">수익</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar earnings-comparison" style="width: ${Math.min((performance.estimatedEarnings || 0) / Math.max(maxEarnings || 1, 1) * 100, 100)}%">
                    <span class="comparison-value">$${(performance.estimatedEarnings || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">페이지뷰</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar pageviews-comparison" style="width: ${Math.min((performance.pageviews || 0) / Math.max(maxPageviews || 1, 1) * 100, 100)}%">
                    <span class="comparison-value">${(performance.pageviews || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">체류 시간</div>
                <div class="comparison-bar-wrapper">
                  <div class="comparison-bar duration-comparison" style="width: ${Math.min((performance.avgSessionDuration || 0) / Math.max(maxDuration || 1, 1) * 100, 100)}%">
                    <span class="comparison-value">${Math.round(performance.avgSessionDuration || 0)}초</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          ${topSources.length > 0 ? `
            <div class="perf-traffic-section">
              <h4>주요 유입 경로</h4>
              <div class="traffic-sources-list">
                ${topSources.map((source, idx) => `
                  <div class="traffic-source-item">
                    <span class="source-rank">${idx + 1}</span>
                    <div class="source-info">
                      <div class="source-name">${source.source === '(direct)' ? '직접 방문' : source.source}</div>
                      <div class="source-medium">${source.medium || 'none'}</div>
                    </div>
                    <div class="source-sessions">${source.sessions.toLocaleString()} 세션</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${performance.lastUpdatedAt ? `
            <div class="perf-footer">
              <span class="last-updated">마지막 업데이트: ${new Date(performance.lastUpdatedAt).toLocaleString('ko-KR')}</span>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="cp-modal-footer">
        <button class="cp-btn cp-btn-secondary" id="close-detail-btn">닫기</button>
      </div>
    </div>
  `;

  container.appendChild(modalWrap);

  // 전체 데이터에서 최대값 계산 (비교 차트용)
  const firebase = window.firebase;
  if (firebase) {
    const kanbanRef = firebase.database().ref("kanban");
    kanbanRef.once("value", (snapshot) => {
      const allCards = snapshot.val() || {};
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
    });
  }

  const closeBtn = modalWrap.querySelector(".cp-modal-close");
  const cancelBtn = modalWrap.querySelector("#close-detail-btn");
  const backdrop = modalWrap.querySelector(".cp-modal-backdrop");

  const cleanup = () => {
    modalWrap.remove();
  };

  closeBtn.addEventListener("click", cleanup);
  cancelBtn.addEventListener("click", cleanup);
  backdrop.addEventListener("click", cleanup);

  // ESC 키로 닫기
  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      cleanup();
      document.removeEventListener("keydown", handleKeydown);
    }
  };
  document.addEventListener("keydown", handleKeydown);
}

/**
 * 비교 차트 업데이트 함수
 */
function updateComparisonChart(modalWrap, performance, maxEarnings, maxPageviews, maxDuration) {
  const chartContainer = modalWrap.querySelector("#metrics-comparison-chart");
  if (!chartContainer) return;

  const earningsWidth = Math.min((performance.estimatedEarnings || 0) / Math.max(maxEarnings, 1) * 100, 100);
  const pageviewsWidth = Math.min((performance.pageviews || 0) / Math.max(maxPageviews, 1) * 100, 100);
  const durationWidth = Math.min((performance.avgSessionDuration || 0) / Math.max(maxDuration, 1) * 100, 100);

  const earningsBar = chartContainer.querySelector(".earnings-comparison");
  const pageviewsBar = chartContainer.querySelector(".pageviews-comparison");
  const durationBar = chartContainer.querySelector(".duration-comparison");

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
