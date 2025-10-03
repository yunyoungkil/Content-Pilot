// background.js (유튜브 채널 ID 변환 로직 최종 수정 완료)

/**
 * 객체 내의 모든 undefined 값을 재귀적으로 제거(null로 변환)하는, 더 안정적인 함수.
 * Firebase에 저장하기 전 데이터를 정제하는 데 사용됩니다.
 * @param {any} data - 정제할 객체, 배열, 또는 원시 값
 * @returns {any} - undefined가 제거된 데이터
 */
function cleanDataForFirebase(data) {
    if (data === undefined) {
        return null;
    }
    if (data === null || typeof data !== 'object') {
        return data; // null, string, number, boolean 등은 그대로 반환
    }
    if (Array.isArray(data)) {
        // 배열인 경우, 각 항목을 재귀적으로 처리
        return data.map(item => cleanDataForFirebase(item));
    }
    // 일반 객체인 경우, 각 속성을 재귀적으로 처리
    const cleanedObj = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const value = data[key];
            // 값이 undefined가 아닐 때만 새로운 객체에 추가
            if (value !== undefined) {
                cleanedObj[key] = cleanDataForFirebase(value);
            }
        }
    }
    return cleanedObj;
}

let creating; // Offscreen Document 생성 중인지 확인하는 플래그

// Offscreen Document를 생성하고 가져오는 헬퍼 함수
async function getOffscreenDocument() {
    if (await chrome.offscreen.hasDocument()) {
        return;
    }
    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_PARSER'],
            justification: 'HTML 문자열을 파싱하기 위함',
        });
        await creating;
        creating = null;
    }
}
// Firebase 라이브러리 import
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

// --- URL Resolution Helpers ---

async function resolveBlogUrl(url) {
    if (!url || !url.startsWith('http')) return null;
    let urlObj;
    try {
        urlObj = new URL(url);
    } catch (e) {
        return null;
    }
    const host = urlObj.hostname.toLowerCase();
    const origin = urlObj.origin;
    let platformRssPath = null;
    if (host.includes('tistory.com')) {
        platformRssPath = urlObj.pathname.endsWith('/') ? 'rss' : '/rss';
    } else if (host.includes('blog.naver.com')) {
        let naverId = null;
        const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
        if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
            naverId = pathMatch[1];
        }
        if (!naverId) {
            const params = new URLSearchParams(urlObj.search);
            naverId = params.get('blogId');
        }
        if (naverId) {
            return `https://rss.blog.naver.com/${naverId}.xml`;
        }
        platformRssPath = '/rss';
    } else if (host.includes('wordpress.com') || host.includes('medium.com')) {
        platformRssPath = '/feed';
    } else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
        platformRssPath = '/feeds/posts/default?alt=rss';
    }
    if (platformRssPath) {
        return platformRssPath.startsWith('/') ? origin + platformRssPath : origin + '/' + platformRssPath;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP 오류! 상태: ${response.status}`);
        const html = await response.text();
        const rssMatch = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']application\/rss\+xml["'][^>]*href=["']([^"']*)["'][^>]*>/i) ||
            html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']application\/atom\+xml["'][^>]*href=["']([^"']*)["'][^>]*>/i);
        if (rssMatch && rssMatch[1]) {
            let rssUrl = rssMatch[1];
            if (rssUrl.startsWith('//')) {
                rssUrl = `https:${rssUrl}`;
            } else if (rssUrl.startsWith('/')) {
                rssUrl = `${urlObj.protocol}//${urlObj.host}${rssUrl}`;
            }
            return rssUrl;
        }
        return url.endsWith('/') ? url + 'feed' : url + '/feed';
    } catch (error) {
        console.error(`RSS 주소 확인 실패 (${url}):`, error);
        return null;
    }
}


/**
 * 유튜브 일반 URL에서 채널 ID(UC...)를 추출하거나 API를 통해 변환 (최종 수정)
 * @param {string} url - 사용자가 입력한 유튜브 URL 또는 ID
 * @param {string} apiKey - YouTube Data API 키
 * @returns {Promise<string|null>} - 추출된 채널 ID 또는 null
 */
async function resolveYoutubeUrl(url, apiKey) {
      if (!url) return null;

    if (url.startsWith('UC') && url.length === 24) {
        return url;
    }

    if (!url.startsWith('http')) {
        return null;
    }
    
    let urlObj;
    try {
        urlObj = new URL(url);
    } catch (e) {
        return null;
    }
    const path = urlObj.pathname;
    
    const channelIdMatch = path.match(/\/channel\/([a-zA-Z0-9_-]{24})/);
    if (channelIdMatch && channelIdMatch[1]) {
        return channelIdMatch[1];
    }
    
    if (!apiKey) {
        console.error("YouTube API Key is missing for URL resolution.");
        return null;
    }

    const videoIdMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/)([\w-]{11})/);
    if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1];
        const videoApiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
        try {
            const response = await fetch(videoApiUrl);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                return data.items[0].snippet.channelId;
            }
        } catch (error) {
            console.error(`영상 URL에서 채널 ID 변환 실패 (${videoId}):`, error);
        }
    }

    const customNameMatch = path.match(/\/(?:@|c\/|user\/)([a-zA-Z0-9_.-]+)/);
    if (customNameMatch && customNameMatch[1]) {
        const name = customNameMatch[1];
        const searchApiUrl = `https://www.googleapis.com/youtube/v3/search?part=id&q=${name}&type=channel&maxResults=1&key=${apiKey}`;
        try {
            const response = await fetch(searchApiUrl);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                return data.items[0].id.channelId;
            }
        } catch (error) {
            console.error(`YouTube 맞춤 URL (${name}) -> 채널 ID 변환 실패:`, error);
        }
    }

    console.warn(`YouTube URL을 채널 ID로 변환할 수 없습니다: ${url}`);
    return null;
}

/**
 * 텍스트에서 AI를 통해 키워드를 추출하는 함수.
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<string[]|null>} - 추출된 키워드 배열 또는 null
 */
async function extractKeywords(text) {
    console.log("키워드 추출 시도:", text.substring(0, 100) + "...");

    if (!text || text.trim().length < 20) {
        console.warn("텍스트가 너무 짧아 키워드 추출을 건너뜁니다.");
        return null;
    }
    
    const { isKeywordExtractionEnabled, geminiApiKey } = await chrome.storage.local.get(['isKeywordExtractionEnabled', 'geminiApiKey']);
    if (!isKeywordExtractionEnabled || !geminiApiKey) {
        console.warn("키워드 추출 기능이 비활성화되었거나 API 키가 없습니다.");
        return null;
    }

    const MODEL_NAME = "gemini-2.0-flash";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${geminiApiKey}`;

    // G-6 (A/C-2): 명확하고 간결한 프롬프트 설계
    const prompt = 
`당신은 전문 SEO 분석가이자 콘텐츠 전략가입니다. 다음 텍스트의 핵심 주제를 파악하여, 콘텐츠를 분류하고 검색 엔진 최적화(SEO)에 도움이 될 키워드를 추출해주세요.

[추출 규칙]
1.  **키워드 조합**: 총 5~7개의 키워드를 추출하며, 아래 두 종류를 적절히 조합해주세요.
    -   **핵심 키워드 (1-2 단어)**: 콘텐츠의 가장 중심이 되는 주제 (예: 'Gemini API', '콘텐츠 전략')
    -   **롱테일 키워드 (3단어 이상)**: 사용자의 구체적인 검색 의도가 담긴 긴 구문 (예: 'AI로 블로그 태그 자동 생성하기', '유튜브 채널 데이터 분석 방법')
2.  **구체성 및 명사 위주**: 명사, 고유명사, 전문 용어를 우선으로 사용합니다.
3.  **불용어 제외**: '방법', '소개', '정리' 등 일반적인 단어는 피합니다.

[응답 형식]
- 반드시 다른 설명이나 줄바꿈, \`\`\`json 같은 마크다운 없이, 순수한 JavaScript 배열 형식으로만 응답해주세요.
- 예: ["Gemini API", "콘텐츠 전략", "AI로 블로그 태그 자동 생성하기", "유튜브 채널 데이터 분석 방법", "SEO 키워드 추출"]

[분석할 텍스트]
"""
${text.substring(0, 2000)}
"""`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error("Gemini API 오류 응답:", responseData);
            throw new Error(`Gemini API 호출 실패: ${response.status}`);
        }
        if (!responseData.candidates || responseData.candidates.length === 0) {
            console.warn("Gemini API가 안전 필터링 등의 이유로 응답을 반환하지 않았습니다.", responseData);
            return null;
        }

        const rawResult = responseData.candidates[0]?.content?.parts[0]?.text;
        
        console.log("Gemini 원본 응답:", rawResult); 

        if (rawResult) {
            const arrayStringMatch = rawResult.match(/\[.*\]/s); 
            if (arrayStringMatch) {
                try {
                    const parsed = JSON.parse(arrayStringMatch[0]);
                    console.log("✅ 추출된 키워드:", parsed);
                    return parsed;
                } catch (e) {
                    console.error("❌ JSON 파싱 오류:", e, "원본 문자열:", arrayStringMatch[0]);
                    return null;
                }
            }
        }
        console.warn("AI 응답에서 유효한 배열 형식을 찾지 못했습니다.");
        return null;
    } catch (error) {
        console.error("❌ Gemini 키워드 추출 중 전체 오류:", error);
        return null;
    }
}

// --- ▼▼▼ [신규] 채널 및 관련 데이터 삭제를 위한 재사용 함수 ▼▼▼ ---
/**
 * 지정된 URL의 채널과 관련된 모든 데이터를 Firebase에서 삭제합니다.
 * @param {string} urlToDelete - 삭제할 채널의 원본 입력 URL
 * @returns {Promise<boolean>} - 성공 시 true, 실패 시 에러 throw
 */
async function deleteChannelData(urlToDelete) {
    const userId = 'default_user';
    const channelsRef = firebase.database().ref(`channels/${userId}`);
    const channelsSnap = await channelsRef.once('value');
    const allChannels = channelsSnap.val();

    if (!allChannels) throw new Error('삭제할 채널 정보를 찾을 수 없습니다.');

    let sourceIdToDelete = null;
    let platformToDelete = null;

    // 모든 채널 유형과 플랫폼을 순회하며 삭제할 채널 찾기
    for (const type of ['myChannels', 'competitorChannels']) {
        for (const platform of ['blogs', 'youtubes']) {
            const channels = allChannels[type]?.[platform] || [];
            const channelIndex = channels.findIndex(c => c.inputUrl === urlToDelete);

            if (channelIndex > -1) {
                const channelInfo = channels[channelIndex];
                sourceIdToDelete = platform === 'blogs' 
                    ? btoa(channelInfo.apiUrl).replace(/=/g, '') 
                    : channelInfo.apiUrl;
                
                platformToDelete = platform;

                // DB에서 해당 채널 정보 제거 (이 부분은 set으로 덮어쓸 것이므로 여기서는 제거 안함)
                break;
            }
        }
        if (sourceIdToDelete) break;
    }

    if (!sourceIdToDelete) {
        // 이미 UI에서 지워지고 없는 상태일 수 있으므로 오류 대신 경고만 출력
        console.warn(`DB에서 '${urlToDelete}' 채널을 찾지 못했습니다. 이미 처리되었을 수 있습니다.`);
        return true;
    }

    // 1. /channel_meta/ 경로에서 메타 정보 삭제
    await firebase.database().ref(`channel_meta/${sourceIdToDelete}`).remove();
    
    // 2. /channel_content/ 경로에서 수집된 모든 콘텐츠 삭제
    const contentRef = firebase.database().ref(`channel_content/${platformToDelete}`);
    const contentSnap = await contentRef.orderByChild('sourceId').equalTo(sourceIdToDelete).once('value');
    const contentToDelete = contentSnap.val();

    if (contentToDelete) {
        const updates = {};
        for (const contentId in contentToDelete) {
            updates[contentId] = null; // null로 설정하여 삭제
        }
        await contentRef.update(updates);
    }
    
    console.log(`'${urlToDelete}' 채널과 관련된 모든 데이터 삭제 완료.`);
    return true;
}

// --- 2. 핵심 이벤트 리스너 ---

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scrap_element" && msg.data) {
        (async () => {
            const tags = await extractKeywords(msg.data.text);
            let scrapPayload = { ...msg.data, timestamp: Date.now(), tags: tags || null };
            
            const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);

            const scrapRef = firebase.database().ref("scraps").push();
            scrapRef.set(cleanedScrapPayload).then(() => {
                if (sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, { action: 'cp_show_preview', data: cleanedScrapPayload }, { frameId: 0 });
                }
            }).catch(err => {
                if (sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, { action: 'cp_show_toast', message: '❌ 스크랩 실패' }, { frameId: 0 });
                }
            });
        })();
        return true;
    }
    else if (msg.action === "cp_get_firebase_scraps") {
        firebase.database().ref("scraps").once("value", (snapshot) => {
            const val = snapshot.val() || {};
            const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
            sendResponse({ data: arr });
        });
        return true;
    }
    else if (msg.action === "delete_scrap") {
        const scrapIdToDelete = msg.id;
        if (scrapIdToDelete) {
            firebase.database().ref("scraps/" + scrapIdToDelete).remove()
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
        }
        return true;
    }
    else if (msg.action === "clear_blog_content") {
        firebase.database().ref('channel_content/blogs').remove()
            .then(() => sendResponse({ success: true, message: '블로그 콘텐츠 데이터가 성공적으로 삭제되었습니다. 새로고침 후 재수집해주세요.' }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; 
    }
    else if (msg.action === "save_channels_and_key") {
        const { youtubeApiKey, geminiApiKey, ...newChannelData } = msg.data;
        const userId = 'default_user';

        (async () => {
            try {
                // 1. 기존에 저장된 채널 목록 가져오기
                const channelsRef = firebase.database().ref(`channels/${userId}`);
                const oldChannelsSnap = await channelsRef.once('value');
                const oldChannels = oldChannelsSnap.val();

                // 2. 새로 제출된 채널 목록 처리 (기존 로직과 동일)
                const apiKey = youtubeApiKey;
                const resolvedChannels = {
                    myChannels: { blogs: [], youtubes: [] },
                    competitorChannels: { blogs: [], youtubes: [] }
                };
                for (const type of ['myChannels', 'competitorChannels']) {
                    if (newChannelData[type]?.blogs) {
                        const blogPromises = newChannelData[type].blogs
                            .filter(url => url.trim().length > 0)
                            .map(async (url) => ({ 
                                inputUrl: url.trim(), 
                                apiUrl: await resolveBlogUrl(url.trim()) 
                            }));
                        resolvedChannels[type].blogs = (await Promise.all(blogPromises)).filter(c => c.apiUrl);
                    }
                    if (newChannelData[type]?.youtubes) {
                        const youtubePromises = newChannelData[type].youtubes
                            .filter(url => url.trim().length > 0)
                            .map(async (url) => ({
                                inputUrl: url.trim(),
                                apiUrl: await resolveYoutubeUrl(url.trim(), apiKey)
                            }));
                        resolvedChannels[type].youtubes = (await Promise.all(youtubePromises)).filter(c => c.apiUrl);
                    }
                }
                
                // 3. 삭제된 채널 찾아서 데이터 삭제하기
                if (oldChannels) {
                    const oldUrls = new Set();
                    ['myChannels', 'competitorChannels'].forEach(type => {
                        ['blogs', 'youtubes'].forEach(platform => {
                            (oldChannels[type]?.[platform] || []).forEach(c => oldUrls.add(c.inputUrl));
                        });
                    });

                    const newUrls = new Set();
                    ['myChannels', 'competitorChannels'].forEach(type => {
                        ['blogs', 'youtubes'].forEach(platform => {
                            (resolvedChannels[type]?.[platform] || []).forEach(c => newUrls.add(c.inputUrl));
                        });
                    });

                    const deletedUrls = [...oldUrls].filter(url => !newUrls.has(url));

                    // 삭제된 각 URL에 대해 데이터 삭제 함수 호출
                    for (const url of deletedUrls) {
                        await deleteChannelData(url);
                    }
                }

                // 4. 최종적으로 새로운 채널 목록과 API 키 저장
                await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
                await channelsRef.set(resolvedChannels);

                console.log('채널 정보가 성공적으로 업데이트되었습니다. 즉시 데이터 수집을 시작합니다.');
                fetchAllChannelData(); // 새로 추가되거나 변경된 채널 데이터 수집
                sendResponse({ success: true, message: '채널 정보가 성공적으로 저장 및 업데이트되었습니다.' });

            } catch (error) {
                console.error('채널 저장/업데이트 처리 중 오류:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    // --- ▼▼▼ [수정] "delete_channel" 핸들러 ▼▼▼ ---
    else if (msg.action === "delete_channel") {
        (async () => {
            try {
                await deleteChannelData(msg.url);
                sendResponse({ success: true });
            } catch (error) {
                console.error('채널 삭제 처리 중 오류:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
  
  else if (msg.action === "get_channels_and_key") {
      const userId = 'default_user';
    Promise.all([
      chrome.storage.local.get(['youtubeApiKey', 'geminiApiKey']),
      firebase.database().ref(`channels/${userId}`).once("value")
    ]).then(([storage, snapshot]) => {
      const rawChannelData = snapshot.val() || {};
      
      const channelDataForUI = {
        myChannels: {
          blogs: (rawChannelData.myChannels?.blogs || []).map(c => c.inputUrl),
          youtubes: (rawChannelData.myChannels?.youtubes || []).map(c => c.inputUrl),
        },
        competitorChannels: {
          blogs: (rawChannelData.competitorChannels?.blogs || []).map(c => c.inputUrl),
          youtubes: (rawChannelData.competitorChannels?.youtubes || []).map(c => c.inputUrl),
        }
      };

      const responseData = {
        ...channelDataForUI,
        youtubeApiKey: storage.youtubeApiKey,
        geminiApiKey: storage.geminiApiKey
      };
      sendResponse({ success: true, data: responseData });
    }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
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
      firebase.database().ref(`channels/${userId}`).once('value')
    ]).then(([contentSnap, metaSnap, channelsSnap]) => {
      const content = contentSnap.val() || {};
      const metas = metaSnap.val() || {};
      const channels = channelsSnap.val() || { myChannels: {}, competitorChannels: {} };

      const blogs = Object.values(content.blogs || {}).filter(item => item !== null);
      const youtubes = Object.values(content.youtubes || {}).filter(item => item !== null);
      const allContent = [...blogs, ...youtubes];

      const responseData = {
        content: allContent,
        metas: metas,
        channels: channels
      };
      
      sendResponse({ success: true, data: responseData });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    
    return true;
  }
    else if (msg.action === "refresh_channel_data") {
      const { sourceId, platform } = msg;
      
      const userId = 'default_user';
      firebase.database().ref(`channels/${userId}`).once('value', snapshot => {
        const channels = snapshot.val();
        if (!channels) {
            sendResponse({ success: false, error: '설정된 채널이 없습니다.' });
            return;
        }

        let channelToFetch = null;
        let channelType = null;
        
        for (const type of ['myChannels', 'competitorChannels']) {
            const blogs = channels[type]?.blogs || [];
            const channel = blogs.find(c => btoa(c.apiUrl).replace(/=/g, '') === sourceId);
            if (channel) {
                channelToFetch = channel;
                channelType = type;
                break;
            }
        }

        if (!channelToFetch) {
            for (const type of ['myChannels', 'competitorChannels']) {
                const youtubes = channels[type]?.youtubes || [];
                const channel = youtubes.find(c => c.apiUrl === sourceId);
                if (channel) {
                    channelToFetch = channel;
                    channelType = type;
                    break;
                }
            }
        }

        if (channelToFetch) {
            if (platform === 'blog') {
                fetchRssFeed(channelToFetch.apiUrl, channelType);
            } else if (platform === 'youtube') {
                fetchYoutubeChannel(channelToFetch.apiUrl, channelType);
            }
            sendResponse({ success: true, message: '데이터 수집을 시작합니다.' });
        } else {
            sendResponse({ success: false, error: '요청한 채널을 찾을 수 없습니다.' });
        }
      });
      return true;
    }
  else if (msg.action === "analyze_my_channel") {
        const contentData = msg.data;
        const dataSummary = contentData
            .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
            .slice(0, 20)
            .map(item => `제목: ${item.title}, 조회수: ${item.viewCount || 0}, 좋아요: ${item.likeCount || 0}`)
            .join('\n');

        (async () => {
            const analysisResult = await callGeminiAPI(dataSummary);
            sendResponse({ success: true, analysis: analysisResult });
        })();
        
        return true;
  }
  else if (msg.action === "generate_content_ideas") {
    const { myContent, competitorContent } = msg.data;
    const myDataSummary = myContent
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 10)
        .map(item => ` - ${item.title} (조회수: ${item.viewCount})`)
        .join('\n');

    const competitorDataSummary = competitorContent
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 10)
        .map(item => ` - ${item.title} (조회수: ${item.viewCount})`)
        .join('\n');
    
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
        const ideasResult = await callGeminiAPI(newPrompt); 
        sendResponse({ success: true, ideas: ideasResult });
    })();
    
    return true;
  }
    else if (msg.action === "analyze_video_comments") {
    const videoId = msg.videoId;
    (async () => {
        const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');
        if (!youtubeApiKey) {
            sendResponse({ success: false, error: "YouTube API 키가 설정되지 않았습니다." });
            return;
        }

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

            const analysisResult = await callGeminiAPI(commentAnalysisPrompt);
            sendResponse({ success: true, analysis: analysisResult });

        } catch (error) {
            console.error("댓글 조회 또는 분석 중 오류 발생:", error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    
    return true;
  }    // --- ▼▼▼ [추가] 채널 삭제 로직 ▼▼▼ ---
    else if (msg.action === "delete_channel") {
        const urlToDelete = msg.url;
        const userId = 'default_user';

        (async () => {
            try {
                const channelsRef = firebase.database().ref(`channels/${userId}`);
                const channelsSnap = await channelsRef.once('value');
                const allChannels = channelsSnap.val();

                if (!allChannels) {
                    throw new Error('삭제할 채널 정보를 찾을 수 없습니다.');
                }

                let sourceIdToDelete = null;
                let platformToDelete = null; // 'blogs' 또는 'youtubes'
                let typeToDelete = null; // 'myChannels' 또는 'competitorChannels'

                // 모든 채널 유형과 플랫폼을 순회하며 삭제할 채널 찾기
                for (const type of ['myChannels', 'competitorChannels']) {
                    for (const platform of ['blogs', 'youtubes']) {
                        const channels = allChannels[type]?.[platform] || [];
                        const channelIndex = channels.findIndex(c => c.inputUrl === urlToDelete);

                        if (channelIndex > -1) {
                            const channelInfo = channels[channelIndex];
                            sourceIdToDelete = platform === 'blogs' 
                                ? btoa(channelInfo.apiUrl).replace(/=/g, '') 
                                : channelInfo.apiUrl;
                            
                            platformToDelete = platform;
                            typeToDelete = type;

                            // DB에서 해당 채널 정보 제거
                            allChannels[type][platform].splice(channelIndex, 1);
                            break;
                        }
                    }
                    if (sourceIdToDelete) break;
                }

                if (!sourceIdToDelete) {
                    throw new Error(`DB에서 '${urlToDelete}' 채널을 찾지 못했습니다.`);
                }

                // 1. /channels/ 경로에서 채널 정보 업데이트
                await channelsRef.set(allChannels);

                // 2. /channel_meta/ 경로에서 메타 정보 삭제
                await firebase.database().ref(`channel_meta/${sourceIdToDelete}`).remove();
                
                // 3. /channel_content/ 경로에서 수집된 모든 콘텐츠 삭제
                const contentRef = firebase.database().ref(`channel_content/${platformToDelete}`);
                const contentSnap = await contentRef.orderByChild('sourceId').equalTo(sourceIdToDelete).once('value');
                const contentToDelete = contentSnap.val();

                if (contentToDelete) {
                    const updates = {};
                    for (const contentId in contentToDelete) {
                        updates[contentId] = null; // null로 설정하여 삭제
                    }
                    await contentRef.update(updates);
                }

                sendResponse({ success: true });

            } catch (error) {
                console.error('채널 삭제 처리 중 오류:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();

        return true; // 비동기 응답을 위해 true 반환
    }
});


// --- 3. 주기적 데이터 수집 로직 ---

chrome.runtime.onInstalled.addListener(() => {
    console.log("Content Pilot 설치됨. 알람을 설정합니다.");
    chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
    chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 240 });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Content Pilot 시작됨. 알람을 확인/설정합니다.");
    chrome.alarms.get('fetch-channels', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 240 });
        }
    });
});

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
        ['myChannels', 'competitorChannels'].forEach(type => {
            if (channels[type]) {
                channels[type].blogs?.forEach(channel => fetchRssFeed(channel.apiUrl, type));
                channels[type].youtubes?.forEach(channel => fetchYoutubeChannel(channel.apiUrl, type));
            }
        });
    });
}


// --- ▼▼▼ [하이브리드 방식] 블로그 데이터 수집 함수 수정 ▼▼▼ ---
async function fetchRssFeed(url, channelType) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();

        const channelTitleMatch = text.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/channel>/);
        const channelTitle = channelTitleMatch ? channelTitleMatch[1] : url;
        const sourceId = btoa(url).replace(/=/g, '');
        firebase.database().ref(`channel_meta/${sourceId}`).set({ title: channelTitle, type: 'blog', source: url, fetchedAt: Date.now() });

        const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const itemText of items.slice(0, 10)) {
            const linkMatch = itemText.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
            if (!linkMatch) continue;
            
            const link = linkMatch[1];
            const contentId = btoa(link).replace(/=/g, '');
            const contentRef = firebase.database().ref(`channel_content/blogs/${contentId}`);

            const existingDataSnap = await contentRef.once('value');

            // --- [핵심 개선 로직] ---
            if (existingDataSnap.exists()) {
                // 1. 기존 데이터가 있으면 '가벼운 업데이트'만 수행
                console.log(`[하이브리드] '${link}'는 이미 존재하므로, 가벼운 업데이트를 시도합니다.`);
                try {
                    const postResponse = await fetch(link);
                    if (!postResponse.ok) continue;
                    let postHtml = await postResponse.text();

                    // 네이버 iframe 처리
                    const naverIframeMatch = postHtml.match(/<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/);
                    if (naverIframeMatch && naverIframeMatch[1]) {
                        const iframeUrl = new URL(naverIframeMatch[1], "https://blog.naver.com").href;
                        const iframeResponse = await fetch(iframeUrl);
                        if (iframeResponse.ok) postHtml = await iframeResponse.text();
                    }
                    
                    await getOffscreenDocument();
                    // offscreen.js로 보내 댓글 수 등 일부 지표만 파싱
                    const parsedData = await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: 'parse_html_in_offscreen', html: postHtml, baseUrl: link }, 
                            (response) => resolve(response)
                        );
                    });

                    if (parsedData && parsedData.success) {
                        // 2. 전체를 덮어쓰는 set() 대신, 변경된 부분만 갱신하는 update() 사용
                        contentRef.update({
                            commentCount: parsedData.metrics.commentCount,
                            likeCount: parsedData.metrics.likeCount || null, // 좋아요는 없을 수 있으므로 null 처리
                            fetchedAt: Date.now()
                        });
                    }
                } catch (updateError) {
                    console.error(`'${link}' 가벼운 업데이트 중 오류:`, updateError);
                }

            } else {
                // 3. 신규 데이터일 경우에만 '무거운 전체 파싱' 수행
                console.log(`[하이브리드] 새로운 콘텐츠 '${link}'를 파싱합니다.`);
                const titleMatch = itemText.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                const pubDateMatch = itemText.match(/<pubDate>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/pubDate>/);
                // ... (이하 새로운 콘텐츠를 파싱하고 저장하는 기존 로직은 모두 동일)
                const title = titleMatch ? titleMatch[1] : '제목 없음';
                const timestamp = new Date(pubDateMatch ? pubDateMatch[1] : Date.now()).getTime();

                // ... (나머지 전체 파싱 및 저장 로직)
                const postResponse = await fetch(link);
                let postHtml = await postResponse.text();
                const naverIframeMatch = postHtml.match(/<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/);
                if (naverIframeMatch && naverIframeMatch[1]) {
                    const iframeUrl = new URL(naverIframeMatch[1], "https://blog.naver.com").href;
                    const iframeResponse = await fetch(iframeUrl);
                    if (iframeResponse.ok) postHtml = await iframeResponse.text();
                }
                
                await getOffscreenDocument();

                const parsedData = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'parse_html_in_offscreen', html: postHtml, baseUrl: link }, 
                        (response) => {
                            if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
                            else resolve(response);
                        }
                    );
                });
                
                if (parsedData && parsedData.success) {
                    const tags = await extractKeywords(parsedData.cleanText);
                    const finalData = {
                        title, link, pubDate: timestamp,
                        description: parsedData.description,
                        thumbnail: parsedData.thumbnail,
                        cleanText: parsedData.cleanText,
                        sourceId, channelType,
                        fetchedAt: Date.now(),
                        ...parsedData.metrics,
                        tags: tags || null
                    };
                    const cleanedFinalData = cleanDataForFirebase(finalData);
                    contentRef.set(cleanedFinalData);
                }
            }
            // --- [개선 로직 끝] ---
        }
    } catch (error) {
        console.error(`Failed to fetch or parse RSS for ${url}:`, error);
    }
}
async function fetchYoutubeChannel(channelId, channelType) {
    const { youtubeApiKey } = await chrome.storage.local.get('youtubeApiKey');

    if (!youtubeApiKey) {
        console.warn('YouTube API 키가 설정되지 않았습니다. YouTube 데이터 수집을 건너킵니다.');
        return;
    }
    
    let channelTitle = channelId;
    
    const channelInfoUrl = `https://www.googleapis.com/youtube/v3/channels?key=${youtubeApiKey}&id=${channelId}&part=snippet`;
    try {
        const channelInfoResponse = await fetch(channelInfoUrl);
        const channelInfoData = await channelInfoResponse.json();
        if (channelInfoData.items && channelInfoData.items.length > 0) {
            channelTitle = channelInfoData.items[0].snippet.title;
        }
    } catch(error) {
        console.error(`YouTube 채널 정보 조회 실패 (${channelId}):`, error);
    }
    
    const userId = 'default_user';
    const channelDataSnap = await firebase.database().ref(`channels/${userId}`).once('value');
    const channelData = channelDataSnap.val();
    
    const allChannels = (channelData?.myChannels?.youtubes || []).concat(channelData?.competitorChannels?.youtubes || []);
    const storedChannel = allChannels.find(c => c.apiUrl === channelId);
    const inputUrl = storedChannel ? storedChannel.inputUrl : channelId; 
        
    firebase.database().ref(`channel_meta/${channelId}`).set({
        title: channelTitle,
        type: 'youtube',
        source: channelId,
        inputUrl: inputUrl,
        fetchedAt: Date.now()
    });


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

        const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoIds.join(',')}&part=snippet,statistics`;
        const detailsResponse = await fetch(videoDetailsUrl);
        const detailsData = await detailsResponse.json();
        
        if (detailsData.items) {
            for (const item of detailsData.items) {
                const { id, snippet, statistics } = item;
                const existingDataSnap = await firebase.database().ref(`channel_content/youtubes/${id}`).once('value');
                const existingData = existingDataSnap.val();
                let tags = (existingData && existingData.tags) ? existingData.tags : await extractKeywords(snippet.description);
                
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
                    channelId,
                    sourceId: channelId,
                    channelType,
                    fetchedAt: Date.now(),
                    tags: tags || null
                };
                
                const cleanedVideoData = cleanDataForFirebase(video);
                firebase.database().ref(`channel_content/youtubes/${cleanedVideoData.videoId}`).set(cleanedVideoData);
            }
            console.log(`YouTube 채널 상세 정보 수집 성공: ${channelId}`);
        }
    } catch (error) {
        console.error(`YouTube 채널 데이터 수집 실패 (${channelId}):`, error);
    }
}


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