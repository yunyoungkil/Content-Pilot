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

// Alt 키 상태 변경 메시지 및 스크랩 데이터 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
    return true;
  }
  if (msg.action === "scrap_element" && msg.data) {
    // 스크랩 데이터 수신 처리 (예: 콘솔 출력, 추후 Firebase 저장 등)
    console.log("스크랩 데이터 수신:", msg.data);
    sendResponse({ success: true });
    return true;
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
