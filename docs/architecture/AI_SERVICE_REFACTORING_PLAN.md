# AI Service 리팩토링 계획서

## 📋 문서 개요

**작성일**: 2025년 12월 2일
**대상 파일**: `js/services/aiService.js`
**현재 상태**: `generateDraftFromIdea` 함수가 1000줄 이상의 거대 함수
**리팩토링 목표**: 함수 분해, 코드 재사용성 향상, 유지보수성 개선

---

## 🔍 현재 문제점 분석

### 1. 함수 크기 및 복잡도

- `generateDraftFromIdea`: 약 1000줄 이상
- 단일 함수가 너무 많은 책임 담당
- 디버깅 및 테스트 어려움

### 2. 코드 중복

- JSON 파싱 로직 반복 (3곳 이상)
- API 호출 재시도 패턴 반복
- 에러 처리 패턴 불일치

### 3. 설정 관리

- 매직 넘버 하드코딩 (`MAX_CONCURRENT = 3`, `maxRetries = 3`)
- 설정 값 분산 배치
- 환경별 설정 관리 부재

### 4. 프롬프트 관리

- 200줄 이상의 템플릿 리터럴 인라인 작성
- 유지보수 및 재사용 어려움
- 동적 프롬프트 생성 로직 복잡

---

## 🎯 리팩토링 목표

### 단기 목표 (1-2주)

- 함수 크기 80% 이상 감소
- 코드 중복 70% 제거
- 단위 테스트 가능하도록 분리

### 장기 목표 (1개월)

- 모듈화된 아키텍처 구축
- 설정 기반 동적 구성
- 확장 가능한 플러그인 구조

---

## 📁 Phase 1: 기초 설정 (예상: 1-2일)

### 1.1 설정 파일 생성

**파일**: `js/services/config/aiServiceConfig.js`

```javascript
export const AI_SERVICE_CONFIG = {
  API_RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY: 1000,
    MAX_DELAY: 5000,
    BACKOFF_MULTIPLIER: 2,
  },
  IMAGE_GENERATION: {
    MAX_CONCURRENT: 3,
    TIMEOUT: 30000,
    UPLOAD_TIMEOUT: 60000,
  },
  PROMPT_LIMITS: {
    MAX_LENGTH: 30000,
    OPTIMIZE_THRESHOLD: 15000,
    COMPRESSION_RATIO: 0.5,
  },
  THUMBNAIL: {
    DEFAULT_TYPES: ['curiosity', 'informative', 'emotional'],
    ASPECT_RATIOS: ['1x1', '4x3', '16x9'],
    TEXT_POSITION: 'bottom',
  },
  AFFILIATE: {
    MAX_LINKS: 3,
    MIN_RELEVANCE_SCORE: 0.3,
  },
};
```

**작업 내용**:

- [ ] 모든 매직 넘버 상수화
- [ ] 환경별 설정 분리
- [ ] 설정 검증 로직 추가

### 1.2 공통 유틸리티 함수 추출

**파일**: `js/services/utils/aiServiceUtils.js`

```javascript
// API 호출 재시도 래퍼
export async function withRetry(operation, config = {}) {
  // 재시도 로직 구현
}

// JSON 응답 파싱 표준화
export function parseJsonArrayResponse(response, options = {}) {
  // JSON 파싱 로직 구현
}

// Result 타입 클래스
export class Result {
  static success(data) {
    return { success: true, data };
  }
  static failure(error) {
    return { success: false, error };
  }
}
```

**작업 내용**:

- [ ] `withRetry` 함수 구현
- [ ] `parseJsonArrayResponse` 함수 구현
- [ ] `Result` 타입 도입
- [ ] 표준 에러 처리 함수 추가

### 1.3 타입 정의

**파일**: `js/services/types/aiServiceTypes.js`

```javascript
/**
 * @typedef {Object} IdeaData
 * @property {string} title
 * @property {string} description
 * @property {string[]} tags
 * @property {string} persona
 * @property {string} tone
 */

/**
 * @typedef {Object} DraftResult
 * @property {boolean} success
 * @property {string} [draft]
 * @property {string} [error]
 * @property {string} [permalink]
 */
```

**작업 내용**:

- [ ] 주요 데이터 타입 정의
- [ ] JSDoc 타입 주석 추가
- [ ] 인터페이스 명세화

---

## 📁 Phase 2: 프롬프트 관리 시스템 (예상: 2-3일)

### 2.1 프롬프트 템플릿 분리

**파일**: `js/services/prompts/draftPromptTemplates.js`

```javascript
export const DRAFT_PROMPT_TEMPLATES = {
  systemPrompt: ({ persona, tone }) => `
    당신은 ${persona} 스타일의 전문 블로그 작성자입니다.
    ${tone} 톤으로 작성해주세요.
  `,

  dateInfo: ({ currentDate, currentYear }) => `
    [현재 시점 정보]
    - 오늘 날짜: ${currentDate}
    - 현재 연도: ${currentYear}년
  `,

  affiliateLinks: ({ links }) => `
    [제휴 마케팅 링크]:
    ${links.map((link) => `- ${link.productName}: ${link.url}`).join('\n')}
  `,
};
```

**작업 내용**:

- [ ] 템플릿을 작은 컴포넌트로 분리
- [ ] 동적 데이터 바인딩 함수 구현
- [ ] 템플릿 검증 로직 추가

### 2.2 프롬프트 빌더 클래스 개선

**파일**: `js/services/prompts/PromptBuilder.js`

```javascript
export class DraftPromptBuilder {
  constructor(persona, tone) {
    this.persona = persona;
    this.tone = tone;
    this.sections = [];
  }

  addSection(template, data) {
    this.sections.push({ template, data });
    return this;
  }

  build() {
    return this.sections.map((section) => section.template(section.data)).join('\n\n');
  }
}
```

**작업 내용**:

- [ ] 빌더 패턴 적용
- [ ] 체이닝 메서드 구현
- [ ] 템플릿 조합 로직 개선

### 2.3 프롬프트 최적화

**파일**: `js/services/prompts/promptOptimizer.js`

```javascript
export class PromptOptimizer {
  static optimize(prompt, maxLength = 30000) {
    if (prompt.length <= maxLength) return prompt;

    // 최적화 로직 구현
    return this.compressSections(prompt, maxLength);
  }

  static compressSections(prompt, maxLength) {
    // 압축 알고리즘 구현
  }
}
```

**작업 내용**:

- [ ] 프롬프트 길이 최적화 로직
- [ ] 압축 알고리즘 구현
- [ ] 품질 유지하면서 크기 감소

---

## 📁 Phase 3: 함수 분해 (예상: 3-4일)

### 3.1 메인 함수 분해 계획

**원본**: `generateDraftFromIdea(ideaData, options)`
**분해 후**:

```javascript
export async function generateDraftFromIdea(ideaData, options = {}) {
  try {
    // 1. 입력 검증 및 전처리
    const context = await prepareDraftContext(ideaData, options);

    // 2. 프롬프트 생성
    const prompt = await buildDraftPrompt(context);

    // 3. AI API 호출
    const rawDraft = await callDraftAPI(prompt, context);

    // 4. 응답 처리
    const processedDraft = await processDraftResponse(rawDraft, context);

    // 5. 추가 기능 적용
    const enhancedDraft = await enhanceDraftWithFeatures(processedDraft, context);

    return Result.success(enhancedDraft);
  } catch (error) {
    return Result.failure(error.message);
  }
}
```

### 3.2 세부 함수 분해

#### 3.2.1 컨텍스트 준비 함수

**함수**: `prepareDraftContext(ideaData, options)`
**책임**: 입력 데이터 검증 및 컨텍스트 구성

```javascript
async function prepareDraftContext(ideaData, options) {
  // 페르소나 감지
  // 제휴 링크 필터링
  // 채널 정보 조회
  // 설정 로드
  return context;
}
```

#### 3.2.2 프롬프트 빌드 함수

**함수**: `buildDraftPrompt(context)`
**책임**: 최종 프롬프트 조합

```javascript
async function buildDraftPrompt(context) {
  const builder = new DraftPromptBuilder(context.persona, context.tone);

  return builder
    .addSystemPrompt(context)
    .addDateInfo(context)
    .addContentInfo(context)
    .addAffiliateLinks(context)
    .build();
}
```

#### 3.2.3 API 호출 함수

**함수**: `callDraftAPI(prompt, context)`
**책임**: AI API 호출 및 재시도

```javascript
async function callDraftAPI(prompt, context) {
  const optimizedPrompt = PromptOptimizer.optimize(prompt);

  return await withRetry(() => callGeminiAPI(optimizedPrompt), AI_SERVICE_CONFIG.API_RETRY);
}
```

#### 3.2.4 응답 처리 함수

**함수**: `processDraftResponse(rawDraft, context)`
**책임**: AI 응답 정제 및 구조화

```javascript
async function processDraftResponse(rawDraft, context) {
  // 마크다운 정리
  // JSON-LD 추출
  // 썸네일 정보 추출
  // HTML 정제
  return processedDraft;
}
```

#### 3.2.5 기능 강화 함수

**함수**: `enhanceDraftWithFeatures(draft, context)`
**책임**: 추가 기능 적용 (썸네일, 퍼머링크, 제휴 링크)

```javascript
async function enhanceDraftWithFeatures(draft, context) {
  const enhanced = { ...draft };

  // 썸네일 생성
  if (context.generateThumbnail) {
    enhanced.thumbnailUrls = await generateDraftThumbnails(draft, context);
  }

  // 퍼머링크 생성
  enhanced.permalink = await generateDraftPermalink(draft.seoTitle, context);

  // 제휴 링크 자동 삽입
  if (context.affiliateLinks?.length > 0) {
    enhanced.draft = await processAffiliateLinks(draft.draft, context.affiliateLinks);
  }

  return enhanced;
}
```

### 3.3 썸네일 생성 모듈 분리

**파일**: `js/services/thumbnail/ThumbnailService.js`

```javascript
export class ThumbnailService {
  static async generateForDraft(draft, context) {
    // 썸네일 생성 로직
  }

  static async uploadThumbnails(images, context) {
    // 업로드 로직
  }
}
```

### 3.4 퍼머링크 생성 모듈

**파일**: `js/services/permalink/PermalinkService.js`

```javascript
export class PermalinkService {
  static async generate(title, context) {
    // 퍼머링크 생성 로직
  }
}
```

---

## 📁 Phase 4: 코드 정리 및 최적화 (예상: 2-3일)

### 4.1 중복 코드 제거

- [ ] JSON 파싱 로직 통합 (`parseJsonArrayResponse`)
- [ ] API 재시도 패턴 통합 (`withRetry`)
- [ ] 에러 처리 표준화 (`Result` 타입)

### 4.2 변수명 및 주석 개선

- [ ] 긴 변수명 축약
- [ ] 복잡한 로직에 주석 추가
- [ ] 함수/변수명 일관성 유지

### 4.3 메모리 및 성능 최적화

- [ ] 불필요한 객체 생성 제거
- [ ] 스트림 처리 적용 (큰 텍스트)
- [ ] 캐싱 적용 (반복 계산)

---

## 📁 Phase 5: 테스트 및 검증 (예상: 2-3일)

### 5.1 단위 테스트 작성

```javascript
// js/services/__tests__/aiService.test.js
describe('generateDraftFromIdea', () => {
  test('should generate draft successfully', async () => {
    // 테스트 케이스
  });

  test('should handle API errors gracefully', async () => {
    // 에러 처리 테스트
  });
});
```

### 5.2 통합 테스트

- [ ] 전체 플로우 테스트
- [ ] 설정 변경 영향 테스트
- [ ] 성능 테스트

### 5.3 문서화

- [ ] 각 함수 JSDoc 작성
- [ ] 사용 예시 추가
- [ ] API 변경 사항 문서화

---

## 📊 진행 상황 추적

### 완료된 작업

- [x] 현재 문제점 분석
- [x] 리팩토링 계획 수립
- [ ] Phase 1 시작

### 진행 중

- [ ] 설정 파일 생성
- [ ] 유틸리티 함수 추출

### 예정 작업

- [ ] 프롬프트 템플릿 분리
- [ ] 함수 분해 실행
- [ ] 테스트 작성

---

## 🔍 리스크 및 고려사항

### 기술적 리스크

1. **하위 호환성**: 기존 API 변경 시 영향도 평가 필요
2. **성능 저하**: 함수 분해로 인한 오버헤드 최소화
3. **메모리 사용**: 큰 객체 분리로 메모리 최적화

### 운영적 리스크

1. **테스트 커버리지**: 모든 분기 케이스 테스트 필요
2. **롤백 계획**: 문제가 발생 시 빠른 복구 방안
3. **문서화**: 변경 사항에 대한 충분한 문서

### 해결 방안

- 점진적 리팩토링 적용
- 각 단계별 테스트 수행
- 기능 플래그로 안전한 배포

---

## 🎯 성공 지표

### 정량적 지표

- 함수 크기: 1000줄 → 200줄 이하 (80% 감소)
- 코드 중복: 70% 제거
- 단위 테스트 커버리지: 80% 이상
- 빌드 시간: 변화 없음 (±5%)

### 정성적 지표

- 코드 가독성 향상
- 유지보수성 개선
- 새로운 기능 추가 용이성
- 팀 개발 생산성 향상

---

## 📞 연락 및 지원

**담당자**: 개발팀
**문서 버전**: v1.0
**최종 검토일**: 2025년 12월 2일

---

_이 문서는 지속적으로 업데이트됩니다._
