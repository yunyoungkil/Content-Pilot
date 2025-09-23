// Firebase 라이브러리 import
importScripts("lib/firebase-app-compat.js", "lib/firebase-database-compat.js");

// Firebase 초기화 (중복 방지)
const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL:
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
  measurementId: "G-5L8PM38MX7",
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Firebase scraps 실시간 구독 및 모든 탭에 브로드캐스트
let lastScrapsJson = "";
firebase
  .database()
  .ref("scraps")
  .on("value", (snapshot) => {
    const val = snapshot.val() || {};
    const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
    const json = JSON.stringify(arr);
    if (json !== lastScrapsJson) {
      lastScrapsJson = json;
      // 모든 탭에 브로드캐스트
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(
              tab.id,
              {
                action: "cp_firebase_scraps",
                data: arr,
              },
              () => {}
            );
          }
        }
      });
    }
  });

// Alt 키 상태 변경 메시지 및 스크랩 데이터 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // content.js가 최신 스크랩 데이터 요청 시 응답
  if (msg && msg.action === "cp_get_firebase_scraps") {
    try {
      const arr = JSON.parse(lastScrapsJson || "[]");
      sendResponse({ data: arr });
    } catch (e) {
      sendResponse({ data: [] });
    }
    return; // 동기 응답이므로 return true 불필요
  }
  if (msg.action === "alt_key_state_changed") {
    // 현재 탭의 모든 프레임에 메시지 전달
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: "alt_key_state_changed",
            isAltPressed: msg.isAltPressed,
          })
          .catch((e) => console.error("Could not send message to tab", e));
      }
    });
    // 동기 처리이므로 return true 제거 (경고 방지)
  }
  if (msg.action === "scrap_element" && msg.data) {
    // 스크랩 데이터 수신 시 Firebase에 저장
    const scrapRef = firebase.database().ref("scraps").push();
    const scrapPayload = {
      ...msg.data,
      timestamp: Date.now(),
    };
    scrapRef
      .set(scrapPayload)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답
  }
  // content.js에서 메시지 수신 시 Firebase에 데이터 저장
  if (msg && msg.action === "firebase-test-write") {
    const testRef = firebase.database().ref("test/testWrite");
    testRef
      .set({
        message: "테스트 저장",
        timestamp: Date.now(),
      })
      .then(() => {
        return testRef.get();
      })
      .then((snapshot) => {
        if (snapshot.exists()) {
          sendResponse({ success: true, data: snapshot.val() });
        } else {
          sendResponse({ success: false, error: "No data available" });
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    // 비동기 응답을 위해 true 반환
    return true;
  }
});
// 확장 아이콘 클릭 시 현재 탭에 content.js가 없으면 주입 후 메시지 전송
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.insertCSS(
    {
      target: { tabId: tab.id },
      files: ["css/style.css"],
    },
    () => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: ["content.js"],
        },
        () => {
          chrome.tabs.sendMessage(tab.id, {
            action: "open_content_pilot_panel",
          });
        }
      );
    }
  );
});
