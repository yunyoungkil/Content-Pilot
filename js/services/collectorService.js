// js/services/collectorService.js

import { getDb, CONSTANTS, cleanDataForFirebase, getCurrentUserId } from './firebaseService.js';
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, get, set, update, remove } from './firebaseService.js';
import { sendErrorToUI } from './analyticsService.js';
import { Logger } from '../utils.js';

let creating;

export async function getOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) await creating;
  else {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'HTML 파싱',
    });
    await creating;
    creating = null;
  }
}

async function limitConcurrency(items, fn, limit = 5) {
  const results = [],
    executing = [];
  for (const item of items) {
    const p = fn(item).then(
      (r) => r,
      (e) => e
    );
    results.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

// 1. URL 정규화 및 인덱스 관리
export function normalizeUrlForComparison(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.replace(/\/$/, '');
  } catch (e) {
    return url.trim();
  }
}

export function encodeUrlForFirebaseKey(url) {
  return url
    .replace(/\./g, '_DOT_')
    .replace(/\//g, '_SLASH_')
    .replace(/#/g, '_HASH_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/\[/g, '_LBRACKET_')
    .replace(/\]/g, '_RBRACKET_');
}

export async function updateUrlIndex(cardId, status, originUrl, publishedUrl) {
  // Firebase REST API는 다중 경로 업데이트를 지원하지 않으므로 각 경로를 개별적으로 업데이트
  const updatePromises = [];

  if (originUrl) {
    const normalizedUrl = normalizeUrlForComparison(originUrl);
    if (normalizedUrl) {
      const encodedKey = encodeUrlForFirebaseKey(normalizedUrl);
      const path = `url_index/${CONSTANTS.USER_ID}/${encodedKey}/origin/${cardId}`;
      updatePromises.push(
        update(path, { status, cardId }).catch((error) => {
          Logger.warn(`[updateUrlIndex] origin URL 인덱스 업데이트 실패 (${path}):`, error);
          return null; // 하나 실패해도 다른 업데이트는 계속
        })
      );
    }
  }

  if (publishedUrl) {
    const normalizedUrl = normalizeUrlForComparison(publishedUrl);
    if (normalizedUrl) {
      const encodedKey = encodeUrlForFirebaseKey(normalizedUrl);
      const path = `url_index/${CONSTANTS.USER_ID}/${encodedKey}/published/${cardId}`;
      updatePromises.push(
        update(path, { status, cardId }).catch((error) => {
          Logger.warn(`[updateUrlIndex] published URL 인덱스 업데이트 실패 (${path}):`, error);
          return null; // 하나 실패해도 다른 업데이트는 계속
        })
      );
    }
  }

  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }
}

export async function checkDuplicateUrl(url) {
  if (!url) return { exists: false };
  try {
    const key = encodeUrlForFirebaseKey(normalizeUrlForComparison(url));
    const indexSnap = await get(ref(getDb(), `url_index/${CONSTANTS.USER_ID}/${key}`));
    if (indexSnap.exists()) {
      const indexData = indexSnap.val();

      // origin과 published 모두 확인
      const matches = [];
      if (indexData.origin) {
        Object.entries(indexData.origin).forEach(([cardId, info]) => {
          matches.push({ cardId, status: info.status, type: 'origin' });
        });
      }
      if (indexData.published) {
        Object.entries(indexData.published).forEach(([cardId, info]) => {
          matches.push({ cardId, status: info.status, type: 'published' });
        });
      }

      // 각 매치에 대해 실제 카드 존재 여부 확인
      for (const match of matches) {
        const cardPath = `kanban/${CONSTANTS.USER_ID}/${match.status}/${match.cardId}`;
        const cardSnap = await get(ref(getDb(), cardPath));

        if (cardSnap.exists()) {
          const cardData = cardSnap.val();
          // 실제 카드가 존재하면 중복으로 판단
          Logger.debug(
            `[checkDuplicateUrl] 중복 발견 - cardId: ${match.cardId}, status: ${match.status}, title: ${cardData.title}`
          );
          return {
            exists: true,
            status: match.status,
            cardId: match.cardId,
            title: cardData.title || '제목 없음',
          };
        } else {
          // 실제 카드가 없으면 인덱스에서 제거 (고아 인덱스 정리)
          Logger.warn(
            `[checkDuplicateUrl] 고아 인덱스 발견 - cardId: ${match.cardId}, 인덱스에서 제거`
          );
          const orphanIndexPath = `url_index/${CONSTANTS.USER_ID}/${key}/${match.type}/${match.cardId}`;
          try {
            await remove(ref(getDb(), orphanIndexPath));
          } catch (removeError) {
            Logger.warn(`[checkDuplicateUrl] 고아 인덱스 제거 실패:`, removeError);
          }
        }
      }
    }
  } catch (e) {
    Logger.error(`[checkDuplicateUrl] 오류:`, e);
  }
  return { exists: false };
}

// 2. RSS 수집
async function processRssItem(itemText, sourceId, channelType) {
  let link =
    itemText.match(/<link[^>]*href=["']([^"']*)["']/) || itemText.match(/<link>(.*?)<\/link>/);
  if (!link) return;
  const fullLink = link[1].replace(/CDATA\[(.*?)\]\]/g, '$1').trim();

  const titleMatch = itemText.match(/<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const title = titleMatch ? titleMatch[1] : '제목 없음';
  const pubDateMatch = itemText.match(/<(pubDate|published|updated)>(.*?)<\/\1>/);
  const timestamp = pubDateMatch ? new Date(pubDateMatch[2]).getTime() : Date.now();

  // RSS 피드에서 태그 추출
  const tags = [];
  // <category> 태그 추출
  const categoryMatches = itemText.matchAll(
    /<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/category>/gi
  );
  for (const match of categoryMatches) {
    if (match[1]) {
      const tag = match[1].trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  // <dc:subject> 태그 추출 (Dublin Core)
  const subjectMatches = itemText.matchAll(
    /<dc:subject[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/dc:subject>/gi
  );
  for (const match of subjectMatches) {
    if (match[1]) {
      const tag = match[1].trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  // <tag> 태그 추출
  const tagMatches = itemText.matchAll(/<tag[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/tag>/gi);
  for (const match of tagMatches) {
    if (match[1]) {
      const tag = match[1].trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }

  const contentId = btoa(fullLink.split('?')[0]).replace(/=/g, '');
  const db = getDb();
  const path = `channel_content/${CONSTANTS.USER_ID}/blogs/${contentId}`;

  // 이미 존재하는지 확인 (가벼운 체크)
  const existSnap = await get(ref(db, path));
  if (existSnap?.exists()) return;

  // 새 글이면 본문 파싱
  const parsed = await parseBlogPage(fullLink);
  if (!parsed.success) return;

  // RSS 피드에서 태그를 찾지 못했으면 다른 소스에서 추출 시도
  let finalTags = tags.length > 0 ? tags : null;

  // 1. HTML 메타 태그에서 태그 추출 (우선순위 높음)
  if (
    !finalTags &&
    parsed.metaTags &&
    Array.isArray(parsed.metaTags) &&
    parsed.metaTags.length > 0
  ) {
    finalTags = parsed.metaTags;
  }

  // 2. 본문에서 키워드 추출 (메타 태그도 없을 때만)
  if (!finalTags && parsed.cleanText) {
    const extractedTags = await extractKeywords(parsed.cleanText);
    finalTags = extractedTags && extractedTags.length > 0 ? extractedTags : null;
  }

  const data = {
    title,
    fullLink,
    pubDate: timestamp,
    description: parsed.description,
    thumbnail: parsed.thumbnail,
    cleanText: parsed.cleanText,
    sourceId,
    channelType,
    fetchedAt: Date.now(),
    tags: finalTags,
    ...parsed.metrics,
  };

  await set(ref(db, path), cleanDataForFirebase(data));
}

export async function fetchRssFeed(url, channelType) {
  // URL 유효성 검사
  if (!url || typeof url !== 'string' || url.trim() === '') {
    Logger.warn(`[RSS] 유효하지 않은 URL: ${url}`);
    return;
  }

  try {
    const db = getDb();
    const sourceId = btoa(url).replace(/=/g, '');
    const metaRef = ref(db, `channel_meta/${CONSTANTS.USER_ID}/${sourceId}`);

    const metaSnap = await get(metaRef);
    const meta = metaSnap?.val() || {};
    const headers = {};
    if (meta.lastEtag) headers['If-None-Match'] = meta.lastEtag;

    const res = await fetch(url, { headers });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    await update(metaRef, {
      lastEtag: res.headers.get('ETag'),
      lastModified: res.headers.get('Last-Modified'),
      fetchedAt: Date.now(),
      source: url,
    });

    const text = await res.text();

    // RSS 피드에서 채널 이름 추출
    let channelTitle = null;

    // 1단계: <channel> 태그 안에서 title 찾기 (RSS 2.0 방식)
    const channelBlockMatch = text.match(/<channel>([\s\S]*?)<\/channel>/);
    if (channelBlockMatch && channelBlockMatch[1]) {
      const titleInChannelMatch = channelBlockMatch[1].match(
        /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      if (titleInChannelMatch && titleInChannelMatch[1]) {
        channelTitle = titleInChannelMatch[1].trim();
      }
    }

    // 2단계: 1단계 실패 시, 첫 게시물(<item> 또는 <entry>) 이전의 <title> 찾기 (Atom 방식)
    if (!channelTitle) {
      const firstItemMatch = text.match(/<(item|entry)>/);
      if (firstItemMatch) {
        const beforeFirstItem = text.substring(0, firstItemMatch.index);
        const titleMatches = beforeFirstItem.matchAll(
          /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi
        );
        for (const match of titleMatches) {
          if (match[1] && match[1].trim()) {
            channelTitle = match[1].trim();
            break;
          }
        }
      }
    }

    // 3단계: 여전히 없으면 <feed> 태그의 title 찾기 (Atom)
    if (!channelTitle) {
      const feedMatch = text.match(/<feed[^>]*>([\s\S]*?)<\/feed>/);
      if (feedMatch && feedMatch[1]) {
        const titleInFeedMatch = feedMatch[1].match(
          /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
        );
        if (titleInFeedMatch && titleInFeedMatch[1]) {
          channelTitle = titleInFeedMatch[1].trim();
        }
      }
    }

    // 채널 이름이 있으면 메타데이터에 저장
    if (channelTitle) {
      await update(metaRef, {
        title: channelTitle,
        lastEtag: res.headers.get('ETag'),
        lastModified: res.headers.get('Last-Modified'),
        fetchedAt: Date.now(),
        source: url,
      });
    } else {
      // 채널 이름이 없어도 기존 메타데이터 업데이트
      await update(metaRef, {
        lastEtag: res.headers.get('ETag'),
        lastModified: res.headers.get('Last-Modified'),
        fetchedAt: Date.now(),
        source: url,
      });
    }

    const items = text.match(/<(item|entry)>([\s\S]*?)<\/\1>/g) || [];
    await limitConcurrency(items.slice(0, 10), (item) =>
      processRssItem(item, sourceId, channelType)
    );
  } catch (e) {
    Logger.error(`[RSS] ${url || 'undefined'} Fail:`, e);
  }
}

// 3. 유튜브 수집
export async function fetchYoutubeChannel(channelId, channelType) {
  const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');
  if (!youtubeApiKey) return;

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`
  );
  const data = await res.json();
  if (!data.items) return;

  const ids = data.items
    .map((i) => i.id.videoId)
    .filter(Boolean)
    .join(',');
  if (!ids) return;

  const detailRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${ids}&part=snippet,statistics`
  );
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
      channelId,
      sourceId: channelId,
      channelType,
      fetchedAt: Date.now(),
    };
    await set(contentRef, cleanDataForFirebase(videoData));
  }
}

/**
 * 블로그 URL을 RSS URL로 변환
 */
function resolveBlogUrlToRss(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return null;
  }

  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();
    const origin = urlObj.origin;

    // 플랫폼별 RSS 경로
    if (host.includes('tistory.com')) {
      return `${origin}/rss`;
    } else if (host.includes('blog.naver.com')) {
      const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
        return `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
      }
      const blogId = new URLSearchParams(urlObj.search).get('blogId');
      if (blogId) {
        return `https://rss.blog.naver.com/${blogId}.xml`;
      }
      return `${origin}/rss`;
    } else if (host.includes('wordpress.com') || host.includes('medium.com')) {
      return url.endsWith('/') ? `${url}feed` : `${url}/feed`;
    } else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
      return `${origin}/feeds/posts/default?alt=rss`;
    }

    // 기본값: /feed 또는 /rss 시도
    return url.endsWith('/') ? `${url}feed` : `${url}/feed`;
  } catch (e) {
    Logger.warn('[resolveBlogUrlToRss] URL 파싱 실패:', url, e);
    return null;
  }
}

// 4. 전체 수집
export async function fetchAllChannelData() {
  Logger.info('[fetchAllChannelData] 채널 데이터 수집 시작');

  const db = getDb();
  const snap = await get(ref(db, `channels/${CONSTANTS.USER_ID}`));
  const channels = snap?.val();
  if (!channels) {
    Logger.warn('[fetchAllChannelData] 채널 데이터가 없습니다.');
    return;
  }

  Logger.info(
    `[fetchAllChannelData] 채널 데이터 발견: blogs=${channels.myChannels?.blogs?.length || 0}, youtubes=${channels.myChannels?.youtubes?.length || 0}`
  );

  const promises = [];

  // blogs 채널 처리
  if (channels.myChannels?.blogs) {
    channels.myChannels.blogs.forEach((c, index) => {
      let rssUrl = null;

      // apiUrl이 있으면 사용
      if (c.apiUrl && typeof c.apiUrl === 'string' && c.apiUrl.trim() !== '') {
        rssUrl = c.apiUrl;
        Logger.info(`[fetchAllChannelData] 블로그 ${index + 1}: apiUrl 사용 - ${rssUrl}`);
      }
      // url이 있으면 RSS URL로 변환 시도
      else if (c.url && typeof c.url === 'string' && c.url.trim() !== '') {
        rssUrl = resolveBlogUrlToRss(c.url);
        if (rssUrl) {
          Logger.info(
            `[fetchAllChannelData] 블로그 ${index + 1}: URL 변환 성공 - ${c.url} -> ${rssUrl}`
          );
        } else {
          Logger.warn(`[fetchAllChannelData] 블로그 ${index + 1}: URL 변환 실패 - ${c.url}`);
        }
      } else {
        Logger.warn(`[fetchAllChannelData] 블로그 ${index + 1}: apiUrl과 url이 모두 없음`, c);
      }

      if (rssUrl) {
        promises.push(
          fetchRssFeed(rssUrl, 'myChannels').catch((err) => {
            Logger.error(`[fetchAllChannelData] RSS 피드 수집 실패 (${rssUrl}):`, err);
            return null; // 하나 실패해도 다른 채널은 계속 수집
          })
        );
      }
    });
  }

  // YouTube 채널 처리 (apiUrl이 있는 경우만)
  if (channels.myChannels?.youtubes) {
    channels.myChannels.youtubes.forEach((c, index) => {
      if (c.apiUrl && typeof c.apiUrl === 'string' && c.apiUrl.trim() !== '') {
        Logger.info(`[fetchAllChannelData] YouTube ${index + 1}: ${c.apiUrl}`);
        promises.push(
          fetchYoutubeChannel(c.apiUrl, 'myChannels').catch((err) => {
            Logger.error(`[fetchAllChannelData] YouTube 채널 수집 실패 (${c.apiUrl}):`, err);
            return null;
          })
        );
      } else {
        Logger.warn(`[fetchAllChannelData] YouTube ${index + 1}: apiUrl이 없음`, c);
      }
    });
  }

  // 경쟁 채널 처리 (competitors)
  if (channels.myChannels?.blogs) {
    channels.myChannels.blogs.forEach((c, index) => {
      // 디버깅: 경쟁 채널 데이터 구조 확인
      Logger.debug(`[fetchAllChannelData] 블로그 ${index + 1} 경쟁 채널 확인:`, {
        hasCompetitors: !!c.competitors,
        competitorsType: typeof c.competitors,
        isArray: Array.isArray(c.competitors),
        competitorsLength: c.competitors?.length,
        competitors: c.competitors,
      });

      if (c.competitors && Array.isArray(c.competitors) && c.competitors.length > 0) {
        Logger.info(
          `[fetchAllChannelData] 블로그 ${index + 1}의 경쟁 채널 ${c.competitors.length}개 수집 시작`
        );
        c.competitors.forEach((compUrl, compIndex) => {
          if (!compUrl || typeof compUrl !== 'string' || compUrl.trim() === '') {
            Logger.warn(
              `[fetchAllChannelData] 경쟁 채널 ${compIndex + 1}: 유효하지 않은 URL - ${compUrl}`
            );
            return;
          }

          // 경쟁 채널 URL을 RSS URL로 변환
          const rssUrl = resolveBlogUrlToRss(compUrl);
          if (rssUrl) {
            Logger.info(
              `[fetchAllChannelData] 경쟁 채널 ${compIndex + 1}: URL 변환 성공 - ${compUrl} -> ${rssUrl}`
            );
            promises.push(
              fetchRssFeed(rssUrl, 'competitorChannels').catch((err) => {
                Logger.error(
                  `[fetchAllChannelData] 경쟁 채널 RSS 피드 수집 실패 (${rssUrl}):`,
                  err
                );
                return null; // 하나 실패해도 다른 채널은 계속 수집
              })
            );
          } else {
            Logger.warn(
              `[fetchAllChannelData] 경쟁 채널 ${compIndex + 1}: URL 변환 실패 - ${compUrl}`
            );
          }
        });
      } else {
        Logger.debug(`[fetchAllChannelData] 블로그 ${index + 1}: 경쟁 채널이 없거나 유효하지 않음`);
      }
    });
  }

  if (promises.length > 0) {
    Logger.info(`[fetchAllChannelData] ${promises.length}개 채널 수집 시작`);
    try {
      await Promise.all(promises);
      Logger.biz(`✅ [fetchAllChannelData] 모든 채널 데이터 수집 완료 (${promises.length}개)`);
    } catch (error) {
      Logger.error('[fetchAllChannelData] 수집 중 오류 발생:', error);
    }
  } else {
    Logger.warn('[fetchAllChannelData] 수집할 채널이 없습니다.');
  }
}

// 5. HTML 파싱 (오프스크린)
export async function parseBlogPage(url, html) {
  try {
    let content = html;
    if (!content) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fetch Fail');
      content = await res.text();
    }

    await getOffscreenDocument();
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'parse_html_in_offscreen', html: content, baseUrl: url },
        resolve
      );
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
    return new Promise((resolve) => {
      reader.onloadend = () => resolve({ success: true, dataUrl: reader.result });
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 7. 단건 저장
export async function fetchAndSaveSinglePost(url, channelId, sourceId) {
  try {
    if (!url || typeof url !== 'string') throw new Error('유효한 URL이 필요합니다.');

    // 1. 중복 검사
    const duplicateCheck = await checkDuplicateUrl(url);
    if (duplicateCheck.exists) {
      const statusMap = { ideas: '기획', 'in-progress': '작성 중', done: '발행 완료' };
      return {
        success: false,
        code: 'DUPLICATE_FOUND',
        message: `이미 '${statusMap[duplicateCheck.status] || duplicateCheck.status}' 단계에 있는 포스팅입니다.`,
        cardInfo: duplicateCheck,
      };
    }

    // 2. 플랫폼 판별 및 ID 추출
    let platform = 'blog';
    let videoId = null;
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      platform = 'youtube';
      if (urlObj.pathname.includes('/watch')) videoId = urlObj.searchParams.get('v');
      else if (urlObj.hostname.includes('youtu.be')) videoId = urlObj.pathname.substring(1);

      if (!videoId) throw new Error('YouTube ID를 찾을 수 없습니다.');
    }

    // 3. 데이터 수집 및 저장
    const userId = CONSTANTS.USER_ID;
    const db = getDb();

    if (platform === 'youtube') {
      const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');
      if (!youtubeApiKey) throw new Error('YouTube API 키가 없습니다.');

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoId}&part=snippet,statistics`
      );
      const data = await res.json();
      if (!data.items?.length) throw new Error('비디오 정보를 찾을 수 없습니다.');

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
        channelType: 'myChannels',
        fetchedAt: Date.now(),
      };

      const tags = await extractKeywords(normalized.description);
      normalized.tags = tags || null;

      await set(
        ref(db, `channel_content/${userId}/youtubes/${videoId}`),
        cleanDataForFirebase(normalized)
      );
      return { success: true, data: normalized, platform };
    } else {
      // 블로그 수집
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const parsed = await parseBlogPage(url, html);
      if (!parsed.success) throw new Error(parsed.error || '파싱 실패');

      // 태그 추출 우선순위: 메타 태그 > 본문 키워드 추출
      let tags = null;
      if (parsed.metaTags && Array.isArray(parsed.metaTags) && parsed.metaTags.length > 0) {
        tags = parsed.metaTags;
      } else if (parsed.cleanText) {
        tags = await extractKeywords(parsed.cleanText);
      }
      let title = '제목 없음';
      const titleMatch = html.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      const contentId = btoa(url.split('?')[0]).replace(/=/g, '');

      // [수정] sourceId를 정확히 설정
      // sourceId가 전달되면 그대로 사용, 없으면 channelId를 기반으로 생성
      let finalSourceId = sourceId;
      if (!finalSourceId && channelId) {
        // channelId가 base64 인코딩된 apiUrl인지 확인
        try {
          const decoded = atob(channelId.replace(/=/g, ''));
          if (decoded.startsWith('http')) {
            finalSourceId = channelId; // 이미 base64 인코딩된 apiUrl이면 그대로 사용
            Logger.debug(
              `[fetchAndSaveSinglePost] channelId가 base64 인코딩된 URL: ${decoded.substring(0, 50)}...`
            );
          } else {
            // channelId가 일반 ID면, 채널 정보에서 apiUrl을 찾아서 인코딩
            const channelsSnap = await get(ref(db, `channels/${userId}`));
            const channels = channelsSnap?.val() || {};
            const myBlogs = channels.myChannels?.blogs || [];
            const matchedChannel = myBlogs.find((blog) => {
              const blogId = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, '') : null);
              return blogId === channelId;
            });

            if (matchedChannel && matchedChannel.apiUrl) {
              finalSourceId = btoa(matchedChannel.apiUrl).replace(/=/g, '');
              Logger.debug(
                `[fetchAndSaveSinglePost] 채널에서 apiUrl 찾음, sourceId 생성: ${finalSourceId.substring(0, 20)}...`
              );
            } else if (matchedChannel && matchedChannel.url) {
              // apiUrl이 없으면 url을 RSS URL로 변환 후 인코딩
              const urlObj = new URL(matchedChannel.url);
              const host = urlObj.hostname.toLowerCase();
              let rssUrl = null;

              if (host.includes('tistory.com')) {
                rssUrl = `${urlObj.origin}/rss`;
              } else if (host.includes('blog.naver.com')) {
                const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
                if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
                  rssUrl = `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
                } else {
                  rssUrl = `${urlObj.origin}/rss`;
                }
              } else {
                rssUrl = matchedChannel.url.endsWith('/')
                  ? `${matchedChannel.url}feed`
                  : `${matchedChannel.url}/feed`;
              }

              finalSourceId = btoa(rssUrl).replace(/=/g, '');
              Logger.debug(
                `[fetchAndSaveSinglePost] RSS URL로 sourceId 생성: ${finalSourceId.substring(0, 20)}...`
              );
            } else {
              finalSourceId = channelId; // fallback: channelId 사용
              Logger.warn(
                `[fetchAndSaveSinglePost] 채널을 찾지 못해 channelId를 sourceId로 사용: ${channelId}`
              );
            }
          }
        } catch (e) {
          // channelId가 base64가 아닌 경우, 채널 정보에서 찾기
          try {
            const channelsSnap = await get(ref(db, `channels/${userId}`));
            const channels = channelsSnap?.val() || {};
            const myBlogs = channels.myChannels?.blogs || [];
            const matchedChannel = myBlogs.find((blog) => {
              const blogId = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, '') : null);
              return blogId === channelId;
            });

            if (matchedChannel && matchedChannel.apiUrl) {
              finalSourceId = btoa(matchedChannel.apiUrl).replace(/=/g, '');
            } else {
              finalSourceId = channelId; // 최종 fallback
            }
          } catch (err) {
            finalSourceId = channelId; // 최종 fallback
            Logger.warn(
              `[fetchAndSaveSinglePost] sourceId 생성 실패, channelId 사용: ${channelId}`,
              err
            );
          }
        }
      }

      Logger.info(
        `[fetchAndSaveSinglePost] 최종 sourceId: ${finalSourceId?.substring(0, 20) || 'null'}...`
      );

      const finalData = {
        title,
        fullLink: url,
        pubDate: Date.now(),
        description: parsed.description,
        thumbnail: parsed.thumbnail,
        cleanText: parsed.cleanText,
        sourceId: finalSourceId || channelId,
        channelType: 'myChannels',
        fetchedAt: Date.now(),
        ...parsed.metrics,
        tags: tags || null,
      };

      await set(
        ref(db, `channel_content/${userId}/blogs/${contentId}`),
        cleanDataForFirebase(finalData)
      );
      return { success: true, data: finalData, platform };
    }
  } catch (e) {
    console.error('[fetchAndSaveSinglePost] 오류:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteChannelData(urlToDelete) {
  try {
    const userId = await getCurrentUserId();
    const db = getDb();
    const channelsRef = ref(db, `channels/${userId}`);
    const snap = await get(channelsRef);
    const allChannels = snap.val();
    if (!allChannels) throw new Error('채널 정보 없음');

    let channelIdToDelete = null;
    let sourceIdToDelete = null;
    let platformToDelete = null;
    let channelFound = false;
    let channelInfo = null;

    // 채널 찾기 및 삭제
    for (const type of ['myChannels', 'competitorChannels']) {
      for (const platform of ['blogs', 'youtubes']) {
        const list = allChannels[type]?.[platform] || [];
        const idx = list.findIndex((c) => {
          const url = c.inputUrl || c.url;
          return url === urlToDelete;
        });
        if (idx > -1) {
          channelInfo = list[idx];
          channelIdToDelete =
            channelInfo.id ||
            (channelInfo.apiUrl ? btoa(channelInfo.apiUrl).replace(/=/g, '') : null);
          sourceIdToDelete =
            platform === 'blogs'
              ? btoa(channelInfo.apiUrl || channelInfo.inputUrl || channelInfo.url).replace(
                  /=/g,
                  ''
                )
              : channelInfo.apiUrl || channelInfo.inputUrl || channelInfo.url;
          platformToDelete = platform;
          list.splice(idx, 1); // 배열에서 제거
          channelFound = true;
          break;
        }
      }
      if (channelFound) break;
    }

    if (!channelFound) return { success: true, message: '삭제할 채널을 찾지 못함' };

    // [중요] 연쇄 삭제: 채널 ID로 연결된 모든 데이터 삭제
    if (channelIdToDelete) {
      try {
        const { deleteChannelDataCascade } = await import('./cascadeDeleteService.js');
        const cascadeResult = await deleteChannelDataCascade(channelIdToDelete, userId);
        Logger.info(
          `[deleteChannelData] 연쇄 삭제 완료 - 삭제된 항목: ${cascadeResult.deletedCount || 0}개`
        );
      } catch (error) {
        Logger.error(`[deleteChannelData] 연쇄 삭제 중 오류:`, error);
        // 연쇄 삭제 실패해도 채널 설정 삭제는 계속 진행
      }
    }

    // DB 업데이트
    await Promise.all([
      set(channelsRef, allChannels), // 목록 업데이트
      remove(ref(db, `channel_meta/${userId}/${sourceIdToDelete}`)), // 메타 삭제
    ]);

    return { success: true };
  } catch (e) {
    Logger.error('[deleteChannelData] 오류:', e);
    return { success: false, error: e.message };
  }
}

export async function refreshChannelData(sourceId, platform) {
  try {
    let apiUrl = sourceId;
    if (platform === 'blog') {
      try {
        apiUrl = atob(sourceId.replace(/_/g, '/').replace(/-/g, '+'));
      } catch (e) {
        // Base64 디코딩 실패 시 원본 사용
      }
    }

    if (platform === 'blog') {
      await fetchRssFeed(apiUrl, 'manual_refresh');
    } else if (platform === 'youtube') {
      await fetchYoutubeChannel(apiUrl, 'manual_refresh');
    }

    return { success: true, message: '새로고침 완료' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function extractKeywords(text) {
  // 간단한 키워드 추출 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 10) return [];

  try {
    // 기본 키워드 추출: 제목과 본문에서 자주 나오는 명사 추출
    // 1. 제목에서 키워드 추출 (첫 100자)
    const titleText = text.substring(0, 100);
    const titleKeywords = extractKeywordsFromText(titleText, 3);

    // 2. 본문에서 키워드 추출 (전체 텍스트)
    const bodyKeywords = extractKeywordsFromText(text, 5);

    // 3. 중복 제거 및 병합
    const allKeywords = [...new Set([...titleKeywords, ...bodyKeywords])];

    // 최대 10개까지만 반환
    return allKeywords.slice(0, 10);
  } catch (error) {
    Logger.warn('[extractKeywords] 키워드 추출 실패:', error);
    return [];
  }
}

/**
 * 텍스트에서 키워드 추출 (간단한 빈도 기반)
 */
function extractKeywordsFromText(text, maxCount = 5) {
  if (!text || text.length < 10) return [];

  // 한글 단어 추출 (2글자 이상)
  const koreanWords = text.match(/[가-힣]{2,}/g) || [];

  // 불용어 제거
  const stopWords = [
    '것',
    '수',
    '등',
    '및',
    '또한',
    '그리고',
    '하지만',
    '그러나',
    '이것',
    '저것',
    '때문',
    '위해',
    '통해',
    '대해',
    '관련',
    '이후',
    '이전',
    '이번',
    '다음',
    '이런',
    '그런',
    '저런',
    '이렇게',
    '그렇게',
    '저렇게',
    '이렇게',
    '그렇게',
    '저렇게',
  ];

  // 단어 빈도 계산
  const wordFreq = {};
  koreanWords.forEach((word) => {
    if (word.length >= 2 && !stopWords.includes(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });

  // 빈도순 정렬
  const sortedWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([word]) => word);

  return sortedWords;
}
export async function summarizeText(text) {
  // 간단한 요약 로직 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 200) return text;
  return text.substring(0, 200) + '...';
}
