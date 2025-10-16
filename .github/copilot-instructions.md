# Copilot Instructions for Content Pilot

## 프로젝트 개요

**Content Pilot**는 웹 콘텐츠 큐레이션을 위한 Chrome 확장 프로그램입니다. Manifest V3 기반으로 구축되어 Alt 키 토글 하이라이터, 원클릭 스크랩, Firebase 실시간 동기화, 워크스페이스 기반 콘텐츠 관리 기능을 제공합니다.

## 핵심 아키텍처 패턴

### 1. Chrome Extension 3-Layer Structure
- **Background Script** (`background.js`): 서비스 워커로 동작, Firebase API 연동 및 데이터 처리 중앙 집중화
- **Content Script** (`content.js` → `dist/bundle.js`): 웹페이지에 주입되어 UI 렌더링 및 사용자 상호작용 처리
- **Offscreen Document** (`offscreen.js`): DOM 파싱 및 복잡한 HTML 분석 전담 (네이버 블로그 iframe, lazy loading 처리)

### 2. Modular ES6 Architecture
모든 기능은 명확한 책임 분리를 통해 모듈화되어 있습니다:

```javascript
// 핵심 기능 모듈
js/core/
├── highlighter.js    // Alt 키 토글, 마우스오버 하이라이트, 클릭 스크랩
└── scrapbook.js      // 스크랩 데이터 로직

// UI 컴포넌트 모듈  
js/ui/
├── panel.js          // 메인 패널 생성/관리, Shadow DOM 활용
├── dashboardMode.js  // 대시보드 렌더링 및 채널 콘텐츠 표시
├── scrapbookMode.js  // 스크랩 목록 표시 및 삭제 기능
├── kanbanMode.js     // 칸반 보드 UI 및 드래그앤드롭
└── workspaceMode.js  // AI 글 생성 및 초안 편집
```

### 3. Communication Patterns
컴포넌트 간 통신은 다음 패턴을 따릅니다:

```javascript
// Content Script ↔ Background Script
chrome.runtime.sendMessage({ action: "scrap_element", data: scrapData }, callback);

// 프레임 간 통신 (main window ↔ iframe)
window.top.postMessage({ action: 'cp_show_preview', data: scrapData }, '*');

// Storage 기반 상태 공유
chrome.storage.local.set({ isScrapingActive: true, highlightToggleState: false });
```

## 개발 워크플로우

### 빌드 시스템
```bash
npm run build      # Production 빌드 (Webpack + Babel)
npm run watch      # Development 모드 (파일 변경 감지)
```

**중요**: 모든 코드 변경 후 반드시 빌드 필요. `content.js`는 `dist/bundle.js`로 번들링되어 실제 로드됩니다.

### 테스트 환경
1. Chrome 확장 프로그램 개발자 모드에서 `manifest.json` 로드
2. 변경사항 적용 시 확장 프로그램 새로고침 필요
3. Background script 디버깅: `chrome://extensions/` → 서비스 워커 검사
4. Content script 디버깅: 웹페이지 개발자 도구 사용

## 프로젝트별 특수 패턴

### 1. Shadow DOM UI 패턴
모든 UI는 웹페이지와의 CSS 충돌을 방지하기 위해 Shadow DOM을 사용합니다:

```javascript
// js/ui/panel.js
const shadowRoot = host.attachShadow({ mode: 'open' });
const styleLink = document.createElement('link');
styleLink.href = chrome.runtime.getURL('css/style.css');
shadowRoot.appendChild(styleLink);
```

### 2. Alt 키 기반 스크랩 시스템
하이라이터는 Alt 키 상태를 `chrome.storage.local`에서 관리하며, 모든 프레임에서 동기화됩니다:

```javascript
// js/core/highlighter.js
chrome.storage.local.get(["isScrapingActive", "highlightToggleState"], function (result) {
  if (result.isScrapingActive && result.highlightToggleState) {
    // 하이라이트 활성화
  }
});
```

### 3. Firebase 데이터 정제 패턴
Firebase 저장 전 모든 `undefined` 값을 `null`로 변환하는 정제 함수를 사용합니다:

```javascript
// background.js
function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  // 재귀적으로 객체/배열 정제
}
```

### 4. Offscreen Document 활용
복잡한 DOM 분석은 Offscreen Document에서 처리합니다:

```javascript
// background.js
await getOffscreenDocument();
const result = await chrome.runtime.sendMessage({ 
  action: 'parse_html_in_offscreen', 
  html: postHtml, 
  baseUrl: fullLink 
});
```

## 상태 관리 및 데이터 흐름

### 전역 상태 (`js/state.js`)
```javascript
const state = {
  activeMode: "scrapbook",     // 현재 활성 UI 모드
  isLayoutEditing: false,      // 레이아웃 편집 상태
  firebaseScraps: [],          // Firebase에서 가져온 스크랩 데이터
  panel: null                  // 패널 DOM 참조
};
```

### 모드 전환 패턴
UI 모드 전환 시 다음 패턴을 사용합니다:

```javascript
// js/ui/panel.js에서 모드별 렌더링 함수 호출
function switchMode(mode, container) {
  window.__cp_active_mode = mode;
  switch(mode) {
    case 'dashboard': renderDashboard(container); break;
    case 'scrapbook': renderScrapbook(container); break;
    case 'kanban': renderKanban(container); break;
    case 'workspace': renderWorkspace(container); break;
  }
}
```

## 확장 및 새 기능 추가 가이드

### 새 UI 모드 추가
1. `js/ui/newMode.js` 생성 및 `export function renderNewMode(container)` 구현
2. `js/ui/panel.js`에서 import 및 switch 문에 케이스 추가
3. 필요시 전용 CSS 파일 생성 후 `panel.js`에서 동적 로드

### 새 core 기능 추가
1. `js/core/newFeature.js` 생성
2. `content.js`에서 초기화 함수 호출
3. Background script와의 통신이 필요한 경우 메시지 액션 추가

### Firebase 데이터 구조 확장
1. `background.js`의 Firebase 관련 함수들에 새 데이터 구조 추가
2. `cleanDataForFirebase()` 함수에서 새 필드 처리 로직 확인
3. 관련 UI 컴포넌트에서 새 데이터 렌더링 로직 구현

---

이 문서는 Content Pilot의 독특한 Chrome Extension 아키텍처와 모듈형 패턴을 이해하여 즉시 생산적으로 작업할 수 있도록 돕습니다. 질문이나 불명확한 부분이 있으면 관련 파일을 직접 참조하거나 피드백을 요청하세요.
