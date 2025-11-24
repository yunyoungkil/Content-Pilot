// background.js (Final Router Version)

import { getDb, CONSTANTS, initializeFirebase, uploadImageToFirebaseStorage, cleanDataForFirebase, getCurrentUserId } from './js/services/firebaseService.js';
import { Logger } from './js/utils.js';

import { 
  updateAllPerformanceMetrics, 
  checkAdSenseRegistrationStatus, 
  runFullSystemDiagnosis
} from './js/services/analyticsService.js';

import { 
  fetchAllChannelData, 
  fetchAndSaveSinglePost, 
  deleteChannelData,
  checkDuplicateUrl,
  summarizeText,
  refreshChannelData,
  fetchImageAsBase64,
  updateUrlIndex,
  normalizeUrlForComparison,
  encodeUrlForFirebaseKey
} from './js/services/collectorService.js';

import { 
  generateDraftFromIdea, 
  generateIdeaBriefing, 
  generateAiImage, 
  analyzeImageForTemplate,
  callGeminiAPI,
  analyzeMyChannel,
  generateContentIdeas,
  generateAndSendKeywords,
  analyzeVideoComments
} from './js/services/aiService.js';

import { 
  startGoogleAuth, 
  revokeGoogleAuth,
  getValidToken,
  restoreAuthSession
} from './js/services/authService.js';

// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
// import { ref, update, remove, set, get, push, serverTimestamp, onValue } from 'firebase/database';
import { ref, update, remove, set, get, push, serverTimestamp, onValue } from './js/services/firebaseService.js';

// Firebase 초기화
initializeFirebase();

// Service Worker 전역 변수 (window 대신 사용)
let kanbanRealtimeListenerAttached = false;
let offscreenDocumentId = null; // Offscreen 문서 ID 추적

// Service Worker 시작 시 세션 복원
(async () => {
  try {
    await restoreAuthSession();
  } catch (error) {
    Logger.error('[System] 세션 복원 실패:', error);
  }
})();

Logger.info("🚀 [System] Service Worker Started (Lightweight Router)");

/**
 * Offscreen 문서 생성 및 관리
 * 이미지 처리를 백그라운드로 이관하여 메인 스레드 부하 감소
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentId) {
    // 이미 생성되어 있는지 확인
    try {
      const clients = await chrome.offscreen.hasDocument();
      if (clients) {
        Logger.debug('[Offscreen] 문서가 이미 존재합니다.');
        return offscreenDocumentId;
      }
    } catch (e) {
      // 문서가 없거나 오류 발생
      offscreenDocumentId = null;
    }
  }

  try {
    // Offscreen 문서 생성
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING', 'WORKERS'], // 이미지 처리용
      justification: '이미지 리사이징 및 템플릿 렌더링을 백그라운드에서 처리'
    });
    
    // 문서 ID 추적 (chrome.offscreen API는 직접 ID를 반환하지 않지만, 
    // hasDocument()로 존재 여부 확인 가능)
    offscreenDocumentId = 'offscreen-doc';
    Logger.info('[Offscreen] 문서 생성 완료');
    return offscreenDocumentId;
  } catch (error) {
    Logger.error('[Offscreen] 문서 생성 실패:', error);
    return null;
  }
}

/**
 * Offscreen 문서로 이미지 리사이징 요청
 * @param {string} imageDataUrl - 원본 이미지 DataURL
 * @param {number} maxWidth - 최대 너비
 * @param {number} maxHeight - 최대 높이
 * @param {number} quality - JPEG 품질 (0-1)
 * @returns {Promise<string>} 리사이즈된 이미지 DataURL
 */
async function resizeImageInOffscreen(imageDataUrl, maxWidth, maxHeight, quality = 0.9) {
  const startTime = performance.now();
  
  try {
    await ensureOffscreenDocument();
    
    // Offscreen 문서로 메시지 전송 (Promise 기반)
    // chrome.runtime.sendMessage는 offscreen 문서의 chrome.runtime.onMessage 리스너로 전달됨
    const response = await new Promise((resolve, reject) => {
      // 응답을 받을 리스너 등록
      const responseListener = (msg, sender, sendResponse) => {
        if (msg.action === 'resize_image_in_offscreen_response') {
          chrome.runtime.onMessage.removeListener(responseListener);
          if (msg.success) {
            resolve(msg);
          } else {
            reject(new Error(msg.error || '이미지 리사이징 실패'));
          }
          return true;
        }
        return false;
      };
      
      chrome.runtime.onMessage.addListener(responseListener);
      
      // Offscreen 문서로 메시지 전송
      // offscreen.js의 chrome.runtime.onMessage 리스너가 이를 받아 처리
      chrome.runtime.sendMessage({
        action: 'resize_image_in_offscreen',
        imageDataUrl,
        maxWidth,
        maxHeight,
        quality
      }).catch((err) => {
        // "message port closed"는 정상적인 상황일 수 있음
        if (err?.message && !err.message.includes('message port closed')) {
          reject(err);
        } else {
          reject(new Error('Offscreen 문서 연결 실패'));
        }
      });
      
      // 타임아웃 설정 (30초)
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(responseListener);
        reject(new Error('이미지 리사이징 타임아웃'));
      }, 30000);
    });
    
    if (response && response.success) {
      const elapsed = Math.round(performance.now() - startTime);
      Logger.info(`⚡ [Offscreen] 이미지 리사이징 완료 (${elapsed}ms)`);
      return response.dataUrl;
    } else {
      throw new Error(response?.error || '이미지 리사이징 실패');
    }
  } catch (error) {
    Logger.error('[Offscreen] 이미지 리사이징 오류:', error);
    throw error;
  }
}

/**
 * Offscreen 문서로 템플릿 렌더링 요청
 * @param {Object} templateData - 템플릿 데이터
 * @param {number} canvasWidth - 캔버스 너비
 * @param {number} canvasHeight - 캔버스 높이
 * @param {Object} dynamicText - 동적 텍스트
 * @returns {Promise<string>} 렌더링된 이미지 DataURL
 */
async function renderTemplateInOffscreen(templateData, canvasWidth, canvasHeight, dynamicText = {}) {
  const startTime = performance.now();
  
  try {
    await ensureOffscreenDocument();
    
    // Offscreen 문서로 메시지 전송 (Promise 기반)
    const response = await new Promise((resolve, reject) => {
      // 응답을 받을 리스너 등록
      const responseListener = (msg, sender, sendResponse) => {
        if (msg.action === 'render_template_in_offscreen_response') {
          chrome.runtime.onMessage.removeListener(responseListener);
          if (msg.success) {
            resolve(msg);
          } else {
            reject(new Error(msg.error || '템플릿 렌더링 실패'));
          }
          return true;
        }
        return false;
      };
      
      chrome.runtime.onMessage.addListener(responseListener);
      
      // Offscreen 문서로 메시지 전송
      chrome.runtime.sendMessage({
        action: 'render_template_in_offscreen',
        templateData,
        canvasWidth,
        canvasHeight,
        dynamicText
      }).catch((err) => {
        // "message port closed"는 정상적인 상황일 수 있음
        if (err?.message && !err.message.includes('message port closed')) {
          reject(err);
        } else {
          reject(new Error('Offscreen 문서 연결 실패'));
        }
      });
      
      // 타임아웃 설정 (60초 - 템플릿 렌더링은 더 오래 걸릴 수 있음)
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(responseListener);
        reject(new Error('템플릿 렌더링 타임아웃'));
      }, 60000);
    });
    
    if (response && response.success) {
      const elapsed = Math.round(performance.now() - startTime);
      Logger.info(`⚡ [Offscreen] 템플릿 렌더링 완료 (${elapsed}ms)`);
      return response.dataUrl;
    } else {
      throw new Error(response?.error || '템플릿 렌더링 실패');
    }
  } catch (error) {
    Logger.error('[Offscreen] 템플릿 렌더링 오류:', error);
    throw error;
  }
}

// 0. 확장 프로그램 아이콘 클릭 리스너
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    }, () => {
      if (chrome.runtime.lastError) {
        // "message port closed"는 정상적인 상황 (탭이 닫히거나 content script가 없을 때)
        // 다른 에러만 경고로 표시
        const errorMsg = chrome.runtime.lastError.message || '';
        if (!errorMsg.includes('message port closed') && 
            !errorMsg.includes('Could not establish connection')) {
          Logger.warn("[sendMessage] 메시지 전송 실패:", errorMsg);
        } else {
          // 정상적인 상황이므로 디버그 레벨로만 로깅
          Logger.debug("[sendMessage] 메시지 포트 닫힘 (정상):", errorMsg);
        }
      }
    });
  }
});

// 1. 알람 리스너 (스케줄러)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetch-channels") {
    Logger.biz("⏰ [Alarm] 채널 데이터 수집 시작");
    fetchAllChannelData();
  } else if (alarm.name === "update-performance-metrics") {
    Logger.biz("⏰ [Alarm] 성과 지표 업데이트 시작");
    updateAllPerformanceMetrics();
  }
});

// 2. 설치/업데이트 리스너
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    Logger.info(`[System] Extension ${details.reason}d. Registering alarms...`);
    chrome.alarms.create("fetch-channels", { delayInMinutes: 1, periodInMinutes: 240 });
    chrome.alarms.create("update-performance-metrics", { delayInMinutes: 5, periodInMinutes: 360 });
    
    // 기본 설정 초기화
    chrome.storage.local.set({
      isScrapingActive: false,
      highlightToggleState: false,
      isKeywordExtractionEnabled: true,
    });
  }
});

// 3. 메시지 라우터 (Message Router)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Offscreen 응답 메시지는 라우터에서 제외 (내부 Promise 리스너가 처리)
  if (msg.action === 'resize_image_in_offscreen_response' || 
      msg.action === 'render_template_in_offscreen_response') {
    return false; // 다른 리스너가 처리하도록 함
  }
  
  // 비동기 응답 처리를 위한 헬퍼
  const handleAsync = (promise) => {
    promise
      .then(data => sendResponse(data || { success: true }))
      .catch(err => {
        Logger.error(`[Router Error] ${msg.action}:`, err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답 표시
  };

  // === [Collector Service] 데이터 수집 ===
  if (msg.action === "fetch_all_channel_data") return handleAsync(fetchAllChannelData());
  if (msg.action === "refresh_channel_data") return handleAsync(refreshChannelData(msg.sourceId, msg.platform));
  if (msg.action === "fetch_and_save_single_post") return handleAsync(fetchAndSaveSinglePost(msg.url, msg.channelId, msg.sourceId));
  if (msg.action === "delete_channel") return handleAsync(deleteChannelData(msg.url));
  if (msg.action === "fetch_image_as_base64") return handleAsync(fetchImageAsBase64(msg.url));
  
  // === [Analytics Service] 성과 분석 & 진단 ===
  if (msg.action === "trigger_performance_refresh") return handleAsync(updateAllPerformanceMetrics());
  if (msg.action === "check_adsense_registration") return handleAsync(checkAdSenseRegistrationStatus());
  if (msg.action === "run_system_diagnosis") return handleAsync(runFullSystemDiagnosis());
  // TODO: 아래 함수들은 아직 구현되지 않음
  if (msg.action === "run_adsense_deep_diagnosis") return handleAsync(Promise.reject(new Error("runAdSenseDeepDiagnosis: 아직 구현되지 않음")));
  if (msg.action === "test_blog_connection") return handleAsync(Promise.reject(new Error("testBlogConnection: 아직 구현되지 않음")));
  if (msg.action === "test_adsense_ga4_access") return handleAsync(Promise.reject(new Error("testAdSenseGa4Access: 아직 구현되지 않음")));

  // === [AI Service] 생성 및 분석 ===
  if (msg.action === "generate_draft_from_idea") return handleAsync(generateDraftFromIdea(msg.data));
  if (msg.action === "generate_idea_briefing") {
    const { cardId, title, description, ...opts } = msg.data;
    opts.onProgress = (p) => {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, { action: "briefing_progress", cardId, progress: p }).catch((err) => {
          // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
          if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
            Logger.debug('[sendMessage] briefing_progress 전송 실패:', err.message);
          }
        });
      }
    };
    return handleAsync(generateIdeaBriefing(cardId, title, description, opts));
  }
  if (msg.action === "ai_generate_images") {
    return handleAsync(generateAiImage(msg.data.prompt, msg.data.count).then(images => ({ success: true, images })));
  }
  if (msg.action === "analyze_image_for_template") return handleAsync(analyzeImageForTemplate(msg.data));
  if (msg.action === "call_gemini") return handleAsync(callGeminiAPI(msg.prompt).then(text => ({ success: true, text })));
  if (msg.action === "analyze_my_channel") return handleAsync(analyzeMyChannel(msg.data));
  if (msg.action === "generate_content_ideas") return handleAsync(generateContentIdeas(msg.data));
  if (msg.action === "request_search_keywords") return handleAsync(generateAndSendKeywords(msg.data, sender));
  if (msg.action === "analyze_video_comments") return handleAsync(analyzeVideoComments(msg.videoId));
  if (msg.action === "upload_thumbnail_to_storage") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      return uploadImageToFirebaseStorage(msg.data.dataUrl, `thumbnails/${userId}/${msg.data.filename || Date.now()+'.png'}`, userId).then(url => ({ success: true, url }));
    })());
  }

  // === [Offscreen Image Processing] 이미지 처리 가속 ===
  if (msg.action === "resize_image_in_offscreen") {
    return handleAsync(resizeImageInOffscreen(
      msg.data.imageDataUrl,
      msg.data.maxWidth || 1920,
      msg.data.maxHeight || 1080,
      msg.data.quality || 0.9
    ).then(dataUrl => ({ success: true, dataUrl })));
  }

  if (msg.action === "render_template_in_offscreen") {
    return handleAsync(renderTemplateInOffscreen(
      msg.data.templateData,
      msg.data.canvasWidth || 1280,
      msg.data.canvasHeight || 720,
      msg.data.dynamicText || {}
    ).then(dataUrl => ({ success: true, dataUrl })));
  }

  // === [Auth Service] 인증 ===
  if (msg.action === "start_google_auth") return handleAsync(startGoogleAuth());
  if (msg.action === "revoke_google_auth") return handleAsync(revokeGoogleAuth());

  // === [DB Operations] 단순 데이터 조작 (직접 처리) ===
  if (msg.action === "add_idea_to_kanban") {
    return handleAsync((async () => {
      const ideaData = JSON.parse(msg.data);

      // 제목 검증
      if (!ideaData.title || !ideaData.title.trim()) {
        return { success: false, error: "제목은 필수입니다." };
      }
      if (ideaData.title.length > 200) {
        ideaData.title = ideaData.title.substring(0, 200);
      }

      // 중복 검사 (Collector Service 활용)
      if (ideaData.origin?.postUrl) {
        const dupCheck = await checkDuplicateUrl(ideaData.origin.postUrl);
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

      // 저장
      const userId = await getCurrentUserId();
      const status = msg.status || 'ideas';
      const path = `kanban/${userId}/${status}`;
      const finalData = { ...ideaData, createdAt: Date.now(), channelId: msg.channelId };
      const pushResult = await push(path, finalData);
      const cardId = pushResult.key; // push()는 { key: string, set: function } 객체를 반환

      // URL 인덱스 업데이트 (중복 검사를 위해 필수)
      if (ideaData.origin?.postUrl) {
        try {
          await updateUrlIndex(cardId, status, ideaData.origin.postUrl, null);
        } catch (error) {
          Logger.warn('[add_idea_to_kanban] URL 인덱스 업데이트 실패:', error);
          // 인덱스 업데이트 실패해도 카드 추가는 성공으로 처리
        }
      }

      // AI 브리핑 자동 생성
      // 'manual_entry'를 제외한 모든 아이디어는 생성 즉시 AI 브리핑을 실행
      // (ai_generated, my_post, competitor_post, my_post_renewal, origin이 없는 경우 등 모든 경우)
      const originType = ideaData.origin?.type;
      const shouldGenerateBriefing = originType !== 'manual_entry' && ideaData.title && status === 'ideas';
      
      if (shouldGenerateBriefing) {
        // 비동기로 실행 (응답을 기다리지 않음)
        Logger.info(`[add_idea_to_kanban] AI 브리핑 자동 생성 시작 - cardId: ${cardId}, originType: ${originType || 'undefined'}, status: ${status}`);
        generateIdeaBriefing(cardId, ideaData.title, ideaData.description || '', {
          status: status, // status 전달
          generateOutline: true,
          generateKeywords: true,
          generateLongTail: true,
          generateMainKeywords: true
        }).then(() => {
          Logger.biz(`✅ [add_idea_to_kanban] AI 브리핑 생성 완료 - cardId: ${cardId}`);
        }).catch((error) => {
          Logger.error('[add_idea_to_kanban] AI 브리핑 생성 실패:', error);
          // 브리핑 생성 실패해도 카드 추가는 성공으로 처리
        });
      } else {
        Logger.debug(`[add_idea_to_kanban] AI 브리핑 자동 생성 건너뜀 - originType: ${originType || 'undefined'}, status: ${status}, title: ${ideaData.title ? '있음' : '없음'}`);
      }

      return { success: true, firebaseKey: cardId };
    })());
  }

  if (msg.action === "update_kanban_card") {
    // msg.data가 객체인 경우와 직접 속성이 있는 경우 모두 처리
    const cardId = msg.data?.cardId || msg.cardId;
    const status = msg.data?.status || msg.status;
    const updates = msg.data?.updates || msg.updates;
    
    return handleAsync((async () => {
      if (!cardId || !status || !updates) {
        Logger.error('[update_kanban_card] 필수 정보 부족:', { cardId, status, hasUpdates: !!updates });
        return { success: false, error: "필수 정보가 부족합니다." };
      }
      
      const userId = await getCurrentUserId();
      const updatePath = `kanban/${userId}/${status}/${cardId}`;
      
      Logger.debug(`[update_kanban_card] 업데이트 시작 - path: ${updatePath}, updates:`, updates);
      
      // 데이터 정제 (undefined → null)
      const cleanedUpdates = cleanDataForFirebase(updates);
      
      await update(ref(getDb(), updatePath), cleanedUpdates);
      
      Logger.biz(`✅ [update_kanban_card] 카드 업데이트 완료 - cardId: ${cardId}, status: ${status}`);
      
      // REST API 모드에서는 실시간 리스너가 작동하지 않으므로, UI 갱신을 위해 최신 데이터를 가져와서 메시지 전송
      try {
        const kanbanRef = ref(getDb(), `kanban/${userId}`);
        const kanbanSnap = await get(kanbanRef);
        const kanbanData = kanbanSnap?.val() || {};
        
        // 1. 확장 프로그램 UI(사이드 패널/팝업)에 메시지 전송
        chrome.runtime.sendMessage({
          action: "kanban_data_updated",
          data: kanbanData
        }).catch((err) => {
          if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
            Logger.debug(`[update_kanban_card] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
          }
        });
        
        // 2. 웹페이지 탭의 content script에도 메시지 전송
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
              chrome.tabs.sendMessage(tab.id, {
                action: "kanban_data_updated",
                data: kanbanData
              }).catch((err) => {
                // 조용히 무시
              });
            }
          });
        });
        Logger.debug(`[update_kanban_card] UI 갱신 메시지 전송 완료`);
      } catch (updateError) {
        Logger.warn(`[update_kanban_card] UI 갱신 메시지 전송 실패:`, updateError);
      }
      
      return { success: true };
    })());
  }
  
  if (msg.action === "delete_kanban_card") {
    return handleAsync((async () => {
      try {
        const { cardId, status } = msg.data;
        if (!cardId || !status) {
          return { success: false, error: "카드 ID와 상태가 필요합니다." };
        }

        const userId = await getCurrentUserId();
        const cardPath = `kanban/${userId}/${status}/${cardId}`;
        
        // 카드 데이터를 먼저 읽어서 URL 인덱스 삭제에 사용
        const cardSnap = await get(ref(getDb(), cardPath));
        const cardData = cardSnap?.val();
        
        if (!cardData) {
          return { success: false, error: "삭제할 카드를 찾을 수 없습니다." };
        }

        // 카드 삭제
        Logger.info(`[delete_kanban_card] 카드 삭제 시작 - cardId: ${cardId}, status: ${status}`);
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
                    Logger.warn(`[delete_kanban_card] origin URL 인덱스 삭제 실패 (${originIndexPath}):`, error);
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
                    Logger.warn(`[delete_kanban_card] published URL 인덱스 삭제 실패 (${publishedIndexPath}):`, error);
                    return null;
                  })
                );
              }
            }
            
            if (updatePromises.length > 0) {
              await Promise.all(updatePromises);
            }
          } catch (indexError) {
            Logger.warn('[delete_kanban_card] URL 인덱스 삭제 중 오류:', indexError);
            // 인덱스 삭제 실패해도 카드 삭제는 성공으로 처리
          }
        }

        Logger.biz(`✅ [delete_kanban_card] 카드 삭제 완료 - cardId: ${cardId}`);
        return { success: true };
      } catch (error) {
        Logger.error('[delete_kanban_card] 카드 삭제 실패:', error);
        return { success: false, error: error.message };
      }
    })());
  }

  if (msg.action === "move_kanban_card") {
    return handleAsync((async () => {
      const { cardId, originalStatus, newStatus } = msg.data;
      if (!cardId || !originalStatus || !newStatus) {
        return { success: false, error: "필수 정보가 부족합니다." };
      }

      const userId = await getCurrentUserId();
      const originalRef = ref(getDb(), `kanban/${userId}/${originalStatus}/${cardId}`);
      const newRef = ref(getDb(), `kanban/${userId}/${newStatus}/${cardId}`);

      try {
        // 원래 위치의 카드 데이터 읽기
        const cardSnap = await get(originalRef);
        const cardData = cardSnap?.val();
        if (!cardData) {
          return { success: false, error: "이동할 카드를 찾을 수 없습니다." };
        }
        
        // 새 위치에 카드 데이터 저장
        await set(newRef, cardData);
        
        // 원래 위치에서 카드 삭제
        await remove(originalRef);

        Logger.biz(`[Kanban] 카드 이동: ${cardId} (${originalStatus} → ${newStatus})`);
        
        // UI 갱신 메시지 전송
        try {
          const kanbanRef = ref(getDb(), `kanban/${userId}`);
          const kanbanSnap = await get(kanbanRef);
          const kanbanData = kanbanSnap?.val() || {};
          
          chrome.runtime.sendMessage({
            action: "kanban_data_updated",
            data: kanbanData
          }).catch((err) => {
            if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
              Logger.debug(`[move_kanban_card] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
            }
          });
          
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
                chrome.tabs.sendMessage(tab.id, {
                  action: "kanban_data_updated",
                  data: kanbanData
                }).catch((err) => {
                  // 조용히 무시
                });
              }
            });
          });
        } catch (updateError) {
          Logger.warn(`[move_kanban_card] UI 갱신 메시지 전송 실패:`, updateError);
        }
        
        return { success: true };
      } catch (error) {
        Logger.error(`[Kanban] 카드 이동 실패:`, error);
        return { success: false, error: error.message };
      }
    })());
  }

  if (msg.action === "delete_draft_and_publish_info") {
    return handleAsync((async () => {
      const { ideaId, status } = msg.data || msg;
      if (!ideaId || !status) {
        return { success: false, error: "필수 정보가 부족합니다." };
      }

      const userId = await getCurrentUserId();
      const cardPath = `kanban/${userId}/${status}/${ideaId}`;
      
      try {
        // 현재 카드 데이터 읽기
        const cardSnap = await get(ref(getDb(), cardPath));
        const cardData = cardSnap?.val();
        
        if (!cardData) {
          return { success: false, error: "카드를 찾을 수 없습니다." };
        }
        
        // draftContent, publishInfo, seoTitle 제거
        // Firebase REST API에서 필드를 완전히 제거하려면 필드를 제외한 전체 데이터를 set()으로 저장해야 함
        // update()로 null을 설정해도 필드가 남아있을 수 있으므로, 처음부터 set() 사용
        
        Logger.debug(`[delete_draft_and_publish_info] 필드 제거 시작 - draftContent: ${cardData.draftContent !== undefined ? '있음' : '없음'}, publishInfo: ${cardData.publishInfo !== undefined ? '있음' : '없음'}, seoTitle: ${cardData.seoTitle !== undefined ? '있음' : '없음'}, workspace.draft: ${cardData.workspace?.draft !== undefined ? '있음' : '없음'}`);
        
        // 필드를 제외한 새 데이터 구성
        const { draftContent, publishInfo, seoTitle, workspace, ...restCardData } = cardData;
        
        // workspace에서 draft만 제거한 새 객체 생성
        let cleanedWorkspace = workspace;
        if (workspace) {
          const { draft, ...restWorkspace } = workspace;
          // workspace에 다른 필드가 있으면 draft만 제거한 객체 사용, 없으면 undefined
          cleanedWorkspace = Object.keys(restWorkspace).length > 0 ? restWorkspace : undefined;
        }
        
        // 필드를 제외한 새 데이터 구성
        const cleanedCardData = {
          ...restCardData,
          ...(cleanedWorkspace ? { workspace: cleanedWorkspace } : {})
        };
        
        Logger.debug(`[delete_draft_and_publish_info] 필드 제외한 데이터로 교체 시작`);
        
        // 초안 삭제 후 자동으로 아이디어 칸(ideas)으로 이동해야 하는지 확인
        const shouldMoveToIdeas = status !== 'ideas';
        
        if (shouldMoveToIdeas) {
          // 이동이 필요한 경우: 필드 제거된 데이터를 바로 아이디어 칸에 저장하고 원래 위치에서 삭제
          Logger.debug(`[delete_draft_and_publish_info] 초안 삭제 후 아이디어 칸으로 이동 - 현재 status: ${status}`);
          
          const ideasPath = `kanban/${userId}/ideas/${ideaId}`;
          
          // 필드 제거된 데이터를 아이디어 칸에 저장
          await set(ref(getDb(), ideasPath), cleanDataForFirebase(cleanedCardData));
          
          // 원래 위치에서 카드 삭제
          await remove(ref(getDb(), cardPath));
          
          Logger.biz(`✅ [delete_draft_and_publish_info] 초안 삭제 및 카드 이동 완료: ${ideaId} (${status} → ideas)`);
        } else {
          // 이동이 필요 없는 경우: 현재 위치에서 필드만 제거
          await set(ref(getDb(), cardPath), cleanDataForFirebase(cleanedCardData));
          
          Logger.biz(`✅ [delete_draft_and_publish_info] 초안 및 발행 정보 삭제 완료 - cardId: ${ideaId}`);
          
          // 업데이트가 완전히 반영되도록 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // 삭제된 필드가 실제로 제거되었는지 확인
          const verifySnap = await get(ref(getDb(), cardPath));
          const verifyData = verifySnap?.val();
          
          if (verifyData) {
            // 필드가 존재하는지 확인 (undefined가 아니면 필드가 존재함)
            const hasDraftField = verifyData.draftContent !== undefined;
            const hasPublishInfoField = verifyData.publishInfo !== undefined;
            const hasSeoTitleField = verifyData.seoTitle !== undefined;
            const hasWorkspaceDraftField = verifyData.workspace?.draft !== undefined;
            
            Logger.debug(`[delete_draft_and_publish_info] 필드 존재 확인 - draftContent: ${hasDraftField}, publishInfo: ${hasPublishInfoField}, seoTitle: ${hasSeoTitleField}, workspace.draft: ${hasWorkspaceDraftField}`);
            
            if (hasDraftField || hasPublishInfoField || hasSeoTitleField || hasWorkspaceDraftField) {
              Logger.error(`[delete_draft_and_publish_info] ⚠️ 필드가 여전히 존재함 - 재시도...`);
              
              // 재시도: 다시 한 번 필드 제거
              const { draftContent: vDraft, publishInfo: vPublish, seoTitle: vSeo, workspace: vWorkspace, ...vRest } = verifyData;
              let vCleanedWorkspace = vWorkspace;
              if (vWorkspace) {
                const { draft: vDraftField, ...vRestWorkspace } = vWorkspace;
                vCleanedWorkspace = Object.keys(vRestWorkspace).length > 0 ? vRestWorkspace : undefined;
              }
              
              const vCleanedCardData = {
                ...vRest,
                ...(vCleanedWorkspace ? { workspace: vCleanedWorkspace } : {})
              };
              
              await set(ref(getDb(), cardPath), cleanDataForFirebase(vCleanedCardData));
              
              // 최종 확인
              await new Promise(resolve => setTimeout(resolve, 300));
              const finalVerifySnap = await get(ref(getDb(), cardPath));
              const finalVerifyData = finalVerifySnap?.val();
              
              const finalHasDraft = finalVerifyData?.draftContent !== undefined;
              const finalHasPublishInfo = finalVerifyData?.publishInfo !== undefined;
              const finalHasSeoTitle = finalVerifyData?.seoTitle !== undefined;
              const finalHasWorkspaceDraft = finalVerifyData?.workspace?.draft !== undefined;
              
              if (finalHasDraft || finalHasPublishInfo || finalHasSeoTitle || finalHasWorkspaceDraft) {
                Logger.error(`[delete_draft_and_publish_info] ⚠️ 재시도 후에도 필드가 남아있음 (draftContent: ${finalHasDraft}, publishInfo: ${finalHasPublishInfo}, seoTitle: ${finalHasSeoTitle}, workspace.draft: ${finalHasWorkspaceDraft})`);
              } else {
                Logger.biz(`✅ [delete_draft_and_publish_info] 재시도 완료 - 필드 완전 삭제 확인됨`);
              }
            } else {
              Logger.biz(`✅ [delete_draft_and_publish_info] 필드 제거 확인 완료 - 모든 필드가 제거됨`);
            }
          }
        }
        
        // UI 갱신 메시지 전송 (최신 데이터로)
        try {
          const kanbanRef = ref(getDb(), `kanban/${userId}`);
          const kanbanSnap = await get(kanbanRef);
          const kanbanData = kanbanSnap?.val() || {};
          
          Logger.debug(`[delete_draft_and_publish_info] UI 갱신 메시지 전송 - 카드 개수: ${Object.keys(kanbanData).reduce((sum, status) => sum + Object.keys(kanbanData[status] || {}).length, 0)}`);
          
          chrome.runtime.sendMessage({
            action: "kanban_data_updated",
            data: kanbanData
          }).catch((err) => {
            if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
              Logger.debug(`[delete_draft_and_publish_info] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
            }
          });
          
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
                chrome.tabs.sendMessage(tab.id, {
                  action: "kanban_data_updated",
                  data: kanbanData
                }).catch((err) => {
                  // 조용히 무시
                });
              }
            });
          });
        } catch (updateError) {
          Logger.warn(`[delete_draft_and_publish_info] UI 갱신 메시지 전송 실패:`, updateError);
        }
        
        return { success: true, moved: shouldMoveToIdeas };
      } catch (error) {
        Logger.error('[delete_draft_and_publish_info] 삭제 실패:', error);
        return { success: false, error: error.message };
      }
    })());
  }

  if (msg.action === "get_kanban_data" || msg.action === "get_all_kanban_data") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      Logger.info(`[get_kanban_data] 요청 수신 - userId: ${userId}`);
      const dbRef = ref(getDb(), `kanban/${userId}`);
    
    // 실시간 리스너 등록 (한 번만)
    if (!kanbanRealtimeListenerAttached) {
      onValue(dbRef, (snapshot) => {
        const data = snapshot?.val() || {};
        const cardsCount = Object.keys(data).length;
        Logger.debug(`[get_kanban_data] 실시간 업데이트 - 카드 개수: ${cardsCount}`);
        // 모든 탭에 업데이트 메시지 전송
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: "kanban_data_updated",
                data: data
              }).catch((err) => {
                // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
                // 조용히 무시
              });
            }
          });
        });
      });
      kanbanRealtimeListenerAttached = true;
    }
    
      const snap = await get(dbRef);
      const data = snap?.val() || {};
      const cardsCount = Object.keys(data).length;
      Logger.info(`[get_kanban_data] 데이터 로드 완료 - 카드 개수: ${cardsCount}`);
      // 즉시 UI에 업데이트 메시지 전송
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "kanban_data_updated",
          data: data
        }).catch((err) => {
          // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
          // 조용히 무시
        });
      }
      return { success: true, data: data };
    })());
  }

  if (msg.action === "get_all_scraps") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      Logger.info(`[get_all_scraps] 요청 수신 - userId: ${userId}, channelId: ${msg.channelId || 'null'}`);
      const snap = await get(ref(getDb(), `scraps/${userId}`));
      const val = snap?.val() || {};
      const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
      Logger.debug(`[get_all_scraps] 전체 스크랩 개수: ${arr.length}`);
      // 필터링
      const filtered = arr.filter(s => s.channelId === undefined || s.channelId === null || s.channelId === msg.channelId);
      Logger.info(`[get_all_scraps] 필터링 후 스크랩 개수: ${filtered.length}`);
      return { success: true, scraps: filtered.sort((a, b) => b.timestamp - a.timestamp) };
    })());
  }

  if (msg.action === "cp_get_firebase_scraps") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      const targetChannelId = msg.channelId || null;
      try {
        const snap = await get(ref(getDb(), `scraps/${userId}`));
        const val = snap?.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
        // 필터링: channelId가 없거나 null이거나 targetChannelId와 일치하는 경우
        const filtered = arr.filter(scrap => {
          return scrap.channelId === undefined || 
                 scrap.channelId === null || 
                 scrap.channelId === targetChannelId;
        });
        return { data: filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) };
      } catch (error) {
        Logger.error('[cp_get_firebase_scraps] Firebase 로드 오류:', error);
        return { data: [] };
      }
    })());
  }

  if (msg.action === "get_channel_content") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      Logger.info(`[get_channel_content] 요청 수신 - userId: ${userId}`);
      const [contentSnap, metaSnap, channelsSnap] = await Promise.all([
        get(ref(getDb(), `channel_content/${userId}`)),
        get(ref(getDb(), `channel_meta/${userId}`)),
        get(ref(getDb(), `channels/${userId}`))
      ]);
      
      // snapshot 객체에서 .val()로 데이터 추출
      const content = contentSnap?.val() || {};
      const metas = metaSnap?.val() || {};
      const channels = channelsSnap?.val() || {
        myChannels: {},
        competitorChannels: {}
      };

      // 필터링: null 값 제거
      const blogs = Object.values(content.blogs || {}).filter(item => item !== null);
      const youtubes = Object.values(content.youtubes || {}).filter(item => item !== null);
      const allContent = [...blogs, ...youtubes];
      
      Logger.info(`[get_channel_content] 데이터 로드 완료 - blogs: ${blogs.length}, youtubes: ${youtubes.length}, total: ${allContent.length}`);

      return {
        success: true,
        data: {
          content: allContent,
          metas: metas,
          channels: channels
        }
      };
    })());
  }

  // === [Channel Management] 채널 관리 ===
  if (msg.action === "get_channels_and_key") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      Logger.info(`[get_channels_and_key] 요청 수신 - userId: ${userId}`);
      const [storage, channelsSnap] = await Promise.all([
        chrome.storage.local.get(["youtubeApiKey", "geminiApiKey"]),
        get(ref(getDb(), `channels/${userId}`))
      ]);
      
      // channelsSnap은 { val: () => data, exists: () => boolean } 형태
      const channelsData = channelsSnap?.val() || {};
      const blogsCount = channelsData.myChannels?.blogs?.length || 0;
      const youtubesCount = channelsData.myChannels?.youtubes?.length || 0;
      Logger.info(`[get_channels_and_key] 채널 데이터 로드 완료 - blogs: ${blogsCount}, youtubes: ${youtubesCount}`);
      
      return {
        success: true,
        data: {
          youtubeApiKey: storage.youtubeApiKey || "",
          geminiApiKey: storage.geminiApiKey || "",
          ...channelsData
        }
      };
    })());
  }

  if (msg.action === "get_my_channels") {
    return handleAsync((async () => {
      const userId = await getCurrentUserId();
      const snap = await get(ref(getDb(), `channels/${userId}`));
      const channels = snap?.val() || {};
      return { success: true, channels: channels.myChannels || { blogs: [], youtubes: [] } };
    })());
  }

  if (msg.action === "save_channels_and_key") {
    return handleAsync((async () => {
      const { youtubeApiKey, geminiApiKey, channels, myChannels } = msg.data;
      // myChannels가 있으면 channels로 변환 (하위 호환성)
      const channelsData = channels || (myChannels ? { myChannels } : null);
      await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
      const userId = await getCurrentUserId();
      
      // 기존 채널 데이터 불러오기 (병합을 위해)
      let existingChannels = {};
      try {
        const existingSnap = await get(ref(getDb(), `channels/${userId}`));
        existingChannels = existingSnap?.val() || {};
      } catch (error) {
        Logger.debug('[save_channels_and_key] 기존 채널 데이터 불러오기 실패 (신규 사용자일 수 있음):', error.message);
      }
      
      // 채널 ID 생성 헬퍼 함수
      const generateChannelId = (channel) => {
        if (channel.id) return channel.id;
        if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, "");
        if (channel.url) return btoa(channel.url).replace(/=/g, "");
        return null;
      };
      
      // 채널에 ID가 없으면 생성
      const ensureChannelIds = (channels) => {
        if (!channels || typeof channels !== 'object') return channels;
        if (channels.myChannels?.blogs) {
          channels.myChannels.blogs = channels.myChannels.blogs.map(c => {
            if (!c.id) {
              c.id = generateChannelId(c);
            }
            return c;
          });
        }
        if (channels.myChannels?.youtubes) {
          channels.myChannels.youtubes = channels.myChannels.youtubes.map(c => {
            if (!c.id) {
              c.id = generateChannelId(c);
            }
            return c;
          });
        }
        return channels;
      };
      
      // channels가 없거나 빈 객체인 경우 기존 데이터 사용 또는 기본 구조 생성
      let channelsToSave = channelsData;
      if (!channelsToSave || (typeof channelsToSave === 'object' && Object.keys(channelsToSave).length === 0)) {
        // 기존 데이터가 있으면 기존 데이터 사용
        if (existingChannels && Object.keys(existingChannels).length > 0) {
          Logger.debug('[save_channels_and_key] channels가 비어있지만 기존 데이터가 있음, 기존 데이터 유지');
          channelsToSave = existingChannels;
        } else {
          // 기존 데이터도 없으면 기본 구조 생성
          Logger.warn('[save_channels_and_key] channels가 비어있고 기존 데이터도 없음, 기본 구조 생성');
          channelsToSave = {
            myChannels: {
              blogs: [],
              youtubes: []
            }
          };
        }
      } else {
        // 새 channels 데이터가 있으면 기존 데이터와 병합 (myChannels 우선)
        if (existingChannels?.myChannels && channelsToSave.myChannels) {
          // 기존 채널 목록과 새 채널 목록 병합 (중복 제거)
          const existingBlogs = existingChannels.myChannels.blogs || [];
          const newBlogs = channelsToSave.myChannels.blogs || [];
          const existingYoutubes = existingChannels.myChannels.youtubes || [];
          const newYoutubes = channelsToSave.myChannels.youtubes || [];
          
          // 중복 제거 및 업데이트를 위한 헬퍼 함수
          const mergeChannels = (existing, newChannels) => {
            const merged = [...existing];
            newChannels.forEach(newChannel => {
              const newId = generateChannelId(newChannel);
              if (!newId) {
                Logger.warn('[save_channels_and_key] 새 채널의 ID를 생성할 수 없습니다:', newChannel);
                return;
              }
              // 기존 채널 중 같은 ID를 가진 채널 찾기
              const existingIndex = merged.findIndex(existingChannel => {
                const existingId = generateChannelId(existingChannel);
                return existingId && existingId === newId;
              });
              
              if (existingIndex >= 0) {
                // 기존 채널이 있으면 업데이트 (competitors 포함 모든 필드 병합)
                Logger.debug(`[save_channels_and_key] 기존 채널 업데이트 (ID: ${newId})`, {
                  existing: merged[existingIndex],
                  new: newChannel
                });
                merged[existingIndex] = {
                  ...merged[existingIndex],
                  ...newChannel,
                  // competitors는 새 값으로 덮어쓰기 (명시적으로 설정된 경우)
                  competitors: newChannel.competitors !== undefined ? newChannel.competitors : merged[existingIndex].competitors
                };
              } else {
                // 기존 채널이 없으면 추가
                merged.push(newChannel);
              }
            });
            return merged;
          };
          
          channelsToSave.myChannels.blogs = mergeChannels(existingBlogs, newBlogs);
          channelsToSave.myChannels.youtubes = mergeChannels(existingYoutubes, newYoutubes);
        }
      }
      
      // 모든 채널에 ID가 있는지 확인하고 없으면 생성
      channelsToSave = ensureChannelIds(channelsToSave);
      
      // undefined 값을 null로 변환하여 Firebase 저장 오류 방지
      const cleanedChannels = cleanDataForFirebase(channelsToSave);
      
      // 빈 객체 체크
      if (cleanedChannels && typeof cleanedChannels === 'object' && Object.keys(cleanedChannels).length === 0) {
        Logger.error('[save_channels_and_key] cleanedChannels가 빈 객체입니다.');
        throw new Error('저장할 채널 데이터가 없습니다.');
      }
      
      await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
      // 데이터 수집 트리거
      await fetchAllChannelData();
      return { success: true, message: "채널 정보가 저장되었습니다." };
    })());
  }

  // === [Idea Management] 아이디어 관리 ===
  if (msg.action === "get_idea_data") {
    return handleAsync((async () => {
      const { ideaId } = msg;
      const snap = await get(ref(getDb(), `kanban/${CONSTANTS.USER_ID}`));
      const allCards = snap?.val() || {};
      for (const status in allCards) {
        if (allCards[status][ideaId]) {
          return { success: true, data: allCards[status][ideaId], status };
        }
      }
      return { success: false, error: "아이디어를 찾을 수 없습니다." };
    })());
  }

  if (msg.action === "get_kanban_card_status") {
    return handleAsync((async () => {
      const { cardId } = msg;
      const snap = await get(ref(getDb(), `kanban/${CONSTANTS.USER_ID}`));
      const allCards = snap?.val() || {};
      for (const status in allCards) {
        if (allCards[status][cardId]) {
          return { success: true, status, data: allCards[status][cardId] };
        }
      }
      return { success: false, error: "카드를 찾을 수 없습니다." };
    })());
  }

  if (msg.action === "save_idea_draft") {
    const { ideaId, draft } = msg;
    return handleAsync((async () => {
      // 빈 내용 필터링 (초안 삭제 후 재생성 방지)
      const content = draft || "";
      const trimmedContent = content.trim();
      if (!trimmedContent || trimmedContent === "<p><br></p>" || trimmedContent === "<p></p>" || trimmedContent === "<br>") {
        Logger.debug(`[save_idea_draft] 빈 내용 저장 차단 - ideaId: ${ideaId}`);
        return { success: true, skipped: true, message: "빈 내용은 저장하지 않습니다." };
      }
      
      const userId = await getCurrentUserId();
      const snap = await get(ref(getDb(), `kanban/${userId}`));
      const allCards = snap?.val() || {};
      
      let foundStatus = null;
      let cardData = null;
      
      // 카드 찾기
      for (const status in allCards) {
        if (allCards[status] && allCards[status][ideaId]) {
          foundStatus = status;
          cardData = allCards[status][ideaId];
          break;
        }
      }
      
      if (!foundStatus || !cardData) {
        return { success: false, error: "아이디어를 찾을 수 없습니다." };
      }
      
      // 초안 저장 및 자동 이동: 'ideas' 컬럼에 있으면 'in-progress'로 이동
      if (foundStatus === 'ideas') {
        Logger.debug(`[save_idea_draft] 초안 저장 및 자동 이동 - ideaId: ${ideaId} (ideas → in-progress)`);
        
        // 카드 데이터에 초안 추가
        const updatedCardData = {
          ...cardData,
          draftContent: draft,
          workspace: {
            ...(cardData.workspace || {}),
            draft: draft
          }
        };
        
        // 'in-progress' 컬럼에 저장
        const newPath = `kanban/${userId}/in-progress/${ideaId}`;
        await set(ref(getDb(), newPath), cleanDataForFirebase(updatedCardData));
        
        // 원래 위치에서 삭제
        const oldPath = `kanban/${userId}/ideas/${ideaId}`;
        await remove(ref(getDb(), oldPath));
        
        Logger.biz(`✅ [save_idea_draft] 초안 저장 및 자동 이동 완료 - ideaId: ${ideaId} (ideas → in-progress)`);
        
        // UI 갱신 메시지 전송
        try {
          const kanbanRef = ref(getDb(), `kanban/${userId}`);
          const kanbanSnap = await get(kanbanRef);
          const kanbanData = kanbanSnap?.val() || {};
          
          chrome.runtime.sendMessage({
            action: "kanban_data_updated",
            data: kanbanData
          }).catch((err) => {
            if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
              Logger.debug(`[save_idea_draft] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
            }
          });
          
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
                chrome.tabs.sendMessage(tab.id, {
                  action: "kanban_data_updated",
                  data: kanbanData
                }).catch((err) => {
                  // 조용히 무시
                });
              }
            });
          });
        } catch (updateError) {
          Logger.warn(`[save_idea_draft] UI 갱신 메시지 전송 실패:`, updateError);
        }
        
        return { success: true, moved: true, newStatus: 'in-progress' };
      } else {
        // 'ideas'가 아니면 현재 위치에서 초안만 업데이트
        await update(ref(getDb(), `kanban/${userId}/${foundStatus}/${ideaId}`), { 
          draftContent: draft,
          workspace: {
            ...(cardData.workspace || {}),
            draft: draft
          }
        });
        Logger.debug(`[save_idea_draft] 초안 저장 완료 - ideaId: ${ideaId}, status: ${foundStatus}`);
        return { success: true, moved: false, newStatus: foundStatus };
      }
    })());
  }

  // === [Scrap Management] 스크랩 관리 ===
  if (msg.action === "scrap_element" && msg.data) {
    return handleAsync((async () => {
      try {
        const { data } = msg;
        const channelId = msg.channelId !== undefined ? msg.channelId : null;
        
        // 스크랩 데이터 준비
        const scrapPayload = {
          text: data.text || '',
          html: data.html || '',
          tag: data.tag || 'UNKNOWN',
          url: data.url || '',
          image: data.image || null,
          images: data.images || [],
          highlights: data.highlights || [], // 하이라이트 메타데이터 포함
          hasHighlights: data.hasHighlights || false,
          timestamp: Date.now(),
          channelId: channelId
        };

        // Firebase에 저장
        const userId = await getCurrentUserId();
        const path = `scraps/${userId}`;
        const pushResult = await push(path, cleanDataForFirebase(scrapPayload));
        const scrapId = pushResult.key; // push()는 { key: string, set: function } 객체를 반환

        return { 
          success: true, 
          scrapId: scrapId,
          scrapData: scrapPayload
        };
      } catch (error) {
        Logger.error('[scrap_element] 저장 실패:', error);
        return { success: false, error: error.message };
      }
    })());
  }

  if (msg.action === "get_canvas_images") {
    return handleAsync((async () => {
      // TODO: 캔버스 이미지 가져오기 로직
      return { success: true, images: [] };
    })());
  }

  if (msg.action === "remove_scrap_image") {
    return handleAsync((async () => {
      const { scrapId, imageUrl } = msg.data;
      const scrapRef = ref(getDb(), `scraps/${CONSTANTS.USER_ID}/${scrapId}`);
      const scrapSnap = await get(scrapRef);
      const scrap = scrapSnap?.val();
      if (scrap) {
        if (scrap.images && Array.isArray(scrap.images)) {
          scrap.images = scrap.images.filter(img => img !== imageUrl);
          await update(scrapRef, { images: scrap.images });
        }
      }
      return { success: true };
    })());
  }

  if (msg.action === "delete_scrap") {
    return handleAsync((async () => {
      const scrapId = msg.id;
      if (!scrapId) {
        return { success: false, error: "스크랩 ID가 필요합니다." };
      }
      const scrapRef = ref(getDb(), `scraps/${CONSTANTS.USER_ID}/${scrapId}`);
      await remove(scrapRef);
      return { success: true };
    })());
  }

  if (msg.action === "toggle_scrap_sharing") {
    return handleAsync((async () => {
      const { scrapId, currentChannelId } = msg;
      
      if (!scrapId) {
        return { success: false, error: "스크랩 ID가 필요합니다." };
      }
      
      const scrapRef = ref(getDb(), `scraps/${CONSTANTS.USER_ID}/${scrapId}`);
      const scrapSnap = await get(scrapRef);
      const scrapData = scrapSnap?.val();
      
      if (!scrapData) {
        return { success: false, error: "스크랩을 찾을 수 없습니다." };
      }
      const currentChannelIdValue = scrapData.channelId;
      const isCurrentlyPublic = currentChannelIdValue === null || currentChannelIdValue === undefined;
      
      // 토글: null/undefined(공용) ↔ currentChannelId(전용)
      const newChannelId = isCurrentlyPublic ? currentChannelId : null;
      
      // currentChannelId가 없으면 전용으로 변경할 수 없음
      if (isCurrentlyPublic && !currentChannelId) {
        return { 
          success: false, 
          error: "활성 채널이 선택되지 않아 전용으로 변경할 수 없습니다." 
        };
      }
      
      // 업데이트
      await update(scrapRef, { channelId: newChannelId });
      
      return { 
        success: true, 
        newChannelId,
        message: newChannelId === null ? "공용 스크랩으로 변경되었습니다." : "전용 스크랩으로 변경되었습니다."
      };
    })());
  }

  if (msg.action === "link_scrap_to_idea") {
    return handleAsync((async () => {
      const { ideaId, scrapId, status } = msg.data;
      const userId = await getCurrentUserId();
      const ideaRef = ref(getDb(), `kanban/${userId}/${status}/${ideaId}`);
      const ideaSnap = await get(ideaRef);
      const idea = ideaSnap?.val();
      if (idea) {
        // linkedScraps를 배열로 정규화
        let linkedScraps = idea.linkedScraps || idea.workspace?.linkedScraps || [];
        if (!Array.isArray(linkedScraps) && typeof linkedScraps === 'object') {
          linkedScraps = Object.keys(linkedScraps);
        }
        if (!linkedScraps.includes(scrapId)) {
          linkedScraps.push(scrapId);
          // linkedScraps를 객체 형태로 저장 (Firebase REST API 호환)
          const linkedScrapsObj = {};
          linkedScraps.forEach(id => { linkedScrapsObj[id] = true; });
          
          // workspace.linkedScraps 업데이트
          const workspace = idea.workspace || {};
          await update(ref(getDb(), `kanban/${userId}/${status}/${ideaId}`), {
            linkedScraps: linkedScrapsObj,
            workspace: {
              ...workspace,
              linkedScraps: linkedScrapsObj
            }
          });
        }
      }
      return { success: true };
    })());
  }

  if (msg.action === "unlink_scrap_from_idea") {
    return handleAsync((async () => {
      const { ideaId, scrapId, status } = msg.data || msg;
      if (!ideaId || !scrapId || !status) {
        return { success: false, error: "ID 또는 상태가 유효하지 않습니다." };
      }

      const userId = await getCurrentUserId();
      const cardPath = `kanban/${userId}/${status}/${ideaId}`;
      const cardSnap = await get(ref(getDb(), cardPath));
      const cardData = cardSnap?.val();
      
      if (!cardData) {
        return { success: false, error: "카드를 찾을 수 없습니다." };
      }
      
      // linkedScraps 업데이트 (루트 레벨) - 배열과 객체 모두 처리
      let linkedScraps = cardData.linkedScraps || {};
      if (Array.isArray(linkedScraps)) {
        linkedScraps = linkedScraps.filter(id => id !== scrapId);
        // 배열을 객체로 변환
        const linkedScrapsObj = {};
        linkedScraps.forEach(id => { linkedScrapsObj[id] = true; });
        linkedScraps = linkedScrapsObj;
      } else if (linkedScraps && typeof linkedScraps === 'object') {
        linkedScraps = { ...linkedScraps };
        delete linkedScraps[scrapId];
      } else {
        linkedScraps = {};
      }
      
      // workspace.linkedScraps 업데이트 - 배열과 객체 모두 처리
      const workspace = cardData.workspace || {};
      let workspaceLinkedScraps = workspace.linkedScraps || {};
      if (Array.isArray(workspaceLinkedScraps)) {
        workspaceLinkedScraps = workspaceLinkedScraps.filter(id => id !== scrapId);
        // 배열을 객체로 변환
        const workspaceLinkedScrapsObj = {};
        workspaceLinkedScraps.forEach(id => { workspaceLinkedScrapsObj[id] = true; });
        workspaceLinkedScraps = workspaceLinkedScrapsObj;
      } else if (workspaceLinkedScraps && typeof workspaceLinkedScraps === 'object') {
        workspaceLinkedScraps = { ...workspaceLinkedScraps };
        delete workspaceLinkedScraps[scrapId];
      } else {
        workspaceLinkedScraps = {};
      }
      
      // 업데이트할 데이터 구성
      const updates = {
        linkedScraps: linkedScraps,
        workspace: {
          ...workspace,
          linkedScraps: workspaceLinkedScraps
        }
      };
      
      await update(ref(getDb(), cardPath), cleanDataForFirebase(updates));
      
      Logger.biz(`✅ [unlink_scrap_from_idea] 스크랩 연결 해제 완료 - ideaId: ${ideaId}, scrapId: ${scrapId}`);
      
      return { success: true };
    })());
  }

  // === [AI Analysis] AI 분석 ===
  if (msg.action === "generate_blog_ideas") {
    return handleAsync((async () => {
      // TODO: 블로그 아이디어 생성 로직
      return { success: true, analysis: "", ideas: "", keywordGap: null };
    })());
  }

  // 핑 테스트
  if (msg.action === "ping") {
    sendResponse({ success: true, mode: "module-router" });
    return false;
  }
  
  // 알 수 없는 액션
  Logger.warn(`[Router] 알 수 없는 액션: ${msg.action}`);
  sendResponse({ success: false, error: `Unknown action: ${msg.action}` });
  return false;
});
