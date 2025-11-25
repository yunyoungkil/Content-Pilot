// js/services/kanbanService.js
// 칸반(기획 보드) 관련 서비스

import { getDb, cleanDataForFirebase, getCurrentUserId } from './firebaseService.js';
import { ref, get, set, remove, update, push, serverTimestamp } from './firebaseService.js';
import { generateIdeaBriefing } from './aiService.js';
import { checkDuplicateUrl, updateUrlIndex, removeUrlIndex, summarizeText, normalizeUrlForComparison, encodeUrlForFirebaseKey } from './collectorService.js';
import { updateSinglePerformanceMetric } from './analyticsService.js';
import { Logger } from '../utils.js';

/**
 * 새로운 아이디어 카드 생성 및 저장
 * @param {Object} ideaData - 아이디어 데이터
 * @param {string} targetStatus - 타겟 상태 (기본값: 'ideas')
 * @param {string|null} channelId - 채널 ID (기본값: null)
 * @returns {Promise<{success: boolean, firebaseKey?: string, error?: string}>}
 */
export async function createAndSaveNewIdea(ideaData, targetStatus = 'ideas', channelId = null) {
  try {
    // origin 및 tags 판별
    let origin = ideaData.origin || null;
    let tags = ideaData.keywords || ideaData.tags || [];

    // keywords와 tags 병합
    if (ideaData.keywords && ideaData.tags) {
      tags = [...(ideaData.tags || []), ...(ideaData.keywords || [])];
    } else if (ideaData.keywords) {
      tags = [...(ideaData.keywords || [])];
    } else if (ideaData.tags) {
      tags = [...(ideaData.tags || [])];
    }

    // origin이 없는 경우 판별
    if (!origin) {
      if (ideaData.keywords && ideaData.keywords.length > 0) {
        origin = { type: "ai_generated" };
      } else {
        origin = { type: "manual_entry" }; // kanbanMode.js의 수동 추가
      }
    }

    // 태그 처리 로직
    if (origin.type === "ai_generated") {
      if (!tags.includes("#AI-추천")) tags.push("#AI-추천");
    } else {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 포스팅 기반 아이디어는 AI 추천 태그 제거
    if (origin.type === 'my_post' || origin.type === 'competitor_post' || origin.type === 'my_post_renewal') {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 태그 중복 제거
    tags = [...new Set(tags)];

    const workspaceKeywords = tags.filter(t => t !== '#AI-추천');

    // Firebase 저장 객체 생성
    // ▼▼▼ [중요] PRD v1.0에 따라 workspace 객체는 반드시 생성되어야 합니다.
    // workspaceMode.js가 cardData.workspace.keywords 등을 접근하므로 필수입니다. ▼▼▼
    const newCard = {
      title: ideaData.title || "제목 없음",
      description: ideaData.description || "",
      createdAt: ideaData.createdAt || Date.now(),
      channelId: channelId, // 👈 핵심: 채널 ID 저장 (없으면 null = 공용/미지정)
      tags: tags,
      origin: origin,
      workspace: { // PRD v1.0 모델 - workspaceMode.js에서 필수로 사용
        keywords: workspaceKeywords || [],
        outline: ideaData.outline || ideaData.workspace?.outline || [],
        draft: ideaData.draft_content || ideaData.draft || ideaData.workspace?.draft || "",
        linkedScraps: ideaData.workspace?.linkedScraps || {}
      },
      // 기존 필드 호환
      recommendedKeywords: ideaData.recommendedSearches || [],
      longTailKeywords: ideaData.longTailKeywords || []
    };
    // ▲▲▲ workspace 객체 생성 완료 ▲▲▲

    // Firebase에 저장
    const userId = await getCurrentUserId();
    const newCardRef = push(ref(getDb(), `kanban/${userId}/${targetStatus}`));
    const newCardKey = newCardRef.key;
    await set(newCardRef, cleanDataForFirebase(newCard));

    // [최적화] URL 인덱스 업데이트 (origin.postUrl이 있는 경우)
    if (origin?.postUrl) {
      updateUrlIndex(newCardKey, targetStatus, origin.postUrl, null)
        .catch(error => Logger.warn(`[URL 인덱스 업데이트 실패] ${newCardKey}:`, error));
    }

    // AI 브리핑 자동 생성
    // 'manual_entry'를 제외한 모든 아이디어는 생성 즉시 AI 브리핑을 실행
    // (ai_generated, my_post, competitor_post, my_post_renewal 등 모든 경우)
    if (origin.type !== 'manual_entry' && newCard.title) {
      generateIdeaBriefing(newCardKey, newCard.title, newCard.description, { status: targetStatus })
        .catch((error) => Logger.error("브리핑 데이터 생성 실패:", error));
    }

    Logger.info(`[createAndSaveNewIdea] 아이디어 카드 생성 완료 - cardId: ${newCardKey}, status: ${targetStatus}`);
    return { success: true, firebaseKey: newCardKey };

  } catch (e) {
    Logger.error("createAndSaveNewIdea 함수 오류:", e);
    return { success: false, error: e.message };
  }
}

/**
 * 칸반에 아이디어 추가
 * @param {Object} ideaData - 아이디어 데이터
 * @param {string} status - 상태 (기본값: 'ideas')
 * @param {string|null} channelId - 채널 ID
 * @returns {Promise<{success: boolean, firebaseKey?: string, error?: string, code?: string, message?: string, cardInfo?: Object}>}
 */
export async function addIdeaToKanban(ideaData, status = 'ideas', channelId = null) {
  try {
    // 제목 검증
    if (!ideaData.title || !ideaData.title.trim()) {
      return { success: false, error: "제목은 필수입니다." };
    }
    if (ideaData.title.length > 200) {
      ideaData.title = ideaData.title.substring(0, 200);
    }

    // 중복 검사 (Collector Service 활용)
    // origin.postUrl 또는 publishedUrl로 중복 검사 수행
    const urlToCheck = ideaData.origin?.postUrl || ideaData.publishedUrl;
    if (urlToCheck) {
      const dupCheck = await checkDuplicateUrl(urlToCheck);
      if (dupCheck.exists) {
        const statusMap = {
          "ideas": "기획",
          "in-progress": "작성 중",
          "done": "발행 완료"
        };
        const statusText = statusMap[dupCheck.status] || dupCheck.status;
        return { 
          success: false, 
          code: "DUPLICATE_FOUND", 
          error: `이미 '${statusText}' 단계에 등록된 아이디어입니다.`,
          message: `이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${dupCheck.title}`,
          cardInfo: dupCheck 
        };
      }
    }

    // 요약 (AI Service 활용)
    if (ideaData.description?.length > 200) {
      ideaData.description = await summarizeText(ideaData.description);
    }

    const userId = await getCurrentUserId();
    
    // origin 및 tags 판별
    let origin = ideaData.origin || null;
    let tags = ideaData.keywords || ideaData.tags || [];

    // keywords와 tags 병합
    if (ideaData.keywords && ideaData.tags) {
      tags = [...(ideaData.tags || []), ...(ideaData.keywords || [])];
    } else if (ideaData.keywords) {
      tags = [...(ideaData.keywords || [])];
    } else if (ideaData.tags) {
      tags = [...(ideaData.tags || [])];
    }

    // origin이 없는 경우 판별
    if (!origin) {
      if (ideaData.keywords && ideaData.keywords.length > 0) {
        origin = { type: "ai_generated" };
      } else {
        origin = { type: "manual_entry" };
      }
    }

    // 태그 처리 로직
    if (origin.type === "ai_generated") {
      if (!tags.includes("#AI-추천")) tags.push("#AI-추천");
    } else {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 포스팅 기반 아이디어는 AI 추천 태그 제거
    if (origin.type === 'my_post' || origin.type === 'competitor_post' || origin.type === 'my_post_renewal') {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 태그 중복 제거
    tags = [...new Set(tags)];

    const workspaceKeywords = tags.filter(t => t !== '#AI-추천');

    // Firebase 저장 객체 생성
    const newCard = {
      title: ideaData.title,
      description: ideaData.description || "",
      createdAt: ideaData.createdAt || Date.now(),
      channelId: channelId,
      tags: tags,
      origin: origin,
      workspace: {
        keywords: workspaceKeywords || [],
        outline: ideaData.outline || ideaData.workspace?.outline || [],
        draft: ideaData.draft_content || ideaData.draft || ideaData.workspace?.draft || "",
        linkedScraps: ideaData.workspace?.linkedScraps || {}
      },
      recommendedKeywords: ideaData.recommendedSearches || [],
      longTailKeywords: ideaData.longTailKeywords || []
    };

    // publishedUrl이 있으면 카드에 저장 (성과 추적 전용)
    if (ideaData.publishedUrl) {
      newCard.publishedUrl = ideaData.publishedUrl;
    }

    // Firebase에 저장
    const finalData = { ...newCard, createdAt: Date.now(), channelId: channelId };
    const cardPath = `kanban/${userId}/${status}`;
    const pushResult = await push(ref(getDb(), cardPath));
    const cardId = pushResult.key;
    await pushResult.set(cleanDataForFirebase(finalData));

    // URL 인덱스 업데이트 (중복 검사를 위해 필수)
    if (ideaData.origin?.postUrl) {
      try {
        // publishedUrl이 있으면 publishedUrl도 인덱스에 추가
        const publishedUrl = ideaData.publishedUrl || null;
        await updateUrlIndex(cardId, status, ideaData.origin.postUrl, publishedUrl);
      } catch (error) {
        Logger.warn('[addIdeaToKanban] URL 인덱스 업데이트 실패:', error);
        // 인덱스 업데이트 실패해도 카드 추가는 성공으로 처리
      }
    } else if (ideaData.publishedUrl) {
      // origin.postUrl이 없지만 publishedUrl이 있는 경우 (성과 추적 전용)
      try {
        await updateUrlIndex(cardId, status, null, ideaData.publishedUrl);
      } catch (error) {
        Logger.warn('[addIdeaToKanban] publishedUrl 인덱스 업데이트 실패:', error);
      }
    }

    // AI 브리핑 자동 생성
    // 성과 추적 전용(tracking_only)은 이미 발행된 포스트이므로 브리핑 생성하지 않음
    const originType = ideaData.origin?.type;
    const shouldGenerateBriefing = originType !== 'manual_entry' && originType !== 'tracking_only' && ideaData.title && status === 'ideas';
    
    if (shouldGenerateBriefing) {
      Logger.info(`[addIdeaToKanban] AI 브리핑 자동 생성 시작 - cardId: ${cardId}, originType: ${originType || 'undefined'}, status: ${status}`);
      generateIdeaBriefing(cardId, ideaData.title, ideaData.description || '', {
        status: status,
        generateOutline: true,
        generateKeywords: true,
        generateLongTail: true,
        generateMainKeywords: true
      }).then(() => {
        Logger.biz(`✅ [addIdeaToKanban] AI 브리핑 생성 완료 - cardId: ${cardId}`);
      }).catch((error) => {
        Logger.error('[addIdeaToKanban] AI 브리핑 생성 실패:', error);
      });
    } else {
      Logger.debug(`[addIdeaToKanban] AI 브리핑 자동 생성 건너뜀 - originType: ${originType || 'undefined'}, status: ${status}, title: ${ideaData.title ? '있음' : '없음'}`);
    }
    
    // 성과 추적 전용인 경우 publishedUrl이 있으면 성과 데이터 수집 시작
    if (originType === 'tracking_only' && ideaData.publishedUrl) {
      Logger.info(`[addIdeaToKanban] 성과 추적 전용 카드 생성 - publishedUrl로 성과 데이터 수집 시작: ${ideaData.publishedUrl}`);
      const cardPath = `kanban/${userId}/${status}/${cardId}`;
      updateSinglePerformanceMetric({
        id: cardId,
        path: cardPath,
        url: ideaData.publishedUrl
      }).then(() => {
        Logger.biz(`✅ [addIdeaToKanban] 성과 데이터 수집 완료 - cardId: ${cardId}`);
      }).catch((error) => {
        Logger.error(`[addIdeaToKanban] 성과 데이터 수집 실패 - cardId: ${cardId}:`, error);
      });
    }

    return { success: true, firebaseKey: cardId };
  } catch (error) {
    Logger.error('[addIdeaToKanban] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 칸반에서 아이디어 제거
 * @param {string} firebaseKey - Firebase 키
 * @param {string} status - 상태 (기본값: 'ideas')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeIdeaFromKanban(firebaseKey, status = 'ideas') {
  if (!firebaseKey) {
    return { success: false, error: "삭제할 아이디어의 키가 없습니다." };
  }

  try {
    const userId = await getCurrentUserId();
    await remove(ref(getDb(), `kanban/${userId}/${status}/${firebaseKey}`));
    
    Logger.info(`[removeIdeaFromKanban] 아이디어 제거 완료 - key: ${firebaseKey}, status: ${status}`);
    return { success: true };
  } catch (error) {
    Logger.error("[removeIdeaFromKanban] 오류:", error);
    return { success: false, error: error.message };
  }
}

/**
 * 칸반 카드 삭제
 * @param {string} cardId - 카드 ID
 * @param {string} status - 상태
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteKanbanCard(cardId, status) {
  if (!cardId || !status) {
    return { success: false, error: "카드 ID와 상태가 필요합니다." };
  }

  try {
    const userId = await getCurrentUserId();
    const cardPath = `kanban/${userId}/${status}/${cardId}`;
    
    // 카드 데이터를 먼저 읽어서 URL 인덱스 삭제에 사용
    const cardSnap = await get(ref(getDb(), cardPath));
    const cardData = cardSnap?.val();
    
    if (!cardData) {
      return { success: false, error: "삭제할 카드를 찾을 수 없습니다." };
    }

    // 카드 삭제
    Logger.info(`[deleteKanbanCard] 카드 삭제 시작 - cardId: ${cardId}, status: ${status}`);
    await remove(ref(getDb(), cardPath));

    // URL 인덱스에서도 제거 (origin.postUrl 또는 publishedUrl이 있는 경우)
    if (cardData.origin?.postUrl || cardData.publishedUrl) {
      try {
        const updatePromises = [];
        
        if (cardData.origin?.postUrl) {
          const normalizedUrl = normalizeUrlForComparison(cardData.origin.postUrl);
          if (normalizedUrl) {
            const encodedKey = encodeUrlForFirebaseKey(normalizedUrl);
            const originIndexPath = `url_index/${userId}/${encodedKey}/origin/${cardId}`;
            updatePromises.push(
              remove(ref(getDb(), originIndexPath)).catch(error => {
                Logger.warn(`[deleteKanbanCard] origin URL 인덱스 삭제 실패 (${originIndexPath}):`, error);
                return null;
              })
            );
          }
        }
        
        if (cardData.publishedUrl) {
          const normalizedUrl = normalizeUrlForComparison(cardData.publishedUrl);
          if (normalizedUrl) {
            const encodedKey = encodeUrlForFirebaseKey(normalizedUrl);
            const publishedIndexPath = `url_index/${userId}/${encodedKey}/published/${cardId}`;
            updatePromises.push(
              remove(ref(getDb(), publishedIndexPath)).catch(error => {
                Logger.warn(`[deleteKanbanCard] published URL 인덱스 삭제 실패 (${publishedIndexPath}):`, error);
                return null;
              })
            );
          }
        }
        
        if (updatePromises.length > 0) {
          await Promise.all(updatePromises);
        }
      } catch (indexError) {
        Logger.warn('[deleteKanbanCard] URL 인덱스 삭제 중 오류:', indexError);
        // 인덱스 삭제 실패해도 카드 삭제는 성공으로 처리
      }
    }

    Logger.biz(`✅ [deleteKanbanCard] 카드 삭제 완료 - cardId: ${cardId}`);
    return { success: true };
  } catch (error) {
    Logger.error('[deleteKanbanCard] 카드 삭제 실패:', error);
    return { success: false, error: error.message };
  }
}

