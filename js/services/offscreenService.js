// js/services/offscreenService.js
// Offscreen Document 관리 및 작업 위임 서비스

import { Logger } from '../utils.js';

let offscreenDocumentId = null;
let offscreenCreationPromise = null;
let offscreenPort = null; // 장기 연결용 포트 (offscreen -> background)
let offscreenBeaconSeenFromExtension = false; // observed offscreen_ready_beacon from offscreen.html

// Helper: decide whether a runtime message should be treated as a full
// 'ready' signal. This is exported so tests can assert the logic.
export function isTrueReadyMessage(msg) {
  return !!(msg && msg.action === 'offscreen_ready');
}

// Wait for the offscreen page to establish a persistent port.
// This reduces races where the page is loaded but hasn't connected yet.
async function waitForOffscreenPort(timeoutMs = 10000) {
  if (offscreenPort) return true;

  return new Promise((resolve) => {
    const start = Date.now();
    // Polling check; when onConnect runs it will set offscreenPort
    const check = setInterval(() => {
      if (offscreenPort) {
        clearInterval(check);
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 200);
  });
}

// Browser compatibility helper: detect if an offscreen document exists.
// Prefer `chrome.runtime.getContexts` (Chrome 116+), then `chrome.offscreen.hasDocument`,
// then fallback to `clients.matchAll()` for older Chrome versions.
async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      return Array.isArray(contexts) && contexts.length > 0;
    } catch (e) {
      Logger.debug('[OffscreenService] runtime.getContexts check failed', e && e.message);
    }
  }

  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    try {
      return await chrome.offscreen.hasDocument();
    } catch (e) {
      Logger.debug('[OffscreenService] chrome.offscreen.hasDocument check failed', e && e.message);
    }
  }

  // Last resort: service worker clients match (older Chrome)
  try {
    const matchedClients =
      globalThis?.clients && typeof globalThis.clients.matchAll === 'function'
        ? await globalThis.clients.matchAll()
        : [];
    return matchedClients.some((c) => c && c.url && c.url.includes(offscreenUrl));
  } catch (e) {
    Logger.debug('[OffscreenService] clients.matchAll check failed', e && e.message);
    return false;
  }
}

/**
 * Offscreen 문서 생성 및 관리 (싱글톤 패턴 + 동시성 제어)
 */
export async function ensureOffscreenDocument() {
  // 이미 생성 중인 경우 대기
  if (offscreenCreationPromise) {
    Logger.debug('[OffscreenService] 문서 생성 중, 대기합니다.');
    return await offscreenCreationPromise;
  }

  // 이미 생성된 문서가 있는지 확인 (호환성 체크 포함)
  if (offscreenDocumentId) {
    try {
      const hasDocument = await hasOffscreenDocument();
      if (hasDocument) {
        Logger.debug('[OffscreenService] 문서가 이미 존재합니다.');
        return offscreenDocumentId;
      } else {
        Logger.warn(
          '[OffscreenService] 문서 ID는 있지만 실제 문서가 존재하지 않습니다. 재생성합니다.'
        );
        offscreenDocumentId = null;
      }
    } catch (e) {
      Logger.warn('[OffscreenService] 문서 존재 확인 중 오류:', e);
      offscreenDocumentId = null;
    }
  }

  // 문서 생성 시작
  offscreenCreationPromise = (async () => {
    try {
      Logger.info('[OffscreenService] 문서 생성 시작...');

      // 기존 문서가 있다면 먼저 닫기 시도
      try {
        await chrome.offscreen.closeDocument();
        Logger.debug('[OffscreenService] 기존 문서 닫기 완료');
      } catch (e) {
        Logger.debug('[OffscreenService] closeDocument failed (ignored):', e && e.message);
      }

      // Attach a one-time readiness listener BEFORE creating the offscreen
      // document so we don't miss immediate readiness signals that the
      // offscreen page may send right after it loads.
      const readyPromise = new Promise((resolve, reject) => {
        const maxWait = 60000; // 60s
        const timeout = setTimeout(() => {
          try {
            chrome.runtime.onMessage.removeListener(onReadyMsg);
            chrome.runtime.onConnect.removeListener(onConnect);
          } catch (e) {
            Logger.debug('[OffscreenService] readyPromise cleanup failed', e && e.message);
          }
          reject(new Error('Offscreen ready wait timed out'));
        }, maxWait);

        const onReadyMsg = (msg, sender) => {
          // Log sender information to help diagnose beacon vs ready origin
          try {
            const src = sender && (sender.url || sender.id || (sender.tab && sender.tab.id));
            Logger.debug(
              '[OffscreenService] onReadyMsg received from',
              src || '<unknown>',
              msg && msg.action
            );
          } catch (e) {
            Logger.debug('[OffscreenService] onReadyMsg sender log failed', e && e.message);
          }

          // Only accept an explicit 'offscreen_ready' message as a true
          // readiness signal. The HTML beacon (offscreen_ready_beacon)
          // indicates the offscreen page loaded, but does not guarantee
          // that handlers are registered; treat it as informational only.
          if (isTrueReadyMessage(msg)) {
            clearTimeout(timeout);
            try {
              chrome.runtime.onMessage.removeListener(onReadyMsg);
              chrome.runtime.onConnect.removeListener(onConnect);
            } catch (e) {
              Logger.debug('[OffscreenService] removeListener failed', e && e.message);
            }
            resolve(true);
            return false;
          }

          if (msg && msg.action === 'offscreen_ready_beacon') {
            Logger.debug('[OffscreenService] offscreen_ready_beacon received (early beacon)');
            // If this beacon comes from the actual offscreen document, mark it.
            try {
              const senderUrl = sender && sender.url;
              if (
                senderUrl &&
                senderUrl.startsWith('chrome-extension://') &&
                senderUrl.includes('offscreen.html')
              ) {
                offscreenBeaconSeenFromExtension = true;
                Logger.debug(
                  '[OffscreenService] offscreen beacon observed from extension offscreen.html'
                );
              }
            } catch (e) {
              Logger.debug('[OffscreenService] beacon sender check failed', e && e.message);
            }
            // Do not treat this as a readiness signal; let verifyPing detect handler activation.
            return false;
          }
          return false;
        };

        const onConnect = (port) => {
          try {
            // Only accept the canonical 'offscreen-init' persistent port
            // as an indication that the offscreen document has fully
            // installed handlers and is ready for port-based messaging.
            if (port && port.name === 'offscreen-init') {
              clearTimeout(timeout);
              try {
                chrome.runtime.onMessage.removeListener(onReadyMsg);
                chrome.runtime.onConnect.removeListener(onConnect);
              } catch (e) {
                Logger.debug(
                  '[OffscreenService] removeListener during onConnect failed',
                  e && e.message
                );
              }

              // store port for future use
              try {
                offscreenPort = port;
                // clean up on disconnect
                port.onDisconnect.addListener(() => {
                  try {
                    offscreenPort = null;
                  } catch (e) {
                    Logger.debug('[OffscreenService] onDisconnect handler error', e && e.message);
                  }
                });
              } catch (e) {
                Logger.debug('[OffscreenService] failed to store offscreen port', e && e.message);
              }
              resolve(true);
            }
          } catch (e) {
            Logger.debug('[OffscreenService] onConnect handler error', e && e.message);
          }
        };

        chrome.runtime.onMessage.addListener(onReadyMsg);
        chrome.runtime.onConnect.addListener(onConnect);
      });

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING', 'WORKERS', 'DOM_PARSER'],
        justification: 'HTML Sanitization, Image Resizing, and Template Rendering',
      });

      // Wait for the offscreen page to signal readiness (either via
      // runtime.sendMessage or via a connected port).
      // NOTE: the page might send an immediate "beacon" before its
      // message handlers are registered. We therefore additionally
      // verify we can communicate with the offscreen page by sending
      // a lightweight ping and waiting for a ping response.
      try {
        await readyPromise;
        Logger.debug('[OffscreenService] 오프스크린 페이지가 준비되었다는 신호 수신');

        // Verify handlers are active by pinging the offscreen page.
        // If a beacon arrived early (before listeners were installed)
        // the ping will fail and we should wait/retry until a handler
        // responds.
        // Increase ping attempts and timeouts to reduce false negatives
        const verifyPing = async (maxAttempts = 12, backoff = 500) => {
          for (let a = 0; a < maxAttempts; a++) {
            try {
              const got = await new Promise((resolve, reject) => {
                const t = setTimeout(() => {
                  try {
                    chrome.runtime.onMessage.removeListener(resp);
                  } catch (e) {
                    Logger.debug('[OffscreenService] removeListener(resp) failed', e && e.message);
                  }
                  reject(new Error('offscreen_ping 응답 타임아웃'));
                }, 5000); // per-ping wait increased to 5s

                const resp = (m) => {
                  if (m && m.action === 'offscreen_ping_response') {
                    clearTimeout(t);
                    try {
                      chrome.runtime.onMessage.removeListener(resp);
                    } catch (e) {
                      Logger.debug(
                        '[OffscreenService] removeListener(resp) in resp handler failed',
                        e && e.message
                      );
                    }
                    resolve(true);
                    // We're not using sendResponse in this listener,
                    // so explicitly return false to avoid signaling async response.
                    return false;
                  }
                  return false;
                };

                chrome.runtime.onMessage.addListener(resp);

                // Prefer the persistent port when available
                if (offscreenPort) {
                  try {
                    const portResp = (m) => {
                      if (m && m.action === 'offscreen_ping_response') {
                        clearTimeout(t);
                        try {
                          chrome.runtime.onMessage.removeListener(resp);
                        } catch (e) {
                          Logger.debug(
                            '[OffscreenService] removeListener(resp) in portResp failed',
                            e && e.message
                          );
                        }
                        try {
                          offscreenPort.onMessage.removeListener(portResp);
                        } catch (e) {
                          Logger.debug(
                            '[OffscreenService] offscreenPort.removeListener(portResp) failed',
                            e && e.message
                          );
                        }
                        resolve(true);
                        return false;
                      }
                      return false;
                    };
                    offscreenPort.onMessage.addListener(portResp);
                    offscreenPort.postMessage({ action: 'offscreen_ping' });
                  } catch (e) {
                    try {
                      if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                        const p = chrome.runtime.sendMessage({ action: 'offscreen_ping' });
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                      }
                    } catch (se) {
                      Logger.debug(
                        '[OffscreenService] runtime ping fallback failed',
                        se && se.message
                      );
                    }
                  }
                } else {
                  try {
                    if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                      const p = chrome.runtime.sendMessage({ action: 'offscreen_ping' });
                      if (p && typeof p.catch === 'function') p.catch(() => {});
                    }
                  } catch (e) {
                    Logger.debug('[OffscreenService] suppressed error', e && e.message);
                  }
                }
              });

              if (got) return true;
            } catch (e) {
              await new Promise((r) => setTimeout(r, backoff * (a + 1)));
            }
          }
          return false;
        };

        const ok = await verifyPing();
        if (!ok) {
          Logger.warn(
            '[OffscreenService] offscreen_ping 응답을 받지 못했습니다. 5초 대기 후 재확인 시도합니다.'
          );
          // Give the page a little more time and try a more thorough check
          await new Promise((r) => setTimeout(r, 5000));
          try {
            await waitForOffscreenReady(6, 500);
            Logger.info('[OffscreenService] 추가 대기 후 준비 확인 성공');
          } catch (e) {
            // If we've observed a beacon coming from the offscreen.html
            // itself (extension origin), accept it as a last-resort
            // readiness signal but log a warning. This mitigates cases
            // where sendMessage/port race conditions prevent a strict
            // ping response yet the offscreen page is actually usable.
            if (offscreenBeaconSeenFromExtension) {
              Logger.warn(
                '[OffscreenService] ping 응답 없음 — 그러나 offscreen beacon이 관찰되어 폴백으로 준비로 간주합니다.'
              );
            } else {
              Logger.error(
                '[OffscreenService] 오프스크린 메시지 핸들러가 활성화되지 않았습니다 — 문서 초기화 실패로 처리합니다'
              );
              throw new Error('Offscreen message handlers did not activate');
            }
          }
        }
      } catch (e) {
        // If readiness wasn't signaled, give the page a bit more time.
        Logger.warn('[OffscreenService] readyPromise 타임아웃, 추가 대기 5초 후 체크');
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // If we've observed an offscreen_ready_beacon originating from the
        // extension's offscreen.html, accept it as a conservative last-resort
        // readiness signal. This mitigates races where the page sends a
        // beacon before its handlers are registered but is otherwise usable.
        if (offscreenBeaconSeenFromExtension) {
          Logger.warn(
            '[OffscreenService] readyPromise 타임아웃 — offscreen beacon 관찰되어 폴백으로 준비로 간주합니다.'
          );
          // Attempt to proactively establish a persistent port to the
          // offscreen document so subsequent messages use the more
          // reliable port channel instead of sendMessage fallbacks.
          if (!offscreenPort) {
            try {
              Logger.debug('[OffscreenService] beacon 관찰 후 포트 연결 시도: offscreen-init');
              const p = chrome.runtime.connect({ name: 'offscreen-init' });
              // give the connect a moment to register via onConnect
              try {
                // registerOffscreenPort will attach handlers and store the port
                registerOffscreenPort(p);
              } catch (e) {
                Logger.debug('[OffscreenService] registerOffscreenPort 실패', e && e.message);
              }
              // wait briefly for port to stabilize
              await waitForOffscreenPort(3000);
              if (offscreenPort) {
                Logger.info('[OffscreenService] 폴백 후 포트 연결 성공');
              } else {
                Logger.warn('[OffscreenService] 폴백 후에도 포트가 설정되지 않았습니다');
              }
            } catch (e) {
              Logger.debug('[OffscreenService] 포트 연결 시도 중 오류', e && e.message);
            }
          }
        } else {
          await waitForOffscreenReady();
        }
      }

      offscreenDocumentId = 'offscreen-doc';
      Logger.info('[OffscreenService] 문서 생성 및 확인 완료');
      return offscreenDocumentId;
    } catch (error) {
      Logger.error('[OffscreenService] 문서 생성 실패:', error);
      offscreenDocumentId = null;
      throw error;
    } finally {
      offscreenCreationPromise = null;
    }
  })();

  return await offscreenCreationPromise;
}

// 외부(예: background)에서 포트를 등록할 수 있도록 하는 헬퍼.
// 이 함수는 서비스 워커의 전역 onConnect에서 호출되어
// offscreen-init 포트를 중앙에서 잡아둘 때 사용됩니다.
export function registerOffscreenPort(port) {
  try {
    if (!port) return false;
    if (port.name !== 'offscreen-init') return false;
    offscreenPort = port;
    try {
      Logger.debug(
        '[OffscreenService] registerOffscreenPort: port registered',
        port?.sender?.url || port?.sender?.tab?.id || '<unknown>'
      );
    } catch (e) {
      Logger.debug('[OffscreenService] registerOffscreenPort debug failed', e && e.message);
    }
    try {
      offscreenPort.onDisconnect.addListener(() => {
        try {
          offscreenPort = null;
        } catch (e) {
          Logger.debug(
            '[OffscreenService] registerOffscreenPort onDisconnect failed',
            e && e.message
          );
        }
      });
    } catch (e) {
      Logger.debug(
        '[OffscreenService] registerOffscreenPort attach onDisconnect failed',
        e && e.message
      );
    }
    // attach a listener to pipe any incoming port messages
    try {
      // Attach a simple onMessage logger so we can observe handshake
      // messages coming from the offscreen page (e.g. offscreen_port_attached).
      try {
        offscreenPort.onMessage.addListener((msg) => {
          try {
            Logger.debug(
              '[OffscreenService] registerOffscreenPort received port message',
              msg && msg.action
            );
          } catch (e) {
            void 0;
          }
          try {
            if (msg && msg.action === 'offscreen_port_attached') {
              Logger.info('[OffscreenService] offscreen reported port attached (handshake)');
            }
          } catch (e) {
            void 0;
          }
        });
      } catch (e) {
        Logger.debug(
          '[OffscreenService] failed to attach offscreenPort.onMessage listener',
          e && e.message
        );
      }

      // Probe the port immediately so we don't consider it usable until
      // the offscreen page actually responds. Some race conditions result
      // in a stored port object that has no receiver attached yet which
      // causes later postMessage() calls to throw "Receiving end does not exist".
      try {
        let probeTimer = null;
        const probeListener = (m) => {
          try {
            if (!m) return false;
            // Accept either the handshake or the debug echo response
            if (m.action === 'offscreen_port_attached' || m.action === 'debug_echo_response') {
              try {
                if (probeTimer) clearTimeout(probeTimer);
              } catch (e) {
                void 0;
              }
              try {
                offscreenPort.onMessage.removeListener(probeListener);
              } catch (e) {
                void 0;
              }
              Logger.info('[OffscreenService] registerOffscreenPort: probe succeeded');
            }
          } catch (e) {
            void 0;
          }
          return false;
        };

        offscreenPort.onMessage.addListener(probeListener);

        // If the port doesn't respond quickly, mark it as unreliable so
        // callers will prefer runtime.sendMessage instead of repeatedly
        // trying a broken port.
        probeTimer = setTimeout(() => {
          try {
            Logger.debug(
              '[OffscreenService] registerOffscreenPort: probe timed out — marking port unreliable'
            );
          } catch (e) {
            void 0;
          }
          try {
            // avoid reusing this port for future sends
            offscreenPort = null;
          } catch (e) {
            void 0;
          }
          try {
            offscreenPort && offscreenPort.onMessage.removeListener(probeListener);
          } catch (e) {
            void 0;
          }
        }, 1200);

        // Try sending a lightweight debug echo to validate the receiver.
        try {
          offscreenPort.postMessage({ action: 'debug_echo', probe: true, ts: Date.now() });
        } catch (e) {
          try {
            Logger.debug(
              '[OffscreenService] registerOffscreenPort: probe postMessage threw',
              e && e.message
            );
          } catch (err) {}
        }
      } catch (e) {
        void 0;
      }
    } catch (e) {
      Logger.debug(
        '[OffscreenService] registerOffscreenPort attach onMessage failed',
        e && e.message
      );
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Offscreen 문서가 준비될 때까지 대기 (준비 완료 메시지 방식)
 */
async function waitForOffscreenReady(maxRetries = 30, retryDelay = 2000) {
  Logger.debug(`[OffscreenService] 준비 확인 시작 - 최대 ${maxRetries}회 시도`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      Logger.debug(`[OffscreenService] 준비 확인 시도 ${i + 1}/${maxRetries}`);

      // 먼저 문서가 존재하는지 확인
      const hasDocument = await hasOffscreenDocument();
      if (!hasDocument) {
        Logger.debug(`[OffscreenService] 문서가 존재하지 않음, ${retryDelay}ms 후 재시도`);
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
        continue;
      }

      Logger.debug(`[OffscreenService] 문서 존재 확인, offscreen_ready 메시지 대기`);

      // 오프스크린 문서가 로드되면 자체적으로 'offscreen_ready' 메시지를 보냅니다.
      // sendMessage를 보내기 전에 offscreen이 onMessage 리스너를 등록할 때까지
      // 기다리는 방식으로 안정성을 향상시킵니다.
      const readyReceived = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            chrome.runtime.onMessage.removeListener(onReadyMsg);
            chrome.runtime.onConnect.removeListener(onConnect);
            reject(new Error('offscreen_ready 타임아웃'));
          },
          Math.max(5000, retryDelay)
        );

        const onReadyMsg = (msg, sender) => {
          try {
            const src = sender && (sender.url || sender.id || (sender.tab && sender.tab.id));
            Logger.debug(
              '[OffscreenService] waitForOffscreenReady onReadyMsg from',
              src || '<unknown>',
              msg && msg.action
            );
          } catch (e) {
            Logger.debug(
              '[OffscreenService] waitForOffscreenReady onReadyMsg sender log failed',
              e && e.message
            );
          }

          // Only a true 'offscreen_ready' should be treated as readiness.
          // The HTML fallback beacon is informational; don't accept it
          // here because handlers may still be uninstalled.
          if (isTrueReadyMessage(msg)) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(onReadyMsg);
            chrome.runtime.onConnect.removeListener(onConnect);
            resolve(true);
            return false;
          }

          if (msg && msg.action === 'offscreen_ready_beacon') {
            Logger.debug(
              '[OffscreenService] waitForOffscreenReady observed beacon, still waiting for handlers'
            );
            try {
              const senderUrl = sender && sender.url;
              if (
                senderUrl &&
                senderUrl.startsWith('chrome-extension://') &&
                senderUrl.includes('offscreen.html')
              ) {
                offscreenBeaconSeenFromExtension = true;
                Logger.debug(
                  '[OffscreenService] waitForOffscreenReady observed extension offscreen beacon'
                );
              }
            } catch (e) {
              Logger.debug(
                '[OffscreenService] waitForOffscreenReady beacon sender check failed',
                e && e.message
              );
            }
            // do not resolve — keep waiting for true ready or port connect
            return false;
          }
          return false;
        };

        // 포트 연결(오프스크린에서 connect)로도 준비 여부 판단
        const onConnect = (port) => {
          try {
            if (port.name === 'offscreen-init') {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(onReadyMsg);
              chrome.runtime.onConnect.removeListener(onConnect);
              // 포트를 통해서도 메시지를 받을 수 있지만 포트를 여는 것 자체
              // 의미가 있으므로 준비로 간주합니다.
              // record persistent port for later messaging
              try {
                offscreenPort = port;
                port.onDisconnect.addListener(() => {
                  offscreenPort = null;
                });
              } catch (e) {
                Logger.debug(
                  '[OffscreenService] waitForOffscreenReady port onDisconnect attach failed',
                  e && e.message
                );
              }
              resolve(true);
            }
          } catch (e) {
            Logger.debug(
              '[OffscreenService] waitForOffscreenReady onConnect outer error',
              e && e.message
            );
          }
        };

        chrome.runtime.onMessage.addListener(onReadyMsg);
        chrome.runtime.onConnect.addListener(onConnect);
      });

      if (readyReceived) {
        Logger.info(`[OffscreenService] 준비 확인 성공 (${i + 1}회 시도)`);
        return;
      }
    } catch (error) {
      Logger.debug(`[OffscreenService] 준비 확인 실패 ${i + 1}/${maxRetries}:`, error.message);
    }

    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error('Offscreen 문서 준비 타임아웃');
}

/**
 * 일반적인 Offscreen 메시지 전송 헬퍼
 * @param {string} action - 액션 이름
 * @param {Object} data - 전송할 데이터
 * @param {number} timeout - 타임아웃 (ms, 기본값: 30000)
 * @returns {Promise<Object>} 응답 데이터
 */
async function sendToOffscreen(action, data, timeout = 30000) {
  await ensureOffscreenDocument();

  // 포트 안정화 대기
  try {
    await waitForOffscreenPort(5000);
  } catch (e) {
    void 0;
  }

  return new Promise((resolve, reject) => {
    // 1. 고유 ID 생성
    const requestId = `${action}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 클로저 변수를 먼저 캡처
    const expectedAction = `${action}_response`;
    const expectedRequestId = requestId;

    const responseListener = (msg) => {
      // 2. 액션명과 ID가 모두 일치해야 내 응답임
      try {
        // msg 객체를 안전하게 검사
        if (!msg || typeof msg !== 'object') {
          return false;
        }

        let act, rid;
        try {
          act = msg.action;
          rid = msg.requestId;
        } catch (propErr) {
          // 프로퍼티 getter 실행 오류 무시
          Logger.debug(
            '[OffscreenService] responseListener msg property getter failed:',
            propErr && propErr.message
          );
          return false;
        }

        if (act === expectedAction && rid === expectedRequestId) {
          chrome.runtime.onMessage.removeListener(responseListener);

          let success;
          try {
            success = msg.success;
          } catch (e) {
            success = false;
          }

          if (success) {
            resolve(msg);
          } else {
            let errorMsg = `${action} 실패`;
            let errName = 'OffscreenError';
            let errStack = '';
            try {
              errorMsg = msg.error || errorMsg;
            } catch (e) {
              /* ignore */
            }
            try {
              errName = msg.errorName || errName;
            } catch (e) {
              /* ignore */
            }
            try {
              errStack = msg.errorStack || '';
            } catch (e) {
              /* ignore */
            }
            const newErr = new Error(errorMsg);
            try {
              newErr.name = errName;
              if (errStack) newErr.stack = errStack;
            } catch (e) {
              /* ignore */
            }
            reject(newErr);
          }
          return true;
        }
        return false;
      } catch (e) {
        Logger.error('[OffscreenService] responseListener handler error:', e && e.message);
        return false;
      }
    };

    const usingPort = Boolean(offscreenPort);
    if (usingPort) {
      try {
        // 클로저 변수를 먼저 캡처 - const 대신 let 사용하여 호이스팅 문제 방지
        const portExpectedAction = action + '_response';
        const portExpectedRequestId = requestId;
        const portOffscreen = offscreenPort;
        const portResolve = resolve;
        const portReject = reject;
        const portAction = action;

        // 일반 함수 선언문 사용 (호이스팅 안전)
        function portResponse(msg) {
          // 안전하게 msg를 직렬화하여 로깅(가능하면) — getter에서 예외 발생할 수 있으므로 try/catch로 보호
          try {
            let safeStr;
            try {
              safeStr = JSON.stringify(msg);
            } catch (_e) {
              try {
                safeStr = String(msg);
              } catch (__e) {
                safeStr = '[unserializable message]';
              }
            }
            Logger.debug('[OffscreenService] portResponse received msg:', safeStr);
          } catch (logErr) {
            // 로깅 실패는 흘려보낸다
            void 0;
          }
          // 3. 포트 메시지도 ID 확인 (안전하게 프로퍼티 접근)
          try {
            // msg 객체를 안전하게 검사
            if (!msg || typeof msg !== 'object') {
              return false;
            }

            let act, rid;
            try {
              act = msg.action;
              rid = msg.requestId;
            } catch (propErr) {
              // 프로퍼티 getter 실행 오류 무시
              Logger.debug(
                '[OffscreenService] portResponse msg property getter failed:',
                propErr && propErr.message
              );
              return false;
            }

            if (act === portExpectedAction && rid === portExpectedRequestId) {
              try {
                portOffscreen.onMessage.removeListener(portResponse);
              } catch (e) {
                void 0;
              }

              let success;
              try {
                success = msg.success;
              } catch (e) {
                success = false;
              }

              if (success) {
                portResolve(msg);
              } else {
                let errorMsg = portAction + ' 실패';
                let errName = 'OffscreenError';
                let errStack = '';
                try {
                  errorMsg = msg.error || errorMsg;
                } catch (e) {
                  /* ignore */
                }
                try {
                  errName = msg.errorName || errName;
                } catch (e) {
                  /* ignore */
                }
                try {
                  errStack = msg.errorStack || '';
                } catch (e) {
                  /* ignore */
                }
                const newErr = new Error(errorMsg);
                try {
                  newErr.name = errName;
                  if (errStack) newErr.stack = errStack;
                } catch (e) {
                  /* ignore */
                }
                portReject(newErr);
              }
              return true;
            }
            return false;
          } catch (e) {
            Logger.error('[OffscreenService] portResponse handler error:', e && e.message);
            return false;
          }
        }

        // Wrap portResponse in a protective wrapper to ensure any runtime error within
        // the handler itself does not crash the background and will be logged and removed.
        function safePortResponseWrapper(msg) {
          try {
            return portResponse(msg);
          } catch (e) {
            try {
              // Try to capture a safe representation of msg
              let safe;
              try {
                safe = JSON.stringify(msg);
              } catch (_jj) {
                try {
                  safe = String(msg);
                } catch (__jj) {
                  safe = '[unable to serialize message]';
                }
              }
              Logger.error(
                '[OffscreenService] portResponse crashed with error:',
                e && e.message,
                'msg:',
                safe
              );
            } catch (logErr) {
              Logger.error(
                '[OffscreenService] portResponse crashed; additional log failed',
                logErr && logErr.message
              );
            }
            try {
              portOffscreen.onMessage.removeListener(safePortResponseWrapper);
            } catch (ignore) {
              void 0;
            }
            return false;
          }
        }
        Logger.debug(
          '[OffscreenService] addListener(for action):',
          action,
          'requestId:',
          requestId
        );
        offscreenPort.onMessage.addListener(safePortResponseWrapper);
        // 4. 요청 보낼 때 requestId 포함
        Logger.debug(
          '[OffscreenService] postMessage to offscreen:',
          action,
          'requestId:',
          requestId
        );
        offscreenPort.postMessage({ action, requestId, ...data });
      } catch (err) {
        // 실패 시 런타임으로 폴백
        try {
          if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            const p = chrome.runtime.sendMessage({ action, requestId, ...data });
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        } catch (se) {
          Logger.debug('[OffscreenService] runtime sendMessage fallback failed', se && se.message);
        }
      }
    } else {
      try {
        if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          const p = chrome.runtime.sendMessage({ action, requestId, ...data });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (se) {
        Logger.debug('[OffscreenService] runtime sendMessage suppressed error', se && se.message);
      }
    }

    chrome.runtime.onMessage.addListener(responseListener);

    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(responseListener);
      // 이미 완료된 경우 reject 무시되므로 안전
      reject(new Error(`${action} 타임아웃 (${timeout}ms) - ID: ${requestId}`));
    }, timeout);
  });
}

/**
 * HTML 정제 및 포매팅 (DOMPurify 사용)
 * @param {string} rawText - 정제할 원본 HTML 텍스트
 * @returns {Promise<string>} 정제된 HTML
 */
export async function sanitizeHtmlInOffscreen(rawText) {
  try {
    const startTime = performance.now();
    Logger.debug('[OffscreenService] HTML 정제 요청 시작');
    const response = await sendToOffscreen('sanitize_html_in_offscreen', { rawText }, 60000);
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] HTML 정제 완료 (${elapsed}ms)`);
    return response.cleanedHtml;
  } catch (error) {
    Logger.error('[OffscreenService] HTML 정제 실패:', error);
    // Offscreen 문서 문제인 경우 재시도
    if (
      error.message.includes('Offscreen 문서 연결 실패') ||
      error.message.includes('Receiving end does not exist')
    ) {
      Logger.warn('[OffscreenService] Offscreen 문서 문제로 인한 실패, 재시도합니다');
      // 문서 ID 리셋 후 재시도
      offscreenDocumentId = null;
      try {
        const response = await sendToOffscreen('sanitize_html_in_offscreen', { rawText }, 30000);
        return response.cleanedHtml;
      } catch (retryError) {
        Logger.error('[OffscreenService] 재시도 실패:', retryError);
        throw new Error(`HTML 정제 실패: ${retryError.message}`);
      }
    }
    throw error;
  }
}

/**
 * 이미지 리사이징
 * @param {string} imageDataUrl - 원본 이미지 DataURL
 * @param {number} maxWidth - 최대 너비
 * @param {number} maxHeight - 최대 높이
 * @param {number} quality - JPEG 품질 (0-1, 기본값: 0.9)
 * @returns {Promise<string>} 리사이즈된 이미지 DataURL
 */
export async function resizeImageInOffscreen(imageDataUrl, maxWidth, maxHeight, quality = 0.9) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'resize_image_in_offscreen',
      {
        imageDataUrl,
        maxWidth,
        maxHeight,
        quality,
      },
      30000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 이미지 리사이징 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 이미지 리사이징 오류:', error);
    throw error;
  }
}

/**
 * 템플릿 렌더링
 * @param {Object} templateData - 템플릿 데이터
 * @param {number} canvasWidth - 캔버스 너비
 * @param {number} canvasHeight - 캔버스 높이
 * @param {Object} dynamicText - 동적 텍스트 (기본값: {})
 * @returns {Promise<string>} 렌더링된 이미지 DataURL
 */
export async function renderTemplateInOffscreen(
  templateData,
  canvasWidth,
  canvasHeight,
  dynamicText = {}
) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'render_template_in_offscreen',
      {
        templateData,
        canvasWidth,
        canvasHeight,
        dynamicText,
      },
      60000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 템플릿 렌더링 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 템플릿 렌더링 오류:', error);
    throw error;
  }
}

/**
 * HTML 파싱 (기존 parse_html_in_offscreen 액션 지원)
 * @param {string} html - 파싱할 HTML 문자열
 * @param {string} baseUrl - 기본 URL
 * @returns {Promise<Object>} 파싱 결과 (thumbnail, description, metrics, cleanText)
 */
export async function parseHtmlInOffscreen(html, baseUrl) {
  try {
    const response = await sendToOffscreen('parse_html_in_offscreen', { html, baseUrl }, 30000);
    return {
      thumbnail: response.thumbnail || '',
      description: response.description || '',
      metrics: response.metrics || {},
      cleanText: response.cleanText || '',
      metaTags: response.metaTags || null,
      title: response.title || '',
    };
  } catch (error) {
    Logger.error('[OffscreenService] HTML 파싱 오류:', error);
    throw error;
  }
}

/**
 * 이미지 크롭 (중앙 기준 Center Crop)
 * @param {string} imageDataUrl - DataURL 형식의 이미지
 * @param {number} targetRatio - 목표 비율 (1 = 1:1, 1.33 = 4:3, 1.77 = 16:9)
 * @returns {Promise<string>} 크롭된 이미지의 DataURL
 */
export async function cropImageInOffscreen(imageDataUrl, targetRatio) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'crop_image_in_offscreen',
      {
        imageDataUrl,
        targetRatio,
      },
      30000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 이미지 크롭 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 이미지 크롭 오류:', error);
    throw error;
  }
}

/**
 * 썸네일 합성 (배경 이미지 + 텍스트)
 * @param {string} imageUrl - AI가 만든 배경 이미지 URL
 * @param {string} text - 삽입할 한글 문구
 * @param {string} textPosition - 텍스트 위치 ("top", "center", "bottom", 기본값: "bottom")
 * @returns {Promise<string>} 합성된 이미지 DataURL
 */
export async function composeThumbnailInOffscreen(imageUrl, text, textPosition = 'bottom') {
  try {
    const startTime = performance.now();

    // Firebase Storage URL인 경우 CORS 문제를 피하기 위해 먼저 fetch로 가져와서 DataURL로 변환
    let imageDataUrl = imageUrl;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      Logger.debug(
        '[OffscreenService] 이미지 URL을 DataURL로 변환 중:',
        imageUrl.substring(0, 50) + '...'
      );
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`이미지 로드 실패: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        imageDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        Logger.debug('[OffscreenService] ✅ 이미지 DataURL 변환 완료');
      } catch (fetchError) {
        Logger.warn('[OffscreenService] 이미지 fetch 실패, 원본 URL 사용:', fetchError);
        // fetch 실패 시 원본 URL 사용 (CORS 문제가 있을 수 있음)
      }
    }

    const response = await sendToOffscreen(
      'compose_thumbnail_in_offscreen',
      {
        imageUrl: imageDataUrl,
        text,
        textPosition,
      },
      60000
    ); // 타임아웃 60초로 증가
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 썸네일 합성 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 썸네일 합성 오류:', error);
    throw error;
  }
}

/**
 * URL에서 HTML 콘텐츠를 fetch (CORS 우회용)
 * @param {string} url - 가져올 URL
 * @returns {Promise<string>} HTML 콘텐츠
 */
export async function fetchUrlInOffscreen(url) {
  try {
    const response = await sendToOffscreen('fetch_url_in_offscreen', { url }, 30000);
    return response.html;
  } catch (error) {
    Logger.error('[OffscreenService] URL fetch 오류:', error);
    throw error;
  }
}
