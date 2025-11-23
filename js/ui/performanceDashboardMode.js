// js/ui/performanceDashboardMode.js
// 성과 대시보드 모드 UI

import { showToast, Logger } from "../utils.js";

let allPerformanceData = [];
let previousDayStats = null; // 전일 통계 저장

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
    const userId = 'default_user'; // CONSTANTS.USER_ID와 동일
    const kanbanRef = firebase.database().ref(`kanban/${userId}`);
    kanbanRef.once("value", async (snapshot) => {
      const allCards = snapshot.val() || {};
      
      await processPerformanceData(allCards, container);
    });
    
    // [수정] Firebase 직접 접근 시에도 실시간 리스너 등록 (한 번만)
    if (!window.performanceDashboardListenerAttached) {
      kanbanRef.on("value", async (snapshot) => {
        const allCards = snapshot.val() || {};
        await processPerformanceData(allCards, container);
      });
      window.performanceDashboardListenerAttached = true;
    }
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

  // 중복 방지를 위한 Set (cardId 기준)
  const seenCardIds = new Set();

  // 모든 상태의 카드에서 성과 데이터가 있는 것만 추출
  for (const status in allCards) {
    // [수정] done status만 포함하도록 필터링 (성과 대시보드는 발행 완료된 카드만 표시)
    if (status !== 'done') {
      continue;
    }
    
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];
      
      // [수정] 중복 카드 제거 (같은 cardId가 여러 status에 있을 수 있음)
      if (seenCardIds.has(cardId)) {
        Logger.warn(`[Performance Dashboard] 중복 카드 발견 (건너뜀): ${cardId}, status: ${status}`);
        continue;
      }
      
      // [체크리스트 5-2] 데이터 필터링 확인
      const hasPerformance = !!card.performance;
      const hasError = card.performance?.error;
      const channelMatch = !activeChannelId || card.channelId === activeChannelId;
      const hasPublishedUrl = !!card.publishedUrl;
      
      
      // [신규] 채널 필터링: 현재 활성 채널과 일치하는 카드만 포함
      if (activeChannelId && card.channelId !== activeChannelId) {
        // channelId가 undefined인 구버전 데이터는 일단 포함 (호환성)
        if (card.channelId !== undefined) {
          continue;
        }
      }
      
      if (card.publishedUrl && card.performance && !card.performance.error) {
        // [체크리스트 5-3] UI 렌더링 확인
        // 추가 메트릭 데이터 확인
        const hasAdditionalMetrics = !!(card.performance.deviceBreakdown || 
                                        card.performance.topCountries || 
                                        card.performance.landingPages || 
                                        card.performance.events);
        
        // [수정] title이 없는 카드에 대한 경고
        if (!card.title || card.title.trim() === '') {
          Logger.warn(`[Performance Dashboard] 제목 없는 카드 발견: ${cardId}, status: ${status}`);
        }
        
        const pushedData = {
          id: cardId,
          status: status,
          title: card.title || "제목 없음",
          publishedUrl: card.publishedUrl,
          performance: card.performance,
          createdAt: card.createdAt || 0,
          lastUpdatedAt: card.performance.lastUpdatedAt || 0,
        };
        
        allPerformanceData.push(pushedData);
        seenCardIds.add(cardId); // 중복 방지
      }
    }
  }

  // [디버깅] 실제 done status의 카드 수 확인
  const doneCardsCount = allCards.done ? Object.keys(allCards.done).length : 0;
  Logger.debug(`[Performance Dashboard] 디버깅 정보:`);
  Logger.debug(`  - done status 실제 카드 수: ${doneCardsCount}개`);
  Logger.debug(`  - 성과 데이터 필터링 후: ${allPerformanceData.length}개`);
  Logger.debug(`  - 카드 목록:`, allPerformanceData.map(item => ({ id: item.id, title: item.title, status: item.status })));
  
  if (doneCardsCount !== allPerformanceData.length) {
    Logger.warn(`[Performance Dashboard] ⚠️ 불일치 발견! done에 ${doneCardsCount}개가 있지만 ${allPerformanceData.length}개가 표시됩니다.`);
    
    // done의 모든 카드 확인
    if (allCards.done) {
      Logger.debug(`  - done status의 모든 카드:`, Object.keys(allCards.done).map(cardId => {
        const card = allCards.done[cardId];
        return {
          id: cardId,
          title: card.title || "제목 없음",
          hasPublishedUrl: !!card.publishedUrl,
          hasPerformance: !!card.performance,
          hasError: !!card.performance?.error
        };
      }));
    }
  }

  renderPerformanceList(container);
}

/**
 * 성과 목록 렌더링
 */
function renderPerformanceList(container, sortBy = "earnings-desc") {
  const contentEl = container.querySelector("#perf-dashboard-content");
  
  // [수정] 이전 내용 완전히 제거 (중복 방지)
  if (contentEl) {
    contentEl.innerHTML = '';
  }
  
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
  
  // 오늘 발행된 콘텐츠 수 계산 (목표 달성 체크용)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPublishedCount = sortedData.filter(item => {
    const publishedDate = item.createdAt ? new Date(item.createdAt) : null;
    if (!publishedDate) return false;
    publishedDate.setHours(0, 0, 0, 0);
    return publishedDate.getTime() === today.getTime();
  }).length;
  
  // 전일 대비 성장률 계산
  const growthRates = calculateGrowthRates(totalEarnings, totalPageviews, totalSessions, sortedData.length);
  
  // 목표 달성 체크 (일일 글 작성 목표: 1일 1포)
  const dailyGoal = 1; // 기본 목표: 1일 1포
  const goalAchieved = todayPublishedCount >= dailyGoal;
  
  // 목표 달성 시 축하 애니메이션
  if (goalAchieved && !window.goalAchievedToday) {
    window.goalAchievedToday = true;
    setTimeout(() => {
      triggerConfettiAnimation();
      showToast(`🎉 축하합니다! 오늘 ${todayPublishedCount}개의 콘텐츠를 발행했습니다!`, 5000);
    }, 500);
  }
  
  // 전일 통계 저장 (다음 렌더링 시 비교용)
  previousDayStats = {
    earnings: totalEarnings,
    pageviews: totalPageviews,
    sessions: totalSessions,
    contentCount: sortedData.length,
    timestamp: Date.now()
  };

  // 상위 5개 콘텐츠 추출 (차트용)
  const top5ForChart = sortedData.slice(0, 5);
  const maxEarnings = Math.max(...sortedData.map(item => item.performance.estimatedEarnings || 0), 1);
  const maxPageviews = Math.max(...sortedData.map(item => getPageviews(item.performance)), 1);

  contentEl.innerHTML = `
    <div class="perf-stats-summary">
      <div class="perf-stat-card">
        <div class="stat-label">총 수익 ${growthRates.earnings.arrow} ${growthRates.earnings.percent !== null ? `<span class="growth-rate ${growthRates.earnings.isPositive ? 'positive' : 'negative'}">${growthRates.earnings.percent}%</span>` : ''}</div>
        <div class="stat-value ${growthRates.earnings.isPositive ? 'growth-positive' : ''}">$${totalEarnings.toFixed(2)}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">총 페이지뷰 ${growthRates.pageviews.arrow} ${growthRates.pageviews.percent !== null ? `<span class="growth-rate ${growthRates.pageviews.isPositive ? 'positive' : 'negative'}">${growthRates.pageviews.percent}%</span>` : ''}</div>
        <div class="stat-value ${growthRates.pageviews.isPositive ? 'growth-positive' : ''}">${totalPageviews.toLocaleString()}</div>
      </div>
      <div class="perf-stat-card">
        <div class="stat-label">총 세션 ${growthRates.sessions.arrow} ${growthRates.sessions.percent !== null ? `<span class="growth-rate ${growthRates.sessions.isPositive ? 'positive' : 'negative'}">${growthRates.sessions.percent}%</span>` : ''}</div>
        <div class="stat-value ${growthRates.sessions.isPositive ? 'growth-positive' : ''}">${totalSessions.toLocaleString()}</div>
      </div>
      <div class="perf-stat-card ${goalAchieved ? 'goal-achieved' : ''}">
        <div class="stat-label">발행 콘텐츠 ${goalAchieved ? '🎯' : ''}</div>
        <div class="stat-value">${sortedData.length}개</div>
        ${goalAchieved ? `<div class="goal-badge">오늘 ${todayPublishedCount}개 발행! 🎉</div>` : ''}
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
  
  // [디버깅] 실제 렌더링된 카드 수 확인
  setTimeout(() => {
    const renderedCards = contentEl.querySelectorAll('.perf-card');
    Logger.debug(`[Performance Dashboard] 렌더링 확인:`);
    Logger.debug(`  - sortedData 길이: ${sortedData.length}`);
    Logger.debug(`  - 실제 DOM의 카드 수: ${renderedCards.length}`);
    
    if (sortedData.length !== renderedCards.length) {
      Logger.warn(`[Performance Dashboard] ⚠️ 불일치! 데이터는 ${sortedData.length}개인데 DOM에는 ${renderedCards.length}개가 렌더링되었습니다.`);
      
      // 실제 렌더링된 카드의 ID 확인
      const renderedIds = Array.from(renderedCards).map(card => card.dataset.cardId);
      Logger.debug(`  - 렌더링된 카드 ID:`, renderedIds);
      Logger.debug(`  - 데이터 카드 ID:`, sortedData.map(item => item.id));
      
      // 중복 확인
      const idCounts = {};
      renderedIds.forEach(id => {
        idCounts[id] = (idCounts[id] || 0) + 1;
      });
      const duplicates = Object.entries(idCounts).filter(([id, count]) => count > 1);
      if (duplicates.length > 0) {
        Logger.warn(`  - 중복된 카드 ID:`, duplicates);
      }
    }
  }, 100);
}

/**
 * 성과 카드 생성
 */
function createPerformanceCard(item, index) {
  const perf = item.performance;
  
  
  // 수익 데이터: estimatedEarnings 우선, 없으면 gaEarnings, 없으면 0
  const earnings = perf.estimatedEarnings !== undefined && perf.estimatedEarnings !== null
    ? perf.estimatedEarnings
    : (perf.gaEarnings !== undefined && perf.gaEarnings !== null ? perf.gaEarnings : 0);
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
  
  // [신규] 데이터 불일치 경고 표시
  const hasDataWarning = perf.dataWarning && perf.dataWarning !== null;
  let warningBadge = '';
  let warningTooltip = '';
  
  if (hasDataWarning) {
    if (perf.dataWarning.type === "EARNINGS_MISMATCH") {
      warningTooltip = perf.dataWarning.message || `소스 간 데이터 불일치: GA4 $${perf.dataWarning.gaValue?.toFixed(2) || 'N/A'} vs AdSense $${perf.dataWarning.adsenseValue?.toFixed(2) || 'N/A'}`;
      warningBadge = `<span class="data-warning-badge" style="background: #FF6B6B; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: help;" title="${warningTooltip}">⚠️ 데이터 불일치</span>`;
    } else if (perf.dataWarning.type === "MULTIPLE_MISMATCH") {
      const mismatchMessages = perf.dataWarning.mismatches?.map(m => 
        `${m.metric}: GA4 ${m.gaValue} vs AdSense ${m.adsenseValue} (${m.differencePercent}% 차이)`
      ).join(', ') || '여러 지표에서 데이터 불일치';
      warningTooltip = `소스 간 데이터 불일치: ${mismatchMessages}`;
      warningBadge = `<span class="data-warning-badge" style="background: #FF6B6B; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: help;" title="${warningTooltip}">⚠️ 데이터 불일치</span>`;
    }
  }
  
  // 신뢰도 점수 표시 (낮은 경우에만)
  const confidenceScore = perf.dataConfidenceScore !== undefined ? perf.dataConfidenceScore : 1.0;
  const confidenceBadge = confidenceScore < 0.8 
    ? `<span class="confidence-badge" style="background: #FFA500; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: help;" title="데이터 신뢰도: ${(confidenceScore * 100).toFixed(0)}%">📊 신뢰도 ${(confidenceScore * 100).toFixed(0)}%</span>`
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
          <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
            ${collectingBadge}
            ${warningBadge}
            ${confidenceBadge}
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

        ${(perf.deviceBreakdown && (perf.deviceBreakdown.mobile?.users > 0 || perf.deviceBreakdown.desktop?.users > 0 || perf.deviceBreakdown.tablet?.users > 0)) || 
           (perf.topCountries && perf.topCountries.length > 0) || 
           (perf.landingPages && perf.landingPages.length > 0) || 
           (perf.events && (perf.events.scroll > 0 || perf.events.click > 0)) ||
           (perf.topSearchTerms && perf.topSearchTerms.length > 0) ? `
          <div class="perf-card-details" style="margin-top:12px; padding-top:12px; border-top:1px solid #e0e0e0;">
            ${perf.deviceBreakdown && (perf.deviceBreakdown.mobile?.users > 0 || perf.deviceBreakdown.desktop?.users > 0 || perf.deviceBreakdown.tablet?.users > 0) ? `
              <div class="perf-detail-section">
                <div class="perf-detail-title">📱 디바이스</div>
                <div class="perf-detail-content">
                  ${perf.deviceBreakdown.mobile?.users > 0 ? `
                    <span class="perf-detail-badge" title="모바일 사용자: ${perf.deviceBreakdown.mobile.users.toLocaleString()}명, 수익: $${perf.deviceBreakdown.mobile.revenue.toFixed(2)}">
                      📱 모바일 ${perf.deviceBreakdown.mobile.users.toLocaleString()}명
                    </span>
                  ` : ''}
                  ${perf.deviceBreakdown.desktop?.users > 0 ? `
                    <span class="perf-detail-badge" title="데스크톱 사용자: ${perf.deviceBreakdown.desktop.users.toLocaleString()}명, 수익: $${perf.deviceBreakdown.desktop.revenue.toFixed(2)}">
                      💻 데스크톱 ${perf.deviceBreakdown.desktop.users.toLocaleString()}명
                    </span>
                  ` : ''}
                  ${perf.deviceBreakdown.tablet?.users > 0 ? `
                    <span class="perf-detail-badge" title="태블릿 사용자: ${perf.deviceBreakdown.tablet.users.toLocaleString()}명, 수익: $${perf.deviceBreakdown.tablet.revenue.toFixed(2)}">
                      📱 태블릿 ${perf.deviceBreakdown.tablet.users.toLocaleString()}명
                    </span>
                  ` : ''}
                </div>
              </div>
            ` : ''}
            
            ${perf.topCountries && perf.topCountries.length > 0 ? `
              <div class="perf-detail-section" style="margin-top:8px;">
                <div class="perf-detail-title">🌍 주요 국가</div>
                <div class="perf-detail-content">
                  ${perf.topCountries.slice(0, 3).map(country => `
                    <span class="perf-detail-badge" title="${country.country}: ${country.users.toLocaleString()}명, 수익: $${country.revenue.toFixed(2)}">
                      ${country.country} ${country.users.toLocaleString()}명
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            
            ${perf.landingPages && perf.landingPages.length > 0 ? `
              <div class="perf-detail-section" style="margin-top:8px;">
                <div class="perf-detail-title">🚪 랜딩 페이지</div>
                <div class="perf-detail-content">
                  ${perf.landingPages.slice(0, 2).map(landing => {
                    const shortPage = landing.page.length > 30 ? landing.page.substring(0, 30) + '...' : landing.page;
                    return `
                      <span class="perf-detail-badge" title="${landing.page}: ${landing.sessions}세션, 이탈률 ${(landing.bounceRate * 100).toFixed(1)}%">
                        ${shortPage} (${landing.sessions}세션)
                      </span>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}
            
            ${perf.events && (perf.events.scroll > 0 || perf.events.click > 0) ? `
              <div class="perf-detail-section" style="margin-top:8px;">
                <div class="perf-detail-title">🖱️ 상호작용</div>
                <div class="perf-detail-content">
                  ${perf.events.scroll > 0 ? `
                    <span class="perf-detail-badge" title="스크롤 이벤트">
                      📜 스크롤 ${perf.events.scroll.toLocaleString()}회
                    </span>
                  ` : ''}
                  ${perf.events.click > 0 ? `
                    <span class="perf-detail-badge" title="클릭 이벤트">
                      🖱️ 클릭 ${perf.events.click.toLocaleString()}회
                    </span>
                  ` : ''}
                </div>
              </div>
            ` : ''}
            
            ${perf.topSearchTerms && perf.topSearchTerms.length > 0 ? `
              <div class="perf-detail-section" style="margin-top:8px;">
                <div class="perf-detail-title">🔍 검색어</div>
                <div class="perf-detail-content">
                  ${perf.topSearchTerms.slice(0, 3).map(search => `
                    <span class="perf-detail-badge" title="검색어: ${search.term}, 사용자: ${search.users.toLocaleString()}명">
                      🔍 ${search.term} (${search.users.toLocaleString()}명)
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

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
 * 전일 대비 성장률 계산
 */
function calculateGrowthRates(currentEarnings, currentPageviews, currentSessions, currentContentCount) {
  // localStorage에서 전일 통계 가져오기
  const storedStats = localStorage.getItem('performance_previous_day_stats');
  let previousStats = null;
  
  if (storedStats) {
    try {
      previousStats = JSON.parse(storedStats);
      // 24시간 이내 데이터만 유효
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      if (previousStats.timestamp < oneDayAgo) {
        previousStats = null;
      }
    } catch (e) {
      previousStats = null;
    }
  }
  
  // 전일 통계가 없으면 null 반환
  if (!previousStats) {
    // 현재 통계 저장 (다음 렌더링 시 비교용)
    localStorage.setItem('performance_previous_day_stats', JSON.stringify({
      earnings: currentEarnings,
      pageviews: currentPageviews,
      sessions: currentSessions,
      contentCount: currentContentCount,
      timestamp: Date.now()
    }));
    
    return {
      earnings: { percent: null, arrow: '', isPositive: false },
      pageviews: { percent: null, arrow: '', isPositive: false },
      sessions: { percent: null, arrow: '', isPositive: false }
    };
  }
  
  // 성장률 계산
  const calculateGrowth = (current, previous) => {
    if (previous === 0) return { percent: current > 0 ? 100 : 0, isPositive: current > 0 };
    const percent = ((current - previous) / previous) * 100;
    return {
      percent: Math.abs(percent).toFixed(1),
      isPositive: percent > 0
    };
  };
  
  const earningsGrowth = calculateGrowth(currentEarnings, previousStats.earnings);
  const pageviewsGrowth = calculateGrowth(currentPageviews, previousStats.pageviews);
  const sessionsGrowth = calculateGrowth(currentSessions, previousStats.sessions);
  
  // 현재 통계 저장
  localStorage.setItem('performance_previous_day_stats', JSON.stringify({
    earnings: currentEarnings,
    pageviews: currentPageviews,
    sessions: currentSessions,
    contentCount: currentContentCount,
    timestamp: Date.now()
  }));
  
  return {
    earnings: {
      percent: earningsGrowth.percent,
      arrow: earningsGrowth.isPositive ? '🔺' : earningsGrowth.percent === '0.0' ? '' : '🔻',
      isPositive: earningsGrowth.isPositive
    },
    pageviews: {
      percent: pageviewsGrowth.percent,
      arrow: pageviewsGrowth.isPositive ? '🔺' : pageviewsGrowth.percent === '0.0' ? '' : '🔻',
      isPositive: pageviewsGrowth.isPositive
    },
    sessions: {
      percent: sessionsGrowth.percent,
      arrow: sessionsGrowth.isPositive ? '🔺' : sessionsGrowth.percent === '0.0' ? '' : '🔻',
      isPositive: sessionsGrowth.isPositive
    }
  };
}

/**
 * Confetti 애니메이션 (목표 달성 시)
 */
function triggerConfettiAnimation() {
  // Confetti 컨테이너 생성
  const confettiContainer = document.createElement('div');
  confettiContainer.id = 'confetti-container';
  confettiContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
  `;
  document.body.appendChild(confettiContainer);
  
  // Confetti 파티클 생성
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'];
  const particleCount = 150;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = Math.random() * 10 + 5;
    const startX = Math.random() * window.innerWidth;
    const startY = -10;
    const endY = window.innerHeight + 10;
    const duration = Math.random() * 2 + 2;
    const delay = Math.random() * 0.5;
    const rotation = Math.random() * 720 + 360; // 360~1080도 회전
    
    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      left: ${startX}px;
      top: ${startY}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
      opacity: 0.9;
      animation: confetti-fall ${duration}s ease-out ${delay}s forwards;
      transform: rotate(${rotation}deg);
    `;
    
    confettiContainer.appendChild(particle);
  }
  
  // CSS 애니메이션 추가 (한 번만)
  if (!document.getElementById('confetti-styles')) {
    const style = document.createElement('style');
    style.id = 'confetti-styles';
    style.textContent = `
      @keyframes confetti-fall {
        0% {
          transform: translateY(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(${window.innerHeight + 100}px) rotate(720deg);
          opacity: 0;
        }
      }
      .growth-rate.positive {
        color: #4CAF50;
        font-weight: 600;
        animation: growth-blink 1s ease-in-out 3;
      }
      .growth-rate.negative {
        color: #F44336;
        font-weight: 600;
      }
      .growth-positive {
        animation: growth-blink 1s ease-in-out 3;
      }
      @keyframes growth-blink {
        0%, 100% { color: inherit; }
        50% { color: #4CAF50; }
      }
      .goal-achieved {
        border: 2px solid #FFD700 !important;
        box-shadow: 0 0 20px rgba(255, 215, 0, 0.5) !important;
        animation: goal-pulse 2s ease-in-out infinite;
      }
      @keyframes goal-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      .goal-badge {
        margin-top: 8px;
        padding: 4px 8px;
        background: linear-gradient(135deg, #FFD700, #FFA500);
        color: white;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        animation: badge-bounce 0.5s ease-out;
      }
      @keyframes badge-bounce {
        0% { transform: scale(0); }
        50% { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }
  
  // 3초 후 confetti 제거
  setTimeout(() => {
    confettiContainer.remove();
  }, 5000);
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

