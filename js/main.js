// Content-Pilot 메인 엔트리포인트 (content.js 역할)
// 각 모듈 초기화 및 메시지 리스너 등록
// import/export 제거, window 바인딩 방식으로 변경 (content script 호환)
// 각 모듈에서 window.함수명 = 함수; 형태로 바인딩되어 있다고 가정

// Alt+클릭 하이라이트 기능 초기화
if (window.initHighlighter) window.initHighlighter();


// 최초 진입 시 Scrapbook 모드로 시작
function initAuthUI() {
  // 실제 구현에서는 Firebase Auth 등으로 로그인 상태를 확인해야 함
  // 여기서는 임시로 user가 null이면 로그인 UI, 있으면 프로필 UI 렌더링
  // const dummyUser = null; // { displayName: '홍길동', photoURL: 'https://randomuser.me/api/portraits/men/1.jpg' };
  // if (dummyUser) {
  //   window.renderProfileUI(dummyUser);
  // } else {
  //   window.renderLoginButton();
  // }
  if (window.createPanel) window.createPanel();
  if (window.renderScrapbook) window.renderScrapbook();
}

initAuthUI();

// 크롬 메시지 리스너
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'open_content_pilot_panel') {
    if (window.createPanel) window.createPanel();
    if (window.renderScrapbook) window.renderScrapbook();
  }
  // ...기타 메시지 처리...
});

// 모드 전환 탭/이벤트 바인딩 (전역)
// (각 모듈에서 window에 바인딩되어 있으므로 별도 처리 불필요)
