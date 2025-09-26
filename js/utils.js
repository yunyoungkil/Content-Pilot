// 유틸리티 함수 모음

// 전역 토스트(모달) 함수 (중복 방지, 어디서든 호출 가능)
export function showToast(msg) {
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

// 긴 링크를 줄여서 보여주는 함수
export function shortenLink(url, maxLength = 40) {
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
export function showConfirmationToast(message, onConfirm) {
  // 혹시 이전에 떠 있던 확인 창이 있다면 제거
  const existingToast = document.getElementById("cp-confirm-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "cp-confirm-toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 36px;
    left: 50%;
    transform: translateX(-50%) translateY(100px); /* 시작 위치 */
    opacity: 0;
    background: #323232;
    color: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 20px;
    font-size: 15px;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  toast.innerHTML = `
    <span>${message}</span>
    <div class="cp-confirm-actions" style="display: flex; gap: 8px;">
      <button id="cp-confirm-yes" style="background: #4285F4; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-weight: 600;">삭제</button>
      <button id="cp-confirm-no" style="background: #5f6368; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">취소</button>
    </div>
  `;

  document.body.appendChild(toast);

  // 나타나는 애니메이션
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  }, 50);

  const closeToast = () => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  };

  toast.querySelector('#cp-confirm-yes').onclick = () => {
    onConfirm(); // "삭제" 버튼 클릭 시 전달받은 함수 실행
    closeToast();
  };

  toast.querySelector('#cp-confirm-no').onclick = closeToast;
}