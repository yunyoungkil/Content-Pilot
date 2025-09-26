// 초안 작성 모드 UI

// 초안 작성 모드 UI 렌더링
export function renderDraftingMode(container = document.body) {
  // 기존 초안 모드가 있으면 제거
  const prev = document.getElementById("cp-draft-mode-root");
  if (prev) prev.remove();

  // 루트 엘리먼트 생성
  const root = document.createElement("div");
  root.id = "cp-draft-mode-root";
  root.style =
    "position:fixed;top:60px;right:40px;z-index:9999;width:520px;height:340px;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,0.18);padding:24px;display:flex;flex-direction:column;gap:16px;";

  // 안내 메시지 및 텍스트에어리어
  const title = document.createElement("div");
  title.textContent = "초안 작성 모드";
  title.style = "font-weight:bold;font-size:18px;margin-bottom:8px;";
  root.appendChild(title);

  const textarea = document.createElement("textarea");
  textarea.placeholder = "여기에 초안을 작성하세요...";
  textarea.style =
    "flex:1;width:100%;resize:none;border-radius:8px;border:1px solid #ddd;padding:12px;font-size:15px;";
  root.appendChild(textarea);

  // 닫기 버튼
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style =
    "align-self:flex-end;background:#eee;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;";
  closeBtn.onclick = () => root.remove();
  root.appendChild(closeBtn);

  container.appendChild(root);
}
