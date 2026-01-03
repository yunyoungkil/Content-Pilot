# AI 초안 작성 데이터 흐름 및 로그 가이드

## 📊 전체 데이터 흐름

```
사용자 입력 (아이디어 데이터)
    ↓
[1단계] 데이터 수집 및 전처리
    ↓
[2단계] 프롬프트 구성
    ↓
[3단계] Gemini API 호출
    ↓
[4단계] 응답 처리 및 정제
    ↓
[5단계] HTML 변환 및 저장
    ↓
최종 초안 반환
```

---

## 🔍 [1단계] 데이터 수집 및 전처리

### 연결 자료 처리 흐름도

```
원본 스크랩 데이터 (linkedScrapsContent)
    ↓
[1-1] 텍스트 압축 (compressText)
    ↓
[1-2] 이미지 분석 (Vision AI)
    ↓
[1-3] 외부 사이트 필터링 (노써치, 다나와)
    ↓
[1-4] 스마트 텍스트 압축 (3500자 초과 시)
    ↓
[1-5] 제품 리뷰 통계 추출
    ↓
[1-6] 키워드 기반 검색 (searchRelevantContent)
    ↓
[1-7] 목차별 구조화 (structureByOutline)
    ↓
최종 구조화된 참고 자료
```

### 입력 데이터 구조 (`ideaData`)
```javascript
{
  id: "idea_12345",
  title: "스마트홈 구축 가이드",
  description: "초보자를 위한 스마트홈 설치 방법",
  
  // 브리핑 데이터
  outline: [
    "스마트홈이란?",
    "필수 디바이스 추천",
    "설치 방법",
    "활용 팁"
  ],
  keywords: ["스마트홈", "IoT", "자동화"],
  longTailKeywords: ["스마트홈 시작하기", "스마트홈 설치 비용"],
  recommendedSearches: [
    "스마트홈 시장 규모 2026",
    "스마트홈 디바이스 순위"
  ],
  tags: ["#스마트홈", "#IoT"],
  
  // 연결된 참고 자료
  linkedScrapsContent: [
    {
      title: "스마트홈 트렌드 분석",
      url: "https://example.com/article1",
      text: "2026년 스마트홈 시장은 50조원 규모...",
      image: "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ],
  
  // 제휴 링크
  affiliateLinks: [
    {
      url: "https://link.coupang.com/...",
      product_name: "삼성 스마트싱스 허브",
      cta: "최저가 확인하기"
    }
  ],
  
  // 기타
  channelId: "channel_abc",
  currentDraft: "", // 기존 초안 (수정 시)
  tone: "friendly" // 작성 톤
}
```

### [1-1] 연결 자료 텍스트 압축 (compressText)

**함수 위치**: `aiService.js` 라인 2387

```javascript
const compressText = (text) => {
  if (!text) return '';
  return text
    .replace(/\n\s*\n/g, '\n')              // 여러 줄 공백을 한 줄로
    .replace(/[ \t]+/g, ' ')                // 연속 공백을 하나로
    .replace(/URL 복사 이웃추가.../g, '')  // 네이버 블로그 노이즈 제거
    .trim();
};
```

**콘솔 로그**:
```javascript
// 자동 로그 없음 (내부 처리)
```

---

### [1-2] 이미지 분석 (Vision AI)

**처리 로직**: `aiService.js` 라인 2403-2415

```javascript
await Promise.all(
  linkedScrapsContent.map(async (scrap, index) => {
    let imageAnalysis = '';
    if (scrap.image) {
      Logger.info(`[generateDraft] 스크랩 #${index + 1} 이미지 분석 시작...`);
      const analysisResult = await analyzeScrapImage(scrap.image);
      if (analysisResult) {
        imageAnalysis = `[이미지 분석 (Vision AI)]:\n${analysisResult}\n\n`;
      }
    }
    // ... 텍스트와 결합
  })
);
```

**콘솔 로그**:
```
[generateDraft] 스크랩 #1 이미지 분석 시작...
[generateDraft] 스크랩 #2 이미지 분석 시작...
```

---

### [1-3] 외부 사이트 필터링

**처리 로직**: `aiService.js` 라인 2420-2450

```javascript
if (content.includes('노써치') || content.includes('nosearch') || content.includes('다나와')) {
  console.log('[aiService] 외부 비교 사이트 컨텐츠 감지, 필터링 수행');
  
  // 1. 비교표 섹션 제거
  content = content.replace(/추천\s*&\s*리뷰\s*[:：]\s*인기\s*TOP\s*\d+[^\n]*[\s\S]*?/gi, '');
  
  // 2. 파워링크 광고 섹션 제거
  content = content.replace(/파워링크[\s\S]*?/gi, '');
  
  // 3. 베스트픽/가성비픽 섹션 제거
  content = content.replace(/베스트픽[\s\S]*?/gi, '');
  
  console.log('[aiService] 외부 비교 사이트 필터링 완료');
}
```

**콘솔 로그**:
```
[aiService] 외부 비교 사이트 컨텐츠 감지, 필터링 수행
[aiService] 외부 비교 사이트 필터링 완료
```

---

### [1-4] 스마트 텍스트 압축 (3500자 초과)

**처리 로직**: `aiService.js` 라인 2455-2500

```javascript
if (content.length > 3500) {
  // 제품 관련 키워드 찾기
  const productKeywords = ['리뷰', '평점', '만족도', '사용자', '후기', ...];
  const keywordPositions = [];
  
  // 키워드 위치 수집
  productKeywords.forEach((keyword) => {
    let pos = content.indexOf(keyword);
    while (pos !== -1) {
      keywordPositions.push(pos);
      pos = content.indexOf(keyword, pos + 1);
    }
  });
  
  // 키워드 주변 컨텍스트 추출 (각 키워드 전후 300자)
  const chunks = [];
  keywordPositions.forEach((pos) => {
    const start = Math.max(0, pos - 300);
    const end = Math.min(content.length, pos + 300);
    chunks.push(content.substring(start, end));
  });
  
  // 최종: 앞부분 1000자 + 키워드 주변 + 뒷부분 500자
  content = content.substring(0, 1000) + '\n\n' + chunks.join('\n...\n') + 
            '\n\n' + content.substring(content.length - 500);
}
```

**결과 예시**:
```
원본: 12,456자
압축 후: 3,200자 (중요 키워드 주변만 추출)
```

---

### [1-5] 제품 리뷰 통계 추출

**처리 로직**: `aiService.js` 라인 2560-2635

```javascript
const productReviewStats = [];

processedScraps.forEach((scrap) => {
  const text = scrap.text || '';
  
  // 정규식 패턴 매칭
  const productNameMatch = text.match(/^([^\n]+)\n리뷰\s*(\d{1,3}(?:,\d{3})*)/m);
  const satisfactionMatch = text.match(/최고\s*평점\s*(\d+)%/);
  const robustnessMatch = text.match(/견고함\s*만족도\s*(\d+)%/);
  const designMatch = text.match(/디자인\s*만족도\s*(\d+)%/);
  
  if (reviewCountMatch && satisfactionMatch && productName) {
    const stats = {
      productName: productName,
      reviewCount: parseInt(reviewCountMatch[1]),
      satisfaction: parseInt(satisfactionMatch[1]),
      robustness: robustnessMatch ? parseInt(robustnessMatch[1]) : null,
      design: designMatch ? parseInt(designMatch[1]) : null,
    };
    
    productReviewStats.push(stats);
    Logger.info('[generateDraft] 리뷰 통계 추출:', stats);
  }
});

// 구조화된 제품 정보 생성
if (productReviewStats.length > 0) {
  structuredProductInfo = `
📊 **[중요] 참고 자료의 주요 제품 정보**

제품 1: 누아트 케이스
  - 리뷰 개수: 1,656개
  - 최고 평점: 75%
  - 견고함 만족도: 80%
  
⚠️ 초안 작성 시 위 제품들의 리뷰 통계를 본문 전체에 걸쳐 반복적으로 언급하세요.
`;
}
```

**콘솔 로그**:
```
[generateDraft] 리뷰 통계 추출: {
  productName: "누아트 케이스",
  reviewCount: 1656,
  satisfaction: 75,
  robustness: 80,
  design: null
}
```

---

### [1-6] 키워드 기반 검색 (searchRelevantContent)

**함수 위치**: `aiService.js` 라인 1918-1990

#### 처리 흐름

```
1. 모든 키워드 수집 (keywords + longTail + searchQueries)
   ↓
2. 키워드를 단어로 분리 (splitKeywordIntoWords)
   예: "스마트홈 시작하기" → ["스마트홈", "시작하기"]
   ↓
3. 각 단어로 연결 자료 검색 (findContextAroundKeyword)
   키워드 전후 150자 추출
   ↓
4. 매칭 결과 반환 (최대 3개씩)
```

#### 핵심 코드

```javascript
function searchRelevantContent(scrapsContent, searchTerms) {
  const allTerms = [
    ...(searchTerms.keywords || []),
    ...(searchTerms.longTail || []),
    ...(searchTerms.searchQueries || []),
  ].filter((t) => t && t.trim());
  
  console.log('🔍 [searchRelevantContent] 원본 키워드:', allTerms);
  
  // 키워드를 단어로 분리
  const expandedTerms = [];
  const termOrigins = new Map();
  
  allTerms.forEach((term) => {
    const words = splitKeywordIntoWords(term);
    console.log(`📝 "${term}" → [${words.join(', ')}]`);
    
    words.forEach((word) => {
      if (!expandedTerms.includes(word)) {
        expandedTerms.push(word);
        termOrigins.set(word, term);
      }
    });
  });
  
  console.log('🔍 [searchRelevantContent] 확장된 검색어:', expandedTerms);
  
  const relevantSections = [];
  const fullText = scrapsContent.map((s) => s.text || '').join('\n\n');
  
  console.log('📄 [searchRelevantContent] 연결 자료 텍스트 길이:', fullText.length);
  console.log('📄 [searchRelevantContent] 연결 자료 샘플:', fullText.substring(0, 500));
  
  // 각 단어로 검색
  expandedTerms.forEach((word, index) => {
    const matches = findContextAroundKeyword(fullText, word, 150);
    if (matches.length > 0) {
      const originKeyword = termOrigins.get(word);
      relevantSections.push({
        keyword: originKeyword,      // 원본 키워드
        searchWord: word,             // 실제 검색된 단어
        content: matches.slice(0, 3), // 최대 3개
      });
      console.log(`✅ [${index + 1}/${expandedTerms.length}] "${word}" → 매칭 ${matches.length}개`);
    } else {
      console.warn(`❌ [${index + 1}/${expandedTerms.length}] "${word}" → 매칭 없음`);
    }
  });
  
  Logger.info(
    `[searchRelevantContent] 키워드 ${allTerms.length}개 → ` +
    `검색어 ${expandedTerms.length}개로 확장하여 ${relevantSections.length}개 섹션 추출`
  );
  
  return relevantSections;
}
```

**헬퍼 함수 1: splitKeywordIntoWords**

```javascript
// 라인 1905-1915
function splitKeywordIntoWords(keyword) {
  // 특수문자 제거하고 공백으로 분리
  const cleaned = keyword.replace(/[^\w\sㄱ-ㅎ가-힣0-9]/g, ' ');
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2); // 2글자 이상만
  return words;
}
```

**헬퍼 함수 2: findContextAroundKeyword**

```javascript
// 라인 1878-1900
function findContextAroundKeyword(text, keyword, contextChars = 100) {
  const results = [];
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  
  let index = 0;
  while ((index = lowerText.indexOf(lowerKeyword, index)) !== -1) {
    const start = Math.max(0, index - contextChars);
    const end = Math.min(text.length, index + keyword.length + contextChars);
    const snippet = text.substring(start, end).trim();
    
    // 중복 제거
    if (!results.some((r) => r.includes(snippet) || snippet.includes(r))) {
      results.push(snippet);
    }
    
    index += keyword.length;
  }
  
  return results;
}
```

**콘솔 로그 실제 예시**:

```
🔍 [searchRelevantContent] 원본 키워드: [
  "스마트홈",
  "IoT",
  "자동화",
  "스마트홈 시작하기",
  "스마트홈 설치 비용"
]

📝 "스마트홈" → [스마트홈]
📝 "IoT" → [IoT]
📝 "자동화" → [자동화]
📝 "스마트홈 시작하기" → [스마트홈, 시작하기]
📝 "스마트홈 설치 비용" → [스마트홈, 설치, 비용]

🔍 [searchRelevantContent] 확장된 검색어 (중복 제거): [
  "스마트홈",
  "IoT",
  "자동화",
  "시작하기",
  "설치",
  "비용"
]

📄 [searchRelevantContent] 연결 자료 텍스트 길이: 12456
📄 [searchRelevantContent] 연결 자료 샘플 (첫 500자): 
스마트홈이란 IoT 기술을 활용하여 집안의 모든 기기를 연결하고 자동화하는...

✅ [1/6] "스마트홈" → 매칭 8개
✅ [2/6] "IoT" → 매칭 5개
✅ [3/6] "자동화" → 매칭 3개
✅ [4/6] "시작하기" → 매칭 2개
✅ [5/6] "설치" → 매칭 4개
❌ [6/6] "비용" → 매칭 없음

[searchRelevantContent] 키워드 5개 → 검색어 6개로 확장하여 5개 섹션 추출
```

---

### [1-7] 목차별 구조화 (structureByOutline)

**함수 위치**: `aiService.js` 라인 2010-2050

#### 처리 흐름

```
1. 각 목차 항목에서 키워드 추출 (extractKeywordsFromSection)
   예: "1. 스마트홈이란?" → ["스마트홈이란"]
   ↓
2. 매칭된 섹션 중 관련 있는 것만 필터링
   목차 키워드 ⊃ 검색 키워드 or 검색 키워드 ⊃ 목차 키워드
   ↓
3. 섹션별로 그룹화
   { 섹션1: {...}, 섹션2: {...}, ... }
```

#### 핵심 코드

```javascript
function structureByOutline(relevantSections, outline) {
  Logger.info('[structureByOutline] 목차:', outline);
  Logger.info('[structureByOutline] 매칭할 섹션 수:', relevantSections.length);
  
  const structured = {};
  
  outline.forEach((section, index) => {
    const sectionNumber = index + 1;
    const sectionKeywords = extractKeywordsFromSection(section);
    
    Logger.debug(
      `[structureByOutline] 섹션${sectionNumber} "${section}" 키워드:`,
      sectionKeywords
    );
    
    // 이 섹션과 관련된 내용 필터링
    const relatedContent = relevantSections.filter((item) =>
      sectionKeywords.some(
        (kw) =>
          item.keyword.toLowerCase().includes(kw.toLowerCase()) ||
          kw.toLowerCase().includes(item.keyword.toLowerCase())
      )
    );
    
    Logger.debug(
      `[structureByOutline] 섹션${sectionNumber} 매칭된 내용:`,
      relatedContent.length
    );
    
    if (relatedContent.length > 0) {
      structured[`섹션${sectionNumber}`] = {
        title: section,
        keywords: sectionKeywords,
        relatedContent: relatedContent,
      };
    }
  });
  
  Logger.info(
    `[structureByOutline] ${outline.length}개 목차 중 ` +
    `${Object.keys(structured).length}개 섹션에 내용 매칭`
  );
  
  return structured;
}

function extractKeywordsFromSection(sectionTitle) {
  // 숫자, 특수문자 제거하고 의미 있는 단어만 추출
  const cleaned = sectionTitle.replace(/^\d+\.\s*/, '').replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  return words;
}
```

**콘솔 로그 실제 예시**:

```
[structureByOutline] 목차: [
  "스마트홈이란?",
  "필수 디바이스 추천",
  "설치 방법",
  "활용 팁"
]
[structureByOutline] 매칭할 섹션 수: 5

[structureByOutline] 섹션1 "스마트홈이란?" 키워드: ["스마트홈이란"]
[structureByOutline] 섹션1 매칭된 내용: 3
[structureByOutline] 섹션2 "필수 디바이스 추천" 키워드: ["필수", "디바이스", "추천"]
[structureByOutline] 섹션2 매칭된 내용: 0
[structureByOutline] 섹션3 "설치 방법" 키워드: ["설치", "방법"]
[structureByOutline] 섹션3 매칭된 내용: 2
[structureByOutline] 섹션4 "활용 팁" 키워드: ["활용", "팁"]
[structureByOutline] 섹션4 매칭된 내용: 0

[structureByOutline] 4개 목차 중 2개 섹션에 내용 매칭
```

---

### 최종 구조화 결과

**메인 로직**: `aiService.js` 라인 2640-2730

```javascript
// [RAG] 시스템 로그
Logger.info('[RAG] 연결 자료 개수:', linkedScrapsContent.length);

const searchTerms = {
  keywords: keywordsArray,
  longTail: ideaData.longTailKeywords || [],
  searchQueries: ideaData.searchQueries || [],
  outline: ideaData.outline || [],
};

Logger.info('[RAG] 브리핑 메타데이터:', {
  keywords: searchTerms.keywords.length,
  keywordsSample: searchTerms.keywords.slice(0, 3),
  longTail: searchTerms.longTail.length,
  searchQueries: searchTerms.searchQueries.length,
  outline: searchTerms.outline.length,
});

Logger.info('[RAG] 조건 통과 - 키워드 기반 검색 시작');

// 1. 키워드 기반 검색
const relevantSections = searchRelevantContent(linkedScrapsContent, searchTerms);

// 2. 목차별 구조화
const structured = structureByOutline(relevantSections, searchTerms.outline);

// 3. 프롬프트 텍스트 생성
if (Object.keys(structured).length > 0) {
  structuredByOutlineText = '\n\n📚 **섹션별 참고 자료**\n\n';
  
  Object.entries(structured).forEach(([sectionKey, data]) => {
    structuredByOutlineText += `### ${sectionKey}: ${data.title}\n`;
    structuredByOutlineText += `관련 키워드: ${data.keywords.join(', ')}\n\n`;
    structuredByOutlineText += `참고할 내용:\n`;
    
    data.relatedContent.forEach((item) => {
      structuredByOutlineText += `▪ [${item.keyword}]\n`;
      item.content.forEach((snippet) => {
        structuredByOutlineText += `  "${snippet.substring(0, 200)}..."\n`;
      });
      structuredByOutlineText += '\n';
    });
    
    structuredByOutlineText += '\n';
  });
  
  Logger.info('[RAG] 목차별 구조화 완료:', Object.keys(structured).length + '개 섹션');
}
```

**콘솔 로그 전체 흐름**:

```
[RAG] 연결 자료 개수: 3

[RAG] 브리핑 메타데이터: {
  keywords: 3,
  keywordsSample: ["스마트홈", "IoT", "자동화"],
  longTail: 2,
  searchQueries: 2,
  outline: 4
}

[RAG] 조건 통과 - 키워드 기반 검색 시작

🔍 [searchRelevantContent] 원본 키워드: [...]
📝 "스마트홈" → [스마트홈]
...
✅ [1/6] "스마트홈" → 매칭 8개
...
[searchRelevantContent] 키워드 5개 → 검색어 6개로 확장하여 5개 섹션 추출

[structureByOutline] 목차: [...]
[structureByOutline] 섹션1 "스마트홈이란?" 키워드: ["스마트홈이란"]
[structureByOutline] 섹션1 매칭된 내용: 3
...
[structureByOutline] 4개 목차 중 2개 섹션에 내용 매칭

[RAG] 목차별 구조화 완료: 2개 섹션
```

**최종 프롬프트에 추가되는 형식**:

```markdown
📚 **섹션별 참고 자료 (각 섹션 작성 시 반드시 활용하세요)**

### 섹션1: 스마트홈이란?
관련 키워드: 스마트홈이란

참고할 내용:
▪ [스마트홈]
  "스마트홈(Smart Home)은 IoT 기술을 활용하여 집안의 모든 기기를 연결하고 자동화하는 시스템입니다. 2026년 글로벌 시장 규모는 50조원에 달할 것으로 전망됩니다..."

▪ [IoT]
  "IoT(사물인터넷) 기술의 발전으로 가전제품 간 연결이 표준화되었으며, 스마트폰 하나로 모든 기기를 제어할 수 있게 되었습니다..."

### 섹션3: 설치 방법
관련 키워드: 설치, 방법

참고할 내용:
▪ [스마트홈 설치]
  "초보자도 쉽게 설치할 수 있습니다. 먼저 허브 장치를 설치하고, 각 기기를 페어링하면 됩니다. 설치 시간은 평균 30분 정도 소요됩니다..."
```

---

### 입력 데이터 구조 (`ideaData`)
```javascript
// [라인 2345] 현재 날짜/시즌 감지
Logger.biz(
  `🎭 [Persona Build]`,
  `Type: friendly, Custom Tone: friendly, Date: 2026-01-03 (겨울)`
);

// 출력:
// 🎭 [Persona Build] Type: friendly, Custom Tone: friendly, Date: 2026-01-03 (겨울)
```

```javascript
// [라인 2380] 연결 자료 디버깅
Logger.debug(`[External Link Debug] 전달받은 연결 자료 개수: 3`);
scraps.forEach((s, i) => {
  Logger.debug(`[External Link Debug] 자료 #${i + 1}:`, {
    title: s.title,
    url_exists: !!s.url,
    url: s.url ? s.url.substring(0, 30) + '...' : '(URL 없음)',
    text_len: s.text ? s.text.length : 0,
  });
});

// 출력:
// [External Link Debug] 전달받은 연결 자료 개수: 3
// [External Link Debug] 자료 #1: {
//   title: "스마트홈 트렌드 분석",
//   url_exists: true,
//   url: "https://example.com/article1...",
//   text_len: 5234
// }
```

---

## 📝 [2단계] 프롬프트 구성

### 시스템 프롬프트 구조
```javascript
// [라인 2318-2348] 날짜/시즌 컨텍스트 추가
const dateContext = `
📅 **[중요] 현재 날짜 및 시즌 정보**:
- 작성 일자: 2026년 1월 (2026-01-03)
- 현재 시즌: 겨울
- ⚠️ **시즌 부적합 콘텐츠 주의**: 여름휴가, 휴가철 관련 콘텐츠는 부적절합니다. (단, 12월은 크리스마스 시즌으로 적절)
- **절대 규칙**: 현재 시즌과 맞지 않는 이벤트, 상품, 트렌드를 언급하지 마세요.
- 연도를 언급할 때는 반드시 2026년을 사용하세요.
`;

systemPrompt += dateContext;
```

### 사용자 프롬프트 구조
```javascript
// [라인 3085-3700] 메인 프롬프트
const userPrompt = `
[현재 시점 정보]
- 오늘 날짜: 2026년 1월 3일
- 현재 연도: 2026년

[작성 요청]
아래 정보를 바탕으로 블로그 포스트 초안을 작성해주세요.

### 1. 아이디어 제목
- ${ideaData.title}  // "스마트홈 구축 가이드"

### 2. 핵심 요약
- ${ideaData.description}  // "초보자를 위한 스마트홈 설치 방법"

### 3. 현재까지 작성된 초안
${ideaData.currentDraft || '(비어 있음)'}

### 4. 본문 구조 (목차)
${ideaData.outline.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}
// 1. 스마트홈이란?
// 2. 필수 디바이스 추천
// 3. 설치 방법
// 4. 활용 팁

### 5. 주요 키워드
- 스마트홈
- IoT
- 자동화

### 6. 롱테일 키워드
- 스마트홈 시작하기
- 스마트홈 설치 비용

### 7. 추천 검색어 (자료 수집용)
1. 스마트홈 시장 규모 2026
2. 스마트홈 디바이스 순위

### 8. 📚 섹션별 참고 자료 (각 섹션 작성 시 반드시 활용)

#### 섹션1: 스마트홈이란?
관련 키워드: 스마트홈, IoT

참고할 내용:
▪ [스마트홈]
  "2026년 글로벌 스마트홈 시장은 50조원 규모로 성장할 것으로..."
  "IoT 기술 발전으로 가전제품 간 연결이 표준화..."

### 9. 제휴 마케팅 링크 (수익화)
아래 제휴 링크를 본문에 자연스럽게 2~3개 삽입하세요:

1. [삼성 스마트싱스 허브]
   - URL: https://link.coupang.com/re/EPXXXXXXX
   - 제안 CTA: "삼성 스마트싱스 허브 최저가 확인하기"
   
2. [필립스 스마트 조명]
   - URL: https://link.coupang.com/re/EPXXXXXXX
   - 제안 CTA: "필립스 스마트 조명 구매하기"

🚨 CRITICAL - 초안 거부 기준:
- 제휴 링크가 2개 미만이면 → 초안 자동 거부!
- 모든 링크가 결론 섹션에만 몰려있으면 → 초안 자동 거부!

**위치 분산 규칙 (강제)**:
- 첫 번째 링크: 섹션2 또는 섹션3에 삽입 (본문 초반~중반)
- 두 번째 링크: 섹션4 또는 섹션5에 삽입 (본문 후반)
- 세 번째 링크(선택): 결론 섹션에 삽입

### 10. 내 과거 포스팅 목록 (내부 링크 추천)
1. 제목: 스마트홈 디바이스 TOP 10
   URL: https://myblog.com/post1
   설명: 2025년 인기 스마트홈 디바이스 순위

[작성 규칙]
- h1 제목 → 서론 → 본문(h2 섹션들) → 결론(h2)
- 제휴 링크는 녹색 span 태그 사용: <span style="color: #2e7d32;"><a href="URL">CTA</a></span>
- JSON-LD 스키마 필수 생성
- 썸네일 3가지 컨셉 JSON 생성
`;
```

### 콘솔 로그 출력
```javascript
// [라인 2650] RAG 시스템 로그
Logger.info('[RAG] 연결 자료 개수:', linkedScrapsContent.length);
Logger.info('[RAG] 브리핑 메타데이터:', {
  keywords: 3,
  keywordsSample: ["스마트홈", "IoT", "자동화"],
  longTail: 2,
  searchQueries: 2,
  outline: 4
});
Logger.info('[RAG] 조건 통과 - 키워드 기반 검색 시작');

// 출력:
// [RAG] 연결 자료 개수: 3
// [RAG] 브리핑 메타데이터: {keywords: 3, keywordsSample: Array(3), longTail: 2, ...}
// [RAG] 조건 통과 - 키워드 기반 검색 시작
```

---

## 🤖 [3단계] Gemini API 호출

### API 요청 구조
```javascript
// [라인 3750] API 호출
const rawDraft = await callGeminiAPI(userPrompt, { systemInstruction: systemPrompt });
```

### 콘솔 로그 출력
```javascript
// callGeminiAPI 내부에서 출력
console.log('[Gemini API] 요청 시작');
console.log('[Gemini API] 시스템 프롬프트 길이:', systemPrompt.length);
console.log('[Gemini API] 사용자 프롬프트 길이:', userPrompt.length);

// 출력:
// [Gemini API] 요청 시작
// [Gemini API] 시스템 프롬프트 길이: 12458
// [Gemini API] 사용자 프롬프트 길이: 8934
```

---

## 📤 [4단계] 응답 처리 및 정제

### AI 응답 구조 (예시)
```markdown
# 2026년 스마트홈 구축 완벽 가이드

스마트홈이 궁금하신가요? 초보자도 쉽게 따라할 수 있는 설치 방법을 알려드립니다!

## **스마트홈이란?**

스마트홈(Smart Home)은 IoT 기술을 활용하여...

<span style="color: #2e7d32;"><a href="https://link.coupang.com/re/EPXXXXXXX" target="_blank">삼성 스마트싱스 허브 최저가 확인하기</a></span>

## **필수 디바이스 추천**

1,656개의 리뷰에서 75% 최고 평점을 받은 제품들을 소개합니다...

<JSON-LD>
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "2026년 스마트홈 구축 완벽 가이드",
  "description": "초보자도 쉽게 따라할 수 있는 스마트홈 설치 방법과 추천 디바이스",
  "author": {"@type": "Person", "name": "Content Pilot"},
  "datePublished": "2026-01-03",
  "dateModified": "2026-01-03",
  "image": ["url1", "url2", "url3"]
}
</JSON-LD>

<THUMBNAILS>
[
  {
    "type": "curiosity",
    "thumbnailTextKo": "이거 모르면 손해!",
    "thumbnailPromptEn": "Modern smart home control panel on wall..."
  },
  {
    "type": "informative",
    "thumbnailTextKo": "완벽 가이드",
    "thumbnailPromptEn": "Infographic showing smart home setup steps..."
  },
  {
    "type": "empathy",
    "thumbnailTextKo": "우리집도 스마트하게",
    "thumbnailPromptEn": "Cozy living room with smart devices..."
  }
]
</THUMBNAILS>
```

### 콘솔 로그 출력
```javascript
// [라인 3845] 응답 파싱
Logger.debug('[generateDraftFromIdea] HTML 정제 및 포매팅 시작 (Offscreen)');

// [라인 3860] 1차 저장
console.log('[generateDraftFromIdea] checkpoint: after sanitizeHtmlInOffscreen');
console.log('[generateDraftFromIdea] checkpoint: saveIntermediateDraft succeeded (1st)');

// 출력:
// [generateDraftFromIdea] HTML 정제 및 포매팅 시작 (Offscreen)
// [generateDraftFromIdea] checkpoint: after sanitizeHtmlInOffscreen
// [generateDraftFromIdea] checkpoint: saveIntermediateDraft succeeded (1st)
```

---

## 🔧 [5단계] 제휴 링크 삽입 검증

### postProcessAffiliateHtml 함수
```javascript
// [라인 1616-1810] 제휴 링크 후처리
const postProcessAffiliateHtml = (html, affiliateLinks, options = {}) => {
  Logger.info(`[postProcessAffiliateHtml] 시작 - 링크 개수: ${affiliateLinks.length}`);
  
  let insertedCount = 0;
  
  // 키워드 매칭 및 링크 삽입...
  
  const minRequiredLinks = 2;
  if (totalLinks > 0 && insertedCount < minRequiredLinks) {
    Logger.warn(`⚠️ 제휴 링크 최소 개수 미달: ${insertedCount}개`);
    chrome.runtime.sendMessage({
      action: 'show_notification',
      title: '⚠️ 제휴 링크 부족',
      message: `초안에 제휴 링크가 ${insertedCount}개만 삽입되었습니다 (최소 ${minRequiredLinks}개 필요)`
    });
  } else {
    Logger.info(`✅ 제휴 링크 삽입 성공: ${insertedCount}개`);
  }
  
  return html;
};
```

### 콘솔 로그 출력
```javascript
// [라인 1616] 후처리 시작
// [postProcessAffiliateHtml] 시작 - 링크 개수: 3

// [라인 1805] 검증 결과
// ✅ 제휴 링크 삽입 성공: 2개

// 또는
// ⚠️ 제휴 링크 최소 개수 미달: 1개
```

---

## 📊 최종 검증 로그

### [라인 4340-4370] 초안 생성 완료 후 검증
```javascript
// 제휴 링크 최종 검증
Logger.warn(
  `[generateDraftFromIdea] ⚠️ 제휴 링크 삽입 실패: ${affiliateLinkCount}/${minRequiredAffiliateLinks}개`,
  '- AI가 프롬프트를 무시했거나 postProcessAffiliateHtml이 실패했습니다.'
);

// 또는 성공 시
Logger.info(
  `[generateDraftFromIdea] ✅ 제휴 링크 삽입 성공: ${affiliateLinkCount}개`
);

// 최종 완료
Logger.info(
  '[generateDraftFromIdea] ✅ 초안 생성 완료 - draft 길이:',
  formattedDraft?.length || 0,
  '문자'
);
```

### 콘솔 출력 예시
```
[generateDraftFromIdea] ✅ 제휴 링크 삽입 성공: 2개
[generateDraftFromIdea] ✅ 초안 생성 완료 - draft 길이: 12458 문자
```

---

## 🎯 주요 검증 포인트

### ✅ 성공 케이스
```
🎭 [Persona Build] Type: friendly, Custom Tone: friendly, Date: 2026-01-03 (겨울)
[External Link Debug] 전달받은 연결 자료 개수: 3
[RAG] 브리핑 메타데이터: {keywords: 3, longTail: 2, ...}
[RAG] 조건 통과 - 키워드 기반 검색 시작
[Gemini API] 요청 시작
[postProcessAffiliateHtml] 시작 - 링크 개수: 3
✅ 제휴 링크 삽입 성공: 2개
[generateDraftFromIdea] ✅ 초안 생성 완료 - draft 길이: 12458 문자
```

### ⚠️ 경고 케이스
```
[generateDraftFromIdea] ⚠️ 시즌 부적합 콘텐츠 감지: "크리스마스" (현재 1월에 부적절)
[postProcessAffiliateHtml] ⚠️ 제휴 링크 최소 개수 미달: 1개
[generateDraftFromIdea] ⚠️ 제휴 링크 삽입 실패: 1/2개
```

---

## 🔍 디버깅 가이드

### 문제: 제휴 링크가 삽입되지 않음

**확인할 로그:**
```javascript
// 1. 제휴 링크가 전달되었는가?
[postProcessAffiliateHtml] 시작 - 링크 개수: 0  // ❌ 문제!

// 2. AI가 프롬프트를 무시했는가?
[generateDraftFromIdea] ⚠️ 제휴 링크 삽입 실패: 0/2개  // ❌ AI 무시

// 3. postProcessAffiliateHtml이 동작했는가?
✅ 제휴 링크 삽입 성공: 2개  // ✅ 정상
```

### 문제: 시즌 부적합 콘텐츠

**확인할 로그:**
```javascript
⚠️ [시즌 부적합] 콘텐츠 감지: "크리스마스" (현재 1월에 부적절)
```

---

## 📚 관련 파일

- `js/services/aiService.js` (라인 2200-4500): 메인 로직
- `js/services/offscreenService.js`: HTML 정제
- `js/utils/Logger.js`: 로깅 유틸리티

---

## 🎓 요약

1. **데이터 수집**: ideaData에서 브리핑, 참고 자료, 제휴 링크 추출
2. **프롬프트 구성**: 날짜/시즌 컨텍스트 + 섹션별 자료 + 제휴 링크 규칙
3. **API 호출**: Gemini에게 구조화된 프롬프트 전달
4. **응답 처리**: 마크다운 → HTML 정제 → JSON-LD/썸네일 추출
5. **링크 검증**: postProcessAffiliateHtml로 최소 2개 보장
6. **최종 저장**: Firebase에 초안 저장 및 사용자 알림

**모든 단계에서 콘솔 로그를 통해 실시간 디버깅 가능합니다!** 🎉
