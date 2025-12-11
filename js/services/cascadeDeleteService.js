// js/services/cascadeDeleteService.js
// 연쇄 삭제(Cascade Delete) 서비스 - 덤프 데이터 기반 정밀 수정

import { getDb } from './firebaseService.js';
import { ref, get, remove } from './firebaseService.js';
import { Logger } from '../utils.js';

/**
 * [수정 1] URL 인덱스 키 생성기 (덤프 데이터 형식 반영)
 * 실제 DB: costcatcher_DOT_k-posting_DOT_info_SLASH_...
 */
function encodeUrlForIndex(url) {
  if (!url) return null;
  try {
    let cleanUrl = url.trim();
    // 프로토콜 제거
    cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
    // 특수문자 치환 (collectorService 로직 추정)
    return cleanUrl
      .replace(/\./g, '_DOT_')
      .replace(/\//g, '_SLASH_')
      .replace(/#/g, '_HASH_')
      .replace(/\?/g, '_QM_');
  } catch (e) {
    return null;
  }
}

/**
 * [수정 2] Legacy Key 생성기 (가능한 모든 RSS 변형 생성)
 * 커스텀 도메인을 위해 /rss, /feed 등을 무차별적으로 모두 생성하여 추적
 */
function generateLegacyKeys(url) {
  const keys = new Set();
  if (!url || typeof url !== 'string') return keys;

  try {
    // 1. URL 정규화 및 객체 생성
    const cleanUrl = url.trim().replace(/\/$/, ''); // 끝 슬래시 제거
    let urlObj;
    try {
      urlObj = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);
    } catch (e) {
      return keys; // 유효하지 않은 URL
    }

    const origin = urlObj.origin; // https://ecodeviceit.tistory.com
    const pathname = urlObj.pathname; // /rss 등

    // 2. 추적할 후보 URL 리스트 (Priority List)
    const candidates = [
      cleanUrl, // 1. 입력된 원본
      `${origin}/rss`, // 2. 티스토리 표준 (/rss)
      `${origin}/feed`, // 3. 워드프레스/미디엄 표준 (/feed)
      `${origin}/feeds/posts/default?alt=rss`, // 4. 구글 블로거 표준
    ];

    // 경로가 이미 있는 경우 (예: /rss가 포함된 경우)
    if (!pathname || pathname === '/') {
      // 이미 위에서 처리됨
    } else {
      candidates.push(`${origin}${pathname}`); // 경로 포함 원본
    }

    // 3. 모든 후보를 Base64 인코딩하여 키 생성
    candidates.forEach((c) => {
      keys.add(btoa(c).replace(/=/g, '')); // Standard Base64
      // http/https 교차 검증
      if (c.startsWith('https:')) {
        keys.add(btoa(c.replace('https:', 'http:')).replace(/=/g, ''));
      } else if (c.startsWith('http:')) {
        keys.add(btoa(c.replace('http:', 'https:')).replace(/=/g, ''));
      }
    });
  } catch (e) {
    console.warn('Key gen error:', e);
  }
  return keys;
}

/**
 * [채널 전체 삭제] 채널 ID(UUID)와 URL(Legacy Key)을 모두 사용하여 데이터 완전 삭제
 */
export async function deleteChannelDataCascade(channelId, userId, channelUrl = null) {
  try {
    Logger.biz(`🚨 [Cascade Delete] 정밀 삭제 시작 - ID: ${channelId}, URL: ${channelUrl}`);

    const stats = {
      kanban: 0,
      scraps: 0,
      urlIndex: 0,
      contentCache: 0,
      meta: 0,
    };

    // -------------------------------------------------------
    // 1. Legacy Key 추적 (Source ID 계산)
    // -------------------------------------------------------
    const targetKeys = Array.from(generateLegacyKeys(channelUrl));
    Logger.debug(`[Cascade Delete] 삭제할 채널 ID: ${channelId}, URL: ${channelUrl}`);
    Logger.debug(`[Cascade Delete] 추적할 Legacy Keys (${targetKeys.length}개):`, targetKeys);

    // -------------------------------------------------------
    // 1.5. Competitor Channels 가져오기
    // -------------------------------------------------------
    const channelMetaRef = ref(getDb(), `channel_meta/${userId}/${channelId}`);
    const channelMetaSnap = await get(channelMetaRef);
    const channelMeta = channelMetaSnap.val();
    const competitorChannels = channelMeta?.competitorChannels || [];
    Logger.debug(`[Cascade Delete] Competitor Channels:`, competitorChannels);

    // -------------------------------------------------------
    // 2. [Channel Content & Meta] RSS 캐시 및 메타 삭제 (Legacy Key 사용)
    // -------------------------------------------------------

    // (A) Channel Meta 삭제
    for (const key of targetKeys) {
      try {
        await remove(ref(getDb(), `channel_meta/${userId}/${key}`));
        stats.meta++;
      } catch (e) {
        Logger.warn('[Cascade Delete] channel_meta delete ignored error', e);
      }
    }
    // UUID 키 메타도 시도
    if (channelId) await remove(ref(getDb(), `channel_meta/${userId}/${channelId}`));
    // Competitor Channels 메타 삭제
    for (const competitorChannelId of competitorChannels) {
      try {
        await remove(ref(getDb(), `channel_meta/${userId}/${competitorChannelId}`));
        stats.meta++;
      } catch (e) {
        Logger.warn('[Cascade Delete] competitor channel meta delete ignored error', e);
      }
    }

    // (B) Channel Content 삭제
    try {
      // 블로그 캐시
      const blogsSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const blogs = blogsSnap?.val() || {};
      Logger.debug(`[Cascade Delete] blogs 데이터 개수: ${Object.keys(blogs).length}`);
      for (const contentId in blogs) {
        const content = blogs[contentId];
        let shouldDelete = false;
        if (content.channelType === 'competitorChannels') {
          shouldDelete = true; // competitorChannels 타입의 데이터는 삭제
        } else {
          shouldDelete =
            content.channelId === channelId ||
            competitorChannels.includes(content.channelId) ||
            (content.sourceId && targetKeys.includes(content.sourceId));
        }
        Logger.debug(
          `[Cascade Delete] blogs/${contentId} - channelId: ${content.channelId}, sourceId: ${content.sourceId}, shouldDelete: ${shouldDelete}`
        );
        if (shouldDelete) {
          await remove(ref(getDb(), `channel_content/${userId}/blogs/${contentId}`));
          stats.contentCache++;
        }
      }

      // 유튜브 캐시
      const youtubesSnap = await get(ref(getDb(), `channel_content/${userId}/youtubes`));
      const youtubes = youtubesSnap?.val() || {};
      Logger.debug(`[Cascade Delete] youtubes 데이터 개수: ${Object.keys(youtubes).length}`);
      for (const videoId in youtubes) {
        const video = youtubes[videoId];
        let shouldDelete = false;
        if (video.channelType === 'competitorChannels') {
          shouldDelete = true; // competitorChannels 타입의 데이터는 삭제
        } else {
          shouldDelete =
            video.channelId === channelId ||
            competitorChannels.includes(video.channelId) ||
            (video.sourceId && targetKeys.includes(video.sourceId));
        }
        Logger.debug(
          `[Cascade Delete] youtubes/${videoId} - channelId: ${video.channelId}, sourceId: ${video.sourceId}, shouldDelete: ${shouldDelete}`
        );
        if (shouldDelete) {
          await remove(ref(getDb(), `channel_content/${userId}/youtubes/${videoId}`));
          stats.contentCache++;
        }
      }

      // 경쟁사 채널 캐시 (legacy 지원)
      const competitorBlogsSnap = await get(
        ref(getDb(), `channel_content/${userId}/competitorChannels/blogs`)
      );
      const competitorBlogs = competitorBlogsSnap?.val() || {};
      Logger.debug(
        `[Cascade Delete] competitorBlogs 데이터 개수: ${Object.keys(competitorBlogs).length}`
      );
      for (const contentId in competitorBlogs) {
        const content = competitorBlogs[contentId];
        let shouldDelete = false;
        if (content.channelType === 'competitorChannels') {
          shouldDelete = true; // competitorChannels 타입의 데이터는 삭제
        } else {
          shouldDelete =
            content.channelId === channelId ||
            competitorChannels.includes(content.channelId) ||
            (content.sourceId && targetKeys.includes(content.sourceId));
        }
        Logger.debug(
          `[Cascade Delete] competitorBlogs/${contentId} - channelId: ${content.channelId}, sourceId: ${content.sourceId}, shouldDelete: ${shouldDelete}`
        );
        if (shouldDelete) {
          await remove(
            ref(getDb(), `channel_content/${userId}/competitorChannels/blogs/${contentId}`)
          );
          stats.contentCache++;
        }
      }

      const competitorYoutubesSnap = await get(
        ref(getDb(), `channel_content/${userId}/competitorChannels/youtubes`)
      );
      const competitorYoutubes = competitorYoutubesSnap?.val() || {};
      Logger.debug(
        `[Cascade Delete] competitorYoutubes 데이터 개수: ${Object.keys(competitorYoutubes).length}`
      );
      for (const videoId in competitorYoutubes) {
        const video = competitorYoutubes[videoId];
        let shouldDelete = false;
        if (video.channelType === 'competitorChannels') {
          shouldDelete = true; // competitorChannels 타입의 데이터는 삭제
        } else {
          shouldDelete =
            video.channelId === channelId ||
            competitorChannels.includes(video.channelId) ||
            (video.sourceId && targetKeys.includes(video.sourceId));
        }
        Logger.debug(
          `[Cascade Delete] competitorYoutubes/${videoId} - channelId: ${video.channelId}, sourceId: ${video.sourceId}, shouldDelete: ${shouldDelete}`
        );
        if (shouldDelete) {
          await remove(
            ref(getDb(), `channel_content/${userId}/competitorChannels/youtubes/${videoId}`)
          );
          stats.contentCache++;
        }
      }
    } catch (e) {
      Logger.warn('Content deletion error', e);
    }

    // -------------------------------------------------------
    // 3. [Kanban & URL Index] 칸반 및 인덱스 삭제 (UUID 기반)
    // -------------------------------------------------------
    try {
      const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
      const kanban = kanbanSnap?.val() || {};

      for (const status in kanban) {
        for (const cardId in kanban[status]) {
          const card = kanban[status][cardId];

          if (card.channelId === channelId || competitorChannels.includes(card.channelId)) {
            // (A) URL 인덱스 삭제 (수정된 키 생성기 사용)
            if (card.origin?.postUrl) {
              const k = encodeUrlForIndex(card.origin.postUrl);
              // 로그로 키 확인
              // Logger.debug(`Deleting Index Key: ${k}`);
              if (k) {
                await remove(ref(getDb(), `url_index/${userId}/${k}/origin/${cardId}`));
                stats.urlIndex++;
              }
            }
            if (card.publishedUrl) {
              const k = encodeUrlForIndex(card.publishedUrl);
              if (k) {
                await remove(ref(getDb(), `url_index/${userId}/${k}/published/${cardId}`));
                stats.urlIndex++;
              }
            }

            // (B) 카드 삭제
            await remove(ref(getDb(), `kanban/${userId}/${status}/${cardId}`));
            stats.kanban++;
          }
        }
      }
    } catch (e) {
      Logger.error('Kanban deletion error', e);
    }

    // -------------------------------------------------------
    // 4. [Scraps] 스크랩 삭제 (UUID 기반)
    // -------------------------------------------------------
    try {
      const scrapsSnap = await get(ref(getDb(), `scraps/${userId}`));
      const scraps = scrapsSnap?.val() || {};
      for (const scrapId in scraps) {
        if (
          scraps[scrapId].channelId === channelId ||
          competitorChannels.includes(scraps[scrapId].channelId)
        ) {
          await remove(ref(getDb(), `scraps/${userId}/${scrapId}`));
          stats.scraps++;
        }
      }
    } catch (e) {
      Logger.warn('[Cascade Delete] Channel content delete stage error', e);
    }

    Logger.biz(
      `✅ [Cascade Delete] 최종 완료: 카드(${stats.kanban}), 스크랩(${stats.scraps}), 메타(${stats.meta}), 캐시(${stats.contentCache}), 인덱스(${stats.urlIndex})`
    );
    return { success: true, deletedCount: stats.kanban + stats.scraps };
  } catch (error) {
    Logger.error(`[Cascade Delete] 오류:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * [경쟁사 개별 삭제] X 버튼 클릭 시 실행
 * channel_content(캐시)와 channel_meta(정보)를 즉시 삭제합니다.
 */
export async function deleteCompetitorData(competitorUrl, userId) {
  try {
    if (!competitorUrl) return { success: false, error: 'URL이 없습니다.' };

    // 로그: 삭제 시작
    Logger.info(`[Delete Competitor] 경쟁사 데이터 삭제 시작: ${competitorUrl}`);

    // 1. 삭제할 키(Source ID) 목록 생성
    const targetKeys = Array.from(generateLegacyKeys(competitorUrl));
    Logger.debug(`[Delete Competitor] 추적할 키 목록:`, targetKeys);

    let deletedCount = 0;

    // 2. [Channel Meta] 메타데이터 삭제 (중요: 이것이 남아있어서 문제였음)
    for (const key of targetKeys) {
      try {
        const metaRef = ref(getDb(), `channel_meta/${userId}/${key}`);
        // 데이터가 있는지 확인하고 삭제 (선택 사항)
        await remove(metaRef);
        // Logger.debug(`Deleted Meta: ${key}`);
      } catch (e) {
        Logger.warn('[Cascade Delete] iterate child delete ignored error', e);
      }
    }

    // 3. [Channel Content] RSS 캐시 삭제
    try {
      const blogsSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const blogs = blogsSnap?.val() || {};

      for (const contentId in blogs) {
        // sourceId가 타겟 키 목록에 포함되면 삭제
        if (targetKeys.includes(blogs[contentId].sourceId)) {
          await remove(ref(getDb(), `channel_content/${userId}/blogs/${contentId}`));
          deletedCount++;
        }
      }
    } catch (error) {
      Logger.error(`Cache deletion error`, error);
    }

    Logger.biz(`✅ [Delete Competitor] 삭제 완료 (캐시 ${deletedCount}개 + 메타데이터)`);
    return { success: true, deletedCount };
  } catch (error) {
    Logger.error(`[Delete Competitor] 오류:`, error);
    return { success: false, error: error.message };
  }
}

export function findDeletedCompetitors(oldCompetitors, newCompetitors) {
  if (!Array.isArray(oldCompetitors) || oldCompetitors.length === 0) return [];
  if (!Array.isArray(newCompetitors)) return oldCompetitors;
  const normalize = (url) =>
    typeof url === 'string' ? url.trim() : url?.inputUrl || url?.url || '';
  const newUrls = new Set(newCompetitors.map(normalize).filter(Boolean));
  return oldCompetitors.map(normalize).filter((url) => url && !newUrls.has(url));
}
