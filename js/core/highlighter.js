// Alt+클릭 및 하이라이트 로직 담당
// content.js에서 분리 이관
function initHighlighter() {
  if (window.__pilotHighlightInitialized) return;
  window.__pilotHighlightInitialized = true;
  window.__pilotHighlightTarget = null;
  window.__pilotHighlightActive = false;

  // Alt 키 상태 메시지 수신
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
window.initHighlighter = initHighlighter;
