// js/ui/panel.js (워크스페이스 연동 로직 최종 적용)

import {
  initDashboardMode,
  addDashboardEventListeners,
  renderDashboard,
  destroyDashboardMode,
} from './dashboardMode.js';
import { renderHeaderAndTabs, addHeaderEventListeners } from './header.js';
import { renderScrapbook, destroyScrapbookMode } from './scrapbookMode.js';
import { renderChannelMode } from './channelMode.js';
import { renderKanban, addKanbanEventListeners, destroyKanbanMode } from './kanbanMode.js';
import { renderWorkspace } from './workspaceMode.js';
import { renderPerformanceDashboard } from './performanceDashboardMode.js';
import { renderPerformanceReport } from './performanceReportMode.js';
import { renderPublishManagement } from './publishManagementMode.js';
import { renderAdminMode } from './adminMode.js';
import { Logger } from '../utils.js';

// 전역 TUI 에디터 리스너 강제 등록 (workspaceMode.js가 로드되기 전에도 작동)
import './workspaceMode.js';

export function isPanelVisible() {
  const host = document.getElementById('content-pilot-host');
  return host && host.style.display !== 'none';
}

export function createAndShowPanel() {
  let host = document.getElementById('content-pilot-host');
  if (host) {
    host.style.display = 'block';
    const mainArea = host.shadowRoot.querySelector('#cp-main-area');
    if (window.__cp_active_mode === 'dashboard' && mainArea) {
      initDashboardMode(mainArea);
    }
  } else {
    // --- 패널 최초 생성 로직 ---
    host = document.createElement('div');
    host.id = 'content-pilot-host';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'stylesheet';
    googleFontsLink.href =
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    shadowRoot.appendChild(googleFontsLink);

    // 1. 기본 스타일(style.css) 링크
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('css/style.css');
    shadowRoot.appendChild(styleLink);

    // 2. 워크스페이스 스타일(workspace.css) 링크 추가
    const workspaceStyleLink = document.createElement('link');
    workspaceStyleLink.rel = 'stylesheet';
    workspaceStyleLink.href = chrome.runtime.getURL('css/workspace.css');
    shadowRoot.appendChild(workspaceStyleLink);

    // 3. 칸반 보드 스타일(kanban.css) 링크 추가
    const kanbanStyleLink = document.createElement('link');
    kanbanStyleLink.rel = 'stylesheet';
    kanbanStyleLink.href = chrome.runtime.getURL('css/kanban.css');
    shadowRoot.appendChild(kanbanStyleLink);

    const panel = document.createElement('div');
    panel.id = 'content-pilot-panel';
    panel.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background-color: rgba(0, 0, 0, 0.4); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font-family: "Noto Sans KR", "Roboto", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
    `;

    const panelContent = document.createElement('div');
    panelContent.id = 'cp-panel-content-wrapper';
    panelContent.style.cssText = `
      width: 90%; height: 90%; max-width: 1400px; max-height: 900px;
      background: #f7f8fa; border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      display: flex; flex-direction: column; overflow: hidden;
    `;
    const headerArea = document.createElement('div');
    headerArea.id = 'cp-header-area';
    const mainArea = document.createElement('div');
    mainArea.id = 'cp-main-area';
    mainArea.style.flex = '1';
    mainArea.style.minHeight = '0';
    mainArea.style.overflowY = 'auto';

    panelContent.appendChild(headerArea);
    panelContent.appendChild(mainArea);
    panel.appendChild(panelContent);
    shadowRoot.appendChild(panel);

    window.__cp_active_mode = 'dashboard';

    // TUI 에디터 메시지 리스너 등록 (Shadow DOM 내부에서도 작동)
    if (!window.__cp_tui_panel_listener_attached) {
      const tuiEditorPanelListener = (event) => {
        if (event.data?.action === 'cp_open_tui_editor') {
          console.log('[Panel] ✅ cp_open_tui_editor 메시지 수신!', event.data);

          // currentImageUrl 또는 imageUrl 둘 다 처리 (호환성)
          const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
          if (!imageUrl) {
            console.error('[Panel] TUI 에디터 열기 실패: 이미지 URL 없음');
            return;
          }

          // workspace 컨테이너 찾기
          const workspaceContainer =
            shadowRoot.querySelector('.workspace-container') ||
            document.querySelector('.workspace-container');

          // TUI 에디터 iframe 생성 또는 재사용
          let tuiEditorIframe = document.querySelector('#tui-editor-iframe');

          if (!tuiEditorIframe) {
            console.log('[Panel] TUI 에디터 iframe 생성 중...');

            // 기존 모달이 있으면 제거
            const existingOverlay = document.querySelector('#tui-editor-overlay');
            if (existingOverlay) existingOverlay.remove();

            // 배경 오버레이 생성
            const overlay = document.createElement('div');
            overlay.id = 'tui-editor-overlay';
            overlay.style.cssText =
              'position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;';
            overlay.onclick = () => {
              if (confirm('편집을 종료하시겠습니까?')) {
                overlay.remove();
                if (tuiEditorIframe) tuiEditorIframe.remove();
              }
            };
            // body의 마지막에 추가하여 최상위에 위치
            document.body.appendChild(overlay);

            // 모달 컨테이너 생성
            const modalContainer = document.createElement('div');
            modalContainer.id = 'tui-editor-modal-container';
            modalContainer.style.cssText =
              'position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;';
            overlay.appendChild(modalContainer);

            // 닫기 버튼 추가
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.cssText =
              'position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;';
            closeBtn.onmouseover = () => (closeBtn.style.background = 'rgba(255,255,255,0.2)');
            closeBtn.onmouseout = () => (closeBtn.style.background = 'rgba(255,255,255,0.1)');
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              if (confirm('편집을 종료하시겠습니까?')) {
                overlay.remove();
                if (tuiEditorIframe) tuiEditorIframe.remove();
              }
            };
            modalContainer.appendChild(closeBtn);

            // iframe 생성
            tuiEditorIframe = document.createElement('iframe');
            tuiEditorIframe.id = 'tui-editor-iframe';
            tuiEditorIframe.src = chrome.runtime.getURL('tui-editor.html');
            tuiEditorIframe.style.cssText =
              'width:100%;height:100%;border:none;background:#282828;';
            modalContainer.appendChild(tuiEditorIframe);
            console.log('[Panel] TUI 에디터 iframe 생성 완료');

            // TUI 에디터에서 편집 완료 시 처리
            const sourceInfo = event.data.source || 'editor';
            const editorIframe = workspaceContainer?.querySelector('#editor-iframe');

            const tuiEditorMessageHandler = function (e) {
              if (e.data?.action === 'tui-editor-result' && e.data.dataUrl) {
                console.log('[Panel] TUI 에디터 편집 완료, 결과 처리 중...');

                // 썸네일 메이커에서 온 경우: 에디터에 삽입
                if (
                  sourceInfo === 'thumbnail_maker' ||
                  !event.data.allDocumentImages ||
                  event.data.allDocumentImages.length === 0
                ) {
                  const altText = '편집된 썸네일';
                  if (editorIframe && editorIframe.contentWindow) {
                    editorIframe.contentWindow.postMessage(
                      {
                        action: 'insert-image',
                        data: {
                          url: e.data.dataUrl,
                          alt: altText,
                        },
                      },
                      '*'
                    );
                    import('../utils.js').then((utils) => {
                      utils.showToast('✅ 편집된 썸네일이 본문에 삽입되었습니다!');
                    });
                  }
                } else {
                  // 에디터에서 온 경우: 기존 이미지 교체
                  if (editorIframe && editorIframe.contentWindow) {
                    editorIframe.contentWindow.postMessage(
                      {
                        action: 'replace-edited-image',
                        data: { dataUrl: e.data.dataUrl },
                      },
                      '*'
                    );
                  }
                }

                // TUI 에디터 iframe 제거
                if (tuiEditorIframe) {
                  tuiEditorIframe.remove();
                }

                // 메시지 핸들러 제거
                window.removeEventListener('message', tuiEditorMessageHandler);
              }
            };
            window.addEventListener('message', tuiEditorMessageHandler);

            // TUI 에디터 iframe이 로드되면 이미지 전달
            tuiEditorIframe.onload = () => {
              console.log('[Panel] TUI 에디터 iframe 로드 완료, 이미지 전달 중...');
              setTimeout(() => {
                if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
                  // 1. 이미지 열기
                  tuiEditorIframe.contentWindow.postMessage(
                    {
                      action: 'open-tui-editor',
                      imageUrl: imageUrl,
                    },
                    '*'
                  );

                  // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
                  if (
                    event.data.allDocumentImages &&
                    Array.isArray(event.data.allDocumentImages) &&
                    event.data.allDocumentImages.length > 0
                  ) {
                    tuiEditorIframe.contentWindow.postMessage(
                      {
                        action: 'set-document-images',
                        images: event.data.allDocumentImages,
                      },
                      '*'
                    );
                    console.log(
                      '[Panel] 문서 이미지 목록 전달 완료:',
                      event.data.allDocumentImages.length,
                      '개'
                    );
                  }

                  console.log('[Panel] TUI 에디터에 이미지 전달 완료');
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
                      action: 'open-tui-editor',
                      imageUrl: imageUrl,
                    },
                    '*'
                  );

                  // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
                  if (
                    event.data.allDocumentImages &&
                    Array.isArray(event.data.allDocumentImages) &&
                    event.data.allDocumentImages.length > 0
                  ) {
                    tuiEditorIframe.contentWindow.postMessage(
                      {
                        action: 'set-document-images',
                        images: event.data.allDocumentImages,
                      },
                      '*'
                    );
                    console.log(
                      '[Panel] 문서 이미지 목록 전달 완료 (즉시):',
                      event.data.allDocumentImages.length,
                      '개'
                    );
                  }

                  console.log('[Panel] TUI 에디터에 이미지 전달 완료 (즉시)');
                }
              }, 100);
            }
          } else {
            // 이미 iframe이 존재하는 경우 이미지만 교체
            console.log('[Panel] 기존 TUI 에디터 iframe 재사용, 이미지 전달 중...');
            if (tuiEditorIframe.contentWindow) {
              // 1. 이미지 열기
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: 'open-tui-editor',
                  imageUrl: imageUrl,
                },
                '*'
              );

              // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
              if (
                event.data.allDocumentImages &&
                Array.isArray(event.data.allDocumentImages) &&
                event.data.allDocumentImages.length > 0
              ) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'set-document-images',
                    images: event.data.allDocumentImages,
                  },
                  '*'
                );
                console.log(
                  '[Panel] 문서 이미지 목록 전달 완료:',
                  event.data.allDocumentImages.length,
                  '개'
                );
              }

              console.log('[Panel] TUI 에디터에 이미지 전달 완료');
            }
          }
        }
      };

      window.addEventListener('message', tuiEditorPanelListener);
      window.__cp_tui_panel_listener_attached = true;
      console.log('[Panel] TUI 에디터 메시지 리스너 등록 완료');
    }

    renderHeaderAndTabs(shadowRoot);
    addEventListenersToPanel(shadowRoot);

    // [Performance Fix] 에러 메시지 리스너 등록 (확장 프로그램 UI에서 직접 수신)
    // chrome.runtime.onMessage를 사용하여 background.js나 analyticsService.js에서 전송된 에러를 수신
    if (!window.__cp_error_listener_attached) {
      chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
        if (msg.action === 'show_error_toast') {
          // Shadow DOM 내부에서 showToast 함수 사용
          import('../utils.js')
            .then((utils) => {
              const icon = msg.icon || '⚠️';
              const message = msg.message || '오류가 발생했습니다.';
              utils.showToast(`${icon} ${message}`);
            })
            .catch((err) => {
              console.error('[Panel] 에러 토스트 표시 실패:', err);
            });
        }
      });
      window.__cp_error_listener_attached = true;
      console.log('[Panel] 에러 메시지 리스너 등록 완료');
    }

    // [수정] 초기 로드 로직 (온보딩 체크 + 마이그레이션 확인)
    chrome.storage.local.get(['activeChannelId'], (res) => {
      // 1. 활성 채널 ID가 있으면 -> 채널이 실제로 존재하는지 확인
      if (res.activeChannelId) {
        // 채널 목록을 확인하여 activeChannelId가 유효한지 검증
        chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
          console.log('[Panel] activeChannelId 검증, get_channels_and_key 응답:', response);
          const myBlogs = response?.data?.myChannels?.blogs || [];
          console.log('[Panel] 채널 개수:', myBlogs.length);

          // activeChannelId가 실제 채널 목록에 있는지 확인
          const generateChannelId = (channel) => {
            if (channel.id) return channel.id;
            if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, '');
            if (channel.url) return btoa(channel.url).replace(/=/g, '');
            return null;
          };

          const isValidChannel = myBlogs.some((blog) => {
            const channelId = generateChannelId(blog);
            return channelId && channelId === res.activeChannelId;
          });

          if (isValidChannel && myBlogs.length > 0) {
            // 유효한 채널이 있으면 대시보드로 진입
            console.log('[Panel] 유효한 activeChannelId 확인, 대시보드 표시');
            renderDashboard(mainArea);
            addDashboardEventListeners(mainArea);

            // 헤더 이벤트 리스너 초기화 (채널 선택기 등)
            import('./header.js').then((module) => {
              module.addHeaderEventListeners(shadowRoot);
            });
          } else {
            // 유효하지 않은 activeChannelId이거나 채널이 없으면 초기화하고 채널 관리 화면으로 이동
            console.log(
              '[Panel] 유효하지 않은 activeChannelId 또는 채널 없음, activeChannelId 초기화'
            );
            chrome.storage.local.remove('activeChannelId', () => {
              // 채널 관리 화면으로 이동
              const navItems = shadowRoot.querySelectorAll('.cp-mode-tab');
              navItems.forEach((item) => item.classList.remove('active'));

              console.log('[Panel] renderChannelMode 호출 시작');
              renderChannelMode(mainArea);
              console.log('[Panel] renderChannelMode 호출 완료');
              showOnboardingMessage(mainArea);
            });
          }
        });
        return;
      }

      // 2. 활성 채널 ID가 없으면 -> 채널 목록 확인 (비동기)
      chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
        console.log('[Panel] get_channels_and_key 응답:', response);
        const myBlogs = response?.data?.myChannels?.blogs || [];
        console.log('[Panel] 채널 개수:', myBlogs.length, '채널 목록:', myBlogs);

        if (myBlogs.length > 0) {
          // 2-A. 채널은 있는데 선택이 안 된 경우 -> 첫 번째 채널 자동 선택 후 대시보드 이동
          console.log('[Panel] 채널이 있음, 대시보드 표시');
          const generateChannelId = (channel) => {
            if (channel.id) return channel.id;
            if (channel.apiUrl) return btoa(channel.apiUrl).replace(/=/g, '');
            if (channel.url) return btoa(channel.url).replace(/=/g, '');
            return null;
          };
          const firstId = generateChannelId(myBlogs[0]);
          if (!firstId) {
            console.error('[Panel] 첫 번째 채널의 ID를 생성할 수 없습니다:', myBlogs[0]);
            return;
          }
          chrome.storage.local.set({ activeChannelId: firstId }, () => {
            renderDashboard(mainArea);
            addDashboardEventListeners(mainArea);

            // 헤더 이벤트 리스너 초기화 (채널 선택기 등)
            import('./header.js').then((module) => {
              module.addHeaderEventListeners(shadowRoot);
            });
          });
        } else {
          // 2-B. 채널이 하나도 없는 '찐' 신규 사용자 -> '채널 관리' 화면 강제 표시
          console.log('[Panel] 신규 사용자 감지: 채널 관리 화면으로 이동');

          // 탭 UI 선택 해제
          const navItems = shadowRoot.querySelectorAll('.cp-mode-tab');
          navItems.forEach((item) => item.classList.remove('active'));

          // 채널 모드 로드 및 온보딩 메시지 표시
          console.log('[Panel] renderChannelMode 호출 시작');
          renderChannelMode(mainArea);
          console.log('[Panel] renderChannelMode 호출 완료');
          showOnboardingMessage(mainArea);
        }
      });
    });

    // [체크리스트 2-🅱️] 마이그레이션 완료 토스트 메시지 처리
    // migration_toast_message listener removed - migration feature has been deleted

    // [체크리스트 1] 글로벌 채널 변경 감지 -> 현재 탭 새로고침
    chrome.storage.onChanged.addListener((changes, namespace) => {
      // [체크리스트 1-2] 조건 확인: 로컬 스토리지의 activeChannelId만 감지
      if (namespace === 'local' && changes.activeChannelId) {
        // [체크리스트 1-3] 로그 출력
        console.log('[Panel] 채널 변경 감지 -> 패널 초기화 시작', {
          oldValue: changes.activeChannelId.oldValue,
          newValue: changes.activeChannelId.newValue,
        });

        // mainArea 참조 다시 가져오기 (Shadow DOM 내부)
        const host = document.getElementById('content-pilot-host');
        if (!host || !host.shadowRoot) {
          console.warn('[Panel] Shadow DOM을 찾을 수 없습니다.');
          return;
        }

        const mainArea = host.shadowRoot.querySelector('#cp-main-area');
        if (!mainArea) {
          console.warn('[Panel] mainArea를 찾을 수 없습니다.');
          return;
        }

        // [체크리스트 2-1] 현재 활성화된 탭 찾기
        const activeTabBtn = host.shadowRoot.querySelector('.cp-mode-tab.active');
        if (!activeTabBtn) {
          console.warn('[Panel] 활성 탭을 찾을 수 없습니다. 초기 로딩 중일 수 있습니다.');
          return;
        }

        // [체크리스트 2-3] 탭 이름 추출
        const tabName = activeTabBtn.dataset.key;
        Logger.debug(`[Panel] 현재 활성 탭: ${tabName}`);

        // [UI 모듈 독립성 강화] 채널 변경 시에도 이전 모드 정리
        if (tabName) {
          Logger.debug(
            `[Panel] 채널 변경으로 인한 모드 리렌더링: ${tabName}, 이전 모드 정리 중...`
          );

          try {
            // 이전 모드의 destroy 함수 호출
            if (tabName === 'dashboard') {
              destroyDashboardMode();
            } else if (tabName === 'scrapbook') {
              destroyScrapbookMode();
            } else if (tabName === 'kanban') {
              destroyKanbanMode();
            }
          } catch (error) {
            Logger.error(`[Panel] 이전 모드(${tabName}) 정리 실패:`, error);
          }
        }

        // [체크리스트 4-1] 로딩 표시 추가
        mainArea.style.opacity = '0.6';
        mainArea.style.transition = 'opacity 0.3s';
        mainArea.classList.add('channel-switching');

        // 탭별 새로고침 로직
        const renderPromise = (() => {
          if (tabName === 'kanban') {
            // [체크리스트 3-2] 기획 보드 리렌더링
            return import('./kanbanMode.js').then((module) => {
              module.renderKanban(mainArea);
              module.addKanbanEventListeners(mainArea);
            });
          } else if (tabName === 'dashboard') {
            // [체크리스트 3-1] 대시보드 리렌더링
            return import('./dashboardMode.js').then((module) => {
              module.renderDashboard(mainArea);
              module.addDashboardEventListeners(mainArea);
            });
          } else if (tabName === 'scrapbook') {
            // [체크리스트 3-3] 스크랩북 리렌더링
            return import('./scrapbookMode.js').then((module) => {
              module.renderScrapbook(mainArea);
            });
          } else if (tabName === 'performance') {
            // [체크리스트 3-4] 성과 대시보드 리렌더링
            return import('./performanceDashboardMode.js').then((module) => {
              module.renderPerformanceDashboard(mainArea);
            });
          } else if (tabName === 'report') {
            // [체크리스트 3-5] 성과 리포트 리렌더링
            return import('./performanceReportMode.js').then((module) => {
              module.renderPerformanceReport(mainArea);
            });
          } else if (tabName === 'workspace') {
            // [체크리스트 3-6 중요] 워크스페이스: 에디터 보호, 자료만 갱신
            const currentIdeaId = mainArea.querySelector('.cp-workspace-container')?.dataset.ideaId;
            if (currentIdeaId) {
              return chrome.runtime
                .sendMessage({ action: 'get_idea_data', ideaId: currentIdeaId })
                .then((response) => {
                  if (response && response.success) {
                    return import('./workspaceMode.js').then((module) => {
                      module.updateWorkspaceScraps(mainArea, response.data);
                    });
                  }
                });
            }
            return Promise.resolve();
          }
          return Promise.resolve();
        })();

        // [체크리스트 4-2] 완료 처리: 로딩 표시 제거
        renderPromise
          .then(() => {
            setTimeout(() => {
              mainArea.style.opacity = '1';
              mainArea.classList.remove('channel-switching');
              console.log(`[Panel] ${tabName} 탭 리렌더링 완료`);
            }, 100);
          })
          .catch((error) => {
            console.error('[Panel] 리렌더링 중 오류:', error);
            mainArea.style.opacity = '1';
            mainArea.classList.remove('channel-switching');
          });
      }
    });
  }

  chrome.storage.local.set({
    isScrapingActive: true,
    highlightToggleState: false,
  });
}

export function closePanel() {
  const host = document.getElementById('content-pilot-host');
  if (host) host.style.display = 'none';
  chrome.storage.local.set({
    isScrapingActive: false,
    highlightToggleState: false,
  });
}

export function minimizePanelToCard() {
  const host = document.getElementById('content-pilot-host');
  if (host) host.style.display = 'none';
  showCardFloatingButton();
  chrome.storage.local.set({
    isScrapingActive: true,
    highlightToggleState: false,
  });
}

export function hidePanelForScrap() {
  const host = document.getElementById('content-pilot-host');
  if (host && host.style.display !== 'none') {
    host.style.display = 'none';
    return true;
  }
  return false;
}

export function restorePanelAfterScrap(wasVisible) {
  if (wasVisible) {
    const host = document.getElementById('content-pilot-host');
    if (host) {
      host.style.display = 'block';
    }
  }
}

// renderHeaderAndTabs는 header.js에서 import하여 사용

function addEventListenersToPanel(shadowRoot) {
  const mainArea = shadowRoot.querySelector('#cp-main-area');
  const panelContent = shadowRoot.querySelector('#cp-panel-content-wrapper');

  // 이벤트 위임을 사용하여 패널 전체의 클릭 이벤트를 효율적으로 관리합니다.
  panelContent.addEventListener('click', (e) => {
    const target = e.target;

    if (target.closest('#cp-back-to-dashboard')) {
      window.__cp_active_mode = 'kanban';
      renderHeaderAndTabs(shadowRoot);
      renderKanban(mainArea);
      addKanbanEventListeners(mainArea);
      return;
    }

    // --- 기존 헤더 버튼 및 탭 클릭 로직 ---

    if (target.closest('#cp-panel-close')) {
      closePanel();
      return;
    }

    if (target.closest('#cp-panel-fullscreen-exit')) {
      minimizePanelToCard();
      return;
    }

    const tab = target.closest('.cp-mode-tab');
    if (tab) {
      const activeKey = tab.dataset.key;
      if (window.__cp_active_mode === activeKey) return;

      // [UI 모듈 독립성 강화] 이전 모드 정리
      const previousMode = window.__cp_active_mode;
      if (previousMode) {
        Logger.debug(`[Panel] 모드 전환: ${previousMode} → ${activeKey}, 이전 모드 정리 중...`);

        try {
          // 이전 모드의 destroy 함수 호출
          if (previousMode === 'dashboard') {
            destroyDashboardMode();
          } else if (previousMode === 'scrapbook') {
            destroyScrapbookMode();
          } else if (previousMode === 'kanban') {
            destroyKanbanMode();
          }
          // 다른 모드들은 아직 destroy 함수가 없을 수 있음
        } catch (error) {
          Logger.error(`[Panel] 이전 모드(${previousMode}) 정리 실패:`, error);
        }
      }

      // [체크리스트 3-🅰️] 채널 없을 때 강제 이동 (채널 관리 탭 제외)
      if (activeKey !== 'admin') {
        chrome.storage.local.get('activeChannelId', (res) => {
          const activeChannelId = res.activeChannelId;

          if (!activeChannelId) {
            // 채널 목록 확인
            chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (channelResponse) => {
              const myBlogs = channelResponse?.data?.myChannels?.blogs || [];

              if (myBlogs.length === 0) {
                // [체크리스트 3-🅰️] 채널이 없으면 채널 관리 화면으로 강제 이동
                e.preventDefault();
                e.stopPropagation();

                // 탭 UI 선택 해제
                shadowRoot
                  .querySelectorAll('.cp-mode-tab')
                  .forEach((item) => item.classList.remove('active'));

                // 채널 모드 로드 및 온보딩 메시지 표시
                import('./channelMode.js').then((module) => {
                  module.renderChannelMode(mainArea);
                });

                // 온보딩 메시지 표시
                showOnboardingMessage(mainArea);

                // 경고 메시지
                import('../utils.js').then((utils) => {
                  utils.showToast('⚠️ 채널을 먼저 추가해주세요.');
                });

                return;
              }
            });
          }
        });
      }

      window.__cp_active_mode = activeKey;
      renderHeaderAndTabs(shadowRoot);

      if (activeKey === 'dashboard') {
        renderDashboard(mainArea);
      } else if (activeKey === 'scrapbook') {
        renderScrapbook(mainArea);
      } else if (activeKey === 'kanban') {
        renderKanban(mainArea);
        addKanbanEventListeners(mainArea);
      } else if (activeKey === 'performance') {
        renderPerformanceDashboard(mainArea);
      } else if (activeKey === 'report') {
        renderPerformanceReport(mainArea);
      } else if (activeKey === 'publish') {
        renderPublishManagement(mainArea);
      } else {
        mainArea.innerHTML = `<h1 style="text-align:center; margin-top: 50px;">${tab.textContent} 모드는 구현 예정입니다.</h1>`;
      }
    }
  });
}

// 좌하단 카드 버튼 표시 함수
function showCardFloatingButton() {
  if (document.getElementById('cp-dock-container')) return;

  const container = document.createElement('div');
  container.id = 'cp-dock-container';
  container.style.cssText = `
    position: fixed; left: 0; bottom: 36px;
    z-index: 2147483648; display: flex; align-items: center;
  `;

  const cardBtn = document.createElement('button');
  cardBtn.id = 'cp-card-float-btn';
  cardBtn.style.cssText = `
    height: 72px; width: 72px; background: #f8f9fa;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #e9ecef;
    border-left: none; border-radius: 0; display: flex;
    align-items: center; justify-content: center; cursor: pointer;
    transition: all 0.2s ease-in-out; z-index: 2;
  `;
  const iconUrl = chrome.runtime.getURL('images/icon-48.png');
  cardBtn.innerHTML = `<img src="${iconUrl}" alt="Content Pilot" style="width: 32px; height: 32px; pointer-events: none; opacity: 0.65;">`;
  const iconImg = cardBtn.querySelector('img');

  cardBtn.onmouseover = () => {
    cardBtn.style.background = '#ffffff';
    cardBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    if (iconImg) iconImg.style.opacity = '1';
  };
  cardBtn.onmouseout = () => {
    cardBtn.style.background = '#f8f9fa';
    cardBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    if (iconImg) iconImg.style.opacity = '0.65';
  };

  cardBtn.onclick = () => {
    createAndShowPanel();
    container.remove();
  };

  container.appendChild(cardBtn);
  document.body.appendChild(container);
}

// 신규 사용자 온보딩 메시지 표시
function showOnboardingMessage(container) {
  const onboardingBanner = document.createElement('div');
  onboardingBanner.style.cssText = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px 24px;
    border-radius: 8px;
    margin: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  `;
  onboardingBanner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 16px;">
      <div style="font-size: 48px;">👋</div>
      <div style="flex: 1;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">
          Content Pilot에 오신 것을 환영합니다!
        </h3>
        <p style="margin: 0; font-size: 14px; opacity: 0.95; line-height: 1.5;">
          먼저 <strong>'+ 채널 추가'</strong> 버튼을 클릭하여 블로그 채널을 등록해주세요.<br>
          채널을 등록하면 콘텐츠 아이디어 관리와 성과 추적을 시작할 수 있습니다.
        </p>
      </div>
    </div>
  `;

  // 채널 설정 컨테이너의 맨 위에 삽입
  const channelContainer = container.querySelector('.channel-settings-container');
  if (channelContainer) {
    channelContainer.insertBefore(onboardingBanner, channelContainer.firstChild);
  } else {
    container.insertBefore(onboardingBanner, container.firstChild);
  }
}
