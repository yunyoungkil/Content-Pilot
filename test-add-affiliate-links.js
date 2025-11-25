/**
 * Firebase 콘솔에서 실행할 수 있는 제휴 링크 테스트 데이터 추가 스크립트
 * 
 * 사용 방법:
 * 1. Chrome 확장 프로그램 > Service Worker > Console 탭에서 실행 (권장)
 * 2. 또는 웹페이지 콘솔에서 실행 (확장 프로그램이 로드된 경우)
 * 
 * 실행: 아래 코드를 복사하여 콘솔에 붙여넣고 Enter 키를 누르세요.
 */

(async function addTestAffiliateLinks() {
  try {
    // 1. Firebase 설정
    const databaseURL = "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app";
    
    // 2. 사용자 정보 가져오기
    const storage = await chrome.storage.local.get([
      'googleUserEmail', 
      'googleAuthToken',  // 올바른 키 사용
      'googleAuthTokenExpiry'
    ]);
    
    if (!storage.googleUserEmail) {
      console.error('❌ 로그인이 필요합니다. 확장 프로그램에서 Google 로그인을 먼저 해주세요.');
      return;
    }
    
    // 사용자 ID 생성 (이메일을 안전한 Firebase 키로 변환)
    const userId = storage.googleUserEmail
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
    
    console.log('📝 사용자 이메일:', storage.googleUserEmail);
    console.log('📝 사용자 ID:', userId);
    console.log('📝 Database URL:', databaseURL);
    
    // 3. 토큰 확인 및 갱신
    let token = storage.googleAuthToken;
    
    if (!token) {
      console.warn('⚠️ 저장된 토큰이 없습니다. background.js를 통해 토큰을 가져오는 중...');
      
      // background.js에 메시지를 보내서 토큰 가져오기 시도
      try {
        const tokenResponse = await chrome.runtime.sendMessage({ action: 'get_auth_token' });
        if (tokenResponse && tokenResponse.success && tokenResponse.token) {
          token = tokenResponse.token;
          console.log('✅ 토큰 가져오기 성공');
        } else {
          console.error('❌ 토큰 가져오기 실패. 직접 로그인을 다시 해주세요.');
          return;
        }
      } catch (e) {
        console.error('❌ background.js 통신 실패:', e);
        console.error('💡 해결 방법: 확장 프로그램에서 Google 로그인을 다시 해주세요.');
        return;
      }
    } else {
      // 토큰 만료 확인
      const now = Date.now();
      const expiry = storage.googleAuthTokenExpiry || (now + 3600000); // 기본 1시간
      
      if (expiry <= now + 300000) { // 5분 이내 만료
        console.warn('⚠️ 토큰이 곧 만료됩니다. 갱신 시도 중...');
        try {
          const tokenResponse = await chrome.runtime.sendMessage({ action: 'refresh_auth_token' });
          if (tokenResponse && tokenResponse.success && tokenResponse.token) {
            token = tokenResponse.token;
            console.log('✅ 토큰 갱신 성공');
          }
        } catch (e) {
          console.warn('⚠️ 토큰 갱신 실패, 기존 토큰 사용:', e);
        }
      }
    }
    
    if (!token) {
      console.error('❌ 유효한 토큰을 가져올 수 없습니다.');
      console.error('💡 해결 방법: 확장 프로그램에서 Google 로그인을 다시 해주세요.');
      return;
    }
    
    console.log('🔑 토큰 확인 완료 (길이:', token.length, '자)');
    
    // 4. 테스트 제휴 링크 데이터
    const testAffiliateLinks = {
      link1: {
        keyword: "아이폰",
        productName: "아이폰 15",
        url: "https://www.coupang.com/vp/products/1234567890",
        description: "아이폰 15 최신 모델",
        createdAt: Date.now()
      },
      link2: {
        keyword: "충전기",
        productName: "무선 충전기",
        url: "https://www.coupang.com/vp/products/0987654321",
        description: "고속 무선 충전기",
        createdAt: Date.now()
      },
      link3: {
        keyword: "케이스",
        productName: "아이폰 케이스",
        url: "https://www.coupang.com/vp/products/1122334455",
        description: "방수 아이폰 케이스",
        createdAt: Date.now()
      },
      link4: {
        keyword: "에어팟",
        productName: "에어팟 프로",
        url: "https://www.coupang.com/vp/products/5566778899",
        description: "에어팟 프로 2세대",
        createdAt: Date.now()
      },
      link5: {
        keyword: "스마트워치",
        productName: "애플워치",
        url: "https://www.coupang.com/vp/products/9988776655",
        description: "애플워치 시리즈 9",
        createdAt: Date.now()
      }
    };
    
    // 5. Firebase REST API로 데이터 추가
    const path = `affiliate_links/${userId}`;
    
    console.log('📤 데이터 추가 중...');
    console.log('📤 경로:', path);
    
    // 각 링크를 개별적으로 추가
    let successCount = 0;
    let failCount = 0;
    
    for (const [key, link] of Object.entries(testAffiliateLinks)) {
      const linkUrl = `${databaseURL}/${path}/${key}.json${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
      
      try {
        const response = await fetch(linkUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(link)
        });
        
        if (response.ok) {
          console.log(`✅ ${key} 추가 완료:`, link.keyword, '-', link.productName);
          successCount++;
        } else {
          const errorText = await response.text();
          console.error(`❌ ${key} 추가 실패 (${response.status}):`, errorText);
          failCount++;
        }
      } catch (error) {
        console.error(`❌ ${key} 추가 중 오류:`, error.message);
        failCount++;
      }
    }
    
    console.log('\n✅ 작업 완료!');
    console.log(`📊 성공: ${successCount}개, 실패: ${failCount}개`);
    
    // 6. 추가된 데이터 확인
    const verifyUrl = `${databaseURL}/${path}.json${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const verifyResponse = await fetch(verifyUrl);
    
    if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json();
      console.log('\n📋 현재 저장된 제휴 링크:');
      console.table(verifyData);
    } else {
      console.warn('⚠️ 데이터 확인 실패:', await verifyResponse.text());
    }
    
    return { success: true, added: successCount, failed: failCount };
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    return { success: false, error: error.message };
  }
})();

/**
 * 개별 링크 추가 함수 (선택적 사용)
 */
async function addSingleAffiliateLink(keyword, productName, url, description = '') {
  try {
    const databaseURL = "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app";
    const storage = await chrome.storage.local.get(['googleUserEmail', 'googleAuthToken']);
    
    if (!storage.googleUserEmail) {
      console.error('❌ 로그인이 필요합니다.');
      return;
    }
    
    const userId = storage.googleUserEmail
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
    
    let token = storage.googleAuthToken;
    if (!token) {
      // background.js를 통해 토큰 가져오기 시도
      try {
        const tokenResponse = await chrome.runtime.sendMessage({ action: 'get_auth_token' });
        if (tokenResponse && tokenResponse.success && tokenResponse.token) {
          token = tokenResponse.token;
        } else {
          console.error('❌ 토큰을 가져올 수 없습니다.');
          return { success: false, error: '토큰 없음' };
        }
      } catch (e) {
        console.error('❌ background.js 통신 실패:', e);
        return { success: false, error: e.message };
      }
    }
    
    const linkKey = `link_${Date.now()}`;
    const linkData = {
      keyword: keyword,
      productName: productName,
      url: url,
      description: description,
      createdAt: Date.now()
    };
    
    const linkUrl = `${databaseURL}/affiliate_links/${userId}/${linkKey}.json${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    
    const response = await fetch(linkUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(linkData)
    });
    
    if (response.ok) {
      console.log('✅ 링크 추가 완료:', keyword);
      return { success: true, key: linkKey };
    } else {
      const error = await response.text();
      console.error('❌ 링크 추가 실패:', error);
      return { success: false, error: error };
    }
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    return { success: false, error: error.message };
  }
}

// 사용 예시:
// addSingleAffiliateLink("갤럭시", "갤럭시 S24", "https://www.coupang.com/...", "갤럭시 S24 울트라");

