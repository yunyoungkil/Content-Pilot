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
    chrome.storage.local.set({ youtubeApiKey: msg.data.apiKey }, () => {
      const channelData = { ...msg.data };
      delete channelData.apiKey;
      const userId = 'default_user';
      firebase.database().ref(`channels/${userId}`).set(channelData)
        .then(() => {
          // ▼▼▼ [핵심 수정] 저장이 성공하면 즉시 데이터 수집 함수를 호출! ▼▼▼
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
    // 두 비동기 작업을 Promise.all로 함께 처리
    Promise.all([
      chrome.storage.local.get('youtubeApiKey'),
      firebase.database().ref(`channels/${userId}`).once("value")
    ]).then(([storage, snapshot]) => {
      const channelData = snapshot.val() || {}; // Firebase 데이터가 null일 경우 빈 객체로 처리
      const responseData = {
        ...channelData,
        apiKey: storage.youtubeApiKey 
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