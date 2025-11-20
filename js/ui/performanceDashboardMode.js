// js/ui/performanceDashboardMode.js
// 성과 대시보드 모드 UI

import { showToast } from "../utils.js";

let allPerformanceData = [];

/**
 * 성과 대시보드 렌더링
 */
export function renderPerformanceDashboard(container) {
  // [체크리스트 6-1] 완전 초기화: 이전 채널의 모든 데이터 제거
  container.innerHTML = '';
  
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
            <option value="rpm-desc">RPM 높은 순 (알짜배기)</option>
            <option value="ctr-desc">CTR 높은 순 (클릭률)</option>
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
function loadPerformanceData(container) {
  // Firebase가 있으면 직접 접근, 없으면 background.js를 통해 데이터 가져오기
  const firebase = window.firebase;
  
  if (firebase) {
    // Firebase 직접 접근
    const kanbanRef = firebase.database().ref("kanban");
    kanbanRef.once("value", async (snapshot) => {
      await processPerformanceData(snapshot.val() || {}, container);
    });
  } else {
    // background.js를 통해 데이터 가져오기
    chrome.runtime.sendMessage({ action: "get_kanban_data" });
    
    // 실시간 업데이트 리스너 등록 (한 번만)
    if (!window.performanceDashboardListenerAttached) {
      chrome.runtime.onMessage.addListener(async (msg) => {
        if (msg.action === "kanban_data_updated") {
          const contentEl = container.querySelector("#perf-dashboard-content");
          if (contentEl) {
            await processPerformanceData(msg.data || {}, container);
          }
        }
      });
      window.performanceDashboardListenerAttached = true;
    }
  }
}

/**
 * 성과 데이터 처리
 */
async function processPerformanceData(allCards, container) {
  allPerformanceData = [];

  // [신규] 현재 활성 채널 ID 가져오기
  const { activeChannelId } = await chrome.storage.local.get("activeChannelId");

  // [체크리스트 5-1] Firebase 데이터 로드 확인
  console.log("[5단계: UI 로드] Firebase 데이터 로드", {
    allCards: allCards,
    statusCount: Object.keys(allCards).length,
    activeChannelId: activeChannelId
  });

  // 모든 상태의 카드에서 성과 데이터가 있는 것만 추출
  for (const status in allCards) {
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];
      
      // [체크리스트 5-2] 데이터 필터링 확인
      const hasPerformance = !!card.performance;
      const hasError = card.performance?.error;
      const channelMatch = !activeChannelId || card.channelId === activeChannelId;
      const hasPublishedUrl = !!card.publishedUrl;
      
      if (!hasPerformance || hasError || !hasPublishedUrl || !channelMatch) {
        console.log("[5단계: UI 로드] 데이터 필터링", {
          cardId: cardId,
          title: card.title,
          hasPerformance: hasPerformance,
          hasError: hasError,
          channelMatch: channelMatch,
          hasPublishedUrl: hasPublishedUrl,
          filtered: true,
          reason: !hasPerformance ? "performance 없음" : 
                  hasError ? "error 있음" : 
                  !hasPublishedUrl ? "publishedUrl 없음" : 
                  !channelMatch ? "channelId 불일치" : "기타"
        });
      }
      
      // [신규] 채널 필터링: 현재 활성 채널과 일치하는 카드만 포함
      if (activeChannelId && card.channelId !== activeChannelId) {
        // channelId가 undefined인 구버전 데이터는 일단 포함 (호환성)
        if (card.channelId !== undefined) {
          continue;
        }
      }
      
      if (card.publishedUrl && card.performance && !card.performance.error) {
        // [체크리스트 5-3] UI 렌더링 확인
        console.log("[5단계: UI 로드] UI 렌더링 데이터", {
          cardId: cardId,
          title: card.title,
          performance: {
            estimatedEarnings: card.performance.estimatedEarnings,
            pageviews: card.performance.pageviews,
            engagementRate: card.performance.engagementRate,
            newUsers: card.performance.newUsers,
            avgEngagementTime: card.performance.avgEngagementTime,
            pageRPM: card.performance.pageRPM
          }
        });
        
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

  console.log("[5단계: UI 로드] 최종 필터링 결과", {
    totalCards: allPerformanceData.length,
    cards: allPerformanceData.map(c => ({
      id: c.id,
      title: c.title,
      earnings: c.performance.estimatedEarnings,
      pageviews: c.performance.pageviews
    }))
  });

  renderPerformanceList(container);
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
    const rpmA = a.performance.pageRPM || a.performance.rpm || 0;
    const rpmB = b.performance.pageRPM || b.performance.rpm || 0;
    const ctrA = a.performance.pageCTR || a.performance.ctr || 0;
    const ctrB = b.performance.pageCTR || b.performance.ctr || 0;
    const engagementA = (a.performance.engagementRate || 0) * 100;
    const engagementB = (b.performance.engagementRate || 0) * 100;
    const newUsersA = a.performance.newUsers || 0;
    const newUsersB = b.performance.newUsers || 0;
    
    // [수정 요청 2] 페이지뷰 참조 로직 수정: pageviews와 pageViews 둘 다 체크
    const getPageviews = (perf) => {
      return perf.pageviews || perf.pageViews || 0; // AdSense는 pageViews (대문자 V)
    };
    const pageviewsA = getPageviews(a.performance);
    const pageviewsB = getPageviews(b.performance);

    switch (sortBy) {
      case "earnings-desc":
        return (b.performance.estimatedEarnings || 0) - (a.performance.estimatedEarnings || 0);
      case "earnings-asc":
        return (a.performance.estimatedEarnings || 0) - (b.performance.estimatedEarnings || 0);
      case "pageviews-desc":
        return pageviewsB - pageviewsA;
      case "pageviews-asc":
        return pageviewsA - pageviewsB;
      case "rpm-desc": // [추가]
        return rpmB - rpmA;
      case "ctr-desc": // [추가]
        return ctrB - ctrA;
      case "engagement-desc":
        return engagementB - engagementA;
      case "new-users-desc":
        return newUsersB - newUsersA;
      case "recent":
        return (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0);
      default:
        return 0;
    }
  });

  // [수정 요청 2] 페이지뷰 참조 로직 수정: pageviews와 pageViews 둘 다 체크
  const getPageviews = (perf) => perf.pageviews || perf.pageViews || 0;
  
  // 통계 계산
  const totalEarnings = sortedData.reduce((sum, item) => sum + (item.performance.estimatedEarnings || 0), 0);
  const totalPageviews = sortedData.reduce((sum, item) => sum + getPageviews(item.performance), 0);
  const totalSessions = sortedData.reduce((sum, item) => sum + (item.performance.sessions || 0), 0);
  const avgEarnings = sortedData.length > 0 ? totalEarnings / sortedData.length : 0;
  const avgPageviews = sortedData.length > 0 ? totalPageviews / sortedData.length : 0;

  // 상위 5개 콘텐츠 추출 (차트용)
  const top5ForChart = sortedData.slice(0, 5);
  const maxEarnings = Math.max(...sortedData.map(item => item.performance.estimatedEarnings || 0), 1);
  const maxPageviews = Math.max(...sortedData.map(item => getPageviews(item.performance)), 1);

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
    ${sortedData.length > 0 ? `
      <div class="perf-charts-section">
        <div class="perf-chart-container">
          <h3 class="perf-chart-title">💰 상위 5개 콘텐츠 수익 비교</h3>
          <div class="perf-bar-chart earnings-chart">
            ${top5ForChart.map((item, idx) => {
              const earnings = item.performance.estimatedEarnings || 0;
              const percentage = maxEarnings > 0 ? (earnings / maxEarnings) * 100 : 0;
              const shortTitle = item.title.length > 20 ? item.title.substring(0, 20) + '...' : item.title;
              return `
                <div class="chart-bar-item">
                  <div class="chart-bar-label">${shortTitle}</div>
                  <div class="chart-bar-wrapper">
                    <div class="chart-bar earnings-bar" style="width: ${percentage}%">
                      <span class="chart-bar-value">$${earnings.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div class="perf-chart-container">
          <h3 class="perf-chart-title">👁️ 상위 5개 콘텐츠 페이지뷰 비교</h3>
          <div class="perf-bar-chart pageviews-chart">
            ${top5ForChart.map((item, idx) => {
              // [수정 요청 2] 페이지뷰 참조 로직 수정: pageviews와 pageViews 둘 다 체크
              const pageviews = item.performance.pageviews || item.performance.pageViews || 0;
              const percentage = maxPageviews > 0 ? (pageviews / maxPageviews) * 100 : 0;
              const shortTitle = item.title.length > 20 ? item.title.substring(0, 20) + '...' : item.title;
              return `
                <div class="chart-bar-item">
                  <div class="chart-bar-label">${shortTitle}</div>
                  <div class="chart-bar-wrapper">
                    <div class="chart-bar pageviews-bar" style="width: ${percentage}%">
                      <span class="chart-bar-value">${pageviews.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    ` : ''}
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
  // [수정 요청 2] 카드 생성 함수 수정: pageviews와 pageViews 둘 다 체크 (Fallback 로직)
  const pageviews = perf.pageviews || perf.pageViews || 0; // AdSense는 pageViews (대문자 V)
  const engagementRate = (perf.engagementRate || 0) * 100; // % 변환
  const newUsers = perf.newUsers || 0;
  const topSource = perf.topSource || "-";
  const avgEngagementTime = Math.round(perf.avgEngagementTime || perf.avgSessionDuration || 0);
  
  // [체크리스트 1-3] 수집 상태 시각화: collecting이 true일 때 배지 및 테두리 표시
  const isCollecting = perf.collecting === true;
  const collectingBadge = isCollecting 
    ? '<span class="collecting-badge" style="background: #FFA500; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🔄 수집 중</span>'
    : '';
  const cardBorderStyle = isCollecting 
    ? 'border: 2px solid #FFA500; box-shadow: 0 0 8px rgba(255, 165, 0, 0.3);'
    : '';
  
  // 소스 아이콘 처리
  let sourceIcon = "🌐";
  if (topSource.includes("google")) sourceIcon = "🇬";
  else if (topSource.includes("naver")) sourceIcon = "🇳";
  else if (topSource.includes("kakao")) sourceIcon = "🇰";
  else if (topSource.includes("direct")) sourceIcon = "🔗";

  return `
    <div class="perf-card" data-card-id="${item.id}" style="${cardBorderStyle}">
      <div class="perf-card-rank">#${index + 1}</div>
      <div class="perf-card-content">
        <div class="perf-card-header">
          <h3 class="perf-card-title">${item.title}</h3>
          <div style="display:flex; align-items:center; gap:8px;">
            ${collectingBadge}
            <span class="source-badge" title="주력 유입 경로: ${topSource}">${sourceIcon} ${topSource.split('/')[0]}</span>
            <a href="${item.publishedUrl}" target="_blank" class="perf-card-link">🔗</a>
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

        <div class="perf-card-metrics secondary" style="margin-top:8px; padding-top:8px; border-top:1px dashed #eee;">
           <div class="perf-metric-item compact" title="신규 방문자">
            <span class="metric-icon">🆕</span>
            <span class="metric-value">${newUsers.toLocaleString()}명</span>
          </div>
          <div class="perf-metric-item compact" title="평균 참여 시간">
            <span class="metric-icon">⏱️</span>
            <span class="metric-value">${avgEngagementTime}초</span>
          </div>
          <div class="perf-metric-item compact" title="RPM (1,000회 노출당 수익)">
            <span class="metric-icon">📈</span>
            <span class="metric-value">$${(perf.pageRPM || 0).toFixed(2)}</span>
          </div>
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
    refreshBtn.addEventListener("click", async () => {
      // [체크리스트 1-1] 새로고침 버튼 리스너 수정: 백그라운드에 명시적 데이터 수집 요청
      showToast("데이터 수집을 시작합니다...");
      
      // [체크리스트 1-2] 로딩 UI 피드백: 버튼 비활성화 및 로딩 표시
      refreshBtn.disabled = true;
      const originalText = refreshBtn.textContent;
      refreshBtn.textContent = "🔄 수집 중...";
      
      try {
        // 백그라운드에 데이터 수집 요청
        await chrome.runtime.sendMessage({ action: "trigger_performance_refresh" });
        
        // 데이터는 Firebase 리스너를 통해 자동으로 업데이트됨
        // UI는 kanban_data_updated 메시지를 받아 자동 갱신
      } catch (error) {
        console.error("[Performance Dashboard] 새로고침 요청 실패:", error);
        showToast("❌ 데이터 수집 요청에 실패했습니다.");
      } finally {
        // 버튼 상태 복원 (3초 후)
        setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.textContent = originalText;
        }, 3000);
      }
    });
  }

  // [신규] 채널 변경 감지 -> 성과 대시보드 새로고침
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.activeChannelId) {
      console.log("[Performance Dashboard] 채널 변경 감지, 데이터 다시 로드");
      loadPerformanceData(container);
    }
  });
}

