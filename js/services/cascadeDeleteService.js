// js/services/cascadeDeleteService.js
// 연쇄 삭제(Cascade Delete) 서비스

import { getDb, getCurrentUserId } from './firebaseService.js';
import { ref, get, remove } from './firebaseService.js';
import { Logger } from '../utils.js';

// resolveBlogUrlToRss 함수를 collectorService에서 가져오기 위해 재구현
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

/**
 * URL 정규화 함수 (trailing slash, http/https 등 통일)
 */
function normalizeUrlForMatching(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const urlObj = new URL(url);
    // 프로토콜, 호스트, 경로 정규화
    let normalized = `${urlObj.protocol}//${urlObj.hostname.toLowerCase()}${urlObj.pathname}`;
    // trailing slash 제거
    normalized = normalized.replace(/\/$/, '');
    return normalized;
  } catch (e) {
    return url.trim();
  }
}

/**
 * 경쟁 채널 URL로 수집된 데이터 삭제
 * @param {string} competitorUrl - 삭제할 경쟁 채널 URL
 * @param {string} userId - 사용자 ID
 * @returns {Promise<{success: boolean, deletedCount?: number, error?: string}>}
 */
export async function deleteCompetitorData(competitorUrl, userId) {
  try {
    Logger.info(`[deleteCompetitorData] 경쟁 채널 데이터 삭제 시작 - URL: ${competitorUrl}`);
    
    // URL 정규화
    const normalizedUrl = normalizeUrlForMatching(competitorUrl);
    
    // 가능한 모든 sourceId 변형 생성
    const sourceIds = new Set();
    
    // 1. 원본 URL로 생성
    sourceIds.add(btoa(competitorUrl).replace(/=/g, ''));
    sourceIds.add(btoa(normalizedUrl).replace(/=/g, ''));
    
    // 2. RSS URL로 변환 후 생성
    const rssUrl = resolveBlogUrlToRss(competitorUrl);
    if (rssUrl) {
      sourceIds.add(btoa(rssUrl).replace(/=/g, ''));
      Logger.debug(`[deleteCompetitorData] RSS URL: ${rssUrl}`);
    }
    
    // 3. 정규화된 URL의 RSS 버전도 시도
    const normalizedRssUrl = resolveBlogUrlToRss(normalizedUrl);
    if (normalizedRssUrl && normalizedRssUrl !== rssUrl) {
      sourceIds.add(btoa(normalizedRssUrl).replace(/=/g, ''));
    }
    
    Logger.debug(`[deleteCompetitorData] 시도할 sourceId 개수: ${sourceIds.size}`);
    const sourceIdArray = Array.from(sourceIds);
    
    let deletedCount = 0;
    
    // 1. channel_content에서 해당 sourceId를 가진 데이터 삭제
    try {
      const blogsSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const blogs = blogsSnap?.val() || {};
      
      Logger.debug(`[deleteCompetitorData] 블로그 콘텐츠 검색 중... (총 ${Object.keys(blogs).length}개)`);
      
      for (const contentId in blogs) {
        const content = blogs[contentId];
        // 모든 가능한 sourceId 변형과 비교
        if (sourceIdArray.includes(content.sourceId)) {
          await remove(ref(getDb(), `channel_content/${userId}/blogs/${contentId}`));
          deletedCount++;
          Logger.info(`[deleteCompetitorData] ✅ 블로그 콘텐츠 삭제: ${contentId} (sourceId: ${content.sourceId?.substring(0, 20)}...)`);
        } else {
          Logger.debug(`[deleteCompetitorData] 매칭 실패: ${contentId} (sourceId: ${content.sourceId?.substring(0, 20)}...)`);
        }
      }
      
      const youtubesSnap = await get(ref(getDb(), `channel_content/${userId}/youtubes`));
      const youtubes = youtubesSnap?.val() || {};
      
      Logger.debug(`[deleteCompetitorData] YouTube 콘텐츠 검색 중... (총 ${Object.keys(youtubes).length}개)`);
      
      for (const videoId in youtubes) {
        const video = youtubes[videoId];
        // 모든 가능한 sourceId 변형과 비교
        if (sourceIdArray.includes(video.sourceId)) {
          await remove(ref(getDb(), `channel_content/${userId}/youtubes/${videoId}`));
          deletedCount++;
          Logger.info(`[deleteCompetitorData] ✅ YouTube 콘텐츠 삭제: ${videoId} (sourceId: ${video.sourceId?.substring(0, 20)}...)`);
        }
      }
    } catch (error) {
      Logger.error(`[deleteCompetitorData] channel_content 삭제 중 오류:`, error);
    }
    
    // 2. channel_meta 삭제 (모든 가능한 sourceId 변형 시도)
    for (const sid of sourceIdArray) {
      try {
        await remove(ref(getDb(), `channel_meta/${userId}/${sid}`));
        Logger.debug(`[deleteCompetitorData] ✅ channel_meta 삭제: ${sid.substring(0, 20)}...`);
      } catch (error) {
        // 존재하지 않는 경로는 무시 (정상)
        Logger.debug(`[deleteCompetitorData] channel_meta 없음: ${sid.substring(0, 20)}...`);
      }
    }
    
    Logger.info(`[deleteCompetitorData] 경쟁 채널 데이터 삭제 완료 - 삭제된 항목: ${deletedCount}개`);
    return { success: true, deletedCount };
  } catch (error) {
    Logger.error(`[deleteCompetitorData] 오류:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 채널 ID로 연결된 모든 데이터 삭제
 * @param {string} channelId - 삭제할 채널 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<{success: boolean, deletedCount?: number, error?: string}>}
 */
export async function deleteChannelDataCascade(channelId, userId) {
  try {
    Logger.info(`[deleteChannelDataCascade] 채널 데이터 연쇄 삭제 시작 - channelId: ${channelId}`);
    
    let deletedCount = 0;
    
    // 1. channel_content에서 해당 channelId를 가진 데이터 삭제
    try {
      const blogsSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const blogs = blogsSnap?.val() || {};
      
      for (const contentId in blogs) {
        const content = blogs[contentId];
        if (content.channelId === channelId || content.sourceId === channelId) {
          await remove(ref(getDb(), `channel_content/${userId}/blogs/${contentId}`));
          deletedCount++;
          Logger.debug(`[deleteChannelDataCascade] 블로그 콘텐츠 삭제: ${contentId}`);
        }
      }
      
      const youtubesSnap = await get(ref(getDb(), `channel_content/${userId}/youtubes`));
      const youtubes = youtubesSnap?.val() || {};
      
      for (const videoId in youtubes) {
        const video = youtubes[videoId];
        if (video.channelId === channelId || video.sourceId === channelId) {
          await remove(ref(getDb(), `channel_content/${userId}/youtubes/${videoId}`));
          deletedCount++;
          Logger.debug(`[deleteChannelDataCascade] YouTube 콘텐츠 삭제: ${videoId}`);
        }
      }
    } catch (error) {
      Logger.warn(`[deleteChannelDataCascade] channel_content 삭제 중 오류:`, error);
    }
    
    // 2. scraps에서 해당 channelId를 가진 데이터 삭제
    try {
      const scrapsSnap = await get(ref(getDb(), `scraps/${userId}`));
      const scraps = scrapsSnap?.val() || {};
      
      for (const scrapId in scraps) {
        const scrap = scraps[scrapId];
        if (scrap.channelId === channelId) {
          await remove(ref(getDb(), `scraps/${userId}/${scrapId}`));
          deletedCount++;
          Logger.debug(`[deleteChannelDataCascade] 스크랩 삭제: ${scrapId}`);
        }
      }
    } catch (error) {
      Logger.warn(`[deleteChannelDataCascade] scraps 삭제 중 오류:`, error);
    }
    
    // 3. kanban에서 해당 channelId를 가진 카드 삭제
    try {
      const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
      const kanban = kanbanSnap?.val() || {};
      
      for (const status in kanban) {
        for (const cardId in kanban[status]) {
          const card = kanban[status][cardId];
          if (card.channelId === channelId) {
            await remove(ref(getDb(), `kanban/${userId}/${status}/${cardId}`));
            deletedCount++;
            Logger.debug(`[deleteChannelDataCascade] 칸반 카드 삭제: ${status}/${cardId}`);
          }
        }
      }
    } catch (error) {
      Logger.warn(`[deleteChannelDataCascade] kanban 삭제 중 오류:`, error);
    }
    
    // 4. channel_meta 삭제 (sourceId로도 시도)
    try {
      await remove(ref(getDb(), `channel_meta/${userId}/${channelId}`));
      Logger.debug(`[deleteChannelDataCascade] channel_meta 삭제: ${channelId}`);
    } catch (error) {
      Logger.warn(`[deleteChannelDataCascade] channel_meta 삭제 중 오류:`, error);
    }
    
    Logger.info(`[deleteChannelDataCascade] 채널 데이터 연쇄 삭제 완료 - 삭제된 항목: ${deletedCount}개`);
    return { success: true, deletedCount };
  } catch (error) {
    Logger.error(`[deleteChannelDataCascade] 오류:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 삭제된 경쟁 채널 URL 목록 찾기
 * @param {Array} oldCompetitors - 기존 경쟁 채널 배열
 * @param {Array} newCompetitors - 새로운 경쟁 채널 배열
 * @returns {Array<string>} 삭제된 URL 목록
 */
export function findDeletedCompetitors(oldCompetitors, newCompetitors) {
  if (!Array.isArray(oldCompetitors) || oldCompetitors.length === 0) {
    return [];
  }
  
  if (!Array.isArray(newCompetitors)) {
    // newCompetitors가 없으면 모든 기존 competitors가 삭제된 것으로 간주
    return oldCompetitors.map(c => typeof c === 'string' ? c : (c.inputUrl || c.url || '')).filter(Boolean);
  }
  
  // URL 정규화 함수
  const normalizeUrl = (url) => {
    if (typeof url === 'string') return url.trim();
    if (typeof url === 'object' && url !== null) {
      return (url.inputUrl || url.url || '').trim();
    }
    return '';
  };
  
  const oldUrls = new Set(oldCompetitors.map(normalizeUrl).filter(Boolean));
  const newUrls = new Set(newCompetitors.map(normalizeUrl).filter(Boolean));
  
  // 기존에 있지만 새 배열에 없는 URL 찾기
  const deletedUrls = [];
  oldUrls.forEach(url => {
    if (!newUrls.has(url)) {
      deletedUrls.push(url);
    }
  });
  
  return deletedUrls;
}

