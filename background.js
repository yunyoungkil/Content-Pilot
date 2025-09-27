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

// ▼▼▼ 중요: 여기에 발급받은 YouTube Data API v3 키를 입력하세요. ▼▼▼
const YOUTUBE_API_KEY = 'AIzaSyCyYQDnwIPrjQijXStHpw3p1tXc2VKbP74'; // 실제 키로 교체 필요

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
    // 채널 정보 저장
    else if (msg.action === "save_channels") {
        const userId = 'default_user';
        firebase.database().ref(`channels/${userId}`).set(msg.data)
            .then(() => sendResponse({ success: true, message: '채널 정보가 저장되었습니다.' }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    // 채널 정보 불러오기
    else if (msg.action === "get_channels") {
        const userId = 'default_user';
        firebase.database().ref(`channels/${userId}`).once("value", (snapshot) => {
            sendResponse({ success: true, data: snapshot.val() });
        }).catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
      else if (msg.action === "get_channel_content") {
    firebase.database().ref('channel_content').once('value', (snapshot) => {
      const content = snapshot.val() || {};
      const blogs = Object.values(content.blogs || {});
      const youtubes = Object.values(content.youtubes || {});
      sendResponse({ success: true, data: [...blogs, ...youtubes] });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 비동기 응답을 위해 true 반환
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
        const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const itemText of items) {
            const titleMatch = itemText.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || itemText.match(/<title>(.*?)<\/title>/);
            const linkMatch = itemText.match(/<link>(.*?)<\/link>/);
            const pubDateMatch = itemText.match(/<pubDate>(.*?)<\/pubDate>/);
            const descriptionMatch = itemText.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || itemText.match(/<description>(.*?)<\/description>/);
            const title = titleMatch ? titleMatch[1] : '';
            const link = linkMatch ? linkMatch[1] : '';
            const pubDate = pubDateMatch ? pubDateMatch[1] : '';
            const description = descriptionMatch ? descriptionMatch[1] : '';

            if (link) {
                const contentId = btoa(link).replace(/=/g, '');
                firebase.database().ref(`channel_content/blogs/${contentId}`).set({
                    title, link, pubDate: new Date(pubDate).getTime(), description,
                    channelType, sourceUrl: url, fetchedAt: Date.now()
                });
            }
        }
        console.log(`Successfully parsed RSS for: ${url}`);
    } catch (error) {
        console.error(`Failed to fetch or parse RSS for ${url}:`, error);
    }
}

async function fetchYoutubeChannel(channelId, channelType) {
  // ▼▼▼ "YOUR_YOUTUBE_API_KEY" 라는 초기 placeholder 값과 비교하도록 수정 ▼▼▼
  if (YOUTUBE_API_KEY === 'AIzaSyCyYQDnwIPrjQijXStHpw3p1tXc2VKbP74' || !YOUTUBE_API_KEY) {
    console.warn('YouTube API Key is not set. Skipping YouTube fetch.');
    return;
  }
  
  const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${channelId}&part=snippet,id&order=date&maxResults=10`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.items) {
      data.items.forEach(item => {
        if (item.id.videoId) {
          const video = {
            videoId: item.id.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: new Date(item.snippet.publishedAt).getTime(),
            thumbnail: item.snippet.thumbnails.default.url,
            channelId,
            channelType,
            fetchedAt: Date.now()
          };
          // 비디오 ID를 키로 사용
          firebase.database().ref(`channel_content/youtubes/${video.videoId}`).set(video);
        }
      });
      console.log(`Successfully fetched YouTube data for channel: ${channelId}`);
    } else {
        // API 키가 유효하지 않거나 제한에 걸렸을 때 에러가 여기에 표시됩니다.
        console.error(`Error fetching YouTube data for ${channelId}:`, data.error?.message || 'Unknown error');
    }
  } catch (error) {
    console.error(`Failed to fetch YouTube channel ${channelId}:`, error);
  }
}