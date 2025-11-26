# 프로그램 로직 상세 설명 (Program Logic Documentation)

이 문서는 Content Pilot의 핵심 프로그램 로직을 상세히 설명합니다. 리팩토링, 에러 해결, 버그 수정 시 참고 자료로 활용하세요.

## 📋 목차

1. [애플리케이션 초기화](#애플리케이션-초기화)
2. [하이라이터 기능](#하이라이터-기능)
3. [스크랩 기능](#스크랩-기능)
4. [AI 서비스](#ai-서비스)
5. [Firebase 연동](#firebase-연동)
6. [성과 데이터 수집](#성과-데이터-수집)
7. [워크스페이스 관리](#워크스페이스-관리)
8. [칸반 보드 관리](#칸반-보드-관리)
9. [채널 관리](#채널-관리)
10. [에러 처리 및 복구](#에러-처리-및-복구)

---

## 애플리케이션 초기화

### 진입점 (Entry Points)

#### 1. Content Script (`content.js`)

**위치**: `content.js` → Webpack 빌드 → `dist/content.bundle.js`

**역할**: 웹페이지에 주입되어 UI 렌더링 및 사용자 상호작용 처리

**초기화 흐름**:
```
content.js
  └─> js/main.js::initialize()
      ├─> chrome.runtime.onMessage 리스너 등록
      ├─> window.addEventListener('message') 리스너 등록
      ├─> Alt 키 이벤트 리스너 등록
      └─> js/core/highlighter.js::setupHighlighter() 호출
```

**주요 기능**:
- 패널 열기/닫기 제어
- 에러 토스트 메시지 표시
- 하이라이터 초기화 (모든 프레임에서 실행)

**중요 사항**:
- `window.self === window.top` 체크로 최상위 프레임에서만 UI 생성
- 하이라이터는 모든 프레임(iframe 포함)에서 실행되어야 함

#### 2. Background Script (`background.js`)

**위치**: `background.js` → Webpack 빌드 → `dist/background.bundle.js`

**역할**: 서비스 워커로 동작, Firebase API 연동 및 데이터 처리 중앙 집중화

**초기화 흐름**:
```
background.js
  ├─> Firebase 초기화
  ├─> chrome.runtime.onMessage 리스너 등록
  ├─> chrome.alarms.onAlarm 리스너 등록 (주기적 작업)
  └─> Offscreen Document 준비
```

**주요 액션 핸들러**:
- `get_all_kanban_data`: 칸반 보드 데이터 조회
- `create_and_save_new_idea`: 새 아이디어 생성 및 저장
- `update_idea`: 아이디어 업데이트
- `delete_idea`: 아이디어 삭제
- `generate_blog_ideas`: AI 아이디어 제안
- `generate_briefing`: AI 브리핑 생성
- `collect_performance_data`: 성과 데이터 수집

#### 3. Offscreen Document (`offscreen.js`)

**위치**: `offscreen.js` → Webpack 빌드 → `dist/offscreen.bundle.js`

**역할**: DOM 파싱 및 HTML 정제 전담

**초기화 흐름**:
```
offscreen.html
  └─> offscreen.js
      ├─> DOMPurify 초기화
      ├─> Marked (마크다운 파서) 초기화
      └─> chrome.runtime.onMessage 리스너 등록
```

**주요 기능**:
- HTML 정제 (XSS 방어)
- 마크다운 → HTML 변환
- 이미지 URL 추출
- 텍스트 요약 생성

---

## 하이라이터 기능

### 개요

하이라이터는 웹페이지에서 스크랩할 요소를 시각적으로 표시하는 기능입니다.

### 구현 위치

- **핵심 로직**: `js/core/highlighter.js`
- **초기화**: `js/main.js::initialize()` → `setupHighlighter()`

### 동작 원리

1. **Alt 키 토글 모드**
   ```javascript
   // Alt 키를 누르면 하이라이터 모드 활성화/비활성화
   document.addEventListener('keydown', (e) => {
     if (e.key === 'Alt') {
       toggleHighlightMode();
     }
   });
   ```

2. **요소 하이라이트**
   - 마우스 오버 시 요소에 테두리 표시
   - 클릭 가능한 요소 표시 (커서 변경)

3. **스크랩 트리거**
   - 하이라이트된 요소 클릭 시 스크랩 프로세스 시작
   - `background.js`로 스크랩 요청 전송

### 중요 사항

- **모든 프레임에서 실행**: iframe 내부 요소도 하이라이트 가능
- **이벤트 버블링 방지**: 하이라이트된 요소 클릭 시 기본 동작 방지
- **메모리 관리**: 이벤트 리스너 정리 및 DOM 참조 해제

---

## 스크랩 기능

### 개요

웹페이지의 특정 요소를 수집하여 Firebase에 저장하는 기능입니다.

### 구현 위치

- **UI 로직**: `js/ui/scrapbookMode.js`
- **백엔드 로직**: `background.js` (스크랩 저장)
- **DOM 분석**: `offscreen.js` (HTML 정제)

### 스크랩 프로세스

```
1. 사용자가 하이라이트된 요소 클릭
   ↓
2. content.js → background.js로 스크랩 요청
   ↓
3. background.js가 HTML 텍스트 수집
   ↓
4. offscreen.js로 HTML 정제 요청
   ↓
5. offscreen.js가 DOMPurify로 정제 + 이미지 추출
   ↓
6. background.js가 정제된 데이터를 Firebase에 저장
   ↓
7. content.js에 성공 메시지 전송
   ↓
8. UI 업데이트 (스크랩북 패널)
```

### 데이터 구조

```javascript
{
  id: "scrap_1234567890",
  url: "https://example.com/page",
  title: "페이지 제목",
  content: "<정제된 HTML>",
  images: ["https://example.com/image1.jpg", ...],
  timestamp: 1234567890,
  channelId: "channel_abc" // 현재 활성 채널 ID
}
```

### 중요 사항

- **Offscreen Document 활용**: Service Worker는 DOM API 사용 불가 → offscreen.js로 위임
- **XSS 방어**: DOMPurify로 모든 HTML 정제
- **이미지 추출**: 정제 과정에서 이미지 URL 자동 추출
- **채널별 필터링**: 현재 활성 채널의 스크랩만 표시

---

## AI 서비스

### 개요

Google Gemini API를 활용한 AI 기능 (아이디어 제안, 브리핑 생성, 초안 생성 등)

### 구현 위치

- **서비스 로직**: `js/services/aiService.js`
- **백엔드 호출**: `background.js` (API 키 관리)

### 주요 기능

#### 1. 아이디어 제안 (`generate_blog_ideas`)

**프로세스**:
```
1. 대시보드에서 "AI 아이디어 추천" 버튼 클릭
   ↓
2. background.js가 성과 데이터 수집
   ↓
3. AI 프롬프트 생성 (성과 분석, 경쟁사 분석 포함)
   ↓
4. Gemini API 호출
   ↓
5. JSON 응답 파싱
   ↓
6. 아이디어 카드 생성 (자동으로 칸반 보드에 추가)
```

**프롬프트 구조**:
- [정보 1]: 내 성공 요인
- [정보 2]: 내 인기글
- [정보 3]: 경쟁사 인기글
- [정보 4]: 성과 분석
- [정보 5]: 사용자 선호도
- [정보 6]: 최신 트렌드 (선택적)

**전략**:
- **활용 전략 (P1)**: 성과 공식 활용 (3개)
- **탐색 전략 (P2/P3)**: 전략적 탐색 (2개)
- **재활용 전략**: 기존 콘텐츠 업데이트 제안 (1개)

#### 2. 브리핑 생성 (`generate_briefing`)

**프로세스**:
```
1. 아이디어 저장 시 자동 생성 (manual_entry 제외)
   ↓
2. background.js가 아이디어 데이터 수집
   ↓
3. AI 프롬프트 생성
   ↓
4. Gemini API 호출 (병렬 처리)
   - 추천 목차 (outline)
   - 추천 검색어 (recommendedKeywords)
   - 롱테일 키워드 (longTailKeywords)
   - 주요 키워드 (mainKeywords/tags)
   ↓
5. Firebase에 저장
   ↓
6. 실시간 리스너로 UI 업데이트
```

**생성 필드**:
- `workspace.outline`: 추천 목차 (배열)
- `workspace.recommendedKeywords`: 추천 검색어 (배열)
- `workspace.longTailKeywords`: 롱테일 키워드 (배열)
- `workspace.keywords`: 주요 키워드 (배열)
- `tags`: 태그 (배열, # 접두사)

#### 3. 초안 생성 (`generate_draft`)

**프로세스**:
```
1. 워크스페이스에서 "AI 초안 생성" 버튼 클릭
   ↓
2. 브리핑 데이터 수집 (outline, keywords 등)
   ↓
3. AI 프롬프트 생성 (목차 기반 구조)
   ↓
4. Gemini API 호출
   ↓
5. 마크다운 형식 응답
   ↓
6. JSON-LD 스키마 추출 및 파싱
   ↓
7. Quill 에디터에 삽입
```

**JSON-LD 구조화된 데이터 생성**:
- **목적**: 구글 검색 엔진 최적화를 통한 상위 노출 확률 향상
- **자동 판단**: 글의 유형에 따라 적절한 스키마 자동 선택
  - 기본: `BlogPosting` 스키마
  - 리뷰 글: `Review` 스키마 (중첩 또는 단독 사용)
  - FAQ 포함: `FAQPage` 스키마 포함
- **필수 필드**:
  - `headline`: SEO 최적화된 제목
  - `description`: 핵심 요약
  - `author`: { name: "Content Pilot" }
  - `datePublished`: 현재 날짜 (YYYY-MM-DD 형식)
  - `image`: 대표 이미지 URL 플레이스홀더
- **출력 형식**: `<JSON-LD>...</JSON-LD>` 태그로 감싸서 반환
- **데이터 추출**: AI 응답에서 JSON-LD 태그 내 데이터 추출 및 JSON 파싱
- **결과 반환**: `jsonLdSchema` 필드에 구조화된 데이터 포함
- **사용 예정**: 향후 UI에서 `<script type="application/ld+json">` 태그로 변환하여 HTML에 포함

### 중요 사항

- **API 키 관리**: `background.js`에서만 API 키 접근 (보안)
- **에러 처리**: 토큰 만료, 할당량 초과 등 에러 처리
- **재시도 로직**: 실패 시 지수 백오프 재시도
- **프롬프트 최적화**: 실용성 가드레일, 성과 공식 기반 요청

---

## Firebase 연동

### 개요

Firebase Realtime Database를 활용한 데이터 저장 및 실시간 동기화

### 구현 위치

- **서비스 로직**: `js/services/firebaseService.js`
- **REST API 모드**: Firebase REST API 사용 (SDK 대신)

### 데이터 구조

#### 채널 구조
```
/channels/{channelId}
  ├─ inputUrl: "https://blog.example.com"
  ├─ apiUrl: "https://blog.example.com/rss"
  ├─ gaPropertyId: "123456789"
  ├─ adSenseAccountId: "pub-123456789"
  └─ competitors: [
      {
        id: "competitor_1",
        inputUrl: "https://competitor.com",
        apiUrl: "https://competitor.com/rss"
      }
    ]
```

#### 아이디어 구조
```
/ideas/{ideaId}
  ├─ title: "아이디어 제목"
  ├─ status: "idea" | "in_progress" | "done"
  ├─ channelId: "channel_abc"
  ├─ origin: "ai_generated" | "manual_entry" | "my_post" | ...
  ├─ tags: ["#태그1", "#태그2"]
  ├─ workspace: {
  │   ├─ outline: [...]
  │   ├─ keywords: [...]
  │   ├─ recommendedKeywords: [...]
  │   ├─ longTailKeywords: [...]
  │   ├─ draft: "<HTML>"
  │   └─ linkedScraps: ["scrap_1", "scrap_2"]
  │ }
  ├─ performance: {
  │   ├─ revenue: 1000
  │   ├─ pageViews: 500
  │   ├─ avgTimeOnPage: 120
  │   └─ ...
  │ }
  └─ publishedUrl: "https://blog.example.com/post/123"
```

#### 스크랩 구조
```
/scraps/{scrapId}
  ├─ url: "https://example.com/page"
  ├─ title: "페이지 제목"
  ├─ content: "<정제된 HTML>"
  ├─ images: ["https://example.com/image1.jpg"]
  ├─ channelId: "channel_abc"
  └─ timestamp: 1234567890
```

### 주요 함수

#### 데이터 읽기
```javascript
// REST API로 데이터 조회
const data = await fetch(`${dbUrl}/path.json`);
const json = await data.json();
```

#### 데이터 쓰기
```javascript
// REST API로 데이터 저장
await fetch(`${dbUrl}/path.json`, {
  method: 'PUT',
  body: JSON.stringify(data)
});
```

#### 실시간 리스너
```javascript
// Firebase REST API는 실시간 리스너 미지원
// 대신 주기적 폴링 또는 이벤트 기반 업데이트 사용
```

### 중요 사항

- **REST API 모드**: Firebase SDK 대신 REST API 사용 (Service Worker 호환성)
- **인증**: Firebase Auth로 사용자 인증
- **보안 규칙**: Firebase Security Rules로 데이터 접근 제어
- **채널별 필터링**: 모든 데이터에 `channelId` 포함

---

## 성과 데이터 수집

### 개요

Google Analytics 4 (GA4) 및 Google AdSense API를 활용한 성과 데이터 수집

### 구현 위치

- **서비스 로직**: `js/services/analyticsService.js`
- **백엔드 호출**: `background.js` (OAuth 토큰 관리)

### 수집 프로세스

```
1. 주기적 자동 수집 (6시간마다)
   또는 수동 업데이트 버튼 클릭
   ↓
2. background.js가 OAuth 토큰 확인
   ↓
3. GA4 API 호출
   - 페이지뷰
   - 세션 수
   - 체류 시간
   - 이탈률
   - 유입 경로
   - 시간대별 트래픽
   ↓
4. AdSense API 호출
   - 수익
   - RPM
   - 클릭률
   - 클릭 수
   ↓
5. Firebase에 저장 (/ideas/{ideaId}/performance)
   ↓
6. 실시간 리스너로 UI 업데이트
```

### 수집 메트릭

#### GA4 메트릭
- `pageViews`: 페이지뷰 수
- `sessions`: 세션 수
- `avgTimeOnPage`: 평균 체류 시간 (초)
- `bounceRate`: 이탈률 (%)
- `trafficSource`: 유입 경로 (상위 5개)
- `hourlyTraffic`: 시간대별 트래픽 (최근 7일)

#### AdSense 메트릭
- `revenue`: 수익 (원)
- `rpm`: RPM (페이지당 수익)
- `ctr`: 클릭률 (%)
- `clicks`: 클릭 수
- `pageViews`: 페이지뷰 수

### 중요 사항

- **OAuth 인증**: Google OAuth 2.0으로 인증
- **에러 처리**: 404는 데이터 없음으로 처리 (오류 아님)
- **필터 전략**: 여러 필터 전략 시도 (정확한 경로, trailing slash 제거/추가)
- **재시도 로직**: 실패 시 지수 백오프 재시도

---

## 워크스페이스 관리

### 개요

콘텐츠 작성 및 관리를 위한 통합 워크스페이스

### 구현 위치

- **UI 로직**: `js/ui/workspaceMode.js`
- **에디터**: `editor.html`, `editor.js` (Quill 에디터)

### 주요 기능

#### 1. 에디터 관리
- **Quill Rich Text Editor**: HTML 기반 리치 텍스트 에디터
- **자동 저장**: 변경 사항 자동 저장 (Firebase)
- **마크다운 지원**: 마크다운 → HTML 변환

#### 2. 탭 관리
- **AI 브리핑**: 추천 목차, 추천 검색어, 롱테일 키워드
- **모든 스크랩**: 현재 채널의 모든 스크랩 표시
- **이미지 갤러리**: 모든 스크랩에서 추출한 이미지 표시

#### 3. 리소스 통합
- **스크랩 드롭**: 스크랩을 에디터에 드래그앤드롭으로 삽입
- **이미지 삽입**: 이미지 갤러리에서 이미지 삽입
- **키워드 삽입**: 키워드 클릭 시 에디터에 삽입

### 데이터 구조

```javascript
workspace: {
  outline: ["1. 소개", "2. 본문", "3. 결론"],
  keywords: ["키워드1", "키워드2"],
  recommendedKeywords: ["검색어1", "검색어2"],
  longTailKeywords: ["롱테일 키워드1"],
  draft: "<HTML 콘텐츠>",
  linkedScraps: ["scrap_1", "scrap_2"]
}
```

### 중요 사항

- **workspace 객체 보장**: 항상 workspace 객체가 존재하도록 방어 코드 필요
- **실시간 동기화**: Firebase 실시간 리스너로 자동 업데이트
- **에디터 통신**: postMessage로 에디터와 통신

---

## 칸반 보드 관리

### 개요

아이디어를 상태별로 관리하는 칸반 보드

### 구현 위치

- **UI 로직**: `js/ui/kanbanMode.js`
- **서비스 로직**: `js/services/kanbanService.js`

### 상태 관리

- **idea**: 아이디어 단계
- **in_progress**: 진행 중
- **done**: 완료

### 주요 기능

#### 1. 카드 추가
- **수동 추가**: "+ 카드 추가" 버튼으로 수동 입력
- **AI 제안**: 대시보드에서 AI 아이디어 제안
- **스크랩 전환**: 스크랩북에서 아이디어로 전환
- **포스팅 추가**: 대시보드에서 포스팅을 아이디어로 추가

#### 2. 드래그앤드롭
- **상태 변경**: 카드를 드래그하여 상태 변경
- **순서 변경**: 같은 컬럼 내에서 순서 변경

#### 3. 성과 표시
- **성과 지표**: 수익, 페이지뷰, 체류 시간 표시
- **시각적 구분**: 성과가 있는 카드는 초록색 테두리

### 중요 사항

- **채널별 필터링**: 현재 활성 채널의 아이디어만 표시
- **실시간 동기화**: Firebase 실시간 리스너로 자동 업데이트
- **workspace 객체 보장**: 카드 클릭 시 workspace 객체 확인

---

## 채널 관리

### 개요

다중 채널(블로그) 관리 및 채널별 데이터 필터링

### 구현 위치

- **UI 로직**: `js/ui/channelMode.js`
- **서비스 로직**: `js/services/firebaseService.js`

### 채널 구조

```javascript
{
  id: "channel_abc",
  inputUrl: "https://blog.example.com",
  apiUrl: "https://blog.example.com/rss",
  gaPropertyId: "123456789",
  adSenseAccountId: "pub-123456789",
  competitors: [
    {
      id: "competitor_1",
      inputUrl: "https://competitor.com",
      apiUrl: "https://competitor.com/rss"
    }
  ]
}
```

### 주요 기능

#### 1. 채널 추가/수정
- **Google OAuth 인증**: GA4 속성 및 AdSense 계정 자동 연동
- **RSS URL 자동 생성**: inputUrl 기반으로 RSS URL 생성
- **경쟁 채널 추가**: 경쟁 채널을 하위 속성으로 관리

#### 2. 채널 전환
- **글로벌 채널 선택기**: 헤더에서 채널 선택
- **자동 새로고침**: 채널 변경 시 모든 탭 자동 새로고침

#### 3. 채널별 필터링
- **아이디어**: 현재 활성 채널의 아이디어만 표시
- **스크랩**: 현재 활성 채널의 스크랩만 표시
- **성과 데이터**: 현재 활성 채널의 성과 데이터만 표시

### 중요 사항

- **채널 ID 부여**: 모든 새 데이터에 `channelId` 자동 부여
- **데이터 마이그레이션**: 기존 데이터 자동 마이그레이션
- **단일 채널 사용자**: 모든 데이터를 해당 채널로 귀속

---

## 에러 처리 및 복구

### 개요

애플리케이션 전반의 에러 처리 및 복구 메커니즘

### 에러 타입

#### 1. API 에러
- **토큰 만료**: OAuth 토큰 갱신 필요
- **할당량 초과**: API 할당량 초과 시 재시도
- **인증 실패**: 재인증 필요

#### 2. Firebase 에러
- **연결 실패**: 네트워크 오류 또는 Firebase 다운
- **권한 오류**: Security Rules 위반
- **데이터 구조 오류**: 예상치 못한 데이터 구조

#### 3. UI 에러
- **DOM 요소 없음**: querySelector 실패
- **이벤트 리스너 중복**: 중복 등록 방지
- **메모리 누수**: 이벤트 리스너 정리

### 에러 처리 패턴

#### 1. 방어 코드
```javascript
// 항상 객체 존재 확인
if (ideaData?.workspace) {
  // workspace 객체 사용
} else {
  // 기본값으로 초기화
  ideaData.workspace = {};
}
```

#### 2. 재시도 로직
```javascript
// 지수 백오프 재시도
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}
```

#### 3. 에러 로깅
```javascript
// 에러 정보 상세 기록
console.error('[ERROR]', {
  action: 'generate_briefing',
  ideaId: ideaId,
  error: error.message,
  stack: error.stack,
  timestamp: Date.now()
});
```

### 중요 사항

- **사용자 친화적 메시지**: 기술적 에러를 사용자 친화적 메시지로 변환
- **에러 복구**: 가능한 경우 자동 복구 시도
- **에러 추적**: 에러 발생 시 상세 정보 기록

---

## 🔗 관련 문서

- [데이터 흐름](./DATA_FLOW.md)
- [서비스 상호작용](./SERVICE_INTERACTIONS.md)
- [버그 해결 로그](./BUG_FIX_LOG.md)
- [리팩토링 가이드](./REFACTORING_GUIDE.md)

