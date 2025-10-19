// tui-editor.js: iframe 내 TUI Image Editor 컨트롤러
window.addEventListener("message", async function (event) {
  if (!event.data || !event.data.action) return;
  if (event.data.action === "open-tui-editor" && event.data.imageUrl) {
    openTuiEditor(event.data.imageUrl);
  }
  if (event.data.action === "get-edited-image") {
    if (window.tuiEditorInstance) {
      const dataUrl = window.tuiEditorInstance.toDataURL();
      window.parent.postMessage({ action: "tui-editor-result", dataUrl }, "*");
    }
  }
});

function openTuiEditor(imageUrl) {
  const mount = document.getElementById("mount");
  mount.innerHTML = "";
  mount.style.width = "100vw";
  mount.style.height = "100vh";
  try {
    window.tuiEditorInstance = new window.tui.ImageEditor(mount, {
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
        uiSize: { width: "100vw", height: "100vh" },
        theme: {},
      },
      cssMaxWidth: 1200,
      cssMaxHeight: 800,
      selectionStyle: {
        cornerSize: 16,
        rotatingPointOffset: 48,
      },
    });
    console.log("[TUI-IFRAME] mount:", mount);
    console.log("[TUI-IFRAME] tuiEditorInstance:", window.tuiEditorInstance);
  } catch (err) {
    console.error("[TUI-IFRAME] TUI Editor init error:", err);
  }
}
