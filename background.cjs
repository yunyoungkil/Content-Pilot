// background.js (Final Router Version)

// Firebase 초기화 (가장 먼저 실행)
try {
  const { initializeFirebase } = require('./js/services/firebaseService.js');
  initializeFirebase();
  const { Logger } = require('./js/utils.js');
  Logger.info('[Background] Firebase 초기화 완료');
} catch (error) {
  const { Logger } = require('./js/utils.js');
  Logger.error('[Background] Firebase 초기화 실패:', error);
}

// 오프스크린 문서 미리 생성 (성능 향상 및 안정성 확보)
(async () => {
  try {
    const { ensureOffscreenDocument } = require('./js/services/offscreenService.js');
    await ensureOffscreenDocument();
    const { Logger } = require('./js/utils.js');
    Logger.info('[Background] 오프스크린 문서 미리 생성 완료');
  } catch (error) {
    const { Logger } = require('./js/utils.js');
    Logger.warn(
      '[Background] 오프스크린 문서 미리 생성 실패 (정상 동작에 영향 없음):',
      error.message
    );
  }
})();

// 확장 프로그램 아이콘 클릭 시 Content Pilot 활성화
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

    const { Logger } = require('./js/utils.js');
    Logger.info('[Background] Content Pilot activated via icon click');
  } catch (error) {
    const { Logger } = require('./js/utils.js');
    Logger.error('[Background] Failed to activate Content Pilot:', error);
  }
});

const {
  getDb,
  CONSTANTS,
  initializeFirebase,
  uploadImageToFirebaseStorage,
  cleanDataForFirebase,
  getCurrentUserId,
  getUnifiedGalleryImages,
  deleteImageFromStorage,
  getUploadedImagesLog,
} = require('./js/services/firebaseService.js');
const { Logger } = require('./js/utils.js');
// [추가] 상수 임포트
const { COLLECTIONS, KANBAN_STATUS } = require('./js/constants.js');

const {
  updateAllPerformanceMetrics,
  updateSinglePerformanceMetric,
  checkAdSenseRegistrationStatus,
  runFullSystemDiagnosis,
} = require('./js/services/analyticsService.js');

const {
  fetchAllChannelData,
  fetchAndSaveSinglePost,
  deleteChannelData,
  checkDuplicateUrl,
  summarizeText,
  refreshChannelData,
  fetchImageAsBase64,
  updateUrlIndex,
  normalizeUrlForComparison,
  encodeUrlForFirebaseKey,
} = require('./js/services/collectorService.js');

const {
  deleteCompetitorData,
  deleteChannelDataCascade,
  findDeletedCompetitors,
} = require('./js/services/cascadeDeleteService.js');

const {
  generateDraftFromIdea,
  generateIdeaBriefing,
  generateAiImage,
  analyzeImageForTemplate,
  callGeminiAPI,
  analyzeMyChannel,
  generateContentIdeas,
  generateAndSendKeywords,
  analyzeVideoComments,
} = require('./js/services/aiService.js');

const {
  startGoogleAuth,
  revokeGoogleAuth,
  getValidToken,
  restoreAuthSession,
} = require('./js/services/authService.js');

// migrationService removed - migration features disabled/removed

const {
  validateTemplateData,
  getThumbnailTemplates,
  deleteTemplate,
  generateThumbnailTexts,
} = require('./js/services/thumbnailService.js');

const {
  createAndSaveNewIdea,
  addIdeaToKanban,
  removeIdeaFromKanban,
  deleteKanbanCard,
} = require('./js/services/kanbanService.js');

const {
  saveScrapElement,
  getFirebaseScraps,
  getScrapDetail,
  saveEntireAnalysis,
  deleteScrap,
  removeScrapImage, // 👈 추가!
  toggleScrapSharing,
} = require('./js/services/scrapService.js');

// Migration service
const { runDataMigration, checkMigrationNeeded } = require('./js/services/migrationService.js');

const {
  sanitizeHtmlInOffscreen,
  resizeImageInOffscreen,
  renderTemplateInOffscreen,
  parseHtmlInOffscreen,
} = require('./js/services/offscreenService.js');

// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
// import { ref, update, remove, set, get, push, serverTimestamp, onValue } from 'firebase/database';
const {
  ref,
  update,
  remove,
  set,
  get,
  push,
  serverTimestamp,
  onValue,
} = require('./js/services/firebaseService.js');

// Firebase 초기화
initializeFirebase();

// [추가] URL 정규화 함수 (스마트 매칭용)
function normalizeUrlForDeletion(url) {
  if (!url) return '';
  try {
    let cleanUrl = url.replace(/&amp;/g, '&');
    const u = new URL(cleanUrl);
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(u.pathname);
    } catch (e) {
      decodedPath = u.pathname;
    }
    return (u.hostname + decodedPath).replace(/\/$/, '').trim();
  } catch (e) {
    return url.trim();
  }
}

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
  // Offscreen 관련 메시지(ready / beacon / responses)는 라우터에서 제외
  // (OffscreenService 내부 Promise가 처리하거나 별도 경로로 처리됨).
  if (
    msg.action &&
    (msg.action.startsWith('offscreen_') || msg.action.endsWith('_in_offscreen_response'))
  ) {
    return false; // 다른 리스너가 처리하도록 함 / 라우터 경고 제거
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
    sendResponse({ success: true, message: 'pong' });
    return true;
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

  // 채널 데이터 마이그레이션 요청
  if (msg.action === 'migrate_channel') {
    return handleAsync(
      (async () => {
        try {
          const { channelId, targetPlatform, dryRun } = msg;
          const userId = await getCurrentUserId();
          if (userId === CONSTANTS.USER_ID) {
            return { success: false, error: '로그인이 필요합니다.' };
          }

          // 현재 마이그레이션은 migrationService에서 처리
          const result = await runDataMigration(userId, channelId, {
            dryRun: !!dryRun,
            targetPlatform: targetPlatform || null,
            ...(msg.options || {}),
          });

          // runDataMigration 기본 구현은 비활성화 상태 메시지를 반환
          if (!result.success) {
            return { success: false, error: result.message || result.error || '마이그레이션 실패' };
          }
          return {
            success: true,
            message: result.message,
            dryRunResult: result.dryRunResult,
            updatedCount: result.updatedCount,
          };
        } catch (err) {
          Logger.error('[Background] migrate_channel 오류:', err);
          return { success: false, error: err.message || '알 수 없는 오류 발생' };
        }
      })()
    );
  }
  if (msg.action === 'fetch_image_as_base64') {
    return handleAsync(
      (async () => {
        try {
          // 네이버 이미지 특별 처리
          if (
            msg.url.includes('postfiles.pstatic.net') ||
            msg.url.includes('blogfiles.naver.net')
          ) {
            const response = await fetch(msg.url, {
              method: 'GET',
              headers: {
                Referer: 'https://blog.naver.com/',
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
              credentials: 'omit',
              cache: 'no-cache',
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
            const mimeType = blob.type || 'image/jpeg';
            return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
          }

          // 일반 이미지 처리
          return await fetchImageAsBase64(msg.url);
        } catch (error) {
          Logger.warn('[Background] fetch_image_as_base64 실패:', error.message);
          return { success: false, error: error.message };
        }
      })()
    );
  }

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
    const resultPromise = generateDraftFromIdea(msg.data, opts);
    resultPromise
      .then((result) => {
        console.debug('[DIAG background generate_draft_from_idea] AI response:', {
          success: result?.success,
          hasSeoTitle: !!result?.seoTitle,
          seoTitle: result?.seoTitle,
          hasDraft: !!result?.draft,
        });
      })
      .catch(() => {});
    return handleAsync(resultPromise);
  }
  if (msg.action === 'generate_idea_briefing') {
    // Support callers that send payload either top-level or under `data`. Normalize options so both
    // top-level flags and nested `options` are accepted.
    const payload = msg.data || msg || {};
    const { cardId, title, description, ...rest } = payload;
    const normalizedOptions = {
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
    normalizedOptions.onProgress = (p) => {
      if (sender.tab?.id) {
        chrome.tabs
          .sendMessage(sender.tab.id, {
            action: 'briefing_progress',
            cardId,
            progress: p,
          })
          .catch((err) => {
            // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
            if (
              err?.message &&
              !err.message.includes('message port closed') &&
              !err.message.includes('Could not establish connection')
            ) {
              Logger.debug('[sendMessage] briefing_progress 전송 실패:', err.message);
            }
          });
      }
    };
    return handleAsync(
      generateIdeaBriefing(cardId, title, description, normalizedOptions)
        .then((res) => {
          if (res && res.success === false) {
            return { success: false, error: res.error || 'Unknown error from AI service' };
          }
          return { success: true };
        })
        .catch((error) => ({ success: false, error: error?.message || String(error) }))
    );
  }
  if (msg.action === 'ai_generate_images') {
    return handleAsync(
      (async () => {
        console.error('[Background] ai_generate_images HANDLER START');
        console.error('[Background] Payload:', JSON.stringify(msg.data, null, 2));

        const prompt = msg.data.prompt;
        const count = msg.data.count || 1;
        // references: optional array of URLs
        let refImages = null;
        let inputUrls = [];
        let successEntries = [];
        let failedUrls = [];

        try {
          if (Array.isArray(msg.data.references) && msg.data.references.length > 0) {
            inputUrls = msg.data.references;
            console.error('[Background] Processing references:', inputUrls.length);

            // fetch each reference asynchronously as base64 objects
            const fetchPromises = msg.data.references.map((url) => fetchImageAsBase64(url).catch((err) => ({ success: false, error: err.message })));
            const fetchedRaw = await Promise.all(fetchPromises);

            // [DEBUG] Log raw fetch results
            try {
              const debugResults = fetchedRaw.map((r, i) => ({
                url: inputUrls[i],
                success: !!(r && r.success),
                dataUrlLen: r && r.dataUrl ? r.dataUrl.length : 0,
                error: r && r.error ? r.error : (r && !r.success ? 'Unknown failure' : null)
              }));
              console.error('[Background] Reference fetch results:', JSON.stringify(debugResults, null, 2));
            } catch (e) { void 0; }

            // [FIX] collectorService.js returns { success: true, dataUrl: ... }, but we need { mimeType, data }
            const fetchedConverted = fetchedRaw.map((item, idx) => {
                if (!item || !item.success || !item.dataUrl) {
                    return null;
                }
                // Relaxed regex to handle empty mimeType or whitespace
                const matches = item.dataUrl.match(/^data:(.*?);base64,(.*)$/);
                if (matches) {
                    return { mimeType: matches[1] || 'image/png', data: matches[2] };
                }
                console.error(`[Background] Regex mismatch for item ${idx}:`, item.dataUrl.substring(0, 50));
                return null;
            });

            refImages = fetchedConverted.filter(Boolean);

            // [DEBUG] 참조 이미지 변환 결과 (스타일 적용)
            console.error('[Background] Reference fetch summary:', {
              inputCount: inputUrls.length,
              successCount: refImages.length,
              failedCount: inputUrls.length - refImages.length,
            });
          } else {
             console.error('[Background] No references provided or empty array');
          }
        } catch (e) {
          console.error('[Background] Reference fetch CRITICAL FAILURE:', e);
        }

        console.error('[Background] Calling generateAiImage with refImages count:', refImages ? refImages.length : 0);
        const images = await generateAiImage(prompt, count, refImages);
        return { 
          success: true, 
          images, 
          diagnostics: { 
            inputCount: inputUrls.length, 
            converted: successEntries.length, 
            failed: failedUrls, 
            convertedSample: successEntries.slice(0,3).map(s => ({ 
              url: s.url, 
              mimeType: s.mimeType, 
              dataPreview: s.dataPreview,
              dataFullUrl: s.dataFullUrl,
              dataKb: Math.round((s.dataLength || 0) / 1024)
            })) 
          } 
        };
      })()
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
        // When running inside the background worker, avoid nested runtime
        // messaging for generate_idea_briefing (that causes port/response races).
        // Ask the kanban service to skip auto-briefing so background can
        // perform briefing directly and reliably.
        const result = await addIdeaToKanban(ideaData, status, channelId, true);

        // [캐시 무효화] 칸반 데이터 변경 시 캐시 초기화
        kanbanDataCache = null;
        kanbanDataCacheTimestamp = 0;
        Logger.debug(`[add_idea_to_kanban] 캐시 무효화 완료`);

        // If the card was added successfully, trigger AI briefing here
        // in the background asynchronously (best-effort) so the request
        // that added the card doesn't block on long LLM calls.
        (async () => {
          try {
            if (result && result.success && result.firebaseKey) {
              const cardId = result.firebaseKey;
              Logger.info(
                '[add_idea_to_kanban] 백그라운드에서 AI 브리핑 생성 시작 - cardId:',
                cardId
              );
              // Extract title/description/origin from ideaData for context
              const title = ideaData?.title || '';
              const description = ideaData?.description || '';
              const options = {
                status,
                generateOutline: true,
                generateKeywords: true,
                generateLongTail: true,
                generateMainKeywords: true,
                originType: ideaData?.origin?.type ?? null,
                origin: ideaData?.origin ?? null,
              };
              const resultBrief = await generateIdeaBriefing(cardId, title, description, options);
              // generateIdeaBriefing returns undefined on success for backward
              // compatibility; treat undefined or {success:true} as success.
              if (resultBrief === undefined || (resultBrief && resultBrief.success)) {
                Logger.biz('[add_idea_to_kanban] AI 브리핑 백그라운드 생성 성공 - cardId:', cardId);
              } else {
                Logger.warn(
                  '[add_idea_to_kanban] AI 브리핑 백그라운드 생성 실패 - cardId:',
                  cardId,
                  resultBrief
                );
              }
            }
          } catch (err) {
            Logger.error(
              '[add_idea_to_kanban] 백그라운드 AI 브리핑 처리 중 예외:',
              err && err.message
            );
          }
        })();

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
              const hasDraftField = verifyData.draftContent !== undefined;
              const hasPublishInfoField = verifyData.publishInfo !== undefined;
              const hasSeoTitleField = verifyData.seoTitle !== undefined;
              const hasWorkspaceDraftField = verifyData.workspace?.draft !== undefined;

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

                const finalHasDraft = finalVerifyData?.draftContent !== undefined;
                const finalHasPublishInfo = finalVerifyData?.publishInfo !== undefined;
                const finalHasSeoTitle = finalVerifyData?.seoTitle !== undefined;
                const finalHasWorkspaceDraft = finalVerifyData?.workspace?.draft !== undefined;

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
        const now = Date.now();

        // 캐시 확인 (30초 이내)
        if (kanbanDataCache && now - kanbanDataCacheTimestamp < KANBAN_CACHE_TTL) {
          Logger.debug(`[get_kanban_data] 캐시된 데이터 반환 - userId: ${userId}`);
          return kanbanDataCache;
        }

        Logger.info(`[get_kanban_data] 새로운 데이터 조회 - userId: ${userId}`);
        const dbRef = ref(getDb(), `${COLLECTIONS.KANBAN}/${userId}`);

        // 실시간 리스너 등록 (한 번만)
        if (!kanbanRealtimeListenerAttached) {
          onValue(dbRef, (snapshot) => {
            const data = snapshot?.val() || {};
            const cardsCount =
              (Object.keys((data && data.ideas) || {}).length || 0) +
              (Object.keys((data && data['in-progress']) || {}).length || 0) +
              (Object.keys((data && data.done) || {}).length || 0);
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
        const cardsCount =
          (Object.keys((data && data.ideas) || {}).length || 0) +
          (Object.keys((data && data['in-progress']) || {}).length || 0) +
          (Object.keys((data && data.done) || {}).length || 0);
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
        // 서버 보호: 기존에 저장된 채널의 platformType이 payload에서 누락되어
        // 의도치 않게 삭제되는 것을 방지하기 위해 기존 DB 데이터를 읽어 병합합니다.
        try {
          const existingSnap = await get(ref(getDb(), `channels/${userId}`));
          const existing = existingSnap?.val() || {};
          const existingBlogs = (existing.myChannels && existing.myChannels.blogs) || [];

          // id 기반 매핑(없으면 apiUrl / url 기반 deterministic id 사용)
          const { mergeBlogsPreservePlatform } = require('./js/services/channelUtils.js');

          if (safeChannels.myChannels && Array.isArray(safeChannels.myChannels.blogs)) {
            safeChannels.myChannels.blogs = mergeBlogsPreservePlatform(existingBlogs, safeChannels.myChannels.blogs);
          }
        } catch (e) {
          Logger.warn('[save_channels_and_key] 기존 채널 병합 중 오류, 그대로 덮어씌움:', e && e.message);
        }

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

  if (msg.action === 'remove_scrap_image') {
    return handleAsync(
      (async () => {
        const { scrapId, imageUrl } = msg.data;
        const result = await removeScrapImage(scrapId, imageUrl);
        // broadcast so other UI contexts can refresh
        try {
          // only broadcast if DB actually changed so other contexts don't react to no-op deletions
          if (result && result.success && result.changed) {
            try {
              if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                chrome.runtime
                  .sendMessage({ action: 'scrap_image_removed', data: { scrapId, imageUrl } })
                  .catch(() => {});
              }
            } catch (e) {
              const { Logger } = require('./js/utils.js');
              Logger.debug('[Background] broadcast sendMessage failed:', e && e.message);
            }
          }
        } catch (e) {
          const { Logger } = require('./js/utils.js');
          Logger.warn('[Background] 브로드캐스트 실패:', e.message);
        }
        return result;
      })()
    );
  }

  if (msg.action === 'get_unified_gallery') {
    return handleAsync(
      (async () => {
        const filter = msg.filter || 'ALL';
        const images = await getUnifiedGalleryImages(filter);
        return { success: true, images };
      })()
    );
  }

  if (msg.action === 'delete_image_from_storage') {
    return handleAsync(
      (async () => {
        const { imageUrl } = msg.data;
        if (!imageUrl) {
          return { success: false, error: '이미지 URL이 필요합니다.' };
        }
        return await deleteImageFromStorage(imageUrl);
      })()
    );
  }

  if (msg.action === 'get_uploaded_images_log') {
    return handleAsync(
      (async () => {
        const images = await getUploadedImagesLog();
        return { success: true, images };
      })()
    );
  }

  if (msg.action === 'delete_storage_image') {
    // Detailed logging for debugging message payloads and sender
    try {
      Logger.info('[delete_storage_image] received request:', {
        action: msg && msg.action,
        data: msg && msg.data,
        sender: sender && (sender.id || (sender.tab && sender.tab.id) || 'unknown'),
      });
    } catch (e) {
      Logger.debug('[delete_storage_image] logging failed:', e && e.message);
    }

    // Synchronous guard: if there's no data payload, respond immediately
    if (!msg || !msg.data) {
      Logger.warn('[delete_storage_image] missing message data');
      sendResponse({ success: false, error: 'missing message data' });
      return false;
    }

    const { id, storagePath } = msg.data || {};

    // Validate basic inputs early
    if (!id) {
      Logger.warn('[delete_storage_image] missing id in request');
      sendResponse({ success: false, error: 'missing id' });
      return false;
    }

    if (!storagePath) {
      Logger.warn('[delete_storage_image] missing storagePath for id:', id);
      sendResponse({ success: false, error: 'missing storagePath' });
      return false;
    }

    // Generate a requestId for follow-up notification
    const requestId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tabId = sender && sender.tab && sender.tab.id;

    // Send an immediate ACK synchronously to ALL callers to prevent port closing
    try {
      sendResponse({ success: 'accepted', requestId });
    } catch (e) {
      Logger.warn('[delete_storage_image] failed to send immediate ACK:', e && e.message);
    }

    (async () => {
      const userId = await getCurrentUserId();
      let result = { success: true };

      try {
        Logger.info('[delete_storage_image] calling deleteImageFromStorage for id:', id, 'path:', storagePath);
        await deleteImageFromStorage(storagePath);
        Logger.info('[delete_storage_image] deleteImageFromStorage succeeded for id:', id);
      } catch (e) {
        Logger.warn('[delete_storage_image] storage deletion failed for id:', id, e && e.message);
        result = { success: false, error: e && e.message ? e.message : String(e) };
      }

      if (result.success) {
        try {
          Logger.info('[delete_storage_image] removing DB metadata for id:', id);
          await remove(ref(getDb(), `thumbnail_images/${userId}/${id}`));
          Logger.info('[delete_storage_image] DB metadata removal succeeded for id:', id);
        } catch (e) {
          Logger.warn('[delete_storage_image] DB metadata removal failed for id:', id, e && e.message);
          result = { success: false, error: e && e.message ? e.message : String(e) };
        }
      }

      Logger.info('[delete_storage_image] operation completed for id:', id, 'result:', result);

      // Notify the originating tab with the final result
      if (tabId) {
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
            chrome.tabs.sendMessage(tabId, { action: 'delete_storage_image_result', requestId, id, ...result }, () => {});
          }
        } catch (e) {
          Logger.warn('[delete_storage_image] failed to notify tab with result:', e && e.message);
        }
      } else {
        // If no tabId (e.g. from popup or background console), broadcast the result
        try {
           if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
             chrome.runtime.sendMessage({ action: 'delete_storage_image_result', requestId, id, ...result }).catch(() => {});
           }
        } catch (e) {
           Logger.warn('[delete_storage_image] failed to broadcast result:', e && e.message);
        }
      }
    })();

    return false; // We already sent the response
  }

  if (msg.action === 'delete_scrap') {
    return handleAsync(
      (async () => {
        const scrapId = msg.id;
        const res = await deleteScrap(scrapId);
        // Broadcast new list to tabs
        try {
          await getFirebaseScraps(null);
        } catch (e) {
          Logger.warn('[delete_scrap] getFirebaseScraps broadcast 실패:', e?.message || e);
        }
        return res;
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

        // 중앙 서비스에 위임하여 DB 업데이트 + 캐시 초기화를 수행
        try {
          const result = await toggleScrapSharing(scrapId, currentChannelId);
          return result;
        } catch (error) {
          Logger.error('[toggle_scrap_sharing] toggleScrapSharing 호출 오류:', error);
          return { success: false, error: error?.message || 'Unknown error' };
        }
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
