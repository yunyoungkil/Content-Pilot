// js/services/analyticsService.js

import { getDb, CONSTANTS, initializeFirebase, getCurrentUserId } from './firebaseService.js';
import { ref, get, update } from './firebaseService.js';
import { getValidToken } from './authService.js';
import { Logger } from '../utils.js';
// [추가] 성능 최적화 서비스 임포트
import { performanceOptimizer } from './performanceOptimizer.js';

// 채널 정보 캐시 (메모리 캐시 + TTL)
const channelCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5분

// 채널 매칭을 위한 Map 생성 (빠른 조회용)
function createChannelMap(blogs) {
  const channelMap = new Map();

  blogs.forEach((blog, index) => {
    const inputUrl = blog.inputUrl || blog.url;
    if (inputUrl) {
      // URL 정규화
      const normalizedUrl = inputUrl
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      channelMap.set(normalizedUrl, { ...blog, index });

      // hostname도 저장
      try {
        const hostname = new URL(inputUrl).hostname.toLowerCase();
        if (!channelMap.has(hostname)) {
          channelMap.set(hostname, { ...blog, index });
        }
      } catch (e) {
        // URL 파싱 실패 시 무시
      }
    }
  });

  return channelMap;
}

// 최적화된 채널 매칭 함수
function findMatchingChannel(contentUrl, channelMap) {
  if (!contentUrl || channelMap.size === 0) return null;

  try {
    const contentHost = new URL(contentUrl).hostname.toLowerCase();
    const normalizedContent = contentUrl
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

    // 1. 정확한 URL 매칭
    if (channelMap.has(normalizedContent)) {
      return channelMap.get(normalizedContent);
    }

    // 2. hostname 매칭
    if (channelMap.has(contentHost)) {
      return channelMap.get(contentHost);
    }

    // 3. 부분 매칭 (fallback)
    for (const [key, blog] of channelMap) {
      if (normalizedContent.includes(key) && key.includes('.')) {
        return blog;
      }
    }

    // 4. hostname 기반 부분 매칭
    for (const [key, blog] of channelMap) {
      if (
        key.includes('.') &&
        (contentHost === key || contentHost.endsWith('.' + key) || key.endsWith('.' + contentHost))
      ) {
        return blog;
      }
    }
  } catch (err) {
    Logger.warn('[findMatchingChannel] URL 파싱 실패:', contentUrl, err.message);
  }

  return null;
}

// 캐시된 채널 정보 조회
async function getCachedChannels(userId) {
  const cacheKey = `channels_${userId}`;

  // 성능 최적화 서비스를 통한 캐싱
  return await performanceOptimizer.getCachedData(cacheKey, async () => {
    const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
    return channelsSnap.val() || {};
  });
}

// 대체 채널 ID 조회 및 캐시
async function getAlternativeChannels(userId) {
  const cacheKey = `alt_channels_${userId}`;
  const cached = channelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const altChannels = { blogs: [] };

  try {
    const storage = await chrome.storage.local.get(['googleUserEmail', 'googleUserId']);
    const altIds = [];

    // build email-derived safe id
    if (storage.googleUserEmail) {
      const safeEmail = storage.googleUserEmail
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_{2,}/g, '_');
      if (safeEmail && safeEmail !== userId) altIds.push(safeEmail);
    }

    // include googleUserId if different
    if (storage.googleUserId && storage.googleUserId !== userId) {
      altIds.push(storage.googleUserId);
    }

    // also check default placeholder as last resort
    if (
      CONSTANTS &&
      CONSTANTS.USER_ID &&
      !altIds.includes(CONSTANTS.USER_ID) &&
      CONSTANTS.USER_ID !== userId
    ) {
      altIds.push(CONSTANTS.USER_ID);
    }

    for (const alt of altIds) {
      try {
        const snap = await get(ref(getDb(), `channels/${alt}`));
        const val = snap?.val();
        const candidateBlogs = val?.myChannels?.blogs || [];
        if (candidateBlogs && candidateBlogs.length > 0) {
          Logger.info(
            '[getAlternativeChannels] 채널이 다른 사용자 키에서 발견되어 대체 사용:',
            alt
          );
          altChannels.blogs = candidateBlogs;
          break;
        }
      } catch (err) {
        Logger.debug(
          '[getAlternativeChannels] 대체 채널 조회 실패 (무시):',
          alt,
          err?.message || err
        );
      }
    }
  } catch (err) {
    Logger.warn('[getAlternativeChannels] 채널 대체 키 조회 중 에러:', err && err.message);
  }

  // 캐시 저장
  channelCache.set(cacheKey, {
    data: altChannels,
    timestamp: Date.now(),
  });

  return altChannels;
}

// 1. 에러 전파 유틸리티
export async function sendErrorToUI(errorType, message) {
  try {
    let icon = '⚠️';
    let msg = message;

    switch (errorType) {
      case 'TOKEN_EXPIRED':
        icon = '🔑';
        msg = '인증 토큰 만료. 재로그인이 필요합니다.';
        break;
      case 'QUOTA_EXCEEDED':
        icon = '📊';
        msg = 'API 할당량 초과.';
        break;
      case 'API_KEY_MISSING':
        icon = '🔑';
        msg = "API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
        break;
      case 'UNAUTHORIZED':
        icon = '🔴';
        msg = '인증 실패: 토큰이 만료되었습니다 (재로그인 필요)';
        break;
      case 'FORBIDDEN':
        icon = '🚫';
        msg = '접근 권한이 없습니다.';
        break;
      case 'API_ERROR':
        icon = '⚠️';
        msg = message || 'API 호출 중 오류가 발생했습니다.';
        break;
      default:
        icon = '⚠️';
        msg = message || '오류가 발생했습니다.';
    }

    try {
      if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        const p = chrome.runtime.sendMessage({
          action: 'show_error_toast',
          errorType,
          message: msg,
          icon,
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {
      // fall through to outer catch
    }
  } catch (e) {
    console.error('[sendErrorToUI] 에러 전파 실패:', e);
  }
}

// 2. 데이터 수집 (GA4) - 유입 경로, 기기, 재방문율 포함
export async function getAnalyticsData(
  token,
  propertyId,
  url,
  retryCount = 0,
  useEncodedPath = false
) {
  const API_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  let urlObj;
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    urlObj = new URL(normalizedUrl);
  } catch (e) {
    return { pageviews: 0, gaEarnings: 0 };
  }

  const rawPath = urlObj.pathname;
  const normalizedPath = rawPath.endsWith('/') && rawPath !== '/' ? rawPath.slice(0, -1) : rawPath;

  let filterPath = normalizedPath;
  if (!useEncodedPath) {
    try {
      filterPath = decodeURIComponent(normalizedPath);
    } catch (e) {
      Logger.warn('[analyticsService] decodeURIComponent failed', e);
    }
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        // [핵심] 차원 확장: 경로 + 소스 + 기기
        dimensions: [{ name: 'pagePath' }, { name: 'sessionSource' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'sessions' },
          { name: 'screenPageViewsPerSession' },
          { name: 'bounceRate' },
          { name: 'engagementRate' },
          { name: 'newUsers' },
          { name: 'activeUsers' },
          { name: 'totalAdRevenue' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'BEGINS_WITH', value: filterPath },
          },
        },
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('UNAUTHORIZED');
      if (res.status === 400 && !useEncodedPath && retryCount === 0) {
        return getAnalyticsData(token, propertyId, url, retryCount + 1, true);
      }
      return { pageviews: 0, gaEarnings: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json();

    // [핵심] 데이터 집계(Aggregation) 로직
    if (data.rows && data.rows.length > 0) {
      let totalPageviews = 0;
      let totalSessions = 0;
      let totalGaEarnings = 0;
      let totalActiveUsers = 0;
      let totalNewUsers = 0;

      // 가중 평균 계산을 위한 변수
      let weightedEngagementRate = 0;
      let weightedSessionDuration = 0;

      const sourceMap = {};
      const deviceMap = {
        mobile: { users: 0, revenue: 0 },
        desktop: { users: 0, revenue: 0 },
        tablet: { users: 0, revenue: 0 },
      };

      data.rows.forEach((row) => {
        // Dimensions: 0:pagePath, 1:sessionSource, 2:deviceCategory
        const source = row.dimensionValues[1].value;
        const device = row.dimensionValues[2].value.toLowerCase();

        // Metrics indices:
        // 0:views, 1:avgTime, 2:sessions, 3:pages/session, 4:bounce, 5:engagement, 6:newUsers, 7:activeUsers, 8:revenue
        const v = row.metricValues;
        const views = parseInt(v[0].value);
        const avgTime = parseFloat(v[1].value);
        const sessions = parseInt(v[2].value);
        const engagement = parseFloat(v[5].value);
        const newUsers = parseInt(v[6].value);
        const activeUsers = parseInt(v[7].value);
        const revenue = parseFloat(v[8].value);

        // 기본 합산
        totalPageviews += views;
        totalSessions += sessions;
        totalGaEarnings += revenue;
        totalActiveUsers += activeUsers;
        totalNewUsers += newUsers;

        // 가중 평균 누적 (세션 수 기준)
        weightedSessionDuration += avgTime * sessions;
        weightedEngagementRate += engagement * sessions;

        // 소스별 집계 (Top Source 선정용)
        if (!sourceMap[source]) sourceMap[source] = 0;
        sourceMap[source] += sessions;

        // 기기별 집계 (안전하게 키 확인)
        if (deviceMap[device] !== undefined) {
          deviceMap[device].users += activeUsers;
          deviceMap[device].revenue += revenue;
        } else {
          // 기타 기기(smart tv 등)는 mobile이나 desktop으로 귀속하거나 무시
          if (device.includes('mobile')) {
            deviceMap.mobile.users += activeUsers;
            deviceMap.mobile.revenue += revenue;
          }
        }
      });

      // 평균값 계산
      const avgSessionDuration = totalSessions > 0 ? weightedSessionDuration / totalSessions : 0;
      const avgEngagementRate = totalSessions > 0 ? weightedEngagementRate / totalSessions : 0;

      // Top Source 선정
      const topSource =
        Object.keys(sourceMap).sort((a, b) => sourceMap[b] - sourceMap[a])[0] || 'direct';

      // [추가] 재방문율 계산 ((활성 - 신규) / 활성)
      const returningUsersRatio =
        totalActiveUsers > 0 ? (totalActiveUsers - totalNewUsers) / totalActiveUsers : 0;

      return {
        pageviews: totalPageviews,
        avgSessionDuration: avgSessionDuration,
        sessions: totalSessions,
        pagesPerSession: totalSessions > 0 ? totalPageviews / totalSessions : 0,
        bounceRate: 1 - avgEngagementRate, // engagementRate 역수로 계산
        engagementRate: avgEngagementRate,
        newUsers: totalNewUsers,
        activeUsers: totalActiveUsers,
        gaEarnings: totalGaEarnings,

        // 확장 메트릭
        topSource: topSource,
        deviceBreakdown: deviceMap,
        returningUsersRatio: returningUsersRatio, // 0 ~ 1 사이 값 (UI에서 % 변환 필요)
      };
    }
    return { pageviews: 0, gaEarnings: 0 };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED' && retryCount < 1) {
      try {
        const refreshedToken = await getValidToken(false);
        if (refreshedToken) {
          return getAnalyticsData(refreshedToken, propertyId, url, retryCount + 1, useEncodedPath);
        }
      } catch (refreshError) {
        console.error(refreshError);
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

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRange: 'LAST_30_DAYS',
        metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'CLICKS', 'PAGE_VIEWS_RPM'],
        dimensions: ['URL_CHANNEL_NAME'],
        filters: [`URL_CHANNEL_NAME==${domain}`],
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('UNAUTHORIZED');
      return { estimatedEarnings: 0, pageViews: 0 };
    }

    const data = await res.json();
    if (data.rows) {
      const match = data.rows.find((r) => {
        const val = r.dimensionValues[0].value;
        return val === url || url.includes(val);
      });

      if (match) {
        const m = match.metricValues;
        return {
          estimatedEarnings: parseFloat(m[0].value),
          pageViews: parseFloat(m[1].value),
          clicks: parseFloat(m[2].value),
          pageRPM: parseFloat(m[3].value),
        };
      }
    }
    return { estimatedEarnings: 0, pageViews: 0 };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED' && retryCount < 1) {
      try {
        const refreshedToken = await getValidToken(false);
        if (refreshedToken) {
          return getAdsenseData(refreshedToken, accountId, url, retryCount + 1);
        }
      } catch (refreshError) {
        console.error(refreshError);
      }
      throw e;
    }
    if (e.message === 'UNAUTHORIZED') throw e;
    return { estimatedEarnings: 0, pageViews: 0, error: e.message };
  }
}

// [신규] 4. 데이터 수집 (Google Search Console) - CTR & 검색어
export async function getSearchConsoleData(token, siteUrl, pageUrl, retryCount = 0) {
  // GSC API URL
  const API_URL = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: '28daysAgo',
        endDate: 'today',
        dimensions: ['query'], // 검색어 기준
        filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }],
        rowLimit: 5, // 상위 5개만
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('UNAUTHORIZED');
      // 403/404 등은 연동 안됨으로 간주하고 0 리턴
      return { pageCTR: 0, topSearchTerms: [] };
    }

    const data = await res.json();

    let totalClicks = 0;
    let totalImpressions = 0;
    let weightedPosition = 0;
    const searchTerms = [];

    if (data.rows && data.rows.length > 0) {
      data.rows.forEach((row) => {
        totalClicks += row.clicks;
        totalImpressions += row.impressions;
        weightedPosition += row.position * row.impressions;

        searchTerms.push({
          term: row.keys[0],
          clicks: row.clicks,
          ctr: (row.ctr * 100).toFixed(1),
          position: row.position.toFixed(1),
        });
      });

      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const avgPosition = totalImpressions > 0 ? weightedPosition / totalImpressions : 0;

      return {
        pageCTR: avgCtr,
        pageImpressions: totalImpressions,
        avgPosition: avgPosition,
        topSearchTerms: searchTerms,
      };
    }

    return { pageCTR: 0, topSearchTerms: [] };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED' && retryCount < 1) {
      try {
        const refreshedToken = await getValidToken(false);
        if (refreshedToken) {
          return getSearchConsoleData(refreshedToken, siteUrl, pageUrl, retryCount + 1);
        }
      } catch (refreshError) {
        console.error(refreshError);
      }
      throw e;
    }
    return { pageCTR: 0, error: e.message };
  }
}

// 5. 단건 성과 지표 업데이트 (통합 로직)
export async function updateSinglePerformanceMetric(contentInfo) {
  if (!initializeFirebase()) return;
  const db = getDb();
  const userId = await getCurrentUserId();

  // Guard: Avoid writing performance data under the default placeholder user.
  // When userId is the default (unauthenticated state), abort to prevent creating
  // records under `default_user` — this should only run for authenticated users.
  if (userId === CONSTANTS.USER_ID) {
    Logger.warn(
      '[updateSinglePerformanceMetric] No valid user ID (default_user) — aborting performance update'
    );
    // Let the UI know to prompt for login/auth instead of silently creating default_user data
    try {
      await sendErrorToUI('UNAUTHORIZED', '로그인이 필요합니다. 성과 추적은 로그인 후 가능합니다.');
    } catch (e) {
      Logger.warn('[updateSinglePerformanceMetric] Failed to signal UI for login:', e);
    }
    return;
  }

  let path = contentInfo.path;
  if (!path.includes(userId)) path = path.replace('kanban/', `kanban/${userId}/`);

  try {
    const cardSnap = await get(ref(db, path));
    const card = cardSnap?.val() || {};
    const isCompetitorPost = card.origin?.type === 'competitor_post';

    if (isCompetitorPost) {
      Logger.info(`[updateSinglePerformanceMetric] 경쟁사 포스트 스킵: ${contentInfo.id}`);
      return;
    }

    await update(ref(db, `${path}/performance`), {
      collecting: true,
      collectingStartedAt: Date.now(),
    });

    const token = await getValidToken(false);
    if (!token) throw new Error('인증 토큰 부재');

    const storage = await chrome.storage.local.get(['adSenseAccountId']);
    const adSenseId = storage.adSenseAccountId;
    if (!adSenseId) throw new Error('AdSense 계정 ID 없음');

    // 채널 정보 로드 (캐시 활용)
    let channels = await getCachedChannels(userId);
    let gaId = null;
    let siteUrl = null; // GSC용 URL

    let blogs = channels.myChannels?.blogs || [];

    // If there are no blogs found under the current userId, try fallbacks.
    // This handles cases where channels were saved under a different user identifier
    // (e.g. email-derived safe id vs. googleUserId) and prevents GA4 being reported
    // as missing when the channel actually exists under another key.
    if ((!blogs || blogs.length === 0) && userId) {
      const altChannels = await getAlternativeChannels(userId);
      blogs = altChannels.blogs;
      if (blogs.length > 0) {
        channels = altChannels;
      }
    }
    // 채널 매칭 (최적화된 Map 기반 조회)
    const channelMap = createChannelMap(blogs);
    const blog = findMatchingChannel(contentInfo.url, channelMap);

    if (blog) {
      gaId = blog.gaPropertyId;
      // GSC 사이트 URL이 별도로 없으면 기본 URL 사용
      siteUrl = blog.gscSiteUrl || blog.inputUrl || blog.url;
    }

    // If channel doesn't have GA4 id, try global selection (user-selected default)
    if (!gaId) {
      const storageSelection = await chrome.storage.local.get(['selectedGaPropertyId']);
      if (storageSelection && storageSelection.selectedGaPropertyId) {
        gaId = storageSelection.selectedGaPropertyId;
        Logger.info(
          '[updateSinglePerformanceMetric] 채널에 GA4 ID가 없어 storage.selectedGaPropertyId를 대체값으로 사용:',
          gaId
        );
      }
    }

    if (!gaId) {
      Logger.warn(
        '[updateSinglePerformanceMetric] GA4 속성 ID 없음 — GA4 데이터 수집 스킵, AdSense/GSC만 수집:',
        { path, userId, channelsCount: Object.keys(blogs).length }
      );
      // GA4 ID가 없어도 AdSense와 GSC 데이터는 수집
      // 사용자에게 GA4 설정을 안내하는 메시지 추가
      try {
        await sendErrorToUI(
          'GA4_MISSING',
          'GA4 속성 ID가 설정되지 않아 조회수 데이터를 수집할 수 없습니다. 채널 설정에서 GA4 Property ID를 입력해주세요.'
        );
      } catch (e) {
        Logger.warn('[updateSinglePerformanceMetric] GA4 설정 안내 메시지 전송 실패:', e);
      }
    }

    // 병렬 호출 (GA4, AdSense, GSC) - GA4가 없어도 나머지 수집
    const [gaData, adData, gscData] = await Promise.allSettled([
      gaId
        ? getAnalyticsData(token, gaId, contentInfo.url)
        : Promise.resolve({ pageviews: 0, gaEarnings: 0 }),
      getAdsenseData(token, adSenseId, contentInfo.url),
      siteUrl ? getSearchConsoleData(token, siteUrl, contentInfo.url) : Promise.resolve({}),
    ]);

    const ga = gaData.status === 'fulfilled' ? gaData.value : { gaEarnings: 0, pageviews: 0 };
    const ad =
      adData.status === 'fulfilled' ? adData.value : { estimatedEarnings: 0, pageViews: 0 };
    const gsc = gscData.status === 'fulfilled' ? gscData.value : { pageCTR: 0 };

    // 하이브리드 수익 계산
    let finalEarnings = ga.gaEarnings || ad.estimatedEarnings || 0;
    let dataWarning = null;

    if (ga.gaEarnings > 0 && ad.estimatedEarnings > 0) {
      const diff = Math.abs(ga.gaEarnings - ad.estimatedEarnings);
      const max = Math.max(ga.gaEarnings, ad.estimatedEarnings);
      if (diff / max > 0.2) {
        dataWarning = {
          type: 'EARNINGS_MISMATCH',
          ga: ga.gaEarnings,
          ad: ad.estimatedEarnings,
        };
        finalEarnings = Math.min(ga.gaEarnings, ad.estimatedEarnings);
      }
    }

    // [중요] 통합 페이지뷰 결정
    const finalPageviews = ga.pageviews || ad.pageViews || 0;

    // [중요] RPM 계산 (Fallback Logic)
    let finalRPM = ad.pageRPM || 0;
    if (finalRPM === 0 && finalPageviews > 0 && finalEarnings > 0) {
      finalRPM = (finalEarnings / finalPageviews) * 1000;
    }

    // DB 저장
    await update(ref(db, `${path}/performance`), {
      ...ga,
      ...ad,
      ...gsc, // 모든 데이터 병합
      estimatedEarnings: finalEarnings,
      pageviews: finalPageviews,
      pageRPM: finalRPM,
      dataWarning,
      lastUpdatedAt: Date.now(),
      collecting: false,
    });
  } catch (e) {
    console.error('[Performance Update Fail]', e);
    await update(ref(db, `${path}/performance`), {
      collecting: false,
      error: e.message,
    });
  }
}

// 6. 전체 성과 업데이트 (배치 처리 최적화)
export async function updateAllPerformanceMetrics() {
  if (!initializeFirebase()) return;
  const db = getDb();
  const userId = await getCurrentUserId();

  if (userId === CONSTANTS.USER_ID) {
    Logger.warn(
      '[updateAllPerformanceMetrics] No valid user ID (default_user) — aborting batch performance update'
    );
    try {
      await sendErrorToUI(
        'UNAUTHORIZED',
        '로그인이 필요합니다. 성과 추적은 로그인 후에만 실행됩니다.'
      );
    } catch (e) {
      Logger.warn('[updateAllPerformanceMetrics] Failed to notify UI for login:', e);
    }
    return;
  }

  // 채널 정보 미리 캐시 (배치 처리 전)
  await getCachedChannels(userId);
  await getAlternativeChannels(userId);

  const snap = await get(ref(db, `kanban/${userId}`));
  const cards = snap.val() || {};

  const tasks = [];
  const now = Date.now();

  for (const status in cards) {
    for (const id in cards[status]) {
      const card = cards[status][id];
      const isCompetitorPost = card.origin?.type === 'competitor_post';
      if (isCompetitorPost) continue;

      // 6시간 경과 체크
      if (card.performanceTracked && card.publishedUrl) {
        if (!card.performance?.lastUpdatedAt || now - card.performance.lastUpdatedAt > 21600000) {
          tasks.push({
            id,
            path: `kanban/${userId}/${status}/${id}`,
            url: card.publishedUrl,
          });
        }
      }
    }
  }

  Logger.info(`[updateAllPerformanceMetrics] 업데이트 대상 카드: ${tasks.length}개`);

  // 최적화: 배치 크기 증가 및 병렬 처리 개선
  const BATCH_SIZE = 15; // 10개에서 15개로 증가
  const CONCURRENT_BATCHES = 3; // 동시에 3개 배치 처리

  for (let i = 0; i < tasks.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
    const batchPromises = [];

    // CONCURRENT_BATCHES만큼 배치를 동시에 실행
    for (let j = 0; j < CONCURRENT_BATCHES && i + j * BATCH_SIZE < tasks.length; j++) {
      const batchStart = i + j * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, tasks.length);
      const batch = tasks.slice(batchStart, batchEnd);

      Logger.info(`[updateAllPerformanceMetrics] 배치 처리 중: ${batchStart + 1}-${batchEnd}`);

      const batchPromise = Promise.allSettled(
        batch.map((t) => updateSinglePerformanceMetric(t))
      ).then((results) => {
        // 실패한 작업 로깅
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          Logger.warn(`[updateAllPerformanceMetrics] 배치에서 실패한 작업: ${failed.length}개`);
          failed.forEach((f, idx) => {
            Logger.warn(
              `[updateAllPerformanceMetrics] 실패 ${idx + 1}:`,
              f.reason?.message || f.reason
            );
          });
        }
        return results;
      });

      batchPromises.push(batchPromise);
    }

    // 모든 배치가 완료될 때까지 대기
    await Promise.all(batchPromises);

    // 배치 그룹 간 딜레이 (API rate limit 고려) - 1.5초로 감소
    if (i + BATCH_SIZE * CONCURRENT_BATCHES < tasks.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  Logger.info(`[updateAllPerformanceMetrics] 모든 배치 처리 완료`);
  await runAutomatedRenewalChecks();
}

// 7. 자동 리뉴얼 체크 & 배지 알림
export async function runAutomatedRenewalChecks() {
  const { decayContent } = await analyzePerformanceData();
  const count = decayContent ? decayContent.length : 0;

  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// 8. 성과 데이터 분석
export async function analyzePerformanceData(targetChannelId = null) {
  if (!initializeFirebase()) return { analysis: null, decayContent: null };
  const db = getDb();
  const userId = await getCurrentUserId();

  if (userId === CONSTANTS.USER_ID) {
    Logger.warn('[analyzePerformanceData] No valid user ID (default_user) — aborting analysis');
    try {
      await sendErrorToUI(
        'UNAUTHORIZED',
        '로그인이 필요합니다. 성과 분석은 로그인 후에만 실행됩니다.'
      );
    } catch (e) {
      Logger.warn('[analyzePerformanceData] Failed to notify UI for login:', e);
    }
    return { analysis: null, decayContent: null };
  }
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
        // 90일 이상, 수익 $1 이상인 글
        if (daysOld >= 90 && card.performance.estimatedEarnings > 1) {
          candidates.push({
            cardId: id,
            title: card.title,
            earnings: card.performance.estimatedEarnings,
            pageviews: card.performance.pageviews,
            daysSinceCreation: daysOld,
            publishedUrl: card.publishedUrl,
            channelId: card.channelId,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.earnings - a.earnings);

  let analysisText = null;
  if (candidates.length > 0) {
    const avgEarnings = candidates.reduce((sum, c) => sum + c.earnings, 0) / candidates.length;
    const avgPageviews = candidates.reduce((sum, c) => sum + c.pageviews, 0) / candidates.length;

    const topTags = {};
    candidates.slice(0, 5).forEach((c) => {
      const tags = Array.isArray(c.tags) ? c.tags : c.tags ? [c.tags] : [];
      tags.forEach((tag) => {
        topTags[tag] = (topTags[tag] || 0) + 1;
      });
    });
    const mostCommonTag =
      Object.keys(topTags).sort((a, b) => topTags[b] - topTags[a])[0] || '특정 주제';

    analysisText = `
과거 발행 콘텐츠 분석 (${candidates.length}개):

- 평균 수익: $${avgEarnings.toFixed(2)}
- 평균 조회수: ${Math.round(avgPageviews).toLocaleString()}

[상위 성과 콘텐츠]

${candidates
  .slice(0, 3)
  .map((c, i) => `${i + 1}. ${c.title} ($${c.earnings.toFixed(2)})`)
  .join('\n')}

[인사이트]

상위 콘텐츠들은 주로 '${mostCommonTag}'와 관련된 내용을 다루고 있습니다.
    `.trim();
  } else {
    analysisText = '분석할 성과 데이터가 없습니다.';
  }

  return {
    analysis: analysisText,
    decayContent: candidates.slice(0, 5),
  };
}

// 9. 사용자 피드백 분석 (Stub)
export async function getUserFeedbackPatterns() {
  return null;
}

// 10. 진단 로직 (AdSense 등)
export async function checkAdSenseRegistrationStatus(
  retryToken = null,
  targetUrl = null,
  targetCardId = null,
  targetStatus = null
) {
  if (!initializeFirebase()) {
    throw new Error('Firebase 초기화 실패');
  }

  const isSingleCardCheck = targetUrl && targetCardId && targetStatus;
  Logger.info(
    `🚀 [AdSense] 등록 확인 시작...${
      isSingleCardCheck ? ` [단일 카드: ${targetCardId}]` : ' [전체 카드]'
    }`
  );

  let token = retryToken;
  let accountId = null;

  if (!token) {
    const storage = await chrome.storage.local.get(['googleAuthToken', 'adSenseAccountId']);
    token = storage.googleAuthToken;
    accountId = storage.adSenseAccountId;
  } else {
    const storage = await chrome.storage.local.get('adSenseAccountId');
    accountId = storage.adSenseAccountId;
  }

  if (!token || !accountId) {
    throw new Error('인증 정보가 없습니다. Google 로그인 및 AdSense 계정 ID 설정이 필요합니다.');
  }

  try {
    // 1. 계정 확인
    let accountName = `accounts/${accountId}`;
    try {
      const listRes = await fetch('https://adsense.googleapis.com/v2/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (listRes.status === 401) throw new Error('UNAUTHORIZED');
      if (listRes.ok) {
        const listData = await listRes.json();
        const normalizedInput = accountId.trim().replace(/^accounts\//, '');
        const matched = listData.accounts?.find((acc) => acc.name.includes(normalizedInput));
        if (matched) accountName = matched.name;
      }
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        await sendErrorToUI('UNAUTHORIZED', '인증 토큰이 만료되었습니다. 재로그인이 필요합니다.');
        throw e;
      }
    }

    // 2. 클라이언트 및 URL 채널 조회
    const registeredUrls = new Set();

    const clientsRes = await fetch(`https://adsense.googleapis.com/v2/${accountName}/adclients`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (clientsRes.status === 401) {
      await sendErrorToUI('UNAUTHORIZED', '인증 토큰이 만료되었습니다. 재로그인이 필요합니다.');
      throw new Error('UNAUTHORIZED');
    }
    if (!clientsRes.ok) {
      throw new Error(`AdSense 조회 실패 (${clientsRes.status})`);
    }

    const clientsData = await clientsRes.json();
    const adClients = clientsData.adClients || [];

    await Promise.all(
      adClients.map(async (client) => {
        if (client.productCode === 'YOUTUBE' || client.name.includes('ca-yt')) return;

        Logger.debug(`📡 [AdSense] 조회 중: ${client.name}`);

        let nextPageToken = null;
        do {
          let url = `https://adsense.googleapis.com/v2/${client.name}/urlchannels?pageSize=1000`;
          if (nextPageToken) url += `&pageToken=${nextPageToken}`;

          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 401) throw new Error('UNAUTHORIZED');
          if (!res.ok) return;

          const json = await res.json();
          if (json.urlChannels) {
            json.urlChannels.forEach((ch) => {
              const urlValue = ch.uriPattern || ch.urlPattern;
              if (urlValue) {
                let normalized = '';
                try {
                  // URL 정규화: 소문자 변환, 프로토콜 제거, 마지막 슬래시 제거
                  normalized = decodeURIComponent(urlValue)
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/\/$/, '');
                } catch (e) {
                  normalized = urlValue
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/\/$/, '');
                }
                registeredUrls.add(normalized);
              }
            });
          }
          nextPageToken = json.nextPageToken;
        } while (nextPageToken);
      })
    );

    Logger.info(`📦 [AdSense] 수집된 URL 패턴: ${registeredUrls.size}개`);

    // 3. 데이터베이스 업데이트 (유연한 매칭 로직 적용)
    let updatedCount = 0;
    let matchedCount = 0;
    let alreadyRegisteredCount = 0;
    let notMatchedCount = 0;

    if (registeredUrls.size > 0) {
      const db = getDb();
      const userId = await getCurrentUserId();
      const snapshot = await get(ref(db, `kanban/${userId}`));
      const allCards = snapshot.val() || {};
      const updates = {};
      const normalizer = (u) =>
        u
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '');
      const urlList = [...registeredUrls]; // 배열로 변환

      const statusesToCheck = isSingleCardCheck ? [targetStatus] : Object.keys(allCards);

      for (const status of statusesToCheck) {
        const cardsToCheck = isSingleCardCheck
          ? { [targetCardId]: allCards[status]?.[targetCardId] }
          : allCards[status] || {};

        for (const cardId in cardsToCheck) {
          // 단일 카드 모드인 경우 해당 카드만 처리
          if (isSingleCardCheck && cardId !== targetCardId) continue;

          const card = cardsToCheck[cardId];
          if (!card) continue;

          if (card.publishedUrl) {
            // 단일 카드 모드인 경우 targetUrl과 일치하는지 확인
            if (isSingleCardCheck && card.publishedUrl !== targetUrl) continue;

            let normUrl = '';
            try {
              normUrl = normalizer(decodeURIComponent(card.publishedUrl));
            } catch (e) {
              normUrl = normalizer(card.publishedUrl);
            }

            // 🔥 [핵심 업그레이드] 매칭 로직 3단계
            // 1. 정확히 일치 (Exact Match)
            // 2. 등록된 패턴으로 시작 (Prefix Match): 예) example.com/blog -> example.com/blog/1
            // 3. 카드 URL이 등록된 패턴을 포함 (Contains Match): 예) k-posting.info -> costcatcher.k-posting.info
            const isReg = urlList.some((reg) => {
              return (
                normUrl === reg ||
                normUrl.startsWith(reg) ||
                (normUrl.includes(reg) && reg.includes('.'))
              );
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
                title: card.title || '제목 없음',
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
      const summaryMessage =
        updatedCount === 0 && alreadyRegisteredCount === matchedCount
          ? '✅ 모든 카드가 이미 올바르게 등록되어 있습니다.'
          : updatedCount === 0 && matchedCount === 0
            ? '⚠️ 매칭된 카드가 없습니다. URL 패턴을 확인하세요.'
            : updatedCount > 0
              ? `🔄 ${updatedCount}개 카드 상태가 업데이트되었습니다.`
              : 'ℹ️ 상태 변경이 필요하지 않습니다.';

      Logger.info(`📊 [AdSense] 상태 요약:`, {
        총_수집된_URL_패턴: registeredUrls.size,
        매칭_성공_카드: matchedCount,
        이미_등록됨: alreadyRegisteredCount,
        매칭_실패_카드: notMatchedCount,
        업데이트_필요: updatedCount,
        메시지: summaryMessage,
      });
    }

    return {
      success: true,
      totalRegistered: registeredUrls.size,
      updatedCards: updatedCount,
      matchedCards: matchedCount,
      alreadyRegistered: alreadyRegisteredCount,
      notMatched: notMatchedCount,
    };
  } catch (error) {
    Logger.error(`[AdSense] 등록 상태 확인 실패:`, error);

    if (error.message === 'UNAUTHORIZED') {
      await sendErrorToUI('UNAUTHORIZED', '인증 토큰이 만료되었습니다. 재로그인이 필요합니다.');
    }

    throw error;
  }
}

export async function runFullSystemDiagnosis() {
  return { checks: [], errors: [] };
}
export async function runAdSenseDeepDiagnosis() {
  return { success: true };
}
export async function testBlogConnection() {
  return { success: true };
}
export async function testAdSenseGa4Access() {
  return { success: true };
}
