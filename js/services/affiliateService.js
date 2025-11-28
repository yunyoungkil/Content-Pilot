// js/services/affiliateService.js
import { getCurrentUserId, cleanDataForFirebase } from "./firebaseService.js";
import { Logger } from "../utils.js";

const DB_PATH = "affiliate_links";

// Firebase REST API 헬퍼 함수들
async function dbRequest(method, path, data = null) {
  const token = await getValidToken(false);

  const baseUrl =
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app";
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;
  const url = `${baseUrl}/${cleanPath}.json${
    token ? `?access_token=${encodeURIComponent(token)}` : ""
  }`;

  const options = {
    method: method,
    headers: { "Content-Type": "application/json" },
  };

  if (data !== null) {
    options.body = JSON.stringify(cleanDataForFirebase(data));
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DB Error (${response.status}): ${errText}`);
  }

  if (method === "DELETE") {
    return true;
  }

  return await response.json();
}

async function getValidToken(forceRefresh = false) {
  // authService에서 토큰 가져오기
  try {
    const { getValidToken } = await import("./authService.js");
    return await getValidToken(forceRefresh);
  } catch (error) {
    Logger.warn("[AffiliateService] 토큰 가져오기 실패:", error);
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
    const linkId = `link_${timestamp}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const payload = {
      ...cleanDataForFirebase(data),
      id: linkId,
      createdAt: timestamp,
      clickCount: 0,
      // keywords가 빈 배열이라도 명시적으로 포함
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
    };

    const path = `${DB_PATH}/${userId}/${linkId}`;
    await dbRequest("PUT", path, payload);

    Logger.debug(`[AffiliateService] 링크 추가 완료: ${linkId}`);
    return { success: true, id: linkId };
  } catch (error) {
    Logger.error("[AffiliateService] 링크 추가 실패:", error);
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
    const data = await dbRequest("GET", path);

    if (!data) return [];

    // 객체를 배열로 변환
    const links = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
    Logger.debug(`[AffiliateService] 링크 목록 조회 완료: ${links.length}개`);
    return links;
  } catch (error) {
    Logger.error("[AffiliateService] 링크 목록 조회 실패:", error);
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
    await dbRequest("DELETE", path);

    Logger.debug(`[AffiliateService] 링크 삭제 완료: ${linkId}`);
    return { success: true };
  } catch (error) {
    Logger.error("[AffiliateService] 링크 삭제 실패:", error);
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
    await dbRequest("PATCH", path, cleanData);

    Logger.debug(`[AffiliateService] 링크 수정 완료: ${linkId}`);
    return { success: true };
  } catch (error) {
    Logger.error("[AffiliateService] 링크 수정 실패:", error);
    throw error;
  }
}
