// 전역 토스트(모달) 함수 (중복 방지, 어디서든 호출 가능)
function showToast(msg) {
  let toast = document.getElementById("cp-toast-modal");
  if (toast) toast.remove();
  toast = document.createElement("div");
  toast.id = "cp-toast-modal";
  toast.textContent = msg;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.top = "60px";
  toast.style.transform = "translateX(-50%)";
  toast.style.background = "rgba(34,34,34,0.97)";
  toast.style.color = "#fff";
  toast.style.fontSize = "15px";
  toast.style.fontWeight = "600";
  toast.style.padding = "13px 32px";
  toast.style.borderRadius = "10px";
  toast.style.boxShadow = "0 2px 12px rgba(0,0,0,0.13)";
  toast.style.zIndex = "99999";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s";
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
  }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 1200);
}
// ===== 스크랩 후보 하이라이트 기능(Alt 하이라이트) =====
// 긴 링크를 줄여서 보여주는 함수
function shortenLink(url, maxLength = 40) {
  if (!url) return "";
  if (url.length <= maxLength) return url;
  const urlObj = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  if (urlObj) {
    const host = urlObj.host;
    const path =
      urlObj.pathname.length > 16
        ? urlObj.pathname.slice(0, 12) + "..." + urlObj.pathname.slice(-4)
        : urlObj.pathname;
    return host + path;
  }
  return url.slice(0, 25) + "..." + url.slice(-10);
}
// ===== 스크랩 후보 하이라이트 기능(Alt 하이라이트) =====
// ===== 스크랩 후보 하이라이트 기능(Alt 하이라이트) =====
if (!window.__pilotHighlightInitialized) {
  window.__pilotHighlightInitialized = true;
  window.__pilotHighlightTarget = null;
  window.__pilotHighlightActive = false;

  // 모든 프레임에서 Alt 키 상태 메시지를 수신하여 하이라이트 활성화 여부를 결정
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "alt_key_state_changed") {
      window.__pilotHighlightActive = msg.isAltPressed;
      if (!msg.isAltPressed && window.__pilotHighlightTarget) {
        window.__pilotHighlightTarget.classList.remove("pilot-highlight");
        window.__pilotHighlightTarget = null;
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    const panel = document.getElementById("content-pilot-panel");
    const cardBtn = document.getElementById("cp-card-float-btn");
    if (window.__pilotHighlightActive) {
      const el = e.target;
      // 패널 또는 최소화 카드 버튼 내부에서는 하이라이트 동작 금지
      if (
        (panel && (el === panel || panel.contains(el))) ||
        (cardBtn && (el === cardBtn || cardBtn.contains(el)))
      ) {
        if (window.__pilotHighlightTarget) {
          window.__pilotHighlightTarget.classList.remove("pilot-highlight");
          window.__pilotHighlightTarget = null;
        }
        return;
      }
      if (
        window.__pilotHighlightTarget &&
        window.__pilotHighlightTarget !== el
      ) {
        window.__pilotHighlightTarget.classList.remove("pilot-highlight");
        window.__pilotHighlightTarget = null;
      }
      if (el && el !== document.body && el !== document.documentElement) {
        if (!el.classList.contains("pilot-highlight")) {
          el.classList.add("pilot-highlight");
        }
        window.__pilotHighlightTarget = el;
      }
    } else {
      if (window.__pilotHighlightTarget) {
        window.__pilotHighlightTarget.classList.remove("pilot-highlight");
        window.__pilotHighlightTarget = null;
      }
    }
  });

  // Alt+클릭 시 스크랩 로직
  window.addEventListener(
    "click",
    (e) => {
      console.log(
        "[Content-Pilot] Alt+클릭 이벤트 진입",
        window.__pilotHighlightActive,
        e.target
      );
      if (window.__pilotHighlightActive) {
        const panel = document.getElementById("content-pilot-panel");
        const cardBtn = document.getElementById("cp-card-float-btn");
        const targetElement = e.target;
        // 패널 또는 최소화 카드 버튼 클릭 시 무시
        if (
          (panel &&
            (targetElement === panel || panel.contains(targetElement))) ||
          (cardBtn &&
            (targetElement === cardBtn || cardBtn.contains(targetElement)))
        ) {
          return;
        }
        e.preventDefault();
        // 하이라이트 제거
        targetElement.classList.remove("pilot-highlight");
        // 스크랩 로직 (예: background.js로 데이터 전송)
        // 이미지 링크 추출 (요소 내부 모든 <img>의 src)
        let images = [];
        const imgEls = targetElement.querySelectorAll("img");
        images = Array.from(imgEls)
          .map((img) => img.src)
          .filter((src) => typeof src === "string" && !!src);
        if (!Array.isArray(images)) images = [];
        const image = images.length > 0 ? images[0] : null;
        const scrapData = {
          text: targetElement.innerText,
          html: targetElement.outerHTML,
          tag: targetElement.tagName,
          url: location.href,
          image, // 대표 이미지(첫 번째)
          images, // 모든 이미지 배열
        };
        console.log("[Content-Pilot] 스크랩 이미지 배열:", images);
        console.log("[Content-Pilot] 대표 이미지:", image);
        console.log("[Content-Pilot] scrapData:", scrapData);
        if (
          typeof chrome !== "undefined" &&
          chrome.runtime &&
          chrome.runtime.sendMessage
        ) {
          chrome.runtime.sendMessage({
            action: "scrap_element",
            data: scrapData,
          });
        } else {
          console.warn("chrome.runtime.sendMessage를 사용할 수 없습니다.");
        }
        window.__pilotHighlightTarget = null;
        window.__pilotHighlightActive = false;
      }
    },
    true
  );
}

// UI 패널 및 관련 코드는 최상위 window에서만 실행
if (window.self === window.top) {
  // 프로그램 시작 시(최초 로드 시) background에 최신 스크랩 데이터 요청
  chrome.runtime.sendMessage(
    { action: "cp_get_firebase_scraps" },
    (response) => {
      if (response && response.data) {
        firebaseScraps = Array.isArray(response.data)
          ? response.data.map(({ tag, html, ...rest }) => rest)
          : [];
        renderScrapbook();
      }
    }
  );
  // Alt 키 상태를 background.js로 전달 (최상위 window에서만 실행)
  if (window.self === window.top) {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Alt") {
        chrome.runtime.sendMessage({
          action: "alt_key_state_changed",
          isAltPressed: true,
        });
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Alt") {
        chrome.runtime.sendMessage({
          action: "alt_key_state_changed",
          isAltPressed: false,
        });
      }
    });
  }
  // ...기존 UI 패널 생성 및 렌더링 코드...
}

// 확장 아이콘 클릭 시 패널 강제 오픈 메시지 수신 및 패널 생성은 최상위 window에서만 실행
if (window.self === window.top) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // background.js에서 파이어베이스 scraps 브로드캐스트 수신
    if (msg && msg.action === "cp_firebase_scraps") {
      // 태그, html 필드 제외하고 반영
      firebaseScraps = Array.isArray(msg.data)
        ? msg.data.map(({ tag, html, ...rest }) => rest)
        : [];
      renderScrapbook();
      return;
    }
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
}
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
    document.head.appendChild(style);
  }
  const iconUrl = chrome.runtime.getURL("images/icon-32.png");
  let activeMode = window.__cp_active_mode || "scrapbook";
  const tabs = [
    { key: "scrapbook", label: "스크랩북 모드", color: "#4285F4" },
    { key: "kanban", label: "기획 보드 모드", color: "#34A853" },
    { key: "draft", label: "초안 작성 모드", color: "#FBBC05" },
  ];
  // 레이아웃 모드 상태를 window 전역에 저장
  const isLayoutMode = !!window.__cp_layout_mode_active;
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
        <label id="cp-layout-mode-btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;border-radius:6px;transition:background 0.15s;line-height:1;">
          <input type="checkbox" id="cp-layout-mode-switch" style="display:none;" ${
            isLayoutMode ? "checked" : ""
          }>
          <span style="width:34px;height:20px;display:inline-block;position:relative;">
            <span style="position:absolute;left:0;top:0;width:34px;height:20px;background:${
              isLayoutMode ? "#e3f2fd" : "#e0e0e0"
            };border-radius:12px;transition:background 0.2s;"></span>
            <span style="position:absolute;top:2px;left:${
              isLayoutMode ? "16px" : "2px"
            };width:16px;height:16px;background:${
    isLayoutMode ? "#1976d2" : "#888"
  };border-radius:50%;transition:left 0.2s,background 0.2s;"></span>
          </span>
          <span style="font-size:14px;font-weight:600;color:${
            isLayoutMode ? "#1976d2" : "#888"
          };user-select:none;">레이아웃</span>
        </label>
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
  if (!panel) {
    panel = document.getElementById("content-pilot-panel");
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
      document.body.appendChild(panel);
    }
  }
  // 헤더와 본문을 한 번에 렌더링 (덮어쓰기)
  panel.innerHTML =
    renderPanelHeader() +
    `<div style="padding:32px 32px 32px 32px;text-align:center;color:#222;font-size:17px;font-weight:500;">Google 계정으로 로그인 후<br>콘텐츠를 스크랩하고 관리할 수 있습니다.</div>`;
  panel.querySelector("#cp-panel-close").onclick = closePanel;
  panel.querySelector("#cp-panel-fullscreen-exit").onclick =
    minimizePanelToCard;
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderScrapbook();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
}

// 프로필 UI 렌더링 함수
function renderProfileUI(user) {
  if (!panel) return;
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
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderScrapbook();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
}
// Content-Pilot UI 패널 및 Google 로그인/로그아웃 UI 구현
// 모든 패널 관련 전역 변수/함수 선언 및 패널 생성 코드는 반드시 최상위 window에서만 실행
let panel;
if (window.self === window.top) {
  panel = document.getElementById("content-pilot-panel");
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
// Firebase 실시간 스크랩 데이터 관리
let firebaseScraps = [];
let firebaseScrapsUnsubscribe = null;

// Firebase compat SDK가 이미 background.js에서 importScripts로 로드됨을 가정
if (typeof firebase !== "undefined" && firebase.database) {
  // 실시간 구독 함수
  function subscribeScrapsRealtime() {
    if (firebaseScrapsUnsubscribe) return; // 중복 구독 방지
    const ref = firebase.database().ref("scraps");
    const handler = (snapshot) => {
      const val = snapshot.val() || {};
      // firebaseScraps: [{id, ...data}]
      firebaseScraps = Object.entries(val).map(([id, data]) => ({
        id,
        ...data,
      }));
      // 콘솔에 실시간 데이터 출력
      console.log(
        "[Content-Pilot] 파이어베이스 스크랩 데이터:",
        firebaseScraps
      );
      // 스크랩북이 열려 있으면 새로고침
      if (window.__cp_active_mode === "scrapbook") {
        renderScrapbook();
      }
    };
    ref.on("value", handler);
    firebaseScrapsUnsubscribe = () => ref.off("value", handler);
  }
  subscribeScrapsRealtime();
}
// Scrapbook UI 렌더링
function renderScrapbook(
  selectedId,
  sortType = "latest",
  filterKeyword = "",
  filterMode = "or",
  cardRect
) {
  if (!panel) return;
  // 리스트 헤더/정렬 그룹 width 동기화 함수
  function syncSortGroupWidth() {
    const listSection = panel.querySelector(".scrapbook-list-section");
    const sortGroup = panel.querySelector(".scrapbook-sort-group");
    if (listSection && sortGroup) {
      sortGroup.style.width = listSection.clientWidth + "px";
    }
  }
  // 레이아웃 모드에서 scrapbook-list-section 가로 리사이즈 핸들러
  if (window.__cp_layout_mode_active) {
    const listSection = panel.querySelector(".scrapbook-list-section");
    const listHandle = panel.querySelector("#scrapbook-list-resize-handle");
    if (listSection && listHandle) {
      let resizingList = false;
      let startX, startW;
      listHandle.onmousedown = (e) => {
        e.preventDefault();
        resizingList = true;
        startX = e.clientX;
        startW = listSection.offsetWidth;
        document.body.style.userSelect = "none";
      };
      document.onmousemove = (e) => {
        if (!resizingList) return;
        const dx = e.clientX - startX;
        listSection.style.width =
          Math.max(120, Math.min(startW + dx, window.innerWidth * 0.8)) + "px";
        syncSortGroupWidth();
      };
      document.onmouseup = () => {
        if (resizingList) {
          resizingList = false;
          document.body.style.userSelect = "";
        }
      };
      // 최초 진입 시에도 동기화
      setTimeout(syncSortGroupWidth, 0);
    }
    // 창 크기 변경 시에도 동기화
    window.addEventListener("resize", syncSortGroupWidth);
  } else {
    // 레이아웃 모드 off시 리스트 크기 초기화
    const listSection = panel.querySelector(".scrapbook-list-section");
    const sortGroup = panel.querySelector(".scrapbook-sort-group");
    if (listSection) {
      listSection.style.height = "";
      listSection.style.width = "";
    }
    if (sortGroup) {
      sortGroup.style.width = "";
    }
  }
  if (!panel) return;
  // 전체 레이아웃 초기화 (헤더 포함, 덮어쓰기)
  window.__cp_active_mode = "scrapbook";
  const rootStyle = window.__cp_layout_mode_active
    ? "position:relative;resize:both;overflow:auto;min-width:320px;min-height:320px;max-width:98vw;max-height:90vh;border:2px dashed #1976d2;"
    : "position:relative;";
  const resizeHandle = window.__cp_layout_mode_active
    ? '<div id="scrapbook-resize-handle" style="position:absolute;right:0;bottom:0;width:24px;height:24px;cursor:se-resize;z-index:10;"><svg width="24" height="24"><rect x="8" y="16" width="8" height="2" fill="#1976d2"/><rect x="12" y="20" width="4" height="2" fill="#1976d2"/></svg></div>'
    : "";
  const listSectionStyle = window.__cp_layout_mode_active
    ? "resize:horizontal;overflow:auto;min-height:120px;max-height:80vh;min-width:120px;max-width:80vw;border-right:2px dashed #1976d2;position:relative;"
    : "";
  const listResizeHandle = window.__cp_layout_mode_active
    ? '<div id="scrapbook-list-resize-handle" style="position:absolute;top:0;right:0;width:12px;height:100%;cursor:e-resize;z-index:11;background:transparent;"></div>'
    : "";
  panel.innerHTML =
    renderPanelHeader() +
    `<div class="scrapbook-root" style="${rootStyle}">${resizeHandle}
      <div class="scrapbook-list-section" style="${listSectionStyle}">
        ${listResizeHandle}
  <div class="scrapbook-list-header" style="width:100%;max-width:none;margin:0;display:flex;align-items:center;gap:8px;">
    <span class="scrapbook-list-title">스크랩 리스트</span>
  </div>
  <div class="scrapbook-sort-group" >
    <button class="scrapbook-sort-btn${
      sortType === "latest" ? " active" : ""
    }" data-sort="latest">최신</button>
    <button class="scrapbook-sort-btn${
      sortType === "popular" ? " active" : ""
    }" data-sort="popular">인기</button>
    <button class="scrapbook-sort-btn${
      sortType === "keyword" ? " active" : ""
    }" data-sort="keyword">키워드</button>
    <div style="display:flex; align-items:center; gap:6px;">
      <input class="scrapbook-keyword-input" type="text" placeholder="키워드" value="${
        filterKeyword || ""
      }"
        style="height:32px; font-size:15px; border-radius:6px; border:1px solid #d0d0d0; padding:0 10px;">
      <select class="scrapbook-keyword-mode" style="height:32px; font-size:15px; border-radius:6px; border:1px solid #d0d0d0; padding:0 8px;">
        <option value="or">부분일치(OR)</option>
        <option value="and">모두포함(AND)</option>
        <option value="exact">완전일치</option>
        <option value="text">텍스트만</option>
      </select>
    </div>
  </div>
  <div class="scrapbook-list-cards" style="max-width:340px;width:100%;margin:0 auto;overflow-y:auto;min-height:120px;"></div>
      </div>
      <div class="scrapbook-detail-section" style="display: flex;flex-direction: column;align-items: center;justify-content: flex-start;min-height: 480px;padding: 32px 0 32px 0;position: relative;background: #f7f8fa;">
        <div class="scrapbook-detail-header" style="width:100%;max-width:540px;font-size:1.18rem;font-weight:700;color:#4285F4;margin-bottom:18px;text-align:left;letter-spacing:0.01em;">스크랩 상세</div>
        <div class="scrapbook-detail-content" style="width:100%;max-width:540px;position:relative;padding-right:32px;"></div>
      </div>
    </div>`;
  `;

  // 레이아웃 모드에서 scrapbook-root 크기 조정 핸들러
  if (window.__cp_layout_mode_active) {
    const root = panel.querySelector('.scrapbook-root');
    const handle = panel.querySelector('#scrapbook-resize-handle');
    if (root && handle) {
      let resizing = false;
      let startX, startY, startW, startH;
      handle.onmousedown = (e) => {
        e.preventDefault();
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = root.offsetWidth;
        startH = root.offsetHeight;
        document.body.style.userSelect = 'none';
      };
      document.onmousemove = (e) => {
        if (!resizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        root.style.width = Math.max(320, Math.min(startW + dx, window.innerWidth * 0.98)) + 'px';
        root.style.height = Math.max(320, Math.min(startH + dy, window.innerHeight * 0.9)) + 'px';
      };
      document.onmouseup = () => {
        if (resizing) {
          resizing = false;
          document.body.style.userSelect = '';
        }
      };
    }
  } else {
    // 레이아웃 모드 off시 크기 초기화
    const root = panel.querySelector('.scrapbook-root');
    if (root) {
      root.style.width = '';
      root.style.height = '';
    }
  }
  <div class="scrapbook-list-header" style="max-width:340px;width:100%;margin:0 auto;">
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
            <div style="display:flex; align-items:center; gap:6px;">
              <input class="scrapbook-keyword-input" type="text" placeholder="키워드" value="${
                filterKeyword || ""
              }" style="height:32px; font-size:15px; border-radius:6px; border:1px solid #d0d0d0; padding:0 10px;">
              <select class="scrapbook-keyword-mode" style="height:32px; font-size:15px; border-radius:6px; border:1px solid #d0d0d0; padding:0 8px;">
                <option value="or">부분일치(OR)</option>
                <option value="and">모두포함(AND)</option>
                <option value="exact">완전일치</option>
                <option value="text">텍스트만</option>
              </select>
            </div>
          </div>
        </div>
  <div class="scrapbook-list-cards" style="max-width:340px;width:100%;margin:0 auto;overflow-y:auto;min-height:120px;"></div>
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
  // 레이아웃 모드 버튼 이벤트 항상 재바인딩
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderScrapbook();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
  bindTabClickEvents();

  // 정렬/필터 적용
  let scraps = [...firebaseScraps];
  if (filterKeyword) {
    const mode = filterMode || "or";
    const keywords = filterKeyword.trim().split(/\s+/).filter(Boolean);
    if (mode === "or") {
      scraps = scraps.filter((s) =>
        keywords.some(
          (kw) =>
            (s.text && s.text.includes(kw)) ||
            (s.url && s.url.includes(kw)) ||
            (s.tag && s.tag.includes(kw))
        )
      );
    } else if (mode === "and") {
      scraps = scraps.filter((s) =>
        keywords.every(
          (kw) =>
            (s.text && s.text.includes(kw)) ||
            (s.url && s.url.includes(kw)) ||
            (s.tag && s.tag.includes(kw))
        )
      );
    } else if (mode === "exact") {
      scraps = scraps.filter(
        (s) =>
          (s.text && s.text === filterKeyword) ||
          (s.url && s.url === filterKeyword) ||
          (s.tag && s.tag === filterKeyword)
      );
    } else if (mode === "text") {
      scraps = scraps.filter((s) =>
        keywords.some((kw) => s.text && s.text.includes(kw))
      );
    }
  }
  if (sortType === "popular") {
    scraps.sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  } else if (sortType === "latest") {
    scraps.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  // 카드 리스트 렌더링
  const listEl = panel.querySelector(".scrapbook-list-cards");
  listEl.innerHTML = scraps
    .map(
      (scrap) => `
    <div class="scrap-card${
      scrap.id === selectedId ? " active" : ""
    }" data-id="${scrap.id}" tabindex="0">
  <div class="scrap-card-img-wrap" style="width: 112px; height: 84px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(66,133,244,0.10); background: #f7f8fa; display: flex; align-items: center; justify-content: center; position:relative;">
        ${(() => {
          // 대표 이미지가 리퍼러 등으로 출력 불가라면 images 배열에서 다음 이미지 사용
          const isReferrerBlocked =
            scrap.image && scrap.image.includes("postfiles.pstatic.net");
          let displayImage = scrap.image;
          if (isReferrerBlocked && Array.isArray(scrap.images)) {
            // 다음 이미지 중 postfiles.pstatic.net이 아닌 첫 번째 이미지 찾기
            const altImg = scrap.images.find(
              (img) => img && !img.includes("postfiles.pstatic.net")
            );
            if (altImg) displayImage = altImg;
          }
          if (isReferrerBlocked && displayImage === scrap.image) {
            // 대체 이미지가 없으면 안내
            return `<div style=\"width:104px;height:76px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;background:#b0b0b0;border-radius:10px;position:relative;cursor:help;\" title=\"이 이미지는 리퍼러(출처) 정보가 필요한 이미지로, 외부 사이트에서는 보이지 않을 수 있습니다.\\n\\n리퍼러란? 이미지를 요청한 웹사이트의 주소(출처) 정보입니다. 일부 사이트는 이 정보가 다를 때 이미지를 차단할 수 있습니다. 이미지를 보고 싶다면 원본 사이트에서 확인해 주세요.\\n\\n원본: ${scrap.image}\">리퍼러 이미지</div>`;
          } else if (displayImage) {
            return `<img src=\"${displayImage}\" alt=\"스크랩 이미지\" style=\"width: 104px; height: 76px; object-fit: cover; border-radius: 10px; background: #f0f0f0; position:relative; display:block;\">`;
          } else {
            return '<span style="width:104px;height:76px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;background:#f0f0f0;border-radius:10px;">이미지 없음</span>';
          }
        })()}
      </div>
  <div class="scrap-card-info" style="position:relative;">
        <div class="scrap-card-title" style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${
          scrap.text ? scrap.text.substring(0, 30) : "(텍스트 없음)"
        }</div>
        <div class="scrap-card-snippet" style="color:#888;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${
          scrap.url
            ? scrap.url.replace(/^https?:\/\//, "").substring(0, 40)
            : ""
        }</div>
        <div class="scrap-card-source" style="color:#b0b0b0;font-size:12px;">${
          scrap.tag || ""
        }</div>
        <button class="scrap-card-delete-btn" data-id="${
          scrap.id
        }" title="삭제" style="position:absolute;top:6px;left:6px;right:auto;width:22px;height:22px;border:none;background:rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.08);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background 0.15s;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="#d32f2f" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
    </div>
  `
    )
    .join("");

  // 카드 클릭/키보드 이벤트
  Array.from(listEl.getElementsByClassName("scrap-card")).forEach((card) => {
    card.onclick = (e) => {
      // 삭제 버튼 클릭 시 카드 클릭 이벤트 막기
      if (e.target.closest(".scrap-card-delete-btn")) return;
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
  // 삭제 버튼 이벤트 바인딩
  Array.from(listEl.getElementsByClassName("scrap-card-delete-btn")).forEach(
    (btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (!id) return;
        if (
          typeof chrome !== "undefined" &&
          chrome.runtime &&
          chrome.runtime.sendMessage
        ) {
          chrome.runtime.sendMessage(
            {
              action: "cp_delete_firebase_scrap",
              id,
            },
            (res) => {
              if (res && res.success) {
                showToast("삭제되었습니다");
                console.log("[Content-Pilot] 삭제 성공:", id);
              } else if (res && res.error) {
                alert("삭제 중 오류가 발생했습니다: " + res.error);
              } else {
                alert("삭제 중 오류가 발생했습니다.");
              }
            }
          );
        } else {
          alert("Firebase를 사용할 수 없습니다.");
        }

        // ...existing code...
        // 전역 토스트(모달) 함수 (중복 방지, 어디서든 호출 가능)
      };
    }
  );

  // 정렬/필터 버튼 이벤트
  panel.querySelectorAll(".scrapbook-sort-btn").forEach((btn) => {
    btn.onclick = () =>
      renderScrapbook(selectedId, btn.dataset.sort, filterKeyword);
  });
  const filterInput = panel.querySelector(".scrapbook-keyword-input");
  const filterModeSelect = panel.querySelector(".scrapbook-keyword-mode");

  filterInput.oninput = (e) => {
    const value = e.target.value;
    const selectionStart = e.target.selectionStart;
    const selectionEnd = e.target.selectionEnd;
    if (window.__cp_keyword_input_timer)
      clearTimeout(window.__cp_keyword_input_timer);
    window.__cp_keyword_input_timer = setTimeout(() => {
      renderScrapbook(selectedId, sortType, value, filterModeSelect.value);
      setTimeout(() => {
        const newInput = panel.querySelector(".scrapbook-keyword-input");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(selectionStart, selectionEnd);
        }
      }, 0);
    }, 200);
  };

  filterModeSelect.onchange = () => {
    renderScrapbook(
      selectedId,
      sortType,
      filterInput.value,
      filterModeSelect.value
    );
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
          ${
            selected.image && selected.image.includes("postfiles.pstatic.net")
              ? `<div style="width:320px;height:200px;display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;background:#b0b0b0;border-radius:18px;border:2px solid #e0e0e0;position:relative;cursor:help;" title="이 이미지는 리퍼러(출처) 정보가 필요한 이미지로, 외부 사이트에서는 보이지 않을 수 있습니다.\n\n리퍼러란? 이미지를 요청한 웹사이트의 주소(출처) 정보입니다. 일부 사이트는 이 정보가 다를 때 이미지를 차단할 수 있습니다. 이미지를 보고 싶다면 원본 사이트에서 확인해 주세요.\n\n원본: ${selected.image}">리퍼러 이미지</div>`
              : `<img src="${selected.image ? selected.image : ""}" alt="${
                  selected.image ? "스크랩 이미지" : "이미지 없음"
                }"
              class="scrapbook-detail-img" style="width: 320px; height: 200px; object-fit: cover; border-radius: 18px; box-shadow: 0 2px 16px rgba(0,0,0,0.13); background: #f7f8fa; border: 2px solid #e0e0e0; position:relative; display:${
                selected.image ? "block" : "none"
              };">`
          }
          ${
            !selected.image
              ? '<div style="width:320px;height:200px;display:flex;align-items:center;justify-content:center;font-size:15px;color:#888;background:#f7f8fa;border-radius:18px;border:2px solid #e0e0e0;">이미지 없음</div>'
              : ""
          }
        </div>
        <div class="scrapbook-detail-title" style="
          font-size: 1.5rem; font-weight: 800; color: #1a237e; text-align: center; margin-top: 8px; letter-spacing: 0.01em; line-height: 1.3;">
          ${selected.text ? selected.text.substring(0, 60) : "(텍스트 없음)"}
        </div>
        <div class="scrapbook-detail-meta" style="
          font-size: 1.02rem; color: #4285F4; font-weight: 600; margin-bottom: 2px; letter-spacing: 0.01em; text-align:center;">
          <span style="vertical-align:middle; margin-right:4px; font-size:1.1em;">🔗</span>${
            selected.url
              ? `<a href="${
                  selected.url
                }" target="_blank" style="color:#4285F4;text-decoration:underline;">${shortenLink(
                  selected.url
                )}</a>`
              : ""
          }
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
  // 레이아웃 모드 버튼 이벤트 항상 재바인딩
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderKanban();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
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
  if (!panel) return;
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
  // 레이아웃 모드 버튼 이벤트 항상 재바인딩
  const layoutSwitch = panel.querySelector("#cp-layout-mode-switch");
  if (layoutSwitch) {
    layoutSwitch.onchange = (e) => {
      window.__cp_layout_mode_active = layoutSwitch.checked;
      renderDraftingMode();
      showToast &&
        showToast(
          window.__cp_layout_mode_active
            ? "레이아웃 설정 모드 ON"
            : "레이아웃 설정 모드 OFF"
        );
    };
    layoutSwitch.title = "레이아웃 설정 모드";
  }
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
