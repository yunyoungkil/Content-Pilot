// background.js

// Firebase 라이브러리 import
importScripts("lib/firebase-app-compat.js", "lib/firebase-database-compat.js");

// Firebase 초기화
const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL: "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// content.js로부터 오는 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 스크랩 저장 요청 처리
  if (msg.action === "scrap_element" && msg.data) {
    const scrapRef = firebase.database().ref("scraps").push();
    const scrapPayload = {
      ...msg.data,
      timestamp: Date.now(),
    };
    scrapRef.set(scrapPayload).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // 비동기 응답을 위해 채널 유지
  }

  // 스크랩 목록 요청 처리
  if (msg.action === "cp_get_firebase_scraps") {
    firebase.database().ref("scraps").once("value", (snapshot) => {
      const val = snapshot.val() || {};
      const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
      sendResponse({ data: arr });
    });
    return true; // 비동기 응답을 위해 채널 유지
  } else if (msg.action === "delete_scrap") {
    const scrapIdToDelete = msg.id;
    if (scrapIdToDelete) {
      // Realtime Database에서 해당 ID의 데이터를 삭제합니다.
      firebase.database().ref("scraps/" + scrapIdToDelete).remove()
        .then(() => {
          console.log("Scrap successfully deleted:", scrapIdToDelete);
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("Error deleting scrap: ", error);
          sendResponse({ success: false, error: error.message });
        });
    }
    return true; // 비동기 응답을 위해 true를 반환합니다.
  }
});

// Firebase 데이터가 변경될 때마다 모든 탭에 실시간으로 알려주기
firebase.database().ref("scraps").on("value", (snapshot) => {
    const val = snapshot.val() || {};
    const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
    
    // 열려있는 모든 탭에 업데이트된 스크랩 목록 전송
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: "cp_scraps_updated", // 새로운 액션 이름
            data: arr,
          }, () => chrome.runtime.lastError); // 에러는 무시
        }
      });
    });
});

// 확장 프로그램 아이콘 클릭 시 UI 열기 메시지 전송
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    });
  }
});

// 확장 프로그램이 처음 설치될 때 기본 상태 값을 설정
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isScrapingActive: false,
    highlightToggleState: false
  });
});

// 사용자가 탭을 전환할 때마다 하이라이트 토글 상태를 OFF로 초기화합니다.
chrome.tabs.onActivated.addListener(() => {
  // 스크랩 기능 자체가 활성화된 상태일 때만 초기화를 진행합니다.
  // (패널을 완전히 닫은 상태에서는 불필요하게 작동하지 않도록 방지)
  chrome.storage.local.get("isScrapingActive", (result) => {
    if (result.isScrapingActive) {
      chrome.storage.local.set({ highlightToggleState: false });
      // console.log("Tab switched, highlight mode reset to OFF."); // 확인용 로그
    }
  });
});