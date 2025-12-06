// js/ui/performanceReportMode.js
// 성과 분석 및 리포트 모드 UI

import { showToast } from '../utils.js';

let allPerformanceData = [];
let analysisReport = null;

/**
 * 성과 분석 리포트 렌더링
 */
export function renderPerformanceReport(container) {
  // [체크리스트 6-1] 완전 초기화: 이전 채널의 모든 데이터 제거
  container.innerHTML = '';

  // [체크리스트 6-3] 리포트 초기화: 채널 변경 시 리포트도 초기화
  analysisReport = null;

  container.innerHTML = `
    <div class="performance-report-container">
      <div class="perf-report-header">
        <h2>📈 성과 분석 리포트</h2>
        <div class="perf-report-controls">
          <button id="generate-report-btn" class="perf-control-btn primary">📊 리포트 생성</button>
          <button id="refresh-report-btn" class="perf-control-btn">🔄 새로고침</button>
        </div>
      </div>
      <div id="perf-report-content" class="perf-report-content">
        <div class="perf-report-welcome">
          <div class="perf-report-icon">📊</div>
          <h3>성과 분석 리포트</h3>
          <p>발행된 콘텐츠의 성과를 분석하여 인사이트와 개선점을 제공합니다.</p>
          <button id="start-analysis-btn" class="perf-control-btn primary">분석 시작하기</button>
        </div>
      </div>
    </div>
  `;

  addPerformanceReportEventListeners(container);
}

/**
 * 이벤트 리스너 추가
 */
function addPerformanceReportEventListeners(container) {
  const startBtn = container.querySelector('#start-analysis-btn');
  const generateBtn = container.querySelector('#generate-report-btn');
  const refreshBtn = container.querySelector('#refresh-report-btn');

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      generatePerformanceReport(container);
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      generatePerformanceReport(container);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadPerformanceData(container);
    });
  }

  // [신규] 채널 변경 감지 -> 성과 리포트 새로고침
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.activeChannelId) {
      console.log('[Performance Report] 채널 변경 감지, 데이터 다시 로드');
      // 리포트 초기화
      analysisReport = null;
      loadPerformanceData(container);
    }
  });
}

/**
 * Firebase에서 성과 데이터 로드
 */
function loadPerformanceData(container) {
  showToast('성과 데이터를 불러오는 중...');

  // [최적화] 성능 최적화 서비스를 통한 데이터 로드
  (async () => {
    try {
      const { loadKanbanData } = await import('../services/kanbanService.js');
      const allCards = await loadKanbanData();
      await processPerformanceData(allCards, container);
    } catch (error) {
      console.error('[PerformanceReport] 데이터 로드 실패:', error);
      showToast('성과 데이터를 불러오는데 실패했습니다.', 'error');
    }
  })();
}

/**
 * 성과 데이터 처리
 */
async function processPerformanceData(allCards, container) {
  allPerformanceData = [];

  // [신규] 현재 활성 채널 ID 가져오기
  const { activeChannelId } = await chrome.storage.local.get('activeChannelId');

  // 모든 상태의 카드에서 성과 데이터가 있는 것만 추출
  for (const status in allCards) {
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];

      // [신규] 채널 필터링: 현재 활성 채널과 일치하는 카드만 포함
      if (activeChannelId && card.channelId !== activeChannelId) {
        // channelId가 undefined인 구버전 데이터는 일단 포함 (호환성)
        if (card.channelId !== undefined) {
          continue;
        }
      }

      if (card.publishedUrl && card.performance && !card.performance.error) {
        allPerformanceData.push({
          id: cardId,
          status: status,
          title: card.title || '제목 없음',
          publishedUrl: card.publishedUrl,
          performance: card.performance,
          tags: card.tags || [],
          createdAt: card.createdAt || 0,
          lastUpdatedAt: card.performance.lastUpdatedAt || 0,
        });
      }
    }
  }

  showToast(`성과 데이터 ${allPerformanceData.length}개를 불러왔습니다.`);

  // 리포트가 있으면 다시 렌더링 (채널 변경 시 리포트는 초기화됨)
  if (analysisReport) {
    renderReport(container);
  }
}

/**
 * 성과 리포트 생성
 */
async function generatePerformanceReport(container) {
  if (allPerformanceData.length === 0) {
    loadPerformanceData(container);
    // 데이터 로드 후 리포트 생성
    setTimeout(() => {
      if (allPerformanceData.length === 0) {
        const contentEl = container.querySelector('#perf-report-content');
        contentEl.innerHTML = `
          <div class="perf-no-data">
            <div class="perf-report-icon">⚠️</div>
            <h3>성과 데이터가 없습니다</h3>
            <p>아직 성과 데이터를 수집하지 않았거나, GA4 설정이 필요할 수 있습니다.</p>
            <div class="perf-setup-guide">
              <h4>설정 확인사항:</h4>
              <ul>
                <li>채널 설정에서 GA4 Property ID가 입력되어 있는지 확인하세요</li>
                <li>콘텐츠가 발행된 후 최소 24시간이 지났는지 확인하세요</li>
                <li>Google Analytics에서 데이터가 수집되고 있는지 확인하세요</li>
              </ul>
              <button id="open-channel-settings-btn" class="perf-control-btn primary">채널 설정 열기</button>
            </div>
          </div>
        `;
        // 채널 설정 버튼 이벤트 추가
        const settingsBtn = contentEl.querySelector('#open-channel-settings-btn');
        if (settingsBtn) {
          settingsBtn.addEventListener('click', () => {
            // 채널 모드로 전환하는 이벤트 발생
            window.dispatchEvent(new CustomEvent('switch-to-channel-mode'));
          });
        }
        return;
      }
      performAnalysis(container);
    }, 1000);
    return;
  }

  performAnalysis(container);
}

/**
 * 성과 분석 수행
 */
async function performAnalysis(container) {
  const contentEl = container.querySelector('#perf-report-content');
  contentEl.innerHTML = `
    <div class="perf-analysis-loading">
      <div class="loading-spinner">⏳</div>
      <h3>성과 데이터를 분석하는 중...</h3>
      <p>잠시만 기다려주세요.</p>
    </div>
  `;

  try {
    // 성과 데이터 분석
    const analysis = analyzePerformanceData();

    // AI 기반 인사이트 생성
    const insights = await generateAIInsights(analysis);

    analysisReport = {
      ...analysis,
      insights,
      generatedAt: Date.now(),
    };

    renderReport(container);
  } catch (error) {
    console.error('성과 분석 중 오류:', error);
    showToast('성과 분석 중 오류가 발생했습니다.', 'error');
    contentEl.innerHTML = `
      <div class="perf-error">
        <h3>오류 발생</h3>
        <p>${error.message}</p>
        <button id="retry-analysis-btn" class="perf-control-btn">다시 시도</button>
      </div>
    `;

    const retryBtn = contentEl.querySelector('#retry-analysis-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => performAnalysis(container));
    }
  }
}

/**
 * 성과 데이터 분석
 */
function analyzePerformanceData() {
  if (allPerformanceData.length === 0) {
    return null;
  }

  // 기본 통계
  const totalEarnings = allPerformanceData.reduce(
    (sum, item) => sum + (item.performance.estimatedEarnings || 0),
    0
  );
  const totalPageviews = allPerformanceData.reduce(
    (sum, item) => sum + (item.performance.pageviews || 0),
    0
  );
  const totalSessions = allPerformanceData.reduce(
    (sum, item) => sum + (item.performance.sessions || 0),
    0
  );
  const avgEarnings = totalEarnings / allPerformanceData.length;
  const avgPageviews = totalPageviews / allPerformanceData.length;
  const avgSessions = totalSessions / allPerformanceData.length;
  const avgDuration =
    allPerformanceData.reduce((sum, item) => sum + (item.performance.avgSessionDuration || 0), 0) /
    allPerformanceData.length;
  const avgCTR =
    allPerformanceData.reduce(
      (sum, item) => sum + (item.performance.pageCTR || item.performance.ctr || 0),
      0
    ) / allPerformanceData.length;
  const avgBounceRate =
    allPerformanceData.reduce((sum, item) => sum + (item.performance.bounceRate || 0), 0) /
    allPerformanceData.length;

  // [추가] 평균 RPM 계산
  // 단순 평균으로 계산 (각 페이지의 RPM의 합 / 개수)
  const avgRPM =
    allPerformanceData.reduce(
      (sum, item) => sum + (item.performance.pageRPM || item.performance.rpm || 0),
      0
    ) / allPerformanceData.length;

  // [신규] 평균 참여율 및 신규 방문자 계산
  const avgEngagementRate =
    allPerformanceData.reduce((sum, item) => sum + (item.performance.engagementRate || 0), 0) /
    allPerformanceData.length;
  const avgNewUsers =
    allPerformanceData.reduce((sum, item) => sum + (item.performance.newUsers || 0), 0) /
    allPerformanceData.length;

  // 성공 콘텐츠 분석 (상위 20%)
  const successThreshold = Math.ceil(allPerformanceData.length * 0.2);
  const sortedByEarnings = [...allPerformanceData].sort(
    (a, b) => (b.performance.estimatedEarnings || 0) - (a.performance.estimatedEarnings || 0)
  );
  const topPerformers = sortedByEarnings.slice(0, successThreshold);

  // 실패 콘텐츠 분석 (하위 20%)
  const bottomPerformers = sortedByEarnings.slice(-successThreshold);

  // 태그 분석
  const tagFrequency = {};
  const topTagFrequency = {};
  const bottomTagFrequency = {};

  allPerformanceData.forEach((item) => {
    (item.tags || []).forEach((tag) => {
      tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
    });
  });

  topPerformers.forEach((item) => {
    (item.tags || []).forEach((tag) => {
      topTagFrequency[tag] = (topTagFrequency[tag] || 0) + 1;
    });
  });

  bottomPerformers.forEach((item) => {
    (item.tags || []).forEach((tag) => {
      bottomTagFrequency[tag] = (bottomTagFrequency[tag] || 0) + 1;
    });
  });

  // 성공 태그 (상위 콘텐츠에 많이 나타나는 태그)
  const successTags = Object.entries(topTagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  // 실패 태그 (하위 콘텐츠에 많이 나타나는 태그)
  const failureTags = Object.entries(bottomTagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  // 성공 패턴 분석
  const successPatterns = {
    avgEarnings:
      topPerformers.reduce((sum, item) => sum + (item.performance.estimatedEarnings || 0), 0) /
      topPerformers.length,
    avgPageviews:
      topPerformers.reduce((sum, item) => sum + (item.performance.pageviews || 0), 0) /
      topPerformers.length,
    avgDuration:
      topPerformers.reduce((sum, item) => sum + (item.performance.avgSessionDuration || 0), 0) /
      topPerformers.length,
    avgCTR:
      topPerformers.reduce(
        (sum, item) => sum + (item.performance.pageCTR || item.performance.ctr || 0),
        0
      ) / topPerformers.length,
    avgBounceRate:
      topPerformers.reduce((sum, item) => sum + (item.performance.bounceRate || 0), 0) /
      topPerformers.length,
    avgRPM:
      topPerformers.reduce(
        (sum, item) => sum + (item.performance.pageRPM || item.performance.rpm || 0),
        0
      ) / topPerformers.length,
    tags: successTags,
  };

  // 실패 패턴 분석
  const failurePatterns = {
    avgEarnings:
      bottomPerformers.reduce((sum, item) => sum + (item.performance.estimatedEarnings || 0), 0) /
      bottomPerformers.length,
    avgPageviews:
      bottomPerformers.reduce((sum, item) => sum + (item.performance.pageviews || 0), 0) /
      bottomPerformers.length,
    avgDuration:
      bottomPerformers.reduce((sum, item) => sum + (item.performance.avgSessionDuration || 0), 0) /
      bottomPerformers.length,
    avgCTR:
      bottomPerformers.reduce(
        (sum, item) => sum + (item.performance.pageCTR || item.performance.ctr || 0),
        0
      ) / bottomPerformers.length,
    avgBounceRate:
      bottomPerformers.reduce((sum, item) => sum + (item.performance.bounceRate || 0), 0) /
      bottomPerformers.length,
    avgRPM:
      bottomPerformers.reduce(
        (sum, item) => sum + (item.performance.pageRPM || item.performance.rpm || 0),
        0
      ) / bottomPerformers.length,
    tags: failureTags,
  };

  return {
    summary: {
      totalContent: allPerformanceData.length,
      totalEarnings,
      totalPageviews,
      totalSessions,
      avgEarnings,
      avgPageviews,
      avgSessions,
      avgDuration,
      avgCTR,
      avgBounceRate,
      avgRPM, // [추가]
      avgEngagementRate: avgEngagementRate * 100, // % 변환
      avgNewUsers,
    },
    topPerformers: topPerformers.slice(0, 5),
    bottomPerformers: bottomPerformers.slice(0, 5),
    successPatterns,
    failurePatterns,
    tagFrequency,
  };
}

/**
 * AI 기반 인사이트 생성
 */
async function generateAIInsights(analysis) {
  if (!analysis) return null;

  try {
    const prompt = `다음은 콘텐츠 성과 분석 데이터입니다. 이를 바탕으로 인사이트와 개선점을 제안해주세요.

**전체 통계:**
- 총 콘텐츠 수: ${analysis.summary.totalContent}개
- 평균 수익: $${analysis.summary.avgEarnings.toFixed(2)}
- 평균 페이지뷰: ${analysis.summary.avgPageviews.toFixed(0)}회
- 평균 체류 시간: ${Math.round(analysis.summary.avgDuration)}초
- 평균 RPM: $${analysis.summary.avgRPM.toFixed(2)}
- 평균 CTR: ${analysis.summary.avgCTR.toFixed(2)}%
- 평균 이탈률: ${analysis.summary.avgBounceRate.toFixed(2)}%

**성공 콘텐츠 패턴:**
- 평균 수익: $${analysis.successPatterns.avgEarnings.toFixed(2)}
- 평균 페이지뷰: ${analysis.successPatterns.avgPageviews.toFixed(0)}회
- 평균 체류 시간: ${Math.round(analysis.successPatterns.avgDuration)}초
- 평균 RPM: $${analysis.successPatterns.avgRPM.toFixed(2)}
- 평균 CTR: ${analysis.successPatterns.avgCTR.toFixed(2)}%
- 성공 태그: ${analysis.successPatterns.tags.join(', ')}

**실패 콘텐츠 패턴:**
- 평균 수익: $${analysis.failurePatterns.avgEarnings.toFixed(2)}
- 평균 페이지뷰: ${analysis.failurePatterns.avgPageviews.toFixed(0)}회
- 평균 체류 시간: ${Math.round(analysis.failurePatterns.avgDuration)}초
- 평균 RPM: $${analysis.failurePatterns.avgRPM.toFixed(2)}
- 평균 CTR: ${analysis.failurePatterns.avgCTR.toFixed(2)}%
- 실패 태그: ${analysis.failurePatterns.tags.join(', ')}

다음 형식으로 응답해주세요:
1. **성공 요인 분석**: 성공 콘텐츠의 공통점
2. **개선점 제안**: 실패 콘텐츠의 문제점과 개선 방안
3. **수익 최적화 제안**: 수익을 높이기 위한 구체적인 전략
4. **태그 전략**: 성공 태그를 활용한 콘텐츠 기획 제안`;

    const response = await chrome.runtime.sendMessage({
      action: 'call_gemini',
      prompt: prompt,
    });

    if (response && response.text) {
      return {
        successFactors: extractSection(response.text, '성공 요인'),
        improvements: extractSection(response.text, '개선점'),
        optimization: extractSection(response.text, '수익 최적화'),
        tagStrategy: extractSection(response.text, '태그 전략'),
        fullText: response.text,
      };
    }

    return null;
  } catch (error) {
    console.error('AI 인사이트 생성 실패:', error);
    return null;
  }
}

/**
 * 텍스트에서 섹션 추출
 */
function extractSection(text, sectionName) {
  const regex = new RegExp(`\\*\\*${sectionName}[^:]*:\\*\\*\\s*([^*]+?)(?=\\*\\*|$)`, 's');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * 리포트 렌더링
 */
function renderReport(container) {
  if (!analysisReport) {
    return;
  }

  const contentEl = container.querySelector('#perf-report-content');
  const analysis = analysisReport;
  const insights = analysis.insights || {};

  contentEl.innerHTML = `
    <div class="perf-report-sections">
      <!-- 전체 요약 -->
      <section class="perf-report-section">
        <h3 class="section-title">📊 전체 성과 요약</h3>
        <div class="perf-summary-grid">
          <div class="perf-summary-card">
            <div class="summary-label">총 콘텐츠</div>
            <div class="summary-value">${analysis.summary.totalContent}개</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">총 수익</div>
            <div class="summary-value">$${analysis.summary.totalEarnings.toFixed(2)}</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">총 페이지뷰</div>
            <div class="summary-value">${analysis.summary.totalPageviews.toLocaleString()}</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 수익</div>
            <div class="summary-value">$${analysis.summary.avgEarnings.toFixed(2)}</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 페이지뷰</div>
            <div class="summary-value">${analysis.summary.avgPageviews.toFixed(0)}</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 RPM</div>
            <div class="summary-value">$${analysis.summary.avgRPM.toFixed(2)}</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 CTR</div>
            <div class="summary-value">${analysis.summary.avgCTR.toFixed(2)}%</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 참여율</div>
            <div class="summary-value">${analysis.summary.avgEngagementRate.toFixed(1)}%</div>
          </div>
          <div class="perf-summary-card">
            <div class="summary-label">평균 신규 방문</div>
            <div class="summary-value">${Math.round(analysis.summary.avgNewUsers)}명</div>
          </div>
        </div>
      </section>

      <!-- 성공 패턴 분석 -->
      <section class="perf-report-section">
        <h3 class="section-title">✨ 성공 콘텐츠 패턴 분석</h3>
        <div class="perf-pattern-analysis">
          <div class="pattern-metrics">
            <div class="pattern-metric">
              <span class="metric-label">평균 수익</span>
              <span class="metric-value highlight">$${analysis.successPatterns.avgEarnings.toFixed(2)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 페이지뷰</span>
              <span class="metric-value highlight">${analysis.successPatterns.avgPageviews.toFixed(0)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 RPM</span>
              <span class="metric-value highlight">$${analysis.successPatterns.avgRPM.toFixed(2)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 체류 시간</span>
              <span class="metric-value highlight">${Math.round(analysis.successPatterns.avgDuration)}초</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 CTR</span>
              <span class="metric-value highlight">${analysis.successPatterns.avgCTR.toFixed(2)}%</span>
            </div>
          </div>
          <div class="pattern-tags">
            <h4>성공 태그</h4>
            <div class="tag-list">
              ${analysis.successPatterns.tags.map((tag) => `<span class="tag success-tag">${tag}</span>`).join('')}
            </div>
          </div>
          ${
            insights.successFactors
              ? `
            <div class="pattern-insights">
              <h4>AI 분석 인사이트</h4>
              <div class="insight-text">${formatInsightText(insights.successFactors)}</div>
            </div>
          `
              : ''
          }
        </div>
      </section>

      <!-- 실패 패턴 분석 -->
      <section class="perf-report-section">
        <h3 class="section-title">⚠️ 실패 콘텐츠 패턴 분석</h3>
        <div class="perf-pattern-analysis">
          <div class="pattern-metrics">
            <div class="pattern-metric">
              <span class="metric-label">평균 수익</span>
              <span class="metric-value warning">$${analysis.failurePatterns.avgEarnings.toFixed(2)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 페이지뷰</span>
              <span class="metric-value warning">${analysis.failurePatterns.avgPageviews.toFixed(0)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 RPM</span>
              <span class="metric-value warning">$${analysis.failurePatterns.avgRPM.toFixed(2)}</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 체류 시간</span>
              <span class="metric-value warning">${Math.round(analysis.failurePatterns.avgDuration)}초</span>
            </div>
            <div class="pattern-metric">
              <span class="metric-label">평균 CTR</span>
              <span class="metric-value warning">${analysis.failurePatterns.avgCTR.toFixed(2)}%</span>
            </div>
          </div>
          <div class="pattern-tags">
            <h4>실패 태그</h4>
            <div class="tag-list">
              ${analysis.failurePatterns.tags.map((tag) => `<span class="tag failure-tag">${tag}</span>`).join('')}
            </div>
          </div>
          ${
            insights.improvements
              ? `
            <div class="pattern-insights">
              <h4>개선점 제안</h4>
              <div class="insight-text">${formatInsightText(insights.improvements)}</div>
            </div>
          `
              : ''
          }
        </div>
      </section>

      <!-- 수익 최적화 제안 -->
      ${
        insights.optimization
          ? `
        <section class="perf-report-section">
          <h3 class="section-title">💰 수익 최적화 제안</h3>
          <div class="perf-optimization">
            <div class="insight-text">${formatInsightText(insights.optimization)}</div>
          </div>
        </section>
      `
          : ''
      }

      <!-- 태그 전략 -->
      ${
        insights.tagStrategy
          ? `
        <section class="perf-report-section">
          <h3 class="section-title">🏷️ 태그 전략 제안</h3>
          <div class="perf-tag-strategy">
            <div class="insight-text">${formatInsightText(insights.tagStrategy)}</div>
          </div>
        </section>
      `
          : ''
      }

      <!-- 상위/하위 콘텐츠 목록 -->
      <section class="perf-report-section">
        <h3 class="section-title">📈 상위 성과 콘텐츠</h3>
        <div class="perf-content-list">
          ${analysis.topPerformers
            .map(
              (item, idx) => `
            <div class="perf-content-item">
              <div class="content-rank">#${idx + 1}</div>
              <div class="content-info">
                <h4>${item.title}</h4>
                <div class="content-metrics">
                  <span>💰 $${(item.performance.estimatedEarnings || 0).toFixed(2)}</span>
                  <span>👁️ ${(item.performance.pageviews || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <section class="perf-report-section">
        <h3 class="section-title">📉 하위 성과 콘텐츠</h3>
        <div class="perf-content-list">
          ${analysis.bottomPerformers
            .map(
              (item, idx) => `
            <div class="perf-content-item">
              <div class="content-rank">#${idx + 1}</div>
              <div class="content-info">
                <h4>${item.title}</h4>
                <div class="content-metrics">
                  <span>💰 $${(item.performance.estimatedEarnings || 0).toFixed(2)}</span>
                  <span>👁️ ${(item.performance.pageviews || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <div class="perf-report-footer">
        <p>리포트 생성 시간: ${new Date(analysisReport.generatedAt).toLocaleString('ko-KR')}</p>
      </div>
    </div>
  `;
}

/**
 * 인사이트 텍스트 포맷팅
 */
function formatInsightText(text) {
  if (!text) return '';
  // 마크다운 스타일을 HTML로 변환
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
    .replace(/^\d+\.\s/gm, '<li>')
    .replace(/(<li>)/g, '<ul>$1')
    .replace(/(<\/ul>)(<ul>)/g, '$1');
}
