# GA4 추가 메트릭 확인 결과

## 요청된 메트릭/차원 목록

### 1. 📱 deviceCategory (디바이스 정보)
- **타입**: Dimension
- **목적**: 모바일 vs 데스크톱 트래픽 분석
- **GA4 API 지원**: ✅ 지원됨
- **추가 가능**: ✅ 가능
- **구현 방법**: 별도 API 요청으로 deviceCategory dimension 추가

### 2. 🌍 country (지역 정보)
- **타입**: Dimension
- **목적**: 국가별 트래픽 및 수익 분석
- **GA4 API 지원**: ✅ 지원됨 (country 또는 countryId)
- **추가 가능**: ✅ 가능
- **구현 방법**: 별도 API 요청으로 country dimension 추가

### 3. 🚪 landingPage (랜딩 페이지)
- **타입**: Dimension
- **목적**: SEO 유입 입구 페이지 분석
- **GA4 API 지원**: ✅ 지원됨 (landingPage 또는 unifiedPagePathScreen + isEntry)
- **추가 가능**: ✅ 가능
- **구현 방법**: 별도 API 요청으로 landingPage dimension 추가

### 4. 🖱️ eventCount (스크롤/클릭 이벤트)
- **타입**: Metric
- **목적**: 사용자 상호작용 분석 (스크롤 깊이, 클릭 수)
- **GA4 API 지원**: ✅ 지원됨 (eventCount + eventName dimension 필터)
- **추가 가능**: ✅ 가능
- **구현 방법**: 
  - eventName dimension 추가
  - dimensionFilter로 eventName == 'scroll' 또는 'click' 필터링
  - eventCount metric 사용

## 구현 계획

### 요청 구조

#### 요청 4: 디바이스 및 지역 정보
```javascript
{
  dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
  dimensions: [
    { name: "deviceCategory" },
    { name: "country" }
  ],
  metrics: [
    { name: "activeUsers" },
    { name: "totalAdRevenue" }
  ],
  dimensionFilter: {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
    }
  },
  orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
  limit: 10 // 상위 10개 조합만
}
```

#### 요청 5: 랜딩 페이지 정보
```javascript
{
  dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
  dimensions: [{ name: "landingPage" }],
  metrics: [
    { name: "sessions" },
    { name: "bounceRate" },
    { name: "averageSessionDuration" }
  ],
  dimensionFilter: {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
    }
  },
  orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  limit: 5 // 상위 5개 랜딩 페이지만
}
```

#### 요청 6: 스크롤/클릭 이벤트
```javascript
{
  dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
  dimensions: [{ name: "eventName" }],
  metrics: [{ name: "eventCount" }],
  dimensionFilter: {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        },
        {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: ["scroll", "click"]
            }
          }
        }
      ]
    }
  }
}
```

## 저장 구조

### Firebase 저장 필드 추가
```javascript
{
  // 기존 필드들...
  
  // 디바이스 정보
  deviceBreakdown: {
    mobile: { users: 0, revenue: 0 },
    desktop: { users: 0, revenue: 0 },
    tablet: { users: 0, revenue: 0 }
  },
  
  // 지역 정보 (상위 5개 국가)
  topCountries: [
    { country: "KR", users: 0, revenue: 0 },
    // ...
  ],
  
  // 랜딩 페이지 정보
  landingPages: [
    { page: "/entry/...", sessions: 0, bounceRate: 0 },
    // ...
  ],
  
  // 이벤트 정보
  events: {
    scroll: 0,
    click: 0
  }
}
```

## 주의사항

1. **API 호출 수 증가**: 현재 3개 요청 → 6개 요청으로 증가
2. **데이터 양 증가**: Firebase 저장 데이터 증가
3. **성능 고려**: 병렬 요청으로 처리하되, Quota 제한 주의
4. **UI 표시**: 성과 대시보드에 추가 정보 표시 필요

## 구현 완료 ✅

1. ✅ 메트릭/차원 사용 가능 여부 확인 완료
2. ✅ 코드 구현 완료
   - 요청 4: 디바이스 및 지역 정보 추가
   - 요청 5: 랜딩 페이지 정보 추가
   - 요청 6: 스크롤/클릭 이벤트 추가
   - 데이터 파싱 로직 추가
   - analyticsData 객체에 새 필드 추가
3. ⏳ Firebase 저장 구조 확장 (자동으로 저장됨)
4. ⏳ UI 표시 로직 추가 (필요 시)

## 구현 상세

### 추가된 API 요청

1. **디바이스 및 지역 정보 (요청 4)**
   - Dimensions: `deviceCategory`, `country`
   - Metrics: `activeUsers`, `totalAdRevenue`
   - Limit: 상위 10개 조합
   - 저장 필드: `deviceBreakdown`, `topCountries`

2. **랜딩 페이지 정보 (요청 5)**
   - Dimensions: `landingPage`
   - Metrics: `sessions`, `bounceRate`, `averageSessionDuration`
   - Limit: 상위 5개
   - 저장 필드: `landingPages`

3. **이벤트 정보 (요청 6)**
   - Dimensions: `eventName`
   - Metrics: `eventCount`
   - 필터: `eventName` in ["scroll", "click"]
   - 저장 필드: `events`

### 저장 데이터 구조

```javascript
{
  // 기존 필드들...
  
  // 디바이스 정보
  deviceBreakdown: {
    mobile: { users: 0, revenue: 0 },
    desktop: { users: 0, revenue: 0 },
    tablet: { users: 0, revenue: 0 }
  },
  
  // 지역 정보 (상위 5개 국가)
  topCountries: [
    { country: "KR", users: 0, revenue: 0 },
    // ...
  ],
  
  // 랜딩 페이지 정보
  landingPages: [
    { page: "/entry/...", sessions: 0, bounceRate: 0, avgSessionDuration: 0 },
    // ...
  ],
  
  // 이벤트 정보
  events: {
    scroll: 0,
    click: 0
  }
}
```

## 주의사항

1. **API 호출 수 증가**: 3개 → 6개 요청 (병렬 처리로 성능 영향 최소화)
2. **Quota 제한**: GA4 API Quota 제한 주의 (429 에러 처리 포함)
3. **에러 처리**: 각 요청이 실패해도 다른 요청은 계속 진행
4. **데이터 양**: Firebase 저장 데이터 증가 (자동 저장됨)

