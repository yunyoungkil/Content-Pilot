// background.js (최종 완성본)

// Firebase 라이브러리 import
importScripts("lib/firebase-app-compat.js", "lib/firebase-database-compat.js");

// --- 1. 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL: "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:1062923832161:web:12dc37c0bfd2fb1ac05320",
};


if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// --- 2. 핵심 이벤트 리스너 ---

// ▼▼▼ [핵심] 누락되었던 아이콘 클릭 이벤트 리스너 복원 ▼▼▼
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    });
  }
});

// 콘텐츠 스크립트로부터 오는 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 스크랩 저장
    if (msg.action === "scrap_element" && msg.data) {
        const scrapRef = firebase.database().ref("scraps").push();
        const scrapPayload = { ...msg.data, timestamp: Date.now() };
        scrapRef.set(scrapPayload).then(() => {
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { action: 'cp_show_preview', data: scrapPayload }, { frameId: 0 });
            }
        }).catch(err => {
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { action: 'cp_show_toast', message: '❌ 스크랩 실패' }, { frameId: 0 });
            }
        });
        return true;
    }
    // 스크랩 목록 요청
    else if (msg.action === "cp_get_firebase_scraps") {
        firebase.database().ref("scraps").once("value", (snapshot) => {
            const val = snapshot.val() || {};
            const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
            sendResponse({ data: arr });
        });
        return true;
    }
    // 스크랩 삭제
    else if (msg.action === "delete_scrap") {
        const scrapIdToDelete = msg.id;
        if (scrapIdToDelete) {
            firebase.database().ref("scraps/" + scrapIdToDelete).remove()
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
        }
        return true;
    }
    // API 키는 chrome.storage에, 나머지 채널 정보는 Firebase에 저장
  else if (msg.action === "save_channels_and_key") {
    const { youtubeApiKey, geminiApiKey, ...channelData } = msg.data;
      // API 키들은 chrome.storage.local에 저장
      chrome.storage.local.set({ youtubeApiKey, geminiApiKey }, () => {
        const userId = 'default_user';
        // 채널 정보는 Firebase에 저장
        firebase.database().ref(`channels/${userId}`).set(channelData)
          .then(() => {
            console.log('New channels saved. Triggering immediate data fetch.');
            fetchAllChannelData(); 
            sendResponse({ success: true });
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
      });
    return true;
  }
  else if (msg.action === "get_channels_and_key") {
      const userId = 'default_user';
      Promise.all([
        chrome.storage.local.get(['youtubeApiKey', 'geminiApiKey']), // Gemini 키도 함께 가져옴
        firebase.database().ref(`channels/${userId}`).once("value")
      ]).then(([storage, snapshot]) => {
        const channelData = snapshot.val() || {};
        const responseData = {
          ...channelData,
          youtubeApiKey: storage.youtubeApiKey,
          geminiApiKey: storage.geminiApiKey // 응답 데이터에 추가
        };
        sendResponse({ success: true, data: responseData });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // 비동기 응답을 위해 true 반환
  }
    // 채널 정보 저장
    else if (msg.action === "save_channels") {
        const userId = 'default_user';
        firebase.database().ref(`channels/${userId}`).set(msg.data)
            .then(() => sendResponse({ success: true, message: '채널 정보가 저장되었습니다.' }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
  
  else if (msg.action === "get_channel_content") {
    const userId = 'default_user';
    Promise.all([
      firebase.database().ref('channel_content').once('value'),
      firebase.database().ref('channel_meta').once('value'),
      firebase.database().ref(`channels/${userId}`).once('value') // 어떤 채널이 '내 채널'인지 확인
    ]).then(([contentSnap, metaSnap, channelsSnap]) => {
      const content = contentSnap.val() || {};
      const metas = metaSnap.val() || {};
      const channels = channelsSnap.val() || {};

      const blogs = Object.values(content.blogs || {});
      const youtubes = Object.values(content.youtubes || {});
      const allContent = [...blogs, ...youtubes];
      
      const responseData = {
        content: allContent,
        metas: metas,
        channels: channels
      };
      
      sendResponse({ success: true, data: responseData });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // 비동기 응답
  }

  else if (msg.action === "get_channel_content") {
    const userId = 'default_user';
    Promise.all([
      firebase.database().ref('channel_content').once('value'),
      firebase.database().ref('channel_meta').once('value'),
      firebase.database().ref(`channels/${userId}`).once('value') // 어떤 채널이 '내 채널'인지 확인
    ]).then(([contentSnap, metaSnap, channelsSnap]) => {
      const content = contentSnap.val() || {};
      const metas = metaSnap.val() || {};
      const channels = channelsSnap.val() || { myChannels: {}, competitorChannels: {} }; // 데이터 없을 시 기본 구조 보장

      const blogs = Object.values(content.blogs || {});
      const youtubes = Object.values(content.youtubes || {});
      const allContent = [...blogs, ...youtubes];
      
      const responseData = {
        content: allContent,
        metas: metas,
        channels: channels
      };
      
      sendResponse({ success: true, data: responseData });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // 비동기 응답
  }
  // ▼▼▼ [추가] AI 채널 분석 요청 처리 ▼▼▼
  else if (msg.action === "analyze_my_channel") {
        const contentData = msg.data;
        const dataSummary = contentData
            .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)) // 조회수 순으로 정렬
            .slice(0, 20) // 성능을 위해 최신/인기 20개 데이터만 사용
            .map(item => `제목: ${item.title}, 조회수: ${item.viewCount || 0}, 좋아요: ${item.likeCount || 0}`)
            .join('\n');

        // callGeminiAPI 함수 호출 (async/await 사용을 위해 즉시 실행 함수로 감싸기)
        (async () => {
            const analysisResult = await callGeminiAPI(dataSummary);
            sendResponse({ success: true, analysis: analysisResult });
        })();
        
        return true; // 비동기 응답임을 명시
  }

   // ▼▼▼ [추가] 콘텐츠 아이디어 생성 요청 처리 ▼▼▼
  else if (msg.action === "generate_content_ideas") {
    const { myContent, competitorContent } = msg.data;

    // 각 채널의 데이터를 요약
    const myDataSummary = myContent
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 10) // 상위 10개 데이터 사용
        .map(item => ` - ${item.title} (조회수: ${item.viewCount})`)
        .join('\n');

    const competitorDataSummary = competitorContent
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 10)
        .map(item => ` - ${item.title} (조회수: ${item.viewCount})`)
        .join('\n');
    
    // Gemini API 호출을 위한 새로운 프롬프트
    const newPrompt = `
        당신은 최고의 유튜브 콘텐츠 전략가입니다. 아래 두 채널의 데이터를 분석하고, 두 채널의 강점을 조합하여 시청자들에게 폭발적인 반응을 얻을 새로운 콘텐츠 아이디어 5가지를 제안해주세요.

        [내 채널의 인기 영상 목록]
        ${myDataSummary}

        [경쟁 채널의 인기 영상 목록]
        ${competitorDataSummary}

        [요청]
        1. 내 채널의 성공 요인과 경쟁 채널의 인기 비결을 각각 한 문장으로 요약해주세요.
        2. 두 채널의 강점을 결합하여 만들 수 있는 새로운 콘텐츠 아이디어 5가지를 제안해주세요.
        3. 각 아이디어는 시청자의 시선을 사로잡을 만한 **매력적인 유튜브 제목** 형식으로 제시하고, 왜 이 아이디어가 성공할 것인지에 대한 간단한 설명을 덧붙여주세요.
        4. 결과는 마크다운 형식으로 보기 좋게 정리해주세요.
    `;

    (async () => {
        // 기존에 만든 callGeminiAPI 함수를 재사용
        const ideasResult = await callGeminiAPI(newPrompt); 
        sendResponse({ success: true, ideas: ideasResult });
    })();
    
    return true; // 비동기 응답
  }
    else if (msg.action === "analyze_video_comments") {
    const videoId = msg.videoId;
    (async () => {
        const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');
        if (!youtubeApiKey) {
            sendResponse({ success: false, error: "YouTube API 키가 설정되지 않았습니다." });
            return;
        }

        // 1. YouTube API로 영상 댓글 가져오기
        // 참고: 댓글 분석은 API 사용량이 많으므로, 결과 개수를 50개 정도로 제한하는 것이 좋습니다.
        const commentsUrl = `https://www.googleapis.com/youtube/v3/commentThreads?key=${youtubeApiKey}&videoId=${videoId}&part=snippet&maxResults=50&order=relevance`;
        
        try {
            const commentsResponse = await fetch(commentsUrl);
            const commentsData = await commentsResponse.json();

            if (commentsData.error) {
                throw new Error(commentsData.error.message);
            }

            const comments = commentsData.items.map(item => item.snippet.topLevelComment.snippet.textOriginal);
            if (comments.length === 0) {
                sendResponse({ success: false, error: "분석할 댓글이 없습니다." });
                return;
            }

            const commentsSummary = comments.join('\n---\n');

            // 2. Gemini API에 전달할 새로운 프롬프트
            const commentAnalysisPrompt = `
                당신은 데이터 분석가이자 콘텐츠 전략가입니다. 아래는 특정 유튜브 영상에 달린 시청자들의 댓글 모음입니다. 이 댓글들을 분석하여 채널 운영자에게 유용한 인사이트와 새로운 콘텐츠 아이디어를 제공해주세요.

                [댓글 데이터]
                ${commentsSummary}

                [분석 및 제안 요청]
                1. **핵심 니즈 파악**: 댓글에서 공통적으로 나타나는 시청자들의 질문, 문제점, 또는 원하는 정보를 3가지 핵심 주제로 요약해주세요.
                2. **콘텐츠 아이디어 제안**: 위에서 파악한 니즈를 해결해 줄 수 있는 새로운 유튜브 영상 아이디어 3가지를 제안해주세요.
                3. 각 아이디어는 **매력적인 유튜브 제목**과 **영상의 핵심 내용을 설명하는 짧은 문장**을 포함해야 합니다.
                4. 결과는 마크다운 형식으로 보기 좋게 정리해주세요.
            `;

            // 3. Gemini API 호출 및 결과 반환
            const analysisResult = await callGeminiAPI(commentAnalysisPrompt);
            sendResponse({ success: true, analysis: analysisResult });

        } catch (error) {
            console.error("Error fetching or analyzing comments:", error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    
    return true; // 비동기 응답
  }
});


// --- 3. 주기적 데이터 수집 로직 ---

// 확장 프로그램 설치 시 기본값 설정 및 알람 생성
chrome.runtime.onInstalled.addListener(() => {
    console.log("Content Pilot installed. Setting up alarm.");
    chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
    chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
});

// 브라우저 시작 시 알람 생성
chrome.runtime.onStartup.addListener(() => {
    console.log("Content Pilot started. Setting up alarm.");
    // onStartup에서는 onInstalled에서 이미 생성된 알람이 유지될 수 있으므로,
    // 필요에 따라 알람이 있는지 확인하고 생성하는 로직을 추가할 수 있습니다.
    chrome.alarms.get('fetch-channels', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
        }
    });
});

// 알람 수신 시 데이터 수집 실행
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'fetch-channels') {
        console.log("Alarm triggered: Fetching all channel data...");
        fetchAllChannelData();
    }
});


// --- 4. 데이터 수집 함수들 ---
function fetchAllChannelData() {
    const userId = 'default_user';
    firebase.database().ref(`channels/${userId}`).once('value', (snapshot) => {
        const channels = snapshot.val();
        if (!channels) {
            console.log('No channels configured.');
            return;
        }
        ['myChannels', 'competitorChannels'].forEach(type => {
            if (channels[type]) {
                channels[type].blogs?.forEach(url => fetchRssFeed(url, type));
                channels[type].youtubes?.forEach(id => fetchYoutubeChannel(id, type));
            }
        });
    });
}

async function fetchRssFeed(url, channelType) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();
        
        // ... (channelTitle, sourceId 추출 로직은 그대로) ...
        const channelTitleMatch = text.match(/<channel>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<\/channel>/) || text.match(/<channel>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/channel>/);
        const channelTitle = channelTitleMatch ? channelTitleMatch[1] : url;
        const sourceId = btoa(url).replace(/=/g, '');
        firebase.database().ref(`channel_meta/${sourceId}`).set({ title: channelTitle, type: 'blog', source: url });

        const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
        for (const itemText of items) {
            const titleMatch = itemText.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || itemText.match(/<title>(.*?)<\/title>/);
            const linkMatch = itemText.match(/<link>(.*?)<\/link>/);
            const pubDateMatch = itemText.match(/<pubDate>(.*?)<\/pubDate>/);
            
            // ▼▼▼ [핵심 수정] 데이터가 하나라도 없으면 이 항목은 건너뜀 ▼▼▼
            if (!titleMatch || !linkMatch || !pubDateMatch) {
                continue; 
            }

            const title = titleMatch[1];
            const link = linkMatch[1];
            const pubDateStr = pubDateMatch[1];
            const timestamp = new Date(pubDateStr).getTime();

            // ▼▼▼ [핵심 수정] 날짜가 유효하지 않으면 이 항목은 건너뜀 ▼▼▼
            if (isNaN(timestamp)) {
                continue;
            }
            
            // ... (description, thumbnail 추출 로직은 그대로) ...
            const descriptionMatch = itemText.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || itemText.match(/<description>(.*?)<\/description>/);
            const description = descriptionMatch ? descriptionMatch[1].trim() : '';
            let thumbnail = '';
            // ... (썸네일 추출 로직)

            const contentId = btoa(link).replace(/=/g, '');
            firebase.database().ref(`channel_content/blogs/${contentId}`).set({
                title, link, description, thumbnail,
                pubDate: timestamp,
                sourceId: sourceId,
                channelType: channelType,
                fetchedAt: Date.now()
            });
        }
        console.log(`Successfully parsed RSS for: ${url}`);
    } catch (error) {
        console.error(`Failed to fetch or parse RSS for ${url}:`, error);
    }
}


async function fetchYoutubeChannel(channelId, channelType) {
    const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');

    if (!youtubeApiKey) {
        console.warn('YouTube API Key is not set in storage. Skipping YouTube fetch.');
        return;
    }
    
    // 채널 메타 정보 수집
    const channelInfoUrl = `https://www.googleapis.com/youtube/v3/channels?key=${youtubeApiKey}&id=${channelId}&part=snippet`;
    try {
        const channelInfoResponse = await fetch(channelInfoUrl);
        const channelInfoData = await channelInfoResponse.json();
        if (channelInfoData.items && channelInfoData.items.length > 0) {
            const channelTitle = channelInfoData.items[0].snippet.title;
            firebase.database().ref(`channel_meta/${channelId}`).set({
                title: channelTitle,
                type: 'youtube',
                source: channelId
            });
        }
    } catch(error) {
        console.error(`Failed to fetch YouTube channel info for ${channelId}:`, error);
    }

     // 1. 채널의 최신 동영상 ID 목록 가져오기
    const videoListUrl = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`;
    try {
        const videoListResponse = await fetch(videoListUrl);
        const videoListData = await videoListResponse.json();
        if (!videoListData.items) {
            console.error(`Error fetching YouTube video list for ${channelId}:`, videoListData.error?.message || 'Unknown error');
            return;
        }

        const videoIds = videoListData.items.map(item => item.id.videoId).filter(Boolean);
        if (videoIds.length === 0) return;

        // 2. 동영상 ID들을 사용하여 상세 정보(성과 지표 포함) 한 번에 요청
        const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoIds.join(',')}&part=snippet,statistics`;
        const detailsResponse = await fetch(videoDetailsUrl);
        const detailsData = await detailsResponse.json();
        
        if (detailsData.items) {
            detailsData.items.forEach(item => {
                const { id, snippet, statistics } = item;
                const timestamp = new Date(snippet.publishedAt).getTime();
                
                const video = {
                    videoId: id,
                    title: snippet.title,
                    description: snippet.description,
                    publishedAt: timestamp,
                    thumbnail: snippet.thumbnails?.default?.url,
                    viewCount: statistics?.viewCount ? parseInt(statistics.viewCount, 10) : 0,
                    likeCount: statistics?.likeCount ? parseInt(statistics.likeCount, 10) : 0,
                    commentCount: statistics?.commentCount ? parseInt(statistics.commentCount, 10) : 0,
                    channelId: channelId,
                    sourceId: channelId,
                    channelType: channelType,
                    fetchedAt: Date.now()
                };
                firebase.database().ref(`channel_content/youtubes/${video.videoId}`).set(video);
            });
            console.log(`Successfully fetched YouTube details for channel: ${channelId}`);
        }
    } catch (error) {
        console.error(`Failed to fetch YouTube channel ${channelId}:`, error);
    }
}


// ▼▼▼ [수정] Gemini API 호출 함수 (에러 핸들링 강화) ▼▼▼
// background.js 파일의 기존 callGeminiAPI 함수를 아래 내용으로 전체 교체하세요.

async function callGeminiAPI(dataSummary) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) {
            return "오류: Gemini API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
        }

        // ▼▼▼ [핵심 수정] curl 명령어와 동일한 'gemini-2.0-flash' 모델을 사용하도록 최종 변경 ▼▼▼
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

        const prompt = `
            당신은 전문 콘텐츠 전략가입니다. 아래 제공되는 유튜브 채널의 영상 데이터 목록을 분석해주세요.

            [데이터]
            ${dataSummary}

            [분석 요청]
            1. 어떤 주제의 영상들이 가장 높은 조회수와 좋아요를 기록했나요? (상위 3개 주제)
            2. 성공적인 영상들의 제목이나 내용에서 나타나는 공통적인 패턴이나 키워드는 무엇인가요?
            3. 위 분석 결과를 바탕으로, 이 채널이 다음에 만들면 성공할 만한 새로운 콘텐츠 아이디어 3가지를 구체적인 제목 예시와 함께 제안해주세요.

            결과는 한국어로, 친절하고 이해하기 쉬운 보고서 형식으로 작성해주세요.
        `;

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Gemini API Error Details:", JSON.stringify(errorData, null, 2)); 
            const errorMessage = errorData.error?.message || "자세한 내용은 서비스 워커 콘솔을 확인하세요.";
            return `오류: Gemini API 호출에 실패했습니다.\n상태: ${response.status}\n원인: ${errorMessage}`;
        }

        const responseData = await response.json();
        
        if (!responseData.candidates || !responseData.candidates[0]?.content?.parts[0]?.text) {
            console.error("Unexpected Gemini API response structure:", responseData);
            return "오류: AI로부터 예상치 못한 형식의 응답을 받았습니다.";
        }
        
        return responseData.candidates[0].content.parts[0].text;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return "오류: AI 분석 중 예외가 발생했습니다. 개발자 콘솔을 확인해주세요.";
    }
}