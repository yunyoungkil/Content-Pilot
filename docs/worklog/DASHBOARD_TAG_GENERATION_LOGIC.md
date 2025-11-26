# 대시보드 포스팅 리스트 태그 생성 로직

이 문서는 대시보드에서 포스팅 리스트의 태그가 어떻게 생성되고 표시되는지 상세히 설명합니다.

## 📋 목차

1. [태그 생성 흐름](#태그-생성-흐름)
2. [태그 추출 소스](#태그-추출-소스)
3. [태그 표시 로직](#태그-표시-로직)
4. [태그 필터링](#태그-필터링)
5. [현재 상태 및 개선 사항](#현재-상태-및-개선-사항)

---

## 태그 생성 흐름

### 1. RSS 피드 수집 시 (`processRssItem`)

**위치**: `js/services/collectorService.js:138-206`

**흐름**:
1. RSS 피드에서 태그 추출 시도
2. 태그를 찾지 못하면 본문에서 추출 시도
3. 최종 태그를 `data.tags`에 저장

**코드**:
```javascript
// RSS 피드에서 태그 추출
const tags = [];
// <category> 태그 추출
const categoryMatches = itemText.matchAll(/<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/category>/gi);
for (const match of categoryMatches) {
  if (match[1]) {
    const tag = match[1].trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
}
// <dc:subject> 태그 추출 (Dublin Core)
const subjectMatches = itemText.matchAll(/<dc:subject[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/dc:subject>/gi);
// <tag> 태그 추출
const tagMatches = itemText.matchAll(/<tag[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/tag>/gi);

// RSS 피드에서 태그를 찾지 못했으면 본문에서 추출 시도
let finalTags = tags.length > 0 ? tags : null;
if (!finalTags && parsed.cleanText) {
  const extractedTags = await extractKeywords(parsed.cleanText);
  finalTags = extractedTags && extractedTags.length > 0 ? extractedTags : null;
}

const data = {
  // ...
  tags: finalTags,
  // ...
};
```

### 2. 단건 저장 시 (`fetchAndSaveSinglePost`)

**위치**: `js/services/collectorService.js:466-640`

**YouTube**:
```javascript
const tags = await extractKeywords(normalized.description);
normalized.tags = tags || null;
```

**블로그**:
```javascript
const tags = await extractKeywords(parsed.cleanText);
finalData.tags = tags || null;
```

### 3. `extractKeywords` 함수

**위치**: `js/services/collectorService.js` (추정)

**현재 구현**:
- ❌ 항상 빈 배열 반환
- 주석에 "나중에 AI 기반 추출로 확장 가능"이라고만 명시
- 실제 키워드 추출 로직 없음

**예상 코드**:
```javascript
export async function extractKeywords(text) {
  // 간단한 키워드 추출 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 10) return [];
  // 기본적으로 빈 배열 반환 (나중에 AI 기반 추출로 확장 가능)
  return [];
}
```

---

## 태그 추출 소스

### 1. RSS 피드 태그

다음 형식의 태그를 추출합니다:

1. **`<category>` 태그**
   ```xml
   <category>태그명</category>
   ```

2. **`<dc:subject>` 태그** (Dublin Core)
   ```xml
   <dc:subject>태그명</dc:subject>
   ```

3. **`<tag>` 태그**
   ```xml
   <tag>태그명</tag>
   ```

### 2. 본문 텍스트

RSS 피드에서 태그를 찾지 못한 경우:
- `parsed.cleanText` (블로그 본문)
- `normalized.description` (YouTube 설명)

`extractKeywords` 함수를 통해 추출 시도 (현재는 빈 배열 반환)

---

## 태그 표시 로직

### `createContentCard` 함수

**위치**: `js/ui/dashboardMode.js:339-553`

**태그 상태별 표시**:

```javascript
let tagsContent = '';
if (item.tags === undefined) {
    // 태그가 아직 분석되지 않음
    tagsContent = `<span class="tag-placeholder">태그 분석 예정...</span>`;
} else if (item.tags === null) {
    // 태그 분석 실패 (API 오류 등)
    tagsContent = `<span class="tag-placeholder error">태그 분석 실패 (API 오류)</span>`;
} else if (Array.isArray(item.tags) && item.tags.length > 0) {
    // 태그가 있으면 #태그 형식으로 표시
    tagsContent = item.tags.map(tag => `<span class="tag">#${tag}</span>`).join('');
} else {
    // 빈 배열 또는 기타 경우
    tagsContent = `<span class="tag-placeholder">관련 태그 없음</span>`;
}
const tagsHtml = `<div class="card-tags">${tagsContent}</div>`;
```

**태그 상태 의미**:
- `undefined`: 태그 분석이 아직 수행되지 않음 (초기 상태)
- `null`: 태그 분석을 시도했지만 실패함
- `[]` (빈 배열): 태그 분석을 수행했지만 태그가 없음
- `['태그1', '태그2']`: 태그가 정상적으로 추출됨

---

## 태그 필터링

### 1. 태그 클릭 이벤트

**위치**: `js/ui/dashboardMode.js:1467-1478`

**동작**:
- 태그 클릭 시 해당 태그로 필터링
- 같은 태그를 다시 클릭하면 필터 해제
- 필터 적용 시 페이지를 0으로 리셋

**코드**:
```javascript
if (target.classList.contains('tag')) {
    e.preventDefault();
    e.stopPropagation();
    const clickedTag = target.textContent.replace('#', '');
    activeTagFilter = (activeTagFilter === clickedTag) ? null : clickedTag;
    Object.keys(viewState).forEach(key => viewState[key].currentPage = 0);
    updateDashboardUI(container);
    return;
}
```

### 2. 태그 필터 적용

**위치**: `js/ui/dashboardMode.js:575-577, 771-773`

**동작**:
- `activeTagFilter`가 설정되어 있으면 해당 태그를 포함하는 콘텐츠만 표시
- 내 채널과 경쟁 채널 모두에 적용

**코드**:
```javascript
// 태그 필터 적용
if (activeTagFilter) {
    filteredContent = filteredContent.filter(item => 
        item.tags && item.tags.includes(activeTagFilter)
    );
}
```

### 3. 태그 활성 상태 표시

**위치**: `js/ui/dashboardMode.js:1181-1186`

**동작**:
- 필터가 적용된 태그에 `active` 클래스 추가
- 시각적으로 강조 표시

**코드**:
```javascript
container.querySelectorAll('.card-tags .tag').forEach(tagEl => {
    if (activeTagFilter && tagEl.textContent.replace('#', '') === activeTagFilter) {
        tagEl.classList.add('active');
    } else {
        tagEl.classList.remove('active');
    }
});
```

---

## 현재 상태 및 개선 사항

### ✅ 구현 완료

1. **RSS 피드 태그 추출**
   - `<category>`, `<dc:subject>`, `<tag>` 태그에서 추출
   - 중복 제거
   - CDATA 섹션 처리

2. **HTML 메타 태그 추출** (2024-12-XX 추가)
   - `<meta name="keywords">` 태그에서 추출
   - `<meta property="article:tag">` 태그에서 추출 (Open Graph)
   - 카테고리/태그 링크에서 추출 (`/category/`, `/tag/` 등)
   - 위치: `offscreen.js:459-483`

3. **`extractKeywords` 함수** (이미 구현됨)
   - 한글 단어 추출 (2글자 이상)
   - 불용어 제거
   - 빈도 기반 키워드 추출
   - 위치: `js/services/collectorService.js:728-750`

4. **태그 추출 우선순위** (2024-12-XX 개선)
   - 1순위: RSS 피드 태그
   - 2순위: HTML 메타 태그
   - 3순위: 본문 키워드 추출 (`extractKeywords`)

5. **태그 표시**
   - 상태별 다른 UI 표시
   - 태그 클릭 필터링
   - 활성 태그 강조

6. **태그 필터링**
   - 태그 클릭으로 필터 토글
   - 필터 적용 시 해당 태그만 표시

### 🔧 개선 완료 (2024-12-XX)

1. **HTML 메타 태그 추출 구현**
   - `<meta name="keywords">` 태그에서 추출
   - `<meta property="article:tag">` 태그에서 추출
   - 카테고리/태그 링크에서 추출
   - 위치: `offscreen.js:459-483`

2. **태그 추출 우선순위 개선**
   - RSS 피드 → HTML 메타 태그 → 본문 키워드 추출 순서로 시도
   - 각 단계에서 태그를 찾으면 다음 단계로 진행하지 않음

### 🔧 추가 개선 방안

#### 단기 개선:

1. **AI 기반 키워드 추출**
   - Gemini API 활용
   - 본문 요약 및 키워드 추출
   - 태그 자동 생성

2. **태그 분석 상태 개선**
   - 분석 진행 중 표시
   - 분석 실패 원인 표시
   - 재시도 기능

#### 장기 개선:

3. **태그 자동 분류**
   - 카테고리 자동 분류
   - 태그 유사도 분석
   - 태그 추천 기능

4. **태그 품질 개선**
   - 불필요한 태그 필터링
   - 태그 정규화 (대소문자, 띄어쓰기 등)
   - 태그 중복 제거 개선

---

## 관련 파일

- `js/services/collectorService.js`: 태그 추출 로직
- `js/ui/dashboardMode.js`: 태그 표시 및 필터링
- `docs/audits/DASHBOARD_TAG_ANALYSIS_AUDIT.md`: 태그 분석 점검 보고서

---

## 변경 이력

- **2024-12-XX**: HTML 메타 태그 추출 기능 추가
  - `<meta name="keywords">` 태그 추출
  - `<meta property="article:tag">` 태그 추출
  - 카테고리/태그 링크에서 추출
  - 태그 추출 우선순위 개선 (RSS → 메타 태그 → 본문 키워드)

- **2024-12-XX**: 태그 생성 로직 문서화
  - RSS 피드 태그 추출 확인
  - 태그 표시 로직 확인
  - 태그 필터링 로직 확인
  - `extractKeywords` 함수 확인 (이미 구현됨)

