import { marked } from "marked";
import showdown from "showdown";
// ... 기존 import 구문
import Quill from "quill";
import "quill/dist/quill.snow.css"; // Webpack 설정 필요
import { shortenLink } from "../utils.js";

export function renderWorkspace(container, ideaData) {
  // 자료 보관함 목록 갱신 함수 (재사용)
  function refreshAllScrapsList(scrapsData) {
    const allScrapsContainer = container.querySelector(".all-scraps-list");
    if (!scrapsData || scrapsData.length === 0) {
      allScrapsContainer.innerHTML = "<p>자료 보관함이 비어있습니다.</p>";
      return;
    }
    // 최신순 정렬
    const sortedScraps = scrapsData
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp);
    const allScrapsHtml = sortedScraps
      .map((s) => createScrapCard(s, false))
      .join("");
    allScrapsContainer.innerHTML = allScrapsHtml;
  }
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps)
    ? ideaData.linkedScraps
    : ideaData.linkedScraps
    ? Object.keys(ideaData.linkedScraps)
    : [];

  const outlineHtml =
    ideaData.outline && ideaData.outline.length > 0
      ? ideaData.outline.map((item) => `<li>${item}</li>`).join("")
      : "<li>추천 목차가 없습니다.</li>";

  const longTailKeywordsHtml =
    ideaData.longTailKeywords && ideaData.longTailKeywords.length > 0
      ? ideaData.longTailKeywords
          .map(
            (k) =>
              `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
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

  container.innerHTML = `
    <div class="workspace-container">
      <div id="ai-briefing-panel" class="workspace-column">
        <h2>✨ AI 브리핑</h2>
        <div class="ai-briefing-content">
          <h4>주요 키워드</h4>
          <div class="keyword-list">
            ${(ideaData.tags || [])
              .filter((t) => t !== "#AI-추천")
              .map(
                (k) =>
                  `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
              )
              .join("")}
          </div>

          <h4>롱테일 키워드</h4>
          <div class="keyword-list">
            ${longTailKeywordsHtml}
          </div>

          <h4>추천 목차</h4>
          <ul class="outline-list">
            ${outlineHtml}
          </ul>
          
          <h4>추천 검색어</h4>
          <ul class="keyword-list">
            ${searchesHtml}
          </ul>

          <button id="generate-draft-btn">📄 AI로 초안 생성하기</button>
        </div>
      </div>

            <div id="main-editor-panel" class="workspace-column">
                <h2>✍️ 초안 작성</h2>
                <div class="draft-history-tabs">
                  <!-- 초안 히스토리 탭 렌더링 -->
                  ${(() => {
                    let tabsHtml = "";
                    const drafts =
                      ideaData.drafts ||
                      (ideaData.draftContent
                        ? {
                            legacy: {
                              title: "기존 초안",
                              content: ideaData.draftContent,
                            },
                          }
                        : {});
                    const activeId =
                      ideaData.activeDraftId ||
                      (drafts.legacy ? "legacy" : Object.keys(drafts)[0]);
                    for (const [draftId, draft] of Object.entries(drafts)) {
                      tabsHtml += `<button class="draft-tab${
                        draftId === activeId ? " active" : ""
                      }" data-draft-id="${draftId}">${
                        draft.title || "(제목 없음)"
                      }</button>`;
                    }
                    tabsHtml += `<button class="draft-tab new-draft-btn" id="create-new-draft-btn">+ 새 초안</button>`;
                    return tabsHtml;
                  })()}
                </div>
                <div id="quill-editor-container" class="quill-snow-wrapper">
                  <!-- Quill 에디터가 이곳에 초기화됩니다 -->
                </div>
            </div>

            <div id="resource-library-panel" class="workspace-column">
                <div id="linked-scraps-section">
                    <h4>🔗 연결된 자료</h4>
                    <div class="scrap-list linked-scraps-list" data-idea-id="${
                      ideaData.id
                    }">
                        <p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>
                    </div>
                </div>
                <h4>📖 모든 스크랩</h4>
                <div class="scrap-list all-scraps-list">
                        <p class="loading-scraps">스크랩 목록을 불러오는 중...</p>
                </div>
            </div>
    </div>
  `;

  chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
    if (response && response.success) {
      const allScrapsData = response.scraps;
      const linkedScrapsContainer = container.querySelector(
        ".linked-scraps-list"
      );
      // 연결된 자료 목록은 기존 방식 유지
      const linkedScrapsHtml = allScrapsData
        .filter((s) => ideaData.linkedScraps.includes(s.id))
        .map((s) => createScrapCard(s, true))
        .join("");
      linkedScrapsContainer.innerHTML =
        linkedScrapsHtml ||
        "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
      // 자료 보관함 목록은 함수로 분리하여 갱신
      refreshAllScrapsList(allScrapsData);
    }
  });

  // Quill 에디터 인스턴스 생성
  const editorEl = container.querySelector("#quill-editor-container");
  if (editorEl && !editorEl.quillInstance) {
    // 중복 초기화 방지
    const quill = new Quill(editorEl, {
      theme: "snow",
      modules: {
        toolbar: {
          container: [
            [{ header: [1, 2, 3, 4, 5, 6, false] }],
            [{ font: [] }, { size: ["small", false, "large", "huge"] }],
            ["bold", "italic", "underline", "strike"],
            [{ color: [] }, { background: [] }],
            [{ script: "sub" }, { script: "super" }],
            ["blockquote", "code-block"],
            [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
            [{ indent: "-1" }, { indent: "+1" }],
            [{ direction: "rtl" }],
            [{ align: [] }],
            ["link", "image", "video"],
            ["clean"],
          ],
          handlers: {
            // 커스텀 핸들러 추가 가능
          },
        },
        clipboard: {
          // 클립보드 최적화
          matchVisual: false,
        },
      },
      formats: [
        "header",
        "font",
        "size",
        "bold",
        "italic",
        "underline",
        "strike",
        "color",
        "background",
        "script",
        "blockquote",
        "code-block",
        "list",
        "bullet",
        "indent",
        "align",
        "direction",
        "link",
        "image",
        "video",
      ],
      placeholder:
        "이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...",
      readOnly: false,
      bounds: editorEl,
      scrollingContainer: editorEl,
    });

    // 에디터 초기화 완료 후 콘텐츠 로드
    try {
      // ★ A/C-2: DB에 저장된 마크다운 초안을 HTML로 변환하여 Quill에 로드
      if (ideaData.draftContent) {
        const htmlContent = marked.parse(ideaData.draftContent);
        quill.clipboard.dangerouslyPasteHTML(0, htmlContent);
      }

      // 에디터 변경 이벤트 리스너 추가 (자동 저장 등을 위해)
      quill.on("text-change", (delta, oldDelta, source) => {
        if (source === "user") {
          // 사용자가 편집할 때만 처리
          const content = quill.root.innerHTML;
          // 자동 저장 로직을 여기에 추가할 수 있음
          console.log("Content changed:", content);
        }
      });

      // 선택 영역 변경 이벤트 (툴바 업데이트 등을 위해)
      quill.on("selection-change", (range, oldRange, source) => {
        if (range) {
          // 선택 영역이 있을 때의 처리
          console.log("Selection changed:", range);
        }
      });

      // Quill 인스턴스를 DOM 엘리먼트에 저장 (나중에 참조할 수 있도록)
      editorEl.quillInstance = quill;

      // 에디터 초기화 완료 표시
      editorEl.classList.add("quill-initialized");
    } catch (error) {
      console.error("Quill 에디터 초기화 중 오류 발생:", error);
    }
  }

  addWorkspaceEventListeners(
    container.querySelector(".workspace-container"),
    ideaData
  );
}

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || "(내용 없음)";
  const cleanedTitle = textContent.replace(/\s+/g, " ").trim();
  const tagsHtml =
    scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
      ? `<div class=\"card-tags\">${scrap.tags
          .map((tag) => `<span class=\"tag\">#${tag}</span>`)
          .join("")}</div>`
      : "";
  const actionButton = isLinked
    ? `<button class=\"scrap-card-delete-btn unlink-scrap-btn\" title=\"연결 해제\">\n         <svg xmlns=\"http://www.w3.org/2000/svg\" height=\"18\" viewBox=\"http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>\n       </button>`
    : "";
  if (isLinked) {
    // 태그형 카드: 아이콘 + 한 줄 제목만 표시
    return `\n      <div class=\"scrap-card-item\" draggable=\"true\" data-scrap-id=\"${
      scrap.id
    }\" data-text=\"${textContent.replace(
      /"/g,
      "&quot;"
    )}\">\n        <div class=\"scrap-card linked-tag-card\">\n          ${actionButton}\n          <span class=\"scrap-card-icon\">📄</span>\n          <span class=\"scrap-card-title\">${cleanedTitle.substring(
      0,
      32
    )}</span>\n        </div>\n      </div>\n    `;
  }
  // 기존 카드(이미지, 요약, 태그 포함)
  return `\n    <div class=\"scrap-card-item\" draggable=\"true\" data-scrap-id=\"${
    scrap.id
  }\" data-text=\"${textContent.replace(
    /"/g,
    "&quot;"
  )}\">\n        <div class=\"scrap-card\">\n            ${actionButton}\n            ${
    scrap.image
      ? `<div class=\"scrap-card-img-wrap\"><img src=\"${scrap.image}\" alt=\"scrap image\" referrerpolicy=\"no-referrer\"></div>`
      : ""
  }\n            <div class=\"scrap-card-info\">\n                <div class=\"scrap-card-title\">${cleanedTitle.substring(
    0,
    20
  )}...</div>\n                <div class=\"scrap-card-snippet\">${shortenLink(
    scrap.url,
    25
  )}</div>\n                ${tagsHtml}\n            </div>\n        </div>\n    </div>\n  `;
}

function addWorkspaceEventListeners(workspaceEl, ideaData) {
  const editorEl = workspaceEl.querySelector("#quill-editor-container");
  const quill = editorEl ? editorEl.quillInstance : null;
  const resourceLibrary = workspaceEl.querySelector("#resource-library-panel");
  const linkedScrapsList = workspaceEl.querySelector(".linked-scraps-list");
  const keywordList = workspaceEl.querySelector(".keyword-list");
  const generateDraftBtn = workspaceEl.querySelector("#generate-draft-btn");

  // Quill 에디터의 text-change 이벤트로 자동 저장 구현
  if (quill) {
    let saveTimeout; // 디바운싱을 위한 타이머

    quill.on("text-change", (delta, oldDelta, source) => {
      if (source !== "user") return; // 사용자에 의한 변경일 때만 저장

      clearTimeout(saveTimeout); // 이전 저장 타이머 취소
      saveTimeout = setTimeout(() => {
        // A/C-2: showdown 변환기 인스턴스 생성
        const converter = new showdown.Converter();
        // A/C-3: Quill 편집기의 현재 내용을 HTML 문자열로 가져옴
        const htmlContent = quill.root.innerHTML;
        // A/C-4: HTML을 마크다운으로 변환
        const markdownDraft = converter.makeMarkdown(htmlContent);

        // 데이터베이스에 저장된 초안과 내용이 다를 경우에만 저장 요청
        if (markdownDraft.trim() !== (ideaData.draftContent || "").trim()) {
          console.log("Saving draft...");
          const saveData = {
            ideaId: ideaData.id,
            status: ideaData.status,
            draft: markdownDraft.trim(), // 마크다운으로 변환된 텍스트를 저장
          };
          chrome.runtime.sendMessage(
            { action: "save_draft_content", data: saveData },
            (saveResponse) => {
              if (saveResponse && saveResponse.success) {
                // 저장 성공 시, ideaData 객체도 업데이트하여 일관성 유지
                ideaData.draftContent = markdownDraft.trim();
                console.log("Draft saved successfully.");
              } else {
                console.error("Failed to save draft:", saveResponse?.error);
              }
            }
          );
        }
      }, 1000); // 1초 디바운싱
    });
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
    const converter = new showdown.Converter();
    const currentHtml = quill ? quill.root.innerHTML : "";
    const currentMarkdown = converter.makeMarkdown(currentHtml);
    const payload = {
      ...ideaData, // title, description, tags, outline, keywords 등 모든 아이디어 데이터
      currentDraft: currentMarkdown, // ★ 마크다운 형식으로 전달
      linkedScrapsContent: linkedScrapsContent, // 연결된 자료의 텍스트 목록
    };

    // 3. 통합된 데이터를 background.js로 전송합니다.
    chrome.runtime.sendMessage(
      { action: "generate_draft_from_idea", data: payload },
      (response) => {
        if (response && response.success) {
          // ★ AI가 생성한 마크다운 초안을 HTML로 변환하여 Quill에 덮어쓰기
          const markdownDraft = response.draft;
          const htmlDraft = marked.parse(markdownDraft);
          if (quill) {
            quill.clipboard.dangerouslyPasteHTML(0, htmlDraft);
          }

          // A/C-4: save_draft_content 메시지 전송
          const saveData = {
            ideaId: ideaData.id,
            status: ideaData.status,
            draft: response.draft,
          };
          chrome.runtime.sendMessage(
            { action: "save_draft_content", data: saveData },
            (saveResponse) => {
              if (!saveResponse || !saveResponse.success) {
                console.error("Failed to save draft:", saveResponse?.error);
                // (선택) 저장 실패 시 사용자에게 알림을 줄 수 있습니다.
              } else {
                console.log("Draft saved successfully.");
              }
            }
          );
        } else {
          alert(
            "초안 생성에 실패했습니다: " +
              (response?.error || "알 수 없는 오류")
          );
        }
        generateDraftBtn.textContent = "📄 AI로 초안 생성하기";
        generateDraftBtn.disabled = false;
      }
    );
  });

  // 실시간 스크랩 업데이트 수신 및 UI 갱신
  const allScrapsContainer = workspaceEl.querySelector(".all-scraps-list");

  function refreshAllScrapsList(scrapsData) {
    if (!scrapsData || scrapsData.length === 0) {
      allScrapsContainer.innerHTML = "<p>자료 보관함이 비어있습니다.</p>";
      return;
    }
    // 최신순 정렬
    const sortedScraps = scrapsData
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp);
    const allScrapsHtml = sortedScraps
      .map((s) => createScrapCard(s, false))
      .join("");
    allScrapsContainer.innerHTML = allScrapsHtml;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scraps_updated") {
      const updatedScraps = message.data || [];
      refreshAllScrapsList(updatedScraps);
    }
  });

  // A/C-1: 키워드 클릭 시 Quill 에디터에 마크다운 소제목 삽입
  keywordList.addEventListener("click", (e) => {
    if (e.target.classList.contains("interactive-tag")) {
      const keyword = e.target.textContent;
      if (quill) {
        // A/C-2: Quill API를 사용하여 편집기 끝에 텍스트 삽입
        const len = quill.getLength(); // 현재 텍스트 길이
        quill.insertText(len, `\n\n## ${keyword}\n\n`, "user"); // 끝에 텍스트 삽입
        quill.setSelection(quill.getLength()); // 커서를 맨 뒤로 이동
        quill.focus();
      }
    }
  });

  linkedScrapsList.addEventListener("click", (e) => {
    const unlinkBtn = e.target.closest(".unlink-scrap-btn");
    if (unlinkBtn) {
      e.stopPropagation();
      const cardItem = unlinkBtn.closest(".scrap-card-item");
      const scrapId = cardItem.dataset.scrapId;

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

  // 드래그 오버 이벤트: Quill 에디터 영역 전체를 드롭 대상으로 인식
  workspaceEl.addEventListener("dragover", (e) => {
    const dropTarget = e.target;
    if (
      editorEl &&
      (editorEl.contains(dropTarget) || linkedScrapsList.contains(dropTarget))
    ) {
      e.preventDefault();
      const targetElement = editorEl.contains(dropTarget)
        ? editorEl
        : linkedScrapsList;
      targetElement.classList.add("drag-over");
      e.dataTransfer.dropEffect = editorEl.contains(dropTarget)
        ? "copy"
        : "link";
    }
  });

  // 드래그 리브 이벤트
  workspaceEl.addEventListener("dragleave", (e) => {
    const target = e.target;
    if (
      editorEl &&
      (editorEl.contains(target) || linkedScrapsList.contains(target))
    ) {
      if (editorEl.contains(target)) {
        editorEl.classList.remove("drag-over");
      }
      if (linkedScrapsList.contains(target)) {
        linkedScrapsList.classList.remove("drag-over");
      }
    }
  });

  workspaceEl.addEventListener("drop", (e) => {
    e.preventDefault();

    let scrapData;
    try {
      scrapData = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (error) {
      return;
    }

    if (!scrapData) return;

    // A/C-2: Quill 편집기 영역 전체를 드롭 대상으로 인식
    if (editorEl && editorEl.contains(e.target)) {
      // 1. 드롭 대상이 에디터일 경우, drag-over 스타일을 제거합니다.
      editorEl.classList.remove("drag-over");

      // 2. 스크랩의 텍스트 내용을 가져옵니다.
      const textToInsert = scrapData.text || "";

      // A/C-3: Quill API를 사용하여 편집기 끝에 인용문 형식으로 텍스트 삽입
      if (quill) {
        const len = quill.getLength();
        quill.insertText(
          len,
          `\n\n--- (스크랩 인용) ---\n${textToInsert}\n------------------\n\n`,
          "user"
        );
        quill.setSelection(quill.getLength()); // 커서를 맨 뒤로 이동
        quill.focus();
      }
    } else if (linkedScrapsList.contains(e.target)) {
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
    }
  });
}
