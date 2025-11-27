// js/services/cascadeDeleteService.js
// 연쇄 삭제(Cascade Delete) 서비스 - 최종 개선판

import { getDb } from "./firebaseService.js";
import { ref, get, remove } from "./firebaseService.js";
import { Logger } from "../utils.js";

// ==========================================
// 1. 헬퍼 함수 (URL 처리)
// ==========================================

/**
 * URL 정규화 함수 (매칭 확률 높이기용)
 */
function normalizeUrlForMatching(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const urlObj = new URL(url);
    // 프로토콜(http/s)과 www를 통일하고, 끝의 슬래시 제거
    let normalized = `${urlObj.protocol}//${urlObj.hostname.toLowerCase()}${
      urlObj.pathname
    }`;
    normalized = normalized.replace(/\/$/, "");
    return normalized;
  } catch (e) {
    return url.trim();
  }
}

/**
 * 블로그 URL을 RSS URL로 변환 (경쟁사 삭제 시 캐시 찾기용)
 */
function resolveBlogUrlToRss(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();
    const origin = urlObj.origin;

    if (host.includes("tistory.com")) return `${origin}/rss`;
    if (host.includes("blog.naver.com")) {
      const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1] && pathMatch[1] !== "PostList.naver") {
        return `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
      }
      return null;
    }
    // 워드프레스, 블로거 등 기타 플랫폼
    return url.endsWith("/") ? `${url}feed` : `${url}/feed`;
  } catch (e) {
    return null;
  }
}

/**
 * URL 인코딩 헬퍼 (url_index 키 생성용)
 * kanbanService/collectorService와 동일한 로직이어야 함
 */
function encodeUrlForIndex(url) {
  if (!url) return null;
  try {
    // URL 정규화 (프로토콜, www 제거 등은 collectorService 로직 따름)
    // 여기서는 안전하게 base64 변환만 수행 (실제 키와 일치해야 함)
    return btoa(url.trim())
      .replace(/=/g, "")
      .replace(/\//g, "_")
      .replace(/\+/g, "-");
  } catch (e) {
    return null;
  }
}

/**
 * 채널 ID로 연결된 모든 데이터 안전하게 삭제 (Cascade Delete)
 * @param {string} channelId - 삭제할 채널의 UUID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<{success: boolean, deletedCount: number, details: Object}>}
 */
export async function deleteChannelDataCascade(channelId, userId) {
  try {
    Logger.biz(
      `🚨 [Cascade Delete] 채널 데이터 영구 삭제 시작 - ID: ${channelId}`
    );

    const stats = {
      kanban: 0,
      scraps: 0,
      urlIndex: 0,
      contentCache: 0,
    };

    // 1. [Kanban & URL Index] 칸반 카드와 연결된 URL 인덱스 삭제 (가장 중요)
    // ----------------------------------------------------------------
    try {
      const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
      const kanban = kanbanSnap?.val() || {};

      // 모든 상태(ideas, in-progress, done) 순회
      for (const status in kanban) {
        for (const cardId in kanban[status]) {
          const card = kanban[status][cardId];

          // 해당 채널의 카드만 타겟팅
          if (card.channelId === channelId) {
            // 1-1. URL 인덱스 삭제 (중복 방지 해제)
            // (A) origin.postUrl 인덱스 삭제
            if (card.origin && card.origin.postUrl) {
              const encodedKey = encodeUrlForIndex(card.origin.postUrl);
              if (encodedKey) {
                await remove(
                  ref(
                    getDb(),
                    `url_index/${userId}/${encodedKey}/origin/${cardId}`
                  )
                );
                stats.urlIndex++;
              }
            }
            // (B) publishedUrl 인덱스 삭제
            if (card.publishedUrl) {
              const encodedKey = encodeUrlForIndex(card.publishedUrl);
              if (encodedKey) {
                await remove(
                  ref(
                    getDb(),
                    `url_index/${userId}/${encodedKey}/published/${cardId}`
                  )
                );
                stats.urlIndex++;
              }
            }

            // 1-2. 칸반 카드 본체 삭제
            await remove(ref(getDb(), `kanban/${userId}/${status}/${cardId}`));
            stats.kanban++;
          }
        }
      }
      Logger.debug(
        `[Cascade Delete] 칸반 카드 ${stats.kanban}개, 인덱스 ${stats.urlIndex}개 삭제 완료`
      );
    } catch (error) {
      Logger.error(`[Cascade Delete] 칸반/인덱스 삭제 중 오류:`, error);
    }

    // 2. [Scraps] 스크랩 데이터 삭제
    // ----------------------------------------------------------------
    try {
      const scrapsSnap = await get(ref(getDb(), `scraps/${userId}`));
      const scraps = scrapsSnap?.val() || {};

      for (const scrapId in scraps) {
        const scrap = scraps[scrapId];
        if (scrap.channelId === channelId) {
          await remove(ref(getDb(), `scraps/${userId}/${scrapId}`));
          stats.scraps++;
        }
      }
      Logger.debug(`[Cascade Delete] 스크랩 ${stats.scraps}개 삭제 완료`);
    } catch (error) {
      Logger.warn(`[Cascade Delete] scraps 삭제 중 오류:`, error);
    }

    // 3. [Channel Content] RSS 파싱 캐시 데이터 삭제 (전단지 수거)
    // ----------------------------------------------------------------
    try {
      // 블로그 캐시
      const blogsSnap = await get(
        ref(getDb(), `channel_content/${userId}/blogs`)
      );
      const blogs = blogsSnap?.val() || {};
      for (const contentId in blogs) {
        const content = blogs[contentId];
        // channelId가 일치하거나 sourceId(URL기반 ID)가 일치하면 삭제
        if (content.channelId === channelId || content.sourceId === channelId) {
          await remove(
            ref(getDb(), `channel_content/${userId}/blogs/${contentId}`)
          );
          stats.contentCache++;
        }
      }

      // 유튜브 캐시 (혹시 있다면)
      const youtubesSnap = await get(
        ref(getDb(), `channel_content/${userId}/youtubes`)
      );
      const youtubes = youtubesSnap?.val() || {};
      for (const videoId in youtubes) {
        const video = youtubes[videoId];
        if (video.channelId === channelId || video.sourceId === channelId) {
          await remove(
            ref(getDb(), `channel_content/${userId}/youtubes/${videoId}`)
          );
          stats.contentCache++;
        }
      }
      Logger.debug(
        `[Cascade Delete] 콘텐츠 캐시 ${stats.contentCache}개 삭제 완료`
      );
    } catch (error) {
      Logger.warn(`[Cascade Delete] channel_content 삭제 중 오류:`, error);
    }

    // 4. [Channel Meta] 채널 메타데이터 삭제 (안전장치)
    // myChannels 배열에서 이미 지웠겠지만, 혹시 channel_meta 경로를 쓴다면 여기서도 삭제
    try {
      await remove(ref(getDb(), `channel_meta/${userId}/${channelId}`));
    } catch (error) {
      // 경로가 없으면 무시
    }

    // 5. [Preservation Check] 보존해야 할 자산은 건드리지 않음
    // - thumbnail_templates (삭제 X)
    // - affiliate_links (삭제 X)
    // - images storage (삭제 X - 참조 무결성 위해 보존)

    Logger.biz(
      `✅ [Cascade Delete] 채널 삭제 완료. 총 삭제: ${
        stats.kanban + stats.scraps + stats.contentCache + stats.urlIndex
      } 항목`
    );
    return {
      success: true,
      deletedCount: stats.kanban + stats.scraps,
      details: stats,
    };
  } catch (error) {
    Logger.error(`[Cascade Delete] 치명적 오류 발생:`, error);
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
    return oldCompetitors
      .map((c) => (typeof c === "string" ? c : c.inputUrl || c.url || ""))
      .filter(Boolean);
  }

  // URL 정규화 함수
  const normalizeUrl = (url) => {
    if (typeof url === "string") return url.trim();
    if (typeof url === "object" && url !== null) {
      return (url.inputUrl || url.url || "").trim();
    }
    return "";
  };

  const oldUrls = new Set(oldCompetitors.map(normalizeUrl).filter(Boolean));
  const newUrls = new Set(newCompetitors.map(normalizeUrl).filter(Boolean));

  // 기존에 있지만 새 배열에 없는 URL 찾기
  const deletedUrls = [];
  oldUrls.forEach((url) => {
    if (!newUrls.has(url)) {
      deletedUrls.push(url);
    }
  });

  return deletedUrls;
}

/**
 * [경쟁사 개별 삭제] 경쟁 채널 URL로 수집된 캐시 데이터(channel_content)만 삭제
 * (주의: 사용자가 작성한 칸반 카드는 지우지 않음)
 * @param {string} competitorUrl - 삭제할 경쟁 채널 URL
 * @param {string} userId - 사용자 ID
 */
export async function deleteCompetitorData(competitorUrl, userId) {
  try {
    if (!competitorUrl) return { success: false, error: "URL이 없습니다." };

    Logger.info(
      `[Delete Competitor] 경쟁사 데이터 정리 시작 - URL: ${competitorUrl}`
    );

    // 1. 삭제할 캐시의 키(Source ID) 후보군 생성
    const sourceIds = new Set();
    const normalizedUrl = normalizeUrlForMatching(competitorUrl);

    // (A) 원본 URL 해시
    sourceIds.add(btoa(competitorUrl).replace(/=/g, ""));
    // (B) 정규화된 URL 해시
    sourceIds.add(btoa(normalizedUrl).replace(/=/g, ""));
    // (C) RSS URL 해시 (RSS 주소로 저장된 경우 대비)
    const rssUrl = resolveBlogUrlToRss(competitorUrl);
    if (rssUrl) sourceIds.add(btoa(rssUrl).replace(/=/g, ""));

    const sourceIdArray = Array.from(sourceIds);
    let deletedCount = 0;

    // 2. channel_content에서 일치하는 캐시 데이터 삭제
    try {
      // 블로그 콘텐츠 캐시 조회
      const blogsSnap = await get(
        ref(getDb(), `channel_content/${userId}/blogs`)
      );
      const blogs = blogsSnap?.val() || {};

      for (const contentId in blogs) {
        const content = blogs[contentId];
        // 캐시 데이터의 sourceId가 삭제 대상 목록에 포함되면 삭제
        if (sourceIdArray.includes(content.sourceId)) {
          await remove(
            ref(getDb(), `channel_content/${userId}/blogs/${contentId}`)
          );
          deletedCount++;
        }
      }

      // 유튜브 콘텐츠 캐시가 있다면 동일하게 처리
      const youtubesSnap = await get(
        ref(getDb(), `channel_content/${userId}/youtubes`)
      );
      const youtubes = youtubesSnap?.val() || {};
      for (const videoId in youtubes) {
        const video = youtubes[videoId];
        if (sourceIdArray.includes(video.sourceId)) {
          await remove(
            ref(getDb(), `channel_content/${userId}/youtubes/${videoId}`)
          );
          deletedCount++;
        }
      }
    } catch (error) {
      Logger.error(`[Delete Competitor] 캐시 삭제 중 오류:`, error);
    }

    Logger.info(
      `[Delete Competitor] 정리 완료 - 삭제된 캐시: ${deletedCount}개`
    );
    return { success: true, deletedCount };
  } catch (error) {
    Logger.error(`[Delete Competitor] 치명적 오류:`, error);
    return { success: false, error: error.message };
  }
}
