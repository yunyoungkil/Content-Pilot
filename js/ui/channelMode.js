// js/ui/channelMode.js

// 각 채널 입력 필드를 생성하는 헬퍼 함수
function createChannelInput(placeholder, value = '') {
  const div = document.createElement('div');
  div.className = 'channel-input-item';
  div.innerHTML = `
    <input type="text" placeholder="${placeholder}" value="${value}">
    <button class="remove-channel-btn">×</button>
  `;
  return div;
}

export function renderChannelMode(container) {
  container.innerHTML = `
    <style>
      .channel-container { padding: 24px 32px; height: 100%; overflow-y: auto; background-color: #f7f8fa; font-family: "Noto Sans KR", sans-serif; }
      .channel-section { background-color: #fff; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
      .channel-section-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 16px; }
      .channel-section-header h2 { font-size: 18px; font-weight: 600; color: #333; margin: 0; }
      .add-channel-btn { background: #e8f0fe; color: #4285F4; border: 1px solid #4285F4; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer; }
      .channel-input-list { display: flex; flex-direction: column; gap: 10px; }
      .channel-input-item { display: flex; align-items: center; gap: 8px; }
      .channel-input-item input { flex: 1; padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
      .remove-channel-btn { width: 28px; height: 28px; border-radius: 50%; border: none; background: #f1f3f5; color: #868e96; font-size: 20px; cursor: pointer; line-height: 28px; }
      .channel-save-btn { display: block; width: 100%; padding: 12px; font-size: 16px; font-weight: 600; background-color: #34A853; color: white; border: none; border-radius: 6px; cursor: pointer; transition: background-color 0.2s; }
      .channel-save-btn:hover { background-color: #1e8e3e; }
    </style>

    <div class="channel-container">
      <div class="channel-section" data-channel-type="my-channels">
        <div class="channel-section-header">
          <h2>🚀 내 채널</h2>
          <button class="add-channel-btn" data-type="blog">블로그 추가</button>
          <button class="add-channel-btn" data-type="youtube">유튜브 추가</button>
        </div>
        <div id="my-blog-list" class="channel-input-list"></div>
        <div id="my-youtube-list" class="channel-input-list" style="margin-top: 10px;"></div>
      </div>

      <div class="channel-section" data-channel-type="competitor-channels">
        <div class="channel-section-header">
          <h2>⚔️ 경쟁 채널</h2>
          <button class="add-channel-btn" data-type="blog">블로그 추가</button>
          <button class="add-channel-btn" data-type="youtube">유튜브 추가</button>
        </div>
        <div id="competitor-blog-list" class="channel-input-list"></div>
        <div id="competitor-youtube-list" class="channel-input-list" style="margin-top: 10px;"></div>
      </div>
      
      <button class="channel-save-btn">연동 정보 저장</button>
    </div>
  `;

  // --- 이벤트 리스너 로직 ---
  const channelContainer = container.querySelector('.channel-container');

  // '추가' 버튼 클릭 이벤트 처리
  channelContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('add-channel-btn')) {
      const section = e.target.closest('.channel-section');
      const type = e.target.dataset.type; // 'blog' or 'youtube'
      const isMyChannel = section.dataset.channelType === 'my-channels';

      if (type === 'blog') {
        const listId = isMyChannel ? 'my-blog-list' : 'competitor-blog-list';
        const placeholder = isMyChannel ? '내 블로그 RSS 주소' : '경쟁 블로그 RSS 주소';
        document.getElementById(listId).appendChild(createChannelInput(placeholder));
      } else if (type === 'youtube') {
        const listId = isMyChannel ? 'my-youtube-list' : 'competitor-youtube-list';
        const placeholder = isMyChannel ? '내 유튜브 채널 ID' : '경쟁 유튜브 채널 ID';
        document.getElementById(listId).appendChild(createChannelInput(placeholder));
      }
    }
  });

  // '삭제' 버튼 클릭 이벤트 처리 (이벤트 위임)
  channelContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-channel-btn')) {
      e.target.parentElement.remove();
    }
  });

  // '저장' 버튼 클릭 이벤트 처리
  const saveBtn = container.querySelector('.channel-save-btn');
  saveBtn.addEventListener('click', () => {
    const getValues = (listId) => {
      return Array.from(document.querySelectorAll(`#${listId} input`)).map(input => input.value).filter(Boolean);
    };

    const channelData = {
      myChannels: {
        blogs: getValues('my-blog-list'),
        youtubes: getValues('my-youtube-list'),
      },
      competitorChannels: {
        blogs: getValues('competitor-blog-list'),
        youtubes: getValues('competitor-youtube-list'),
      }
    };

    // ▼▼▼ [수정] background.js로 채널 저장 메시지 전송 ▼▼▼
    chrome.runtime.sendMessage({ action: 'save_channels', data: channelData }, (response) => {
      if (response.success) {
        alert('채널 정보가 성공적으로 저장되었습니다.');
      } else {
        alert('저장 중 오류가 발생했습니다: ' + response.error);
      }
    });
  });

 // ▼▼▼ [추가] Firebase에서 저장된 채널 정보를 불러와서 화면에 렌더링 ▼▼▼
  chrome.runtime.sendMessage({ action: 'get_channels' }, (response) => {
    if (response.success && response.data) {
      const data = response.data;
      
      // 내 채널 데이터 렌더링
      if (data.myChannels) {
        data.myChannels.blogs?.forEach(url => document.getElementById('my-blog-list').appendChild(createChannelInput('내 블로그 RSS 주소', url)));
        data.myChannels.youtubes?.forEach(id => document.getElementById('my-youtube-list').appendChild(createChannelInput('내 유튜브 채널 ID', id)));
      }
      
      // 경쟁 채널 데이터 렌더링
      if (data.competitorChannels) {
        data.competitorChannels.blogs?.forEach(url => document.getElementById('competitor-blog-list').appendChild(createChannelInput('경쟁 블로그 RSS 주소', url)));
        data.competitorChannels.youtubes?.forEach(id => document.getElementById('competitor-youtube-list').appendChild(createChannelInput('경쟁 유튜브 채널 ID', id)));
      }
    } else {
      // 저장된 데이터가 없으면 기본 입력창 하나씩 추가
      document.querySelector('#my-blog-list').appendChild(createChannelInput('내 블로그 RSS 주소'));
      document.querySelector('#competitor-blog-list').appendChild(createChannelInput('경쟁 블로그 RSS 주소'));
    }
  });
}