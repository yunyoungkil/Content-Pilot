# Firebase 채널 데이터 구조

> **최종 업데이트**: 2025-01-25  
> **상태**: ✅ 최신 (inputUrl, apiUrl 필드 추가 완료)

## 경로
```
channels/{userId}
```

## 데이터 구조

```json
{
  "myChannels": {
    "blogs": [
      {
        "id": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlk",  // base64 인코딩된 URL (자동 생성)
        "inputUrl": "https://blog.naver.com/myid",     // 사용자가 입력한 원본 URL
        "url": "https://blog.naver.com/myid",          // 하위 호환성 (inputUrl과 동일)
        "apiUrl": "https://blog.naver.com/myid/rss",   // RSS URL (자동 생성)
        "gaPropertyId": "123456789",                    // GA4 속성 ID
        "adSenseAccountId": "pub-0000000000000000",    // AdSense 게시자 ID
        "competitors": [                                // 경쟁 채널 목록
          "https://blog.naver.com/competitor1",         // 문자열 형태
          "https://blog.naver.com/competitor2"
          // 또는 객체 형태: { "inputUrl": "https://blog.naver.com/competitor1" }
        ]
      }
    ],
    "youtubes": [
      {
        "id": "aHR0cHM6Ly93d3cueW91dHViZS5jb20vY2hhbm5lbC9VQ1hYWFhYWFhY",  // base64 인코딩된 URL
        "inputUrl": "https://www.youtube.com/channel/UCXXXXXXXX",
        "url": "https://www.youtube.com/channel/UCXXXXXXXX",
        "apiUrl": "https://www.youtube.com/channel/UCXXXXXXXX",
        "competitors": []
      }
    ]
  }
}
```

## 필드 설명

### 최상위 레벨
- `myChannels`: 내 채널 정보를 담는 객체

### myChannels
- `blogs`: 블로그 채널 배열
- `youtubes`: YouTube 채널 배열

### blogs/youtubes 배열의 각 항목
- `id` (필수): 채널 고유 ID
  - 자동 생성: `btoa(inputUrl || apiUrl || url).replace(/=/g, "")`
  - 예: `"https://blog.naver.com/myid"` → `"aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlk"`
  
- `inputUrl` (필수): 사용자가 입력한 원본 URL
  - 예: `"https://blog.naver.com/myid"`
  - 저장 시 자동 생성됨
  
- `url` (필수): 하위 호환성을 위한 필드 (inputUrl과 동일)
  - 예: `"https://blog.naver.com/myid"`
  - 기존 데이터와의 호환성을 위해 유지
  
- `apiUrl` (선택): RSS/API URL (자동 생성 및 저장)
  - 예: `"https://rss.blog.naver.com/myid.xml"`
  - 저장 시 `resolveBlogUrlToRss(inputUrl)`로 생성되어 함께 저장됨
  - 성능 개선: 매번 변환하지 않고 저장된 값 사용
  
- `gaPropertyId` (선택): Google Analytics 4 속성 ID
  - 예: `"123456789"`
  
- `adSenseAccountId` (선택): AdSense 게시자 ID
  - 예: `"pub-0000000000000000"`
  
- `competitors` (선택): 경쟁 채널 URL 배열
  - 형태 1 (문자열): `["https://blog.naver.com/competitor1"]`
  - 형태 2 (객체): `[{ "inputUrl": "https://blog.naver.com/competitor1" }]`

## 실제 예시

```json
{
  "myChannels": {
    "blogs": [
      {
        "id": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS95dW55b3VuZ2tpbA",
        "inputUrl": "https://blog.naver.com/yunyoungkil",
        "url": "https://blog.naver.com/yunyoungkil",
        "apiUrl": "https://rss.blog.naver.com/yunyoungkil.xml",
        "gaPropertyId": "123456789",
        "adSenseAccountId": "pub-1234567890123456",
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

## 데이터 읽기/쓰기

### 읽기 (get_channels_and_key)
```javascript
// background.js
const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
const channelsData = channelsSnap?.val() || {};

// 응답 구조
{
  success: true,
  data: {
    youtubeApiKey: "...",
    geminiApiKey: "...",
    myChannels: {
      blogs: [...],
      youtubes: [...]
    }
  }
}
```

### 쓰기 (save_channels_and_key)
```javascript
// channelMode.js에서 전송하는 데이터
{
  youtubeApiKey: "...",
  geminiApiKey: "...",
  myChannels: {
    blogs: [
      {
        inputUrl: "https://blog.naver.com/myid",      // 원본 URL
        url: "https://blog.naver.com/myid",           // 하위 호환성
        apiUrl: "https://rss.blog.naver.com/myid.xml", // RSS URL (자동 생성)
        gaPropertyId: "123456789",
        adSenseAccountId: "pub-0000000000000000",
        competitors: ["https://blog.naver.com/competitor1"]
      }
    ]
  }
}
```

## 주의사항

1. **ID 자동 생성**: `id` 필드가 없으면 `inputUrl`(또는 `url`), `apiUrl` 순서로 base64 인코딩하여 생성
2. **inputUrl과 url**: 둘 다 저장되며, `inputUrl`이 우선 사용됨 (하위 호환성을 위해 `url`도 유지)
3. **apiUrl 자동 생성**: 저장 시 `resolveBlogUrlToRss(inputUrl)`로 생성되어 함께 저장됨
4. **competitors 형태**: 문자열 또는 객체 형태 모두 지원 (하위 호환성)
5. **병합 로직**: 저장 시 기존 채널과 새 채널을 ID 기준으로 병합
6. **undefined 처리**: Firebase 저장 전 `undefined` 값을 `null`로 변환

