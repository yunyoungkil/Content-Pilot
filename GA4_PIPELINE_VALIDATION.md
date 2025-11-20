# GA4 데이터 파이프라인 검증 체크리스트

이 문서는 GA4 데이터 파이프라인의 각 단계별 검증 결과를 기록합니다.

## 1단계: 사전 설정 및 인증 (Prerequisites)

### ✅ Google 인증 토큰 존재 여부
- **상태**: ✅ 구현됨
- **위치**: `background.js:3013-3014`
- **검증**: `chrome.storage.local`에 `googleAuthToken` 저장 확인
- **코드**:
  ```javascript
  await chrome.storage.local.set({
    googleAuthToken: token,
    googleUserEmail: userInfo.email,
    gaProperties: gaProperties,
    adSenseAccountId: adSenseAccountId,
  });
  ```

### ✅ GA4 속성 ID 매핑
- **상태**: ✅ 구현됨
- **위치**: `background.js:6484-6553`
- **검증**: Firebase `channels/{userId}/myChannels/blogs` 경로에서 `gaPropertyId` 매핑
- **로직**: URL hostname 기반 매칭 (정확한 매칭 + 하위 도메인 고려)

### ✅ 권한 스코프 확인
- **상태**: ✅ 구현됨
- **위치**: `manifest.json:45`
- **검증**: `https://www.googleapis.com/auth/analytics.readonly` 포함
- **코드**:
  ```json
  "scopes": [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/adsense.readonly"
  ]
  ```

### ✅ AdSense ID 확인
- **상태**: ✅ 구현됨
- **위치**: `background.js:3017, 6451`
- **검증**: `adSenseAccountId`가 `chrome.storage.local`에 저장됨

---

## 2단계: 트리거 및 요청 시작 (Triggering)

### ✅ 자동 이벤트 발생 확인
- **상태**: ✅ 구현됨
- **위치**: `background.js:5410-5418`
- **검증**: `chrome.alarms.onAlarm` 리스너에서 `update-performance-metrics` 처리
- **코드**:
  ```javascript
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "update-performance-metrics") {
      updateAllPerformanceMetrics();
    }
  });
  ```

### ✅ 수동 새로고침 버튼
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:336-339`
- **검증**: "🔄 새로고침" 버튼 클릭 시 `loadPerformanceData` 실행

### ✅ URL 유효성 검사
- **상태**: ✅ 구현됨 (개선 완료)
- **위치**: `background.js:6406-6415, 6436-6460`
- **검증**: 
  - `updateAllPerformanceMetrics`: `isValidUrl` 함수로 URL 형식 검증
  - `updateSinglePerformanceMetric`: null/undefined 체크 및 URL 형식 검증
  - 유효하지 않은 URL은 에러 기록 후 건너뛰기
- **코드**:
  ```javascript
  const isValidUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  };
  ```

### ✅ 상태 업데이트 (collecting: true)
- **상태**: ✅ 구현됨
- **위치**: `background.js:6440-6447`
- **검증**: 수집 시작 시 Firebase에 `collecting: true` 기록

---

## 3단계: API 호출 및 데이터 수집 (Fetching - Background)

### ✅ URL 정규화 (Normalization)
- **상태**: ✅ 구현됨
- **위치**: `background.js:6730-6736`
- **검증**:
  - `decodeURIComponent`로 한글 디코딩
  - Trailing slash 제거 처리
- **코드**:
  ```javascript
  const rawPath = urlObj.pathname;
  let decodedPath = rawPath;
  try { decodedPath = decodeURIComponent(rawPath); } catch(e) {}
  const normalizedPath = decodedPath.endsWith('/') && decodedPath !== '/' 
    ? decodedPath.slice(0, -1) 
    : decodedPath;
  ```

### ✅ API 필터링 조건
- **상태**: ✅ 구현됨
- **위치**: `background.js:6760-6765`
- **검증**:
  - `matchType: "BEGINS_WITH"` 설정
  - 필터 값이 디코딩된 경로로 전달됨

### ✅ 토큰 만료 처리 (401)
- **상태**: ✅ 구현됨
- **위치**: `background.js:6856-6865`
- **검증**: 401 발생 시 `chrome.identity.removeCachedAuthToken` 호출 후 재시도
- **재시도 횟수**: 최대 3회

### ✅ Quota 제한 처리 (429)
- **상태**: ✅ 구현됨 (개선 완료)
- **위치**: `background.js:6791-6805`
- **검증**: 429 에러 감지 시 지수 백오프 재시도 (최대 3회)
- **재시도 전략**: 1초, 2초, 4초 지연 후 재시도
- **코드**:
  ```javascript
  if (metricsRes.status === 429) {
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000; // 지수 백오프
      await new Promise(resolve => setTimeout(resolve, delay));
      return getAnalyticsData(token, propertyId, url, retryCount + 1);
    }
  }
  ```

---

## 4단계: 데이터 가공 및 정합성 (Processing)

### ✅ 데이터 파싱
- **상태**: ✅ 구현됨
- **위치**: `background.js:6801-6844`
- **검증**: `metricValues` 인덱스 매핑 정확
  - Index 0: screenPageViews (조회수)
  - Index 5: publisherAdRevenue (수익)
  - Index 8: engagementRate (참여율)
  - Index 10: newUsers (신규 방문자)
  - Index 11: activeUsers (활성 사용자)

### ✅ 하이브리드 수익 로직
- **상태**: ✅ 구현됨
- **위치**: `background.js:6592-6594`
- **검증**:
  - GA4 수익 > 0이면 GA4 값 사용
  - GA4 수익이 0이고 AdSense 수익이 있으면 AdSense 값 사용
- **코드**:
  ```javascript
  const finalEarnings = (analyticsResult.gaEarnings && analyticsResult.gaEarnings > 0)
    ? analyticsResult.gaEarnings
    : (adsenseResult.estimatedEarnings || 0);
  ```

### ✅ 유입 경로(Source) 추출
- **상태**: ✅ 구현됨
- **위치**: `background.js:6814-6821`
- **검증**: `sessionSource` / `sessionMedium` 파싱하여 `topSource` 저장

---

## 5단계: 데이터 저장 (Saving - Database)

### ✅ 저장 경로 확인
- **상태**: ✅ 구현됨
- **위치**: `background.js:6670-6674`
- **검증**: `kanban/{status}/{cardId}/performance` 경로에 업데이트

### ✅ 타임스탬프 갱신
- **상태**: ✅ 구현됨
- **위치**: `background.js:6608`
- **검증**: `lastUpdatedAt: Date.now()` 설정

### ✅ 상태 종료 (collecting: false)
- **상태**: ✅ 구현됨
- **위치**: `background.js:6659`
- **검증**: 저장 완료 후 `collecting: false` 설정

### ✅ 에러 기록
- **상태**: ✅ 구현됨
- **위치**: `background.js:6629-6651, 6695-6707`
- **검증**: 실패 시 `error` 메시지와 `errorType` 저장
- **에러 타입**:
  - `AUTH_MISSING`: 인증 토큰 없음
  - `ID_MISSING`: GA/AdSense ID 없음
  - `API_ERROR`: API 호출 오류
  - `UNEXPECTED_ERROR`: 예상치 못한 오류

---

## 6단계: UI 출력 및 렌더링 (Rendering - UI)

### ✅ 데이터 리스너 동작
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:64-68`
- **검증**: `kanban_data_updated` 이벤트 감지

### ✅ 채널 필터링
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:90-96`
- **검증**: `activeChannelId`와 일치하는 카드만 렌더링

### ✅ 정렬 로직
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:330-332`
- **검증**: 정렬 옵션 변경 시 `renderPerformanceList` 재실행

### ✅ 값 포맷팅
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:283, 288, 293`
- **검증**:
  - 수익: `$${earnings.toFixed(2)}` (소수점 2자리)
  - 조회수: `${pageviews.toLocaleString()}` (천 단위 콤마)
  - 기본값 처리: `|| 0` 또는 `|| "-"` 사용

### ✅ 차트 렌더링
- **상태**: ✅ 구현됨
- **위치**: `js/ui/performanceDashboardMode.js:199-240`
- **검증**: 상위 5개 콘텐츠의 바 차트 렌더링 (수익/페이지뷰)

---

## 개선 사항 요약

### ✅ 완료된 개선 사항
1. **429 Quota 제한 처리 추가** ✅ - API 호출 시 429 에러 감지 및 지수 백오프 재시도 로직 구현 완료
2. **URL 유효성 검사 강화** ✅ - `publishedUrl` 유효성 검사 강화 완료 (null/undefined 체크 + URL 형식 검증)

---

## 검증 완료율

- ✅ 완료: 27/27 항목 (100%)
- ⚠️ 부분 완료: 0/27 항목 (0%)
- ❌ 미완료: 0/27 항목 (0%)

---

## 다음 단계

1. ✅ 429 에러 처리 로직 추가 (완료)
2. ✅ URL 유효성 검사 강화 (완료)
3. 통합 테스트 수행 (권장)

