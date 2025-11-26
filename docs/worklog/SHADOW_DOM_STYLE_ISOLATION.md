# Shadow DOM 스타일 격리 가이드

이 문서는 Content Pilot에서 Shadow DOM을 사용하여 UI 스타일을 격리하는 방법과 외부 페이지 스타일 침투 문제를 해결하는 방법을 상세히 설명합니다.

## 📋 목차

1. [문제 상황](#문제-상황)
2. [Shadow DOM 스타일 격리 원리](#shadow-dom-스타일-격리-원리)
3. [스타일 침투 원인 분석](#스타일-침투-원인-분석)
4. [해결 방법](#해결-방법)
5. [구현 상세](#구현-상세)
6. [테스트 방법](#테스트-방법)
7. [주의사항](#주의사항)
8. [참고 자료](#참고-자료)

---

## 문제 상황

### 증상

- 프로그램 UI에 접속해 있는 페이지의 스타일이 적용되는 것 같음
- Shadow DOM을 사용하고 있음에도 불구하고 외부 페이지의 일부 스타일(폰트, 색상 등)이 UI에 영향을 미침
- 다른 웹사이트에서 확장 프로그램을 열 때마다 UI 스타일이 달라 보일 수 있음

### 예시 시나리오

1. **구글 검색 페이지에서 확장 프로그램 열기**
   - 구글의 전역 폰트 스타일이 UI에 적용됨
   - 구글의 색상 스키마가 UI에 영향을 미침

2. **네이버 블로그에서 확장 프로그램 열기**
   - 네이버의 전역 스타일이 UI에 적용됨
   - 레이아웃이 달라 보일 수 있음

3. **유튜브에서 확장 프로그램 열기**
   - 유튜브의 다크 모드 스타일이 UI에 영향을 미칠 수 있음

---

## Shadow DOM 스타일 격리 원리

### Shadow DOM이란?

Shadow DOM은 웹 컴포넌트의 핵심 기술 중 하나로, DOM 트리의 일부를 캡슐화하여 외부 스타일과 격리시킵니다.

```javascript
// Shadow DOM 생성 예시
const host = document.createElement('div');
const shadowRoot = host.attachShadow({ mode: 'open' });
```

### 스타일 격리 메커니즘

1. **기본 격리**
   - Shadow DOM 내부의 스타일은 외부로 전파되지 않음
   - 외부 스타일은 Shadow DOM 내부로 전파되지 않음 (대부분의 경우)

2. **상속 가능한 속성**
   - 일부 CSS 속성은 Shadow DOM 경계를 넘어 상속될 수 있음
   - `font-family`, `color`, `line-height`, `text-align` 등

3. **CSS 변수**
   - CSS 변수(`--variable-name`)는 Shadow DOM 경계를 넘어 전파될 수 있음

---

## 스타일 침투 원인 분석

### 1. 상속 가능한 속성

다음 속성들은 Shadow DOM 경계를 넘어 상속될 수 있습니다:

- `font-family`
- `font-size`
- `color`
- `line-height`
- `text-align`
- `direction`
- `cursor`
- `visibility`
- `opacity`

### 2. CSS 변수 전파

```css
/* 외부 페이지 */
:root {
  --primary-color: #4285f4;
  --font-family: 'Roboto', sans-serif;
}

/* Shadow DOM 내부에서도 접근 가능 */
:host {
  color: var(--primary-color); /* 외부 변수 사용 가능 */
}
```

### 3. 전역 스타일 리셋 부족

Shadow DOM 내부에 명시적인 리셋 스타일이 없으면:
- 브라우저 기본 스타일이 적용됨
- 외부 페이지의 전역 스타일이 간접적으로 영향을 미칠 수 있음

---

## 해결 방법

### 1. Shadow DOM 루트 요소 리셋 (최소한의 리셋)

`:host` 선택자를 사용하여 Shadow DOM의 호스트 요소에 최소한의 스타일만 적용합니다.
기존 컴포넌트 스타일을 유지하기 위해 `!important`를 사용하지 않습니다.

```css
:host {
  /* 외부 페이지의 전역 스타일이 Shadow DOM에 영향을 주지 않도록 최소한의 리셋만 적용 */
  font-family: "Noto Sans KR", "Roboto", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: #333;
  /* box-sizing만 강제 적용 (레이아웃 안정성) */
  box-sizing: border-box;
  /* 외부 페이지의 전역 스타일 영향 차단 */
  text-align: left;
  direction: ltr;
}
```

### 2. 내부 요소 box-sizing만 적용

`:host *` 선택자를 사용하여 Shadow DOM 내부의 모든 요소에 `box-sizing`만 강제 적용합니다.
기존 컴포넌트 스타일(margin, padding, background 등)은 유지됩니다.

```css
:host *,
:host *::before,
:host *::after {
  /* box-sizing만 강제 적용하여 레이아웃 안정성 확보 */
  box-sizing: border-box;
}
```

**주의**: 기존 컴포넌트 스타일을 유지하기 위해 `margin`, `padding`, `background` 등은 리셋하지 않습니다.

---

## 구현 상세

### 파일 구조

```
Content-Pilot/
├── css/
│   └── style.css          # Shadow DOM 리셋 스타일 포함
├── js/
│   └── ui/
│       └── panel.js       # Shadow DOM 생성 로직
└── docs/
    └── worklog/
        └── SHADOW_DOM_STYLE_ISOLATION.md  # 이 문서
```

### CSS 파일 구조

`css/style.css` 파일의 구조:

```css
/* ============================================
   Shadow DOM 스타일 격리 리셋
   ============================================ */

/* Shadow DOM 루트 요소 리셋 */
:host {
  /* 리셋 스타일 */
}

/* Shadow DOM 내부 모든 요소 리셋 */
:host * {
  /* 리셋 스타일 */
}

/* 기본 HTML 요소 리셋 */
:host div, :host span, ... {
  /* 리셋 스타일 */
}

/* ============================================
   기존 스타일 시작
   ============================================ */

/* 기존 컴포넌트 스타일 */
```

### Shadow DOM 생성 로직

`js/ui/panel.js`의 `createAndShowPanel()` 함수:

```javascript
export function createAndShowPanel() {
  let host = document.getElementById("content-pilot-host");
  if (host) {
    // 기존 호스트 재사용
  } else {
    // 새 호스트 생성
    host = document.createElement("div");
    host.id = "content-pilot-host";
    document.body.appendChild(host);

    // Shadow DOM 생성
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // 스타일 링크 추가 (순서 중요!)
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('css/style.css');
    shadowRoot.appendChild(styleLink);

    // 추가 스타일 링크들...
  }
}
```

### 스타일 로드 순서

Shadow DOM 내부에 스타일을 추가할 때 순서가 중요합니다:

1. **리셋 스타일이 먼저 로드되어야 함**
   - `style.css` (리셋 포함) → `workspace.css` → `kanban.css`

2. **리셋 스타일이 다른 스타일보다 우선순위가 높아야 함**
   - `!important` 플래그 사용
   - CSS 특이성(specificity) 고려

---

## 테스트 방법

### 1. 다양한 웹사이트에서 테스트

다음 웹사이트에서 확장 프로그램 UI를 열고 스타일이 일관되게 표시되는지 확인:

- 구글 검색 페이지
- 네이버 블로그
- 유튜브
- 깃허브
- 트위터/X

### 2. 개발자 도구로 확인

1. **Shadow DOM 내부 요소 선택**
   ```javascript
   // 콘솔에서 실행
   const host = document.getElementById('content-pilot-host');
   const shadowRoot = host.shadowRoot;
   const panel = shadowRoot.querySelector('#content-pilot-panel');
   ```

2. **계산된 스타일 확인**
   - 개발자 도구에서 요소 선택
   - "Computed" 탭에서 계산된 스타일 확인
   - 외부 페이지의 스타일이 적용되지 않았는지 확인

3. **스타일 소스 추적**
   - 개발자 도구에서 스타일 소스 확인
   - 외부 페이지의 스타일이 표시되지 않아야 함

### 3. CSS 변수 테스트

외부 페이지에서 CSS 변수를 정의하고 Shadow DOM 내부에서 사용되지 않는지 확인:

```css
/* 외부 페이지 */
:root {
  --test-color: red;
}
```

Shadow DOM 내부에서 이 변수가 적용되지 않아야 합니다.

---

## 주의사항

### 1. `!important` 사용 금지

- `!important` 플래그는 기존 컴포넌트 스타일과 충돌할 수 있으므로 사용하지 않음
- Shadow DOM의 기본 격리 메커니즘이 대부분의 외부 스타일을 차단하므로 `!important`가 필요하지 않음

### 2. 최소한의 리셋만 적용

- 기존 컴포넌트 스타일을 유지하기 위해 최소한의 리셋만 적용
- `margin`, `padding`, `background` 등은 기존 스타일이 우선 적용되도록 함
- `box-sizing`만 강제 적용하여 레이아웃 안정성 확보

### 3. CSS 변수 처리

- 외부 페이지의 CSS 변수가 필요한 경우, Shadow DOM 내부에서 명시적으로 재정의해야 함
- 또는 Shadow DOM 내부에서만 사용하는 CSS 변수를 정의

### 4. 성능 고려

- 리셋 스타일이 많을수록 렌더링 성능에 영향을 줄 수 있음
- 필요한 최소한의 리셋만 적용

### 5. 브라우저 호환성

- Shadow DOM은 모든 최신 브라우저에서 지원됨
- 구형 브라우저에서는 폴백이 필요할 수 있음

---

## 참고 자료

### 관련 문서

- [BUG_FIX_LOG.md](./BUG_FIX_LOG.md#shadow-dom-스타일-격리-문제-외부-페이지-스타일-침투) - 버그 해결 로그
- [PROGRAM_LOGIC.md](./PROGRAM_LOGIC.md) - 프로그램 로직 상세 설명
- [DEVELOPMENT_GUIDE.md](../guides/DEVELOPMENT_GUIDE.md) - 개발 가이드

### 관련 파일

- `css/style.css` - Shadow DOM 리셋 스타일
- `js/ui/panel.js` - Shadow DOM 생성 로직

### 외부 자료

- [MDN: Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/Web_Components/Using_shadow_DOM)
- [MDN: CSS Inheritance](https://developer.mozilla.org/en-US/docs/Web/CSS/inheritance)
- [W3C: Shadow DOM Specification](https://www.w3.org/TR/shadow-dom/)

---

## 변경 이력

- **2024-12-XX**: Shadow DOM 스타일 격리 문제 해결 및 문서 작성
  - CSS 리셋 스타일 추가 (최소한의 리셋)
  - Shadow DOM 루트 요소 리셋 구현 (`:host`)
  - 내부 요소 `box-sizing`만 강제 적용 (`:host *`)
  - 기존 컴포넌트 스타일 유지를 위해 `!important` 제거

---

## 향후 개선 사항

1. **CSS 변수 격리 강화**
   - 외부 CSS 변수가 Shadow DOM 내부로 전파되지 않도록 추가 조치

2. **성능 최적화**
   - 리셋 스타일 최적화
   - 불필요한 리셋 제거

3. **자동화된 테스트**
   - 다양한 웹사이트에서 자동으로 스타일 격리 테스트
   - CI/CD 파이프라인에 통합

