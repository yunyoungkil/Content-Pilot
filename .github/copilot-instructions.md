# Copilot Instructions for Content-Pilot

## 프로젝트 개요 및 아키텍처
- **Content-Pilot**는 크롬 확장 프로그램으로, 웹에서 텍스트/이미지 스크랩, AI 기반 기획, 멀티 모드 UI(스크랩북/칸반/초안)를 제공합니다.
- **주요 기술**: Chrome Extension MV3, Firebase(Auth/Firestore/Storage), 모듈형 ES6 JavaScript
- **구조**: 모든 주요 기능은 `js/` 하위 모듈로 분리되어 있습니다. 엔트리포인트는 `js/main.js`입니다.
- **데이터 흐름**: 사용자 액션 → content script → Firebase(실시간 동기화) → UI 반영

## 주요 디렉토리/파일
- `js/constants.js`: 모드, 키, CSS 클래스 등 상수 정의
- `js/state.js`: 전역 상태(모드, 패널, 스크랩 데이터 등)
- `js/utils.js`: showToast, shortenLink 등 UI/문자열 유틸
- `js/core/highlighter.js`: Alt+클릭 하이라이트 기능
- `js/core/scrapbook.js`: 스크랩 데이터 처리(확장 예정)
- `js/ui/panel.js`: 패널 생성/닫기/최소화 등 UI 컨테이너
- `js/ui/header.js`: 패널 헤더 렌더링
- `js/ui/scrapbookMode.js`: 스크랩북 모드 UI/이벤트
- `js/ui/kanbanMode.js`: 칸반 모드 UI/이벤트, 샘플 데이터 포함
- `js/ui/draftMode.js`: 초안 작성 모드 UI/이벤트
- `js/main.js`: 모든 모듈 연결, 진입점, 메시지 리스너, 모드 전환 전역화

## 개발/디버깅 워크플로우
- **빌드/번들 없음**: ES6 모듈을 그대로 로드, 별도 빌드 과정 없이 개발
- **핫리로드**: 코드 수정 후 크롬 확장 새로고침(개발자 모드)
- **테스트**: 별도 테스트 프레임워크 없음. 크롬 확장 환경에서 직접 기능 확인
- **디버깅**: content script의 각 모듈은 window에 일부 함수 바인딩(window.renderScrapbook 등), 콘솔에서 직접 호출 가능

## 프로젝트별 관례/패턴
- **모든 UI/로직은 모듈 단위로 분리**: content.js는 완전히 비워져 있고, main.js가 엔트리포인트
- **상태/상수/유틸은 별도 파일에서 import**
- **Firebase 연동은 background.js, content script에서 직접 수행**
- **모드 전환/이벤트 바인딩은 main.js에서 window에 노출**
- **샘플 데이터/AI 클러스터는 각 모드별 js에 하드코딩**
- **크롬 메시지(chrome.runtime.onMessage)로 백그라운드와 통신**

## 외부 연동/의존성
- **Firebase SDK**: lib/에 직접 포함, manifest.json에서 명시적으로 로드
- **크롬 API**: storage, runtime, contextMenus 등 사용
- **스타일**: css/style.css에서 전역 스타일 관리

## 예시: 새로운 모드 추가 시
1. `js/ui/새모드.js` 생성, UI/이벤트 함수 export
2. main.js에서 import 및 window에 바인딩
3. manifest.json content_scripts에 추가
4. 필요시 constants.js/state.js에 상수/상태 추가

---
이 문서는 실제 코드 구조와 워크플로우에 기반해 작성되었습니다. 관례/패턴이 변경되면 반드시 이 문서를 갱신하세요.
