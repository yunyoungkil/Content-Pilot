# Firebase REST API 마이그레이션 완료

## 🎯 문제 해결

### 원래 문제
- Firebase Web SDK는 **Firebase ID Token**만 받아들임
- `chrome.identity.getAuthToken()`은 **Google Access Token**만 제공
- Access Token을 Web SDK에 주입하려고 시도했지만 실패 (`auth/configuration-not-found`, `permission_denied`)

### 해결 방법
**Firebase Realtime Database REST API**를 사용하여 Google Access Token을 직접 사용

## ✅ 구현 완료

### 1. REST API 어댑터 함수들 (`js/services/firebaseService.js`)

#### `getDbUrl(path)`
- Firebase 경로를 REST API URL로 변환
- `.json` 확장자 자동 추가

#### `set(path, data)`
- HTTP PUT 요청으로 데이터 저장
- `access_token` 파라미터로 Google OAuth 토큰 전달
- `cleanDataForFirebase()`로 undefined 값 처리

#### `get(path)`
- HTTP GET 요청으로 데이터 읽기
- 토큰이 없어도 공개 데이터 접근 가능

#### `push(path, data)`
- HTTP POST 요청으로 새 항목 생성
- 생성된 키 반환

#### `update(path, updates)`
- HTTP PATCH 요청으로 부분 업데이트

#### `remove(path)`
- HTTP DELETE 요청으로 데이터 삭제

#### `ref(db, path)`
- 하위 호환성을 위한 래퍼 함수
- 경로 문자열만 반환 (기존 코드와 호환)

#### `serverTimestamp()`
- REST API용 타임스탬프 객체 반환: `{ '.sv': 'timestamp' }`

#### `onValue(path, callback, interval)`
- 실시간 리스너 대신 폴링 방식 구현
- 기본 5초 간격으로 데이터 변경 감지

### 2. 코드 수정 사항

#### `background.js`
- `snap.val()` → 직접 데이터 반환
- `snap.exists()` → `data !== null` 체크
- `push(ref(...))` → `push(path, data)` 형태로 변경

#### `firebaseService.js`
- `firebase/database` import 제거 (주석 처리)
- REST API 기반 함수들로 완전 교체
- `getDb()` 함수는 더미 객체 반환 (호환성 유지)

## 🔐 보안 규칙

Firebase Realtime Database 보안 규칙에서 `auth != null`을 사용하면:
- Google Access Token이 유효하면 `auth` 객체가 생성됨
- `auth.token.email`로 사용자 이메일 확인 가능
- REST API는 Access Token을 자동으로 인증 정보로 변환

## 📝 사용 예시

### 기존 코드 (Web SDK)
```javascript
import { ref, set, get } from 'firebase/database';
const db = getDatabase();
await set(ref(db, 'channels/userId'), data);
const snapshot = await get(ref(db, 'channels/userId'));
const data = snapshot.val();
```

### 새로운 코드 (REST API)
```javascript
import { ref, set, get } from './js/services/firebaseService.js';
await set(ref(getDb(), 'channels/userId'), data);
const data = await get(ref(getDb(), 'channels/userId'));
```

**주의**: `ref()` 함수는 이제 단순히 경로 문자열을 반환하므로, `ref(getDb(), path)` 형태로 사용하면 됩니다.

## ⚠️ 제한사항

1. **실시간 리스너**: REST API는 WebSocket을 지원하지 않으므로 `onValue`는 폴링 방식으로 동작합니다.
2. **Firebase Auth**: REST API는 Firebase Authentication과 직접 연동되지 않지만, Google Access Token으로 인증이 가능합니다.

## 🚀 장점

1. **백엔드 서버 불필요**: Chrome Extension에서 직접 Google Access Token 사용
2. **간단한 인증**: Firebase Console 설정만으로 작동
3. **호환성 유지**: 기존 코드 구조를 최대한 유지

## 📚 참고 문서

- [Firebase Realtime Database REST API](https://firebase.google.com/docs/reference/rest/database)
- [Firebase Security Rules](https://firebase.google.com/docs/database/security)

