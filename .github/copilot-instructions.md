# Copilot Instructions for Content Pilot

## 프로젝트 개요

- **Content Pilot**는 웹 콘텐츠 큐레이션을 위한 Chrome 확장 프로그램입니다.
- 주요 기능: 웹페이지의 텍스트/이미지 스크랩, 실시간 Firebase 동기화, 하이라이터 및 모듈형 UI 제공.
- 아키텍처: Manifest V3 기반, Offscreen Document 활용, Webpack/Babel 빌드, ES6+ 모듈화 JS.

## 주요 디렉터리 및 역할

- `background.js`, `content.js`, `offscreen.js`: 확장 핵심 로직 및 크롬 API 연동
- `js/core/`: 하이라이터, 스크랩북 등 핵심 기능 모듈
- `js/ui/`: 대시보드, 패널, 워크스페이스 등 UI 컴포넌트
- `lib/`: Firebase SDK 등 외부 라이브러리 번들
- `css/`: 스타일 및 레이아웃 정의
- `prd/`: 제품 요구사항 및 전략 문서

## 데이터 흐름 및 통신

- **Content Script**(`content.js`)가 웹페이지에서 데이터를 추출
- **Background**(`background.js`)가 이벤트 관리 및 외부 통신 처리
- **Offscreen**(`offscreen.js`)는 iframe/Lazy Loading 등 특수 상황에서 데이터 수집
- **Firebase**(`lib/firebase-*.js`)를 통해 실시간 데이터 저장/동기화
- UI 컴포넌트(`js/ui/`)는 상태(`js/state.js`)와 상호작용하며, 주요 액션은 `js/main.js`에서 조율

## 빌드 및 개발 워크플로우

- **빌드**: `webpack.config.js` 기반, `npm run build`로 번들링
- **테스트/디버깅**: Chrome 확장 개발자 모드에서 `manifest.json` 등록 후 테스트
- **핫리로드/수정**: 소스 수정 후 재번들 필요, `npm run build` 반복

## 프로젝트 고유 패턴 및 규칙

- 모든 주요 기능은 모듈 단위(`js/core/`, `js/ui/`)로 분리, 각 모듈은 명확한 역할을 가짐
- 상태 관리(`js/state.js`)는 단일 소스에서 UI와 기능 모듈에 전달
- 외부 API(Firebase 등)는 `lib/`에서 래핑하여 직접 참조
- UI/기능 확장 시 기존 모듈 구조와 통신 패턴을 준수

## 통합 및 확장

- 새로운 기능 추가 시, core/ui 디렉터리 내 모듈로 구현 후 main.js에서 연결
- 외부 서비스 연동은 lib/에 번들 추가 후 background.js에서 초기화
- 크롬 확장 Manifest V3 규칙 및 오프스크린 문서 활용 필수

## 예시

- 하이라이터 기능: `js/core/highlighter.js`에서 구현, UI는 `js/ui/panel.js`와 연동
- 스크랩북: `js/core/scrapbook.js` + `js/ui/scrapbookMode.js` 조합
- 실시간 데이터: `lib/firebase-database-compat.js` + `js/state.js` 활용

---

이 문서는 AI 에이전트가 Content Pilot 코드베이스에서 즉시 생산적으로 작업할 수 있도록 핵심 구조, 워크플로우, 규칙을 요약합니다. 불명확하거나 추가 설명이 필요한 부분이 있으면 피드백을 요청하세요.
