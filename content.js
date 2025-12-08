// content.js (수정 완료된 최종 버전)

// [CSP Fix] webpack publicPath를 Chrome Extension URL로 설정
// 동적 import로 생성된 청크 파일이 올바른 경로에서 로드되도록 함
// webpack이 이 변수를 인식하도록 파일 최상단에 배치
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
  // eslint-disable-next-line no-undef
  __webpack_public_path__ = chrome.runtime.getURL("dist/") + "/";
}

// [Permissions Policy Fix] iframe 내부에서 web-share API 사용 방지
// 브라우저의 "Potential permissions policy violation: web-share is not allowed" 경고 방지
// iframe 내부에서는 web-share를 사용하지 않도록 명시적으로 체크
if (
  window.self !== window.top &&
  typeof navigator !== "undefined" &&
  navigator.share
) {
  // iframe 내부에서는 web-share를 사용하지 않도록 래퍼 함수로 감싸기
  try {
    const originalShare = navigator.share;
    Object.defineProperty(navigator, "share", {
      value: function () {
        // iframe 내부에서는 web-share를 사용하지 않음
        return Promise.reject(
          new DOMException(
            "Web Share API is not allowed in iframes",
            "NotAllowedError"
          )
        );
      },
      writable: false,
      configurable: true,
    });
  } catch (e) {
    // 이미 정의된 경우 무시 (조용히 실패)
  }
}

import { setupHighlighter } from "./js/core/highlighter.js";
import { createAndShowPanel, isPanelVisible } from "./js/ui/panel.js";
import { showRecentScrapPreview } from "./js/ui/preview.js";
import { showToast, Logger, showConfirmationToast } from "./js/utils.js";
import { renderDashboard } from "./js/ui/dashboardMode.js";

// 전역 TUI 에디터 리스너 강제 등록 (workspaceMode.js 모듈 로드)
import "./js/ui/workspaceMode.js";

// content.js 초기화 시점에 메시지 리스너 등록 확인
Logger.debug("🔧 [Content] content.js 모듈 로드 완료");
// 항상 보이는 로그로 content bundle 로드 확인을 쉽게 함 (디버깅용)
try {
  console.info('[Content Pilot] content.bundle.js loaded — content script active');
} catch (e) {
  // 노출 불가 환경 안전 장치
}

// 디버깅 보조: 페이지에서 확장 스크립트가 로드되었는지 즉시 시각 확인할 수 있도록
// 최상위 프레임에만 8초간 표시되는 작은 오버레이 배너를 추가합니다.
if (typeof window !== 'undefined' && window.self === window.top) {
  try {
    const existing = document.getElementById('cp-debug-banner');
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'cp-debug-banner';
      banner.textContent = 'Content Pilot active — content.bundle.js loaded';
      banner.style.cssText = [
        'position:fixed',
        'right:12px',
        'top:12px',
        'z-index:2147483647',
        'background:rgba(39, 174, 96, 0.95)',
        'color:white',
        'padding:6px 10px',
        'border-radius:6px',
        'font-family:system-ui, -apple-system, Roboto, "Noto Sans", "Segoe UI", sans-serif',
        'font-size:12px',
        'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
      ].join(' !important;');

      // 클릭하면 사라지도록 해두어 사용자 방해 최소화
      banner.addEventListener('click', () => banner.remove());

      document.documentElement.appendChild(banner);

      // 8초 뒤 자동 제거
      setTimeout(() => {
        try {
          banner.remove();
        } catch (e) {}
      }, 8000);
    }
  } catch (e) {
    // 안전 장치: 어떤 CSP/페이지 환경에서의 실패를 무시
    try {
      console.debug('[Content Pilot] cp-debug-banner 추가 실패:', e?.message || e);
    } catch (ignore) {}
  }
}

// 서비스 워커 / background에 로드 완료 시그널을 보냅니다 (디버깅 목적)
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'cp_content_loaded', href: window.location?.href, isTop: window.self === window.top });
  }
} catch (e) {
  try {
    console.debug('[Content Pilot] cp_content_loaded 메시지 전송 실패:', e?.message || e);
  } catch (_) {}
}
Logger.debug("🔧 [Content] window.location:", window.location?.href);
Logger.debug("🔧 [Content] window === window.top:", window === window.top);

// [최적화] Extension context 무효화 감지 - 이벤트 기반 방식 (폴링 제거)
// sessionStorage를 사용하여 페이지 세션 동안 한 번만 표시
const RELOAD_PROMPT_KEY = "cp_reload_prompt_shown";
const RELOAD_PROMPT_TIMEOUT = 5 * 60 * 1000; // 5분

// 1. 스크랩 기능은 항상 모든 프레임에서 활성화 준비
setupHighlighter();

// 2. UI 및 상태 제어 관련 기능은 최상위 창(top frame)에서만 실행
if (window.self === window.top) {
  window.__CP_HIGHLIGHT_TOGGLE_STATE = false;
  // 페이지 로드 시간 기록 (웹 페이지를 처음 열었을 때 감지용)
  window.__cp_pageLoadTime = Date.now();

  // 초기화 시 자동으로 패널 표시 (테스트용)
  setTimeout(() => {
    createAndShowPanel();
  }, 1000);

  // [최적화] 이벤트 기반 연결 상태 모니터링 (폴링 제거)
  function setupExtensionConnection() {
    let port = null;

    try {
      // 1. 백그라운드와 롱 런타임 연결(Long-lived connection) 수립
      port = chrome.runtime.connect({ name: "content-script-keepalive" });

      // 2. 연결이 끊어지는 시점(확장 프로그램 업데이트/삭제/비활성화) 감지
      port.onDisconnect.addListener(() => {
        // [실질적 원인 파악] chrome.runtime.lastError 확인
        const error = chrome.runtime.lastError;

        // 에러가 있고 "message port closed"가 아닌 경우만 실제 업데이트로 간주
        // "message port closed"는 정상적인 연결 종료 (서비스 워커 재시작 등)
        if (
          error &&
          error.message &&
          !error.message.includes("message port closed")
        ) {
          Logger.warn(
            "[Content Pilot] 확장 프로그램 연결 오류:",
            error.message
          );
          // 실제 에러인 경우에만 알림 표시
        } else if (
          error &&
          error.message &&
          error.message.includes("message port closed")
        ) {
          // 정상적인 연결 종료는 무시 (서비스 워커가 비활성 상태에서 종료된 경우)
          Logger.debug(
            "[Content Pilot] 정상적인 연결 종료 (서비스 워커 재시작)"
          );
          return;
        }

        // [실질적 원인 파악] 실제 업데이트 여부 확인
        // chrome.runtime.id를 확인하여 확장 프로그램이 여전히 존재하는지 확인
        try {
          const extensionId = chrome.runtime.id;
          if (!extensionId) {
            // 확장 프로그램이 삭제된 경우
            Logger.warn("[Content Pilot] 확장 프로그램이 삭제되었습니다.");
            return;
          }
        } catch (e) {
          // chrome.runtime.id 접근 실패 = 확장 프로그램이 실제로 제거됨
          Logger.warn("[Content Pilot] 확장 프로그램이 제거되었습니다.");
          return;
        }

        // [실질적 원인 파악] 서비스 워커가 실제로 업데이트되었는지 확인
        // chrome.storage.local에 업데이트 플래그가 있는지 확인
        chrome.storage.local.get(
          ["extension_updated", "extension_updated_time"],
          (result) => {
            // 업데이트 플래그가 없으면 단순 재시작으로 간주하고 알림 표시하지 않음
            if (!result.extension_updated) {
              Logger.debug(
                "[Content Pilot] 서비스 워커 재시작 감지 (실제 업데이트 아님)"
              );
              return;
            }

            // 업데이트 플래그가 있으면 실제 업데이트로 간주
            Logger.warn("[Content Pilot] 확장 프로그램이 업데이트되었습니다.");
            Logger.debug(
              "[Content Pilot] 업데이트 시간:",
              result.extension_updated_time
                ? new Date(result.extension_updated_time).toISOString()
                : "없음"
            );

            // 업데이트 플래그 제거 (한 번만 알림 표시)
            chrome.storage.local.remove([
              "extension_updated",
              "extension_updated_time",
            ]);

            // 3. 중복 프롬프트 방지 (sessionStorage 사용)
            try {
              const lastShownTime = sessionStorage.getItem(RELOAD_PROMPT_KEY);
              const now = Date.now();

              // 이전에 표시한 시간이 있고, 5분 이내라면 표시하지 않음
              if (lastShownTime) {
                const timeSinceLastShown = now - parseInt(lastShownTime, 10);
                if (timeSinceLastShown < RELOAD_PROMPT_TIMEOUT) {
                  Logger.debug(
                    `[Content Pilot] 새로고침 프롬프트 건너뜀 (${Math.round(
                      timeSinceLastShown / 1000
                    )}초 전에 표시됨)`
                  );
                  return; // 이미 최근에 표시됨
                }
              }

              // 표시 시간 기록
              sessionStorage.setItem(RELOAD_PROMPT_KEY, now.toString());
              Logger.debug("[Content Pilot] 새로고침 프롬프트 표시 시작");
            } catch (storageError) {
              // sessionStorage 접근 실패 시에도 계속 진행 (private browsing 등)
              Logger.warn(
                "[Content Pilot] sessionStorage 접근 실패, 프롬프트 표시 계속:",
                storageError
              );
            }

            // 4. 사용자에게 새로고침 안내 UI 표시
            // showConfirmationToast 사용 (utils.js에 있음)
            if (typeof showConfirmationToast === "function") {
              Logger.debug("[Content Pilot] showConfirmationToast 함수 호출");
              showConfirmationToast(
                "Content Pilot이 업데이트되었습니다. 원활한 사용을 위해 페이지를 새로고침해주세요.",
                () => {
                  // 새로고침 시 sessionStorage도 초기화
                  try {
                    sessionStorage.removeItem(RELOAD_PROMPT_KEY);
                  } catch (e) {
                    // 무시
                  }
                  window.location.reload();
                }
              );
            } else {
              Logger.warn(
                "[Content Pilot] showConfirmationToast 함수를 찾을 수 없음, fallback UI 사용"
              );
              // Fallback UI (utils.js가 없을 경우)
              const msg =
                "Content Pilot이 업데이트되었습니다.\n기능을 계속 사용하려면 페이지를 새로고침해주세요.";
              if (confirm(msg)) {
                try {
                  sessionStorage.removeItem(RELOAD_PROMPT_KEY);
                } catch (e) {
                  // 무시
                }
                window.location.reload();
              }
            }
          }
        );
      });

      Logger.info("[Content Pilot] 확장 프로그램 연결 모니터링 시작");
    } catch (error) {
      // 이미 연결이 끊어진 상태에서 진입했을 경우
      Logger.error("[Content Pilot] 초기 연결 실패 (이미 무효화됨):", error);

      // 연결 실패 시에도 중복 방지 체크 후 프롬프트 표시
      try {
        const lastShownTime = sessionStorage.getItem(RELOAD_PROMPT_KEY);
        const now = Date.now();

        if (lastShownTime) {
          const timeSinceLastShown = now - parseInt(lastShownTime, 10);
          if (timeSinceLastShown < RELOAD_PROMPT_TIMEOUT) {
            return; // 이미 최근에 표시됨
          }
        }

        sessionStorage.setItem(RELOAD_PROMPT_KEY, now.toString());

        if (typeof showConfirmationToast === "function") {
          showConfirmationToast(
            "Content Pilot이 업데이트되었습니다. 원활한 사용을 위해 페이지를 새로고침해주세요.",
            () => {
              try {
                sessionStorage.removeItem(RELOAD_PROMPT_KEY);
              } catch (e) {
                // 무시
              }
              window.location.reload();
            }
          );
        }
      } catch (storageError) {
        Logger.warn(
          "[Content Pilot] 연결 실패 후 프롬프트 표시 실패:",
          storageError
        );
      }
    }
  }

  // 초기화 시점에 연결 설정 실행
  setupExtensionConnection();

  // background.js로부터의 메시지 수신
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case "open_content_pilot_panel":
        createAndShowPanel();
        break;

      // 데이터 새로고침 메시지를 수신하여 대시보드를 다시 렌더링
      case "cp_data_refreshed": {
        const host = document.getElementById("content-pilot-host");
        if (isPanelVisible() && host?.shadowRoot) {
          const mainArea = host.shadowRoot.querySelector("#cp-main-area");
          if (mainArea && window.__cp_active_mode === "dashboard") {
            renderDashboard(mainArea);
          }
        }
        break;
      }
      case 'cp_ping': {
        // background에서 보낸 펑(ping)에 대해 응답(pong)을 즉시 반환
        try {
          return Promise.resolve({ action: 'cp_pong', href: window.location?.href, isTop: window.self === window.top });
        } catch (e) {
          return Promise.resolve({ action: 'cp_pong', href: 'unknown', isTop: window.self === window.top });
        }
      }

      // [체크리스트 1-A] 스크랩 저장 후 프리뷰 UI 표시
      case "cp_show_preview": {
        if (msg.data) {
          showRecentScrapPreview(msg.data);
        }
        break;
      }

      // [체크리스트 1-A] 스크랩 저장 실패 시 토스트 메시지
      case "cp_show_toast": {
        if (msg.message) {
          showToast(msg.message);
        }
        break;
      }
    }
  });

  // 아이프레임으로부터 미리보기/토스트 메시지 요청 수신
  // 전역 메시지 리스너 (모든 window에서 작동, 모든 프레임에서 등록)
  const contentMessageListener = (event) => {
    // 디버깅: 모든 메시지 로깅
    if (event.data && typeof event.data === "object" && event.data.action) {
      // Cross-origin 프레임의 location 접근 시도 시 SecurityError 방지
      let sourceWindowLocation = "unknown";
      try {
        sourceWindowLocation = event.source?.location?.href || "unknown";
      } catch (e) {
        // Cross-origin 프레임에서는 location에 접근할 수 없음
        sourceWindowLocation = "cross-origin";
      }

      let windowLocation = "unknown";
      try {
        windowLocation = window.location.href;
      } catch (e) {
        windowLocation = "cross-origin";
      }

      // 디버그 모드에서만 상세 로그 출력
      if (Logger.isDebugMode()) {
        Logger.debug("📨 [Content] 메시지 수신:", {
          action: event.data.action,
          origin: event.origin,
          source: event.source,
          windowLocation: windowLocation,
          isTopWindow: window === window.top,
          sourceWindow: sourceWindowLocation,
        });
      }
    }

    if (event.data && event.data.action === "cp_show_preview") {
      showRecentScrapPreview(event.data.data);
    }
    if (event.data && event.data.action === "cp_show_toast") {
      showToast(event.data.message);
    }

    // TUI 에디터 열기 요청 처리
    if (event.data && event.data.action === "cp_open_tui_editor") {
      // 디버그 모드에서만 상세 로그 출력
      if (Logger.isDebugMode()) {
        Logger.debug("🏢 [Content] 📨 cp_open_tui_editor 메시지 수신!");
        Logger.debug("📦 [Content] 메시지 데이터:", event.data);
        Logger.debug("🔍 [Content] 이벤트 소스:", event.source);
        Logger.debug("🔍 [Content] 이벤트 origin:", event.origin);
      }

      // currentImageUrl 또는 imageUrl 둘 다 처리 (호환성)
      const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
      if (!imageUrl) {
        console.error("[Content] TUI 에디터 열기 실패: 이미지 URL 없음");
        return;
      }

      // workspace 컨테이너 찾기
      const host = document.getElementById("content-pilot-host");
      const workspaceContainer =
        host?.shadowRoot?.querySelector(".workspace-container") ||
        document.querySelector(".workspace-container") ||
        document.querySelector(".cp-workspace-container");

      // TUI 에디터 iframe 생성 또는 재사용
      let tuiEditorIframe = document.querySelector("#tui-editor-iframe");

      if (!tuiEditorIframe) {
        console.log("🔨 [Content] TUI 에디터 iframe 생성 중...");

        // 기존 모달이 있으면 제거
        const existingOverlay = document.querySelector("#tui-editor-overlay");
        if (existingOverlay) existingOverlay.remove();

        // 배경 오버레이 생성
        const overlay = document.createElement("div");
        overlay.id = "tui-editor-overlay";
        overlay.style.cssText =
          "position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;";
        overlay.onclick = () => {
          if (confirm("편집을 종료하시겠습니까?")) {
            overlay.remove();
            if (tuiEditorIframe) tuiEditorIframe.remove();
          }
        };
        // body의 마지막에 추가하여 최상위에 위치
        document.body.appendChild(overlay);

        // 모달 컨테이너 생성
        const modalContainer = document.createElement("div");
        modalContainer.id = "tui-editor-modal-container";
        modalContainer.style.cssText =
          "position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;";
        overlay.appendChild(modalContainer);

        // 닫기 버튼 추가
        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = "×";
        closeBtn.style.cssText =
          "position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;";
        closeBtn.onmouseover = () =>
          (closeBtn.style.background = "rgba(255,255,255,0.2)");
        closeBtn.onmouseout = () =>
          (closeBtn.style.background = "rgba(255,255,255,0.1)");
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm("편집을 종료하시겠습니까?")) {
            overlay.remove();
            if (tuiEditorIframe) tuiEditorIframe.remove();
          }
        };
        modalContainer.appendChild(closeBtn);

        // iframe 생성
        tuiEditorIframe = document.createElement("iframe");
        tuiEditorIframe.id = "tui-editor-iframe";
        tuiEditorIframe.src = chrome.runtime.getURL("tui-editor.html");
        tuiEditorIframe.style.cssText =
          "width:100%;height:100%;border:none;background:#282828;";
        modalContainer.appendChild(tuiEditorIframe);
        console.log("✅ [Content] TUI 에디터 iframe 생성 완료!");
        console.log("📍 [Content] iframe src:", tuiEditorIframe.src);

        // TUI 에디터에서 편집 완료 시 처리
        const sourceInfo = event.data.source || "editor";
        const editorIframe =
          workspaceContainer?.querySelector("#quill-editor-iframe") ||
          host?.shadowRoot?.querySelector("#quill-editor-iframe");

        const tuiEditorMessageHandler = function (e) {
          if (e.data?.action === "tui-editor-result" && e.data.dataUrl) {
            console.log("[Content] TUI 에디터 편집 완료, 결과 처리 중...");

            // 썸네일 메이커에서 온 경우: 에디터에 삽입
            if (
              sourceInfo === "thumbnail_maker" ||
              !event.data.allDocumentImages ||
              event.data.allDocumentImages.length === 0
            ) {
              const altText = "편집된 썸네일";
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  {
                    action: "insert-image",
                    data: {
                      url: e.data.dataUrl,
                      alt: altText,
                    },
                  },
                  "*"
                );
                if (typeof showToast === "function") {
                  showToast("✅ 편집된 썸네일이 본문에 삽입되었습니다!");
                }
              }
            } else {
              // 에디터에서 온 경우: 기존 이미지 교체
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  {
                    action: "replace-edited-image",
                    data: { dataUrl: e.data.dataUrl },
                  },
                  "*"
                );
              }
            }

            // TUI 에디터 iframe 제거
            if (tuiEditorIframe) {
              tuiEditorIframe.remove();
            }

            // 메시지 핸들러 제거
            window.removeEventListener("message", tuiEditorMessageHandler);
          }
        };
        window.addEventListener("message", tuiEditorMessageHandler);

        // TUI 에디터 iframe이 로드되면 이미지 전달
        tuiEditorIframe.onload = () => {
          console.log(
            "[Content] TUI 에디터 iframe 로드 완료, 이미지 전달 중..."
          );
          setTimeout(() => {
            if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
              // 1. 이미지 열기
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: "open-tui-editor",
                  imageUrl: imageUrl,
                },
                "*"
              );

              // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
              if (
                event.data.allDocumentImages &&
                Array.isArray(event.data.allDocumentImages) &&
                event.data.allDocumentImages.length > 0
              ) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: "set-document-images",
                    images: event.data.allDocumentImages,
                  },
                  "*"
                );
                console.log(
                  "[Content] 문서 이미지 목록 전달 완료:",
                  event.data.allDocumentImages.length,
                  "개"
                );
              }

              console.log("[Content] TUI 에디터에 이미지 전달 완료");
            }
          }, 500);
        };

        // onload가 이미 발생했을 수 있으므로 즉시 체크
        if (tuiEditorIframe.contentWindow) {
          setTimeout(() => {
            if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
              // 1. 이미지 열기
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: "open-tui-editor",
                  imageUrl: imageUrl,
                },
                "*"
              );

              // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
              if (
                event.data.allDocumentImages &&
                Array.isArray(event.data.allDocumentImages) &&
                event.data.allDocumentImages.length > 0
              ) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: "set-document-images",
                    images: event.data.allDocumentImages,
                  },
                  "*"
                );
                console.log(
                  "[Content] 문서 이미지 목록 전달 완료 (즉시):",
                  event.data.allDocumentImages.length,
                  "개"
                );
              }

              console.log("[Content] TUI 에디터에 이미지 전달 완료 (즉시)");
            }
          }, 100);
        }
      } else {
        // 이미 iframe이 존재하는 경우 이미지만 교체
        console.log(
          "[Content] 기존 TUI 에디터 iframe 재사용, 이미지 전달 중..."
        );
        if (tuiEditorIframe.contentWindow) {
          // 1. 이미지 열기
          tuiEditorIframe.contentWindow.postMessage(
            {
              action: "open-tui-editor",
              imageUrl: imageUrl,
            },
            "*"
          );

          // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
          if (
            event.data.allDocumentImages &&
            Array.isArray(event.data.allDocumentImages) &&
            event.data.allDocumentImages.length > 0
          ) {
            tuiEditorIframe.contentWindow.postMessage(
              {
                action: "set-document-images",
                images: event.data.allDocumentImages,
              },
              "*"
            );
            console.log(
              "[Content] 문서 이미지 목록 전달 완료:",
              event.data.allDocumentImages.length,
              "개"
            );
          }

          console.log("[Content] TUI 에디터에 이미지 전달 완료");
        }
      }
    }
  };

  // 메시지 리스너 등록 (모든 프레임에서)
  window.addEventListener("message", contentMessageListener);
  // 디버그 모드에서만 상세 로그 출력
  if (Logger.isDebugMode()) {
    Logger.debug("✅ [Content] 전역 메시지 리스너 등록 완료");
    try {
      Logger.debug("🔍 [Content] 리스너 등록 위치:", window.location.href);
    } catch (e) {
      Logger.debug("🔍 [Content] 리스너 등록 위치: cross-origin (접근 불가)");
    }
    Logger.debug("🔍 [Content] window === window.top:", window === window.top);
  }
}

// 메시지 리스너는 모든 프레임에서 등록 (위의 if 블록 밖에서도)
// 하지만 contentMessageListener는 if 블록 안에서 정의되었으므로,
// 모든 프레임에서 사용할 수 있도록 블록 밖에서도 정의해야 함
const globalContentMessageListener = (event) => {
  // 디버깅: 모든 메시지 로깅 (디버그 모드에서만)
  if (event.data && typeof event.data === "object" && event.data.action) {
    if (Logger.isDebugMode()) {
      Logger.debug("📨 [Content] 메시지 수신 (전역):", {
        action: event.data.action,
        origin: event.origin,
        source: event.source,
        windowLocation: (() => {
          try {
            return window.location.href;
          } catch (e) {
            return "cross-origin";
          }
        })(),
        isTopWindow: window === window.top,
        sourceWindow: (() => {
          try {
            return event.source?.location?.href || "unknown";
          } catch (e) {
            return "cross-origin";
          }
        })(),
      });
    }
  }

  if (event.data && event.data.action === "cp_show_preview") {
    showRecentScrapPreview(event.data.data);
  }
  if (event.data && event.data.action === "cp_show_toast") {
    showToast(event.data.message);
  }

  // TUI 에디터 열기 요청 처리
  if (event.data && event.data.action === "cp_open_tui_editor") {
    // 디버그 모드에서만 상세 로그 출력
    if (Logger.isDebugMode()) {
      Logger.debug(
        "🏢 [Content] 📨 cp_open_tui_editor 메시지 수신! (전역 리스너)"
      );
      Logger.debug("📦 [Content] 메시지 데이터:", event.data);
      Logger.debug("🔍 [Content] 이벤트 소스:", event.source);
      Logger.debug("🔍 [Content] 이벤트 origin:", event.origin);
    }

    // currentImageUrl 또는 imageUrl 둘 다 처리 (호환성)
    const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
    if (!imageUrl) {
      console.error("[Content] TUI 에디터 열기 실패: 이미지 URL 없음");
      return;
    }

    // workspace 컨테이너 찾기
    const host = document.getElementById("content-pilot-host");
    const workspaceContainer =
      host?.shadowRoot?.querySelector(".workspace-container") ||
      document.querySelector(".workspace-container") ||
      document.querySelector(".cp-workspace-container");

    // TUI 에디터 iframe 생성 또는 재사용
    let tuiEditorIframe = document.querySelector("#tui-editor-iframe");

    if (!tuiEditorIframe) {
      console.log("🔨 [Content] TUI 에디터 iframe 생성 중...");

      // 기존 모달이 있으면 제거
      const existingOverlay = document.querySelector("#tui-editor-overlay");
      if (existingOverlay) existingOverlay.remove();

      // 배경 오버레이 생성
      const overlay = document.createElement("div");
      overlay.id = "tui-editor-overlay";
      overlay.style.cssText =
        "position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;";
      overlay.onclick = () => {
        if (confirm("편집을 종료하시겠습니까?")) {
          overlay.remove();
          if (tuiEditorIframe) tuiEditorIframe.remove();
        }
      };
      // body의 마지막에 추가하여 최상위에 위치
      document.body.appendChild(overlay);

      // 모달 컨테이너 생성
      const modalContainer = document.createElement("div");
      modalContainer.id = "tui-editor-modal-container";
      modalContainer.style.cssText =
        "position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;";
      overlay.appendChild(modalContainer);

      // 닫기 버튼 추가
      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "×";
      closeBtn.style.cssText =
        "position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;";
      closeBtn.onmouseover = () =>
        (closeBtn.style.background = "rgba(255,255,255,0.2)");
      closeBtn.onmouseout = () =>
        (closeBtn.style.background = "rgba(255,255,255,0.1)");
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm("편집을 종료하시겠습니까?")) {
          overlay.remove();
          if (tuiEditorIframe) tuiEditorIframe.remove();
        }
      };
      modalContainer.appendChild(closeBtn);

      // iframe 생성
      tuiEditorIframe = document.createElement("iframe");
      tuiEditorIframe.id = "tui-editor-iframe";
      tuiEditorIframe.src = chrome.runtime.getURL("tui-editor.html");
      tuiEditorIframe.style.cssText =
        "width:100%;height:100%;border:none;background:#282828;";
      modalContainer.appendChild(tuiEditorIframe);
      console.log("✅ [Content] TUI 에디터 iframe 생성 완료!");
      console.log("📍 [Content] iframe src:", tuiEditorIframe.src);

      // TUI 에디터에서 편집 완료 시 처리
      const sourceInfo = event.data.source || "editor";
      const editorIframe =
        workspaceContainer?.querySelector("#quill-editor-iframe") ||
        host?.shadowRoot?.querySelector("#quill-editor-iframe");

      const tuiEditorMessageHandler = function (e) {
        if (e.data?.action === "tui-editor-result" && e.data.dataUrl) {
          console.log("[Content] TUI 에디터 편집 완료, 결과 처리 중...");

          // 썸네일 메이커에서 온 경우: 에디터에 삽입
          if (
            sourceInfo === "thumbnail_maker" ||
            !event.data.allDocumentImages ||
            event.data.allDocumentImages.length === 0
          ) {
            const altText = "편집된 썸네일";
            if (editorIframe && editorIframe.contentWindow) {
              editorIframe.contentWindow.postMessage(
                {
                  action: "insert-image",
                  data: {
                    url: e.data.dataUrl,
                    alt: altText,
                  },
                },
                "*"
              );
              if (typeof showToast === "function") {
                showToast("✅ 편집된 썸네일이 본문에 삽입되었습니다!");
              }
            }
          } else {
            // 에디터에서 온 경우: 기존 이미지 교체
            if (editorIframe && editorIframe.contentWindow) {
              editorIframe.contentWindow.postMessage(
                {
                  action: "replace-edited-image",
                  data: { dataUrl: e.data.dataUrl },
                },
                "*"
              );
            }
          }

          // TUI 에디터 iframe 제거
          if (tuiEditorIframe) {
            tuiEditorIframe.remove();
          }

          // 메시지 핸들러 제거
          window.removeEventListener("message", tuiEditorMessageHandler);
        }
      };
      window.addEventListener("message", tuiEditorMessageHandler);

      // TUI 에디터 iframe이 로드되면 이미지 전달
      tuiEditorIframe.onload = () => {
        console.log("[Content] TUI 에디터 iframe 로드 완료, 이미지 전달 중...");
        setTimeout(() => {
          if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
            // 1. 이미지 열기
            tuiEditorIframe.contentWindow.postMessage(
              {
                action: "open-tui-editor",
                imageUrl: imageUrl,
              },
              "*"
            );

            // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
            if (
              event.data.allDocumentImages &&
              Array.isArray(event.data.allDocumentImages) &&
              event.data.allDocumentImages.length > 0
            ) {
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: "set-document-images",
                  images: event.data.allDocumentImages,
                },
                "*"
              );
              console.log(
                "[Content] 문서 이미지 목록 전달 완료:",
                event.data.allDocumentImages.length,
                "개"
              );
            }

            console.log("[Content] TUI 에디터에 이미지 전달 완료");
          }
        }, 500);
      };

      // onload가 이미 발생했을 수 있으므로 즉시 체크
      if (tuiEditorIframe.contentWindow) {
        setTimeout(() => {
          if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
            // 1. 이미지 열기
            tuiEditorIframe.contentWindow.postMessage(
              {
                action: "open-tui-editor",
                imageUrl: imageUrl,
              },
              "*"
            );

            // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
            if (
              event.data.allDocumentImages &&
              Array.isArray(event.data.allDocumentImages) &&
              event.data.allDocumentImages.length > 0
            ) {
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: "set-document-images",
                  images: event.data.allDocumentImages,
                },
                "*"
              );
              console.log(
                "[Content] 문서 이미지 목록 전달 완료 (즉시):",
                event.data.allDocumentImages.length,
                "개"
              );
            }

            console.log("[Content] TUI 에디터에 이미지 전달 완료 (즉시)");
          }
        }, 100);
      }
    } else {
      // 이미 iframe이 존재하는 경우 이미지만 교체
      console.log("[Content] 기존 TUI 에디터 iframe 재사용, 이미지 전달 중...");
      if (tuiEditorIframe.contentWindow) {
        // 1. 이미지 열기
        tuiEditorIframe.contentWindow.postMessage(
          {
            action: "open-tui-editor",
            imageUrl: imageUrl,
          },
          "*"
        );

        // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
        if (
          event.data.allDocumentImages &&
          Array.isArray(event.data.allDocumentImages) &&
          event.data.allDocumentImages.length > 0
        ) {
          tuiEditorIframe.contentWindow.postMessage(
            {
              action: "set-document-images",
              images: event.data.allDocumentImages,
            },
            "*"
          );
          console.log(
            "[Content] 문서 이미지 목록 전달 완료:",
            event.data.allDocumentImages.length,
            "개"
          );
        }

        console.log("[Content] TUI 에디터에 이미지 전달 완료");
      }
    }
  }
};

// 모든 프레임에서 전역 메시지 리스너 등록
window.addEventListener("message", globalContentMessageListener);
// 디버그 모드에서만 상세 로그 출력
if (Logger.isDebugMode()) {
  Logger.debug("✅ [Content] 전역 메시지 리스너 등록 완료 (모든 프레임)");
  try {
    Logger.debug("🔍 [Content] 리스너 등록 위치:", window.location.href);
  } catch (e) {
    Logger.debug("🔍 [Content] 리스너 등록 위치: cross-origin (접근 불가)");
  }
  Logger.debug("🔍 [Content] window === window.top:", window === window.top);
}

// Alt 키 토글 리스너 (최상위 프레임에서만)
if (window.self === window.top) {
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Alt") {
        if (!isPanelVisible()) {
          e.preventDefault();

          chrome.storage.local.get(
            ["isScrapingActive", "highlightToggleState"],
            (result) => {
              if (result.isScrapingActive) {
                const newState = !result.highlightToggleState;
                chrome.storage.local.set({ highlightToggleState: newState });
                showToast(
                  newState ? "✅ 하이라이트 모드 ON" : "☑️ 하이라이트 모드 OFF"
                );

                const cardBtn = document.getElementById("cp-card-float-btn");
                if (cardBtn) {
                  const cardBtnText = cardBtn.querySelector("span");
                  cardBtn.style.borderColor = newState ? "#4285F4" : "#e0e0e0";
                  cardBtn.style.boxShadow = newState
                    ? "0 4px 16px rgba(66, 133, 244, 0.35)"
                    : "0 2px 12px rgba(0,0,0,0.15)";

                  if (cardBtnText) {
                    cardBtnText.textContent = newState ? "모드 ON" : "열기";
                    cardBtnText.style.color = newState ? "#4285F4" : "#333";
                  }
                }
              }
            }
          );
        }
      }
    },
    true
  );

  console.log("✅ Content Pilot UI Initialized (Top Frame).");
}

/**
 * [테스트 함수] 확장 프로그램 컨텍스트 무효화 시뮬레이션
 * 콘솔에서 testExtensionContextInvalidation() 실행하여 confirm 다이얼로그 테스트
 *
 * 사용 방법:
 * 1. 웹 페이지에서 F12로 개발자 도구 열기
 * 2. Console 탭에서 다음 명령어 실행:
 *    testExtensionContextInvalidation()
 */
function testExtensionContextInvalidation() {
  console.log("🧪 [테스트] 확장 프로그램 컨텍스트 무효화 시뮬레이션 시작...");

  // extensionContextInvalidated와 reloadPromptShown 플래그 초기화 (테스트용)
  if (typeof window !== "undefined") {
    // 전역 변수에 접근하기 위해 임시로 플래그 리셋
    // 실제로는 content.js 스코프 내부 변수이므로,
    // 테스트를 위해 checkExtensionContext를 직접 호출하는 방식 사용

    // chrome.runtime.id 접근을 강제로 실패시키기 위해
    // 임시로 chrome.runtime을 null로 설정 (실제로는 불가능)
    // 대신 checkExtensionContext()를 호출하여 에러를 발생시키는 방식

    // 실제 테스트: checkExtensionContext()를 호출하면
    // chrome.runtime.id 접근 시도 시 에러가 발생하지 않으므로,
    // 수동으로 에러를 시뮬레이션해야 함

    // 더 나은 방법: 실제 확장 프로그램을 다시 로드하거나,
    // 또는 테스트용으로 에러를 강제 발생시키는 함수 추가

    console.warn("⚠️ 실제 컨텍스트 무효화를 시뮬레이션하려면:");
    console.log("   1. chrome://extensions 페이지로 이동");
    console.log("   2. Content Pilot 확장 프로그램의 '새로고침' 버튼 클릭");
    console.log("   3. 웹 페이지로 돌아와서 확인");
    console.log("");
    console.log("또는 수동으로 confirm 다이얼로그를 테스트하려면:");
    console.log("   testConfirmDialog() 실행");
  }
}

/**
 * [테스트 함수] confirm 다이얼로그 직접 테스트
 * 실제 컨텍스트 무효화 없이 confirm 다이얼로그만 테스트
 *
 * 사용 방법: 콘솔에서 testConfirmDialog() 실행
 */
function testConfirmDialog() {
  if (window.self !== window.top) {
    console.warn("⚠️ 최상위 프레임에서만 실행 가능합니다.");
    return;
  }

  console.log("🧪 [테스트] confirm 다이얼로그 표시 중...");
  const shouldReload = confirm(
    "⚠️ 확장 프로그램이 업데이트되었습니다.\n\n" +
      "원활한 동작을 위해 페이지를 새로고침 하시겠습니까?\n\n" +
      "⚠️ 주의: 새로고침하면 작성 중인 내용이 사라질 수 있습니다.\n" +
      "작성 중인 내용을 저장한 후 확인을 눌러주세요.\n\n" +
      "※ 취소를 선택하면 작성 중인 내용이 유지됩니다."
  );

  if (shouldReload) {
    console.log("✅ 사용자가 '확인'을 선택했습니다.");
    showToast(
      "⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!"
    );
    console.log("3초 후 페이지 새로고침 예정...");
    setTimeout(() => {
      console.log("🔄 페이지를 새로고침합니다...");
      window.location.reload();
    }, 3000);
  } else {
    console.log("❌ 사용자가 '취소'를 선택했습니다. 새로고침하지 않습니다.");
    console.log("✅ 작성 중인 내용이 유지됩니다.");
  }
}

/**
 * [테스트 함수] 확장 프로그램 컨텍스트 무효화 감지 테스트
 * chrome.runtime.id 접근을 시도하여 에러가 발생하는지 확인
 */
function testExtensionContext() {
  console.log("🧪 [테스트] 확장 프로그램 컨텍스트 상태 확인...");
  try {
    const runtimeId = chrome.runtime.id;
    console.log("✅ 확장 프로그램 컨텍스트 정상:", runtimeId);
    return true;
  } catch (error) {
    console.error("❌ 확장 프로그램 컨텍스트 무효화 감지:", error);
    console.log("이 상태에서 confirm 다이얼로그가 표시되어야 합니다.");

    // 수동으로 컨텍스트 무효화 시뮬레이션
    if (window.self === window.top) {
      console.log("수동으로 컨텍스트 무효화 처리 시작...");
      extensionContextInvalidated = false; // 플래그 리셋
      reloadPromptShown = false; // 플래그 리셋

      // checkExtensionContext 로직 직접 실행
      const showReloadPrompt = () => {
        try {
          if (document.body) {
            showToast(
              "⚠️ 확장 프로그램이 업데이트되었습니다. 작성 중인 내용을 저장해주세요."
            );
          }
        } catch (err) {
          console.error("showToast 오류:", err);
        }

        setTimeout(() => {
          const shouldReload = confirm(
            "⚠️ 확장 프로그램이 업데이트되었습니다.\n\n" +
              "원활한 동작을 위해 페이지를 새로고침 하시겠습니까?\n\n" +
              "⚠️ 주의: 새로고침하면 작성 중인 내용이 사라질 수 있습니다.\n" +
              "작성 중인 내용을 저장한 후 확인을 눌러주세요.\n\n" +
              "※ 취소를 선택하면 작성 중인 내용이 유지됩니다."
          );
          if (shouldReload) {
            console.log("✅ 사용자가 새로고침을 확인했습니다.");
            if (document.body) {
              showToast(
                "⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!"
              );
            }
            setTimeout(() => {
              window.location.reload();
            }, 3000);
          } else {
            console.log("❌ 사용자가 새로고침을 취소했습니다.");
            if (document.body) {
              showToast(
                "⚠️ 확장 프로그램이 업데이트되었습니다. 필요시 수동으로 새로고침해주세요."
              );
            }
          }
        }, 2000);
      };

      if (document.body) {
        showReloadPrompt();
      } else {
        document.addEventListener("DOMContentLoaded", showReloadPrompt);
      }
    }
    return false;
  }
}

// 전역 함수로 등록 (콘솔에서 직접 호출 가능)
if (typeof window !== "undefined" && window.self === window.top) {
  try {
    window.testConfirmDialog = testConfirmDialog;
    window.testExtensionContext = testExtensionContext;
    window.testExtensionContextInvalidation = testExtensionContextInvalidation;

    // 콘솔에서 쉽게 찾을 수 있도록 로그 출력
    console.log("🧪 [테스트 함수] 사용 가능:");
    console.log("   - testConfirmDialog() : confirm 다이얼로그 직접 테스트");
    console.log(
      "   - testExtensionContext() : 확장 프로그램 컨텍스트 상태 확인 및 시뮬레이션"
    );
    console.log("   - testExtensionContextInvalidation() : 테스트 방법 안내");
  } catch (error) {
    console.error("테스트 함수 등록 실패:", error);
  }
}
