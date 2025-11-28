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
  if (!container) {
    console.error(
      "[AffiliateModal] renderAffiliateModal: container is null or undefined"
    );
    return;
  }
  // CSS 로드 (한 번만) — Shadow DOM에서 렌더링될 수 있으므로
  // 루트 노드(문서 또는 쉐도우 루트)에 스타일 시트를 삽입합니다.
  try {
    const rootNode = container?.getRootNode
      ? container.getRootNode()
      : document;
    const alreadyLinked =
      (rootNode.querySelector &&
        rootNode.querySelector('link[href*="affiliate-modal.css"]')) ||
      document.querySelector('link[href*="affiliate-modal.css"]');

    if (!alreadyLinked) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("css/affiliate-modal.css");

      // ShadowRoot에서도 append 가능 (open mode인 경우)
      if (rootNode instanceof ShadowRoot) {
        rootNode.appendChild(link);
        console.info(
          "[AffiliateModal] stylesheet injected into ShadowRoot:",
          link.href
        );
      } else if (document.head) {
        document.head.appendChild(link);
        console.info(
          "[AffiliateModal] stylesheet injected into document.head:",
          link.href
        );
      }
    }
  } catch (err) {
    // 안전 장치 — 스타일이 못 들어가도 동작은 계속되게 함
    console.warn("[AffiliateModal] 스타일 로드 실패, 계속 진행합니다:", err);
  }

  // [Fallback] 외부 스타일 로드에 실패했을 때도 최소한의 기본 스타일을 적용하기 위해
  // 쉐도우 루트(또는 container)에 인라인 스타일 블록을 추가합니다. 이는 시각 확인용 최소 스타일입니다.
  try {
    const rootNode = container?.getRootNode
      ? container.getRootNode()
      : document;
    const inlineId = "affiliate-inline-style";
    const hasInline =
      (rootNode.querySelector && rootNode.querySelector(`#${inlineId}`)) ||
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

                <!-- Card Mode: 쿠팡 텍스트 붙여넣기 및 상세 데이터 -->
                <div class="affiliate-form-group card-mode-group" style="margin-top:12px;border-top:1px dashed #eee;padding-top:12px;">
                  <label class="affiliate-form-label">카드형 데이터 (자동 분석)</label>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <textarea id="card-raw-text" placeholder="쿠팡 상품 텍스트를 붙여넣으세요 (예: 상품명 207,460원 9% 187,460원 내일(토) 도착 보장 5 (867))" style="width:100%;min-height:60px;padding:8px;border:1px solid #e9ecef;border-radius:8px;background:#fafbfc;"></textarea>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <button id="btn-parse-card" class="cp-btn cp-btn-secondary" title="자동 분석">자동분석</button>
                      <span style="font-size:12px;color:#666;">붙여넣고 자동분석을 누르면 카드 필드가 채워집니다. 수동 입력도 가능합니다.</span>
                    </div>

                    <div class="card-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                      <input type="text" id="card-product-name" placeholder="상품명 (자동 입력됨)" class="affiliate-form-input">
                      <input type="text" id="card-image-url" placeholder="이미지 URL (선택)" class="affiliate-form-input">
                      <input type="number" id="card-original-price" placeholder="원가 (숫자)" class="affiliate-form-input">
                      <input type="number" id="card-sale-price" placeholder="판매가 (숫자)" class="affiliate-form-input">
                      <input type="number" id="card-discount-rate" placeholder="할인율 (%)" class="affiliate-form-input">
                      <input type="number" id="card-rating" step="0.1" placeholder="별점 (예: 4.5)" class="affiliate-form-input">
                      <input type="number" id="card-review-count" placeholder="리뷰수" class="affiliate-form-input">
                      <input type="text" id="card-badges" placeholder="뱃지(쉼표로 구분)" class="affiliate-form-input">
                      <label style="grid-column: 1 / -1; display:flex; gap:8px; align-items:center;">
                        <input type="checkbox" id="card-is-rocket"> <span style="font-size:13px;color:#555;">내일 도착 보장 / 로켓배송 여부</span>
                      </label>
                      <label style="grid-column: 1 / -1; display:flex; gap:8px; align-items:center;">
                        <span style="font-size:13px;color:#666;">삽입 모드:</span>
                        <select id="card-insert-mode" class="affiliate-form-select" style="width:160px;">
                          <option value="card">카드형으로 삽입</option>
                          <option value="text">텍스트 링크로 삽입</option>
                        </select>
                      </label>
                    </div>
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

/**
 * 쿠팡의 상품 텍스트를 파싱하여 cardData 객체를 추출합니다.
 * - 가격(원), 할인율(%), 별점, 리뷰수, 로켓배송 여부, 뱃지 등을 시도적으로 추출합니다.
 * - 이 파서는 완벽하지 않으므로 실패해도 기존 폼 필드를 수동으로 편집할 수 있습니다.
 */
export function parseCoupangText(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  const result = {
    productName: "",
    originalPrice: 0,
    salePrice: 0,
    discountRate: 0,
    rating: 0,
    reviewCount: 0,
    isRocket: false,
    badges: [],
    imageUrl: "",
  };

  const text = rawText.trim();
  // If input looks like HTML, try to parse DOM for a more accurate extraction
  let doc = null;
  if (/<[a-z][\s\S]*>/i.test(text)) {
    try {
      doc = new DOMParser().parseFromString(text, "text/html");
    } catch (e) {
      doc = null;
    }
  }

  const lines = (doc ? doc.body.textContent || "" : text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1) 상품명: 우선 DOM에서 찾고, 실패하면 첫 줄
  try {
    if (doc) {
      // common class patterns seen on Coupang / other marketplaces
      const nameEl = doc.querySelector(
        ".ProductUnit_productNameV2__cV9cw, .ProductUnit_productName, .product-name, .ProductName, .title, .product-title"
      );
      if (nameEl && nameEl.textContent.trim())
        result.productName = nameEl.textContent.trim();
    }
  } catch (e) {}

  if (!result.productName && lines.length > 0) result.productName = lines[0];

  // 2) 가격 (모든 원 표기를 찾아 숫자 추출)
  const priceRegex = /([0-9,]+)원/g;
  const prices = [];
  let m;
  // When HTML is provided, prefer price values located inside the price area if possible
  if (doc) {
    try {
      const priceContainer =
        doc.querySelector(".PriceArea_priceArea__NntJz") ||
        doc.querySelector(".PriceArea") ||
        doc.querySelector(".PriceArea_priceArea");
      const priceSourceText = priceContainer
        ? priceContainer.textContent || ""
        : doc.body.textContent || "";
      while ((m = priceRegex.exec(priceSourceText)) !== null) {
        prices.push(parseInt(m[1].replace(/,/g, ""), 10));
      }
    } catch (e) {
      // fallback to scanning full text
    }
  }
  // fallback: scan whole text if none found in DOM price container
  if (prices.length === 0) {
    while ((m = priceRegex.exec(text)) !== null) {
      prices.push(parseInt(m[1].replace(/,/g, ""), 10));
    }
  }
  if (prices.length >= 2) {
    // 일반적으로 [원가, 할인가] 형태
    result.originalPrice = Math.max(...prices);
    result.salePrice = Math.min(...prices);
  } else if (prices.length === 1) {
    result.salePrice = prices[0];
  }

  // 3) 할인률 - try DOM first
  let discountMatch = null;
  if (doc) {
    try {
      const percEl = doc.querySelector(
        "*[class*='percent'], *[class*='discount'], div, span"
      );
      // fallback: search for any % in body text
      const pct =
        doc.body && doc.body.textContent
          ? doc.body.textContent.match(/(\d{1,3})%/) || null
          : null;
      discountMatch = pct;
    } catch (e) {
      discountMatch = text.match(/(\d{1,3})%/);
    }
  } else {
    discountMatch = text.match(/(\d{1,3})%/);
  }
  if (discountMatch) result.discountRate = parseInt(discountMatch[1], 10);

  // 4) 별점과 리뷰수 (예: 4.5 (1,234))
  // 4) 별점과 리뷰수 (예: 4.5 (1,234)) - try DOM then fallback to text
  let ratingMatch = null;
  try {
    if (doc) {
      // rating (stars or numeric)
      const starEl = doc.querySelector(
        ".ProductRating_star__RGSlV, .ProductRating_rating__lMxS9, .rating, .star"
      );
      const reviewEl = doc.querySelector(
        ".ProductRating_ratingCount__R0Vhz, .ratingCount, .review-count"
      );
      if (starEl && starEl.textContent) {
        const starTxt = starEl.textContent.trim();
        const r = starTxt.match(/([0-5](?:\.\d)?)/);
        if (r) ratingMatch = [r[0], r[1]]; // emulate match groups
      }
      if (!ratingMatch && reviewEl && reviewEl.textContent) {
        const t = reviewEl.textContent.match(/([0-9,]+)/);
        if (t) ratingMatch = [t[0], t[1]]; // fallback
      }
      // final fallback: try to search the body text
      if (!ratingMatch) {
        const bodyText = doc.body.textContent || "";
        ratingMatch = bodyText
          ? bodyText.match(/([0-5](?:\.\d)?)\s*\(?([0-9,]{1,})?\)?/)
          : null;
      }
    }
  } catch (e) {
    ratingMatch = null;
  }
  if (!ratingMatch)
    ratingMatch = text.match(/([0-5](?:\.\d)?)\s*\(?([0-9,]{1,})?\)?/);
  if (ratingMatch) {
    // ratingMatch might be custom-generated array above
    const maybeRating = parseFloat(ratingMatch[1] || ratingMatch[0] || 0);
    if (!Number.isNaN(maybeRating)) result.rating = maybeRating;
    const rc =
      ratingMatch[2] ||
      (ratingMatch[1] && ratingMatch[0] && ratingMatch[0] !== ratingMatch[1]
        ? ratingMatch[0]
        : null);
    if (rc) {
      // rc may include commas
      const digits = String(rc)
        .replace(/[^0-9,]/g, "")
        .replace(/,/g, "");
      if (digits) result.reviewCount = parseInt(digits, 10);
    }
  }

  // 5) 배송/로켓배송 여부
  try {
    if (doc) {
      const deliveryText = doc.body.textContent || "";
      if (
        /로켓|도착 보장|내일\(|오늘\(|빠른 배송|로켓배송/.test(deliveryText)
      ) {
        result.isRocket = true;
      }
    } else if (/로켓|도착 보장|내일\(|오늘\(|빠른 배송|로켓배송/.test(text)) {
      result.isRocket = true;
    }
  } catch (e) {
    if (/로켓|도착 보장|내일\(|오늘\(|빠른 배송|로켓배송/.test(text))
      result.isRocket = true;
  }

  // 6) 뱃지 키워드 간단 추출 - prefer DOM (badges or img alt / span text)
  try {
    if (doc) {
      const badgeEls = Array.from(
        doc.querySelectorAll(
          "img[alt], .BenefitBadge_cash-benefit__SmkrN span, .custom-oos, .ImageBadge_default__JWaYp, .ImageBadge_coupick__0i8UV, .ProductRating_ratingCount__R0Vhz, .ProductUnit_productInfo__1l0il span"
        )
      );
      const badgeTexts = new Set();
      badgeEls.forEach((el) => {
        const t =
          (el.getAttribute && el.getAttribute("alt")) || el.textContent || "";
        const trimmed = (t || "").trim();
        if (trimmed) badgeTexts.add(trimmed);
      });
      // fallback keywords
      [
        "무료배송",
        "적립",
        "쿠폰",
        "최저가",
        "세일",
        "웰컴백 쿠폰 적용됨",
      ].forEach((k) => {
        if ((doc.body.textContent || "").includes(k)) badgeTexts.add(k);
      });
      result.badges = Array.from(badgeTexts).filter(Boolean);
    } else {
      ["무료배송", "적립", "쿠폰", "최저가", "세일"].forEach((k) => {
        if (text.includes(k)) result.badges.push(k);
      });
    }
  } catch (e) {
    ["무료배송", "적립", "쿠폰", "최저가", "세일"].forEach((k) => {
      if (text.includes(k)) result.badges.push(k);
    });
  }

  // 7) 이미지 추출 (DOM 우선)
  try {
    if (doc) {
      const mainImg = doc.querySelector(
        "figure img, .ProductUnit_productImage__Mqcg1 img, img[src]"
      );
      if (mainImg && mainImg.src) result.imageUrl = mainImg.src;
    }
  } catch (e) {}

  // if still missing some values, keep fallback from text results above
  // Fallback: if reviewCount still missing, try to extract digits from collected badge texts (e.g. "(867)")
  try {
    if (!result.reviewCount && result.badges && result.badges.length > 0) {
      const joined = result.badges.join(" ");
      // prioritize numbers inside parentheses (e.g. (867)), otherwise prefer any number with >=3 digits
      const paren = joined.match(/\((\d{1,3}(?:,\d{3})*)\)/);
      if (paren && paren[1]) {
        result.reviewCount = parseInt(paren[1].replace(/,/g, ""), 10);
      } else {
        const numMatches = joined.match(/\d{1,3}(?:,\d{3})*/g) || [];
        const candidate = numMatches.find(
          (x) => x.replace(/,/g, "").length >= 3
        );
        if (candidate)
          result.reviewCount = parseInt(candidate.replace(/,/g, ""), 10);
      }
    }
  } catch (e) {}
  return result;
}

function bindEvents(container) {
  if (!container) {
    console.error("[AffiliateModal] Container is null");
    return;
  }

  const modal = container.querySelector("#affiliate-modal");
  const formContainer = container.querySelector("#affiliate-form-container");
  const keywordInput = container.querySelector("#affiliate-keyword-input");
  // search controls (may exist in modal)
  const searchToggle = container.querySelector(".affiliate-search-toggle");
  const searchBar = container.querySelector(".affiliate-search-bar");
  const searchInput = container.querySelector(".affiliate-search-input");
  const searchClear = container.querySelector(".affiliate-search-clear");

  if (!modal) {
    console.error("[AffiliateModal] Modal element not found");
    return;
  }

  // (removed stray DOM parsing code that was accidentally placed here)
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

  // 모달 닫기 버튼 (헤더 우측 X)
  const closeModalBtn = container.querySelector(
    ".cp-modal-close, .affiliate-close-btn"
  );
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // 먼저 폼이 열려있다면 폼 숨김
      if (formContainer && formContainer.style.display !== "none") {
        formContainer.style.display = "none";
      }
      // 모달 숨김
      modal.style.display = "none";
    });
  }

  // 모달 백드롭 클릭으로 닫기
  const backdrop = container.querySelector(".cp-modal-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      e.preventDefault();
      if (formContainer && formContainer.style.display !== "none") {
        formContainer.style.display = "none";
      }
      modal.style.display = "none";
    });
  }

  // 미리보기 버튼
  const previewBtn = container.querySelector("#btn-preview-link");
  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      showLinkPreview(container);
    });
  }

  // 카드 HTML 복사 버튼 (form footer 좌측에 추가)
  const copyHtmlBtnId = "btn-copy-card-html";
  if (!container.querySelector(`#${copyHtmlBtnId}`)) {
    const copyBtn = document.createElement("button");
    copyBtn.id = copyHtmlBtnId;
    copyBtn.className = "cp-btn cp-btn-secondary";
    copyBtn.style.marginLeft = "8px";
    copyBtn.textContent = "카드 HTML 복사";

    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        const cardProductName = container
          .querySelector("#card-product-name")
          ?.value?.trim();
        const cardImg = container
          .querySelector("#card-image-url")
          ?.value?.trim();
        const cardSale = container
          .querySelector("#card-sale-price")
          ?.value?.trim();
        const cardOrig = container
          .querySelector("#card-original-price")
          ?.value?.trim();
        const cardDiscount = container
          .querySelector("#card-discount-rate")
          ?.value?.trim();
        const cardBadges = container
          .querySelector("#card-badges")
          ?.value?.trim();
        const url = container.querySelector("#aff-url")?.value?.trim() || "";

        const cardHtml = `
          <div style="border:1px solid #eee;border-radius:12px;padding:16px;display:flex;gap:16px;max-width:640px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.06);">
            <div style="width:128px;height:128px;border-radius:8px;overflow:hidden;background:#fafbfc;border:1px solid #eee;display:flex;align-items:center;justify-content:center;">
              ${
                cardImg
                  ? `<img src="${cardImg}" style="width:100%;height:100%;object-fit:cover;"/>`
                  : '<div style="color:#999;">이미지 없음</div>'
              }
            </div>
            <div style="flex:1;">
              <div style="font-weight:800;font-size:15px;color:#222;margin-bottom:8px;">${
                cardProductName || ""
              }</div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div style="font-weight:900;color:#ae0000;font-size:18px;">${
                  cardSale ? Number(cardSale).toLocaleString() + "원" : ""
                }</div>
                ${
                  cardOrig && Number(cardOrig) > Number(cardSale || 0)
                    ? `<div style="text-decoration:line-through;color:#999;">${Number(
                        cardOrig
                      ).toLocaleString()}원</div>`
                    : ""
                }
                ${
                  cardDiscount
                    ? `<div style="color:#ae0000;font-weight:700;">${cardDiscount}%</div>`
                    : ""
                }
              </div>
              ${
                cardBadges
                  ? `<div style="font-size:12px;color:#666;">${cardBadges}</div>`
                  : ""
              }
              <div style="margin-top:12px;"><a href="${url}" target="_blank" style="background:#007aff;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;">최저가 보러가기</a></div>
            </div>
          </div>
        `;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(cardHtml)
            .then(() => {
              showToast(
                "✅ 카드 HTML이 클립보드에 복사되었습니다. 에디터에 붙여넣으세요."
              );
            })
            .catch((err) => {
              console.error("카드 HTML 복사 실패", err);
              showToast("⚠️ 카드 HTML 복사 실패");
            });
        } else {
          // 폴백: prompt로 보여주기
          window.prompt("아래 HTML을 복사하세요:", cardHtml);
        }
      } catch (err) {
        console.error("카드 HTML 생성 오류", err);
        showToast("⚠️ 카드 HTML 생성 실패");
      }
    });

    const footerLeft = container.querySelector(
      ".affiliate-form-footer .form-footer-left"
    );
    if (footerLeft) footerLeft.appendChild(copyBtn);
  }

  // '에디터에 삽입' 버튼: 카드 HTML을 직접 워크스페이스 에디터로 전송합니다.
  const insertHtmlBtnId = "btn-insert-card-html";
  if (!container.querySelector(`#${insertHtmlBtnId}`)) {
    const insertBtn = document.createElement("button");
    insertBtn.id = insertHtmlBtnId;
    insertBtn.className = "cp-btn cp-btn-primary";
    insertBtn.style.marginLeft = "8px";
    insertBtn.textContent = "에디터에 삽입";

    insertBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        const cardProductName = container
          .querySelector("#card-product-name")
          ?.value?.trim();
        const cardImg = container
          .querySelector("#card-image-url")
          ?.value?.trim();
        const cardSale = container
          .querySelector("#card-sale-price")
          ?.value?.trim();
        const cardOrig = container
          .querySelector("#card-original-price")
          ?.value?.trim();
        const cardDiscount = container
          .querySelector("#card-discount-rate")
          ?.value?.trim();
        const cardBadges = container
          .querySelector("#card-badges")
          ?.value?.trim();
        const url = container.querySelector("#aff-url")?.value?.trim() || "";
        const insertMode =
          container.querySelector("#card-insert-mode")?.value || "card";

        // 카드 모드와 텍스트 모드 선택에 따른 패이로드
        let payloadHtml = "";
        if (insertMode === "card") {
          payloadHtml = `
            <div style="border:1px solid #eee;border-radius:12px;padding:16px;display:flex;gap:16px;max-width:640px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.06);">
              <div style="width:128px;height:128px;border-radius:8px;overflow:hidden;background:#fafbfc;border:1px solid #eee;display:flex;align-items:center;justify-content:center;">
                ${
                  cardImg
                    ? `<img src="${cardImg}" style="width:100%;height:100%;object-fit:cover;"/>`
                    : '<div style="color:#999;">이미지 없음</div>'
                }
              </div>
              <div style="flex:1;">
                <div style="font-weight:800;font-size:15px;color:#222;margin-bottom:8px;">${
                  cardProductName || ""
                }</div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                  <div style="font-weight:900;color:#ae0000;font-size:18px;">${
                    cardSale ? Number(cardSale).toLocaleString() + "원" : ""
                  }</div>
                  ${
                    cardOrig && Number(cardOrig) > Number(cardSale || 0)
                      ? `<div style="text-decoration:line-through;color:#999;">${Number(
                          cardOrig
                        ).toLocaleString()}원</div>`
                      : ""
                  }
                  ${
                    cardDiscount
                      ? `<div style="color:#ae0000;font-weight:700;">${cardDiscount}%</div>`
                      : ""
                  }
                </div>
                ${
                  cardBadges
                    ? `<div style="font-size:12px;color:#666;">${cardBadges}</div>`
                    : ""
                }
                <div style="margin-top:12px;"><a href="${url}" target="_blank" style="background:#007aff;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;">최저가 보러가기</a></div>
              </div>
            </div>
          `;
        } else {
          // 텍스트 모드: 간단한 앵커 태그 삽입
          const txtTitle =
            cardProductName ||
            container.querySelector("#aff-name")?.value?.trim() ||
            "상품 링크";
          payloadHtml = `<a href="${url}" target="_blank" rel="nofollow noopener">${txtTitle}</a>`;
        }

        // 에디터 iframe을 찾아 postMessage로 전달합니다 (워크스페이스 / quill editor prefer)
        const tryIframes = [];

        // helper: search selector in multiple root contexts and return first iframe element
        const findIframeInRoots = (sel) => {
          // 1) same root node as the container
          try {
            const rootNode = container?.getRootNode && container.getRootNode();
            if (rootNode && rootNode.querySelector) {
              const el = rootNode.querySelector(sel);
              if (el) return el;
            }
          } catch (e) {}

          // 2) If container is in panel, try the host shadow root
          try {
            const host =
              container?.closest && container.closest("#content-pilot-host");
            const hostShadow = host && host.shadowRoot;
            if (hostShadow && hostShadow.querySelector) {
              const el = hostShadow.querySelector(sel);
              if (el) return el;
            }
          } catch (e) {}

          // 3) global document fallback
          try {
            const el = document.querySelector(sel);
            if (el) return el;
          } catch (e) {}

          return null;
        };

        // prefer quill in same workspace (shadow root / host) then global
        const quillIframe = findIframeInRoots("#quill-editor-iframe");
        if (quillIframe && quillIframe.contentWindow)
          tryIframes.push(quillIframe.contentWindow);

        // TUI iframe can be in the same roots too
        const tuiIframe = findIframeInRoots("#tui-editor-iframe");
        if (tuiIframe && tuiIframe.contentWindow)
          tryIframes.push(tuiIframe.contentWindow);

        // Lastly, include all editor-like iframes in global document (avoid duplicates)
        document.querySelectorAll('iframe[id*="editor"]').forEach((f) => {
          if (f.contentWindow && !tryIframes.includes(f.contentWindow))
            tryIframes.push(f.contentWindow);
        });

        let sent = false;
        for (const win of tryIframes) {
          try {
            win.postMessage(
              { action: "insert-html", data: { html: payloadHtml } },
              "*"
            );
            sent = true;
          } catch (err) {
            console.warn("에디터 전송 실패 대상:", err);
          }
        }

        if (sent) {
          showToast(
            "✅ 에디터에 삽입 요청을 보냈습니다. (성공하면 에디터에 카드가 들어갑니다)"
          );
        } else {
          // 실패시 클립보드 복사 폴백
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(payloadHtml)
              .then(() => {
                showToast(
                  "ℹ️ 에디터가 감지되지 않았습니다. 카드 HTML을 클립보드에 복사했습니다 — 에디터에 붙여넣어 주세요."
                );
              })
              .catch(() => {
                window.prompt(
                  "에디터를 찾을 수 없습니다. 아래 HTML을 복사하세요:",
                  payloadHtml
                );
              });
          } else {
            window.prompt(
              "에디터를 찾을 수 없습니다. 아래 HTML을 복사하세요:",
              payloadHtml
            );
          }
        }
      } catch (err) {
        console.error("에디터 삽입 처리 중 오류", err);
        showToast("⚠️ 에디터 삽입에 실패했습니다.");
      }
    });

    const footerLeft2 = container.querySelector(
      ".affiliate-form-footer .form-footer-left"
    );
    if (footerLeft2) footerLeft2.appendChild(insertBtn);
  }

  // 카드 자동분석 버튼
  const parseBtn = container.querySelector("#btn-parse-card");
  if (parseBtn) {
    parseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const rawText = container.querySelector("#card-raw-text")?.value?.trim();
      if (!rawText) {
        showToast("⚠️ 먼저 텍스트를 붙여넣어 주세요.");
        return;
      }

      const parsed = parseCoupangText(rawText);
      if (!parsed) {
        showToast("⚠️ 텍스트 파싱에 실패했습니다. 수동으로 입력하세요.");
        return;
      }

      // 채워 넣기
      const setValue = (id, value) => {
        const el = container.querySelector(`#${id}`);
        if (el) el.value = value !== undefined && value !== null ? value : "";
      };

      setValue("card-product-name", parsed.productName || "");
      setValue("card-original-price", parsed.originalPrice || "");
      setValue("card-sale-price", parsed.salePrice || "");
      setValue("card-discount-rate", parsed.discountRate || "");
      setValue("card-rating", parsed.rating || "");
      setValue("card-review-count", parsed.reviewCount || "");
      setValue("card-badges", (parsed.badges || []).join(", "));
      setValue("card-image-url", parsed.imageUrl || "");
      const rocket = container.querySelector("#card-is-rocket");
      if (rocket) rocket.checked = !!parsed.isRocket;

      showToast("✅ 텍스트 분석 완료 — 카드 필드에 값이 채워졌습니다.");
    });
  }

  // 폼 상단의 X 버튼 (폼 내부 닫기)
  const formClose = container.querySelector(".affiliate-form-close");
  if (formClose) {
    formClose.addEventListener("click", (e) => {
      e.preventDefault();
      if (formContainer) formContainer.style.display = "none";
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

      // 카드형 데이터가 있을 경우 cardData 객체를 구성
      const cardProductName = container
        .querySelector("#card-product-name")
        ?.value?.trim();
      const cardImageUrl = container
        .querySelector("#card-image-url")
        ?.value?.trim();
      const cardOriginalPrice =
        parseInt(
          container.querySelector("#card-original-price")?.value || 0,
          10
        ) || 0;
      const cardSalePrice =
        parseInt(container.querySelector("#card-sale-price")?.value || 0, 10) ||
        0;
      const cardDiscountRate =
        parseInt(
          container.querySelector("#card-discount-rate")?.value || 0,
          10
        ) || 0;
      const cardRating =
        parseFloat(container.querySelector("#card-rating")?.value || 0) || 0;
      const cardReviewCount =
        parseInt(
          container.querySelector("#card-review-count")?.value || 0,
          10
        ) || 0;
      const cardBadges =
        container
          .querySelector("#card-badges")
          ?.value?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) || [];
      const cardIsRocket =
        !!container.querySelector("#card-is-rocket")?.checked;
      const cardInsertMode =
        container.querySelector("#card-insert-mode")?.value || "card";

      const cardData =
        cardProductName ||
        cardImageUrl ||
        cardSalePrice ||
        cardOriginalPrice ||
        cardRating
          ? {
              productName: cardProductName || name,
              imageUrl: cardImageUrl || "",
              originalPrice: cardOriginalPrice || 0,
              salePrice: cardSalePrice || 0,
              discountRate: cardDiscountRate || 0,
              rating: cardRating || 0,
              reviewCount: cardReviewCount || 0,
              isRocket: cardIsRocket,
              badges: cardBadges,
              insertMode: cardInsertMode,
            }
          : null;

      const payload = {
        name,
        url,
        platform,
        keywords: tempKeywords, // 배열로 저장
        cardData,
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
  // 만약 카드 필드가 채워진 경우 '카드형 미리보기'를 우선적으로 보여줍니다.
  const cardProductName = container
    .querySelector("#card-product-name")
    ?.value?.trim();
  const cardImg = container.querySelector("#card-image-url")?.value?.trim();
  const cardSale = container.querySelector("#card-sale-price")?.value?.trim();
  const cardOrig = container
    .querySelector("#card-original-price")
    ?.value?.trim();
  const cardDiscount = container
    .querySelector("#card-discount-rate")
    ?.value?.trim();

  if (cardProductName || cardImg || cardSale) {
    previewContent.innerHTML = `
      <div class="preview-link-card" style="display:flex;gap:12px;align-items:center;">
        <div style="width:80px;height:80px;border-radius:8px;overflow:hidden;background:#fafbfc;border:1px solid #eee;display:flex;align-items:center;justify-content:center;">
          ${
            cardImg
              ? `<img src="${cardImg}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`
              : '<div style="color:#999;font-size:12px;padding:6px">이미지 없음</div>'
          }
        </div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#222;margin-bottom:6px;">${
            cardProductName || name
          }</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="font-weight:800;color:#ae0000;font-size:16px;">${
              cardSale ? Number(cardSale).toLocaleString() + "원" : ""
            }</div>
            ${
              cardOrig && Number(cardOrig) > Number(cardSale || 0)
                ? `<div style="text-decoration:line-through;color:#999;font-size:13px;">${Number(
                    cardOrig
                  ).toLocaleString()}원</div>`
                : ""
            }
            ${
              cardDiscount
                ? `<div style="color:#ae0000;font-weight:700;font-size:13px;">${cardDiscount}%↓</div>`
                : ""
            }
          </div>
          <div style="font-size:12px;color:#666;">${
            tempKeywords.length > 0
              ? tempKeywords
                  .map(
                    (k) =>
                      `<span style='background:#f0f0f0;padding:3px 6px;border-radius:12px;margin-right:4px;font-size:12px;'>#${k}</span>`
                  )
                  .join("")
              : '<span class="no-keywords">키워드 없음</span>'
          }</div>
        </div>
      </div>
    `;
  } else {
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
  }

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

      // 카드형 데이터가 있으면 간단한 카드 미리보기 추가
      const cardData = link.cardData || null;
      const cardPreviewHtml = cardData
        ? `
          <div class="link-card-preview" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#fafbfc;display:flex;align-items:center;justify-content:center;border:1px solid #eee;">
              <img src="${
                cardData.imageUrl || ""
              }" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">
            </div>
            <div style="font-size:13px;color:#333;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(
              cardData.productName || ""
            ).slice(0, 60)}</div>
            <div style="font-weight:700;color:#ae0000">${
              cardData.salePrice
                ? cardData.salePrice.toLocaleString() + "원"
                : ""
            }</div>
          </div>
        `
        : "";

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
          ${cardPreviewHtml}
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

  // 카드 필드 채우기 (있으면)
  const cd = link.cardData || {};
  const setValue = (id, v) => {
    const el = container.querySelector(`#${id}`);
    if (el) el.value = v !== undefined && v !== null ? v : "";
  };

  setValue("card-product-name", cd.productName || "");
  setValue("card-image-url", cd.imageUrl || "");
  setValue("card-original-price", cd.originalPrice || "");
  setValue("card-sale-price", cd.salePrice || "");
  setValue("card-discount-rate", cd.discountRate || "");
  setValue("card-rating", cd.rating || "");
  setValue("card-review-count", cd.reviewCount || "");
  setValue("card-badges", (cd.badges || []).join(", "));
  const rocket = container.querySelector("#card-is-rocket");
  if (rocket) rocket.checked = !!cd.isRocket;
  const insertMode = container.querySelector("#card-insert-mode");
  if (insertMode) insertMode.value = cd.insertMode || "card";

  if (formTitle) formTitle.textContent = "링크 수정";
  if (formContainer) formContainer.style.display = "block";

  // 폼이 열리면 상품명 입력창에 포커스
  if (nameInput) setTimeout(() => nameInput.focus(), 100);
}
