// background.js (Final Router Version)

// Firebase 초기화 (가장 먼저 실행)
try {
  initializeFirebase();
  Logger.info('[Background] Firebase 초기화 완료');
} catch (error) {
  Logger.error('[Background] Firebase 초기화 실패:', error);
}

// 확장 프로그램 아이콘 클릭 시 Content Pilot 활성화
if (
  typeof chrome !== 'undefined' &&
  chrome.action &&
  chrome.action.onClicked &&
  chrome.action.onClicked.addListener
) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      // 현재 탭에 content script 삽입
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['dist/content.bundle.js'],
      });

      // CSS도 삽입
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ['css/style.css'],
      });

      Logger.info('[Background] Content Pilot activated via icon click');
    } catch (error) {
      Logger.error('[Background] Failed to activate Content Pilot:', error);
    }
  });
}

import {
  getDb,
  CONSTANTS,
  initializeFirebase,
  uploadImageToFirebaseStorage,
  cleanDataForFirebase,
  getCurrentUserId,
  getUnifiedGalleryImages,
} from './js/services/firebaseService.js';
import { Logger } from './js/utils.js';
// [추가] 상수 임포트
import { COLLECTIONS, KANBAN_STATUS } from './js/constants.js';

import {
  updateAllPerformanceMetrics,
  updateSinglePerformanceMetric,
  checkAdSenseRegistrationStatus,
  runFullSystemDiagnosis,
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
  encodeUrlForFirebaseKey,
} from './js/services/collectorService.js';

// [추가] 이미지 삭제를 위한 강력한 URL 정규화 함수
function normalizeUrlForDeletion(url) {
  if (!url) return '';
  try {
    // 1. HTML 엔티티(&amp;)를 일반 문자(&)로 변환 (가장 흔한 원인)
    let cleanUrl = url.replace(/&amp;/g, '&');

    // 2. URL 객체 생성 (프로토콜, 쿼리스트링 분리)
    const u = new URL(cleanUrl);

    // 3. 경로(pathname)를 디코딩하여 표준화 (%20 -> 공백, %2F -> / 등)
    // 쿼리스트링(?token=...)은 무시하고, 도메인+경로만 비교하여 일치율을 높임
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(u.pathname);
    } catch (e) {
      decodedPath = u.pathname;
    }

    return (u.hostname + decodedPath).replace(/\/$/, '').trim();
  } catch (e) {
    // URL 파싱 실패 시 원본 그대로 반환
    return url.trim();
  }
}

import {
  deleteCompetitorData,
  deleteChannelDataCascade,
  findDeletedCompetitors,
} from './js/services/cascadeDeleteService.js';

import {
  generateDraftFromIdea,
  generateIdeaBriefing,
  generateAiImage,
  analyzeImageForTemplate,
  callGeminiAPI,
  analyzeMyChannel,
  generateContentIdeas,
  generateAndSendKeywords,
  analyzeVideoComments,
} from './js/services/aiService.js';

import {
  startGoogleAuth,
  revokeGoogleAuth,
  getValidToken,
  restoreAuthSession,
} from './js/services/authService.js';

// migrationService removed - migration features disabled/removed

import {
  validateTemplateData,
  getThumbnailTemplates,
  deleteTemplate,
  generateThumbnailTexts,
} from './js/services/thumbnailService.js';

import {
  createAndSaveNewIdea,
  addIdeaToKanban,
  removeIdeaFromKanban,
  deleteKanbanCard,
} from './js/services/kanbanService.js';

import {
  saveScrapElement,
  getFirebaseScraps,
  getScrapDetail,
  saveEntireAnalysis,
  deleteScrap,
  removeScrapImage,
} from './js/services/scrapService.js';

import {
  sanitizeHtmlInOffscreen,
  resizeImageInOffscreen,
  renderTemplateInOffscreen,
  parseHtmlInOffscreen,
  registerOffscreenPort,
} from './js/services/offscreenService.js';

// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
// import { ref, update, remove, set, get, push, serverTimestamp, onValue } from 'firebase/database';
import {
  ref,
  update,
  remove,
  set,
  get,
  push,
  serverTimestamp,
  onValue,
} from './js/services/firebaseService.js';

// Firebase 초기화
initializeFirebase();

// Service Worker 전역 변수 (window 대신 사용)
let kanbanRealtimeListenerAttached = false;

// [캐시 최적화] get_channels_and_key 요청 캐시
let channelsAndKeyCache = null;
let channelsAndKeyCacheTimestamp = 0;
const CHANNELS_CACHE_TTL = 5 * 60 * 1000; // 5분 TTL

// [캐시 최적화] get_kanban_data 요청 캐시
let kanbanDataCache = null;
let kanbanDataCacheTimestamp = 0;
const KANBAN_CACHE_TTL = 30 * 1000; // 30초 TTL

// Service Worker 시작 시 세션 복원
(async () => {
  try {
    await restoreAuthSession();
  } catch (error) {
    Logger.error('[System] 세션 복원 실패:', error);
  }
})();

Logger.info('🚀 [System] Service Worker Started (Lightweight Router)');

// 0. 확장 프로그램 아이콘 클릭 리스너
if (
  typeof chrome !== 'undefined' &&
  chrome.action &&
  chrome.action.onClicked &&
  chrome.action.onClicked.addListener
) {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'open_content_pilot_panel',
        },
        () => {
          if (chrome.runtime.lastError) {
            // "message port closed"는 정상적인 상황 (탭이 닫히거나 content script가 없을 때)
            // 다른 에러만 경고로 표시
            const errorMsg = chrome.runtime.lastError.message || '';
            if (
              !errorMsg.includes('message port closed') &&
              !errorMsg.includes('Could not establish connection')
            ) {
              Logger.warn('[sendMessage] 메시지 전송 실패:', errorMsg);
            } else {
              // 정상적인 상황이므로 디버그 레벨로만 로깅
              Logger.debug('[sendMessage] 메시지 포트 닫힘 (정상):', errorMsg);
            }
          }
        }
      );
    }
  });
}

// 1. 알람 리스너 (스케줄러)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetch-channels') {
    Logger.biz('⏰ [Alarm] 채널 데이터 수집 시작');
    fetchAllChannelData();
  } else if (alarm.name === 'update-performance-metrics') {
    Logger.biz('⏰ [Alarm] 성과 지표 업데이트 시작');
    updateAllPerformanceMetrics();
  }
});

// [최적화] 콘텐츠 스크립트와의 롱 런타임 연결(Keep-alive) 처리
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-script-keepalive') {
    Logger.debug(`[Background] 콘텐츠 스크립트 연결됨: ${port.sender?.tab?.id}`);

    // 포트가 끊어졌을 때의 처리 (선택 사항)
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      Logger.debug(
        `[Background] 콘텐츠 스크립트 연결 해제: ${port.sender?.tab?.id}`,
        err ? `(Error: ${err.message})` : ''
      );
    });
  }

  // Offscreen document persistent init port - register globally so the
  // service worker doesn't miss the connection when it occurs outside
  // the local ensureOffscreenDocument lifecycle window.
  if (port.name === 'offscreen-init') {
    Logger.debug('[Background] offscreen-init 포트 연결 수신, 오프스크린 등록 시도');
    try {
      const ok = registerOffscreenPort(port);
      if (ok) {
        Logger.debug('[Background] offscreen-init 포트 등록 성공');
      } else {
        Logger.warn('[Background] offscreen-init 포트 등록 실패 (모듈 헬퍼 반환 false)');
      }
    } catch (e) {
      Logger.warn('[Background] offscreen-init 포트 등록 중 예외 발생', e && e.message);
    }
  }
});

// 2. 설치/업데이트 리스너
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    Logger.info(`[System] Extension ${details.reason}d. Registering alarms...`);
    chrome.alarms.create('fetch-channels', {
      delayInMinutes: 1,
      periodInMinutes: 240,
    });
    chrome.alarms.create('update-performance-metrics', {
      delayInMinutes: 5,
      periodInMinutes: 360,
    });

    // [실질적 원인 파악] 업데이트 플래그 설정 (content script에서 실제 업데이트 여부 확인용)
    if (details.reason === 'update') {
      chrome.storage.local.set({
        extension_updated: true,
        extension_updated_time: Date.now(),
      });
      Logger.info('[System] 확장 프로그램 업데이트 플래그 설정');
    }

    // 기본 설정 초기화
    chrome.storage.local.set({
      isScrapingActive: false,
      highlightToggleState: false,
      isKeywordExtractionEnabled: true,
    });

    // [체크리스트 2-🅰️] 업데이트 시 마이그레이션 자동 실행
    // 마이그레이션 완료 상태 확인
    // 마이그레이션 자동 실행: 현재 비활성화되어 있음.
    // 이전에는 설치 시 자동 마이그레이션을 시도했으나, 현재 개발 단계에서는
    // 데이터가 적고 수동 관리중이므로 해당 자동 실행을 제거합니다.
    // 필요 시 추후에 마이그레이션 로직을 다시 추가할 수 있습니다.
  }
});

// 3. 메시지 라우터 (Message Router)
/**
 * 백그라운드 스크립트의 메인 메시지 핸들러입니다.
 * 모든 content script와 popup의 메시지를 라우팅하고 처리합니다.
 */
console.log('[Background] 메시지 라우터 등록 시작');
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[Background] 메시지 수신:', msg.action);
  // Offscreen 응답 메시지는 라우터에서 제외 (OffscreenService 내부 Promise가 처리)
  if (msg.action.endsWith('_in_offscreen_response')) {
    return false; // 다른 리스너가 처리하도록 함
  }

  // [추가] Keep-Alive 핑은 조용히 무시 (서비스 워커를 깨우는 용도)
  if (msg.action === 'keep_alive_ping') {
    return false;
  }

  // 비동기 응답 처리를 위한 헬퍼
  const handleAsync = (promise) => {
    promise
      .then((data) => sendResponse(data || { success: true }))
      .catch((err) => {
        Logger.error(`[Router Error] ${msg.action}:`, err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답 표시
  };

  // === [System] 연결 확인 ===
  if (msg.action === 'ping') {
    // synchronous reply — do NOT return true (which indicates async response)
    sendResponse({ success: true, message: 'pong' });
    return false;
  }

  // === [System] 사용자 ID 조회 ===
  if (msg.action === 'get_user_id') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        return { success: true, userId };
      })()
    );
  }

  // === [Collector Service] 데이터 수집 ===
  if (msg.action === 'fetch_all_channel_data') return handleAsync(fetchAllChannelData());
  if (msg.action === 'refresh_channel_data')
    return handleAsync(refreshChannelData(msg.sourceId, msg.platform));
  if (msg.action === 'fetch_and_save_single_post')
    return handleAsync(fetchAndSaveSinglePost(msg.url, msg.channelId, msg.sourceId));
  if (msg.action === 'delete_channel') {
    return handleAsync(
      (async () => {
        const { id: channelId, url: channelUrl } = msg;
        console.log(
          '[Background] delete_channel - channelId:',
          channelId,
          'channelUrl:',
          channelUrl
        );
        const userId = await getCurrentUserId();

        // Guard: avoid writing to default_user when unauthenticated
        if (userId === CONSTANTS.USER_ID) {
          Logger.warn(
            '[link_published_url] No valid user ID (default_user) — aborting link_published_url to avoid creating default_user data'
          );
          // Notify the UI to prompt login
          chrome.runtime
            .sendMessage({
              action: 'show_error_toast',
              errorType: 'UNAUTHORIZED',
              message: '로그인이 필요합니다. 퍼포먼스 추적을 시작하려면 로그인해주세요.',
            })
            .catch(() => {});
          return { success: false, error: '로그인이 필요합니다.' };
        }

        // 1. Firebase에서 채널 목록에서 직접 제거
        const channelsRef = ref(getDb(), `channels/${userId}`);
        const channelsSnap = await get(channelsRef);
        const channelsData = channelsSnap?.val() || {
          myChannels: { blogs: [], youtubes: [] },
        };

        let channelRemoved = false;
        if (channelsData.myChannels) {
          // blogs에서 제거
          if (channelsData.myChannels.blogs) {
            const originalLength = channelsData.myChannels.blogs.length;
            channelsData.myChannels.blogs = channelsData.myChannels.blogs.filter((ch) => {
              const chId = ch.id || (ch.apiUrl ? btoa(ch.apiUrl).replace(/=/g, '') : null);
              return chId !== channelId;
            });
            if (channelsData.myChannels.blogs.length < originalLength) {
              channelRemoved = true;
            }
          }
          // youtubes에서 제거
          if (channelsData.myChannels.youtubes) {
            const originalLength = channelsData.myChannels.youtubes.length;
            channelsData.myChannels.youtubes = channelsData.myChannels.youtubes.filter((ch) => {
              const chId = ch.id || (ch.apiUrl ? btoa(ch.apiUrl).replace(/=/g, '') : null);
              return chId !== channelId;
            });
            if (channelsData.myChannels.youtubes.length < originalLength) {
              channelRemoved = true;
            }
          }
        }

        if (channelRemoved) {
          await set(channelsRef, channelsData);
          console.log('[Background] 채널 목록에서 제거 완료');
        }

        // 2. 연쇄 삭제 실행
        const result = await deleteChannelDataCascade(channelId, userId, channelUrl);
        if (!result.success) {
          throw new Error(result.error);
        }

        // [캐시 무효화] 채널 삭제 시 캐시 초기화
        channelsAndKeyCache = null;
        channelsAndKeyCacheTimestamp = 0;
        Logger.debug(`[delete_channel] 캐시 무효화 완료`);

        return {
          success: true,
          count: result.deletedCount,
          details: result.details,
        };
      })()
    );
  }
  if (msg.action === 'fetch_image_as_base64') return handleAsync(fetchImageAsBase64(msg.url));

  // === [Analytics Service] 성과 분석 & 진단 ===
  if (msg.action === 'trigger_performance_refresh')
    return handleAsync(updateAllPerformanceMetrics());
  if (msg.action === 'check_adsense_registration')
    return handleAsync(checkAdSenseRegistrationStatus());
  if (msg.action === 'run_system_diagnosis') return handleAsync(runFullSystemDiagnosis());
  // TODO: 아래 함수들은 아직 구현되지 않음
  if (msg.action === 'run_adsense_deep_diagnosis')
    return handleAsync(Promise.reject(new Error('runAdSenseDeepDiagnosis: 아직 구현되지 않음')));
  if (msg.action === 'test_blog_connection')
    return handleAsync(Promise.reject(new Error('testBlogConnection: 아직 구현되지 않음')));
  if (msg.action === 'test_adsense_ga4_access')
    return handleAsync(Promise.reject(new Error('testAdSenseGa4Access: 아직 구현되지 않음')));

  // === [AI Service] 생성 및 분석 ===
  if (msg.action === 'generate_draft_from_idea') {
    const opts = msg.options || {};
    opts.onProgress = (p) => {
      if (sender.tab?.id) {
        chrome.tabs
          .sendMessage(sender.tab.id, {
            action: 'thumbnail_progress',
            progress: p,
            cardId: msg.data?.cardId || null,
            message: p?.message || null,
            step: p?.step || null,
          })
          .catch((err) => {
            if (
              err?.message &&
              !err.message.includes('message port closed') &&
              !err.message.includes('Could not establish connection')
            ) {
              Logger.debug('[sendMessage] thumbnail_progress 전송 실패:', err.message);
            }
          });
      }
    };
    return handleAsync(generateDraftFromIdea(msg.data, opts));
  }
  if (msg.action === 'generate_idea_briefing') {
    const payload = msg.data || msg || {};
    const { cardId, title, description } = payload;
    // Normalize options: accept flags in top-level payload or in nested options
    let normalizedOptions;
    const hasAnyFlag =
      !!payload.options ||
      payload.generateOutline !== undefined ||
      payload.generateKeywords !== undefined ||
      payload.generateLongTail !== undefined ||
      payload.generateMainKeywords !== undefined ||
      payload.status !== undefined ||
      payload.originType !== undefined ||
      payload.origin !== undefined ||
      payload.onProgress !== undefined;

    if (hasAnyFlag) {
      normalizedOptions = {
        ...(payload.options || {}),
        generateOutline: payload.options?.generateOutline ?? payload.generateOutline ?? false,
        generateKeywords: payload.options?.generateKeywords ?? payload.generateKeywords ?? false,
        generateLongTail: payload.options?.generateLongTail ?? payload.generateLongTail ?? false,
        generateMainKeywords:
          payload.options?.generateMainKeywords ?? payload.generateMainKeywords ?? false,
        status: payload.options?.status ?? payload.status ?? 'ideas',
        originType: payload.options?.originType ?? payload.originType ?? null,
        origin: payload.options?.origin ?? payload.origin ?? null,
        onProgress: payload.options?.onProgress ?? payload.onProgress ?? null,
      };
    } else {
      normalizedOptions = undefined;
    }

    return handleAsync(
      generateIdeaBriefing(cardId, title, description, normalizedOptions)
        .then((res) => {
          if (res && res.success === false) {
            return {
              success: false,
              error: res.error || res.reason || 'Unknown error from AI service',
            };
          }
          return { success: true };
        })
        .catch((error) => ({ success: false, error: error.message }))
    );
  }
  if (msg.action === 'retry_idea_briefing') {
    // enqueue a retry: set DB state to queued and then schedule generateIdeaBriefing in background
    const payload = msg.data || msg || {};
    const { cardId, status = 'ideas' } = payload;
    return handleAsync(
      (async () => {
        try {
          const userId = await getCurrentUserId();
          if (!userId) return { success: false, error: 'no_user' };
          const updatePath = `kanban/${userId}/${status}/${cardId}`;
          // read existing card so we can pass title/description to the generator
          try {
            const snapshot = await get(ref(getDb(), updatePath));
            const cardData = snapshot?.val();
            if (!cardData) return { success: false, error: 'card_not_found' };

            // mark queued and reset progress/error fields
            try {
              await update(ref(getDb(), updatePath), {
                briefingStatus: 'queued',
                briefingQueuedAt: serverTimestamp(),
                briefingError: null,
                briefingCompletedAt: null,
                briefingProgress: 0,
              });
            } catch (e) {
              Logger.warn('[retry_idea_briefing] DB update failed:', e?.message || String(e));
            }

            // schedule the generator (do not await to keep UI responsive)
            try {
              generateIdeaBriefing(cardId, cardData.title || '', cardData.description || '', {
                status,
              }).catch((err) => {
                Logger.error(
                  '[retry_idea_briefing] generateIdeaBriefing error:',
                  err?.message || String(err)
                );
              });
            } catch (e) {}

            return { success: true };
          } catch (err) {
            return { success: false, error: err?.message || String(err) };
          }
        } catch (err) {
          return { success: false, error: err?.message || String(err) };
        }
      })()
    );
  }
  if (msg.action === 'ai_generate_images') {
    return handleAsync(
      generateAiImage(msg.data.prompt, msg.data.count).then((images) => ({
        success: true,
        images,
      }))
    );
  }
  if (msg.action === 'analyze_image_for_template')
    return handleAsync(analyzeImageForTemplate(msg.data));
  if (msg.action === 'call_gemini')
    return handleAsync(callGeminiAPI(msg.prompt).then((text) => ({ success: true, text })));
  if (msg.action === 'analyze_my_channel') return handleAsync(analyzeMyChannel(msg.data));
  if (msg.action === 'generate_content_ideas') return handleAsync(generateContentIdeas(msg.data));
  if (msg.action === 'request_search_keywords')
    return handleAsync(generateAndSendKeywords(msg.data, sender));
  if (msg.action === 'analyze_video_comments')
    return handleAsync(analyzeVideoComments(msg.videoId));
  if (msg.action === 'upload_thumbnail_to_storage') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        return uploadImageToFirebaseStorage(
          msg.data.dataUrl,
          `thumbnails/${userId}/${msg.data.filename || Date.now() + '.png'}`,
          userId
        ).then((url) => ({ success: true, url }));
      })()
    );
  }

  // === [Offscreen Image Processing] 이미지 처리 가속 ===
  if (msg.action === 'resize_image_in_offscreen') {
    // [변경] OffscreenService의 함수 호출
    return handleAsync(
      resizeImageInOffscreen(
        msg.data.imageDataUrl,
        msg.data.maxWidth || 1920,
        msg.data.maxHeight || 1080,
        msg.data.quality || 0.9
      ).then((dataUrl) => ({ success: true, dataUrl }))
    );
  }

  if (msg.action === 'render_template_in_offscreen') {
    // [변경] OffscreenService의 함수 호출
    return handleAsync(
      renderTemplateInOffscreen(
        msg.data.templateData,
        msg.data.canvasWidth || 1280,
        msg.data.canvasHeight || 720,
        msg.data.dynamicText || {}
      ).then((dataUrl) => ({ success: true, dataUrl }))
    );
  }

  // [신규] 이미지 크롭 요청 라우팅 (offscreen.js로 전달)
  if (msg.action === 'crop_image_in_offscreen') {
    // offscreen.js로 직접 전달 (응답은 offscreen.js에서 처리)
    chrome.runtime
      .sendMessage({
        action: 'crop_image_in_offscreen',
        imageDataUrl: msg.imageDataUrl,
        targetRatio: msg.targetRatio,
      })
      .catch((err) => {
        Logger.error('[Router] 이미지 크롭 요청 전송 실패:', err);
      });
    // 응답은 offscreen.js에서 직접 처리하므로 여기서는 true 반환
    return true;
  }

  // [신규] 외부(팝업 등)에서 HTML 정제를 요청할 경우를 대비한 라우트
  if (msg.action === 'sanitize_html') {
    Logger.debug('[Router] sanitize_html 요청 수신');
    return handleAsync(
      sanitizeHtmlInOffscreen(msg.rawText || msg.data?.rawText || '')
        .then((cleanedHtml) => {
          Logger.debug('[Router] sanitize_html 정제 완료');
          return { success: true, cleanedHtml };
        })
        .catch((error) => {
          Logger.error('[Router] sanitize_html 정제 실패:', error);
          throw error;
        })
    );
  }

  // === [Auth Service] 인증 ===
  if (msg.action === 'start_google_auth') return handleAsync(startGoogleAuth());
  if (msg.action === 'revoke_google_auth') return handleAsync(revokeGoogleAuth());

  // === [System] 인증 토큰 가져오기 (테스트 스크립트용) ===
  if (msg.action === 'get_auth_token') {
    return handleAsync(
      (async () => {
        try {
          const { getValidToken } = await import('./js/services/authService.js');
          const token = await getValidToken(false);
          if (token) {
            return { success: true, token };
          } else {
            // 토큰이 없으면 interactive 모드로 재시도
            const interactiveToken = await getValidToken(true);
            if (interactiveToken) {
              return { success: true, token: interactiveToken };
            }
            return {
              success: false,
              error: '토큰을 가져올 수 없습니다. 로그인이 필요합니다.',
            };
          }
        } catch (error) {
          Logger.error('[get_auth_token] 오류:', error);
          return { success: false, error: error.message };
        }
      })()
    );
  }

  // === [System] 인증 토큰 갱신 (테스트 스크립트용) ===
  if (msg.action === 'refresh_auth_token') {
    return handleAsync(
      (async () => {
        try {
          const { refreshAuthToken } = await import('./js/services/authService.js');
          const result = await refreshAuthToken(false);
          if (result.success) {
            return { success: true, token: result.token };
          } else {
            // interactive 모드로 재시도
            const interactiveResult = await refreshAuthToken(true);
            if (interactiveResult.success) {
              return { success: true, token: interactiveResult.token };
            }
            return { success: false, error: result.error || '토큰 갱신 실패' };
          }
        } catch (error) {
          Logger.error('[refresh_auth_token] 오류:', error);
          return { success: false, error: error.message };
        }
      })()
    );
  }

  // === [DB Operations] 단순 데이터 조작 (직접 처리) ===
  if (msg.action === 'add_idea_to_kanban') {
    return handleAsync(
      (async () => {
        const ideaData = JSON.parse(msg.data);
        const status = msg.status || 'ideas';
        const channelId = msg.channelId || null;

        // Run the DB save step but skip the internal auto-briefing inside the service
        // because we're running inside the background context and should create the
        // briefing directly here (avoids nested runtime messaging and potential timeouts).
        const result = await addIdeaToKanban(ideaData, status, channelId, true);

        // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
        kanbanDataCache = null;
        kanbanDataCacheTimestamp = 0;
        Logger.debug(`[add_idea_to_kanban] 캐시 무효화 완료`);

        // If the DB write succeeded and the card should have a briefing, generate it
        try {
          const originType = ideaData.origin?.type;
          const shouldGenerateBriefing =
            originType !== 'manual_entry' &&
            originType !== 'tracking_only' &&
            ideaData.title &&
            status === 'ideas';

          if (result?.success && shouldGenerateBriefing) {
            (async () => {
              try {
                Logger.info(
                  `[background:add_idea_to_kanban] 직접 AI 브리핑 생성 시작 - card from UI message`
                );
                // call generateIdeaBriefing in background context directly
                const briefResult = await generateIdeaBriefing(
                  result.firebaseKey || result.firebase_key || result.id || null,
                  ideaData.title,
                  ideaData.description || '',
                  {
                    status: status,
                    generateOutline: true,
                    generateKeywords: true,
                    generateLongTail: true,
                    generateMainKeywords: true,
                    originType: originType,
                    origin: ideaData.origin || null,
                  }
                );
                // generateIdeaBriefing returns undefined on success in current
                // implementation — treat undefined or explicit success as success
                if (briefResult === undefined || (briefResult && briefResult.success)) {
                  Logger.biz(`[background:add_idea_to_kanban] 직접 AI 브리핑 생성 완료`);
                } else {
                  Logger.warn(`[background:add_idea_to_kanban] 직접 AI 브리핑 실패:`, briefResult);
                }
              } catch (err) {
                Logger.error(
                  '[background:add_idea_to_kanban] AI 브리핑 생성 실패:',
                  err?.message || String(err)
                );
              }
            })();
          }
        } catch (err) {
          Logger.error(
            '[background:add_idea_to_kanban] 브리핑 스케줄링 중 오류:',
            err?.message || String(err)
          );
        }

        return result;
      })()
    );
  }

  if (msg.action === 'link_published_url') {
    return handleAsync(
      (async () => {
        const { cardId, url, status } = msg.data || {};

        if (!cardId || !url || !status) {
          Logger.error('[link_published_url] 필수 정보 부족:', {
            cardId,
            url,
            status,
          });
          return { success: false, error: '필요한 정보가 부족합니다.' };
        }

        const userId = await getCurrentUserId();
        const cardPath = `${COLLECTIONS.KANBAN}/${userId}/${status}/${cardId}`;

        // 기존 카드 정보 가져오기 (origin.postUrl 확인용)
        const cardSnap = await get(ref(getDb(), cardPath));
        const existingCard = cardSnap?.val() || {};

        // [수정] 벤치마킹(경쟁사 포스트)이라도 발행 URL을 연결하면 '내 글'로 간주하여 추적 활성화
        // performanceTracked를 무조건 true로 설정
        await update(ref(getDb(), cardPath), {
          publishedUrl: url,
          performanceTracked: true, // ✅ 항상 추적 활성화
        });

        Logger.biz(
          `✅ [link_published_url] 아이디어 카드(${cardId})와 URL(${url}) 연결 완료 (성과 추적 시작)`
        );

        // URL 인덱스 업데이트
        try {
          await updateUrlIndex(cardId, status, existingCard.origin?.postUrl || null, url);
        } catch (error) {
          Logger.warn(`[link_published_url] URL 인덱스 업데이트 실패 (${cardId}):`, error);
          // 인덱스 업데이트 실패해도 연결은 성공으로 처리
        }

        // [수정] 조건문 제거: 모든 경우에 성과 추적 실행
        Logger.info(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 시작: ${url}`);
        updateSinglePerformanceMetric({
          id: cardId,
          path: cardPath,
          url: url,
        })
          .then(() => {
            Logger.biz(`✅ [GA4] 카드 ${cardId}의 GA4 데이터 수집 완료`);
          })
          .catch((error) => {
            Logger.error(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 실패:`, error);
          });

        // 해당 카드의 AdSense 등록 상태 확인 (단일 카드 모드)
        try {
          await checkAdSenseRegistrationStatus(null, url, cardId, status);
          Logger.info(`[AdSense] 카드 ${cardId}의 등록 상태 확인 완료`);
        } catch (error) {
          Logger.warn(`[AdSense] 카드 ${cardId}의 등록 상태 확인 실패:`, error);
        }

        // UI 갱신을 위해 최신 데이터 전송
        try {
          const kanbanRef = ref(getDb(), `kanban/${userId}`);
          const kanbanSnap = await get(kanbanRef);
          const kanbanData = kanbanSnap?.val() || {};

          chrome.runtime
            .sendMessage({
              action: 'kanban_data_updated',
              data: kanbanData,
            })
            .catch((err) => {
              if (
                err?.message &&
                !err.message.includes('message port closed') &&
                !err.message.includes('Could not establish connection')
              ) {
                Logger.debug('[sendMessage] kanban_data_updated 전송 실패:', err.message);
              }
            });

          if (sender.tab?.id) {
            chrome.tabs
              .sendMessage(sender.tab.id, {
                action: 'kanban_data_updated',
                data: kanbanData,
              })
              .catch((err) => {
                if (
                  err?.message &&
                  !err.message.includes('message port closed') &&
                  !err.message.includes('Could not establish connection')
                ) {
                  Logger.debug('[sendMessage] kanban_data_updated 전송 실패:', err.message);
                }
              });
          }
        } catch (error) {
          Logger.warn('[link_published_url] UI 갱신 메시지 전송 실패:', error);
        }

        return { success: true };
      })()
    );
  }

  if (msg.action === 'update_kanban_card') {
    // msg.data가 객체인 경우와 직접 속성이 있는 경우 모두 처리
    const cardId = msg.data?.cardId || msg.cardId;
    const status = msg.data?.status || msg.status;
    const updates = msg.data?.updates || msg.updates;

    return handleAsync(
      (async () => {
        if (!cardId || !status || !updates) {
          Logger.error('[update_kanban_card] 필수 정보 부족:', {
            cardId,
            status,
            hasUpdates: !!updates,
          });
          return { success: false, error: '필수 정보가 부족합니다.' };
        }

        const userId = await getCurrentUserId();
        const updatePath = `kanban/${userId}/${status}/${cardId}`;

        Logger.debug(`[update_kanban_card] 업데이트 시작 - path: ${updatePath}, updates:`, updates);

        // 데이터 정제 (undefined → null)
        const cleanedUpdates = cleanDataForFirebase(updates);

        await update(ref(getDb(), updatePath), cleanedUpdates);

        Logger.biz(
          `✅ [update_kanban_card] 카드 업데이트 완료 - cardId: ${cardId}, status: ${status}`
        );

        // REST API 모드에서는 실시간 리스너가 작동하지 않으므로, UI 갱신을 위해 최신 데이터를 가져와서 메시지 전송
        try {
          const kanbanRef = ref(getDb(), `kanban/${userId}`);
          const kanbanSnap = await get(kanbanRef);
          const kanbanData = kanbanSnap?.val() || {};

          // 1. 확장 프로그램 UI(사이드 패널/팝업)에 메시지 전송
          chrome.runtime
            .sendMessage({
              action: 'kanban_data_updated',
              data: kanbanData,
            })
            .catch((err) => {
              if (
                err?.message &&
                !err.message.includes('message port closed') &&
                !err.message.includes('Could not establish connection')
              ) {
                Logger.debug(
                  `[update_kanban_card] 확장 프로그램 UI 메시지 전송 실패:`,
                  err.message
                );
              }
            });

          // 2. 웹페이지 탭의 content script에도 메시지 전송
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (
                tab.id &&
                tab.url &&
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('edge://') &&
                !tab.url.startsWith('about:')
              ) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    action: 'kanban_data_updated',
                    data: kanbanData,
                  })
                  .catch((err) => {
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
      })()
    );
  }

  if (msg.action === 'delete_kanban_card') {
    return handleAsync(
      (async () => {
        const { cardId, status } = msg.data;
        const result = await deleteKanbanCard(cardId, status);

        // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
        kanbanDataCache = null;
        kanbanDataCacheTimestamp = 0;
        Logger.debug(`[delete_kanban_card] 캐시 무효화 완료`);

        return result;
      })()
    );
  }

  if (msg.action === 'move_kanban_card') {
    return handleAsync(
      (async () => {
        const { cardId, originalStatus, newStatus } = msg.data;
        if (!cardId || !originalStatus || !newStatus) {
          return { success: false, error: '필수 정보가 부족합니다.' };
        }

        const userId = await getCurrentUserId();
        const originalRef = ref(getDb(), `kanban/${userId}/${originalStatus}/${cardId}`);
        const newRef = ref(getDb(), `kanban/${userId}/${newStatus}/${cardId}`);

        try {
          // 원래 위치의 카드 데이터 읽기
          const cardSnap = await get(originalRef);
          const cardData = cardSnap?.val();
          if (!cardData) {
            return { success: false, error: '이동할 카드를 찾을 수 없습니다.' };
          }

          // 새 위치에 카드 데이터 저장
          await set(newRef, cardData);

          // 원래 위치에서 카드 삭제
          await remove(originalRef);

          Logger.biz(`[Kanban] 카드 이동: ${cardId} (${originalStatus} → ${newStatus})`);

          // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
          kanbanDataCache = null;
          kanbanDataCacheTimestamp = 0;
          Logger.debug(`[move_kanban_card] 캐시 무효화 완료`);

          // UI 갱신 메시지 전송
          try {
            const kanbanRef = ref(getDb(), `kanban/${userId}`);
            const kanbanSnap = await get(kanbanRef);
            const kanbanData = kanbanSnap?.val() || {};

            chrome.runtime
              .sendMessage({
                action: 'kanban_data_updated',
                data: kanbanData,
              })
              .catch((err) => {
                if (
                  err?.message &&
                  !err.message.includes('message port closed') &&
                  !err.message.includes('Could not establish connection')
                ) {
                  Logger.debug(
                    `[move_kanban_card] 확장 프로그램 UI 메시지 전송 실패:`,
                    err.message
                  );
                }
              });

            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (
                  tab.id &&
                  tab.url &&
                  !tab.url.startsWith('chrome://') &&
                  !tab.url.startsWith('edge://') &&
                  !tab.url.startsWith('about:')
                ) {
                  chrome.tabs
                    .sendMessage(tab.id, {
                      action: 'kanban_data_updated',
                      data: kanbanData,
                    })
                    .catch((err) => {
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
      })()
    );
  }

  if (msg.action === 'delete_draft_and_publish_info') {
    return handleAsync(
      (async () => {
        const { ideaId, status } = msg.data || msg;
        if (!ideaId || !status) {
          return { success: false, error: '필수 정보가 부족합니다.' };
        }

        const userId = await getCurrentUserId();
        const cardPath = `kanban/${userId}/${status}/${ideaId}`;

        try {
          // 현재 카드 데이터 읽기
          const cardSnap = await get(ref(getDb(), cardPath));
          const cardData = cardSnap?.val();

          if (!cardData) {
            return { success: false, error: '카드를 찾을 수 없습니다.' };
          }

          // draftContent, publishInfo, seoTitle 제거
          // Firebase REST API에서 필드를 완전히 제거하려면 필드를 제외한 전체 데이터를 set()으로 저장해야 함
          // update()로 null을 설정해도 필드가 남아있을 수 있으므로, 처음부터 set() 사용

          Logger.debug(
            `[delete_draft_and_publish_info] 필드 제거 시작 - draftContent: ${
              cardData.draftContent !== undefined ? '있음' : '없음'
            }, publishInfo: ${cardData.publishInfo !== undefined ? '있음' : '없음'}, seoTitle: ${
              cardData.seoTitle !== undefined ? '있음' : '없음'
            }, workspace.draft: ${cardData.workspace?.draft !== undefined ? '있음' : '없음'}`
          );

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
            ...(cleanedWorkspace ? { workspace: cleanedWorkspace } : {}),
          };

          Logger.debug(`[delete_draft_and_publish_info] 필드 제외한 데이터로 교체 시작`);

          // 초안 삭제 후 자동으로 아이디어 칸(ideas)으로 이동해야 하는지 확인
          const shouldMoveToIdeas = status !== 'ideas';

          if (shouldMoveToIdeas) {
            // 이동이 필요한 경우: 필드 제거된 데이터를 바로 아이디어 칸에 저장하고 원래 위치에서 삭제
            Logger.debug(
              `[delete_draft_and_publish_info] 초안 삭제 후 아이디어 칸으로 이동 - 현재 status: ${status}`
            );

            const ideasPath = `${COLLECTIONS.KANBAN}/${userId}/${KANBAN_STATUS.IDEAS}/${ideaId}`;

            // 필드 제거된 데이터를 아이디어 칸에 저장
            await set(ref(getDb(), ideasPath), cleanDataForFirebase(cleanedCardData));

            // 원래 위치에서 카드 삭제
            await remove(ref(getDb(), cardPath));

            Logger.biz(
              `✅ [delete_draft_and_publish_info] 초안 삭제 및 카드 이동 완료: ${ideaId} (${status} → ideas)`
            );
          } else {
            // 이동이 필요 없는 경우: 현재 위치에서 필드만 제거
            await set(ref(getDb(), cardPath), cleanDataForFirebase(cleanedCardData));

            Logger.biz(
              `✅ [delete_draft_and_publish_info] 초안 및 발행 정보 삭제 완료 - cardId: ${ideaId}`
            );

            // 업데이트가 완전히 반영되도록 잠시 대기
            await new Promise((resolve) => setTimeout(resolve, 300));

            // 삭제된 필드가 실제로 제거되었는지 확인
            const verifySnap = await get(ref(getDb(), cardPath));
            const verifyData = verifySnap?.val();

            if (verifyData) {
              // 필드가 존재하는지 확인 (undefined가 아니면 필드가 존재함)
              // Treat null as removed: only consider a field present if it's !== undefined and !== null
              const hasDraftField =
                verifyData.draftContent !== undefined && verifyData.draftContent !== null;
              const hasPublishInfoField =
                verifyData.publishInfo !== undefined && verifyData.publishInfo !== null;
              const hasSeoTitleField =
                verifyData.seoTitle !== undefined && verifyData.seoTitle !== null;
              const hasWorkspaceDraftField =
                verifyData.workspace?.draft !== undefined && verifyData.workspace?.draft !== null;

              Logger.debug(
                `[delete_draft_and_publish_info] 필드 존재 확인 - draftContent: ${hasDraftField}, publishInfo: ${hasPublishInfoField}, seoTitle: ${hasSeoTitleField}, workspace.draft: ${hasWorkspaceDraftField}`
              );

              if (
                hasDraftField ||
                hasPublishInfoField ||
                hasSeoTitleField ||
                hasWorkspaceDraftField
              ) {
                Logger.error(`[delete_draft_and_publish_info] ⚠️ 필드가 여전히 존재함 - 재시도...`);

                // 재시도: 다시 한 번 필드 제거
                const {
                  draftContent: vDraft,
                  publishInfo: vPublish,
                  seoTitle: vSeo,
                  workspace: vWorkspace,
                  ...vRest
                } = verifyData;
                let vCleanedWorkspace = vWorkspace;
                if (vWorkspace) {
                  const { draft: vDraftField, ...vRestWorkspace } = vWorkspace;
                  vCleanedWorkspace =
                    Object.keys(vRestWorkspace).length > 0 ? vRestWorkspace : undefined;
                }

                const vCleanedCardData = {
                  ...vRest,
                  ...(vCleanedWorkspace ? { workspace: vCleanedWorkspace } : {}),
                };

                await set(ref(getDb(), cardPath), cleanDataForFirebase(vCleanedCardData));

                // 최종 확인
                await new Promise((resolve) => setTimeout(resolve, 300));
                const finalVerifySnap = await get(ref(getDb(), cardPath));
                const finalVerifyData = finalVerifySnap?.val();

                const finalHasDraft =
                  finalVerifyData?.draftContent !== undefined &&
                  finalVerifyData?.draftContent !== null;
                const finalHasPublishInfo =
                  finalVerifyData?.publishInfo !== undefined &&
                  finalVerifyData?.publishInfo !== null;
                const finalHasSeoTitle =
                  finalVerifyData?.seoTitle !== undefined && finalVerifyData?.seoTitle !== null;
                const finalHasWorkspaceDraft =
                  finalVerifyData?.workspace?.draft !== undefined &&
                  finalVerifyData?.workspace?.draft !== null;

                if (
                  finalHasDraft ||
                  finalHasPublishInfo ||
                  finalHasSeoTitle ||
                  finalHasWorkspaceDraft
                ) {
                  Logger.error(
                    `[delete_draft_and_publish_info] ⚠️ 재시도 후에도 필드가 남아있음 (draftContent: ${finalHasDraft}, publishInfo: ${finalHasPublishInfo}, seoTitle: ${finalHasSeoTitle}, workspace.draft: ${finalHasWorkspaceDraft})`
                  );
                } else {
                  Logger.biz(
                    `✅ [delete_draft_and_publish_info] 재시도 완료 - 필드 완전 삭제 확인됨`
                  );
                }
              } else {
                Logger.biz(
                  `✅ [delete_draft_and_publish_info] 필드 제거 확인 완료 - 모든 필드가 제거됨`
                );
              }
            }
          }

          // UI 갱신 메시지 전송 (최신 데이터로)
          try {
            const kanbanRef = ref(getDb(), `kanban/${userId}`);
            const kanbanSnap = await get(kanbanRef);
            const kanbanData = kanbanSnap?.val() || {};

            Logger.debug(
              `[delete_draft_and_publish_info] UI 갱신 메시지 전송 - 카드 개수: ${Object.keys(
                kanbanData
              ).reduce((sum, status) => sum + Object.keys(kanbanData[status] || {}).length, 0)}`
            );

            chrome.runtime
              .sendMessage({
                action: 'kanban_data_updated',
                data: kanbanData,
              })
              .catch((err) => {
                if (
                  err?.message &&
                  !err.message.includes('message port closed') &&
                  !err.message.includes('Could not establish connection')
                ) {
                  Logger.debug(
                    `[delete_draft_and_publish_info] 확장 프로그램 UI 메시지 전송 실패:`,
                    err.message
                  );
                }
              });

            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (
                  tab.id &&
                  tab.url &&
                  !tab.url.startsWith('chrome://') &&
                  !tab.url.startsWith('edge://') &&
                  !tab.url.startsWith('about:')
                ) {
                  chrome.tabs
                    .sendMessage(tab.id, {
                      action: 'kanban_data_updated',
                      data: kanbanData,
                    })
                    .catch((err) => {
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
      })()
    );
  }

  if (msg.action === 'get_kanban_data' || msg.action === 'get_all_kanban_data') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();

        Logger.info(`[get_kanban_data] 새로운 데이터 조회 - userId: ${userId}`);
        const dbRef = ref(getDb(), `${COLLECTIONS.KANBAN}/${userId}`);

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
                  chrome.tabs
                    .sendMessage(tab.id, {
                      action: 'kanban_data_updated',
                      data: data,
                    })
                    .catch((err) => {
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

        const responseData = { success: true, data: data };

        // 캐시에 저장
        kanbanDataCache = responseData;
        kanbanDataCacheTimestamp = now;

        // 즉시 UI에 업데이트 메시지 전송 (콜백이 실행되지 않는 경우 대비)
        if (sender.tab?.id) {
          chrome.tabs
            .sendMessage(sender.tab.id, {
              action: 'kanban_data_updated',
              data: data,
            })
            .catch((err) => {
              // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
              // 조용히 무시
            });
        }

        return responseData;
      })()
    );
  }

  if (msg.action === 'get_paginated_performance_data') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        const { page = 1, pageSize = 50 } = msg;
        const offset = (page - 1) * pageSize;

        Logger.info(
          `[get_paginated_performance_data] 요청 수신 - page: ${page}, pageSize: ${pageSize}`
        );

        const snap = await get(ref(getDb(), `${COLLECTIONS.KANBAN}/${userId}`));
        const allCards = snap?.val() || {};

        // 성과 데이터만 필터링 (done 상태의 카드 중 publishedUrl과 performance가 있는 것)
        const performanceCards = [];
        const { activeChannelId } = await chrome.storage.local.get('activeChannelId');

        for (const status in allCards) {
          if (status !== 'done') continue;

          for (const cardId in allCards[status]) {
            const card = allCards[status][cardId];

            // 채널 필터링
            if (activeChannelId && card.channelId && card.channelId !== activeChannelId) {
              try {
                const cardUrl = atob(card.channelId.replace(/=/g, ''));
                const activeUrl = atob(activeChannelId.replace(/=/g, ''));
                if (new URL(cardUrl).origin !== new URL(activeUrl).origin) continue;
              } catch (e) {
                continue;
              }
            }

            if (card.publishedUrl && card.performance && !card.performance.error) {
              performanceCards.push({
                id: cardId,
                status: status,
                title: card.title || '제목 없음',
                publishedUrl: card.publishedUrl,
                performance: card.performance,
                createdAt: card.createdAt || 0,
                lastUpdatedAt: card.performance.lastUpdatedAt || 0,
              });
            }
          }
        }

        // 페이징 적용
        const total = performanceCards.length;
        const paginatedData = performanceCards.slice(offset, offset + pageSize);
        const hasMore = offset + pageSize < total;

        Logger.info(
          `[get_paginated_performance_data] 반환 - total: ${total}, page: ${page}, returned: ${paginatedData.length}, hasMore: ${hasMore}`
        );

        return {
          success: true,
          data: paginatedData,
          hasMore: hasMore,
          total: total,
          page: page,
          pageSize: pageSize,
        };
      })()
    );
  }

  if (msg.action === 'get_all_scraps') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        Logger.info(
          `[get_all_scraps] 요청 수신 - userId: ${userId}, channelId: ${msg.channelId || 'null'}`
        );
        const snap = await get(ref(getDb(), `${COLLECTIONS.SCRAPS}/${userId}`));
        const val = snap?.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
        const targetChannelId = msg.channelId || null;
        Logger.debug(
          `[get_all_scraps] 전체 스크랩 개수: ${arr.length}, targetChannelId: ${targetChannelId}`
        );
        // 필터링: channelId가 없거나 null이거나 targetChannelId와 일치하는 경우
        const filtered = arr.filter((scrap) => {
          // channelId가 없거나 null인 경우 포함 (구버전 데이터 또는 공용 스크랩)
          if (scrap.channelId === undefined || scrap.channelId === null) {
            return true;
          }

          // 정확히 일치하는 경우 포함
          if (scrap.channelId === targetChannelId) {
            return true;
          }

          // URL의 origin이 일치하는 경우 포함 (칸반과 동일한 로직)
          if (scrap.channelId && targetChannelId) {
            try {
              const scrapUrl = atob(scrap.channelId.replace(/=/g, ''));
              const targetUrl = atob(targetChannelId.replace(/=/g, ''));

              const scrapUrlObj = new URL(scrapUrl);
              const targetUrlObj = new URL(targetUrl);

              if (scrapUrlObj.origin === targetUrlObj.origin) {
                Logger.debug(
                  `[get_all_scraps] URL origin 일치: ${scrapUrlObj.origin} === ${targetUrlObj.origin}`
                );
                return true;
              }
            } catch (e) {
              // base64 디코딩 실패 시 무시
            }
          }

          return false;
        });
        Logger.info(`[get_all_scraps] 필터링 후 스크랩 개수: ${filtered.length}`);

        const responseData = {
          success: true,
          scraps: filtered.sort((a, b) => b.timestamp - a.timestamp),
        };

        // 콜백이 실행되지 않는 경우를 대비하여 content script에 메시지 전송
        // 모든 탭에 업데이트 메시지 전송 (콜백이 실행되지 않는 경우 대비)
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs
                .sendMessage(tab.id, {
                  action: 'scraps_data_updated',
                  scraps: responseData.scraps,
                })
                .catch((err) => {
                  // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
                  // 조용히 무시
                });
            }
          });
        });

        return responseData;
      })()
    );
  }

  if (msg.action === 'cp_get_firebase_scraps') {
    return handleAsync(
      (async () => {
        const targetChannelId = msg.channelId || null;
        return await getFirebaseScraps(targetChannelId);
      })()
    );
  }

  if (msg.action === 'get_channel_content') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        Logger.info(`[get_channel_content] 요청 수신 - userId: ${userId}`);
        const [contentSnap, metaSnap, channelsSnap] = await Promise.all([
          get(ref(getDb(), `${COLLECTIONS.CHANNEL_CONTENT}/${userId}`)),
          get(ref(getDb(), `${COLLECTIONS.CHANNEL_META}/${userId}`)),
          get(ref(getDb(), `${COLLECTIONS.CHANNELS}/${userId}`)),
        ]);

        // snapshot 객체에서 .val()로 데이터 추출
        const content = contentSnap?.val() || {};
        const metas = metaSnap?.val() || {};
        const channels = channelsSnap?.val() || {
          myChannels: {},
          competitorChannels: {},
        };

        // 필터링: null 값 제거 및 undefined 값도 제거
        const blogsRaw = content.blogs || {};
        const youtubesRaw = content.youtubes || {};

        // 디버깅: 원본 데이터 개수 확인
        const blogsRawCount = Object.keys(blogsRaw).length;
        const youtubesRawCount = Object.keys(youtubesRaw).length;
        Logger.debug(
          `[get_channel_content] 원본 데이터 개수 - blogs: ${blogsRawCount}, youtubes: ${youtubesRawCount}`
        );

        const blogs = Object.values(blogsRaw).filter((item) => item !== null && item !== undefined);
        const youtubes = Object.values(youtubesRaw).filter(
          (item) => item !== null && item !== undefined
        );
        const allContent = [...blogs, ...youtubes];

        // 디버깅: 필터링 후 개수 확인
        Logger.info(
          `[get_channel_content] 데이터 로드 완료 - blogs: ${blogs.length} (원본: ${blogsRawCount}), youtubes: ${youtubes.length} (원본: ${youtubesRawCount}), total: ${allContent.length}`
        );

        // 디버깅: null/undefined로 필터링된 항목 확인
        if (blogsRawCount > blogs.length) {
          const filteredOut = Object.entries(blogsRaw).filter(
            ([key, value]) => value === null || value === undefined
          );
          Logger.warn(
            `[get_channel_content] blogs에서 필터링된 항목: ${filteredOut.length}개`,
            filteredOut.map(([key]) => key)
          );
        }
        if (youtubesRawCount > youtubes.length) {
          const filteredOut = Object.entries(youtubesRaw).filter(
            ([key, value]) => value === null || value === undefined
          );
          Logger.warn(
            `[get_channel_content] youtubes에서 필터링된 항목: ${filteredOut.length}개`,
            filteredOut.map(([key]) => key)
          );
        }

        return {
          success: true,
          data: {
            content: allContent,
            metas: metas,
            channels: channels,
          },
        };
      })()
    );
  }

  // === [Channel Management] 채널 관리 ===
  if (msg.action === 'get_channels_and_key') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        const now = Date.now();

        // 캐시 확인 (5분 이내)
        if (channelsAndKeyCache && now - channelsAndKeyCacheTimestamp < CHANNELS_CACHE_TTL) {
          Logger.debug(`[get_channels_and_key] 캐시된 데이터 반환 - userId: ${userId}`);
          return channelsAndKeyCache;
        }

        Logger.info(`[get_channels_and_key] 새로운 데이터 조회 - userId: ${userId}`);
        const [storage, channelsSnap] = await Promise.all([
          chrome.storage.local.get(['youtubeApiKey', 'geminiApiKey']),
          get(ref(getDb(), `channels/${userId}`)),
        ]);

        // channelsSnap은 { val: () => data, exists: () => boolean } 형태
        const channelsData = channelsSnap?.val() || {};
        const blogsCount = channelsData.myChannels?.blogs?.length || 0;
        const youtubesCount = channelsData.myChannels?.youtubes?.length || 0;
        Logger.info(
          `[get_channels_and_key] 채널 데이터 로드 완료 - blogs: ${blogsCount}, youtubes: ${youtubesCount}`
        );

        const responseData = {
          success: true,
          data: {
            youtubeApiKey: storage.youtubeApiKey || '',
            geminiApiKey: storage.geminiApiKey || '',
            ...channelsData,
          },
        };

        // 캐시에 저장
        channelsAndKeyCache = responseData;
        channelsAndKeyCacheTimestamp = now;

        // 콜백이 실행되지 않는 경우를 대비하여 content script에 메시지 전송
        if (sender.tab?.id) {
          chrome.tabs
            .sendMessage(sender.tab.id, {
              action: 'channels_data_updated',
              data: responseData.data,
            })
            .catch((err) => {
              // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
              // 조용히 무시
            });
        }

        return responseData;
      })()
    );
  }

  if (msg.action === 'get_my_channels') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        const snap = await get(ref(getDb(), `channels/${userId}`));
        const channels = snap?.val() || {};
        return {
          success: true,
          channels: channels.myChannels || { blogs: [], youtubes: [] },
        };
      })()
    );
  }

  if (msg.action === 'save_channels_and_key') {
    return handleAsync(
      (async () => {
        const { youtubeApiKey, geminiApiKey, channels, myChannels } = msg.data;
        // myChannels가 있으면 channels로 변환 (하위 호환성)
        const channelsData = channels || (myChannels ? { myChannels } : null);
        await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
        const userId = await getCurrentUserId();

        // [핵심 수정] 빈 목록도 명확한 데이터로 인식하도록 강제
        // Firebase에서 빈 배열([])은 null로 저장될 수 있으므로, 명시적으로 빈 배열을 유지
        const safeChannels = channelsData || {
          myChannels: { blogs: [], youtubes: [] },
        };
        if (safeChannels.myChannels) {
          if (!safeChannels.myChannels.blogs) safeChannels.myChannels.blogs = [];
          if (!safeChannels.myChannels.youtubes) safeChannels.myChannels.youtubes = [];
        }

        // set()으로 덮어쓰기하여 빈 배열도 확실하게 저장
        await set(ref(getDb(), `channels/${userId}`), safeChannels);

        // [캐시 무효화] 채널 데이터 변경 시 캐시 초기화
        channelsAndKeyCache = null;
        channelsAndKeyCacheTimestamp = 0;
        Logger.debug(`[save_channels_and_key] 캐시 무효화 완료`);

        // 데이터 수집 트리거
        await fetchAllChannelData();
        return { success: true, message: '채널 정보가 저장되었습니다.' };
      })()
    );
  }

  // === [Idea Management] 아이디어 관리 ===
  if (msg.action === 'get_idea_data') {
    return handleAsync(
      (async () => {
        const { ideaId } = msg;
        const snap = await get(ref(getDb(), `kanban/${CONSTANTS.USER_ID}`));
        const allCards = snap?.val() || {};
        for (const status in allCards) {
          if (allCards[status][ideaId]) {
            return { success: true, data: allCards[status][ideaId], status };
          }
        }
        return { success: false, error: '아이디어를 찾을 수 없습니다.' };
      })()
    );
  }

  if (msg.action === 'get_kanban_card_status') {
    return handleAsync(
      (async () => {
        const { cardId } = msg;
        const snap = await get(ref(getDb(), `kanban/${CONSTANTS.USER_ID}`));
        const allCards = snap?.val() || {};
        for (const status in allCards) {
          if (allCards[status][cardId]) {
            return { success: true, status, data: allCards[status][cardId] };
          }
        }
        return { success: false, error: '카드를 찾을 수 없습니다.' };
      })()
    );
  }

  if (msg.action === 'save_idea_draft') {
    const { ideaId, draft } = msg;
    return handleAsync(
      (async () => {
        // 빈 내용 필터링 (초안 삭제 후 재생성 방지)
        const content = draft || '';
        const trimmedContent = content.trim();
        if (
          !trimmedContent ||
          trimmedContent === '<p><br></p>' ||
          trimmedContent === '<p></p>' ||
          trimmedContent === '<br>'
        ) {
          Logger.debug(`[save_idea_draft] 빈 내용 저장 차단 - ideaId: ${ideaId}`);
          return {
            success: true,
            skipped: true,
            message: '빈 내용은 저장하지 않습니다.',
          };
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
          return { success: false, error: '아이디어를 찾을 수 없습니다.' };
        }

        // 초안 저장 및 자동 이동: 'ideas' 컬럼에 있으면 'in-progress'로 이동
        if (foundStatus === 'ideas') {
          Logger.debug(
            `[save_idea_draft] 초안 저장 및 자동 이동 - ideaId: ${ideaId} (ideas → in-progress)`
          );

          // 카드 데이터에 초안 추가
          const updatedCardData = {
            ...cardData,
            draftContent: draft,
            workspace: {
              ...(cardData.workspace || {}),
              draft: draft,
            },
            updatedAt: serverTimestamp(),
          };

          // 'in-progress' 컬럼에 저장
          const newPath = `kanban/${userId}/in-progress/${ideaId}`;
          await set(ref(getDb(), newPath), cleanDataForFirebase(updatedCardData));

          // 원래 위치에서 삭제
          const oldPath = `kanban/${userId}/ideas/${ideaId}`;
          await remove(ref(getDb(), oldPath));

          Logger.biz(
            `✅ [save_idea_draft] 초안 저장 및 자동 이동 완료 - ideaId: ${ideaId} (ideas → in-progress)`
          );

          // UI 갱신 메시지 전송
          try {
            const kanbanRef = ref(getDb(), `kanban/${userId}`);
            const kanbanSnap = await get(kanbanRef);
            const kanbanData = kanbanSnap?.val() || {};

            chrome.runtime
              .sendMessage({
                action: 'kanban_data_updated',
                data: kanbanData,
              })
              .catch((err) => {
                if (
                  err?.message &&
                  !err.message.includes('message port closed') &&
                  !err.message.includes('Could not establish connection')
                ) {
                  Logger.debug(`[save_idea_draft] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
                }
              });

            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (
                  tab.id &&
                  tab.url &&
                  !tab.url.startsWith('chrome://') &&
                  !tab.url.startsWith('edge://') &&
                  !tab.url.startsWith('about:')
                ) {
                  chrome.tabs
                    .sendMessage(tab.id, {
                      action: 'kanban_data_updated',
                      data: kanbanData,
                    })
                    .catch((err) => {
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
              draft: draft,
            },
            updatedAt: serverTimestamp(),
          });
          Logger.debug(
            `[save_idea_draft] 초안 저장 완료 - ideaId: ${ideaId}, status: ${foundStatus}`
          );

          // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
          kanbanDataCache = null;
          kanbanDataCacheTimestamp = 0;
          Logger.debug(`[save_idea_draft] 캐시 무효화 완료`);

          return { success: true, moved: false, newStatus: foundStatus };
        }
      })()
    );
  }

  // === [Scrap Management] 스크랩 관리 ===
  if (msg.action === 'scrap_element' && msg.data) {
    return handleAsync(
      (async () => {
        const { data } = msg;
        const channelId = msg.channelId !== undefined ? msg.channelId : null;
        return await saveScrapElement(data, channelId);
      })()
    );
  }

  if (msg.action === 'get_canvas_images') {
    return handleAsync(
      (async () => {
        // TODO: 캔버스 이미지 가져오기 로직
        return { success: true, images: [] };
      })()
    );
  }

  // [추가/확인] 이미지 삭제 핸들러
  if (msg.action === 'remove_scrap_image') {
    console.log('[Background] 이미지 삭제 요청 수신:', msg.data);
    const { scrapId, imageUrl } = msg.data || {};

    removeScrapImage(scrapId, imageUrl)
      .then((result) => {
        console.log('[Background] 삭제 처리 결과:', result);
        // Notify other extension contexts so UIs can refresh immediately
        try {
          // only broadcast when DB was actually updated
          if (result && result.success && result.changed) {
            try {
              if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                chrome.runtime
                  .sendMessage({ action: 'scrap_image_removed', data: { scrapId, imageUrl } })
                  .catch(() => {});
              }
            } catch (e) {
              console.warn('[Background] 브로드캐스트 실패:', e.message);
            }
          }
        } catch (e) {
          console.warn('[Background] 브로드캐스트 실패:', e.message);
        }
        sendResponse(result);
      })
      .catch((error) => {
        console.error('[Background] 삭제 처리 중 오류:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // 비동기 응답 필수
  }
  if (msg.action === 'delete_scrap') {
    return handleAsync(
      (async () => {
        const scrapId = msg.id;
        return await deleteScrap(scrapId);
      })()
    );
  }

  if (msg.action === 'toggle_scrap_sharing') {
    return handleAsync(
      (async () => {
        const { scrapId, currentChannelId } = msg;

        if (!scrapId) {
          return { success: false, error: '스크랩 ID가 필요합니다.' };
        }

        const userId = await getCurrentUserId();
        const scrapRef = ref(getDb(), `scraps/${userId}/${scrapId}`);
        const scrapSnap = await get(scrapRef);
        const scrapData = scrapSnap?.val();

        if (!scrapData) {
          return { success: false, error: '스크랩을 찾을 수 없습니다.' };
        }
        const currentChannelIdValue = scrapData.channelId;
        const isCurrentlyPublic =
          currentChannelIdValue === null || currentChannelIdValue === undefined;

        // 토글: null/undefined(공용) ↔ currentChannelId(전용)
        const newChannelId = isCurrentlyPublic ? currentChannelId : null;

        // currentChannelId가 없으면 전용으로 변경할 수 없음
        if (isCurrentlyPublic && !currentChannelId) {
          return {
            success: false,
            error: '활성 채널이 선택되지 않아 전용으로 변경할 수 없습니다.',
          };
        }

        // 업데이트
        await update(scrapRef, { channelId: newChannelId });

        return {
          success: true,
          newChannelId,
          message:
            newChannelId === null
              ? '공용 스크랩으로 변경되었습니다.'
              : '전용 스크랩으로 변경되었습니다.',
        };
      })()
    );
  }

  if (msg.action === 'get_unified_gallery') {
    return handleAsync(
      (async () => {
        const filter = msg.filter || msg.data?.filter || 'ALL';
        const images = await getUnifiedGalleryImages(filter);
        return { success: true, images };
      })()
    );
  }

  if (msg.action === 'link_scrap_to_idea') {
    return handleAsync(
      (async () => {
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
            linkedScraps.forEach((id) => {
              linkedScrapsObj[id] = true;
            });

            // workspace.linkedScraps 업데이트
            const workspace = idea.workspace || {};
            await update(ref(getDb(), `kanban/${userId}/${status}/${ideaId}`), {
              linkedScraps: linkedScrapsObj,
              workspace: {
                ...workspace,
                linkedScraps: linkedScrapsObj,
              },
            });
          }
        }

        // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
        kanbanDataCache = null;
        kanbanDataCacheTimestamp = 0;
        Logger.debug(`[link_scrap_to_idea] 캐시 무효화 완료`);

        return { success: true };
      })()
    );
  }

  if (msg.action === 'unlink_scrap_from_idea') {
    return handleAsync(
      (async () => {
        const { ideaId, scrapId, status } = msg.data || msg;
        if (!ideaId || !scrapId || !status) {
          return { success: false, error: 'ID 또는 상태가 유효하지 않습니다.' };
        }

        const userId = await getCurrentUserId();
        const cardPath = `kanban/${userId}/${status}/${ideaId}`;
        const cardSnap = await get(ref(getDb(), cardPath));
        const cardData = cardSnap?.val();

        if (!cardData) {
          return { success: false, error: '카드를 찾을 수 없습니다.' };
        }

        // linkedScraps 업데이트 (루트 레벨) - 배열과 객체 모두 처리
        let linkedScraps = cardData.linkedScraps || {};
        if (Array.isArray(linkedScraps)) {
          linkedScraps = linkedScraps.filter((id) => id !== scrapId);
          // 배열을 객체로 변환
          const linkedScrapsObj = {};
          linkedScraps.forEach((id) => {
            linkedScrapsObj[id] = true;
          });
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
          workspaceLinkedScraps = workspaceLinkedScraps.filter((id) => id !== scrapId);
          // 배열을 객체로 변환
          const workspaceLinkedScrapsObj = {};
          workspaceLinkedScraps.forEach((id) => {
            workspaceLinkedScrapsObj[id] = true;
          });
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
            linkedScraps: workspaceLinkedScraps,
          },
        };

        await update(ref(getDb(), cardPath), cleanDataForFirebase(updates));

        Logger.biz(
          `✅ [unlink_scrap_from_idea] 스크랩 연결 해제 완료 - ideaId: ${ideaId}, scrapId: ${scrapId}`
        );

        // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
        kanbanDataCache = null;
        kanbanDataCacheTimestamp = 0;
        Logger.debug(`[unlink_scrap_from_idea] 캐시 무효화 완료`);

        return { success: true };
      })()
    );
  }

  if (msg.action === 'add_image_to_scrap') {
    return handleAsync(
      (async () => {
        const { scrapId, imageUrl } = msg.data || msg;
        if (!scrapId || !imageUrl) {
          return { success: false, error: '스크랩 ID 또는 이미지 URL이 유효하지 않습니다.' };
        }

        const userId = await getCurrentUserId();
        const scrapPath = `scraps/${userId}/${scrapId}`;
        const scrapSnap = await get(ref(getDb(), scrapPath));
        const scrapData = scrapSnap?.val();

        if (!scrapData) {
          return { success: false, error: '스크랩을 찾을 수 없습니다.' };
        }

        // allImages 배열에 이미지 추가 (중복 방지)
        let allImages = scrapData.allImages || [];
        if (!Array.isArray(allImages)) {
          allImages = [];
        }
        
        // 중복 체크 - 정규화된 URL로 비교
        const normalizedNewUrl = normalizeUrlForDeletion(imageUrl);
        const isDuplicate = allImages.some(
          (existingUrl) => normalizeUrlForDeletion(existingUrl) === normalizedNewUrl
        );

        if (!isDuplicate) {
          allImages.push(imageUrl);

          // image 필드가 비어있으면 첫 번째 이미지로 설정
          const updates = {
            allImages: allImages,
          };
          
          if (!scrapData.image) {
            updates.image = imageUrl;
          }

          await update(ref(getDb(), scrapPath), cleanDataForFirebase(updates));

          Logger.biz(
            `✅ [add_image_to_scrap] 스크랩에 이미지 추가 완료 - scrapId: ${scrapId}, imageUrl: ${imageUrl}`
          );

          return { success: true, allImages: allImages };
        } else {
          Logger.debug(`[add_image_to_scrap] 이미 존재하는 이미지 - scrapId: ${scrapId}`);
          return { success: true, allImages: allImages, duplicate: true };
        }
      })()
    );
  }

  // === [AI Analysis] AI 분석 ===
  if (msg.action === 'generate_blog_ideas') {
    return handleAsync(
      (async () => {
        // TODO: 블로그 아이디어 생성 로직
        return { success: true, analysis: '', ideas: '', keywordGap: null };
      })()
    );
  }

  // === [Migration & System Fix] 데이터 마이그레이션 및 시스템 수정 ===
  // Migration message handlers removed: migration flow has been deleted

  if (msg.action === 'fix_active_channel_mismatch') {
    return handleAsync(
      (async () => {
        try {
          const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
          if (!activeChannelId) {
            throw new Error('활성 채널이 설정되지 않았습니다.');
          }

          const userId = await getCurrentUserId();
          const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
          const channelsData = channelsSnap?.val() || {};
          const myChannels = channelsData.myChannels || {
            blogs: [],
            youtubes: [],
          };
          const allChannels = [...(myChannels.blogs || []), ...(myChannels.youtubes || [])];

          const channelExists = allChannels.some((ch) => {
            if (ch.id && ch.id === activeChannelId) return true;
            if (ch.channelId && ch.channelId === activeChannelId) return true;
            if (ch.apiUrl) {
              const generatedId = btoa(ch.apiUrl).replace(/=/g, '');
              if (generatedId === activeChannelId) return true;
            }
            return false;
          });

          if (channelExists) {
            return { success: true, message: '활성 채널이 정상입니다.' };
          }

          // 활성 채널이 목록에 없으면 첫 번째 채널로 변경
          if (allChannels.length > 0) {
            const firstChannel = allChannels[0];
            const newActiveChannelId =
              firstChannel.id ||
              (firstChannel.apiUrl ? btoa(firstChannel.apiUrl).replace(/=/g, '') : null);

            if (newActiveChannelId) {
              await chrome.storage.local.set({
                activeChannelId: newActiveChannelId,
              });
              return {
                success: true,
                message: `활성 채널을 첫 번째 채널로 변경했습니다. (${newActiveChannelId})`,
              };
            } else {
              throw new Error('채널 ID를 생성할 수 없습니다.');
            }
          } else {
            await chrome.storage.local.remove('activeChannelId');
            return {
              success: true,
              message: '등록된 채널이 없어 활성 채널을 제거했습니다.',
            };
          }
        } catch (error) {
          Logger.error('[활성 채널 수정] 오류:', error);
          throw error;
        }
      })()
    );
  }

  if (msg.action === 'fix_channel_structure') {
    return handleAsync(
      (async () => {
        try {
          const userId = await getCurrentUserId();
          const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
          const channelsData = channelsSnap?.val() || {};

          let fixedCount = 0;
          const updates = {};

          // 1. 구버전 전역 competitorChannels를 내 채널의 competitors로 마이그레이션
          if (channelsData.competitorChannels) {
            const oldCompetitors = [
              ...(channelsData.competitorChannels.blogs || []),
              ...(channelsData.competitorChannels.youtubes || []),
            ];

            if (oldCompetitors.length > 0) {
              const myBlogs = channelsData.myChannels?.blogs || [];

              if (myBlogs.length > 0) {
                const firstBlog = myBlogs[0];
                const firstBlogIndex = myBlogs.findIndex(
                  (b) =>
                    (b.id || (b.apiUrl ? btoa(b.apiUrl).replace(/=/g, '') : null)) ===
                    (firstBlog.id ||
                      (firstBlog.apiUrl ? btoa(firstBlog.apiUrl).replace(/=/g, '') : null))
                );

                if (firstBlogIndex >= 0) {
                  const existingCompetitors = firstBlog.competitors || [];
                  const newCompetitors = oldCompetitors.map((comp) => ({
                    inputUrl: comp.inputUrl || comp.url || comp.apiUrl || '',
                    apiUrl: comp.apiUrl || comp.inputUrl || comp.url || '',
                  }));

                  // 중복 제거
                  const mergedCompetitors = [...existingCompetitors];
                  newCompetitors.forEach((newComp) => {
                    const exists = mergedCompetitors.some(
                      (existing) =>
                        existing.inputUrl === newComp.inputUrl || existing.apiUrl === newComp.apiUrl
                    );
                    if (!exists) mergedCompetitors.push(newComp);
                  });

                  updates[`channels/${userId}/myChannels/blogs/${firstBlogIndex}/competitors`] =
                    mergedCompetitors;
                  fixedCount++;
                }
              }

              // 전역 competitorChannels 제거
              updates[`channels/${userId}/competitorChannels`] = null;
            }
          }

          // 2. competitors 배열이 없는 채널에 빈 배열 추가
          const myBlogs = channelsData.myChannels?.blogs || [];
          myBlogs.forEach((blog, index) => {
            if (!blog.competitors || !Array.isArray(blog.competitors)) {
              updates[`channels/${userId}/myChannels/blogs/${index}/competitors`] = [];
              fixedCount++;
            }
          });

          // 업데이트 실행
          if (Object.keys(updates).length > 0) {
            await Promise.all(
              Object.entries(updates).map(([path, value]) => {
                if (value === null) {
                  return remove(ref(getDb(), path));
                } else {
                  return set(ref(getDb(), path), value);
                }
              })
            );

            return {
              success: true,
              message: `채널 데이터 구조가 수정되었습니다. (${fixedCount}개 항목 처리)`,
            };
          } else {
            return {
              success: true,
              message: '수정할 항목이 없습니다. 구조가 이미 정상입니다.',
            };
          }
        } catch (error) {
          Logger.error('[채널 구조 수정] 오류:', error);
          throw error;
        }
      })()
    );
  }

  // === [Draft Management] 초안 관리 ===
  if (msg.action === 'save_draft_content') {
    return handleAsync(
      (async () => {
        const { ideaId, status, draft } = msg.data;
        if (!ideaId || !status) {
          throw new Error('Idea ID or status is missing.');
        }

        const userId = await getCurrentUserId();
        const currentRef = ref(getDb(), `kanban/${userId}/${status}/${ideaId}`);
        const newStatus = 'in-progress';

        const cardSnap = await get(currentRef);
        const cardData = cardSnap?.val();
        if (!cardData) {
          throw new Error('Card data not found for move.');
        }

        const updates = { draftContent: draft };

        // 'ideas' 컬럼에 있을 때만 이동
        if (status === 'ideas') {
          const newRef = ref(getDb(), `kanban/${userId}/${newStatus}/${ideaId}`);
          const dataToMove = { ...cardData, ...updates };
          await set(newRef, dataToMove);
          await remove(currentRef);
          return {
            success: true,
            moved: true,
            newStatus: newStatus,
          };
        } else {
          await update(currentRef, updates);
          return {
            success: true,
            moved: false,
            newStatus: status,
          };
        }
      })()
    );
  }

  if (msg.action === 'delete_draft_content') {
    return handleAsync(
      (async () => {
        const cardId = msg.data?.cardId;
        if (!cardId) {
          throw new Error('Card ID is missing.');
        }

        try {
          const userId = await getCurrentUserId();
          const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
          const allCards = kanbanSnap?.val() || {};

          let foundStatus = null;
          for (const status in allCards) {
            if (allCards[status] && allCards[status][cardId]) {
              foundStatus = status;
              break;
            }
          }

          if (!foundStatus) {
            throw new Error('Card not found.');
          }

          // draftContent를 null로 업데이트
          await update(ref(getDb(), `kanban/${userId}/${foundStatus}/${cardId}`), {
            draftContent: null,
          });
          return { success: true };
        } catch (error) {
          Logger.error('Error deleting draft content:', error);
          throw error;
        }
      })()
    );
  }

  // === [Scrap Management] 스크랩 관리 ===
  if (msg.action === 'get_scrap_detail') {
    return handleAsync(
      (async () => {
        const { scrapId, channelId } = msg;
        return await getScrapDetail(scrapId, channelId);
      })()
    );
  }

  if (msg.action === 'scrap_entire_analysis') {
    return handleAsync(
      (async () => {
        const analysisContent = msg.data;
        return await saveEntireAnalysis(analysisContent);
      })()
    );
  }

  // === [Keyword Management] 키워드 관리 ===
  if (msg.action === 'regenerate_search_keywords') {
    return handleAsync(generateAndSendKeywords(msg.data, sender));
  }

  // === [Content Management] 콘텐츠 관리 ===
  if (msg.action === 'clear_blog_content') {
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();
        await remove(ref(getDb(), `channel_content/${userId}/blogs`));
        return {
          success: true,
          message: '블로그 콘텐츠 데이터가 성공적으로 삭제되었습니다. 새로고침 후 재수집해주세요.',
        };
      })()
    );
  }

  // === [Kanban Management] 칸반 관리 ===
  if (msg.action === 'remove_idea_from_kanban') {
    return handleAsync(
      (async () => {
        const firebaseKey = msg.key;
        const status = msg.status || 'ideas';
        return await removeIdeaFromKanban(firebaseKey, status);
      })()
    );
  }

  // === [Template Management] 템플릿 관리 ===
  if (msg.action === 'get_thumbnail_templates') {
    return handleAsync(
      (async () => {
        return await getThumbnailTemplates();
      })()
    );
  }

  if (msg.action === 'delete_template') {
    return handleAsync(
      (async () => {
        const templateId = msg.templateId;
        return await deleteTemplate(templateId);
      })()
    );
  }

  // === [Thumbnail Generation] 썸네일 생성 ===
  if (msg.action === 'gemini_generate_thumbnail_texts') {
    return handleAsync(
      (async () => {
        if (!Array.isArray(msg.data?.outlines)) {
          throw new Error('outlines 배열이 필요합니다.');
        }

        const outlines = msg.data.outlines;
        const draft = msg.data.draft || '';
        return await generateThumbnailTexts(outlines, draft);
      })()
    );
  }

  // === [Alarm Management] 알람 관리 ===
  if (msg.action === 'register_alarms') {
    return handleAsync(
      (async () => {
        try {
          // 기존 알람 제거
          await chrome.alarms.clearAll();

          // 알람 재등록
          chrome.alarms.create('fetch-channels', {
            delayInMinutes: 1,
            periodInMinutes: 240,
          });
          chrome.alarms.create('update-performance-metrics', {
            delayInMinutes: 5,
            periodInMinutes: 360,
          });

          // 등록 확인
          const alarms = await chrome.alarms.getAll();
          const hasFetch = alarms.some((a) => a.name === 'fetch-channels');
          const hasUpdate = alarms.some((a) => a.name === 'update-performance-metrics');

          if (hasFetch && hasUpdate) {
            return {
              success: true,
              message:
                '알람이 성공적으로 재등록되었습니다. (fetch-channels, update-performance-metrics)',
            };
          } else {
            throw new Error(
              `일부 알람 등록 실패 (fetch: ${
                hasFetch ? '성공' : '실패'
              }, update: ${hasUpdate ? '성공' : '실패'})`
            );
          }
        } catch (error) {
          Logger.error('[알람 재등록] 오류:', error);
          throw error;
        }
      })()
    );
  }

  // === [Auth] 토큰 요청 ===
  if (msg.action === 'getValidToken') {
    return handleAsync(
      (async () => {
        const token = await getValidToken(false);
        return { success: true, token };
      })()
    );
  }

  // === [AdSense Management] AdSense 관리 ===
  if (msg.action === 'get_adsense_accounts') {
    return handleAsync(
      (async () => {
        const { googleAuthToken } = await chrome.storage.local.get(['googleAuthToken']);

        if (!googleAuthToken) {
          throw new Error('Google 계정이 연동되지 않았습니다.');
        }

        const accountsListUrl = 'https://adsense.googleapis.com/v2/accounts';
        const accountsListResponse = await fetch(accountsListUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${googleAuthToken}`,
          },
        });

        if (accountsListResponse.ok) {
          const accountsData = await accountsListResponse.json();
          return {
            success: true,
            accounts: accountsData.accounts || [],
          };
        } else {
          const errorData = await accountsListResponse.json().catch(() => ({}));
          throw new Error(
            errorData.error?.message || `계정 목록 조회 실패 (${accountsListResponse.status})`
          );
        }
      })()
    );
  }

  // 알 수 없는 액션
  Logger.warn(`[Router] 알 수 없는 액션: ${msg.action}`);
  sendResponse({ success: false, error: `Unknown action: ${msg.action}` });
  return false;
});

// === [Migration Function] 데이터 마이그레이션 함수 ===
// migrationService.js로 이동됨 - import로 사용
