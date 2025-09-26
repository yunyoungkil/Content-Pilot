// 칸반 보드 모드 UI

// 칸반 보드 모드 UI 렌더링
export function renderKanban(container = document.body) {
  // 기존 칸반 보드가 있으면 제거
  const prev = document.getElementById("cp-kanban-board-root");
  if (prev) prev.remove();

  // 루트 엘리먼트 생성
  const root = document.createElement("div");
  root.id = "cp-kanban-board-root";
  root.style =
    "position:fixed;top:60px;right:40px;z-index:9999;width:600px;height:400px;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,0.18);padding:24px;display:flex;flex-direction:row;gap:16px;";

  // 칸반 컬럼 샘플
  const columns = ["To Do", "In Progress", "Done"];
  columns.forEach((col) => {
    const colDiv = document.createElement("div");
    colDiv.style =
      "flex:1;background:#f6f8fa;border-radius:8px;padding:12px;min-width:120px;display:flex;flex-direction:column;gap:8px;";
    colDiv.innerHTML = `<div style='font-weight:bold;margin-bottom:8px;'>${col}</div><div style='color:#aaa;font-size:13px;'>카드를 여기에 추가하세요</div>`;
    root.appendChild(colDiv);
  });

  // 닫기 버튼
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style =
    "position:absolute;top:12px;right:16px;background:#eee;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;";
  closeBtn.onclick = () => root.remove();
  root.appendChild(closeBtn);

  container.appendChild(root);
}
