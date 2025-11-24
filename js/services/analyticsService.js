// js/services/analyticsService.js

import { getDb, CONSTANTS, initializeFirebase } from './firebaseService.js';
import { ref, get, update } from 'firebase/database';
import { getValidToken } from './authService.js';

// 1. 에러 전파 유틸리티
// [Performance Fix] chrome.runtime.sendMessage를 사용하여 확장 프로그램 UI(팝업/사이드 패널)에 직접 전송
// 이렇게 하면 웹페이지 탭이 활성화되지 않아도 에러 메시지가 표시됨
export async function sendErrorToUI(errorType, message) {
  try {
    // 에러 타입별 아이콘 및 메시지 매핑
    let icon = "⚠️";
    let msg = message;
    
    switch (errorType) {
      case "TOKEN_EXPIRED":
        icon = "🔑";
        msg = "인증 토큰 만료. 재로그인이 필요합니다.";
        break;
      case "QUOTA_EXCEEDED":
        icon = "📊";
        msg = "API 할당량 초과.";
        break;
      case "API_KEY_MISSING":
        icon = "🔑";
        msg = "API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
        break;
      case "UNAUTHORIZED":
        icon = "🔴";
        msg = "인증 실패: 토큰이 만료되었습니다 (재로그인 필요)";
        break;
      case "FORBIDDEN":
        icon = "🚫";
        msg = "인증 실패: 토큰이 만료되었습니다 (재로그인 필요)";
        break;
      case "API_ERROR":
        icon = "⚠️";
        msg = message || "API 호출 중 오류가 발생했습니다.";
        break;
      default:
        icon = "⚠️";
        msg = message || "오류가 발생했습니다.";
    }
    
    // 1. 확장 프로그램 UI(팝업/사이드 패널)에 직접 전송 (우선순위 1)
    // chrome.runtime.sendMessage는 모든 확장 프로그램 컨텍스트에서 수신 가능
    chrome.runtime.sendMessage({
      action: "show_error_toast",
      errorType,
      message: msg,
      icon
    }).catch(() => {
      // 메시지 전송 실패 시 조용히 처리 (확장 프로그램이 닫혔을 수 있음)
    });
    
    // 2. 활성 웹페이지 탭에도 전송 (fallback, 선택적)
    // 웹페이지에서 확장 프로그램을 사용하는 경우를 위해 유지
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      
      if (tabs && tabs.length > 0 && tabs[0].id) {
        // chrome:// 페이지나 특수 페이지는 제외
        const url = tabs[0].url || '';
        if (url && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "show_error_toast",
            errorType,
            message: msg,
            icon
          }).catch(() => {
            // 탭이 닫혔거나 content script가 없는 경우 조용히 실패
          });
        }
      }
    } catch (tabError) {
      // 탭 조회 실패 시 무시 (확장 프로그램 UI에만 표시)
    }
  } catch (e) {
    console.error('[sendErrorToUI] 에러 전파 실패:', e);
  }
}

// 2. 데이터 수집 (GA4)
export async function getAnalyticsData(token, propertyId, url, retryCount = 0, useEncodedPath = false) {
  const API_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  
  let urlObj;
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    urlObj = new URL(normalizedUrl);
  } catch (e) { return { pageviews: 0, gaEarnings: 0 }; }

  const rawPath = urlObj.pathname;
  const normalizedPath = rawPath.endsWith('/') && rawPath !== '/' ? rawPath.slice(0, -1) : rawPath;
  
  // 인코딩 경로 사용 여부에 따른 필터 설정
  let filterPath = normalizedPath;
  if (!useEncodedPath) {
    try { filterPath = decodeURIComponent(normalizedPath); } catch(e) {}
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }], 
        metrics: [
          { name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "sessions" },
          { name: "screenPageViewsPerSession" }, { name: "bounceRate" }, { name: "engagementRate" },
          { name: "newUsers" }, { name: "activeUsers" }, { name: "totalAdRevenue" }
        ],
        dimensionFilter: {
          filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: filterPath } }
        }
      })
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error("UNAUTHORIZED");
      // 400 에러 시 인코딩된 경로로 1회 재시도
      if (res.status === 400 && !useEncodedPath && retryCount === 0) {
        return getAnalyticsData(token, propertyId, url, retryCount + 1, true);
      }
      return { pageviews: 0, gaEarnings: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.rows && data.rows.length > 0) {
      const v = data.rows[0].metricValues;
      return {
        pageviews: parseInt(v[0].value),
        avgSessionDuration: parseFloat(v[1].value),
        sessions: parseInt(v[2].value),
        pagesPerSession: parseFloat(v[3].value),
        bounceRate: parseFloat(v[4].value),
        engagementRate: parseFloat(v[5].value),
        newUsers: parseInt(v[6].value),
        activeUsers: parseInt(v[7].value),
        gaEarnings: parseFloat(v[8].value)
      };
    }
    return { pageviews: 0, gaEarnings: 0 };
  } catch (e) {
    if (e.message === "UNAUTHORIZED" && retryCount < 1) {
        // 토큰 갱신 후 재시도
        try {
          const refreshedToken = await getValidToken(false);
          if (refreshedToken) {
            return getAnalyticsData(refreshedToken, propertyId, url, retryCount + 1, useEncodedPath);
          }
        } catch (refreshError) {
          console.error('[getAnalyticsData] 토큰 갱신 실패:', refreshError);
        }
        throw e; 
    }
    return { pageviews: 0, gaEarnings: 0, error: e.message };
  }
}

// 3. 데이터 수집 (AdSense)
export async function getAdsenseData(token, accountId, url, retryCount = 0) {
  const parentAccount = `accounts/${accountId}`;
  const API_URL = `https://adsense.googleapis.com/v2/${parentAccount}/reports:generate`;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // 1차 시도: 도메인 필터 (데이터 존재 여부 확인용)
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRange: "LAST_30_DAYS",
        metrics: ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "CLICKS", "PAGE_VIEWS_RPM"],
        dimensions: ["URL_CHANNEL_NAME"],
        filters: [`URL_CHANNEL_NAME==${domain}`]
      })
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error("UNAUTHORIZED");
      return { estimatedEarnings: 0, pageViews: 0 };
    }

    const data = await res.json();
    if (data.rows) {
      // URL과 일치하는 행 찾기
      const match = data.rows.find(r => {
        const val = r.dimensionValues[0].value;
        return val === url || url.includes(val);
      });
      
      if (match) {
        const m = match.metricValues;
        return {
          estimatedEarnings: parseFloat(m[0].value),
          pageViews: parseFloat(m[1].value),
          clicks: parseFloat(m[2].value),
          pageRPM: parseFloat(m[3].value)
        };
      }
    }
    return { estimatedEarnings: 0, pageViews: 0 };
  } catch (e) {
    if (e.message === "UNAUTHORIZED" && retryCount < 1) {
        // 토큰 갱신 후 재시도
        try {
          const refreshedToken = await getValidToken(false);
          if (refreshedToken) {
            return getAdsenseData(refreshedToken, accountId, url, retryCount + 1);
          }
        } catch (refreshError) {
          console.error('[getAdsenseData] 토큰 갱신 실패:', refreshError);
        }
        throw e;
    }
    if (e.message === "UNAUTHORIZED") throw e;
    return { estimatedEarnings: 0, pageViews: 0, error: e.message };
  }
}

// 4. 단건 성과 지표 업데이트 (핵심 로직)
export async function updateSinglePerformanceMetric(contentInfo) {
  if (!initializeFirebase()) return;
  const db = getDb();
  const userId = CONSTANTS.USER_ID;
  
  // 경로 보정
  let path = contentInfo.path;
  if (!path.includes(userId)) path = path.replace('kanban/', `kanban/${userId}/`);
  
  try {
    await update(ref(db, `${path}/performance`), { collecting: true, collectingStartedAt: Date.now() });

    // 토큰 검증 및 자동 갱신
    const token = await getValidToken(false);
    if (!token) {
      throw new Error("인증 토큰을 가져올 수 없습니다. 로그인이 필요합니다.");
    }

    const storage = await chrome.storage.local.get(["adSenseAccountId"]);
    const adSenseId = storage.adSenseAccountId;

    if (!adSenseId) throw new Error("AdSense 계정 ID가 없습니다.");

    // 채널 정보에서 GA ID 찾기
    const channelsSnap = await get(ref(db, `channels/${userId}`));
    const channels = channelsSnap.val() || {};
    let gaId = null;
    const blogs = channels.myChannels?.blogs || [];
    const blog = blogs.find(b => contentInfo.url.includes(b.inputUrl || b.url));
    if (blog) gaId = blog.gaPropertyId;
    
    if (!gaId) throw new Error("GA4 속성 ID를 찾을 수 없음");

    // 병렬 수집
    const [gaData, adData] = await Promise.allSettled([
      getAnalyticsData(token, gaId, contentInfo.url),
      getAdsenseData(token, adSenseId, contentInfo.url)
    ]);

    const ga = gaData.status === 'fulfilled' ? gaData.value : { gaEarnings: 0, pageviews: 0 };
    const ad = adData.status === 'fulfilled' ? adData.value : { estimatedEarnings: 0, pageViews: 0 };

    // 하이브리드 데이터 보정 (20% 이상 차이 시 보수적 선택)
    let finalEarnings = ga.gaEarnings || ad.estimatedEarnings || 0;
    let dataWarning = null;
    
    if (ga.gaEarnings > 0 && ad.estimatedEarnings > 0) {
      const diff = Math.abs(ga.gaEarnings - ad.estimatedEarnings);
      const max = Math.max(ga.gaEarnings, ad.estimatedEarnings);
      if (diff / max > 0.2) {
        dataWarning = { type: "EARNINGS_MISMATCH", ga: ga.gaEarnings, ad: ad.estimatedEarnings };
        finalEarnings = Math.min(ga.gaEarnings, ad.estimatedEarnings);
      }
    }

    // DB 저장
    await update(ref(db, `${path}/performance`), {
      ...ga, ...ad,
      estimatedEarnings: finalEarnings,
      pageviews: ga.pageviews || ad.pageViews || 0,
      dataWarning,
      lastUpdatedAt: Date.now(),
      collecting: false
    });

  } catch (e) {
    console.error("[Performance Update Fail]", e);
    await update(ref(db, `${path}/performance`), { collecting: false, error: e.message });
  }
}

// 5. 전체 성과 업데이트 (배치 처리)
export async function updateAllPerformanceMetrics() {
  if (!initializeFirebase()) return;
  const db = getDb();
  const userId = CONSTANTS.USER_ID;
  const snap = await get(ref(db, `kanban/${userId}`));
  const cards = snap.val() || {};
  
  const tasks = [];
  const now = Date.now();
  
  for (const status in cards) {
    for (const id in cards[status]) {
      const card = cards[status][id];
      // 6시간 경과 체크
      if (card.performanceTracked && card.publishedUrl) {
        if (!card.performance?.lastUpdatedAt || now - card.performance.lastUpdatedAt > 21600000) {
          tasks.push({ id, path: `kanban/${userId}/${status}/${id}`, url: card.publishedUrl });
        }
      }
    }
  }

  // 5개씩 배치 실행
  for (let i = 0; i < tasks.length; i += 5) {
    const batch = tasks.slice(i, i + 5);
    await Promise.all(batch.map(t => updateSinglePerformanceMetric(t)));
    await new Promise(r => setTimeout(r, 1000)); // API 제한 방지
  }
  
  // 재활용 후보 알림 업데이트
  await runAutomatedRenewalChecks();
}

// 6. 자동 리뉴얼 체크 & 배지 알림
export async function runAutomatedRenewalChecks() {
  const { decayContent } = await analyzePerformanceData();
  const count = decayContent ? decayContent.length : 0;
  
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// 7. 성과 데이터 분석 (순수 데이터 처리)
export async function analyzePerformanceData(targetChannelId = null) {
  if (!initializeFirebase()) return { analysis: null, decayContent: null };
  const db = getDb();
  const userId = CONSTANTS.USER_ID;
  const snap = await get(ref(db, `kanban/${userId}`));
  const cards = snap.val() || {};
  
  const candidates = [];
  const now = Date.now();
  
  for (const status in cards) {
    for (const id in cards[status]) {
      const card = cards[status][id];
      if (card.performance && card.publishedUrl) {
        if (targetChannelId && card.channelId !== targetChannelId) continue;
        
        const daysOld = (now - (card.createdAt || 0)) / 86400000;
        // 90일 이상, 수익 $1 이상인 글을 후보로
        if (daysOld >= 90 && card.performance.estimatedEarnings > 1) {
          candidates.push({
            cardId: id, title: card.title,
            earnings: card.performance.estimatedEarnings,
            pageviews: card.performance.pageviews,
            daysSinceCreation: daysOld,
            publishedUrl: card.publishedUrl,
            channelId: card.channelId
          });
        }
      }
    }
  }
  
  candidates.sort((a, b) => b.earnings - a.earnings);
  
  // 텍스트 분석 생성
  let analysisText = null;
  if (candidates.length > 0) {
    const avgEarnings = candidates.reduce((sum, c) => sum + c.earnings, 0) / candidates.length;
    const avgPageviews = candidates.reduce((sum, c) => sum + c.pageviews, 0) / candidates.length;
    
    const topTags = {};
    candidates.slice(0, 5).forEach(c => {
      // tags는 문자열 배열이거나 문자열일 수 있음
      const tags = Array.isArray(c.tags) ? c.tags : (c.tags ? [c.tags] : []);
      tags.forEach(tag => {
        topTags[tag] = (topTags[tag] || 0) + 1;
      });
    });
    const mostCommonTag = Object.keys(topTags).sort((a, b) => topTags[b] - topTags[a])[0] || '특정 주제';
    
    analysisText = `
과거 발행 콘텐츠 분석 (${candidates.length}개):

- 평균 수익: $${avgEarnings.toFixed(2)}
- 평균 조회수: ${Math.round(avgPageviews).toLocaleString()}

[상위 성과 콘텐츠]

${candidates.slice(0, 3).map((c, i) => `${i+1}. ${c.title} ($${c.earnings.toFixed(2)})`).join('\n')}

[인사이트]

상위 콘텐츠들은 주로 '${mostCommonTag}'와 관련된 내용을 다루고 있습니다.
    `.trim();
  } else {
    analysisText = "분석할 성과 데이터가 없습니다.";
  }
  
  return { 
    analysis: analysisText,
    decayContent: candidates.slice(0, 5) 
  };
}

// 8. 사용자 피드백 분석
export async function getUserFeedbackPatterns() {
  return null; // AI 분석 로직 분리를 위해 데이터 반환 형태로 변경 권장 (현재는 단순화)
}

// 9. 진단 로직 (Stub)
export async function checkAdSenseRegistrationStatus() { return { updatedCards: 0 }; }
export async function runFullSystemDiagnosis() { return { checks: [], errors: [] }; }
export async function runAdSenseDeepDiagnosis() { return { success: true }; }
export async function testBlogConnection() { return { success: true }; }
export async function testAdSenseGa4Access() { return { success: true }; }
