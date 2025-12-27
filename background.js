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
  deleteImageFromStorage,
  getUploadedImagesLog,
  firebaseConfig,
  markDeletedThumbnail,
  isThumbnailDeleted,
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

// Loose URL matcher to improve publishInfo clearing robustness
function matchUrlLoose(a, b) {
  try {
    const an = normalizeUrlForDeletion(a || '');
    const bn = normalizeUrlForDeletion(b || '');
    if (!an || !bn) return false;

    if (an === bn) return true;
    if (an.endsWith(bn) || bn.endsWith(an)) return true;
    if (an.includes(bn) || bn.includes(an)) return true;

    // filename match fallback
    const af = an.split('/').pop();
    const bf = bn.split('/').pop();
    if (af && bf && af === bf) return true;

    return false;
  } catch (e) {
    Logger.debug('[matchUrlLoose] comparison failed:', e && e.message);
    return false;
  }
} 

import {
  deleteCompetitorData,
  deleteChannelDataCascade,
  findDeletedCompetitors,
} from './js/services/cascadeDeleteService.js';

// 채널 ID 계산 유틸
import { genId } from './js/services/channelUtils.js';

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
  generateThumbnailImages,
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

import { runDataMigration, checkMigrationNeeded } from './js/services/migrationService.js';

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
if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm && chrome.alarms.onAlarm.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetch-channels') {
    Logger.biz('⏰ [Alarm] 채널 데이터 수집 시작');
    fetchAllChannelData();
  } else if (alarm.name === 'update-performance-metrics') {
    Logger.biz('⏰ [Alarm] 성과 지표 업데이트 시작');
    updateAllPerformanceMetrics();
  }
  });
}

// [최적화] 콘텐츠 스크립트와의 롱 런타임 연결(Keep-alive) 처리
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect && chrome.runtime.onConnect.addListener) {
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
}

// 2. 설치/업데이트 리스너
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener) {
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
}

// 3. 메시지 라우터 (Message Router)
/**
 * 백그라운드 스크립트의 메인 메시지 핸들러입니다.
 * 모든 content script와 popup의 메시지를 라우팅하고 처리합니다.
 */
console.log('[Background] 메시지 라우터 등록 시작');
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Allow messages that embed action inside `data` or `payload`
  if (!msg.action && msg.data && typeof msg.data.action === 'string') {
    msg.action = msg.data.action;
  }
  if (!msg.action && msg.payload && typeof msg.payload.action === 'string') {
    msg.action = msg.payload.action;
  }
  // Normalize action string for robust matching (trim, lowercase, camelCase->underscore, hyphen->underscore)
  if (msg && typeof msg.action === 'string') {
    msg.action = msg.action
      .trim()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }
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
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 즉시 ACK(accepted) 응답을 보내어 클라이언트의 포트 닫힘 에러 가능성을 낮춥니다.
    try {
      sendResponse({ success: 'accepted', requestId });
      Logger.info(`[Router] immediate ACK sent for action=${msg.action}`, { requestId });
    } catch (e) {
      Logger.debug('[Router] immediate ACK sendResponse failed:', e && e.message);
    }

    let finished = false;
    const finish = (payload, isError = false) => {
      if (finished) return;
      finished = true;

      const resultPayload = isError
        ? { success: false, error: payload && payload.message ? payload.message : String(payload), requestId }
        : (payload && typeof payload === 'object' ? { ...payload, requestId } : { success: true, result: payload, requestId });

      // 1) 우선 시도: 탭으로 직접 전달 (원래 요청자가 탭에 있으면 더 신뢰성 있음)
      try {
        if (sender && sender.tab && Number.isInteger(sender.tab.id)) {
          chrome.tabs.sendMessage(sender.tab.id, { action: `${msg.action}_result`, ...resultPayload }, (res) => {
            if (chrome.runtime.lastError) {
              Logger.debug('[Router] tab sendMessage failed:', chrome.runtime.lastError && chrome.runtime.lastError.message);
            } else {
              Logger.info('[Router] final result delivered to tab', { tabId: sender.tab.id, requestId });
            }
          });
        } else {
          // 2) 폴백: 런타임 전역 메시지로 전달
          chrome.runtime.sendMessage({ action: `${msg.action}_result`, ...resultPayload }, (r) => {
            if (chrome.runtime.lastError) {
              Logger.debug('[Router] runtime.sendMessage fallback failed:', chrome.runtime.lastError && chrome.runtime.lastError.message);
            } else {
              Logger.info('[Router] final result delivered via runtime fallback', { requestId });
            }
          });
        }
      } catch (e) {
        Logger.debug('[Router] error delivering final result via messaging:', e && e.message);
      }

      // 3) sendResponse 시도(포트가 열려 있으면 받는 쪽으로 전달됨)
      try {
        sendResponse(resultPayload);
        Logger.info(`[Router] sendResponse called for action=${msg.action}`, { requestId });
      } catch (e) {
        Logger.debug('[Router] sendResponse final attempt failed (port likely closed):', e && e.message);
      }
    };

    promise
      .then((data) => finish(data, false))
      .catch((err) => {
        Logger.error(`[Router Error] ${msg.action}:`, err && err.message ? err.message : String(err));
        finish(err, true);
      });

    // 타임아웃 폴백: 너무 오래 걸리면 타임아웃 결과를 보냄
    const timeoutMs = 10000;
    setTimeout(() => {
      if (!finished) {
        Logger.warn(`[Router] async action ${msg.action} timed out after ${timeoutMs}ms`, { requestId });
        finish({ message: 'timeout' }, true);
      }
    }, timeoutMs);

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
  // 채널 데이터 마이그레이션 요청
  if (msg.action === 'migrate_channel') {
    return handleAsync(
      (async () => {
        const { channelId, targetPlatform, dryRun, options } = msg;
        const userId = await getCurrentUserId();
        if (userId === CONSTANTS.USER_ID) {
          return { success: false, error: '로그인이 필요합니다.' };
        }

        // 권한 검사: 채널이 사용자 소유 여부 확인 (실패 시 차단)
        // 단, 테스트/환경에서 firebase REST helper가 주입되지 않은 경우에는 체크를 건너뜁니다.
        if (typeof get !== 'function' || typeof ref !== 'function') {
          Logger.warn('[migrate_channel] firebaseService.get/ref 함수가 없어 권한 검사를 건너뜁니다.');
        } else {
        let found = false;
        try {
          // Use get with either a ref(getDb(), path) if getDb exists, else call get(path)
          let channelsSnap;
          try {
            if (typeof getDb === 'function') channelsSnap = await get(ref(getDb(), `channels/${userId}`));
            else channelsSnap = await get(`channels/${userId}`);
          } catch (e) {
            // Fallback, try direct get as plain path
            channelsSnap = await get(`channels/${userId}`);
          }
          const channelsData = channelsSnap?.val() || {};
          const myBlogs = channelsData.myChannels?.blogs || [];
          const myYoutubes = channelsData.myChannels?.youtubes || [];
          const allChannels = [...(myBlogs || []), ...(myYoutubes || [])];
          function safeGenId(b) {
            try {
              if (!b) return null;
              if (b.id) return b.id;
              if (b.apiUrl) return btoa(b.apiUrl).replace(/=/g, '');
              if (b.inputUrl || b.url) return btoa((b.inputUrl || b.url).replace(/\/$/, '')).replace(/=/g, '');
              return null;
            } catch (e) {
              return b?.id || null;
            }
          }
          found = allChannels.some((ch) => (ch && (ch.id === channelId || safeGenId(ch) === channelId)) || false);
        } catch (err) {
          Logger.warn('[migrate_channel] 채널 소유권 확인 실패:', err);
          return { success: false, error: '권한 검사 중 오류가 발생했습니다.' };
        }
          if (!found) {
            return { success: false, error: '권한이 없습니다: 이 채널은 현재 사용자 소유가 아닙니다.' };
          }
        }

        // Dry-run인 경우 즉시 실행
        if (!!dryRun) {
          const result = await runDataMigration(userId, channelId, { dryRun: !!dryRun, targetPlatform: targetPlatform || null, collections: options?.collections || null, debug: options?.debug || false });
          if (!result.success) return { success: false, error: result.message };
          return { success: true, message: result.message, dryRunResult: result.dryRunResult, updatedCount: result.updatedCount };
        }

        // 실제 실행: 작업(잡)으로 등록하고 비동기로 처리
        const jobId = `migration-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // push job to local storage queue
        try {
          const storage = await new Promise((resolve) => chrome.storage.local.get(['migrationJobs'], resolve));
          const jobs = storage.migrationJobs || [];
          jobs.push({ id: jobId, userId, channelId, targetPlatform, status: 'queued', createdAt: Date.now() });
          Logger.info('[migrate_channel] enqueuing job', jobId, 'jobsCount(before set):', jobs.length);
          await new Promise((resolve) => chrome.storage.local.set({ migrationJobs: jobs }, resolve));
          Logger.info('[migrate_channel] job enqueued', jobId, 'jobsCount(after set):', jobs.length);

          // Start processing in background (fire and forget)
          (async () => {
            try {
              // update job status to running
              const s1 = await new Promise((resolve) => chrome.storage.local.get(['migrationJobs'], resolve));
              const jobs1 = s1.migrationJobs || [];
              const idx = jobs1.findIndex((j) => j.id === jobId);
              if (idx >= 0) jobs1[idx].status = 'running';
              await new Promise((resolve) => chrome.storage.local.set({ migrationJobs: jobs1 }, resolve));

              const res = await runDataMigration(userId, channelId, { dryRun: false, targetPlatform: targetPlatform || null, collections: options?.collections || null, debug: options?.debug || false });

              const s2 = await new Promise((resolve) => chrome.storage.local.get(['migrationJobs'], resolve));
              const jobs2 = s2.migrationJobs || [];
              const i2 = jobs2.findIndex((j) => j.id === jobId);
              if (i2 >= 0) {
                jobs2[i2].status = res.success ? 'completed' : 'failed';
                jobs2[i2].result = res;
                jobs2[i2].finishedAt = Date.now();
              }
              await new Promise((resolve) => chrome.storage.local.set({ migrationJobs: jobs2 }, resolve));
            } catch (jobErr) {
              Logger.error('[Background] migration job failed:', jobErr);
              try {
                const s3 = await new Promise((resolve) => chrome.storage.local.get(['migrationJobs'], resolve));
                const jobs3 = s3.migrationJobs || [];
                const i3 = jobs3.findIndex((j) => j.id === jobId);
                if (i3 >= 0) {
                  jobs3[i3].status = 'failed';
                  jobs3[i3].result = { success: false, error: jobErr.message };
                  jobs3[i3].finishedAt = Date.now();
                }
                await new Promise((resolve) => chrome.storage.local.set({ migrationJobs: jobs3 }, resolve));
              } catch (t) {
                Logger.warn('[Background] failed to persist job failure info:', t);
              }
            }
          })();

          return { success: true, jobId };
        } catch (e) {
          Logger.error('[Background] migration job enqueue failed:', e);
          return { success: false, error: '작업 등록 실패' };
        }
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
      (async () => {
        console.error('[Background] ai_generate_images REQUEST RECEIVED:', JSON.stringify(msg.data, null, 2));

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
                console.error('[Background] Fetching references count:', inputUrls.length);

                // fetch each reference asynchronously as base64 objects with a single retry on failure
                const tryFetch = async (url) => {
                  try {
                    const first = await fetchImageAsBase64(url);
                    if (first && first.success) return first;
                  } catch (e) { /* fallthrough to retry */ }
                  // Retry once after short delay
                  try {
                    await new Promise((r) => setTimeout(r, 100));
                    const second = await fetchImageAsBase64(url);
                    return second || { success: false, error: 'retry_failed' };
                  } catch (e) {
                    return { success: false, error: e && e.message ? e.message : String(e) };
                  }
                };

                const fetchPromises = msg.data.references.map((url) => tryFetch(url).catch((err) => ({ success: false, error: err.message })));
                const fetchedRaw = await Promise.all(fetchPromises);
            // [DEBUG] Log raw fetch results with console.error to ensure visibility
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

            // Build success/failure lists without logging full base64 blobs
            // Increase preview threshold to 1MB for diagnostics so we can visually confirm conversions
            const PREVIEW_THRESHOLD = 1024 * 1024; // 1MB
            successEntries = fetchedConverted
              .map((item, idx) => {
                if (!item) return null;
                const rawItem = fetchedRaw[idx];
                const dataStr = rawItem.dataUrl ? rawItem.dataUrl.split(',')[1] : '';
                const preview = dataStr.length > 200 ? dataStr.substring(0, 200) + '...[truncated]' : dataStr;
                const dataFullUrl = rawItem.dataUrl && rawItem.dataUrl.length < PREVIEW_THRESHOLD ? rawItem.dataUrl : undefined;
                return {
                  url: inputUrls[idx],
                  mimeType: item.mimeType || 'unknown',
                  dataLength: dataStr.length,
                  dataPreview: preview,
                  dataFullUrl, // include full dataUrl when small enough for preview
                };
              })
              .filter(Boolean);
            
            failedUrls = inputUrls.map((u, i) => {
                const res = fetchedRaw[i];
                if (!fetchedConverted[i]) {
                    return { url: u, error: res ? res.error : 'Unknown error' };
                }
                return null;
            }).filter(Boolean);

            // [DEBUG] 참조 이미지 변환 결과 (스타일 적용)
            console.log('%c[AI 썸네일 메이커 디버깅][Reference fetch]', 'color:#9E9E9E', {
              inputCount: inputUrls.length,
              successCount: successEntries.length,
              successes: successEntries.map(s => ({ url: s.url, mimeType: s.mimeType, dataLength: s.dataLength })),
              failedUrls: failedUrls,
            });

            // [DEBUG] 변환된 실제 값(미리보기, 앞 200자):
            console.log('%c[AI 썸네일 메이커 디버깅][Reference convert values]', 'color:#9E9E9E', successEntries.map(s => ({ url: s.url, mimeType: s.mimeType, dataPreview: s.dataPreview })) );

            // [DEBUG] 변환 완료 요약 (간단 문구)
            console.log('%c[AI 썸네일 메이커 디버깅][Reference convert complete]', 'color:#9E9E9E', {
              convertedCount: successEntries.length,
              convertedSample: successEntries.slice(0, 3).map((s) => ({ url: s.url, mimeType: s.mimeType, dataKb: Math.round((s.dataLength || 0) / 1024) })),
              failedCount: failedUrls.length,
            });
          }
        } catch (e) {
          console.warn('%c[AI 썸네일 메이커 디버깅][Reference fetch failed]', 'color:#9E9E9E', e);
        }

        // [DEBUG] generateAiImage에 넘기는 refImages 요약
        try {
          console.log('%c[AI 썸네일 메이커 디버깅][generateAiImage input]', 'color:#9E9E9E', {
            refImagesCount: Array.isArray(refImages) ? refImages.length : 0,
            refSample: Array.isArray(refImages) && refImages.length > 0 ? refImages.slice(0,3).map(r => ({ mimeType: r.mimeType, dataLen: r.data ? r.data.length : 0 })) : []
          });
          if (Array.isArray(msg.data.references) && Array.isArray(refImages) && refImages.length !== msg.data.references.length) {
            console.warn('%c[AI 썸네일 메이커 디버깅][Reference mismatch] 입력 URL 수와 변환된 이미지 수가 다릅니다.', 'color:#9E9E9E', { inputUrlsLength: msg.data.references.length, convertedLength: refImages.length });
          }
        } catch (e) {
          void 0;
        }

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
                    // generateMetaDescription: intentionally omitted to avoid auto-generating
                    // meta descriptions on idea creation. Users can generate via the
                    // publish-info UI when needed.
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

        // Sanitize incoming publishInfo: remove any thumbnail URLs that have been tombstoned (recently deleted)
        try {
          if (updates && updates.publishInfo) {
            const pub = updates.publishInfo;

            const sanitizeUrl = async (u) => {
              try {
                if (!u) return null;
                let objectPath = null;
                if (u.startsWith('gs://')) {
                  const m = String(u).match(/^gs:\/\/[^\/]+\/(.+)$/);
                  if (m && m[1]) objectPath = decodeURIComponent(m[1]);
                } else {
                  try {
                    const uu = new URL(u);
                    const mFull = uu.pathname.match(/\/v0\/b\/([^\/]+)\/o\/([^?\/]+)/);
                    if (mFull && mFull[2]) objectPath = decodeURIComponent(mFull[2]);
                    else {
                      const mShort = uu.pathname.match(/\/o\/([^?\/]+)/);
                      if (mShort && mShort[1]) objectPath = decodeURIComponent(mShort[1]);
                    }
                  } catch (e) {}
                }
                if (!objectPath) return u;
                const uid = await getCurrentUserId();
                const deleted = await (typeof isThumbnailDeleted === 'function' ? isThumbnailDeleted(uid, objectPath) : false);
                return deleted ? null : u;
              } catch (e) {
                return u;
              }
            };

            if (Array.isArray(pub.thumbnailInfo)) {
              pub.thumbnailInfo = await Promise.all(
                pub.thumbnailInfo.map(async (t) => {
                  const copy = { ...t };
                  if (copy.bgImage) {
                    const safe = await sanitizeUrl(copy.bgImage);
                    if (!safe) delete copy.bgImage;
                    else copy.bgImage = safe;
                  }
                  if (Array.isArray(copy.bgImages)) {
                    const filtered = [];
                    for (const x of copy.bgImages) {
                      const safe = await sanitizeUrl(x);
                      if (safe) filtered.push(safe);
                    }
                    if (filtered.length > 0) copy.bgImages = filtered;
                    else delete copy.bgImages;
                  }
                  return copy;
                })
              );
            }

            if (pub.bgImage) {
              const safe = await sanitizeUrl(pub.bgImage);
              if (!safe) delete pub.bgImage;
              else pub.bgImage = safe;
            }
            if (Array.isArray(pub.bgImages)) {
              const newArr = [];
              for (const x of pub.bgImages) {
                const safe = await sanitizeUrl(x);
                if (safe) newArr.push(safe);
              }
              if (newArr.length > 0) pub.bgImages = newArr;
              else delete pub.bgImages;
            }

            if (pub.thumbnailUrls && typeof pub.thumbnailUrls === 'object') {
              const keys = Object.keys(pub.thumbnailUrls);
              for (const k of keys) {
                try {
                  const safe = await sanitizeUrl(pub.thumbnailUrls[k]);
                  if (!safe) delete pub.thumbnailUrls[k];
                  else pub.thumbnailUrls[k] = safe;
                } catch (e) {}
              }
            }

            updates.publishInfo = pub;
          }
        } catch (sanitizeErr) {
          Logger.warn('[update_kanban_card] publishInfo sanitation failed:', sanitizeErr && sanitizeErr.message);
        }

        // 데이터 정제 (undefined → null)
        const cleanedUpdates = cleanDataForFirebase(updates);

        // Defensive normalization: ensure thumbnailInfo doesn't accidentally set the same bgImage for all candidates.
        // If publishInfo.thumbnailInfo is an array and selectedThumbnailIndex is provided and the selected
        // candidate has a bgImage equal to other candidates' bgImage, clear bgImage on non-selected candidates
        // to avoid broad overwrites caused by shared references or buggy merges.
        try {
          if (cleanedUpdates && cleanedUpdates.publishInfo && Array.isArray(cleanedUpdates.publishInfo.thumbnailInfo)) {
            const pf = cleanedUpdates.publishInfo;
            const arr = pf.thumbnailInfo;
            const selIndex = typeof pf.selectedThumbnailIndex === 'number' ? pf.selectedThumbnailIndex : undefined;
            if (typeof selIndex === 'number' && selIndex >= 0 && selIndex < arr.length) {
              const selBg = arr[selIndex] && arr[selIndex].bgImage;
              if (selBg) {
                cleanedUpdates.publishInfo.thumbnailInfo = arr.map((it, idx) => {
                  if (idx === selIndex) return it;
                  // If another candidate references the same selected bg (either as bgImage or in bgImages), remove it from that candidate
                  if (it && (it.bgImage === selBg || (Array.isArray(it.bgImages) && it.bgImages.includes(selBg)))) {
                    const clone = { ...it };
                    if (clone.bgImage === selBg) clone.bgImage = null;
                    if (Array.isArray(clone.bgImages)) {
                      clone.bgImages = clone.bgImages.filter((u) => u !== selBg);
                      if (clone.bgImages.length === 0) delete clone.bgImages;
                    }
                    return clone;
                  }
                  return it;
                });
                Logger.debug('[update_kanban_card] Normalized thumbnailInfo to keep bgImage only on selected index:', selIndex);
              }
            }
          }
        } catch (normErr) {
          Logger.warn('[update_kanban_card] thumbnail normalization failed:', normErr);
        }

        // Extra debug when publishInfo is present to diagnose missing DB writes
        try {
          Logger.debug('[update_kanban_card] about to persist cleanedUpdates:', cleanedUpdates);
          if (cleanedUpdates && cleanedUpdates.publishInfo) {
            Logger.debug('[update_kanban_card] publishInfo payload preview:', cleanedUpdates.publishInfo);
          }

          try {
            await update(ref(getDb(), updatePath), cleanedUpdates);
            Logger.biz(`✅ [update_kanban_card] 카드 업데이트 완료 - cardId: ${cardId}, status: ${status}`);
          } catch (dbErr) {
            Logger.error('[update_kanban_card] DB update failed:', dbErr && (dbErr.message || dbErr));
            // bubble up a structured error so callers can react/test accordingly
            return { success: false, error: 'db_update_failed', detail: dbErr && dbErr.message ? dbErr.message : String(dbErr) };
          }
        } catch (err) {
          Logger.error('[update_kanban_card] unexpected error preparing update:', err && (err.message || err));
          return { success: false, error: 'internal_error', detail: err && err.message ? err.message : String(err) };
        }

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

  // Debug helper: fetch and return a specific kanban card for debugging publishInfo issues
  if (msg.action === 'debug_print_card') {
    return handleAsync(
      (async () => {
        try {
          const { cardId, status = 'ideas' } = msg.data || {};
          if (!cardId) return { success: false, error: 'cardId is required' };
          const userId = await getCurrentUserId();
          const path = `kanban/${userId}/${status}/${cardId}`;
          Logger.debug(`[debug_print_card] fetching path: ${path}`);
          const snap = await get(ref(getDb(), path));
          const val = snap?.val();
          Logger.debug('[debug_print_card] data:', val);
          return { success: true, data: val };
        } catch (err) {
          Logger.error('[debug_print_card] error:', err && err.message ? err.message : err);
          return { success: false, error: err && err.message ? err.message : String(err) };
        }
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
        const cardsCount =
          (Object.keys(data?.ideas || {}).length || 0) +
          (Object.keys(data?.['in-progress'] || {}).length || 0) +
          (Object.keys(data?.done || {}).length || 0);
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
        const result = await saveScrapElement(data, channelId);

        // After successful save, force a refresh of scrap list & broadcast update
        if (result && result.success) {
          try {
            // Trigger getFirebaseScraps which will send 'scraps_data_updated' to content scripts
            await getFirebaseScraps(channelId);
          } catch (e) {
            Logger.warn('[Background] getFirebaseScraps 호출 실패:', e?.message || e);
          }

          try {
            // also send a lightweight notification so UIs can proactively request fresh data
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (tab.id) {
                  try {
                    chrome.tabs.sendMessage(tab.id, { action: 'cp_scraps_updated' });
                  } catch (_sendErr) {
                    // ignore
                  }
                }
              });
            });
          } catch (e) {
            Logger.warn('[Background] cp_scraps_updated 브로드캐스트 실패:', e?.message || e);
          }
        }

        return result;
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
        const res = await deleteScrap(scrapId);
        // Broadcast new scraps list to all tabs so UI updates even if content scripts don't re-request
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

  // === [Thumbnail IMAGE Generation] 실제 이미지 생성/합성/업로드 ===
  if (msg.action === 'generate_thumbnail_images') {
    return handleAsync(
      (async () => {
        const data = msg.data || msg;
        // basic validation (permalink not strictly required but recommended)
        try {
          const res = await generateThumbnailImages({
            thumbnailCandidates: data.thumbnailCandidates || [],
            affiliateLinks: data.affiliateLinks || [],
            permalink: data.permalink || (data.publishInfo && data.publishInfo.permalink) || null,
            composeThumbnailText: data.composeThumbnailText,
            seoTitle: data.seoTitle || (data.publishInfo && data.publishInfo.seoTitle) || data.title || '',
            ideaData: data,
            jsonLdSchema: data.jsonLdSchema || null,
            formattedDraft: data.currentDraft || data.formattedDraft || '',
            onProgress: null,
          });
          return res;
        } catch (e) {
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })()
    );
  }

  // Single delete: delete file from Storage and remove DB metadata
  if (msg.action === 'delete_storage_image') {
    // Detailed logging for debugging message payloads and sender
    try {
      Logger.info('[delete_storage_image] received request:', {
        action: msg && msg.action,
        data: msg && msg.data,
        sender: sender && (sender.id || (sender.tab && sender.tab.id) || 'unknown'),
      });
    } catch (e) {
      // Logging should never throw the handler
      Logger.debug('[delete_storage_image] logging failed:', e && e.message);
    }

    // Synchronous guard: if there's no data payload, respond immediately so callers don't hang
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

    // If the message came from a page/tab, send an immediate ACK synchronously, then handle actual work and notify the tab with the final result.
    if (tabId) {
      try {
        sendResponse({ success: 'accepted', requestId });
      } catch (e) {
        Logger.warn('[delete_storage_image] failed to send immediate ACK:', e && e.message);
        // Fall through to async path if sendResponse failed
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

            // Mark tombstone for the deleted storage path to avoid immediate re-uploads
            try {
              const m = String(storagePath || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (m) {
                const objectPath = decodeURIComponent(m[2]);
                const tombRes = await markDeletedThumbnail(userId, objectPath);
                Logger.info('[delete_storage_image] tombstone mark result:', { id, objectPath, success: !!tombRes });
              }
            } catch (e) {
              Logger.debug('[delete_storage_image] failed to mark tombstone for id:', id, e && e.message);
            }
          } catch (e) {
            Logger.warn('[delete_storage_image] DB metadata removal failed for id:', id, e && e.message);
            result = { success: false, error: e && e.message ? e.message : String(e) };
          }
        }

        Logger.info('[delete_storage_image] operation completed for id:', id, 'result:', result);

        // Notify the originating tab with the final result
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
            chrome.tabs.sendMessage(tabId, { action: 'delete_storage_image_result', requestId, id, ...result }, () => {});
          } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'delete_storage_image_result', requestId, id, ...result }).catch(() => {});
          }
        } catch (e) {
          Logger.warn('[delete_storage_image] failed to notify tab with result:', e && e.message);
        }
      })();

      // We already sent a synchronous ACK via sendResponse
      return false;
    }

    // Otherwise, fallback to existing async sendResponse flow (for callers without tab context)
    return handleAsync(
      (async () => {
        const userId = await getCurrentUserId();

        // 1. 스토리지 원본 삭제
        try {
          Logger.info('[delete_storage_image] calling deleteImageFromStorage for id:', id, 'path:', storagePath);
          await deleteImageFromStorage(storagePath);
          Logger.info('[delete_storage_image] deleteImageFromStorage succeeded for id:', id);
        } catch (e) {
          Logger.warn('[delete_storage_image] storage deletion failed for id:', id, e && e.message);
          return { success: false, error: e && e.message ? e.message : String(e) };
        }

        // 2. DB 메타데이터 삭제
        try {
          Logger.info('[delete_storage_image] removing DB metadata for id:', id);
          await remove(ref(getDb(), `thumbnail_images/${userId}/${id}`));
          Logger.info('[delete_storage_image] DB metadata removal succeeded for id:', id);

          // Mark tombstone for the deleted storage path to avoid immediate re-uploads
          try {
            const m = String(storagePath || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
            if (m) {
              const objectPath = decodeURIComponent(m[2]);
              await markDeletedThumbnail(userId, objectPath);
            }
          } catch (e) {
            Logger.debug('[delete_storage_image] failed to mark tombstone for id:', id, e && e.message);
          }
        } catch (e) {
          Logger.warn('[delete_storage_image] DB metadata removal failed for id:', id, e && e.message);
          return { success: false, error: e && e.message ? e.message : String(e) };
        }

        Logger.info('[delete_storage_image] operation completed for id:', id);
        return { success: true };
      })()
    );
  }

  // New: delete by download URL - finds metadata entry and deletes storage + metadata
  if (msg.action === 'delete_storage_image_by_url') {
    if (!msg || !msg.data || !msg.data.url) {
      return sendResponse({ success: false, error: 'missing url' });
    }

    return handleAsync(
      (async () => {
        const url = String(msg.data.url || '');
        const userId = await getCurrentUserId();
        Logger.info('[delete_storage_image_by_url] received delete request for url:', url);
        try {
          const list = await getUploadedImagesLog();
          Logger.debug('[delete_storage_image_by_url] uploaded images metadata count:', Array.isArray(list) ? list.length : 0);

          const target = normalizeUrlForDeletion(url);
          Logger.debug('[delete_storage_image_by_url] normalized target:', target.substring(0, 120));

          const matches = Array.isArray(list)
            ? list.filter((it) => {
                const d = normalizeUrlForDeletion(it.downloadURL || '');
                return matchUrlLoose(d, target);
              })
            : []; 

          if (matches.length > 0) {
            Logger.info('[delete_storage_image_by_url] found metadata matches count:', matches.length);

            // Collect unique storage paths (derive from downloadURL if missing)
            const storagePaths = new Set();
            for (const m of matches) {
              if (m.storagePath) storagePaths.add(m.storagePath);
              else {
                // try to parse from downloadURL
                try {
                  const u2 = new URL(m.downloadURL);
                  const pMatch2 = u2.pathname.match(/\/o\/([^?\/]+)/) || u2.pathname.match(/\/v0\/b\/[^\/]+\/o\/([^?\/]+)/);
                  if (pMatch2 && pMatch2[1]) {
                    const decoded = decodeURIComponent(pMatch2[1]);
                    // fallback to firebaseConfig if available
                    const bucketGuess = (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.storageBucket) ? firebaseConfig.storageBucket : null;
                    if (bucketGuess) storagePaths.add(`gs://${bucketGuess}/${decoded}`);
                  }
                } catch (e) {
                  Logger.debug('[delete_storage_image_by_url] failed to parse storage path from match downloadURL:', e && e.message);
                }
              }
            }

            // Attempt deletes + verification for each storage path
            const verifiedPaths = new Set();
            const failedPaths = [];
            for (const sp of storagePaths) {
              try {
                await deleteImageFromStorage(sp);
              } catch (e) {
                Logger.warn('[delete_storage_image_by_url] storage delete failed for path from matches:', sp, e && e.message);
              }

              // verify via HEAD
              try {
                const m2 = String(sp || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
                if (m2) {
                  const bucket2 = m2[1];
                  const objectPath2 = m2[2];
                  const encoded2 = encodeURIComponent(objectPath2);
                  const dlUrl2 = `https://firebasestorage.googleapis.com/v0/b/${bucket2}/o/${encoded2}?alt=media`;
                  const metaUrl2 = `https://firebasestorage.googleapis.com/v0/b/${bucket2}/o/${encoded2}`;

                  let confirmed = false;
                  let lastErr = null;

                  for (let attempt = 0; attempt < 2 && !confirmed; attempt++) {
                    try {
                      let token2 = await getValidToken(false);
                      if (!token2) token2 = await getValidToken(true);

                      // Try HEAD (fast)
                      try {
                        const verifyResp2 = await fetch(dlUrl2, { method: 'HEAD', headers: { Authorization: `Bearer ${token2}` } });
                        if (verifyResp2 && verifyResp2.status === 404) {
                          Logger.info('[delete_storage_image_by_url] storage delete confirmed (not found) for path:', sp, 'via HEAD');
                          confirmed = true;
                          break;
                        }
                        lastErr = `HEAD status:${verifyResp2 ? verifyResp2.status : 'no-response'}`;
                      } catch (e) {
                        lastErr = e && e.message ? e.message : String(e);
                        Logger.debug('[delete_storage_image_by_url] HEAD fetch failed for verification:', lastErr);
                      }

                      // Try metadata GET as fallback
                      try {
                        const metaResp = await fetch(metaUrl2, { method: 'GET', headers: { Authorization: `Bearer ${token2}` } });
                        if (metaResp && metaResp.status === 404) {
                          Logger.info('[delete_storage_image_by_url] storage delete confirmed (not found) for path:', sp, 'via metadata GET');
                          confirmed = true;
                          break;
                        }
                        lastErr = `META status:${metaResp ? metaResp.status : 'no-response'}`;
                      } catch (e) {
                        lastErr = e && e.message ? e.message : String(e);
                        Logger.debug('[delete_storage_image_by_url] metadata GET failed for verification:', lastErr);
                      }

                      // if not confirmed, refresh token on next attempt
                      if (attempt === 0) {
                        await getValidToken(true);
                      }
                    } catch (e) {
                      lastErr = e && e.message ? e.message : String(e);
                      Logger.debug('[delete_storage_image_by_url] verification attempt error:', lastErr);
                    }
                  }

                  if (confirmed) {
                    verifiedPaths.add(sp);
                  } else {
                    Logger.warn('[delete_storage_image_by_url] storage delete not confirmed after retries for path:', sp, 'lastErr:', lastErr);
                    failedPaths.push({ path: sp, error: lastErr });
                  }
                } else {
                  Logger.debug('[delete_storage_image_by_url] unable to parse gs:// path for verification:', sp);
                }
              } catch (e) {
                Logger.warn('[delete_storage_image_by_url] verification HEAD failed for path from matches:', sp, e && e.message);
                failedPaths.push(sp);
              }
            }

            // Remove all metadata entries that match verified paths or normalized url
            const removedIds = [];
            for (const m of matches) {
              const mStorage = m.storagePath;
              const shouldRemove = (mStorage && verifiedPaths.has(mStorage)) || (!mStorage && verifiedPaths.size > 0);
              // Additionally, remove if normalized downloadURL matches target
              const dnorm = normalizeUrlForDeletion(m.downloadURL || '');
              if (shouldRemove || matchUrlLoose(dnorm, target)) {
                try {
                  await remove(ref(getDb(), `thumbnail_images/${userId}/${m.id}`));
                  Logger.info('[delete_storage_image_by_url] metadata removed for id:', m.id);
                  removedIds.push(m.id);
                } catch (e) {
                  Logger.warn('[delete_storage_image_by_url] failed to remove metadata for id:', m.id, e && e.message);
                }
              }
            }

            Logger.info('[delete_storage_image_by_url] removed metadata ids count:', removedIds.length, 'failedPaths:', failedPaths.length);

            // mark tombstones for verified paths to prevent immediate re-uploads
            try {
              for (const sp of verifiedPaths) {
                try {
                  const m2 = String(sp || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
                  if (m2) {
                    const objectPath2 = decodeURIComponent(m2[2]);
                    const tombRes2 = await markDeletedThumbnail(userId, objectPath2);
                    Logger.info('[delete_storage_image_by_url] tombstone mark result for path:', { path: sp, objectPath: objectPath2, success: !!tombRes2 });
                  }
                } catch (e) {
                  Logger.warn('[delete_storage_image_by_url] failed to mark tombstone for path:', sp, e && e.message);
                }
              }
            } catch (e) {
              Logger.debug('[delete_storage_image_by_url] tombstone marking errors:', e && e.message);
            }

            // Additionally, clear any references to the deleted download URL in kanban publishInfo/thumbnailInfo
            try {
              const urlsToClear = new Set();
              // original request url
              if (url) urlsToClear.add(url);
              // add normalized download urls for verified paths
              for (const p of verifiedPaths) {
                const m = String(p).match(/^gs:\/\/([^\/]+)\/(.+)$/);
                if (m) {
                  const b = m[1];
                  const op = encodeURIComponent(m[2]);
                  urlsToClear.add(`https://firebasestorage.googleapis.com/v0/b/${b}/o/${op}?alt=media`);
                }
              }

              const statuses = Object.values(KANBAN_STATUS || {});
              for (const status of statuses) {
                const basePath = `kanban/${userId}/${status}`;
                const snap = await get(basePath);
                const all = snap && snap.val ? snap.val() : null;
                if (!all) continue;

                for (const id in all) {
                  try {
                    const card = all[id];
                    const publish = card && card.publishInfo ? { ...card.publishInfo } : null;
                    let dirty = false;

                    if (publish && Array.isArray(publish.thumbnailInfo)) {
                      const newThumbs = publish.thumbnailInfo.map((t) => {
                        const copy = { ...t };
                        if (copy.bgImage) {
                          const matched = Array.from(urlsToClear).find((u) => matchUrlLoose(copy.bgImage, u));
                          if (matched) {
                            Logger.info('[delete_storage_image_by_url] cleared thumbnailInfo.bgImage match', { card: `${basePath}/${id}`, matched, bgImage: copy.bgImage });
                            copy.bgImage = null;
                            dirty = true;
                          }
                        }
                        if (copy.bgImages && Array.isArray(copy.bgImages)) {
                          const filtered = copy.bgImages.filter((x) => !Array.from(urlsToClear).some((u) => matchUrlLoose(x, u)));
                          if (filtered.length !== copy.bgImages.length) {
                            Logger.info('[delete_storage_image_by_url] cleared thumbnailInfo.bgImages entries for card', `${basePath}/${id}`);
                            copy.bgImages = filtered;
                            dirty = true;
                          }
                        }
                        return copy;
                      });

                      if (dirty) {
                        publish.thumbnailInfo = newThumbs;
                        await update(`${basePath}/${id}`, { publishInfo: publish });
                        Logger.info('[delete_storage_image_by_url] cleared thumbnail refs for card:', `${basePath}/${id}`);
                      }
                    }

                    // top-level bgImage / bgImages in publishInfo (if any)
                    if (publish && publish.bgImage) {
                      const matched = Array.from(urlsToClear).find((u) => matchUrlLoose(publish.bgImage, u));
                      if (matched) {
                        Logger.info('[delete_storage_image_by_url] cleared publishInfo.bgImage for card', `${basePath}/${id}`);
                        publish.bgImage = null;
                        dirty = true;
                      }
                    }
                    if (publish && Array.isArray(publish.bgImages)) {
                      const filtered = publish.bgImages.filter((x) => !Array.from(urlsToClear).some((u) => matchUrlLoose(x, u)));
                      if (filtered.length !== publish.bgImages.length) {
                        Logger.info('[delete_storage_image_by_url] cleared publishInfo.bgImages entries for card', `${basePath}/${id}`);
                        if (filtered.length === 0) {
                          delete publish.bgImages;
                        } else {
                          publish.bgImages = filtered;
                        }
                        dirty = true;
                      }
                    }

                    if (dirty && !(publish && publish.thumbnailInfo && publish.thumbnailInfo.length === 0)) {
                      await update(`${basePath}/${id}`, { publishInfo: publish });
                      Logger.info('[delete_storage_image_by_url] publishInfo updated for card:', `${basePath}/${id}`);
                    }
                  } catch (e) {
                    Logger.warn('[delete_storage_image_by_url] failed to clear publishInfo refs for card:', `${basePath}/${id}`, e && e.message);
                  }
                }
              }

              // Cleanup pass: remove any empty publish.bgImages arrays that remained (safety)
              try {
                for (const id in all) {
                  try {
                    const card2 = all[id];
                    const publish2 = card2 && card2.publishInfo ? { ...card2.publishInfo } : null;
                    if (publish2 && Array.isArray(publish2.bgImages) && publish2.bgImages.length === 0) {
                      const newPublish = { ...publish2 };
                      delete newPublish.bgImages;
                      await update(`${basePath}/${id}`, { publishInfo: newPublish });
                      Logger.info('[delete_storage_image_by_url] removed empty publish.bgImages for card:', `${basePath}/${id}`);
                    }
                  } catch (e) {
                    // ignore per-card cleanup errors
                  }
                }
              } catch (e) {
                Logger.debug('[delete_storage_image_by_url] cleanup pass failed:', e && e.message);
              }
            } catch (e) {
              Logger.warn('[delete_storage_image_by_url] failed to scan/update kanban publishInfo entries:', e && e.message);
            }

            // Broadcast kanban changes to UI tabs so clients refresh cached publishInfo
            try {
              const kanbanRefBroad = ref(getDb(), `kanban/${userId}`);
              const kanbanSnapBroad = await get(kanbanRefBroad);
              const kanbanDataBroad = kanbanSnapBroad?.val() || {};

              try {
                chrome.runtime.sendMessage({ action: 'kanban_data_updated', data: kanbanDataBroad });
              } catch (e) {
                Logger.debug('[delete_storage_image_by_url] broadcast runtime.sendMessage failed:', e && e.message);
              }

              try {
                chrome.tabs.query({}, (tabs) => {
                  tabs.forEach((tab) => {
                    if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
                      try {
                        chrome.tabs.sendMessage(tab.id, { action: 'kanban_data_updated', data: kanbanDataBroad }, () => {});
                      } catch (ignored) {}
                    }
                  });
                });
              } catch (e) {
                Logger.debug('[delete_storage_image_by_url] tabs broadcast failed:', e && e.message);
              }
            } catch (e) {
              Logger.debug('[delete_storage_image_by_url] preparing broadcast failed:', e && e.message);
            }

            return { success: true, removedIds, failedPaths };
          }

          // try to parse storage path from a firebase download URL (multiple fallbacks)
          try {
            const u = new URL(url);

            // Attempt to extract bucket and object path explicitly from known firebase download URL patterns
            // Pattern 1: /v0/b/<bucket>/o/<encodedPath>
            // Pattern 2: /o/<encodedPath>  (no bucket in path)
            let bucket = null;
            let encodedPath = null;

            const mFull = u.pathname.match(/\/v0\/b\/([^\/]+)\/o\/([^?\/]+)/);
            if (mFull) {
              bucket = mFull[1];
              encodedPath = mFull[2];
            } else {
              const mShort = u.pathname.match(/\/o\/([^?\/]+)/);
              if (mShort) {
                encodedPath = mShort[1];
                // fallback to firebaseConfig.storageBucket only if available
                if (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.storageBucket) {
                  bucket = firebaseConfig.storageBucket;
                }
              }
            }

            if (!bucket) {
              Logger.warn('[delete_storage_image_by_url] could not determine storage bucket from URL:', url);
              return { success: false, error: 'could not determine storage bucket' };
            }

            if (!encodedPath) {
              Logger.warn('[delete_storage_image_by_url] could not determine object path from URL:', url);
              return { success: false, error: 'could not determine object path' };
            }

            const decoded = decodeURIComponent(encodedPath);
            const storagePath = `gs://${bucket}/${decoded}`;
            Logger.info('[delete_storage_image_by_url] parsed storage path:', storagePath);
            try {
              await deleteImageFromStorage(storagePath);
              Logger.info('[delete_storage_image_by_url] storage delete succeeded for parsed path');
            } catch (e) {
              Logger.warn('[delete_storage_image_by_url] storage delete failed for parsed path:', storagePath, e && e.message);
              // Continue: even if storage deletion failed, attempt to remove metadata & mark tombstone to prevent re-uploads.
            }

            // If metadata exists for the parsed storage path, remove ALL matching entries
            const matchesByStorage = Array.isArray(list)
              ? list.filter((it) => {
                  const dnorm = normalizeUrlForDeletion(it.downloadURL || '');
                  const targetNorm = normalizeUrlForDeletion(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(decoded)}`);
                  // Match by exact storagePath or loose normalization match
                  return (it.storagePath === storagePath) || matchUrlLoose(dnorm, targetNorm);
                })
              : []; 

            Logger.debug('[delete_storage_image_by_url] matchesByStorage count:', matchesByStorage.length);
            const removedParsedIds = [];
            for (const b of matchesByStorage) {
              try {
                await remove(ref(getDb(), `thumbnail_images/${userId}/${b.id}`));
                Logger.info('[delete_storage_image_by_url] metadata removed for parsed storage id:', b.id);
                removedParsedIds.push(b.id);
              } catch (e) {
                Logger.warn('[delete_storage_image_by_url] failed to remove metadata for parsed storage id:', b.id, e && e.message);
              }
            }

            Logger.info('[delete_storage_image_by_url] removed parsed storage metadata ids count:', removedParsedIds.length);

            // Also clear references to this parsed download URL in kanban publishInfo
            try {
              const urlsToClear = new Set();
              const m = String(storagePath || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (m) {
                const bucket2 = m[1];
                const objectPath2 = encodeURIComponent(m[2]);
                const dlUrl2 = `https://firebasestorage.googleapis.com/v0/b/${bucket2}/o/${objectPath2}?alt=media`;
                urlsToClear.add(dlUrl2);
                // Mark tombstone for parsed storage path to avoid immediate re-uploads
                try {
                  await markDeletedThumbnail(userId, decodeURIComponent(m[2]));
                } catch (e) {
                  Logger.debug('[delete_storage_image_by_url] failed to mark tombstone for parsed path:', e && e.message);
                }
              }
              if (url) urlsToClear.add(url);

              const statuses = Object.values(KANBAN_STATUS || {});
              for (const status of statuses) {
                const basePath = `kanban/${userId}/${status}`;
                const snap = await get(basePath);
                const all = snap && snap.val ? snap.val() : null;
                if (!all) continue;

                for (const id in all) {
                  try {
                    const card = all[id];
                    const publish = card && card.publishInfo ? { ...card.publishInfo } : null;
                    let dirty = false;

                    if (publish && Array.isArray(publish.thumbnailInfo)) {
                      const newThumbs = publish.thumbnailInfo.map((t) => {
                        const copy = { ...t };
                        if (copy.bgImage) {
                          const matched = Array.from(urlsToClear).find((u) => matchUrlLoose(copy.bgImage, u));
                          if (matched) {
                            Logger.info('[delete_storage_image_by_url] cleared thumbnailInfo.bgImage match', { card: `${basePath}/${id}`, matched, bgImage: copy.bgImage });
                            copy.bgImage = null;
                            dirty = true;
                          }
                        }
                        if (copy.bgImages && Array.isArray(copy.bgImages)) {
                          const filtered = copy.bgImages.filter((x) => !Array.from(urlsToClear).some((u) => matchUrlLoose(x, u)));
                          if (filtered.length !== copy.bgImages.length) {
                            Logger.info('[delete_storage_image_by_url] cleared thumbnailInfo.bgImages entries for card', `${basePath}/${id}`);
                            copy.bgImages = filtered;
                            dirty = true;
                          }
                        }
                        return copy;
                      });

                      if (dirty) {
                        publish.thumbnailInfo = newThumbs;
                        await update(`${basePath}/${id}`, { publishInfo: publish });
                        Logger.info('[delete_storage_image_by_url] cleared thumbnail refs for card:', `${basePath}/${id}`);
                      }
                    }

                    if (publish && publish.bgImage) {
                      const matched = Array.from(urlsToClear).find((u) => matchUrlLoose(publish.bgImage, u));
                      if (matched) {
                        Logger.info('[delete_storage_image_by_url] cleared publishInfo.bgImage for card', `${basePath}/${id}`);
                        publish.bgImage = null;
                        dirty = true;
                      }
                    }
                    if (publish && Array.isArray(publish.bgImages)) {
                      const filtered = publish.bgImages.filter((x) => !Array.from(urlsToClear).some((u) => matchUrlLoose(x, u)));
                      if (filtered.length !== publish.bgImages.length) {
                        Logger.info('[delete_storage_image_by_url] cleared publishInfo.bgImages entries for card', `${basePath}/${id}`);
                        if (filtered.length === 0) {
                          delete publish.bgImages;
                        } else {
                          publish.bgImages = filtered;
                        }
                        dirty = true;
                      }
                    }

                    if (dirty && !(publish && publish.thumbnailInfo && publish.thumbnailInfo.length === 0)) {
                      await update(`${basePath}/${id}`, { publishInfo: publish });
                      Logger.info('[delete_storage_image_by_url] publishInfo updated for card:', `${basePath}/${id}`);
                    }
                  } catch (e) {
                    Logger.warn('[delete_storage_image_by_url] failed to clear publishInfo refs for card:', `${basePath}/${id}`, e && e.message);
                  }
                }
              }

              // Cleanup pass for parsed path scan: remove empty publish.bgImages arrays
              try {
                const statuses2 = Object.values(KANBAN_STATUS || {});
                for (const status2 of statuses2) {
                  const basePath2 = `kanban/${userId}/${status2}`;
                  const snap2 = await get(basePath2);
                  const all2 = snap2 && snap2.val ? snap2.val() : null;
                  if (!all2) continue;
                  for (const id2 in all2) {
                    try {
                      const card2 = all2[id2];
                      const publish2 = card2 && card2.publishInfo ? { ...card2.publishInfo } : null;
                      if (publish2 && Array.isArray(publish2.bgImages) && publish2.bgImages.length === 0) {
                        const newPublish = { ...publish2 };
                        delete newPublish.bgImages;
                        await update(`${basePath2}/${id2}`, { publishInfo: newPublish });
                        Logger.info('[delete_storage_image_by_url] removed empty publish.bgImages for card (parsed path):', `${basePath2}/${id2}`);
                      }
                    } catch (e) {
                      // ignore per-card cleanup errors
                    }
                  }
                }
              } catch (e) {
                Logger.debug('[delete_storage_image_by_url] parsed-path cleanup pass failed:', e && e.message);
              }
            } catch (e) {
              Logger.warn('[delete_storage_image_by_url] failed to scan/update kanban publishInfo entries for parsed path:', e && e.message);
            }

            return { success: true, removedParsedIds };
          } catch (e) {
            Logger.debug('[delete_storage_image_by_url] failed to parse storage path from url (URL constructor):', e && e.message);
          }

          // If we reached here, we could not find or parse storage metadata/path
          Logger.warn('[delete_storage_image_by_url] uploaded image metadata not found for url:', url);
          return { success: false, error: 'uploaded image metadata not found' };
        } catch (e) {
          Logger.error('[delete_storage_image_by_url] unexpected error:', e && e.message);
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })()
    );
  }

  // Diagnostic: find references to a download URL or filename across thumbnail_images and kanban
  if (msg.action === 'find_url_references') {
    if (!msg || !msg.data || !msg.data.url) {
      return sendResponse({ success: false, error: 'missing url' });
    }

    return handleAsync(
      (async () => {
        const url = String(msg.data.url || '');
        const userId = await getCurrentUserId();
        const targetNorm = normalizeUrlForDeletion(url);
        const results = { thumbnailImages: [], kanban: [] };

        try {
          const list = await getUploadedImagesLog();
          if (Array.isArray(list)) {
            for (const m of list) {
              const dnorm = normalizeUrlForDeletion(m.downloadURL || '');
              const filename = (m.storagePath && String(m.storagePath).split('/').pop()) || (dnorm && dnorm.split('/').pop());
              if (
                dnorm === targetNorm ||
                (dnorm && (dnorm.endsWith(targetNorm) || dnorm.includes(targetNorm))) ||
                (filename && (filename === targetNorm || filename === (String(url).split('/').pop())))
              ) {
                results.thumbnailImages.push({ id: m.id, downloadURL: m.downloadURL, storagePath: m.storagePath });
              }
            }
          }

          const statuses = Object.values(KANBAN_STATUS || {});
          for (const status of statuses) {
            const basePath = `kanban/${userId}/${status}`;
            const snap = await get(basePath);
            const all = snap && snap.val ? snap.val() : null;
            if (!all) continue;

            for (const id in all) {
              try {
                const card = all[id];
                const publish = card && card.publishInfo ? card.publishInfo : null;
                if (!publish) continue;

                if (Array.isArray(publish.thumbnailInfo)) {
                  for (let i = 0; i < publish.thumbnailInfo.length; i++) {
                    const t = publish.thumbnailInfo[i];
                    const bg = t && t.bgImage;
                    if (bg && (normalizeUrlForDeletion(bg) === targetNorm || normalizeUrlForDeletion(bg).includes(targetNorm))) {
                      results.kanban.push({ path: `${basePath}/${id}`, field: `thumbnailInfo[${i}].bgImage`, value: bg });
                    }
                    if (t && Array.isArray(t.bgImages)) {
                      for (let j = 0; j < t.bgImages.length; j++) {
                        const x = t.bgImages[j];
                        if (x && (normalizeUrlForDeletion(x) === targetNorm || normalizeUrlForDeletion(x).includes(targetNorm))) {
                          results.kanban.push({ path: `${basePath}/${id}`, field: `thumbnailInfo[${i}].bgImages[${j}]`, value: x });
                        }
                      }
                    }
                  }
                }

                if (publish.bgImage && (normalizeUrlForDeletion(publish.bgImage) === targetNorm || normalizeUrlForDeletion(publish.bgImage).includes(targetNorm))) {
                  results.kanban.push({ path: `${basePath}/${id}`, field: 'bgImage', value: publish.bgImage });
                }

                if (Array.isArray(publish.bgImages)) {
                  for (let k = 0; k < publish.bgImages.length; k++) {
                    const x = publish.bgImages[k];
                    if (x && (normalizeUrlForDeletion(x) === targetNorm || normalizeUrlForDeletion(x).includes(targetNorm))) {
                      results.kanban.push({ path: `${basePath}/${id}`, field: `bgImages[${k}]`, value: x });
                    }
                  }
                }
              } catch (e) {
                // ignore per-card errors
              }
            }
          }

          Logger.info('[find_url_references] found thumbnailImages:', results.thumbnailImages.length, 'kanbanRefs:', results.kanban.length);
          return { success: true, results };
        } catch (e) {
          Logger.warn('[find_url_references] error during scan:', e && e.message);
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })()
    );
  }

  // Force removal helper: dryRun=true will return planned removals without changing DB
  if (msg.action === 'force_remove_url_references') {
    // Immediate diagnostic log to confirm request arrival
    try {
      Logger.info('[force_remove_url_references] request received (entry):', {
        url: msg && msg.data && msg.data.url,
        dryRun: !!(msg && msg.data && msg.data.dryRun),
        sender: sender && (sender.id || (sender.tab && sender.tab.id) || 'unknown'),
      });
    } catch (e) {
      Logger.debug('[force_remove_url_references] entry logging failed:', e && e.message);
    }

    if (!msg || !msg.data || !msg.data.url) return sendResponse({ success: false, error: 'missing url' });

    return handleAsync(
      (async () => {
        const url = String(msg.data.url || '');
        const dryRun = !!msg.data.dryRun;
        const userId = await getCurrentUserId();
        const targetNorm = normalizeUrlForDeletion(url);
        const toRemove = { thumbnailIds: [], kanbanUpdates: [] };

        try {
          // 1) thumbnail_images matches
          const list = await getUploadedImagesLog();
          if (Array.isArray(list)) {
            for (const m of list) {
              const dnorm = normalizeUrlForDeletion(m.downloadURL || '');
              const filename = (m.storagePath && String(m.storagePath).split('/').pop()) || (dnorm && dnorm.split('/').pop());
              if (
                dnorm === targetNorm ||
                (dnorm && (dnorm.endsWith(targetNorm) || dnorm.includes(targetNorm))) ||
                (filename && (filename === targetNorm || filename === (String(url).split('/').pop())))
              ) {
                toRemove.thumbnailIds.push({ id: m.id, storagePath: m.storagePath, downloadURL: m.downloadURL });
              }
            }
          }

          // 2) kanban publishInfo references
          const statuses = Object.values(KANBAN_STATUS || {});
          for (const status of statuses) {
          }

          // Diagnostics: log planned removals after scan
          Logger.info('[force_remove_url_references] planned counts after scan:', { thumbnailIds: toRemove.thumbnailIds.length, kanbanUpdates: toRemove.kanbanUpdates.length });
          Logger.debug('[force_remove_url_references] planned details:', toRemove);

          // Execute removals early (before kanban updates) to make execution observable & robust in tests
          let removalsExecuted = false;
          if (!dryRun && Array.isArray(toRemove.thumbnailIds) && toRemove.thumbnailIds.length > 0) {
            removalsExecuted = true;
            Logger.info('[force_remove_url_references] executing removals (early), count:', toRemove.thumbnailIds.length);
            for (const t of toRemove.thumbnailIds) {
              Logger.debug('[force_remove_url_references] early removing thumbnail id:', t && t.id, 'storagePath:', t && t.storagePath);
              try {
                if (t.storagePath) {
                  try {
                    await deleteImageFromStorage(t.storagePath);
                    Logger.info('[force_remove_url_references] deleteImageFromStorage called for', t.storagePath);
                  } catch (e) {
                    Logger.warn('[force_remove_url_references] storage delete failed for:', t.storagePath, e && e.message);
                  }
                  try {
                    const m = String(t.storagePath || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
                    if (m) {
                      const objectPath = decodeURIComponent(m[2]);
                      const tombRes = await markDeletedThumbnail(userId, objectPath);
                      Logger.info('[force_remove_url_references] tombstone mark result:', { objectPath, success: !!tombRes });
                    }
                  } catch (e) {
                    Logger.debug('[force_remove_url_references] tombstone mark failed:', e && e.message);
                  }
                }

                try {
                  await remove(ref(getDb(), `thumbnail_images/${userId}/${t.id}`));
                  Logger.info('[force_remove_url_references] removed thumbnail_images entry (early):', t.id);
                } catch (e) {
                  Logger.warn('[force_remove_url_references] failed to remove thumbnail_images id (early):', t.id, e && e.message);
                }
              } catch (e) {
                Logger.debug('[force_remove_url_references] error removing thumbnail id (early):', t.id, e && e.message);
              }
            }
          }

          for (const status of statuses) {
            const basePath = `kanban/${userId}/${status}`;
            const snap = await get(basePath);
            const all = snap && snap.val ? snap.val() : null;
            if (!all) continue;

            for (const id in all) {
              try {
                const card = all[id];
                const publish = card && card.publishInfo ? { ...card.publishInfo } : null;
                if (!publish) continue;
                let dirty = false;

                if (Array.isArray(publish.thumbnailInfo)) {
                  const newThumbs = publish.thumbnailInfo.map((t) => {
                    const copy = { ...t };
                    if (copy.bgImage && (normalizeUrlForDeletion(copy.bgImage) === targetNorm || normalizeUrlForDeletion(copy.bgImage).includes(targetNorm))) {
                      toRemove.kanbanUpdates.push({ path: `${basePath}/${id}`, field: 'thumbnailInfo.bgImage', oldValue: copy.bgImage });
                      copy.bgImage = null;
                      dirty = true;
                    }
                    if (copy.bgImages && Array.isArray(copy.bgImages)) {
                      const filtered = copy.bgImages.filter((x) => !(x && (normalizeUrlForDeletion(x) === targetNorm || normalizeUrlForDeletion(x).includes(targetNorm))));
                      if (filtered.length !== copy.bgImages.length) {
                        toRemove.kanbanUpdates.push({ path: `${basePath}/${id}`, field: 'thumbnailInfo.bgImages', oldValue: copy.bgImages });
                        copy.bgImages = filtered;
                        dirty = true;
                      }
                    }
                    return copy;
                  });

                  if (dirty) {
                    if (!dryRun) await update(`${basePath}/${id}`, { publishInfo: { ...publish, thumbnailInfo: newThumbs } });
                  }
                }

                // top-level bgImage/bgImages
                if (publish && publish.bgImage && (normalizeUrlForDeletion(publish.bgImage) === targetNorm || normalizeUrlForDeletion(publish.bgImage).includes(targetNorm))) {
                  toRemove.kanbanUpdates.push({ path: `${basePath}/${id}`, field: 'bgImage', oldValue: publish.bgImage });
                  if (!dryRun) {
                    publish.bgImage = null;
                  }
                }
                if (publish && Array.isArray(publish.bgImages)) {
                  const filtered = publish.bgImages.filter((x) => !(x && (normalizeUrlForDeletion(x) === targetNorm || normalizeUrlForDeletion(x).includes(targetNorm))));
                  if (filtered.length !== publish.bgImages.length) {
                    toRemove.kanbanUpdates.push({ path: `${basePath}/${id}`, field: 'bgImages', oldValue: publish.bgImages });
                    if (!dryRun) {
                      if (filtered.length === 0) {
                        delete publish.bgImages;
                      } else {
                        publish.bgImages = filtered;
                      }
                    }
                  }
                }

                if (!dryRun && dirty) {
                  await update(`${basePath}/${id}`, { publishInfo: publish });
                  Logger.info('[force_remove_url_references] updated publishInfo for card:', `${basePath}/${id}`);
                }
              } catch (e) {
                Logger.debug('[force_remove_url_references] per-card error:', `${basePath}/${id}`, e && e.message);
              }
            }
          }

          // If not dryRun, actually remove thumbnail_images entries and mark tombstones (skip if already executed earlier)
          if (!dryRun && Array.isArray(toRemove.thumbnailIds) && !removalsExecuted) {
            Logger.info('[force_remove_url_references] entering removal phase, dryRun:', dryRun, 'toRemoveCount:', toRemove.thumbnailIds.length);
            for (const t of toRemove.thumbnailIds) {
              Logger.debug('[force_remove_url_references] removing thumbnail id:', t && t.id, 'storagePath:', t && t.storagePath);
              try {
                if (t.storagePath) {
                  try {
                    await deleteImageFromStorage(t.storagePath);
                    Logger.info('[force_remove_url_references] deleteImageFromStorage called for', t.storagePath);
                  } catch (e) {
                    Logger.warn('[force_remove_url_references] storage delete failed for:', t.storagePath, e && e.message);
                  }
                  try {
                    const m = String(t.storagePath || '').match(/^gs:\/\/([^\/]+)\/(.+)$/);
                    if (m) {
                      const objectPath = decodeURIComponent(m[2]);
                      const tombRes = await markDeletedThumbnail(userId, objectPath);
                      Logger.info('[force_remove_url_references] tombstone mark result:', { objectPath, success: !!tombRes });
                    }
                  } catch (e) {
                    Logger.debug('[force_remove_url_references] tombstone mark failed:', e && e.message);
                  }
                }

                try {
                  await remove(ref(getDb(), `thumbnail_images/${userId}/${t.id}`));
                  Logger.info('[force_remove_url_references] removed thumbnail_images entry:', t.id);
                } catch (e) {
                  Logger.warn('[force_remove_url_references] failed to remove thumbnail_images id:', t.id, e && e.message);
                }
              } catch (e) {
                Logger.debug('[force_remove_url_references] error removing thumbnail id:', t.id, e && e.message);
              }
            }
          }

          Logger.info('[force_remove_url_references] dryRun:', dryRun, 'plannedRemovals:', toRemove);
          return { success: true, dryRun, planned: toRemove };
        } catch (e) {
          Logger.error('[force_remove_url_references] unexpected error:', e && e.message);
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })()
    );
  }

  // Batch delete storage images (delete file in Firebase Storage + DB metadata entry)
  if (msg.action === 'delete_storage_images') {
    return handleAsync(
      (async () => {
        const items = Array.isArray(msg.data && msg.data.items) ? msg.data.items : [];
        const userId = await getCurrentUserId();
        const results = [];

        for (const it of items) {
          try {
            if (!it || !it.id) {
              results.push({ id: it && it.id, success: false, error: 'missing id' });
              continue;
            }

            if (!it.storagePath) {
              Logger.warn('[delete_storage_images] missing storagePath for id:', it.id);
              results.push({ id: it.id, success: false, error: 'missing storagePath' });
              continue;
            }

            try {
              await deleteImageFromStorage(it.storagePath);
            } catch (e) {
              Logger.warn('[delete_storage_images] storage deletion failed for id:', it.id, e && e.message);
              results.push({ id: it.id, success: false, error: e && e.message });
              continue;
            }

            try {
              await remove(ref(getDb(), `thumbnail_images/${userId}/${it.id}`));
            } catch (e) {
              Logger.warn('[delete_storage_images] DB metadata removal failed for id:', it.id, e && e.message);
              results.push({ id: it.id, success: false, error: e && e.message });
              continue;
            }

            results.push({ id: it.id, success: true });
          } catch (e) {
            Logger.warn('[delete_storage_images] item delete failed:', it && it.id, e && e.message);
            results.push({ id: it && it.id, success: false, error: e && e.message });
          }
        }

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
          return { success: false, results };
        }

        return { success: true, results };
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
  Logger.warn(`[Router] 알 수 없는 액션: ${msg.action}`, msg);
  sendResponse({ success: false, error: `Unknown action: ${msg.action}`, info: msg });
  return false;
});

// === [Migration Function] 데이터 마이그레이션 함수 ===
// migrationService.js로 이동됨 - import로 사용
