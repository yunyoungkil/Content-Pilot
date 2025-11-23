// background.js (Final Router Version)

import { getDb, CONSTANTS, initializeFirebase, uploadImageToFirebaseStorage, cleanDataForFirebase } from './js/services/firebaseService.js';
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
  fetchImageAsBase64
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

import { ref, update, remove, set, get, push, serverTimestamp, onValue } from 'firebase/database';

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
      }).catch(reject);
      
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
      }).catch(reject);
      
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
        Logger.warn("[sendMessage] 메시지 전송 실패:", chrome.runtime.lastError.message);
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
      if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { action: "briefing_progress", cardId, progress: p }).catch(()=>{});
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
    return handleAsync(uploadImageToFirebaseStorage(msg.data.dataUrl, `thumbnails/${CONSTANTS.USER_ID}/${msg.data.filename || Date.now()+'.png'}`, CONSTANTS.USER_ID).then(url => ({ success: true, url })));
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

      // 중복 검사 (Collector Service 활용)
      if (ideaData.origin?.postUrl) {
        const dupCheck = await checkDuplicateUrl(ideaData.origin.postUrl);
        if (dupCheck.exists) return { success: false, code: "DUPLICATE_FOUND", cardInfo: dupCheck };
      }

      // 요약 (AI Service 활용)
      if (ideaData.description?.length > 200) {
        ideaData.description = await summarizeText(ideaData.description);
      }

      // 저장
      const newRef = push(ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${msg.status || 'ideas'}`));
      await set(newRef, { ...ideaData, createdAt: Date.now(), channelId: msg.channelId });

      return { success: true, firebaseKey: newRef.key };
    })());
  }

  if (msg.action === "update_kanban_card") {
    const { cardId, status, updates } = msg.data;
    return handleAsync(update(ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${status}/${cardId}`), updates));
  }
  
  if (msg.action === "delete_kanban_card") {
    return handleAsync(remove(ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${msg.data.status}/${msg.data.cardId}`)));
  }

  if (msg.action === "move_kanban_card") {
    return handleAsync((async () => {
      const { cardId, originalStatus, newStatus } = msg.data;
      if (!cardId || !originalStatus || !newStatus) {
        return { success: false, error: "필수 정보가 부족합니다." };
      }

      const userId = CONSTANTS.USER_ID;
      const originalRef = ref(getDb(), `kanban/${userId}/${originalStatus}/${cardId}`);
      const newRef = ref(getDb(), `kanban/${userId}/${newStatus}/${cardId}`);

      try {
        // 원래 위치의 카드 데이터 읽기
        const snapshot = await get(originalRef);
        if (!snapshot.exists()) {
          return { success: false, error: "이동할 카드를 찾을 수 없습니다." };
        }

        const cardData = snapshot.val();
        
        // 새 위치에 카드 데이터 저장
        await set(newRef, cardData);
        
        // 원래 위치에서 카드 삭제
        await remove(originalRef);

        Logger.biz(`[Kanban] 카드 이동: ${cardId} (${originalStatus} → ${newStatus})`);
        return { success: true };
      } catch (error) {
        Logger.error(`[Kanban] 카드 이동 실패:`, error);
        return { success: false, error: error.message };
      }
    })());
  }

  if (msg.action === "get_kanban_data" || msg.action === "get_all_kanban_data") {
    const dbRef = ref(getDb(), `kanban/${CONSTANTS.USER_ID}`);
    
    // 실시간 리스너 등록 (한 번만)
    if (!kanbanRealtimeListenerAttached) {
      onValue(dbRef, (snapshot) => {
        const data = snapshot.val() || {};
        // 모든 탭에 업데이트 메시지 전송
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: "kanban_data_updated",
                data: data
              }).catch(() => {});
            }
          });
        });
      });
      kanbanRealtimeListenerAttached = true;
    }
    
    return handleAsync(get(dbRef).then(snap => {
      const data = snap.val() || {};
      // 즉시 UI에 업데이트 메시지 전송
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "kanban_data_updated",
          data: data
        }).catch(() => {});
      }
      return { success: true, data: data };
    }));
  }

  if (msg.action === "get_all_scraps") {
    return handleAsync(get(ref(getDb(), `scraps/${CONSTANTS.USER_ID}`)).then(snap => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
      // 필터링
      const filtered = arr.filter(s => s.channelId === undefined || s.channelId === null || s.channelId === msg.channelId);
      return { success: true, scraps: filtered.sort((a, b) => b.timestamp - a.timestamp) };
    }));
  }

  if (msg.action === "cp_get_firebase_scraps") {
    const targetChannelId = msg.channelId || null;
    return handleAsync(get(ref(getDb(), `scraps/${CONSTANTS.USER_ID}`)).then(snap => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
      // 필터링: channelId가 없거나 null이거나 targetChannelId와 일치하는 경우
      const filtered = arr.filter(scrap => {
        return scrap.channelId === undefined || 
               scrap.channelId === null || 
               scrap.channelId === targetChannelId;
      });
      return { data: filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) };
    }).catch(error => {
      Logger.error('[cp_get_firebase_scraps] Firebase 로드 오류:', error);
      return { data: [] };
    }));
  }

  if (msg.action === "get_channel_content") {
    return handleAsync((async () => {
      const [contentSnap, metaSnap, channelsSnap] = await Promise.all([
        get(ref(getDb(), `channel_content/${CONSTANTS.USER_ID}`)),
        get(ref(getDb(), `channel_meta/${CONSTANTS.USER_ID}`)),
        get(ref(getDb(), `channels/${CONSTANTS.USER_ID}`))
      ]);
      
      const content = contentSnap.val() || {};
      const metas = metaSnap.val() || {};
      const channels = channelsSnap.val() || {
        myChannels: {},
        competitorChannels: {}
      };

      // 필터링: null 값 제거
      const blogs = Object.values(content.blogs || {}).filter(item => item !== null);
      const youtubes = Object.values(content.youtubes || {}).filter(item => item !== null);
      const allContent = [...blogs, ...youtubes];

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
      const [storage, channelsSnap] = await Promise.all([
        chrome.storage.local.get(["youtubeApiKey", "geminiApiKey"]),
        get(ref(getDb(), `channels/${CONSTANTS.USER_ID}`))
      ]);
      return {
        success: true,
        data: {
          youtubeApiKey: storage.youtubeApiKey || "",
          geminiApiKey: storage.geminiApiKey || "",
          ...(channelsSnap.val() || {})
        }
      };
    })());
  }

  if (msg.action === "get_my_channels") {
    return handleAsync(get(ref(getDb(), `channels/${CONSTANTS.USER_ID}`)).then(snap => {
      const channels = snap.val() || {};
      return { success: true, channels: channels.myChannels || { blogs: [], youtubes: [] } };
    }));
  }

  if (msg.action === "save_channels_and_key") {
    return handleAsync((async () => {
      const { youtubeApiKey, geminiApiKey, channels } = msg.data;
      await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
      await set(ref(getDb(), `channels/${CONSTANTS.USER_ID}`), channels);
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
      const allCards = snap.val() || {};
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
      const allCards = snap.val() || {};
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
      const snap = await get(ref(getDb(), `kanban/${CONSTANTS.USER_ID}`));
      const allCards = snap.val() || {};
      for (const status in allCards) {
        if (allCards[status][ideaId]) {
          await update(ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${status}/${ideaId}`), { draftContent: draft });
          return { success: true };
        }
      }
      return { success: false, error: "아이디어를 찾을 수 없습니다." };
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
        const userId = CONSTANTS.USER_ID;
        const scrapRef = push(ref(getDb(), `scraps/${userId}`));
        await set(scrapRef, cleanDataForFirebase(scrapPayload));

        return { 
          success: true, 
          scrapId: scrapRef.key,
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
      const snap = await get(scrapRef);
      if (snap.exists()) {
        const scrap = snap.val();
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
      const snap = await get(scrapRef);
      
      if (!snap.exists()) {
        return { success: false, error: "스크랩을 찾을 수 없습니다." };
      }
      
      const scrapData = snap.val();
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
      const ideaRef = ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${status}/${ideaId}`);
      const ideaSnap = await get(ideaRef);
      if (ideaSnap.exists()) {
        const idea = ideaSnap.val();
        const linkedScraps = idea.workspace?.linkedScraps || [];
        if (!linkedScraps.includes(scrapId)) {
          linkedScraps.push(scrapId);
          await update(ref(getDb(), `kanban/${CONSTANTS.USER_ID}/${status}/${ideaId}/workspace`), { linkedScraps });
        }
      }
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
