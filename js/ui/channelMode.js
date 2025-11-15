// js/ui/channelMode.js (데이터 로딩 로직 최종 수정)

// 블로그 연동 상태 확인 함수 (전역으로 이동)
let checkBlogConnectionStatus = null;
let testBlogConnection = null;

function createBlogInput(gaProperties = [], savedUrl = '', savedPropertyId = '', connectionStatus = null) {
    const div = document.createElement('div');
    div.className = 'channel-input-item blog-input-item';
    const gaEnabled = gaProperties.length > 0;
    const propertyOptions = gaProperties.map(p => `<option value="${p.id}" ${p.id === savedPropertyId ? 'selected' : ''}>${p.name} (${p.id})</option>`).join('');
    
    // 연동 상태 표시 (savedUrl이 있으면 항상 표시)
    let statusHtml = '';
    if (savedUrl) {
        let statusClass = 'connection-status';
        let statusIcon = '⏳';
        let statusText = '확인 중';
        let statusTooltip = '';
        
        if (connectionStatus) {
            const { hasGoogleAuth, hasAdSense, hasGAProperty, testResult } = connectionStatus;
            
            if (hasGoogleAuth && hasAdSense && hasGAProperty && testResult?.success) {
                statusClass += ' success';
                statusIcon = '✅';
                statusText = '연동 완료';
                statusTooltip = `GA4: ${testResult.ga4 ? '✅ 정상' : '❌ 오류'} | AdSense: ${testResult.adsense ? '✅ 정상' : '❌ 오류'}`;
            } else if (hasGoogleAuth && hasAdSense && hasGAProperty) {
                statusClass += ' warning';
                statusIcon = '⚠️';
                statusText = '연동 확인 필요';
                if (testResult) {
                    statusTooltip = `테스트 결과: ${testResult.error || '알 수 없는 오류'}`;
                } else {
                    statusTooltip = '연동 테스트를 실행해주세요.';
                }
            } else {
                statusClass += ' error';
                statusIcon = '❌';
                statusText = '설정 불완전';
                const missing = [];
                if (!hasGoogleAuth) missing.push('Google 계정');
                if (!hasAdSense) missing.push('AdSense 계정');
                if (!hasGAProperty) missing.push('GA4 속성');
                statusTooltip = `누락된 설정: ${missing.join(', ')}`;
            }
        } else {
            // connectionStatus가 없으면 기본 상태 표시
            statusClass += ' warning';
            statusIcon = '⏳';
            statusText = '상태 확인 중';
            statusTooltip = '연동 상태를 확인하는 중입니다.';
        }
        
        statusHtml = `
            <div class="${statusClass}" title="${statusTooltip}">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${statusText}</span>
                <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
            </div>
        `;
    }
    
    div.innerHTML = `
        <div class="input-wrapper">
            <input type="text" class="blog-url-input" placeholder="내 블로그 주소" value="${savedUrl}">
            <select class="ga-property-select" ${!gaEnabled ? 'disabled' : ''}>
                <option value="">${gaEnabled ? '연동할 GA4 속성 선택' : 'Google 계정 미연동'}</option>
                ${propertyOptions}
            </select>
            <button class="remove-channel-btn">×</button>
        </div>
        ${statusHtml}
    `;
    
    // 테스트 버튼 이벤트 리스너 추가
    if (savedUrl) {
        // 이벤트 위임을 사용하여 동적으로 추가된 버튼도 처리
        div.addEventListener('click', async (e) => {
            if (e.target.classList.contains('test-connection-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const currentUrl = div.querySelector('.blog-url-input').value;
                const currentGAPropertyId = div.querySelector('.ga-property-select').value;
                if (testBlogConnection) {
                    await testBlogConnection(div, currentUrl, currentGAPropertyId);
                } else {
                    console.warn('testBlogConnection 함수가 아직 정의되지 않았습니다.');
                }
            }
        });
        
        // GA 속성 선택 변경 시 상태 업데이트
        const gaSelect = div.querySelector('.ga-property-select');
        if (gaSelect) {
            gaSelect.addEventListener('change', async () => {
                const currentUrl = div.querySelector('.blog-url-input').value;
                const currentGAPropertyId = gaSelect.value;
                if (currentUrl) {
                    // 상태 표시가 없으면 생성
                    let statusDiv = div.querySelector('.connection-status');
                    if (!statusDiv) {
                        statusDiv = document.createElement('div');
                        statusDiv.className = 'connection-status';
                        div.appendChild(statusDiv);
                    }
                    
                    if (checkBlogConnectionStatus) {
                        const connectionStatus = await checkBlogConnectionStatus(currentUrl, currentGAPropertyId);
                        const { hasGoogleAuth, hasAdSense, hasGAProperty } = connectionStatus;
                        
                        if (hasGoogleAuth && hasAdSense && hasGAProperty) {
                            statusDiv.className = 'connection-status warning';
                            statusDiv.innerHTML = `
                                <span class="status-icon">⚠️</span>
                                <span class="status-text">연동 확인 필요</span>
                                <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                            `;
                        } else {
                            statusDiv.className = 'connection-status error';
                            const missing = [];
                            if (!hasGoogleAuth) missing.push('Google 계정');
                            if (!hasAdSense) missing.push('AdSense 계정');
                            if (!hasGAProperty) missing.push('GA4 속성');
                            statusDiv.innerHTML = `
                                <span class="status-icon">❌</span>
                                <span class="status-text">설정 불완전</span>
                                <span class="status-detail">누락: ${missing.join(', ')}</span>
                                <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                            `;
                        }
                    } else {
                        statusDiv.className = 'connection-status warning';
                        statusDiv.innerHTML = `
                            <span class="status-icon">⏳</span>
                            <span class="status-text">상태 확인 중</span>
                            <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                        `;
                    }
                }
            });
        }
        
        // URL 입력 변경 시에도 상태 업데이트
        const urlInput = div.querySelector('.blog-url-input');
        if (urlInput) {
            urlInput.addEventListener('blur', async () => {
                const currentUrl = urlInput.value;
                const currentGAPropertyId = div.querySelector('.ga-property-select')?.value || '';
                if (currentUrl) {
                    // 상태 표시가 없으면 생성
                    let statusDiv = div.querySelector('.connection-status');
                    if (!statusDiv) {
                        statusDiv = document.createElement('div');
                        statusDiv.className = 'connection-status';
                        div.appendChild(statusDiv);
                    }
                    
                    if (checkBlogConnectionStatus) {
                        const connectionStatus = await checkBlogConnectionStatus(currentUrl, currentGAPropertyId);
                        const { hasGoogleAuth, hasAdSense, hasGAProperty } = connectionStatus;
                        
                        if (hasGoogleAuth && hasAdSense && hasGAProperty) {
                            statusDiv.className = 'connection-status warning';
                            statusDiv.innerHTML = `
                                <span class="status-icon">⚠️</span>
                                <span class="status-text">연동 확인 필요</span>
                                <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                            `;
                        } else {
                            statusDiv.className = 'connection-status error';
                            const missing = [];
                            if (!hasGoogleAuth) missing.push('Google 계정');
                            if (!hasAdSense) missing.push('AdSense 계정');
                            if (!hasGAProperty) missing.push('GA4 속성');
                            statusDiv.innerHTML = `
                                <span class="status-icon">❌</span>
                                <span class="status-text">설정 불완전</span>
                                <span class="status-detail">누락: ${missing.join(', ')}</span>
                                <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                            `;
                        }
                    }
                } else {
                    // URL이 없으면 상태 표시 제거
                    const statusDiv = div.querySelector('.connection-status');
                    if (statusDiv) {
                        statusDiv.remove();
                    }
                }
            });
        }
    }
    
    return div;
}

function createYoutubeInput(placeholder, value = '') {
    const div = document.createElement('div');
    div.className = 'channel-input-item';
    div.innerHTML = `
        <div class="input-wrapper">
            <input type="text" placeholder="${placeholder}" value="${value}">
            <button class="remove-channel-btn">×</button>
        </div>
    `;
    return div;
}

export function renderChannelMode(container) {
  container.innerHTML = `
    <div class="channel-container">
      <div class="channel-section">
          <h2>🔑 API 키 설정</h2>
          <div class="channel-input-item"><label for="youtube-api-key">YouTube Data API v3 Key</label><div class="input-wrapper"><input type="password" id="youtube-api-key" placeholder="AIzaSy...로 시작하는 YouTube API 키" style="width: 100%;"></div></div>
          <div class="settings-section"><div class="setting-item"><label class="toggle-switch"><input type="checkbox" id="keyword-extraction-toggle"><span class="slider"></span></label><label for="keyword-extraction-toggle">AI 키워드 자동 추출 활성화</label></div></div>
          <div class="channel-input-item" style="margin-top: 15px;"><label for="gemini-api-key">Google AI Gemini API Key</label><div class="input-wrapper"><input type="password" id="gemini-api-key" placeholder="AIzaSy...로 시작하는 Gemini API 키" style="width: 100%;"></div></div>
      </div>
      <div class="channel-section">
          <h2>🔗 고급 데이터 연동 (수익 분석용)</h2>
          <div id="google-auth-section">
              <p class="auth-description">Google 계정을 연동하여 애널리틱스(GA4)와 애드센스의 데이터를 기반으로 더 정교한 수익화 분석을 받아보세요.</p>
              <div id="auth-status-ui"></div>
          </div>
      </div>
      <div class="channel-section">
        <div class="channel-section-header">
          <h2>🚀 내 채널</h2>
          <div>
            <button class="add-channel-btn" data-type="blog" data-target="my-blog-list">블로그 추가</button>
            <button class="add-channel-btn" data-type="youtube" data-target="my-youtube-list">유튜브 추가</button>
          </div>
        </div>
        <div class="connection-status-info">
          <p class="info-text">💡 각 블로그의 연동 상태를 확인하고, 문제가 있을 경우 "테스트" 버튼을 클릭하여 진단하세요.</p>
        </div>
        <div id="my-blog-list" class="channel-input-list"></div>
        <div id="my-youtube-list" class="channel-input-list"></div>
      </div>
      <div class="channel-section">
        <div class="channel-section-header">
          <h2>⚔️ 경쟁 채널</h2>
          <div>
            <button class="add-channel-btn" data-type="competitor-blog" data-target="competitor-blog-list">블로그 추가</button>
            <button class="add-channel-btn" data-type="competitor-youtube" data-target="competitor-youtube-list">유튜브 추가</button>
          </div>
        </div>
        <div id="competitor-blog-list" class="channel-input-list"></div>
        <div id="competitor-youtube-list" class="channel-input-list"></div>
      </div>
      <button class="channel-save-btn">연동 정보 저장</button>
    </div>
  `;

  const channelContainer = container.querySelector('.channel-container');

  const updateAuthUI = (data) => {
      const authStatusUI = channelContainer.querySelector('#auth-status-ui');
      if (data && data.email) {
          authStatusUI.innerHTML = `
              <div class="auth-status-item">
                  <strong>연동된 계정:</strong> ${data.email} <button id="google-logout-btn" class="logout-btn">연동 해제</button>
              </div>
              <div class="auth-status-item">
                  <label><strong>연동된 애드센스 계정 ID:</strong></label>
                  <input type="text" id="adsense-account-id-input" value="${data.adSenseAccountId || ''}" placeholder="pub-xxxxxxxxxxxx">
                  <button id="refresh-adsense-account-btn" class="refresh-account-btn" title="AdSense 계정 목록 새로고침">🔄</button>
                  <button id="save-adsense-account-btn" class="save-account-btn" title="AdSense 계정 ID 저장">💾 저장</button>
              </div>
              <div id="adsense-accounts-list" class="adsense-accounts-list" style="display: none; margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 12px;">
                  <div style="font-weight: 600; margin-bottom: 4px;">사용 가능한 AdSense 계정:</div>
                  <div id="adsense-accounts-items"></div>
              </div>
          `;
          channelContainer.querySelector('#google-logout-btn')?.addEventListener('click', handleLogout);
          channelContainer.querySelector('#refresh-adsense-account-btn')?.addEventListener('click', loadAdSenseAccounts);
          
          // AdSense 계정 ID 저장 버튼
          const saveAdSenseBtn = channelContainer.querySelector('#save-adsense-account-btn');
          if (saveAdSenseBtn) {
              saveAdSenseBtn.addEventListener('click', () => {
                  const accountIdInput = channelContainer.querySelector('#adsense-account-id-input');
                  const accountId = accountIdInput?.value?.trim() || '';
                  if (accountId) {
                      // 공백 제거 후 저장
                      const trimmedAccountId = accountId.trim();
                      chrome.storage.local.set({ adSenseAccountId: trimmedAccountId }, () => {
                          // 입력 필드도 업데이트
                          if (accountIdInput) {
                              accountIdInput.value = trimmedAccountId;
                          }
                          alert('AdSense 계정 ID가 저장되었습니다.');
                      });
                  } else {
                      alert('AdSense 계정 ID를 입력해주세요.');
                  }
              });
          }
          
      } else {
          authStatusUI.innerHTML = `
              <div id="auth-status"><span class="status-disconnected">●</span> 미연동</div>
              <button id="google-login-btn" class="google-btn">
                  <img src="${chrome.runtime.getURL('images/google-logo.png')}" alt="Google logo">
                  <span>Google 계정으로 로그인</span>
              </button>
          `;
          channelContainer.querySelector('#google-login-btn')?.addEventListener('click', handleLogin);
      }
  };

  const handleLogin = () => {
      chrome.runtime.sendMessage({ action: 'start_google_auth' }, (response) => {
          if (response && response.success) {
              alert('Google 계정 연동에 성공했습니다!');
              loadInitialData(); // 로그인 성공 후 모든 데이터를 다시 로드
          } else {
              alert('Google 계정 연동 실패: ' + (response?.error || '알 수 없는 오류'));
          }
      });
  };
  
  // AdSense 계정 목록 조회 함수
  const loadAdSenseAccounts = () => {
      chrome.runtime.sendMessage({ action: 'get_adsense_accounts' }, (response) => {
          const accountsListDiv = channelContainer.querySelector('#adsense-accounts-list');
          const accountsItemsDiv = channelContainer.querySelector('#adsense-accounts-items');
          
          if (response && response.success && response.accounts && response.accounts.length > 0) {
              const accountIds = response.accounts.map(acc => acc.name?.split('/')[1] || '').filter(Boolean);
              accountsItemsDiv.innerHTML = accountIds.map(id => 
                  `<div class="adsense-account-item" data-account-id="${id}" style="padding: 4px; cursor: pointer; border-radius: 3px;">
                    ${id}
                  </div>`
              ).join('');
              
              // 계정 목록 클릭 이벤트 추가
              accountsItemsDiv.querySelectorAll('.adsense-account-item').forEach(item => {
                  item.addEventListener('click', () => {
                      const accountId = (item.dataset.accountId || '').trim();
                      const accountIdInput = channelContainer.querySelector('#adsense-account-id-input');
                      if (accountIdInput && accountId) {
                          accountIdInput.value = accountId;
                          // 자동 저장 (공백 제거)
                          chrome.storage.local.set({ adSenseAccountId: accountId }, () => {
                              accountsListDiv.style.display = 'none';
                              alert('AdSense 계정 ID가 저장되었습니다.');
                          });
                      }
                  });
              });
              accountsListDiv.style.display = 'block';
          } else {
              accountsItemsDiv.innerHTML = '<div style="color: #999;">사용 가능한 AdSense 계정이 없습니다.</div>';
              accountsListDiv.style.display = 'block';
          }
      });
  };

  const handleLogout = () => {
      if (!confirm('Google 계정 연동을 해제하시겠습니까?')) return;
      chrome.runtime.sendMessage({ action: 'revoke_google_auth' }, (response) => {
          if (response && response.success) {
              alert('연동이 해제되었습니다.');
              updateAuthUI(null);
              renderMyBlogInputs([]); // GA 속성 목록을 비워서 UI 초기화
          } else {
              alert('연동 해제 실패: ' + (response?.error || '알 수 없는 오류'));
          }
      });
  };
  
    // 블로그 연동 상태 확인 함수
    checkBlogConnectionStatus = async (blogUrl, gaPropertyId) => {
        return new Promise((resolve) => {
            chrome.storage.local.get(['googleAuthToken', 'adSenseAccountId', 'blogConnectionTests'], (result) => {
                const hasGoogleAuth = !!result.googleAuthToken;
                const hasAdSense = !!result.adSenseAccountId;
                const hasGAProperty = !!gaPropertyId;
                
                // 저장된 테스트 결과 불러오기
                let testResult = null;
                if (blogUrl && gaPropertyId && result.blogConnectionTests) {
                    // URL 정규화 (끝의 슬래시 제거, 소문자 변환)
                    const normalizedUrl = blogUrl.trim().toLowerCase().replace(/\/+$/, '');
                    const testKey = `${normalizedUrl}|${gaPropertyId}`;
                    
                    // 정확한 키로 먼저 찾기
                    let savedTest = result.blogConnectionTests[testKey];
                    
                    // 찾지 못하면 모든 키를 순회하며 URL만 비교
                    if (!savedTest) {
                        for (const key in result.blogConnectionTests) {
                            const [savedUrl] = key.split('|');
                            const normalizedSavedUrl = savedUrl.trim().toLowerCase().replace(/\/+$/, '');
                            if (normalizedSavedUrl === normalizedUrl) {
                                savedTest = result.blogConnectionTests[key];
                                break;
                            }
                        }
                    }
                    
                    if (savedTest) {
                        // 테스트 결과가 24시간 이내인지 확인
                        const testAge = Date.now() - (savedTest.timestamp || 0);
                        const maxAge = 24 * 60 * 60 * 1000; // 24시간
                        if (testAge < maxAge) {
                            testResult = savedTest.result;
                        }
                    }
                }
                
                resolve({
                    hasGoogleAuth,
                    hasAdSense,
                    hasGAProperty,
                    testResult: testResult
                });
            });
        });
    };
    
    // 블로그 연동 테스트 함수 (background.js를 통해 API 호출)
    testBlogConnection = async (blogItem, blogUrl, gaPropertyId) => {
        const statusDiv = blogItem.querySelector('.connection-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<span class="status-icon">🔄</span><span class="status-text">테스트 중...</span>';
        }
        
        chrome.storage.local.get(['adSenseAccountId'], async (result) => {
            const adSenseAccountId = result.adSenseAccountId;
            
            // 디버깅: 저장된 계정 ID 확인
            console.log('[테스트 시작] 저장된 AdSense 계정 ID:', adSenseAccountId);
            
            if (!adSenseAccountId || !gaPropertyId) {
                if (statusDiv) {
                    statusDiv.className = 'connection-status error';
                    const missing = [];
                    if (!adSenseAccountId) missing.push('AdSense 계정 ID');
                    if (!gaPropertyId) missing.push('GA4 속성');
                    statusDiv.innerHTML = `<span class="status-icon">❌</span><span class="status-text">설정 불완전</span><span class="status-detail">누락: ${missing.join(', ')}</span>`;
                }
                return;
            }
            
            // background.js를 통해 API 테스트
            chrome.runtime.sendMessage({
                action: 'test_blog_connection',
                data: {
                    gaPropertyId: gaPropertyId,
                    adSenseAccountId: adSenseAccountId
                }
            }, (response) => {
                // 디버깅: 전체 response 확인
                console.log('[연동 테스트 응답]', response);
                console.log('[AdSense 응답 상세]', response?.adsense);
                
                if (chrome.runtime.lastError) {
                    if (statusDiv) {
                        statusDiv.className = 'connection-status error';
                        statusDiv.innerHTML = `
                            <span class="status-icon">❌</span>
                            <span class="status-text">테스트 실패</span>
                            <span class="status-detail">${chrome.runtime.lastError.message}</span>
                        `;
                    }
                    return;
                }

                if (!response) {
                    if (statusDiv) {
                        statusDiv.className = 'connection-status error';
                        statusDiv.innerHTML = `
                            <span class="status-icon">❌</span>
                            <span class="status-text">테스트 실패</span>
                            <span class="status-detail">응답이 없습니다</span>
                        `;
                    }
                    return;
                }

                // 결과 업데이트
                if (statusDiv) {
                    const ga4Success = response.ga4?.success || false;
                    const adsenseSuccess = response.adsense?.success || false;
                    const ga4Error = response.ga4?.error;
                    const adsenseError = response.adsense?.error;

                    // 테스트 결과 저장
                    if (blogUrl && gaPropertyId) {
                        chrome.storage.local.get(['blogConnectionTests'], (storageResult) => {
                            const tests = storageResult.blogConnectionTests || {};
                            // URL 정규화 (끝의 슬래시 제거, 소문자 변환)
                            const normalizedUrl = blogUrl.trim().toLowerCase().replace(/\/+$/, '');
                            const testKey = `${normalizedUrl}|${gaPropertyId}`;
                            tests[testKey] = {
                                result: {
                                    success: ga4Success && adsenseSuccess,
                                    ga4: { success: ga4Success, error: ga4Error },
                                    adsense: { success: adsenseSuccess, error: adsenseError }
                                },
                                timestamp: Date.now()
                            };
                            chrome.storage.local.set({ blogConnectionTests: tests });
                        });
                    }
                    
                    if (ga4Success && adsenseSuccess) {
                        statusDiv.className = 'connection-status success';
                        statusDiv.innerHTML = `
                            <span class="status-icon">✅</span>
                            <span class="status-text">연동 완료</span>
                            <span class="status-detail">GA4: ✅ AdSense: ✅</span>
                        `;
                    } else {
                        statusDiv.className = 'connection-status warning';
                        const errors = [];
                        let hasAuthError = false;
                        
                        if (!ga4Success) {
                            const errorMsg = ga4Error || '오류';
                            if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('인증')) {
                                errors.push('GA4: 인증 오류 (토큰 갱신 필요)');
                                hasAuthError = true;
                            } else {
                                errors.push(`GA4: ${errorMsg}`);
                            }
                        }
                        if (!adsenseSuccess) {
                            const errorMsg = adsenseError || '오류';
                            const debugInfo = response.adsense?.debug;
                            
                            // 디버그 정보를 콘솔에 출력
                            if (debugInfo) {
                                console.log('[AdSense 디버그 정보]', debugInfo);
                            }
                            
                            if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('인증') || errorMsg.includes('404')) {
                                if (errorMsg.includes('404')) {
                                    let errorDetail = 'AdSense: 계정을 찾을 수 없음';
                                    // 디버깅 정보가 있으면 추가 표시
                                    if (debugInfo) {
                                        const availableAccounts = debugInfo.사용가능한_계정_원본 || debugInfo.사용가능한_계정 || [];
                                        const inputId = debugInfo.입력한_ID_정리 || debugInfo.입력한_ID || '없음';
                                        errorDetail += `\n[디버그] 입력한 ID: "${inputId}", 사용 가능한 계정: ${availableAccounts.join(', ') || '없음'}`;
                                        if (debugInfo.계정_상세정보) {
                                            errorDetail += `\n계정 상세: ${debugInfo.계정_상세정보.join(', ')}`;
                                        }
                                    }
                                    errors.push(errorDetail);
                                } else {
                                    errors.push('AdSense: 인증 오류 (토큰 갱신 필요)');
                                    hasAuthError = true;
                                }
                            } else {
                                let errorDetail = `AdSense: ${errorMsg}`;
                                // 디버깅 정보가 있으면 추가 표시
                                if (debugInfo) {
                                    const availableAccounts = debugInfo.사용가능한_계정_원본 || debugInfo.사용가능한_계정 || [];
                                    const inputId = debugInfo.입력한_ID_정리 || debugInfo.입력한_ID || '없음';
                                    const normalizedId = debugInfo.입력한_ID_정규화 || debugInfo.정규화된_ID || '없음';
                                    errorDetail += `\n[디버그] 입력한 ID: "${inputId}", 정규화된 ID: "${normalizedId}", 사용 가능한 계정: ${availableAccounts.join(', ') || '없음'}`;
                                }
                                errors.push(errorDetail);
                            }
                        }
                        
                        const errorText = errors.length > 0 ? errors[0] : '오류';
                        const fullErrorText = errors.join(', ');
                        
                        // 에러 메시지에 디버깅 정보가 포함되어 있으면 더 자세히 표시
                        const errorDisplayText = fullErrorText.length > 100 ? errorText : fullErrorText;
                        
                        statusDiv.innerHTML = `
                            <span class="status-icon">⚠️</span>
                            <span class="status-text">연동 오류</span>
                            <span class="status-detail" title="${fullErrorText.replace(/\n/g, ' | ')}">${errorDisplayText}</span>
                            ${hasAuthError ? '<button class="refresh-token-btn" style="margin-left: 8px; padding: 2px 6px; font-size: 10px; border: 1px solid #dadce0; border-radius: 3px; background: #fff; cursor: pointer;">토큰 갱신</button>' : ''}
                            ${fullErrorText.includes('[디버그]') ? '<button class="show-debug-btn" style="margin-left: 4px; padding: 2px 6px; font-size: 10px; border: 1px solid #dadce0; border-radius: 3px; background: #fff; cursor: pointer;" title="디버그 정보 보기">🔍</button>' : ''}
                        `;
                        
                        // 디버그 정보 보기 버튼 이벤트
                        const debugBtn = statusDiv.querySelector('.show-debug-btn');
                        if (debugBtn) {
                            debugBtn.addEventListener('click', () => {
                                alert('디버그 정보:\n\n' + fullErrorText);
                            });
                        }
                        
                        // 토큰 갱신 버튼 이벤트
                        const refreshBtn = statusDiv.querySelector('.refresh-token-btn');
                        if (refreshBtn) {
                            refreshBtn.addEventListener('click', () => {
                                handleLogin();
                            });
                        }
                    }
                }
            });
        });
    };
    
    const renderMyBlogInputs = async (gaProperties = [], savedBlogs = []) => {
        const listElement = channelContainer.querySelector('#my-blog-list');
        listElement.innerHTML = '';
        if (savedBlogs.length > 0) {
            for (const blog of savedBlogs) {
                const connectionStatus = await checkBlogConnectionStatus(blog.inputUrl, blog.gaPropertyId);
                listElement.appendChild(createBlogInput(gaProperties, blog.inputUrl, blog.gaPropertyId, connectionStatus));
            }
        } else {
            listElement.appendChild(createBlogInput(gaProperties));
        }
    };
    
    const renderOtherInputs = (listId, channels = [], placeholder) => {
        const listElement = channelContainer.querySelector(`#${listId}`);
        listElement.innerHTML = '';
        if (channels.length > 0) {
            channels.forEach(channel => listElement.appendChild(createYoutubeInput(placeholder, channel.inputUrl || channel)));
        } else {
            listElement.appendChild(createYoutubeInput(placeholder));
        }
    };

    const loadInitialData = () => {
        chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
            const data = response.data || {};
            // API 키 및 설정 복원
            if(data.youtubeApiKey) channelContainer.querySelector('#youtube-api-key').value = data.youtubeApiKey;
            if(data.geminiApiKey) channelContainer.querySelector('#gemini-api-key').value = data.geminiApiKey;
            chrome.storage.local.get('isKeywordExtractionEnabled', setting => {
                channelContainer.querySelector('#keyword-extraction-toggle').checked = !!setting.isKeywordExtractionEnabled;
            });

            // Google 연동 정보 및 채널 목록 렌더링
            chrome.storage.local.get(['googleUserEmail', 'gaProperties', 'adSenseAccountId'], (result) => {
                updateAuthUI({
                    email: result.googleUserEmail,
                    adSenseAccountId: result.adSenseAccountId
                });
                renderMyBlogInputs(result.gaProperties, data.myChannels?.blogs || []);
                renderOtherInputs('my-youtube-list', data.myChannels?.youtubes || [], '내 유튜브 채널 주소');
                renderOtherInputs('competitor-blog-list', data.competitorChannels?.blogs || [], '경쟁 블로그 주소');
                renderOtherInputs('competitor-youtube-list', data.competitorChannels?.youtubes || [], '경쟁 유튜브 채널 주소');
            });
        });
    };

    loadInitialData(); // 페이지가 처음 로드될 때 모든 데이터를 불러옵니다.

    const getValues = (listId, isBlog = false) => {
        const listElement = channelContainer.querySelector(`#${listId}`);
        if (!listElement) return [];
        if (isBlog) {
            return Array.from(listElement.querySelectorAll('.blog-input-item')).map(item => ({
                url: item.querySelector('.blog-url-input').value,
                gaPropertyId: item.querySelector('.ga-property-select').value
            })).filter(item => item.url);
        }
        return Array.from(listElement.querySelectorAll('input')).map(input => input.value).filter(Boolean);
    };

    channelContainer.addEventListener('click', async (e) => {
        if (e.target.classList.contains('add-channel-btn')) {
            const type = e.target.dataset.type;
            const targetListId = type.includes('blog') ? (type.startsWith('competitor') ? 'competitor-blog-list' : 'my-blog-list') : (type.startsWith('competitor') ? 'competitor-youtube-list' : 'my-youtube-list');
            const listElement = channelContainer.querySelector(`#${targetListId}`);

            if (type === 'blog') {
                chrome.storage.local.get('gaProperties', async (result) => {
                    const newBlogInput = createBlogInput(result.gaProperties || []);
                    listElement.appendChild(newBlogInput);
                    
                    // 새로 추가된 블로그 입력 필드에 상태 확인 기능 추가
                    const urlInput = newBlogInput.querySelector('.blog-url-input');
                    if (urlInput) {
                        // URL 입력 후 상태 확인
                        urlInput.addEventListener('blur', async () => {
                            const currentUrl = urlInput.value;
                            const currentGAPropertyId = newBlogInput.querySelector('.ga-property-select')?.value || '';
                            if (currentUrl && checkBlogConnectionStatus) {
                                const connectionStatus = await checkBlogConnectionStatus(currentUrl, currentGAPropertyId);
                                // 상태 표시가 없으면 생성
                                let statusDiv = newBlogInput.querySelector('.connection-status');
                                if (!statusDiv) {
                                    statusDiv = document.createElement('div');
                                    statusDiv.className = 'connection-status';
                                    newBlogInput.appendChild(statusDiv);
                                }
                                
                                const { hasGoogleAuth, hasAdSense, hasGAProperty } = connectionStatus;
                                if (hasGoogleAuth && hasAdSense && hasGAProperty) {
                                    statusDiv.className = 'connection-status warning';
                                    statusDiv.innerHTML = `
                                        <span class="status-icon">⚠️</span>
                                        <span class="status-text">연동 확인 필요</span>
                                        <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                                    `;
                                } else {
                                    statusDiv.className = 'connection-status error';
                                    const missing = [];
                                    if (!hasGoogleAuth) missing.push('Google 계정');
                                    if (!hasAdSense) missing.push('AdSense 계정');
                                    if (!hasGAProperty) missing.push('GA4 속성');
                                    statusDiv.innerHTML = `
                                        <span class="status-icon">❌</span>
                                        <span class="status-text">설정 불완전</span>
                                        <span class="status-detail">누락: ${missing.join(', ')}</span>
                                        <button class="test-connection-btn" title="연동 테스트">🔍 테스트</button>
                                    `;
                                }
                            }
                        });
                    }
                });
            } else {
                 const placeholder = targetListId.includes('my') ? '내 유튜브 채널 주소' : '경쟁 채널 주소';
                 listElement.appendChild(createYoutubeInput(placeholder));
            }
        }
        if (e.target.classList.contains('remove-channel-btn')) {
                  const inputItem = e.target.closest('.channel-input-item');
                    const inputElement = inputItem.querySelector('input');
                    const urlToDelete = inputElement.value;

                    if (urlToDelete) {
                        if (confirm(`'${urlToDelete}' 채널과 수집된 모든 데이터를 삭제하시겠습니까?`)) {
                        chrome.runtime.sendMessage({ action: 'delete_channel', url: urlToDelete }, (response) => {
                            if (response && response.success) {
                            console.log('채널이 성공적으로 삭제되었습니다.');
                            inputItem.remove(); // UI에서 입력창 제거
                            } else {
                            alert('채널 삭제 중 오류가 발생했습니다: ' + (response?.error || '알 수 없는 오류'));
                            }
                        });
                        }
                    } else {
                        // 입력창에 URL이 없는 경우, 그냥 UI에서만 제거
                        inputItem.remove();
                    }
        }
        if (e.target.classList.contains('channel-save-btn')) {
            chrome.storage.local.set({ isKeywordExtractionEnabled: channelContainer.querySelector('#keyword-extraction-toggle').checked });

            const dataToSave = {
                youtubeApiKey: channelContainer.querySelector('#youtube-api-key').value,
                geminiApiKey: channelContainer.querySelector('#gemini-api-key').value,
                myChannels: {
                    blogs: getValues('my-blog-list', true),
                    youtubes: getValues('my-youtube-list')
                },
                competitorChannels: {
                    blogs: getValues('competitor-blog-list'),
                    youtubes: getValues('competitor-youtube-list')
                }
            };
            chrome.runtime.sendMessage({ action: 'save_channels_and_key', data: dataToSave }, (response) => {
                if (response.success) {
                    alert(response.message || '저장되었습니다.');
                } else {
                    alert('저장 실패: ' + response.error);
                }
            });
        }
    });
}