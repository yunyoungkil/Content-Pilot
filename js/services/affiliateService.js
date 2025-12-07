// js/services/affiliateService.js
import { getCurrentUserId, cleanDataForFirebase } from './firebaseService.js';
import { Logger } from '../utils.js';

const DB_PATH = 'affiliate_links';

// Firebase REST API 헬퍼 함수들
async function dbRequest(method, path, data = null) {
  const token = await getValidToken(false);

  const baseUrl = 'https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app';
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  const url = `${baseUrl}/${cleanPath}.json${
    token ? `?access_token=${encodeURIComponent(token)}` : ''
  }`;

  const options = {
    method: method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (data !== null) {
    options.body = JSON.stringify(cleanDataForFirebase(data));
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DB Error (${response.status}): ${errText}`);
  }

  if (method === 'DELETE') {
    return true;
  }

  return await response.json();
}

async function getValidToken(forceRefresh = false) {
  // authService에서 토큰 가져오기
  try {
    const { getValidToken } = await import('./authService.js');
    return await getValidToken(forceRefresh);
  } catch (error) {
    Logger.warn('[AffiliateService] 토큰 가져오기 실패:', error);
    return null;
  }
}

/**
 * 제휴 링크 추가
 */
export async function addAffiliateLink(data) {
  try {
    const userId = await getCurrentUserId();
    const timestamp = Date.now();
    const linkId = `link_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;

    const payload = {
      ...cleanDataForFirebase(data),
      id: linkId,
      createdAt: timestamp,
      clickCount: 0,
      // keywords가 빈 배열이라도 명시적으로 포함
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      // SEO 관련 추가 필드
      originalAffiliateKeywords: Array.isArray(data.keywords) ? data.keywords : [],
      recommendedSearches: Array.isArray(data.recommendedSearches)
        ? data.recommendedSearches
        : Array.isArray(data.recommendedKeywords)
          ? data.recommendedKeywords
          : [],
      longTailKeywords: Array.isArray(data.longTailKeywords) ? data.longTailKeywords : [],
      outline: Array.isArray(data.outline) ? data.outline : [],
    };

    const path = `${DB_PATH}/${userId}/${linkId}`;
    await dbRequest('PUT', path, payload);

    Logger.debug(`[AffiliateService] 링크 추가 완료: ${linkId}`);
    return { success: true, id: linkId };
  } catch (error) {
    Logger.error('[AffiliateService] 링크 추가 실패:', error);
    throw error;
  }
}

/**
 * 제휴 링크 목록 조회
 */
export async function getAffiliateLinks() {
  try {
    const userId = await getCurrentUserId();
    const path = `${DB_PATH}/${userId}`;
    const data = await dbRequest('GET', path);

    if (!data) return [];

    // 객체를 배열로 변환
    const links = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
    Logger.debug(`[AffiliateService] 링크 목록 조회 완료: ${links.length}개`);
    return links;
  } catch (error) {
    Logger.error('[AffiliateService] 링크 목록 조회 실패:', error);
    throw error;
  }
}

/**
 * 제휴 링크 삭제
 */
export async function deleteAffiliateLink(linkId) {
  try {
    const userId = await getCurrentUserId();
    const path = `${DB_PATH}/${userId}/${linkId}`;
    await dbRequest('DELETE', path);

    Logger.debug(`[AffiliateService] 링크 삭제 완료: ${linkId}`);
    return { success: true };
  } catch (error) {
    Logger.error('[AffiliateService] 링크 삭제 실패:', error);
    throw error;
  }
}

/**
 * 제휴 링크 수정
 */
export async function updateAffiliateLink(linkId, data) {
  try {
    const userId = await getCurrentUserId();
    const path = `${DB_PATH}/${userId}/${linkId}`;
    const cleanData = cleanDataForFirebase(data);
    // keywords가 빈 배열이라도 명시적으로 포함
    cleanData.keywords = Array.isArray(data.keywords) ? data.keywords : [];
    // SEO 관련 필드도 명시적으로 포함
    cleanData.originalAffiliateKeywords = Array.isArray(data.keywords) ? data.keywords : [];
    cleanData.recommendedSearches = Array.isArray(data.recommendedSearches)
      ? data.recommendedSearches
      : Array.isArray(data.recommendedKeywords)
        ? data.recommendedKeywords
        : [];
    cleanData.longTailKeywords = Array.isArray(data.longTailKeywords) ? data.longTailKeywords : [];
    cleanData.outline = Array.isArray(data.outline) ? data.outline : [];
    await dbRequest('PATCH', path, cleanData);

    Logger.debug(`[AffiliateService] 링크 수정 완료: ${linkId}`);
    return { success: true };
  } catch (error) {
    Logger.error('[AffiliateService] 링크 수정 실패:', error);
    throw error;
  }
}

/**
 * 제휴 링크 클릭 수 증가 (개선된 버전)
 * 참고: Firebase REST API의 한계로 트랜잭션을 사용할 수 없어
 * race condition이 발생할 수 있지만, 실제 운영에서는 큰 문제가 되지 않음
 */
export async function incrementAffiliateLinkClick(linkId) {
  try {
    const userId = await getCurrentUserId();

    // 링크 존재 여부 확인
    const linkPath = `${DB_PATH}/${userId}/${linkId}`;
    const currentData = await dbRequest('GET', linkPath);

    if (!currentData) {
      Logger.warn(`[AffiliateService] 클릭 수 증가 실패: 링크를 찾을 수 없음 (${linkId})`);
      throw new Error(`링크를 찾을 수 없습니다: ${linkId}`);
    }

    // 현재 클릭 수 가져오기 (기본값 0)
    const currentClickCount = Number(currentData.clickCount) || 0;
    const newClickCount = currentClickCount + 1;

    // 유효성 검사
    if (newClickCount < 0 || !Number.isInteger(newClickCount)) {
      throw new Error(`유효하지 않은 클릭 수: ${newClickCount}`);
    }

    // 클릭 수 업데이트 (PUT 사용 - 특정 필드만 업데이트)
    const clickCountPath = `${linkPath}/clickCount`;
    await dbRequest('PUT', clickCountPath, newClickCount);

    Logger.debug(
      `[AffiliateService] 링크 클릭 수 증가 성공: ${linkId} (${currentClickCount} → ${newClickCount})`
    );
    return { success: true, newClickCount };
  } catch (error) {
    Logger.error(`[AffiliateService] 링크 클릭 수 증가 실패 (${linkId}):`, error);

    // 구체적인 에러 메시지 제공
    if (error.message?.includes('링크를 찾을 수 없습니다')) {
      throw error;
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      throw new Error('네트워크 오류로 클릭 수를 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
    } else {
      throw new Error('클릭 수 저장 중 오류가 발생했습니다.');
    }
  }
}
