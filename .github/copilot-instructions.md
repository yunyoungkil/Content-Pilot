# Copilot Instructions for Content Pilot

## 프로젝트 개요

**Content Pilot**는 웹 콘텐츠 큐레이션을 위한 Chrome 확장 프로그램입니다. Manifest V3 기반으로 구축되어 Alt 키 토글 하이라이터, 원클릭 스크랩, Firebase 실시간 동기화, iframe 기반 Quill 에디터, 워크스페이스 기반 콘텐츠 관리 기능을 제공합니다.

## ⚡ 즉시 알아야 할 핵심 사항

### 코드 변경 후 필수 단계

1. **빌드**: `npm run build` (또는 `npm run watch` 실행 중인지 확인)
2. **확장 프로그램 새로고침**: `chrome://extensions/` → 새로고침 버튼 클릭
3. **웹페이지 새로고침**: Content script 변경 시 테스트 페이지도 새로고침

### 디버깅 시작점

- **Background script 로그**: `chrome://extensions/` → Content Pilot → "서비스 워커" 클릭
- **Content script 로그**: 웹페이지 개발자 도구 콘솔
- **Offscreen document 로그**: Background script 콘솔에서 offscreen 관련 메시지 확인

### 프레임 실행 규칙 (가장 흔한 실수)

```javascript
setupHighlighter(); // ✅ 모든 프레임(iframe 포함)에서 실행

if (window.self === window.top) {
  // ✅ 최상위 프레임에서만 실행
  createAndShowPanel(); // UI는 한 번만
}
```

## 핵심 아키텍처 패턴

### 1. Chrome Extension 3-Layer Structure

- **Background Script** (`background.js`): 서비스 워커로 동작, Firebase API 연동 및 데이터 처리 중앙 집중화
- **Content Script** (`content.js` → `dist/bundle.js`): 웹페이지에 주입되어 UI 렌더링 및 사용자 상호작용 처리
- **Offscreen Document** (`offscreen.js`): DOM 파싱 및 복잡한 HTML 분석 전담 (네이버 블로그 iframe, lazy loading 처리)

**중요**: Content script는 Webpack으로 번들링되므로 `content.js`를 수정해도 실제로는 `dist/bundle.js`가 로드됩니다.

### 2. Modular ES6 Architecture

모든 기능은 명확한 책임 분리를 통해 모듈화되어 있습니다:

```javascript
// 핵심 기능 모듈
js/core/
├── highlighter.js    // Alt 키 토글, 마우스오버 하이라이트, 클릭 스크랩
└── scrapbook.js      // 스크랩 데이터 로직

// UI 컴포넌트 모듈
js/ui/
├── panel.js             // 메인 패널 생성/관리, Shadow DOM 활용
├── header.js            // 패널 헤더 및 모드 전환 네비게이션
├── dashboardMode.js     // 대시보드 렌더링 및 채널 콘텐츠 표시
├── scrapbookMode.js     // 스크랩 목록 표시 및 삭제 기능
├── kanbanMode.js        // 칸반 보드 UI 및 드래그앤드롭
├── workspaceMode.js     // AI 글 생성 및 초안 편집 (iframe 에디터 포함)
├── channelMode.js       // 채널 관리 (블로그, YouTube 등)
├── draftMode.js         // 빠른 초안 작성 모드
├── preview.js           // 스크랩 미리보기 및 토스트 알림
├── thumbnailGenerator.js // PRD v2.7 범용 캔버스 렌더러 (Shape & Gradient 지원)
└── ... (utility modules)

// 유틸리티 모듈
js/utils/
├── editor-markdown-auto.js  // 마크다운 자동 변환
└── markdownToQuill.js      // 마크다운 → Quill 변환
```

### 3. Communication Patterns

컴포넌트 간 통신은 다음 패턴을 따릅니다:

```javascript
// Content Script ↔ Background Script
chrome.runtime.sendMessage(
  { action: "scrap_element", data: scrapData },
  callback
);

// 프레임 간 통신 (main window ↔ iframe)
window.top.postMessage({ action: "cp_show_preview", data: scrapData }, "*");

// Storage 기반 상태 공유
chrome.storage.local.set({
  isScrapingActive: true,
  highlightToggleState: false,
});
```

## 개발 워크플로우

### 빌드 시스템

```bash
npm run build      # Production 빌드 (Webpack + Babel)
npm run watch      # Development 모드 (파일 변경 감지)
```

**중요**: 모든 코드 변경 후 반드시 빌드 필요. `content.js`는 `dist/bundle.js`로 번들링되어 실제 로드됩니다.

### 개발 브랜치 전략

- **Main Branch**: `Master` (안정 버전)
- **Current Working Branch**: `에디터-iframe-적용` (Editor iframe implementation)
- iframe 기반 Quill 에디터 시스템 완료, postMessage 통신 패턴 확립

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
const shadowRoot = host.attachShadow({ mode: "open" });
const styleLink = document.createElement("link");
styleLink.href = chrome.runtime.getURL("css/style.css");
shadowRoot.appendChild(styleLink);
```

### 2. Alt 키 기반 스크랩 시스템

하이라이터는 Alt 키 상태를 `chrome.storage.local`에서 관리하며, 모든 프레임에서 동기화됩니다:

```javascript
// js/core/highlighter.js
chrome.storage.local.get(
  ["isScrapingActive", "highlightToggleState"],
  function (result) {
    if (result.isScrapingActive && result.highlightToggleState) {
      // 하이라이트 활성화
    }
  }
);
```

### 3. Firebase 데이터 정제 패턴

Firebase 저장 전 모든 `undefined` 값을 `null`로 변환하는 정제 함수를 **반드시** 사용해야 합니다:

```javascript
// background.js - 모든 Firebase 저장 전 필수 호출
function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data))
    return data.map((item) => cleanDataForFirebase(item));

  const cleanedObj = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== undefined) {
        cleanedObj[key] = cleanDataForFirebase(value);
      }
    }
  }
  return cleanedObj;
}
```

### 4. Offscreen Document 활용

복잡한 DOM 분석은 Offscreen Document에서 처리합니다:

```javascript
// background.js
await getOffscreenDocument();
const result = await chrome.runtime.sendMessage({
  action: "parse_html_in_offscreen",
  html: postHtml,
  baseUrl: fullLink,
});
```

### 5. iframe 기반 에디터 패턴 (핵심 아키텍처)

워크스페이스의 Quill 에디터는 포커스 문제 해결을 위해 독립된 iframe에서 실행됩니다. 이는 프로젝트의 가장 복잡한 통신 패턴입니다:

```javascript
// workspaceMode.js - iframe 생성 및 통신 설정
<iframe id="quill-editor-iframe" src="${chrome.runtime.getURL('editor.html')}">

// 에디터 준비 상태 관리
let editorReady = false;
function sendCommand(action, data = {}) {
  if (editorReady && editorIframe.contentWindow) {
    editorIframe.contentWindow.postMessage({ action, data }, '*');
  }
}

// 양방향 메시지 수신 처리
window.addEventListener('message', (event) => {
  if (event.source !== editorIframe.contentWindow) return;
  const { action, data } = event.data;

  switch (action) {
    case 'editor-ready':
      editorReady = true;
      // 초기 콘텐츠 로드
      break;
    case 'content-changed':
      currentEditorContent = data.content;
      // 자동 저장 로직
      break;
  }
});

// editor.js - iframe 내부 에디터 제어
window.addEventListener('message', function(event) {
  const { action, data } = event.data;
  switch (action) {
    case 'set-content': quillEditor.root.innerHTML = data.html; break;
    case 'get-content':
      window.parent.postMessage({
        action: 'content-changed',
        data: { content: quillEditor.root.innerHTML }
      }, '*');
      break;
    case 'insert-image':
      const range = quillEditor.getSelection();
      quillEditor.insertEmbed(range?.index || 0, 'image', data.url);
      break;
  }
});
```

## 상태 관리 및 데이터 흐름

### 전역 상태 (`js/state.js`)

```javascript
const state = {
  activeMode: "scrapbook", // 현재 활성 UI 모드
  isLayoutEditing: false, // 레이아웃 편집 상태
  firebaseScraps: [], // Firebase에서 가져온 스크랩 데이터
  panel: null, // 패널 DOM 참조
};
```

### 모드 전환 패턴

UI 모드 전환 시 다음 패턴을 사용합니다:

```javascript
// js/ui/panel.js에서 모드별 렌더링 함수 호출
function switchMode(mode, container) {
  window.__cp_active_mode = mode;
  switch (mode) {
    case "dashboard":
      renderDashboard(container);
      break;
    case "scrapbook":
      renderScrapbook(container);
      break;
    case "kanban":
      renderKanban(container);
      break;
    case "workspace":
      renderWorkspace(container);
      break;
    case "channel":
      renderChannelMode(container);
      break;
    case "draft":
      renderDraftingMode(container);
      break;
  }
}
```

### 워크스페이스 '자료 보관함' 탭 구조 (v1.2)

워크스페이스 모드의 '자료 보관함' 패널은 사용자/운영자 역할에 따라 5개 탭으로 구성됩니다:

```javascript
// js/ui/workspaceMode.js - 탭 순서 및 역할
📖 모든 스크랩 (data-tab="all-scraps")        // 기본 탭
🖼️ 이미지 갤러리 (data-tab="image-gallery")   // 연결된 스크랩의 이미지
🎨 썸네일 생성 (data-tab="thumbnail-gen")      // 사용자용 - 목차 기반 썸네일 예시
✨ AI 이미지 생성 (data-tab="ai-image")        // 사용자용 - 범용 AI 이미지
⚙️ 템플릿 관리 (data-tab="template-admin")    // 운영자용 - 템플릿 등록/관리

// 탭 전환 시 5개 패널 제어 필요
const allScrapsArea = resourceLibrary.querySelector(".all-scraps-area");
const imageGalleryArea = resourceLibrary.querySelector(".image-gallery-area");
const thumbnailGenArea = resourceLibrary.querySelector(".thumbnail-gen-area");
const aiImageArea = resourceLibrary.querySelector(".ai-image-area");
const templateAdminArea = resourceLibrary.querySelector(".template-admin-area");
```

**중요 분리 원칙**:

- **썸네일 생성 탭**: `#ai-thumbnail-grid`에 결과 렌더링 (목차 기반)
- **AI 이미지 생성 탭**: `#ai-image-grid`에 결과 렌더링 (프롬프트 기반)
- 두 그리드를 명확히 분리하여 결과 덮어쓰기 버그 방지

### AI 기반 썸네일 템플릿 자동 생성기 (v2.4 - 반응형 템플릿 시스템)

**핵심 개념**: 운영자의 템플릿 등록 방식을 'JavaScript 코딩'에서 '참고 이미지 업로드'로 변경하여, AI Vision이 이미지를 분석하고 Canvas 렌더링 가능한 JSON 스키마를 자동 생성합니다.

**버전 히스토리**:

- **v2.0**: 최초 AI 템플릿 자동 생성 시스템
- **v2.1**: 드래그 앤 드롭 UI 추가
- **v2.2**: 웹 이미지 URL 드래그 앤 드롭 지원
- **v2.3**: 등록 즉시 UI 새로고침 + 삭제 기능
- **v2.4 (현재)**: 반응형 템플릿 시스템 - 모든 좌표/크기를 0.0~1.0 비율 값으로 변경, 16:9/1:1/9:16 등 다양한 화면 비율 지원

#### 워크플로우 개요 (v2.4 - 반응형)

```
[운영자] 로컬 파일/웹 이미지 DnD → workspaceMode.js (소스 감지)
                                            ↓
                         base64Image 또는 imageUrl → background.js
                                            ↓
                         fetch (URL인 경우) → Blob → Base64 변환
                                            ↓
         Gemini Vision API (반응형 프롬프트) → TemplateDataSchema (비율 기반 JSON) → Firebase 저장
                                            ↓
                         { success: true } → refreshAllTemplateData()
                                            ↓
                    Firebase 재조회 → (A) 사용자 드롭다운 + (B) 운영자 목록 동시 갱신
                                            ↓
[사용자] 화면 비율 선택 (16:9/1:1/9:16) → 템플릿 선택 → AI 문구 생성
                                            ↓
         Canvas 크기 결정 (비율에 따라) → renderTemplateFromData(템플릿JSON, 문구)
                                            ↓
                    상대 좌표 → 절대 픽셀 변환 → 반응형 썸네일 생성
```

#### TemplateDataSchema (PRD v2.4 - 반응형 구조)

Firebase `thumbnail_templates/{id}`에 저장되며, **모든 좌표와 크기는 0.0~1.0 비율 값**으로 저장됩니다:

```json
{
  "name": "반응형-템플릿",
  "background": {
    "type": "solid",
    "value": "#1A1A1A"
  },
  "layers": [
    {
      "type": "text",
      "text": "{{SLOGAN}}",
      "x": 0.5, // 50% (가로 중앙)
      "y": 0.45, // 45% (세로 위치)
      "styles": {
        "fontRatio": 0.12, // 캔버스 높이의 12%
        "fontWeight": "bold",
        "fontFamily": "'Noto Sans KR'",
        "fill": "#FFFFFF",
        "align": "center",
        "baseline": "middle",
        "shadow": {
          "color": "rgba(0,0,0,0.5)",
          "blur": 5,
          "offsetX": 2,
          "offsetY": 2
        }
      }
    },
    {
      "type": "text",
      "text": "{{VISUALIZATION_CUE}}",
      "x": 0.5,
      "y": 0.65,
      "styles": {
        "fontRatio": 0.05,
        "fontWeight": "normal",
        "fontFamily": "'Noto Sans KR'",
        "fill": "#DDDDDD",
        "align": "center"
      }
    }
  ]
}
```

**중요 변경사항**:

1. `width`, `height` 필드 제거 - 렌더링 시점에 동적 결정
2. `x`, `y`: 절대 픽셀 → **0.0~1.0 비율 값**
3. `styles.font`: 문자열 → `fontRatio` (숫자), `fontWeight`, `fontFamily` 분리
4. `shape` 레이어: `width`, `height` → `widthRatio`, `heightRatio`

#### 구현 체크리스트 (v2.4 완료 상태)

**FR-R-Render (완료)**: 반응형 범용 렌더러 리팩토링 (v2.7)

- [x] `thumbnailGenerator.js`: 헬퍼 함수 패턴으로 리팩토링 (v2.7)
  - `renderHelpers.drawText()`: 모든 JSON 스타일 속성 완벽 적용
    - `align`, `baseline`, `fontWeight`, `fontFamily`, `fill` 지원
    - **[v2.7 수정]** 그림자 없을 때 명시적 초기화 (이전 레이어 그림자 제거)
  - `renderHelpers.drawShape()`: rect, circle 도형 렌더링 (v2.7 신규)
  - `renderHelpers.drawBackground()`: solid, gradient, image 배경 렌더링
  - `renderHelpers.drawImage()`: 이미지 placeholder 렌더링
- [x] `renderTemplateFromData()`: switch 문으로 타입별 헬퍼 호출 (v2.7)
  - Canvas 크기 동적 감지 (`ctx.canvas.width`, `ctx.canvas.height`)
  - 상대 좌표 → 절대 픽셀 변환 (`actualX = layer.x * canvasWidth`)
  - `fontRatio` → 실제 폰트 크기 변환 (`actualFontSize = fontRatio * canvasHeight`)
  - 하위 호환: v2.3 템플릿의 절대 픽셀 좌표도 자동 감지
  - **[v2.6]** 그림자 스마트 비율 처리: `blurValue > 10 ? blurValue : blurValue * canvasHeight`
- [x] 배경 렌더링: canvas 크기 기준으로 변경
- [x] 플레이스홀더 치환: `{{SLOGAN}}`, `{{VISUALIZATION_CUE}}`

**FR-R-AI (완료)**: Gemini Vision API 프롬프트 강화 (v2.6)

- [x] `background.js`: `analyze_image_for_template` 프롬프트 대폭 강화
  - **필수 필드 강조**: name, background, layers 명시
  - **반응형 좌표 규칙**: 모든 좌표와 크기는 0.0~1.0 비율 값
  - **[v2.6 추가]** 핵심 규칙 3: "그림자도 비율" - shadow.blur, offsetX, offsetY도 0.0~1.0 비율
  - **좌표 변환 예시** 추가: "600x400 이미지에서 중앙(300, 200) → x=0.5, y=0.5"
  - **[v2.6 추가]** 그림자 변환 예시: "blur 5px (400px 기준): 0.0125", "offset 2px: 0.0016"
  - **검증 규칙 체크리스트**: AI가 반환 전 자체 검증하도록 유도
  - **[v2.6 추가]** shadow 검증: "shadow가 있다면 0.0~1.0 사이"
  - **금지 사항 명시**: width/height 필드, 절대 픽셀, 마크다운 코드 블록 금지
  - **순수 JSON만 요청**: 설명 텍스트 없이 JSON 객체만 반환하도록 지시

**FR-V-Validate (신규 v2.5)**: 백엔드 데이터 검증 로직

- [x] `background.js`: `validateTemplateData()` 함수 추가
  - 필수 필드 검증: name, background, layers
  - background 하위 필드 검증: type, value
  - layers 배열 검증: 최소 1개 이상, {{SLOGAN}} 필수
  - 상대 좌표 범위 검증: x, y, fontRatio가 0.0~1.0 범위 내
  - 데이터 타입 검증: 숫자, 문자열, 객체 타입 확인
- [x] `background.js`: Firebase 저장 전 검증 호출
  - `validateTemplateData(parsedTemplate)` 호출
  - 검증 실패 시 구체적인 에러 메시지 반환
  - 예: "필수 필드 'layers'가 비어있거나 배열이 아닙니다."
- [x] 콘솔 로그 강화: AI 응답 원문, 파싱 단계, 검증 결과 출력

**FR-R-UI (완료)**: 화면 비율 선택 UI 추가

- [x] `workspaceMode.js`: 🎨 썸네일 생성 탭에 화면 비율 버튼 그룹 추가
  ```html
  <div class="ai-aspect-ratio-group">
    <button class="aspect-ratio-btn active" data-aspect="16:9">
      16:9 (유튜브)
    </button>
    <button class="aspect-ratio-btn" data-aspect="1:1">1:1 (인스타그램)</button>
    <button class="aspect-ratio-btn" data-aspect="9:16">9:16 (쇼츠)</button>
  </div>
  ```
- [x] `workspace.css`: `.aspect-ratio-btn`, `.active` 스타일 추가
- [x] `workspaceMode.js`: 버튼 클릭 이벤트 리스너 추가 (active 클래스 토글)

**FR-R-Admin (완료)**: 운영자 미리보기 하위 호환성 처리

- [x] `workspaceMode.js`: `populateAdminList()` 함수 수정
  - 반응형 템플릿 감지: `!template.width && !template.height`
  - v2.4 템플릿: 기본 16:9 비율(1280x720)로 캔버스 생성
  - v2.3 이하 템플릿: 기존 절대 픽셀 크기 유지
  - 템플릿 정보 표시: "반응형 (비율 기반)" vs "크기: 600×400"
- [x] **즉시 시각적 피드백**: 운영자는 템플릿 등록 후 탭 이동 없이 `⚙️ 템플릿 관리` 탭에서 캔버스 미리보기를 즉시 확인 가능
- [x] 콘솔 로그 추가: 템플릿 타입 및 렌더링 크기 출력

**FR-R-Flow (미완료 - 다음 단계)**: 사용자 썸네일 생성 플로우

- [ ] 목차 "썸네일" 버튼 클릭 핸들러 수정
- [ ] 선택된 화면 비율 가져오기 (`document.querySelector(".aspect-ratio-btn.active").dataset.aspect`)
- [ ] Canvas 크기 동적 설정
  ```javascript
  if (aspect === "16:9") {
    canvas.width = 1280;
    canvas.height = 720;
  } else if (aspect === "1:1") {
    canvas.width = 1080;
    canvas.height = 1080;
  } else if (aspect === "9:16") {
    canvas.width = 720;
    canvas.height = 1280;
  }
  ```
- [ ] `renderTemplateFromData(ctx, templateData, { slogan, visualizationCue })` 호출
- [ ] 결과를 `#ai-thumbnail-grid`에 삽입

---

#### v2.3 이전 구현 (참고용)

**1. 운영자 UI (workspaceMode.js - FR-T3/T4-DnD)**

- [x] `⚙️ 템플릿 관리` 탭에 드래그 앤 드롭 영역 추가
- [x] 다중 소스 `drop` 이벤트 핸들러 구현
  - **1순위**: 로컬 파일 (`e.dataTransfer.files`) → Base64 변환 → `processTemplateUpload({ base64Image })`
  - **2순위**: 웹 URL (`e.dataTransfer.getData("text/uri-list")`) → `processTemplateUpload({ imageUrl })`
- [x] 공통 업로드 함수 `processTemplateUpload(uploadData, defaultName)` 구현
  - 템플릿 이름 입력 (`prompt()`)
  - `chrome.runtime.sendMessage("analyze_image_for_template", { ...uploadData, templateName })`
  - 응답 처리 및 토스트 알림
- [x] 업로드 성공 시 `refreshAllTemplateData()` 호출 (v2.3)

**2. AI 분석 백엔드 (background.js - FR3)**

- [x] `analyze_image_for_template` 액션 핸들러 추가
- [x] 다중 소스 이미지 처리 로직
  - `data.base64Image` 존재 시: Base64 헤더 파싱 및 MIME 타입 추출
  - `data.imageUrl` 존재 시: `fetch()` → Blob → `convertBlobToBase64()` → Base64 변환
- [x] `convertBlobToBase64(blob)` 헬퍼 함수 추가 (FileReader 기반)
- [x] Gemini Vision API 호출 (gemini-2.5-flash with vision support)
  - 프롬프트: TemplateDataSchema JSON 형식 요청
  - `inlineData` 필드에 MIME 타입 및 Base64 데이터 포함
- [x] AI 응답에서 JSON 파싱 (코드 블록 또는 순수 JSON 지원)
- [x] 필수 필드 검증 (name, width, layers)
- [x] `firebase.database().ref("thumbnail_templates").push(cleanedTemplate)`
- [x] `sendResponse({ success: true/false, error?, template? })`

**3. 템플릿 관리 시스템 (background.js + workspaceMode.js - FR5, FR-A-List, FR-A-Delete, FR-R-Refresh)**

- [x] **background.js**: `get_thumbnail_templates` 액션 구현
  - `firebase.database().ref("thumbnail_templates").once("value")`
  - 모든 템플릿을 배열로 반환
- [x] **background.js**: `delete_template` 액션 구현 (v2.3)
  - `firebase.database().ref("thumbnail_templates/{id}").remove()`
- [x] **workspaceMode.js**: 템플릿 캐시 변수 (`let templateCache = []`)
- [x] **workspaceMode.js**: `refreshAllTemplateData()` 마스터 새로고침 함수 (v2.3)
  - Firebase에서 최신 템플릿 목록 조회
  - 로컬 캐시 업데이트
  - `populateUserDropdown()` + `populateAdminList()` 동시 호출
- [x] **workspaceMode.js**: `populateUserDropdown(templates)` 구현 (v2.3)
  - `🎨 썸네일 생성` 탭의 드롭다운(`#ai-thumb-style-select`)에 템플릿 목록 추가
- [x] **workspaceMode.js**: `populateAdminList(templates)` 구현 (v2.3)
  - `⚙️ 템플릿 관리` 탭의 목록(`#template-preview-grid`)에 템플릿 카드 렌더링
  - 각 카드에 삭제 버튼 추가 및 이벤트 바인딩
- [x] **workspaceMode.js**: 초기 로드 시 `refreshAllTemplateData()` 호출 (v2.3)

**4. 범용 렌더러 분리 (thumbnailGenerator.js - FR4, v2.6 완료)**

- [x] **js/ui/thumbnailGenerator.js**: 독립 모듈 생성 (300+ lines)
  - `renderTemplateFromData(ctx, templateData, dynamicText)` 함수
  - 배경 렌더링: solid, gradient, image 타입 지원
  - 레이어 렌더링: text, shape, image 타입 지원
  - 플레이스홀더 치환: `{{SLOGAN}}`, `{{VISUALIZATION_CUE}}`
  - v2.3 템플릿 하위 호환성: 절대 픽셀 좌표 자동 감지
  - v2.4+ 템플릿: 비율 좌표(0.0~1.0) → 절대 픽셀 변환
  - 폰트 파싱: `font` 문자열 vs `fontRatio/fontWeight/fontFamily` 분리
  - 그림자 스마트 처리: >10은 절대 픽셀, <=10은 비율
- [x] **workspaceMode.js**: import 및 호출
  - `import { renderTemplateFromData } from './thumbnailGenerator.js'`
  - `populateAdminList()` 함수에서 Canvas 미리보기 렌더링
  - 각 템플릿마다 Canvas 요소 생성 및 280px 스케일링

**5. 사용자 플로우 통합 (workspaceMode.js - FR5)** - `select#ai-thumb-style-select` 드롭다운 채우기

- 운영자가 템플릿 업로드 시 캐시 새로고침

**5. 사용자 플로우 통합 (workspaceMode.js - FR5)**

- [ ] 목차의 "썸네일" 버튼 클릭
- [ ] `ai_generate_slogan_for_session` 호출 → `{ slogan, visualizationCue }`
- [ ] `templateId = select#ai-thumb-style-select.value`
- [ ] `templateData = templateCache[templateId]`
- [ ] `renderTemplateFromData(ctx, templateData, { slogan, visualizationCue })`
- [ ] 결과를 `#ai-thumbnail-grid`에 삽입

#### 에러 핸들링 패턴

```javascript
// background.js
try {
  const response = await geminiVisionAPI(base64Image, prompt);
  const templateData = JSON.parse(extractJSON(response));
  await firebase
    .database()
    .ref("thumbnail_templates")
    .push(cleanDataForFirebase(templateData));
  sendResponse({ success: true });
} catch (error) {
  console.error("Template analysis failed:", error);
  sendResponse({ success: false, error: error.message });
}

// workspaceMode.js
chrome.runtime.sendMessage(
  { action: "analyze_image_for_template", data },
  (response) => {
    if (response?.success) {
      showToast("✅ 템플릿이 등록되었습니다.");
      refreshTemplateCache(); // get_thumbnail_templates 재호출
    } else {
      showToast(
        "❌ 템플릿 등록 실패: " + (response?.error || "알 수 없는 오류")
      );
    }
  }
);
```

#### 테스트 시나리오 (v2.2)

**시나리오 1: 로컬 파일 드래그 앤 드롭**

1. Windows 탐색기에서 이미지 파일(PNG/JPG) 선택
2. `⚙️ 템플릿 관리` 탭의 드롭존으로 드래그
3. 템플릿 이름 입력 (예: "블루 그라디언트")
4. "🔄 AI가 이미지를 분석하는 중..." 메시지 확인
5. "✅ 템플릿이 성공적으로 등록되었습니다!" 토스트 알림 확인
6. Firebase `thumbnail_templates` 컬렉션에 데이터 저장 확인

**시나리오 2: 웹 이미지 URL 드래그 앤 드롭**

1. Google 이미지 검색에서 참고 썸네일 이미지 찾기
2. 이미지를 브라우저에서 직접 드래그
3. `⚙️ 템플릿 관리` 탭의 드롭존으로 드롭
4. 템플릿 이름 입력 (예: "핀터레스트 스타일")
5. background.js가 `fetch(imageUrl)` → Blob → Base64 변환 수행
6. Gemini Vision API 호출 및 Firebase 저장 확인

**시나리오 3: 폴백 파일 업로드 (클릭)**

1. 드롭존 클릭 → 파일 선택 다이얼로그 열림
2. 로컬 이미지 파일 선택
3. 시나리오 1과 동일한 프로세스 진행

**예상 에러 케이스**

- 이미지가 아닌 파일 드롭: "❌ 이미지 파일만 업로드 가능합니다." 알림
- 유효하지 않은 URL 드롭: "❌ 유효한 이미지 URL이 아닙니다." 알림
- Gemini API 키 없음: "❌ Gemini API 키가 없습니다." 응답
- 네트워크 오류: "❌ 템플릿 등록 실패: Failed to fetch image: 403 Forbidden" 토스트

#### 마이그레이션 노트

- 이 시스템 구현 후 `js/ui/thumbnailGenerator.js`의 모든 하드코딩된 디자인 함수는 삭제됩니다.
- 기존 사용자 플로우는 변경 없이 새 렌더러(`renderTemplateFromData`)를 통해 동작합니다.
- Firebase 템플릿 데이터는 실시간 동기화되므로 운영자가 등록한 템플릿을 모든 사용자가 즉시 사용할 수 있습니다.

#### 다중 소스 처리 우선순위 (중요)

`drop` 이벤트 핸들러는 다음 순서로 소스를 확인합니다:

1. **1순위: `e.dataTransfer.files`** (로컬 파일)

   - Windows 탐색기, macOS Finder에서 드래그한 파일
   - FileReader로 즉시 Base64 변환 후 Gemini API 전송

2. **2순위: `e.dataTransfer.getData("text/uri-list")`** (웹 URL)
   - 브라우저 내 이미지를 드래그한 경우
   - URL을 background.js로 전송 → `fetch()` 수행

이 우선순위는 **변경하지 말 것** - 일부 브라우저는 웹 이미지 드래그 시 `files`와 `uri-list`를 동시에 제공할 수 있으며, 로컬 파일을 우선 처리하는 것이 더 안정적입니다.

## 확장 및 새 기능 추가 가이드

### 새 UI 모드 추가

1. `js/ui/newMode.js` 생성 및 `export function renderNewMode(container)` 구현
2. `js/ui/panel.js`에서 import 및 switch 문에 케이스 추가
3. 필요시 전용 CSS 파일 생성 후 `panel.js`에서 동적 로드
4. `js/ui/header.js`에 새 모드 네비게이션 버튼 추가

### 워크스페이스 '자료 보관함' 탭 추가

1. `js/ui/workspaceMode.js`의 `renderWorkspace` 함수에서 새 탭 버튼 추가:
   ```html
   <button class="resource-tab-btn" data-tab="new-tab">🎯 새 탭 이름</button>
   ```
2. 새 패널 컨테이너 추가:
   ```html
   <div
     class="resource-content-area new-tab-area"
     id="new-tab-area"
     style="display: none;"
   >
     <!-- 탭 컨텐츠 -->
   </div>
   ```
3. `addWorkspaceEventListeners`에서 탭 전환 로직에 새 패널 변수 추가:
   ```javascript
   const newTabArea = resourceLibrary.querySelector(".new-tab-area");
   // 탭 클릭 시 display 제어
   newTabArea.style.display = tab === "new-tab" ? "block" : "none";
   ```
4. 필요한 이벤트 리스너 등록 (버튼 클릭, 데이터 로딩 등)

### 새 core 기능 추가

1. `js/core/newFeature.js` 생성
2. `content.js`에서 초기화 함수 호출
3. Background script와의 통신이 필요한 경우 메시지 액션 추가

### Firebase 데이터 구조 확장

1. `background.js`의 Firebase 관련 함수들에 새 데이터 구조 추가
2. `cleanDataForFirebase()` 함수에서 새 필드 처리 로직 확인
3. 관련 UI 컴포넌트에서 새 데이터 렌더링 로직 구현

### iframe 기반 에디터 확장

1. `editor.html`에서 새로운 에디터 기능 구현
2. `editor.js`에서 postMessage 액션 추가 및 처리 로직 구현
3. 부모 창에서 `sendCommand()` 함수를 통한 에디터 제어
4. `manifest.json`의 `web_accessible_resources`에 새 파일 등록 필수

**중요**: 에디터 통신은 항상 준비 상태(`editorReady`)를 확인하고, iframe의 `contentWindow`가 존재하는지 검증해야 합니다. 모든 액션은 비동기적으로 처리되며, 에디터 응답을 기다려야 하는 경우 적절한 콜백 패턴을 사용하세요.

## 핵심 라이브러리 및 의존성

### 외부 라이브러리

- **Quill.js (v2.0.3)**: 워크스페이스 모드의 리치 텍스트 에디터 (iframe 내에서 실행)
- **Marked (v16.3.0)**: 마크다운 파싱 및 HTML 변환
- **Firebase**: 실시간 데이터베이스, 인증, 스토리지 (CDN 라이브러리 사용)
- **Gemini API**: AI 콘텐츠 생성 및 Vision 분석
  - `gemini-pro`: 텍스트 생성 (초안, 슬로건 등)
  - `gemini-pro-vision`: 이미지 분석 (템플릿 자동 생성)

### 개발 도구

- **Webpack 5**: ES6 모듈 번들링, `content.js` → `dist/bundle.js`
- **Babel**: ES6+ → ES5 호환성 변환
- **Chrome Extensions API**: Manifest V3, offscreen document, storage

### 특별한 Chrome API 활용

- **offscreen**: DOM 파싱 전용 (Chrome 109+ 필수)
- **storage.local**: Alt 키 상태 및 UI 상태 동기화
- **runtime.sendMessage**: Background ↔ Content Script 통신
- **web_accessible_resources**: iframe 및 CSS 리소스 접근

### AI API 통합 패턴

```javascript
// background.js - Gemini Vision API 호출 예시
async function analyzeImageForTemplate(base64Image, templateName) {
  const apiKey = "YOUR_GEMINI_API_KEY";
  const prompt = `
이 이미지는 썸네일 디자인 참고 이미지입니다.
다음 TemplateDataSchema JSON 형식으로 디자인 정보를 추출하세요:
{
  "name": "${templateName}",
  "width": 600,
  "height": 400,
  "background": { "type": "solid|gradient|image", "value": "색상코드 또는 URL" },
  "layers": [
    {
      "type": "text",
      "text": "{{SLOGAN}}" 또는 고정 텍스트,
      "x": 숫자, "y": 숫자,
      "styles": {
        "font": "굵기 크기 'Noto Sans KR'",
        "fill": "색상코드",
        "align": "left|center|right",
        "baseline": "top|middle|bottom",
        "shadow": { "color": "rgba(...)", "blur": 숫자, "offsetX": 숫자, "offsetY": 숫자 }
      }
    }
  ]
}
플레이스홀더: {{SLOGAN}}, {{VISUALIZATION_CUE}}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-pro-vision:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image.split(",")[1],
                },
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  const jsonText = data.candidates[0].content.parts[0].text;
  return JSON.parse(jsonText.match(/\{[\s\S]*\}/)[0]);
}
```

## 디버깅 및 문제 해결

### 일반적인 이슈

1. **에디터 iframe 통신 실패**: `editorReady` 상태 확인, `contentWindow` 존재 여부 검증
2. **Firebase undefined 오류**: 모든 데이터를 `cleanDataForFirebase()`로 정제 후 저장
3. **하이라이터 동작 안함**: `chrome.storage.local`의 상태값 확인, Alt 키 이벤트 리스너 점검
4. **Gemini API 오류**: API 키 유효성 확인, 요청 포맷 검증, JSON 파싱 실패 시 에러 핸들링
5. **빌드 후 변경사항 미적용**: Chrome 확장 프로그램 새로고침 필요

### 개발 환경 Chrome 버전 요구사항

**Chrome 109+ 필수** - Offscreen Document API 지원

## 핵심 데이터 흐름 이해하기

### 스크랩 라이프사이클 (End-to-End)

```javascript
// 1. 사용자가 Alt 키로 하이라이트 모드 활성화
chrome.storage.local.set({ highlightToggleState: true });

// 2. 모든 프레임에서 storage 변경 감지 → 하이라이트 표시
// js/core/highlighter.js
document.addEventListener("mouseover", (e) => {
  chrome.storage.local.get(["highlightToggleState"], (result) => {
    if (result.highlightToggleState) {
      e.target.classList.add("pilot-highlight");
    }
  });
});

// 3. 클릭 시 스크랩 데이터 생성 및 background로 전송
chrome.runtime.sendMessage({
  action: "scrap_element",
  data: scrapData,
});

// 4. background.js에서 Firebase 저장 전 데이터 정제
const cleanedData = cleanDataForFirebase(scrapData);
firebase.database().ref(`scraps/${userId}`).push(cleanedData);

// 5. 최상위 프레임에서 미리보기 표시
window.top.postMessage(
  {
    action: "cp_show_preview",
    data: scrapData,
  },
  "*"
);
```

**중요**: 하이라이터는 **모든 프레임**(iframe 포함)에서 동작하지만, UI는 **최상위 프레임**(`window.self === window.top`)에서만 렌더링됩니다.

### iframe 에디터 통신 디버깅 체크리스트

에디터 통신 문제 발생 시 순서대로 확인:

1. **iframe 로드 확인**: `editorIframe.contentWindow` null 여부
2. **ready 이벤트 수신**: `editorReady` 플래그 true 여부
3. **메시지 origin 검증**: `event.source === editorIframe.contentWindow`
4. **manifest 리소스 등록**: `web_accessible_resources`에 `editor.html`, `editor.js`, `lib/quill.js` 포함 여부
5. **Quill 초기화 순서**: Quill 인스턴스 생성 → `window.parent.postMessage({ action: 'editor-ready' })` 호출

## 프로젝트 고유 규칙

### 1. 프레임 실행 조건 분리 패턴

**모든 프레임**에서 실행되어야 하는 것과 **최상위 프레임**에서만 실행되어야 하는 것을 명확히 구분합니다:

```javascript
// content.js - 올바른 패턴
setupHighlighter(); // ✅ 모든 프레임에서 실행 (스크랩 기능)

if (window.self === window.top) {
  // ✅ 최상위 프레임에서만 실행
  createAndShowPanel(); // UI 렌더링
  window.addEventListener("message", handleIframeMessages); // 메시지 수신
}
```

**잘못된 예**: UI 코드를 프레임 조건 없이 실행하면 iframe마다 패널이 중복 생성됩니다.

### 2. Chrome Storage는 UI 상태의 신뢰 가능한 소스 (Single Source of Truth)

키보드 상태(Alt 키 등)는 이벤트 기반이 아닌 `chrome.storage.local`에서 읽어옵니다:

```javascript
// ❌ 잘못된 패턴: 이벤트 객체의 altKey 직접 사용
document.addEventListener("click", (e) => {
  if (e.altKey) {
    /* ... */
  }
});

// ✅ 올바른 패턴: storage에서 상태 읽기
document.addEventListener("click", (e) => {
  chrome.storage.local.get(["highlightToggleState"], (result) => {
    if (result.highlightToggleState) {
      /* ... */
    }
  });
});
```

이는 여러 프레임 간 상태 동기화를 보장하고, 사용자가 프레임 경계를 넘나들 때 일관된 동작을 제공합니다.

### 3. postMessage 통신 시 반드시 source 검증

iframe과의 통신 시 메시지 발신자를 항상 확인합니다:

```javascript
// js/ui/workspaceMode.js
window.addEventListener("message", (event) => {
  // ✅ 안전한 패턴: 예상된 iframe에서 온 메시지만 처리
  if (event.source !== editorIframe.contentWindow) return;

  const { action, data } = event.data;
  // 메시지 처리...
});
```

이는 악의적인 외부 iframe이나 브라우저 확장으로부터의 간섭을 방지합니다.

---

이 문서는 Content Pilot의 독특한 Chrome Extension 아키텍처와 모듈형 패턴을 이해하여 즉시 생산적으로 작업할 수 있도록 돕습니다. 질문이나 불명확한 부분이 있으면 관련 파일을 직접 참조하거나 피드백을 요청하세요.
