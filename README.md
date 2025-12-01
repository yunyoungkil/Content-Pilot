## Note: Offscreen documents and the `offscreen` manifest field

Some Chrome versions do not yet recognise the `offscreen` manifest block
and will show a warning like "Unrecognized manifest key 'offscreen'".
The runtime Offscreen API (chrome.offscreen.createDocument) still works
without that manifest block on newer Chrome builds. For predictable
behaviour in development/tests, we recommend using Chrome 116+ (or the
latest stable / Canary) if you rely on the `offscreen` manifest field.

# Content Pilot ✈️

**Content Pilot**은 웹 콘텐츠 큐레이션부터 AI 기반 콘텐츠 기획, 작성, 성과 추적까지 전 과정을 지원하는 통합 콘텐츠 관리 플랫폼입니다. 모듈화된 JavaScript 코드와 Webpack 빌드 시스템, 그리고 최신 Manifest V3 아키텍처를 통해 체계적으로 개발되었습니다.

## 📖 프로젝트 개요

웹 서핑 중 발견한 정보를 수집하고, AI의 도움을 받아 콘텐츠를 기획하고 작성하며, 발행 후 성과를 추적하는 완전한 콘텐츠 생명주기를 한 곳에서 관리할 수 있습니다. Firebase와 Google Analytics, AdSense를 연동하여 데이터 기반의 콘텐츠 전략을 수립할 수 있습니다.

## ✨ 주요 기능

### 1. 콘텐츠 수집 및 관리

- **지능형 하이라이터**: `Alt` 키로 켜고 끄는 토글(Toggle) 모드를 통해, 스크랩할 요소를 명확하게 하이라이트합니다.
- **원클릭 요소 스크랩**: 하이라이트된 웹페이지의 모든 요소를 클릭 한 번으로 손쉽게 스크랩할 수 있습니다.
- **안정적인 데이터 수집**: Manifest V3의 **Offscreen Document**를 활용하여, 네이버 블로그의 아이프레임 구조나 지연 로딩(Lazy Loading) 이미지도 안정적으로 분석하고 수집합니다.
- **스크랩북 관리**: 수집한 콘텐츠를 체계적으로 관리하고, 아이디어로 전환할 수 있습니다.
- **이미지 갤러리**: 모든 스크랩에서 이미지를 자동으로 추출하여 갤러리로 관리하고, 에디터에 드래그앤드롭으로 삽입할 수 있습니다.

### 2. AI 기반 콘텐츠 기획

- **칸반 보드 기반 아이디어 관리**: 아이디어를 상태별(아이디어 → 진행 중 → 완료)로 관리하고, 드래그앤드롭으로 상태를 변경할 수 있습니다.
- **AI 아이디어 제안**: 성과 데이터와 사용자 피드백을 기반으로 맞춤형 아이디어를 제안합니다.
- **AI 브리핑 자동 생성**: 아이디어 저장 시 추천 목차, 추천 검색어, 주요 키워드, 롱테일 키워드를 자동으로 생성합니다.
- **콘텐츠 재활용 제안**: 기존 콘텐츠의 성과를 분석하여 업데이트가 필요한 콘텐츠를 제안합니다.

### 3. 통합 워크스페이스

- **통합 에디터**: Rich Text Editor를 활용한 전문적인 콘텐츠 작성 환경
- **AI 초안 자동 생성**: 브리핑 데이터를 기반으로 초안을 자동 생성합니다.
- **AI 기반 제휴 링크 자동 삽입**: 사용자가 등록한 제휴 링크를 문맥에 맞게 자연스럽게 삽입하고, 매력적인 CTA 문구를 자동 생성합니다.
- **스마트 썸네일 생성**: 3가지 컨셉(호기심 자극형, 정보 요약형, 감성/공감형)의 썸네일을 고속 병렬 처리로 자동 생성하고 선택할 수 있습니다.
- **리소스 통합 관리**: AI 브리핑, 추천 목차, 추천 검색어, 모든 스크랩, 이미지 갤러리를 탭으로 관리합니다.
- **실시간 동기화**: Firebase를 통한 실시간 데이터 동기화

### 4. 성과 추적 및 분석

- **Google Analytics 4 (GA4) 연동**: 페이지뷰, 세션 수, 체류 시간, 이탈률, 유입 경로 등 상세한 분석 데이터 수집
- **Google AdSense 연동**: 수익, RPM, 클릭률 등 수익화 데이터 수집
- **자동 업데이트**: 6시간마다 자동으로 성과 데이터를 업데이트합니다.
- **성과 시각화**: 기획 보드 카드에 성과 지표 표시, 시간대별 추이 차트, 상위 콘텐츠 비교 차트 제공
- **성과 대시보드**: 모든 발행 콘텐츠의 성과를 한눈에 비교하고 분석할 수 있습니다.
- **성과 리포트**: AI 기반 성과 분석 및 개선 제안을 제공합니다.

### 5. 채널 연동 및 관리

- **채널 중심 아키텍처**: 경쟁 채널을 각 내 채널의 하위 속성으로 관리하여 더 체계적인 구조를 제공합니다.
- **글로벌 채널 선택기**: 헤더에 위치한 채널 선택기를 통해 언제든지 작업할 채널을 전환할 수 있습니다.
- **다중 채널 관리**: 여러 블로그/채널을 추가하고 각각 다른 GA4 속성과 AdSense 계정을 연결할 수 있습니다.
- **Google OAuth 인증**: 채널 설정 모달에서 Google 계정으로 로그인하여 GA4 속성 목록과 AdSense 계정 ID를 자동으로 가져옵니다.
- **채널별 데이터 필터링**: 모든 탭(대시보드, 기획 보드, 스크랩북, 워크스페이스)에서 현재 선택된 채널의 데이터만 표시됩니다.
- **자동 데이터 마이그레이션**: 기존 데이터를 자동으로 마이그레이션하여 새 아키텍처에 맞게 변환합니다.
- **연동 상태 모니터링**: 각 채널의 연동 상태를 실시간으로 확인하고 테스트할 수 있습니다.
- **채널 데이터 구조**: 각 채널은 `inputUrl`(원본 URL), `apiUrl`(RSS URL), `gaPropertyId`, `adSenseAccountId`, `competitors`(경쟁 채널 목록)를 포함합니다. 자세한 구조는 `FIREBASE_CHANNELS_STRUCTURE.md` 참조.

### 6. 시스템 진단

- **종합 시스템 진단**: 5개 핵심 영역(API 연동, 데이터 구조, Firebase 연결, 성과 데이터 수집, 외부 API 연동)에 대한 20개 항목을 점검합니다.
- **실시간 진단 리포트**: 각 항목의 상태를 실시간으로 확인하고 문제점을 즉시 파악할 수 있습니다.
- **자동 문제 감지**: 시스템의 잠재적 문제를 사전에 감지하여 예방합니다.

## 🛠️ 기술 스택

- **Core**: JavaScript (ES6+), HTML5, CSS3
- **Build System**: Webpack, Babel
- **Backend & Database**: Firebase (Realtime Database)
- **Platform**: Chrome Extension (Manifest V3 with Offscreen Document)
- **Editor**: Quill Rich Text Editor
- **API Integration**: Google Analytics 4 API, Google AdSense API, Google Gemini API
- **Authentication**: Google OAuth 2.0
- **Security**: DOMPurify (XSS 방어)
- **Markdown**: Marked (마크다운 파싱)

## 🚀 설치 및 개발 환경 설정

이 프로젝트를 로컬 컴퓨터에 설치하고 개발을 시작하는 방법은 다음과 같습니다.

### 사전 준비

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/ko) (npm 포함)
- **Google Chrome 브라우저 (버전 109 이상)**: 이 확장 프로그램의 핵심 기능인 `Offscreen Document` API가 **Chrome 109**부터 정식 지원되므로, 반드시 해당 버전 이상의 Chrome 브라우저가 필요합니다.

### 설치 순서

1. **프로젝트 복제 (Clone)**

   ```bash
   git clone [깃허브 저장소 URL]
   ```

2. **프로젝트 폴더로 이동**

   ```bash
   cd content-pilot
   ```

3. **의존성 패키지 설치 (Install Dependencies)**

   ```bash
   npm install
   ```

4. **프로젝트 빌드 (Build)**

   ```bash
   npx webpack
   ```

5. **프로젝트 자동 빌드 (Build)**

   package.json

   ```json
   "scripts": {
       "build": "webpack --mode=production",
       "watch": "webpack --mode=development --watch"
   }
   ```

   ```bash
   npm run watch
   ```

   (이후 `chrome://extensions`에서 '압축 해제된 확장 프로그램을 로드'로 폴더를 선택하여 로드합니다.)

## 🔄 확장 프로그램 업데이트 방법

소스 코드(`*.js`, `manifest.json` 등)를 수정한 후에는, 변경사항을 개발 중인 확장 프로그램에 적용하기 위해 다음 단계를 따라야 합니다.

1. **프로젝트 빌드 (Re-build)**

   터미널에서 `npx webpack` 명령어를 다시 실행하여 변경된 소스 코드를 `dist/bundle.js` 파일에 반영합니다.

   ```bash
   npx webpack
   ```

2. **확장 프로그램 새로고침 (Reload)**

   `chrome://extensions` 페이지로 이동하여 Content Pilot 확장 프로그램 카드에 있는 **새로고침(↻) 아이콘**을 클릭합니다.

---

## 📂 프로젝트 구조 및 파일 설명

### 프로젝트 구조도

```bash

Content-Pilot/
├── 📄 manifest.json              # 확장 프로그램 설정 파일
├── 📄 background.js               # 서비스 워커 (Firebase, API 호출)
├── 📄 content.js                  # Webpack 진입점
├── 📄 offscreen.html              # Offscreen Document HTML
├── 📄 offscreen.js                # DOM 분석 및 HTML 정제 전용 스크립트 (Webpack 빌드 대상)
├── 📄 webpack.config.js           # Webpack 빌드 설정
├── 📄 package.json                # 프로젝트 의존성 관리
├── 📁 js/                         # 소스 코드
│   ├── 📁 core/                   # 핵심 로직
│   │   ├── 📜 highlighter.js     # 하이라이터 기능
│   │   └── 📜 scrapbook.js       # 스크랩북 관리
│   ├── 📁 ui/                     # UI 모드별 컴포넌트
│   │   ├── 📜 panel.js            # 메인 패널 관리
│   │   ├── 📜 header.js           # 헤더 및 탭
│   │   ├── 📜 dashboardMode.js   # 대시보드 모드
│   │   ├── 📜 scrapbookMode.js   # 스크랩북 모드
│   │   ├── 📜 kanbanMode.js      # 기획 보드 모드
│   │   ├── 📜 workspaceMode.js  # 워크스페이스 모드
│   │   ├── 📜 channelMode.js     # 채널 연동 모드
│   │   ├── 📜 adminMode.js       # 시스템 진단 모드
│   │   ├── 📜 performanceDashboardMode.js  # 성과 대시보드
│   │   └── 📜 performanceReportMode.js     # 성과 리포트
│   ├── 📁 utils/                  # 유틸리티 함수
│   │   ├── 📜 editor-markdown-auto.js
│   │   └── 📜 markdownToQuill.js
│   ├── 📜 main.js                 # 메인 진입점
│   ├── 📜 state.js                # 전역 상태 관리
│   └── 📜 constants.js            # 상수 정의
├── 📁 css/                        # 스타일시트
│   ├── 📜 style.css              # 기본 스타일
│   ├── 📜 kanban.css             # 칸반 보드 스타일
│   └── 📜 workspace.css          # 워크스페이스 스타일
├── 📁 dist/                       # 빌드 결과물
│   └── 📜 bundle.js               # Webpack 번들
├── 📁 images/                     # 이미지 리소스
│   └── 📜 icon-*.png             # 확장 프로그램 아이콘
├── 📁 lib/                        # 외부 라이브러리
│   ├── 📜 firebase-*.js          # Firebase SDK
│   ├── 📜 quill.js               # Quill 에디터
│   └── 📜 ... (기타 라이브러리)
└── 📁 docs/                       # 문서
    └── 📜 성과-데이터-시각화-사용-패턴.md

```

### 디렉토리별 파일 설명

#### 최상위 파일

- **`manifest.json`**: 확장 프로그램의 **설계도**입니다. 이름, 버전, 권한(`offscreen`, `identity` 포함), 실행할 스크립트(`background.js`, `content.js`), OAuth 설정 등 모든 기본 정보를 정의합니다.

- **`background.js`**: 확장 프로그램의 **중앙 관제탑** (서비스 워커)입니다. Firebase와의 통신, Google Analytics/AdSense API 호출, AI API 연동, 성과 데이터 수집 등 보이지 않는 곳에서 모든 핵심 로직을 처리합니다. DOM 분석이 필요할 때는 `offscreen.html`을 호출하여 작업을 위임합니다.

- **`content.js`**: 실제 웹페이지에 삽입되는 **현장 요원**입니다. `js/` 폴더의 모든 UI 및 핵심 로직 모듈을 가져와(`import`) 실행하는 Webpack 번들의 시작점입니다. 페이지 UI를 그리고 사용자의 상호작용(하이라이트, 클릭)을 직접 처리합니다.

- **`offscreen.html` & `offscreen.js`**: **DOM 분석 및 HTML 정제 전문가**입니다. `background.js`는 보안상의 이유로 DOM API(`DOMParser` 등) 사용에 제약이 있습니다. 이 제약을 극복하기 위해, `background.js`는 수집한 HTML 텍스트를 `offscreen` 페이지로 보냅니다. `offscreen.js`는 완전한 DOM 환경을 활용하여 HTML을 안전하고 정확하게 분석한 후, 이미지, 요약 등의 결과만 다시 `background.js`로 돌려주는 핵심적인 역할을 수행합니다. 또한 **DOMPurify와 Marked를 사용하여 XSS 공격을 방어하고 마크다운을 안전하게 HTML로 변환**하는 역할도 담당합니다.

- **`webpack.config.js`**: Webpack 빌더의 **설정 파일**입니다. `content.js`, `background.js`, `offscreen.js`를 시작점으로 `js/` 폴더의 여러 JavaScript 파일들을 어떻게 하나의 최종 결과물(`dist/*.bundle.js`)로 합칠지 정의합니다.

- **`package.json`**: 프로젝트의 **정보 파일**입니다. 프로젝트의 이름, 버전과 함께 `webpack`, `babel`, `quill` 등 개발에 필요한 도구(패키지)들의 목록을 관리합니다.

#### 디렉토리

- **`/js`**: 애플리케이션의 핵심 JavaScript 소스 코드들이 모여있는 곳입니다. `content.js`가 이 폴더의 모듈들을 가져와 사용합니다.
  - **`/js/core`**: 스크랩 하이라이터, 스크랩북 관리 등 핵심 비즈니스 로직을 담당하는 파일들이 위치합니다.
  - **`/js/ui`**: 메인 패널, 대시보드, 기획 보드, 워크스페이스, 성과 대시보드 등 사용자 인터페이스(UI)를 생성하고 제어하는 코드들이 위치합니다.
  - **`/js/services`**: AI 서비스, Firebase 연동, 인증, 데이터 수집, 칸반 보드 관리 등 각 기능을 독립적인 서비스로 분리한 파일들이 위치합니다.
    - `aiService.js`: Gemini API를 활용한 AI 기능
    - `analyticsService.js`: GA4 및 AdSense 데이터 수집 및 분석
    - `authService.js`: Google OAuth 인증
    - `cascadeDeleteService.js`: 채널/경쟁 채널 삭제 시 연쇄 삭제 처리
    - `collectorService.js`: RSS 및 YouTube 콘텐츠 수집
    - `firebaseService.js`: Firebase REST API 연동
    - `kanbanService.js`: 칸반 보드 관리
  - (마이그레이션 서비스 제거됨)
  - `offscreenService.js`: Offscreen Document 관리 및 HTML 정제
  - `scrapService.js`: 스크랩 관리
  - `thumbnailService.js`: 썸네일 생성
  - **`/js/utils`**: 에디터 변환, 마크다운 처리 등 유틸리티 함수들이 위치합니다.

- **`/css`**: UI 스타일을 정의하는 CSS 파일들이 위치합니다.
  - `style.css`: 기본 스타일
  - `kanban.css`: 칸반 보드 전용 스타일
  - `workspace.css`: 워크스페이스 전용 스타일

- **`/dist`**: Webpack이 소스 코드들을 하나로 합쳐서 만들어낸 **빌드 결과물**이 저장되는 폴더입니다.
  - `content.bundle.js`: `content.js`와 `js/` 폴더의 모든 JavaScript 파일이 합쳐지고 압축된 파일로, 실제 브라우저가 웹페이지에서 실행하는 최종 파일입니다.
  - `background.bundle.js`: `background.js`와 관련 서비스 파일들이 합쳐진 Service Worker 파일입니다.
  - `offscreen.bundle.js`: `offscreen.js`와 DOMPurify, Marked 등이 합쳐진 Offscreen Document 파일입니다.

- **`/images`**: 확장 프로그램 아이콘 및 UI 이미지 파일들을 보관합니다.

- **`/lib`**: Firebase SDK, Quill 에디터, TUI Image Editor 등 외부에서 가져온 라이브러리 파일들을 보관합니다. `background.js`가 `importScripts`를 통해 이 파일들을 불러옵니다.

- **`/docs`**: 프로젝트 문서 및 사용 가이드가 위치합니다.
  - `guides/`: 사용 가이드 및 개발 가이드
  - `architecture/`: 아키텍처 및 구조 문서
  - `firebase/`: Firebase 관련 문서
  - `analytics/`: Analytics 관련 문서
  - `audits/`: 감사 및 검증 문서
  - `reviews/`: 코드 리뷰 문서

## 🎯 주요 모드 및 기능

Content Pilot은 다양한 모드를 제공하여 콘텐츠 생명주기의 각 단계를 지원합니다:

### 1. 대시보드 (Dashboard)

- 전체 아이디어 및 성과 개요
- AI 아이디어 제안 기능
- 내 채널 및 경쟁사 채널 관리
- 빠른 아이디어 생성 및 관리

### 2. 스크랩북 (Scrapbook)

- 웹에서 수집한 모든 스크랩 관리
- 스크랩에서 아이디어로 전환 기능
- 스크랩 검색 및 필터링
- 이미지 자동 추출 및 관리

### 3. 기획 보드 (Kanban Board)

- 칸반 보드 기반 아이디어 관리
- 상태별 관리 (아이디어 → 진행 중 → 완료)
- 드래그앤드롭으로 상태 변경
- 성과 지표 표시 (수익, 페이지뷰, 체류 시간)
- 발행 URL 연결 및 성과 추적
- 카드 클릭 시 워크스페이스로 이동

### 4. 워크스페이스 (Workspace)

- 통합 콘텐츠 작성 환경
- Rich Text Editor를 활용한 전문적인 에디터
- AI 브리핑, 추천 목차, 추천 검색어 탭
- 모든 스크랩 및 이미지 갤러리 통합
- AI 초안 자동 생성
- 실시간 자동 저장

### 5. 성과 대시보드 (Performance Dashboard)

- 모든 발행 콘텐츠의 성과 한눈에 보기
- 상위 5개 콘텐츠 비교 차트
- 성과 순위 정렬 (수익, 페이지뷰, 최근 업데이트 순)
- 통계 요약 (총 수익, 총 페이지뷰, 총 세션)

### 6. 성과 리포트 (Performance Report)

- AI 기반 성과 분석 리포트
- 성공 요인 및 개선점 제안
- 상위/하위 성과 콘텐츠 분석
- 성과 패턴 분석 및 인사이트 제공

### 7. 채널 연동 (Channel Integration)

- 채널 중심 아키텍처 (경쟁 채널이 내 채널 하위로 관리)
- 글로벌 채널 선택기 (헤더에서 언제든지 채널 전환)
- Google 계정 OAuth 인증 (GA4 속성 및 AdSense 계정 자동 연동)
- 다중 블로그/채널 관리
- GA4 속성 연결 및 테스트
- AdSense 계정 연동
- 채널별 데이터 필터링
- 자동 데이터 마이그레이션
- 연동 상태 모니터링
- **채널 데이터 구조**: `inputUrl`(원본 URL), `apiUrl`(RSS URL 자동 생성), `gaPropertyId`, `adSenseAccountId`, `competitors`(경쟁 채널 배열) 포함

### 8. 시스템 진단 (System Diagnosis)

- 종합 시스템 진단 (5개 영역, 20개 항목)
- 실시간 진단 리포트
- 자동 문제 감지 및 알림

## 📚 문서

프로젝트의 상세한 기술 문서와 가이드는 `docs/` 폴더에 주제별로 정리되어 있습니다:

### 📖 가이드 문서 (`docs/guides/`)

- **`AI_SERVICE_GUIDE.md`**: AI 서비스 사용 가이드 (Gemini API, 브리핑 생성, 초안 생성, HTML 정제, 제휴 링크 삽입)
- **`AFFILIATE_LINKS_GUIDE.md`**: 제휴 마케팅 링크 가이드 (문맥 인식 자동 삽입, AI 기반 CTA 생성, 스마트 필터링)
- **`PROMPT_BUILDER_TEST_GUIDE.md`**: 프롬프트 빌더 시스템 검증 및 테스트 가이드
- **(마이그레이션 가이드 제거됨)**
- **`DEVELOPMENT_GUIDE.md`**: 개발자를 위한 개발 환경 설정 및 코딩 가이드
- **`AUTHENTICATION_FLOW.md`**: Google OAuth 인증 흐름 및 Service Worker에서의 Firebase 작업
- **`CORS_SETUP_GUIDE.md`**: CORS 설정 가이드
- **`성과-데이터-시각화-사용-패턴.md`**: 성과 데이터 시각화 기능 사용자 사용 패턴

### 🏗️ 아키텍처 문서 (`docs/architecture/`)

- **`SERVICES_ARCHITECTURE.md`**: 서비스 아키텍처 개요 및 서비스 간 상호작용
- **`ACTUAL_SAVE_STRUCTURE.md`**: 실제 저장되는 데이터 구조 및 수정 이력
- **`CARD_ADDITION_LOGIC.md`**: 카드 추가 로직 설명

### 🔥 Firebase 문서 (`docs/firebase/`)

- **`FIREBASE_CHANNELS_STRUCTURE.md`**: Firebase 채널 데이터 구조 상세 설명
  - 채널 데이터 저장 경로 및 구조
  - 필드 설명 (`inputUrl`, `apiUrl`, `url`, `gaPropertyId`, `adSenseAccountId`, `competitors`)
  - 데이터 읽기/쓰기 예시
- **`FIREBASE_AUTH_SETUP.md`**: Firebase 인증 설정 가이드
- **`FIREBASE_REST_API_MIGRATION.md`**: Firebase REST API 마이그레이션 완료 문서
- **`FIREBASE_SDK_USAGE.md`**: Firebase SDK 사용 가이드
- **`FIREBASE_SECURITY_RULES.md`**: Firebase Database 보안 규칙 설정 가이드

### 📊 Analytics 문서 (`docs/analytics/`)

- **`GA4_PIPELINE_VALIDATION.md`**: GA4 데이터 파이프라인 검증
- **`GA4_COLLECTED_METRICS.md`**: 수집되는 GA4 메트릭 목록
- **`GA4_ADDITIONAL_METRICS_CHECK.md`**: GA4 추가 메트릭 체크

### 🔍 감사 및 검증 문서 (`docs/audits/`)

- **`DASHBOARD_TAG_ANALYSIS_AUDIT.md`**: 대시보드 태그 분석 감사
- **`FUNCTION_LISTENER_VALIDATION.md`**: 함수 리스너 검증
- **`IDEA_CARD_ADDITION_AUDIT.md`**: 아이디어 카드 추가 감사
- **`PERFORMANCE_OPTIMIZATION_WORK.md`**: 성능 최적화 작업 내역
- **`REFRESH_LOGIC_VALIDATION.md`**: 새로고침 로직 검증
- **`SEARCH_TERMS_VERIFICATION_TODO.md`**: 검색어 검증 TODO
- **`ZERO_METRICS_DEBUG_CHECKLIST.md`**: 제로 메트릭 디버그 체크리스트

### 📝 코드 리뷰 (`docs/reviews/`)

- **`CODE_REVIEW.md`**: 코드 리뷰 체크리스트
- **`CODE_REVIEW_content.js.md`**: content.js 코드 리뷰

모든 문서는 `docs/` 폴더에 주제별로 정리되어 있습니다.
