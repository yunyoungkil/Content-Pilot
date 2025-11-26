# JSON-LD 스키마 필드 가이드

이 문서는 Content Pilot에서 생성되는 JSON-LD 구조화된 데이터의 각 필드에 어떤 값이 들어가는지 설명합니다.

## 📋 목차

1. [JSON-LD 개요](#json-ld-개요)
2. [필수 필드 설명](#필수-필드-설명)
3. [추가 권장 필드](#추가-권장-필드)
4. [데이터 매핑 로직](#데이터-매핑-로직)
5. [예시](#예시)

---

## JSON-LD 개요

JSON-LD (JavaScript Object Notation for Linked Data)는 구조화된 데이터를 JSON 형식으로 표현하는 방법입니다. Google 검색 엔진이 콘텐츠를 더 잘 이해하고 상위 노출할 수 있도록 돕습니다.

### 기본 구조

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "...",
  "description": "...",
  "author": { ... },
  "datePublished": "YYYY-MM-DD",
  "image": "...",
  "url": "..."
}
```

---

## 필수 필드 설명

### 1. `@context`
- **값**: `"https://schema.org"`
- **설명**: Schema.org 표준을 사용한다는 의미
- **자동 설정**: 항상 고정값

### 2. `@type`
- **값**: `"BlogPosting"` (기본) / `"Review"` / `"FAQPage"` 등
- **설명**: 글의 유형
- **자동 판단**: AI가 글 내용을 분석하여 적절한 타입 선택
  - 기본: `BlogPosting`
  - 리뷰 글: `Review`
  - FAQ 포함: `FAQPage`

### 3. `headline`
- **값**: SEO 최적화된 실제 초안 제목
- **설명**: 검색 결과에 표시될 제목
- **데이터 소스**:
  1. AI가 생성한 SEO 최적화 제목 (우선)
  2. 없으면 `seoTitle` (h1에서 추출)
  3. 없으면 `ideaData.title`
- **예시**: `"갤럭시 S23 완벽 사용 가이드: 초보자도 쉽게 따라하는 10가지 팁"`

### 4. `description`
- **값**: 글의 핵심 내용 요약 (150-200자 내외)
- **설명**: 검색 결과에 표시될 설명
- **데이터 소스**:
  1. AI가 생성한 요약 (우선)
  2. 없으면 `ideaData.description`
  3. 200자 초과 시 자동으로 197자로 제한 후 "..." 추가
- **예시**: `"갤럭시 S23의 모든 기능을 완벽하게 활용하는 방법을 단계별로 설명합니다. 초보자도 쉽게 따라할 수 있는 실용적인 팁과 노하우를 공유합니다."`

### 5. `author`
- **값**: 작성자 정보 객체
- **설명**: 글의 작성자
- **데이터 소스**:
  1. 채널 정보가 있으면: 채널 URL의 호스트명 (예: `"blog.example.com"`)
  2. 없으면: `"Content Pilot"`
- **구조**:
  ```json
  {
    "@type": "Person",
    "name": "채널명 또는 Content Pilot"
  }
  ```
- **예시**:
  ```json
  {
    "@type": "Person",
    "name": "blog.example.com"
  }
  ```

### 6. `datePublished`
- **값**: 발행 날짜 (YYYY-MM-DD 형식)
- **설명**: 글의 발행 날짜
- **데이터 소스**:
  1. AI가 생성한 날짜 (우선)
  2. 없거나 형식이 잘못되면: 현재 날짜
- **예시**: `"2024-12-24"`

### 7. `image`
- **값**: 대표 이미지 URL
- **설명**: 글의 대표 이미지
- **데이터 소스**:
  1. AI가 생성한 이미지 URL (우선)
  2. 플레이스홀더(`https://example.com/image.jpg`)이면:
     - 채널 정보에 `thumbnail` 또는 `logo`가 있으면 사용
     - 없으면 필드 제거 (선택 필드)
- **예시**: `"https://blog.example.com/images/thumbnail.jpg"`

---

## 추가 권장 필드

### 8. `url` (선택)
- **값**: 발행될 예상 URL
- **설명**: 글의 실제 URL
- **데이터 소스**:
  - `ideaData.publishInfo.permalink`와 `channelInfo.inputUrl`을 조합
  - Tistory: `{origin}/{permalink}`
  - 기타: `{origin}/{permalink}`
- **예시**: `"https://blog.example.com/my-article-slug"`

### 9. `mainEntityOfPage` (선택)
- **값**: WebPage 객체
- **설명**: 이 글이 속한 웹페이지 정보
- **구조**:
  ```json
  {
    "@type": "WebPage",
    "@id": "발행될 예상 URL"
  }
  ```

### 10. `publisher` (선택)
- **값**: Organization 객체
- **설명**: 발행자 정보
- **구조**:
  ```json
  {
    "@type": "Organization",
    "name": "채널명",
    "logo": {
      "@type": "ImageObject",
      "url": "로고 URL"
    }
  }
  ```

---

## 데이터 매핑 로직

### 1. AI 생성 단계
- AI가 프롬프트를 받아 JSON-LD 스키마 생성
- 가능한 한 실제 데이터를 사용하도록 지시
- 플레이스홀더 사용 지양

### 2. 후처리 단계 (seoTitle 추출 후)
- `headline`: seoTitle 또는 title로 보완
- `description`: ideaData.description으로 보완 (200자 제한)
- `datePublished`: 현재 날짜로 보완 (형식 검증)
- `author`: 채널 정보로 보완
- `image`: 채널 정보로 보완 또는 제거
- `url`: permalink와 채널 URL 조합

### 3. 최종 검증
- 필수 필드 존재 확인
- 날짜 형식 검증 (YYYY-MM-DD)
- URL 형식 검증

---

## 예시

### 기본 예시

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "갤럭시 S23 완벽 사용 가이드: 초보자도 쉽게 따라하는 10가지 팁",
  "description": "갤럭시 S23의 모든 기능을 완벽하게 활용하는 방법을 단계별로 설명합니다. 초보자도 쉽게 따라할 수 있는 실용적인 팁과 노하우를 공유합니다.",
  "author": {
    "@type": "Person",
    "name": "blog.example.com"
  },
  "datePublished": "2024-12-24",
  "image": "https://blog.example.com/images/thumbnail.jpg",
  "url": "https://blog.example.com/galaxy-s23-complete-guide"
}
```

### 리뷰 글 예시

```json
{
  "@context": "https://schema.org",
  "@type": "Review",
  "itemReviewed": {
    "@type": "Product",
    "name": "갤럭시 S23"
  },
  "headline": "갤럭시 S23 실사용 후기: 3개월 사용 후 솔직한 평가",
  "description": "갤럭시 S23을 3개월간 실제로 사용한 후기입니다. 장단점을 솔직하게 공유합니다.",
  "author": {
    "@type": "Person",
    "name": "blog.example.com"
  },
  "datePublished": "2024-12-24",
  "reviewRating": {
    "@type": "Rating",
    "ratingValue": "4.5",
    "bestRating": "5"
  }
}
```

### FAQ 포함 예시

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "갤럭시 S23 자주 묻는 질문 FAQ",
  "description": "갤럭시 S23에 대한 자주 묻는 질문과 답변을 정리했습니다.",
  "author": {
    "@type": "Person",
    "name": "blog.example.com"
  },
  "datePublished": "2024-12-24",
  "mainEntity": {
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "갤럭시 S23 배터리 수명은 어느 정도인가요?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "일반적인 사용 기준으로 하루 종일 사용 가능합니다."
        }
      }
    ]
  }
}
```

---

## 데이터 흐름

```
1. AI 초안 생성 요청
   ↓
2. 채널 정보 조회 (activeChannelId 기반)
   ↓
3. AI 프롬프트 생성 (채널 정보 포함)
   ↓
4. AI가 JSON-LD 스키마 생성
   ↓
5. JSON-LD 추출 및 파싱
   ↓
6. seoTitle 추출 (h1에서)
   ↓
7. JSON-LD 후처리 (실제 데이터로 보완)
   - headline: seoTitle 사용
   - description: ideaData.description 사용
   - datePublished: 현재 날짜 사용
   - author: 채널 정보 사용
   - image: 채널 정보 사용 또는 제거
   - url: permalink와 채널 URL 조합
   ↓
8. 최종 JSON-LD 스키마 반환
```

---

## 주의사항

### 1. 필수 필드
- `@context`, `@type`, `headline`, `description`, `author`, `datePublished`는 필수
- `image`는 선택 필드이지만 있으면 SEO에 도움

### 2. 날짜 형식
- 반드시 `YYYY-MM-DD` 형식 (예: `2024-12-24`)
- 다른 형식은 자동으로 현재 날짜로 교체

### 3. URL 형식
- 절대 URL 사용 (상대 URL 불가)
- `http://` 또는 `https://` 포함

### 4. 이미지 URL
- 플레이스홀더(`https://example.com/image.jpg`)는 자동으로 제거되거나 채널 정보로 교체
- 실제 사용 가능한 이미지 URL만 사용

### 5. author 이름
- 채널 정보가 있으면 채널 URL의 호스트명 사용
- 없으면 "Content Pilot" 사용

---

## 검증 방법

### Google 리치 결과 테스트 도구
1. 생성된 JSON-LD를 복사
2. [Google 리치 결과 테스트 도구](https://search.google.com/test/rich-results)에 붙여넣기
3. "BlogPosting" 또는 해당 타입으로 올바르게 인식되는지 확인

### 필수 필드 확인
- `@context`: "https://schema.org"
- `@type`: "BlogPosting" 등
- `headline`: 비어있지 않음
- `description`: 비어있지 않음
- `author.name`: 비어있지 않음
- `datePublished`: YYYY-MM-DD 형식

---

## 🔗 관련 문서

- [작업 세션 로그](./WORK_SESSION_LOG.md#2024-12-xx-seo-json-ld-구조화된-데이터-자동-생성-기능-추가)
- [프로그램 로직 문서](./PROGRAM_LOGIC.md#ai-서비스)
- [Schema.org BlogPosting 문서](https://schema.org/BlogPosting)

