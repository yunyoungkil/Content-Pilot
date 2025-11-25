# 프롬프트 빌더 시스템 검증 및 테스트 가이드

> **최종 업데이트**: 2025-01-26  
> **상태**: ✅ 최신

## 📋 개요

이 문서는 모듈형 프롬프트 빌더 시스템(`promptService.js`)의 검증 및 테스트 방법을 설명합니다. 프롬프트 빌더는 페르소나, 톤, 스킬, 트렌드 데이터를 레이어로 분리하여 동적으로 프롬프트를 조립하는 시스템입니다.

## 🎯 테스트 목표

1. **페르소나 자동 감지**: 키워드 기반으로 올바른 페르소나가 선택되는지 확인
2. **톤앤매너 적용**: 각 페르소나의 기본 톤이 올바르게 적용되는지 확인
3. **스킬 주입**: 글쓰기 스킬이 프롬프트에 포함되는지 확인
4. **트렌드 데이터 반영**: SEO 키워드가 프롬프트에 주입되는지 확인
5. **톤 오버라이드**: 페르소나와 별개로 톤을 강제 설정할 수 있는지 확인

---

## 🧪 테스트 시나리오

### 테스트 1: 동적 페르소나 테스트

#### 1-1. 친근한형 (friendly) 페르소나 테스트

**목적**: 친근한형 페르소나가 올바르게 감지되고 적용되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "제주도 여행 후기",
  description: "제주도 여행을 다녀왔어요. 맛집 추천과 일상 이야기를 공유합니다.",
  tags: ["여행", "후기", "맛집", "추천"],
  channelId: "channel123"
};
```

**예상 결과**:
- 페르소나: `friendly` (자동 감지)
- 기본 톤: `emotional`
- 기본 스킬: `questioning`, `storytelling`
- 생성된 글에 포함되어야 할 요소:
  - "여러분", "~해요", "~네요" 같은 친근한 구어체
  - 질문형 문장 ("~아시나요?", "~해보셨어요?")
  - 개인적인 경험담과 일화

**검증 방법**:
1. 워크스페이스에서 해당 아이디어 카드 열기
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ "안녕하세요!", "여러분께", "~해요" 같은 친근한 표현 포함
   - ✅ 질문형 문장 포함
   - ✅ 개인적인 경험담 포함
   - ❌ 반말("~해", "~야") 사용하지 않음

---

#### 1-2. 전문가형 (professional) 페르소나 테스트

**목적**: 전문가형 페르소나가 올바르게 감지되고 적용되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "스마트홈 설정 가이드",
  description: "초보자를 위한 스마트홈 설정 방법을 체계적으로 정리합니다.",
  tags: ["가이드", "스마트홈", "IoT", "설정"],
  channelId: "channel123"
};
```

**예상 결과**:
- 페르소나: `professional` (자동 감지)
- 기본 톤: `logical`
- 기본 스킬: `statistics`, `comparison`
- 생성된 글에 포함되어야 할 요소:
  - "~입니다", "~합니다" 같은 정제된 비즈니스 톤
  - "따라서", "그러므로" 같은 논리적 연결어
  - 구체적인 숫자나 통계 데이터
  - 체계적인 구조와 명확한 해결책 제시

**검증 방법**:
1. 워크스페이스에서 해당 아이디어 카드 열기
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ "본 글에서는...", "이번에는..." 같은 전문적인 도입부
   - ✅ "~입니다", "~합니다" 체 사용
   - ✅ 논리적 구조와 명확한 인과관계
   - ✅ 구체적인 숫자나 통계 포함

---

#### 1-3. 바이럴형 (viral) 페르소나 테스트

**목적**: 바이럴형 페르소나가 올바르게 감지되고 적용되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "아무도 모르는 꿀팁 공개",
  description: "99%가 모르는 초간단 비밀을 공개합니다.",
  tags: ["꿀팁", "비밀", "초간단", "충격"],
  channelId: "channel123"
};
```

**예상 결과**:
- 페르소나: `viral` (자동 감지)
- 기본 톤: `impact`
- 기본 스킬: `cliffhanger`
- 생성된 글에 포함되어야 할 요소:
  - "이거 진짜 놀라운데요?", "아무도 모르는 비밀" 같은 강렬한 첫 문장
  - "충격적인", "놀라운", "반드시", "절대" 같은 강력한 형용사
  - 짧고 임팩트 있는 문장
  - 클리프행어 기법 (다음 섹션을 읽고 싶게 만드는 문장)

**검증 방법**:
1. 워크스페이스에서 해당 아이디어 카드 열기
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 강렬하고 임팩트 있는 첫 문장
   - ✅ "충격적인", "놀라운", "반드시" 같은 강력한 표현
   - ✅ 짧고 임팩트 있는 문장 구조
   - ✅ 문단 마지막에 궁금증을 유발하는 문장

---

### 테스트 2: 스킬 주입 테스트

#### 2-1. 수치 증명 스킬 테스트

**목적**: `statistics` 스킬이 프롬프트에 포함되고 생성된 글에 반영되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "스마트폰 배터리 수명 연장 방법",
  description: "배터리 수명을 늘리는 실용적인 팁을 제공합니다.",
  tags: ["스마트폰", "배터리", "팁"],
  skills: ["statistics"], // 스킬 명시적 지정
  channelId: "channel123"
};
```

**예상 결과**:
- 생성된 글에 구체적인 숫자나 비율 포함
- 예: "90% 이상의 사용자가...", "평균 3배 더 오래...", "약 20% 개선..."

**검증 방법**:
1. 아이디어 카드에 `skills: ["statistics"]` 추가 (개발자 도구에서 직접 수정)
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 구체적인 숫자나 비율 포함
   - ✅ 주장을 뒷받침하는 통계 데이터 포함

---

#### 2-2. 질문 던지기 스킬 테스트

**목적**: `questioning` 스킬이 프롬프트에 포함되고 생성된 글에 반영되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "건강한 식습관 만들기",
  description: "일상에서 실천할 수 있는 건강한 식습관을 소개합니다.",
  tags: ["건강", "식습관", "추천"],
  skills: ["questioning"], // 스킬 명시적 지정
  channelId: "channel123"
};
```

**예상 결과**:
- 생성된 글에 독자의 생각을 묻는 질문 포함
- 예: "여러분은 어떻게 생각하시나요?", "~해보셨어요?", "~아시나요?"

**검증 방법**:
1. 아이디어 카드에 `skills: ["questioning"]` 추가
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 문단 시작이나 끝에 질문형 문장 포함
   - ✅ 독자의 참여를 유도하는 질문 포함

---

#### 2-3. 클리프행어 스킬 테스트

**목적**: `cliffhanger` 스킬이 프롬프트에 포함되고 생성된 글에 반영되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "성공하는 블로거의 비밀",
  description: "블로거가 알아야 할 핵심 전략을 공개합니다.",
  tags: ["블로그", "비밀", "전략"],
  skills: ["cliffhanger"], // 스킬 명시적 지정
  channelId: "channel123"
};
```

**예상 결과**:
- 생성된 글의 문단 마지막에 궁금증을 유발하는 문장 포함
- 예: "하지만 이것만으로는 부족합니다. 다음 섹션에서 더 중요한 비밀을 공개하겠습니다."

**검증 방법**:
1. 아이디어 카드에 `skills: ["cliffhanger"]` 추가
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 문단 마지막에 다음 섹션을 읽고 싶게 만드는 문장 포함
   - ✅ 궁금증을 유발하는 표현 포함

---

### 테스트 3: 트렌드 데이터 반영 테스트

#### 3-1. 추천 검색어 주입 테스트

**목적**: `recommendedSearches`가 프롬프트에 주입되고 생성된 글에 자연스럽게 반영되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "스마트홈 자동화 설정",
  description: "스마트홈을 자동화하는 방법을 설명합니다.",
  tags: ["스마트홈", "자동화", "IoT"],
  recommendedSearches: ["스마트홈 초기 설정", "홈 IoT 연결", "자동화 시나리오"],
  channelId: "channel123"
};
```

**예상 결과**:
- 프롬프트의 `[Trend Data & Context]` 섹션에 추천 검색어 포함
- 생성된 글에 추천 검색어가 자연스럽게 녹아들어 있음
- 키워드 스터핑 없이 문맥에 맞게 사용

**검증 방법**:
1. 아이디어 카드에 `recommendedSearches` 배열 추가
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 추천 검색어가 본문에 자연스럽게 포함
   - ✅ 키워드 스터핑 없이 문맥에 맞게 사용
   - ✅ SEO 최적화가 자연스럽게 적용

---

#### 3-2. 롱테일 키워드 주입 테스트

**목적**: `longTailKeywords`가 프롬프트에 주입되고 생성된 글에 자연스럽게 반영되는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "노트북 구매 가이드",
  description: "노트북을 구매할 때 고려해야 할 사항을 정리합니다.",
  tags: ["노트북", "구매", "가이드"],
  longTailKeywords: ["게이밍 노트북 추천", "가성비 노트북 비교", "노트북 사양 선택"],
  channelId: "channel123"
};
```

**예상 결과**:
- 프롬프트의 `[Trend Data & Context]` 섹션에 롱테일 키워드 포함
- 생성된 글에 롱테일 키워드가 자연스럽게 녹아들어 있음

**검증 방법**:
1. 아이디어 카드에 `longTailKeywords` 배열 추가
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 롱테일 키워드가 본문에 자연스럽게 포함
   - ✅ 키워드 스터핑 없이 문맥에 맞게 사용

---

### 테스트 4: 톤앤매너 오버라이드 테스트

#### 4-1. 전문가형 페르소나 + 친근한 톤 테스트

**목적**: 페르소나와 별개로 톤을 강제 설정할 수 있는지 확인

**테스트 데이터**:
```javascript
const ideaData = {
  title: "스마트홈 설정 가이드",
  description: "초보자를 위한 스마트홈 설정 방법을 체계적으로 정리합니다.",
  tags: ["가이드", "스마트홈", "IoT"],
  persona: "professional", // 전문가형 페르소나
  tone: "emotional", // 친근한 톤 오버라이드
  channelId: "channel123"
};
```

**예상 결과**:
- 페르소나: `professional` (전문가형 역할 유지)
- 톤: `emotional` (친근한 말투 적용)
- 생성된 글: 전문가의 깊이 있는 통찰력 + 친근한 구어체

**검증 방법**:
1. 아이디어 카드에 `persona: "professional"`, `tone: "emotional"` 추가
2. "AI 초안 생성" 버튼 클릭
3. 생성된 초안 확인:
   - ✅ 전문가의 깊이 있는 통찰력 포함
   - ✅ "~해요", "~네요" 같은 친근한 구어체 사용
   - ✅ 전문가형의 논리적 구조 + 친근한 말투 조합

---

## 🔍 개발자 콘솔 테스트

### Service Worker 콘솔에서 직접 테스트

**접근 방법**:
1. `chrome://extensions` 페이지 열기
2. Content Pilot 확장 프로그램의 "Service Worker" 링크 클릭
3. Service Worker 콘솔에서 테스트

**테스트 코드**:
```javascript
// PromptService 직접 테스트
import { PromptBuilder, detectPersona, PROMPT_CONFIG } from './js/services/promptService.js';

// 1. 페르소나 자동 감지 테스트
const text1 = "제주도 여행 후기 맛집 추천";
console.log("감지된 페르소나:", detectPersona(text1)); // 예상: "friendly"

const text2 = "스마트홈 설정 가이드 사용법";
console.log("감지된 페르소나:", detectPersona(text2)); // 예상: "professional"

const text3 = "아무도 모르는 꿀팁 비밀 공개";
console.log("감지된 페르소나:", detectPersona(text3)); // 예상: "viral"

// 2. PromptBuilder 테스트
const builder = new PromptBuilder('friendly');
builder.setTone('emotional');
builder.addSkill('questioning');
builder.addSkill('storytelling');
builder.setTrendContext(['여행', '맛집'], ['제주도 맛집 추천', '제주 여행 코스']);

const systemPrompt = builder.buildSystemPrompt();
console.log("생성된 시스템 프롬프트:", systemPrompt);

// 3. 톤 오버라이드 테스트
const builder2 = new PromptBuilder('professional');
builder2.setTone('emotional'); // 전문가형인데 친근한 톤
const systemPrompt2 = builder2.buildSystemPrompt();
console.log("톤 오버라이드 프롬프트:", systemPrompt2);
```

---

## 📊 검증 체크리스트

### 기본 기능 검증

- [ ] 페르소나 자동 감지가 올바르게 작동하는가?
  - [ ] 친근한 키워드 → `friendly` 감지
  - [ ] 전문적 키워드 → `professional` 감지
  - [ ] 바이럴 키워드 → `viral` 감지

- [ ] 각 페르소나의 기본 톤이 올바르게 적용되는가?
  - [ ] `professional` → `logical` 톤
  - [ ] `friendly` → `emotional` 톤
  - [ ] `viral` → `impact` 톤

- [ ] 기본 스킬이 자동으로 주입되는가?
  - [ ] `professional` → `statistics`, `comparison`
  - [ ] `friendly` → `questioning`, `storytelling`
  - [ ] `viral` → `cliffhanger`

### 고급 기능 검증

- [ ] 톤 오버라이드가 작동하는가?
  - [ ] 전문가형 + 친근한 톤 조합 가능
  - [ ] 친근한형 + 논리적 톤 조합 가능

- [ ] 스킬이 명시적으로 지정되면 올바르게 주입되는가?
  - [ ] `skills: ["statistics"]` → 수치 증명 스킬 포함
  - [ ] `skills: ["questioning"]` → 질문 던지기 스킬 포함
  - [ ] `skills: ["cliffhanger"]` → 클리프행어 스킬 포함

- [ ] 트렌드 데이터가 프롬프트에 주입되는가?
  - [ ] `recommendedSearches` → `[Trend Data & Context]` 섹션에 포함
  - [ ] `longTailKeywords` → `[Trend Data & Context]` 섹션에 포함
  - [ ] 생성된 글에 트렌드 키워드가 자연스럽게 반영

### 생성된 콘텐츠 품질 검증

- [ ] 각 페르소나의 특징이 생성된 글에 반영되는가?
  - [ ] 친근한형: "~해요", "~네요", 질문형 문장
  - [ ] 전문가형: "~입니다", "~합니다", 논리적 구조
  - [ ] 바이럴형: 강렬한 표현, 짧은 문장, 클리프행어

- [ ] 스킬이 실제로 글에 반영되는가?
  - [ ] `statistics` → 구체적인 숫자나 비율 포함
  - [ ] `questioning` → 질문형 문장 포함
  - [ ] `cliffhanger` → 궁금증을 유발하는 문장 포함

- [ ] 트렌드 키워드가 자연스럽게 반영되는가?
  - [ ] 키워드 스터핑 없이 문맥에 맞게 사용
  - [ ] SEO 최적화가 자연스럽게 적용

---

## 🐛 문제 해결

### 페르소나가 올바르게 감지되지 않는 경우

**증상**: 예상과 다른 페르소나가 선택됨

**해결 방법**:
1. 아이디어 데이터에 `persona`를 명시적으로 설정
2. 사용자 설정에서 `defaultPersona` 확인
3. `detectPersona()` 함수의 키워드 스코어링 로직 확인

### 스킬이 반영되지 않는 경우

**증상**: 지정한 스킬이 생성된 글에 나타나지 않음

**해결 방법**:
1. `ideaData.skills` 배열이 올바르게 설정되었는지 확인
2. `PROMPT_CONFIG.skills`에 해당 스킬이 정의되어 있는지 확인
3. Service Worker 콘솔에서 `builder.buildSystemPrompt()` 결과 확인

### 트렌드 데이터가 반영되지 않는 경우

**증상**: 추천 검색어나 롱테일 키워드가 생성된 글에 나타나지 않음

**해결 방법**:
1. `ideaData.recommendedSearches` 또는 `ideaData.longTailKeywords` 배열 확인
2. `builder.setTrendContext()` 호출 여부 확인
3. 생성된 프롬프트의 `[Trend Data & Context]` 섹션 확인

---

## 📝 테스트 결과 기록

테스트를 수행한 후 아래 형식으로 결과를 기록하세요:

```
## 테스트 결과 (YYYY-MM-DD)

### 테스트 1: 동적 페르소나 테스트
- [ ] 친근한형: ✅/❌
- [ ] 전문가형: ✅/❌
- [ ] 바이럴형: ✅/❌

### 테스트 2: 스킬 주입 테스트
- [ ] 수치 증명: ✅/❌
- [ ] 질문 던지기: ✅/❌
- [ ] 클리프행어: ✅/❌

### 테스트 3: 트렌드 데이터 반영 테스트
- [ ] 추천 검색어: ✅/❌
- [ ] 롱테일 키워드: ✅/❌

### 테스트 4: 톤 오버라이드 테스트
- [ ] 전문가형 + 친근한 톤: ✅/❌

### 발견된 문제
- (문제 설명)

### 개선 사항
- (개선 제안)
```

---

## 🔗 관련 문서

- [AI 서비스 가이드](./AI_SERVICE_GUIDE.md)
- [서비스 아키텍처](../architecture/SERVICES_ARCHITECTURE.md)
- [개발 가이드](./DEVELOPMENT_GUIDE.md)

