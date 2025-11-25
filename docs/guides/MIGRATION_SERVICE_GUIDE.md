# 마이그레이션 서비스 가이드

> **최종 업데이트**: 2025-01-25  
> **상태**: ✅ 최신

## 📋 개요

마이그레이션 서비스는 채널 중심 아키텍처로 전환할 때 기존 데이터에 `channelId`를 부여하는 기능을 제공합니다.

## 🎯 목적

기존에 `channelId`가 없던 데이터(칸반 카드, 스크랩)를 새로운 채널 중심 아키텍처에 맞게 마이그레이션합니다.

---

## 🔑 주요 기능

### 1. 마이그레이션 필요 여부 확인 (`checkMigrationNeeded`)

**기능**: 마이그레이션이 필요한지 확인하고, 필요한 경우 채널 옵션을 제공합니다.

**사용법**:
```javascript
import { checkMigrationNeeded } from './services/migrationService.js';

const userId = await getCurrentUserId();
const result = await checkMigrationNeeded(userId);

if (result.needsMigration) {
  console.log(`마이그레이션 필요: ${result.count}개 항목`);
  console.log('채널 옵션:', result.channelOptions);
  
  if (result.autoMigration) {
    // 단일 채널: 자동 마이그레이션 가능
    console.log('자동 마이그레이션 가능');
  } else {
    // 다중 채널: 사용자 선택 필요
    console.log('사용자 선택 필요');
  }
}
```

**응답 구조**:
```javascript
{
  success: true,
  needsMigration: true,
  needed: true,
  count: 10, // 마이그레이션 필요한 항목 수
  reason: "single_channel_auto" | "multiple_channels_manual" | "no_orphan_data" | "no_channels",
  channelOptions: [
    {
      id: "channel123",
      name: "https://blog.naver.com/myid",
      url: "https://rss.blog.naver.com/myid.xml"
    }
  ],
  autoMigration: true, // 단일 채널인 경우 true
  targetChannelId: "channel123" // 자동 마이그레이션 가능한 경우
}
```

**마이그레이션 불필요한 경우**:
- `reason: "no_channels"`: 등록된 채널이 없음
- `reason: "no_orphan_data"`: `channelId`가 없는 데이터가 없음

---

### 2. 데이터 마이그레이션 실행 (`runDataMigration`)

**기능**: `channelId`가 없는 데이터에 채널 ID를 부여합니다.

**사용법**:
```javascript
import { runDataMigration } from './services/migrationService.js';

const userId = await getCurrentUserId();
const targetChannelId = "channel123"; // null이면 자동 결정

const result = await runDataMigration(userId, targetChannelId);

if (result.success) {
  console.log(`마이그레이션 완료: ${result.updatedCount}개 항목 업데이트`);
} else {
  console.error('마이그레이션 실패:', result.message);
}
```

**마이그레이션 프로세스**:

1. **백업 생성**
   - 타임스탬프 기반 백업 경로 생성: `backup/{timestamp}`
   - 칸반 데이터 백업
   - 스크랩 데이터 백업
   - Firebase에 백업 저장

2. **타겟 채널 결정**
   - `targetChannelId`가 제공되면 사용
   - 제공되지 않으면:
     - 단일 채널: 자동으로 해당 채널 선택
     - 다중 채널: `null` (공용으로 처리)

3. **데이터 마이그레이션**
   - 칸반 카드: `channelId` 부여
   - 스크랩: `channelId` 부여
   - 진행률 계산 및 로깅

4. **롤백 지원**
   - 마이그레이션 실패 시 자동 롤백
   - 백업 데이터로 복원

**응답 구조**:
```javascript
{
  success: true,
  message: "마이그레이션 완료",
  updatedCount: 10 // 업데이트된 항목 수
}
```

---

## 📊 마이그레이션 시나리오

### 시나리오 1: 단일 채널 사용자

**상황**: 사용자가 하나의 블로그만 등록한 경우

**동작**:
- `checkMigrationNeeded`가 `autoMigration: true` 반환
- 사용자 확인 없이 자동 마이그레이션 가능
- 모든 고아 데이터가 해당 채널로 귀속

**예시**:
```javascript
const result = await checkMigrationNeeded(userId);
// result.autoMigration === true
// result.targetChannelId === "channel123"

// 자동 마이그레이션 실행
await runDataMigration(userId, result.targetChannelId);
```

---

### 시나리오 2: 다중 채널 사용자

**상황**: 사용자가 여러 블로그를 등록한 경우

**동작**:
- `checkMigrationNeeded`가 `autoMigration: false` 반환
- 사용자가 마이그레이션할 채널을 선택해야 함
- 선택하지 않으면 공용(`null`)으로 유지

**예시**:
```javascript
const result = await checkMigrationNeeded(userId);
// result.autoMigration === false
// result.channelOptions === [
//   { id: "channel1", name: "블로그 1", url: "..." },
//   { id: "channel2", name: "블로그 2", url: "..." }
// ]

// 사용자가 채널 선택 후 마이그레이션 실행
const selectedChannelId = "channel1";
await runDataMigration(userId, selectedChannelId);
```

---

### 시나리오 3: 채널 없음

**상황**: 등록된 채널이 없는 경우

**동작**:
- `checkMigrationNeeded`가 `needsMigration: false` 반환
- 마이그레이션 불가능

**예시**:
```javascript
const result = await checkMigrationNeeded(userId);
// result.needsMigration === false
// result.reason === "no_channels"
```

---

## 🔄 마이그레이션 UI 흐름

### 1. 마이그레이션 모달 표시

사용자가 처음 채널을 추가하거나, 고아 데이터가 감지되면 마이그레이션 모달이 표시됩니다.

**모달 내용**:
- 마이그레이션 필요한 항목 수
- 채널 옵션 (다중 채널인 경우)
- 자동 마이그레이션 여부

### 2. 사용자 선택

- **단일 채널**: "마이그레이션 시작" 버튼만 표시
- **다중 채널**: 채널 선택 드롭다운 + "마이그레이션 시작" 버튼

### 3. 마이그레이션 실행

- 진행률 표시
- 백업 생성
- 데이터 업데이트
- 완료 알림

---

## 📝 마이그레이션 대상 데이터

### 칸반 카드 (`kanban/{userId}/{status}/{cardId}`)

**조건**: `channelId`가 `undefined` 또는 `null`인 경우

**업데이트**:
```javascript
{
  ...cardData,
  channelId: targetChannelId // 또는 null (공용)
}
```

### 스크랩 (`scraps/{userId}/{scrapId}`)

**조건**: `channelId`가 `undefined` 또는 `null`인 경우

**업데이트**:
```javascript
{
  ...scrapData,
  channelId: targetChannelId // 또는 null (공용)
}
```

---

## 🔒 안전장치

### 1. 백업 생성

마이그레이션 전에 모든 데이터를 백업합니다.

**백업 경로**: `backup/{timestamp}`

**백업 내용**:
- 칸반 데이터
- 스크랩 데이터

### 2. 롤백 지원

마이그레이션 실패 시 자동으로 백업 데이터로 복원합니다.

**롤백 조건**:
- 마이그레이션 중 에러 발생
- 데이터 무결성 검증 실패

### 3. 진행률 추적

마이그레이션 진행 상황을 실시간으로 추적합니다.

**진행률 계산**:
```javascript
const progress = (updatedCount / totalItems) * 100;
```

---

## ⚠️ 주의사항

1. **데이터 백업**: 마이그레이션 전에 항상 백업이 생성됩니다.
2. **롤백**: 마이그레이션 실패 시 자동 롤백되지만, 수동 확인을 권장합니다.
3. **채널 선택**: 다중 채널 사용자는 신중하게 채널을 선택하세요.
4. **공용 데이터**: 선택하지 않으면 공용(`null`)으로 유지됩니다.

---

## 🔗 관련 문서

- [Firebase 채널 구조](./firebase/FIREBASE_CHANNELS_STRUCTURE.md)
- [실제 저장 구조](./architecture/ACTUAL_SAVE_STRUCTURE.md)
- [Firebase REST API 마이그레이션](./firebase/FIREBASE_REST_API_MIGRATION.md)

