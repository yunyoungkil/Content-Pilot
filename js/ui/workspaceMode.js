// 썸네일 생성 기능 제거됨

// 이미지 갤러리 렌더링 및 에디터 삽입 이벤트
function updateImageGallery(resourceLibrary, linkedScrapsData, sendCommand) {
  const imageGalleryGrid = resourceLibrary.querySelector(".image-gallery-grid");
  if (!imageGalleryGrid) return;
  const imageUrls = renderImageGallery(linkedScrapsData);
  if (imageUrls.length === 0) {
    imageGalleryGrid.innerHTML =
      "<p>이미지 자료가 없습니다.<br>스크랩 객체에 image/allImages 필드가 포함되어 있는지 확인하세요.</p>";
    return;
  }
  imageGalleryGrid.innerHTML = imageUrls
    .map(
      (url) => `
      <div class="gallery-thumb-wrap">
        <img src="${url}" class="gallery-thumb" style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,0.08);" alt="자료 이미지">
      </div>
    `
    )
    .join("");
  imageGalleryGrid.querySelectorAll(".gallery-thumb").forEach((img) => {
    img.addEventListener("click", () => {
      sendCommand("insert-image", { url: img.src });
      sendCommand("focus");
    });
  });
}

// 이미지 데이터 집계 함수: 연결된 스크랩에서 image/allImages 필드 파싱, 중복 제거
function renderImageGallery(linkedScrapsData) {
  const imageSet = new Set();
  linkedScrapsData.forEach((scrap) => {
    if (scrap.image) imageSet.add(scrap.image);
    if (Array.isArray(scrap.allImages)) {
      scrap.allImages.forEach((url) => imageSet.add(url));
    }
  });
  let result = Array.from(imageSet);
  // 테스트: 이미지가 하나도 없으면 예시 이미지 추가
  if (result.length === 0) {
    result = [
      "https://dummyimage.com/240x160/4285f4/fff.png&text=No+Image",
      "https://dummyimage.com/240x160/1a73e8/fff.png&text=Sample+Image",
    ];
  }
  return result;
}

// 파이어베이스 전체 스크랩에서 이미지 갤러리 업데이트
function updateImageGalleryFromAllScraps(resourceLibrary, allScraps, sendCommand) {
  const imageGalleryGrid = resourceLibrary.querySelector(".image-gallery-grid");
  if (!imageGalleryGrid) return;
  
  const imageSet = new Set();
  allScraps.forEach((scrap) => {
    if (scrap.image) imageSet.add(scrap.image);
    if (Array.isArray(scrap.allImages)) {
      scrap.allImages.forEach((url) => imageSet.add(url));
    }
  });
  
  const imageUrls = Array.from(imageSet);
  
  if (imageUrls.length === 0) {
    imageGalleryGrid.innerHTML =
      "<p style='text-align:center;color:#888;padding:20px;'>이미지가 없습니다.</p>";
    return;
  }
  
  imageGalleryGrid.innerHTML = imageUrls
    .map(
      (url) => `
      <div class="gallery-thumb-wrap" draggable="true" data-image-url="${url}">
        <img src="${url}" class="gallery-thumb" style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:move;box-shadow:0 1px 6px rgba(0,0,0,0.08);" alt="자료 이미지">
      </div>
    `
    )
    .join("");
  
  // 클릭으로 이미지 삽입
  imageGalleryGrid.querySelectorAll(".gallery-thumb").forEach((img) => {
    img.addEventListener("click", () => {
      sendCommand("insert-image", { url: img.src });
      sendCommand("focus");
    });
  });
  
  // 드래그앤드랍으로 이미지 삽입
  imageGalleryGrid.querySelectorAll(".gallery-thumb-wrap").forEach((wrap) => {
    wrap.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", wrap.dataset.imageUrl);
      e.dataTransfer.effectAllowed = "copy";
    });
  });
}
// js/ui/workspaceMode.js (수정 완료된 최종 버전)

import { shortenLink } from "../utils.js";
import { marked } from "marked";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps)
    ? ideaData.linkedScraps
    : ideaData.linkedScraps
    ? Object.keys(ideaData.linkedScraps)
    : [];

  // --- 브리핑 데이터가 없으면 자동 생성 (각 필드별로 개별 체크) ---
  const needsOutline = !ideaData.outline || ideaData.outline.length === 0;
  const needsMainKeywords = !ideaData.tags || ideaData.tags.length <= 1 || (ideaData.tags.length === 1 && ideaData.tags[0] === '#AI-추천');
  const needsKeywords = !ideaData.recommendedKeywords || ideaData.recommendedKeywords.length === 0;
  const needsLongTail = !ideaData.longTailKeywords || ideaData.longTailKeywords.length === 0;
  
  // 각 필드가 없으면 개별적으로 생성 요청
  if (ideaData.title && ideaData.description) {
    if (needsOutline || needsMainKeywords || needsKeywords || needsLongTail) {
      chrome.runtime.sendMessage({
        action: "generate_idea_briefing",
        data: {
          cardId: ideaData.id,
          title: ideaData.title,
          description: ideaData.description,
          // 생성할 필드만 지정 (없는 것만 생성)
          generateOutline: needsOutline,
          generateMainKeywords: needsMainKeywords,
          generateKeywords: needsKeywords,
          generateLongTail: needsLongTail
        }
      }, (response) => {
        if (response && response.success) {
          // Firebase 실시간 업데이트를 통해 자동으로 UI가 갱신됨
          console.log("브리핑 데이터 생성 요청 완료");
        } else if (response && response.error) {
          console.error("브리핑 데이터 생성 실패:", response.error);
        }
      });
    }
  }

  // --- 에디터 draft 저장 메시지 수신 및 background로 전달 ---
  window.__cp_workspace_idea_id = ideaData.id;
  if (!window.__cp_workspace_save_listener) {
    window.addEventListener("message", function (event) {
      if (
        event.data &&
        event.data.action === "cp_save_draft" &&
        event.data.content
      ) {
        const draftContent = event.data.content;
        const ideaId = window.__cp_workspace_idea_id;
        if (ideaId) {
          chrome.runtime.sendMessage(
            {
              action: "save_idea_draft",
              ideaId: ideaId,
              draft: draftContent,
            },
            function (response) {
              // 저장 성공/실패에 따라 피드백 처리 가능 (선택)
            }
          );
        }
      }
    });
    window.__cp_workspace_save_listener = true;
  }
  const outlineHtml =
    ideaData.outline && ideaData.outline.length > 0
      ? ideaData.outline.map((item) => `<li>${item}</li>`).join("")
      : "<li>추천 목차가 없습니다.</li>";

  const KeywordsTagsHtml =
    ideaData.tags && ideaData.tags.length > 0
      ? ideaData.tags
          .filter((t) => t !== "#AI-추천")
          .map(
            (k) =>
              `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
          )
          .join("")
      : "<span>제안된 주요 키워드가 없습니다.</span>";

  const longTailKeywordsHtml =
    ideaData.longTailKeywords && ideaData.longTailKeywords.length > 0
      ? ideaData.longTailKeywords
          .map(
            (k) =>
              `<span class="tag long-tail-keyword interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
          )
          .join("")
      : "<span>제안된 롱테일 키워드가 없습니다.</span>";

  const searchesHtml =
    ideaData.recommendedKeywords && ideaData.recommendedKeywords.length > 0
      ? ideaData.recommendedKeywords
          .map(
            (item) =>
              `<li><a href="https://www.google.com/search?q=${encodeURIComponent(
                item
              )}" target="_blank">${item}</a></li>`
          )
          .join("")
      : "<li>추천 검색어가 없습니다.</li>";

  const hasDraft = !!ideaData.draftContent;
  const draftActionsHtml = `
    <div id="draft-actions-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0;">
      <button id="generate-draft-btn">
        📄 AI로 초안 생성하기
      </button>
      ${
        hasDraft
          ? `<button id="delete-draft-in-workspace" class="draft-delete-btn"
                  title="작성된 초안 내용을 완전히 삭제하고 아이디어 상태로 초기화합니다.">
             ❌ 초안 삭제
           </button>`
          : ""
      }
    </div>`;

  const editorKeywordSectionHtml = `
    <div class="editor-keyword-section">
      <div class="keyword-list">
        ${KeywordsTagsHtml} ${longTailKeywordsHtml}
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="workspace-container">
      <div id="main-editor-panel" class="workspace-column" style="display: flex; flex-direction: column; min-height: 0;">
        <div id="workspace-title-header" style="padding: 12px 16px; border-bottom: 1px solid #e9ecef; background: #f8f9fa; border-radius: 8px 8px 0 0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="text" id="workspace-title-input" value="${ideaData.title || "제목 없음"}" 
              style="flex: 1; font-size: 16px; font-weight: 600; color: #333; border: 1px solid transparent; background: transparent; padding: 4px 8px; border-radius: 4px; outline: none;"
              placeholder="제목을 입력하세요">
            <button id="save-title-btn" style="padding: 4px 12px; font-size: 12px; border: 1px solid #dadce0; background: #fff; border-radius: 4px; cursor: pointer; display: none;">저장</button>
          </div>
        </div>
        ${draftActionsHtml}
        <div style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 8px;">
          <iframe id="quill-editor-iframe" src="${chrome.runtime.getURL(
            "editor.html"
          )}" frameborder="0" style="flex: 1 1 0; min-height: 0; width: 100%; display: block; border: 1.5px solid #e9ecef; border-radius: 8px; background: white; overflow: hidden;"></iframe>
          <div id="linked-scraps-section" style="flex-shrink: 0; margin-top: 0;">
            <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${
              ideaData.id
            }">
              <p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>
            </div>
          </div>
        </div>
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
          <button class="resource-tab-btn active" data-tab="ai-briefing" style="font-weight:bold;" title="AI 브리핑">✨</button>
          <button class="resource-tab-btn" data-tab="outline" title="추천 목차">📄</button>
          <button class="resource-tab-btn" data-tab="recommended-keywords" title="추천 검색어">🔍</button>
          <button class="resource-tab-btn" data-tab="all-scraps" title="모든 스크랩">📖</button>
          <button class="resource-tab-btn" data-tab="image-gallery" title="이미지 갤러리">🖼️</button>
        </div>
        
        <div class="resource-content-area ai-briefing-area" id="ai-briefing-area" style="display: block;">
          ${editorKeywordSectionHtml}
        </div>
        
        <div class="resource-content-area outline-area" id="outline-area" style="display: none;">
          <div class="ai-briefing-content">
            <h4>추천 목차</h4>
            <ul class="outline-list">
              ${outlineHtml}
            </ul>
          </div>
        </div>
        
        <div class="resource-content-area recommended-keywords-area" id="recommended-keywords-area" style="display: none;">
          <div class="ai-briefing-content">
            <h4>추천 검색어</h4>
            <ul>
              ${searchesHtml}
            </ul>
          </div>
        </div>
        
        <div class="resource-content-area all-scraps-area" id="all-scraps-list-container" style="display: none;">
          <div class="scrap-list all-scraps-list">
            <p class="loading-scr랩">스크랩 목록을 불러오는 중...</p>
          </div>
        </div>
        
        <div class="resource-content-area image-gallery-area" id="image-gallery-list-container" style="display: none;">
          <div class="image-gallery-grid">
            <p class="loading-images">이미지 갤러리를 불러오는 중...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
    if (response && response.success) {
      const allScrapsContainer = container.querySelector(".all-scraps-list");
      const linkedScrapsContainer = container.querySelector(
        ".linked-scraps-list"
      );

      if (response.scraps.length > 0) {
        const allScrapsData = response.scraps;

        const linkedScrapsHtml = allScrapsData
          .filter((s) => ideaData.linkedScraps.includes(s.id))
          .map((s) => createScrapCard(s, true))
          .join("");

        const allScrapsHtml = allScrapsData
          .map((s) => createScrapCard(s, false))
          .join("");

        if (linkedScrapsHtml) {
          linkedScrapsContainer.innerHTML = linkedScrapsHtml;
          linkedScrapsContainer.classList.remove("empty-state");
        } else {
          linkedScrapsContainer.innerHTML =
            "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
          linkedScrapsContainer.classList.add("empty-state");
        }
        allScrapsContainer.innerHTML = allScrapsHtml;

        // 연결된 자료가 변경될 때 에디터 높이 재조정 메시지 전송
        const editorIframe = container.querySelector("#quill-editor-iframe");
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            { action: "adjust-editor-height" },
            "*"
          );
        }
      } else {
        linkedScrapsContainer.innerHTML =
          "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
        linkedScrapsContainer.classList.add("empty-state");
        allScrapsContainer.innerHTML = "<p>자료 보관함이 비어있습니다.</p>";

        // 연결된 자료가 변경될 때 에디터 높이 재조정 메시지 전송
        const editorIframe = container.querySelector("#quill-editor-iframe");
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            { action: "adjust-editor-height" },
            "*"
          );
        }
      }
    }
  });

  addWorkspaceEventListeners(
    container.querySelector(".workspace-container"),
    ideaData
  );
}

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || "(내용 없음)";
  const cleanedTitle = textContent.replace(/\s+/g, " ").trim();
  const displayTitle = cleanedTitle.substring(0, 10);
  // 연결된 자료일 경우 태그형 UI 반환 (unlink 버튼 제거, 드래그만)
  if (isLinked) {
    return `
      <div class="scrap-card-item linked-scrap-item" data-scrap-id="${
        scrap.id
      }" data-text="${textContent.replace(
      /"/g,
      "&quot;"
    )}" draggable="true" style="margin:0;">
        <div class="linked-scrap-tag">
          <span class="tag-text">${displayTitle}...</span>
        </div>
      </div>
    `;
  }
  // ...기존 카드형 UI 반환 로직 유지
  const tagsHtml =
    scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
      ? `<div class=\"card-tags\">${scrap.tags
          .map((tag) => `<span class=\"tag\">#${tag}</span>`)
          .join("")}</div>`
      : "";
  const actionButton = `<button class=\"scrap-card-delete-btn unlink-scrap-btn\" title=\"연결 해제\">
         <svg xmlns=\"http://www.w3.org/2000/svg\" height=\"18\" viewBox=\"0 -960 960 960\" width=\"18\"><path d=\"m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z\"/></svg>
       </button>`;
  return `
    <div class=\"scrap-card-item\" draggable=\"true\" data-scrap-id=\"${
      scrap.id
    }\" data-text=\"${textContent.replace(/\"/g, "&quot;")}\">
        <div class=\"scrap-card\">
            ${actionButton}
            ${
              scrap.image
                ? `<div class=\"scrap-card-img-wrap\"><img src=\"${scrap.image}\" alt=\"scrap image\" referrerpolicy=\"no-referrer\"></div>`
                : ""
            }
            <div class=\"scrap-card-info\">
                <div class=\"scrap-card-title\">${cleanedTitle.substring(
                  0,
                  20
                )}...</div>
                <div class=\"scrap-card-snippet\">${shortenLink(
                  scrap.url,
                  25
                )}</div>
                ${tagsHtml}
            </div>
        </div>
    </div>
  `;
}

function addWorkspaceEventListeners(workspaceEl, ideaData) {
  // --- TUI Image Editor 동적 로더 (옵션) ---
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }
  function loadCSS(href) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`))
        return resolve();
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = () => resolve();
      l.onerror = (e) => reject(e);
      document.head.appendChild(l);
    });
  }
  async function ensureTuiEditorLoaded() {
    if (window.tui && window.tui.ImageEditor) return true;
    // 1. 로컬(lib/) 우선 로드 시도 (의존성 순서 중요)
    try {
      // 필수 의존성을 순서대로 로드
      await loadCSS(chrome.runtime.getURL("lib/tui-color-picker.min.css"));
      await loadCSS(chrome.runtime.getURL("lib/tui-image-editor.min.css"));
      // fabric.js 먼저 로드 (TUI Image Editor의 핵심 의존성)
      if (!window.fabric) {
        await loadScript(chrome.runtime.getURL("lib/fabric.min.js"));
      }
      // tui-code-snippet 로드
      if (!window.tui || !window.tui.util) {
        await loadScript(chrome.runtime.getURL("lib/tui-code-snippet.js"));
      }
      // tui-color-picker 로드
      if (!window.tui || !window.tui.colorPicker) {
        await loadScript(chrome.runtime.getURL("lib/tui-color-picker.min.js"));
      }
      // 마지막으로 TUI Image Editor 로드
      await loadScript(chrome.runtime.getURL("lib/tui-image-editor.min.js"));
      if (window.tui && window.tui.ImageEditor) return true;
    } catch (e) {
      console.warn("로컬 TUI Image Editor 로드 실패, CDN 시도", e);
    }
    // 2. window.CP_ENABLE_TUI_CDN === true일 때 CDN에서 로드
    if (!window.CP_ENABLE_TUI_CDN) return false;
    try {
      await loadCSS(
        "https://uicdn.toast.com/tui-color-picker/latest/tui-color-picker.css"
      );
      await loadCSS(
        "https://uicdn.toast.com/tui-image-editor/latest/tui-image-editor.css"
      );
      await loadScript(
        "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.6.0/fabric.min.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-code-snippet/latest/tui-code-snippet.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-color-picker/latest/tui-color-picker.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-image-editor/latest/tui-image-editor.js"
      );
      return !!(window.tui && window.tui.ImageEditor);
    } catch (e) {
      console.error("Failed to load TUI Editor libs", e);
      return false;
    }
  }
  // --- W-21/W-22/W-23: TUI 편집 모달 렌더링 유틸 ---
  function renderTUIEditorModal(imageUrl, sendCommand, onIframeReady) {
    if (!imageUrl) {
      window.parent.postMessage(
        {
          action: "cp_show_toast",
          message: "❗ 편집할 이미지 URL이 없습니다.",
        },
        "*"
      );
      return;
    }

    // 중복 모달 방지
    const existing = workspaceEl.querySelector(".cp-tui-modal-wrap");
    if (existing) {
      try {
        existing.remove();
      } catch (e) {}
    }

    // 모달 컨테이너 생성
    const modalWrap = document.createElement("div");
    modalWrap.className = "cp-tui-modal-wrap";
    modalWrap.innerHTML = `
      <div class="cp-modal-backdrop"></div>
      <div class="cp-modal">
        <div class="cp-modal-header">
          <div class="cp-modal-title">🎨 TUI 이미지 편집기</div>
          <button class="cp-modal-close" title="닫기">×</button>
        </div>
        <div class="cp-modal-body">
          <div id="cp-tui-editor-mount" class="cp-tui-editor-mount"></div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary">취소</button>
          <button class="cp-btn cp-btn-primary">저장</button>
        </div>
      </div>`;

    workspaceEl.appendChild(modalWrap);
    // W-21.2: 모달 내부 클릭 이벤트 전파 차단
    modalWrap.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    const btnClose = modalWrap.querySelector(".cp-modal-close");
    const btnCancel = modalWrap.querySelector(".cp-btn-secondary");
    const btnSave = modalWrap.querySelector(".cp-btn-primary");
    const mountEl = modalWrap.querySelector("#cp-tui-editor-mount");
    const backdrop = modalWrap.querySelector(".cp-modal-backdrop");

    const onKeydown = (e) => {
      if (e.key === "Escape") cleanup();
    };
    const cleanup = () => {
      try {
        modalWrap.remove();
      } catch (e) {}
      document.removeEventListener("keydown", onKeydown);
    };
    btnClose.onclick = btnCancel.onclick = cleanup;
    backdrop.onclick = function (e) {
      console.log("[CP] 백드롭 클릭됨, 모달 닫기 시도");
      cleanup();
    };
    document.addEventListener("keydown", onKeydown);

    // iframe 기반 TUI Image Editor 모달 구현
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("tui-editor.html");
    iframe.style.width = "calc(100% - 32px)";
    iframe.style.marginRight = "32px";
    iframe.style.height = "600px";
    iframe.style.border = "none";
    iframe.style.background = "#fff";
    iframe.style.position = "relative";
    iframe.style.zIndex = "9999"; // 백드롭(9998)보다 앞에 위치
    mountEl.appendChild(iframe);

    // iframe 로드 후 이미지 URL 전달 및 추가 콜백 실행
    iframe.onload = () => {
      iframe.contentWindow.postMessage(
        { action: "open-tui-editor", imageUrl },
        "*"
      );
      if (typeof onIframeReady === "function") {
        onIframeReady(iframe);
      }
    };

    // 저장 버튼 클릭 시 iframe에 편집 결과 요청
    btnSave.onclick = () => {
      iframe.contentWindow.postMessage({ action: "get-edited-image" }, "*");
    };

    // 부모 창에서 결과/범위 갱신 수신 후 Quill에 반영
    window.addEventListener("message", function onResult(event) {
      if (
        event.data &&
        event.data.action === "tui-editor-result" &&
        event.data.dataUrl
      ) {
        // 중복 삽입 방지: replace-edited-image 한 번만 호출
        sendCommand("replace-edited-image", { dataUrl: event.data.dataUrl });
        sendCommand("focus");
        window.parent.postMessage(
          {
            action: "cp_show_toast",
            message: "✅ 편집된 이미지로 교체했습니다.",
          },
          "*"
        );
        cleanup();
        window.removeEventListener("message", onResult);
      } else if (
        event.data &&
        event.data.action === "cp_update_editing_range" &&
        (event.data.data?.range || event.data.data?.url)
      ) {
        // TUI iframe에서 전달한 Range를 Quill iframe으로 전달
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            {
              action: "cp_update_editing_range",
              data: { range: event.data.data.range, url: event.data.data.url },
            },
            "*"
          );
        }
      }
    });
  }
  const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
  const resourceLibrary = workspaceEl.querySelector("#resource-library-panel");
  const tabBtns = resourceLibrary.querySelectorAll(".resource-tab-btn");
  const allScrapsArea = resourceLibrary.querySelector(".all-scraps-area");
  const imageGalleryArea = resourceLibrary.querySelector(".image-gallery-area");
  const aiBriefingArea = resourceLibrary.querySelector("#ai-briefing-area");
  const outlineArea = resourceLibrary.querySelector("#outline-area");
  const recommendedKeywordsArea = resourceLibrary.querySelector("#recommended-keywords-area");
  
  // 제목 편집 기능
  const titleInput = workspaceEl.querySelector("#workspace-title-input");
  const saveTitleBtn = workspaceEl.querySelector("#save-title-btn");
  if (titleInput && saveTitleBtn) {
    let originalTitle = ideaData.title || "";
    
    titleInput.addEventListener("input", () => {
      if (titleInput.value !== originalTitle) {
        saveTitleBtn.style.display = "block";
      } else {
        saveTitleBtn.style.display = "none";
      }
    });
    
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        saveTitleBtn.click();
      }
    });
    
    saveTitleBtn.addEventListener("click", () => {
      const newTitle = titleInput.value.trim() || "제목 없음";
      chrome.runtime.sendMessage({
        action: "update_kanban_card",
        data: {
          cardId: ideaData.id,
          status: ideaData.status,
          updates: { title: newTitle }
        }
      }, (response) => {
        if (response && response.success) {
          originalTitle = newTitle;
          ideaData.title = newTitle;
          saveTitleBtn.style.display = "none";
          window.parent.postMessage({
            action: "cp_show_toast",
            message: "✅ 제목이 업데이트되었습니다."
          }, "*");
        } else {
          window.parent.postMessage({
            action: "cp_show_toast",
            message: "❌ 제목 업데이트 실패"
          }, "*");
        }
      });
    });
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      
      // 모든 영역 숨기기
      aiBriefingArea.style.display = "none";
      outlineArea.style.display = "none";
      recommendedKeywordsArea.style.display = "none";
      allScrapsArea.style.display = "none";
      imageGalleryArea.style.display = "none";
      
      // 선택된 탭에 따라 해당 영역 표시
      if (tab === "ai-briefing") {
        aiBriefingArea.style.display = "block";
      } else if (tab === "outline") {
        outlineArea.style.display = "block";
      } else if (tab === "recommended-keywords") {
        recommendedKeywordsArea.style.display = "block";
      } else if (tab === "all-scraps") {
        allScrapsArea.style.display = "block";
      } else if (tab === "image-gallery") {
        imageGalleryArea.style.display = "block";
        // 파이어베이스 전체 스크랩에서 이미지 로드
        chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
          if (response && response.success) {
            updateImageGalleryFromAllScraps(resourceLibrary, response.scraps, sendCommand);
          }
        });
      }
    });
  });

  const linkedScrapsList = workspaceEl.querySelector(".linked-scraps-list");
  // 주요 키워드, 롱테일 키워드 각각의 DOM을 분리해서 이벤트 적용
  const keywordSection = workspaceEl.querySelector(".editor-keyword-section");
  const mainKeywordList = keywordSection?.children[0]; // 주요 키워드
  const longTailKeywordList = keywordSection?.children[1]; // 롱테일 키워드
  const generateDraftBtn = workspaceEl.querySelector("#generate-draft-btn");
  const outlineList = workspaceEl.querySelector(".outline-list");
  const deleteDraftBtn = workspaceEl.querySelector(
    "#delete-draft-in-workspace"
  );

  let editorReady = false;
  let currentEditorContent = "";

  // iframe으로 명령 전송
  function sendCommand(action, data = {}) {
    if (editorReady && editorIframe.contentWindow) {
      editorIframe.contentWindow.postMessage({ action, data }, "*");
      // 이미지 삽입 시 바로 저장 트리거
      if (action === "insert-image") {
        setTimeout(() => {
          editorIframe.contentWindow.postMessage(
            { action: "get-content" },
            "*"
          );
        }, 100); // 이미지 렌더링 후 약간의 지연
      }
    }
  }

  // iframe으로부터 메시지 수신
  window.addEventListener("message", (event) => {
    if (event.source !== editorIframe.contentWindow) return;

    const { action, data } = event.data;

    switch (action) {
      case "editor-ready":
        editorReady = true;
        console.log("Editor is ready");

        // 초기 콘텐츠 설정 (Markdown → HTML 변환 지원)
        if (ideaData.draftContent) {
          const isLikelyMarkdown =
            /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s/m.test(
              ideaData.draftContent
            );
          const html = isLikelyMarkdown
            ? marked.parse(ideaData.draftContent)
            : ideaData.draftContent;
          sendCommand("set-content", { html });
        }
        break;

      case "content-changed":
        currentEditorContent = data.html;
        // 자동 저장 (디바운스 적용)
        clearTimeout(window._autoSaveTimeout);
        window._autoSaveTimeout = setTimeout(() => {
          saveCurrentDraft();
        }, 1000);
        break;

      case "selection-changed":
        // 선택 영역 변경 시 툴바 상태 업데이트 가능
        break;

      case "editor-error":
        console.error("Editor error:", data.error);
        break;
      case "cp_open_tui_editor": {
        // 수신 필드 호환: imageUrl 우선, 과거 imgSrc도 지원
        const tuiImageUrl =
          event.data?.currentImageUrl ||
          event.data?.imageUrl ||
          event.data?.imgSrc ||
          data?.currentImageUrl ||
          data?.imageUrl ||
          data?.imgSrc;
        // allDocumentImages가 있으면 iframe에 전달
        if (
          event.data?.allDocumentImages &&
          Array.isArray(event.data.allDocumentImages)
        ) {
          // 모달 생성 및 iframe 준비
          renderTUIEditorModal(tuiImageUrl, sendCommand, (iframe) => {
            iframe.contentWindow.postMessage(
              {
                action: "set-document-images",
                images: event.data.allDocumentImages,
              },
              "*"
            );
          });
        } else {
          renderTUIEditorModal(tuiImageUrl, sendCommand);
        }
        break;
      }
    }
  });

  // 현재 초안 저장
  function saveCurrentDraft() {
    if (currentEditorContent !== (ideaData.draftContent || "")) {
      console.log("Saving draft...");
      
      // 현재 제목, 태그, 롱테일 키워드, 목차, 추천 검색어 수집
      const currentTitle = titleInput ? titleInput.value.trim() : ideaData.title;
      const currentTags = ideaData.tags || [];
      const currentLongTailKeywords = ideaData.longTailKeywords || [];
      const currentOutline = ideaData.outline || [];
      const currentRecommendedSearches = ideaData.recommendedSearches || [];
      
      const saveData = {
        ideaId: ideaData.id,
        status: ideaData.status,
        draft: currentEditorContent,
        title: currentTitle,
        tags: currentTags,
        longTailKeywords: currentLongTailKeywords,
        outline: currentOutline,
        recommendedSearches: currentRecommendedSearches,
      };
      chrome.runtime.sendMessage(
        { action: "save_draft_content", data: saveData },
        (saveResponse) => {
          if (saveResponse && saveResponse.success) {
            ideaData.draftContent = currentEditorContent;
            ideaData.title = currentTitle;
            console.log("Draft saved successfully.");

            // ✨ K-6: 상태 자동 이동 후 클라이언트 메모리 업데이트 및 알림
            if (saveResponse.moved) {
              ideaData.status = saveResponse.newStatus; // 'ideas' -> 'in-progress'
              console.log(
                `Card moved to ${ideaData.status}, client status updated.`
              );
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: `✅ 초안 저장 및 '${ideaData.status}'로 자동 이동되었습니다.`,
                },
                "*"
              );
            }
          } else {
            console.error("Failed to save draft:", saveResponse.error);
            window.parent.postMessage(
              { action: "cp_show_toast", message: "❌ 초안 저장 실패" },
              "*"
            );
          }
        }
      );
    }
  }

  generateDraftBtn.addEventListener("click", () => {
    generateDraftBtn.textContent = "AI가 초안을 작성하는 중...";
    generateDraftBtn.disabled = true;

    // 1. '연결된 자료' 목록에서 스크랩 텍스트를 모두 수집합니다.
    const linkedScrapsContent = Array.from(
      linkedScrapsList.querySelectorAll(".scrap-card-item")
    ).map((cardItem) => {
      return {
        text: cardItem.dataset.text || "",
        // 필요하다면 출처(URL)도 함께 보낼 수 있습니다.
        url: cardItem.querySelector(".scrap-card-snippet")?.textContent || "",
      };
    });

    // 2. AI에게 보낼 모든 데이터를 하나의 객체로 통합합니다.
    const payload = {
      ...ideaData, // title, description, tags, outline, keywords 등 모든 아이디어 데이터
      currentDraft: currentEditorContent, // 현재 에디터에 작성된 내용
      linkedScrapsContent: linkedScrapsContent, // 연결된 자료의 텍스트 목록
    };

    // 3. 통합된 데이터를 background.js로 전송합니다.
    chrome.runtime.sendMessage(
      { action: "generate_draft_from_idea", data: payload },
      (response) => {
        if (response && response.success) {
          // iframe 에디터에 생성된 초안 설정 (Markdown → HTML 변환 지원)
          const isLikelyMarkdown =
            /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s/m.test(
              response.draft || ""
            );
          const html = isLikelyMarkdown
            ? marked.parse(response.draft)
            : response.draft;
          sendCommand("set-content", { html });
          currentEditorContent = html;

          const saveData = {
            ideaId: ideaData.id,
            status: ideaData.status,
            draft: html,
          };
          chrome.runtime.sendMessage(
            { action: "save_draft_content", data: saveData },
            (saveResponse) => {
              if (!saveResponse || !saveResponse.success) {
                console.error("Failed to save draft:", saveResponse.error);
                // (선택) 저장 실패 시 사용자에게 알림을 줄 수 있습니다.
              } else {
                console.log("Draft saved successfully.");
                ideaData.draftContent = response.draft;
              }
            }
          );
        } else {
          alert(
            "초안 생성에 실패했습니다: " + (response.error || "알 수 없는 오류")
          );
        }
        generateDraftBtn.textContent = "📄 AI로 초안 생성하기";
        generateDraftBtn.disabled = false;
      }
    );
  });

  // 추천 목차 클릭 시 에디터 내 해당 위치로 스크롤 이동
  if (outlineList) {
    outlineList.addEventListener("click", (e) => {
      if (e.target.tagName === "LI") {
        const outlineText = e.target.textContent.trim();
        // iframe 에디터에 스크롤 명령 전송
        sendCommand("scroll-to-text", { text: outlineText });
      }
    });
  }

  // 주요 키워드 클릭 시 에디터에 삽입
  if (mainKeywordList) {
    mainKeywordList.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-tag")) {
        const keyword = e.target.textContent;
        sendCommand("insert-text", { text: `\n\n## ${keyword}\n\n` });
        sendCommand("focus");
      }
    });
  }

  // 롱테일 키워드 클릭 시 에디터에 삽입
  if (longTailKeywordList) {
    longTailKeywordList.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-tag")) {
        const keyword = e.target.textContent;
        sendCommand("insert-text", { text: ` ${keyword} ` });
        sendCommand("focus");
      }
    });
  }

  // 썸네일 생성 및 AI 이미지 생성 기능 제거됨

  // 드래그앤드랍 삭제: 스크랩을 리스트 바깥에 드롭하면 연결 해제
  linkedScrapsList.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".scrap-card-item");
    if (card) {
      e.dataTransfer.setData("text/plain", card.dataset.scrapId);
      card.classList.add("dragging");
    }
  });

  linkedScrapsList.addEventListener("dragend", (e) => {
    const card = e.target.closest(".scrap-card-item");
    if (card) card.classList.remove("dragging");
  });

  // document 전체에 drop/dragover 이벤트 등록 (환경 호환성 개선)
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const scrapId = e.dataTransfer.getData("text/plain");
    // 리스트 바깥에서 drop된 경우만 삭제
    if (scrapId && !e.target.closest(".linked-scraps-list")) {
      const cardItem = linkedScrapsList.querySelector(
        `[data-scrap-id="${scrapId}"]`
      );
      if (!cardItem) return;
      const message = {
        action: "unlink_scrap_from_idea",
        data: {
          ideaId: ideaData.id,
          scrapId: scrapId,
          status: ideaData.status,
        },
      };
      chrome.runtime.sendMessage(message, (response) => {
        if (response && response.success) {
          cardItem.remove();
          if (ideaData.linkedScraps) {
            const index = ideaData.linkedScraps.indexOf(scrapId);
            if (index > -1) {
              ideaData.linkedScraps.splice(index, 1);
            }
          }
          if (linkedScrapsList.children.length === 0) {
            linkedScrapsList.innerHTML =
              "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
            linkedScrapsList.classList.add("empty-state");
          }
        } else {
          alert(
            "스크랩 연결 해제에 실패했습니다: " +
              (response.error || "알 수 없는 오류")
          );
        }
      });
    }
  });

  // --- '연결된 자료' 툴팁 기능 (수정된 최종 버전) ---
  let tooltipTimeout;
  let activeTooltip = null;

  // 툴팁을 워크스페이스 최상단에 한 번만 생성
  const tooltip = document.createElement("div");
  tooltip.className = "scrap-tooltip";
  workspaceEl.appendChild(tooltip);

  linkedScrapsList.addEventListener("mouseover", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      // 마우스가 다른 카드로 이동했을 때 이전 타이머 취소
      clearTimeout(tooltipTimeout);

      // 0.2초 지연 후 툴팁 표시
      tooltipTimeout = setTimeout(() => {
        const textContent = cardItem.dataset.text;
        if (textContent) {
          // 툴팁 내용 업데이트
          tooltip.innerHTML = `<p>${textContent}</p>`;

          // 툴팁 위치 계산
          const cardRect = cardItem.getBoundingClientRect();
          tooltip.style.left = `${cardRect.right + 12}px`;
          tooltip.style.top = `${cardRect.top}px`;

          // 툴팁 보이기
          tooltip.classList.add("visible");
          activeTooltip = cardItem; // 현재 툴팁이 활성화된 카드 저장
        }
      }, 200);
    }
  });

  linkedScrapsList.addEventListener("mouseout", (e) => {
    // 마우스가 목록 영역을 벗어나면 타이머 취소 및 툴팁 숨기기
    clearTimeout(tooltipTimeout);

    // 마우스가 실제로 다른 요소로 이동했는지 확인 (카드 내부 요소 이동 시 툴팁이 깜빡이는 현상 방지)
    if (!linkedScrapsList.contains(e.relatedTarget)) {
      tooltip.classList.remove("visible");
      activeTooltip = null;
    }
  });

  resourceLibrary.addEventListener("dragstart", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      const card = cardItem.querySelector(".scrap-card");
      const imageEl = card.querySelector(".scrap-card-img-wrap img");
      const snippetEl = card.querySelector(".scrap-card-snippet");

      // 드래그 시 필요한 모든 스크랩 데이터를 객체로 만듭니다.
      const scrapData = {
        id: cardItem.dataset.scrapId,
        text: cardItem.dataset.text, // 에디터에 삽입될 텍스트
        image: imageEl ? imageEl.src : null,
        url: snippetEl ? snippetEl.textContent : "",
        tags: Array.from(card.querySelectorAll(".card-tags .tag")).map((t) =>
          t.textContent.replace("#", "")
        ),
      };

      // 데이터를 JSON 문자열 형태로 dataTransfer 객체에 저장합니다.
      e.dataTransfer.setData("application/json", JSON.stringify(scrapData));
      e.dataTransfer.effectAllowed = "copyLink";
      cardItem.style.opacity = "0.5";
    }
  });

  resourceLibrary.addEventListener("dragend", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      cardItem.style.opacity = "1";
    }
  });

  workspaceEl.addEventListener("dragover", (e) => {
    const dropTarget = e.target;
    if (linkedScrapsList.contains(dropTarget)) {
      e.preventDefault();
      linkedScrapsList.classList.add("drag-over");
      e.dataTransfer.dropEffect = "link";
    }
  });

  workspaceEl.addEventListener("dragleave", (e) => {
    const target = e.target;
    if (linkedScrapsList.contains(target)) {
      target.classList.remove("drag-over");
    }
  });

  workspaceEl.addEventListener("drop", (e) => {
    e.preventDefault();

    // 이미지 갤러리에서 드래그한 이미지 URL 처리
    const imageUrl = e.dataTransfer.getData("text/plain");
    if (imageUrl && imageUrl.startsWith("http")) {
      // 에디터 영역에 이미지 삽입
      if (e.target.closest("#main-editor-panel") || e.target.closest("#quill-editor-iframe")) {
        sendCommand("insert-image", { url: imageUrl });
        sendCommand("focus");
        return;
      }
    }

    let scrapData;
    try {
      scrapData = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (error) {
      return;
    }

    if (!scrapData) return;

    // 1. 연결된 자료 영역에 드롭 우선 처리
    if (linkedScrapsList.contains(e.target)) {
      linkedScrapsList.classList.remove("drag-over");

      if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) {
        return;
      }

      const message = {
        action: "link_scrap_to_idea",
        data: {
          ideaId: ideaData.id,
          scrapId: scrapData.id,
          status: ideaData.status,
        },
      };
      chrome.runtime.sendMessage(message, (response) => {
        if (response && response.success) {
          const newLinkedCardHtml = createScrapCard(scrapData, true);
          const placeholder = linkedScrapsList.querySelector("p");
          if (placeholder) {
            placeholder.remove();
            linkedScrapsList.classList.remove("empty-state");
          }
          linkedScrapsList.insertAdjacentHTML("beforeend", newLinkedCardHtml);

          if (!ideaData.linkedScraps) ideaData.linkedScraps = [];
          ideaData.linkedScraps.push(scrapData.id);
        } else {
          alert(
            "스크랩 연결에 실패했습니다: " +
              (response.error || "알 수 없는 오류")
          );
        }
      });
      return;
    }

    // 2. 에디터 영역에 드롭
    if (e.target.closest("#main-editor-panel")) {
      // Quill 에디터에 텍스트 삽입 (스크랩 인용)
      const textToInsert = scrapData.text || "";
      sendCommand("insert-text", {
        text: `\n\n--- (스크랩 인용) ---\n${textToInsert}\n------------------\n\n`,
      });
      sendCommand("focus");
    }
  });

  // 에디터 iframe에 드래그앤드랍 이벤트 추가
  if (editorIframe) {
    editorIframe.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    editorIframe.addEventListener("drop", (e) => {
      e.preventDefault();
      const imageUrl = e.dataTransfer.getData("text/plain");
      if (imageUrl && imageUrl.startsWith("http")) {
        sendCommand("insert-image", { url: imageUrl });
        sendCommand("focus");
      }
    });
  }

  if (deleteDraftBtn) {
    deleteDraftBtn.addEventListener("click", () => {
      if (
        confirm(
          "경고: 현재 작성 중인 초안 내용이 완전히 삭제됩니다. 진행하시겠습니까?"
        )
      ) {
        chrome.runtime.sendMessage(
          {
            action: "delete_draft_content",
            data: { cardId: ideaData.id },
          },
          (response) => {
            if (response?.success) {
              ideaData.draftContent = null;
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: "✅ 초안이 삭제되었습니다. 기획 보드로 돌아갑니다.",
                },
                "*"
              );
              window.parent.postMessage(
                { action: "close-workspace-and-refresh" },
                "*"
              );
            } else {
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: "❌ 초안 삭제 중 오류가 발생했습니다.",
                },
                "*"
              );
            }
          }
        );
      }
    });
  }


}
