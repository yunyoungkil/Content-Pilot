// js/ui/performanceDashboardMode.js
// 성과 대시보드 모드 UI (Updated for GSC & Advanced Metrics)

import { showToast, Logger } from "../utils.js";

let allPerformanceData = [];
let previousDayStats = null;
let isProcessingData = false;
let processDataTimeout = null;

/**
 * 성과 대시보드 렌더링
 */
export function renderPerformanceDashboard(container) {
  container.innerHTML = "";

  container.innerHTML = `
    <div class="performance-dashboard-container">
      <div class="perf-dashboard-header">
        <h2>📊 성과 대시보드</h2>
        <div class="perf-dashboard-controls">
          <select id="perf-sort-select" class="perf-control-select">
            <option value="earnings-desc">수익 높은 순</option>
            <option value="earnings-asc">수익 낮은 순</option>
            <option value="pageviews-desc">페이지뷰 높은 순</option>
            <option value="ctr-desc">구글 클릭률(CTR) 높은 순</option>
            <option value="impressions-desc">구글 노출수 높은 순</option>
            <option value="engagement-desc">참여율 높은 순</option>
            <option value="new-users-desc">신규 방문자 많은 순</option>
            <option value="recent">최근 업데이트 순</option>
          </select>
          <button id="perf-refresh-btn" class="perf-control-btn">🔄 새로고침</button>
        </div>
      </div>
      <div id="perf-dashboard-content" class="perf-dashboard-content">
        <div class="perf-loading">성과 데이터를 불러오는 중...</div>
      </div>
    </div>
  `;

  loadPerformanceData(container);
  addPerformanceDashboardEventListeners(container);
}

/**
 * Firebase에서 성과 데이터 로드
 */
function loadPerformanceData(container, retryCount = 0) {
  const MAX_RETRY_COUNT = 10;

  chrome.storage.local.get(["googleUserEmail"], (authResult) => {
    if (!authResult.googleUserEmail) {
      if (retryCount < MAX_RETRY_COUNT) {
        setTimeout(() => loadPerformanceData(container, retryCount + 1), 1000);
      } else {
        const contentEl = container.querySelector("#perf-dashboard-content");
        if (contentEl)
          contentEl.innerHTML =
            '<div class="perf-loading">로그인이 필요합니다.</div>';
      }
      return;
    }

    chrome.runtime.sendMessage({ action: "get_kanban_data" }, (response) => {
      if (response && response.success && response.data) {
        processPerformanceData(response.data || {}, container);
      } else {
        const contentEl = container.querySelector("#perf-dashboard-content");
        if (contentEl)
          contentEl.innerHTML =
            '<div class="perf-loading">데이터를 불러올 수 없습니다.</div>';
      }
    });

    // 안전 장치: 응답 지연 시 재요청
    setTimeout(() => {
      if (allPerformanceData.length === 0 && !isProcessingData) {
        chrome.runtime.sendMessage(
          { action: "get_kanban_data" },
          (response) => {
            if (response && response.success && response.data) {
              processPerformanceData(response.data || {}, container);
            }
          }
        );
      }
    }, 1500);

    if (!window.performanceDashboardListenerAttached) {
      chrome.runtime.onMessage.addListener(async (msg) => {
        if (msg.action === "kanban_data_updated") {
          const contentEl = container.querySelector("#perf-dashboard-content");
          if (!contentEl) return false;
          await processPerformanceData(msg.data || {}, container);
        }
        return false;
      });
      window.performanceDashboardListenerAttached = true;
    }
  });
}

/**
 * 성과 데이터 처리
 */
async function processPerformanceData(allCards, container) {
  if (isProcessingData) return;
  if (processDataTimeout) clearTimeout(processDataTimeout);

  processDataTimeout = setTimeout(async () => {
    isProcessingData = true;
    try {
      allPerformanceData = [];
      const { activeChannelId } = await chrome.storage.local.get(
        "activeChannelId"
      );
      const seenCardIds = new Set();

      for (const status in allCards) {
        if (status !== "done") continue;

        for (const cardId in allCards[status]) {
          const card = allCards[status][cardId];
          if (seenCardIds.has(cardId)) continue;

          // 채널 필터링
          if (
            activeChannelId &&
            card.channelId &&
            card.channelId !== activeChannelId
          ) {
            try {
              const cardUrl = atob(card.channelId.replace(/=/g, ""));
              const activeUrl = atob(activeChannelId.replace(/=/g, ""));
              if (new URL(cardUrl).origin !== new URL(activeUrl).origin)
                continue;
            } catch (e) {
              continue;
            }
          }

          if (
            card.publishedUrl &&
            card.performance &&
            !card.performance.error
          ) {
            allPerformanceData.push({
              id: cardId,
              status: status,
              title: card.title || "제목 없음",
              publishedUrl: card.publishedUrl,
              performance: card.performance,
              createdAt: card.createdAt || 0,
              lastUpdatedAt: card.performance.lastUpdatedAt || 0,
            });
            seenCardIds.add(cardId);
          }
        }
      }
      renderPerformanceList(container);
    } finally {
      isProcessingData = false;
      processDataTimeout = null;
    }
  }, 300);
}

/**
 * 성과 목록 렌더링
 */
function renderPerformanceList(container, sortBy = "earnings-desc") {
  const contentEl = container.querySelector("#perf-dashboard-content");
  let scrollPosition = contentEl ? contentEl.scrollTop : 0;

  if (contentEl) contentEl.innerHTML = "";

  if (allPerformanceData.length === 0) {
    contentEl.innerHTML = `
      <div class="perf-empty-state">
        <div class="perf-empty-icon">📊</div>
        <h3>성과 데이터가 없습니다</h3>
        <p>발행된 콘텐츠에 성과 추적을 연결하면 여기에 표시됩니다.</p>
      </div>
    `;
    return;
  }

  // 정렬 로직
  const sortedData = [...allPerformanceData].sort((a, b) => {
    const pA = a.performance;
    const pB = b.performance;
    const getPv = (p) => p.pageviews || p.pageViews || 0;

    switch (sortBy) {
      case "earnings-desc":
        return (pB.estimatedEarnings || 0) - (pA.estimatedEarnings || 0);
      case "earnings-asc":
        return (pA.estimatedEarnings || 0) - (pB.estimatedEarnings || 0);
      case "pageviews-desc":
        return getPv(pB) - getPv(pA);
      case "ctr-desc":
        return (pB.pageCTR || 0) - (pA.pageCTR || 0);
      case "impressions-desc":
        return (pB.pageImpressions || 0) - (pA.pageImpressions || 0);
      case "engagement-desc":
        return (pB.engagementRate || 0) - (pA.engagementRate || 0);
      case "new-users-desc":
        return (pB.newUsers || 0) - (pA.newUsers || 0);
      case "recent":
        return (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0);
      default:
        return 0;
    }
  });

  // 통계 계산
  const totalEarnings = sortedData.reduce(
    (sum, item) => sum + (item.performance.estimatedEarnings || 0),
    0
  );
  const totalPageviews = sortedData.reduce(
    (sum, item) =>
      sum + (item.performance.pageviews || item.performance.pageViews || 0),
    0
  );
  const totalImpressions = sortedData.reduce(
    (sum, item) => sum + (item.performance.pageImpressions || 0),
    0
  );

  // 성장률 (간소화)
  const growthRates = calculateGrowthRates(
    totalEarnings,
    totalPageviews,
    totalImpressions,
    sortedData.length
  );

  contentEl.innerHTML = `
    <div class="perf-stats-summary">
      <div class="perf-stat-card">
        <div class="stat-label">총 수익 ${growthRates.earnings.arrow}</div>
        <div class="stat-value">$${totalEarnings.toFixed(2)}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">총 페이지뷰 ${growthRates.pageviews.arrow}</div>
        <div class="stat-value">${totalPageviews.toLocaleString()}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">구글 총 노출</div>
        <div class="stat-value">${totalImpressions.toLocaleString()}</div>
      </div>
    </div>
    <div class="perf-list-container">
      ${sortedData
        .map((item, index) => createPerformanceCard(item, index))
        .join("")}
    </div>
  `;

  if (scrollPosition > 0)
    requestAnimationFrame(() => (contentEl.scrollTop = scrollPosition));
}

/**
 * 성과 카드 생성 (UI 핵심 로직 수정됨)
 */
function createPerformanceCard(item, index) {
  const perf = item.performance;

  const earnings = perf.estimatedEarnings || perf.gaEarnings || 0;
  const pageviews = perf.pageviews || perf.pageViews || 0;
  const engagementRate = (perf.engagementRate || 0) * 100;
  const avgEngagementTime = Math.round(
    perf.avgEngagementTime || perf.avgSessionDuration || 0
  );

  // [신규] GSC 지표
  const ctr = perf.pageCTR ? (perf.pageCTR * 100).toFixed(1) : "0.0";
  const impressions = perf.pageImpressions
    ? perf.pageImpressions.toLocaleString()
    : "0";
  const position = perf.avgPosition ? perf.avgPosition.toFixed(1) : "-";

  // [신규] 재방문율
  const returningRatio = perf.returningUsersRatio
    ? (perf.returningUsersRatio * 100).toFixed(0)
    : 0;

  // 수집 상태
  const isCollecting = perf.collecting === true;
  const collectingBadge = isCollecting
    ? '<span class="collecting-badge" style="background: #FFA500; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">🔄 수집 중</span>'
    : "";

  // 소스 아이콘 (GA4 sessionSource 기준)
  let sourceIcon = "🌐";
  const source = (perf.topSource || "direct").toLowerCase();
  if (source.includes("google")) sourceIcon = "🇬 Google";
  else if (source.includes("naver")) sourceIcon = "🇳 Naver";
  else if (source.includes("kakao")) sourceIcon = "🇰 Kakao";
  else if (source.includes("bing")) sourceIcon = "🇧 Bing";
  else if (source.includes("direct")) sourceIcon = "🔗 Direct";

  return `
    <div class="perf-card" data-card-id="${item.id}" style="${
    isCollecting ? "border-color: #FFA500;" : ""
  }">
      <div class="perf-card-rank">#${index + 1}</div>
      <div class="perf-card-content">
        <div class="perf-card-header">
          <h3 class="perf-card-title">${item.title}</h3>
          <div class="perf-card-meta-badges">
            ${collectingBadge}
            <span class="source-badge" title="주 유입 경로">${sourceIcon}</span>
            <span class="source-badge" title="재방문율 (충성도)">🔄 재방문 ${returningRatio}%</span>
            <a href="${
              item.publishedUrl
            }" target="_blank" class="perf-card-link">🔗</a>
          </div>
        </div>

        <div class="perf-card-metrics primary">
          <div class="perf-metric-item highlight">
            <span class="metric-icon">💰</span>
            <span class="metric-label">수익</span>
            <span class="metric-value">$${earnings.toFixed(2)}</span>
          </div>
          <div class="perf-metric-item">
            <span class="metric-icon">👁️</span>
            <span class="metric-label">페이지뷰</span>
            <span class="metric-value">${pageviews.toLocaleString()}</span>
          </div>
          <div class="perf-metric-item">
            <span class="metric-icon">❤️</span>
            <span class="metric-label">참여율</span>
            <span class="metric-value">${engagementRate.toFixed(1)}%</span>
          </div>
        </div>

        <div class="perf-card-metrics secondary" style="background: #f8f9fa; border-radius: 6px; padding: 8px; margin-top: 8px;">
           <div class="perf-metric-item compact" title="구글 노출수">
            <span class="metric-icon">👀</span>
            <span class="metric-label" style="font-size:11px;">노출</span>
            <span class="metric-value">${impressions}</span>
          </div>
          <div class="perf-metric-item compact" title="클릭률 (CTR)">
            <span class="metric-icon">👆</span>
            <span class="metric-label" style="font-size:11px;">클릭률</span>
            <span class="metric-value">${ctr}%</span>
          </div>
          <div class="perf-metric-item compact" title="평균 게재 순위">
            <span class="metric-icon">🥇</span>
            <span class="metric-label" style="font-size:11px;">순위</span>
            <span class="metric-value">${position}위</span>
          </div>
          <div class="perf-metric-item compact" title="평균 체류 시간">
            <span class="metric-icon">⏱️</span>
            <span class="metric-label" style="font-size:11px;">체류</span>
            <span class="metric-value">${avgEngagementTime}초</span>
          </div>
        </div>

        ${hasDetails(perf) ? renderDetails(perf) : ""}

        <div class="perf-card-footer">
          <span class="perf-updated-time">업데이트: ${new Date(
            item.lastUpdatedAt
          ).toLocaleString("ko-KR")}</span>
        </div>
      </div>
    </div>
  `;
}

// 상세 정보 존재 여부 확인
function hasDetails(perf) {
  return (
    (perf.deviceBreakdown &&
      (perf.deviceBreakdown.mobile?.users > 0 ||
        perf.deviceBreakdown.desktop?.users > 0)) ||
    (perf.topSearchTerms && perf.topSearchTerms.length > 0)
  );
}

// 상세 정보 렌더링 (검색어, 기기 등)
function renderDetails(perf) {
  return `
    <div class="perf-card-details" style="margin-top:12px; padding-top:12px; border-top:1px solid #e0e0e0;">

      ${
        perf.deviceBreakdown
          ? `
        <div class="perf-detail-section">
          <div class="perf-detail-title">📱 기기 분포</div>
          <div class="perf-detail-content">
            ${["mobile", "desktop", "tablet"]
              .map((device) => {
                const data = perf.deviceBreakdown[device];
                if (!data || data.users === 0) return "";
                const icon =
                  device === "mobile"
                    ? "📱"
                    : device === "desktop"
                    ? "💻"
                    : "📟";
                return `<span class="perf-detail-badge">${icon} ${
                  data.users
                }명 ($${data.revenue.toFixed(2)})</span>`;
              })
              .join("")}
          </div>
        </div>
      `
          : ""
      }

      ${
        perf.topSearchTerms && perf.topSearchTerms.length > 0
          ? `
        <div class="perf-detail-section" style="margin-top:8px;">
          <div class="perf-detail-title">🔍 유입 검색어 (Top 5)</div>
          <div class="perf-detail-content">
            ${perf.topSearchTerms
              .map(
                (term) => `
              <span class="perf-detail-badge" title="클릭 ${term.clicks}회 / CTR ${term.ctr}% / ${term.position}위">
                ${term.term} <small style="opacity:0.8;">(${term.clicks}클릭)</small>
              </span>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function calculateGrowthRates(
  currentEarnings,
  currentPageviews,
  currentImpressions,
  count
) {
  // 간단한 성장률 로직 (localStorage 비교 생략하고 현재 값만 리턴)
  return {
    earnings: { arrow: "", percent: 0 },
    pageviews: { arrow: "", percent: 0 },
  };
}

function addPerformanceDashboardEventListeners(container) {
  const sortSelect = container.querySelector("#perf-sort-select");
  const refreshBtn = container.querySelector("#perf-refresh-btn");

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) =>
      renderPerformanceList(container, e.target.value)
    );
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "🔄 요청 중...";
      showToast("데이터 수집을 요청했습니다.");

      try {
        await chrome.runtime.sendMessage({
          action: "trigger_performance_refresh",
        });
      } catch (e) {
        console.error(e);
      }

      setTimeout(() => {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "🔄 새로고침";
      }, 3000);
    });
  }
}
