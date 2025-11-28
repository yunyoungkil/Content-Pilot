// js/ui/affiliateModal.js
// 정적 import로 affiliateService 함수들을 불러옵니다
import {
  getAffiliateLinks,
  addAffiliateLink,
  updateAffiliateLink,
  deleteAffiliateLink,
} from "../services/affiliateService.js";

import { showToast } from "../utils.js";

let currentLinks = [];

export function renderAffiliateModal(container) {
  // CSS 로드 (한 번만) — Shadow DOM에서 렌더링될 수 있으므로
  // 루트 노드(문서 또는 쉐도우 루트)에 스타일 시트를 삽입합니다.
  try {
    const rootNode = container?.getRootNode ? container.getRootNode() : document;
    const alreadyLinked =
      (rootNode.querySelector && rootNode.querySelector('link[href*="affiliate-modal.css"]')) ||
      document.querySelector('link[href*="affiliate-modal.css"]');

    if (!alreadyLinked) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("css/affiliate-modal.css");

      // ShadowRoot에서도 append 가능 (open mode인 경우)
      if (rootNode instanceof ShadowRoot) {
        rootNode.appendChild(link);
        console.info("[AffiliateModal] stylesheet injected into ShadowRoot:", link.href);
      } else if (document.head) {
        document.head.appendChild(link);
        console.info("[AffiliateModal] stylesheet injected into document.head:", link.href);
      }
    }
  } catch (err) {
    // 안전 장치 — 스타일이 못 들어가도 동작은 계속되게 함
    console.warn("[AffiliateModal] 스타일 로드 실패, 계속 진행합니다:", err);
  }

  // [Fallback] 외부 스타일 로드에 실패했을 때도 최소한의 기본 스타일을 적용하기 위해
  // 쉐도우 루트(또는 container)에 인라인 스타일 블록을 추가합니다. 이는 시각 확인용 최소 스타일입니다.
  try {
    const rootNode = container?.getRootNode ? container.getRootNode() : document;
    const inlineId = "affiliate-inline-style";
    const hasInline = (rootNode.querySelector && rootNode.querySelector(`#${inlineId}`)) ||
                      document.querySelector(`#${inlineId}`);
    if (!hasInline) {
      const styleEl = document.createElement("style");
      styleEl.id = inlineId;
      styleEl.textContent = `
        /* minimal fallback styles to confirm UI changes */
        .affiliate-modal-large { background: #fff; color: #111; }
        .affiliate-link-card { background: #fff; border-radius: 8px; padding: 12px; border: 1px solid #eee; }
        .affiliate-form-section { background: #fff; border-radius: 8px; padding: 12px; }
      `;

      if (rootNode instanceof ShadowRoot) rootNode.appendChild(styleEl);
      else if (document.head) document.head.appendChild(styleEl);

      console.info("[AffiliateModal] minimal inline fallback styles injected.");
    }
  } catch (err) {
    // 너무 중요한 실패는 아니므로 경고만 남기고 계속 진행
    console.warn("[AffiliateModal] fallback inline style 적용 실패:", err);
  }

  // 모달 HTML 주입 - 개선된 UI
  const modalHTML = `
    <div id="affiliate-modal" class="cp-modal-wrap" style="display: none;">
      <div class="cp-modal-backdrop"></div>
      <div class="cp-modal affiliate-modal-large">
        <div class="cp-modal-header affiliate-modal-header">
          <div class="cp-modal-title affiliate-modal-title">
            <span class="affiliate-icon">💰</span>
            제휴 링크 관리 (Money Pipeline)
          </div>
          <div class="affiliate-modal-actions">
            <button class="cp-btn cp-btn-secondary affiliate-search-toggle" title="검색">
              <span class="search-icon">🔍</span>
            </button>
            <button class="cp-modal-close affiliate-close-btn" title="닫기">×</button>
          </div>
        </div>

        <div class="affiliate-search-bar" style="display: none;">
          <input type="text" class="affiliate-search-input" placeholder="링크명, 플랫폼, 키워드로 검색..." />
          <button class="affiliate-search-clear" title="검색 초기화">×</button>
        </div>

        <div class="cp-modal-body affiliate-modal-body">
          <div class="affiliate-content-wrapper">
            <!-- 링크 목록 섹션 -->
            <div class="affiliate-list-section">
              <div class="affiliate-list-header">
                <div class="affiliate-list-title-section">
                  <h3 class="affiliate-section-title">등록된 링크</h3>
                  <span class="affiliate-link-count" id="affiliate-link-count">(0개)</span>
                </div>
                <div class="affiliate-list-actions">
                  <button class="cp-btn cp-btn-secondary affiliate-refresh-btn" title="새로고침">
                    <span class="refresh-icon">🔄</span>
                  </button>
                  <button id="btn-show-add-form" class="cp-btn cp-btn-primary affiliate-add-btn">
                    <span class="add-icon">+</span>
                    새 링크 추가
                  </button>
                </div>
              </div>

              <div class="affiliate-link-stats" id="affiliate-link-stats" style="display: none;">
                <div class="stat-item">
                  <span class="stat-label">총 클릭수:</span>
                  <span class="stat-value" id="total-clicks">0</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">활성 링크:</span>
                  <span class="stat-value" id="active-links">0</span>
                </div>
              </div>

              <div id="affiliate-link-list" class="affiliate-link-list">
                <div class="affiliate-loading-state">
                  <div class="loading-spinner"></div>
                  <div class="loading-text">링크를 불러오는 중...</div>
                </div>
              </div>
            </div>

            <!-- 링크 폼 섹션 -->
            <div class="affiliate-form-section affiliate-form-container" id="affiliate-form-container" style="display: none;">
              <div class="affiliate-form-header">
                <h3 id="form-title" class="affiliate-form-title">새 링크 등록</h3>
                <button class="affiliate-form-close" title="폼 닫기">×</button>
              </div>

              <div class="affiliate-form-body">
                <input type="hidden" id="edit-link-id">

                <div class="affiliate-form-group">
                  <label for="aff-platform" class="affiliate-form-label required">플랫폼</label>
                  <select id="aff-platform" class="affiliate-form-select">
                    <option value="Coupang">🚀 쿠팡 파트너스</option>
                    <option value="AliExpress">🛍️ 알리익스프레스</option>
                    <option value="Amazon">📦 아마존 어소시에이트</option>
                    <option value="General">🔗 일반 제휴 링크</option>
                  </select>
                </div>

                <div class="affiliate-form-group">
                  <label for="aff-name" class="affiliate-form-label required">상품명 (표시 이름)</label>
                  <input type="text" id="aff-name" class="affiliate-form-input" placeholder="예: 아이폰 15 프로 자급제 256GB">
                  <div class="form-help-text">사용자에게 표시될 상품 이름입니다.</div>
                </div>

                <div class="affiliate-form-group">
                  <label for="aff-url" class="affiliate-form-label required">제휴 링크 URL</label>
                  <input type="url" id="aff-url" class="affiliate-form-input" placeholder="https://link.coupang.com/...">
                  <div class="form-help-text">제휴 프로그램에서 제공받은 추적 링크를 입력하세요.</div>
                </div>

                <div class="affiliate-form-group">
                  <label class="affiliate-form-label">자동 매칭 키워드</label>
                  <div class="affiliate-keyword-container">
                    <div id="keyword-tags-container" class="affiliate-keyword-tags">
                      <input type="text" id="affiliate-keyword-input" class="affiliate-keyword-input"
                             placeholder="키워드 입력 후 Enter (또는 붙여넣기)">
                    </div>
                    <div class="keyword-suggestions" style="display: none;">
                      <div class="suggestion-title">💡 추천 키워드:</div>
                      <div class="suggestion-tags" id="keyword-suggestions"></div>
                    </div>
                  </div>
                  <div class="form-help-text">
                    이 단어들이 콘텐츠에 나오면 자동으로 링크가 연결됩니다.
                    <br>쉼표, 줄바꿈, 공백으로 구분된 텍스트를 붙여넣으면 자동으로 분리됩니다.
                  </div>
                </div>

                <div class="affiliate-form-preview" id="affiliate-link-preview" style="display: none;">
                  <div class="preview-title">링크 미리보기</div>
                  <div class="preview-content" id="preview-content"></div>
                </div>
              </div>

              <div class="affiliate-form-footer">
                <div class="form-footer-left">
                  <button id="btn-preview-link" class="cp-btn cp-btn-secondary affiliate-preview-btn">
                    <span class="preview-icon">👁️</span>
                    미리보기
                  </button>
                </div>
                <div class="form-footer-right">
                  <button id="btn-cancel-form" class="cp-btn cp-btn-secondary">취소</button>
                  <button id="btn-save-link" class="cp-btn cp-btn-primary affiliate-save-btn">
                    <span class="save-icon">💾</span>
                    저장하기
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 이미 모달이 있으면 제거 후 다시 생성 (재렌더링 방지)
  const existing = container.querySelector("#affiliate-modal");
  if (existing) existing.remove();

  container.insertAdjacentHTML("beforeend", modalHTML);

  // 이벤트 바인딩
  bindEvents(container);

  // 데이터 로드
  loadLinks(container);
}

// 키워드 태그 관리용 배열
let tempKeywords = [];

// 텍스트에서 키워드를 파싱하는 헬퍼 함수
function parseKeywordsFromText(text) {
  if (!text || typeof text !== "string") return [];

  // 여러 구분자로 분리: 줄바꿈, 쉼표, 탭, 연속된 공백
  let keywords = text.split(/[\n,\t]+/);

  // 각 부분을 다시 공백으로 분리 (하지만 단일 키워드 유지)
  keywords = keywords.flatMap((part) => part.trim().split(/\s+/));

  // 빈 값 제거 및 트림, 중복 제거
  return keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .filter((keyword, index, arr) => arr.indexOf(keyword) === index);
}

function bindEvents(container) {
  if (!container) {
    console.error("[AffiliateModal] Container is null");
    return;
  }

  const modal = container.querySelector("#affiliate-modal");
  const formContainer = container.querySelector("#affiliate-form-container");
  const keywordInput = container.querySelector("#affiliate-keyword-input");

  if (!modal) {
    console.error("[AffiliateModal] Modal element not found");
    return;
  }

  // 모달 닫기
  const closeBtn = container.querySelector(".cp-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // 폼 닫기 버튼
  const formCloseBtn = container.querySelector(".affiliate-form-close");
  if (formCloseBtn) {
    formCloseBtn.addEventListener("click", () => {
      if (formContainer) formContainer.style.display = "none";
    });
  }

  // 검색 토글
  const searchToggle = container.querySelector(".affiliate-search-toggle");
  const searchBar = container.querySelector(".affiliate-search-bar");
  const searchInput = container.querySelector(".affiliate-search-input");
  const searchClear = container.querySelector(".affiliate-search-clear");

  if (searchToggle && searchBar) {
    searchToggle.addEventListener("click", () => {
      const isVisible = searchBar.style.display !== "none";
      searchBar.style.display = isVisible ? "none" : "flex";
      if (!isVisible && searchInput) {
        searchInput.focus();
      }
    });
  }

  // 검색 기능
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      filterLinks(container, e.target.value);
    });
  }

  // 검색 초기화
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      filterLinks(container, "");
    });
  }

  // 새로고침 버튼
  const refreshBtn = container.querySelector(".affiliate-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadLinks(container);
    });
  }

  // 폼 열기 (추가 모드)
  const showFormBtn = container.querySelector("#btn-show-add-form");
  if (showFormBtn) {
    showFormBtn.addEventListener("click", () => {
      resetForm(container);
      if (formContainer) formContainer.style.display = "block";
      // 폼이 열리면 상품명 입력창에 포커스
      const nameInput = container.querySelector("#aff-name");
      if (nameInput) setTimeout(() => nameInput.focus(), 100);
    });
  }

  // 폼 취소
  const cancelBtn = container.querySelector("#btn-cancel-form");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      if (formContainer) formContainer.style.display = "none";
    });
  }

  // 미리보기 버튼
  const previewBtn = container.querySelector("#btn-preview-link");
  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      showLinkPreview(container);
    });
  }

  // 키워드 태그 입력 (Enter 감지 및 붙여넣기 자동 분리)
  if (keywordInput) {
    // 붙여넣기 이벤트 처리 - 자동으로 키워드 분리
    keywordInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const pastedText = e.clipboardData.getData("text");
      const keywords = parseKeywordsFromText(pastedText);

      let addedCount = 0;
      keywords.forEach((keyword) => {
        const trimmed = keyword.trim();
        if (trimmed && !tempKeywords.includes(trimmed)) {
          tempKeywords.push(trimmed);
          addedCount++;
        }
      });

      if (addedCount > 0) {
        renderTags(container);
        updateKeywordSuggestions(container);
        e.target.value = "";
        showToast(`✅ ${addedCount}개의 키워드가 추가되었습니다.`);
      } else if (keywords.length > 0) {
        showToast("ℹ️ 모든 키워드가 이미 존재하거나 비어있습니다.");
      }
    });

    // Enter 키 입력 처리
    keywordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val && !tempKeywords.includes(val)) {
          tempKeywords.push(val);
          renderTags(container);
          updateKeywordSuggestions(container);
          e.target.value = "";
        }
      }
    });

    // 입력 중 실시간 힌트 표시
    keywordInput.addEventListener("input", (e) => {
      const value = e.target.value.trim();
      if (value.length > 0) {
        // 잠시 후 힌트 표시
        setTimeout(() => {
          if (e.target.value.trim() === value) {
            // 값이 변경되지 않았을 때만
            const keywords = parseKeywordsFromText(value);
            if (keywords.length > 1) {
              showToast(
                "💡 붙여넣기나 Enter로 키워드를 추가하세요. 공백/줄바꿈/쉼표로 구분된 텍스트는 자동으로 분리됩니다."
              );
            } else if (
              value.includes(" ") ||
              value.includes("\n") ||
              value.includes(",")
            ) {
              showToast("💡 붙여넣기나 Enter로 키워드를 추가하세요.");
            }
          }
        }, 1500);
      }
    });
  }

  // 저장 버튼
  const saveBtn = container.querySelector("#btn-save-link");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const id = container.querySelector("#edit-link-id")?.value;
      const name = container.querySelector("#aff-name")?.value?.trim();
      const url = container.querySelector("#aff-url")?.value?.trim();
      const platform = container.querySelector("#aff-platform")?.value;

      if (!name || !url) {
        showToast("❌ 상품명과 링크 URL은 필수입니다.");
        // 필수 필드 하이라이트
        const nameInput = container.querySelector("#aff-name");
        const urlInput = container.querySelector("#aff-url");
        if (!name && nameInput) nameInput.classList.add("error");
        if (!url && urlInput) urlInput.classList.add("error");
        return;
      }

      // 로딩 상태 표시
      saveBtn.disabled = true;
      saveBtn.innerHTML =
        '<div class="loading-spinner small"></div> 저장 중...';

      const payload = {
        name,
        url,
        platform,
        keywords: tempKeywords, // 배열로 저장
      };

      try {
        if (id) {
          await updateAffiliateLink(id, payload);
          showToast("✅ 링크가 수정되었습니다.");
        } else {
          await addAffiliateLink(payload);
          showToast("✅ 새 링크가 등록되었습니다.");
        }

        resetForm(container);
        if (formContainer) formContainer.style.display = "none";
        loadLinks(container); // 목록 갱신
      } catch (error) {
        console.error("[AffiliateModal] Save error:", error);
        showToast("❌ 저장 중 오류가 발생했습니다.");
      } finally {
        // 로딩 상태 해제
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="save-icon">💾</span> 저장하기';
      }
    });
  }

  // ESC 키로 모달 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (formContainer && formContainer.style.display !== "none") {
        formContainer.style.display = "none";
      } else if (modal.style.display !== "none") {
        modal.style.display = "none";
      }
    }
  });
}

function renderTags(container) {
  if (!container) return;

  const tagContainer = container.querySelector("#keyword-tags-container");
  const input = container.querySelector("#affiliate-keyword-input");

  if (!tagContainer || !input) return;

  // 기존 태그 지우기 (input 제외)
  Array.from(tagContainer.children).forEach((child) => {
    if (child !== input) child.remove();
  });

  // 태그 다시 그리기
  tempKeywords.forEach((tag, index) => {
    const tagEl = document.createElement("span");
    tagEl.className = "affiliate-keyword-tag";
    tagEl.innerHTML = `
      <span class="tag-text">${tag}</span>
      <button class="tag-remove" title="키워드 삭제" data-index="${index}">×</button>
    `;

    // 태그 삭제 이벤트
    const removeBtn = tagEl.querySelector(".tag-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        tempKeywords.splice(index, 1);
        renderTags(container);
        updateKeywordSuggestions(container);
      });
    }

    tagContainer.insertBefore(tagEl, input);
  });

  // 태그 개수에 따라 컨테이너 높이 조정
  updateTagContainerHeight(container);
}

function updateTagContainerHeight(container) {
  const tagContainer = container.querySelector("#keyword-tags-container");
  if (!tagContainer) return;

  const tagCount = tempKeywords.length;
  const minHeight = tagCount > 3 ? "80px" : "48px";
  tagContainer.style.minHeight = minHeight;
}

function updateKeywordSuggestions(container) {
  const suggestionsContainer = container.querySelector(".keyword-suggestions");
  const suggestionsTags = container.querySelector("#keyword-suggestions");

  if (!suggestionsContainer || !suggestionsTags) return;

  // 현재 키워드를 기반으로 추천 키워드 생성
  const suggestions = generateKeywordSuggestions(tempKeywords);

  if (suggestions.length > 0) {
    suggestionsTags.innerHTML = suggestions
      .map(
        (suggestion) => `
      <button class="suggestion-tag" data-keyword="${suggestion}">${suggestion}</button>
    `
      )
      .join("");

    // 추천 키워드 클릭 이벤트
    suggestionsTags.querySelectorAll(".suggestion-tag").forEach((btn) => {
      btn.addEventListener("click", () => {
        const keyword = btn.dataset.keyword;
        if (keyword && !tempKeywords.includes(keyword)) {
          tempKeywords.push(keyword);
          renderTags(container);
          updateKeywordSuggestions(container);
          showToast(`✅ 추천 키워드 "${keyword}"가 추가되었습니다.`);
        }
      });
    });

    suggestionsContainer.style.display = "block";
  } else {
    suggestionsContainer.style.display = "none";
  }
}

function generateKeywordSuggestions(existingKeywords) {
  // 간단한 추천 로직 - 실제로는 더 정교한 알고리즘 사용 가능
  const commonSuggestions = [
    "구매",
    "가격",
    "할인",
    "리뷰",
    "추천",
    "최저가",
    "배송",
    "무료배송",
    "특가",
    "세일",
    "이벤트",
    "쿠폰",
    "포토후기",
    "사용후기",
  ];

  return commonSuggestions
    .filter(
      (suggestion) =>
        !existingKeywords.includes(suggestion) &&
        !existingKeywords.some(
          (keyword) =>
            keyword.includes(suggestion) || suggestion.includes(keyword)
        )
    )
    .slice(0, 8);
}

function showLinkPreview(container) {
  const name = container.querySelector("#aff-name")?.value?.trim();
  const url = container.querySelector("#aff-url")?.value?.trim();
  const platform = container.querySelector("#aff-platform")?.value;

  if (!name || !url) {
    showToast("⚠️ 상품명과 URL을 입력한 후 미리보기를 확인하세요.");
    return;
  }

  const previewContainer = container.querySelector("#affiliate-link-preview");
  const previewContent = container.querySelector("#preview-content");

  if (!previewContainer || !previewContent) return;

  // 플랫폼 아이콘 결정
  let icon = "🔗";
  if (platform === "Coupang") icon = "🚀";
  else if (platform === "AliExpress") icon = "🛍️";
  else if (platform === "Amazon") icon = "📦";

  // 미리보기 HTML 생성
  previewContent.innerHTML = `
    <div class="preview-link-card">
      <div class="preview-link-header">
        <span class="preview-platform-icon">${icon}</span>
        <span class="preview-platform-name">${platform}</span>
      </div>
      <div class="preview-link-title">${name}</div>
      <div class="preview-link-url">${url}</div>
      <div class="preview-link-keywords">
        ${
          tempKeywords.length > 0
            ? tempKeywords
                .map((k) => `<span class="preview-keyword">#${k}</span>`)
                .join(" ")
            : '<span class="no-keywords">키워드 없음</span>'
        }
      </div>
    </div>
  `;

  previewContainer.style.display = "block";

  // 미리보기 스크롤
  previewContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function filterLinks(container, searchTerm) {
  const listEl = container.querySelector("#affiliate-link-list");
  if (!listEl) return;

  const searchLower = searchTerm.toLowerCase();
  const linkCards = listEl.querySelectorAll(".affiliate-link-card");

  linkCards.forEach((card) => {
    const title =
      card.querySelector(".link-title")?.textContent?.toLowerCase() || "";
    const platform =
      card.querySelector(".link-platform")?.textContent?.toLowerCase() || "";
    const keywords = Array.from(card.querySelectorAll(".link-keyword")).map(
      (k) => k.textContent.toLowerCase()
    );

    const matches =
      title.includes(searchLower) ||
      platform.includes(searchLower) ||
      keywords.some((k) => k.includes(searchLower));

    card.style.display = matches ? "block" : "none";
  });

  // 검색 결과 개수 표시
  const visibleCards = listEl.querySelectorAll(
    '.affiliate-link-card[style*="display: block"], .affiliate-link-card:not([style*="display"])'
  );
  const totalCards = linkCards.length;

  if (searchTerm && visibleCards.length !== totalCards) {
    showToast(`🔍 검색 결과: ${visibleCards.length}개 링크 찾음`);
  }
}

function resetForm(container) {
  if (!container) return;

  const editIdInput = container.querySelector("#edit-link-id");
  const nameInput = container.querySelector("#aff-name");
  const urlInput = container.querySelector("#aff-url");
  const platformSelect = container.querySelector("#aff-platform");
  const formTitle = container.querySelector("#form-title");
  const previewContainer = container.querySelector("#affiliate-link-preview");

  if (editIdInput) editIdInput.value = "";
  if (nameInput) {
    nameInput.value = "";
    nameInput.classList.remove("error");
  }
  if (urlInput) {
    urlInput.value = "";
    urlInput.classList.remove("error");
  }
  if (platformSelect) platformSelect.value = "Coupang";

  tempKeywords = [];
  renderTags(container);
  updateKeywordSuggestions(container);

  if (formTitle) formTitle.textContent = "새 링크 등록";
  if (previewContainer) previewContainer.style.display = "none";
}

async function loadLinks(container) {
  if (!container) return;

  const listEl = container.querySelector("#affiliate-link-list");
  const countEl = container.querySelector("#affiliate-link-count");
  const statsEl = container.querySelector("#affiliate-link-stats");

  if (!listEl) return;

  // 로딩 상태 표시
  listEl.innerHTML = `
    <div class="affiliate-loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">링크를 불러오는 중...</div>
    </div>
  `;

  try {
    currentLinks = await getAffiliateLinks();

    // 링크 개수 업데이트
    if (countEl) {
      countEl.textContent = `(${currentLinks.length}개)`;
    }

    // 통계 업데이트
    if (statsEl) {
      const totalClicks = currentLinks.reduce(
        (sum, link) => sum + (link.clickCount || 0),
        0
      );
      const activeLinks = currentLinks.filter(
        (link) => link.keywords && link.keywords.length > 0
      ).length;

      container.querySelector("#total-clicks").textContent =
        totalClicks.toLocaleString();
      container.querySelector("#active-links").textContent = activeLinks;

      if (currentLinks.length > 0) {
        statsEl.style.display = "flex";
      } else {
        statsEl.style.display = "none";
      }
    }

    if (currentLinks.length === 0) {
      listEl.innerHTML = `
        <div class="affiliate-empty-state">
          <div class="empty-icon">🔗</div>
          <div class="empty-title">등록된 제휴 링크가 없습니다</div>
          <div class="empty-description">새로운 제휴 링크를 추가하여 수익을 창출해보세요!</div>
          <button class="cp-btn cp-btn-primary affiliate-add-from-empty" id="btn-add-from-empty">
            <span class="add-icon">+</span>
            첫 제휴 링크 추가하기
          </button>
        </div>
      `;

      // 빈 상태에서 추가 버튼 이벤트
      const addFromEmptyBtn = listEl.querySelector("#btn-add-from-empty");
      if (addFromEmptyBtn) {
        addFromEmptyBtn.addEventListener("click", () => {
          const addBtn = container.querySelector("#btn-show-add-form");
          if (addBtn) addBtn.click();
        });
      }

      return;
    }

    listEl.innerHTML = "";
    currentLinks.forEach((link) => {
      const item = document.createElement("div");
      item.className = "affiliate-link-card";

      // 플랫폼 정보 결정
      let platformIcon = "🔗";
      let platformName = "일반";
      let platformColor = "#666";

      if (link.platform === "Coupang") {
        platformIcon = "🚀";
        platformName = "쿠팡";
        platformColor = "#ff5a5f";
      } else if (link.platform === "AliExpress") {
        platformIcon = "🛍️";
        platformName = "알리익스프레스";
        platformColor = "#ff6a00";
      } else if (link.platform === "Amazon") {
        platformIcon = "📦";
        platformName = "아마존";
        platformColor = "#ff9900";
      }

      // 키워드 표시
      const keywordsHtml = (link.keywords || [])
        .map((k) => `<span class="link-keyword">#${k}</span>`)
        .join("");

      // 클릭 수 표시
      const clickCount = link.clickCount || 0;

      item.innerHTML = `
        <div class="link-header">
          <div class="link-platform-info">
            <span class="link-platform-icon" style="color: ${platformColor}">${platformIcon}</span>
            <span class="link-platform">${platformName}</span>
          </div>
          <div class="link-actions">
            <button class="link-edit-btn" title="수정">✏️</button>
            <button class="link-delete-btn" title="삭제">🗑️</button>
          </div>
        </div>

        <div class="link-content">
          <div class="link-title">${link.name}</div>
          <div class="link-url" title="${link.url}">${link.url}</div>
          <div class="link-keywords-section">
            ${keywordsHtml || '<span class="no-keywords">키워드 없음</span>'}
          </div>
        </div>

        <div class="link-footer">
          <div class="link-stats">
            <span class="click-count">클릭: ${clickCount.toLocaleString()}</span>
          </div>
          <div class="link-date">등록: ${new Date(
            link.createdAt || Date.now()
          ).toLocaleDateString("ko-KR")}</div>
        </div>
      `;

      // 수정 버튼 이벤트
      const editBtn = item.querySelector(".link-edit-btn");
      if (editBtn) {
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openEditForm(container, link);
        });
      }

      // 삭제 버튼 이벤트
      const deleteBtn = item.querySelector(".link-delete-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm(`"${link.name}" 링크를 정말 삭제하시겠습니까?`)) {
            try {
              deleteBtn.disabled = true;
              deleteBtn.textContent = "삭제 중...";

              await deleteAffiliateLink(link.id);
              await loadLinks(container);
              showToast("🗑️ 링크가 삭제되었습니다.");
            } catch (error) {
              console.error("[AffiliateModal] Delete error:", error);
              showToast("❌ 삭제 중 오류가 발생했습니다.");
              deleteBtn.disabled = false;
              deleteBtn.textContent = "🗑️";
            }
          }
        });
      }

      // 카드 클릭으로 수정 모드 (삭제 버튼 제외)
      item.addEventListener("click", (e) => {
        if (
          !e.target.classList.contains("link-delete-btn") &&
          !e.target.classList.contains("link-edit-btn")
        ) {
          openEditForm(container, link);
        }
      });

      listEl.appendChild(item);
    });
  } catch (error) {
    console.error("[AffiliateModal] Load links error:", error);
    if (listEl) {
      listEl.innerHTML = `
        <div class="affiliate-error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-title">링크 로드 실패</div>
          <div class="error-description">링크를 불러오는 중 오류가 발생했습니다.</div>
          <button class="cp-btn cp-btn-secondary affiliate-retry-btn" id="affiliate-retry-btn">
            <span class="retry-icon">🔄</span>
            다시 시도
          </button>
        </div>
      `;

      // 에러 상태에서 다시 시도 버튼 이벤트 추가
      const retryBtn = listEl.querySelector("#affiliate-retry-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          loadLinks(container);
        });
      }
    }
  }
}

function openEditForm(container, link) {
  const formContainer = container.querySelector("#affiliate-form-container");
  resetForm(container);

  const editIdInput = container.querySelector("#edit-link-id");
  const nameInput = container.querySelector("#aff-name");
  const urlInput = container.querySelector("#aff-url");
  const platformSelect = container.querySelector("#aff-platform");
  const formTitle = container.querySelector("#form-title");

  if (editIdInput) editIdInput.value = link.id;
  if (nameInput) nameInput.value = link.name;
  if (urlInput) urlInput.value = link.url;
  if (platformSelect) platformSelect.value = link.platform || "General";

  tempKeywords = [...(link.keywords || [])];
  renderTags(container);
  updateKeywordSuggestions(container);

  if (formTitle) formTitle.textContent = "링크 수정";
  if (formContainer) formContainer.style.display = "block";

  // 폼이 열리면 상품명 입력창에 포커스
  if (nameInput) setTimeout(() => nameInput.focus(), 100);
}
