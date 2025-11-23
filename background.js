// background.js (Final Router Version)

import { getDb, CONSTANTS, initializeFirebase, uploadImageToFirebaseStorage } from './js/services/firebaseService.js';

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
  revokeGoogleAuth 
} from './js/services/authService.js';

import { ref, update, remove, set, get, push, serverTimestamp } from 'firebase/database';

// Firebase 초기화
initializeFirebase();

console.log("🚀 [System] Service Worker Started (Lightweight Router)");

// 0. 확장 프로그램 아이콘 클릭 리스너
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[sendMessage] 메시지 전송 실패:", chrome.runtime.lastError.message);
      }
    });
  }
});

// 1. 알람 리스너 (스케줄러)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetch-channels") {
    console.log("⏰ [Alarm] 채널 데이터 수집 시작");
    fetchAllChannelData();
  } else if (alarm.name === "update-performance-metrics") {
    console.log("⏰ [Alarm] 성과 지표 업데이트 시작");
    updateAllPerformanceMetrics();
  }
});

// 2. 설치/업데이트 리스너
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    console.log(`[System] Extension ${details.reason}d. Registering alarms...`);
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
  // 비동기 응답 처리를 위한 헬퍼
  const handleAsync = (promise) => {
    promise
      .then(data => sendResponse(data || { success: true }))
      .catch(err => {
        console.error(`[Router Error] ${msg.action}:`, err);
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

  if (msg.action === "get_kanban_data" || msg.action === "get_all_kanban_data") {
    const dbRef = ref(getDb(), `kanban/${CONSTANTS.USER_ID}`);
    return handleAsync(get(dbRef).then(snap => {
      // 실시간 리스너 등록 (기존 로직 유지)
      // ... (생략: 필요 시 추가 구현)
      return { success: true, data: snap.val() || {} };
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
  console.warn(`[Router] 알 수 없는 액션: ${msg.action}`);
  sendResponse({ success: false, error: `Unknown action: ${msg.action}` });
  return false;
});
