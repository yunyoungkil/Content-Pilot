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
