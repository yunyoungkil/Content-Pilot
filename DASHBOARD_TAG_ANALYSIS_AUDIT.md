# 대시보드 리스트 태그 분석 로직 점검 보고서

## 📋 점검 개요

대시보드에서 콘텐츠 카드의 태그를 어떻게 분석하고 표시하는지 확인하고, 발견된 문제점과 개선 사항을 정리했습니다.

## 🔍 현재 태그 분석 흐름

### 1. 태그 생성 단계

#### 1.1 RSS 피드 수집 시 (`processRssItem`)
**위치**: `js/services/collectorService.js:69`

**현재 구현**:
- ❌ 태그 추출 없음
- RSS 피드에서 `<category>`, `<tag>` 등의 태그 정보를 파싱하지 않음
- `data` 객체에 `tags` 필드가 포함되지 않음

**코드**:
```javascript
const data = {
  title, fullLink, pubDate: timestamp,
  description: parsed.description,
  thumbnail: parsed.thumbnail,
  cleanText: parsed.cleanText,
  sourceId, channelType,
  fetchedAt: Date.now(),
  ...parsed.metrics
  // tags 필드 없음!
};
```

#### 1.2 단건 저장 시 (`fetchAndSaveSinglePost`)
**위치**: `js/services/collectorService.js:362`

**현재 구현**:
- ✅ `extractKeywords()` 함수 호출
- ❌ 하지만 `extractKeywords()`가 빈 배열 반환
- YouTube: `normalized.description`에서 추출 시도
- 블로그: `parsed.cleanText`에서 추출 시도

**코드**:
```javascript
// YouTube
const tags = await extractKeywords(normalized.description);
normalized.tags = tags || null;

// 블로그
const tags = await extractKeywords(parsed.cleanText);
finalData.tags = tags || null;
```

#### 1.3 `extractKeywords` 함수
**위치**: `js/services/collectorService.js:531`

**현재 구현**:
- ❌ 항상 빈 배열 반환
- 주석에 "나중에 AI 기반 추출로 확장 가능"이라고만 명시

**코드**:
```javascript
export async function extractKeywords(text) { 
  // 간단한 키워드 추출 (필요시 AI Service의 callGeminiAPI 사용)
  if (!text || text.length < 10) return [];
  // 기본적으로 빈 배열 반환 (나중에 AI 기반 추출로 확장 가능)
  return []; 
}
```

### 2. 태그 표시 단계

#### 2.1 대시보드 카드 렌더링 (`createContentCard`)
**위치**: `js/ui/dashboardMode.js:404`

**현재 구현**:
- ✅ `item.tags` 상태에 따라 다른 UI 표시
- `undefined`: "태그 분석 예정..."
- `null`: "태그 분석 실패 (API 오류)"
- 빈 배열: "관련 태그 없음"
- 태그 있음: `#태그` 형식으로 표시

**코드**:
```javascript
let tagsContent = '';
if (item.tags === undefined) {
    tagsContent = `<span class="tag-placeholder">태그 분석 예정...</span>`;
} else if (item.tags === null) {
    tagsContent = `<span class="tag-placeholder error">태그 분석 실패 (API 오류)</span>`;
} else if (Array.isArray(item.tags) && item.tags.length > 0) {
    tagsContent = item.tags.map(tag => `<span class="tag">#${tag}</span>`).join('');
} else {
    tagsContent = `<span class="tag-placeholder">관련 태그 없음</span>`;
}
```

### 3. 태그 필터링 단계

#### 3.1 태그 클릭 이벤트
**위치**: `js/ui/dashboardMode.js:1283`

**현재 구현**:
- ✅ 태그 클릭 시 필터 토글
- ✅ `activeTagFilter` 전역 변수로 상태 관리
- ✅ 필터 적용 시 해당 태그가 있는 콘텐츠만 표시

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

#### 3.2 태그 필터 적용
**위치**: `js/ui/dashboardMode.js:525, 665`

**현재 구현**:
- ✅ `activeTagFilter`가 있으면 해당 태그를 포함하는 콘텐츠만 필터링
- ✅ 내 채널과 경쟁 채널 모두에 적용

**코드**:
```javascript
// 태그 필터 적용
if (activeTagFilter) {
    filteredContent = filteredContent.filter(item => item.tags && item.tags.includes(activeTagFilter));
}
```

## 🐛 발견된 문제점

### 문제 1: 태그 추출이 작동하지 않음
**심각도**: 높음
**영향**: 모든 콘텐츠에 태그가 없어 "관련 태그 없음" 또는 "태그 분석 예정..." 표시

**원인**:
1. `extractKeywords()` 함수가 항상 빈 배열 반환
2. RSS 피드 수집 시 태그 파싱 없음
3. HTML에서 메타 태그나 카테고리 정보 추출 없음

### 문제 2: RSS 피드 태그 정보 미활용
**심각도**: 중간
**영향**: RSS 피드에 태그 정보가 있어도 사용하지 않음

**RSS 피드 태그 형식**:
- `<category>태그명</category>`
- `<dc:subject>태그명</dc:subject>`
- `<tag>태그명</tag>`

### 문제 3: 태그 분석 상태 표시 불일치
**심각도**: 낮음
**영향**: 사용자가 태그 분석 상태를 정확히 파악하기 어려움

**현재 상태**:
- `undefined`: "태그 분석 예정..." (실제로는 분석 안 함)
- `null`: "태그 분석 실패" (실제로는 분석 시도 안 함)

## 🔧 개선 방안

### 개선 1: RSS 피드에서 태그 추출
`processRssItem` 함수에서 RSS 피드의 `<category>`, `<dc:subject>`, `<tag>` 태그를 파싱하여 추출

### 개선 2: `extractKeywords` 함수 구현
실제로 키워드를 추출하는 로직 구현:
- 옵션 1: 간단한 키워드 추출 (명사 추출, 빈도 기반)
- 옵션 2: AI 기반 키워드 추출 (Gemini API 활용)
- 옵션 3: 하이브리드 (간단한 추출 + AI 보완)

### 개선 3: HTML 메타 태그에서 태그 추출
`parseBlogPage` 함수에서 HTML의 메타 태그나 카테고리 정보 추출:
- `<meta name="keywords" content="...">`
- 카테고리 링크 (`<a href="/category/...">`)
- 태그 링크 (`<a href="/tag/...">`)

### 개선 4: 태그 분석 상태 명확화
- `undefined`: "태그 분석 안 됨" (분석 시도 안 함)
- `null`: "태그 분석 실패" (분석 시도했지만 실패)
- 빈 배열: "관련 태그 없음" (분석했지만 태그 없음)

## 📝 권장 수정 사항

### 즉시 수정 필요:
1. RSS 피드에서 태그 추출 추가
2. `extractKeywords` 함수 기본 구현 (간단한 키워드 추출)

### 단기 개선:
3. HTML 메타 태그에서 태그 추출
4. 태그 분석 상태 메시지 개선

### 장기 개선:
5. AI 기반 키워드 추출 (Gemini API)
6. 태그 자동 분류 및 카테고리화

