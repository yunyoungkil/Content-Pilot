# 스크랩 저장 로직 상세 문서

이 문서는 Content Pilot의 스크랩 저장 기능의 전체 흐름과 로직을 설명합니다.

## 📋 목차

1. [전체 흐름](#전체-흐름)
2. [데이터 구조](#데이터-구조)
3. [저장 경로](#저장-경로)
4. [코드 위치](#코드-위치)
5. [채널 필터링](#채널-필터링)
6. [에러 처리](#에러-처리)

---

## 전체 흐름

### 1. 사용자 액션
```
사용자가 웹 페이지에서 텍스트 하이라이트
  ↓
하이라이트 도구바에서 "스크랩 저장" 버튼 클릭
  ↓
스크랩 저장 모달 표시 (채널 선택 옵션 포함)
```

### 2. Content Script 처리
**파일**: `js/core/highlighter.js`

```javascript
// 스크랩 저장 모달 표시
showScrapSaveModalInline(scrapData, activeChannelId, activeChannelName)
  ↓
사용자가 "저장" 버튼 클릭
  ↓
chrome.runtime.sendMessage({
  action: "scrap_element",
  data: scrapData,
  channelId: targetChannelId  // null 또는 activeChannelId
})
```

**스크랩 데이터 구조** (`scrapData`):
```javascript
{
  text: string,           // 하이라이트된 텍스트
  html: string,          // HTML 원본
  tag: string,           // 태그 (기본값: 'UNKNOWN')
  url: string,          // 현재 페이지 URL
  image: string|null,    // 대표 이미지
  images: Array,         // 이미지 배열
  allImages: Array,      // 모든 이미지 (images + image 통합)
  highlights: Array,     // 하이라이트 메타데이터
  hasHighlights: boolean // 하이라이트 존재 여부
}
```

### 3. Background Script 처리
**파일**: `background.js` (1296-1301번 라인)

```javascript
if (msg.action === "scrap_element" && msg.data) {
  const { data } = msg;
  const channelId = msg.channelId !== undefined ? msg.channelId : null;
  return await saveScrapElement(data, channelId);
}
```

### 4. Scrap Service 저장
**파일**: `js/services/scrapService.js` (14-60번 라인)

```javascript
export async function saveScrapElement(data, channelId = null) {
  // 1. 스크랩 페이로드 준비
  const scrapPayload = {
    text: data.text || '',
    html: data.html || '',
    tag: data.tag || 'UNKNOWN',
    url: data.url || '',
    image: data.image || null,
    images: data.images || [],
    allImages: data.allImages || (data.images && data.images.length > 0 
      ? data.images 
      : (data.image ? [data.image] : null)),
    highlights: data.highlights || [],
    hasHighlights: data.hasHighlights || false,
    timestamp: Date.now(),
    channelId: channelId  // null 또는 채널 ID
  };

  // 2. images 배열을 allImages로 통합
  if (Array.isArray(data.images) && data.images.length > 0) {
    const existingAllImages = scrapPayload.allImages || [];
    const mergedImages = [...new Set([...existingAllImages, ...data.images])];
    scrapPayload.allImages = mergedImages.length > 0 ? mergedImages : null;
  }

  // 3. images 필드 제거 (allImages로 통합됨)
  if (scrapPayload.images) {
    delete scrapPayload.images;
  }

  // 4. Firebase에 저장
  const userId = await getCurrentUserId();
  const scrapRef = push(ref(getDb(), `scraps/${userId}`));
  const scrapId = scrapRef.key;
  await set(scrapRef, cleanDataForFirebase(scrapPayload));

  return { 
    success: true, 
    scrapId: scrapId,
    scrapData: scrapPayload
  };
}
```

### 5. 응답 처리
**파일**: `js/core/highlighter.js` (214-237번 라인)

```javascript
chrome.runtime.sendMessage({...}, (response) => {
  if (response && response.success) {
    const feedbackMessage = isChannelOnly && activeChannelName
      ? `✅ 스크랩이 '${activeChannelName}'에 저장되었습니다.`
      : "✅ 공용 스크랩으로 저장되었습니다.";
    showToast(feedbackMessage);
    
    // 미리보기 표시
    window.postMessage({
      action: "cp_show_preview",
      data: { ...scrapData, channelId: targetChannelId }
    }, "*");
  } else {
    showToast("❌ 스크랩 저장 실패");
  }
});
```

---

## 데이터 구조

### 저장되는 데이터 (`scrapPayload`)

| 필드 | 타입 | 설명 | 기본값 |
|------|------|------|--------|
| `text` | string | 하이라이트된 텍스트 | `''` |
| `html` | string | HTML 원본 | `''` |
| `tag` | string | 태그 (카테고리) | `'UNKNOWN'` |
| `url` | string | 현재 페이지 URL | `''` |
| `image` | string\|null | 대표 이미지 URL | `null` |
| `allImages` | Array\|null | 모든 이미지 배열 (images + image 통합) | `null` |
| `highlights` | Array | 하이라이트 메타데이터 | `[]` |
| `hasHighlights` | boolean | 하이라이트 존재 여부 | `false` |
| `timestamp` | number | 저장 시간 (Unix timestamp) | `Date.now()` |
| `channelId` | string\|null | 채널 ID (null = 공용) | `null` |

### 이미지 필드 통합 로직

1. **`images` 배열 처리**:
   - `data.images`가 있으면 `allImages`에 병합
   - 중복 제거 (`Set` 사용)

2. **`image` 단일 필드 처리**:
   - `data.image`가 있으면 `allImages`에 추가
   - `data.images`가 없으면 `[data.image]`로 배열 생성

3. **`images` 필드 제거**:
   - 최종적으로 `allImages`만 저장
   - `images` 필드는 제거됨

---

## 저장 경로

### Firebase 경로
```
scraps/{userId}/{scrapId}
```

- `userId`: 현재 사용자 ID (`getCurrentUserId()`)
- `scrapId`: Firebase가 자동 생성한 고유 키 (`push().key`)

### 예시
```
scraps/user123/-NxYz123AbC456
```

---

## 코드 위치

### 1. 스크랩 저장 모달 UI
- **파일**: `js/core/highlighter.js`
- **함수**: `showScrapSaveModalInline()` (90-249번 라인)
- **역할**: 사용자에게 채널 선택 옵션 제공

### 2. 메시지 핸들러
- **파일**: `background.js`
- **핸들러**: `scrap_element` (1296-1301번 라인)
- **역할**: Content Script에서 온 메시지를 처리하고 서비스 호출

### 3. 스크랩 저장 서비스
- **파일**: `js/services/scrapService.js`
- **함수**: `saveScrapElement()` (14-60번 라인)
- **역할**: 실제 Firebase 저장 로직

### 4. Firebase 유틸리티
- **파일**: `js/services/firebaseService.js`
- **함수**: `cleanDataForFirebase()`, `getCurrentUserId()`, `push()`, `set()`
- **역할**: Firebase 데이터 정제 및 저장

---

## 채널 필터링

### 채널 ID 처리

1. **공용 스크랩** (`channelId = null`):
   - 모든 채널에서 접근 가능
   - 스크랩 저장 모달에서 "공용 스크랩" 선택 시

2. **채널 전용 스크랩** (`channelId = activeChannelId`):
   - 특정 채널에만 연결
   - 스크랩 저장 모달에서 "이 채널에만 저장" 체크 시

### 조회 시 필터링
**파일**: `js/services/scrapService.js` (67-143번 라인)

```javascript
export async function getFirebaseScraps(targetChannelId = null) {
  // 1. 전체 스크랩 조회
  const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
  
  // 2. 필터링
  const filtered = arr.filter(scrap => {
    // channelId가 없거나 null인 경우 포함 (공용 스크랩)
    if (scrap.channelId === undefined || scrap.channelId === null) {
      return true;
    }
    
    // targetChannelId가 없는 경우, 모든 스크랩 포함
    if (!targetChannelId) {
      return true;
    }

    // 정확히 일치하는 경우 포함
    if (scrap.channelId === targetChannelId) {
      return true;
    }

    // URL의 origin이 일치하는 경우 포함
    if (scrap.channelId && targetChannelId) {
      const scrapUrl = atob(scrap.channelId.replace(/=/g, ''));
      const targetUrl = atob(targetChannelId.replace(/=/g, ''));
      
      const scrapUrlObj = new URL(scrapUrl);
      const targetUrlObj = new URL(targetUrl);
      
      if (scrapUrlObj.origin === targetUrlObj.origin) {
        return true;
      }
    }
    
    return false;
  });
  
  return { data: filtered };
}
```

---

## 에러 처리

### 1. 저장 실패 시
```javascript
try {
  await set(scrapRef, cleanDataForFirebase(scrapPayload));
  return { success: true, scrapId, scrapData };
} catch (error) {
  Logger.error('[saveScrapElement] 저장 실패:', error);
  return { success: false, error: error.message };
}
```

### 2. Content Script 에러 처리
```javascript
chrome.runtime.sendMessage({...}, (response) => {
  if (chrome.runtime.lastError) {
    const errorMsg = chrome.runtime.lastError.message;
    showToast(`❌ 스크랩 저장 실패: ${errorMsg}`);
    return;
  }

  if (response && response.success) {
    showToast("✅ 스크랩 저장 완료");
  } else {
    showToast("❌ 스크랩 저장 실패");
  }
});
```

### 3. 데이터 정제
- `cleanDataForFirebase()`: `undefined` 값 제거
- Firebase는 `undefined` 값을 저장할 수 없으므로 사전 정제 필요

---

## 특수 케이스

### 1. AI 분석 리포트 저장
**파일**: `js/services/scrapService.js` (194-226번 라인)

```javascript
export async function saveEntireAnalysis(analysisContent) {
  const scrapPayload = {
    text: analysisContent,
    html: `<pre>${analysisContent}</pre>`,
    tag: "AI_ANALYSIS",
    url: `content-pilot://analysis/${Date.now()}`,
    tags: [`#성과분석`, `#${dateTag}`],
    timestamp: Date.now(),
  };
  
  // channelId 없음 (공용 스크랩)
  // ...
}
```

### 2. 이미지 없는 스크랩
- `image`: `null`
- `allImages`: `null`
- 필드 자체가 저장되지 않을 수 있음 (`cleanDataForFirebase` 처리)

### 3. 하이라이트 없는 스크랩
- `highlights`: `[]`
- `hasHighlights`: `false`

---

## 데이터 흐름 다이어그램

```
[웹 페이지]
  ↓ (하이라이트 + 저장 버튼 클릭)
[Content Script - highlighter.js]
  ↓ (스크랩 저장 모달 표시)
[사용자 선택]
  ↓ (채널 선택 또는 공용 선택)
[chrome.runtime.sendMessage]
  ↓ (action: "scrap_element")
[Background Script - background.js]
  ↓ (메시지 핸들러)
[Scrap Service - scrapService.js]
  ↓ (saveScrapElement 호출)
[데이터 준비 및 정제]
  ↓ (cleanDataForFirebase)
[Firebase 저장]
  ↓ (scraps/{userId}/{scrapId})
[응답 반환]
  ↓ (success: true/false)
[Content Script]
  ↓ (토스트 메시지 표시)
[사용자 확인]
```

---

## 개선 사항

### 현재 구현의 장점
1. ✅ 채널별 필터링 지원
2. ✅ 이미지 통합 로직 (`allImages`)
3. ✅ 하이라이트 메타데이터 저장
4. ✅ 에러 처리 완비

### 개선 가능한 부분
1. ⚠️ 중복 검사 없음 (같은 URL/텍스트 중복 저장 가능)
2. ⚠️ 태그 자동 추출 없음 (기본값: 'UNKNOWN')
3. ⚠️ 이미지 최적화 없음 (원본 URL만 저장)

---

## 관련 문서

- [카드 추가 로직](./CARD_ADDITION_LOGIC.md)
- [서비스 아키텍처](../architecture/SERVICES_ARCHITECTURE.md)
- [프로그램 로직](./PROGRAM_LOGIC.md)

