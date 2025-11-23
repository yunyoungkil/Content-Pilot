// js/services/collectorService.js
// 데이터 수집 서비스

import { getDb, CONSTANTS, initializeFirebase, cleanDataForFirebase } from './firebaseService.js';
import { ref, get, set, update, remove } from 'firebase/database';

// Offscreen Document 생성 및 관리
let creating;
export async function getOffscreenDocument() {
  if (creating) {
    return creating;
  }
  creating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'HTML 파싱을 위해 필요합니다.'
  });
  await creating;
  return creating;
}

// 동시 실행 수 제한
export async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  const executing = [];
  
  for (const item of items) {
    const promise = (async () => {
      try {
        return await fn(item);
      } finally {
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      }
    })();
    
    results.push(promise);
    executing.push(promise);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

// URL 정규화 함수들
export function getNormalizedUrl(url) {
  if (!url || !url.startsWith("http")) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    return null;
  }
}

export function normalizeUrlForComparison(url) {
  if (!url) return "";
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch (e) {
    return url;
  }
}

export function encodeUrlForFirebaseKey(url) {
  return btoa(url).replace(/=/g, "");
}

export function decodeUrlFromFirebaseKey(encoded) {
  try {
    return atob(encoded);
  } catch (e) {
    return null;
  }
}

// URL 인덱스 관리
export async function updateUrlIndex(url, data) {
  const userId = CONSTANTS.USER_ID;
  const urlKey = encodeUrlForFirebaseKey(url);
  const db = getDb();
  const indexRef = ref(db, `url_index/${userId}/${urlKey}`);
  await set(indexRef, { url, ...data, updatedAt: Date.now() });
}

export async function removeUrlIndex(url) {
  const userId = CONSTANTS.USER_ID;
  const urlKey = encodeUrlForFirebaseKey(url);
  const db = getDb();
  const indexRef = ref(db, `url_index/${userId}/${urlKey}`);
  await remove(indexRef);
}

// 중복 URL 체크
export async function checkDuplicateUrl(url) {
  const userId = CONSTANTS.USER_ID;
  const urlKey = encodeUrlForFirebaseKey(url);
  const db = getDb();
  const indexRef = ref(db, `url_index/${userId}/${urlKey}`);
  const snapshot = await get(indexRef);
  return snapshot.exists();
}

export async function checkDuplicateUrlFallback(url) {
  // 간단한 fallback 로직
  const normalized = normalizeUrlForComparison(url);
  // TODO: Firebase에서 전체 검색 (비효율적이지만 fallback)
  return false;
}

// AI 관련 함수들 (Gemini API 호출)
// TODO: aiService.js에서 import하도록 변경 필요
export async function summarizeText(text) {
  // TODO: aiService.js의 callGeminiAPI 사용
  if (!text || text.length < 200) {
    return text;
  }
  // 임시 구현
  return text.substring(0, 200) + "...";
}

export async function extractKeywords(text) {
  // TODO: aiService.js의 callGeminiAPI 사용
  // 임시 구현
  return [];
}

// RSS 피드 처리
export async function processRssItem(itemText, sourceId, channelType) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] processRssItem: 함수 구현 필요");
}

export async function fetchRssFeed(url, channelType) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] fetchRssFeed: 함수 구현 필요");
}

// YouTube 채널 처리
export async function fetchYoutubeChannel(channelId, channelType) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] fetchYoutubeChannel: 함수 구현 필요");
}

export async function normalizeYoutubeData(data) {
  // TODO: background.js에서 함수 복사 필요
  return data;
}

// 블로그 페이지 파싱
export async function parseBlogPage(url, html) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] parseBlogPage: 함수 구현 필요");
}

// 채널 데이터 수집
export async function fetchAllChannelData() {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] fetchAllChannelData: 함수 구현 필요");
}

export async function fetchAndSaveSinglePost(url, channelId) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] fetchAndSaveSinglePost: 함수 구현 필요");
}

export async function deleteChannelData(urlToDelete) {
  // TODO: background.js에서 함수 복사 필요
  console.warn("[collectorService] deleteChannelData: 함수 구현 필요");
}

