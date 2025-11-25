# 실제 저장되는 Firebase 데이터 구조

> **최종 업데이트**: 2025-01-25  
> **상태**: ✅ 수정 완료 (문서와 실제 구조 일치)

## ✅ 수정 완료 (2025-01-25)

이제 저장 구조가 문서와 일치합니다.

## 현재 저장되는 구조 (channelMode.js → background.js)

### 1. channelMode.js에서 전송하는 데이터 (수정 후)
```javascript
{
  youtubeApiKey: "...",
  geminiApiKey: "...",
  myChannels: {
    blogs: [
      {
        inputUrl: "https://blog.naver.com/myid",      // ✅ 원본 URL
        url: "https://blog.naver.com/myid",           // ✅ 하위 호환성
        apiUrl: "https://rss.blog.naver.com/myid.xml", // ✅ RSS URL (자동 생성)
        gaPropertyId: "123456789",
        adSenseAccountId: "pub-0000000000000000",
        competitors: [                                 // 문자열 배열
          "https://blog.naver.com/competitor1",
          "https://blog.naver.com/competitor2"
        ]
      }
    ]
  }
}
```

### 2. background.js에서 저장 전 처리
- `id` 자동 생성: `btoa(inputUrl || apiUrl || url).replace(/=/g, "")`
- `inputUrl` 필드 저장됨 ✅
- `apiUrl` 필드 저장됨 ✅ (저장 시 자동 생성)

### 3. 실제 Firebase에 저장되는 최종 구조
```json
{
  "myChannels": {
    "blogs": [
      {
        "id": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlk",  // 자동 생성
        "inputUrl": "https://blog.naver.com/myid",     // ✅ 원본 URL
        "url": "https://blog.naver.com/myid",          // ✅ 하위 호환성
        "apiUrl": "https://rss.blog.naver.com/myid.xml", // ✅ RSS URL
        "gaPropertyId": "123456789",
        "adSenseAccountId": "pub-0000000000000000",
        "competitors": [
          "https://blog.naver.com/competitor1",
          "https://blog.naver.com/competitor2"
        ]
      }
    ],
    "youtubes": []
  }
}
```

## ✅ 수정 완료 - 문서와 일치

### 저장되는 필드 (문서와 일치)
- ✅ `id`: 자동 생성됨
- ✅ `inputUrl`: 사용자가 입력한 원본 URL
- ✅ `url`: 하위 호환성을 위한 필드 (inputUrl과 동일)
- ✅ `apiUrl`: RSS URL (저장 시 자동 생성)
- ✅ `gaPropertyId`: GA4 속성 ID
- ✅ `adSenseAccountId`: AdSense 게시자 ID
- ✅ `competitors`: 경쟁 채널 URL 배열 (문자열)

## 읽을 때의 처리 (하위 호환성)

### channelMode.js에서 읽을 때
```javascript
// inputUrl이 없으면 url 사용 (하위 호환성)
url: blog.inputUrl || blog.url
```

### collectorService.js에서 사용할 때
```javascript
// apiUrl이 있으면 사용, 없으면 url을 RSS URL로 변환
if (c.apiUrl) {
  rssUrl = c.apiUrl;
} else if (c.url) {
  rssUrl = resolveBlogUrlToRss(c.url);
}
```

## ✅ 수정 완료

### 적용된 수정 사항

1. **inputUrl 추가**: 저장 시 `inputUrl` 필드 추가 ✅
2. **apiUrl 저장**: RSS URL을 미리 생성하여 저장 ✅
3. **하위 호환성 유지**: 기존 `url` 필드도 함께 저장하여 기존 데이터와 호환 ✅

### 수정된 저장 로직
```javascript
// channelMode.js
const apiUrl = resolveBlogUrlToRss(url);

const newData = {
  inputUrl: url,           // 원본 URL
  url: url,                // 하위 호환성
  apiUrl: apiUrl || null,  // RSS URL (자동 생성)
  gaPropertyId: gaId,
  adSenseAccountId: adsenseId,
  competitors: competitors
};
```

### 개선 효과

1. **성능 개선**: RSS URL을 매번 변환하지 않고 저장된 값 사용
2. **데이터 일관성**: 문서와 실제 구조 일치
3. **하위 호환성**: 기존 데이터와의 호환성 유지

