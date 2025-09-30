// background.js (유튜브 채널 ID 변환 로직 최종 수정 완료)
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
        console.warn(`유효하지 않은 유튜브 URL 형식: ${url}`);
        return null;
    }
    
    let urlObj;
    try {
        urlObj = new URL(url);
    } catch (e) {
        console.warn(`유튜브 URL 파싱 실패: ${url}`);
        return null;
    }
    const path = urlObj.pathname;
    
     const customUrlMatch = path.match(/\/(?:@|c\/|user\/)([a-zA-Z0-9_.-]+)/);
    if (customUrlMatch && customUrlMatch[1]) {
        const name = customUrlMatch[1];
        // 'search' API를 사용하여 채널명으로 검색
        const searchApiUrl = `https://www.googleapis.com/youtube/v3/search?part=id&q=${name}&type=channel&maxResults=1&key=${apiKey}`;
        try {
            const response = await fetch(searchApiUrl);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                // 검색 결과의 첫 번째 채널 ID를 반환
                return data.items[0].id.channelId;
            } else {
                console.warn(`YouTube API 검색으로 맞춤 URL(${name})에 해당하는 채널을 찾을 수 없습니다.`);
            }
        } catch (error) {
            console.error(`YouTube 맞춤 URL(${name}) -> 채널 ID 변환 중 API 오류:`, error);
        }
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
            } else {
                console.warn(`YouTube API에서 영상 정보(채널 ID 포함)를 찾을 수 없습니다: ${videoId}.`);
            }
        } catch (error) {
            console.error(`영상 URL (${videoId})에서 채널 ID 변환 중 API 오류:`, error);
        }
    }
    
    console.warn(`모든 방법을 시도했지만 YouTube URL을 채널 ID로 변환할 수 없습니다: ${url}`);
    return null;
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
    const { youtubeApiKey, geminiApiKey, ...channelData } = msg.data;
      
      chrome.storage.local.set({ youtubeApiKey, geminiApiKey }, async () => {
        const userId = 'default_user';
        const apiKey = youtubeApiKey;

        const resolvedChannels = {
            myChannels: { blogs: [], youtubes: [] },
            competitorChannels: { blogs: [], youtubes: [] }
        };

        for (const type of ['myChannels', 'competitorChannels']) {
            if (channelData[type]?.blogs) {
                const blogPromises = channelData[type].blogs
                    .filter(url => url.trim().length > 0)
                    .map(async (url) => {
                        const resolvedUrl = await resolveBlogUrl(url.trim());
                        if (resolvedUrl) {
                            return { 
                                inputUrl: url.trim(), 
                                apiUrl: resolvedUrl 
                            }; 
                        }
                        return null;
                    });
                const results = await Promise.all(blogPromises);
                resolvedChannels[type].blogs = results.filter(item => item !== null);
            }

            if (channelData[type]?.youtubes) {
                const youtubePromises = channelData[type].youtubes
                    .filter(url => url.trim().length > 0)
                    .map(async (url) => {
                        const resolvedId = await resolveYoutubeUrl(url.trim(), apiKey);
                        if (resolvedId) {
                            return { 
                                inputUrl: url.trim(), 
                                apiUrl: resolvedId 
                            };
                        }
                        return null;
                    });
                const results = await Promise.all(youtubePromises);
                resolvedChannels[type].youtubes = results.filter(item => item !== null); 
            }
        }
        
        firebase.database().ref(`channels/${userId}`).set(resolvedChannels)
          .then(() => {
            console.log('새 채널이 저장되었습니다. 즉시 데이터 수집을 시작합니다.');
            fetchAllChannelData();
            sendResponse({ success: true, message: '채널 및 API 키 정보가 성공적으로 저장되었습니다.' });
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
      });
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
  }
});


// --- 3. 주기적 데이터 수집 로직 ---

chrome.runtime.onInstalled.addListener(() => {
    console.log("Content Pilot 설치됨. 알람을 설정합니다.");
    chrome.storage.local.set({ isScrapingActive: false, highlightToggleState: false });
    chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Content Pilot 시작됨. 알람을 확인/설정합니다.");
    chrome.alarms.get('fetch-channels', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('fetch-channels', { delayInMinutes: 1, periodInMinutes: 60 });
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

async function fetchRssFeed(url, channelType) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();

        const channelTitleMatch = text.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/channel>/);
        const channelTitle = channelTitleMatch ? channelTitleMatch[1] : url;
        const sourceId = btoa(url).replace(/=/g, '');
        firebase.database().ref(`channel_meta/${sourceId}`).set({ title: channelTitle, type: 'blog', source: url });

        const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const itemText of items.slice(0, 10)) {
            const titleMatch = itemText.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
            const linkMatch = itemText.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
            const pubDateMatch = itemText.match(/<pubDate>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/pubDate>/);

            if (!linkMatch || !titleMatch) continue;
            
            const title = titleMatch[1];
            const link = linkMatch[1];
            const timestamp = new Date(pubDateMatch ? pubDateMatch[1] : Date.now()).getTime();

            if (isNaN(timestamp)) continue;

            try {
                const postResponse = await fetch(link);
                if (!postResponse.ok) continue;
                let postHtml = await postResponse.text();
                
                // ▼▼▼ [핵심 수정] 네이버 블로그 아이프레임 처리 로직 추가 ▼▼▼
                const naverIframeMatch = postHtml.match(/<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/);
                if (naverIframeMatch && naverIframeMatch[1]) {
                    const iframeSrc = naverIframeMatch[1];
                    // 아이프레임 주소가 상대 경로일 수 있으므로, new URL()로 절대 경로 생성
                    const iframeUrl = new URL(iframeSrc, "https://blog.naver.com").href;
                    
                    const iframeResponse = await fetch(iframeUrl);
                    if (iframeResponse.ok) {
                        // 실제 콘텐츠가 담긴 아이프레임의 HTML로 postHtml을 교체
                        postHtml = await iframeResponse.text();
                    }
                }
                // ▲▲▲ 수정 완료 ▲▲▲

                await getOffscreenDocument();
                const parsedData = await chrome.runtime.sendMessage({
                    action: 'parse_html_in_offscreen',
                    html: postHtml,
                    baseUrl: link 
                });

                if (parsedData && parsedData.success) {
                    const contentId = btoa(link).replace(/=/g, '');
                    firebase.database().ref(`channel_content/blogs/${contentId}`).set({
                        title, link, pubDate: timestamp,
                        description: parsedData.description,
                        thumbnail: parsedData.thumbnail,
                        allImages: parsedData.allImages,
                        sourceId: sourceId,
                        channelType: channelType,
                        fetchedAt: Date.now()
                    });
                }
            } catch (postError) {
                console.error(`Error processing post ${link}:`, postError);
            }
        }
        console.log(`Successfully parsed RSS for: ${url}`);
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