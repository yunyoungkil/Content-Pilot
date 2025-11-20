# 현재 GA4에서 수집하는 데이터 목록

## 📊 수집 기간
- **날짜 범위**: 최근 28일 (`28daysAgo ~ today`)

## 📈 수집하는 메트릭 (12개)

### 기본 성과 지표 (8개)

1. **screenPageViews** (Index 0)
   - **한글명**: 조회수 / 페이지뷰
   - **저장 필드**: `pageviews`
   - **타입**: 정수

2. **averageSessionDuration** (Index 1)
   - **한글명**: 평균 세션 지속 시간
   - **저장 필드**: `avgSessionDuration`
   - **타입**: 초 (소수)

3. **sessions** (Index 2)
   - **한글명**: 세션 수
   - **저장 필드**: `sessions`
   - **타입**: 정수

4. **screenPageViewsPerSession** (Index 3)
   - **한글명**: 세션당 페이지 수
   - **저장 필드**: `pagesPerSession`
   - **타입**: 소수

5. **bounceRate** (Index 4)
   - **한글명**: 이탈률
   - **저장 필드**: `bounceRate`
   - **타입**: 소수 (0~1)

6. **publisherAdRevenue** (Index 5)
   - **한글명**: 광고 수익
   - **저장 필드**: `gaEarnings` → `estimatedEarnings` (하이브리드 로직)
   - **타입**: 달러 (소수)
   - **특이사항**: AdSense 수익과 병합하여 최종 수익 결정

7. **publisherAdImpressions** (Index 6)
   - **한글명**: 광고 노출수
   - **저장 필드**: `gaImpressions` / `adImpressions`
   - **타입**: 정수

8. **publisherAdClicks** (Index 7)
   - **한글명**: 광고 클릭수
   - **저장 필드**: `gaClicks` / `adClicks`
   - **타입**: 정수

### 성장 지표 (4개)

9. **engagementRate** (Index 8)
   - **한글명**: 참여율
   - **저장 필드**: `engagementRate`
   - **타입**: 소수 (0~1)
   - **UI 표시**: ×100하여 %로 표시

10. **averageEngagementTime** (Index 9)
    - **한글명**: 평균 참여 시간
    - **저장 필드**: `avgEngagementTime`
    - **타입**: 초 (소수)
    - **Fallback**: `avgSessionDuration` 사용

11. **newUsers** (Index 10)
    - **한글명**: 신규 방문자
    - **저장 필드**: `newUsers`
    - **타입**: 정수

12. **activeUsers** (Index 11)
    - **한글명**: 활성 사용자
    - **저장 필드**: `activeUsers`
    - **타입**: 정수

## 🔍 추가 수집 데이터

### 유입 경로 분석
- **Dimensions**: `sessionSource`, `sessionMedium`
- **저장 필드**: `topSource`
- **형식**: `"{source} / {medium}"` (예: "google / organic")
- **정렬**: `activeUsers` 기준 내림차순
- **제한**: 상위 1개만 수집

### 파생 지표 (계산값)

1. **pageRPM** (페이지 RPM)
   - **공식**: `(adRevenue / adImpressions) * 1000`
   - **저장 필드**: `pageRPM`
   - **설명**: 1,000회 광고 노출당 수익

2. **pageCTR** (페이지 CTR)
   - **공식**: `(adClicks / adImpressions) * 100`
   - **저장 필드**: `pageCTR`
   - **설명**: 광고 클릭률 (%)

3. **returningUsers** (재방문자)
   - **공식**: `activeUsers - newUsers`
   - **저장 필드**: `returningUsers`
   - **설명**: 재방문자 수

## 📋 API 요청 구조

### 요청 1: 핵심 성과 지표
```javascript
{
  dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
  dimensions: [{ name: "pagePath" }],
  metrics: [
    // 위 12개 메트릭
  ],
  dimensionFilter: {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
    }
  }
}
```

### 요청 2: 유입 경로 분석
```javascript
{
  dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
  dimensions: [
    { name: "sessionSource" },
    { name: "sessionMedium" }
  ],
  metrics: [{ name: "activeUsers" }],
  orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
  limit: 1,
  dimensionFilter: {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
    }
  }
}
```

## 💾 Firebase 저장 구조

```javascript
{
  // 기본 지표
  pageviews: number,
  avgSessionDuration: number,
  sessions: number,
  pagesPerSession: number,
  bounceRate: number,
  
  // 수익 관련
  gaEarnings: number,           // GA4 수익
  estimatedEarnings: number,    // 최종 수익 (하이브리드)
  gaImpressions: number,
  gaClicks: number,
  pageRPM: number,
  pageCTR: number,
  
  // 성장 지표
  engagementRate: number,
  avgEngagementTime: number,
  newUsers: number,
  activeUsers: number,
  returningUsers: number,
  
  // 유입 경로
  topSource: string,
  
  // 메타데이터
  lastUpdatedAt: number,
  collecting: boolean,
  collectingStartedAt: number,
  collectingCompletedAt: number,
  collectionDuration: number
}
```

## 🎯 UI에서 표시되는 지표

성과 대시보드(`performanceDashboardMode.js`)에서 표시되는 주요 지표:

1. ✅ **수익** (`estimatedEarnings`)
2. ✅ **페이지뷰** (`pageviews`)
3. ✅ **참여율** (`engagementRate` × 100)
4. ✅ **신규 방문자** (`newUsers`)
5. ✅ **평균 참여시간** (`avgEngagementTime` 또는 `avgSessionDuration`)
6. ✅ **RPM** (`pageRPM`)

## 📝 참고사항

- 모든 메트릭은 **최근 28일** 기준으로 수집됩니다
- URL 필터는 `BEGINS_WITH` 방식으로 매칭됩니다
- 한글 경로는 `decodeURIComponent`로 디코딩 후 사용됩니다
- Trailing slash(/)는 자동으로 제거됩니다
- 수익은 GA4와 AdSense를 병합한 하이브리드 로직을 사용합니다

