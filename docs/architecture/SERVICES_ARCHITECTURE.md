# 서비스 아키텍처 개요

> **최종 업데이트**: 2025-01-27  
> **상태**: ✅ 최신 (제휴 링크 기능 추가)

## 📋 개요

Content Pilot은 모듈화된 서비스 아키텍처를 채택하여 각 기능을 독립적인 서비스로 분리했습니다.

## 🏗️ 서비스 구조

```
js/services/
├── aiService.js              # AI 기능 (Gemini API)
├── analyticsService.js       # 성과 분석 (GA4, AdSense)
├── authService.js            # 인증 (Google OAuth)
├── cascadeDeleteService.js   # 연쇄 삭제 (채널/경쟁 채널 삭제)
├── collectorService.js       # 콘텐츠 수집 (RSS, YouTube)
├── firebaseService.js        # Firebase 연동 (REST API)
├── kanbanService.js          # 칸반 보드 관리
├── (migrationService 삭제)   # 데이터 마이그레이션 기능은 현재 제거됨
├── offscreenService.js       # Offscreen Document 관리
├── promptService.js          # 프롬프트 빌더 (페르소나, 톤, 스킬)
├── scrapService.js           # 스크랩 관리
└── thumbnailService.js       # 썸네일 생성
```

---

## 🔑 주요 서비스

### 1. Firebase Service (`firebaseService.js`)

**역할**: Firebase Realtime Database와의 모든 통신을 담당합니다.

**주요 기능**:

- Firebase 초기화 및 인증
- 데이터 읽기/쓰기 (REST API)
- 이미지 업로드 (Firebase Storage)
- 사용자 인증 상태 관리

**주요 함수**:

- `initializeFirebase()`: Firebase 초기화
- `getCurrentUserId()`: 현재 사용자 ID 가져오기
- `signInToFirebaseWithGoogleToken()`: Google 토큰으로 로그인
- `ref()`, `get()`, `set()`, `update()`, `remove()`: 데이터베이스 작업
- `uploadImageToFirebaseStorage()`: 이미지 업로드

**데이터 경로 구조**:

```
kanban/{userId}/{status}/{cardId}
scraps/{userId}/{scrapId}
channels/{userId}/myChannels/blogs
channels/{userId}/myChannels/youtubes
affiliate_links/{userId}/{linkKey}  # 제휴 링크 데이터
```

---

### 2. AI Service (`aiService.js`)

**역할**: Google Gemini API를 활용한 AI 기능 제공.

**주요 기능**:

- 아이디어 브리핑 생성
- 콘텐츠 초안 자동 생성 (제휴 링크 자동 삽입 포함)
- 키워드 갭 분석
- 트렌드 분석
- 이미지 생성
- 제휴 링크 조회 및 필터링

**주요 함수**:

- `callGeminiAPI()`: Gemini API 호출
- `generateIdeaBriefing()`: 브리핑 생성
- `generateDraftFromIdea()`: 초안 생성 (PromptService 사용, 제휴 링크 자동 삽입)
- `getRelevantAffiliateLinks()`: 관련 제휴 링크 조회 및 필터링
- `analyzeKeywordGap()`: 키워드 갭 분석
- `getEmergingTopics()`: 트렌드 분석
- `generateAiImage()`: 이미지 생성

**프롬프트 시스템**:

- `promptService.js`를 사용하여 모듈형 프롬프트 빌더 패턴 적용
- 페르소나, 톤, 스킬을 레이어로 분리하여 조립

**관련 문서**: [AI 서비스 가이드](../guides/AI_SERVICE_GUIDE.md)

---

### 3. Analytics Service (`analyticsService.js`)

**역할**: Google Analytics 4와 AdSense 데이터 수집 및 분석.

**주요 기능**:

- GA4 데이터 수집 (페이지뷰, 세션, 체류 시간 등)
- AdSense 데이터 수집 (수익, RPM, CTR 등)
- 성과 데이터 자동 업데이트
- 성과 분석 및 리포트 생성

**주요 함수**:

- `getAnalyticsData()`: GA4 데이터 가져오기
- `getAdsenseData()`: AdSense 데이터 가져오기
- `updateSinglePerformanceMetric()`: 단일 콘텐츠 성과 업데이트
- `updateAllPerformanceMetrics()`: 전체 성과 업데이트
- `analyzePerformanceData()`: 성과 데이터 분석
- `getUserFeedbackPatterns()`: 사용자 피드백 패턴 분석

**자동 업데이트**:

- 6시간마다 자동으로 성과 데이터 업데이트
- Chrome Alarms API 사용

---

### 4. Auth Service (`authService.js`)

**역할**: Google OAuth 2.0 인증 관리.

**주요 기능**:

- Google 계정 로그인
- 토큰 갱신
- GA4 속성 목록 가져오기
- AdSense 계정 ID 가져오기

**주요 함수**:

- `startGoogleAuth()`: Google 로그인 시작
- `refreshAuthToken()`: 토큰 갱신
- `getValidToken()`: 유효한 토큰 가져오기
- `fetchGaProperties()`: GA4 속성 목록 가져오기
- `fetchAdSenseAccountId()`: AdSense 계정 ID 가져오기
- `revokeGoogleAuth()`: 인증 취소

**인증 흐름**:

1. 사용자가 "Google 로그인" 버튼 클릭
2. Chrome Identity API로 OAuth 토큰 획득
3. Firebase에 Google 토큰으로 로그인
4. GA4/AdSense API 접근 권한 확인

**관련 문서**: [인증 흐름](../guides/AUTHENTICATION_FLOW.md)

---

### 5. Collector Service (`collectorService.js`)

**역할**: 외부 채널에서 콘텐츠를 수집합니다.

**주요 기능**:

- RSS 피드 수집 (블로그)
- YouTube 채널 수집
- 웹페이지 파싱 (Offscreen Document 활용)
- 중복 URL 체크

**주요 함수**:

- `fetchRssFeed()`: RSS 피드 수집
- `fetchYoutubeChannel()`: YouTube 채널 수집
- `fetchAllChannelData()`: 모든 채널 데이터 수집
- `parseBlogPage()`: 블로그 페이지 파싱
- `checkDuplicateUrl()`: 중복 URL 체크
- `fetchAndSaveSinglePost()`: 단일 포스트 수집 및 저장

**Offscreen Document 활용**:

- Manifest V3의 제약으로 인해 Service Worker에서 DOM API 사용 불가
- Offscreen Document를 통해 HTML 파싱 및 분석

---

### 6. Kanban Service (`kanbanService.js`)

**역할**: 칸반 보드의 아이디어 카드 관리.

**주요 기능**:

- 아이디어 카드 생성/삭제
- 상태 변경 (아이디어 → 진행 중 → 완료)
- AI 브리핑 자동 생성
- 성과 추적 연결

**주요 함수**:

- `createAndSaveNewIdea()`: 새 아이디어 생성
- `addIdeaToKanban()`: 아이디어를 칸반에 추가
- `removeIdeaFromKanban()`: 아이디어 제거
- `deleteKanbanCard()`: 카드 삭제

**자동 브리핑 생성**:

- 아이디어 저장 시 자동으로 AI 브리핑 생성
- `originType`이 `manual_entry` 또는 `tracking_only`가 아닌 경우

---

### 7. Scrap Service (`scrapService.js`)

**역할**: 스크랩 데이터 관리.

**주요 기능**:

- 스크랩 저장
- 스크랩 조회 (채널별 필터링)
- 스크랩 삭제
- 스크랩 상세 정보 가져오기

**주요 함수**:

- `saveScrapElement()`: 스크랩 저장
- `getFirebaseScraps()`: 스크랩 목록 가져오기
- `getScrapDetail()`: 스크랩 상세 정보
- `deleteScrap()`: 스크랩 삭제

**채널 필터링**:

- `targetChannelId` 파라미터로 특정 채널의 스크랩만 조회 가능

---

### 8. Migration Service

이전에는 마이그레이션 서비스가 존재했지만, 현재 개발 단계에서는 해당 기능이 제거되어 문서와 코드베이스에서 삭제되었습니다.
필요 시 추후 재추진할 수 있습니다.

---

### 9. Thumbnail Service (`thumbnailService.js`)

**역할**: 썸네일 템플릿 및 텍스트 생성.

**주요 기능**:

- 썸네일 템플릿 관리
- 썸네일 텍스트 생성 (AI 활용)

**주요 함수**:

- `getThumbnailTemplates()`: 템플릿 목록 가져오기
- `deleteTemplate()`: 템플릿 삭제
- `generateThumbnailTexts()`: 썸네일 텍스트 생성

---

### 10. Offscreen Service (`offscreenService.js`)

**역할**: Offscreen Document 생성 및 관리, HTML 정제 및 포매팅.

**주요 기능**:

- Offscreen Document 생성 및 관리 (싱글톤 패턴)
- HTML 정제 및 포매팅 (DOMPurify 사용)
- 이미지 리사이징
- 템플릿 렌더링
- HTML 파싱

**주요 함수**:

- `sanitizeHtmlInOffscreen()`: HTML 정제 및 포매팅 (XSS 방어)
- `resizeImageInOffscreen()`: 이미지 리사이징
- `renderTemplateInOffscreen()`: 템플릿 렌더링
- `parseHtmlInOffscreen()`: HTML 파싱

**보안 기능**:

- DOMPurify를 통한 XSS 공격 방어
- 위험한 태그/속성 자동 제거 (`<script>`, `onerror`, `onclick`, `<iframe>` 등)
- Marked를 통한 안전한 마크다운 변환

**사용 예시**:

```javascript
import { sanitizeHtmlInOffscreen } from './offscreenService.js';

const cleanedHtml = await sanitizeHtmlInOffscreen(rawHtml);
```

---

### 12. Cascade Delete Service (`cascadeDeleteService.js`)

**역할**: 채널 및 경쟁 채널 삭제 시 연쇄 삭제 처리.

**주요 기능**:

- 경쟁 채널 삭제 시 관련 데이터 연쇄 삭제
- 채널 삭제 시 관련 데이터 연쇄 삭제
- 삭제된 경쟁 채널 감지

**주요 함수**:

- `deleteCompetitorData()`: 경쟁 채널 데이터 삭제
- `deleteChannelDataCascade()`: 채널 데이터 연쇄 삭제
- `findDeletedCompetitors()`: 삭제된 경쟁 채널 URL 찾기

**삭제 대상 데이터**:

- `channel_content/{userId}/blogs` (경쟁 채널 콘텐츠)
- `channel_content/{userId}/youtubes` (경쟁 채널 콘텐츠)
- `channel_meta/{userId}/{sourceId}` (채널 메타데이터)
- `scraps/{userId}` (채널 관련 스크랩)
- `kanban/{userId}/{status}/{cardId}` (채널 관련 칸반 카드)

---

## 🔄 서비스 간 상호작용

### 데이터 흐름 예시

#### 1. 아이디어 생성 및 브리핑 생성

```
kanbanService.addIdeaToKanban()
  → aiService.generateIdeaBriefing()
    → firebaseService.update() (브리핑 저장)
```

#### 2. 성과 데이터 수집

```
analyticsService.updateSinglePerformanceMetric()
  → authService.getValidToken()
  → analyticsService.getAnalyticsData()
  → analyticsService.getAdsenseData()
  → firebaseService.update() (성과 데이터 저장)
```

#### 3. 채널 데이터 수집

```
collectorService.fetchAllChannelData()
  → firebaseService.get() (채널 목록 조회)
  → collectorService.fetchRssFeed()
  → collectorService.fetchAndSaveSinglePost()
    → firebaseService.set() (포스트 저장)
```

#### 4. 초안 생성 및 HTML 정제 (제휴 링크 포함)

```
aiService.generateDraftFromIdea()
  → aiService.getRelevantAffiliateLinks() (제휴 링크 조회 및 필터링)
    → firebaseService.get() (affiliate_links/{userId} 조회)
    → 키워드 기반 필터링 (제목, 태그와 관련된 링크만 선택)
  → promptService.PromptBuilder() (프롬프트 조립)
    → detectPersona() (페르소나 자동 감지)
    → setTone() (톤앤매너 설정)
    → addSkill() (글쓰기 스킬 추가)
    → setTrendContext() (트렌드 데이터 주입)
    → buildSystemPrompt() (시스템 프롬프트 생성)
    → 제휴 링크 삽입 규칙 주입 (문맥 기반, CTA 자동 생성, 최대 3개 제한)
  → aiService.callGeminiAPI() (초안 생성)
  → offscreenService.sanitizeHtmlInOffscreen() (HTML 정제 및 포매팅)
    → DOMPurify (XSS 방어)
    → Marked (마크다운 변환)
    → DOM API (스타일링, 제휴 링크 녹색 스타일 보존)
  → firebaseService.update() (초안 저장)
```

#### 5. 채널/경쟁 채널 삭제

```
background.js (delete_channel 액션)
  → cascadeDeleteService.deleteChannelDataCascade()
    → firebaseService.remove() (연관 데이터 삭제)

background.js (save_channels_and_key 액션)
  → cascadeDeleteService.findDeletedCompetitors()
  → cascadeDeleteService.deleteCompetitorData()
    → firebaseService.remove() (경쟁 채널 데이터 삭제)
```

---

## 📦 의존성 관리

### 서비스 간 의존성

```
firebaseService (기본)
  ├── aiService
  ├── analyticsService
  ├── kanbanService
  ├── scrapService
  ├── (migrationService removed)
  ├── thumbnailService
  ├── cascadeDeleteService
  └── collectorService

authService
  └── analyticsService

aiService
  ├── analyticsService (순환 참조 방지: 순수 함수만 import)
  ├── offscreenService (HTML 정제)
  └── promptService (프롬프트 빌더)

offscreenService
  └── (독립적, Offscreen Document에서 실행)

cascadeDeleteService
  └── firebaseService
```

### 순환 참조 방지

- `aiService`와 `analyticsService` 간 순환 참조 방지
- `analyticsService`에서 순수 데이터 분석 함수만 export
- `aiService`에서 순수 함수만 import

---

## 🔒 에러 처리

### 공통 에러 처리 패턴

```javascript
try {
  const result = await serviceFunction();
  if (result.success) {
    // 성공 처리
  } else {
    Logger.error('에러:', result.error);
  }
} catch (error) {
  Logger.error('예외 발생:', error);
  // 에러 UI 표시
}
```

### Logger 사용

모든 서비스는 `Logger`를 사용하여 로깅합니다:

```javascript
import { Logger } from '../utils.js';

Logger.info('정보 메시지');
Logger.warn('경고 메시지');
Logger.error('에러 메시지');
Logger.debug('디버그 메시지');
Logger.biz('비즈니스 로직 메시지');
```

---

## 🔗 관련 문서

- [AI 서비스 가이드](../guides/AI_SERVICE_GUIDE.md)
  -- (마이그레이션 서비스 가이드는 제거됨)
- [Firebase 채널 구조](../firebase/FIREBASE_CHANNELS_STRUCTURE.md)
- [실제 저장 구조](./ACTUAL_SAVE_STRUCTURE.md)
