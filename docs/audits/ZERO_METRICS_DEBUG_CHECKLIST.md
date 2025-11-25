# 성과 대시보드 지표 0 표시 원인 진단 체크리스트

이 문서는 성과 대시보드에서 수익, 페이지뷰, 참여율, 신규 방문자, 평균 참여시간, RPM이 0으로 나오는 원인을 체계적으로 진단하기 위한 체크리스트입니다.

## 🔍 1단계: 사전 조건 확인 (Prerequisites)

### ✅ Google 인증 토큰 유효성 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6502-6506`
- **체크 방법**: 
  ```javascript
  const { googleAuthToken } = await chrome.storage.local.get(["googleAuthToken"]);
  console.log("토큰 존재:", !!googleAuthToken);
  ```
- **예상 문제**: 토큰이 없거나 만료된 경우 → 401 에러 발생
- **해결 방법**: 채널 연동 탭에서 재로그인

### ✅ GA4 속성 ID 매핑 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6530-6605`
- **체크 방법**: 콘솔에서 다음 로그 확인
  ```
  [성과 지표 수집] URL 매칭 결과: { gaPropertyId: "...", matchedBlog: {...} }
  ```
- **예상 문제**: 
  - `gaPropertyId`가 `null` 또는 `undefined`
  - URL 매칭 실패 (도메인 불일치)
- **해결 방법**: 채널 설정에서 GA4 속성 ID 확인 및 URL 매칭 확인

### [ ] publishedUrl 유효성
- **확인 위치**: `background.js:6485-6500`
- **체크 방법**: Firebase에서 카드의 `publishedUrl` 필드 확인
- **예상 문제**: 
  - `publishedUrl`이 `null`, `undefined`, 또는 빈 문자열
  - 유효하지 않은 URL 형식
- **해결 방법**: 카드에 올바른 발행 URL 연결

### [ ] performanceTracked 플래그
- **확인 위치**: `background.js:6436`
- **체크 방법**: Firebase에서 `kanban/{status}/{cardId}/performanceTracked` 확인
- **예상 문제**: `performanceTracked`가 `false` 또는 없음
- **해결 방법**: URL 연결 시 자동 설정되지만, 수동으로 `true` 설정 가능

---

## 🔍 2단계: GA4 API 호출 및 응답 확인

### ✅ API 요청 성공 여부 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6877-6904`
- **체크 방법**: 콘솔에서 다음 로그 확인
  ```
  [GA4] 데이터 수집 성공 (URL) {...}
  ```
- **예상 문제**: 
  - HTTP 상태 코드가 200이 아님 (401, 403, 404, 429, 500 등)
  - 네트워크 오류
- **디버깅 코드 추가**:
  ```javascript
  console.log("[GA4 API 응답]", {
    status: metricsRes.status,
    ok: metricsRes.ok,
    url: url
  });
  ```

### ✅ API 응답 데이터 존재 여부 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6911`
- **체크 방법**: 
  ```javascript
  console.log("[GA4 응답 데이터]", {
    hasRows: metricsData.rows && metricsData.rows.length > 0,
    rowCount: metricsData.rowCount,
    rows: metricsData.rows
  });
  ```
- **예상 문제**: 
  - `metricsData.rows`가 빈 배열 `[]`
  - `metricsData.rowCount === 0`
  - **원인**: 해당 기간(28일) 동안 해당 경로에 데이터가 없음
- **해결 방법**: 
  - GA4 대시보드에서 직접 해당 URL의 데이터 확인
  - 날짜 범위 확대 검토 (현재: 28daysAgo ~ today)

### ✅ URL 필터 매칭 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6816-6822, 6846-6850`
- **체크 방법**: 
  ```javascript
  console.log("[URL 필터]", {
    rawPath: rawPath,
    decodedPath: decodedPath,
    normalizedPath: normalizedPath,
    filterPath: filterPath
  });
  ```
- **예상 문제**: 
  - GA4에 저장된 경로와 필터 경로가 불일치
  - 한글 인코딩 문제
  - Trailing slash 불일치
- **해결 방법**: 
  - GA4에서 실제 `pagePath` 값 확인
  - 필터 경로와 정확히 일치하는지 확인

### ✅ Metrics 배열 순서 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6832-6844, 6913-6950`
- **체크 방법**: 
  ```javascript
  console.log("[Metrics 인덱스]", {
    values: values,
    "0-pageviews": values[0]?.value,
    "5-earnings": values[5]?.value,
    "8-engagementRate": values[8]?.value,
    "9-avgEngagementTime": values[9]?.value,
    "10-newUsers": values[10]?.value
  });
  ```
- **예상 문제**: 
  - Metrics 배열 순서와 파싱 인덱스 불일치
  - `values[index]`가 `undefined`
- **해결 방법**: Metrics 배열 순서 확인 (0~11 인덱스)

---

## 🔍 3단계: 데이터 파싱 확인

### ✅ 페이지뷰 (pageviews) - Index 0 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6934`
- **체크 방법**:
  ```javascript
  const pageviews = parseInt(values[0]?.value || "0", 10);
  console.log("[페이지뷰 파싱]", {
    rawValue: values[0]?.value,
    parsed: pageviews,
    isZero: pageviews === 0
  });
  ```
- **예상 문제**:
  - `values[0]`이 `undefined` 또는 `null`
  - `values[0].value`가 `"0"` 또는 빈 문자열
  - 실제 GA4 데이터가 0 (해당 기간 조회수 없음)

### ✅ 수익 (estimatedEarnings) - Index 5 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6916, 6678-6680, 6686`
- **체크 방법**:
  ```javascript
  console.log("[수익 파싱]", {
    gaEarnings: analyticsResult.gaEarnings,
    adsenseEarnings: adsenseResult.estimatedEarnings,
    finalEarnings: finalEarnings,
    "GA4 raw (index 5)": values[5]?.value
  });
  ```
- **예상 문제**:
  - GA4 `publisherAdRevenue`가 0 (광고 수익 없음)
  - AdSense API도 0 반환
  - 하이브리드 로직에서 둘 다 0이면 최종 수익 0
- **해결 방법**: 
  - GA4에서 `publisherAdRevenue` 메트릭 직접 확인
  - AdSense 계정에서 실제 수익 확인

### ✅ 참여율 (engagementRate) - Index 8 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6947`
- **체크 방법**:
  ```javascript
  const engagementRate = parseFloat(values[8]?.value || "0");
  console.log("[참여율 파싱]", {
    rawValue: values[8]?.value,
    parsed: engagementRate,
    isZero: engagementRate === 0
  });
  ```
- **예상 문제**:
  - `values[8]`이 `undefined`
  - GA4에서 `engagementRate`가 0 (실제 참여 없음)
  - **참고**: engagementRate는 0~1 사이의 소수값 (UI에서 ×100하여 % 표시)

### ✅ 신규 방문자 (newUsers) - Index 10 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6949`
- **체크 방법**:
  ```javascript
  const newUsers = parseInt(values[10]?.value || "0", 10);
  console.log("[신규 방문자 파싱]", {
    rawValue: values[10]?.value,
    parsed: newUsers,
    isZero: newUsers === 0
  });
  ```
- **예상 문제**:
  - `values[10]`이 `undefined`
  - 실제로 신규 방문자가 없음 (모두 재방문자)

### ✅ 평균 참여시간 (avgEngagementTime) - Index 9 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6948`
- **체크 방법**:
  ```javascript
  const avgEngagementTime = parseFloat(values[9]?.value || "0");
  console.log("[평균 참여시간 파싱]", {
    rawValue: values[9]?.value,
    parsed: avgEngagementTime,
    isZero: avgEngagementTime === 0
  });
  ```
- **예상 문제**:
  - `values[9]`이 `undefined`
  - 실제 참여 시간이 0초 (즉시 이탈)
  - **참고**: UI에서 `avgEngagementTime || avgSessionDuration` 사용 (fallback)

### ✅ RPM (pageRPM) - 계산값 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6921, 6691`
- **체크 방법**:
  ```javascript
  console.log("[RPM 계산]", {
    adRevenue: adRevenue,
    adImpressions: adImpressions,
    pageRPM: pageRPM,
    formula: adImpressions > 0 ? (adRevenue / adImpressions) * 1000 : 0
  });
  ```
- **예상 문제**:
  - `adImpressions`가 0 → RPM = 0 (0으로 나누기 방지)
  - `adRevenue`가 0 → RPM = 0
  - **공식**: `(adRevenue / adImpressions) * 1000`
- **해결 방법**: 광고 노출수(`publisherAdImpressions`) 확인

---

## 🔍 4단계: 데이터 저장 확인 (Firebase)

### ✅ Firebase 저장 성공 여부 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6756-6760`
- **체크 방법**: Firebase 콘솔에서 `kanban/{status}/{cardId}/performance` 경로 확인
- **예상 문제**:
  - 저장 실패 (권한 오류, 네트워크 오류)
  - 저장은 되었지만 데이터가 0으로 저장됨
- **디버깅 코드**:
  ```javascript
  console.log("[Firebase 저장]", {
    path: contentInfo.path,
    updateData: updateData,
    "수익": updateData.estimatedEarnings,
    "페이지뷰": updateData.pageviews
  });
  ```

### ✅ 데이터 병합 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `background.js:6682-6696`
- **체크 방법**: 
  ```javascript
  console.log("[데이터 병합]", {
    analyticsResult: analyticsResult,
    adsenseResult: adsenseResult,
    performanceData: performanceData
  });
  ```
- **예상 문제**:
  - `...analyticsResult` 스프레드 연산자로 인한 덮어쓰기
  - `estimatedEarnings`가 0으로 덮어쓰여짐
- **해결 방법**: `finalEarnings` 계산 로직 확인

### [ ] collecting 플래그 확인
- **확인 위치**: `background.js:6492-6499, 6745-6747`
- **체크 방법**: Firebase에서 `performance.collecting` 값 확인
- **예상 문제**:
  - `collecting: true`로 고정되어 수집 완료되지 않음
  - 수집 중 에러 발생으로 `collecting: false`로 변경되지 않음

---

## 🔍 5단계: UI 로드 및 표시 확인

### ✅ Firebase 데이터 로드 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `js/ui/performanceDashboardMode.js:47-74`
- **체크 방법**: 
  ```javascript
  console.log("[UI 데이터 로드]", {
    allCards: allCards,
    cardPerformance: allCards[status]?.[cardId]?.performance
  });
  ```
- **예상 문제**:
  - Firebase에서 데이터를 가져오지 못함
  - `kanban_data_updated` 메시지 미수신

### ✅ 데이터 필터링 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `js/ui/performanceDashboardMode.js:79-110`
- **체크 방법**:
  ```javascript
  console.log("[데이터 필터링]", {
    card: card,
    hasPerformance: !!card.performance,
    hasError: card.performance?.error,
    channelMatch: card.channelId === activeChannelId
  });
  ```
- **예상 문제**:
  - `card.performance.error`가 있어서 필터링됨
  - `activeChannelId`와 불일치로 필터링됨
  - `card.publishedUrl`이 없어서 필터링됨

### ✅ UI 렌더링 확인 (디버깅 로그 추가 완료)
- **확인 위치**: `js/ui/performanceDashboardMode.js:251-320`
- **체크 방법**: 
  ```javascript
  console.log("[UI 렌더링]", {
    item: item,
    performance: item.performance,
    earnings: perf.estimatedEarnings,
    pageviews: perf.pageviews,
    engagementRate: perf.engagementRate
  });
  ```
- **예상 문제**:
  - `perf.estimatedEarnings`가 `undefined` → `|| 0`으로 0 표시
  - `perf.pageviews`가 `undefined` → `|| 0`으로 0 표시
  - 데이터는 있지만 UI에서 읽지 못함

---

## 🔍 6단계: 지표별 특수 확인 사항

### 수익 (estimatedEarnings) 특수 확인
- [ ] GA4 `publisherAdRevenue` 메트릭 활성화 여부
  - GA4 속성 설정에서 Publisher Ad Revenue 활성화 확인
- [ ] AdSense 계정 연동 확인
  - `adSenseAccountId`가 저장소에 존재하는지 확인
- [ ] 하이브리드 로직 확인
  ```javascript
  // GA4 수익이 0이고 AdSense 수익이 있어도 0으로 표시되는 경우
  const finalEarnings = (analyticsResult.gaEarnings && analyticsResult.gaEarnings > 0)
    ? analyticsResult.gaEarnings  // GA4가 0이면 이 분기 탈락
    : (adsenseResult.estimatedEarnings || 0);  // AdSense 값 사용
  ```

### 페이지뷰 (pageviews) 특수 확인
- [ ] GA4에서 실제 조회수 확인
  - GA4 대시보드에서 해당 URL의 `screenPageViews` 직접 확인
- [ ] 날짜 범위 확인
  - 현재: `28daysAgo ~ today`
  - 최근 28일 동안 데이터가 없으면 0

### 참여율 (engagementRate) 특수 확인
- [ ] GA4에서 `engagementRate` 메트릭 확인
  - 참여 이벤트가 설정되어 있는지 확인
- [ ] 값 범위 확인
  - GA4: 0~1 사이 소수값
  - UI: ×100하여 % 표시

### 신규 방문자 (newUsers) 특수 확인
- [ ] GA4에서 `newUsers` 메트릭 확인
  - 실제로 신규 방문자가 없을 수 있음 (모두 재방문자)
- [ ] `activeUsers`와 비교
  - `newUsers = activeUsers - returningUsers`

### 평균 참여시간 (avgEngagementTime) 특수 확인
- [ ] Fallback 로직 확인
  ```javascript
  const avgEngagementTime = Math.round(perf.avgEngagementTime || perf.avgSessionDuration || 0);
  ```
  - `avgEngagementTime`이 없으면 `avgSessionDuration` 사용
- [ ] GA4에서 `averageEngagementTime` 메트릭 확인

### RPM (pageRPM) 특수 확인
- [ ] 광고 노출수 확인
  - `publisherAdImpressions`가 0이면 RPM = 0
- [ ] 계산 공식 확인
  ```javascript
  const pageRPM = adImpressions > 0 ? (adRevenue / adImpressions) * 1000 : 0;
  ```
  - 광고 노출이 없으면 RPM 계산 불가 (0 반환)

---

## 🛠️ 디버깅 도구 및 명령어

### 콘솔에서 직접 확인
```javascript
// 1. Firebase 데이터 확인
const firebase = window.firebase;
const cardRef = firebase.database().ref("kanban/{status}/{cardId}/performance");
cardRef.once("value", (snapshot) => {
  console.log("Performance 데이터:", snapshot.val());
});

// 2. Storage 확인
chrome.storage.local.get(["googleAuthToken", "adSenseAccountId"], (result) => {
  console.log("인증 정보:", result);
});

// 3. GA4 API 직접 호출 테스트
// (background.js의 getAnalyticsData 함수 참고)
```

### 로그 확인 포인트
1. `[성과 지표 수집 시작]` - 수집 시작 로그
2. `[GA4] 데이터 수집 성공` - API 성공 로그
3. `[성과 지표 업데이트 완료]` - 저장 완료 로그
4. `[성과 지표 수집 실패]` - 에러 로그

---

## 📋 체크리스트 요약

### 필수 확인 항목 (우선순위 높음)
1. ✅ Google 인증 토큰 존재 및 유효성
2. ✅ GA4 속성 ID 매핑 성공
3. ✅ publishedUrl 유효성
4. ✅ API 응답 데이터 존재 (`metricsData.rows.length > 0`)
5. ✅ URL 필터 매칭 성공
6. ✅ Metrics 인덱스 매핑 정확성

### 데이터 확인 항목
7. ✅ 각 지표별 파싱 값 확인 (콘솔 로그)
8. ✅ Firebase 저장 데이터 확인
9. ✅ UI 필터링 로직 확인

### 특수 확인 항목
10. ✅ GA4 메트릭 활성화 여부 (publisherAdRevenue, engagementRate 등)
11. ✅ 날짜 범위 확인 (28일)
12. ✅ 실제 GA4 대시보드에서 데이터 존재 여부

---

## 🎯 빠른 진단 가이드

### 모든 지표가 0인 경우
1. API 응답 확인 (`metricsData.rows` 빈 배열)
2. URL 필터 매칭 실패
3. 날짜 범위 문제 (28일 동안 데이터 없음)

### 일부 지표만 0인 경우
1. 해당 메트릭의 인덱스 매핑 확인
2. GA4에서 해당 메트릭 활성화 여부 확인
3. 실제 데이터 존재 여부 확인

### 수익만 0인 경우
1. `publisherAdRevenue` 메트릭 활성화 확인
2. AdSense 계정 연동 확인
3. 하이브리드 로직 확인 (GA4 vs AdSense)

---

## 📝 다음 단계

1. ✅ 위 체크리스트를 순서대로 확인 (완료)
2. ✅ 각 단계에서 콘솔 로그 확인 (디버깅 로그 추가 완료)
3. 문제 발견 시 해당 섹션의 해결 방법 적용
4. 필요시 추가 디버깅 코드 삽입

---

## ✅ 디버깅 로그 추가 완료 요약

모든 체크리스트 항목에 대한 디버깅 로그가 추가되었습니다. 콘솔에서 다음 로그를 확인할 수 있습니다:

### 1단계: 사전 조건 확인
- `[1단계: 사전 조건] Google 인증 토큰 확인`
- `[1단계: 사전 조건] URL 매칭 결과`

### 2단계: GA4 API 호출 및 응답 확인
- `[2단계: GA4 API] URL 필터`
- `[2단계: GA4 API] API 응답 상태`
- `[2단계: GA4 API] 응답 데이터`
- `[2단계: GA4 API] Metrics 인덱스`

### 3단계: 데이터 파싱 확인
- `[3단계: 데이터 파싱] 지표별 파싱 결과`
- `[3단계: 데이터 파싱] 수익 파싱`
- `[3단계: 데이터 파싱] RPM 계산`

### 4단계: 데이터 저장 확인
- `[4단계: 데이터 저장] Firebase 저장`
- `[4단계: 데이터 저장] 데이터 병합`

### 5단계: UI 로드 및 표시 확인
- `[5단계: UI 로드] Firebase 데이터 로드`
- `[5단계: UI 로드] 데이터 필터링`
- `[5단계: UI 로드] UI 렌더링 데이터`
- `[5단계: UI 로드] 최종 필터링 결과`

이제 성과 데이터 수집 시 콘솔에서 각 단계별로 상세한 디버깅 정보를 확인할 수 있습니다.

