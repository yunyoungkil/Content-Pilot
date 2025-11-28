# AI 서비스 가이드

> **최종 업데이트**: 2025-01-27  
> **상태**: ✅ 최신 (제휴 링크 삽입 기능 추가)

## 📋 개요

Content Pilot의 AI 서비스는 Google Gemini API를 활용하여 콘텐츠 기획, 작성, 분석을 자동화하는 핵심 기능을 제공합니다.

## 🔑 주요 기능

### 1. Gemini API 호출 (`callGeminiAPI`)

**기능**: Gemini API를 호출하여 텍스트 생성 작업을 수행합니다.

**사용법**:

```javascript
import { callGeminiAPI } from "./services/aiService.js";

const prompt = "콘텐츠 아이디어를 5개 제안해주세요.";
const result = await callGeminiAPI(prompt);
```

**설정 요구사항**:

- `geminiApiKey`가 `chrome.storage.local`에 저장되어 있어야 합니다.
- API 키는 채널 관리 모달에서 설정할 수 있습니다.

**에러 처리**:

- API 키가 없으면 에러를 throw합니다.
- API 호출 실패 시 상세한 에러 메시지를 반환합니다.

---

### 2. 프롬프트 빌더 시스템 (`promptService.js`)

**기능**: 모듈형 프롬프트 빌더 패턴을 사용하여 페르소나, 톤, 스킬을 레이어로 분리하여 동적으로 프롬프트를 조립합니다.

**프롬프트 레이어 구조**:

1. **System Instruction**: 페르소나 역할 및 기본 정체성
2. **Tone & Manner Guide**: 어조 및 말투 세부 조정
3. **Writing Skills Applied**: 글쓰기 스킬 옵션
4. **Trend Data & Context**: SEO 강화를 위한 트렌드 키워드

**지원 페르소나**:

#### 전문가형 (`professional`)

- **기본 톤**: 논리적 (`logical`)
- **특징**: 권위 있는 전문가, 깊이 있는 통찰력
- **기본 스킬**: 수치 증명, 비교 분석
- **적용 키워드**: 가이드, 사용법, 강좌, 정리, 뉴스, 소식, 트렌드, 통계, 비교, 장단점, 분석

#### 친근한형 (`friendly`)

- **기본 톤**: 감성적 (`emotional`)
- **특징**: 소통을 좋아하는 인플루언서, 공감대 형성
- **기본 스킬**: 질문 던지기, 스토리텔링
- **적용 키워드**: 후기, 리뷰, 일상, 여행, 맛집, 추천, 솔직, 내돈내산, 소통, 이웃

#### 바이럴형 (`viral`)

- **기본 톤**: 임팩트 (`impact`)
- **특징**: 클릭을 유도하는 카피라이팅, 호기심 자극
- **기본 스킬**: 클리프행어
- **적용 키워드**: 비밀, 꿀팁, 초간단, 초보, 모르는, 충격, 놀라운, 반드시, 절대, 공개

**톤앤매너 오버라이드**:

- 페르소나와 별개로 톤을 강제로 설정할 수 있습니다.
- 예: 전문가형 페르소나에 친근한 톤 적용 가능

**글쓰기 스킬**:

- `questioning`: 질문 던지기
- `statistics`: 수치 증명
- `storytelling`: 스토리텔링
- `comparison`: 비교 분석
- `cliffhanger`: 클리프행어

**페르소나 선택 우선순위**:

1. 아이디어 데이터에 명시적으로 설정된 `persona`
2. 사용자 설정의 `defaultPersona` 또는 `defaultTone`
3. 자동 감지 (`detectPersona` 함수 사용)

---

### 3. 아이디어 브리핑 생성 (`generateIdeaBriefing`)

**기능**: 아이디어 카드에 대한 AI 브리핑 데이터를 자동 생성합니다.

**생성되는 데이터**:

- **추천 목차** (`outline`): 콘텐츠 구조 제안
- **추천 검색어** (`recommendedSearchTerms`): SEO 최적화 검색어
- **주요 키워드** (`mainKeywords`): 핵심 키워드 목록
- **롱테일 키워드** (`longTailKeywords`): 세부 키워드 목록

**사용법**:

```javascript
import { generateIdeaBriefing } from "./services/aiService.js";

await generateIdeaBriefing(cardId, title, description, {
  status: "ideas",
  generateOutline: true,
  generateKeywords: true,
  generateLongTail: true,
  generateMainKeywords: true,
  onProgress: (progress) => console.log(progress),
});
```

**자동 생성 조건**:

- `originType`이 `manual_entry` 또는 `tracking_only`가 아닌 경우
- 아이디어에 `title`이 있는 경우
- 상태가 `ideas`인 경우

**옵션**:

- `generateOutline`: 목차 생성 여부
- `generateKeywords`: 검색어 생성 여부
- `generateLongTail`: 롱테일 키워드 생성 여부
- `generateMainKeywords`: 주요 키워드 생성 여부
- `onProgress`: 진행 상황 콜백

---

### 4. 초안 자동 생성 (`generateDraftFromIdea`)

**기능**: 아이디어 데이터를 기반으로 완전한 콘텐츠 초안을 생성합니다.

**입력 데이터**:

- 아이디어 제목, 설명, 태그
- 연결된 스크랩 자료
- 원본 본문 (리뉴얼의 경우)
- 과거 포스팅 목록 (내부 링크용)

**생성되는 내용**:

- SEO 최적화된 제목 (h1)
- 서론
- 본문 섹션들 (목차 기반, h2)
- 결론
- 이미지 생성 프롬프트 (본문 중간)
- 썸네일 정보 (JSON 형식)

**HTML 정제 및 포매팅**:

- Gemini API로 생성된 초안은 `offscreenService.sanitizeHtmlInOffscreen()`을 통해 안전하게 정제됩니다.
- DOMPurify를 사용하여 XSS 공격을 방어합니다.
- Marked를 사용하여 마크다운을 안전하게 HTML로 변환합니다.
- DOM API를 사용하여 스타일링 및 포매팅을 적용합니다.
- 위험한 정규식 기반 함수(`formatDraftForReadability`)는 제거되었습니다.

**작성 규칙**:

1. **이모지 사용 금지**: 텍스트만 사용
2. **제목 최적화**: SEO 최적화된 제목을 별도로 생성
3. **문서 구조**: 제목 → 구분선 → 서론 → 본문 → 결론
4. **키워드 통합**: 롱테일 키워드를 자연스럽게 본문에 포함
5. **이미지 프롬프트**: 본문 중간에 적절한 위치에 삽입
6. **참고 자료 링크**: 번호 표기 없이 자연스럽게 통합

**이미지 프롬프트 형식**:

```markdown
<span style="color: #2e7d32;">[이미지 생성 프롬프트 (영어): High-quality photo of [주제], professional lighting, 8K resolution]</span>

<span style="color: #2e7d32;">[이미지 생성 프롬프트 (한글): [주제]에 대한 고품질 사진, 전문적인 조명, 사실적 스타일]</span>
```

**썸네일 정보 형식** (3가지 컨셉 배열):

```xml
<썸네일정보>
[
  {
    "type": "curiosity",
    "thumbnailPromptEn": "영어 프롬프트",
    "thumbnailPromptKo": "한글 프롬프트",
    "thumbnailText": "호기심 문구 (12자 이내)"
  },
  {
    "type": "informative",
    "thumbnailPromptEn": "영어 프롬프트",
    "thumbnailPromptKo": "한글 프롬프트",
    "thumbnailText": "정보형 문구 (12자 이내)"
  },
  {
    "type": "emotional",
    "thumbnailPromptEn": "영어 프롬프트",
    "thumbnailPromptKo": "한글 프롬프트",
    "thumbnailText": "공감형 문구 (12자 이내)"
  }
]
</썸네일정보>
```

**사용법**:

```javascript
import { generateDraftFromIdea } from './services/aiService.js';

const ideaData = {
  title: "스마트홈 설정 가이드",
  description: "초보자를 위한 스마트홈 설정 방법",
  tags: ["스마트홈", "IoT"],
  linkedScrapsContent: [...],
  channelId: "channel123"
};

const result = await generateDraftFromIdea(ideaData);
if (result.success) {
  console.log(result.draft); // 정제된 초안 (XSS 방어 적용)
  console.log(result.thumbnailInfo); // 썸네일 정보
  console.log(result.seoTitle); // SEO 최적화된 제목
}
```

**제휴 마케팅 링크 삽입**:

- 초안 생성 시 사용자가 등록한 제휴 링크를 자동으로 조회하고 필터링합니다.
- 글의 주제(제목, 태그)와 관련된 링크만 선별하여 프롬프트에 주입합니다.
- AI가 문맥을 이해하고 구매 의도가 발생하는 순간에 자연스럽게 링크를 삽입합니다.
- 매력적인 CTA(Call To Action) 문구를 자동 생성합니다 (예: "최저가 확인하기", "더 자세한 스펙 보기").
- 최대 3개까지만 삽입하여 글의 품질을 유지합니다.
- 녹색 텍스트 스타일(`<span style="color: #2e7d32;">`)로 시각적 강조를 적용합니다.

**제휴 링크 데이터 구조**:

- Firebase 경로: `affiliate_links/{userId}/{linkKey}`
- 필수 필드: `keyword`, `url`
- 선택 필드: `productName`, `description`, `createdAt`

**제휴 링크 필터링 로직**:

- 글의 제목, 태그, 설명에 키워드가 포함된 링크만 선택
- 최대 10개까지만 프롬프트에 포함 (토큰 절약)

---

### 5. 키워드 갭 분석 (`analyzeKeywordGap`)

**기능**: 내 콘텐츠와 경쟁 채널 콘텐츠의 키워드 차이를 분석합니다.

**사용법**:

```javascript
import { analyzeKeywordGap } from "./services/aiService.js";

const myContent = [{ tags: ["스마트홈", "IoT"] }];
const competitorContent = [{ tags: ["스마트홈", "자동화", "AI"] }];

const result = await analyzeKeywordGap(myContent, competitorContent);
console.log(result.gapKeywords); // ["자동화", "AI"]
console.log(result.gapCount); // 2
```

---

### 6. 트렌드 분석 (`getEmergingTopics`)

**기능**: 채널 맥락을 기반으로 최신 트렌드 주제를 제안합니다.

**사용법**:

```javascript
import { getEmergingTopics } from "./services/aiService.js";

const channelContext = "스마트홈 관련 블로그";
const topics = await getEmergingTopics(channelContext);
```

---

### 7. AI 이미지 생성 (`generateAiImage`)

**기능**: Gemini API를 사용하여 이미지를 생성하고 Firebase Storage에 업로드합니다.

**사용법**:

```javascript
import { generateAiImage } from "./services/aiService.js";

const prompt = "고품질 스마트홈 이미지";
const result = await generateAiImage(prompt, (count = 1));
// 결과: ['https://firebase-storage-url/image1.png', ...]
```

**처리 방식**:

- **병렬 처리**: 최대 3개 동시 요청으로 API Rate Limit 방지
- **에러 핸들링**: 개별 실패 시 null 반환, 성공한 이미지만 필터링
- **자동 업로드**: 생성된 이미지를 Firebase Storage에 자동 업로드

**알고리즘 세부사항**:

1. 작업 큐 생성: `count`만큼의 이미지 생성 작업 준비
2. 동시 실행 제한: `MAX_CONCURRENT = 3`으로 동시에 최대 3개만 실행
3. 대기 관리: `Promise.race()`로 하나 완료 시 다음 작업 시작
4. 결과 수집: `Promise.all()`로 모든 작업 완료 대기
5. 필터링: 성공한 URL만 반환, 실패한 작업은 제외

**성능 특징**:

- **속도 향상**: 순차 처리 대비 2-3배 빠른 이미지 생성
- **안정성**: 일부 실패해도 전체 작업 중단되지 않음
- **리소스 관리**: 동시 요청 제한으로 API 과부하 방지

**에러 처리**:

- 개별 이미지 생성 실패 시 해당 작업만 skip
- 모든 작업 실패 시 에러 throw
- Firebase 업로드 실패 시 해당 이미지 제외

---

### 8. 콘텐츠 아이디어 생성 (`generateContentIdeas`)

**기능**: 성과 데이터와 사용자 피드백을 기반으로 맞춤형 아이디어를 제안합니다.

**사용법**:

```javascript
import { generateContentIdeas } from './services/aiService.js';

const data = {
  channelId: "channel123",
  performanceData: {...},
  feedback: {...}
};

const ideas = await generateContentIdeas(data);
```

---

### 9. 제휴 마케팅 링크 관리

**기능**: 사용자가 등록한 제휴 링크를 Firebase에 저장하고, 초안 생성 시 자동으로 삽입합니다.

**데이터 저장 경로**:

```
affiliate_links/{userId}/{linkKey}
```

**링크 데이터 구조**:

```javascript
{
  keyword: "아이폰",           // 필수: 키워드
  productName: "아이폰 15",     // 선택: 상품명
  url: "https://coupang.com/...", // 필수: 제휴 링크 URL
  description: "아이폰 15 최신 모델", // 선택: 설명
  createdAt: 1234567890         // 선택: 생성 시간
}
```

**테스트 데이터 추가**:

- `test-add-affiliate-links.js` 스크립트를 사용하여 Firebase에 테스트 데이터를 추가할 수 있습니다.
- Service Worker 콘솔에서 스크립트를 실행하면 자동으로 인증 토큰을 가져와 데이터를 추가합니다.

**초안 생성 시 자동 삽입**:

- `generateDraftFromIdea` 함수가 자동으로 관련 제휴 링크를 조회합니다.

Auto-insertion note:

- The service will now optionally post-process generated drafts and insert affiliate links from the user's saved `affiliate_links` automatically.
- This behavior is controlled by a user-level setting `autoInsertAffiliateLinks` (chrome.storage.local) and can be overridden per request by passing `ideaData.autoInsertAffiliateLinks` boolean to `generateDraftFromIdea`.
- Insert rules enforced:
  - At most 3 affiliate links are inserted automatically.
  - The system prefers existing affiliate anchors and styles them consistently.
  - If there are no existing affiliate anchors, the service will deterministically look for a keyword/product name match and insert a CTA link in the most relevant location.
- 글의 제목, 태그, 설명과 관련된 링크만 선별합니다.
- AI가 문맥을 이해하고 자연스럽게 링크를 삽입합니다.

**링크 삽입 규칙**:

1. **문맥 기반 자연스러운 삽입**: 구매 의도가 발생하는 순간에 배치
2. **AI 기반 CTA 자동 생성**: 문맥에 어울리는 매력적인 문구 생성
3. **개수 제한**: 최대 3개까지만 삽입
4. **시각적 강조**: 녹색 텍스트 스타일 적용

---

## 🔧 설정

### Gemini API 키 설정

1. Content Pilot 패널 열기
2. 헤더의 글로벌 채널 선택기에서 "채널 관리" 선택
3. "📊 성과 추적 연동" 섹션에서 "Gemini API 키" 입력
4. API 키 저장

**API 키 발급 방법**:

1. [Google AI Studio](https://makersuite.google.com/app/apikey) 접속
2. "Create API Key" 클릭
3. 생성된 API 키를 복사하여 Content Pilot에 입력

---

## 📊 데이터 흐름

### 브리핑 생성 흐름

```
아이디어 저장 → generateIdeaBriefing 호출 → Gemini API 호출 →
브리핑 데이터 파싱 → Firebase 저장 → UI 업데이트
```

### 초안 생성 흐름

```
워크스페이스에서 "AI 초안 생성" 클릭 → generateDraftFromIdea 호출 →
페르소나 선택 → 데이터 준비 → Gemini API 호출 →
초안 파싱 및 포맷팅 → 에디터에 삽입
```

---

## ⚠️ 주의사항

1. **API 키 보안**: API 키는 로컬 스토리지에 저장되며, 절대 공유하지 마세요.
2. **API 사용량**: Gemini API는 사용량에 따라 비용이 발생할 수 있습니다.
3. **에러 처리**: API 호출 실패 시 적절한 에러 메시지가 표시됩니다.
4. **페르소나 선택**: 자동 감지가 원하는 결과를 주지 않으면 명시적으로 설정하세요.

---

## 🔗 관련 문서

- [Firebase 채널 구조](./firebase/FIREBASE_CHANNELS_STRUCTURE.md)
- [성과 데이터 시각화 사용 패턴](./성과-데이터-시각화-사용-패턴.md)
- [워크스페이스 기능 PRD](<../../prd/Content%20Pilot%20워크스페이스%20기능%20PRD%20(v1.0).txt>)
