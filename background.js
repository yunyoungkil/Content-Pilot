// 확장 아이콘 클릭 시 현재 탭에 content.js로 패널 오픈 메시지 전송
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "open_content_pilot_panel" });
});
