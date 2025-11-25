# 제휴 마케팅 링크 가이드

> **최종 업데이트**: 2025-01-27  
> **상태**: ✅ 최신

## 📋 개요

Content Pilot의 제휴 마케팅 링크 기능은 AI가 글의 문맥을 이해하고, 구매 의도가 발생하는 순간에 자연스럽게 제휴 링크를 삽입하여 수익화를 극대화하는 기능입니다.

## ✨ 주요 특징

### 1. 문맥 인식 자동 삽입 (Context-Aware Injection)
- 단순 키워드 치환이 아닌, 글의 흐름을 이해하고 적절한 위치에 링크 삽입
- 구매 의도가 발생하는 순간을 AI가 자동으로 감지
- 예: 상품의 장점 설명 후, 비교 분석 후, 사용 방법 언급 후

### 2. AI 기반 CTA 자동 생성
- 문맥에 어울리는 매력적인 클릭 유도 문구 자동 생성
- 예: "최저가 확인하기", "더 자세한 스펙 보기", "사용자 후기 모음", "현재 할인 가격 알아보기"

### 3. 스마트 필터링
- 글의 제목, 태그, 설명과 관련된 링크만 선별
- 프롬프트 토큰 낭비 방지 및 정확도 향상
- 최대 10개까지만 프롬프트에 포함

### 4. 품질 보장
- 최대 3개까지만 삽입하여 글의 품질 유지
- 과도한 광고로 인한 독자 이탈 방지

### 5. 시각적 강조
- 녹색 텍스트 스타일(`#2e7d32`)로 제휴 링크 강조
- 독자의 시선을 자연스럽게 유도

## 🗂️ 데이터 구조

### Firebase 저장 경로
```
affiliate_links/{userId}/{linkKey}
```

### 링크 데이터 구조
```javascript
{
  keyword: "아이폰",                    // 필수: 키워드
  productName: "아이폰 15",             // 선택: 상품명
  url: "https://coupang.com/vp/products/...", // 필수: 제휴 링크 URL
  description: "아이폰 15 최신 모델",   // 선택: 설명
  createdAt: 1234567890                 // 선택: 생성 시간 (타임스탬프)
}
```

### 필드 설명
- **keyword** (필수): 글의 제목, 태그와 매칭되는 키워드
- **productName** (선택): 상품명 (키워드 매칭에 보조적으로 사용)
- **url** (필수): 제휴 링크 URL (쿠팡, 네이버 쇼핑 등)
- **description** (선택): 링크에 대한 설명
- **createdAt** (선택): 생성 시간 (밀리초 타임스탬프)

## 🚀 사용 방법

### 1. 제휴 링크 등록

#### 방법 1: 테스트 스크립트 사용 (개발/테스트용)
1. Chrome 확장 프로그램 > Service Worker > Console 탭 열기
2. `test-add-affiliate-links.js` 파일 내용을 복사하여 콘솔에 붙여넣기
3. Enter 키를 눌러 실행
4. 자동으로 인증 토큰을 가져와 Firebase에 테스트 데이터 추가

#### 방법 2: Firebase 콘솔에서 직접 추가
1. Firebase Realtime Database 콘솔 접속
2. `affiliate_links/{userId}` 경로로 이동
3. 새 키 생성 후 링크 데이터 입력

### 2. 초안 생성 시 자동 삽입

1. 워크스페이스에서 "AI 초안 생성" 버튼 클릭
2. AI가 자동으로 관련 제휴 링크를 조회하고 필터링
3. 초안 생성 시 문맥에 맞게 링크 삽입
4. 녹색 스타일로 표시된 제휴 링크 확인

## 🔍 작동 원리

### 1. 링크 조회 및 필터링
```javascript
// aiService.js 내부
const contextForLinks = `${ideaData.title} ${(ideaData.tags || []).join(' ')} ${ideaData.description || ''}`;
const affiliateLinks = await getRelevantAffiliateLinks(userId, contextForLinks);
```

**필터링 로직**:
- 글의 제목, 태그, 설명에 키워드가 포함된 링크만 선택
- `productName`도 매칭에 사용
- 최대 10개까지만 반환 (프롬프트 과부하 방지)

### 2. 프롬프트 주입
```javascript
// 제휴 링크 삽입 규칙이 프롬프트에 추가됨
affiliateLinksPrompt = `
  ### 10. 제휴 마케팅 링크 (수익화) - [매우 중요]
  [제휴 링크 목록]
  - 키워드: "아이폰" / URL: https://coupang.com/...
  
  [링크 삽입 규칙]
  1. 문맥 기반 자연스러운 삽입
  2. AI 기반 CTA 자동 생성
  3. 최대 3개까지만 삽입
  4. 녹색 텍스트 스타일 적용
`;
```

### 3. AI가 링크 삽입
- AI가 글의 문맥을 이해하고 적절한 위치에 링크 삽입
- 매력적인 CTA 문구 자동 생성
- 녹색 스타일(`<span style="color: #2e7d32;">`)로 감싸서 삽입

### 4. HTML 정제 및 스타일 보존
```javascript
// offscreen.js에서 제휴 링크 스타일 보존
const parentSpan = a.closest('span[style*="#2e7d32"]');
if (parentSpan) {
  // 녹색 스타일 유지
  a.style.color = '#2e7d32';
}
```

## 📝 예시

### 입력 데이터
```javascript
{
  title: "아이폰 15 사용 후기",
  tags: ["아이폰", "스마트폰", "리뷰"],
  description: "아이폰 15를 사용한 후기를 공유합니다."
}
```

### 등록된 제휴 링크
```javascript
{
  keyword: "아이폰",
  productName: "아이폰 15",
  url: "https://coupang.com/vp/products/1234567890"
}
```

### 생성된 초안 예시
```html
<p>아이폰 15의 성능이 정말 인상적입니다. 특히 카메라 기능이 뛰어나서 사진 촬영이 즐거워졌어요.</p>

<p>더 자세한 스펙과 현재 할인 정보는 <span style="color: #2e7d32;"><a href="https://coupang.com/vp/products/1234567890">아이폰 15 최저가 확인하기</a></span>에서 확인할 수 있습니다.</p>
```

## ⚙️ 설정 및 커스터마이징

### 링크 개수 제한
- 기본값: 최대 3개
- 프롬프트에서 변경 가능: `generateDraftFromIdea` 함수 내 `affiliateLinksPrompt` 수정

### 스타일 색상 변경
- 기본값: `#2e7d32` (녹색)
- 변경 위치: `offscreen.js`의 `sanitizeAndFormatHtml` 함수

### 필터링 로직 커스터마이징
- 위치: `aiService.js`의 `getRelevantAffiliateLinks` 함수
- 키워드 매칭 로직 수정 가능

## 🔒 보안 및 권한

### Firebase 보안 규칙
```json
{
  "rules": {
    "affiliate_links": {
      "$userId": {
        ".read": "$userId === auth.uid",
        ".write": "$userId === auth.uid"
      }
    }
  }
}
```

### 인증 토큰
- Google OAuth 토큰을 사용하여 Firebase에 접근
- `getCurrentUserId()` 함수로 사용자 ID 확인
- `background.js`의 `get_auth_token` 액션으로 토큰 가져오기

## 🐛 문제 해결

### 링크가 삽입되지 않는 경우
1. **키워드 매칭 확인**: 글의 제목/태그에 링크의 키워드가 포함되어 있는지 확인
2. **Firebase 데이터 확인**: `affiliate_links/{userId}` 경로에 데이터가 있는지 확인
3. **로그 확인**: Service Worker 콘솔에서 `[getRelevantAffiliateLinks]` 로그 확인

### 스타일이 적용되지 않는 경우
1. **HTML 정제 확인**: `offscreen.js`의 스타일 보존 로직 확인
2. **부모 span 확인**: 링크가 `<span style="color: #2e7d32;">`로 감싸져 있는지 확인

### 토큰 오류 (401 Permission denied)
1. **로그인 확인**: 확장 프로그램에서 Google 로그인 상태 확인
2. **토큰 갱신**: `background.js`의 `refresh_auth_token` 액션 사용
3. **Firebase 보안 규칙**: 사용자 ID와 일치하는지 확인

## 📊 성과 측정

### 추적 가능한 지표
- 제휴 링크 클릭률 (각 링크별)
- 제휴 링크 수익 (각 링크별)
- 링크 삽입 위치별 성과

### 개선 방향
- 링크 삽입 위치 최적화
- CTA 문구 A/B 테스팅
- 키워드 매칭 정확도 향상

## 🔗 관련 문서

- [AI 서비스 가이드](./AI_SERVICE_GUIDE.md)
- [서비스 아키텍처](../architecture/SERVICES_ARCHITECTURE.md)
- [Firebase 채널 구조](../firebase/FIREBASE_CHANNELS_STRUCTURE.md)

## 📝 변경 이력

### 2025-01-27
- 제휴 링크 삽입 기능 초기 구현
- 문맥 인식 자동 삽입
- AI 기반 CTA 자동 생성
- 스마트 필터링
- 녹색 스타일 적용 및 보존

