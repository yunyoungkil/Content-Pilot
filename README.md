# Content Pilot ✈️

**Content Pilot**은 웹 서핑 중 발견하는 중요한 정보와 아이디어를 손쉽게 수집하고 관리할 수 있도록 도와주는 강력한 웹 콘텐츠 큐레이션 확장 프로그램입니다. 모듈화된 JavaScript 코드와 Webpack 빌드 시스템, 그리고 최신 Manifest V3 아키텍처를 통해 체계적으로 개발되었습니다.

## 📖 프로젝트 개요

웹페이지의 텍스트, 이미지 등 원하는 모든 요소를 클릭 한 번으로 스크랩하고, Firebase와 연동하여 실시간으로 데이터를 관리할 수 있습니다. 사용자의 편의성을 위해 직관적인 하이라이터 기능과 세련된 UI를 제공합니다.

## ✨ 주요 기능

- **지능형 하이라이터**: `Alt` 키로 켜고 끄는 토글(Toggle) 모드를 통해, 스크랩할 요소를 명확하게 하이라이트합니다.
- **원클릭 요소 스크랩**: 하이라이트된 웹페이지의 모든 요소를 클릭 한 번으로 손쉽게 스크랩할 수 있습니다.
- **실시간 동기화**: 모든 스크랩 데이터는 Firebase Realtime Database에 저장되어 실시간으로 동기화됩니다.
- **스크랩 관리**: 메인 패널의 스크랩북 모드에서 수집한 콘텐츠 목록을 확인하고, 개별 삭제 버튼으로 불필요한 스크랩을 관리할 수 있습니다.
- **안정적인 데이터 수집**: Manifest V3의 **Offscreen Document**를 활용하여, 네이버 블로그의 아이프레임 구조나 지연 로딩(Lazy Loading) 이미지도 안정적으로 분석하고 수집합니다.
- **확장형 모듈 UI**: 최소화 시 화면 하단에 깔끔한 '독(Dock)' 형태의 UI를 제공하며, 스크랩 시에는 부드럽게 펼쳐지는 미리보기 패널로 즉각적인 피드백을 줍니다.

## 🛠️ 기술 스택

- **Core**: JavaScript (ES6+), HTML5, CSS3
- **Build System**: Webpack, Babel
- **Backend & Database**: Firebase (Realtime Database)
- **Platform**: Chrome Extension (Manifest V3 with Offscreen Document)

## 🚀 설치 및 개발 환경 설정

이 프로젝트를 로컬 컴퓨터에 설치하고 개발을 시작하는 방법은 다음과 같습니다.

### 사전 준비

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/ko) (npm 포함)
- **Google Chrome 브라우저 (버전 109 이상)**: 이 확장 프로그램의 핵심 기능인 `Offscreen Document` API가 **Chrome 109**부터 정식 지원되므로, 반드시 해당 버전 이상의 Chrome 브라우저가 필요합니다.

### 설치 순서

1.  **프로젝트 복제 (Clone)**
    ```bash
    git clone [깃허브 저장소 URL]
    ```

2.  **프로젝트 폴더로 이동**
    ```bash
    cd content-pilot
    ```

3.  **의존성 패키지 설치 (Install Dependencies)**
    ```bash
    npm install
    ```

4.  **프로젝트 빌드 (Build)**
    ```bash
    npx webpack
    ```

5.  **프로젝트 자동 빌드 (Build)**
    package.json
    ```bash
    "scripts": {
        "build": "webpack --mode=production",
        "watch": "webpack --mode=development --watch"
    }
  ```
    ```bash
    npm run watch
    ```

    (이후 `chrome://extensions`에서 '압축 해제된 확장 프로그램을 로드'로 폴더를 선택하여 로드합니다.)

## 🔄 확장 프로그램 업데이트 방법

소스 코드(`*.js`, `manifest.json` 등)를 수정한 후에는, 변경사항을 개발 중인 확장 프로그램에 적용하기 위해 다음 단계를 따라야 합니다.

1.  **프로젝트 빌드 (Re-build)**
    터미널에서 `npx webpack` 명령어를 다시 실행하여 변경된 소스 코드를 `dist/bundle.js` 파일에 반영합니다.

    ```bash
    npx webpack
    ```

2.  **확장 프로그램 새로고침 (Reload)**
    `chrome://extensions` 페이지로 이동하여 Content Pilot 확장 프로그램 카드에 있는 **새로고침(↻) 아이콘**을 클릭합니다.

---

## 📂 프로젝트 구조 및 파일 설명

### 프로젝트 구조도

````

Content-Pilot/
├── 📄 manifest.json
├── 📄 background.js
├── 📄 content.js
├── 📄 offscreen.html
├── 📄 offscreen.js
├── 📄 webpack.config.js
├── 📄 package.json
├── 📁 js/
│   ├── 📁 core/
│   │   └── 📜 highlighter.js
│   └── 📁 ui/
│       ├── 📜 panel.js
│       ├── 📜 dashboardMode.js
│       └── 📜 ... (기타 UI 파일)
├── 📁 css/
│   └── 📜 style.css
├── 📁 dist/
│   └── 📜 bundle.js
├── 📁 images/
│   └── 📜 icon-48.png
└── 📁 lib/
└── 📜 firebase-\*.js

```

### 디렉토리별 파일 설명

#### 최상위 파일

- **`manifest.json`**: 확장 프로그램의 **설계도**입니다. 이름, 버전, 권한(`offscreen` 포함), 실행할 스크립트(`background.js`, `content.js`) 등 모든 기본 정보를 정의합니다.

- **`background.js`**: 확장 프로그램의 **중앙 관제탑** (서비스 워커)입니다. Firebase와의 통신, 데이터 수집(RSS, YouTube API 호출), AI API 연동 등 보이지 않는 곳에서 모든 핵심 로직을 처리합니다. DOM 분석이 필요할 때는 `offscreen.html`을 호출하여 작업을 위임합니다.

- **`content.js`**: 실제 웹페이지에 삽입되는 **현장 요원**입니다. `js/` 폴더의 모든 UI 및 핵심 로직 모듈을 가져와(`import`) 실행하는 Webpack 번들의 시작점입니다. 페이지 UI를 그리고 사용자의 상호작용(하이라이트, 클릭)을 직접 처리합니다.

- **`offscreen.html` & `offscreen.js`**: **DOM 분석 전문가**입니다. `background.js`는 보안상의 이유로 DOM API(`DOMParser` 등) 사용에 제약이 있습니다. 이 제약을 극복하기 위해, `background.js`는 수집한 HTML 텍스트를 `offscreen` 페이지로 보냅니다. `offscreen.js`는 완전한 DOM 환경을 활용하여 HTML을 안전하고 정확하게 분석한 후, 이미지, 요약 등의 결과만 다시 `background.js`로 돌려주는 핵심적인 역할을 수행합니다.

- **`webpack.config.js`**: Webpack 빌더의 **설정 파일**입니다. `content.js`를 시작점으로 `js/` 폴더의 여러 JavaScript 파일들을 어떻게 하나의 최종 결과물(`dist/bundle.js`)로 합칠지 정의합니다.

- **`package.json`**: 프로젝트의 **정보 파일**입니다. 프로젝트의 이름, 버전과 함께 `webpack`, `babel` 등 개발에 필요한 도구(패키지)들의 목록을 관리합니다.

#### 디렉토리

- **`/js`**: 애플리케이션의 핵심 JavaScript 소스 코드들이 모여있는 곳입니다. `content.js`가 이 폴더의 모듈들을 가져와 사용합니다.
    - **`/js/core`**: 스크랩 하이라이터와 같이 핵심 비즈니스 로직을 담당하는 파일들이 위치합니다.
    - **`/js/ui`**: 메인 패널, 대시보드, 스크랩북 등 사용자 인터페이스(UI)를 생성하고 제어하는 코드들이 위치합니다.

- **`/css`**: UI 스타일을 정의하는 CSS 파일(`style.css`)이 위치합니다.

- **`/dist`**: Webpack이 소스 코드들을 하나로 합쳐서 만들어낸 **빌드 결과물**이 저장되는 폴더입니다.
    - `bundle.js`: `content.js`와 `js/` 폴더의 모든 JavaScript 파일이 합쳐지고 압축된 파일로, 실제 브라우저가 웹페이지에서 실행하는 최종 파일입니다.

- **`/images`**: 확장 프로그램 아이콘 등 이미지 파일들을 보관합니다.

- **`/lib`**: Firebase SDK처럼 외부에서 가져온 라이브러리 파일들을 보관합니다. `background.js`가 `importScripts`를 통해 이 파일들을 불러옵니다.
```