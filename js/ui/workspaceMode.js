// PRD v2.6: AI 템플릿 렌더링 시스템
import { renderTemplateFromData } from "./thumbnailGenerator.js";

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
// js/ui/workspaceMode.js (수정 완료된 최종 버전)

import { shortenLink } from "../utils.js";
import { marked } from "marked";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps)
    ? ideaData.linkedScraps
    : ideaData.linkedScraps
    ? Object.keys(ideaData.linkedScraps)
    : [];

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
      <div id="ai-briefing-panel" class="workspace-column">
        <h2>✨ AI 브리핑</h2>
        ${editorKeywordSectionHtml}
        <div class="ai-briefing-content">
          <h4>추천 목차</h4>
          <ul class="outline-list">
            ${outlineHtml}
          </ul>
          <h4>추천 검색어</h4>
          <ul>
            ${searchesHtml}
          </ul>
        </div>
      </div>

      <div id="main-editor-panel" class="workspace-column" style="display: flex; flex-direction: column; min-height: 0;">
        ${draftActionsHtml}
        <div style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column;">
          <iframe id="quill-editor-iframe" src="${chrome.runtime.getURL(
            "editor.html"
          )}" frameborder="0" style="flex: 1 1 0; min-height: 0; width: 100%; display: block; border: none; border-radius: 0 0 6px 6px; background: white; overflow: hidden;"></iframe>
          <div id="linked-scraps-section" style="flex-shrink: 0;">
            <div class="scrap-list linked-scraps-list" data-idea-id="${
              ideaData.id
            }">
              <p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>
            </div>
          </div>
        </div>
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
          <button class="resource-tab-btn" data-tab="all-scraps" style="font-weight:bold;" title="모든 스크랩">📖</button>
          <button class="resource-tab-btn" data-tab="image-gallery" title="이미지 갤러리">🖼️</button>
          <button class="resource-tab-btn" data-tab="thumbnail-gen" title="썸네일 생성">🎨</button>
          <button class="resource-tab-btn" data-tab="ai-image" title="AI 이미지 생성">✨</button>
          <button class="resource-tab-btn" data-tab="template-admin" title="템플릿 관리">⚙️</button>
        </div>
  <div class="resource-content-area all-scraps-area" id="all-scraps-list-container" style="display: block;">
          <div class="scrap-list all-scraps-list">
            <p class="loading-scr랩">스크랩 목록을 불러오는 중...</p>
          </div>
        </div>
        <div class="resource-content-area image-gallery-area" id="image-gallery-list-container" style="display: none;">
          <div class="image-gallery-grid">
            <p class="loading-images">이미지 갤러리를 불러오는 중...</p>
          </div>
        </div>
        <div class="resource-content-area thumbnail-gen-area" id="thumbnail-gen-area" style="display: none;">
          <div class="ai-image-controls">
            <!-- FR-R-UI (PRD v2.4): 화면 비율 선택 추가 -->
            <label class="ai-field" style="display:block;width:100%;margin-bottom:16px;">
              <div class="ai-field-row">
                <span>화면 비율</span>
                <span class="ai-hint">생성할 썸네일의 가로:세로 비율을 선택하세요</span>
              </div>
              <div class="ai-aspect-ratio-group" style="display:flex;gap:8px;margin-top:8px;">
                <button class="aspect-ratio-btn active" data-aspect="16:9">16:9 (유튜브)</button>
                <button class="aspect-ratio-btn" data-aspect="1:1">1:1 (인스타그램)</button>
                <button class="aspect-ratio-btn" data-aspect="9:16">9:16 (쇼츠)</button>
              </div>
            </label>
            <label class="ai-field" style="display:block;width:100%;">
              <div class="ai-field-row">
                <span>썸네일 스타일 선택</span>
                <span class="ai-hint">목차에 맞는 썸네일 예시를 생성합니다</span>
              </div>
              <select id="ai-thumb-style-select" class="ai-select" style="width:100%;margin-top:8px;">
                <option value="">템플릿 선택...</option>
              </select>
            </label>
            <div class="ai-row ai-actions" style="margin-top:16px;">
              <button id="ai-generate-thumb-btn" class="ai-generate-btn">썸네일 예시 생성</button>
              <span class="ai-cost-note">목차 기반으로 썸네일 예시를 자동 생성합니다.</span>
            </div>
            <div class="ai-row ai-message-row">
              <span id="ai-thumbnail-message" class="loading-images">화면 비율과 스타일을 선택하고 썸네일을 생성해보세요.</span>
            </div>
          </div>
          <div class="ai-image-grid" id="ai-thumbnail-grid">
            <!-- 썸네일 예시가 여기에 표시됩니다 -->
          </div>
        </div>
        <div class="resource-content-area ai-image-area" id="ai-image-area" style="display: none;">
          <div class="ai-image-controls">
            <label class="ai-field" style="display:block;width:100%;">
              <div class="ai-field-row">
                <span>프롬프트</span>
                <span class="ai-hint">최대 250자 · 기본 프롬프트 자동 생성</span>
              </div>
              <textarea id="ai-image-prompt" maxlength="250" class="ai-prompt-textarea" placeholder="어떤 이미지를 원하시나요? 예: 미래지향적 도시의 야경, 네온사인, 시네마틱 라이트"></textarea>
            </label>
            <div class="ai-row">
              <label>
                <span class="ai-label">스타일</span>
                <select id="ai-image-style" class="ai-select">
                  <option value="realistic">실사 사진</option>
                  <option value="3d">3D 렌더</option>
                  <option value="watercolor">수채화</option>
                  <option value="cyberpunk">사이버펑크</option>
                  <option value="none">기본/기타</option>
                </select>
              </label>
               <label>
                <span class="ai-label">종횡비</span>
                <select id="ai-image-aspect" class="ai-select">
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>
              <label>
                <span class="ai-label">생성 개수</span>
                <select id="ai-image-count" class="ai-select">
                  <option value="1">1장</option>
                  <option value="2">2장</option>
                  <option value="3" selected>3장</option>
                  <option value="4">4장</option>
                </select>
              </label>
            </div>
            <div class="ai-row ai-actions">
              <button id="ai-generate-btn" class="ai-generate-btn">이미지 생성하기</button>
              <span class="ai-cost-note">유의: 생성은 비용이 발생할 수 있습니다. 데모에서는 로컬/플레이스홀더 방식으로 생성됩니다.</span>
            </div>
            <div class="ai-row ai-message-row">
              <span id="ai-image-message" class="loading-images">프롬프트를 입력하고 이미지를 생성해보세요.</span>
            </div>
          </div>
          <div class="ai-image-grid" id="ai-image-grid">
            <!-- 메시지는 위 ai-image-message에서 출력 -->
          </div>
        </div>
        <div class="resource-content-area template-admin-area" id="template-admin-area" style="display: none;">
          <div class="ai-image-controls">
            <h4 style="margin:0 0 12px 0;font-size:18px;font-weight:600;">🎨 AI 템플릿 자동 등록</h4>
            <p style="margin:0 0 20px 0;color:#666;font-size:14px;line-height:1.5;">
              참고할 썸네일 이미지를 업로드하면, AI가 디자인을 분석하여 새로운 템플릿으로 자동 등록합니다.
            </p>

            <div id="ai-template-dropzone" class="ai-template-dropzone-area">
              <span>📁 여기에 템플릿 이미지를 드래그 앤 드롭하세요<br><span style="font-size:13px;color:#888;">또는 클릭하여 파일 선택</span></span>
            </div>
            
            <input type="file" id="ai-template-uploader" accept="image/png, image/jpeg, image/jpg" style="display:none;" />
            
            <div class="ai-row ai-message-row" style="margin-top:16px;">
              <span id="ai-template-message" class="loading-images">드래그 앤 드롭 또는 클릭하여 이미지를 선택하세요.</span>
            </div>
          </div>
          <div class="template-list-area" id="template-list-area">
            <h4 style="margin-top:24px;">등록된 템플릿 목록</h4>
            <div class="ai-image-grid" id="template-preview-grid">
              <p>등록된 템플릿이 여기에 표시됩니다.</p>
            </div>
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

        linkedScrapsContainer.innerHTML =
          linkedScrapsHtml ||
          "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
        allScrapsContainer.innerHTML = allScrapsHtml;

        // [PRD v3.3 FR-W2] 콘솔 오류 제거: adjust-editor-height 메시지 삭제
        // (에디터 높이는 CSS flexbox로 자동 관리됨)
      } else {
        linkedScrapsContainer.innerHTML =
          "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
        allScrapsContainer.innerHTML = "<p>자료 보관함이 비어있습니다.</p>";

        // [PRD v3.3 FR-W2] 콘솔 오류 제거: adjust-editor-height 메시지 삭제
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
  const thumbnailGenArea = resourceLibrary.querySelector(".thumbnail-gen-area");
  const aiImageArea = resourceLibrary.querySelector(".ai-image-area");
  const templateAdminArea = resourceLibrary.querySelector(
    ".template-admin-area"
  );
  const aiPromptInput = resourceLibrary.querySelector("#ai-image-prompt");
  const aiStyleSelect = resourceLibrary.querySelector("#ai-image-style");
  const aiAspectSelect = resourceLibrary.querySelector("#ai-image-aspect");
  const aiCountSelect = resourceLibrary.querySelector("#ai-image-count");
  const aiGenerateBtn = resourceLibrary.querySelector("#ai-generate-btn");
  const aiImageGrid = resourceLibrary.querySelector("#ai-image-grid");

  // 기본 프롬프트 자동 생성
  function buildDefaultPromptFromIdea(idea) {
    const base = (idea?.title || "").trim();
    const tags = Array.isArray(idea?.tags)
      ? idea.tags.filter((t) => t && t !== "#AI-추천").slice(0, 4)
      : [];
    const tagLine = tags.length ? `, ${tags.join(", ")}` : "";
    const quality = ", high quality photo, professional, cinematic lighting";
    return `${base}${tagLine}${quality}`.trim();
  }
  if (aiPromptInput) {
    aiPromptInput.value = buildDefaultPromptFromIdea(ideaData);
  }
  // 스타일 기본값: 실사 사진
  if (aiStyleSelect) aiStyleSelect.value = "realistic";

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      allScrapsArea.style.display = tab === "all-scraps" ? "block" : "none";
      imageGalleryArea.style.display =
        tab === "image-gallery" ? "block" : "none";
      thumbnailGenArea.style.display =
        tab === "thumbnail-gen" ? "block" : "none";
      aiImageArea.style.display = tab === "ai-image" ? "block" : "none";
      templateAdminArea.style.display =
        tab === "template-admin" ? "block" : "none";

      if (tab === "image-gallery") {
        // 연결된 스크랩 데이터로 이미지 갤러리 갱신
        chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
          if (response && response.success) {
            const linkedScrapsData = response.scraps.filter((s) =>
              ideaData.linkedScraps.includes(s.id)
            );
            updateImageGallery(resourceLibrary, linkedScrapsData, sendCommand);
          }
        });
      }
    });
  });

  // FR-R-UI (PRD v2.4): 화면 비율 버튼 이벤트 리스너
  const aspectRatioBtns =
    thumbnailGenArea?.querySelectorAll(".aspect-ratio-btn");
  aspectRatioBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      // 모든 버튼에서 active 제거
      aspectRatioBtns.forEach((b) => b.classList.remove("active"));
      // 클릭한 버튼에 active 추가
      btn.classList.add("active");
      console.log(`[PRD v2.4] 화면 비율 선택됨: ${btn.dataset.aspect}`);
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
      const saveData = {
        ideaId: ideaData.id,
        status: ideaData.status,
        draft: currentEditorContent,
      };
      chrome.runtime.sendMessage(
        { action: "save_draft_content", data: saveData },
        (saveResponse) => {
          if (saveResponse && saveResponse.success) {
            ideaData.draftContent = currentEditorContent;
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

  // --- AI 이미지 생성 기능 ---
  function mapAspectToSize(aspect) {
    switch (aspect) {
      case "16:9":
        return { width: 1024, height: 576 };
      case "9:16":
        return { width: 576, height: 1024 };
      case "1:1":
      default:
        return { width: 768, height: 768 };
    }
  }

  function renderAIGallery(images) {
    if (!aiImageGrid) return;
    if (!images || images.length === 0) {
      aiImageGrid.innerHTML = "<p>이미지 생성 결과가 없습니다.</p>";
      return;
    }
    const html = images
      .map(
        (dataUrl, idx) => `
        <div class="ai-thumb-wrap">
          <img src="${dataUrl}" class="ai-generated-thumb" draggable="true" alt="AI 생성 이미지 ${
          idx + 1
        }" />
          <div class="ai-thumb-actions">
            <button class="ai-insert-btn" data-url="${dataUrl}">에디터에 삽입</button>
            <a class="ai-download-btn" href="${dataUrl}" download="cp-ai-image-${
          idx + 1
        }.png">다운로드</a>
          </div>
        </div>
      `
      )
      .join("");
    aiImageGrid.innerHTML = html;

    aiImageGrid.querySelectorAll(".ai-generated-thumb").forEach((img) => {
      img.addEventListener("click", () => {
        sendCommand("insert-image", { url: img.src });
        sendCommand("focus");
      });
      img.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-cp-ai-image", img.src);
        e.dataTransfer.effectAllowed = "copy";
      });
    });
    aiImageGrid.querySelectorAll(".ai-insert-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        if (url) {
          sendCommand("insert-image", { url });
          sendCommand("focus");
        }
      });
    });
  }

  if (aiGenerateBtn) {
    // 썸네일 예시 생성 버튼 이벤트는 한 번만 등록 (중복 방지)
    const aiGenerateThumbBtn = resourceLibrary.querySelector(
      "#ai-generate-thumb-btn"
    );
    if (aiGenerateThumbBtn && !aiGenerateThumbBtn.__cp_thumb_event) {
      aiGenerateThumbBtn.addEventListener("click", async () => {
        const aiThumbnailGrid =
          resourceLibrary.querySelector("#ai-thumbnail-grid");
        const aiThumbnailMessage = resourceLibrary.querySelector(
          "#ai-thumbnail-message"
        );

        // 선택된 화면 비율에 따른 캔버스 크기 설정 (PRD v2.4)
        const activeAspectBtn = resourceLibrary.querySelector(
          ".aspect-ratio-btn.active"
        );
        const aspect = activeAspectBtn?.dataset?.aspect || "16:9";
        let width = 1280,
          height = 720;
        if (aspect === "1:1") {
          width = 1080;
          height = 1080;
        } else if (aspect === "9:16") {
          width = 720;
          height = 1280;
        }

        // 선택된 템플릿 로드
        const selectEl = resourceLibrary.querySelector(
          "#ai-thumb-style-select"
        );
        const selectedId = selectEl?.value || "";
        if (!selectedId) {
          if (aiThumbnailMessage)
            aiThumbnailMessage.textContent =
              "먼저 썸네일 스타일(템플릿)을 선택해주세요.";
          window.parent.postMessage(
            {
              action: "cp_show_toast",
              message: "템플릿을 먼저 선택해주세요.",
            },
            "*"
          );
          return;
        }

        const template = (templateCache || []).find(
          (t) => String(t.id) === String(selectedId)
        );
        if (!template) {
          if (aiThumbnailMessage)
            aiThumbnailMessage.textContent =
              "선택한 템플릿을 찾을 수 없습니다.";
          return;
        }

        // 목차 기반 동적 텍스트 구성
        let outline = [];
        if (
          window.__cp_workspace_ideaData &&
          Array.isArray(window.__cp_workspace_ideaData.outline)
        ) {
          outline = window.__cp_workspace_ideaData.outline;
        } else if (Array.isArray(ideaData?.outline)) {
          outline = ideaData.outline;
        }
        if (!outline.length) outline = ["고퀄리티 썸네일"];

        // [FR-U2] 렌더링 및 갤러리 구성 - for...of로 변환하여 await 지원
        const cards = [];
        for (let idx = 0; idx < outline.length; idx++) {
          const title = outline[idx];
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");

          try {
            // [FR-U2] renderTemplateFromData는 async 함수이므로 await 필요
            await renderTemplateFromData(ctx, template, {
              slogan: title,
              visualizationCue: "PREVIEW",
            });
          } catch (e) {
            console.error("[Thumbnail Gen] 렌더 오류", e);
            ctx.fillStyle = "#FFCFCF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#B00020";
            ctx.font = "bold 24px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("렌더링 오류", canvas.width / 2, canvas.height / 2);
          }

          const dataUrl = canvas.toDataURL("image/png");
          cards.push(
            `<div class="ai-thumb-wrap"><img src="${dataUrl}" class="ai-generated-thumb" alt="썸네일 예시${
              idx + 1
            }" /></div>`
          );
        }

        aiThumbnailGrid.innerHTML = cards.join("");
        if (aiThumbnailMessage)
          aiThumbnailMessage.textContent = `썸네일 예시 ${outline.length}개를 생성했습니다.`;

        // 생성된 썸네일 클릭 시 에디터에 삽입
        aiThumbnailGrid
          .querySelectorAll(".ai-generated-thumb")
          .forEach((img) => {
            img.addEventListener("click", () => {
              sendCommand("insert-image", { url: img.src });
              sendCommand("focus");
            });
          });
      });
      aiGenerateThumbBtn.__cp_thumb_event = true;
    }
    aiGenerateBtn.addEventListener("click", () => {
      const prompt = (aiPromptInput?.value || "").trim();
      const aiMessage = resourceLibrary.querySelector("#ai-image-message");
      if (!prompt) {
        if (aiMessage) aiMessage.textContent = "프롬프트를 입력해주세요.";
        window.parent.postMessage(
          { action: "cp_show_toast", message: "프롬프트를 입력해주세요." },
          "*"
        );
        return;
      }
      const style = aiStyleSelect?.value || "realistic";
      const aspect = aiAspectSelect?.value || "1:1";
      const { width, height } = mapAspectToSize(aspect);
      const count = parseInt(aiCountSelect?.value, 10) || 3;

      aiGenerateBtn.disabled = true;
      const prevText = aiGenerateBtn.textContent;
      aiGenerateBtn.textContent = "✨ 생성 중...";
      if (aiMessage) aiMessage.textContent = "이미지를 생성하는 중입니다...";
      aiImageGrid.innerHTML = "";

      chrome.runtime.sendMessage(
        {
          action: "ai_generate_images",
          data: { prompt, style, aspect, count, size: { width, height } },
        },
        (response) => {
          aiGenerateBtn.disabled = false;
          aiGenerateBtn.textContent = prevText;
          if (response?.success) {
            if (aiMessage) aiMessage.textContent = "이미지 생성 완료!";
            renderAIGallery(response.images || []);
          } else {
            const msg = response?.error || "이미지 생성 실패";
            if (aiMessage) aiMessage.textContent = msg;
            aiImageGrid.innerHTML = "";
            window.parent.postMessage(
              { action: "cp_show_toast", message: "❌ " + msg },
              "*"
            );
          }
        }
      );
    });
  }

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

    let scrapData;
    try {
      scrapData = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (error) {
      // scrap json이 아니면 AI 이미지 드래그 여부 확인
      const aiDataUrl = e.dataTransfer.getData("application/x-cp-ai-image");
      if (aiDataUrl && e.target.closest("#main-editor-panel")) {
        sendCommand("insert-image", { url: aiDataUrl });
        sendCommand("focus");
      }
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
          if (placeholder) placeholder.remove();
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

  // --- 템플릿 업로더 드래그 앤 드롭 기능 (PRD v2.2: 로컬 파일 + 웹 이미지 URL) ---
  const templateDropzone = resourceLibrary.querySelector(
    "#ai-template-dropzone"
  );
  const templateUploader = resourceLibrary.querySelector(
    "#ai-template-uploader"
  );
  const templateMessage = resourceLibrary.querySelector("#ai-template-message");
  const templatePreviewGrid = resourceLibrary.querySelector(
    "#template-preview-grid"
  );
  const thumbStyleSelect = resourceLibrary.querySelector(
    "#ai-thumb-style-select"
  );

  // 템플릿 캐시 (전역)
  let templateCache = [];

  // FR-R-Refresh (PRD v2.3): 마스터 템플릿 새로고침 함수
  async function refreshAllTemplateData() {
    try {
      // 1. Firebase에서 최신 템플릿 목록 가져오기
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "get_thumbnail_templates" },
          resolve
        );
      });

      if (!response?.success) {
        console.error("[Template Refresh] 템플릿 로드 실패:", response?.error);
        return;
      }

      // 2. 캐시 업데이트
      templateCache = response.templates || [];
      console.log(
        `[Template Refresh] ✅ 템플릿 ${templateCache.length}개 로드됨`
      );

      // 3. UI 업데이트
      populateUserDropdown(templateCache);
      await populateAdminList(templateCache); // [FR-U1] await 추가
    } catch (error) {
      console.error("[Template Refresh] 오류:", error);
    }
  }

  // FR5 (수정): 사용자 탭 드롭다운 채우기
  function populateUserDropdown(templates) {
    if (!thumbStyleSelect) return;

    // 기존 옵션 제거 (첫 옵션 제외)
    while (thumbStyleSelect.options.length > 0) {
      thumbStyleSelect.remove(0);
    }

    // 기본 템플릿 옵션 추가
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "템플릿 선택";
    thumbStyleSelect.appendChild(defaultOption);

    // Firebase 템플릿 추가
    templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name || "이름 없음";
      thumbStyleSelect.appendChild(option);
    });

    console.log(
      `[Template Dropdown] ✅ 드롭다운에 ${templates.length}개 템플릿 추가`
    );
  }

  // FR-A-List: 운영자 탭 템플릿 목록 채우기 (캔버스 미리보기 포함)
  // [FR-U1] async 함수로 변환 - renderTemplateFromData가 Promise 반환
  async function populateAdminList(templates) {
    if (!templatePreviewGrid) return;

    if (templates.length === 0) {
      templatePreviewGrid.innerHTML =
        '<p style="color:#888;text-align:center;padding:20px;">등록된 템플릿이 없습니다.</p>';
      return;
    }

    // 캔버스 미리보기를 포함한 템플릿 카드 생성
    templatePreviewGrid.innerHTML = "";

    // [FR-U1] forEach 대신 for...of 사용 (await 지원)
    for (const template of templates) {
      // 템플릿 카드 컨테이너
      const card = document.createElement("div");
      card.className = "template-item";
      card.dataset.templateId = template.id;
      card.style.cssText =
        "border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff;margin-bottom:12px;";

      // 헤더 (이름 + 삭제 버튼)
      const header = document.createElement("div");
      header.style.cssText =
        "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";

      const nameEl = document.createElement("strong");
      nameEl.style.fontSize = "14px";
      nameEl.textContent = template.name || "이름 없음";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "admin-delete-template-btn";
      deleteBtn.dataset.templateId = template.id;
      deleteBtn.textContent = "삭제";
      deleteBtn.style.cssText =
        "background:#d32f2f;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;";

      header.appendChild(nameEl);
      header.appendChild(deleteBtn);

      // PRD v2.4: 반응형 템플릿 하위 호환성 처리
      // v2.4 템플릿(비율 기반)인지 v2.3 이하 템플릿(절대 픽셀)인지 감지
      const isResponsiveTemplate = !template.width && !template.height;

      // 캔버스 미리보기
      const canvas = document.createElement("canvas");
      const previewWidth = 280;

      let canvasWidth, canvasHeight, previewHeight;

      if (isResponsiveTemplate) {
        // PRD v2.4: 반응형 템플릿 - 기본 16:9 비율로 미리보기
        canvasWidth = 1280;
        canvasHeight = 720;
        previewHeight = Math.round((previewWidth * canvasHeight) / canvasWidth);
        console.log(
          `[Admin Preview] 반응형 템플릿 "${template.name}" - 16:9 비율로 렌더링`
        );
      } else {
        // PRD v2.3 이하: 절대 픽셀 템플릿
        canvasWidth = template.width || 600;
        canvasHeight = template.height || 400;
        previewHeight = Math.round((previewWidth * canvasHeight) / canvasWidth);
        console.log(
          `[Admin Preview] 절대 좌표 템플릿 "${template.name}" - ${canvasWidth}x${canvasHeight}`
        );
      }

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.cssText = `width:${previewWidth}px;height:${previewHeight}px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;display:block;margin:8px 0;`;

      const ctx = canvas.getContext("2d");

      // [FR-U1] renderTemplateFromData는 async 함수이므로 await 필요
      try {
        await renderTemplateFromData(ctx, template, {
          slogan: "미리보기",
          visualizationCue: "PREVIEW",
        });
      } catch (error) {
        console.error("[Template Preview] 렌더링 오류:", error);
        ctx.fillStyle = "#FFCCCC";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#CC0000";
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("렌더링 오류", canvas.width / 2, canvas.height / 2);
      }

      // 템플릿 정보
      const info = document.createElement("div");
      info.style.cssText = "font-size:12px;color:#666;";

      if (isResponsiveTemplate) {
        // PRD v2.4: 반응형 템플릿 정보
        info.innerHTML = `
          타입: 반응형 (비율 기반)<br>
          레이어: ${template.layers?.length || 0}개
        `;
      } else {
        // PRD v2.3 이하: 절대 좌표 템플릿 정보
        info.innerHTML = `
          크기: ${template.width || 600} × ${template.height || 400}<br>
          레이어: ${template.layers?.length || 0}개
        `;
      }

      // 카드 조립
      card.appendChild(header);
      card.appendChild(canvas);
      card.appendChild(info);
      templatePreviewGrid.appendChild(card);
    } // [FR-U1] for...of 루프 종료

    // FR-A-Delete: 삭제 버튼 이벤트 바인딩
    const deleteBtns = templatePreviewGrid.querySelectorAll(
      ".admin-delete-template-btn"
    );
    deleteBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const templateId = btn.dataset.templateId;
        const templateName =
          btn.parentElement.querySelector("strong")?.textContent || "템플릿";

        if (!confirm(`"${templateName}"을(를) 삭제하시겠습니까?`)) return;

        // 삭제 요청
        chrome.runtime.sendMessage(
          { action: "delete_template", templateId },
          (response) => {
            if (response?.success) {
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: `✅ "${templateName}" 삭제 완료`,
                },
                "*"
              );
              // 즉시 새로고침
              refreshAllTemplateData();
            } else {
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: `❌ 삭제 실패: ${
                    response?.error || "알 수 없는 오류"
                  }`,
                },
                "*"
              );
            }
          }
        );
      });
    });

    console.log(
      `[Template Admin] ✅ 관리 목록에 ${templates.length}개 템플릿 추가`
    );
  }

  // 이미지 리사이즈 헬퍼: base64 -> canvas 리사이즈 -> base64 반환
  function resizeBase64Image(base64Str, maxWidth = 1280, maxHeight = 1280) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = function () {
          let width = img.width;
          let height = img.height;
          const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
          const targetW = Math.round(width * ratio);
          const targetH = Math.round(height * ratio);

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, targetW, targetH);

          // 유지할 MIME 타입은 입력 base64의 헤더에서 유추
          const matches = base64Str.match(
            /^data:(image\/(png|jpeg|jpg));base64,/i
          );
          const mime = matches ? matches[1] : "image/png";
          const quality =
            mime === "image/jpeg" || mime === "image/jpg" ? 0.85 : undefined;
          const resized = canvas.toDataURL(mime, quality);
          resolve(resized);
        };
        img.onerror = function (err) {
          reject(err || new Error("이미지 로드 실패"));
        };
        // src 할당은 onload 등록 후
        img.src = base64Str;
      } catch (err) {
        reject(err);
      }
    });
  }

  // FR-T4-DnD (v2.2): 공통 업로드 처리 함수 - 중복 코드 제거
  async function processTemplateUpload(uploadData, defaultName = "새 템플릿") {
    console.log(
      "[DEBUG] 🔴 processTemplateUpload 호출됨",
      uploadData,
      defaultName
    );
    // uploadData = { base64Image: "..." } 또는 { imageUrl: "..." }

    // 템플릿 이름 입력받기
    const templateName = prompt(
      "AI가 분석할 이 템플릿의 이름을 입력하세요:",
      defaultName
    );
    console.log("[DEBUG] 🔴 템플릿 이름 입력:", templateName);
    if (!templateName) {
      console.log("[DEBUG] 🔴 템플릿 이름 입력 취소됨");
      if (templateMessage) {
        templateMessage.textContent = "템플릿 등록이 취소되었습니다.";
        templateMessage.style.color = "#666";
      }
      return;
    }

    // 로딩 상태 표시
    console.log("[DEBUG] 🔴 로딩 상태 표시 시작");
    if (templateMessage) {
      templateMessage.textContent = "🔄 AI가 이미지를 분석하는 중...";
      templateMessage.style.color = "#1976d2";
    }

    // 자동 리사이즈: base64 이미지가 있으면 캔버스에서 리사이즈 후 재할당
    try {
      if (
        uploadData?.base64Image &&
        typeof uploadData.base64Image === "string"
      ) {
        const header = uploadData.base64Image.slice(0, 100);
        const originalLength = uploadData.base64Image.length;
        // 작은 이미지는 스킵(이미 충분히 작음)
        if (originalLength > 200000) {
          // ~200KB 기준 임계값
          console.log(
            "[Template Upload] 🔄 자동 리사이즈 시작 (base64 length):",
            originalLength
          );
          const resizedBase64 = await resizeBase64Image(
            uploadData.base64Image,
            1280,
            1280
          );
          if (resizedBase64 && resizedBase64.length < originalLength) {
            uploadData = Object.assign({}, uploadData, {
              base64Image: resizedBase64,
            });
            console.log(
              "[Template Upload] ✅ 리사이즈 적용, 새 base64 length:",
              resizedBase64.length,
              "prompt head:",
              header
            );
          } else {
            console.log(
              "[Template Upload] ⚠️ 리사이즈 결과가 원본보다 크거나 동일하여 적용하지 않음"
            );
          }
        } else {
          console.log(
            "[Template Upload] ⚪ 이미지 크기 작음 - 리사이즈 생략 (length):",
            originalLength
          );
        }
      }
    } catch (err) {
      console.warn(
        "[Template Upload] 자동 리사이즈 실패, 원본 전송 진행:",
        err
      );
      // 실패 시 원본 이미지를 그대로 사용
    }

    // [PRD v3.3 Enhanced] 타임아웃 처리 추가 (5분 - 복잡한 이미지 분석 고려)
    let responseReceived = false;
    const TIMEOUT_MS = 300000; // 5분 (300초) - 복잡한 이미지 분석에 충분한 시간

    const timeoutId = setTimeout(() => {
      if (!responseReceived) {
        responseReceived = true;
        if (templateMessage) {
          templateMessage.textContent =
            "⏱️ 분석 시간이 초과되었습니다. 더 작은 이미지로 다시 시도하세요.";
          templateMessage.style.color = "#f57c00";
        }
        window.parent.postMessage(
          {
            action: "cp_show_toast",
            message: "⏱️ AI 분석 시간 초과. 다시 시도하세요.",
          },
          "*"
        );
      }
    }, TIMEOUT_MS);

    // 진행 상태 업데이트 (10초마다)
    let progressCount = 0;
    const progressInterval = setInterval(() => {
      if (responseReceived) {
        clearInterval(progressInterval);
        return;
      }
      progressCount++;
      const dots = ".".repeat((progressCount % 3) + 1);
      if (templateMessage) {
        templateMessage.textContent = `🔄 AI가 이미지를 분석하는 중${dots} (${
          progressCount * 10
        }초)`;
      }
    }, 10000);

    // background.js로 데이터 전송
    console.log("[DEBUG] 🔴 chrome.runtime.sendMessage 호출 직전", {
      action: "analyze_image_for_template",
      data: { ...uploadData, templateName: templateName },
    });
    chrome.runtime.sendMessage(
      {
        action: "analyze_image_for_template",
        data: { ...uploadData, templateName: templateName },
      },
      (response) => {
        console.log(
          "[DEBUG] 🔴 chrome.runtime.sendMessage 콜백 실행됨",
          response
        );

        // chrome.runtime.lastError 확인
        if (chrome.runtime.lastError) {
          console.error(
            "[DEBUG] 🔴 chrome.runtime.lastError:",
            chrome.runtime.lastError
          );
          clearTimeout(timeoutId);
          clearInterval(progressInterval);
          if (templateMessage) {
            templateMessage.textContent = `❌ 메시지 전송 실패: ${chrome.runtime.lastError.message}`;
            templateMessage.style.color = "#d32f2f";
          }
          return;
        }

        if (responseReceived) return; // 타임아웃 후 응답은 무시
        responseReceived = true;
        clearTimeout(timeoutId);
        clearInterval(progressInterval);

        if (response?.success) {
          if (templateMessage) {
            templateMessage.textContent =
              "✅ 템플릿이 성공적으로 등록되었습니다!";
            templateMessage.style.color = "#2e7d32";
          }
          window.parent.postMessage(
            {
              action: "cp_show_toast",
              message: `✅ 템플릿 "${templateName}"이 등록되었습니다.`,
            },
            "*"
          );
          // FR-T3-DnD (v2.3): 등록 성공 시 즉시 새로고침
          refreshAllTemplateData();
        } else {
          // [PRD v3.3 FR-W1] 구체적인 오류 메시지 UI 표시
          const errorMsg = response?.error || "알 수 없는 오류";
          let userFriendlyMessage = `❌ 템플릿 등록 실패: ${errorMsg}`;

          if (errorMsg.includes("fontRatio")) {
            userFriendlyMessage =
              "❌ 분석 실패: 폰트 크기(fontRatio)를 숫자로 인식하지 못했습니다. AI가 값을 추정하지 못했습니다.";
          } else if (errorMsg.includes("시간 초과")) {
            userFriendlyMessage =
              "❌ 분석 실패: AI 분석 시간이 초과되었습니다. 더 단순한 이미지를 시도해보세요.";
          } else if (
            errorMsg.includes("widthRatio") ||
            errorMsg.includes("heightRatio")
          ) {
            userFriendlyMessage =
              "❌ 분석 실패: 요소 크기를 숫자로 인식하지 못했습니다.";
          } else if (errorMsg.includes("x") || errorMsg.includes("y")) {
            userFriendlyMessage =
              "❌ 분석 실패: 요소 위치를 숫자로 인식하지 못했습니다.";
          }

          if (templateMessage) {
            templateMessage.textContent = userFriendlyMessage;
            templateMessage.style.color = "#d32f2f";
          }
          window.parent.postMessage(
            {
              action: "cp_show_toast",
              message: userFriendlyMessage,
            },
            "*"
          );
        }
      }
    );
  }

  // FR-T3-DnD (v2.2 수정): 다중 소스 드래그 앤 드롭 이벤트 바인딩
  if (templateDropzone && templateUploader) {
    // dragover: 드롭 허용 및 시각적 피드백
    templateDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      templateDropzone.classList.add("drag-over");
      templateDropzone.style.borderColor = "#4285F4";
      templateDropzone.style.background = "#f0f6ff";
    });

    // dragleave: 시각적 피드백 제거
    templateDropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      templateDropzone.classList.remove("drag-over");
      templateDropzone.style.borderColor = "#ccc";
      templateDropzone.style.background = "#f9f9f9";
    });

    // drop: 다중 소스 처리 (로컬 파일 우선, 웹 URL 차순위)
    templateDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      templateDropzone.classList.remove("drag-over");
      templateDropzone.style.borderColor = "#ccc";
      templateDropzone.style.background = "#f9f9f9";

      // 1순위: 로컬 파일
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];

        // 파일 유효성 검사
        if (!file.type.startsWith("image/")) {
          if (templateMessage) {
            templateMessage.textContent = "❌ 이미지 파일만 업로드 가능합니다.";
            templateMessage.style.color = "#d32f2f";
          }
          window.parent.postMessage(
            {
              action: "cp_show_toast",
              message: "❌ 이미지 파일만 업로드 가능합니다.",
            },
            "*"
          );
          return;
        }

        // Base64 변환 후 공통 함수 호출
        const reader = new FileReader();
        reader.onload = (event) => {
          processTemplateUpload(
            { base64Image: event.target.result },
            file.name.replace(/\.[^/.]+$/, "")
          );
        };
        reader.onerror = () => {
          if (templateMessage) {
            templateMessage.textContent = "❌ 파일 읽기 실패";
            templateMessage.style.color = "#d32f2f";
          }
          window.parent.postMessage(
            { action: "cp_show_toast", message: "❌ 파일 읽기 실패" },
            "*"
          );
        };
        reader.readAsDataURL(file);
      }
      // 2순위: 웹 이미지 URL
      else if (e.dataTransfer.getData("text/uri-list")) {
        const imageUrl = e.dataTransfer.getData("text/uri-list").trim();

        // URL 유효성 검사 (간단한 체크)
        if (!imageUrl.startsWith("http")) {
          if (templateMessage) {
            templateMessage.textContent = "❌ 유효한 이미지 URL이 아닙니다.";
            templateMessage.style.color = "#d32f2f";
          }
          window.parent.postMessage(
            {
              action: "cp_show_toast",
              message: "❌ 유효한 이미지 URL이 아닙니다.",
            },
            "*"
          );
          return;
        }

        // 이미지 확장자 간단 검증 (선택적)
        const validExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
        const hasValidExt = validExtensions.some((ext) =>
          imageUrl.toLowerCase().includes(ext)
        );
        if (!hasValidExt) {
          // 경고만 하고 진행 (일부 URL은 확장자가 명확하지 않을 수 있음)
          console.warn(
            "⚠️ URL에 이미지 확장자가 명확하지 않습니다. 계속 진행합니다."
          );
        }

        // URL을 직접 공통 함수로 전달 (background.js가 fetch 처리)
        const urlFileName =
          imageUrl.split("/").pop().split("?")[0] || "웹 이미지";
        processTemplateUpload({ imageUrl: imageUrl }, urlFileName);
      }
      // 기타 (text/html 등): 무시
      else {
        if (templateMessage) {
          templateMessage.textContent =
            "❌ 이미지 파일 또는 이미지 URL을 드롭해주세요.";
          templateMessage.style.color = "#d32f2f";
        }
      }
    });

    // click: 폴백 - 파일 선택 다이얼로그 열기
    templateDropzone.addEventListener("click", () => {
      templateUploader.click();
    });

    // change: 폴백 - 로컬 파일 선택 시 처리
    templateUploader.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // 파일 유효성 검사
      if (!file.type.startsWith("image/")) {
        if (templateMessage) {
          templateMessage.textContent = "❌ 이미지 파일만 업로드 가능합니다.";
          templateMessage.style.color = "#d32f2f";
        }
        window.parent.postMessage(
          {
            action: "cp_show_toast",
            message: "❌ 이미지 파일만 업로드 가능합니다.",
          },
          "*"
        );
        return;
      }

      // Base64 변환 후 공통 함수 호출
      const reader = new FileReader();
      reader.onload = (event) => {
        processTemplateUpload(
          { base64Image: event.target.result },
          file.name.replace(/\.[^/.]+$/, "")
        );
      };
      reader.onerror = () => {
        if (templateMessage) {
          templateMessage.textContent = "❌ 파일 읽기 실패";
          templateMessage.style.color = "#d32f2f";
        }
        window.parent.postMessage(
          { action: "cp_show_toast", message: "❌ 파일 읽기 실패" },
          "*"
        );
      };
      reader.readAsDataURL(file);

      // 동일 파일 재업로드 가능하도록 초기화
      e.target.value = null;
    });
  }

  // FR5 (수정, PRD v2.3): 워크스페이스 진입 시 템플릿 데이터 초기 로드
  refreshAllTemplateData();
}
