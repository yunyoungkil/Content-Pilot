// js/services/analyticsService.js
// 데이터 분석 서비스 (AI 호출 없음, 순수 데이터 계산만)

import { getDb, CONSTANTS, initializeFirebase } from './firebaseService.js';
import { ref, get, update, remove } from 'firebase/database';

// UI에 에러 메시지를 전송하는 헬퍼 함수
export async function sendErrorToUI(errorType, message) {
  try {
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (tabs && tabs.length > 0 && tabs[0].id) {
      let userFriendlyMessage = message;
      let icon = "⚠️";
      
      switch (errorType) {
        case "TOKEN_EXPIRED":
          userFriendlyMessage = "🔑 인증 토큰이 만료되었습니다. 잠시 후 자동으로 갱신됩니다.";
          icon = "🔑";
          break;
        case "QUOTA_EXCEEDED":
          userFriendlyMessage = "📊 API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.";
          icon = "📊";
          break;
        case "API_KEY_MISSING":
          userFriendlyMessage = "🔑 API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
          icon = "🔑";
          break;
        case "UNAUTHORIZED":
        case "FORBIDDEN":
          userFriendlyMessage = "인증 실패: 토큰이 만료되었습니다 (재로그인 필요)";
          icon = "🔴";
          break;
        case "API_ERROR":
          userFriendlyMessage = `⚠️ ${message || "API 호출 중 오류가 발생했습니다."}`;
          icon = "⚠️";
          break;
        default:
          userFriendlyMessage = `⚠️ ${message || "오류가 발생했습니다."}`;
          icon = "⚠️";
      }
      
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "show_error_toast",
        errorType: errorType,
        message: userFriendlyMessage,
        icon: icon
      }).catch((err) => {
        console.warn("[sendErrorToUI] 메시지 전송 실패:", err);
      });
    }
  } catch (error) {
    console.error("[sendErrorToUI] 에러 전송 실패:", error);
  }
}

// 1. 데이터 수집 함수 (GA4, AdSense)
// TODO: background.js에서 getAnalyticsData, getAdsenseData 함수 이동 필요
export async function getAnalyticsData(token, propertyId, url, retryCount = 0, useEncodedPath = false, excludePublisherMetrics = false, excludeAverageEngagementTime = false) {
  // TODO: background.js에서 함수 복사 필요
  return { pageviews: 0, gaEarnings: 0 };
}

export async function getAdsenseData(token, accountId, url, retryCount = 0) {
  // TODO: background.js에서 함수 복사 필요
  return { estimatedEarnings: 0, pageViews: 0 };
}

// 2. 성과 지표 업데이트 (단건)
// TODO: background.js에서 updateSinglePerformanceMetric 함수 이동 필요
export async function updateSinglePerformanceMetric(contentInfo) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[analyticsService] updateSinglePerformanceMetric: 함수 구현 필요");
}

// 3. 성과 지표 업데이트 (전체)
// TODO: background.js에서 updateAllPerformanceMetrics 함수 이동 필요
export async function updateAllPerformanceMetrics() {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[analyticsService] updateAllPerformanceMetrics: 함수 구현 필요");
}

// 4. 성과 분석 (AI 호출 없이 데이터만 가공해서 리턴)
export async function analyzePerformanceData(targetChannelId = null) {
  try {
    if (!initializeFirebase()) {
      console.error('[analyzePerformanceData] Firebase가 로드되지 않았습니다.');
      return { analysis: null, decayContent: null };
    }
    
    const userId = CONSTANTS.USER_ID;
    const db = getDb();
    const kanbanRef = ref(db, `kanban/${userId}`);
    const snapshot = await get(kanbanRef);
    const allCards = snapshot.val() || {};
    
    const performanceData = [];
    const now = Date.now();
    
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        
        if (card.performance && !card.performance.error && card.publishedUrl) {
          if (targetChannelId !== null && card.channelId !== targetChannelId) {
            continue;
          }
          
          const createdAt = card.createdAt || 0;
          const daysSinceCreation = (now - createdAt) / (24 * 60 * 60 * 1000);
          
          performanceData.push({
            cardId: cardId,
            title: card.title || "제목 없음",
            earnings: card.performance.estimatedEarnings || 0,
            pageviews: card.performance.pageviews || 0,
            sessions: card.performance.sessions || 0,
            avgDuration: card.performance.avgSessionDuration || 0,
            ctr: card.performance.ctr || 0,
            bounceRate: card.performance.bounceRate || 0,
            tags: card.tags || [],
            createdAt: createdAt,
            daysSinceCreation: daysSinceCreation,
            publishedUrl: card.publishedUrl,
            channelId: card.channelId || null,
          });
        }
      }
    }
    
    if (performanceData.length === 0) {
      return { analysis: null, decayContent: null };
    }
    
    // 성과 데이터 정렬
    const sortedByEarnings = [...performanceData].sort((a, b) => b.earnings - a.earnings);
    const sortedByPageviews = [...performanceData].sort((a, b) => b.pageviews - a.pageviews);
    
    const top5ByEarnings = sortedByEarnings.slice(0, 5);
    const top5ByPageviews = sortedByPageviews.slice(0, 5);
    
    // 평균 성과 계산
    const avgEarnings = performanceData.reduce((sum, item) => sum + item.earnings, 0) / performanceData.length;
    const avgPageviews = performanceData.reduce((sum, item) => sum + item.pageviews, 0) / performanceData.length;
    const avgDuration = performanceData.reduce((sum, item) => sum + item.avgDuration, 0) / performanceData.length;
    
    // 성공 패턴 분석
    const topTags = {};
    top5ByEarnings.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          topTags[tag] = (topTags[tag] || 0) + 1;
        });
      }
    });
    
    const topTagsList = Object.entries(topTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => tag)
      .join(", ");
    
    // 콘텐츠 부패(Content Decay) 식별
    const decayCandidates = performanceData
      .filter(item => {
        const isOld = item.daysSinceCreation >= 90;
        const hadHighPerformance = item.earnings > avgEarnings * 1.5 || item.pageviews > avgPageviews * 1.5;
        return isOld && hadHighPerformance;
      })
      .sort((a, b) => {
        const scoreA = a.earnings * 0.6 + a.pageviews * 0.4;
        const scoreB = b.earnings * 0.6 + b.pageviews * 0.4;
        return scoreB - scoreA;
      })
      .slice(0, 5);
    
    // AI 분석 텍스트 생성 부분은 제거 (순수 데이터만 반환)
    // AI 분석이 필요하면 aiService에서 이 함수를 호출한 뒤 2차 가공함
    
    const decayContent = decayCandidates.length > 0 ? decayCandidates.map(item => ({
      cardId: item.cardId,
      title: item.title,
      earnings: item.earnings,
      pageviews: item.pageviews,
      daysSinceCreation: Math.round(item.daysSinceCreation),
      publishedUrl: item.publishedUrl,
      tags: item.tags || [],
      channelId: item.channelId
    })) : null;
    
    return { 
      // analysis: "AI 분석은 aiService에서 수행", 
      decayContent: decayContent 
    };
  } catch (error) {
    console.error("[성과 데이터 분석 실패]", error);
    return { analysis: null, decayContent: null };
  }
}

// 5. 사용자 피드백 패턴 (데이터만 리턴)
export async function getUserFeedbackPatterns() {
  try {
    const userId = CONSTANTS.USER_ID;
    const db = getDb();
    const kanbanRef = ref(db, `kanban/${userId}`);
    const snapshot = await get(kanbanRef);
    const allCards = snapshot.val() || {};
    
    const adoptedIdeas = [];
    const ignoredIdeas = [];
    
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        const isAiIdea = card.tags && Array.isArray(card.tags) && card.tags.includes("#AI-추천");
        
        if (!isAiIdea) continue;
        
        const createdAt = card.createdAt || 0;
        const daysSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
        
        if (status === "ideas" && daysSinceCreation > 7 && !card.draftContent) {
          ignoredIdeas.push({
            title: card.title || "제목 없음",
            tags: card.tags || [],
            daysSinceCreation: Math.round(daysSinceCreation),
          });
        } else if ((status === "in-progress" || status === "done") || card.draftContent) {
          adoptedIdeas.push({
            title: card.title || "제목 없음",
            tags: card.tags || [],
            status: status,
          });
        }
      }
    }
    
    if (adoptedIdeas.length === 0 && ignoredIdeas.length === 0) {
      return null;
    }
    
    // 채택된 아이디어의 태그 분석
    const adoptedTags = {};
    adoptedIdeas.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          if (tag !== "#AI-추천") {
            adoptedTags[tag] = (adoptedTags[tag] || 0) + 1;
          }
        });
      }
    });
    
    // 무시된 아이디어의 태그 분석
    const ignoredTags = {};
    ignoredIdeas.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          if (tag !== "#AI-추천") {
            ignoredTags[tag] = (ignoredTags[tag] || 0) + 1;
          }
        });
      }
    });
    
    const preferredTags = Object.entries(adoptedTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => `${tag} (${count}회 채택)`)
      .join(", ");
    
    const avoidedTags = Object.entries(ignoredTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag, count]) => `${tag} (${count}회 무시)`)
      .join(", ");
    
    return `
사용자 피드백 패턴 분석:

[채택된 AI 아이디어] (${adoptedIdeas.length}개)
- 사용자가 실제로 작업을 시작하거나 완료한 AI 추천 아이디어입니다.
- 선호하는 태그/주제: ${preferredTags || "없음"}

[무시된 AI 아이디어] (${ignoredIdeas.length}개)
- 7일 이상 아이디어 상태로 남아있어 사용자가 관심을 보이지 않은 아이디어입니다.
- 회피하는 태그/주제: ${avoidedTags || "없음"}

[권장 사항]
- 선호하는 태그와 주제를 중심으로 아이디어를 제안해주세요.
- 회피하는 태그와 주제는 피하거나, 더 매력적인 각도로 재구성하여 제안해주세요.
`;
  } catch (error) {
    console.error("[사용자 피드백 패턴 분석 실패]", error);
    return null;
  }
}

// 6. 진단 로직
// TODO: background.js에서 checkAdSenseRegistrationStatus, runFullSystemDiagnosis 함수 이동 필요
export async function checkAdSenseRegistrationStatus(retryToken = null, targetUrl = null, targetCardId = null, targetStatus = null) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[analyticsService] checkAdSenseRegistrationStatus: 함수 구현 필요");
}

export async function runFullSystemDiagnosis() {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[analyticsService] runFullSystemDiagnosis: 함수 구현 필요");
}

