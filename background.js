// background.js (최종 패치: Firebase 라이브러리 로딩 경로 수정)

// Firebase 라이브러리 import
// dist/background.bundle.js에서 상위 폴더(..)의 lib 폴더를 참조하도록 경로를 수정합니다.
importScripts("../lib/firebase-app-compat.js", "../lib/firebase-database-compat.js");

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

// --- URL Resolution Helpers (G-1 구현: 일반 URL -> RSS 주소/채널 ID 변환 로직) ---

/**
 * 블로그 일반 URL에서 RSS 피드 주소를 추출합니다.
 * 플랫폼별 패턴을 먼저 시도하여 안정성을 높입니다.
 * @param {string} url - 사용자가 입력한 블로그 URL
 * @returns {Promise<string|null>} - 추출된 RSS 주소 또는 null
 */
async function resolveBlogUrl(url) {
    if (!url || !url.startsWith('http')) return null;

    let urlObj;
    try {
        urlObj = new URL(url);
    } catch (e) {
        return null; // 유효하지 않은 URL
    }
    const host = urlObj.hostname.toLowerCase();
    const origin = urlObj.origin;

    // 1. 플랫폼 기반의 명시적인 RSS 주소 패턴 시도 (Naver, Blogspot 고유 패턴 적용)
    let platformRssPath = null;
    
    // Tistory 패턴 적용: /rss
    if (host.includes('tistory.com')) {
        platformRssPath = urlObj.pathname.endsWith('/') ? 'rss' : '/rss';
    } 
    // Naver Blog 패턴 적용: ID 추출 후 고유 XML URL 생성
    else if (host.includes('blog.naver.com')) {
        let naverId = null;

        // 1. URL 경로에서 ID 추출 (예: /masteri0100)
        const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
        if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
            naverId = pathMatch[1];
        }
        
        // 2. 경로에서 추출 실패 시 쿼리 파라미터에서 ID 추출 (예: ?blogId=masteri0100)
        if (!naverId) {
            const params = new URLSearchParams(urlObj.search);
            naverId = params.get('blogId');
        }

        if (naverId) {
            // Naver의 고유 RSS 패턴을 따르는 URL 생성 후 즉시 반환
            return `https://rss.blog.naver.com/${naverId}.xml`;
        }
        platformRssPath = '/rss'; // ID 추출 실패 시 대체 경로 시도 (낮은 확률)
    }

    // WordPress, Medium 등 /feed 패턴 적용
    else if (host.includes('wordpress.com') || host.includes('medium.com')) {
        platformRssPath = '/feed';
    }
    // Blogspot/Blogger 명시적 대응: /feeds/posts/default?alt=rss
    else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
        platformRssPath = '/feeds/posts/default?alt=rss';
    }

    // 명시적 패턴이 발견되면, 최종 RSS URL을 생성하여 반환 (최우선)
    if (platformRssPath) {
        let finalUrl = platformRssPath.startsWith('/') ? origin + platformRssPath : origin + '/' + platformRssPath;
        return finalUrl;
    }
    
    // 2. (Fallback) HTML Fetch 및 <link> 태그 분석 (표준 방식 - 2차 도메인 등)
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP 오류! 상태: ${response.status}`);
        const html = await response.text();

        // 표준 RSS link 태그 패턴 검색
        const rssMatch = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']application\/rss\+xml["'][^>]*href=["']([^"']*)["'][^>]*>/i) ||
                        html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']application\/atom\+xml["'][^>]*href=["']([^"']*)["'][^>]*>/i);

        if (rssMatch && rssMatch[1]) {
            let rssUrl = rssMatch[1];
            // 상대 경로를 절대 경로로 변환 처리
            if (rssUrl.startsWith('//')) {
                rssUrl = `https:${rssUrl}`;
            } else if (rssUrl.startsWith('/')) {
                rssUrl = `${urlObj.protocol}//${urlObj.host}${rssUrl}`;
            }
            return rssUrl;
        }

        // 3. (Final Fallback) 일반적인 /feed 경로 시도 
        const fallbackUrl = url.endsWith('/') ? url + 'feed' : url + '/feed';
        return fallbackUrl;
    } catch (error) {
        console.error(`RSS 주소 확인 실패 (${url}):`, error);
        return null;
    }
}

/**
 * 유튜브 일반 URL에서 채널 ID(UC...)를 추출하거나 API를 통해 변환합니다. (G-1 A/C-2)
 * 영상 재생 주소(watch?v=)까지 처리하도록 보완되었습니다.
 * @param {string} url - 사용자가 입력한 유튜브 URL 또는 ID
 * @param {string} apiKey - YouTube Data API 키
 * @returns {Promise<string|null>} - 추출된 채널 ID 또는 null
 */
async function resolveYoutubeUrl(url, apiKey) {
    if (!url || !url.startsWith('http')) {
        // 'UC'로 시작하는 24자리 문자열이면 이미 채널 ID로 간주
        if (url.startsWith('UC') && url.length === 24) return url;
        return null;
    }
    
    let path = '';
    let urlObj;
    try {
        urlObj = new URL(url);
        path = urlObj.pathname;
    } catch (e) {
        return null;
    }

    // 1. [보완 로직] 영상 주소 (watch?v=) 처리
    if (path.includes('/watch') || path.includes('/embed')) {
        const videoId = urlObj.searchParams.get('v'); // 'v' 파라미터에서 Video ID 추출
        if (videoId && apiKey) {
            // videos 엔드포인트를 사용하여 Channel ID 검색
            const videoApi = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
            try {
                const response = await fetch(videoApi);
                const data = await response.json();
                
                if (data.items && data.items.length > 0) {
                    return data.items[0].snippet.channelId; // Channel ID 반환
                }
            } catch (error) {
                console.error(`Video URL에서 채널 ID 변환 실패 (${videoId}):`, error);
                return null;
            }
        }
    }


    // 2. [기존 로직] 채널 주소 기반 ID 추출 (/@handle, /user, /channel)
    let identifier = null;
    let endpoint = null;
    const channelIdMatch = path.match(/\/channel\/([UC|c][a-zA-Z0-9_-]{22,24})/i);
    const handleMatch = path.match(/\/@([a-zA-Z0-9_-]+)/i);
    const userMatch = path.match(/\/user\/([a-zA-Z0-9_-]+)/i);

    // 이미 채널 ID가 URL에 포함된 경우 바로 반환
    if (channelIdMatch && channelIdMatch[1]) {
        return channelIdMatch[1];
    } 
    // 핸들 URL (@handle)인 경우
    else if (handleMatch && handleMatch[1]) {
        identifier = handleMatch[1];
        endpoint = `forHandle=@${identifier}`; // forHandle 파라미터 사용
    } 
    // 사용자 이름 URL (/user/username)인 경우
    else if (userMatch && userMatch[1]) {
        identifier = userMatch[1];
        endpoint = `forUsername=${identifier}`; // forUsername 파라미터 사용
    } else {
        // 유효한 형태가 아니면 null 반환
        return null;
    }

    // 3. [기존 로직] API 호출을 통해 핸들/사용자 이름 변환
    if (endpoint && apiKey) {
        const api = `https://www.googleapis.com/youtube/v3/channels?part=id&${endpoint}&key=${apiKey}`;
        try {
            const response = await fetch(api);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                return data.items[0].id; 
            }
        } catch (error) {
            console.error(`YouTube API를 통한 ID 변환 실패 (${identifier}):`, error);
            return null;
        }
    }
    
    return null;
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
    // ▼▼▼ [추가] 블로그 콘텐츠 데이터 전체 삭제 기능 ▼▼▼
    else if (msg.action === "clear_blog_content") {
        firebase.database().ref('channel_content/blogs').remove()
            .then(() => sendResponse({ success: true, message: '블로그 콘텐츠 데이터가 성공적으로 삭제되었습니다. 새로고침 후 재수집해주세요.' }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; 
    }
    // ▲▲▲ [추가 끝] ▲▲▲
    // API 키 및 채널 정보 저장 (G-1 로직 적용)
  else if (msg.action === "save_channels_and_key") {
    const { youtubeApiKey, geminiApiKey, ...channelData } = msg.data;
      
      // 1. API 키들은 chrome.storage.local에 저장
      chrome.storage.local.set({ youtubeApiKey, geminiApiKey }, async () => {
        const userId = 'default_user';
        const apiKey = youtubeApiKey; // YouTube API 키를 URL 변환에 사용

        const resolvedChannels = {
            myChannels: { blogs: [], youtubes: [] },
            competitorChannels: { blogs: [], youtubes: [] }
        };

        // 2. URL Resolution Logic 실행 (G-1 구현)
        for (const type of ['myChannels', 'competitorChannels']) {
            // 블로그 처리: URL -> RSS Feed URL로 변환
            if (channelData[type]?.blogs) {
                const blogPromises = channelData[type].blogs
                    .filter(url => url.trim().length > 0)
                    .map(url => resolveBlogUrl(url.trim()));
                const results = await Promise.all(blogPromises);
                resolvedChannels[type].blogs = results.filter(url => url !== null); // null 값 필터링
            }

            // 유튜브 처리: URL -> 채널 ID로 변환
            if (channelData[type]?.youtubes) {
                const youtubePromises = channelData[type].youtubes
                    .filter(url => url.trim().length > 0)
                    .map(url => resolveYoutubeUrl(url.trim(), apiKey));
                const results = await Promise.all(youtubePromises);
                // 변환된 채널 ID (UC...)만 저장
                resolvedChannels[type].youtubes = results.filter(id => id !== null); 
            }
        }
        
        // 3. 변환이 완료된 채널 정보를 Firebase에 저장
        firebase.database().ref(`channels/${userId}`).set(resolvedChannels)
          .then(() => {
            console.log('새 채널이 저장되었습니다. 즉시 데이터 수집을 시작합니다.');
            fetchAllChannelData(); // 데이터 수집 즉시 실행
            sendResponse({ success: true, message: '채널 및 API 키 정보가 성공적으로 저장되었습니다.' });
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
      });
    return true; // 비동기 응답을 위해 true 반환
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
    // 채널 정보 저장 (레거시 코드, save_channels_and_key로 통합됨)
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
    
    return true; // 비동기 응답을 위해 true 반환
  }
    // ▼▼▼ [G-5 백그라운드 로직 패치] 메시지 리스너 추가 ▼▼▼
    else if (msg.action === "refresh_channel_data") {
      const { sourceId, platform } = msg;
      
      const userId = 'default_user';
      firebase.database().ref(`channels/${userId}`).once('value', snapshot => {
        const channels = snapshot.val();
        if (!channels) {
            sendResponse({ success: false, error: '설정된 채널이 없습니다.' });
            return;
        }

        let urlToFetch = null;
        if (platform === 'blog') {
            const allUrls = channels.myChannels?.blogs || [];
            urlToFetch = allUrls.find(url => btoa(url).replace(/=/g, '') === sourceId);
            if (urlToFetch) {
                fetchRssFeed(urlToFetch, 'myChannels');
            }
        } else if (platform === 'youtube') {
            const allIds = channels.myChannels?.youtubes || [];
            urlToFetch = allIds.find(id => id === sourceId);
            if (urlToFetch) {
                fetchYoutubeChannel(urlToFetch, 'myChannels');
            }
        }

        if (urlToFetch) {
            sendResponse({ success: true, message: '데이터 수집을 시작합니다.' });
        } else {
            sendResponse({ success: false, error: '요청한 채널을 찾을 수 없습니다.' });
        }
      });
      return true; // 비동기 응답
    }
    // ▲▲▲ [G-5 백그라운드 로직 패치 끝] ▲▲▲
  // AI 채널 분석 요청 처리
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

   // 콘텐츠 아이디어 생성 요청 처리
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
    
    return true; // 비동기 응답임을 명시
  }
    // 유튜브 댓글 분석 요청 처리
    else if (msg.action === "analyze_video_comments") {
    const videoId = msg.videoId;
    (async () => {
        const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');
        if (!youtubeApiKey) {
            sendResponse({ success: false, error: "YouTube API 키가 설정되지 않았습니다." });
            return;
        }

        // 1. YouTube API로 영상 댓글 가져오기 (댓글 분석은 API 사용량이 많으므로, 결과 개수를 50개로 제한)
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
            console.error("댓글 조회 또는 분석 중 오류 발생:", error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    
    return true; // 비동기 응답임을 명시
  }
});


// --- 3. 주기적 데이터 수집 로직 ---

// 확장 프로그램 설치 시 기본값 설정 및 알람 생성
chrome.runtime.onInstalled.addListener(() => {
    console.log("Content Pilot 설치됨. 알람을 설정합니다.");
    chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
    chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
});

// 브라우저 시작 시 알람 생성
chrome.runtime.onStartup.addListener(() => {
    console.log("Content Pilot 시작됨. 알람을 확인/설정합니다.");
    // 알람이 없으면 새로 생성
    chrome.alarms.get('fetch-channels', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
        }
    });
});

// 알람 수신 시 데이터 수집 실행
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'fetch-channels') {
        console.log("알람 발생: 모든 채널 데이터를 수집합니다...");
        fetchAllChannelData();
    }
});


// --- 4. 데이터 수집 함수들 ---
function fetchAllChannelData() {
    const userId = 'default_user';
    firebase.database().ref(`channels/${userId}`).once('value', (snapshot) => {
        const channels = snapshot.val();
        if (!channels) {
            console.log('설정된 채널 정보가 없습니다.');
            return;
        }
        // 내 채널과 경쟁 채널 모두에 대해 데이터 수집 시작
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
        if (!response.ok) throw new Error(`HTTP 오류! 상태: ${response.status}`);
        const text = await response.text();
        
        // 채널 제목 및 소스 ID 추출
        const channelTitleMatch = text.match(/<channel>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<\/channel>/) || text.match(/<channel>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/channel>/);
        const channelTitle = channelTitleMatch ? channelTitleMatch[1] : url;
        const sourceId = btoa(url).replace(/=/g, '');
        // ▼▼▼ [G-5 백그라운드 로직 패치] channel_meta에 fetchedAt 기록 ▼▼▼
        firebase.database().ref(`channel_meta/${sourceId}`).set({ title: channelTitle, type: 'blog', source: url, fetchedAt: Date.now() });
        // ▲▲▲ [G-5 백그라운드 로직 패치 끝]

        // 개별 포스트 아이템 추출 및 파싱
        const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
        
        for (const itemText of items) {
            // 정규식 매칭 함수 정의
            const matchAndClean = (regex) => {
                const match = itemText.match(regex);
                if (match && match[1]) {
                    return match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
                }
                return null;
            };

            const title = matchAndClean(/<title>(.*?)<\/title>/);
            const linkMatch = itemText.match(/<link>([\s\S]*?)<\/link>/i); 
            let link = null;
            if (linkMatch && linkMatch[1]) {
                link = linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
            }
            const pubDateStr = matchAndClean(/<pubDate>(.*?)<\/pubDate>/) || matchAndClean(/<atom:updated>(.*?)<\/atom:updated>/);
            
            if (!title || !link || !pubDateStr) {
                continue; 
            }

            const timestamp = new Date(pubDateStr).getTime();
            if (isNaN(timestamp)) {
                continue;
            }
            
            const description = matchAndClean(/<description>(.*?)<\/description>/);
            
            let thumbnail = '';
            let imageAlt = '';

            const contentEncodedMatch = itemText.match(/<content:encoded>(.*?)<\/content:encoded>/s);
            const contentToAnalyze = contentEncodedMatch ? contentEncodedMatch[1] : description;

            const encodedImgMatch = contentToAnalyze.match(/<img[^>]*src=&quot;([^&]*)&quot;/i);
            if (encodedImgMatch && encodedImgMatch[1]) {
                thumbnail = encodedImgMatch[1];
                const altMatch = contentToAnalyze.match(/alt=&quot;([^&]*)&quot;/i);
                if (altMatch && altMatch[1]) {
                    imageAlt = altMatch[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                }
            } else {
                const standardImgMatch = contentToAnalyze.match(/<img[^>]*src=["']([^"']*)["']/i);
                if (standardImgMatch && standardImgMatch[1]) {
                    thumbnail = standardImgMatch[1];
                    const standardAltMatch = contentToAnalyze.match(/alt=["']([^"']*)["']/i);
                    if (standardAltMatch && standardAltMatch[1]) {
                        imageAlt = standardAltMatch[1];
                    }
                }
            }
            
            let tags = '';
            const categoryMatches = itemText.match(/<category>(.*?)<\/category>/ig);
            
            if (categoryMatches) {
                tags = categoryMatches.map(m => {
                    let tagContent = m.replace(/<!\[CDATA\[|\]\]>/g, '');
                    const contentMatch = tagContent.match(/<category[^>]*>(.*?)<\/category>/i);
                    return contentMatch ? contentMatch[1].trim() : '';
                }).filter(t => t.length > 0).join(',');
            }
            if (!tags) {
                const tagMatch = itemText.match(/<tag><!\[CDATA\[(.*?)\]\]><\/tag>/);
                if (tagMatch) {
                    tags = tagMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
                }
            }

            const contentId = btoa(link).replace(/=/g, '');
            firebase.database().ref(`channel_content/blogs/${contentId}`).set({
                title, link, description, thumbnail, tags, imageAlt,
                pubDate: timestamp,
                sourceId: sourceId,
                channelType: channelType,
                fetchedAt: Date.now()
            });
        }
        console.log(`RSS 피드 파싱 성공: ${url}`);
    } catch (error) {
        console.error(`RSS 피드 조회 또는 파싱 실패 (${url}):`, error);
    }
}


async function fetchYoutubeChannel(channelId, channelType) {
    const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');

    if (!youtubeApiKey) {
        console.warn('YouTube API 키가 설정되지 않았습니다. YouTube 데이터 수집을 건너킵니다.');
        return;
    }
    
    // 채널 메타 정보 수집
    const channelInfoUrl = `https://www.googleapis.com/youtube/v3/channels?key=${youtubeApiKey}&id=${channelId}&part=snippet`;
    try {
        const channelInfoResponse = await fetch(channelInfoUrl);
        const channelInfoData = await channelInfoResponse.json();
        if (channelInfoData.items && channelInfoData.items.length > 0) {
            const channelTitle = channelInfoData.items[0].snippet.title;
            // ▼▼▼ [G-5 백그라운드 로직 패치] channel_meta에 fetchedAt 기록 ▼▼▼
            firebase.database().ref(`channel_meta/${channelId}`).set({
                title: channelTitle,
                type: 'youtube',
                source: channelId,
                fetchedAt: Date.now()
            });
            // ▲▲▲ [G-5 백그라운드 로직 패치 끝]
        }
    } catch(error) {
        console.error(`YouTube 채널 정보 조회 실패 (${channelId}):`, error);
    }

     // 1. 채널의 최신 동영상 ID 목록 가져오기 (최대 10개)
    const videoListUrl = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`;
    try {
        const videoListResponse = await fetch(videoListUrl);
        const videoListData = await videoListResponse.json();
        if (!videoListData.items) {
            console.error(`YouTube 영상 목록 조회 오류 (${channelId}):`, videoListData.error?.message || '알 수 없는 오류');
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
                    fetchedAt: Date.now() // G-5: 콘텐츠 아이템에도 수집 시간 기록
                };
                firebase.database().ref(`channel_content/youtubes/${video.videoId}`).set(video);
            });
            console.log(`YouTube 채널 상세 정보 수집 성공: ${channelId}`);
        }
    } catch (error) {
        console.error(`YouTube 채널 데이터 수집 실패 (${channelId}):`, error);
    }
}


// Gemini API 호출 함수 (AI 분석용)
async function callGeminiAPI(dataSummary) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) {
            return "오류: Gemini API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
        }

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
            console.error("Gemini API 오류 상세:", JSON.stringify(errorData, null, 2)); 
            const errorMessage = errorData.error?.message || "자세한 내용은 서비스 워커 콘솔을 확인하세요.";
            return `오류: Gemini API 호출에 실패했습니다.\n상태: ${response.status}\n원인: ${errorMessage}`;
        }

        const responseData = await response.json();
        
        if (!responseData.candidates || !responseData.candidates[0]?.content?.parts[0]?.text) {
            console.error("예상치 못한 Gemini API 응답 구조:", responseData);
            return "오류: AI로부터 예상치 못한 형식의 응답을 받았습니다.";
        }
        
        return responseData.candidates[0].content.parts[0].text;

    } catch (error) {
        console.error("Gemini API 호출 중 오류 발생:", error);
        return "오류: AI 분석 중 예외가 발생했습니다. 개발자 콘솔을 확인해주세요.";
    }
}