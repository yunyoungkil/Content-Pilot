// ===== 스크랩 후보 하이라이트 기능 =====
let pilotHighlightTarget = null;
let pilotHighlightActive = false;

// Alt 키 상태 추적
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') pilotHighlightActive = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') {
    pilotHighlightActive = false;
    if (pilotHighlightTarget) {
      pilotHighlightTarget.classList.remove('pilot-highlight');
      pilotHighlightTarget = null;
    }
  }
});

// 마우스 오버 시 하이라이트
window.addEventListener('mouseover', (e) => {
  if (!pilotHighlightActive) return;
  const el = e.target;
  if (pilotHighlightTarget && pilotHighlightTarget !== el) {
    pilotHighlightTarget.classList.remove('pilot-highlight');
  }
  if (el && el !== document.body && el !== document.documentElement) {
    el.classList.add('pilot-highlight');
    pilotHighlightTarget = el;
  }
});

// 마우스가 요소를 벗어날 때 하이라이트 해제
window.addEventListener('mouseout', (e) => {
  if (pilotHighlightTarget && e.target === pilotHighlightTarget) {
    pilotHighlightTarget.classList.remove('pilot-highlight');
    pilotHighlightTarget = null;
  }
});

// background.js에 Firebase 저장 요청 및 결과 출력
chrome.runtime.sendMessage({ action: 'firebase-test-write' }, (response) => {
  if (response && response.success) {
    console.log('Firebase 저장 성공!', response.data);
  } else {
    console.error('Firebase 저장 실패:', response && response.error);
  }
});

// 확장 아이콘 클릭 시 패널 강제 오픈 메시지 수신
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "open_content_pilot_panel") {
    // 패널이 없으면 생성, 있으면 보이게
    let panel = document.getElementById("content-pilot-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "content-pilot-panel";
      panel.style.position = "fixed";
      panel.style.right = "32px";
      panel.style.bottom = "32px";
      panel.style.zIndex = "2147483647";
      panel.style.boxShadow = "0px 4px 24px rgba(0,0,0,0.13)";
      panel.style.borderRadius = "12px";
      panel.style.background = "#fff";
      panel.style.minWidth = "fit-content";
      panel.style.overflow = "auto";
      panel.style.top = "0";
      panel.style.left = "0";
      panel.innerHTML = renderPanelHeader();
      document.body.appendChild(panel);
      panel.querySelector("#cp-panel-close").onclick = closePanel;
    }
    panel.style.display = "";
    // Scrapbook 모드로 진입(최초)
    renderScrapbook();
  }
});
// 공통 헤더 렌더링 함수
function renderPanelHeader() {
  // 구글 머티리얼 심볼 폰트가 없으면 동적으로 head에 추가
  if (!document.getElementById("cp-material-symbols-font")) {
    const link = document.createElement("link");
    link.id = "cp-material-symbols-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(link);
  }
  // 스타일은 항상 한 번만 추가
  if (!document.getElementById("cp-material-symbols-style")) {
    const style = document.createElement("style");
    style.id = "cp-material-symbols-style";
    style.textContent = `.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }`;
  }
}

function renderPanelHeader() {
  // 구글 머티리얼 심볼 폰트가 없으면 동적으로 head에 추가
  if (!document.getElementById("cp-material-symbols-font")) {
    const link = document.createElement("link");
    link.id = "cp-material-symbols-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(link);
  }
  // 스타일은 항상 한 번만 추가
  if (!document.getElementById("cp-material-symbols-style")) {
    const style = document.createElement("style");
    style.id = "cp-material-symbols-style";
    style.textContent = `.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }`;
    document.head.appendChild(style);
  }
  const iconUrl = chrome.runtime.getURL("images/icon-32.png");
  let activeMode = window.__cp_active_mode || "scrapbook";
  const tabs = [
    { key: "scrapbook", label: "스크랩북 모드", color: "#4285F4" },
    { key: "kanban", label: "기획 보드 모드", color: "#34A853" },
    { key: "draft", label: "초안 작성 모드", color: "#FBBC05" },
  ];
  return `
    <div id="cp-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px 18px;border-bottom:1.5px solid #f0f0f0;background:#fff;border-radius:12px 12px 0 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${iconUrl}" alt="Content Pilot" style="height:26px;width:26px;">
        <span style="font-size:18px;font-weight:700;color:#222;letter-spacing:0.5px;">Content Pilot</span>
      </div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="cp-panel-fullscreen-exit" style="background:none;border:none;font-size:22px;color:#888;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <span class="material-symbols-outlined">fullscreen_exit</span>
        </button>
        <button id="cp-panel-close" style="background:none;border:none;font-size:22px;color:#888;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div id="cp-mode-tabs" style="display:flex;gap:8px;margin-bottom:8px;padding:0 18px 0 18px;">
      ${tabs
        .map(
          (tab) => `
            <div class="cp-mode-tab${
              activeMode === tab.key ? " active" : ""
            }" data-key="${tab.key}" style="
              padding:7px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:15px;
              color:${activeMode === tab.key ? tab.color : "#888"};
              background:${activeMode === tab.key ? "#f2f3f7" : "transparent"};
              border:2px solid ${
                activeMode === tab.key ? tab.color : "transparent"
              };
              transition:all 0.2s;
            ">${tab.label}</div>
          `
        )
        .join("")}
    </div>
  `;
// 파일 끝 중괄호 정리
}

// 로그인/로그아웃 클릭 핸들러 (임시)
function onLoginClick() {
  // 실제 구현에서는 Firebase Auth 등 연동
  alert("로그인 기능은 추후 구현 예정입니다.");
}
function onLogoutClick() {
  // 실제 구현에서는 로그아웃 처리
  alert("로그아웃 기능은 추후 구현 예정입니다.");
}
// 로그인 버튼 UI 렌더링 함수
function renderLoginButton() {
  // 헤더와 본문을 한 번에 렌더링 (덮어쓰기)
  panel.innerHTML =
    renderPanelHeader() +
    `<div style="padding:32px 32px 32px 32px;text-align:center;color:#222;font-size:17px;font-weight:500;">Google 계정으로 로그인 후<br>콘텐츠를 스크랩하고 관리할 수 있습니다.</div>`;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
}

// 프로필 UI 렌더링 함수
function renderProfileUI(user) {
  // 헤더와 프로필 UI를 한 번에 렌더링 (덮어쓰기)
  panel.innerHTML =
    renderPanelHeader() +
    `<div class="cp-profile">
      <img src="${user.photoURL}" alt="프로필">
      <span class="cp-name">${user.displayName}</span>
    </div>
    <button class="cp-btn" id="cp-logout-btn">로그아웃</button>`;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
  document.getElementById("cp-logout-btn").onclick = onLogoutClick;
}
// Content-Pilot UI 패널 및 Google 로그인/로그아웃 UI 구현

// 패널 생성
let panel = document.getElementById("content-pilot-panel");
if (!panel) {
  panel = document.createElement("div");
  panel.id = "content-pilot-panel";
  // 우측 하단 고정 스타일 기본 적용
  panel.style.position = "fixed";
  panel.style.right = "32px";
  panel.style.bottom = "32px";
  panel.style.zIndex = "2147483647";
  panel.style.boxShadow = "0px 4px 24px rgba(0,0,0,0.13)";
  panel.style.borderRadius = "12px";
  panel.style.background = "#fff";
  panel.style.minWidth = "fit-content";
  // panel.style.maxWidth = "600px";
  // panel.style.maxHeight = "90vh";
  panel.style.overflow = "auto";
  panel.style.top = "0";
  panel.style.left = "0";
  // 헤더 추가
  panel.innerHTML = renderPanelHeader();
  document.body.appendChild(panel);
  panel.querySelector("#cp-panel-close").onclick = closePanel;
}

// 패널 닫기 및 재오픈 플로팅 버튼 구현

function closePanel() {
  panel.style.display = "none";
}

// 패널 최소화(카드화) 및 좌하단 카드 버튼 표시 (전역)
function minimizePanelToCard() {
  panel.style.display = "none";
  showCardFloatingButton();
}

function showCardFloatingButton() {
  // 머티리얼 심볼 폰트 및 스타일(opsz 48) 동적 추가
  if (!document.getElementById("cp-material-symbols-font")) {
    const link = document.createElement("link");
    link.id = "cp-material-symbols-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(link);
  }
  if (!document.getElementById("cp-material-symbols-style-48")) {
    const style = document.createElement("style");
    style.id = "cp-material-symbols-style-48";
    style.textContent = `.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 48; }`;
    document.head.appendChild(style);
  }
  let cardBtn = document.getElementById("cp-card-float-btn");
  if (!cardBtn) {
    cardBtn = document.createElement("button");
    cardBtn.id = "cp-card-float-btn";
    cardBtn.style.position = "fixed";
    cardBtn.style.left = "36px";
    cardBtn.style.bottom = "36px";
    cardBtn.style.zIndex = "2147483648";
    cardBtn.style.width = "64px";
    cardBtn.style.height = "64px";
    cardBtn.style.borderRadius = "18px";
    cardBtn.style.background = "#fff";
    cardBtn.style.boxShadow = "0 2px 12px rgba(0,0,0,0.15)";
    cardBtn.style.border = "1.5px solid #e0e0e0";
    cardBtn.style.display = "flex";
    cardBtn.style.flexDirection = "column";
    cardBtn.style.alignItems = "center";
    cardBtn.style.justifyContent = "center";
    cardBtn.style.cursor = "pointer";
    cardBtn.style.padding = "0";
    cardBtn.style.transition = "box-shadow 0.18s";
    cardBtn.onmouseenter = () => {
      cardBtn.style.boxShadow = "0 4px 20px rgba(66,133,244,0.18)";
    };
    cardBtn.onmouseleave = () => {
      cardBtn.style.boxShadow = "0 2px 12px rgba(0,0,0,0.15)";
    };
    // 머티리얼 심볼 아이콘 및 텍스트
    cardBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:48px;margin-top:8px;color:#434343;">widget_width</span>
    `;
    cardBtn.onclick = () => {
      panel.style.display = "";
      cardBtn.remove();
    };
    document.body.appendChild(cardBtn);
  }
}

function showFloatingButton() {
  let btn = document.getElementById("cp-float-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "cp-float-btn";
    btn.style.position = "fixed";
    btn.style.right = "36px";
    btn.style.bottom = "36px";
    btn.style.zIndex = "2147483648";
    btn.style.width = "48px";
    btn.style.height = "48px";
    btn.style.borderRadius = "50%";
    btn.style.background = "#fff";
    btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.13)";
    btn.style.border = "1.5px solid #e0e0e0";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.cursor = "pointer";
    btn.style.padding = "0";
    btn.style.transition = "box-shadow 0.18s";
    btn.onmouseenter = () => {
      btn.style.boxShadow = "0 4px 16px rgba(66,133,244,0.18)";
    };
    btn.onmouseleave = () => {
      btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.13)";
    };
    // 아이콘
    const iconUrl = chrome.runtime.getURL("images/icon-32.png");
    btn.innerHTML = `<img src="${iconUrl}" alt="Content Pilot" style="width:28px;height:28px;">`;
    btn.onclick = () => {
      // 패널이 DOM에 없으면 새로 생성
      let panel = document.getElementById("content-pilot-panel");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "content-pilot-panel";
        panel.style.position = "fixed";
        panel.style.right = "32px";
        panel.style.bottom = "32px";
        panel.style.zIndex = "2147483647";
        panel.style.boxShadow = "0px 4px 24px rgba(0,0,0,0.13)";
        panel.style.borderRadius = "12px";
        panel.style.background = "#fff";
        panel.style.minWidth = "fit-content";
        panel.style.overflow = "auto";
        panel.style.top = "0";
        panel.style.left = "0";
        panel.innerHTML = renderPanelHeader();
        document.body.appendChild(panel);
        panel.querySelector("#cp-panel-close").onclick = closePanel;
      }
      panel.style.display = "";
      btn.remove();
    };
    document.body.appendChild(btn);
  }
}

// Scrapbook 샘플 데이터 (UI 테스트용)
const sampleScraps = [
  {
    id: "s1",
    title: "콘텐츠 마케팅 전략",
    snippet: "최신 AI 동향과 전망을 한눈에!",
    image:
      "https://storage.googleapis.com/static.fastcampus.co.kr/prod/uploads/202304/011837-982/7.jpg",
    content:
      "2025년 AI는 생성형 모델, 멀티모달, 에이전트 등 다양한 분야에서 혁신을 이끌 전망입니다.",
  },
  {
    id: "s2",
    title: "UX 디자인 가이드",
    snippet: "사용자 경험을 높이는 실전 팁",
    image:
      "https://storage.googleapis.com/static.fastcampus.co.kr/prod/uploads/202310/164619-1143/don-t-read,-just-look.png",
    content:
      "효과적인 UX 설계는 직관적 네비게이션, 일관된 UI, 접근성 강화가 핵심입니다.",
  },
  {
    id: "s3",
    title: "2025 AI 트렌드",
    snippet: "AI 시대의 콘텐츠 기획법",
    image:
      "https://cdn.prod.website-files.com/646742ada26b6e8f3a121721/67b7dbaf5b377dd7fc089f67_2%EC%9B%94%201%EC%A3%BC%EC%B0%A8%20KR_%EC%8D%B8%EB%84%A4%EC%9D%BC.webp",
    content:
      "AI를 활용한 타겟팅, 데이터 기반 기획, 자동화 도구 활용이 중요합니다.",
  },
  {
    id: "s4",
    title: "마케팅 자동화 도구 비교",
    snippet: "2025년 추천 마케팅 툴 TOP 5",
    image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    content:
      "마케팅 자동화는 효율적인 캠페인 운영과 데이터 분석에 필수적입니다.",
  },
  {
    id: "s5",
    title: "콘텐츠 SEO 최적화",
    snippet: "검색엔진 상위 노출 전략",
    image: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6",
    content: "키워드 분석, 메타데이터 최적화, 내부 링크 구조가 중요합니다.",
  },
  {
    id: "s6",
    title: "브랜딩 성공 사례",
    snippet: "글로벌 브랜드의 비밀",
    image: "https://images.unsplash.com/photo-1519125323398-675f0ddb6308",
    content: "일관된 메시지와 감성적 스토리텔링이 브랜딩의 핵심입니다.",
  },
  {
    id: "s7",
    title: "소셜 미디어 트렌드 2025",
    snippet: "플랫폼별 공략법",
    image: "https://images.unsplash.com/photo-1465101046530-73398c7f28ca",
    content: "숏폼 영상, 인플루언서 마케팅, 커뮤니티 빌딩이 대세입니다.",
  },
  {
    id: "s8",
    title: "콘텐츠 캘린더 만들기",
    snippet: "효율적인 일정 관리 팁",
    image: "https://images.unsplash.com/photo-1503676382389-4809596d5290",
    content: "정기적인 콘텐츠 발행과 팀 협업이 중요합니다.",
  },
  {
    id: "s9",
    title: "AI 기반 카피라이팅",
    snippet: "자동화된 문장 생성의 미래",
    image: "https://images.unsplash.com/photo-1515378791036-0648a3ef77b2",
    content: "AI 카피라이팅 도구는 빠른 제작과 A/B 테스트에 유용합니다.",
  },
  {
    id: "s10",
    title: "콘텐츠 퍼널 설계",
    snippet: "고객 여정에 맞춘 전략",
    image:
      "https://www.salesforce.com/content/dam/web/ko_kr/www/images/Hub/marketing/ai-marketing.jpg",
    content: "퍼널 단계별 맞춤 콘텐츠가 전환율을 높입니다.",
  },
  {
    id: "s11",
    title: "이메일 마케팅 가이드",
    snippet: "오픈율을 높이는 비법",
    image: "https://images.unsplash.com/photo-1464983953574-0892a716854b",
    content: "개인화, 타이밍, 명확한 CTA가 핵심입니다.",
  },
  {
    id: "s12",
    title: "콘텐츠 큐레이션 전략",
    snippet: "효과적인 정보 선별법",
    image: "https://images.unsplash.com/photo-1465101046530-73398c7f28ca",
    content: "신뢰할 수 있는 소스와 주제별 분류가 중요합니다.",
  },
  {
    id: "s13",
    title: "디자인 시스템 구축",
    snippet: "일관된 UI/UX의 시작",
    image: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6",
    content: "컴포넌트화, 가이드라인 문서화, 협업 툴 활용이 필수입니다.",
  },
];
// Scrapbook UI 렌더링
function renderScrapbook(
  selectedId,
  sortType = "latest",
  filterKeyword = "",
  cardRect
) {
  // 전체 레이아웃 초기화 (헤더 포함, 덮어쓰기)
  window.__cp_active_mode = "scrapbook";
  panel.innerHTML =
    renderPanelHeader() +
    `<div class="scrapbook-root">
      <div class="scrapbook-list-section">
        <div class="scrapbook-list-header">
          <span class="scrapbook-list-title">스크랩 리스트</span>
          <div class="scrapbook-sort-group">
            <button class="scrapbook-sort-btn${
              sortType === "latest" ? " active" : ""
            }" data-sort="latest">최신</button>
            <button class="scrapbook-sort-btn${
              sortType === "popular" ? " active" : ""
            }" data-sort="popular">인기</button>
            <button class="scrapbook-sort-btn${
              sortType === "keyword" ? " active" : ""
            }" data-sort="keyword">키워드</button>
            <input class="scrapbook-keyword-input" type="text" placeholder="키워드" value="${
              filterKeyword || ""
            }">
          </div>
        </div>
        <div class="scrapbook-list-cards"></div>
      </div>
      <div class="scrapbook-detail-section" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        min-height: 480px;
        padding: 32px 0 32px 0;
        position: relative;
        background: #f7f8fa;
      ">
        <div class="scrapbook-detail-header" style="width:100%;max-width:540px;font-size:1.18rem;font-weight:700;color:#4285F4;margin-bottom:18px;text-align:left;letter-spacing:0.01em;">스크랩 상세</div>
  <div class="scrapbook-detail-content" style="width:100%;max-width:540px;position:relative;padding-right:32px;"></div>
      </div>
    </div>`;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
  bindTabClickEvents();

  // 정렬/필터 적용
  let scraps = [...sampleScraps];
  if (filterKeyword) {
    scraps = scraps.filter(
      (s) =>
        s.title.includes(filterKeyword) || s.snippet.includes(filterKeyword)
    );
  }
  if (sortType === "popular") {
    scraps.sort((a, b) => a.id.localeCompare(b.id));
  } else if (sortType === "latest") {
    scraps.reverse();
  }

  // 카드 리스트 렌더링
  const listEl = panel.querySelector(".scrapbook-list-cards");
  listEl.innerHTML = scraps
    .map(
      (scrap) => `
    <div class="scrap-card${
      scrap.id === selectedId ? " active" : ""
    }" data-id="${scrap.id}" tabindex="0">
      <div class="scrap-card-img-wrap" style="width: 112px; height: 84px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(66,133,244,0.10); background: #f7f8fa; display: flex; align-items: center; justify-content: center;">
        <img src="${
          scrap.image
        }" alt="scrap" style="width: 104px; height: 76px; object-fit: cover; border-radius: 10px;">
      </div>
      <div class="scrap-card-info">
        <div class="scrap-card-title">${scrap.title}</div>
        <div class="scrap-card-snippet">${scrap.snippet}</div>
        <div class="scrap-card-source">source.com/...</div>
      </div>
    </div>
  `
    )
    .join("");

  // 카드 클릭/키보드 이벤트
  Array.from(listEl.getElementsByClassName("scrap-card")).forEach((card) => {
    card.onclick = (e) => {
      const newId = card.getAttribute("data-id");
      const valid = scraps.some((s) => s.id === newId) ? newId : undefined;
      // 클릭한 카드의 위치 정보 전달
      const rect = card.getBoundingClientRect();
      renderScrapbook(valid, sortType, filterKeyword, rect);
    };
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") card.onclick(e);
    };
  });

  // 정렬/필터 버튼 이벤트
  panel.querySelectorAll(".scrapbook-sort-btn").forEach((btn) => {
    btn.onclick = () =>
      renderScrapbook(selectedId, btn.dataset.sort, filterKeyword);
  });
  const filterInput = panel.querySelector(".scrapbook-keyword-input");
  // debounce 변수는 window에 저장 (모드 전환 시에도 유지)
  if (!window.__cp_keyword_input_timer) window.__cp_keyword_input_timer = null;
  filterInput.oninput = (e) => {
    const value = e.target.value;
    const selectionStart = e.target.selectionStart;
    const selectionEnd = e.target.selectionEnd;
    if (window.__cp_keyword_input_timer)
      clearTimeout(window.__cp_keyword_input_timer);
    window.__cp_keyword_input_timer = setTimeout(() => {
      renderScrapbook(selectedId, sortType, value);
      // 렌더 후 커서 위치 복원
      setTimeout(() => {
        const newInput = panel.querySelector(".scrapbook-keyword-input");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(selectionStart, selectionEnd);
        }
      }, 0);
    }, 200);
  };

  // 상세 패널 렌더링 (스켈레톤)
  const detailPanel = panel.querySelector(".scrapbook-detail-content");
  if (!scraps.length) {
    detailPanel.innerHTML = `<div class="scrapbook-detail-empty" style="text-align:center;padding:48px 0 32px 0;color:#888;font-size:1.13rem;">
      <div style="font-size:2.5rem;">📭</div>
      <div style="margin-top:10px;">스크랩이 없습니다.</div>
    </div>`;
    return;
  }
  if (!selectedId) {
    // 스크랩이 있을 때는 첫 번째 스크랩 자동 선택
    if (scraps.length > 0) {
      renderScrapbook(scraps[0].id, sortType, filterKeyword);
    }
    return;
  }
  // 스켈레톤 UI 표시
  detailPanel.innerHTML = `<div class="scrapbook-detail-skeleton"><div class="scrapbook-skeleton-img"></div><div class="scrapbook-skeleton-line"></div><div class="scrapbook-skeleton-line short"></div></div>`;
  setTimeout(() => {
    const selected = scraps.find((s) => s.id === selectedId) || scraps[0];
    if (!selected) {
      detailPanel.innerHTML = `<div class="scrapbook-detail-empty" style="text-align:center;padding:48px 0 32px 0;color:#888;font-size:1.13rem;">
        <div style="font-size:2.5rem;">📭</div>
        <div style="margin-top:10px;">스크랩이 없습니다.</div>
      </div>`;
      return;
    }
    // 상세 카드를 항상 가운데 flexbox로 정렬, position: static
    let detailStyle = `
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(66,133,244,0.10);
      padding: 36px 32px 32px 32px;
      max-width: 520px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      min-height: 380px;
      transition: box-shadow 0.2s, opacity 0.4s;
      word-break: keep-all;
      position: static;
      z-index: 1002;
      margin: 0 auto;
    `;
    detailPanel.innerHTML = `
      <div class="scrapbook-detail-card" style="${detailStyle}">
        <div style="width: 100%; display: flex; justify-content: center;">
          <img src="${selected.image}" alt="scrap" class="scrapbook-detail-img" style="
            width: 320px; height: 200px; object-fit: cover; border-radius: 18px; box-shadow: 0 2px 16px rgba(0,0,0,0.13); background: #f7f8fa; border: 2px solid #e0e0e0;">
        </div>
        <div class="scrapbook-detail-title" style="
          font-size: 1.5rem; font-weight: 800; color: #1a237e; text-align: center; margin-top: 8px; letter-spacing: 0.01em; line-height: 1.3;">
          ${selected.title}
        </div>
        <div class="scrapbook-detail-meta" style="
          font-size: 1.02rem; color: #4285F4; font-weight: 600; margin-bottom: 2px; letter-spacing: 0.01em; text-align:center;">
          <span style="vertical-align:middle; margin-right:4px; font-size:1.1em;">🔗</span>source.com/...
        </div>
        <div class="scrapbook-detail-desc" style="
          font-size: 1.13rem; color: #333; line-height: 1.8; text-align: left; margin-top: 2px; font-weight: 400;">
          ${selected.content}
        </div>
      </div>
      <style>
        @media (max-width: 600px) {
          .scrapbook-detail-card {
            max-width: 98vw !important;
            padding: 18px 4vw 18px 4vw !important;
          }
          .scrapbook-detail-img {
            width: 98vw !important;
            max-width: 98vw !important;
            height: 180px !important;
          }
        }
      </style>
    `;
    detailPanel.querySelector(".scrapbook-detail-card").style.opacity = 0;
    setTimeout(() => {
      detailPanel.querySelector(".scrapbook-detail-card").style.transition =
        "opacity 0.4s";
      detailPanel.querySelector(".scrapbook-detail-card").style.opacity = 1;
    }, 10);
  }, 400);
}

// 기존 로그인 UI 렌더링 함수 확장

const _renderLoginButton = renderLoginButton;
renderLoginButton = function () {
  _renderLoginButton();
  renderModeTabs("scrapbook");
  renderScrapbook();
};

const _renderProfileUI = renderProfileUI;
renderProfileUI = function (user) {
  _renderProfileUI(user);
  renderModeTabs("scrapbook");
  renderScrapbook();
};

// =========================
// Planning Board Mode UI/UX
// =========================

// 샘플 칸반 데이터
const sampleKanban = {
  아이디어: [
    { id: "1", title: "AI 트렌드 2025", cluster: true },
    { id: "2", title: "UX 디자인 가이드" },
  ],
  "기획 중": [{ id: "3", title: "콘텐츠 마케팅 전략" }],
  "초안 작성": [],
};

// AI 추천 클러스터 샘플
const aiClusters = [
  {
    id: "c1",
    title: "AI+UX 융합 아이디어",
    color: "#34A853",
    items: ["1", "2"],
  },
];

// 칸반 보드 렌더링
function renderKanban() {
  window.__cp_active_mode = "kanban";
  panel.innerHTML = renderPanelHeader();
  panel.innerHTML += `
    <div id="cp-kanban-wrap">
      ${Object.keys(sampleKanban)
        .map(
          (col) => `
        <div class="cp-kanban-col" data-col="${col}">
          <div class="cp-kanban-col-title">${col}</div>
          <div class="cp-kanban-cards" data-col="${col}"></div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
  bindTabClickEvents();
  // 카드 렌더링
  Object.entries(sampleKanban).forEach(([col, cards]) => {
    const colEl = panel.querySelector(`.cp-kanban-cards[data-col="${col}"]`);
    colEl.innerHTML = cards
      .map((card) => {
        const isCluster = aiClusters.some((c) => c.items.includes(card.id));
        return `<div class="cp-kanban-card${
          isCluster ? " cluster" : ""
        }" draggable="true" data-id="${card.id}">${card.title}</div>`;
      })
      .join("");
  });
  // 드래그 앤 드롭 이벤트
  let dragId = null;
  panel.querySelectorAll(".cp-kanban-card").forEach((card) => {
    card.ondragstart = (e) => {
      dragId = card.getAttribute("data-id");
      e.dataTransfer.effectAllowed = "move";
    };
  });
  panel.querySelectorAll(".cp-kanban-col").forEach((col) => {
    col.ondragover = (e) => {
      e.preventDefault();
    };
    col.ondrop = (e) => {
      e.preventDefault();
      if (!dragId) return;
      // 실제 이동 로직은 상태 관리 필요(여기선 샘플)
      alert("카드 이동: 실제 구현 필요");
      dragId = null;
    };
  });
}

// 상단 모드 전환 탭
function renderModeTabs(active) {
  const tabs = [
    { key: "scrapbook", label: "스크랩북", color: "#4285F4" },
    { key: "kanban", label: "기획 보드", color: "#34A853" },
    { key: "draft", label: "초안 작성", color: "#FBBC05" },
  ];
  panel.innerHTML += `
		<div id="cp-mode-tabs" style="display:flex;gap:8px;margin-bottom:8px;">
			${tabs
        .map(
          (tab) => `
				<div class="cp-mode-tab${active === tab.key ? " active" : ""}" data-key="${
            tab.key
          }" style="
					padding:7px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:15px;
					color:${active === tab.key ? tab.color : "#888"};
					background:${active === tab.key ? "#f2f3f7" : "transparent"};
					border:2px solid ${active === tab.key ? tab.color : "transparent"};
					transition:all 0.2s;
				">${tab.label}</div>
			`
        )
        .join("")}
		</div>
	`;
  // 탭 클릭 이벤트
  setTimeout(() => {
    panel.querySelectorAll(".cp-mode-tab").forEach((tabEl) => {
      tabEl.onclick = () => {
        if (tabEl.getAttribute("data-key") === "scrapbook") renderScrapbook();
        if (tabEl.getAttribute("data-key") === "kanban") renderKanban();
        if (tabEl.getAttribute("data-key") === "draft") renderDraftingMode();
      };
    });
  }, 10);
}

// Scrapbook/로그인 UI 확장: 상단 탭 추가
// (중복 정의 제거, 위에서 한 번만 정의)

// =========================
// Drafting Mode UI/UX 구현
// =========================

function renderDraftingMode() {
  window.__cp_active_mode = "draft";
  panel.innerHTML = renderPanelHeader();
  panel.innerHTML += `

  // 탭 클릭 이벤트 바인딩(헤더 렌더 후 1회만)
  bindTabClickEvents();
  // 탭 클릭 이벤트 바인딩(헤더 렌더 후 1회만)
  bindTabClickEvents();
  // 탭 클릭 이벤트 바인딩(헤더 렌더 후 1회만)
  bindTabClickEvents();

 <div id="cp-draft-wrap" style="display:flex;min-width:700px;height:420px;background:#f7f8fa;border-radius:8px;margin-top:12px;box-shadow:0 2px 12px rgba(0,0,0,0.10);overflow:hidden;">
      <div id="cp-draft-board" style="width:220px;background:#f2f3f7;border-right:1px solid #e0e0e0;padding:0 0 0 0;overflow-y:auto;">
        <div style="font-weight:700;font-size:16px;color:#4285F4;text-align:center;margin:18px 0 10px 0;">기획 보드</div>
        <div id="cp-draft-board-list"></div>
      </div>
      <div id="cp-draft-editor" style="flex:1;background:#fff;padding:28px 24px 24px 24px;display:flex;flex-direction:column;gap:12px;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;font-weight:700;color:#222;">초안 작성</span>
          <button id="cp-ai-suggest-btn" style="background:#FBBC05;color:#222;border:none;border-radius:4px;padding:7px 14px;font-weight:600;font-size:14px;cursor:pointer;">AI 제안</button>
        </div>
        <textarea id="cp-draft-textarea" style="flex:1;width:100%;min-height:220px;resize:vertical;font-size:15px;padding:14px 12px;border-radius:6px;border:1.5px solid #e0e0e0;background:#f7f8fa;color:#222;line-height:1.7;margin-top:8px;"></textarea>
      </div>
    </div>
  `;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
  bindTabClickEvents();
  // 기획 보드 카드 목록
  const boardList = Object.values(sampleKanban)
    .flat()
    .map(
      (card) =>
        `<div style="background:#fff;border-radius:6px;margin:10px 12px 0 12px;padding:10px 10px;font-size:15px;font-weight:500;color:#333;box-shadow:0 1px 4px rgba(66,133,244,0.04);">${card.title}</div>`
    )
    .join("");
  panel.querySelector("#cp-draft-board-list").innerHTML = boardList;
  // AI 제안 버튼 이벤트
  panel.querySelector("#cp-ai-suggest-btn").onclick = () => {
    const textarea = panel.querySelector("#cp-draft-textarea");
    textarea.value +=
      "\n[AI 제안] 예시 문장: 이곳에 AI가 추천하는 문장이나 단락이 추가됩니다.";
    textarea.focus();
  };
}

// 최초 진입 시 Scrapbook 모드로 시작
function initAuthUI() {
  // 실제 구현에서는 Firebase Auth 등으로 로그인 상태를 확인해야 함
  // 여기서는 임시로 user가 null이면 로그인 UI, 있으면 프로필 UI 렌더링
  const dummyUser = null; // { displayName: '홍길동', photoURL: 'https://randomuser.me/api/portraits/men/1.jpg' };
  if (dummyUser) {
    renderProfileUI(dummyUser);
  } else {
    renderLoginButton();
  }
}
initAuthUI();

// 모드 전환 탭 클릭 이벤트 바인딩 (전역)
function bindTabClickEvents() {
  setTimeout(() => {
    document.querySelectorAll(".cp-mode-tab").forEach((tabEl) => {
      tabEl.onclick = () => {
        window.__cp_active_mode = tabEl.getAttribute("data-key");
        if (tabEl.getAttribute("data-key") === "scrapbook") renderScrapbook();
        if (tabEl.getAttribute("data-key") === "kanban") renderKanban();
        if (tabEl.getAttribute("data-key") === "draft") renderDraftingMode();
      };
    });
  }, 10);
}
