// js/ui/channelMode.js (데이터 로딩 로직 최종 수정)

function createBlogInput(gaProperties = [], savedUrl = '', savedPropertyId = '') {
    const div = document.createElement('div');
    div.className = 'channel-input-item blog-input-item';
    const gaEnabled = gaProperties.length > 0;
    const propertyOptions = gaProperties.map(p => `<option value="${p.id}" ${p.id === savedPropertyId ? 'selected' : ''}>${p.name} (${p.id})</option>`).join('');
    div.innerHTML = `
        <div class="input-wrapper">
            <input type="text" class="blog-url-input" placeholder="내 블로그 주소" value="${savedUrl}">
            <select class="ga-property-select" ${!gaEnabled ? 'disabled' : ''}>
                <option value="">${gaEnabled ? '연동할 GA4 속성 선택' : 'Google 계정 미연동'}</option>
                ${propertyOptions}
            </select>
            <button class="remove-channel-btn">×</button>
        </div>
    `;
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
                  <input type="text" value="${data.adSenseAccountId || '연동된 계정 없음'}" readonly>
              </div>
          `;
          channelContainer.querySelector('#google-logout-btn')?.addEventListener('click', handleLogout);
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
  
    const renderMyBlogInputs = (gaProperties = [], savedBlogs = []) => {
        const listElement = channelContainer.querySelector('#my-blog-list');
        listElement.innerHTML = '';
        if (savedBlogs.length > 0) {
            savedBlogs.forEach(blog => {
                listElement.appendChild(createBlogInput(gaProperties, blog.inputUrl, blog.gaPropertyId));
            });
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

    channelContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-channel-btn')) {
            const type = e.target.dataset.type;
            const targetListId = type.includes('blog') ? (type.startsWith('competitor') ? 'competitor-blog-list' : 'my-blog-list') : (type.startsWith('competitor') ? 'competitor-youtube-list' : 'my-youtube-list');
            const listElement = channelContainer.querySelector(`#${targetListId}`);

            if (type === 'blog') {
                chrome.storage.local.get('gaProperties', (result) => {
                    listElement.appendChild(createBlogInput(result.gaProperties || []));
                });
            } else {
                 const placeholder = targetListId.includes('my') ? '내 유튜브 채널 주소' : '경쟁 채널 주소';
                 listElement.appendChild(createYoutubeInput(placeholder));
            }
        }
        if (e.target.classList.contains('remove-channel-btn')) {
            e.target.closest('.channel-input-item').remove();
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