# Content-Pilot 프로젝트 구조

```
Content-Pilot/
├── manifest.json
├── content.js
├── background.js
├── popup.html
├── popup.js
├── images/
│   └── icon.png
├── css/
│   └── style.css
└── lib/
    ├── firebase-app.js
    ├── firebase-auth.js
    ├── firebase-firestore.js
    └── firebase-storage.js
```

## 각 파일 및 폴더 설명

- **manifest.json**: 확장 프로그램의 메타데이터와 권한, 파일 경로 등을 정의하는 가장 중요한 설정 파일입니다. 여기에는 Firebase SDK 스크립트를 로드하기 위한 정보와 CSP(Content Security Policy) 설정이 포함됩니다.
- **content.js**: 사용자가 현재 보고 있는 웹 페이지의 콘텐츠에 접근하여 텍스트나 이미지를 스크랩하는 역할을 합니다. 또한, UI 패널을 제공하고 Firebase와 통신하는 기능을 담당합니다.
- **background.js**: 확장 프로그램의 백그라운드에서 실행되는 스크립트입니다. 웹서핑 중 Alt+클릭과 같은 이벤트를 감지하고 content.js와 통신하여 데이터를 처리합니다.
- **popup.html / popup.js**: 확장 프로그램 아이콘을 클릭했을 때 나타나는 팝업 창의 UI와 로직을 담당합니다.
- **/images**: 확장 프로그램 아이콘 등 이미지를 저장하는 폴더입니다.
- **/css**: UI 디자인을 위한 CSS 파일을 저장하는 폴더입니다.
- **/lib**: Firebase SDK와 같은 외부 라이브러리 파일을 저장하는 폴더입니다. README.md에 언급된 Authentication, Firestore, Storage 서비스를 사용하기 위해 관련 SDK 파일들이 필요합니다.

### **프로그램 개발 목표 및 컨셉**

- **프로그램명 (가칭)**: `Content Pilot`
- **컨셉**: 웹에서 수집한 아이디어 조각(Scraps)을 AI와 함께 체계적인 콘텐츠로 발전시키는 클라우드 기반 워크스페이스
- **핵심 기술**: Chrome Extension + Firebase (Authentication, Firestore, Storage)

### **시스템 아키텍처 설계도 (System Architecture)**

![Image](https://github.com/user-attachments/assets/05cfb76c-32f1-42be-a631-cf111268a743)

| **컴포넌트**                    | **역할**                                                                               | **사용 기술/서비스**                    |
| :------------------------------ | :------------------------------------------------------------------------------------- | :-------------------------------------- |
| **Frontend (Chrome Extension)** | 사용자 인터페이스 제공, 데이터 수집 및 표시, Firebase와 통신                           | `content.js`, `background.js`, HTML/CSS |
| **Backend as a Service (BaaS)** | 서버리스 백엔드 역할. 데이터 저장, 파일 관리, 사용자 인증 처리                         | **Firebase**                            |
| ┣ **Authentication**            | Google 계정을 통한 사용자 로그인 및 식별                                               | Firebase Authentication                 |
| ┣ **Firestore**                 | 모든 텍스트 데이터(스크랩, 프로젝트 정보, 분석 결과 등)를 실시간으로 저장하는 NoSQL DB | Cloud Firestore                         |
| ┗ **Storage**                   | 스크랩한 이미지 파일을 저장하고 고유 URL을 제공하는 파일 스토리지                      | Cloud Storage for Firebase              |

**데이터 흐름 (Data Flow):**

1.  사용자는 확장 프로그램을 통해 Google 계정으로 로그인합니다 (최초 1회).
2.  웹서핑 중 `Alt+클릭`으로 텍스트나 이미지를 스크랩합니다.
3.  **이미지**는 **Firebase Storage**에 업로드되고, 고유 다운로드 URL이 생성됩니다.
4.  **텍스트 데이터**와 이미지의 **URL**은 사용자의 고유 ID와 함께 **Firestore** 데이터베이스에 저장됩니다.
5.  다른 PC에서 동일한 Google 계정으로 로그인하면, 확장 프로그램은 Firestore에서 해당 사용자의 데이터를 가져와 화면에 표시합니다. 데이터가 변경되면 모든 기기에 실시간으로 동기화됩니다.

---

### **개발을 위한 단계별 상세 계획 (Step-by-Step Development Plan)**

#### **Phase 1: Firebase 연동 및 사용자 인증 기반 구축 (소요 기간: 약 1주)**

> **목표**: 사용자가 Google 계정으로 로그인하고, 개인 데이터를 저장할 수 있는 기반을 마련합니다.

1.  **Firebase 프로젝트 생성**:
    - Google Firebase 콘솔에 접속하여 새 프로젝트를 생성합니다.
    - 프로젝트 내에서 **Authentication(Google 로그인 활성화)**, **Firestore Database**, **Storage** 서비스를 활성화합니다.
2.  **Firebase SDK 설치 및 연동**:
    - `manifest.json`을 수정하여 Firebase SDK 스크립트를 로드하고, 콘텐츠 보안 정책(CSP)을 설정하여 Firebase 서버와 통신을 허용합니다.
    - Firebase 프로젝트 설정에서 웹 앱 구성 정보(API 키 등)를 가져와 확장 프로그램에 추가합니다.
3.  **로그인/로그아웃 UI 구현**:
    - `content.js`를 수정하여 UI 패널에 **'Google 계정으로 로그인'** 버튼을 추가합니다.
    - 로그인 성공 시, 버튼을 사용자 프로필 사진과 이름으로 변경하고 로그아웃 버튼을 제공합니다.
4.  **인증 상태 관리**:
    - 사용자가 로그인하면 `onAuthStateChanged` 리스너를 통해 사용자 정보(UID 등)를 전역 변수에 저장합니다. 이 UID는 모든 데이터를 저장하고 조회하는 기준이 됩니다.

#### **Phase 2: 데이터 저장소를 `chrome.storage`에서 Firestore로 전환 (소요 기간: 약 2주)**

> **목표**: 모든 텍스트 데이터를 `chrome.storage.local`에서 클라우드 데이터베이스인 Firestore로 이전하여 기기 간 동기화를 구현합니다.

1.  **Firestore 데이터 구조 설계**:
    - 컬렉션(Collection)과 문서(Document) 구조를 설계합니다. 예를 들어, 최상위 컬렉션을 `users`로 두고, 각 사용자의 UID를 문서 ID로 사용합니다. 그 안에 `projects`, `scraps`, `prompts` 등의 하위 컬렉션을 두는 구조를 구상합니다.
    - **예시 구조**: `users/{user_uid}/projects/{project_id}/scraps/{scrap_id}`
2.  **프로젝트 관리 기능 구현**:
    - UI에 '프로젝트' 개념을 도입합니다. 사용자는 데이터를 저장하기 전에 어떤 프로젝트에 속할지 선택하거나 새로 만들 수 있습니다.
    - 프로젝트 목록을 보여주고 관리하는 UI를 추가합니다.
3.  **데이터 CRUD 로직 변경**:
    - 기존에 `chrome.storage.local.set()`과 `get()`을 사용하던 모든 코드를 Firestore의 `addDoc()`, `getDoc()`, `updateDoc()`, `deleteDoc()` 등의 함수로 교체합니다.
    - 데이터를 저장할 때는 현재 로그인된 사용자의 UID와 선택된 프로젝트 ID를 포함하여 저장 경로를 지정합니다.
4.  **실시간 리스너 적용**:
    - Firestore의 `onSnapshot` 리스너를 사용하여 데이터 변경을 실시간으로 감지하고, 별도의 새로고침 없이 UI에 즉시 반영되도록 합니다.

#### **Phase 3: 이미지 저장소를 Firebase Storage로 구현 (소요 기간: 약 1주)**

> **목표**: 이미지 파일을 클라우드에 저장하고, 여러 기기에서 동일한 이미지를 볼 수 있도록 합니다.

1.  **이미지 업로드 로직 구현**:
    - 사용자가 이미지를 스크랩하거나 드래그앤드랍으로 추가할 때, 해당 이미지 파일(Blob 또는 Data URL)을 가져옵니다.
    - Firebase Storage SDK의 `uploadBytes` 또는 `uploadString` 함수를 사용하여 이미지를 업로드합니다. 업로드 경로는 `images/{user_uid}/{image_filename}`과 같이 구성합니다.
2.  **URL 저장 및 표시 로직 구현**:
    - 이미지 업로드가 완료되면 `getDownloadURL` 함수를 통해 해당 이미지의 고유 URL을 받습니다.
    - 이 **URL을 텍스트 데이터와 함께 Firestore에 저장**합니다. (이미지 자체를 DB에 저장하지 않습니다.)
    - UI에서 이미지를 표시할 때는 Firestore에서 가져온 URL을 `<img>` 태그의 `src` 속성에 넣어주기만 하면 됩니다.

#### **Phase 4: 워크플로우 중심의 UI/UX 개선 (소요 기간: 약 1~2주)**

> **목표**: 이전 제안을 바탕으로, 사용자가 '수집 → 기획 → 제작'의 흐름에 따라 자연스럽게 프로그램을 사용할 수 있도록 UI를 개선합니다.

1.  **모드 전환 UI 도입**:
    - 확장 프로그램의 메인 UI를 **'스크랩북 모드', '기획 보드 모드', '초안 작성 모드'**로 전환할 수 있는 탭이나 버튼을 추가합니다.
2.  **스크랩북 UI 구현**:
    - 수집한 데이터를 텍스트 목록이 아닌, 미리보기가 포함된 **카드 형태**로 표시하여 시각적 만족도와 직관성을 높입니다.
3.  **기획 보드 및 초안 편집기 구현**:
    - 드래그앤드랍으로 콘텐츠 개요를 구성할 수 있는 인터페이스와, AI 어시스턴트 기능이 통합된 텍스트 편집기를 구현합니다.
    - 이 단계에서는 기존의 'AI 분석' 및 'Gemini 결과' 패널의 기능들을 새로운 모드에 맞게 통합하고 재배치합니다.

이 계획은 현재의 강력한 기능들을 기반으로, **서버리스(Serverless)** 아키텍처를 통해 **지속 가능하고 확장 가능한 서비스**로 발전시키는 체계적인 로드맵입니다. 각 단계를 완료할 때마다 프로그램의 가치가 크게 향상될 것입니다.
#### **스크랩 UI/UX**
<img width="842" height="819" alt="Image" src="https://github.com/user-attachments/assets/0787955a-1316-4aa5-8333-bfb25997cfa3" />
