// js/ui/channelMode.js (채널 중심 아키텍처 적용 버전)

import { showToast, Logger } from '../utils.js';
import { deleteCompetitorData } from '../services/cascadeDeleteService.js';
import { getCurrentUserId } from '../services/firebaseService.js';
import { migrateChannelIdCascade } from '../services/migrationService.js';

export function renderChannelMode(container) {
  container.innerHTML = `
    <div class="channel-settings-container">
      <div class="settings-header">
        <h2>⚙️ 채널 및 API 설정</h2>
        <p class="settings-desc">내 채널을 등록하고, 각 채널별로 경쟁사를 관리하세요.</p>
      </div>
      <div class="api-key-section">
        <div class="input-group">
          <label>YouTube Data API Key</label>
          <input type="password" id="youtube-api-key" placeholder="AIzaSy...">
        </div>
        <div class="input-group">
          <label>Gemini API Key</label>
          <input type="password" id="gemini-api-key" placeholder="AIzaSy...">
          </div>
      </div>
      <div class="api-key-section">
        <div class="input-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #eee;">
           <div style="display: flex; justify-content: space-between; align-items: center;">
             <label style="margin: 0;">애드센스 URL 채널 동기화</label>
             <button id="sync-adsense-status-btn" class="cp-btn-secondary small">🔄 등록 상태 확인하기</button>
           </div>
           <p class="settings-desc" style="margin-top: 4px;">애드센스 관리자 페이지에 수동으로 등록된 URL 목록을 가져와 카드의 상태를 업데이트합니다.</p>
        </div>
      </div>
      <div class="my-channel-list-section">
        <div class="section-header">
          <h3>📺 내 채널 목록</h3>
          <button id="add-my-channel-btn" class="cp-btn-primary small">+ 채널 추가</button>
        </div>
        <div id="my-channel-list" class="channel-list">
        </div>
      </div>
      <div class="save-actions">
        <button id="save-all-channels-btn" class="cp-btn-primary full-width">설정 저장하기</button>
      </div>
    </div>
    
    <div id="channel-detail-modal" class="cp-modal-wrap" style="display: none;">
      <div class="cp-modal-backdrop"></div>
      <div class="cp-modal large">
        <div class="cp-modal-header">
          <div class="cp-modal-title">채널 상세 설정</div>
          <button class="cp-modal-close">×</button>
        </div>
        <div class="cp-modal-body">
          <div class="input-group">
            <label>블로그 플랫폼 및 URL <span class="required">*</span></label>
            <div style="display: flex; gap: 8px;">
              <select id="modal-platform-select" style="width: 130px; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                <option value="naver">🟢 네이버</option>
                <option value="tistory">🟠 티스토리</option>
                <option value="wordpress">🔵 워드프레스</option>
                <option value="blogger">🟡 구글 블로거</option>
                <option value="direct">🔗 직접 입력</option>
              </select>
              <input type="text" id="modal-blog-url" style="flex: 1;" placeholder="블로그 주소 입력">
            </div>
            <p class="settings-desc" id="url-guide-text" style="margin-top: 4px;">블로그 메인 주소를 입력하세요. (자동으로 RSS를 찾습니다)</p>
          </div>
          
          <div class="integration-section">
            <div class="section-header" style="margin-bottom: 12px;">
              <h4>📊 성과 추적 연동</h4>
              <button id="modal-google-login-btn" class="google-btn" style="padding: 8px 16px; font-size: 13px;">
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <g fill="#000" fill-rule="evenodd">
                    <path d="M17.64 9.2045c0-.6371-.0573-1.2516-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0772-1.7955 2.7164v2.2581h2.9087c1.7023-1.5668 2.6836-3.8741 2.6836-6.6149z" fill="#4285F4"/>
                    <path d="M9 18c2.4297 0 4.4673-.795 5.9564-2.1636l-2.9087-2.2581c-.8064.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0364-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
                    <path d="M3.9636 10.7273c-.18-.54-.2827-1.1168-.2827-1.7273s.1027-1.1873.2827-1.7273V4.9409H.9573C.3477 6.175.0009 7.5409.0009 9s.3468 2.825.9564 4.0591l3.0063-2.3318z" fill="#FBBC05"/>
                    <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5814-2.5814C13.4632.8918 11.4255 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9409L3.9636 7.2727C4.6718 5.1455 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
                  </g>
                </svg>
                Google 로그인
              </button>
            </div>
            <div id="google-auth-status" style="display: none; margin-bottom: 12px; padding: 8px; background: #e8f5e9; border-radius: 4px; font-size: 12px; color: #2e7d32;">
              <span id="google-auth-email"></span>
              <button id="modal-google-logout-btn" class="logout-btn" style="margin-left: 8px;">로그아웃</button>
            </div>
            <div class="input-group">
              <label>GA4 속성 ID (Property ID)</label>
              <select id="modal-ga-select" style="display: none; width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; margin-bottom: 8px;">
                <option value="">선택하세요</option>
              </select>
              <input type="text" id="modal-ga-id" placeholder="123456789 또는 Google 로그인으로 자동 입력">
            </div>
            <div class="input-group">
              <label>AdSense 게시자 ID</label>
              <input type="text" id="modal-adsense-id" placeholder="pub-0000000000000000 또는 Google 로그인으로 자동 입력">
            </div>
          </div>
          <div class="competitor-section">
            <div class="section-header">
              <h4>⚔️ 경쟁 채널 관리</h4>
              <button id="modal-add-competitor-btn" class="cp-btn-secondary small">+ 경쟁사 추가</button>
            </div>
            <div id="modal-competitor-list" class="competitor-list">
            </div>
          </div>
          <div class="content-limit-section">
            <div class="section-header">
              <h4>📊 콘텐츠 수집 설정</h4>
            </div>
            <!-- improved layout: two-column responsive grid for quick comparison -->
            <div class="content-limit-grid" style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start;">
              <div class="input-group" style="flex: 1; min-width:220px;">
                <label style="display:flex; gap:8px; align-items:center;">내 채널 최대 수집
                  <span style="color:#888; font-weight:400; font-size:12px; margin-left:6px;">(RSS / YouTube 별도)</span>
                </label>
                <div style="display:flex; gap:8px; align-items:center;">
                  <select id="modal-content-limit" style="flex:1; padding:8px 12px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
                    <option value="5">5개</option>
                    <option value="10" selected>10개</option>
                    <option value="15">15개</option>
                    <option value="20">20개</option>
                    <option value="30">30개</option>
                    <option value="50">50개</option>
                  </select>
                  <div title="수집 개수가 많을수록 최신 콘텐츠 외의 항목도 가져옵니다. 성능과 필요에 따라 조절하세요." style="font-size:12px; color:#777;">ⓘ</div>
                </div>
                <p class="settings-desc" style="margin-top:6px;">내 채널에서 수집할 최대 콘텐츠 개수(피드별). 기본값은 <strong>10개</strong>입니다.</p>
              </div>

              <div class="input-group" style="flex: 1; min-width:220px;">
                <label style="display:flex; gap:8px; align-items:center;">경쟁 채널 최대 수집
                  <span style="color:#888; font-weight:400; font-size:12px; margin-left:6px;">(경쟁 채널 별도)</span>
                </label>
                <select id="modal-competitor-content-limit" style="width:100%; padding:8px 12px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
                  <option value="5">5개</option>
                  <option value="10" selected>10개</option>
                  <option value="15">15개</option>
                  <option value="20">20개</option>
                  <option value="30">30개</option>
                  <option value="50">50개</option>
                </select>
                <p class="settings-desc" style="margin-top:6px;">경쟁 채널은 모니터링 목적이므로 작은 값(5~15)을 권장합니다. 필요한 경우 확대하세요.</p>
              </div>
            </div>
          </div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary" id="modal-cancel-btn">취소</button>
          <button class="cp-btn cp-btn-primary" id="modal-apply-btn">적용</button>
        </div>
      </div>
    </div>
  `;

  // 스타일 주입 (필요시 css 파일로 이동)
  const style = document.createElement('style');
  style.textContent = `
    .channel-settings-container { padding: 20px; max-width: 800px; margin: 0 auto; }
    .settings-header { margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 16px; }
    .settings-header h2 { margin: 0 0 8px 0; font-size: 20px; }
    .settings-desc { margin: 0; color: #666; font-size: 13px; }
    .input-group { margin-bottom: 16px; }
    .input-group label { display: block; font-weight: 500; margin-bottom: 6px; font-size: 13px; color: #333; }
    .input-group input { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    
    .my-channel-list-section { margin-top: 32px; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .section-header h3 { margin: 0; font-size: 16px; }
    .channel-list { display: grid; gap: 12px; }
    
    .my-channel-card { 
      border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; background: #fff; 
      display: flex; justify-content: space-between; align-items: center;
      transition: box-shadow 0.2s;
    }
    .my-channel-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .channel-info-main { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .channel-info-sub { font-size: 12px; color: #666; }
    
    .cp-btn-primary.small { padding: 6px 12px; font-size: 12px; }
    .cp-btn-secondary.small { padding: 4px 10px; font-size: 12px; }
    .action-btn { padding: 6px 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 13px; margin-left: 8px; }
    .action-btn:hover { background: #f5f5f5; }
    .action-btn.delete { color: #d32f2f; border-color: #ffcdd2; }
    .action-btn.delete:hover { background: #ffebee; }
    
    .integration-section { background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e9ecef; }
    .integration-section h4 { margin: 0 0 12px 0; font-size: 14px; color: #444; }
    
    .competitor-section { margin-top: 20px; }
    .competitor-item { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .competitor-item input { flex: 1; }
    .competitor-delete-btn { padding: 8px; color: #999; cursor: pointer; background: none; border: none; font-size: 18px; }
    .competitor-delete-btn:hover { color: #d32f2f; }
    
    /* 채널 상세 설정 모달 좌우 여백 추가 */
    #channel-detail-modal .cp-modal {
      max-width: min(90vw, 700px);
      margin: 0 auto;
      /* column layout so footer sits below body */
      display: flex;
      flex-direction: column;
      max-height: 90vh; /* keep modal within viewport */
    }
    .content-limit-grid { display:flex; gap:12px; flex-wrap:wrap; }
    .content-limit-grid .input-group { margin-bottom: 8px; }
    .content-limit-grid .settings-desc { margin-top: 6px; color: #666; font-size: 12px; }
    .content-limit-grid [title] { cursor: help; }
    #channel-detail-modal .cp-modal-body {
      padding: 24px;
      /* allow the modal body to scroll if content overflows */
      overflow-y: auto;
      flex: 1 1 auto;
      box-sizing: border-box;
      /* give bottom padding so controls are not hidden behind footer */
      padding-bottom: 96px;
    }
    #channel-detail-modal .cp-modal-footer {
      display:flex;
      justify-content:flex-end;
      gap:8px;
      padding:12px 20px;
      border-top:1px solid #eee;
      background: linear-gradient(180deg, rgba(255,255,255,0.7), #fff);
      z-index: 10;
      flex: 0 0 auto;
    }
  `;
  container.appendChild(style);

  let myChannelsData = []; // 로컬 상태 관리
  let loadRetryCount = 0;
  const MAX_RETRY_COUNT = 10; // 최대 10회 재시도 (약 10초)

  // 블로그 URL을 RSS URL로 변환하는 헬퍼 함수 (호스트 기반 우선 + 플랫폼 검증)
  function resolveBlogUrlToRss(url, selectedPlatform = null) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return null;
    }

    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname.toLowerCase();
      const origin = urlObj.origin;

      // 호스트 기반 판별 (가장 정확한 방법)
      let rssUrl = null;
      let _detectedPlatform = null;

      if (host.includes('tistory.com')) {
        rssUrl = `${origin}/rss`;
        _detectedPlatform = 'tistory';
      } else if (host.includes('blog.naver.com')) {
        const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
        if (pathMatch && pathMatch[1] && pathMatch[1] !== 'PostList.naver') {
          rssUrl = `https://rss.blog.naver.com/${pathMatch[1]}.xml`;
        } else {
          const blogId = new URLSearchParams(urlObj.search).get('blogId');
          if (blogId) {
            rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
          } else {
            rssUrl = `${origin}/rss`;
          }
        }
        _detectedPlatform = 'naver';
      } else if (host.includes('wordpress.com') || host.includes('medium.com')) {
        rssUrl = url.endsWith('/') ? `${url}feed` : `${url}/feed`;
        _detectedPlatform = 'wordpress';
      } else if (host.includes('blogspot.com') || host.includes('blogger.com')) {
        rssUrl = `${origin}/feeds/posts/default?alt=rss`;
        _detectedPlatform = 'blogger';
      } else {
        // 알 수 없는 호스트의 경우 플랫폼 선택에 따라 처리
        if (selectedPlatform && selectedPlatform !== 'direct') {
          switch (selectedPlatform) {
            case 'naver':
              rssUrl = `${origin}/rss`;
              break;
            case 'tistory':
              rssUrl = `${origin}/rss`;
              break;
            case 'wordpress':
              rssUrl = url.endsWith('/') ? `${url}feed` : `${url}/feed`;
              break;
            case 'blogger':
              rssUrl = `${origin}/feeds/posts/default?alt=rss`;
              break;
          }
        } else {
          // 기본값: /feed 또는 /rss 시도
          rssUrl = url.endsWith('/') ? `${url}feed` : `${url}/feed`;
        }
      }

      return rssUrl;
    } catch (e) {
      console.warn('[ChannelMode] URL 파싱 실패:', url, e);
      return null;
    }
  }

  // 채널 데이터 응답 처리 함수 (공통)
  function processChannelDataResponse(response) {
    Logger.debug('[ChannelMode] processChannelDataResponse - 응답 처리 시작:', {
      hasResponse: !!response,
      success: response?.success,
      hasData: !!response?.data,
      hasMyChannels: !!response?.data?.myChannels,
      hasBlogs: !!response?.data?.myChannels?.blogs,
      blogsLength: response?.data?.myChannels?.blogs?.length || 0,
    });

    // [수정] 성공 여부와 관계없이 UI 갱신 시도 (실패 시 에러 메시지 표시)
    if (response && response.success) {
      const youtubeApiKeyEl = container.querySelector('#youtube-api-key');
      const geminiApiKeyEl = container.querySelector('#gemini-api-key');
      if (youtubeApiKeyEl) youtubeApiKeyEl.value = response.data.youtubeApiKey || '';
      if (geminiApiKeyEl) geminiApiKeyEl.value = response.data.geminiApiKey || '';

      // 데이터 구조: { inputUrl, url, apiUrl, gaPropertyId, adSenseAccountId, competitors: [] }
      let blogs = [];
      // [수정] 데이터 경로 안전하게 접근
      if (
        response.data &&
        response.data.myChannels &&
        Array.isArray(response.data.myChannels.blogs)
      ) {
        blogs = response.data.myChannels.blogs;
      } else {
        blogs = [];
      }
      Logger.debug('[ChannelMode] processChannelDataResponse - 블로그 데이터 개수:', blogs.length);

      let needSave = false;

      myChannelsData = blogs.map((blog) => {
        Logger.debug('[ChannelMode] processChannelDataResponse - 블로그 변환:', blog);

        // UUID가 없으면 생성 (마이그레이션)
        let channelId = blog.id;
        if (!channelId) {
          channelId = crypto.randomUUID(); // 브라우저 내장 UUID 생성 함수
          needSave = true; // 저장 필요함 표시
        }

        return {
          id: channelId, // 👈 [핵심] 불변 ID
          inputUrl: blog.inputUrl || blog.url, // inputUrl 우선, 없으면 url (하위 호환성)
          url: blog.url || blog.inputUrl, // 하위 호환성 유지
          apiUrl: blog.apiUrl || null, // RSS URL
          platformType: blog.platformType || 'naver', // 플랫폼 타입 추가
          gaPropertyId: blog.gaPropertyId || '',
          adSenseAccountId: blog.adSenseAccountId || '',
          competitors: (blog.competitors || []).map((c) => {
            // competitors가 객체인 경우 inputUrl 추출, 문자열인 경우 그대로 사용
            return typeof c === 'object' && c.inputUrl ? c.inputUrl : c || '';
          }),
          contentLimit: blog.contentLimit || 10, // 내 채널 콘텐츠 수집 개수
          competitorContentLimit: blog.competitorContentLimit || 10, // 경쟁 채널 콘텐츠 수집 개수
        };
      });

      // 마이그레이션된 ID가 있다면 Firebase에 즉시 저장 (동기화)
      if (needSave) {
        Logger.debug('[ChannelMode] 🛠️ 레거시 채널에 UUID를 부여하고 저장합니다.');
        saveChannelsToFirebase();
      }

      Logger.debug(
        '[ChannelMode] processChannelDataResponse - 채널 데이터 로드 완료:',
        myChannelsData.length,
        '개',
        myChannelsData
      );

      // UI 업데이트
      const listEl = container.querySelector('#my-channel-list');
      Logger.debug('[ChannelMode] processChannelDataResponse - 목록 요소 확인:', !!listEl);

      renderMyChannels(); // [중요] 반드시 호출

      Logger.debug('[ChannelMode] processChannelDataResponse - renderMyChannels 호출 완료');
    } else {
      Logger.error('[ChannelMode] processChannelDataResponse - 채널 데이터 로드 실패:', response);
      const listEl = container.querySelector('#my-channel-list');
      if (listEl) {
        listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: #888; border: 1px dashed #ddd; border-radius: 8px;">데이터를 불러올 수 없습니다.<br>잠시 후 다시 시도해주세요.</div>`;
      }
      // [수정] 실패 시에도 renderMyChannels 호출하여 빈 상태 표시
      renderMyChannels();
    }
  }

  // 데이터 로드 함수 (인증 상태 확인 후 실행) - 실제 사용되는 함수
  function loadChannelData() {
    // 인증 상태 확인
    chrome.storage.local.get(['googleUserEmail'], (authResult) => {
      // 인증이 완료되지 않았으면 잠시 대기 후 재시도
      if (!authResult.googleUserEmail) {
        if (loadRetryCount < MAX_RETRY_COUNT) {
          loadRetryCount++;
          Logger.debug(
            `[ChannelMode] 인증 대기 중... (${loadRetryCount}/${MAX_RETRY_COUNT}) 1초 후 재시도`
          );
          setTimeout(() => {
            loadChannelData();
          }, 1000);
        } else {
          Logger.warn('[ChannelMode] 인증 대기 시간 초과. 로그인이 필요할 수 있습니다.');
          // 재시도 횟수 초기화
          loadRetryCount = 0;
        }
        return;
      }

      // 인증 완료 후 재시도 횟수 초기화
      loadRetryCount = 0;

      // 인증 완료 후 데이터 로드
      Logger.debug('[ChannelMode] loadChannelData - 인증 확인 완료, 데이터 요청 시작');

      // Promise 기반으로 변경하여 콜백 문제 해결
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      })
        .then((response) => {
          Logger.debug('[ChannelMode] loadChannelData - 응답 받음:', {
            hasResponse: !!response,
            success: response?.success,
            hasData: !!response?.data,
            hasMyChannels: !!response?.data?.myChannels,
            hasBlogs: !!response?.data?.myChannels?.blogs,
            blogsLength: response?.data?.myChannels?.blogs?.length || 0,
          });

          if (response && response.success) {
            const youtubeApiKeyEl = container.querySelector('#youtube-api-key');
            const geminiApiKeyEl = container.querySelector('#gemini-api-key');
            if (youtubeApiKeyEl) youtubeApiKeyEl.value = response.data.youtubeApiKey || '';
            if (geminiApiKeyEl) geminiApiKeyEl.value = response.data.geminiApiKey || '';

            // 데이터 구조: { inputUrl, url, apiUrl, gaPropertyId, adSenseAccountId, competitors: [] }
            const blogs = response.data.myChannels?.blogs || [];
            Logger.debug(
              '[ChannelMode] loadChannelData - 블로그 데이터 변환 시작, 개수:',
              blogs.length
            );

            myChannelsData = blogs.map((blog) => {
              Logger.debug('[ChannelMode] loadChannelData - 블로그 변환:', blog);
              return {
                inputUrl: blog.inputUrl || blog.url, // inputUrl 우선, 없으면 url (하위 호환성)
                url: blog.url || blog.inputUrl, // 하위 호환성 유지
                apiUrl: blog.apiUrl || null, // RSS URL
                gaPropertyId: blog.gaPropertyId || '',
                adSenseAccountId: blog.adSenseAccountId || '',
                competitors: (blog.competitors || []).map((c) => {
                  // competitors가 객체인 경우 inputUrl 추출, 문자열인 경우 그대로 사용
                  return typeof c === 'object' && c.inputUrl ? c.inputUrl : c || '';
                }),
                contentLimit: blog.contentLimit || 10, // 내 채널 콘텐츠 수집 개수
                competitorContentLimit: blog.competitorContentLimit || 10, // 경쟁 채널 콘텐츠 수집 개수
              };
            });

            Logger.debug(
              '[ChannelMode] loadChannelData - 채널 데이터 로드 완료:',
              myChannelsData.length,
              '개',
              myChannelsData
            );

            // UI 업데이트
            const listEl = container.querySelector('#my-channel-list');
            Logger.debug('[ChannelMode] loadChannelData - 목록 요소 확인:', !!listEl);

            renderMyChannels();

            Logger.debug('[ChannelMode] loadChannelData - renderMyChannels 호출 완료');
          } else {
            Logger.error('[ChannelMode] loadChannelData - 채널 데이터 로드 실패:', response);
            // 실패 시 재시도는 하지 않음 (인증은 완료되었으므로)
            const listEl = container.querySelector('#my-channel-list');
            if (listEl) {
              listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: #888; border: 1px dashed #ddd; border-radius: 8px;">데이터를 불러올 수 없습니다.<br>잠시 후 다시 시도해주세요.</div>`;
            }
          }
        })
        .catch((error) => {
          console.error('[ChannelMode] loadChannelData - 오류 발생:', error);
          const listEl = container.querySelector('#my-channel-list');
          if (listEl) {
            listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: #888; border: 1px dashed #ddd; border-radius: 8px;">데이터를 불러오는 중 오류가 발생했습니다.<br>${error.message}</div>`;
          }
        });
    });
  }

  // 채널 데이터 업데이트 메시지 리스너 (콜백이 실행되지 않는 경우 대비)
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.action === 'channel_data_updated' || msg.action === 'channels_data_updated') {
      console.log('[ChannelMode] 채널 데이터 업데이트 메시지 수신:', msg.data);

      // container가 유효한지 확인 (다른 모드로 전환된 경우 대비)
      const listEl = container.querySelector('#my-channel-list');
      if (!listEl) {
        Logger.debug('[ChannelMode] 채널 모드가 아닌 상태에서 메시지 수신, 무시');
        return false;
      }

      // 응답 데이터 구조 처리
      const responseData = {
        success: true,
        data: msg.data,
      };

      processChannelDataResponse(responseData);
    }

    // 다른 메시지는 처리하지 않음
    return false;
  });

  // 초기 데이터 로드
  loadChannelData();

  // 인증 상태 변경 감지하여 데이터 재로드
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.googleUserEmail) {
      const newValue = changes.googleUserEmail.newValue;
      const oldValue = changes.googleUserEmail.oldValue;

      if (newValue && !oldValue) {
        // 로그인: 새로 로그인한 경우 데이터 로드
        Logger.debug('[ChannelMode] 로그인 감지, 데이터 로드');
        loadRetryCount = 0;
        loadChannelData();
      } else if (!newValue && oldValue) {
        // 로그아웃: 로그아웃한 경우 데이터 초기화
        Logger.debug('[ChannelMode] 로그아웃 감지, 데이터 초기화');
        myChannelsData = [];
        renderMyChannels();

        // 모달이 열려있으면 초기화
        const modal = container.querySelector('#channel-detail-modal');
        if (modal && modal.style.display !== 'none') {
          const blogUrlEl = container.querySelector('#modal-blog-url');
          const gaIdEl = container.querySelector('#modal-ga-id');
          const adsenseIdEl = container.querySelector('#modal-adsense-id');
          const compListEl = container.querySelector('#modal-competitor-list');

          if (blogUrlEl) blogUrlEl.value = '';
          if (gaIdEl) gaIdEl.value = '';
          if (adsenseIdEl) adsenseIdEl.value = '';
          if (compListEl) {
            compListEl.innerHTML = '';
            addCompetitorInput('');
          }
          currentEditingIndex = -1;
        }
      } else if (newValue && oldValue && newValue !== oldValue) {
        // 사용자 변경: 다른 계정으로 로그인한 경우 데이터 재로드
        Logger.debug('[ChannelMode] 사용자 변경 감지, 데이터 재로드');
        loadRetryCount = 0;
        loadChannelData();
      }
    }
  });

  // 내 채널 목록 렌더링
  function renderMyChannels() {
    const listEl = container.querySelector('#my-channel-list');
    Logger.debug('[ChannelMode] renderMyChannels 호출:', {
      hasListEl: !!listEl,
      channelsCount: myChannelsData.length,
      channelsData: myChannelsData,
    });

    if (!listEl) {
      console.error('[ChannelMode] renderMyChannels - 목록 요소를 찾을 수 없습니다!');
      return;
    }

    listEl.innerHTML = '';

    // [수정] 데이터가 없는 경우 처리 강화
    if (!myChannelsData || myChannelsData.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: #888; border: 1px dashed #ddd; border-radius: 8px;">등록된 채널이 없습니다.<br>'+ 채널 추가' 버튼을 눌러 시작하세요.</div>`;
      return;
    }

    myChannelsData.forEach((channel, index) => {
      // inputUrl 우선, 없으면 url 사용 (하위 호환성)
      const displayUrl = channel.inputUrl || channel.url || '';
      const card = document.createElement('div');
      card.className = 'my-channel-card';
      card.innerHTML = `
        <div class="channel-info">
          <div class="channel-info-main">${displayUrl}</div>
          <div class="channel-info-sub">
            경쟁사: ${channel.competitors.length}개 | GA4: ${
              channel.gaPropertyId ? '✅' : '❌'
            } | AdSense: ${channel.adSenseAccountId ? '✅' : '❌'}
          </div>
        </div>
        <div class="channel-actions">
          <button class="action-btn edit-btn">⚙️ 관리</button>
          <button class="action-btn delete delete-btn">삭제</button>
        </div>
      `;

      // 수정 버튼
      card.querySelector('.edit-btn').addEventListener('click', () => openDetailModal(index));

      // 삭제 버튼
      card.querySelector('.delete-btn').addEventListener('click', async () => {
        if (
          confirm('이 채널을 삭제하시겠습니까? \n(작성한 모든 카드와 데이터가 영구 삭제됩니다)')
        ) {
          const channelToDelete = myChannelsData[index];
          const targetId = channelToDelete.id;
          const targetUrl = channelToDelete.inputUrl || channelToDelete.url;

          try {
            // 1. [Storage] 크롬 로컬 스토리지 청소 (동기화 보장)
            // activeChannelId와 로컬 캐시 데이터를 찾아서 지웁니다.
            await new Promise((resolve) => {
              chrome.storage.local.get(null, (items) => {
                const keysToRemove = [];

                // (A) 활성 채널 ID 삭제
                if (items.activeChannelId === targetId) {
                  keysToRemove.push('activeChannelId');
                  Logger.debug('🧹 [Storage] 활성 채널 ID 삭제 예약');
                }

                // (B) 로컬 분석 캐시 삭제 (analysisCache_URL...)
                // URL이 포함된 캐시 키를 찾아냅니다.
                if (targetUrl) {
                  const encodedUrl = btoa(targetUrl).replace(/=/g, ''); // 혹시 base64로 저장된 경우
                  Object.keys(items).forEach((key) => {
                    // 키에 URL이나 인코딩된 URL이 포함되어 있다면 삭제
                    if (key.includes(targetUrl) || (encodedUrl && key.includes(encodedUrl))) {
                      keysToRemove.push(key);
                    }
                  });
                }

                if (keysToRemove.length > 0) {
                  chrome.storage.local.remove(keysToRemove, () => {
                    Logger.debug('🧹 [Storage] 로컬 데이터 청소 완료:', keysToRemove);
                    resolve();
                  });
                } else {
                  resolve();
                }
              });
            });

            // 2. [UI] 목록에서 즉시 제거 (반응성)
            myChannelsData.splice(index, 1);
            renderMyChannels();

            // 3. [Background] Firebase 데이터 연쇄 삭제 요청 (Cascade Delete)
            if (targetId) {
              Logger.debug('[ChannelMode] Firebase에서 채널 삭제:', targetId);
              chrome.runtime.sendMessage(
                {
                  action: 'delete_channel',
                  id: targetId,
                  url: targetUrl,
                },
                (response) => {
                  if (response && response.success) {
                    console.log('[ChannelMode] 채널 삭제 완료');
                    showToast(`✅ 채널 삭제 완료 (삭제된 항목: ${response.count || 0}개)`);

                    // 4. [Sync] 변경된 채널 목록(myChannels)을 Firebase & Storage에 저장
                    saveChannelsToFirebase((saveResponse) => {
                      if (saveResponse && saveResponse.success) {
                        console.log('[ChannelMode] 삭제 후 채널 목록 저장 완료');
                      } else {
                        console.warn('[ChannelMode] 삭제 후 채널 목록 저장 실패:', saveResponse);
                      }
                    });
                  } else {
                    console.error('[ChannelMode] 채널 삭제 실패:', response);
                    showToast('❌ 삭제 실패: ' + (response?.error || '알 수 없는 오류'));

                    // 실패 시 로컬 데이터 복구
                    myChannelsData.splice(index, 0, channelToDelete);
                    renderMyChannels();
                  }
                }
              );
            } else {
              showToast('❌ 삭제 실패: 채널 ID가 없습니다.');
              // ID 없는 경우도 복구
              myChannelsData.splice(index, 0, channelToDelete);
              renderMyChannels();
            }
          } catch (err) {
            console.error('채널 삭제 중 오류:', err);
            showToast('❌ 삭제 중 오류가 발생했습니다.');
            // 오류 시 복구
            myChannelsData.splice(index, 0, channelToDelete);
            renderMyChannels();
          }
        }
      });

      listEl.appendChild(card);
    });
  }

  // 모달 관련 변수
  const modal = container.querySelector('#channel-detail-modal');
  let currentEditingIndex = -1;
  let gaPropertiesList = []; // GA4 속성 목록

  // GA4 드롭다운 업데이트 (공통 함수)
  function updateGa4Dropdown() {
    const gaSelectEl = container.querySelector('#modal-ga-select');
    const gaIdEl = container.querySelector('#modal-ga-id');

    if (gaSelectEl && gaPropertiesList.length > 0) {
      // 현재 input에 있는 값 저장
      const currentValue = gaIdEl ? gaIdEl.value : '';

      gaSelectEl.innerHTML = '<option value="">선택하세요</option>';
      gaPropertiesList.forEach((prop) => {
        const option = document.createElement('option');
        option.value = prop.id;
        option.textContent = `${prop.name} (${prop.id})`;
        // 현재 input 값과 일치하는 옵션 선택
        if (prop.id === currentValue) option.selected = true;
        gaSelectEl.appendChild(option);
      });
      gaSelectEl.style.display = 'block';
      if (gaIdEl) gaIdEl.style.display = 'none';
    } else {
      // GA4 속성이 없으면 input 필드 표시
      if (gaSelectEl) gaSelectEl.style.display = 'none';
      if (gaIdEl) gaIdEl.style.display = 'block';
    }
  }

  // 상세 모달 열기
  function openDetailModal(index) {
    console.log('[ChannelMode] openDetailModal 호출:', index);
    console.log('[ChannelMode] 모달 요소 (외부 변수):', modal);

    // 모달 요소를 다시 찾기 (container가 업데이트되었을 수 있음)
    const currentModal = container.querySelector('#channel-detail-modal');
    console.log('[ChannelMode] 모달 요소 (재검색):', currentModal);

    const targetModal = currentModal || modal;

    if (!targetModal) {
      console.error('[ChannelMode] 모달 요소를 찾을 수 없습니다!', {
        container: container,
        containerHTML: container.innerHTML.substring(0, 500),
      });
      return;
    }

    currentEditingIndex = index;
    const isNew = index === -1;

    // 모달 표시 (로딩 상태로 먼저 표시)
    targetModal.style.display = 'flex';

    // 기존 채널 편집 시 최신 데이터를 서버에서 다시 불러오기
    if (!isNew && index >= 0) {
      console.log('[ChannelMode] 기존 채널 편집 - 최신 데이터 불러오기');

      // 인증 상태 확인 후 데이터 로드
      chrome.storage.local.get(['googleUserEmail'], (authResult) => {
        if (!authResult.googleUserEmail) {
          console.warn('[ChannelMode] 인증되지 않음, 로컬 데이터 사용');
          // 인증이 안 되어 있어도 로컬 데이터로 모달 표시
          if (index >= 0 && index < myChannelsData.length) {
            populateModalWithData(myChannelsData[index], isNew);
          } else {
            showToast('❌ 채널 데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
            targetModal.style.display = 'none';
          }
          return;
        }

        // 인증 완료 후 최신 데이터 로드
        chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (response) => {
          if (response && response.success) {
            // 최신 데이터로 myChannelsData 업데이트
            const latestChannels = (response.data.myChannels?.blogs || []).map((blog) => ({
              inputUrl: blog.inputUrl || blog.url, // inputUrl 우선
              url: blog.url || blog.inputUrl, // 하위 호환성
              apiUrl: blog.apiUrl || null, // RSS URL
              platformType: blog.platformType || 'naver', // 플랫폼 타입 추가
              gaPropertyId: blog.gaPropertyId || '',
              adSenseAccountId: blog.adSenseAccountId || '',
              competitors: (blog.competitors || []).map((c) => {
                // competitors가 객체인 경우 inputUrl 추출, 문자열인 경우 그대로 사용
                return typeof c === 'object' && c.inputUrl ? c.inputUrl : c || '';
              }),
              contentLimit: blog.contentLimit || 10, // 내 채널 콘텐츠 수집 개수
              competitorContentLimit: blog.competitorContentLimit || 10, // 경쟁 채널 콘텐츠 수집 개수
            })); // myChannelsData 업데이트
            myChannelsData = latestChannels;

            // 인덱스가 유효한지 확인
            if (index >= 0 && index < myChannelsData.length) {
              populateModalWithData(myChannelsData[index], isNew);
            } else {
              console.error(
                '[ChannelMode] 인덱스가 유효하지 않습니다:',
                index,
                '채널 개수:',
                myChannelsData.length
              );
              showToast('❌ 채널 데이터를 불러올 수 없습니다.');
              targetModal.style.display = 'none';
            }
          } else {
            console.error('[ChannelMode] 채널 데이터 불러오기 실패:', response);
            // 실패해도 로컬 데이터로 시도
            if (index >= 0 && index < myChannelsData.length) {
              populateModalWithData(myChannelsData[index], isNew);
            } else {
              showToast('❌ 채널 데이터를 불러올 수 없습니다.');
              targetModal.style.display = 'none';
            }
          }
        });
      });
    } else {
      // 새 채널 추가인 경우 빈 데이터로 모달 채우기
      populateModalWithData(
        {
          url: '',
          platformType: 'naver',
          gaPropertyId: '',
          adSenseAccountId: '',
          competitors: [],
        },
        isNew
      );
    }
  }

  // 모달에 데이터 채우기 (공통 함수)
  function populateModalWithData(data, isNew) {
    const modalTitle = container.querySelector('.cp-modal-title');
    if (modalTitle) modalTitle.textContent = isNew ? '새 채널 추가' : '채널 상세 설정';
    const blogUrlEl = container.querySelector('#modal-blog-url');
    const platformSelectEl = container.querySelector('#modal-platform-select');
    const gaIdEl = container.querySelector('#modal-ga-id');
    const adsenseIdEl = container.querySelector('#modal-adsense-id');
    const contentLimitEl = container.querySelector('#modal-content-limit');
    const competitorContentLimitEl = container.querySelector('#modal-competitor-content-limit');
    // inputUrl 우선, 없으면 url 사용 (하위 호환성)
    if (blogUrlEl) blogUrlEl.value = data.inputUrl || data.url || '';
    if (platformSelectEl) platformSelectEl.value = data.platformType || 'naver';
    if (gaIdEl) gaIdEl.value = data.gaPropertyId || '';
    if (adsenseIdEl) adsenseIdEl.value = data.adSenseAccountId || '';
    if (contentLimitEl) contentLimitEl.value = data.contentLimit || 10;
    if (competitorContentLimitEl)
      competitorContentLimitEl.value = data.competitorContentLimit || 10;

    // Google 로그인 상태 확인 (GA4 목록도 함께 로드)
    checkGoogleAuthStatus();

    // GA4 드롭다운은 checkGoogleAuthStatus()에서 자동으로 업데이트됨
    // updateGa4Dropdown(data.gaPropertyId); // 제거됨

    // 경쟁사 리스트 렌더링
    const compListEl = container.querySelector('#modal-competitor-list');
    if (compListEl) {
      compListEl.innerHTML = '';
      console.log('[ChannelMode] 경쟁사 리스트 렌더링 시작, 개수:', data.competitors?.length || 0);
      if (data.competitors && Array.isArray(data.competitors) && data.competitors.length > 0) {
        data.competitors.forEach((url, index) => {
          console.log(`[ChannelMode] 경쟁사 ${index + 1} 추가:`, url);
          addCompetitorInput(url);
        });
      } else {
        // 빈 입력칸 하나 추가 (UX)
        console.log('[ChannelMode] 경쟁사가 없으므로 빈 입력칸 추가');
        addCompetitorInput('');
      }

      // 모달이 열릴 때 경쟁사 추가 버튼이 있는지 확인하고 이벤트 리스너 재등록
      const addCompetitorBtn = container.querySelector('#modal-add-competitor-btn');
      if (addCompetitorBtn) {
        // 기존 리스너 제거 후 재등록 (중복 방지)
        const newBtn = addCompetitorBtn.cloneNode(true);
        addCompetitorBtn.parentNode.replaceChild(newBtn, addCompetitorBtn);
        newBtn.addEventListener('click', (e) => {
          console.log('[ChannelMode] 경쟁사 추가 버튼 클릭됨 (모달 열림 후 재등록)');
          e.preventDefault();
          e.stopPropagation();
          addCompetitorInput('');
        });
        console.log('[ChannelMode] 경쟁사 추가 버튼 이벤트 리스너 재등록 완료');
      } else {
        console.error('[ChannelMode] 모달이 열렸지만 경쟁사 추가 버튼을 찾을 수 없습니다!');
      }
    } else {
      console.error('[ChannelMode] 경쟁사 리스트 요소를 찾을 수 없습니다!');
    }
  }

  // Google 로그인 상태 확인
  function checkGoogleAuthStatus() {
    chrome.storage.local.get(['googleUserEmail', 'gaProperties', 'adSenseAccountId'], (result) => {
      const authStatusEl = container.querySelector('#google-auth-status');
      const authEmailEl = container.querySelector('#google-auth-email');
      const loginBtn = container.querySelector('#modal-google-login-btn');

      if (result.googleUserEmail) {
        if (authStatusEl) authStatusEl.style.display = 'block';
        if (authEmailEl) authEmailEl.textContent = `✅ ${result.googleUserEmail}`;
        if (loginBtn) loginBtn.style.display = 'none';

        // GA4 속성 목록 저장 및 드롭다운 업데이트
        if (result.gaProperties && Array.isArray(result.gaProperties)) {
          gaPropertiesList = result.gaProperties;
          updateGa4Dropdown(); // GA4 드롭다운 즉시 업데이트
        }

        // AdSense 계정 ID 자동 입력 (모달이 열려있을 때만)
        if (result.adSenseAccountId && modal && modal.style.display !== 'none') {
          const adsenseIdEl = container.querySelector('#modal-adsense-id');
          if (adsenseIdEl && !adsenseIdEl.value) {
            adsenseIdEl.value = result.adSenseAccountId;
          }
        }
      } else {
        if (authStatusEl) authStatusEl.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'inline-flex';
      }
    });
  }

  // 경쟁사 입력칸 추가
  function addCompetitorInput(value = '') {
    const listEl = container.querySelector('#modal-competitor-list');
    if (!listEl) {
      console.error('[ChannelMode] 경쟁사 리스트 요소를 찾을 수 없습니다!');
      return;
    }
    const div = document.createElement('div');
    div.className = 'competitor-item';
    div.innerHTML = `
      <input type="text" class="competitor-input" value="${value}" placeholder="경쟁사 블로그 URL">
      <button class="competitor-delete-btn" title="삭제">×</button>
    `;
    const deleteBtn = div.querySelector('.competitor-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        console.log('[ChannelMode] 경쟁사 입력칸 삭제');
        div.remove();
      });
    }
    listEl.appendChild(div);
    console.log('[ChannelMode] 경쟁사 입력칸 추가됨:', value || '(빈 값)');
  }

  // 이벤트 리스너
  const addChannelBtn = container.querySelector('#add-my-channel-btn');
  console.log('[ChannelMode] 채널 추가 버튼 찾기:', addChannelBtn);
  if (addChannelBtn) {
    addChannelBtn.addEventListener('click', () => {
      console.log('[ChannelMode] 채널 추가 버튼 클릭됨');
      const modal = container.querySelector('#channel-detail-modal');
      console.log('[ChannelMode] 모달 요소 찾기:', modal);
      openDetailModal(-1);
    });
  } else {
    console.error('[ChannelMode] 채널 추가 버튼을 찾을 수 없습니다!');
  }

  // 경쟁사 추가 버튼 이벤트 리스너 (이벤트 위임 사용)
  // 모달이 동적으로 생성되거나 업데이트될 수 있으므로 이벤트 위임 사용
  container.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'modal-add-competitor-btn') {
      console.log('[ChannelMode] 경쟁사 추가 버튼 클릭됨');
      e.preventDefault();
      e.stopPropagation();
      addCompetitorInput('');
    }

    // 경쟁사 삭제 버튼도 이벤트 위임으로 처리
    if (e.target && e.target.classList.contains('competitor-delete-btn')) {
      e.preventDefault();
      e.stopPropagation();

      const competitorItem = e.target.closest('.competitor-item');
      if (competitorItem) {
        const input = competitorItem.querySelector('input');
        const urlToDelete = input ? input.value.trim() : '';

        // 1. UI에서 즉시 제거 (반응성)
        competitorItem.remove();

        // 2. 백그라운드에서 캐시 데이터 삭제 (URL이 있는 경우만)
        if (urlToDelete) {
          console.log(`[ChannelMode] 경쟁사 캐시 삭제 요청: ${urlToDelete}`);
          try {
            const userId = await getCurrentUserId();
            // 서비스 호출 (비동기로 실행되므로 UI 멈춤 없음)
            deleteCompetitorData(urlToDelete, userId).then((result) => {
              console.log(`[ChannelMode] 캐시 삭제 완료: ${result.deletedCount}건`);
            });
          } catch (err) {
            console.warn('[ChannelMode] 캐시 삭제 실패:', err);
          }
        }
      }
    }
  });

  // 플랫폼 선택 이벤트 리스너
  const platformSelectEl = container.querySelector('#modal-platform-select');
  if (platformSelectEl) {
    platformSelectEl.addEventListener('change', (e) => {
      const selectedPlatform = e.target.value;
      const urlGuideText = container.querySelector('#url-guide-text');

      // 플랫폼별 가이드 텍스트 변경
      switch (selectedPlatform) {
        case 'naver':
          urlGuideText.textContent =
            '네이버 블로그 메인 주소를 입력하세요. (예: https://blog.naver.com/myid)';
          break;
        case 'tistory':
          urlGuideText.textContent =
            '티스토리 블로그 메인 주소를 입력하세요. (예: https://myblog.tistory.com)';
          break;
        case 'wordpress':
          urlGuideText.textContent =
            '워드프레스 블로그 메인 주소를 입력하세요. (예: https://myblog.com)';
          break;
        case 'blogger':
          urlGuideText.textContent =
            '구글 블로거 메인 주소를 입력하세요. (예: https://myblog.blogspot.com)';
          break;
        case 'direct':
          urlGuideText.textContent =
            'RSS 피드 URL을 직접 입력하세요. (예: https://myblog.com/feed)';
          break;
        default:
          urlGuideText.textContent = '블로그 메인 주소를 입력하세요. (자동으로 RSS를 찾습니다)';
      }
    });
  }

  // URL 입력 검증 이벤트 리스너
  const blogUrlInput = container.querySelector('#modal-blog-url');
  if (blogUrlInput) {
    blogUrlInput.addEventListener('blur', () => {
      const url = blogUrlInput.value.trim();
      const selectedPlatform = platformSelectEl ? platformSelectEl.value : null;

      if (url && selectedPlatform && selectedPlatform !== 'direct') {
        try {
          const urlObj = new URL(url);
          const host = urlObj.hostname.toLowerCase();

          // 플랫폼과 호스트 불일치 검증
          let expectedPlatform = null;
          if (host.includes('blog.naver.com')) expectedPlatform = 'naver';
          else if (host.includes('tistory.com')) expectedPlatform = 'tistory';
          else if (host.includes('wordpress.com') || host.includes('medium.com'))
            expectedPlatform = 'wordpress';
          else if (host.includes('blogspot.com') || host.includes('blogger.com'))
            expectedPlatform = 'blogger';

          if (expectedPlatform && expectedPlatform !== selectedPlatform) {
            const platformNames = {
              naver: '네이버',
              tistory: '티스토리',
              wordpress: '워드프레스',
              blogger: '구글 블로거',
            };

            showToast(
              `⚠️ URL이 ${platformNames[expectedPlatform]} 플랫폼으로 보입니다. 플랫폼 선택을 확인해주세요.`
            );
          }
        } catch (e) {
          // URL 파싱 실패 시 무시
        }
      }
    });
  }

  const modalCloseBtn = container.querySelector('.cp-modal-close');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
  }

  const modalCancelBtn = container.querySelector('#modal-cancel-btn');
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
  }

  // Google 로그인 버튼
  const googleLoginBtn = container.querySelector('#modal-google-login-btn');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
      googleLoginBtn.disabled = true;
      googleLoginBtn.textContent = '로그인 중...';

      chrome.runtime.sendMessage({ action: 'start_google_auth' }, (response) => {
        googleLoginBtn.disabled = false;
        googleLoginBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <g fill="#000" fill-rule="evenodd">
              <path d="M17.64 9.2045c0-.6371-.0573-1.2516-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0772-1.7955 2.7164v2.2581h2.9087c1.7023-1.5668 2.6836-3.8741 2.6836-6.6149z" fill="#4285F4"/>
              <path d="M9 18c2.4297 0 4.4673-.795 5.9564-2.1636l-2.9087-2.2581c-.8064.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0364-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
              <path d="M3.9636 10.7273c-.18-.54-.2827-1.1168-.2827-1.7273s.1027-1.1873.2827-1.7273V4.9409L.9573 4.9409C.3477 6.175.0009 7.5409.0009 9s.3468 2.825.9564 4.0591l3.0063-2.3318z" fill="#FBBC05"/>
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5814-2.5814C13.4632.8918 11.4255 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9409L3.9636 7.2727C4.6718 5.1455 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
            </g>
          </svg>
          Google 로그인
        `;

        if (response && response.success) {
          // GA4 속성 목록 저장 (응답 구조에 따라 처리)
          // response.data가 있으면 data 내부에서, 없으면 직접 접근
          const gaProperties =
            response.data?.gaProperties || response.gaProperties || response.properties;
          const adSenseAccountId =
            response.data?.adSenseAccountId || response.adSenseAccountId || response.adSenseId;

          if (gaProperties && Array.isArray(gaProperties)) {
            gaPropertiesList = gaProperties;
            updateGa4Dropdown();
          }

          // AdSense 계정 ID 자동 입력
          if (adSenseAccountId) {
            const adsenseIdEl = container.querySelector('#modal-adsense-id');
            if (adsenseIdEl && !adsenseIdEl.value) {
              adsenseIdEl.value = adSenseAccountId;
            }
          }

          // 로그인 상태 UI 즉시 업데이트 (response.data에서 직접 사용)
          const authStatusEl = container.querySelector('#google-auth-status');
          const authEmailEl = container.querySelector('#google-auth-email');
          const loginBtn = container.querySelector('#modal-google-login-btn');

          if (response.data && response.data.email) {
            if (authStatusEl) authStatusEl.style.display = 'block';
            if (authEmailEl) authEmailEl.textContent = `✅ ${response.data.email}`;
            if (loginBtn) loginBtn.style.display = 'none';
          }

          // 추가로 storage에서도 확인 (백업)
          checkGoogleAuthStatus();

          // 🔥 로그인 성공 후 Firebase에서 채널 데이터 다시 불러오기
          // storage 변경이 완료될 때까지 기다린 후 데이터 로드
          console.log('[ChannelMode] Google 로그인 성공 - storage 변경 확인 후 채널 데이터 재로드');

          // storage에 googleUserEmail이 저장될 때까지 확인
          const checkStorageAndLoad = (retryCount = 0) => {
            chrome.storage.local.get(['googleUserEmail'], (result) => {
              if (result.googleUserEmail) {
                // storage에 이메일이 저장되었으면 데이터 로드
                console.log('[ChannelMode] storage 확인 완료, 채널 데이터 로드 시작');
                loadChannelDataAfterLogin();
              } else if (retryCount < 5) {
                // 아직 저장되지 않았으면 재시도 (최대 5회)
                console.log(`[ChannelMode] storage 대기 중... (${retryCount + 1}/5)`);
                setTimeout(() => checkStorageAndLoad(retryCount + 1), 200);
              } else {
                // 재시도 횟수 초과 시 강제 로드
                console.warn('[ChannelMode] storage 확인 시간 초과, 강제 로드');
                loadChannelDataAfterLogin();
              }
            });
          };

          checkStorageAndLoad();

          alert('✅ Google 계정 연동이 완료되었습니다!');
        } else {
          alert('❌ Google 로그인 실패: ' + (response?.error || '알 수 없는 오류'));
        }
      });
    });
  }

  // 로그인 후 채널 데이터 로드 함수 (별도 함수로 분리)
  function loadChannelDataAfterLogin() {
    console.log('[ChannelMode] 로그인 후 채널 데이터 로드 시작');
    chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (channelResponse) => {
      console.log('[ChannelMode] 채널 데이터 응답:', channelResponse);
      if (channelResponse && channelResponse.success) {
        console.log('[ChannelMode] 응답 데이터 구조:', {
          hasData: !!channelResponse.data,
          hasMyChannels: !!channelResponse.data?.myChannels,
          hasBlogs: !!channelResponse.data?.myChannels?.blogs,
          blogsLength: channelResponse.data?.myChannels?.blogs?.length || 0,
          blogsData: channelResponse.data?.myChannels?.blogs,
        });

        // 최신 데이터로 myChannelsData 업데이트
        const latestChannels = (channelResponse.data.myChannels?.blogs || []).map((blog) => {
          console.log('[ChannelMode] 블로그 데이터 변환:', blog);
          return {
            inputUrl: blog.inputUrl || blog.url, // inputUrl 우선
            url: blog.url || blog.inputUrl, // 하위 호환성
            apiUrl: blog.apiUrl || null, // RSS URL
            gaPropertyId: blog.gaPropertyId || '',
            adSenseAccountId: blog.adSenseAccountId || '',
            competitors: (blog.competitors || []).map((c) => {
              return typeof c === 'object' && c.inputUrl ? c.inputUrl : c || '';
            }),
            contentLimit: blog.contentLimit || 10, // 내 채널 콘텐츠 수집 개수
            competitorContentLimit: blog.competitorContentLimit || 10, // 경쟁 채널 콘텐츠 수집 개수
          };
        });

        myChannelsData = latestChannels;
        console.log(
          '[ChannelMode] 채널 데이터 재로드 완료:',
          myChannelsData.length,
          '개',
          myChannelsData
        );

        // 메인 채널 목록 업데이트
        renderMyChannels();

        // 모달이 열려있으면 채널 데이터를 모달에 표시
        const modal = container.querySelector('#channel-detail-modal');
        const isModalOpen = modal && modal.style.display !== 'none' && modal.style.display !== '';

        console.log('[ChannelMode] 모달 상태 확인:', {
          modal: !!modal,
          display: modal?.style.display,
          isModalOpen: isModalOpen,
          currentEditingIndex: currentEditingIndex,
          channelsCount: myChannelsData.length,
        });

        if (isModalOpen) {
          if (currentEditingIndex >= 0 && currentEditingIndex < myChannelsData.length) {
            // 편집 중인 채널이 있고 데이터가 있으면 해당 채널의 최신 데이터로 모달 업데이트
            console.log(
              '[ChannelMode] 모달이 열려있음 - 편집 중인 채널 정보 업데이트:',
              currentEditingIndex
            );
            populateModalWithData(myChannelsData[currentEditingIndex], false);
          } else if (myChannelsData.length > 0) {
            // 편집 중인 채널이 없지만 데이터가 있으면 첫 번째 채널을 모달에 표시
            console.log('[ChannelMode] 모달이 열려있음 - 첫 번째 채널 정보 표시');
            currentEditingIndex = 0;
            populateModalWithData(myChannelsData[0], false);
          } else {
            // 채널 데이터가 없으면 새 채널 추가 모드로 표시
            console.log('[ChannelMode] 모달이 열려있지만 채널 데이터 없음 - 새 채널 모드');
            currentEditingIndex = -1;
            populateModalWithData(
              {
                inputUrl: '',
                url: '',
                apiUrl: null,
                gaPropertyId: '',
                adSenseAccountId: '',
                competitors: [],
              },
              true
            );
          }
        } else {
          console.log('[ChannelMode] 모달이 닫혀있음 - 메인 목록만 업데이트');
        }
      } else {
        console.error('[ChannelMode] 채널 데이터 재로드 실패:', channelResponse);
        // 실패 시 재시도 (사용자 ID가 아직 업데이트되지 않았을 수 있음)
        setTimeout(() => {
          console.log('[ChannelMode] 채널 데이터 재로드 재시도');
          loadChannelDataAfterLogin();
        }, 1000);
      }
    });
  }

  // Google 로그아웃 버튼
  const googleLogoutBtn = container.querySelector('#modal-google-logout-btn');
  if (googleLogoutBtn) {
    googleLogoutBtn.addEventListener('click', () => {
      if (confirm('Google 계정 연동을 해제하시겠습니까?')) {
        chrome.runtime.sendMessage({ action: 'revoke_google_auth' }, (response) => {
          if (response && response.success) {
            gaPropertiesList = [];
            checkGoogleAuthStatus();

            // GA4 드롭다운 숨기기
            const gaSelectEl = container.querySelector('#modal-ga-select');
            const gaIdEl = container.querySelector('#modal-ga-id');
            if (gaSelectEl) gaSelectEl.style.display = 'none';
            if (gaIdEl) {
              gaIdEl.style.display = 'block';
              gaIdEl.value = '';
            }

            // AdSense ID 초기화
            const adsenseIdEl = container.querySelector('#modal-adsense-id');
            if (adsenseIdEl) adsenseIdEl.value = '';

            // 🔥 로그아웃 시 Firebase에서 가져온 채널 정보 완전 초기화
            console.log('[ChannelMode] Google 로그아웃 - 채널 정보 완전 초기화');

            // 1. myChannelsData 초기화 (Firebase 데이터이므로)
            myChannelsData = [];

            // 2. 모달이 열려있으면 모든 필드 초기화
            const modal = container.querySelector('#channel-detail-modal');
            const isModalOpen = modal && modal.style.display !== 'none';

            if (isModalOpen) {
              // 블로그 URL 초기화 (Firebase에서 가져온 데이터이므로)
              const blogUrlEl = container.querySelector('#modal-blog-url');
              if (blogUrlEl) blogUrlEl.value = '';

              // GA4, AdSense는 이미 위에서 초기화됨

              // 경쟁사 목록 초기화 (Firebase에서 가져온 데이터이므로)
              const compListEl = container.querySelector('#modal-competitor-list');
              if (compListEl) {
                compListEl.innerHTML = '';
                // 빈 입력칸 하나만 남김
                addCompetitorInput('');
                console.log('[ChannelMode] 경쟁사 목록 초기화 완료');
              }

              // 편집 인덱스 초기화
              currentEditingIndex = -1;
            }

            // 3. 메인 채널 목록 초기화 (빈 상태로 렌더링)
            renderMyChannels();

            // 4. API 키 필드도 초기화 (선택사항 - 사용자가 입력한 값이므로 유지할 수도 있음)
            // 필요시 아래 주석 해제
            // const youtubeApiKeyEl = container.querySelector("#youtube-api-key");
            // const geminiApiKeyEl = container.querySelector("#gemini-api-key");
            // if (youtubeApiKeyEl) youtubeApiKeyEl.value = "";
            // if (geminiApiKeyEl) geminiApiKeyEl.value = "";

            console.log('[ChannelMode] 모든 채널 정보 초기화 완료');
            alert('✅ Google 계정 연동이 해제되었습니다. 채널 정보가 초기화되었습니다.');
          }
        });
      }
    });
  }

  // GA4 드롭다운 변경 시 입력 필드에 값 복사
  const gaSelectEl = container.querySelector('#modal-ga-select');
  if (gaSelectEl) {
    gaSelectEl.addEventListener('change', (e) => {
      const gaIdEl = container.querySelector('#modal-ga-id');
      if (gaIdEl) gaIdEl.value = e.target.value;
    });
  }

  // 플랫폼 선택에 따른 가이드 텍스트 변경
  const platformSelect = container.querySelector('#modal-platform-select');
  const urlInput = container.querySelector('#modal-blog-url');
  const guideText = container.querySelector('#url-guide-text');

  if (platformSelect) {
    platformSelect.addEventListener('change', (e) => {
      const type = e.target.value;
      if (type === 'direct') {
        urlInput.placeholder = 'https://example.com/feed.xml';
        guideText.textContent = '❗ RSS 피드의 전체 주소를 정확하게 입력해야 합니다.';
      } else if (type === 'naver') {
        urlInput.placeholder = 'https://blog.naver.com/아이디';
        guideText.textContent = '네이버 블로그 메인 주소를 입력하세요.';
      } else if (type === 'tistory') {
        urlInput.placeholder = 'https://myblog.tistory.com';
        guideText.textContent = '티스토리 블로그 메인 주소를 입력하세요. (커스텀 도메인도 지원)';
      } else if (type === 'wordpress') {
        urlInput.placeholder = 'https://myblog.com';
        guideText.textContent = '워드프레스 블로그 메인 주소를 입력하세요. (커스텀 도메인도 지원)';
      } else if (type === 'blogger') {
        urlInput.placeholder = 'https://myblog.blogspot.com';
        guideText.textContent = '구글 블로거 메인 주소를 입력하세요. (커스텀 도메인도 지원)';
      } else {
        urlInput.placeholder = 'https://blog.example.com';
        guideText.textContent = '블로그 메인 주소를 입력하세요.';
      }
    });
  }

  // URL 입력 검증 이벤트 리스너
  if (urlInput) {
    urlInput.addEventListener('blur', () => {
      const url = urlInput.value.trim();
      const selectedPlatform = platformSelect ? platformSelect.value : null;

      if (url && selectedPlatform && selectedPlatform !== 'direct') {
        try {
          const urlObj = new URL(url);
          const host = urlObj.hostname.toLowerCase();

          // 호스트 기반 플랫폼 판별
          let detectedPlatform = null;
          let isCustomDomain = false;

          if (host.includes('blog.naver.com')) detectedPlatform = 'naver';
          else if (host.includes('tistory.com')) detectedPlatform = 'tistory';
          else if (host.includes('wordpress.com') || host.includes('medium.com'))
            detectedPlatform = 'wordpress';
          else if (host.includes('blogspot.com') || host.includes('blogger.com'))
            detectedPlatform = 'blogger';
          else {
            // 커스텀 도메인 (하위 도메인 등)의 경우 플랫폼 선택이 중요
            isCustomDomain = true;
          }

          // 플랫폼 불일치 검증 (커스텀 도메인은 제외)
          if (!isCustomDomain && detectedPlatform && detectedPlatform !== selectedPlatform) {
            const platformNames = {
              naver: '네이버',
              tistory: '티스토리',
              wordpress: '워드프레스',
              blogger: '구글 블로거',
            };

            showToast(
              `⚠️ URL이 ${platformNames[detectedPlatform]} 플랫폼으로 보입니다. 플랫폼 선택을 확인해주세요.`
            );
          } else if (isCustomDomain) {
            // 커스텀 도메인 안내
            const platformNames = {
              wordpress: '워드프레스',
              blogger: '구글 블로거',
              tistory: '티스토리',
              naver: '네이버',
            };

            if (platformNames[selectedPlatform]) {
              showToast(
                `ℹ️ 커스텀 도메인 감지됨. ${platformNames[selectedPlatform]} RSS 경로를 적용합니다.`
              );
            }
          }
        } catch (e) {
          // URL 파싱 실패 시 무시
        }
      }
    });
  }

  // (중복 제거) 해당 파일 상단에 이미 정의된 resolveBlogUrlToRss를 사용합니다.

  // 모달 적용 버튼 (임시 저장)
  const modalApplyBtn = container.querySelector('#modal-apply-btn');
  if (modalApplyBtn) {
    modalApplyBtn.addEventListener('click', async () => {
      const blogUrlEl = container.querySelector('#modal-blog-url');
      const platformSelect = container.querySelector('#modal-platform-select');
      const gaIdEl = container.querySelector('#modal-ga-id');
      const adsenseIdEl = container.querySelector('#modal-adsense-id');
      const contentLimitEl = container.querySelector('#modal-content-limit');
      const competitorContentLimitEl = container.querySelector('#modal-competitor-content-limit');

      if (!blogUrlEl) return;
      const url = blogUrlEl.value.trim();
      const platformType = platformSelect ? platformSelect.value : 'naver';

      if (!url) {
        showToast('❌ 블로그 URL은 필수입니다.');
        blogUrlEl.focus();
        return;
      }

      // [체크리스트 4-3] URL 유효성 검사
      try {
        const urlObj = new URL(url);
        if (!urlObj.protocol.startsWith('http')) {
          showToast('❌ URL은 http:// 또는 https://로 시작해야 합니다.');
          blogUrlEl.focus();
          return;
        }
      } catch (e) {
        showToast('❌ 유효한 URL 형식이 아닙니다. (예: https://blog.naver.com/myid)');
        blogUrlEl.focus();
        return;
      }

      // GA4 ID는 드롭다운 또는 입력 필드에서 가져오기
      const gaSelectEl = container.querySelector('#modal-ga-select');
      const gaId =
        gaSelectEl && gaSelectEl.style.display !== 'none'
          ? gaSelectEl.value.trim()
          : gaIdEl
            ? gaIdEl.value.trim()
            : '';
      // [체크리스트 5] AdSense ID 저장 시 공백 제거 및 pub- 접두사 검증
      let adsenseId = adsenseIdEl ? adsenseIdEl.value.trim() : '';
      if (adsenseId && !adsenseId.startsWith('pub-')) {
        // pub- 접두사가 없으면 자동 추가 (사용자가 숫자만 입력한 경우 대비)
        if (/^\d+$/.test(adsenseId)) {
          adsenseId = `pub-${adsenseId}`;
        }
      }

      // 콘텐츠 수집 제한 설정
      const contentLimit = parseInt(contentLimitEl ? contentLimitEl.value : '10') || 10;
      const competitorContentLimit =
        parseInt(competitorContentLimitEl ? competitorContentLimitEl.value : '10') || 10;

      // 경쟁사 목록 수집
      const competitorInputs = container.querySelectorAll('.competitor-input');
      const competitors = Array.from(competitorInputs)
        .map((input) => input.value.trim())
        .filter((val) => val !== ''); // 빈 값 제거

      // RSS URL 생성 (플랫폼 타입 전달)
      const apiUrl = resolveBlogUrlToRss(url, platformType);

      if (!apiUrl) {
        showToast("❌ RSS 주소를 생성할 수 없습니다. URL을 확인하거나 '직접 입력'을 사용하세요.");
        return;
      }

      // [변경 감지 로직 시작]
      const oldId = currentEditingIndex === -1 ? null : myChannelsData[currentEditingIndex].id;

      // 1. ID 결정 로직
      // 만약 ID를 변경하는 UI가 있다면 여기서 newId를 가져오겠지만,
      // 지금은 예시로 '기존 ID 유지' 또는 '새로 생성' 로직을 따릅니다.
      // 사용자가 강제로 ID를 바꾸는 상황을 가정합니다.

      let newId;
      if (currentEditingIndex === -1) {
        newId = crypto.randomUUID(); // 신규 생성
      } else {
        newId = myChannelsData[currentEditingIndex].id; // 기본은 유지

        // [핵심] 만약 어떤 이유로 ID가 변경되었다면? (예: url 변경 시 ID도 재발급 정책 등)
        // 여기서는 예시로 'url이 바뀌면 ID도 바뀐다'는 가정을 해보겠습니다. (실제로는 추천하지 않음)
        // if (url !== myChannelsData[currentEditingIndex].url) {
        //    newId = crypto.randomUUID();
        // }
      }

      // 2. 마이그레이션 실행 (수정 모드이고, ID가 달라졌을 때만)
      if (currentEditingIndex !== -1 && oldId && newId && oldId !== newId) {
        // 사용자에게 알림 (선택 사항)
        const confirmMigration = confirm(
          '채널 ID가 변경되었습니다. 기존 데이터를 새 채널로 이동하시겠습니까?'
        );
        if (confirmMigration) {
          showToast('🔄 데이터 이관 중...');
          await migrateChannelIdCascade(oldId, newId);
        }
      }

      const newData = {
        // 신규 생성 시 UUID 부여, 수정 시 기존 ID 유지
        id: newId, // 결정된 ID 사용
        inputUrl: url,
        url: url,
        apiUrl: apiUrl, // 정확하게 생성된 RSS URL
        platformType: platformType, // (선택사항) 나중에 수정 시 UI 복원용으로 저장해두면 좋음
        gaPropertyId: gaId,
        adSenseAccountId: adsenseId,
        contentLimit: contentLimit,
        competitorContentLimit: competitorContentLimit,
        competitors: competitors,
      };

      if (currentEditingIndex === -1) {
        myChannelsData.push(newData);
      } else {
        myChannelsData[currentEditingIndex] = newData;
      }

      renderMyChannels();
      if (modal) modal.style.display = 'none';

      // 즉시 저장: 상세 모달에서 적용을 누르면 백그라운드에 저장하고
      // 후속 로직(헤더 갱신, 활성 채널 자동 선택 및 대시보드 이동)을 실행합니다.
      saveChannelsToFirebase((response) => {
        if (response && response.success) {
          showToast('✅ 채널이 저장되었습니다.');

          const shadowRoot =
            container.closest('#content-pilot-host')?.shadowRoot ||
            document.querySelector('#content-pilot-host')?.shadowRoot;
          if (shadowRoot) {
            import('./header.js').then((module) => {
              module.addHeaderEventListeners(shadowRoot);
            });
          }

          // 활성 채널이 없으면 첫 번째 채널을 활성화하고 대시보드로 이동
          chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (channelResponse) => {
            const myBlogs = channelResponse?.data?.myChannels?.blogs || [];
            chrome.storage.local.get('activeChannelId', (res) => {
              const activeChannelId = res.activeChannelId;
              if (!activeChannelId && myBlogs.length > 0) {
                const firstChannel = myBlogs[0];
                const firstChannelId =
                  firstChannel.id ||
                  (firstChannel.apiUrl ? btoa(firstChannel.apiUrl).replace(/=/g, '') : '');

                if (firstChannelId) {
                  chrome.storage.local.set({ activeChannelId: firstChannelId }, () => {
                    const shadowRoot =
                      container.closest('#content-pilot-host')?.shadowRoot ||
                      document.querySelector('#content-pilot-host')?.shadowRoot;
                    if (shadowRoot) {
                      const mainArea = shadowRoot.querySelector('#cp-main-area');
                      const dashboardTab = shadowRoot.querySelector('[data-key="dashboard"]');

                      if (mainArea && dashboardTab) {
                        shadowRoot
                          .querySelectorAll('.cp-mode-tab')
                          .forEach((tab) => tab.classList.remove('active'));
                        dashboardTab.classList.add('active');

                        import('./dashboardMode.js').then((module) => {
                          module.renderDashboard(mainArea);
                          module.addDashboardEventListeners(mainArea);
                        });

                        import('./header.js').then((module) => {
                          module.addHeaderEventListeners(shadowRoot);
                        });

                        showToast('✅ 첫 번째 채널이 선택되었습니다. 대시보드로 이동합니다.');
                      }
                    }
                  });
                }
              }
            });
          });
        } else {
          // 저장 실패시 간단하게 사용자에게 알림
          showToast('❌ 채널 저장에 실패했습니다. 다시 시도해주세요.');
        }
      });
    });
  }

  // Firebase에 채널 저장하는 공통 함수
  function saveChannelsToFirebase(callback) {
    const youtubeApiKeyEl = container.querySelector('#youtube-api-key');
    const geminiApiKeyEl = container.querySelector('#gemini-api-key');
    const youtubeApiKey = youtubeApiKeyEl ? youtubeApiKeyEl.value.trim() : '';
    const geminiApiKey = geminiApiKeyEl ? geminiApiKeyEl.value.trim() : '';
    const payload = {
      youtubeApiKey,
      geminiApiKey,
      myChannels: { blogs: myChannelsData }, // 변경된 데이터 구조에 맞게 전송
    };

    chrome.runtime.sendMessage(
      {
        action: 'save_channels_and_key',
        data: payload,
      },
      (response) => {
        if (callback) callback(response);
      }
    );
  }

  // 최종 저장 버튼 (서버 전송)
  const saveAllBtn = container.querySelector('#save-all-channels-btn');
  if (saveAllBtn) {
    saveAllBtn.addEventListener('click', () => {
      // [체크리스트 4-3 최적화] 저장 중 로딩 표시
      saveAllBtn.disabled = true;
      const originalText = saveAllBtn.textContent;
      saveAllBtn.textContent = '저장 중...';

      saveChannelsToFirebase((response) => {
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = originalText;

        if (response && response.success) {
          // [체크리스트 4-3] 저장 성공 피드백
          showToast('✅ 채널 설정이 저장되었습니다.');

          // [체크리스트 4-2] 실시간 동기화: 헤더의 채널 선택기 갱신
          const shadowRoot =
            container.closest('#content-pilot-host')?.shadowRoot ||
            document.querySelector('#content-pilot-host')?.shadowRoot;
          if (shadowRoot) {
            import('./header.js').then((module) => {
              module.addHeaderEventListeners(shadowRoot);
            });
          }

          // [체크리스트 3-🆎] 첫 채널 생성 후 자동 선택 및 대시보드 이동
          chrome.runtime.sendMessage({ action: 'get_channels_and_key' }, (channelResponse) => {
            const myBlogs = channelResponse?.data?.myChannels?.blogs || [];
            const currentActiveChannelId = chrome.storage.local.get('activeChannelId', (res) => {
              const activeChannelId = res.activeChannelId;

              // 활성 채널이 없고, 채널이 1개 이상 있으면 첫 번째 채널 자동 선택
              if (!activeChannelId && myBlogs.length > 0) {
                const firstChannel = myBlogs[0];
                const firstChannelId =
                  firstChannel.id ||
                  (firstChannel.apiUrl ? btoa(firstChannel.apiUrl).replace(/=/g, '') : '');

                if (firstChannelId) {
                  chrome.storage.local.set({ activeChannelId: firstChannelId }, () => {
                    // [체크리스트 3-🆎] 대시보드로 화면 전환
                    const shadowRoot =
                      container.closest('#content-pilot-host')?.shadowRoot ||
                      document.querySelector('#content-pilot-host')?.shadowRoot;
                    if (shadowRoot) {
                      const mainArea = shadowRoot.querySelector('#cp-main-area');
                      const dashboardTab = shadowRoot.querySelector('[data-key="dashboard"]');

                      if (mainArea && dashboardTab) {
                        // 대시보드 탭 활성화
                        shadowRoot
                          .querySelectorAll('.cp-mode-tab')
                          .forEach((tab) => tab.classList.remove('active'));
                        dashboardTab.classList.add('active');

                        // 대시보드 렌더링
                        import('./dashboardMode.js').then((module) => {
                          module.renderDashboard(mainArea);
                          module.addDashboardEventListeners(mainArea);
                        });

                        // 헤더 이벤트 리스너 초기화
                        import('./header.js').then((module) => {
                          module.addHeaderEventListeners(shadowRoot);
                        });

                        showToast('✅ 첫 번째 채널이 선택되었습니다. 대시보드로 이동합니다.');
                      }
                    }
                  });
                }
              }
            });
          });
        } else {
          alert('❌ 저장 실패: ' + (response?.error || '알 수 없는 오류'));
        }
      });
    });
  }

  // [추가] 애드센스 동기화 버튼 이벤트
  const syncBtn = container.querySelector('#sync-adsense-status-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '확인 중...';

      chrome.runtime.sendMessage({ action: 'check_adsense_registration' }, (response) => {
        syncBtn.disabled = false;
        syncBtn.textContent = '🔄 등록 상태 확인하기';

        if (response && response.success) {
          const { totalRegistered, updatedCards, matchedCards, alreadyRegistered, notMatched } =
            response.data;

          // [팝업 메시지 개선] 더 명확한 메시지 표시
          let message = `✅ 확인 완료!\n\n`;
          message += `📋 수집된 등록 URL: ${totalRegistered}개\n`;
          message += `✅ 매칭된 카드: ${matchedCards || 0}개\n`;

          if (updatedCards > 0) {
            message += `🔄 업데이트된 카드: ${updatedCards}개\n`;
          } else if (matchedCards > 0 && alreadyRegistered === matchedCards) {
            message += `✅ 이미 등록된 카드: ${alreadyRegistered}개\n`;
            message += `\n💡 모든 카드가 이미 올바르게 등록되어 있어 추가 업데이트가 필요 없습니다.`;
          } else if (matchedCards === 0) {
            message += `⚠️ 매칭된 카드가 없습니다.\n`;
            message += `\n💡 발행된 콘텐츠의 URL이 AdSense에 등록되어 있는지 확인하세요.`;
          } else {
            message += `ℹ️ 업데이트된 카드: 0개\n`;
          }

          if (notMatched > 0) {
            message += `\n⚠️ 매칭 실패한 카드: ${notMatched}개`;
          }

          alert(message);
          // 대시보드나 칸반 데이터 갱신이 필요하면 여기서 트리거
        } else {
          alert('❌ 확인 실패: ' + (response?.error || '알 수 없는 오류'));
        }
      });
    });
  }
}
