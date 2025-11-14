// js/ui/performanceDashboardMode.js
// 성과 대시보드 모드 UI

import { showToast } from "../utils.js";

let allPerformanceData = [];

/**
 * 성과 대시보드 렌더링
 */
export function renderPerformanceDashboard(container) {
  container.innerHTML = `
    <div class="performance-dashboard-container">
      <div class="perf-dashboard-header">
        <h2>📊 성과 대시보드</h2>
        <div class="perf-dashboard-controls">
          <select id="perf-sort-select" class="perf-control-select">
            <option value="earnings-desc">수익 높은 순</option>
            <option value="earnings-asc">수익 낮은 순</option>
            <option value="pageviews-desc">페이지뷰 높은 순</option>
            <option value="pageviews-asc">페이지뷰 낮은 순</option>
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
function loadPerformanceData(container) {
  const firebase = window.firebase;
  if (!firebase) {
    container.querySelector("#perf-dashboard-content").innerHTML = 
      "<div class='perf-error'>Firebase가 초기화되지 않았습니다.</div>";
    return;
  }

  const kanbanRef = firebase.database().ref("kanban");
  kanbanRef.once("value", (snapshot) => {
    const allCards = snapshot.val() || {};
    allPerformanceData = [];

    // 모든 상태의 카드에서 성과 데이터가 있는 것만 추출
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        if (card.publishedUrl && card.performance && !card.performance.error) {
          allPerformanceData.push({
            id: cardId,
            status: status,
            title: card.title || "제목 없음",
            publishedUrl: card.publishedUrl,
            performance: card.performance,
            createdAt: card.createdAt || 0,
            lastUpdatedAt: card.performance.lastUpdatedAt || 0,
          });
        }
      }
    }

    renderPerformanceList(container);
  });
}

/**
 * 성과 목록 렌더링
 */
function renderPerformanceList(container, sortBy = "earnings-desc") {
  const contentEl = container.querySelector("#perf-dashboard-content");
  
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

  // 정렬
  const sortedData = [...allPerformanceData].sort((a, b) => {
    switch (sortBy) {
      case "earnings-desc":
        return (b.performance.estimatedEarnings || 0) - (a.performance.estimatedEarnings || 0);
      case "earnings-asc":
        return (a.performance.estimatedEarnings || 0) - (b.performance.estimatedEarnings || 0);
      case "pageviews-desc":
        return (b.performance.pageviews || 0) - (a.performance.pageviews || 0);
      case "pageviews-asc":
        return (a.performance.pageviews || 0) - (b.performance.pageviews || 0);
      case "recent":
        return (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0);
      default:
        return 0;
    }
  });

  // 통계 계산
  const totalEarnings = sortedData.reduce((sum, item) => sum + (item.performance.estimatedEarnings || 0), 0);
  const totalPageviews = sortedData.reduce((sum, item) => sum + (item.performance.pageviews || 0), 0);
  const totalSessions = sortedData.reduce((sum, item) => sum + (item.performance.sessions || 0), 0);

  contentEl.innerHTML = `
    <div class="perf-stats-summary">
      <div class="perf-stat-card">
        <div class="stat-label">총 수익</div>
        <div class="stat-value">$${totalEarnings.toFixed(2)}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">총 페이지뷰</div>
        <div class="stat-value">${totalPageviews.toLocaleString()}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">총 세션</div>
        <div class="stat-value">${totalSessions.toLocaleString()}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">발행 콘텐츠</div>
        <div class="stat-value">${sortedData.length}개</div>
      </div>
    </div>
    <div class="perf-list-container">
      ${sortedData.map((item, index) => createPerformanceCard(item, index)).join("")}
    </div>
  `;
}

/**
 * 성과 카드 생성
 */
function createPerformanceCard(item, index) {
  const perf = item.performance;
  const earnings = perf.estimatedEarnings || 0;
  const pageviews = perf.pageviews || 0;
  const sessions = perf.sessions || 0;
  const avgDuration = perf.avgSessionDuration || 0;
  const ctr = perf.ctr || 0;

  return `
    <div class="perf-card" data-card-id="${item.id}">
      <div class="perf-card-rank">#${index + 1}</div>
      <div class="perf-card-content">
        <div class="perf-card-header">
          <h3 class="perf-card-title">${item.title}</h3>
          <a href="${item.publishedUrl}" target="_blank" class="perf-card-link">🔗</a>
        </div>
        <div class="perf-card-metrics">
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
            <span class="metric-icon">👥</span>
            <span class="metric-label">세션</span>
            <span class="metric-value">${sessions.toLocaleString()}</span>
          </div>
          <div class="perf-metric-item">
            <span class="metric-icon">⏱️</span>
            <span class="metric-label">체류 시간</span>
            <span class="metric-value">${Math.round(avgDuration)}초</span>
          </div>
          ${ctr > 0 ? `
            <div class="perf-metric-item">
              <span class="metric-icon">🎯</span>
              <span class="metric-label">CTR</span>
              <span class="metric-value">${ctr.toFixed(2)}%</span>
            </div>
          ` : ''}
        </div>
        ${perf.lastUpdatedAt ? `
          <div class="perf-card-footer">
            <span class="perf-updated-time">업데이트: ${new Date(perf.lastUpdatedAt).toLocaleString('ko-KR')}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * 이벤트 리스너 추가
 */
function addPerformanceDashboardEventListeners(container) {
  const sortSelect = container.querySelector("#perf-sort-select");
  const refreshBtn = container.querySelector("#perf-refresh-btn");

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      renderPerformanceList(container, e.target.value);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      showToast("성과 데이터를 새로고침합니다...");
      loadPerformanceData(container);
    });
  }
}

