// tui-editor.js: iframe 내 TUI Image Editor 컨트롤러

let documentImages = [];
let currentImageUrl = null;
let isDirty = false;
let tuiEditorInstance = null;

window.addEventListener("message", async function (event) {
  if (!event.data || !event.data.action) return;
  if (event.data.action === "open-tui-editor" && event.data.imageUrl) {
    currentImageUrl = event.data.imageUrl;
    openTuiEditor(currentImageUrl);
  }
  if (event.data.action === "set-document-images" && Array.isArray(event.data.images)) {
    documentImages = event.data.images;
    renderSidebar();
  }
  if (event.data.action === "get-edited-image") {
    if (window.tuiEditorInstance) {
      const dataUrl = window.tuiEditorInstance.toDataURL();
      window.parent.postMessage({ action: "tui-editor-result", dataUrl }, "*");
    }
  }
  if (event.data.action === "add-undo-stack") {
    if (window.tuiEditorInstance && window.tuiEditorInstance._graphics) {
      // TUI ImageEditor 내부 Graphics 객체의 undoStack에 현재 상태 push
      try {
        window.tuiEditorInstance._graphics.undoStack.push(
          window.tuiEditorInstance._graphics.getCurrentState()
        );
        // undoStackChanged 이벤트 강제 발생
        if (typeof window.tuiEditorInstance._graphics.fire === "function") {
          window.tuiEditorInstance._graphics.fire("undoStackChanged");
        }
      } catch (e) {
        console.warn("add-undo-stack 실패", e);
      }
    }
  }
});

function renderSidebar() {
  let sidebar = document.getElementById("cp-image-sidebar");
  if (!sidebar) {
    sidebar = document.createElement("div");
    sidebar.id = "cp-image-sidebar";
    sidebar.style.position = "fixed";
    sidebar.style.left = "0";
    sidebar.style.top = "0";
    sidebar.style.width = "96px";
    sidebar.style.height = "100vh";
    sidebar.style.background = "#f8fafc";
    sidebar.style.borderRight = "1px solid #e5e7eb";
    sidebar.style.overflowY = "auto";
    sidebar.style.zIndex = "10001";
    sidebar.style.display = "flex";
    sidebar.style.flexDirection = "column";
    sidebar.style.alignItems = "center";
    sidebar.style.padding = "12px 0";
    document.body.appendChild(sidebar);
  }
  sidebar.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;">문서 이미지</div>';
  documentImages.forEach((img, idx) => {
    const thumb = document.createElement("img");
    thumb.src = img.url;
    thumb.style.width = "72px";
    thumb.style.height = "72px";
    thumb.style.objectFit = "cover";
    thumb.style.borderRadius = "8px";
    thumb.style.marginBottom = "10px";
    thumb.style.cursor = "pointer";
    thumb.style.border = (img.url === currentImageUrl) ? "2px solid #2563eb" : "2px solid #e5e7eb";
    thumb.title = img.url;
    thumb.onclick = async function () {
      if (img.url === currentImageUrl) return;
      if (isDirty) {
        if (!confirm("이전 편집 내용이 저장되지 않았습니다. 그래도 이미지를 전환하시겠습니까?")) return;
      }
  // Range 정보 + URL을 Quill로 전달
  window.parent.postMessage({ action: "cp_update_editing_range", data: { range: img.range, url: img.url } }, "*");
      // 이미지 로드
      currentImageUrl = img.url;
      openTuiEditor(currentImageUrl);
      isDirty = false;
      renderSidebar();
    };
    sidebar.appendChild(thumb);
  });
}

function openTuiEditor(imageUrl) {
  const mount = document.getElementById("mount");
  mount.style.position = "fixed";
  mount.style.left = "120px";
  mount.style.top = "0";
  mount.style.width = "calc(100vw - 120px)";
  mount.style.height = "100vh";
  if (!tuiEditorInstance) {
    mount.innerHTML = "";
    try {
      tuiEditorInstance = new window.tui.ImageEditor(mount, {
        includeUI: {
          loadImage: { path: imageUrl, name: "image" },
          menu: [
            "crop",
            "flip",
            "rotate",
            "draw",
            "shape",
            "icon",
            "text",
            "mask",
            "filter",
          ],
          uiSize: { width: "calc(100vw - 120px)", height: "100vh" },
          theme: {},
        },
        cssMaxWidth: 1200,
        cssMaxHeight: 800,
        selectionStyle: {
          cornerSize: 16,
          rotatingPointOffset: 48,
        },
      });
      window.tuiEditorInstance = tuiEditorInstance;
      tuiEditorInstance.on("object:added", () => { isDirty = true; });
      tuiEditorInstance.on("object:modified", () => { isDirty = true; });
      tuiEditorInstance.on("object:removed", () => { isDirty = true; });
      tuiEditorInstance.on("undoStackChanged", () => { isDirty = true; });
      console.log("[TUI-IFRAME] mount:", mount);
      console.log("[TUI-IFRAME] tuiEditorInstance:", tuiEditorInstance);
    } catch (err) {
      alert("이미지 에디터 초기화 중 오류가 발생했습니다.\n\n" + (err?.message || err));
      console.error("[TUI-IFRAME] TUI Editor init error:", err);
    }
  } else {
    // 인스턴스가 이미 있으면 이미지 교체만 수행 (history 보존)
    tuiEditorInstance.loadImageFromURL(imageUrl, "image").catch((err) => {
      alert("이미지 서버의 보안 정책(CORS)으로 인해 이미지를 불러올 수 없습니다. 다른 이미지를 선택하거나, 직접 업로드해 주세요.\n\n오류: " + (err?.message || err));
    });
  }
}
