# 프로그램 로직 상세 기록 템플릿 (Detailed Logic Template)

이 문서는 복잡한 프로그램 로직을 상세히 기록하기 위한 템플릿입니다.

## 📋 사용 방법

1. 새로운 로직을 구현하거나 수정할 때 이 템플릿을 사용합니다.
2. 각 함수/클래스별로 별도 섹션을 생성합니다.
3. 필요시 새 파일을 생성하여 상세 기록을 작성합니다.

---

## 템플릿 구조

```markdown
# [기능명] 상세 로직 문서

**작성 일자**: YYYY-MM-DD
**최종 수정 일자**: YYYY-MM-DD
**관련 파일**: `파일 경로`

## 📋 목차

1. [개요](#개요)
2. [함수/클래스 목록](#함수클래스-목록)
3. [상세 설명](#상세-설명)
4. [데이터 흐름](#데이터-흐름)
5. [에러 처리](#에러-처리)
6. [사용 예시](#사용-예시)
7. [관련 문서](#관련-문서)

---

## 개요

### 기능 설명
- 이 기능이 무엇을 하는지 간단히 설명

### 주요 목적
- 이 기능의 주요 목적 및 사용 사례

### 위치
- 구현 위치 및 관련 파일

---

## 함수/클래스 목록

### 함수명/클래스명
- **위치**: `파일 경로`
- **용도**: 간단한 설명
- **입력**: 입력 파라미터 설명
- **출력**: 반환값 설명

---

## 상세 설명

### 함수명/클래스명

#### 개요
- 함수/클래스의 역할 및 목적

#### 시그니처
```javascript
function functionName(param1, param2) {
  // 함수 구현
}
```

#### 파라미터
- `param1` (Type): 설명
- `param2` (Type): 설명

#### 반환값
- 반환 타입: 설명

#### 처리 흐름
1. 단계 1 설명
2. 단계 2 설명
3. 단계 3 설명

#### 중요 사항
- 주의해야 할 사항
- 성능 고려사항
- 제약사항

#### 관련 코드
```javascript
// 관련 코드 스니펫
```

---

## 데이터 흐름

### 전체 흐름도
```
시작
  ↓
단계 1
  ↓
단계 2
  ↓
단계 3
  ↓
종료
```

### 데이터 변환
- 입력 데이터 형식
- 중간 데이터 형식
- 출력 데이터 형식

---

## 에러 처리

### 에러 타입
1. **에러 타입 1**
   - 발생 조건: 설명
   - 처리 방법: 설명
   - 관련 코드: `파일 경로:라인 번호`

2. **에러 타입 2**
   - 발생 조건: 설명
   - 처리 방법: 설명
   - 관련 코드: `파일 경로:라인 번호`

### 방어 코드
- 방어 코드 위치 및 이유
- 기본값 처리
- null/undefined 체크

---

## 사용 예시

### 기본 사용법
```javascript
// 사용 예시 코드
```

### 고급 사용법
```javascript
// 고급 사용 예시 코드
```

---

## 변경 이력

### YYYY-MM-DD: 변경 내용
- 변경 사항 설명
- 변경 이유
- 관련 이슈/버그

---

## 관련 문서

- [프로그램 로직 문서](./PROGRAM_LOGIC.md)
- [관련 가이드](../guides/RELATED_GUIDE.md)
- [버그 해결 로그](./BUG_FIX_LOG.md)

---

## 참고 사항

- 추가 참고 사항
- 향후 개선 계획
- 알려진 제약사항
```

---

## 실제 예시

### 예시: AI 브리핑 생성 로직

```markdown
# AI 브리핑 생성 상세 로직

**작성 일자**: 2024-12-XX
**최종 수정 일자**: 2024-12-XX
**관련 파일**: `background.js`, `js/services/aiService.js`

## 📋 목차

1. [개요](#개요)
2. [함수 목록](#함수-목록)
3. [상세 설명](#상세-설명)
4. [데이터 흐름](#데이터-흐름)
5. [에러 처리](#에러-처리)
6. [사용 예시](#사용-예시)

---

## 개요

### 기능 설명
아이디어 저장 시 자동으로 AI 브리핑 데이터(추천 목차, 추천 검색어, 롱테일 키워드)를 생성하는 기능입니다.

### 주요 목적
- 사용자가 아이디어를 저장하면 즉시 브리핑 데이터를 제공하여 콘텐츠 작성에 바로 활용할 수 있도록 합니다.
- AI가 분석한 키워드와 목차를 통해 SEO 최적화된 콘텐츠를 작성할 수 있도록 지원합니다.

### 위치
- **백엔드**: `background.js` (AI API 호출)
- **서비스**: `js/services/aiService.js` (프롬프트 생성)

---

## 함수 목록

### generateBriefing
- **위치**: `background.js`
- **용도**: 아이디어 브리핑 데이터 생성
- **입력**: `ideaId` (string), `ideaData` (object)
- **출력**: `Promise<void>`

### buildBriefingPrompt
- **위치**: `js/services/aiService.js`
- **용도**: 브리핑 생성 프롬프트 생성
- **입력**: `ideaData` (object)
- **출력**: `string`

---

## 상세 설명

### generateBriefing

#### 개요
아이디어 데이터를 기반으로 AI 브리핑을 생성하고 Firebase에 저장하는 함수입니다.

#### 시그니처
```javascript
async function generateBriefing(ideaId, ideaData) {
  // 구현
}
```

#### 파라미터
- `ideaId` (string): 아이디어 ID
- `ideaData` (object): 아이디어 데이터 객체
  - `title` (string): 아이디어 제목
  - `tags` (array): 태그 배열
  - `keywords` (array): 키워드 배열 (선택)

#### 반환값
- `Promise<void>`: 비동기 처리, 반환값 없음

#### 처리 흐름
1. 아이디어 데이터에서 브리핑 생성에 필요한 정보 추출
2. AI 프롬프트 생성 (buildBriefingPrompt 호출)
3. Gemini API 호출 (병렬 처리)
   - 추천 목차 생성
   - 추천 검색어 생성
   - 롱테일 키워드 생성
4. 응답 파싱 및 검증
5. Firebase에 저장 (`/ideas/{ideaId}/workspace`)

#### 중요 사항
- **병렬 처리**: 3개의 API 호출을 Promise.all로 병렬 처리하여 성능 최적화
- **에러 처리**: 일부 실패해도 나머지는 계속 진행
- **재시도 로직**: API 호출 실패 시 지수 백오프로 재시도

#### 관련 코드
```javascript
// background.js
async function generateBriefing(ideaId, ideaData) {
  try {
    const prompt = buildBriefingPrompt(ideaData);
    const [outline, keywords, longTail] = await Promise.all([
      callGeminiAPI(prompt, 'outline'),
      callGeminiAPI(prompt, 'keywords'),
      callGeminiAPI(prompt, 'longTail')
    ]);
    
    await saveBriefingToFirebase(ideaId, { outline, keywords, longTail });
  } catch (error) {
    console.error('[ERROR] generateBriefing:', error);
    // 에러 처리
  }
}
```

---

## 데이터 흐름

### 전체 흐름도
```
아이디어 저장
  ↓
generateBriefing 호출
  ↓
프롬프트 생성 (buildBriefingPrompt)
  ↓
Gemini API 호출 (병렬)
  ├─ 추천 목차
  ├─ 추천 검색어
  └─ 롱테일 키워드
  ↓
응답 파싱 및 검증
  ↓
Firebase 저장
  ↓
실시간 리스너로 UI 업데이트
```

### 데이터 변환
- **입력**: `ideaData` (title, tags, keywords)
- **중간**: AI 프롬프트 문자열
- **출력**: `{ outline: [], recommendedKeywords: [], longTailKeywords: [] }`

---

## 에러 처리

### 에러 타입
1. **API 호출 실패**
   - 발생 조건: Gemini API 호출 실패 (네트워크 오류, 인증 오류 등)
   - 처리 방법: 지수 백오프 재시도 (최대 3회)
   - 관련 코드: `background.js:라인 번호`

2. **응답 파싱 실패**
   - 발생 조건: AI 응답이 JSON 형식이 아니거나 예상 형식과 다름
   - 처리 방법: 기본값으로 대체하거나 에러 로그 기록
   - 관련 코드: `background.js:라인 번호`

3. **Firebase 저장 실패**
   - 발생 조건: Firebase 연결 실패 또는 권한 오류
   - 처리 방법: 에러 로그 기록 및 재시도
   - 관련 코드: `background.js:라인 번호`

### 방어 코드
- `ideaData`가 없을 때 기본값 처리
- `tags`나 `keywords`가 없을 때 빈 배열로 처리
- API 응답이 null일 때 기본값 반환

---

## 사용 예시

### 기본 사용법
```javascript
// background.js
const ideaData = {
  title: "새로운 아이디어",
  tags: ["#태그1", "#태그2"],
  keywords: ["키워드1", "키워드2"]
};

await generateBriefing("idea_123", ideaData);
```

### 에러 처리 포함
```javascript
try {
  await generateBriefing(ideaId, ideaData);
} catch (error) {
  console.error('브리핑 생성 실패:', error);
  // 사용자에게 알림 표시
}
```

---

## 변경 이력

### 2024-12-XX: 초기 구현
- AI 브리핑 자동 생성 기능 추가
- 병렬 처리로 성능 최적화

### 2024-12-XX: 에러 처리 개선
- 재시도 로직 추가
- 부분 실패 처리 개선

---

## 관련 문서

- [프로그램 로직 - AI 서비스](./PROGRAM_LOGIC.md#ai-서비스)
- [AI 서비스 가이드](../guides/AI_SERVICE_GUIDE.md)
- [작업 세션 로그](./WORK_SESSION_LOG.md)

---

## 참고 사항

- 브리핑 생성은 비동기로 처리되므로 UI는 실시간 리스너로 업데이트됩니다.
- API 호출 비용을 고려하여 불필요한 호출을 방지합니다.
- 향후 브리핑 데이터 수동 재생성 기능 추가 예정입니다.
```

---

## 🔗 관련 문서

- [작업 문서화 가이드](./WORK_DOCUMENTATION_GUIDE.md)
- [프로그램 로직 문서](./PROGRAM_LOGIC.md)
- [작업 세션 로그](./WORK_SESSION_LOG.md)

