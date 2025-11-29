// js/services/scrapService.js
// 스크랩 관련 서비스

import { cleanDataForFirebase, getCurrentUserId } from './firebaseService.js';
import { get, remove, push, writeBatch, getDb } from './firebaseService.js';
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
    const batch = writeBatch(getDb());
    const results = [];

    // 각 스크랩 데이터를 준비하고 배치에 추가
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

      // 배치에 추가
      const scrapRef = push(scrapPath);
      batch.set(scrapRef, cleanDataForFirebase(scrapPayload));

      results.push({
        scrapId: scrapRef.key,
        scrapData: scrapPayload,
      });
    }

    // 배치 커밋
    await batch.commit();

    Logger.info(`[saveScrapElementsBatch] 배치 저장 완료 - ${scrapDataArray.length}개 스크랩`);
    return {
      success: true,
      results: results,
    };
  } catch (_error) {
    Logger.error('[saveScrapElementsBatch] 배치 저장 실패:', _error);
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
export async function getFirebaseScraps(targetChannelId = null, limit = 100, startAfter = null) {
  try {
    const userId = await getCurrentUserId();
    const scrapPath = `scraps/${userId}`;

    // Firebase 쿼리 구성 (페이징 지원)
    let query = get(scrapPath);
    if (startAfter) {
      query = query.orderByKey().startAfter(startAfter).limitToFirst(limit);
    } else {
      query = query.orderByKey().limitToFirst(limit);
    }

    const snap = await query;
    const val = snap?.val() || {};
    const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));

    Logger.debug(
      `[getFirebaseScraps] 조회된 스크랩 개수: ${arr.length}, targetChannelId: ${targetChannelId}, limit: ${limit}, startAfter: ${startAfter}`
    );

    // 필터링: channelId가 없거나 null이거나 targetChannelId와 일치하는 경우
    const filtered = arr.filter((scrap) => {
      // channelId가 없거나 null인 경우 포함 (구버전 데이터 또는 공용 스크랩)
      if (scrap.channelId === undefined || scrap.channelId === null) {
        Logger.debug(
          `[getFirebaseScraps] 스크랩 필터링: ID ${scrap.id} - channelId undefined/null, 포함`
        );
        return true;
      }

      // targetChannelId가 없는 경우, 모든 스크랩 포함 (기본 동작)
      if (!targetChannelId) {
        Logger.debug(
          `[getFirebaseScraps] 스크랩 필터링: ID ${scrap.id} - targetChannelId 없음, 포함`
        );
        return true;
      }

      // 정확히 일치하는 경우 포함 (UUID 기반 단순 비교)
      if (scrap.channelId === targetChannelId) {
        Logger.debug(
          `[getFirebaseScraps] 스크랩 필터링: ID ${scrap.id} - UUID 일치: ${scrap.channelId} === ${targetChannelId}, 포함`
        );
        return true;
      }

      Logger.debug(`[getFirebaseScraps] 스크랩 필터링: ID ${scrap.id} - 제외됨`);
      return false;
    });

    Logger.info(`[getFirebaseScraps] 필터링 후 스크랩 개수: ${filtered.length}`);
    const sortedScraps = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 페이징 지원: 더 많은 데이터가 있는지 확인
    const hasMore = arr.length === limit;

    // 콜백이 실행되지 않는 경우를 대비하여 content script에 메시지 전송
    // 모든 탭에 업데이트 메시지 전송 (콜백이 실행되지 않는 경우 대비)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              action: 'scraps_data_updated',
              scraps: sortedScraps,
            })
            .catch((_err) => {
              // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
              // 조용히 무시
            });
        }
      });
    });

    return { data: sortedScraps, hasMore: hasMore };
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
