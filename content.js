// content.js (수정 완료된 최종 버전)

// [CSP Fix] webpack publicPath를 Chrome Extension URL로 설정
// 동적 import로 생성된 청크 파일이 올바른 경로에서 로드되도록 함
// webpack이 이 변수를 인식하도록 파일 최상단에 배치
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
  // eslint-disable-next-line no-undef
  if (typeof __webpack_public_path__ !== 'undefined') {
    // eslint-disable-next-line no-undef
    __webpack_public_path__ = chrome.runtime.getURL('dist/');
  }
}

import { setupHighlighter } from "./js/core/highlighter.js";
import { createAndShowPanel, isPanelVisible } from "./js/ui/panel.js";
import { showRecentScrapPreview } from "./js/ui/preview.js";
import { showToast } from "./js/utils.js";
import { renderDashboard } from "./js/ui/dashboardMode.js";

// [PRD v3.2] Extension context 무효화 감지 (자동 새로고침 제거 - 사용자 컨펌으로 변경)
let extensionContextInvalidated = false;
let reloadPromptShown = false; // 중복 프롬프트 방지

// 확장 프로그램 컨텍스트 무효화 감지 (초기 로드 시)
// 주의: 이 부분은 웹 페이지를 새로고침할 때마다 실행되므로,
// 확장 프로그램이 실제로 무효화된 경우에만 다이얼로그를 표시해야 함
// 단순히 확장 프로그램이 비활성화된 경우는 다이얼로그를 표시하지 않음
try {
  chrome.runtime.id; // 확장 프로그램이 유효한지 체크
  console.log("[Content Pilot] 확장 프로그램 컨텍스트 정상:", chrome.runtime.id);
} catch (error) {
  // 초기 로드 시 확장 프로그램이 없거나 비활성화된 경우
  // 이는 정상적인 상황일 수 있으므로 다이얼로그를 표시하지 않음
  // (확장 프로그램이 설치되지 않았거나 비활성화된 경우)
  console.warn(
    "[Content Pilot] Extension context invalidated (초기 로드 시). 확장 프로그램이 없거나 비활성화되었습니다.",
    error
  );
  extensionContextInvalidated = true;
  // 초기 로드 시에는 다이얼로그를 표시하지 않음
  // (런타임 중 무효화된 경우에만 다이얼로그 표시)
}

// Extension context 무효화 감지 (런타임 중) - 자동 새로고침 제거, 사용자 컨펌으로 변경
const checkExtensionContext = () => {
  try {
    chrome.runtime.id;
    return true;
  } catch (error) {
    if (!extensionContextInvalidated) {
      console.warn(
        "[Content Pilot] Extension context invalidated during runtime. Please reload the page manually."
      );
      extensionContextInvalidated = true;
      // 사용자 동의를 받아 새로고침 (Fail-safe: 거부 시 새로고침하지 않음)
      if (window.self === window.top && !reloadPromptShown) {
        reloadPromptShown = true;
        console.log("[Content Pilot] 확장 프로그램 컨텍스트 무효화 감지 (런타임)");
        
        // document.body가 준비될 때까지 대기
        const showReloadPrompt = () => {
          try {
            // 경고 메시지 표시 (작성 중인 내용 저장 안내)
            if (document.body) {
              showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 작성 중인 내용을 저장해주세요.");
            } else {
              console.warn("[Content Pilot] document.body가 아직 준비되지 않았습니다.");
            }
          } catch (error) {
            console.error("[Content Pilot] showToast 오류:", error);
          }
          
          // 약간의 지연 후 confirm 표시 (사용자가 내용을 저장할 시간 제공)
          console.log("[Content Pilot] 2초 후 confirm 다이얼로그 표시 예정...");
          setTimeout(() => {
            console.log("[Content Pilot] confirm 다이얼로그 표시 중...");
            const shouldReload = confirm(
              "⚠️ 확장 프로그램이 업데이트되었습니다.\n\n" +
              "원활한 동작을 위해 페이지를 새로고침 하시겠습니까?\n\n" +
              "⚠️ 주의: 새로고침하면 작성 중인 내용이 사라질 수 있습니다.\n" +
              "작성 중인 내용을 저장한 후 확인을 눌러주세요.\n\n" +
              "※ 취소를 선택하면 작성 중인 내용이 유지됩니다."
            );
            if (shouldReload) {
              console.log("[Content Pilot] ✅ 사용자가 새로고침을 확인했습니다.");
              // 확인 후 경고 메시지 표시 및 짧은 지연 후 새로고침
              try {
                if (document.body) {
                  showToast("⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!");
                }
              } catch (error) {
                console.error("[Content Pilot] showToast 오류:", error);
              }
              console.log("[Content Pilot] 3초 후 페이지 새로고침 예정...");
              setTimeout(() => {
                console.log("[Content Pilot] 🔄 페이지를 새로고침합니다...");
                window.location.reload();
              }, 3000); // 3초 지연 (사용자가 내용 저장할 시간)
            } else {
              console.warn("[Content Pilot] ❌ 사용자가 새로고침을 취소했습니다. 일부 기능이 동작하지 않을 수 있습니다.");
              try {
                if (document.body) {
                  showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 필요시 수동으로 새로고침해주세요.");
                }
              } catch (error) {
                console.error("[Content Pilot] showToast 오류:", error);
              }
            }
          }, 2000); // 2초 지연 (사용자가 내용 저장할 시간)
        };
        
        // document.body가 준비될 때까지 대기
        if (document.body) {
          showReloadPrompt();
        } else if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', showReloadPrompt);
        } else {
          // 이미 로드 완료된 경우 즉시 실행
          setTimeout(showReloadPrompt, 100);
        }
      }
    }
    return false;
  }
};

// chrome.runtime API 호출을 래핑하여 안전하게 처리 (자동 새로고침 제거, 사용자 컨펌으로 변경)
const safeRuntimeSendMessage = (...args) => {
  if (!checkExtensionContext()) return;
  try {
    chrome.runtime.sendMessage(...args);
  } catch (error) {
    console.error("[Content Pilot] Failed to send message:", error);
    if (error.message.includes("Extension context invalidated")) {
      if (!extensionContextInvalidated) {
        extensionContextInvalidated = true;
        // 사용자 동의를 받아 새로고침 (Fail-safe: 거부 시 새로고침하지 않음)
        if (window.self === window.top && !reloadPromptShown) {
          reloadPromptShown = true;
          // 경고 메시지 표시 (작성 중인 내용 저장 안내)
          showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 작성 중인 내용을 저장해주세요.", 5000);
          
          // 약간의 지연 후 confirm 표시 (사용자가 내용을 저장할 시간 제공)
          setTimeout(() => {
            const shouldReload = confirm(
              "⚠️ 확장 프로그램이 업데이트되었습니다.\n\n" +
              "원활한 동작을 위해 페이지를 새로고침 하시겠습니까?\n\n" +
              "⚠️ 주의: 새로고침하면 작성 중인 내용이 사라질 수 있습니다.\n" +
              "작성 중인 내용을 저장한 후 확인을 눌러주세요.\n\n" +
              "※ 취소를 선택하면 작성 중인 내용이 유지됩니다."
            );
            if (shouldReload) {
              console.log("[Content Pilot] 사용자가 새로고침을 확인했습니다. 페이지를 새로고침합니다...");
              window.location.reload();
            } else {
              console.warn("[Content Pilot] 사용자가 새로고침을 취소했습니다. 일부 기능이 동작하지 않을 수 있습니다.");
              showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 필요시 수동으로 새로고침해주세요.", 5000);
            }
          }, 2000); // 2초 지연 (사용자가 내용 저장할 시간)
        }
      }
    }
  }
};

// 1. 스크랩 기능은 항상 모든 프레임에서 활성화 준비
setupHighlighter();

// 2. UI 및 상태 제어 관련 기능은 최상위 창(top frame)에서만 실행
if (window.self === window.top) {
  window.__CP_HIGHLIGHT_TOGGLE_STATE = false;
  // 페이지 로드 시간 기록 (웹 페이지를 처음 열었을 때 감지용)
  window.__cp_pageLoadTime = Date.now();

  // [추가] 확장 프로그램 연결 끊김 감지 (런타임 중 컨텍스트 무효화 감지)
  // 방법 1: chrome.runtime.connect의 onDisconnect 사용
  let extensionPort = null;
  let connectionSetupTime = null; // 연결 설정 시간 기록
  
  const setupExtensionConnection = () => {
    try {
      connectionSetupTime = Date.now(); // 연결 설정 시간 기록
      extensionPort = chrome.runtime.connect({ name: "content-script-connection" });
      
      extensionPort.onDisconnect.addListener(() => {
        const disconnectTime = Date.now();
        const timeSinceSetup = disconnectTime - connectionSetupTime;
        const timeSincePageLoad = disconnectTime - (window.__cp_pageLoadTime || Date.now());
        
        console.warn("[Content Pilot] 확장 프로그램 연결이 끊어졌습니다. (런타임 중 컨텍스트 무효화)");
        console.log("[Content Pilot] 연결 설정 후 경과 시간:", timeSinceSetup, "ms");
        console.log("[Content Pilot] 페이지 로드 후 경과 시간:", timeSincePageLoad, "ms");
        
        // 연결이 끊어진 이유 확인
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn("[Content Pilot] 연결 끊김 이유:", lastError.message);
        }
        
        // 웹 페이지를 처음 열었을 때는 다이얼로그를 표시하지 않음
        // (웹 페이지를 닫은 상태에서 확장 프로그램을 새로고침한 경우)
        if (timeSincePageLoad < 5000) {
          console.warn("[Content Pilot] 웹 페이지 초기 로드로 판단 - 다이얼로그 표시하지 않음");
          return;
        }
        
        // 웹 페이지 새로고침으로 인한 재로드인지 확인
        // 연결 설정 후 3초 이내에 끊어지면 웹 페이지 새로고침으로 인한 것일 가능성이 높음
        // (확장 프로그램 재로드는 보통 더 오래 걸림)
        if (timeSinceSetup < 3000) {
          console.warn("[Content Pilot] 웹 페이지 새로고침으로 인한 연결 끊김으로 판단 - 다이얼로그 표시하지 않음");
          return; // 웹 페이지 새로고침으로 인한 것일 가능성이 높으므로 다이얼로그 표시하지 않음
        }
        
        handleExtensionContextInvalidation();
      });
      
      console.log("[Content Pilot] 확장 프로그램 연결 모니터링 시작");
    } catch (error) {
      console.warn("[Content Pilot] chrome.runtime.connect 실패:", error);
      // 연결 실패 시 주기적으로 재시도
      setTimeout(setupExtensionConnection, 1000);
    }
  };
  
  // 초기 연결 설정
  setupExtensionConnection();
  
  // 방법 2: 주기적으로 실제 메시지 전송 시도 (백업 방법)
  // chrome.runtime.id는 재로드 후에도 접근 가능하지만, sendMessage는 실패함
  let contextCheckInterval = null;
  let lastSuccessfulPing = Date.now(); // 마지막 성공적인 핑 시간 기록
  let pageLoadTime = Date.now(); // 페이지 로드 시간 기록 (웹 페이지를 처음 열었을 때)
  let hasEstablishedConnection = false; // 연결이 한 번이라도 성공했는지 여부
  
  // 초기 연결 확인 (페이지 로드 직후)
  try {
    chrome.runtime.sendMessage({ action: "ping" }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (!lastError) {
        hasEstablishedConnection = true;
        lastSuccessfulPing = Date.now();
        console.log("[Content Pilot] 초기 연결 확인 성공");
      }
    });
  } catch (error) {
    console.warn("[Content Pilot] 초기 연결 확인 실패:", error);
  }
  
  // 2초마다 실제 메시지 전송을 시도하여 컨텍스트 유효성 확인
  contextCheckInterval = setInterval(() => {
    try {
      // 실제 메시지 전송 시도 (빈 메시지로 핑)
      chrome.runtime.sendMessage({ action: "ping" }, (response) => {
        // 응답이 없거나 에러가 발생하면 컨텍스트 무효화
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          // "Extension context invalidated" 또는 "message port closed" 에러인 경우
          if (lastError.message && (
            lastError.message.includes("Extension context invalidated") ||
            lastError.message.includes("message port closed") ||
            lastError.message.includes("Could not establish connection")
          )) {
            const timeSinceLastSuccess = Date.now() - lastSuccessfulPing;
            const timeSincePageLoad = Date.now() - pageLoadTime;
            console.warn("[Content Pilot] 확장 프로그램 컨텍스트 무효화 감지 (메시지 전송 실패):", lastError.message);
            console.log("[Content Pilot] 마지막 성공 후 경과 시간:", timeSinceLastSuccess, "ms");
            console.log("[Content Pilot] 페이지 로드 후 경과 시간:", timeSincePageLoad, "ms");
            console.log("[Content Pilot] 연결 성공 이력:", hasEstablishedConnection);
            
            // 웹 페이지를 처음 열었을 때는 다이얼로그를 표시하지 않음
            // (웹 페이지를 닫은 상태에서 확장 프로그램을 새로고침한 경우)
            if (!hasEstablishedConnection || timeSincePageLoad < 5000) {
              console.warn("[Content Pilot] 웹 페이지 초기 로드로 판단 - 다이얼로그 표시하지 않음");
              // 연결이 성공하지 않았거나 페이지 로드 후 5초 이내면 초기 로드로 판단
              return;
            }
            
            // 웹 페이지 새로고침으로 인한 재로드인지 확인
            // 마지막 성공 후 3초 이내에 실패하면 웹 페이지 새로고침으로 인한 것일 가능성이 높음
            if (timeSinceLastSuccess < 3000) {
              console.warn("[Content Pilot] 웹 페이지 새로고침으로 인한 실패로 판단 - 다이얼로그 표시하지 않음");
              return; // 웹 페이지 새로고침으로 인한 것일 가능성이 높으므로 다이얼로그 표시하지 않음
            }
            
            if (contextCheckInterval) {
              clearInterval(contextCheckInterval);
              contextCheckInterval = null;
            }
            handleExtensionContextInvalidation();
          }
        } else {
          // 성공적인 응답
          hasEstablishedConnection = true;
          lastSuccessfulPing = Date.now();
        }
      });
    } catch (error) {
      // sendMessage 자체가 실패하면 컨텍스트 무효화
      if (error.message && (
        error.message.includes("Extension context invalidated") ||
        error.message.includes("message port closed")
      )) {
        const timeSinceLastSuccess = Date.now() - lastSuccessfulPing;
        const timeSincePageLoad = Date.now() - pageLoadTime;
        console.warn("[Content Pilot] 확장 프로그램 컨텍스트 무효화 감지 (예외):", error.message);
        console.log("[Content Pilot] 마지막 성공 후 경과 시간:", timeSinceLastSuccess, "ms");
        console.log("[Content Pilot] 페이지 로드 후 경과 시간:", timeSincePageLoad, "ms");
        console.log("[Content Pilot] 연결 성공 이력:", hasEstablishedConnection);
        
        // 웹 페이지를 처음 열었을 때는 다이얼로그를 표시하지 않음
        if (!hasEstablishedConnection || timeSincePageLoad < 5000) {
          console.warn("[Content Pilot] 웹 페이지 초기 로드로 판단 - 다이얼로그 표시하지 않음");
          return;
        }
        
        // 웹 페이지 새로고침으로 인한 재로드인지 확인
        if (timeSinceLastSuccess < 3000) {
          console.warn("[Content Pilot] 웹 페이지 새로고침으로 인한 실패로 판단 - 다이얼로그 표시하지 않음");
          return;
        }
        
        if (contextCheckInterval) {
          clearInterval(contextCheckInterval);
          contextCheckInterval = null;
        }
        handleExtensionContextInvalidation();
      }
    }
  }, 2000); // 2초마다 체크
  
  // 확장 프로그램 컨텍스트 무효화 처리 함수
  function handleExtensionContextInvalidation() {
    console.log("[Content Pilot] handleExtensionContextInvalidation 호출됨");
    console.log("[Content Pilot] extensionContextInvalidated:", extensionContextInvalidated);
    console.log("[Content Pilot] reloadPromptShown:", reloadPromptShown);
    
    if (extensionContextInvalidated || reloadPromptShown) {
      console.warn("[Content Pilot] 이미 처리됨 - 함수 종료");
      return; // 이미 처리됨
    }
    
    extensionContextInvalidated = true;
    reloadPromptShown = true;
    console.log("[Content Pilot] 플래그 설정 완료");
    
    const showReloadPrompt = () => {
      console.log("[Content Pilot] showReloadPrompt 실행 중...");
      try {
        if (document.body) {
          console.log("[Content Pilot] 토스트 메시지 표시 중...");
          showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 작성 중인 내용을 저장해주세요.");
        } else {
          console.warn("[Content Pilot] document.body가 없음");
        }
      } catch (error) {
        console.error("[Content Pilot] showToast 오류:", error);
      }
      
      console.log("[Content Pilot] 2초 후 confirm 다이얼로그 표시 예정...");
      setTimeout(() => {
        console.log("[Content Pilot] confirm 다이얼로그 표시 중...");
        const shouldReload = confirm(
          "⚠️ 확장 프로그램이 업데이트되었습니다.\n\n" +
          "원활한 동작을 위해 페이지를 새로고침 하시겠습니까?\n\n" +
          "⚠️ 주의: 새로고침하면 작성 중인 내용이 사라질 수 있습니다.\n" +
          "작성 중인 내용을 저장한 후 확인을 눌러주세요.\n\n" +
          "※ 취소를 선택하면 작성 중인 내용이 유지됩니다."
        );
        console.log("[Content Pilot] 사용자 선택:", shouldReload);
        if (shouldReload) {
          console.log("[Content Pilot] ✅ 사용자가 새로고침을 확인했습니다.");
          try {
            if (document.body) {
              showToast("⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!");
            }
          } catch (error) {
            console.error("[Content Pilot] showToast 오류:", error);
          }
          setTimeout(() => {
            console.log("[Content Pilot] 🔄 페이지를 새로고침합니다...");
            window.location.reload();
          }, 3000);
        } else {
          console.warn("[Content Pilot] ❌ 사용자가 새로고침을 취소했습니다.");
          try {
            if (document.body) {
              showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 필요시 수동으로 새로고침해주세요.");
            }
          } catch (error) {
            console.error("[Content Pilot] showToast 오류:", error);
          }
        }
      }, 2000);
    };
    
    console.log("[Content Pilot] document.body 상태 확인 중...");
    console.log("[Content Pilot] document.body:", document.body ? "존재" : "없음");
    console.log("[Content Pilot] document.readyState:", document.readyState);
    
    if (document.body) {
      console.log("[Content Pilot] document.body 존재 - 즉시 실행");
      showReloadPrompt();
    } else if (document.readyState === 'loading') {
      console.log("[Content Pilot] DOMContentLoaded 이벤트 대기 중...");
      document.addEventListener('DOMContentLoaded', showReloadPrompt);
    } else {
      console.log("[Content Pilot] 100ms 후 실행");
      setTimeout(showReloadPrompt, 100);
    }
  }

  // background.js로부터의 메시지 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (!checkExtensionContext()) return;

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
  window.addEventListener("message", (event) => {
    if (event.data && event.data.action === "cp_show_preview") {
      showRecentScrapPreview(event.data.data);
    }
    if (event.data && event.data.action === "cp_show_toast") {
      showToast(event.data.message);
    }
  });

  // Alt 키 토글 리스너
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
  if (typeof window !== 'undefined') {
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
    showToast("⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!");
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
            showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 작성 중인 내용을 저장해주세요.");
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
              showToast("⚠️ 3초 후 페이지가 새로고침됩니다. 작성 중인 내용을 저장하세요!");
            }
            setTimeout(() => {
              window.location.reload();
            }, 3000);
          } else {
            console.log("❌ 사용자가 새로고침을 취소했습니다.");
            if (document.body) {
              showToast("⚠️ 확장 프로그램이 업데이트되었습니다. 필요시 수동으로 새로고침해주세요.");
            }
          }
        }, 2000);
      };
      
      if (document.body) {
        showReloadPrompt();
      } else {
        document.addEventListener('DOMContentLoaded', showReloadPrompt);
      }
    }
    return false;
  }
}

// 전역 함수로 등록 (콘솔에서 직접 호출 가능)
if (typeof window !== 'undefined' && window.self === window.top) {
  try {
    window.testConfirmDialog = testConfirmDialog;
    window.testExtensionContext = testExtensionContext;
    window.testExtensionContextInvalidation = testExtensionContextInvalidation;
    
    // 콘솔에서 쉽게 찾을 수 있도록 로그 출력
    console.log("🧪 [테스트 함수] 사용 가능:");
    console.log("   - testConfirmDialog() : confirm 다이얼로그 직접 테스트");
    console.log("   - testExtensionContext() : 확장 프로그램 컨텍스트 상태 확인 및 시뮬레이션");
    console.log("   - testExtensionContextInvalidation() : 테스트 방법 안내");
  } catch (error) {
    console.error("테스트 함수 등록 실패:", error);
  }
}
