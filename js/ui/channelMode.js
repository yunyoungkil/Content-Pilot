// js/ui/channelMode.js (최종 완성본)

// 입력 필드와 도움말 아이콘을 생성하는 헬퍼 함수
function createChannelInput(placeholder, value = '', type) {
  const div = document.createElement('div');
  div.className = 'channel-input-item';
  const helpIcon = type === 'youtube' ? '<span class="help-icon" title="채널 ID 찾는 법">?</span>' : '';
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
            <h3>YouTube 채널 ID 찾는 법</h3>
            <ol>
                <li>채널 페이지로 이동합니다 (예: youtube.com/@채널이름).</li>
                <li>페이지의 빈 공간을 마우스 오른쪽 클릭 후 <strong>'페이지 소스 보기'</strong>를 선택합니다.</li>
                <li>새로 열린 코드 페이지에서 <strong>Ctrl+F</strong> (Mac: Cmd+F)를 누릅니다.</li>
                <li>검색창에 <strong>channelId</strong> 라고 입력합니다.</li>
                <li><code>"channelId":"UC..."</code> 와 같이 "UC"로 시작하는 긴 문자열이 바로 채널 ID입니다.</li>
            </ol>
        </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cp-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

export function renderChannelMode(container) {
  container.innerHTML = `
    <style>
      .channel-container { padding: 24px 32px; height: 100%; overflow-y: auto; background-color: #f7f8fa; font-family: "Noto Sans KR", sans-serif; box-sizing: border-box;}
      .channel-section { background-color: #fff; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
      .channel-section h2 { font-size: 18px; font-weight: 600; color: #333; margin-top: 0; }
      .channel-section-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 16px; }
      .add-channel-btn { background: #e8f0fe; color: #4285F4; border: 1px solid #4285F4; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer; margin-left: 8px; }
      .channel-input-list { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
      .channel-input-item label { display: block; font-size: 14px; font-weight: 500; color: #555; margin-bottom: 6px; }
      .channel-input-item .input-wrapper { display: flex; align-items: center; gap: 8px; }
      .channel-input-item input { flex: 1; padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
      .help-icon { display: inline-block; width: 16px; height: 16px; border-radius: 50%; background: #e0e0e0; color: white; font-weight: bold; text-align: center; line-height: 16px; font-size: 12px; cursor: pointer; }
      .remove-channel-btn { width: 28px; height: 28px; border-radius: 50%; border: none; background: #f1f3f5; color: #868e96; font-size: 20px; cursor: pointer; }
      .channel-save-btn { display: block; width: 100%; padding: 12px; font-size: 16px; font-weight: 600; background-color: #34A853; color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 20px; }
      .cp-modal-backdrop { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100; display: flex; align-items: center; justify-content: center; }
      .cp-modal-content { background: white; padding: 20px 24px; border-radius: 8px; max-width: 450px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); position: relative; }
      .cp-modal-content h3 { margin-top: 0; }
      .cp-modal-content ol { padding-left: 20px; line-height: 1.6; }
      .cp-modal-close { position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 24px; cursor: pointer; color: #888; }
    </style>
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
      const placeholder = type === 'blog' ? '블로그 RSS 주소' : '유튜브 채널 ID';
      document.getElementById(targetListId).appendChild(createChannelInput(placeholder, '', type));
    }
    // --- ▼▼▼ [수정] 삭제 버튼 클릭 이벤트 핸들러 ▼▼▼ ---
    if (e.target.classList.contains('remove-channel-btn')) {
      const inputItem = e.target.closest('.channel-input-item');
      const inputElement = inputItem.querySelector('input');
      const urlToDelete = inputElement.value;

      // URL 값이 있는 경우 (이미 저장된 채널)에만 삭제 메시지 전송
      if (urlToDelete) {
        if (confirm(`'${urlToDelete}' 채널과 수집된 모든 데이터를 삭제하시겠습니까?`)) {
          chrome.runtime.sendMessage({ action: 'delete_channel', url: urlToDelete }, (response) => {
            if (response && response.success) {
              console.log('채널이 성공적으로 삭제되었습니다.');
              inputItem.remove(); // 성공적으로 삭제된 후에만 UI에서 제거
            } else {
              alert('채널 삭제 중 오류가 발생했습니다: ' + (response?.error || '알 수 없는 오류'));
            }
          });
        }
      } else {
        // URL 값이 없는 경우 (새로 추가된 빈 입력 필드)에는 그냥 UI에서만 제거
        inputItem.remove();
      }
    }
    if (e.target.classList.contains('help-icon')) {
      showHelpModal(container);
    }
    if (e.target.classList.contains('channel-save-btn')) {
      const getValues = (listId) => Array.from(document.querySelectorAll(`#${listId} input`)).map(input => input.value).filter(Boolean);
      const youtubeApiKey = document.getElementById('youtube-api-key').value;
      const geminiApiKey = document.getElementById('gemini-api-key').value; // Gemini 키 값 가져오기

      // --- ▼▼▼ [G-11] 설정 값 가져오기 ▼▼▼ ---
      const isKeywordExtractionEnabled = document.getElementById('keyword-extraction-toggle').checked;
      chrome.storage.local.set({ isKeywordExtractionEnabled });      


      const channelData = {
        youtubeApiKey: youtubeApiKey,
        geminiApiKey: geminiApiKey, // 저장할 데이터에 추가
        myChannels: { blogs: getValues('my-blog-list'), youtubes: getValues('my-youtube-list') },
        competitorChannels: { blogs: getValues('competitor-blog-list'), youtubes: getValues('competitor-youtube-list') }
      };
      
      chrome.runtime.sendMessage({ action: 'save_channels_and_key', data: channelData }, (response) => {
        if (response && response.success) alert('채널 및 API 키 정보가 성공적으로 저장되었습니다.');
        else alert('저장 중 오류가 발생했습니다: ' + response?.error);
      });
    }
  });

  chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
    if (response && response.success && response.data) {
      const data = response.data;
      if (data.youtubeApiKey) document.getElementById('youtube-api-key').value = data.youtubeApiKey;
      if (data.geminiApiKey) document.getElementById('gemini-api-key').value = data.geminiApiKey; // Gemini 키 값 불러오기
   
      // --- ▼▼▼ [G-11] 저장된 설정 값 불러와서 UI에 반영 ▼▼▼ ---
      chrome.storage.local.get('isKeywordExtractionEnabled', (result) => {
          document.getElementById('keyword-extraction-toggle').checked = !!result.isKeywordExtractionEnabled;
      });
      
      const renderSavedChannels = (type, platform) => {
          const channels = data[type]?.[platform];
          const listId = `${type.replace('Channels', '')}-${platform.slice(0,-1)}-list`;
          const placeholder = `${type === 'myChannels' ? '내' : '경쟁'} ${platform === 'blogs' ? '블로그 RSS 주소' : '유튜브 채널 ID'}`;
          const channelType = platform === 'blogs' ? 'blog' : 'youtube';

          if (channels?.length > 0) {
              channels.forEach(val => document.getElementById(listId).appendChild(createChannelInput(placeholder, val, channelType)));
          } else {
              document.getElementById(listId).appendChild(createChannelInput(placeholder, '', channelType));
          }
      };
      
      renderSavedChannels('myChannels', 'blogs');
      renderSavedChannels('myChannels', 'youtubes');
      renderSavedChannels('competitorChannels', 'blogs');
      renderSavedChannels('competitorChannels', 'youtubes');
    } else {
        // 데이터가 아예 없을 경우 기본 입력창 1개씩 띄우기
        document.getElementById('my-blog-list').appendChild(createChannelInput('블로그 RSS 주소', '', 'blog'));
        document.getElementById('my-youtube-list').appendChild(createChannelInput('유튜브 채널 ID', '', 'youtube'));
    }
  });
}