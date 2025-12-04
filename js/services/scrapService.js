// js/services/scrapService.js
// 스크랩 관련 서비스

import { cleanDataForFirebase, getCurrentUserId } from './firebaseService.js';
import { get, remove, push, getDb } from './firebaseService.js';
import { Logger } from '../utils.js';

/**
 * 스크랩 요소 저장
 * @param {Object} data - 스크랩 데이터
 * @param {string|null} channelId - 채널 ID (기본값: null)
 * @returns {Promise<{success: boolean, scrapId?: string, scrapData?: Object, error?: string}>}
 */
export async function saveScrapElement(data, channelId = null) {
  try {
    // 스크랩 데이터 준비
    const scrapPayload = {
      text: data.text || '',
      html: data.html || '',
      tag: data.tag || 'UNKNOWN',
      url: data.url || '',
      image: data.image || null,
      images: data.images || [],
      allImages:
        data.allImages ||
        (data.images && data.images.length > 0 ? data.images : data.image ? [data.image] : null),
      highlights: data.highlights || [], // 하이라이트 메타데이터 포함
      hasHighlights: data.hasHighlights || false,
      timestamp: Date.now(),
      channelId: channelId,
    };

    // images 배열을 allImages로 변환 (기존 allImages가 있으면 병합)
    if (Array.isArray(data.images) && data.images.length > 0) {
      const existingAllImages = scrapPayload.allImages || [];
      // 중복 제거하면서 병합
      const mergedImages = [...new Set([...existingAllImages, ...data.images])];
      scrapPayload.allImages = mergedImages.length > 0 ? mergedImages : null;
    }

    // images 필드는 제거 (allImages로 통합)
    if (scrapPayload.images) {
      delete scrapPayload.images;
    }

    // Firebase에 저장
    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}`;
    const scrapRef = await push(scrapPath, cleanDataForFirebase(scrapPayload));
    const scrapId = scrapRef.key;

    Logger.info(`[saveScrapElement] 스크랩 저장 완료 - scrapId: ${scrapId}`);
    return {
      success: true,
      scrapId: scrapId,
      scrapData: scrapPayload,
    };
  } catch (_error) {
    Logger.error('[saveScrapElement] 저장 실패:', _error);
    return { success: false, error: _error.message };
  }
}

/**
 * 여러 스크랩 요소를 배치로 저장 (성능 최적화)
 * @param {Array<Object>} scrapDataArray - 스크랩 데이터 배열
 * @param {string|null} channelId - 채널 ID (기본값: null)
 * @returns {Promise<{success: boolean, results?: Array<{scrapId: string, scrapData: Object}>, error?: string}>}
 */
export async function saveScrapElementsBatch(scrapDataArray, channelId = null) {
  try {
    if (!Array.isArray(scrapDataArray) || scrapDataArray.length === 0) {
      return { success: false, error: '스크랩 데이터 배열이 비어있습니다.' };
    }

    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}`;
    const results = [];

    // 각 스크랩 데이터를 개별적으로 저장 (REST API에서는 batch가 지원되지 않음)
    for (const data of scrapDataArray) {
      const scrapPayload = {
        text: data.text || '',
        html: data.html || '',
        tag: data.tag || 'UNKNOWN',
        url: data.url || '',
        image: data.image || null,
        images: data.images || [],
        allImages:
          data.allImages ||
          (data.images && data.images.length > 0 ? data.images : data.image ? [data.image] : null),
        highlights: data.highlights || [],
        hasHighlights: data.hasHighlights || false,
        timestamp: Date.now(),
        channelId: channelId,
      };

      // images 배열을 allImages로 변환
      if (Array.isArray(data.images) && data.images.length > 0) {
        const existingAllImages = scrapPayload.allImages || [];
        const mergedImages = [...new Set([...existingAllImages, ...data.images])];
        scrapPayload.allImages = mergedImages.length > 0 ? mergedImages : null;
      }

      if (scrapPayload.images) {
        delete scrapPayload.images;
      }

      // 개별 push로 저장
      const scrapRef = await push(scrapPath, cleanDataForFirebase(scrapPayload));

      results.push({
        scrapId: scrapRef.key,
        scrapData: scrapPayload,
      });
    }

    Logger.info(`[saveScrapElementsBatch] 개별 저장 완료 - ${scrapDataArray.length}개 스크랩`);
    return {
      success: true,
      results: results,
    };
  } catch (_error) {
    Logger.error('[saveScrapElementsBatch] 저장 실패:', _error);
    return { success: false, error: _error.message };
  }
}

/**
 * Firebase에서 스크랩 목록 조회 (채널 필터링 포함)
 * @param {string|null} targetChannelId - 타겟 채널 ID (기본값: null)
 * @param {number} limit - 최대 조회 개수 (기본값: 100, 성능 최적화)
 * @param {string|null} startAfter - 시작 키 (페이징용)
 * @returns {Promise<{data: Array, success?: boolean, error?: string, hasMore?: boolean}>}
 */
// 스크랩 데이터 캐시 (메모리 캐시 + TTL)
const scrapCache = new Map();
const SCRAP_CACHE_TTL = 2 * 60 * 1000; // 2분

// 캐시된 스크랩 데이터 조회
async function getCachedScraps(userId, targetChannelId = null) {
  const cacheKey = `scraps_${userId}_${targetChannelId || 'all'}`;
  const cached = scrapCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < SCRAP_CACHE_TTL) {
    return cached.data;
  }

  // 캐시 만료 또는 없음 - DB 조회
  const scrapPath = `scraps/${userId}`;
  const snap = await get(scrapPath);
  const val = snap?.val() || {};

  // 모든 스크랩을 배열로 변환하고 타임스탬프 기준 정렬
  let allScraps = Object.entries(val).map(([id, data]) => ({ id, ...data }));
  allScraps.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // 채널 필터링 적용
  let filteredScraps = allScraps;
  if (targetChannelId) {
    filteredScraps = allScraps.filter((scrap) => {
      if (scrap.channelId === undefined || scrap.channelId === null) return true;
      if (!targetChannelId) return true;
      return scrap.channelId === targetChannelId;
    });
  }

  // 캐시 저장
  scrapCache.set(cacheKey, {
    data: filteredScraps,
    timestamp: Date.now(),
  });

  return filteredScraps;
}

export async function getFirebaseScraps(targetChannelId = null, limit = 50, startAfter = null) {
  try {
    const userId = await getCurrentUserId();

    // 캐시된 데이터 사용
    let allScraps = await getCachedScraps(userId, targetChannelId);

    Logger.debug(
      `[getFirebaseScraps] 캐시된 스크랩 개수: ${allScraps.length}, targetChannelId: ${targetChannelId}, limit: ${limit}, startAfter: ${startAfter}`
    );

    // 페이징 처리: startAfter가 있으면 해당 타임스탬프 이후부터 시작
    let filteredScraps = allScraps;
    if (startAfter) {
      const startIndex = allScraps.findIndex((scrap) => scrap.id === startAfter);
      if (startIndex !== -1) {
        filteredScraps = allScraps.slice(startIndex + 1);
      }
    }

    // 제한 적용 (더 작은 기본값 사용)
    const limitedScraps = filteredScraps.slice(0, limit);

    Logger.info(`[getFirebaseScraps] 페이징 후 스크랩 개수: ${limitedScraps.length}`);

    // 페이징 지원: 더 많은 데이터가 있는지 확인
    const hasMore = filteredScraps.length > limit;

    Logger.debug(`[getFirebaseScraps] 반환 데이터 구조:`, { data: limitedScraps, hasMore });

    // 콜백이 실행되지 않는 경우를 대비하여 content script에 메시지 전송
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              action: 'scraps_data_updated',
              scraps: limitedScraps,
            })
            .catch((_err) => {
              // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
              // 조용히 무시
            });
        }
      });
    });

    return { data: limitedScraps, hasMore: hasMore };
  } catch (_error) {
    Logger.error('[getFirebaseScraps] Firebase 로드 오류:', _error);
    return { data: [], hasMore: false };
  }
}

/**
 * 스크랩 상세 정보 조회
 * @param {string} scrapId - 스크랩 ID
 * @param {string|null} channelId - 채널 ID (권한 확인용, 기본값: null)
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function getScrapDetail(scrapId, channelId = null) {
  if (!scrapId) {
    return { success: false, error: '스크랩 ID가 없습니다.' };
  }

  try {
    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}/${scrapId}`;
    const scrapSnap = await get(scrapPath);
    const scrapData = scrapSnap?.val();

    if (!scrapData) {
      return { success: false, error: '스크랩을 찾을 수 없습니다.' };
    }

    // 채널 ID 필터링 (필요한 경우)
    if (
      channelId !== undefined &&
      scrapData.channelId !== undefined &&
      scrapData.channelId !== null &&
      scrapData.channelId !== channelId
    ) {
      return { success: false, error: '접근 권한이 없습니다.' };
    }

    return {
      success: true,
      data: {
        id: scrapId,
        text: scrapData.text || scrapData.cleanText || '',
        url: scrapData.url || '',
        image: scrapData.image || '',
        allImages: scrapData.allImages || (scrapData.image ? [scrapData.image] : []),
        tags: scrapData.tags || [],
        timestamp: scrapData.timestamp || 0,
      },
    };
  } catch (_error) {
    Logger.error('[getScrapDetail] 오류:', _error);
    return { success: false, error: _error.message };
  }
}

/**
 * 전체 분석 리포트를 스크랩으로 저장
 * @param {string} analysisContent - 분석 콘텐츠
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function saveEntireAnalysis(analysisContent) {
  if (!analysisContent) {
    return { success: false, error: '분석 콘텐츠가 비어있습니다.' };
  }

  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateTag = `${year}-${month}-${day}`;

    const scrapPayload = {
      text: analysisContent,
      html: `<pre>${analysisContent}</pre>`,
      tag: 'AI_ANALYSIS',
      url: `content-pilot://analysis/${Date.now()}`,
      tags: [`#성과분석`, `#${dateTag}`],
      timestamp: Date.now(),
    };

    const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);
    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}`;
    await push(scrapPath, cleanedScrapPayload);

    Logger.info('AI 분석 리포트가 스크랩북에 저장되었습니다.');
    return { success: true, message: 'AI 분석 리포트가 저장되었습니다.' };
  } catch (_error) {
    Logger.error('[saveEntireAnalysis] 오류:', _error);
    return { success: false, error: _error.message };
  }
}

/**
 * 스크랩 삭제
 * @param {string} scrapId - 스크랩 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteScrap(scrapId) {
  if (!scrapId) {
    return { success: false, error: '스크랩 ID가 필요합니다.' };
  }

  try {
    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}/${scrapId}`;
    await remove(scrapPath);

    Logger.info(`[deleteScrap] 스크랩 삭제 완료 - scrapId: ${scrapId}`);
    return { success: true };
  } catch (_error) {
    Logger.error('[deleteScrap] 오류:', _error);
    return { success: false, error: _error.message };
  }
}
