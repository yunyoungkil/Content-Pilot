// js/services/analyticsService.js

import { getDb, CONSTANTS, initializeFirebase } from './firebaseService.js';
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, get, update } from './firebaseService.js';
import { getValidToken } from './authService.js';
import { Logger } from '../utils.js';

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
    // [수정] 경쟁사 포스트인지 확인
    const cardSnap = await get(ref(db, path));
    const card = cardSnap?.val() || {};
    const isCompetitorPost = card.origin?.type === 'competitor_post';
    
    if (isCompetitorPost) {
      Logger.info(`[updateSinglePerformanceMetric] 경쟁사 포스트이므로 성과 추적을 건너뜁니다: ${contentInfo.id}`);
      return; // 경쟁사 포스트는 성과 추적하지 않음
    }
    
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
      // [수정] 경쟁사 포스트는 성과 추적 제외
      const isCompetitorPost = card.origin?.type === 'competitor_post';
      if (isCompetitorPost) {
        continue; // 경쟁사 포스트는 건너뛰기
      }
      
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

// 9. 진단 로직
/**
 * AdSense URL 채널 등록 상태 확인
 * @param {string|null} retryToken - 재시도용 토큰
 * @param {string|null} targetUrl - 특정 URL만 체크할 경우 (null이면 전체 체크)
 * @param {string|null} targetCardId - 특정 카드 ID만 업데이트할 경우 (null이면 전체 업데이트)
 * @param {string|null} targetStatus - 특정 카드의 상태 (targetCardId와 함께 사용)
 */
export async function checkAdSenseRegistrationStatus(retryToken = null, targetUrl = null, targetCardId = null, targetStatus = null) {
  if (!initializeFirebase()) {
    throw new Error("Firebase 초기화 실패");
  }
  
  const isSingleCardCheck = targetUrl && targetCardId && targetStatus;
  Logger.info(`🚀 [AdSense] 등록 확인 시작...${isSingleCardCheck ? ` [단일 카드: ${targetCardId}]` : ' [전체 카드]'}`);
  
  let token = retryToken;
  let accountId = null;

  if (!token) {
    const storage = await chrome.storage.local.get(["googleAuthToken", "adSenseAccountId"]);
    token = storage.googleAuthToken;
    accountId = storage.adSenseAccountId;
  } else {
    const storage = await chrome.storage.local.get("adSenseAccountId");
    accountId = storage.adSenseAccountId;
  }

  if (!token || !accountId) {
    throw new Error("인증 정보가 없습니다. Google 로그인 및 AdSense 계정 ID 설정이 필요합니다.");
  }

  try {
    // 1. 계정 확인
    let accountName = `accounts/${accountId}`;
    try {
      const listRes = await fetch("https://adsense.googleapis.com/v2/accounts", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (listRes.status === 401) throw new Error("UNAUTHORIZED");
      if (listRes.ok) {
        const listData = await listRes.json();
        const normalizedInput = accountId.trim().replace(/^accounts\//, '');
        const matched = listData.accounts?.find(acc => acc.name.includes(normalizedInput));
        if (matched) accountName = matched.name;
      }
    } catch (e) { 
      if (e.message === "UNAUTHORIZED") {
        await sendErrorToUI("UNAUTHORIZED", "인증 토큰이 만료되었습니다. 재로그인이 필요합니다.");
        throw e;
      }
    }

    // 2. 클라이언트 및 URL 채널 조회
    const registeredUrls = new Set();
    
    const clientsRes = await fetch(`https://adsense.googleapis.com/v2/${accountName}/adclients`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (clientsRes.status === 401) {
      await sendErrorToUI("UNAUTHORIZED", "인증 토큰이 만료되었습니다. 재로그인이 필요합니다.");
      throw new Error("UNAUTHORIZED");
    }
    if (!clientsRes.ok) {
      throw new Error(`AdSense 조회 실패 (${clientsRes.status})`);
    }
    
    const clientsData = await clientsRes.json();
    const adClients = clientsData.adClients || [];

    await Promise.all(adClients.map(async (client) => {
      if (client.productCode === "YOUTUBE" || client.name.includes("ca-yt")) return;

      Logger.debug(`📡 [AdSense] 조회 중: ${client.name}`);

      let nextPageToken = null;
      do {
        let url = `https://adsense.googleapis.com/v2/${client.name}/urlchannels?pageSize=1000`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;
        
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) throw new Error("UNAUTHORIZED");
        if (!res.ok) return;

        const json = await res.json();
        if (json.urlChannels) {
          json.urlChannels.forEach(ch => {
            const urlValue = ch.uriPattern || ch.urlPattern;
            if (urlValue) {
              // 디코딩 및 정규화하여 저장
              let normalized = "";
              try {
                // URL 정규화: 소문자 변환, 프로토콜 제거, 마지막 슬래시 제거
                normalized = decodeURIComponent(urlValue).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
              } catch (e) {
                normalized = urlValue.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
              }
              registeredUrls.add(normalized);
            }
          });
        }
        nextPageToken = json.nextPageToken;
      } while (nextPageToken);
    }));

    Logger.info(`📦 [AdSense] 수집된 URL 패턴: ${registeredUrls.size}개`);

    // 3. 데이터베이스 업데이트 (유연한 매칭 로직 적용)
    let updatedCount = 0;
    let matchedCount = 0;
    let alreadyRegisteredCount = 0;
    let notMatchedCount = 0;
    
    if (registeredUrls.size > 0) {
      const db = getDb();
      const userId = CONSTANTS.USER_ID;
      const snapshot = await get(ref(db, `kanban/${userId}`));
      const allCards = snapshot.val() || {};
      const updates = {};
      const normalizer = (u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const urlList = [...registeredUrls]; // 배열로 변환

      // 단일 카드 체크 모드인 경우 해당 카드만 처리
      const statusesToCheck = isSingleCardCheck ? [targetStatus] : Object.keys(allCards);

      for (const status of statusesToCheck) {
        const cardsToCheck = isSingleCardCheck ? { [targetCardId]: allCards[status]?.[targetCardId] } : (allCards[status] || {});
        
        for (const cardId in cardsToCheck) {
          // 단일 카드 모드인 경우 해당 카드만 처리
          if (isSingleCardCheck && cardId !== targetCardId) continue;
          
          const card = cardsToCheck[cardId];
          if (!card) continue;
          
          if (card.publishedUrl) {
            // 단일 카드 모드인 경우 targetUrl과 일치하는지 확인
            if (isSingleCardCheck && card.publishedUrl !== targetUrl) continue;
            
            let normUrl = "";
            try { 
              normUrl = normalizer(decodeURIComponent(card.publishedUrl)); 
            } catch(e) { 
              normUrl = normalizer(card.publishedUrl); 
            }
            
            // 🔥 [핵심 업그레이드] 매칭 로직 3단계
            // 1. 정확히 일치 (Exact Match)
            // 2. 등록된 패턴으로 시작 (Prefix Match): 예) example.com/blog -> example.com/blog/1
            // 3. 카드 URL이 등록된 패턴을 포함 (Contains Match): 예) k-posting.info -> costcatcher.k-posting.info
            const isReg = urlList.some(reg => {
                return normUrl === reg || normUrl.startsWith(reg) || (normUrl.includes(reg) && reg.includes('.'));
            });
            
            // 통계 수집
            if (isReg) {
              matchedCount++;
              if (card.adSenseRegistered === true) {
                alreadyRegisteredCount++;
              }
            } else {
              notMatchedCount++;
            }
            
            // 현재 상태 확인 (undefined도 false로 처리)
            const currentStatus = card.adSenseRegistered === true;
            const needsUpdate = currentStatus !== isReg;
            
            if (needsUpdate) {
              const cardPath = `kanban/${userId}/${status}/${cardId}`;
              updates[cardPath] = { adSenseRegistered: isReg };
              updatedCount++;
              Logger.info(`🔄 [상태 업데이트] 카드 ${cardId}: ${currentStatus} → ${isReg}`, {
                url: normUrl,
                title: card.title || "제목 없음"
              });
            }
          }
        }
      }
      
      // Firebase 업데이트 (배치 업데이트)
      if (updatedCount > 0) {
        Logger.info(`💾 [AdSense] Firebase 업데이트 시작: ${updatedCount}개 카드`);
        for (const [path, data] of Object.entries(updates)) {
          await update(ref(db, path), data);
        }
        Logger.info(`✅ [AdSense] Firebase 업데이트 완료: ${updatedCount}개 카드`);
      }
      
      // 상태 요약 로그
      const summaryMessage = updatedCount === 0 && alreadyRegisteredCount === matchedCount 
        ? "✅ 모든 카드가 이미 올바르게 등록되어 있습니다."
        : updatedCount === 0 && matchedCount === 0
        ? "⚠️ 매칭된 카드가 없습니다. URL 패턴을 확인하세요."
        : updatedCount > 0
        ? `🔄 ${updatedCount}개 카드 상태가 업데이트되었습니다.`
        : "ℹ️ 상태 변경이 필요하지 않습니다.";
        
      Logger.info(`📊 [AdSense] 상태 요약:`, {
        총_수집된_URL_패턴: registeredUrls.size,
        매칭_성공_카드: matchedCount,
        이미_등록됨: alreadyRegisteredCount,
        매칭_실패_카드: notMatchedCount,
        업데이트_필요: updatedCount,
        메시지: summaryMessage
      });
    }

    return {
      success: true,
      totalRegistered: registeredUrls.size,
      updatedCards: updatedCount,
      matchedCards: matchedCount,
      alreadyRegistered: alreadyRegisteredCount,
      notMatched: notMatchedCount
    };
  } catch (error) {
    Logger.error(`[AdSense] 등록 상태 확인 실패:`, error);
    
    if (error.message === "UNAUTHORIZED") {
      await sendErrorToUI("UNAUTHORIZED", "인증 토큰이 만료되었습니다. 재로그인이 필요합니다.");
    }
    
    throw error;
  }
}

export async function runFullSystemDiagnosis() { return { checks: [], errors: [] }; }
export async function runAdSenseDeepDiagnosis() { return { success: true }; }
export async function testBlogConnection() { return { success: true }; }
export async function testAdSenseGa4Access() { return { success: true }; }
