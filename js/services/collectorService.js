// js/services/collectorService.js

import { getDb, CONSTANTS, cleanDataForFirebase } from './firebaseService.js';
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, get, set, update, remove } from './firebaseService.js';
import { sendErrorToUI } from './analyticsService.js';

let creating;

export async function getOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) await creating;
  else {
    creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'HTML 파싱' });
    await creating;
    creating = null;
  }
}

async function limitConcurrency(items, fn, limit = 5) {
  const results = [], executing = [];
  for (const item of items) {
    const p = fn(item).then(r => r, e => e);
    results.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

// 1. URL 정규화 및 인덱스 관리
export function normalizeUrlForComparison(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.replace(/\/$/, '');
  } catch(e) { return url.trim(); }
}

export function encodeUrlForFirebaseKey(url) {
  return url.replace(/\./g, '_DOT_').replace(/\//g, '_SLASH_').replace(/#/g, '_HASH_').replace(/\$/g, '_DOLLAR_').replace(/\[/g, '_LBRACKET_').replace(/\]/g, '_RBRACKET_');
}

export async function updateUrlIndex(cardId, status, originUrl, publishedUrl) {
  const db = getDb();
  const updates = {};
  if (originUrl) updates[`url_index/${CONSTANTS.USER_ID}/${encodeUrlForFirebaseKey(normalizeUrlForComparison(originUrl))}/origin/${cardId}`] = { status, cardId };
  if (publishedUrl) updates[`url_index/${CONSTANTS.USER_ID}/${encodeUrlForFirebaseKey(normalizeUrlForComparison(publishedUrl))}/published/${cardId}`] = { status, cardId };
  if (Object.keys(updates).length) await update(ref(db), updates);
}

export async function checkDuplicateUrl(url) {
  if (!url) return { exists: false };
  try {
    const key = encodeUrlForFirebaseKey(normalizeUrlForComparison(url));
    const snap = await get(ref(getDb(), `url_index/${CONSTANTS.USER_ID}/${key}`));
    if (snap.exists()) {
      const data = snap.val();
      const match = data.origin ? Object.values(data.origin)[0] : Object.values(data.published)[0];
      if (match) return { exists: true, status: match.status, cardId: match.cardId, title: "중복된 아이디어" };
    }
  } catch(e) {}
  return { exists: false };
}

// 2. RSS 수집
async function processRssItem(itemText, sourceId, channelType) {
  let link = itemText.match(/<link[^>]*href=["']([^"']*)["']/) || itemText.match(/<link>(.*?)<\/link>/);
  if (!link) return;
  const fullLink = link[1].replace(/CDATA\[(.*?)\]\]/g, '$1').trim();
  
  const titleMatch = itemText.match(/<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const title = titleMatch ? titleMatch[1] : "제목 없음";
  const pubDateMatch = itemText.match(/<(pubDate|published|updated)>(.*?)<\/\1>/);
  const timestamp = pubDateMatch ? new Date(pubDateMatch[2]).getTime() : Date.now();

  const contentId = btoa(fullLink.split('?')[0]).replace(/=/g, '');
  const db = getDb();
  const path = `channel_content/${CONSTANTS.USER_ID}/blogs/${contentId}`;

  // 이미 존재하는지 확인 (가벼운 체크)
  const existSnap = await get(ref(db, path));
  if (existSnap.exists()) return;

  // 새 글이면 본문 파싱
  const parsed = await parseBlogPage(fullLink);
  if (!parsed.success) return;

  const data = {
    title, fullLink, pubDate: timestamp,
    description: parsed.description,
    thumbnail: parsed.thumbnail,
    cleanText: parsed.cleanText,
    sourceId, channelType,
    fetchedAt: Date.now(),
    ...parsed.metrics
  };

  await set(ref(db, path), cleanDataForFirebase(data));
}

export async function fetchRssFeed(url, channelType) {
  try {
    const db = getDb();
    const sourceId = btoa(url).replace(/=/g, '');
    const metaRef = ref(db, `channel_meta/${CONSTANTS.USER_ID}/${sourceId}`);
    
    const metaSnap = await get(metaRef);
    const meta = metaSnap.val() || {};
    const headers = {};
    if (meta.lastEtag) headers['If-None-Match'] = meta.lastEtag;
    
    const res = await fetch(url, { headers });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    await update(metaRef, {
      lastEtag: res.headers.get('ETag'),
      lastModified: res.headers.get('Last-Modified'),
      fetchedAt: Date.now(),
      source: url
    });

    const text = await res.text();
    const items = text.match(/<(item|entry)>([\s\S]*?)<\/\1>/g) || [];
    await limitConcurrency(items.slice(0, 10), item => processRssItem(item, sourceId, channelType));
  } catch (e) { console.error(`[RSS] ${url} Fail:`, e); }
}

// 3. 유튜브 수집
export async function fetchYoutubeChannel(channelId, channelType) {
  const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
  if (!youtubeApiKey) return;
  
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`);
  const data = await res.json();
  if (!data.items) return;

  const ids = data.items.map(i => i.id.videoId).filter(Boolean).join(',');
  if (!ids) return;

  const detailRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${ids}&part=snippet,statistics`);
  const details = await detailRes.json();
  
  const db = getDb();
  const userId = CONSTANTS.USER_ID;

  for (const item of details.items || []) {
    const contentRef = ref(db, `channel_content/${userId}/youtubes/${item.id}`);
    const videoData = {
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      publishedAt: new Date(item.snippet.publishedAt).getTime(),
      thumbnail: item.snippet.thumbnails.default?.url,
      viewCount: parseInt(item.statistics.viewCount || 0),
      likeCount: parseInt(item.statistics.likeCount || 0),
      commentCount: parseInt(item.statistics.commentCount || 0),
      channelId, sourceId: channelId, channelType,
      fetchedAt: Date.now()
    };
    await set(contentRef, cleanDataForFirebase(videoData));
  }
}

// 4. 전체 수집
export async function fetchAllChannelData() {
  const db = getDb();
  const snap = await get(ref(db, `channels/${CONSTANTS.USER_ID}`));
  const channels = snap.val();
  if (!channels) return;

  const promises = [];
  channels.myChannels?.blogs?.forEach(c => promises.push(fetchRssFeed(c.apiUrl, "myChannels")));
  channels.myChannels?.youtubes?.forEach(c => promises.push(fetchYoutubeChannel(c.apiUrl, "myChannels")));
  
  await Promise.all(promises);
}

// 5. HTML 파싱 (오프스크린)
export async function parseBlogPage(url, html) {
  try {
    let content = html;
    if (!content) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch Fail");
      content = await res.text();
    }
    
    await getOffscreenDocument();
    return await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "parse_html_in_offscreen", html: content, baseUrl: url }, resolve);
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 6. 이미지 프록시
export async function fetchImageAsBase64(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const reader = new FileReader();
    return new Promise(resolve => {
      reader.onloadend = () => resolve({ success: true, dataUrl: reader.result });
      reader.readAsDataURL(blob);
    });
  } catch (e) { return { success: false, error: e.message }; }
}

// 7. 단건 저장
export async function fetchAndSaveSinglePost(url, channelId, sourceId) {
  try {
    if (!url || typeof url !== "string") throw new Error("유효한 URL이 필요합니다.");

    // 1. 중복 검사
    const duplicateCheck = await checkDuplicateUrl(url);
    if (duplicateCheck.exists) {
      const statusMap = { "ideas": "기획", "in-progress": "작성 중", "done": "발행 완료" };
      return {
        success: false,
        code: "DUPLICATE_FOUND",
        message: `이미 '${statusMap[duplicateCheck.status] || duplicateCheck.status}' 단계에 있는 포스팅입니다.`,
        cardInfo: duplicateCheck
      };
    }

    // 2. 플랫폼 판별 및 ID 추출
    let platform = "blog";
    let videoId = null;
    const urlObj = new URL(url);
    if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be")) {
      platform = "youtube";
      if (urlObj.pathname.includes("/watch")) videoId = urlObj.searchParams.get("v");
      else if (urlObj.hostname.includes("youtu.be")) videoId = urlObj.pathname.substring(1);
      
      if (!videoId) throw new Error("YouTube ID를 찾을 수 없습니다.");
    }

    // 3. 데이터 수집 및 저장
    const userId = CONSTANTS.USER_ID;
    const db = getDb();

    if (platform === "youtube") {
      const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
      if (!youtubeApiKey) throw new Error("YouTube API 키가 없습니다.");

      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoId}&part=snippet,statistics`);
      const data = await res.json();
      if (!data.items?.length) throw new Error("비디오 정보를 찾을 수 없습니다.");

      const apiItem = data.items[0];
      const normalized = {
        videoId: apiItem.id,
        title: apiItem.snippet.title,
        description: apiItem.snippet.description,
        publishedAt: new Date(apiItem.snippet.publishedAt).getTime(),
        thumbnail: apiItem.snippet.thumbnails.default?.url,
        viewCount: parseInt(apiItem.statistics.viewCount || 0),
        likeCount: parseInt(apiItem.statistics.likeCount || 0),
        commentCount: parseInt(apiItem.statistics.commentCount || 0),
        channelId: apiItem.snippet.channelId,
        sourceId: sourceId || channelId,
        channelType: "myChannels",
        fetchedAt: Date.now()
      };
      
      const tags = await extractKeywords(normalized.description);
      normalized.tags = tags || null;

      await set(ref(db, `channel_content/${userId}/youtubes/${videoId}`), cleanDataForFirebase(normalized));
      return { success: true, data: normalized, platform };

    } else {
      // 블로그 수집
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      
      const parsed = await parseBlogPage(url, html);
      if (!parsed.success) throw new Error(parsed.error || "파싱 실패");

      const tags = await extractKeywords(parsed.cleanText);
      let title = "제목 없음";
      const titleMatch = html.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      const contentId = btoa(url.split('?')[0]).replace(/=/g, '');
      
      const finalData = {
        title,
        fullLink: url,
        pubDate: Date.now(),
        description: parsed.description,
        thumbnail: parsed.thumbnail,
        cleanText: parsed.cleanText,
        sourceId: sourceId || channelId,
        channelType: "myChannels",
        fetchedAt: Date.now(),
        ...parsed.metrics,
        tags: tags || null
      };

      await set(ref(db, `channel_content/${userId}/blogs/${contentId}`), cleanDataForFirebase(finalData));
      return { success: true, data: finalData, platform };
    }

  } catch (e) {
    console.error("[fetchAndSaveSinglePost] 오류:", e);
    return { success: false, error: e.message };
  }
}

export async function deleteChannelData(urlToDelete) {
  try {
    const userId = CONSTANTS.USER_ID;
    const db = getDb();
    const channelsRef = ref(db, `channels/${userId}`);
    const snap = await get(channelsRef);
    const allChannels = snap.val();
    if (!allChannels) throw new Error("채널 정보 없음");

    let sourceIdToDelete = null;
    let platformToDelete = null;
    let channelFound = false;

    // 채널 찾기 및 삭제
    for (const type of ["myChannels", "competitorChannels"]) {
      for (const platform of ["blogs", "youtubes"]) {
        const list = allChannels[type]?.[platform] || [];
        const idx = list.findIndex(c => c.inputUrl === urlToDelete);
        if (idx > -1) {
          const info = list[idx];
          sourceIdToDelete = platform === "blogs" ? btoa(info.apiUrl).replace(/=/g, "") : info.apiUrl;
          platformToDelete = platform;
          list.splice(idx, 1); // 배열에서 제거
          channelFound = true;
          break;
        }
      }
      if (channelFound) break;
    }

    if (!channelFound) return { success: true, message: "삭제할 채널을 찾지 못함" };

    // DB 업데이트
    await Promise.all([
      set(channelsRef, allChannels), // 목록 업데이트
      remove(ref(db, `channel_meta/${userId}/${sourceIdToDelete}`)) // 메타 삭제
    ]);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function refreshChannelData(sourceId, platform) {
  try {
    let apiUrl = sourceId;
    if (platform === 'blog') {
      try { 
        apiUrl = atob(sourceId.replace(/_/g, '/').replace(/-/g, '+')); 
      } catch(e) {
        // Base64 디코딩 실패 시 원본 사용
      }
    }
    
    if (platform === 'blog') {
      await fetchRssFeed(apiUrl, "manual_refresh");
    } else if (platform === 'youtube') {
      await fetchYoutubeChannel(apiUrl, "manual_refresh");
    }

    return { success: true, message: "새로고침 완료" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function extractKeywords(text) { 
  // 간단한 키워드 추출 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 10) return [];
  // 기본적으로 빈 배열 반환 (나중에 AI 기반 추출로 확장 가능)
  return []; 
}
export async function summarizeText(text) { 
  // 간단한 요약 로직 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 200) return text;
  return text.substring(0, 200) + "...";
}
