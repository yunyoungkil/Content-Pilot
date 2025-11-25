# AI 서비스 가이드

> **최종 업데이트**: 2025-01-25  
> **상태**: ✅ 최신

## 📋 개요

Content Pilot의 AI 서비스는 Google Gemini API를 활용하여 콘텐츠 기획, 작성, 분석을 자동화하는 핵심 기능을 제공합니다.

## 🔑 주요 기능

### 1. Gemini API 호출 (`callGeminiAPI`)

**기능**: Gemini API를 호출하여 텍스트 생성 작업을 수행합니다.

**사용법**:
```javascript
import { callGeminiAPI } from './services/aiService.js';

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

### 2. 페르소나 시스템 (`PERSONA_TEMPLATES`)

**기능**: 콘텐츠 작성 시 사용할 톤앤매너를 자동으로 선택합니다.

**지원 페르소나**:

#### 전문가형 (`professional`)
- **톤앤매너**: 신뢰감 있고 정제된 비즈니스 톤 ("~입니다", "~합니다")
- **특징**: 객관적인 사실, 통계, 전문 용어 활용
- **적용 키워드**: 가이드, 사용법, 강좌, 정리, 뉴스, 소식, 트렌드, 통계, 비교, 장단점, 분석

#### 친근한형 (`friendly`)
- **톤앤매너**: 친근하고 편안한 구어체, 반드시 존댓말 사용
- **특징**: 개인적인 경험담과 감성적 표현
- **적용 키워드**: 후기, 리뷰, 일상, 여행, 맛집, 추천, 솔직, 내돈내산

#### 바이럴형 (`viral`)
- **톤앤매너**: 강렬하고 임팩트 있는 문장, 호기심 자극
- **특징**: 숫자, 비교, 놀라운 사실 활용
- **적용 키워드**: 비밀, 꿀팁, 초간단, 초보, 모르는, 충격, 놀라운, 반드시, 절대

**페르소나 선택 우선순위**:
1. 아이디어 데이터에 명시적으로 설정된 `persona` 또는 `tone`
2. 사용자 설정의 `defaultPersona` 또는 `defaultTone`
3. 자동 감지 (키워드 스코어링)

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
import { generateIdeaBriefing } from './services/aiService.js';

await generateIdeaBriefing(cardId, title, description, {
  status: 'ideas',
  generateOutline: true,
  generateKeywords: true,
  generateLongTail: true,
  generateMainKeywords: true,
  onProgress: (progress) => console.log(progress)
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

**썸네일 정보 형식**:
```xml
<썸네일정보>
{
  "thumbnailPromptEn": "영어 프롬프트",
  "thumbnailPromptKo": "한글 프롬프트",
  "thumbnailText": "썸네일 문구 (12자 이내)"
}
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
  console.log(result.draft); // 생성된 초안
  console.log(result.thumbnailInfo); // 썸네일 정보
}
```

---

### 5. 키워드 갭 분석 (`analyzeKeywordGap`)

**기능**: 내 콘텐츠와 경쟁 채널 콘텐츠의 키워드 차이를 분석합니다.

**사용법**:
```javascript
import { analyzeKeywordGap } from './services/aiService.js';

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
import { getEmergingTopics } from './services/aiService.js';

const channelContext = "스마트홈 관련 블로그";
const topics = await getEmergingTopics(channelContext);
```

---

### 7. AI 이미지 생성 (`generateAiImage`)

**기능**: Gemini API를 사용하여 이미지를 생성합니다.

**사용법**:
```javascript
import { generateAiImage } from './services/aiService.js';

const prompt = "고품질 스마트홈 이미지";
const result = await generateAiImage(prompt, count = 1);
```

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
- [워크스페이스 기능 PRD](../../prd/Content%20Pilot%20워크스페이스%20기능%20PRD%20(v1.0).txt)

