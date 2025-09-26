# Content Pilot ✈️

**Content Pilot**은 웹 서핑 중 발견하는 중요한 정보와 아이디어를 손쉽게 수집하고 관리할 수 있도록 도와주는 강력한 웹 콘텐츠 큐레이션 확장 프로그램입니다. 모듈화된 JavaScript 코드와 Webpack 빌드 시스템을 통해 체계적으로 개발되었습니다.

## 📖 프로젝트 개요

웹페이지의 텍스트, 이미지 등 원하는 모든 요소를 클릭 한 번으로 스크랩하고, Firebase와 연동하여 실시간으로 데이터를 관리할 수 있습니다. 사용자의 편의성을 위해 직관적인 하이라이터 기능과 세련된 UI를 제공합니다.

## ✨ 주요 기능

  - **지능형 하이라이터**: `Alt` 키로 켜고 끄는 토글(Toggle) 모드를 통해, 스크랩할 요소를 명확하게 하이라이트합니다.
  - **원클릭 요소 스크랩**: 하이라이트된 웹페이지의 모든 요소를 클릭 한 번으로 손쉽게 스크랩할 수 있습니다.
  - **실시간 동기화**: 모든 스크랩 데이터는 Firebase Realtime Database에 저장되어 실시간으로 동기화됩니다.
  - **스크랩 관리**: 메인 패널의 스크랩북 모드에서 수집한 콘텐츠 목록을 확인하고, 개별 삭제 버튼으로 불필요한 스크랩을 관리할 수 있습니다.
  - **확장형 모듈 UI**: 최소화 시 화면 하단에 깔끔한 '독(Dock)' 형태의 UI를 제공하며, 스크랩 시에는 부드럽게 펼쳐지는 미리보기 패널로 즉각적인 피드백을 줍니다.

## 🛠️ 기술 스택

  - **Core**: JavaScript (ES6+), HTML5, CSS3
  - **Build System**: Webpack, Babel
  - **Backend & Database**: Firebase (Realtime Database)
  - **Platform**: Chrome Extension (Manifest V3)

## 🚀 설치 및 개발 환경 설정

이 프로젝트를 로컬 컴퓨터에 설치하고 개발을 시작하는 방법은 다음과 같습니다.

### 사전 준비

개발에 필요한 아래 도구들이 컴퓨터에 설치되어 있어야 합니다.

  - [Git](https://git-scm.com/)
  - [Node.js](https://nodejs.org/ko) (npm 포함)

### 설치 순서

1.  **프로젝트 복제 (Clone)**
    터미널을 열고 아래 명령어를 입력하여 프로젝트 파일을 컴퓨터로 복제합니다.

    ```bash
    git clone [깃허브 저장소 URL]
    ```

2.  **프로젝트 폴더로 이동 및 브랜치 전환**
    방금 생성된 프로젝트 폴더로 이동한 후, 개발 브랜치로 전환합니다.

    ```bash
    cd content-pilot
    git checkout 리팩토링/모듈화-webpack빌드-사용
    ```

3.  **의존성 패키지 설치 (Install Dependencies)**
    프로젝트에 필요한 Webpack을 포함한 모든 개발 도구를 설치합니다. `package.json` 파일을 기반으로 `node_modules` 폴더가 생성됩니다.

    ```bash
    npm install
    ```

4.  **프로젝트 빌드 (Build)**
    Webpack을 실행하여 `js/` 폴더에 있는 모듈화된 소스 코드들을 하나로 합쳐, 브라우저가 읽을 수 있는 `dist/bundle.js` 파일을 생성합니다.

    ```bash
    npx webpack
    ```

5.  **Chrome 확장 프로그램 로드**

      - Chrome 브라우저에서 `chrome://extensions` 주소로 이동합니다.
      - 오른쪽 위의 **'개발자 모드(Developer mode)'** 스위치를 켭니다.
      - 왼쪽 위에 나타난 **'압축 해제된 확장 프로그램을 로드합니다(Load unpacked)'** 버튼을 클릭합니다.
      - 이 프로젝트의 \*\*최상위 폴더(`content-pilot`)\*\*를 선택하고 '폴더 선택'을 클릭합니다.

    \*주의: 코드를 수정한 후에는 항상 \*\*4단계(빌드)\**를 다시 실행하고, 확장 프로그램 관리 페이지에서 **새로고침(↻)** 아이콘을 눌러야 변경사항이 적용됩니다.*

## 📂 프로젝트 구조

프로젝트는 역할에 따라 체계적으로 폴더와 파일로 구성되어 있습니다.

```
Content-Pilot/
├── 📄 manifest.json
├── 📄 background.js
├── 📄 content.js
├── 📁 js/
│   ├── 📁 core/
│   │   ├── 📜 highlighter.js
│   │   └── 📜 scrapbook.js
│   ├── 📁 ui/
│   │   ├── 📜 panel.js
│   │   ├── 📜 scrapbookMode.js
│   │   ├── 📜 preview.js
│   │   └── 📜 ... (기타 UI 파일)
│   └── 📜 utils.js
├── 📁 css/
│   └── 📜 style.css
├── 📁 dist/
│   └── 📜 bundle.js
├── 📁 images/
│   └── 📜 icon-48.png
├── 📁 lib/
│   └── 📜 firebase-*.js
├── 📄 webpack.config.js
├── 📄 package.json
└── 📄 .gitignore
```

### 최상위 파일

  - **`manifest.json`**: 확장 프로그램의 **설계도**입니다. 이름, 버전, 권한, 실행할 스크립트 등 모든 기본 정보를 정의합니다.
  - **`background.js`**: 확장 프로그램의 **중앙 관제탑**입니다. 브라우저 이벤트 감지, Firebase와의 통신, 데이터 관리 등 보이지 않는 곳에서 핵심 로직을 처리합니다.
  - **`content.js`**: 실제 웹페이지에 삽입되는 **현장 요원**입니다. 페이지의 내용을 분석하고, 사용자의 상호작용(하이라이트, 클릭)을 직접 처리하며 UI를 화면에 그립니다.
  - **`webpack.config.js`**: Webpack 빌더의 **설정 파일**입니다. `js/` 폴더의 여러 JavaScript 파일들을 어떻게 하나(`dist/bundle.js`)로 합칠지 정의합니다.
  - **`package.json`**: 프로젝트의 **정보 파일**입니다. 이름, 버전과 함께 `webpack`, `babel` 등 개발에 필요한 도구(패키지)들의 목록을 관리합니다.
  - **`.gitignore`**: Git이 추적하지 않을 **무시 목록**입니다. `node_modules`처럼 용량이 크거나 불필요한 파일/폴더를 지정합니다.

### 디렉토리별 파일

  - **`js/`**: 애플리케이션의 핵심 JavaScript 소스 코드들이 모여있는 곳입니다.
      - **`js/core/`**: 핵심 비즈니스 로직을 담당합니다.
          - `highlighter.js`: 요소 하이라이트 기능의 모든 로직(추가, 제거, 이벤트 처리)을 담당합니다.
          - `scrapbook.js`: 스크랩 데이터의 정렬, 필터링 등 데이터 처리 관련 로직을 담당합니다.
      - **`js/ui/`**: 사용자 인터페이스(UI)를 생성하고 제어하는 코드들을 담당합니다.
          - `panel.js`: 메인 패널의 생성, 표시, 숨김 등 상태를 관리합니다.
          - `scrapbookMode.js`: 스크랩북 목록과 상세 보기 화면을 그리는 역할을 합니다.
          - `preview.js`: 스크랩 직후 나타나는 미리보기 카드 UI 및 애니메이션을 담당합니다.
      - `utils.js`: 여러 파일에서 공통으로 사용되는 유용한 함수(예: 토스트 메시지 표시)들을 모아놓은 파일입니다.
  - **`css/`**: UI 스타일을 정의하는 CSS 파일들이 위치합니다.
      - `style.css`: 하이라이트 효과, 패널, 카드 등 모든 UI 요소의 디자인을 담당합니다.
  - **`dist/`**: Webpack이 소스 코드들을 하나로 합쳐서 만들어낸 **결과물**이 저장되는 폴더입니다.
      - `bundle.js`: `content.js`와 `js/` 폴더의 모든 JavaScript 파일이 합쳐지고 압축된 파일로, 실제 브라우저에서 실행되는 파일입니다.
  - **`images/`**: 확장 프로그램 아이콘 등 이미지 파일들을 보관합니다.
  - **`lib/`**: Firebase SDK처럼 외부에서 가져온 라이브러리 파일들을 보관합니다.