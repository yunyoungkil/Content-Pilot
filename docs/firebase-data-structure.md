# Firebase 데이터 구조 상세 문서

## 개요

Content Pilot은 Firebase Realtime Database를 사용하여 모든 데이터를 저장합니다. 이 문서는 데이터베이스의 전체 구조와 각 노드의 의미, 필드 설명을 상세히 기록합니다.

**최종 업데이트**: 2024년 (채널 중심 아키텍처 적용)

---

## 1. 루트 구조

```
Firebase Realtime Database
├── channels/          # 채널 설정 및 메타데이터
├── kanban/            # 칸반 보드 아이디어 카드
├── scraps/            # 스크랩 데이터
├── channel_content/   # 채널 콘텐츠 (블로그/유튜브)
└── channel_meta/      # 채널 메타데이터
```

---

## 2. channels/ - 채널 설정 및 메타데이터

### 2.1 경로 구조

```
channels/
└── default_user/
    └── myChannels/
        ├── blogs/          # 내 블로그 채널 배열
        └── youtubes/       # 내 유튜브 채널 배열 (향후 지원)
```

### 2.2 데이터 구조

#### `channels/default_user/myChannels/blogs/` (배열)

각 블로그 채널 객체:

```javascript
{
  inputUrl: string,              // 사용자가 입력한 원본 URL (예: "https://blog.naver.com/myid")
  apiUrl: string,                 // RSS/API URL (예: "https://blog.naver.com/myid/rss")
  id: string,                    // 채널 고유 ID (btoa(apiUrl).replace(/=/g, ""))
  gaPropertyId: string | null,   // GA4 속성 ID (예: "123456789")
  adSenseAccountId: string | null, // AdSense 게시자 ID (예: "pub-0000000000000000")
  competitors: [                 // 경쟁 채널 목록 (Nested 구조)
    {
      inputUrl: string,          // 경쟁사 입력 URL
      apiUrl: string             // 경쟁사 RSS/API URL
    },
    // ... 더 많은 경쟁사
  ]
}
```

**예시:**

```json
{
  "channels": {
    "default_user": {
      "myChannels": {
        "blogs": [
          {
            "inputUrl": "https://blog.naver.com/myid",
            "apiUrl": "https://blog.naver.com/myid/rss",
            "id": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Jzcw",
            "gaPropertyId": "123456789",
            "adSenseAccountId": "pub-1234567890123456",
            "competitors": [
              {
                "inputUrl": "https://blog.naver.com/competitor1",
                "apiUrl": "https://blog.naver.com/competitor1/rss"
              },
              {
                "inputUrl": "https://blog.naver.com/competitor2",
                "apiUrl": "https://blog.naver.com/competitor2/rss"
              }
            ]
          }
        ],
        "youtubes": []
      }
    }
  }
}
```

**중요 사항:**

- **채널 중심 아키텍처**: 경쟁 채널(`competitors`)은 더 이상 전역으로 관리되지 않고, 각 내 채널의 하위 속성으로 저장됩니다.
- **ID 생성 규칙**: `id`는 `btoa(apiUrl).replace(/=/g, "")`로 생성됩니다.
- **하위 호환성**: 구버전 데이터에 `competitorChannels` 필드가 있을 수 있으나, 시스템 진단 도구를 통해 자동 마이그레이션됩니다.

---

## 3. kanban/ - 칸반 보드 아이디어 카드

### 3.1 경로 구조

```
kanban/
├── ideas/          # 아이디어 단계
├── in_progress/    # 진행 중 단계
└── completed/      # 완료 단계
```

각 상태 폴더 내부에는 Firebase Push ID를 키로 하는 카드 객체들이 저장됩니다.

### 3.2 데이터 구조

#### `kanban/{status}/{cardId}`

```javascript
{
  title: string,                    // 카드 제목
  description: string,              // 카드 설명
  createdAt: number,                // 생성 시간 (Unix timestamp)
  channelId: string | null,         // 소속 채널 ID (null = 공용/미지정)
  tags: string[],                   // 태그 배열 (예: ["#AI-추천", "#트렌드"])
  origin: {                         // 아이디어 출처
    type: string,                   // "ai_generated" | "manual_entry" | "my_post" | "competitor_post" | "my_post_renewal"
    sourceId?: string,              // 출처 채널/콘텐츠 ID (선택)
    url?: string                    // 출처 URL (선택)
  },
  workspace: {                     // 워크스페이스 데이터 (PRD v1.0)
    keywords: string[],             // 워크스페이스 키워드 (tags에서 #AI-추천 제외)
    outline: string[],              // 목차 배열
    draft: string,                  // 초안 내용 (HTML 또는 마크다운)
    linkedScraps: {                 // 연결된 스크랩 객체
      [scrapId: string]: {
        // 스크랩 메타데이터 (선택)
      }
    }
  },
  recommendedKeywords: string[],     // 추천 검색어
  longTailKeywords: string[],       // 롱테일 키워드
  publishedUrl: string | null,      // 발행된 URL (완료 시)
  performance: {                    // 성과 데이터 (발행 후 자동 수집)
    estimatedEarnings: number,      // 예상 수익 (USD)
    pageviews: number,              // 페이지뷰
    sessions: number,               // 세션 수
    avgSessionDuration: number,    // 평균 세션 지속 시간 (초)
    ctr: number,                    // 클릭률
    bounceRate: number,             // 이탈률
    lastUpdated: number,            // 마지막 업데이트 시간
    error: string | null            // 오류 메시지 (있는 경우)
  } | null,
  briefing: {                       // AI 브리핑 데이터 (자동 생성)
    summary: string,                // 요약
    keyPoints: string[],            // 핵심 포인트
    targetAudience: string,         // 타겟 오디언스
    suggestedTags: string[]         // 제안 태그
  } | null
}
```

**예시:**

```json
{
  "kanban": {
    "ideas": {
      "-Nx1234567890": {
        "title": "2024년 블로그 트렌드 분석",
        "description": "최신 블로그 트렌드와 콘텐츠 전략",
        "createdAt": 1704067200000,
        "channelId": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Jzcw",
        "tags": ["#AI-추천", "#트렌드", "#전략"],
        "origin": {
          "type": "ai_generated"
        },
        "workspace": {
          "keywords": ["#트렌드", "#전략"],
          "outline": ["서론", "본론", "결론"],
          "draft": "<h1>2024년 블로그 트렌드</h1>...",
          "linkedScraps": {}
        },
        "recommendedKeywords": ["블로그 트렌드", "콘텐츠 전략"],
        "longTailKeywords": ["2024년 블로그 트렌드 분석", "콘텐츠 마케팅 전략"],
        "publishedUrl": null,
        "performance": null,
        "briefing": {
          "summary": "2024년 블로그 트렌드에 대한 종합 분석",
          "keyPoints": ["트렌드 1", "트렌드 2"],
          "targetAudience": "블로거 및 콘텐츠 크리에이터",
          "suggestedTags": ["#트렌드", "#블로그"]
        }
      }
    }
  }
}
```

**중요 사항:**

- **channelId 필터링**: 모든 카드는 `channelId`로 필터링되어 해당 채널에만 표시됩니다. `null`인 경우 공용 데이터로 간주됩니다.
- **workspace 객체**: PRD v1.0에 따라 반드시 존재해야 하며, `workspaceMode.js`에서 필수로 사용됩니다.
- **성과 데이터**: `publishedUrl`이 설정되고 발행된 후, 백그라운드에서 자동으로 GA4/AdSense 데이터를 수집하여 `performance` 객체에 저장합니다.

---

## 4. scraps/ - 스크랩 데이터

### 4.1 경로 구조

```
scraps/
└── {scrapId}/        # Firebase Push ID
```

### 4.2 데이터 구조

#### `scraps/{scrapId}`

```javascript
{
  text: string,                     // 스크랩된 텍스트 내용
  url: string,                      // 스크랩된 페이지 URL
  title: string,                     // 페이지 제목
  timestamp: number,                // 스크랩 시간 (Unix timestamp)
  channelId: string | null,         // 소속 채널 ID (null = 공용 스크랩)
  tags: string[] | null,            // 자동 추출된 태그
  allImages: string[] | null,       // 페이지에서 추출된 모든 이미지 URL 배열
  cleanText: string | null,         // 정제된 텍스트 (HTML 태그 제거)
  metadata: {                       // 메타데이터 (선택)
    author?: string,
    publishedAt?: number,
    description?: string
  } | null
}
```

**예시:**

```json
{
  "scraps": {
    "-Ny1234567890": {
      "text": "2024년 최신 블로그 트렌드에 대한 분석...",
      "url": "https://example.com/blog-trends-2024",
      "title": "2024년 블로그 트렌드 분석",
      "timestamp": 1704067200000,
      "channelId": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Jzcw",
      "tags": ["#트렌드", "#블로그", "#콘텐츠"],
      "allImages": [
        "https://example.com/image1.jpg",
        "https://example.com/image2.jpg"
      ],
      "cleanText": "2024년 최신 블로그 트렌드에 대한 분석...",
      "metadata": {
        "author": "홍길동",
        "publishedAt": 1703980800000,
        "description": "블로그 트렌드 분석 글"
      }
    }
  }
}
```

**중요 사항:**

- **channelId 필터링**: 스크랩도 `channelId`로 필터링됩니다. `null`인 경우 모든 채널에서 공용으로 사용 가능합니다.
- **이미지 배열**: `allImages`는 페이지에서 추출된 모든 이미지 URL을 포함합니다. 워크스페이스에서 이미지 갤러리로 활용됩니다.

---

## 5. channel_content/ - 채널 콘텐츠 (블로그/유튜브)

### 5.1 경로 구조

```
channel_content/
├── blogs/           # 블로그 게시물 데이터
│   └── {contentId}/ # Base64 인코딩된 URL (쿼리 파라미터 제거)
└── youtubes/        # 유튜브 동영상 데이터
    └── {videoId}/   # YouTube Video ID
```

### 5.2 데이터 구조

#### `channel_content/blogs/{contentId}`

```javascript
{
  title: string,                    // 게시물 제목
  fullLink: string,                 // 전체 URL (쿼리 파라미터 포함)
  linkForId: string,                // ID 생성용 URL (쿼리 파라미터 제거)
  contentId: string,                // 콘텐츠 ID (btoa(linkForId).replace(/=/g, ""))
  sourceId: string,                 // 출처 채널 ID (btoa(apiUrl).replace(/=/g, ""))
  channelType: string,              // "myChannels" | "competitorChannels"
  publishedAt: number,              // 발행 시간 (Unix timestamp)
  fetchedAt: number,                // 데이터 수집 시간
  cleanText: string | null,         // 정제된 텍스트
  tags: string[] | null,            // 자동 추출된 태그
  commentCount: number | null,     // 댓글 수
  likeCount: number | null,        // 좋아요 수
  readTimeInSeconds: number | null // 읽기 시간 (초)
}
```

**예시:**

```json
{
  "channel_content": {
    "blogs": {
      "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Bvc3QxMjM": {
        "title": "2024년 블로그 트렌드",
        "fullLink": "https://blog.naver.com/myid/123?param=value",
        "linkForId": "https://blog.naver.com/myid/123",
        "contentId": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Bvc3QxMjM",
        "sourceId": "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Jzcw",
        "channelType": "myChannels",
        "publishedAt": 1703980800000,
        "fetchedAt": 1704067200000,
        "cleanText": "2024년 블로그 트렌드에 대한 분석...",
        "tags": ["#트렌드", "#블로그"],
        "commentCount": 15,
        "likeCount": 42,
        "readTimeInSeconds": 300
      }
    }
  }
}
```

#### `channel_content/youtubes/{videoId}`

```javascript
{
  videoId: string,                   // YouTube Video ID
  title: string,                     // 동영상 제목
  description: string,              // 동영상 설명
  publishedAt: number,              // 발행 시간 (Unix timestamp)
  thumbnail: string,                // 썸네일 URL
  viewCount: number,                // 조회수
  likeCount: number,                // 좋아요 수
  commentCount: number,             // 댓글 수
  channelId: string,                // YouTube Channel ID
  sourceId: string,                 // 출처 채널 ID
  channelType: string,              // "myChannels" | "competitorChannels"
  fetchedAt: number,                // 데이터 수집 시간
  tags: string[] | null             // 자동 추출된 태그
}
```

**예시:**

```json
{
  "channel_content": {
    "youtubes": {
      "dQw4w9WgXcQ": {
        "videoId": "dQw4w9WgXcQ",
        "title": "2024년 블로그 트렌드 분석",
        "description": "블로그 트렌드에 대한 상세 분석...",
        "publishedAt": 1703980800000,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg",
        "viewCount": 10000,
        "likeCount": 500,
        "commentCount": 50,
        "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
        "sourceId": "UCxxxxxxxxxxxxxxxxxxxxxx",
        "channelType": "myChannels",
        "fetchedAt": 1704067200000,
        "tags": ["#트렌드", "#블로그"]
      }
    }
  }
}
```

**중요 사항:**

- **contentId 생성 규칙**: 블로그의 경우 `btoa(linkForId).replace(/=/g, "")`로 생성됩니다. `linkForId`는 쿼리 파라미터를 제거한 URL입니다.
- **sourceId**: 콘텐츠가 어느 채널에서 수집되었는지 식별하는 ID입니다. `channelId` 필터링에 사용됩니다.

---

## 6. channel_meta/ - 채널 메타데이터

### 6.1 경로 구조

```
channel_meta/
└── {channelId}/      # 채널 ID (btoa(apiUrl).replace(/=/g, ""))
```

### 6.2 데이터 구조

#### `channel_meta/{channelId}`

```javascript
{
  title: string,                    // 채널 제목
  type: string,                     // "blog" | "youtube"
  source: string,                   // 채널 소스 (RSS URL 또는 YouTube Channel ID)
  inputUrl: string,                 // 사용자가 입력한 원본 URL
  fetchedAt: number                 // 메타데이터 수집 시간
}
```

**예시:**

```json
{
  "channel_meta": {
    "aHR0cHM6Ly9ibG9nLm5hdmVyLmNvbS9teWlkL3Jzcw": {
      "title": "내 블로그",
      "type": "blog",
      "source": "https://blog.naver.com/myid/rss",
      "inputUrl": "https://blog.naver.com/myid",
      "fetchedAt": 1704067200000
    }
  }
}
```

---

## 7. 데이터 필터링 및 쿼리 패턴

### 7.1 채널별 필터링

모든 데이터는 `channelId`로 필터링됩니다:

- **칸반 카드**: `kanban/{status}/{cardId}.channelId === activeChannelId`
- **스크랩**: `scraps/{scrapId}.channelId === activeChannelId || scraps/{scrapId}.channelId === null`
- **콘텐츠**: `channel_content/blogs/{contentId}.sourceId === activeChannelId`

### 7.2 공용 데이터

`channelId`가 `null`인 데이터는 모든 채널에서 공용으로 사용 가능합니다:

- **칸반 카드**: `channelId === null` → 모든 채널에서 표시
- **스크랩**: `channelId === null` → 모든 채널에서 표시

### 7.3 하위 호환성

구버전 데이터(`channelId`가 `undefined`)는 다음 규칙으로 처리됩니다:

- **단일 채널 사용자**: 자동으로 해당 채널로 마이그레이션
- **다중 채널 사용자**: 공용(`null`)으로 설정

---

## 8. 데이터 마이그레이션

### 8.1 자동 마이그레이션

확장 프로그램 설치/업데이트 시 자동으로 실행됩니다:

1. **고아 데이터 처리**: `channelId`가 없는 칸반 카드/스크랩에 `channelId` 부여
2. **채널 구조 마이그레이션**: 전역 `competitorChannels`를 내 채널의 `competitors` 배열로 이동

### 8.2 수동 마이그레이션

시스템 진단 모드에서 수동으로 실행 가능:

- **"고아 데이터 감지"** → "마이그레이션 실행" 버튼
- **"채널 데이터 구조"** → "구조 확인" 버튼

---

## 9. 데이터 무결성 체크리스트

시스템 진단 모드에서 확인하는 항목:

1. **활성 채널 상태**: `activeChannelId`가 채널 목록에 존재하는지 확인
2. **고아 데이터**: `channelId`가 없는 데이터 개수 확인
3. **채널 데이터 구조**: 채널 중심 아키텍처 구조 준수 여부 확인

---

## 10. 참고 사항

### 10.1 ID 생성 규칙

- **채널 ID**: `btoa(apiUrl).replace(/=/g, "")`
- **콘텐츠 ID**: `btoa(linkForId).replace(/=/g, "")` (블로그의 경우)
- **스크랩 ID**: Firebase Push ID (자동 생성)

### 10.2 타임스탬프

모든 타임스탬프는 Unix timestamp (밀리초) 형식입니다.

### 10.3 null vs undefined

- **null**: 명시적으로 공용/미지정으로 설정된 값
- **undefined**: 구버전 데이터 (마이그레이션 대상)

---

## 11. 변경 이력

### 2024년 - 채널 중심 아키텍처 적용

- **변경 사항**: 경쟁 채널을 전역 `competitorChannels`에서 각 내 채널의 `competitors` 배열로 이동
- **영향**: 모든 데이터에 `channelId` 필드 추가, 채널별 필터링 로직 적용
- **마이그레이션**: 자동 마이그레이션 함수 제공 (`runDataMigration`)

---

## 12. FAQ

### Q1. 여러 채널을 사용할 때 데이터가 섞이지 않나요?

A: 모든 데이터는 `channelId`로 필터링됩니다. 각 채널은 독립적으로 관리되며, 공용 데이터(`channelId: null`)만 모든 채널에서 공유됩니다.

### Q2. 구버전 데이터는 어떻게 되나요?

A: 확장 프로그램 업데이트 시 자동으로 마이그레이션됩니다. 단일 채널 사용자는 해당 채널로, 다중 채널 사용자는 공용으로 설정됩니다.

### Q3. 경쟁 채널 데이터는 어디에 저장되나요?

A: 각 내 채널의 `competitors` 배열에 저장됩니다. 더 이상 전역으로 관리되지 않습니다.

---

**문서 작성일**: 2024년  
**최종 수정일**: 2024년  
**작성자**: Content Pilot 개발팀

