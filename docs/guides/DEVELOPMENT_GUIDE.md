# 개발 가이드

> **최종 업데이트**: 2025-01-26  
> **상태**: ✅ 최신

## 📋 개요

Content Pilot 개발을 시작하기 위한 가이드입니다.

## 🚀 개발 환경 설정

### 사전 요구사항

- **Node.js** (v16 이상)
- **npm** 또는 **yarn**
- **Google Chrome** (v109 이상) - Offscreen Document API 지원

### 설치

```bash
# 프로젝트 클론
git clone [repository-url]
cd Content-Pilot

# 의존성 설치
npm install

# 개발 모드 빌드 (watch 모드)
npm run watch

# 프로덕션 빌드
npm run build
```

---

## 📁 프로젝트 구조

```
Content-Pilot/
├── manifest.json              # 확장 프로그램 설정
├── background.js              # Service Worker (소스)
├── content.js                 # Content Script (Webpack 진입점)
├── offscreen.html             # Offscreen Document
├── offscreen.js              # Offscreen Document 스크립트
├── webpack.config.js          # Webpack 설정
├── package.json              # 의존성 관리
├── js/                       # 소스 코드
│   ├── main.js              # 메인 진입점
│   ├── state.js             # 전역 상태 관리
│   ├── constants.js         # 상수 정의
│   ├── utils.js            # 유틸리티 함수
│   ├── core/               # 핵심 로직
│   │   ├── highlighter.js  # 하이라이터
│   │   └── scrapbook.js   # 스크랩북
│   ├── services/           # 서비스 레이어
│   │   ├── aiService.js
│   │   ├── analyticsService.js
│   │   ├── authService.js
│   │   ├── cascadeDeleteService.js
│   │   ├── collectorService.js
│   │   ├── firebaseService.js
│   │   ├── kanbanService.js
│   │   ├── offscreenService.js
│   │   ├── scrapService.js
│   │   └── thumbnailService.js
│   └── ui/                 # UI 컴포넌트
│       ├── panel.js        # 메인 패널
│       ├── header.js       # 헤더
│       ├── dashboardMode.js
│       └── ...
├── css/                     # 스타일시트
├── dist/                    # 빌드 결과물
├── lib/                     # 외부 라이브러리
└── docs/                    # 문서
```

---

## 🔧 개발 워크플로우

### 1. 코드 수정

소스 코드를 수정합니다 (`js/` 폴더).

### 2. 빌드

```bash
# 개발 모드 (watch)
npm run watch

# 또는 프로덕션 빌드
npm run build
```

### 3. 확장 프로그램 로드

1. Chrome에서 `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축 해제된 확장 프로그램을 로드합니다" 클릭
4. 프로젝트 루트 폴더 선택

### 4. 변경사항 적용

코드를 수정한 후:

1. Webpack이 자동으로 빌드 (watch 모드)
2. `chrome://extensions`에서 확장 프로그램 새로고침 버튼 클릭
3. 테스트할 웹페이지 새로고침

---

## 🏗️ 아키텍처 패턴

### 서비스 레이어 패턴

각 기능은 독립적인 서비스로 분리되어 있습니다:

```javascript
// js/services/myService.js
import { getDb, getCurrentUserId } from './firebaseService.js';
import { Logger } from '../utils.js';

export async function myFunction(param) {
  try {
    const userId = await getCurrentUserId();
    // 로직 구현
    return { success: true, data: result };
  } catch (error) {
    Logger.error('[myFunction] 에러:', error);
    return { success: false, error: error.message };
  }
}
```

### UI 컴포넌트 패턴

UI 컴포넌트는 `baseView.js`를 상속받습니다:

```javascript
// js/ui/myMode.js
import { BaseView } from './baseView.js';

export class MyMode extends BaseView {
  constructor() {
    super('my-mode');
  }

  async render() {
    this.container.innerHTML = `
      <div class="my-mode">
        <!-- UI 내용 -->
      </div>
    `;
    this.attachEventListeners();
  }

  attachEventListeners() {
    // 이벤트 리스너 연결
  }
}
```

---

## 🔑 주요 개념

### 1. 채널 중심 아키텍처

모든 데이터(아이디어, 스크랩, 성과)는 `channelId`로 구분됩니다.

```javascript
// 채널 ID 가져오기
const channelId = await getCurrentChannelId();

// 채널별 데이터 조회
const scraps = await getFirebaseScraps(channelId);
```

### 2. Firebase REST API

Firebase SDK 대신 REST API를 사용합니다:

```javascript
import { ref, get, set, update, remove } from './firebaseService.js';

// 데이터 읽기
const snapshot = await get(ref(getDb(), `kanban/${userId}`));
const data = snapshot.val();

// 데이터 쓰기
await set(ref(getDb(), `kanban/${userId}/${cardId}`), cardData);
```

### 3. Offscreen Document 및 HTML 정제

DOM 분석 및 HTML 정제가 필요한 경우 Offscreen Service를 사용합니다:

```javascript
import { sanitizeHtmlInOffscreen, parseHtmlInOffscreen } from './offscreenService.js';

// HTML 정제 (XSS 방어)
const cleanedHtml = await sanitizeHtmlInOffscreen(rawHtml);

// HTML 파싱
const result = await parseHtmlInOffscreen(htmlContent, baseUrl);
```

**Offscreen Service 주요 기능**:

- `sanitizeHtmlInOffscreen()`: DOMPurify를 사용한 HTML 정제 및 포매팅
- `resizeImageInOffscreen()`: 이미지 리사이징
- `renderTemplateInOffscreen()`: 템플릿 렌더링
- `parseHtmlInOffscreen()`: HTML 파싱 및 메타데이터 추출

**보안 기능**:

- DOMPurify를 통한 XSS 공격 방어
- 위험한 태그/속성 자동 제거
- Marked를 통한 안전한 마크다운 변환

---

## 🧪 테스트

### 로컬 테스트

1. 개발 모드로 빌드
2. Chrome 확장 프로그램으로 로드
3. 실제 웹페이지에서 테스트

### 디버깅

**Service Worker 디버깅**:

1. `chrome://extensions`에서 "서비스 워커" 링크 클릭
2. Chrome DevTools에서 디버깅

**Content Script 디버깅**:

1. 확장 프로그램이 주입된 웹페이지에서 F12
2. DevTools에서 디버깅

**Logger 사용**:

```javascript
import { Logger } from '../utils.js';

Logger.info('정보');
Logger.warn('경고');
Logger.error('에러');
Logger.debug('디버그');
Logger.biz('비즈니스 로직');
```

---

## 📝 코딩 컨벤션

### 파일 명명

- **서비스**: `camelCase.js` (예: `aiService.js`)
- **UI 컴포넌트**: `camelCase.js` (예: `dashboardMode.js`)
- **유틸리티**: `camelCase.js` (예: `utils.js`)

### 함수 명명

- **export 함수**: `camelCase` (예: `generateDraftFromIdea`)
- **내부 함수**: `camelCase` (예: `selectPersona`)

### 변수 명명

- **일반 변수**: `camelCase` (예: `userId`, `cardData`)
- **상수**: `UPPER_SNAKE_CASE` (예: `CONSTANTS.USER_ID`)

### 에러 처리

```javascript
try {
  const result = await someFunction();
  if (!result.success) {
    Logger.error('[functionName] 실패:', result.error);
    return { success: false, error: result.error };
  }
  return { success: true, data: result.data };
} catch (error) {
  Logger.error('[functionName] 예외:', error);
  return { success: false, error: error.message };
}
```

---

## 🔐 환경 변수 및 설정

### API 키 설정

API 키는 `chrome.storage.local`에 저장됩니다:

```javascript
// 저장
await chrome.storage.local.set({
  geminiApiKey: 'your-api-key',
  youtubeApiKey: 'your-api-key',
});

// 읽기
const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
```

### Firebase 설정

Firebase 설정은 `firebaseService.js`에서 관리됩니다:

```javascript
// Firebase 초기화
initializeFirebase();

// 인증
await signInToFirebaseWithGoogleToken(token);
```

---

## 🚨 주의사항

### 1. Manifest V3 제약

- Service Worker는 DOM API를 사용할 수 없습니다
- DOM 분석이 필요한 경우 Offscreen Document를 사용하세요

### 2. CORS 정책

- 외부 API 호출 시 CORS 정책을 확인하세요
- 필요한 경우 `host_permissions`에 도메인을 추가하세요

### 3. Chrome 확장 프로그램 제한

- `chrome.storage.local` 용량 제한: 10MB
- Service Worker 생명주기 관리 필요
- Service Worker에서 동적 `import()` 사용 불가 (정적 import만 가능)

### 4. Firebase 보안 규칙

- Firebase 보안 규칙을 반드시 설정하세요
- 사용자별 데이터 접근 제어 구현

---

## 📚 추가 리소스

### 공식 문서

- [Chrome Extension 개발 가이드](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 마이그레이션](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Firebase Realtime Database](https://firebase.google.com/docs/database)

### 프로젝트 문서

- [서비스 아키텍처](../architecture/SERVICES_ARCHITECTURE.md)
- [AI 서비스 가이드](./AI_SERVICE_GUIDE.md)
  -- (마이그레이션 서비스 가이드: 제거됨)
- [Firebase 채널 구조](../firebase/FIREBASE_CHANNELS_STRUCTURE.md)

---

## 🐛 문제 해결

### 빌드 오류

```bash
# node_modules 삭제 후 재설치
rm -rf node_modules package-lock.json
npm install
```

### 확장 프로그램 로드 실패

1. `manifest.json` 문법 확인
2. 빌드 결과물(`dist/`) 확인
3. Chrome 콘솔에서 에러 확인

### Firebase 연결 실패

1. Firebase 프로젝트 설정 확인
2. 보안 규칙 확인
3. 인증 상태 확인

---

## 🔗 관련 문서

- [README.md](../../README.md)
- [서비스 아키텍처](./architecture/SERVICES_ARCHITECTURE.md)
- [코드 리뷰 체크리스트](./reviews/CODE_REVIEW.md)
