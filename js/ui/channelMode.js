// js/ui/channelMode.js (Shadow DOM 호환 최종 수정 완료)

// 입력 필드와 도움말 아이콘을 생성하는 헬퍼 함수
function createChannelInput(placeholder, value = '', type) {
  const div = document.createElement('div');
  div.className = 'channel-input-item';
  const helpIcon = type === 'youtube' ? `<span class="help-icon" title="채널 ID 찾는 법">?</span>` : '';
  div.innerHTML = `
    <label>${placeholder} ${helpIcon}</label>
    <div class="input-wrapper">
      <input type="text" placeholder="${placeholder}" value="${value}">
      <button class="remove-channel-btn">×</button>
    </div>
  `;
  return div;
}

// 도움말 모달을 생성하고 보여주는 함수
function showHelpModal(container) {
    const existingModal = container.querySelector('.cp-modal-backdrop');
    if (existingModal) existingModal.remove();
    const modal = document.createElement('div');
    modal.className = 'cp-modal-backdrop';
    modal.innerHTML = `
        <div class="cp-modal-content">
            <button class="cp-modal-close">×</button>
            <h3>YouTube 채널 주소/ID 찾는 법</h3>
            <ol>
                <li>가장 간단한 방법은 채널의 URL(예: youtube.com/@채널이름)을 그대로 입력하는 것입니다.</li>
                <li>또는, 페이지 소스 보기에서 <strong>Ctrl+F</strong>로 <strong>channelId</strong>를 검색하여 "UC..."로 시작하는 ID를 직접 입력할 수도 있습니다.</li>
            </ol>
        </div>
    `;
    container.querySelector('.channel-container').appendChild(modal);
    modal.querySelector('.cp-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

export function renderChannelMode(container) {
  container.innerHTML = `
    <div class="channel-container">
      <div class="channel-section">
          <h2>🔑 API 키 설정</h2>
          <div class="channel-input-item">
              <label for="youtube-api-key">YouTube Data API v3 Key</label>
              <div class="input-wrapper">
                <input type="password" id="youtube-api-key" placeholder="AIzaSy...로 시작하는 YouTube API 키" style="width: 100%;">
              </div>
          </div>
          <div class="settings-section">
            <div class="setting-item">
              <label class="toggle-switch">
                <input type="checkbox" id="keyword-extraction-toggle">
                <span class="slider"></span>
              </label>
              <label for="keyword-extraction-toggle">AI 키워드 자동 추출 활성화</label>
            </div>
          </div>          
          <div class="channel-input-item" style="margin-top: 15px;">
              <label for="gemini-api-key">Google AI Gemini API Key</label>
              <div class="input-wrapper">
                <input type="password" id="gemini-api-key" placeholder="AIzaSy...로 시작하는 Gemini API 키" style="width: 100%;">
              </div>
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
            <button class="add-channel-btn" data-type="blog" data-target="competitor-blog-list">블로그 추가</button>
            <button class="add-channel-btn" data-type="youtube" data-target="competitor-youtube-list">유튜브 추가</button>
          </div>
        </div>
        <div id="competitor-blog-list" class="channel-input-list"></div>
        <div id="competitor-youtube-list" class="channel-input-list"></div>
      </div>
      <button class="channel-save-btn">연동 정보 및 API 키 저장</button>
    </div>
  `;

  const channelContainer = container.querySelector('.channel-container');

  channelContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('add-channel-btn')) {
      const type = e.target.dataset.type;
      const targetListId = e.target.dataset.target;
      const placeholder = type === 'blog' ? '블로그 주소' : '유튜브 채널 주소';
      channelContainer.querySelector(`#${targetListId}`).appendChild(createChannelInput(placeholder, '', type));
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
              inputItem.remove();
            } else {
              alert('채널 삭제 중 오류가 발생했습니다: ' + (response?.error || '알 수 없는 오류'));
            }
          });
        }
      } else {
        inputItem.remove();
      }
    }

    if (e.target.classList.contains('help-icon')) {
      showHelpModal(container);
    }

    if (e.target.classList.contains('channel-save-btn')) {
      const getValues = (listId) => Array.from(channelContainer.querySelectorAll(`#${listId} input`)).map(input => input.value).filter(Boolean);
      const youtubeApiKey = channelContainer.querySelector('#youtube-api-key').value;
      const geminiApiKey = channelContainer.querySelector('#gemini-api-key').value;
      const isKeywordExtractionEnabled = channelContainer.querySelector('#keyword-extraction-toggle').checked;
      
      chrome.storage.local.set({ isKeywordExtractionEnabled });

      const channelData = {
        youtubeApiKey: youtubeApiKey,
        geminiApiKey: geminiApiKey,
        myChannels: { blogs: getValues('my-blog-list'), youtubes: getValues('my-youtube-list') },
        competitorChannels: { blogs: getValues('competitor-blog-list'), youtubes: getValues('competitor-youtube-list') }
      };
      
      chrome.runtime.sendMessage({ action: 'save_channels_and_key', data: channelData }, (response) => {
        if (response && response.success) {
          alert('채널 및 API 키 정보가 성공적으로 저장되었습니다.');
        } else {
          alert('저장 중 오류가 발생했습니다: ' + (response?.error || '알 수 없는 오류'));
        }
      });
    }
  });

  chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
    if (response && response.success && response.data) {
      const data = response.data;
      if (data.youtubeApiKey) channelContainer.querySelector('#youtube-api-key').value = data.youtubeApiKey;
      if (data.geminiApiKey) channelContainer.querySelector('#gemini-api-key').value = data.geminiApiKey;
   
      chrome.storage.local.get('isKeywordExtractionEnabled', (result) => {
          channelContainer.querySelector('#keyword-extraction-toggle').checked = !!result.isKeywordExtractionEnabled;
      });
      
      const renderSavedChannels = (type, platform) => {
          const channels = data[type]?.[platform] || [];
          const listId = `${type.replace('Channels', '')}-${platform.slice(0,-1)}-list`;
          const placeholder = `${type === 'myChannels' ? '내' : '경쟁'} ${platform === 'blogs' ? '블로그 주소' : '유튜브 채널 주소'}`;
          const channelType = platform === 'blogs' ? 'blog' : 'youtube';
          const listElement = channelContainer.querySelector(`#${listId}`);

          if (channels?.length > 0) {
              channels.forEach(val => listElement.appendChild(createChannelInput(placeholder, val, channelType)));
          } else {
              listElement.appendChild(createChannelInput(placeholder, '', channelType));
          }
      };
      
      renderSavedChannels('myChannels', 'blogs');
      renderSavedChannels('myChannels', 'youtubes');
      renderSavedChannels('competitorChannels', 'blogs');
      renderSavedChannels('competitorChannels', 'youtubes');
    } else {
        channelContainer.querySelector('#my-blog-list').appendChild(createChannelInput('블로그 주소', '', 'blog'));
        channelContainer.querySelector('#my-youtube-list').appendChild(createChannelInput('유튜브 채널 주소', '', 'youtube'));
    }
  });
}