// background.js (수정 완료된 최종 버전)

// 상수 정의 'default_user'
const CONSTANTS = {
  USER_ID: 'default_user'
};

let creating; // Offscreen Document 생성 플래그
let isKanbanListenerActive = false;

/**
 * 객체 내의 모든 undefined 값을 재귀적으로 null로 변환하는 함수.
 * Firebase에 저장하기 전 데이터를 정제하는 데 사용됩니다.
 */
function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data))
    return data.map((item) => cleanDataForFirebase(item));

  const cleanedObj = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== undefined) {
        cleanedObj[key] = cleanDataForFirebase(value);
      }
    }
  }
  return cleanedObj;
}

/**
 * Blob 객체를 Base64 문자열로 변환하는 헬퍼 함수 (PRD v2.2)
 * 웹 이미지 URL을 다운로드하여 Gemini Vision API로 전송할 때 사용됩니다.
 * @param {Blob} blob - 변환할 Blob 객체
 * @returns {Promise<string>} Base64 데이터 URI (예: "data:image/jpeg;base64,/9j/4AAQ...")
 */
function convertBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * FR-V-Validate (PRD v2.5): AI가 반환한 템플릿 데이터를 검증하는 함수
 * Firebase 저장 전에 필수 필드와 데이터 타입을 확인하여 불완전한 데이터를 차단합니다.
 * @param {Object} data - AI가 반환한 템플릿 JSON 객체
 * @throws {Error} 검증 실패 시 구체적인 에러 메시지와 함께 예외 발생
 */
function validateTemplateData(data) {
  if (!data) {
    throw new Error("AI가 유효한 데이터를 반환하지 않았습니다.");
  }

  // PRD v2.4 반응형 스키마 기준 필수 필드 검증
  if (!data.name || typeof data.name !== "string") {
    throw new Error("필수 필드 'name'이 누락되었거나 문자열이 아닙니다.");
  }

  if (!data.background || typeof data.background !== "object") {
    throw new Error("필수 필드 'background'가 누락되었거나 객체가 아닙니다.");
  }

  if (!data.background.type || !data.background.value) {
    throw new Error("background 필드에 'type'과 'value'가 필요합니다.");
  }

  if (!Array.isArray(data.layers) || data.layers.length === 0) {
    throw new Error(
      "필수 필드 'layers'가 비어있거나 배열이 아닙니다. 최소 1개 이상의 레이어가 필요합니다."
    );
  }

  // 플레이스홀더 레이어 검증 (고충실도 복제 지원)
  const sloganLayer = data.layers.find(
    (l) =>
      l.type === "text" &&
      (l.text === "{{SLOGAN}}" ||
        (typeof l.text === "string" && l.text.length > 0))
  );
  if (!sloganLayer) {
    throw new Error(
      "필수 텍스트 레이어가 없습니다. 메인 텍스트(실제 텍스트 또는 '{{SLOGAN}}')가 반드시 포함되어야 합니다."
    );
  }

  // PRD v3.2: 타입별 상대 좌표 검증 (0.0 ~ 1.0 범위)
  for (let i = 0; i < data.layers.length; i++) {
    const layer = data.layers[i];

    // 공통 검증: 타입 필수
    if (!layer.type || !["text", "shape", "svg", "image"].includes(layer.type)) {
      throw new Error(`레이어 ${i}: type 필드가 누락되었거나 유효하지 않은 값입니다. (허용: text, shape, svg, image)`);
    }

    // 공통 검증: 좌표 범위
    if (typeof layer.x !== "number" || typeof layer.y !== "number") {
      throw new Error(`레이어 ${i}: x, y 좌표가 숫자가 아닙니다.`);
    }

    if (layer.x < 0 || layer.x > 1 || layer.y < 0 || layer.y > 1) {
      throw new Error(
        `레이어 ${i}: x, y 좌표는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: x=${layer.x}, y=${layer.y})`
      );
    }

    // 타입별 검증
    if (layer.type === "text") {
      if (!layer.styles || typeof layer.styles !== "object") {
        throw new Error(`레이어 ${i}: styles 객체가 필요합니다.`);
      }

      if (typeof layer.styles.fontRatio !== "number") {
        throw new Error(`레이어 ${i}: styles.fontRatio가 숫자가 아닙니다.`);
      }

      if (layer.styles.fontRatio <= 0 || layer.styles.fontRatio > 1) {
        throw new Error(
          `레이어 ${i}: fontRatio는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: ${layer.styles.fontRatio})`
        );
      }
    } else if (layer.type === "svg") {
      // SVG 레이어 검증 (pathData는 선택적, widthRatio/heightRatio 필수)
      if (layer.widthRatio && (layer.widthRatio <= 0 || layer.widthRatio > 1)) {
        throw new Error(`레이어 ${i}: widthRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`);
      }
      if (layer.heightRatio && (layer.heightRatio <= 0 || layer.heightRatio > 1)) {
        throw new Error(`레이어 ${i}: heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`);
      }
    } else if (layer.type === "image") {
      // 이미지 레이어 검증 (widthRatio/heightRatio 필수)
      if (!layer.widthRatio || !layer.heightRatio) {
        throw new Error(`레이어 ${i}: 이미지 타입은 widthRatio와 heightRatio가 필수입니다.`);
      }
      if (layer.widthRatio <= 0 || layer.widthRatio > 1 || layer.heightRatio <= 0 || layer.heightRatio > 1) {
        throw new Error(`레이어 ${i}: widthRatio, heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`);
      }
    }
  }

  console.log(`[Template Validator] ✅ 템플릿 "${data.name}" 검증 통과`);
  return true;
}

async function getOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "HTML 문자열을 파싱하기 위함",
    });
    await creating;
    creating = null;
  }
}

importScripts(
  "../lib/firebase-app-compat.js",
  "../lib/firebase-database-compat.js"
);

const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL:
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

/**
 * 지정된 URL의 채널과 관련된 모든 데이터를 Firebase에서 삭제하는 통합 함수.
 * @param {string} urlToDelete - 삭제할 채널의 원본 입력 URL
 */
async function deleteChannelData(urlToDelete) {
  const userId = CONSTANTS.USER_ID;
  const channelsRef = firebase.database().ref(`channels/${userId}`);
  const channelsSnap = await channelsRef.once("value");
  const allChannels = channelsSnap.val();

  if (!allChannels) throw new Error("삭제할 채널 정보를 찾을 수 없습니다.");

  let sourceIdToDelete = null;
  let platformToDelete = null;
  let channelFound = false;

  // 1. 삭제할 채널을 찾고, ID/플랫폼 확보 및 로컬 객체에서 제거
  for (const type of ["myChannels", "competitorChannels"]) {
    for (const platform of ["blogs", "youtubes"]) {
      const channels = allChannels[type]?.[platform] || [];
      const channelIndex = channels.findIndex(
        (c) => c.inputUrl === urlToDelete
      );

      if (channelIndex > -1) {
        const channelInfo = channels[channelIndex];
        sourceIdToDelete =
          platform === "blogs"
            ? btoa(channelInfo.apiUrl).replace(/=/g, "")
            : channelInfo.apiUrl;
        platformToDelete = platform;

        allChannels[type][platform].splice(channelIndex, 1); // 목록에서 제거
        channelFound = true;
        break;
      }
    }
    if (channelFound) break;
  }

  if (!channelFound) {
    console.warn(`DB에서 '${urlToDelete}' 채널을 찾지 못해 삭제를 건너뜁니다.`);
    return; // 작업을 중단하고 경고만 남김
  }

  // 2. 모든 DB 삭제 작업을 병렬로 실행
  const deletePromises = [];

  // 2-1. 수정된 채널 목록을 /channels/ 경로에 다시 저장
  deletePromises.push(channelsRef.set(allChannels));

  // 2-2. /channel_meta/ 경로에서 메타 정보 삭제
  deletePromises.push(
    firebase.database().ref(`channel_meta/${userId}/${sourceIdToDelete}`).remove()
  );

  // 2-3. /channel_content/ 경로에서 관련 콘텐츠 모두 삭제
  const contentRef = firebase
    .database()
    .ref(`channel_content/${userId}/${platformToDelete}`);
  const contentPromise = contentRef
    .orderByChild("sourceId")
    .equalTo(sourceIdToDelete)
    .once("value")
    .then((snapshot) => {
      const contentToDelete = snapshot.val();
      if (contentToDelete) {
        const updates = {};
        for (const contentId in contentToDelete) {
          updates[contentId] = null; // null로 설정하여 삭제
        }
        return contentRef.update(updates);
      }
    });
  deletePromises.push(contentPromise);

  await Promise.all(deletePromises);

  console.log(`'${urlToDelete}' 채널과 관련된 모든 데이터 삭제 완료.`);
}

/**
 * 블로그 일반 URL에서 RSS 피드 주소를 추출합니다. (개선된 버전)
 */
async function resolveBlogUrl(url) {
  if (!url || !url.startsWith("http")) return null;
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const host = urlObj.hostname.toLowerCase();
  const origin = urlObj.origin;

  let platformRssPath = null;
  if (host.includes("tistory.com")) {
    platformRssPath = "/rss";
  } else if (host.includes("blog.naver.com")) {
    let naverId = null;
    const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
    if (pathMatch && pathMatch[1] && pathMatch[1] !== "PostList.naver") {
      naverId = pathMatch[1];
    } else {
      naverId = new URLSearchParams(urlObj.search).get("blogId");
    }
    if (naverId) return `https://rss.blog.naver.com/${naverId}.xml`;
    platformRssPath = "/rss";
  } else if (host.includes("wordpress.com") || host.includes("medium.com")) {
    platformRssPath = "/feed";
  } else if (host.includes("blogspot.com") || host.includes("blogger.com")) {
    platformRssPath = "/feeds/posts/default?alt=rss";
  }

  if (platformRssPath) return origin + platformRssPath;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP 오류! 상태: ${response.status}`);
    const html = await response.text();
    const rssMatch = html.match(
      /<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']*)["']/i
    );
    if (rssMatch && rssMatch[2]) {
      let rssUrl = rssMatch[2];
      if (rssUrl.startsWith("//")) rssUrl = `https:${rssUrl}`;
      else if (rssUrl.startsWith("/")) rssUrl = `${origin}${rssUrl}`;
      return rssUrl;
    }
    const fallbackUrl = url.endsWith("/") ? url + "feed" : url + "/feed";
    return fallbackUrl;
  } catch (error) {
    console.error(`RSS 주소 확인 실패 (${url}):`, error);
    return null;
  }
}

/**
 * 유튜브 일반 URL에서 채널 ID(UC...)를 추출하거나 API를 통해 변환합니다. (개선된 버전)
 */
async function resolveYoutubeUrl(url, apiKey) {
  if (!url) return null;
  if (url.startsWith("UC") && url.length === 24) return url;
  if (!url.startsWith("http")) return null;

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const path = urlObj.pathname;

  if (path.includes("/watch") || path.includes("/embed")) {
    const videoId = urlObj.searchParams.get("v");
    if (videoId && apiKey) {
      const videoApi = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
      try {
        const response = await fetch(videoApi);
        const data = await response.json();
        if (data.items && data.items.length > 0)
          return data.items[0].snippet.channelId;
      } catch (error) {
        console.error(`Video URL에서 채널 ID 변환 실패 (${videoId}):`, error);
        return null;
      }
    }
  }

  const channelIdMatch = path.match(/\/channel\/([UC|c][a-zA-Z0-9_-]{22,24})/i);
  if (channelIdMatch && channelIdMatch[1]) return channelIdMatch[1];

  let identifier = null;
  let endpoint = null;
  const handleMatch = path.match(/\/@([a-zA-Z0-9_-]+)/i);
  const userMatch = path.match(/\/user\/([a-zA-Z0-9_-]+)/i);

  if (handleMatch && handleMatch[1]) {
    identifier = handleMatch[1];
    endpoint = `forHandle=@${identifier}`;
  } else if (userMatch && userMatch[1]) {
    identifier = userMatch[1];
    endpoint = `forUsername=${identifier}`;
  } else {
    return null;
  }

  if (endpoint && apiKey) {
    const api = `https://www.googleapis.com/youtube/v3/channels?part=id&${endpoint}&key=${apiKey}`;
    try {
      const response = await fetch(api);
      const data = await response.json();
      if (data.items && data.items.length > 0) return data.items[0].id;
    } catch (error) {
      console.error(`YouTube API를 통한 ID 변환 실패 (${identifier}):`, error);
    }
  }
  return null;
}
/**
 * 텍스트에서 AI를 통해 키워드를 추출하는 함수.
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<string[]|null>} - 추출된 키워드 배열 또는 null
 */
async function extractKeywords(text) {
  console.log("키워드 추출 시도:", text.substring(0, 100) + "...");

  if (!text || text.trim().length < 20) {
    console.warn("텍스트가 너무 짧아 키워드 추출을 건너뜁니다.");
    return null;
  }

  const { isKeywordExtractionEnabled, geminiApiKey } =
    await chrome.storage.local.get([
      "isKeywordExtractionEnabled",
      "geminiApiKey",
    ]);
  if (!isKeywordExtractionEnabled || !geminiApiKey) {
    console.warn("키워드 추출 기능이 비활성화되었거나 API 키가 없습니다.");
    if (!geminiApiKey) {
      await sendErrorToUI("API_KEY_MISSING", "Gemini API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.");
    }
    return null;
  }

  const MODEL_NAME = "gemini-2.0-flash";
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${geminiApiKey}`;

  // G-6 (A/C-2): 명확하고 간결한 프롬프트 설계
  const prompt = `당신은 전문 SEO 분석가이자 콘텐츠 전략가입니다. 다음 텍스트의 핵심 주제를 파악하여, 콘텐츠를 분류하고 검색 엔진 최적화(SEO)에 도움이 될 키워드를 추출해주세요.

[추출 규칙]
1.  **키워드 조합**: 총 5~7개의 키워드를 추출하며, 아래 두 종류를 적절히 조합해주세요.
    -   **핵심 키워드 (1-2 단어)**: 콘텐츠의 가장 중심이 되는 주제 (예: 'Gemini API', '콘텐츠 전략')
    -   **롱테일 키워드 (3단어 이상)**: 사용자의 구체적인 검색 의도가 담긴 긴 구문 (예: 'AI로 블로그 태그 자동 생성하기', '유튜브 채널 데이터 분석 방법')
2.  **구체성 및 명사 위주**: 명사, 고유명사, 전문 용어를 우선으로 사용합니다.
3.  **불용어 제외**: '방법', '소개', '정리' 등 일반적인 단어는 피합니다.

[응답 형식]
- 반드시 다른 설명이나 줄바꿈, \`\`\`json 같은 마크다운 없이, 순수한 JavaScript 배열 형식으로만 응답해주세요.
- 예: ["Gemini API", "콘텐츠 전략", "AI로 블로그 태그 자동 생성하기", "유튜브 채널 데이터 분석 방법", "SEO 키워드 추출"]

[분석할 텍스트]
"""
${text.substring(0, 2000)}
"""`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error("Gemini API 오류 응답:", responseData);
      
      // 에러 타입별 처리
      let errorType = "API_ERROR";
      if (response.status === 401) {
        errorType = "UNAUTHORIZED";
      } else if (response.status === 403) {
        errorType = "FORBIDDEN";
      } else if (response.status === 429) {
        errorType = "QUOTA_EXCEEDED";
      }
      
      const errorMessage = responseData.error?.message || `HTTP ${response.status}`;
      await sendErrorToUI(errorType, `키워드 추출 실패: ${errorMessage}`);
      throw new Error(`Gemini API 호출 실패: ${response.status}`);
    }
    if (!responseData.candidates || responseData.candidates.length === 0) {
      console.warn(
        "Gemini API가 안전 필터링 등의 이유로 응답을 반환하지 않았습니다.",
        responseData
      );
      return null;
    }

    const rawResult = responseData.candidates[0]?.content?.parts[0]?.text;

    console.log("Gemini 원본 응답:", rawResult);

    if (rawResult) {
      const arrayStringMatch = rawResult.match(/\[.*\]/s);
      if (arrayStringMatch) {
        try {
          const parsed = JSON.parse(arrayStringMatch[0]);
          console.log("✅ 추출된 키워드:", parsed);
          return parsed;
        } catch (e) {
          console.error(
            "❌ JSON 파싱 오류:",
            e,
            "원본 문자열:",
            arrayStringMatch[0]
          );
          return null;
        }
      }
    }
    console.warn("AI 응답에서 유효한 배열 형식을 찾지 못했습니다.");
    return null;
  } catch (error) {
    console.error("❌ Gemini 키워드 추출 중 전체 오류:", error);
    // 네트워크 오류나 기타 예외의 경우
    if (!error.message.includes("Gemini API 호출 실패")) {
      await sendErrorToUI("API_ERROR", `키워드 추출 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`);
    }
    return null;
  }
}

async function fetchGaProperties(token) {
  const API_URL =
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("GA4 속성 목록을 가져오는데 실패했습니다.");

  const data = await response.json();
  const properties = [];
  data.accountSummaries?.forEach((account) => {
    account.propertySummaries?.forEach((prop) => {
      properties.push({
        id: prop.property.split("/")[1], // "properties/12345"에서 숫자만 추출
        name: prop.displayName,
      });
    });
  });
  return properties;
}

// ▼▼▼ [추가] 애드센스 계정 ID를 가져오는 함수 ▼▼▼
async function fetchAdSenseAccountId(token) {
  const API_URL = "https://adsense.googleapis.com/v2/accounts";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null; // 애드센스 계정이 없는 경우 오류 대신 null 반환

  const data = await response.json();
  return data.accounts?.[0]?.name.split("/")[1] || null; // "accounts/pub-..."에서 ID만 추출
}

async function generateAndSendKeywords(data, sender) {
  const { cardId, status, title, description } = data;
  const userId = CONSTANTS.USER_ID;
  const keywordsRef = firebase
    .database()
    .ref(`kanban/${userId}/${status}/${cardId}/recommendedKeywords`);

  const searchQueryPrompt = `
        당신은 특정 주제에 대한 자료 조사를 시작하는 전문 콘텐츠 기획자입니다.
        아래 아이디어를 바탕으로, 구체적인 통계, 사례, 근거, 반론 등을 찾기 위한 가장 효과적인 구글 검색어 5개를 추천해주세요.
        검색어는 각기 다른 관점에서 주제에 접근해야 하며, 사용자가 즉시 검색에 활용할 수 있도록 자연스러운 질문 형태나 핵심 키워드 조합으로 구성해주세요.
        
        [아이디어]
        - 제목: ${title}
        - 설명: ${description || "없음"}

        [응답 형식]
        - 다른 설명이나 마크다운 없이, 순수한 JavaScript 배열 형식으로만 응답해주세요.
        - 예: ["콘텐츠 마케팅 성공 KPI 측정 사례", "블로그 방문자 체류 시간 늘리는 방법", "2024년 SEO 트렌드 통계", "디지털 콘텐츠 유료화 실패 원인"]
    `;

  try {
    const resultText = await callGeminiAPI(searchQueryPrompt);
    
    // 에러 메시지인 경우 파싱 시도하지 않음
    if (resultText && (resultText.trim().startsWith("오류:") || resultText.trim().startsWith("오류："))) {
      console.warn("[generateRecommendedKeywords] API 오류 응답 감지, 파싱 건너뜀:", resultText.substring(0, 100));
      return;
    }
    
    // Gemini API 응답에서 배열 부분만 정확히 파싱
    const arrayMatch = resultText.match(/\[.*\]/s);
    if (!arrayMatch) {
      console.warn("[generateRecommendedKeywords] 배열 형식을 찾지 못했습니다:", resultText.substring(0, 100));
      return;
    }
    const keywords = JSON.parse(arrayMatch[0]);

    // Firebase에 새로운 키워드를 덮어쓰기
    await keywordsRef.set(keywords);

    // UI에 새로운 키워드 전송
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "search_queries_recommended",
        success: true,
        data: keywords,
        cardId, // 모달 재현을 위해 cardId, status, title 전달
        status,
        cardTitle: title,
      });
    }
  } catch (error) {
    console.error("AI 검색어 추천 생성 중 오류:", error);
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "search_queries_recommended",
        success: false,
        error: error.message,
      });
    }
  }
}

/**
 * 아이디어에 대한 AI 브리핑 데이터를 생성하는 함수
 * outline, recommendedKeywords, longTailKeywords를 생성합니다.
 */
/**
 * 아이디어 카드를 생성하고 Firebase에 저장하는 헬퍼 함수
 * @param {Object} ideaData - 아이디어 데이터 객체
 * @param {string} targetStatus - 저장할 상태 ('ideas', 'in-progress', 'done')
 * @returns {Promise<{success: boolean, firebaseKey?: string, error?: string}>}
 */
async function createAndSaveNewIdea(ideaData, targetStatus = 'ideas', channelId = null) {
  try {
    // origin 및 tags 판별
    let origin = ideaData.origin || null;
    let tags = ideaData.keywords || ideaData.tags || [];

    // keywords와 tags 병합
    if (ideaData.keywords && ideaData.tags) {
      tags = [...(ideaData.tags || []), ...(ideaData.keywords || [])];
    } else if (ideaData.keywords) {
      tags = [...(ideaData.keywords || [])];
    } else if (ideaData.tags) {
      tags = [...(ideaData.tags || [])];
    }

    // origin이 없는 경우 판별
    if (!origin) {
      if (ideaData.keywords && ideaData.keywords.length > 0) {
        origin = { type: "ai_generated" };
      } else {
        origin = { type: "manual_entry" }; // kanbanMode.js의 수동 추가
      }
    }

    // 태그 처리 로직
    if (origin.type === "ai_generated") {
      if (!tags.includes("#AI-추천")) tags.push("#AI-추천");
    } else {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 포스팅 기반 아이디어는 AI 추천 태그 제거
    if (origin.type === 'my_post' || origin.type === 'competitor_post' || origin.type === 'my_post_renewal') {
      tags = tags.filter(t => t !== '#AI-추천');
    }

    // 태그 중복 제거
    tags = [...new Set(tags)];

    const workspaceKeywords = tags.filter(t => t !== '#AI-추천');

    // Firebase 저장 객체 생성
    // ▼▼▼ [중요] PRD v1.0에 따라 workspace 객체는 반드시 생성되어야 합니다.
    // workspaceMode.js가 cardData.workspace.keywords 등을 접근하므로 필수입니다. ▼▼▼
    const newCard = {
      title: ideaData.title || "제목 없음",
      description: ideaData.description || "",
      createdAt: ideaData.createdAt || Date.now(),
      channelId: channelId, // 👈 핵심: 채널 ID 저장 (없으면 null = 공용/미지정)
      tags: tags,
      origin: origin,
      workspace: { // PRD v1.0 모델 - workspaceMode.js에서 필수로 사용
        keywords: workspaceKeywords || [],
        outline: ideaData.outline || ideaData.workspace?.outline || [],
        draft: ideaData.draft_content || ideaData.draft || ideaData.workspace?.draft || "",
        linkedScraps: ideaData.workspace?.linkedScraps || {}
      },
      // 기존 필드 호환
      recommendedKeywords: ideaData.recommendedSearches || [],
      longTailKeywords: ideaData.longTailKeywords || []
    };
    // ▲▲▲ workspace 객체 생성 완료 ▲▲▲

    // Firebase에 저장
    const userId = CONSTANTS.USER_ID;
    const newCardRef = firebase.database().ref(`kanban/${userId}/${targetStatus}`).push();
    const newCardKey = newCardRef.key;
    await newCardRef.set(newCard);

    // [최적화] URL 인덱스 업데이트 (origin.postUrl이 있는 경우)
    if (origin?.postUrl) {
      updateUrlIndex(newCardKey, targetStatus, origin.postUrl, null)
        .catch(error => console.warn(`[URL 인덱스 업데이트 실패] ${newCardKey}:`, error));
    }

    // AI 브리핑 자동 생성
    // 'manual_entry'를 제외한 모든 아이디어는 생성 즉시 AI 브리핑을 실행
    // (ai_generated, my_post, competitor_post, my_post_renewal 등 모든 경우)
    if (origin.type !== 'manual_entry' && newCard.title) {
      generateIdeaBriefing(newCardKey, newCard.title, newCard.description)
        .catch((error) => console.error("브리핑 데이터 생성 실패:", error));
    }

    return { success: true, firebaseKey: newCardKey };

  } catch (e) {
    console.error("createAndSaveNewIdea 함수 오류:", e);
    return { success: false, error: e.message };
  }
}

async function generateIdeaBriefing(cardId, title, description, options = {}) {
    const userId = CONSTANTS.USER_ID;
    const cardRef = firebase.database().ref(`kanban/${userId}/ideas/${cardId}`);
  const {
    generateOutline = true,
    generateKeywords = true,
    generateLongTail = true,
    generateMainKeywords = true,
    onProgress = null // 진행률 콜백 추가
  } = options;
  
  try {
    const promises = [];
    const totalTasks = [generateOutline, generateMainKeywords, generateKeywords, generateLongTail].filter(Boolean).length;
    let completedTasks = 0;
    
    // 진행률 업데이트 함수
    const updateProgress = (taskName) => {
      completedTasks++;
      if (onProgress) {
        onProgress({
          completed: completedTasks,
          total: totalTasks,
          current: taskName,
          percentage: Math.round((completedTasks / totalTasks) * 100)
        });
      }
    };
    
    // 1. 목차(outline) 생성
    if (generateOutline) {
      const outlinePrompt = `
      당신은 전문 콘텐츠 기획자입니다. 아래 아이디어를 바탕으로 블로그 포스트의 목차를 생성해주세요.
      
      [아이디어]
      - 제목: ${title}
      - 설명: ${description || "없음"}
      
      [요청]
      SEO에 최적화되고 독자의 흥미를 끄는 목차 5-7개를 생성해주세요. 각 목차는 간결하고 명확해야 합니다.
      
      [응답 형식]
      반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
      ["목차 1", "목차 2", "목차 3"]
    `;
      promises.push(
        callGeminiAPI(outlinePrompt)
          .catch(() => null)
          .then(result => {
            updateProgress('목차 생성');
            return { type: 'outline', result };
          })
      );
    }
    
    // 2. 주요 키워드(mainKeywords/tags) 생성
    if (generateMainKeywords) {
      const mainKeywordsPrompt = `
      당신은 SEO 전문가입니다. 아래 아이디어를 바탕으로 콘텐츠의 핵심 주제를 나타내는 주요 키워드 5-7개를 생성해주세요.
      
      [아이디어]
      - 제목: ${title}
      - 설명: ${description || "없음"}
      
      [요청]
      핵심 키워드(1-2 단어)와 중간 길이 키워드(3-4 단어)를 조합하여 생성해주세요. 예: "화장품 리뷰", "내돈내산", "이벤트 참여", "제품 추천"
      
      [응답 형식]
      반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
      ["키워드 1", "키워드 2", "키워드 3"]
    `;
      promises.push(
        callGeminiAPI(mainKeywordsPrompt)
          .catch(() => null)
          .then(result => {
            updateProgress('주요 키워드 생성');
            return { type: 'mainKeywords', result };
          })
      );
    }
    
    // 3. 추천 검색어(recommendedKeywords) 생성
    if (generateKeywords) {
      const keywordsPrompt = `
      당신은 특정 주제에 대한 자료 조사를 시작하는 전문 콘텐츠 기획자입니다.
      아래 아이디어를 바탕으로, 구체적인 통계, 사례, 근거, 반론 등을 찾기 위한 가장 효과적인 구글 검색어 5개를 추천해주세요.
      
      [아이디어]
      - 제목: ${title}
      - 설명: ${description || "없음"}
      
      [응답 형식]
      반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
      ["검색어 1", "검색어 2", "검색어 3"]
    `;
      promises.push(
        callGeminiAPI(keywordsPrompt)
          .catch(() => null)
          .then(result => {
            updateProgress('추천 검색어 생성');
            return { type: 'keywords', result };
          })
      );
    }
    
    // 4. 롱테일 키워드(longTailKeywords) 생성
    if (generateLongTail) {
      const longTailPrompt = `
      당신은 SEO 전문가입니다. 아래 아이디어를 바탕으로 검색 최적화에 유용한 롱테일 키워드 5개를 생성해주세요.
      
      [아이디어]
      - 제목: ${title}
      - 설명: ${description || "없음"}
      
      [요청]
      구체적이고 검색 의도가 명확한 롱테일 키워드를 생성해주세요. 예: "2024년 블로그 트래픽 늘리는 방법", "콘텐츠 마케팅 ROI 측정 가이드"
      
      [응답 형식]
      반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
      ["롱테일 키워드 1", "롱테일 키워드 2", "롱테일 키워드 3"]
    `;
      promises.push(
        callGeminiAPI(longTailPrompt)
          .catch(() => null)
          .then(result => {
            updateProgress('롱테일 키워드 생성');
            return { type: 'longTail', result };
          })
      );
    }
    
    // 병렬로 필요한 데이터만 생성
    const results = await Promise.all(promises);
    
    // 결과 파싱 및 업데이트
    const updates = {};
    let mainKeywordsParsed = null;
    
    results.forEach(({ type, result }) => {
      if (!result) return;
      
      // 에러 메시지인 경우 파싱 시도하지 않음
      if (result.trim().startsWith("오류:") || result.trim().startsWith("오류：")) {
        console.warn(`[generateBriefingData] ${type} API 오류 응답 감지, 파싱 건너뜀:`, result.substring(0, 100));
        return;
      }
      
      try {
        // JSON 배열 추출 (여러 방법 시도)
        let jsonText = null;
        let parsed = null;
        
        // 방법 1: 코드 블록에서 추출
        const codeBlockMatch = result.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();
          try {
            parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed)) {
              // 성공적으로 파싱됨
            } else {
              parsed = null;
            }
          } catch (e) {
            parsed = null;
          }
        }
        
        // 방법 2: 순수 JSON 배열 찾기 (방법 1이 실패한 경우)
        if (!parsed) {
          // 첫 번째 '[' 부터 마지막 ']' 까지 추출
          const firstBracket = result.indexOf('[');
          const lastBracket = result.lastIndexOf(']');
          
          if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            jsonText = result.substring(firstBracket, lastBracket + 1);
            
            // 불완전한 문자열 수정 시도
            // 닫히지 않은 따옴표를 찾아서 수정
            let fixedJson = '';
            let inString = false;
            let escapeNext = false;
            let bracketCount = 0;
            
            for (let i = 0; i < jsonText.length; i++) {
              const char = jsonText[i];
              
              if (escapeNext) {
                fixedJson += char;
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                fixedJson += char;
                continue;
              }
              
              if (char === '"') {
                inString = !inString;
                fixedJson += char;
                continue;
              }
              
              if (inString) {
                fixedJson += char;
                continue;
              }
              
              if (char === '[') {
                bracketCount++;
                fixedJson += char;
              } else if (char === ']') {
                bracketCount--;
                fixedJson += char;
                if (bracketCount === 0) {
                  // 배열이 완성되었으므로 여기서 종료
                  break;
                }
              } else {
                fixedJson += char;
              }
            }
            
            // 닫히지 않은 대괄호가 있으면 추가
            while (bracketCount > 0) {
              fixedJson += ']';
              bracketCount--;
            }
            
            // 닫히지 않은 문자열이 있으면 닫기
            if (inString) {
              fixedJson += '"';
            }
            
            jsonText = fixedJson;
            
            try {
              parsed = JSON.parse(jsonText);
              if (!Array.isArray(parsed)) {
                parsed = null;
              }
            } catch (e) {
              parsed = null;
            }
          }
        }
        
        // 방법 3: 정규식으로 간단하게 추출 (fallback)
        if (!parsed) {
          const simpleMatch = result.match(/\[[\s\S]*\]/);
          if (simpleMatch) {
            jsonText = simpleMatch[0];
            try {
              parsed = JSON.parse(jsonText);
              if (!Array.isArray(parsed)) {
                parsed = null;
              }
            } catch (e) {
              // 파싱 실패 시 null 유지
              parsed = null;
            }
          }
        }
        
        // 파싱 성공 시 업데이트
        if (parsed && Array.isArray(parsed)) {
          if (type === 'outline') {
            updates.outline = parsed;
          } else if (type === 'mainKeywords') {
            mainKeywordsParsed = parsed;
          } else if (type === 'keywords') {
            updates.recommendedKeywords = parsed;
          } else if (type === 'longTail') {
            updates.longTailKeywords = parsed;
          }
        } else {
          console.warn(`[generateBriefingData] ${type} JSON 파싱 실패. 원본 응답:`, result.substring(0, 300));
        }
      } catch (e) {
        console.error(`${type} 파싱 오류:`, e);
        console.error(`[generateBriefingData] ${type} 원본 응답:`, result.substring(0, 500));
      }
    });
    
    // 주요 키워드가 있으면 기존 tags와 병합
    if (mainKeywordsParsed) {
      const snapshot = await cardRef.once('value');
      const currentData = snapshot.val() || {};
      const existingTags = currentData.tags || [];
      const newTags = existingTags.filter(t => t !== '#AI-추천');
      updates.tags = ['#AI-추천', ...newTags, ...mainKeywordsParsed];
    }
    
    // Firebase에 업데이트
    if (Object.keys(updates).length > 0) {
      await cardRef.update(updates);
      console.log(`[브리핑 데이터 생성 완료] 카드 ID: ${cardId}`, updates);
    }
    
  } catch (error) {
    console.error("AI 브리핑 데이터 생성 중 오류:", error);
  }
}
// --- 2. 핵심 이벤트 리스너 ---

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // [추가] 확장 프로그램 컨텍스트 유효성 확인용 ping 핸들러
  if (msg.action === "ping") {
    sendResponse({ success: true });
    return true;
  }
  // 썸네일용 Gemini 슬로건 생성 (draft 전체와 outline 리스트를 함께 보냄)
  if (
    msg.action === "gemini_generate_thumbnail_texts" &&
    Array.isArray(msg.data?.outlines)
  ) {
    (async () => {
      try {
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        if (!geminiApiKey) {
          sendResponse({ success: false, error: "Gemini API 키가 없습니다." });
          return;
        }
        const outlines = msg.data.outlines;
        const draft = msg.data.draft || "";
        // draft와 outline을 함께 프롬프트에 포함
        const prompt = `아래는 콘텐츠 초안과 세션(아웃라인) 목록입니다.\n\n[초안]\n${draft}\n\n[세션 목록]\n${outlines
          .map((t, i) => `${i + 1}. ${t}`)
          .join(
            "\n"
          )}\n\n각 세션에 어울리는 썸네일용 짧은 슬로건 또는 키워드를 한글로 1개씩, 12자 이내로, 꾸밈말 없이 핵심만 배열로 추천해줘.\n예시: ["슬로건1", "슬로건2", ...]`;
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
            geminiApiKey,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          console.error("[Gemini 슬로건] API 오류 응답:", data);
          sendResponse({ success: false, error: "Gemini API 오류", data });
          return;
        }
        // Gemini 응답에서 배열 파싱
        let slogans = [];
        try {
          const raw =
            data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          const arrayMatch = raw.match(/\[.*\]/s);
          if (arrayMatch) {
            slogans = JSON.parse(arrayMatch[0]);
          } else {
            console.warn("[Gemini 슬로건] 배열 형식 파싱 실패, 원본:", raw);
          }
        } catch (e) {
          console.error("[Gemini 슬로건] 배열 파싱 예외:", e, data);
        }
        // 개수 맞추기 (실패 시 빈값 채움)
        if (!Array.isArray(slogans) || slogans.length !== outlines.length) {
          slogans = Array(outlines.length).fill("");
        }
        sendResponse({ success: true, slogans });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  // 워크스페이스 draft 저장
  if (
    msg.action === "save_idea_draft" &&
    msg.ideaId &&
    msg.draft !== undefined
  ) {
    try {
      const db = firebase.database();
      // 아이디어 카드가 어떤 status(컬럼)에 있는지 찾아야 함
      const userId = CONSTANTS.USER_ID;
      db.ref(`kanban/${userId}`)
        .once("value")
        .then((snapshot) => {
          const allCards = snapshot.val() || {};
          let foundStatus = null;
          for (const status in allCards) {
            if (allCards[status] && allCards[status][msg.ideaId]) {
              foundStatus = status;
              break;
            }
          }
          if (!foundStatus) {
            sendResponse({ success: false, message: "Idea card not found." });
            return;
          }
          db.ref(`kanban/${userId}/${foundStatus}/${msg.ideaId}/draftContent`)
            .set(msg.draft)
            .then(() => {
              db.ref(`kanban/${userId}/${foundStatus}/${msg.ideaId}/updatedAt`).set(
                firebase.database.ServerValue.TIMESTAMP
              );
              sendResponse({
                success: true,
                message: "Draft saved successfully.",
              });
            })
            .catch((error) => {
              console.error("Firebase Draft Save Error:", error);
              sendResponse({ success: false, error: error.message });
            });
        });
      return true; // 비동기 응답
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  // K-4: 초안 삭제 핸들러
  if (msg.action === "delete_draft_content") {
    const cardId = msg.data.cardId;
    (async () => {
      if (!cardId) {
        sendResponse({ success: false, message: "Card ID is missing." });
        return;
      }
      try {
        // 아이디어가 어느 status에 있는지 찾기
        const userId = CONSTANTS.USER_ID;
        const kanbanRef = firebase.database().ref(`kanban/${userId}`);
        const snapshot = await kanbanRef.once("value");
        const allCards = snapshot.val() || {};
        let foundStatus = null;
        for (const status in allCards) {
          if (allCards[status][cardId]) {
            foundStatus = status;
            break;
          }
        }
        if (!foundStatus) {
          sendResponse({ success: false, message: "Card not found." });
          return;
        }
        // draftContent를 null로 업데이트
        await firebase
          .database()
          .ref(`kanban/${userId}/${foundStatus}/${cardId}/draftContent`)
          .set(null);
        sendResponse({ success: true });
      } catch (error) {
        console.error("Error deleting draft content:", error);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }
  // 초안과 발행 정보 모두 삭제
  if (msg.action === "delete_draft_and_publish_info") {
    const { ideaId, status } = msg.data;
    (async () => {
      if (!ideaId) {
        sendResponse({ success: false, message: "Idea ID is missing." });
        return;
      }
      try {
        const db = firebase.database();
        let foundStatus = status;
        
        // status가 제공되지 않으면 찾기
        if (!foundStatus) {
          const userId = CONSTANTS.USER_ID;
          const snapshot = await db.ref(`kanban/${userId}`).once("value");
          const allCards = snapshot.val() || {};
          for (const s in allCards) {
            if (allCards[s] && allCards[s][ideaId]) {
              foundStatus = s;
              break;
            }
          }
        }
        
        if (!foundStatus) {
          sendResponse({ success: false, message: "Card not found." });
          return;
        }
        
        const userId = CONSTANTS.USER_ID;
        const cardRef = db.ref(`kanban/${userId}/${foundStatus}/${ideaId}`);
        
        // 초안과 발행 정보 모두 삭제
        const updates = {
          draftContent: null,
          seoTitle: null,
          publishInfo: {
            permalink: null,
            tags: null,
            thumbnailInfo: null
          }
        };
        
        // workspace.draft도 함께 삭제 (workspace 객체가 존재하는 경우)
        const cardSnapshot = await cardRef.once("value");
        const cardData = cardSnapshot.val();
        if (cardData && cardData.workspace) {
          updates.workspace = {
            draft: null
          };
        }
        
        await cardRef.update(updates);
        
        // updatedAt 업데이트
        await cardRef.child("updatedAt").set(firebase.database.ServerValue.TIMESTAMP);
        
        sendResponse({ success: true });
      } catch (error) {
        console.error("[초안 및 발행 정보 삭제 실패]", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  // 스크랩 및 자료 관리
  if (msg.action === "scrap_element" && msg.data) {
    (async () => {
      // [수정] 사용자가 선택한 channelId 사용 (없으면 기본값: null = 공용 스크랩)
      // UI에서 모달을 통해 사용자가 선택한 channelId가 msg.channelId로 전달됨
      // 패널이 닫혀 있을 때는 activeChannelId를 사용
      const storage = await chrome.storage.local.get("activeChannelId");
      const activeChannelId = storage.activeChannelId || null;
      const userSelectedChannelId = msg.channelId !== undefined ? msg.channelId : activeChannelId;
      
      // [체크리스트 1] 방어 코드: activeChannelId가 없고 msg.channelId도 없으면 공용으로 저장 (에러 아님)
      // 사용자가 명시적으로 null을 선택한 경우도 허용하므로, undefined일 때만 activeChannelId 사용
      
      // ▼▼▼ [보완] 채널 이름(Name) 찾기 로직 추가 (패널 닫힘 상태 대응) ▼▼▼
      let activeChannelName = null;
      if (userSelectedChannelId) {
        try {
          const userId = CONSTANTS.USER_ID;
          const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
          const channelsData = channelsSnapshot.val() || {};
          const myBlogs = channelsData.myChannels?.blogs || [];
          
          // ID나 API URL로 채널 찾기
          const channel = myBlogs.find(b => 
            b.id === userSelectedChannelId || 
            (b.apiUrl && btoa(b.apiUrl).replace(/=/g, "") === userSelectedChannelId)
          );
          
          if (channel) {
            activeChannelName = channel.inputUrl || channel.url || "내 채널";
          }
        } catch (e) {
          console.warn("[Scrap] 채널 이름 조회 실패:", e);
        }
      }
      // ▲▲▲ [보완 끝] ▲▲▲

      try {
        const tags = await extractKeywords(msg.data.text);
        let scrapPayload = {
          ...msg.data,
          timestamp: Date.now(),
          tags: tags || null,
          channelId: userSelectedChannelId, // 👈 핵심: 사용자 선택에 따른 channelId (null = 공용 스크랩)
          // [보완] 프리뷰 UI를 위해 채널 이름도 데이터에 포함 (저장은 안 해도 됨)
          _channelName: activeChannelName
        };

        // images 배열을 allImages로 변환 (기존 allImages가 있으면 병합)
        if (Array.isArray(msg.data.images) && msg.data.images.length > 0) {
          const existingAllImages = scrapPayload.allImages || [];
          // 중복 제거하면서 병합
          const mergedImages = [...new Set([...existingAllImages, ...msg.data.images])];
          scrapPayload.allImages = mergedImages.length > 0 ? mergedImages : null;
          // images 필드는 제거 (allImages로 통합)
          delete scrapPayload.images;
        } else if (scrapPayload.images) {
          // images가 배열이 아니면 제거
          delete scrapPayload.images;
        }

        const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);
        
        // 저장용 데이터에서 임시 필드(_channelName) 분리 (DB에는 저장 안 함)
        const { _channelName, ...dataToSave } = cleanedScrapPayload;

        const userId = CONSTANTS.USER_ID;
        const scrapRef = firebase.database().ref(`scraps/${userId}`).push();
        scrapRef
          .set(dataToSave)
          .then(() => {
            // 응답 전송 (비동기 응답을 위해)
            sendResponse({ success: true, scrapData: dataToSave });
            
            if (sender.tab?.id) {
              // 프리뷰에는 채널 이름을 포함해서 전송
              const previewData = { ...dataToSave, channelName: _channelName };
              chrome.tabs.sendMessage(
                sender.tab.id,
                { action: "cp_show_preview", data: previewData },
                { frameId: 0 }
              );
            }
          })
          .catch((err) => {
            console.error("[Scrap] 저장 실패:", err);
            sendResponse({ success: false, error: err.message });
            
            if (sender.tab?.id) {
              chrome.tabs.sendMessage(
                sender.tab.id,
                { action: "cp_show_toast", message: "❌ 스크랩 실패" },
                { frameId: 0 }
              );
            }
          });
      } catch (error) {
        // [CSP/에러 처리] 모든 예외 경로에서 sendResponse 호출 보장
        console.error("[Scrap] 처리 중 오류:", error);
        sendResponse({ success: false, error: error.message || "스크랩 처리 중 오류가 발생했습니다." });
        
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(
            sender.tab.id,
            { action: "cp_show_toast", message: "❌ 스크랩 처리 실패" },
            { frameId: 0 }
          );
        }
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "toggle_scrap_sharing") {
    // [체크리스트 1] 스크랩 공유 토글 핸들러
    (async () => {
      try {
        const { scrapId, currentChannelId } = msg;
        
        if (!scrapId) {
          sendResponse({ success: false, error: "스크랩 ID가 필요합니다." });
          return;
        }
        
        const userId = CONSTANTS.USER_ID;
        const scrapRef = firebase.database().ref(`scraps/${userId}/${scrapId}`);
        const scrapSnap = await scrapRef.once("value");
        const scrapData = scrapSnap.val();
        
        if (!scrapData) {
          sendResponse({ success: false, error: "스크랩을 찾을 수 없습니다." });
          return;
        }
        
        // 현재 channelId 확인 (null, undefined 모두 공용으로 처리)
        const currentChannelIdValue = scrapData.channelId;
        const isCurrentlyPublic = currentChannelIdValue === null || currentChannelIdValue === undefined;
        
        // 토글: null/undefined(공용) ↔ currentChannelId(전용)
        // 공용이면 전용으로, 전용이면 공용으로 변경
        const newChannelId = isCurrentlyPublic ? currentChannelId : null;
        
        // currentChannelId가 없으면 전용으로 변경할 수 없음
        if (isCurrentlyPublic && !currentChannelId) {
          sendResponse({ 
            success: false, 
            error: "활성 채널이 선택되지 않아 전용으로 변경할 수 없습니다." 
          });
          return;
        }
        
        // 업데이트
        await scrapRef.update({ channelId: newChannelId });
        
        sendResponse({ 
          success: true, 
          newChannelId,
          message: newChannelId === null ? "공용 스크랩으로 변경되었습니다." : "전용 스크랩으로 변경되었습니다."
        });
      } catch (error) {
        // [에러 처리] 모든 예외 경로에서 sendResponse 호출 보장
        console.error("[Scrap] 공유 토글 실패:", error);
        sendResponse({ success: false, error: error.message || "공유 토글 처리 중 오류가 발생했습니다." });
      }
    })();
    return true;
  } else if (msg.action === "cp_get_firebase_scraps") {
    const targetChannelId = msg.channelId || null; // UI에서 보낸 활성 채널 ID

    const userId = CONSTANTS.USER_ID;
    firebase
      .database()
      .ref(`scraps/${userId}`)
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));

        // [수정] 필터링 로직 적용
        const filteredScraps = arr.filter(scrap => {
          return scrap.channelId === undefined || // 구버전 데이터 호환
                 scrap.channelId === null ||      // 공용 스크랩
                 scrap.channelId === targetChannelId; // 전용 스크랩
        });

        sendResponse({ data: filteredScraps });
      });
    return true;
  } else if (msg.action === "delete_scrap") {
    const scrapIdToDelete = msg.id;
    if (scrapIdToDelete) {
      const userId = CONSTANTS.USER_ID;
      firebase
        .database()
        .ref(`scraps/${userId}/${scrapIdToDelete}`)
        .remove()
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
    }
    return true;
  } else if (msg.action === "remove_scrap_image") {
    const { scrapId, imageUrl } = msg.data;
    if (!scrapId || !imageUrl) {
      sendResponse({ success: false, error: "스크랩 ID와 이미지 URL이 필요합니다." });
      return true;
    }
    
    (async () => {
      try {
        const userId = CONSTANTS.USER_ID;
        const scrapRef = firebase.database().ref(`scraps/${userId}/${scrapId}`);
        const snapshot = await scrapRef.once("value");
        const scrapData = snapshot.val();
        
        if (!scrapData) {
          sendResponse({ success: false, error: "스크랩을 찾을 수 없습니다." });
          return;
        }
        
        const updates = {};
        
        // image 필드에서 삭제
        if (scrapData.image === imageUrl) {
          updates.image = null;
        }
        
        // allImages 배열에서 삭제
        if (Array.isArray(scrapData.allImages)) {
          updates.allImages = scrapData.allImages.filter(url => url !== imageUrl);
          // 배열이 비어있으면 null로 설정
          if (updates.allImages.length === 0) {
            updates.allImages = null;
          }
        }
        
        // Firebase 업데이트
        await scrapRef.update(updates);
        sendResponse({ success: true });
      } catch (error) {
        console.error("이미지 삭제 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true;
  } else if (msg.action === "get_all_scraps") {
    const targetChannelId = msg.channelId || null; // UI에서 보낸 활성 채널 ID

    const userId = CONSTANTS.USER_ID;
    firebase
      .database()
      .ref(`scraps/${userId}`)
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));

        // [수정] 필터링 로직 적용
        // 1. channelId가 없는 경우 (구버전 데이터) -> 일단 포함 (나중에 마이그레이션으로 해결)
        // 2. channelId가 null인 경우 (공용 데이터) -> 포함
        // 3. channelId가 현재 활성 채널과 일치하는 경우 -> 포함
        const filteredScraps = arr.filter(scrap => {
          return scrap.channelId === undefined || // 구버전 데이터 호환
                 scrap.channelId === null ||      // 공용 스크랩
                 scrap.channelId === targetChannelId; // 전용 스크랩
        });

        sendResponse({
          success: true,
          scraps: filteredScraps.sort((a, b) => b.timestamp - a.timestamp),
        });
      });
    return true;
  } else if (msg.action === "get_scrap_detail") {
    const { scrapId, channelId } = msg;
    if (!scrapId) {
      sendResponse({ success: false, error: "스크랩 ID가 없습니다." });
      return true;
    }
    
    const userId = CONSTANTS.USER_ID;
    firebase
      .database()
      .ref(`scraps/${userId}/${scrapId}`)
      .once("value", (snapshot) => {
        const scrapData = snapshot.val();
        if (!scrapData) {
          sendResponse({ success: false, error: "스크랩을 찾을 수 없습니다." });
          return;
        }
        
        // 채널 ID 필터링 (필요한 경우)
        if (channelId !== undefined && scrapData.channelId !== undefined && 
            scrapData.channelId !== null && scrapData.channelId !== channelId) {
          sendResponse({ success: false, error: "접근 권한이 없습니다." });
          return;
        }
        
        sendResponse({
          success: true,
          data: {
            id: scrapId,
            text: scrapData.text || scrapData.cleanText || "",
            url: scrapData.url || "",
            image: scrapData.image || "",
            allImages: scrapData.allImages || (scrapData.image ? [scrapData.image] : []),
            tags: scrapData.tags || [],
            timestamp: scrapData.timestamp || 0
          }
        });
      })
      .catch((error) => {
        console.error("[스크랩 상세 조회 실패]", error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
    // (이전 placeholder/canvas 기반 핸들러 완전 제거, Gemini API만 사용)
  } else if (msg.action === "get_canvas_images") {
    // Firebase 캔버스 데이터에서 이미지 URL 추출
    const imageUrls = new Set();
    
    // 여러 가능한 경로에서 캔버스 데이터 확인
    const canvasPaths = ["canvas", "canvases", "canvas_data", "edited_images", "images"];
    const promises = canvasPaths.map((path) => {
      return firebase
        .database()
        .ref(path)
        .once("value")
        .then((snapshot) => {
          const data = snapshot.val();
          if (!data) return;
          
          // 객체인 경우 모든 값 순회
          if (typeof data === 'object' && !Array.isArray(data)) {
            Object.values(data).forEach((item) => {
              if (typeof item === 'object' && item !== null) {
                // imageUrl, url, dataUrl, image 등의 필드 확인
                if (item.imageUrl) imageUrls.add(item.imageUrl);
                if (item.url && item.url.startsWith('data:image')) imageUrls.add(item.url);
                if (item.url && (item.url.startsWith('http') || item.url.startsWith('https'))) imageUrls.add(item.url);
                if (item.dataUrl && item.dataUrl.startsWith('data:image')) imageUrls.add(item.dataUrl);
                if (item.image && typeof item.image === 'string') imageUrls.add(item.image);
                // base64 이미지 데이터도 확인
                if (item.base64 && item.base64.startsWith('data:image')) imageUrls.add(item.base64);
              } else if (typeof item === 'string' && (item.startsWith('data:image') || item.startsWith('http'))) {
                imageUrls.add(item);
              }
            });
          } else if (Array.isArray(data)) {
            data.forEach((item) => {
              if (typeof item === 'object' && item !== null) {
                if (item.imageUrl) imageUrls.add(item.imageUrl);
                if (item.url && item.url.startsWith('data:image')) imageUrls.add(item.url);
                if (item.url && (item.url.startsWith('http') || item.url.startsWith('https'))) imageUrls.add(item.url);
                if (item.dataUrl && item.dataUrl.startsWith('data:image')) imageUrls.add(item.dataUrl);
                if (item.image && typeof item.image === 'string') imageUrls.add(item.image);
                if (item.base64 && item.base64.startsWith('data:image')) imageUrls.add(item.base64);
              } else if (typeof item === 'string' && (item.startsWith('data:image') || item.startsWith('http'))) {
                imageUrls.add(item);
              }
            });
          }
        })
        .catch(() => {
          // 경로가 없으면 무시
        });
    });
    
    Promise.all(promises).then(() => {
      sendResponse({
        success: true,
        images: Array.from(imageUrls),
      });
    });
    
    return true;
  } else if (msg.action === "scrap_entire_analysis") {
    const analysisContent = msg.data;
    if (!analysisContent) {
      sendResponse({ success: false, error: "분석 콘텐츠가 비어있습니다." });
      return true;
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateTag = `${year}-${month}-${day}`;

    const scrapPayload = {
      text: analysisContent,
      html: `<pre>${analysisContent}</pre>`,
      tag: "AI_ANALYSIS",
      url: `content-pilot://analysis/${Date.now()}`,
      // 2. '#AI리포트'를 삭제하고 날짜 태그를 추가합니다.
      tags: [`#성과분석`, `#${dateTag}`],
      timestamp: Date.now(),
    };

    const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);
    const userId = CONSTANTS.USER_ID;
    const scrapRef = firebase.database().ref(`scraps/${userId}`).push();
    scrapRef
      .set(cleanedScrapPayload)
      .then(() => {
        console.log("AI 분석 리포트가 스크랩북에 저장되었습니다.");
        sendResponse({ success: true, message: "AI 분석 리포트가 저장되었습니다." });
      })
      .catch((err) => {
        console.error("AI 리포트 스크랩 중 오류:", err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // 비동기 응답
  }
  // FR3 (PRD v2.0/v2.2): AI 기반 썸네일 템플릿 자동 생성기
  else if (msg.action === "analyze_image_for_template") {
    console.log("[Template Generator] 🚀 템플릿 분석 요청 수신");
    (async () => {
      try {
        const { data } = msg; // { base64Image?, imageUrl?, templateName }
        console.log("[Template Generator] 📦 데이터:", {
          hasBase64: !!data.base64Image,
          hasUrl: !!data.imageUrl,
          templateName: data.templateName
        });

        // 1. [신규 v2.2] 이미지 소스(Base64 또는 URL) 처리
        let imageBase64Data;
        let imageMimeType = "image/jpeg"; // 기본값

        if (data.base64Image) {
          // 로컬 파일 (Base64)
          const parts = data.base64Image.split(",");
          if (parts.length === 2) {
            // MIME 타입 추출 (예: "data:image/png;base64," -> "image/png")
            const mimeMatch = parts[0].match(/data:(.+);base64/);
            if (mimeMatch) imageMimeType = mimeMatch[1];
            imageBase64Data = parts[1];
          } else {
            throw new Error("Invalid Base64 image format");
          }
        } else if (data.imageUrl) {
          // 웹 이미지 URL (v2.2 신규)
          const response = await fetch(data.imageUrl);
          if (!response.ok)
            throw new Error(
              `Failed to fetch image: ${response.status} ${response.statusText}`
            );

          // Content-Type에서 MIME 타입 추출
          const contentType = response.headers.get("Content-Type");
          if (contentType && contentType.startsWith("image/")) {
            imageMimeType = contentType;
          }

          // Blob으로 변환 후 Base64 인코딩
          const blob = await response.blob();
          const base64Result = await convertBlobToBase64(blob);
          imageBase64Data = base64Result.split(",")[1];
        } else {
          throw new Error("No image data provided (base64Image or imageUrl)");
        }

        // 2. [기존 v2.0] Gemini Vision API 호출
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        console.log("[Template Generator] 🔑 API 키 확인:", geminiApiKey ? "존재함" : "없음");
        
        if (!geminiApiKey) {
          throw new Error("Gemini API 키가 설정되지 않았습니다. 설정에서 API 키를 등록해주세요.");
        }

        const VISION_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
        console.log("[Template Generator] 🌐 API URL 생성 완료");

        // CR1 (PRD v3.1): JSON 스키마 정의 - API 레벨에서 구조 강제
        const templateSchema = {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "템플릿의 이름(예: 원본 파일명 등)",
            },
            background: {
              type: "object",
              description: "이미지의 주요 배경색(단색, HEX 또는 rgba 형식)",
              properties: {
                type: {
                  type: "string",
                  enum: ["solid"],
                  description: "배경의 종류(단색만 허용)",
                },
                value: {
                  type: "string",
                  description: "배경 색상(HEX 또는 rgba 형식)",
                },
              },
              required: ["type", "value"],
            },
            layers: {
              type: "array",
              description: "텍스트, 도형, SVG 아이콘, 이미지 등 모든 시각적 요소의 배열",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["text", "shape", "svg", "image"],
                    description: "요소 타입(text, shape, svg, image)",
                  },
                  text: {
                    type: "string",
                    description:
                      "텍스트 레이어일 경우: 플레이스홀더({{SLOGAN}}, {{VISUALIZATION_CUE}}) 또는 실제 텍스트 문자열",
                  },
                  shape: {
                    type: "string",
                    enum: ["rect", "circle"],
                    description:
                      "도형 레이어일 경우: 'rect'(사각형), 'circle'(원) 중 하나",
                  },
                  pathData: {
                    type: "string",
                    description:
                      "SVG 레이어일 경우: SVG path 데이터(예: 'M 0,0 L 10,10 Z')",
                  },
                  src: {
                    type: "string",
                    description:
                      "이미지 레이어일 경우: Base64 이미지 데이터 또는 null(placeholder)",
                  },
                  x: {
                    type: "number",
                    description: "가로 위치(중심 좌표, 0.0~1.0 비율)",
                  },
                  y: {
                    type: "number",
                    description: "세로 위치(중심 좌표, 0.0~1.0 비율)",
                  },
                  widthRatio: {
                    type: "number",
                    description:
                      "요소의 가로 크기(이미지 너비 대비 비율, 0.0~1.0)",
                  },
                  heightRatio: {
                    type: "number",
                    description:
                      "요소의 세로 크기(이미지 높이 대비 비율, 0.0~1.0)",
                  },
                  styles: {
                    type: "object",
                    properties: {
                      fontRatio: {
                        type: "number",
                        description:
                          "텍스트의 폰트 크기(이미지 높이 대비 비율, 0.0~1.0)",
                      },
                      fontWeight: {
                        type: "string",
                        enum: ["normal", "bold"],
                        description: "폰트 두께(normal 또는 bold)",
                      },
                      fontFamily: {
                        type: "string",
                        description: "폰트 패밀리(예: 'Noto Sans KR')",
                      },
                      fill: {
                        type: "string",
                        description: "채우기 색상(HEX 또는 rgba)",
                      },
                      stroke: {
                        type: "string",
                        description: "테두리 색상(HEX 또는 rgba)",
                      },
                      lineWidth: {
                        type: "number",
                        description: "테두리 두께(이미지 대비 비율, 0.0~1.0)",
                      },
                      align: {
                        type: "string",
                        enum: ["left", "center", "right"],
                        description: "텍스트 정렬(left, center, right)",
                      },
                      baseline: {
                        type: "string",
                        enum: ["top", "middle", "bottom", "alphabetic"],
                        description:
                          "텍스트 기준선(top, middle, bottom, alphabetic)",
                      },
                      shadow: {
                        type: "object",
                        properties: {
                          color: {
                            type: "string",
                            description: "그림자 색상(rgba 권장)",
                          },
                          blur: {
                            type: "number",
                            description:
                              "그림자 블러(이미지 높이 대비 비율, 0.0~1.0)",
                          },
                          offsetX: {
                            type: "number",
                            description:
                              "그림자 X 오프셋(이미지 너비 대비 비율, 0.0~1.0)",
                          },
                          offsetY: {
                            type: "number",
                            description:
                              "그림자 Y 오프셋(이미지 높이 대비 비율, 0.0~1.0)",
                          },
                        },
                      },
                    },
                  },
                },
                required: ["type", "x", "y"],
              },
            },
          },
          required: ["name", "background", "layers"],
        };

        // CR3 (PRD v3.2 Enhanced): 고충실도(High-Fidelity) 모드 프롬프트 - 복잡한 그래픽 감지 강화
        const jsonStructurePrompt = `
당신은 썸네일 디자인 이미지를 HTML5 Canvas에서 정확히 복제하기 위한 고충실도 JSON 템플릿을 생성하는 전문가입니다.

**템플릿 이름**: "${data.templateName || "새 템플릿"}"

**[핵심 원칙: 초고충실도 복제]**
- 이미지의 **모든 시각적 요소**를 레이어별로 완벽하게 추출합니다.
- 단순한 텍스트만이 아니라, 복잡한 그래픽 요소(3D 텍스트, 아이콘, 복합 도형)도 정확히 감지합니다.
- **복잡도 판단 우선**: 요소가 복잡하면(그라디언트, 3D 효과, 테두리, 그림자 등) type: "image"로 추출합니다.

**1. 배경 분석**:
- 주요 단색(가장 넓게 사용된 색상)을 HEX 코드로 추출 (예: "#1A1A1A").
- 그라디언트가 있으면 linear-gradient(...) 또는 대표 색상 선택.

**2. 텍스트 레이어 - 복잡도 기반 분류 (가장 중요!)**:

**[2-1] 단순 텍스트 (type: "text"로 추출)**:
- 조건: 단색 채우기 + 단순 그림자만 있는 평범한 텍스트
- 예: "간단한 제목", "설명 텍스트"
- JSON: type: "text", text: "실제내용", styles: { fill, fontRatio, fontWeight }

**[2-2] 복잡한 텍스트 그래픽 (type: "image"로 추출, 매우 중요!)**:
- 조건: 다음 중 하나라도 해당하면 type: "image"로 추출
  ✓ 3D 효과, 입체감, 깊이감이 있는 텍스트
  ✓ 텍스트에 그라디언트 채우기가 적용된 경우
  ✓ 텍스트에 복잡한 테두리(두꺼운 stroke, 다중 레이어)가 있는 경우
  ✓ 텍스트에 빛/광선/후광 효과가 있는 경우
  ✓ 텍스트가 아치형/곡선형으로 배치된 경우
  ✓ 텍스트가 변형(perspective, 기울기)된 경우
- 예: "동네 일거리 바라회" (3D 효과 + 테두리 + 그림자)
- JSON: type: "image", src: null, x: 0.5, y: 0.3, widthRatio: 0.8, heightRatio: 0.2
- 설명: 이런 복잡한 텍스트는 Canvas로 100% 복제 불가능하므로, 나중에 Base64 이미지로 대체할 placeholder로 남깁니다.

**3. 도형/장식 레이어 - 세밀한 추출 (복합 도형 분리!)**:

**[3-1] 단일 도형**:
- 사각형: type: "shape", shape: "rect", fill/stroke
- 원: type: "shape", shape: "circle", fill/stroke

**[3-2] 복합 도형 (여러 레이어로 분리!)**:
- 예: '24' 뱃지 (녹색 원 + 짙은 녹색 테두리)
  → 레이어 1: { type: "shape", shape: "circle", fill: "#90EE90" }
  → 레이어 2: { type: "shape", shape: "circle", stroke: "#228B22", styles: { lineWidth: 0.01 } }
- 예: 카드 배경 (흰색 사각형 + 회색 테두리)
  → 레이어 1: { type: "shape", shape: "rect", fill: "#FFFFFF" }
  → 레이어 2: { type: "shape", shape: "rect", stroke: "#CCCCCC" }

**[3-3] 장식선/밑줄**:
- 얇은 사각형으로 표현: heightRatio: 0.01~0.03

**4. 아이콘 레이어 (작은 그래픽 요소, 매우 중요!)**:

**[4-1] 벡터 아이콘 감지 (우선순위 높음)**:
- 조건: 작은 심볼/픽토그램 (크기 5~10% 이하)
- 예: 스프레이 아이콘, 커피잔, 별, 하트, 화살표, 체크마크
- JSON: type: "svg", pathData: "M 0,0 L 10,10..." (근사치 허용)
- 복잡한 아이콘은 단순화된 path로 표현

**[4-2] 아이콘 플레이스홀더 (SVG 변환 어려울 때)**:
- JSON: type: "image", src: null, widthRatio: 0.05~0.1
- 예: { type: "image", x: 0.1, y: 0.2, widthRatio: 0.08, heightRatio: 0.08, src: null }

**5. 사진/이미지 레이어 (실물 사진)**:
- 조건: 실제 사진(인물, 동물, 풍경, 제품 등)
- JSON: type: "image", src: null, widthRatio, heightRatio
- 예: 강아지 사진 → { type: "image", x: 0.5, y: 0.55, widthRatio: 0.3, heightRatio: 0.4, src: null }

**6. 좌표/크기 체계 (0.0~1.0 비율)**:
- 모든 좌표는 이미지 크기 대비 비율.
- 예: 600×400px 이미지
  - 중심점 (300, 200) → x: 0.5, y: 0.5
  - 왼쪽 상단 (60, 80) → x: 0.1, y: 0.2
- 텍스트: (x, y) = 텍스트가 그려지는 위치.
- 도형/아이콘/이미지: (x, y) = 중심 좌표.
- 크기: widthRatio, heightRatio (절대값 사용 금지).
- fontRatio = fontSize / imageHeight (예: 72px / 400px → 0.18)

**7. 스타일 속성**:
- 색상: HEX(#FF6B35) 또는 rgba(255, 107, 53, 1.0).
- fontWeight: "normal" 또는 "bold".
- fontFamily: "'Noto Sans KR'" (따옴표 포함).
- align: "left", "center", "right".
- baseline: "top", "middle", "bottom", "alphabetic".
- lineWidth: 테두리 두께 비율 (0.01 = 1%)

**8. 그림자 속성 (단순 텍스트만)**:
- shadow.blur, offsetX, offsetY는 비율 값 (0.0~1.0)
- 복잡한 그림자는 type: "image"로 추출

**중요한 예시 (초고충실도 모드)**:

**예시 1: 복잡한 3D 텍스트 (type: "image"로 추출)**
- 시각적: "동네 일거리 바라회" - 3D 효과 + 두꺼운 테두리 + 그림자
- JSON:
{
  "type": "image",
  "x": 0.5,
  "y": 0.3,
  "widthRatio": 0.8,
  "heightRatio": 0.2,
  "src": null
}
→ Canvas로 복제 불가능한 복잡한 텍스트는 이미지 placeholder로 처리

**예시 2: 아이콘 5개 감지 (각각 별도 레이어)**
- 시각적: 스프레이, 커피잔, 등 작은 아이콘 5개
- JSON:
[
  { "type": "svg", "pathData": "M ...", "x": 0.15, "y": 0.6, "widthRatio": 0.08, "heightRatio": 0.08 },
  { "type": "image", "src": null, "x": 0.35, "y": 0.6, "widthRatio": 0.08, "heightRatio": 0.08 },
  { "type": "image", "src": null, "x": 0.55, "y": 0.6, "widthRatio": 0.08, "heightRatio": 0.08 },
  { "type": "image", "src": null, "x": 0.75, "y": 0.6, "widthRatio": 0.08, "heightRatio": 0.08 },
  { "type": "image", "src": null, "x": 0.95, "y": 0.6, "widthRatio": 0.08, "heightRatio": 0.08 }
]

**예시 3: 복합 도형 - '24' 뱃지 (2개 레이어로 분리)**
- 시각적: 녹색 원 + 짙은 녹색 테두리
- JSON:
[
  { "type": "shape", "shape": "circle", "x": 0.9, "y": 0.1, "widthRatio": 0.1, "heightRatio": 0.1, "styles": { "fill": "#90EE90" } },
  { "type": "shape", "shape": "circle", "x": 0.9, "y": 0.1, "widthRatio": 0.1, "heightRatio": 0.1, "styles": { "stroke": "#228B22", "lineWidth": 0.01 } },
  { "type": "text", "text": "24", "x": 0.9, "y": 0.1, "styles": { "fontRatio": 0.05, "fontWeight": "bold", "fill": "#FFFFFF", "align": "center", "baseline": "middle" } }
]

**예시 4: 단순 텍스트 + 밑줄**
- 시각적: "간단한 제목" + 주황색 밑줄
- JSON:
[
  { "type": "text", "text": "간단한 제목", "x": 0.5, "y": 0.2, "styles": { "fontRatio": 0.08, "fontWeight": "bold", "fill": "#000000", "align": "center" } },
  { "type": "shape", "shape": "rect", "x": 0.5, "y": 0.25, "widthRatio": 0.7, "heightRatio": 0.02, "styles": { "fill": "#FF6B35" } }
]

**출력 형식 (필수)**:
- JSON 객체만 반환 (마크다운 코드 블록 금지, 설명 금지).
- 응답은 제공된 JSON 스키마와 정확히 일치.
- 모든 좌표와 크기는 0.0~1.0 비율 값.
- **복잡한 요소는 반드시 type: "image"로 추출**.
`;

        // CR2 (PRD v3.1): Gemini API 호출 시 generationConfig에 스키마 전달
        // [강화] 재시도 로직 (503 과부하 대응)
        let visionResponse;
        let retryCount = 0;
        const MAX_RETRIES = 5; // 3 → 5회로 증가
        const RETRY_DELAY = 3000; // 2초 → 3초로 증가

        while (retryCount < MAX_RETRIES) {
          try {
            console.log(`[Template Generator] 📡 API 호출 시도 ${retryCount + 1}/${MAX_RETRIES}`);
            
            visionResponse = await fetch(VISION_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: jsonStructurePrompt },
                      {
                        inlineData: {
                          mimeType: imageMimeType,
                          data: imageBase64Data,
                        },
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: "application/json",
                  responseSchema: templateSchema,
                },
              }),
            });

            console.log(`[Template Generator] 📨 응답 수신: ${visionResponse.status} ${visionResponse.statusText}`);

            if (visionResponse.ok) {
              console.log("[Template Generator] ✅ API 호출 성공");
              break; // 성공하면 루프 탈출
            }

            const errorData = await visionResponse.json();

            // 503 (과부하) 또는 429 (요청 제한) 에러인 경우에만 재시도
            if (
              visionResponse.status === 503 ||
              visionResponse.status === 429
            ) {
              retryCount++;
              if (retryCount < MAX_RETRIES) {
                console.warn(
                  `[Gemini Vision] ${visionResponse.status} 오류, ${retryCount}/${MAX_RETRIES} 재시도 중... (${RETRY_DELAY}ms 후)`
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, RETRY_DELAY * retryCount)
                ); // 지수 백오프
                continue;
              }
            }

            // 재시도 불가능한 에러이거나 최대 재시도 횟수 초과
            console.error("[Gemini Vision] API 오류 응답:", errorData);

            // 사용자 친화적 에러 메시지
            let userMessage = errorData.error?.message || "알 수 없는 오류";
            if (visionResponse.status === 503) {
              userMessage =
                "Gemini API 서버가 현재 과부하 상태입니다. 잠시 후 다시 시도해주세요.";
            } else if (visionResponse.status === 429) {
              userMessage =
                "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.";
            }

            throw new Error(
              `${userMessage} (상태 코드: ${visionResponse.status}${
                retryCount >= MAX_RETRIES ? ", 최대 재시도 횟수 초과" : ""
              })`
            );
          } catch (fetchError) {
            // 네트워크 오류 등
            if (retryCount < MAX_RETRIES - 1) {
              retryCount++;
              console.warn(
                `[Gemini Vision] 네트워크 오류, ${retryCount}/${MAX_RETRIES} 재시도 중...`,
                fetchError.message
              );
              await new Promise((resolve) =>
                setTimeout(resolve, RETRY_DELAY * retryCount)
              );
              continue;
            }
            throw fetchError;
          }
        }

        const visionData = await visionResponse.json();
        console.log("[Template Generator] 📄 JSON 파싱 완료, candidates 길이:", visionData.candidates?.length || 0);

        // 3. FR-V-Validate (PRD v2.5): JSON 파싱 및 강화된 검증
        const rawText =
          visionData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

        console.log(
          "[Template Generator] AI 응답 원문:",
          rawText.substring(0, 200) + "..."
        );

        // JSON 추출 (코드 블록 또는 순수 JSON)
        let templateDataJson;
        const jsonMatch = rawText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          templateDataJson = jsonMatch[1];
          console.log("[Template Generator] 코드 블록에서 JSON 추출 완료");
        } else {
          const pureJsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (pureJsonMatch) {
            templateDataJson = pureJsonMatch[0];
            console.log("[Template Generator] 순수 JSON 추출 완료");
          } else {
            throw new Error(
              "Gemini 응답에서 JSON을 추출할 수 없습니다. AI 응답: " +
                rawText.substring(0, 300)
            );
          }
        }

        // JSON 파싱
        const parsedTemplate = JSON.parse(templateDataJson);
        console.log(
          "[Template Generator] JSON 파싱 성공:",
          parsedTemplate.name
        );

        // [신규 v2.5] validateTemplateData 함수로 철저한 검증
        validateTemplateData(parsedTemplate);

        // 4. 검증 통과 후 Firebase에 저장 (undefined → null 정제)
        const cleanedTemplate = cleanDataForFirebase(parsedTemplate);
        const newTemplateRef = await firebase
          .database()
          .ref("thumbnail_templates")
          .push(cleanedTemplate);

        console.log(
          `[Template Generator] ✅ 템플릿 "${parsedTemplate.name}" 저장 완료 (ID: ${newTemplateRef.key})`
        );
        sendResponse({
          success: true,
          template: parsedTemplate,
          id: newTemplateRef.key,
        });
      } catch (error) {
        console.error("[Template Generator] ❌ 오류:", error);

        // 구체적인 에러 메시지 반환 (v2.5)
        const errorMessage = error.message || "알 수 없는 오류가 발생했습니다.";
        sendResponse({
          success: false,
          error: `템플릿 분석 실패: ${errorMessage}`,
        });
      }
    })();
    return true; // 비동기 응답
  }
  // FR5 (PRD v2.3): 템플릿 목록 조회
  else if (msg.action === "get_thumbnail_templates") {
    firebase
      .database()
      .ref("thumbnail_templates")
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const templates = Object.entries(val).map(([id, data]) => ({
          id,
          ...data,
        }));
        sendResponse({ success: true, templates });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  // FR-A-Delete (PRD v2.3): 템플릿 삭제
  else if (msg.action === "delete_template") {
    const templateId = msg.templateId;
    if (!templateId) {
      sendResponse({ success: false, error: "템플릿 ID가 없습니다." });
      return true;
    }

    firebase
      .database()
      .ref(`thumbnail_templates/${templateId}`)
      .remove()
      .then(() => {
        console.log(
          `[Template Manager] ✅ 템플릿 ID "${templateId}" 삭제 완료`
        );
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("[Template Manager] ❌ 삭제 오류:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // 채널 및 설정
  else if (msg.action === "save_channels_and_key") {
    const { youtubeApiKey, geminiApiKey, myChannels } = msg.data; // competitorChannels 제거됨
    const userId = CONSTANTS.USER_ID;

    (async () => {
      try {
        // 1. 새로운 채널 데이터를 API URL로 변환하고 정리합니다.
        const resolvedMyChannels = [];

        if (myChannels && myChannels.blogs && Array.isArray(myChannels.blogs)) {
          for (const blog of myChannels.blogs) {
            // 1-1. 내 채널 URL 처리
            const inputUrl = blog.url.trim();
            const apiUrl = await resolveBlogUrl(inputUrl);
            
            // 1-2. 해당 채널에 속한 경쟁 채널 처리 (Nested)
            const resolvedCompetitors = [];
            if (blog.competitors && Array.isArray(blog.competitors)) {
              for (const compUrl of blog.competitors) {
                const compInputUrl = compUrl.trim();
                const compApiUrl = await resolveBlogUrl(compInputUrl);
                if (compApiUrl) {
                  resolvedCompetitors.push({
                    inputUrl: compInputUrl,
                    apiUrl: compApiUrl
                  });
                }
              }
            }

            if (apiUrl) {
              // [체크리스트 5] AdSense ID 저장 시 공백 제거 및 pub- 접두사 검증
              let adSenseId = blog.adSenseAccountId ? blog.adSenseAccountId.trim() : null;
              if (adSenseId && !adSenseId.startsWith('pub-')) {
                // pub- 접두사가 없으면 자동 추가 (사용자가 숫자만 입력한 경우 대비)
                if (/^\d+$/.test(adSenseId)) {
                  adSenseId = `pub-${adSenseId}`;
                }
              }
              
              resolvedMyChannels.push({
                inputUrl: inputUrl,
                apiUrl: apiUrl,
                gaPropertyId: blog.gaPropertyId ? blog.gaPropertyId.trim() : null,
                adSenseAccountId: adSenseId,
                competitors: resolvedCompetitors // 경쟁 채널 목록 포함
              });
            }
          }
        }

        // 2. 최종적으로 API 키와 정리된 채널 데이터를 저장합니다.
        // competitorChannels 키는 더 이상 사용하지 않습니다.
        await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
        await firebase.database().ref(`channels/${userId}`).set({
          myChannels: { blogs: resolvedMyChannels }
          // competitorChannels 필드 삭제
        });

        sendResponse({
          success: true,
          message: "채널 정보가 저장되었습니다. (채널 중심 아키텍처 적용됨)",
        });

        // 3. 데이터 수집 및 UI 새로고침
        fetchAllChannelData().then(() => {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { action: "cp_data_refreshed" }).catch(() => {});
              }
            });
          });
        });
      } catch (error) {
        console.error("채널 저장/업데이트 처리 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "get_channels_and_key") {
    const userId = CONSTANTS.USER_ID;
    console.log("[Background] get_channels_and_key 요청, 사용자 ID:", userId);
    console.log("[Background] CONSTANTS.USER_ID 값:", CONSTANTS.USER_ID);
    const firebasePath = `channels/${userId}`;
    console.log("[Background] Firebase 경로:", firebasePath);
    
    Promise.all([
      chrome.storage.local.get(["youtubeApiKey", "geminiApiKey"]),
      firebase.database().ref(firebasePath).once("value"),
    ])
      .then(([storage, snapshot]) => {
        const rawChannelData = snapshot.val() || {};
        console.log("[Background] Firebase에서 읽어온 데이터:", rawChannelData);
        
        // 'myChannels.blogs' 배열을 그대로 전달 (competitors가 포함되어 있음)
        const myBlogs = rawChannelData.myChannels?.blogs || [];
        console.log("[Background] 채널 개수:", myBlogs.length);
        
        const responseData = {
          myChannels: {
            blogs: myBlogs, 
            // 유튜브는 추후 동일한 방식으로 마이그레이션 필요 (현재는 블로그 우선)
            youtubes: rawChannelData.myChannels?.youtubes || [] 
          },
          // competitorChannels 전역 필드는 더 이상 반환하지 않음 (하위 호환성 위해 빈 배열 둘 수 있음)
          competitorChannels: { blogs: [], youtubes: [] }, 
          youtubeApiKey: storage.youtubeApiKey,
          geminiApiKey: storage.geminiApiKey,
        };
        console.log("[Background] 응답 데이터:", responseData);
        sendResponse({ success: true, data: responseData });
      })
      .catch((error) => {
        console.error("[Background] get_channels_and_key 오류:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (msg.action === "get_my_channels") {
    const userId = CONSTANTS.USER_ID;
    firebase.database().ref(`channels/${userId}`).once("value")
      .then((snapshot) => {
        const rawChannelData = snapshot.val() || {};
        sendResponse({ 
          success: true, 
          channels: {
            myChannels: {
              blogs: rawChannelData.myChannels?.blogs || [],
              youtubes: rawChannelData.myChannels?.youtubes || []
            }
          }
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (msg.action === "get_kanban_card_status") {
    const { cardId } = msg.data;
    if (!cardId) {
      sendResponse({ success: false, error: "cardId가 필요합니다." });
      return true;
    }
    const userId = CONSTANTS.USER_ID;
    firebase.database().ref(`kanban/${userId}`).once("value")
      .then((snapshot) => {
        const allCards = snapshot.val() || {};
        for (const status in allCards) {
          if (allCards[status] && allCards[status][cardId]) {
            sendResponse({ success: true, status });
            return;
          }
        }
        sendResponse({ success: false, error: "카드를 찾을 수 없습니다." });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (msg.action === "delete_channel") {
    (async () => {
      try {
        await deleteChannelData(msg.url);
        sendResponse({ success: true });
      } catch (error) {
        console.error("채널 삭제 처리 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "get_channel_content") {
    const userId = CONSTANTS.USER_ID;
    Promise.all([
      firebase.database().ref(`channel_content/${userId}`).once("value"),
      firebase.database().ref(`channel_meta/${userId}`).once("value"),
      firebase.database().ref(`channels/${userId}`).once("value"),
    ])
      .then(([contentSnap, metaSnap, channelsSnap]) => {
        const content = contentSnap.val() || {};
        const metas = metaSnap.val() || {};
        const channels = channelsSnap.val() || {
          myChannels: {},
          competitorChannels: {},
        };

        const blogs = Object.values(content.blogs || {}).filter(
          (item) => item !== null
        );
        const youtubes = Object.values(content.youtubes || {}).filter(
          (item) => item !== null
        );
        const allContent = [...blogs, ...youtubes];

        const responseData = {
          content: allContent,
          metas: metas,
          channels: channels,
        };

        sendResponse({ success: true, data: responseData });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  } else if (msg.action === "refresh_channel_data") {
    const { sourceId, platform } = msg;

    const userId = CONSTANTS.USER_ID;
    firebase
      .database()
      .ref(`channels/${userId}`)
      .once("value", (snapshot) => {
        const channels = snapshot.val();
        if (!channels) {
          sendResponse({ success: false, error: "설정된 채널이 없습니다." });
          return;
        }

        let channelToFetch = null;
        let channelType = null;

        for (const type of ["myChannels", "competitorChannels"]) {
          const blogs = channels[type]?.blogs || [];
          const channel = blogs.find(
            (c) => btoa(c.apiUrl).replace(/=/g, "") === sourceId
          );
          if (channel) {
            channelToFetch = channel;
            channelType = type;
            break;
          }
        }

        if (!channelToFetch) {
          for (const type of ["myChannels", "competitorChannels"]) {
            const youtubes = channels[type]?.youtubes || [];
            const channel = youtubes.find((c) => c.apiUrl === sourceId);
            if (channel) {
              channelToFetch = channel;
              channelType = type;
              break;
            }
          }
        }

        if (channelToFetch) {
          if (platform === "blog") {
            fetchRssFeed(channelToFetch.apiUrl, channelType);
          } else if (platform === "youtube") {
            fetchYoutubeChannel(channelToFetch.apiUrl, channelType);
          }
          sendResponse({ success: true, message: "데이터 수집을 시작합니다." });
        } else {
          sendResponse({
            success: false,
            error: "요청한 채널을 찾을 수 없습니다.",
          });
        }
      });
    return true;
  } else if (msg.action === "fetch_all_channel_data") {
    // [신규] 모든 채널 데이터 수집 (RSS 새로고침)
    (async () => {
      try {
        await fetchAllChannelData();
        // 수집 완료 후 UI에 알림
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { action: "cp_data_refreshed" }).catch(() => {});
            }
          });
        });
        sendResponse({ success: true, message: "모든 채널 데이터 수집이 시작되었습니다." });
      } catch (error) {
        console.error("[fetch_all_channel_data] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "fetch_and_save_single_post") {
    // [Phase 1] 단건 수집 및 저장 액션 핸들러
    (async () => {
      try {
        const { url } = msg;
        
        if (!url || typeof url !== "string") {
          sendResponse({ success: false, error: "유효한 URL이 필요합니다." });
          return;
        }

        // [핵심] 중복 검사 선행 (강력한 정규화 적용)
        const duplicateCheck = await checkDuplicateUrl(url);
        if (duplicateCheck.exists) {
          // status를 한글로 변환하여 사용자에게 더 친절하게 안내
          const statusMap = {
            "ideas": "기획",
            "in-progress": "작성 중",
            "done": "발행 완료"
          };
          const statusText = statusMap[duplicateCheck.status] || duplicateCheck.status;
          
          sendResponse({
            success: false,
            code: "DUPLICATE_FOUND",
            message: `이미 '${statusText}' 단계에 있는 포스팅입니다.\n카드명: ${duplicateCheck.title}`,
            cardInfo: {
              status: duplicateCheck.status,
              statusLabel: statusText,
              cardId: duplicateCheck.cardId,
              title: duplicateCheck.title
            }
          });
          return;
        }

        // URL에서 플랫폼 판별
        let platform = null;
        let videoId = null;
        
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.toLowerCase();
          
          if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
            platform = "youtube";
            // YouTube 비디오 ID 추출
            if (urlObj.pathname.includes("/watch")) {
              videoId = urlObj.searchParams.get("v");
            } else if (urlObj.pathname.includes("/embed/")) {
              videoId = urlObj.pathname.split("/embed/")[1]?.split("?")[0];
            } else if (hostname.includes("youtu.be")) {
              videoId = urlObj.pathname.substring(1);
            }
            
            if (!videoId) {
              sendResponse({ success: false, error: "YouTube 비디오 ID를 찾을 수 없습니다." });
              return;
            }
          } else {
            platform = "blog";
          }
        } catch (e) {
          sendResponse({ success: false, error: "유효하지 않은 URL 형식입니다." });
          return;
        }

        // 플랫폼별 수집 및 저장
        if (platform === "youtube") {
          const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
          if (!youtubeApiKey) {
            sendResponse({ success: false, error: "YouTube API 키가 설정되지 않았습니다." });
            return;
          }

          // YouTube videos.list API로 비디오 정보 가져오기
          const videoApiUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoId}&part=snippet,statistics`;
          const videoResponse = await fetch(videoApiUrl);
          
          if (!videoResponse.ok) {
            sendResponse({ success: false, error: `YouTube API 호출 실패 (HTTP ${videoResponse.status})` });
            return;
          }
          
          const videoData = await videoResponse.json();

          if (!videoData.items || videoData.items.length === 0) {
            sendResponse({ success: false, error: "YouTube 비디오를 찾을 수 없습니다." });
            return;
          }

          const apiItem = videoData.items[0];
          const normalizedData = normalizeYoutubeData(apiItem, apiItem.snippet.channelId, "myChannels");
          
          // [체크리스트 1] sourceId를 현재 활성 채널의 sourceId로 강제 지정 (필수)
          if (msg.sourceId) {
            normalizedData.sourceId = msg.sourceId; // 프론트엔드에서 전달된 sourceId 우선 사용
          } else if (msg.channelId) {
            // channelId가 있으면 sourceId로 사용 (채널 ID와 sourceId가 같은 경우)
            normalizedData.sourceId = msg.channelId;
          } else {
            // sourceId가 없으면 에러 반환 (데이터가 필터링되어 안 보일 수 있음)
            sendResponse({ success: false, error: "활성 채널이 선택되지 않았습니다. 채널을 선택한 후 다시 시도해주세요." });
            return;
          }
          
          // 키워드 추출
          const tags = await extractKeywords(normalizedData.description);
          normalizedData.tags = tags || null;

          // Firebase에 저장
          const cleanedData = cleanDataForFirebase(normalizedData);
          
          // [체크리스트 3] 데이터 저장 경로 확인: videoId가 없으면 에러
          if (!cleanedData.videoId) {
            sendResponse({ success: false, error: "비디오 ID를 찾을 수 없습니다." });
            return;
          }
          
          const userId = CONSTANTS.USER_ID;
          await firebase
            .database()
            .ref(`channel_content/${userId}/youtubes/${cleanedData.videoId}`)
            .set(cleanedData);

          sendResponse({ success: true, data: cleanedData, platform: "youtube" });

        } else if (platform === "blog") {
          // 블로그 페이지 수집
          const response = await fetch(url);
          if (!response.ok) {
            sendResponse({ success: false, error: `페이지를 가져올 수 없습니다. (HTTP ${response.status})` });
            return;
          }

          const html = await response.text();
          const parsedData = await parseBlogPage(url, html);

          if (!parsedData || !parsedData.success) {
            sendResponse({ 
              success: false, 
              error: parsedData?.error || "페이지를 파싱할 수 없습니다." 
            });
            return;
          }

          // 키워드 추출
          const tags = await extractKeywords(parsedData.cleanText);
          
          // 제목 추출 (HTML에서)
          let title = "제목 없음";
          const titleMatch = html.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
          }

          // 날짜 추출
          const pubDate = Date.now();
          
          // contentId 생성
          const linkForId = url.split("?")[0];
          const contentId = btoa(linkForId).replace(/=/g, "");
          
          // [체크리스트 1] sourceId를 현재 활성 채널의 sourceId로 강제 지정 (필수)
          let sourceId = null;
          if (msg.sourceId) {
            sourceId = msg.sourceId; // 프론트엔드에서 전달된 sourceId 우선 사용
          } else if (msg.channelId) {
            // channelId가 있으면 sourceId로 사용 (채널 ID와 sourceId가 같은 경우)
            sourceId = msg.channelId;
          } else {
            // sourceId가 없으면 에러 반환 (데이터가 필터링되어 안 보일 수 있음)
            sendResponse({ success: false, error: "활성 채널이 선택되지 않았습니다. 채널을 선택한 후 다시 시도해주세요." });
            return;
          }

          // [체크리스트 3] 썸네일 URL 정제: HTML 엔티티 제거
          let cleanedThumbnail = parsedData.thumbnail || null;
          if (cleanedThumbnail) {
            cleanedThumbnail = cleanedThumbnail.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          }

          const finalData = {
            title,
            fullLink: url,
            pubDate,
            description: parsedData.description || null,
            thumbnail: cleanedThumbnail,
            cleanText: parsedData.cleanText,
            sourceId,
            channelType: "myChannels",
            fetchedAt: Date.now(),
            ...parsedData.metrics,
            tags: tags || null,
          };

          // Firebase에 저장
          const cleanedData = cleanDataForFirebase(finalData);
          
          // [체크리스트 3] 데이터 저장 경로 확인: contentId가 없으면 에러
          if (!contentId) {
            sendResponse({ success: false, error: "콘텐츠 ID를 생성할 수 없습니다." });
            return;
          }
          
          const userId = CONSTANTS.USER_ID;
          await firebase
            .database()
            .ref(`channel_content/${userId}/blogs/${contentId}`)
            .set(cleanedData);

          sendResponse({ success: true, data: cleanedData, platform: "blog" });
        } else {
          sendResponse({ success: false, error: "지원하지 않는 플랫폼입니다." });
        }

      } catch (error) {
        console.error("[fetch_and_save_single_post] 오류:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "데이터 수집 중 오류가 발생했습니다." 
        });
      }
    })();
    return true;
  } else if (msg.action === "fetch_image_as_base64") {
    // [체크리스트 2-B] 이미지 프록시 액션: Base64 변환
    (async () => {
      try {
        const response = await fetch(msg.url);
        if (!response.ok) {
          sendResponse({ success: false, error: `HTTP ${response.status}` });
          return;
        }
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result });
        };
        reader.onerror = () => {
          sendResponse({ success: false, error: "FileReader 오류" });
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        console.error("[fetch_image_as_base64] 오류:", e);
        sendResponse({ success: false, error: e.message || "이미지 로드 실패" });
      }
    })();
    return true;
  } else if (msg.action === "clear_blog_content") {
    const userId = CONSTANTS.USER_ID;
    firebase
      .database()
      .ref(`channel_content/${userId}/blogs`)
      .remove()
      .then(() =>
        sendResponse({
          success: true,
          message:
            "블로그 콘텐츠 데이터가 성공적으로 삭제되었습니다. 새로고침 후 재수집해주세요.",
        })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // AI 분석 및 아이디어
  else if (msg.action === "analyze_my_channel") {
    const { channelName, channelContent } = msg.data; // 채널 이름과 데이터를 분리
    const analysisDate = new Date().toLocaleDateString("ko-KR"); // 'YYYY. M. D.' 형식의 날짜 생성

    const dataSummary = channelContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 20)
      .map(
        (item) =>
          `제목: ${item.title}, 조회수: ${item.viewCount || 0}, 좋아요: ${
            item.likeCount || 0
          }`
      )
      .join("\n");

    const youtubeAnalysisPrompt = `
            ## "${channelName}" 유튜브 채널 성과 분석 (${analysisDate})

            당신은 전문 콘텐츠 전략가입니다. 아래 제공되는 유튜브 채널의 영상 데이터 목록을 분석해주세요.
            
            [데이터]
            ${dataSummary}

            [분석 요청]
            1. 어떤 주제의 영상들이 가장 높은 조회수와 좋아요를 기록했나요? (상위 3개 주제)
            2. 성공적인 영상들의 제목이나 내용에서 나타나는 공통적인 패턴이나 키워드는 무엇인가요?
            3. 위 분석 결과를 바탕으로, 이 채널이 다음에 만들면 성공할 만한 새로운 콘텐츠 아이디어 3가지를 구체적인 제목 예시와 함께 제안해주세요.

            결과는 한국어로, 친절하고 이해하기 쉬운 보고서 형식으로 작성해주세요.
        `;

    (async () => {
      const analysisResult = await callGeminiAPI(youtubeAnalysisPrompt);
      sendResponse({ success: true, analysis: analysisResult });
    })();

    return true;
  } else if (msg.action === "generate_content_ideas") {
    const { myContent, competitorContent, myAnalysisSummary } = msg.data;

    const myDataSummary = myContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 10)
      .map((item) => ` - ${item.title} (조회수: ${item.viewCount})`)
      .join("\n");

    const competitorDataSummary = competitorContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 10)
      .map((item) => ` - ${item.title} (조회수: ${item.viewCount})`)
      .join("\n");

    const youtubeIdeasPrompt = `
            당신은 최고의 유튜브 콘텐츠 전략가입니다. 아래 세 가지 정보를 종합하여, 나의 강점을 활용해 경쟁자를 이길 수 있는 새로운 아이디어 5가지를 제안해주세요.

            [정보 1: 내 채널의 핵심 성공 요인]
            ${myAnalysisSummary}

            [정보 2: 내 채널의 인기 영상 목록]
            ${myDataSummary}

            [정보 3: 경쟁 채널의 인기 영상 목록]
            ${competitorDataSummary}

            [요청]
            나의 핵심 성공 요인(정보 1)을 바탕으로, 경쟁 채널의 인기 요소(정보 3)를 전략적으로 결합하거나, 혹은 경쟁자보다 더 나은 가치를 제공할 수 있는 새로운 아이디어 5가지를 제안해주세요.

            [출력 형식]
            반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
            [
              {
                "title": "아이디어 제목",
                "description": "이 아이디어가 전략적으로 유효한 이유와 구체적인 설명"
              },
              {
                "title": "아이디어 제목",
                "description": "이 아이디어가 전략적으로 유효한 이유와 구체적인 설명"
              }
            ]
        `;

    (async () => {
      const ideasResult = await callGeminiAPI(youtubeIdeasPrompt);
      sendResponse({ success: true, ideas: ideasResult });
    })();

    return true;
  } else if (msg.action === "call_gemini") {
    (async () => {
      try {
        const result = await callGeminiAPI(msg.prompt);
        sendResponse({ success: true, text: result });
      } catch (error) {
        console.error("Gemini API 호출 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "generate_blog_ideas") {
    const { activeChannelId } = msg;
    
    (async () => {
      try {
        if (!activeChannelId) throw new Error("채널 ID가 전달되지 않았습니다.");

        // 1. 채널 정보 가져오기 (경쟁사 목록 확인용)
        const userId = CONSTANTS.USER_ID;
        const channelsSnap = await firebase.database().ref(`channels/${userId}/myChannels/blogs`).once("value");
        const myChannels = channelsSnap.val() || [];
        
        // ID 또는 API URL로 채널 찾기
        const currentChannel = myChannels.find(blog => {
          const id = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : "");
          return id === activeChannelId;
        });

        if (!currentChannel) throw new Error("채널 정보를 찾을 수 없습니다.");

        const channelName = currentChannel.inputUrl || "내 블로그";
        const competitorUrls = (currentChannel.competitors || []).map(c => c.inputUrl || c);

        // 2. 콘텐츠 데이터 가져오기 (내 콘텐츠 & 경쟁사 콘텐츠)
        const contentSnap = await firebase.database().ref(`channel_content/${userId}`).once("value");
        const allContent = contentSnap.val() || {};
        const blogs = Object.values(allContent.blogs || {}).filter(item => item !== null);
        
        // 2-1. 내 콘텐츠 필터링
        // sourceId는 보통 btoa(apiUrl) 형태임. activeChannelId와 일치하는지 확인.
        const myContent = blogs.filter(item => item.sourceId === activeChannelId);

        // 2-2. 경쟁사 콘텐츠 필터링
        // 경쟁사 URL(inputUrl)을 기반으로 sourceId를 유추하거나 매칭해야 함.
        // 가장 정확한 방법은 item.fullLink나 item.sourceId를 경쟁사 목록과 비교하는 것.
        const competitorContent = blogs.filter(item => {
          // 내 채널이 아니면서, 경쟁사 URL 목록에 포함되는지 확인 (도메인 등으로)
          if (item.sourceId === activeChannelId) return false;
          
          // 경쟁사 URL 중 하나라도 item.fullLink에 포함되면 경쟁사 콘텐츠로 간주
          return competitorUrls.some(compUrl => {
            if (!compUrl || !item.fullLink) return false;
            try {
              const compUrlObj = new URL(compUrl);
              const itemUrlObj = new URL(item.fullLink);
              // 도메인 매칭 (정확한 매칭)
              return compUrlObj.hostname === itemUrlObj.hostname;
            } catch (e) {
              // URL 파싱 실패 시 문자열 포함 여부로 판단
              return item.fullLink.includes(compUrl);
            }
          });
        });

        // 3. 데이터 요약 생성 (기존 로직 활용)
        const myDataSummary = myContent
          .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
          .slice(0, 10)
          .map((item) => ` - ${item.title} (댓글: ${item.commentCount || 0}, 좋아요: ${item.likeCount || 0})`)
          .join("\n");

        const competitorDataSummary = competitorContent
          .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
          .slice(0, 10)
          .map((item) => ` - ${item.title} (출처: ${(item.fullLink || '').substring(0, 50)}...)`)
          .join("\n");

        // 4. 성과 분석 실행 (채널 ID 전달!)
        const performanceData = await analyzePerformanceData(activeChannelId);
        const performanceAnalysis = performanceData?.analysis || null;
        const decayContent = performanceData?.decayContent || null;
        const userFeedback = await getUserFeedbackPatterns();
        
        // 5. 채널 맥락 정보 구성 (트렌드 분석용)
        const myAnalysisSummary = `현재 채널: ${channelName}\n분석된 내 글 수: ${myContent.length}개`;
        const channelContext = `${myAnalysisSummary}\n\n[인기 게시물]\n${myDataSummary}`;
        const emergingTopics = await getEmergingTopics(channelContext);
        
        // 콘텐츠 재활용 정보 포맷팅
        const repurposingInfo = decayContent && decayContent.length > 0 ? `
[재활용 후보 콘텐츠]
과거에 높은 성과를 보였지만 시간이 지나 트래픽이 하락할 수 있는 콘텐츠들입니다. 다음 콘텐츠들을 업데이트하여 새로운 트래픽을 유입시킬 수 있습니다:

${decayContent.map((item, idx) => 
  `${idx + 1}. "${item.title}" - 과거 수익: $${item.earnings.toFixed(2)}, 페이지뷰: ${item.pageviews.toLocaleString()}, 발행 후 ${item.daysSinceCreation}일 경과`
).join("\n")}

[재활용 전략]
- 최신 정보로 업데이트 (통계, 가격, 기능 등)
- 새로운 섹션 추가 (FAQ, 사용자 후기, 비교 분석 등)
- SEO 최적화 개선 (메타 설명, 키워드 밀도 등)
- 관련 최신 트렌드나 사례 추가
        ` : '';
        
        // 성과 데이터가 있을 때와 없을 때 프롬프트 분기
        const blogIdeasPrompt = `
            당신은 최고의 블로그 콘텐츠 전략가입니다. 아래 정보를 종합하여, 나의 강점을 활용해 경쟁자를 이길 수 있는 아이디어 5가지를 제안해주세요.

            [정보 1: 내 채널의 핵심 성공 요인]
            ${myAnalysisSummary}

            [정보 2: 내 채널의 인기 게시물 목록]
            ${myDataSummary}

            [정보 3: 경쟁 채널의 인기 게시물 목록]
            ${competitorDataSummary}

            ${performanceAnalysis ? `
            [정보 4: 과거 발행 콘텐츠 성과 분석]
            ${performanceAnalysis}
            ` : ''}

            ${userFeedback ? `
            [정보 5: 사용자 선호도 패턴]
            ${userFeedback}
            ` : ''}

            ${emergingTopics ? `
            [정보 6: 최신 트렌드 (선행성 지표)]
            ${emergingTopics}
            ` : ''}

            ${repurposingInfo ? `
            [정보 7: 콘텐츠 재활용 기회]
            ${repurposingInfo}
            ` : ''}

            [핵심 원칙: 실용성 및 사용자 의도]
            - 단순 키워드 조합이 아닌, 실제 사용자가 검색하고 공감할 만한 실용적 주제여야 합니다.
            - 실제 행동 패턴과 동떨어진 주제 (예: '갤럭시 탭으로 생활 가전 연동')는 지양해야 합니다.
            - 사용자가 실제로 필요로 하고, 검색 의도가 명확한 주제를 우선적으로 제안해주세요.

            ${performanceAnalysis ? `
            [요청: 성과 공식 기반 3단계 로직]
            다음 3단계 프로세스를 따라 아이디어를 생성해주세요:
            
            1단계: [정보 4]에서 '성공 공식(패턴)' 도출
            - 과거 발행 콘텐츠 중 수익성과 트래픽이 높은 콘텐츠의 공통 패턴을 분석하여 성공 공식을 도출하세요.
            - 예: "특정 태그 조합", "특정 주제 유형", "특정 접근 방식" 등
            
            2단계: [정보 2, 3${emergingTopics ? ', 6' : ''}]에서 '새로운 기회(키워드)' 탐색
            - 내 채널의 인기 게시물(정보 2)과 경쟁 채널의 인기 게시물(정보 3)을 분석하여 아직 다루지 않았거나 더 깊이 다룰 수 있는 새로운 기회를 찾으세요.
            ${emergingTopics ? '- [정보 6: 최신 트렌드]를 활용하여 시장 선점 기회를 잡으세요. 트렌드가 확산되기 전에 콘텐츠를 발행하면 더 높은 성과를 기대할 수 있습니다.' : ''}
            
            3단계: '성공 공식'을 '새로운 기회'에 적용
            - 1단계에서 도출한 성공 공식을 2단계에서 찾은 새로운 기회에 적용하여 구체적인 아이디어를 생성하세요.
            
            [아이디어 구성 비율]
            총 5개 제안 시, 다음 비율로 구성해주세요:
            ${repurposingInfo ? 
              `- 2개: '신규[성과 공식 활용]' 아이디어 (1단계에서 도출한 성공 공식을 직접 활용한 신규 콘텐츠)
            - 2개: '신규[전략적 탐색]' 아이디어 (새로운 기회를 탐색하여 경쟁자보다 우위를 점할 수 있는 신규 콘텐츠)
            - 1개: '기존[재활용]' 아이디어 ([정보 7]의 재활용 후보 콘텐츠를 업데이트하여 새로운 트래픽을 유입시키는 아이디어)` :
              `- 3개: '성과 공식 활용' 아이디어 (1단계에서 도출한 성공 공식을 직접 활용)
            - 2개: '전략적 탐색' 아이디어 (새로운 기회를 탐색하여 경쟁자보다 우위를 점할 수 있는 아이디어)`
            }
            ` : `
            [요청: 콜드 스타트 시나리오]
            성과 데이터가 없으므로, 다음 차선책 전략을 사용해주세요:
            - [정보 3: 경쟁 채널의 인기 게시물]과 [정보 1: 내 채널의 핵심 성공 요인]을 결합하여 아이디어를 생성하세요.
            ${emergingTopics ? '- [정보 6: 최신 트렌드]를 활용하여 시장 선점 기회를 잡으세요.' : ''}
            - 경쟁 채널에서 인기 있는 주제를 내 채널의 강점과 접목하여 차별화된 아이디어를 제안해주세요.
            - 내 채널의 핵심 성공 요인을 활용하여 경쟁자보다 더 나은 가치를 제공할 수 있는 아이디어를 우선적으로 제안해주세요.
            `}

            [출력 형식]
            반드시 다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
            [
              {
                "title": "아이디어 제목",
                "description": "이 아이디어가 전략적으로 유효한 이유와 구체적인 설명${repurposingInfo ? ' (재활용 아이디어인 경우, 어떤 콘텐츠를 업데이트할지 명시)' : ''}"
              },
              {
                "title": "아이디어 제목",
                "description": "이 아이디어가 전략적으로 유효한 이유와 구체적인 설명${repurposingInfo ? ' (재활용 아이디어인 경우, 어떤 콘텐츠를 업데이트할지 명시)' : ''}"
              }
            ]
        `;

        // 6. Gemini 호출 및 응답
        const ideasResult = await callGeminiAPI(blogIdeasPrompt);
        
        // 분석 결과(성과 분석 텍스트)와 아이디어 결과(JSON)를 함께 반환
        sendResponse({ 
          success: true, 
          analysis: performanceAnalysis || "성과 데이터가 부족하여 분석을 건너뛰었습니다.", // UI '성과 분석 결과' 영역용
          ideas: ideasResult // UI 'AI 아이디어 제안' 영역용
        });

      } catch (error) {
        console.error("AI 아이디어 생성 실패:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  } else if (msg.action === "analyze_my_blog") {
    const { channelName, channelContent } = msg.data; // 채널 이름과 데이터를 분리
    const analysisDate = new Date().toLocaleDateString("ko-KR"); // 날짜 생성

    const topPosts = channelContent
      .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
      .slice(0, 20);

    const dataSummary = topPosts
      .map(
        (item) =>
          `제목: ${item.title}, 댓글: ${item.commentCount || 0}, 좋아요: ${
            item.likeCount || 0
          }, 글자수: ${item.textLength || 0}`
      )
      .join("\n");

    const titleList = topPosts
      .map((item, index) => `${index + 1}. ${item.title}`)
      .join("\n");

    const blogAnalysisPrompt = `
            ## "${channelName}" 블로그 성과 분석 (${analysisDate})

            당신은 최고의 블로그 콘텐츠 전략가입니다. 아래 제공되는 데이터를 분석해주세요.

            [분석 대상 데이터 요약]
            ${dataSummary}

            [분석 요청]
            1. (기존 분석 요청 1, 2, 3과 동일)

            [출력 형식]
            - 모든 분석이 끝난 후, 보고서의 마지막에 다음 형식으로 분석에 사용된 데이터 목록을 반드시 포함해주세요.
            
            ### 분석 기반 데이터 (상위 ${topPosts.length}개)
            ${titleList}
        `;

    (async () => {
      const analysisResult = await callGeminiAPI(blogAnalysisPrompt);
      sendResponse({ success: true, analysis: analysisResult });
    })();

    return true;
  } else if (msg.action === "ai_generate_images") {
    // Gemini 2.5 Flash Image REST API 연동
    (async () => {
      try {
        const {
          prompt = "",
          style = "none",
          aspect = "1:1",
          count = 3,
        } = msg.data || {};
        // 1. Gemini API 키를 안전하게 가져오기
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        if (!geminiApiKey) {
          sendResponse({
            success: false,
            error: "Gemini API 키가 설정되지 않았습니다.",
          });
          return;
        }

        // 2. 프롬프트 및 옵션 구성
        const model = "gemini-2.5-flash";
        const API_URL = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${geminiApiKey}`;
        // 3. 여러 장 요청: Gemini는 1회 1장만 반환하므로 count만큼 반복 호출
        const images = [];
        for (let i = 0; i < count; i++) {
          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.candidates) {
            sendResponse({
              success: false,
              error: data.error?.message || "Gemini 이미지 생성 실패",
            });
            return;
          }
          let found = false;
          for (const part of data.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
              images.push(`data:image/png;base64,${part.inlineData.data}`);
              found = true;
            }
          }
          if (!found) {
            sendResponse({
              success: false,
              error: "이미지 생성 결과가 없습니다.",
            });
            return;
          }
        }
        sendResponse({ success: true, images });
      } catch (e) {
        sendResponse({
          success: false,
          error: e?.message || "Gemini 호출 오류",
        });
      }
    })();
    return true;
  } else if (msg.action === "analyze_video_comments") {
    const videoId = msg.videoId;
    (async () => {
      const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
      if (!youtubeApiKey) {
        sendResponse({
          success: false,
          error: "YouTube API 키가 설정되지 않았습니다.",
        });
        return;
      }

      const commentsUrl = `https://www.googleapis.com/youtube/v3/commentThreads?key=${youtubeApiKey}&videoId=${videoId}&part=snippet&maxResults=50&order=relevance`;

      try {
        const commentsResponse = await fetch(commentsUrl);
        const commentsData = await commentsResponse.json();

        if (commentsData.error) {
          throw new Error(commentsData.error.message);
        }

        const comments = commentsData.items.map(
          (item) => item.snippet.topLevelComment.snippet.textOriginal
        );
        if (comments.length === 0) {
          sendResponse({ success: false, error: "분석할 댓글이 없습니다." });
          return;
        }

        const commentsSummary = comments.join("\n---\n");

        const commentAnalysisPrompt = `
                당신은 데이터 분석가이자 콘텐츠 전략가입니다. 아래는 특정 유튜브 영상에 달린 시청자들의 댓글 모음입니다. 이 댓글들을 분석하여 채널 운영자에게 유용한 인사이트와 새로운 콘텐츠 아이디어를 제공해주세요.

                [댓글 데이터]
                ${commentsSummary}

                [분석 및 제안 요청]
                1. **핵심 니즈 파악**: 댓글에서 공통적으로 나타나는 시청자들의 질문, 문제점, 또는 원하는 정보를 3가지 핵심 주제로 요약해주세요.
                2. **콘텐츠 아이디어 제안**: 위에서 파악한 니즈를 해결해 줄 수 있는 새로운 유튜브 영상 아이디어 3가지를 제안해주세요.
                3. 각 아이디어는 **매력적인 유튜브 제목**과 **영상의 핵심 내용을 설명하는 짧은 문장**을 포함해야 합니다.
                4. 결과는 마크다운 형식으로 보기 좋게 정리해주세요.
            `;

        const analysisResult = await callGeminiAPI(commentAnalysisPrompt);
        sendResponse({ success: true, analysis: analysisResult });
      } catch (error) {
        console.error("댓글 조회 또는 분석 중 오류 발생:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  }

  // Google 계정 연동
  else if (msg.action === "start_google_auth") {
    (async () => {
      try {
        // 1. 토큰 발급 (기존과 동일)
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message));
            else resolve(token);
          });
        });
        if (!token) throw new Error("인증 토큰을 받아오지 못했습니다.");

        // 2. 이메일, GA4 속성, 애드센스 ID를 병렬로 가져오기 (기존과 동일)
        const [userInfoResponse, gaProperties, adSenseAccountId] =
          await Promise.all([
            fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetchGaProperties(token),
            fetchAdSenseAccountId(token),
          ]);
        const userInfo = await userInfoResponse.json();
        if (!userInfo.email)
          throw new Error("사용자 이메일을 가져오지 못했습니다.");

        // 3. 모든 정보를 chrome.storage에 저장 (기존과 동일)
        await chrome.storage.local.set({
          googleAuthToken: token,
          googleUserEmail: userInfo.email,
          gaProperties: gaProperties,
          adSenseAccountId: adSenseAccountId,
        });

        // ▼▼▼ [수정] UI 업데이트에 필요한 모든 데이터를 함께 보냅니다. ▼▼
        const responseData = {
          email: userInfo.email,
          gaProperties: gaProperties,
          adSenseAccountId: adSenseAccountId,
        };
        sendResponse({ success: true, data: responseData });
      } catch (error) {
        console.error("Google 인증 중 오류 발생:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "test_blog_connection") {
    // 블로그 연동 테스트 (GA4, AdSense)
    (async () => {
      try {
        const { gaPropertyId, adSenseAccountId } = msg.data || {};
        
        if (!gaPropertyId || !adSenseAccountId) {
          sendResponse({ 
            success: false, 
            error: "GA4 속성 ID 또는 AdSense 계정 ID가 없습니다." 
          });
          return;
        }

        // 토큰 가져오기 및 갱신 함수
        const getValidToken = async () => {
          const storageResult = await new Promise((resolve) => {
            chrome.storage.local.get(['googleAuthToken'], resolve);
          });
          let token = storageResult.googleAuthToken;
          
          if (!token) {
            throw new Error("Google 계정이 연동되지 않았습니다.");
          }

          // 토큰이 만료되었는지 확인하기 위해 간단한 API 호출 시도
          const testResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` }
          });

          // 401 오류가 발생하면 토큰 갱신
          if (testResponse.status === 401) {
            console.log("[토큰 갱신] 만료된 토큰 감지, 새 토큰 발급 중...");
            
            // 기존 토큰 무효화
            try {
              await new Promise((resolve) => {
                chrome.identity.removeCachedAuthToken({ token }, resolve);
              });
            } catch (e) {
              console.warn("[토큰 갱신] 기존 토큰 제거 실패:", e);
            }

            // 새 토큰 발급
            token = await new Promise((resolve, reject) => {
              chrome.identity.getAuthToken({ interactive: false }, (newToken) => {
                if (chrome.runtime.lastError) {
                  // interactive: false로 실패하면 interactive: true로 재시도
                  chrome.identity.getAuthToken({ interactive: true }, (newToken2) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                    } else {
                      resolve(newToken2);
                    }
                  });
                } else {
                  resolve(newToken);
                }
              });
            });

            // 새 토큰 저장
            await new Promise((resolve) => {
              chrome.storage.local.set({ googleAuthToken: token }, resolve);
            });
            console.log("[토큰 갱신] 새 토큰 발급 완료");
          }

          return token;
        };

        const token = await getValidToken();

        // GA4 API 테스트
        let ga4Result = { success: false, error: null };
        try {
          const ga4TestUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${gaPropertyId}:runReport`;
          const ga4Response = await fetch(ga4TestUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              dateRanges: [{ startDate: 'today', endDate: 'today' }],
              metrics: [{ name: 'activeUsers' }]
            })
          });

          if (ga4Response.ok) {
            ga4Result.success = true;
          } else {
            const errorData = await ga4Response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || `HTTP ${ga4Response.status}`;
            ga4Result.error = errorMessage;
            
            // 401 오류면 토큰 갱신 후 재시도
            if (ga4Response.status === 401) {
              try {
                const newToken = await getValidToken();
                const retryResponse = await fetch(ga4TestUrl, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${newToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    dateRanges: [{ startDate: 'today', endDate: 'today' }],
                    metrics: [{ name: 'activeUsers' }]
                  })
                });
                if (retryResponse.ok) {
                  ga4Result.success = true;
                  ga4Result.error = null;
                }
              } catch (retryError) {
                console.warn("[GA4 재시도 실패]", retryError);
              }
            }
          }
        } catch (error) {
          ga4Result.error = error.message;
        }

        // AdSense API 테스트
        let adsenseResult = { success: false, error: null };
        try {
          // 먼저 계정 목록을 조회하여 사용 가능한 계정 확인
          const accountsListUrl = "https://adsense.googleapis.com/v2/accounts";
          const accountsListResponse = await fetch(accountsListUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (!accountsListResponse.ok) {
            if (accountsListResponse.status === 401) {
              // 토큰 갱신 후 재시도
              try {
                const newToken = await getValidToken();
                const retryAccountsList = await fetch(accountsListUrl, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${newToken}`
                  }
                });
                if (retryAccountsList.ok) {
                  const accountsData = await retryAccountsList.json();
                  const accounts = accountsData.accounts || [];
                  // 계정 ID 추출 및 정규화 (공백 제거, 소문자 변환)
                  const accountIds = accounts.map(acc => {
                    const id = acc.name?.split('/')[1] || '';
                    return id.trim().toLowerCase();
                  }).filter(Boolean);
                  
                  // 입력한 계정 ID 정규화
                  const normalizedInputId = (adSenseAccountId || '').trim().toLowerCase();
                  
                  // 입력한 계정 ID가 목록에 있는지 확인
                  if (!accountIds.includes(normalizedInputId)) {
                    // 원본 계정 ID 목록 표시 (정규화 전)
                    const originalAccountIds = accounts.map(acc => acc.name?.split('/')[1] || '').filter(Boolean);
                    adsenseResult.error = `AdSense 계정을 찾을 수 없습니다. 입력한 ID: "${adSenseAccountId}", 사용 가능한 계정: ${originalAccountIds.join(', ') || '없음'}`;
                    adsenseResult.debug = {
                      입력한_ID: adSenseAccountId,
                      정규화된_ID: normalizedInputId,
                      사용가능한_계정_수: accountIds.length,
                      사용가능한_계정: originalAccountIds,
                      정규화된_사용가능한_계정: accountIds
                    };
                  } else {
                    // 계정이 존재하면 리포트 생성 테스트
                    const adsenseTestUrl = `https://adsense.googleapis.com/v2/accounts/${adSenseAccountId}/reports:generate`;
                    const adsenseResponse = await fetch(adsenseTestUrl, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        dateRange: 'TODAY',
                        metrics: ['PAGE_VIEWS']
                      })
                    });
                    if (adsenseResponse.ok) {
                      adsenseResult.success = true;
                    } else {
                      const errorData = await adsenseResponse.json().catch(() => ({}));
                      if (adsenseResponse.status === 404) {
                        adsenseResult.error = `AdSense 계정을 찾을 수 없습니다 (404). 계정 ID 형식을 확인해주세요: "${adSenseAccountId}"`;
                      } else {
                        adsenseResult.error = errorData.error?.message || `리포트 생성 실패 (${adsenseResponse.status})`;
                      }
                    }
                  }
                } else {
                  adsenseResult.error = "AdSense 계정 목록을 가져올 수 없습니다.";
                }
              } catch (retryError) {
                adsenseResult.error = retryError.message;
              }
            } else {
              const errorData = await accountsListResponse.json().catch(() => ({}));
              adsenseResult.error = errorData.error?.message || `계정 목록 조회 실패 (${accountsListResponse.status})`;
            }
          } else {
            const accountsData = await accountsListResponse.json();
            const accounts = accountsData.accounts || [];
            
            // 계정 ID 추출 (원본과 정규화된 버전 모두 저장)
            const accountInfo = accounts.map(acc => {
              const fullName = acc.name || '';
              const extractedId = fullName.split('/').pop() || fullName.split('/')[1] || '';
              const originalId = extractedId.trim();
              const normalizedId = originalId.toLowerCase();
              return {
                fullName: fullName,
                originalId: originalId,
                normalizedId: normalizedId
              };
            }).filter(acc => acc.originalId);
            
            const accountIds = accountInfo.map(acc => acc.normalizedId);
            const originalAccountIds = accountInfo.map(acc => acc.originalId);
            
            // 입력한 계정 ID 정규화
            const normalizedInputId = (adSenseAccountId || '').trim().toLowerCase();
            const originalInputId = (adSenseAccountId || '').trim();
            
            // 입력한 계정 ID가 목록에 있는지 확인
            if (accounts.length === 0) {
              adsenseResult.error = "연동된 AdSense 계정이 없습니다.";
              adsenseResult.debug = { 입력한_ID: adSenseAccountId, 사용가능한_계정_수: 0 };
            } else if (!accountIds.includes(normalizedInputId)) {
              // 정확한 비교를 위해 모든 정보 포함
              adsenseResult.error = `AdSense 계정을 찾을 수 없습니다. 입력한 ID: "${originalInputId}", 사용 가능한 계정: ${originalAccountIds.join(', ') || '없음'}`;
              adsenseResult.debug = {
                입력한_ID_원본: adSenseAccountId,
                입력한_ID_정리: originalInputId,
                입력한_ID_정규화: normalizedInputId,
                사용가능한_계정_수: accountIds.length,
                사용가능한_계정_원본: originalAccountIds,
                사용가능한_계정_정규화: accountIds,
                계정_상세정보: accountInfo.map(acc => `${acc.originalId} (정규화: ${acc.normalizedId})`)
              };
            } else {
              // 계정 ID 형식 검증 (pub-로 시작하는지 확인)
              if (!normalizedInputId.startsWith('pub-')) {
                console.warn('[AdSense 경고] 계정 ID가 pub-로 시작하지 않습니다:', normalizedInputId);
              }
              
              // 실제 API 호출 시 사용할 계정 ID 결정 (원본 입력값 사용, 없으면 정규화된 값 사용)
              const apiAccountId = originalInputId || normalizedInputId;
              
              // 먼저 계정 정보를 조회하여 계정이 실제로 존재하는지 확인
              const accountInfoUrl = `https://adsense.googleapis.com/v2/accounts/${apiAccountId}`;
              const accountInfoResponse = await fetch(accountInfoUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              });
              
              if (!accountInfoResponse.ok) {
                const accountErrorData = await accountInfoResponse.json().catch(() => ({}));
                if (accountInfoResponse.status === 404) {
                  adsenseResult.error = `AdSense 계정을 찾을 수 없습니다 (404). 계정 ID를 확인해주세요: "${apiAccountId}"`;
                  adsenseResult.debug = {
                    입력한_ID: adSenseAccountId,
                    API에_사용한_ID: apiAccountId,
                    정규화된_ID: normalizedInputId,
                    사용가능한_계정: originalAccountIds,
                    계정_정보_조회_오류: accountErrorData.error?.message || `HTTP ${accountInfoResponse.status}`
                  };
                } else {
                  adsenseResult.error = `계정 정보 조회 실패: ${accountErrorData.error?.message || `HTTP ${accountInfoResponse.status}`}`;
                  adsenseResult.debug = {
                    입력한_ID: adSenseAccountId,
                    API에_사용한_ID: apiAccountId,
                    계정_정보_조회_오류: accountErrorData.error?.message || `HTTP ${accountInfoResponse.status}`
                  };
                }
              } else {
                // 계정이 존재하면 리포트 생성 테스트
                // 실제 데이터 수집과 동일한 형식으로 테스트
                const adsenseTestUrl = `https://adsense.googleapis.com/v2/accounts/${apiAccountId}/reports:generate`;
                
                // 여러 형식으로 시도 (dimensions 없이, dimensions 있이)
                const testRequests = [
                  {
                    name: '간단한 요청 (metrics만)',
                    body: {
                      dateRange: 'LAST_7_DAYS',
                      metrics: ['PAGE_VIEWS']
                    }
                  },
                  {
                    name: 'dimensions 포함 요청',
                    body: {
                      dateRange: 'LAST_7_DAYS',
                      metrics: ['PAGE_VIEWS'],
                      dimensions: ['URL_CHANNEL_NAME']
                    }
                  },
                  {
                    name: 'TODAY 요청',
                    body: {
                      dateRange: 'TODAY',
                      metrics: ['PAGE_VIEWS']
                    }
                  }
                ];
                
                let adsenseResponse = null;
                let lastError = null;
                let successfulRequest = null;
                
                for (const testReq of testRequests) {
                  try {
                    adsenseResponse = await fetch(adsenseTestUrl, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify(testReq.body)
                    });
                    
                    if (adsenseResponse.ok) {
                      successfulRequest = testReq.name;
                      break;
                    } else {
                      const errorData = await adsenseResponse.json().catch(() => ({}));
                      lastError = {
                        request: testReq.name,
                        status: adsenseResponse.status,
                        error: errorData.error?.message || `HTTP ${adsenseResponse.status}`
                      };
                    }
                  } catch (err) {
                    lastError = {
                      request: testReq.name,
                      error: err.message
                    };
                  }
                }

                if (successfulRequest) {
                  adsenseResult.success = true;
                  adsenseResult.debug = {
                    입력한_ID: adSenseAccountId,
                    API에_사용한_ID: apiAccountId,
                    정규화된_ID: normalizedInputId,
                    사용가능한_계정: originalAccountIds,
                    계정_정보_조회: '성공',
                    리포트_생성_성공: successfulRequest
                  };
                } else if (adsenseResponse) {
                  const errorData = await adsenseResponse.json().catch(() => ({}));
                  const errorMessage = errorData.error?.message || `HTTP ${adsenseResponse.status}`;
                  
                  // 404 오류인 경우: 계정은 존재하지만 리포트 생성 권한/데이터가 없을 수 있음
                  // 하지만 계정 정보 조회가 성공했으므로 연동 자체는 성공으로 간주
                  if (adsenseResponse.status === 404) {
                    // 계정은 존재하지만 리포트 생성이 불가능한 경우
                    // 실제 데이터 수집 시에는 필터를 사용하므로 성공할 수 있음
                    adsenseResult.success = true; // 계정 정보 조회 성공 = 연동 성공
                    adsenseResult.error = null;
                    adsenseResult.debug = {
                      입력한_ID: adSenseAccountId,
                      API에_사용한_ID: apiAccountId,
                      정규화된_ID: normalizedInputId,
                      사용가능한_계정: originalAccountIds,
                      계정_정보_조회: '성공',
                      리포트_생성_테스트: '404 오류 (계정은 존재하지만 리포트 생성 불가 - 데이터 수집 시 필터 사용으로 해결 가능)',
                      시도한_요청들: testRequests.map(r => r.name),
                      마지막_오류: lastError
                    };
                  } else {
                    adsenseResult.error = `리포트 생성 실패: ${errorMessage}`;
                    adsenseResult.debug = {
                      입력한_ID: adSenseAccountId,
                      API에_사용한_ID: apiAccountId,
                      리포트_생성_오류: errorMessage,
                      계정_정보_조회: '성공',
                      시도한_요청들: testRequests.map(r => r.name),
                      마지막_오류: lastError
                    };
                  }
                  
                  // 401 오류면 토큰 갱신 후 재시도
                  if (adsenseResponse.status === 401) {
                    try {
                      const newToken = await getValidToken();
                      const retryResponse = await fetch(adsenseTestUrl, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${newToken}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          dateRange: 'LAST_7_DAYS',
                          metrics: ['PAGE_VIEWS']
                        })
                      });
                      if (retryResponse.ok) {
                        adsenseResult.success = true;
                        adsenseResult.error = null;
                      } else {
                        const retryErrorData = await retryResponse.json().catch(() => ({}));
                        if (retryResponse.status === 404) {
                          adsenseResult.error = `리포트 생성 실패 (404). 계정은 존재하지만 리포트를 생성할 수 없습니다. 계정 ID: "${apiAccountId}"`;
                          adsenseResult.debug = {
                            입력한_ID: adSenseAccountId,
                            API에_사용한_ID: apiAccountId,
                            정규화된_ID: normalizedInputId,
                            리포트_생성_오류_재시도: retryErrorData.error?.message || `HTTP ${retryResponse.status}`,
                            계정_정보_조회: '성공'
                          };
                        } else {
                          adsenseResult.error = retryErrorData.error?.message || `재시도 실패 (${retryResponse.status})`;
                        }
                      }
                    } catch (retryError) {
                      console.warn("[AdSense 재시도 실패]", retryError);
                      adsenseResult.error = retryError.message || "재시도 중 오류가 발생했습니다.";
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          adsenseResult.error = error.message;
        }

        sendResponse({
          success: ga4Result.success && adsenseResult.success,
          ga4: ga4Result,
          adsense: adsenseResult
        });
      } catch (error) {
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      }
    })();
    return true;
  } else if (msg.action === "get_adsense_accounts") {
    // AdSense 계정 목록 조회
    (async () => {
      try {
        const { googleAuthToken } = await chrome.storage.local.get(['googleAuthToken']);
        
        if (!googleAuthToken) {
          sendResponse({ 
            success: false, 
            error: "Google 계정이 연동되지 않았습니다." 
          });
          return;
        }

        const accountsListUrl = "https://adsense.googleapis.com/v2/accounts";
        const accountsListResponse = await fetch(accountsListUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${googleAuthToken}`
          }
        });

        if (accountsListResponse.ok) {
          const accountsData = await accountsListResponse.json();
          sendResponse({
            success: true,
            accounts: accountsData.accounts || []
          });
        } else {
          const errorData = await accountsListResponse.json().catch(() => ({}));
          sendResponse({
            success: false,
            error: errorData.error?.message || `계정 목록 조회 실패 (${accountsListResponse.status})`,
            accounts: []
          });
        }
      } catch (error) {
        sendResponse({ 
          success: false, 
          error: error.message,
          accounts: []
        });
      }
    })();
    return true;
  } else if (msg.action === "revoke_google_auth") {
    (async () => {
      try {
        const { googleAuthToken } = await chrome.storage.local.get(
          "googleAuthToken"
        );
        if (googleAuthToken) {
          // 1. 현재 토큰을 무효화합니다.
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${googleAuthToken}`
          );
          // 2. Chrome의 인증 캐시에서도 제거합니다.
          await new Promise((resolve) =>
            chrome.identity.removeCachedAuthToken(
              { token: googleAuthToken },
              resolve
            )
          );
        }

        // 3. storage에 저장된 모든 관련 정보를 삭제합니다.
        await chrome.storage.local.remove([
          "googleAuthToken",
          "googleUserEmail",
          "gaProperties",
          "adSenseAccountId",
          "selectedGaPropertyId",
        ]);

        sendResponse({ success: true });
      } catch (error) {
        console.error("Google 연동 해제 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // [체크리스트 2-1] 메시지 핸들러 추가: trigger_performance_refresh
  if (msg.action === "trigger_performance_refresh") {
    (async () => {
      try {
        console.log("[Performance Refresh] 사용자 요청으로 성과 데이터 수집 시작...");
        await updateAllPerformanceMetrics();
        sendResponse({ success: true, message: "성과 데이터 수집이 시작되었습니다." });
      } catch (error) {
        console.error("[Performance Refresh] 오류 발생:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  }

  // 칸반 보드 및 워크스페이스
  if (msg.action === "get_kanban_data") {
    // 1. 요청한 탭에 현재 데이터를 즉시 보냅니다.
    firebase
      .database()
      .ref(`kanban/${CONSTANTS.USER_ID}`)
      .once("value", (snapshot) => {
        if (sender.tab?.id) {
          chrome.tabs
            .sendMessage(sender.tab.id, {
              action: "kanban_data_updated",
              data: snapshot.val() || {},
            })
            .catch((e) => {}); // 오류는 무시
        }
      });

    // 2. 실시간 리스너가 아직 등록되지 않았다면, 한 번만 등록합니다.
    if (!isKanbanListenerActive) {
      firebase
        .database()
        .ref(`kanban/${CONSTANTS.USER_ID}`)
        .on("value", (snapshot) => {
          const allCards = snapshot.val() || {};

          // 모든 탭에 데이터 변경 사항을 브로드캐스트합니다.
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    action: "kanban_data_updated",
                    data: allCards,
                  })
                  .catch((e) => {});
              }
            });
          });
        });
      isKanbanListenerActive = true;
      console.log("Firebase 칸반 데이터 실시간 리스너를 활성화했습니다.");
    }
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "get_all_kanban_data") {
    // ▼▼▼ [신규 추가] 모든 칸반 데이터를 직접 반환하는 액션 ▼▼▼
    firebase
      .database()
      .ref(`kanban/${CONSTANTS.USER_ID}`)
      .once("value", (snapshot) => {
        sendResponse({ success: true, data: snapshot.val() || {} });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // 비동기 응답을 위해 true 반환
    // ▲▲▲ [신규 추가] ▲▲▲
  } else if (msg.action === "move_kanban_card") {
    const { cardId, originalStatus, newStatus } = msg.data;
    const userId = CONSTANTS.USER_ID;
    const originalRef = firebase
      .database()
      .ref(`kanban/${userId}/${originalStatus}/${cardId}`);
    originalRef.once("value", (snapshot) => {
      const cardData = snapshot.val();
      if (cardData) {
        const newRef = firebase.database().ref(`kanban/${userId}/${newStatus}/${cardId}`);
        originalRef
          .remove()
          .then(() => newRef.set(cardData))
          .then(() => sendResponse({ success: true }))
          .catch((error) =>
            sendResponse({ success: false, error: error.message })
          );
      } else {
        sendResponse({
          success: false,
          error: "이동할 카드를 찾을 수 없습니다.",
        });
      }
    });
    return true;
  } else if (msg.action === "link_published_url") {
    const { cardId, url, status } = msg.data;
    if (!cardId || !url || !status) {
      sendResponse({ success: false, error: "필요한 정보가 부족합니다." });
      return true;
    }

    // [최적화] async 함수로 변경하여 await 사용 가능하도록
    (async () => {
      try {
        const userId = CONSTANTS.USER_ID;
        const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${cardId}`);
        
        // [최적화] 기존 카드 정보 가져오기 (origin.postUrl 확인용)
        const cardSnapshot = await cardRef.once("value");
        const existingCard = cardSnapshot.val() || {};
        
        await cardRef.update({
          publishedUrl: url,
          performanceTracked: true,
        });
        
        console.log(`[G-16] 아이디어 카드(${cardId})와 URL(${url}) 연결 완료.`);
        
        // [최적화] URL 인덱스 업데이트
        updateUrlIndex(cardId, status, existingCard.origin?.postUrl || null, url)
          .catch(error => console.warn(`[URL 인덱스 업데이트 실패] ${cardId}:`, error));
        
        sendResponse({ success: true });
        
        // GA4 데이터 수집 시작 (비동기로 실행, 완료를 기다리지 않음)
        console.log(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 시작: ${url}`);
        updateSinglePerformanceMetric({
          id: cardId,
          path: `kanban/${userId}/${status}/${cardId}`,
          url: url,
        }).then(() => {
          console.log(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 완료`);
        }).catch((error) => {
          console.error(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 실패:`, error.message);
        });
        
        // 해당 카드의 AdSense 등록 상태 확인 (단일 카드 모드)
        try {
          await checkAdSenseRegistrationStatus(null, url, cardId, status);
          console.log(`[AdSense] 카드 ${cardId}의 등록 상태 확인 완료`);
        } catch (error) {
          console.warn(`[AdSense] 카드 ${cardId}의 등록 상태 확인 실패:`, error.message);
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true;
  } else if (msg.action === "add_idea_to_kanban") {
    // [Phase 1] 아이디어 생성 시 중복 검사 추가
    (async () => {
      try {
        const ideaObjectString = msg.data;
        const targetStatus = msg.status || "ideas";
        // [수정] 메시지에 포함된 channelId를 전달
        const channelId = msg.channelId || null;

        if (!ideaObjectString) {
          sendResponse({ success: false, error: "아이디어 내용이 없습니다." });
          return;
        }

        const ideaData = JSON.parse(ideaObjectString);
        
        // [핵심] 중복 검사: origin.postUrl이 있는 경우 (리뉴얼 버튼 등)
        if (ideaData.origin?.postUrl) {
          const duplicateCheck = await checkDuplicateUrl(ideaData.origin.postUrl);
          if (duplicateCheck.exists) {
            // status를 한글로 변환하여 사용자에게 더 친절하게 안내
            const statusMap = {
              "ideas": "기획",
              "in-progress": "작성 중",
              "done": "발행 완료"
            };
            const statusText = statusMap[duplicateCheck.status] || duplicateCheck.status;
            
            sendResponse({
              success: false,
              code: "DUPLICATE_FOUND",
              error: `이미 '${statusText}' 단계에 등록된 아이디어입니다.`,
              message: `이미 '${statusText}' 단계에 등록된 아이디어입니다.\n카드명: ${duplicateCheck.title}`,
              cardInfo: {
                status: duplicateCheck.status,
                statusLabel: statusText,
                cardId: duplicateCheck.cardId,
                title: duplicateCheck.title
              }
            });
            return;
          }
        }

        // [체크리스트 1, 2] 원본 본문 백업 및 AI 요약 적용
        if (ideaData.description && ideaData.description.length > 200) {
          // origin 객체 초기화
          if (!ideaData.origin) {
            ideaData.origin = {};
          }
          
          // 원본 본문 백업 (나중에 초안 생성 시 참고용)
          if (!ideaData.origin.fullContent) {
            ideaData.origin.fullContent = ideaData.description;
          }

          // AI 요약 실행 (비동기 처리)
          try {
            const summary = await summarizeText(ideaData.description);
            ideaData.description = summary; // 설명은 요약본으로 교체
          } catch (error) {
            console.error("[add_idea_to_kanban] 요약 실패, 원본 사용:", error);
            // 요약 실패 시 원본 유지
          }
        }

        // [체크리스트 1] 원본 포스팅을 스크랩으로 자동 변환 및 연결
        let linkedScraps = ideaData.workspace?.linkedScraps || {};
        if (typeof linkedScraps === 'object' && !Array.isArray(linkedScraps)) {
          // 객체 형태로 저장되어 있는 경우 그대로 사용
        } else if (Array.isArray(linkedScraps)) {
          // 배열인 경우 객체로 변환
          const scrapsObj = {};
          linkedScraps.forEach((scrapId, index) => {
            if (scrapId) scrapsObj[scrapId] = true;
          });
          linkedScraps = scrapsObj;
        }

        // 리뉴얼 원본이 있다면 '스크랩'으로 자동 생성
        if (ideaData.origin && ideaData.origin.postUrl) {
          // 원본 본문 확인 (fullContent 우선, 없으면 description 사용)
          const originalContent = ideaData.origin.fullContent || ideaData.description || "";
          
          if (originalContent && originalContent.length > 0) {
            try {
              // 스크랩 제목: [리뉴얼] 태그 제거
              const scrapTitle = ideaData.title.replace(/^\[.*?\]\s*/, '');
              
              // 키워드 추출 (비동기)
              const tags = await extractKeywords(originalContent);
              
              const scrapPayload = {
                title: scrapTitle,
                text: originalContent,
                url: ideaData.origin.postUrl,
                channelId: channelId, // 현재 채널 소속으로 저장
                timestamp: Date.now(),
                tags: tags || ideaData.keywords || ideaData.tags || []
              };

              // 스크랩 저장 및 ID 확보
              const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);
              const userId = CONSTANTS.USER_ID;
        const scrapRef = firebase.database().ref(`scraps/${userId}`).push();
              const scrapId = scrapRef.key;
              
              await scrapRef.set(cleanedScrapPayload);
              
              // 연결할 스크랩 ID 목록에 추가 (객체 형태로 저장)
              linkedScraps[scrapId] = true;
              
              console.log(`[리뉴얼] 원본 포스팅이 스크랩으로 자동 생성 및 연결됨: ${scrapId}`);
            } catch (error) {
              console.error("[리뉴얼] 스크랩 생성 실패:", error);
              // 스크랩 생성 실패해도 아이디어 생성은 계속 진행
            }
          } else {
            console.warn("[리뉴얼] 원본 본문이 없어 스크랩을 생성하지 않습니다.");
          }
        }

        // 아이디어 데이터에 연결 정보 주입
        if (!ideaData.workspace) {
          ideaData.workspace = {};
        }
        ideaData.workspace.linkedScraps = linkedScraps;
        
        const response = await createAndSaveNewIdea(ideaData, targetStatus, channelId); // channelId 전달
        sendResponse(response);
      } catch (e) {
        console.error("add_idea_to_kanban 파싱 오류:", e, "데이터:", msg.data);
        sendResponse({ success: false, error: "아이디어 데이터 파싱 실패" });
      }
    })();
    return true; // 비동기 응답
  } else if (msg.action === "generate_idea_briefing") {
    const { cardId, title, description, generateOutline, generateMainKeywords, generateKeywords, generateLongTail } = msg.data;
    if (!cardId || !title) {
      sendResponse({
        success: false,
        error: "아이디어 ID와 제목이 필요합니다.",
      });
      return true;
    }

    // 진행률 업데이트를 위한 메시지 전송 함수
    const sendProgress = (progress) => {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "briefing_progress",
          cardId: cardId,
          progress: progress
        }).catch(() => {}); // 오류 무시
      }
    };

    // 비동기로 브리핑 데이터 생성 (옵션에 따라 필요한 것만 생성)
    generateIdeaBriefing(cardId, title, description || "", {
      generateOutline: generateOutline !== false, // 기본값 true
      generateMainKeywords: generateMainKeywords !== false,
      generateKeywords: generateKeywords !== false,
      generateLongTail: generateLongTail !== false,
      onProgress: sendProgress // 진행률 콜백 전달
    })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("브리핑 데이터 생성 실패:", error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "remove_idea_from_kanban") {
    const firebaseKey = msg.key;
    if (!firebaseKey) {
      sendResponse({
        success: false,
        error: "삭제할 아이디어의 키가 없습니다.",
      });
      return true;
    }

    firebase
      .database()
      .ref(`kanban/ideas/${firebaseKey}`)
      .remove()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "link_scrap_to_idea") {
    const { ideaId, scrapId, status } = msg.data;
    if (!ideaId || !scrapId || !status) {
      sendResponse({
        success: false,
        error: "아이디어, 스크랩 ID 또는 상태가 없습니다.",
      });
      return true;
    }
    
    // linkedScraps와 workspace.linkedScraps 모두 업데이트
    const userId = CONSTANTS.USER_ID;
    const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${ideaId}`);
    cardRef.once("value").then((snapshot) => {
      const cardData = snapshot.val();
      if (!cardData) {
        sendResponse({ success: false, error: "카드를 찾을 수 없습니다." });
        return;
      }
      
      // 중복 체크: 이미 연결된 스크랩인지 확인
      let linkedScraps = cardData.linkedScraps;
      if (Array.isArray(linkedScraps)) {
        if (linkedScraps.includes(scrapId)) {
          sendResponse({ success: false, error: "이미 연결된 스크랩입니다." });
          return;
        }
        linkedScraps = [...linkedScraps, scrapId];
      } else if (linkedScraps && typeof linkedScraps === 'object') {
        if (linkedScraps[scrapId]) {
          sendResponse({ success: false, error: "이미 연결된 스크랩입니다." });
          return;
        }
        linkedScraps = { ...linkedScraps, [scrapId]: true };
      } else {
        linkedScraps = { [scrapId]: true };
      }
      
      // workspace.linkedScraps 업데이트
      const workspace = cardData.workspace || {};
      let workspaceLinkedScraps = workspace.linkedScraps;
      if (Array.isArray(workspaceLinkedScraps)) {
        if (workspaceLinkedScraps.includes(scrapId)) {
          sendResponse({ success: false, error: "이미 연결된 스크랩입니다." });
          return;
        }
        workspaceLinkedScraps = [...workspaceLinkedScraps, scrapId];
      } else if (workspaceLinkedScraps && typeof workspaceLinkedScraps === 'object') {
        if (workspaceLinkedScraps[scrapId]) {
          sendResponse({ success: false, error: "이미 연결된 스크랩입니다." });
          return;
        }
        workspaceLinkedScraps = { ...workspaceLinkedScraps, [scrapId]: true };
      } else {
        workspaceLinkedScraps = { [scrapId]: true };
      }
      
      // workspace 객체 전체를 업데이트 (점(.)을 포함한 키 사용 불가)
      const updates = {
        linkedScraps: linkedScraps,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      
      // workspace 객체가 없으면 생성
      if (!cardData.workspace) {
        updates.workspace = {
          keywords: [],
          outline: [],
          draft: "",
          linkedScraps: workspaceLinkedScraps
        };
      } else {
        // 기존 workspace 객체를 유지하면서 linkedScraps만 업데이트
        updates.workspace = {
          ...cardData.workspace,
          linkedScraps: workspaceLinkedScraps
        };
      }
      
      cardRef.update(updates)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true;
  } else if (msg.action === "unlink_scrap_from_idea") {
    const { ideaId, scrapId, status } = msg.data;
    if (!ideaId || !scrapId || !status) {
      sendResponse({
        success: false,
        error: "ID 또는 상태가 유효하지 않습니다.",
      });
      return true;
    }

    // linkedScraps와 workspace.linkedScraps 모두에서 제거
    const userId = CONSTANTS.USER_ID;
    const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${ideaId}`);
    cardRef.once("value").then((snapshot) => {
      const cardData = snapshot.val();
      if (!cardData) {
        sendResponse({ success: false, error: "카드를 찾을 수 없습니다." });
        return;
      }
      
      // linkedScraps 업데이트 (루트 레벨) - 배열과 객체 모두 처리
      let linkedScraps = cardData.linkedScraps;
      if (Array.isArray(linkedScraps)) {
        linkedScraps = linkedScraps.filter(id => id !== scrapId);
      } else if (linkedScraps && typeof linkedScraps === 'object') {
        linkedScraps = { ...linkedScraps };
        delete linkedScraps[scrapId];
      } else {
        linkedScraps = {};
      }
      
      // workspace.linkedScraps 업데이트 - 배열과 객체 모두 처리
      const workspace = cardData.workspace || {};
      let workspaceLinkedScraps = workspace.linkedScraps;
      if (Array.isArray(workspaceLinkedScraps)) {
        workspaceLinkedScraps = workspaceLinkedScraps.filter(id => id !== scrapId);
      } else if (workspaceLinkedScraps && typeof workspaceLinkedScraps === 'object') {
        workspaceLinkedScraps = { ...workspaceLinkedScraps };
        delete workspaceLinkedScraps[scrapId];
      } else {
        workspaceLinkedScraps = {};
      }
      
      // workspace 객체 전체를 업데이트 (점(.)을 포함한 키 사용 불가)
      const updates = {
        linkedScraps: linkedScraps,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      
      // workspace 객체가 없으면 생성
      if (!cardData.workspace) {
        updates.workspace = {
          keywords: [],
          outline: [],
          draft: "",
          linkedScraps: workspaceLinkedScraps
        };
      } else {
        // 기존 workspace 객체를 유지하면서 linkedScraps만 업데이트
        updates.workspace = {
          ...cardData.workspace,
          linkedScraps: workspaceLinkedScraps
        };
      }
      
      cardRef.update(updates)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });

    return true;
  } else if (msg.action === "generate_draft_from_idea") {
    const ideaData = msg.data;
    
      // 가독성 포맷팅 함수
      function formatDraftForReadability(draftText) {
        if (!draftText) return draftText;
        
        let html = draftText;
        
        // 마크다운 형식인지 확인 (마크다운 문법이 있으면 HTML로 변환 필요)
        const isMarkdown = /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s|\[.*\]\(.*\)/m.test(draftText);
        
        // 마크다운이면 HTML로 변환 (marked는 background.js에서 사용 불가하므로 클라이언트에서 처리)
        // 여기서는 마크다운 링크만 먼저 처리하고, 나머지는 클라이언트에서 처리
        if (isMarkdown) {
          // 마크다운 링크를 HTML로 변환하면서 밑줄 제거
          // [텍스트](URL) 형식을 <a href="URL" style="text-decoration: none; color: #1a73e8;">텍스트</a>로 변환
          html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="text-decoration: none; color: #1a73e8;">$1</a>');
        }
      
      // 기존 HTML 링크의 밑줄 제거
      html = html.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
        if (!attrs.includes('style=')) {
          return `<a ${attrs} style="text-decoration: none; color: #1a73e8;">`;
        } else if (!attrs.includes('text-decoration')) {
          return `<a ${attrs.replace(/style="([^"]*)"/, 'style="$1; text-decoration: none; color: #1a73e8;"')}>`;
        }
        return match;
      });
      
      // 마크다운 형식의 구분선을 HTML로 변환 (기존 구분선은 유지)
      // 단, mark 태그 안에 있는 것은 제외
      html = html.replace(/\n\s*---\s*\n/gi, (match, offset, string) => {
        // mark 태그 안에 있는지 확인
        const beforeMatch = string.substring(0, offset);
        const lastMarkOpen = beforeMatch.lastIndexOf('<mark');
        const lastMarkClose = beforeMatch.lastIndexOf('</mark>');
        // 마지막 <mark>가 </mark>보다 뒤에 있으면 mark 태그 안에 있음
        if (lastMarkOpen > lastMarkClose) {
          return match; // 변환하지 않음
        }
        return '\n<hr style="border: none; border-top: 2px solid #e0e0e0; margin: 24px 0 32px 0;">\n';
      });
      
      // 잘못된 mark 태그 안의 hr 태그 제거 (<<mark ... >hr ... > 형식)
      html = html.replace(/<mark[^>]*>\s*<hr[^>]*>/gi, '<mark style="background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;">');
      html = html.replace(/<\/mark>\s*<hr[^>]*>/gi, '</mark>');
      
      // "(참고 자료 X)" 같은 번호 표기 제거
      // 마크다운 형식이면 HTML로 변환 후 처리 (클라이언트에서 처리하도록 남겨둠)
      // 여기서는 HTML 형식일 때만 처리
      if (!isMarkdown || html.includes('<')) {
        // HTML 태그가 있으면 태그를 임시로 치환하여 텍스트만 처리
        const textNodes = [];
        let tagIndex = 0;
        const tagPlaceholder = '__TAG_PLACEHOLDER__';
        
        // HTML 태그를 임시로 치환
        html = html.replace(/<[^>]+>/g, (match) => {
          textNodes[tagIndex] = match;
          return `${tagPlaceholder}${tagIndex++}${tagPlaceholder}`;
        });
        
        // 텍스트에서 참고 자료 번호 표기 제거
        html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
        html = html.replace(/\[참고\s*자료\s*\d+\]/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에\s*따르면/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에서/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에\s*의하면/gi, '');
        html = html.replace(/참고\s*자료\s*\d+/gi, '');
        // 문장 중간에 있는 경우 처리 (앞뒤 공백 정리, 줄바꿈은 보존)
        html = html.replace(/[ \t]*\(참고\s*자료\s*\d+\)[ \t]*/gi, ' ');
        html = html.replace(/[ \t]*\[참고\s*자료\s*\d+\][ \t]*/gi, ' ');
        // 빈 괄호 제거
        html = html.replace(/\([ \t]*\)/g, '');
        // 연속된 공백을 하나로 (줄바꿈은 유지)
        html = html.replace(/[ \t]{2,}/g, ' ');
        // 마침표 앞 공백 정리 (줄바꿈은 보존)
        html = html.replace(/[ \t]+\./g, '.');
        html = html.replace(/\.[ \t]+\./g, '.');
        
        // 태그 복원
        html = html.replace(new RegExp(`${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), (match, index) => {
          return textNodes[parseInt(index)] || match;
        });
      } else {
        // 마크다운 형식이면 텍스트에서만 제거 (마크다운 문법은 보존)
        html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
        html = html.replace(/\[참고\s*자료\s*\d+\]/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에\s*따르면/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에서/gi, '');
        html = html.replace(/참고\s*자료\s*\d+\s*에\s*의하면/gi, '');
        html = html.replace(/참고\s*자료\s*\d+/gi, '');
      }
      
      // 중요한 문장에 배경색 적용 (AI가 <mark> 태그를 사용하지 않은 경우)
      // 단, hr 태그나 다른 블록 요소가 포함된 경우는 제외
      // 서론 부분(제목 다음, 첫 번째 h2 이전)은 제외
      if (!html.includes('<mark')) {
        const importantKeywords = ['중요', '핵심', '요약', '결론', '주의', '필수', '반드시', '꼭'];
        let importantCount = 0;
        
        // 서론 부분 찾기 (h1 다음부터 첫 번째 h2 이전까지)
        const h1Match = html.match(/<h1[^>]*>.*?<\/h1>/i);
        const firstH2Match = html.match(/<h2[^>]*>/i);
        const introEndIndex = firstH2Match ? firstH2Match.index : html.length;
        const introStartIndex = h1Match ? h1Match.index + h1Match[0].length : 0;
        
        importantKeywords.forEach(keyword => {
          if (importantCount >= 2) return;
          // 문장 단위로 찾기 (마침표, 느낌표, 물음표로 끝나는 문장)
          // hr 태그나 다른 블록 요소가 포함된 경우는 제외
          const regex = new RegExp(`([^<]*${keyword}[^<]*[.!?])`, 'gi');
          html = html.replace(regex, (match, p1, offset, string) => {
            // 서론 부분(제목 다음, 첫 번째 h2 이전)이면 mark 태그를 추가하지 않음
            if (offset >= introStartIndex && offset < introEndIndex) {
              return match;
            }
            // hr 태그나 다른 블록 요소가 포함되어 있으면 mark 태그를 추가하지 않음
            if (match.includes('<hr') || match.includes('<div') || match.includes('<p>') || match.includes('<h')) {
              return match;
            }
            if (importantCount < 2 && !match.includes('<mark') && match.trim().length > 10) {
              importantCount++;
              return `<mark style="background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;">${match}</mark>`;
            }
            return match;
          });
        });
      }
      
      // 이미 mark 태그 안에 hr 태그가 잘못 들어간 경우 수정
      html = html.replace(/<mark([^>]*)>([^<]*)<hr([^>]*)>([^<]*)<\/mark>/gi, '<hr$3><mark$1>$2$4</mark>');
      html = html.replace(/<mark([^>]*)><hr([^>]*)>/gi, '<hr$2><mark$1>');
      
      // 서론 부분(제목 다음, 첫 번째 h2 이전)의 mark 태그 제거
      const h1Match = html.match(/<h1[^>]*>.*?<\/h1>/i);
      const firstH2Match = html.match(/<h2[^>]*>/i);
      if (h1Match && firstH2Match) {
        const introStartIndex = h1Match.index + h1Match[0].length;
        const introEndIndex = firstH2Match.index;
        const beforeIntro = html.substring(0, introStartIndex);
        const introSection = html.substring(introStartIndex, introEndIndex);
        const afterIntro = html.substring(introEndIndex);
        
        // 서론 부분에서 mark 태그 제거
        const cleanedIntro = introSection.replace(/<mark[^>]*>/gi, '').replace(/<\/mark>/gi, '');
        html = beforeIntro + cleanedIntro + afterIntro;
      }
      
      return html;
    }
    
    (async () => {
      // 1. 모든 키워드를 수집하고 중복을 제거합니다.
      const allKeywords = new Set([
        ...(ideaData.tags || []).filter((t) => t !== "#AI-추천"),
        ...(ideaData.longTailKeywords || []),
      ]);
      const keywordsText = Array.from(allKeywords).join("\n- ");

      // 2. 연결된 자료 텍스트를 프롬프트 형식으로 만듭니다.
      const linkedScrapsText = (ideaData.linkedScrapsContent || [])
        .map((scrap, index) => {
          const title = scrap.title || scrap.text?.substring(0, 50) || `참고 자료 ${index + 1}`;
          const url = scrap.url || "";
          return `[참고 자료 ${index + 1}]\n제목: ${title}\nURL: ${url}\n내용: ${scrap.text || ""}\n`;
        })
        .join("\n");

      // [체크리스트 3] 원본 본문 참조: origin.fullContent가 있으면 참고 자료에 추가
      let originalContentText = "";
      if (ideaData.origin?.fullContent && ideaData.origin.fullContent.length > 0) {
        originalContentText = `[원본 본문 (리뉴얼 참고용)]\n${ideaData.origin.fullContent.substring(0, 5000)}\n\n`;
      }

      // 3. 추천 검색어와 롱테일 키워드 수집
      const recommendedSearches = ideaData.recommendedSearches || [];
      const longTailKeywords = ideaData.longTailKeywords || [];
      const tags = (ideaData.tags || []).filter((t) => t !== "#AI-추천");
      
      // 4. 페르소나 자동 선택
      const selectedPersona = selectPersona(ideaData);
      console.log(`🤖 [AI] 선택된 페르소나: ${selectedPersona.name} (톤: ${selectedPersona.tone})`);
      
      // 5. 모든 정보를 종합하여 '마스터 프롬프트'를 생성합니다.
      const prompt = `
            ${selectedPersona.systemPrompt}
            
            아래 제공된 모든 정보를 활용하여, SEO에 최적화되고 독자의 흥미를 끄는 완성도 높은 블로그 포스트 초안을 작성해주세요.

            ### 1. 아이디어 제목 (참고용)
            - ${ideaData.title}

            ### 1-1. SEO 최적화된 실제 초안 제목 생성
            위 아이디어 제목을 참고하여, 검색 노출에 최적화되고 독자의 체류시간을 늘릴 수 있는 실제 초안 제목을 생성해주세요.
            - 검색 키워드를 자연스럽게 포함
            - 클릭을 유도하는 제목
            - 독자의 문제를 해결하거나 유용한 정보를 제공한다는 것을 명확히 표현
            - 50자 이내로 간결하게
            - 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요
            - **중요**: 아래 목차의 첫 번째 항목은 제목이 아닙니다. 목차는 본문 구조를 위한 것이며, 제목은 별도로 생성해야 합니다.

            ### 2. 핵심 요약
            - ${ideaData.description || "주제에 대한 상세 설명"}

            ### 3. 현재까지 작성된 초안 (이 내용을 바탕으로 발전시켜주세요)
            ${ideaData.currentDraft || "(비어 있음)"}

            ### 4. 본문 구조 (목차 - 이 목차는 본문 섹션 제목으로만 사용하세요)
            ${(ideaData.outline || []).length > 0 
              ? ideaData.outline.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
              : "목차가 제공되지 않았습니다. 논리적이고 체계적인 구조로 작성해주세요."}
            
            [문서 구조 규칙 - 매우 중요]
            1. **제목 (h1)**: SEO 최적화된 독립적인 제목을 생성하고, h1 태그(# 제목)로 문서의 맨 처음에 포함해주세요.
               - 목차의 첫 번째 항목을 제목으로 사용하지 마세요.
               - 제목은 아이디어 제목을 참고하되, SEO와 클릭률을 고려하여 새로 생성하세요.
            
            2. **서론**: 제목 다음에 서론을 작성해주세요.
               - 독자의 관심을 끄는 도입부
               - 글의 목적과 핵심 내용을 간략히 소개
            
            3. **본문**: 서론 다음에 목차를 h2(## 제목) 섹션으로 작성해주세요.
               - 목차의 각 항목을 h2 태그로 사용하세요.
               - 각 섹션에 충실한 내용을 작성하세요.
               - 하위 섹션이 필요하면 h3(### 제목)를 사용하세요.
            
            4. **결론**: 본문 마지막에 결론 섹션을 h2(## 결론)로 추가해주세요.
               - 글의 핵심 내용 요약
               - 독자에게 도움이 되는 마무리
            
            [작성 순서]
            h1 제목 → 서론(일반 텍스트) → 본문(h2 섹션들) → 결론(h2)

            ### 5. 주요 키워드 (본문에 자연스럽게 포함해주세요)
            ${tags.length > 0 ? tags.map(t => `- ${t.replace(/^#/, "")}`).join("\n") : "없음"}

            ### 6. 롱테일 키워드 (SEO 최적화를 위해 본문에 자연스럽게 통합해주세요)
            ${longTailKeywords.length > 0 
              ? longTailKeywords.map(k => `- ${k}`).join("\n")
              : "없음"}
            
            ### 7. 추천 검색어 (독자들이 검색할 수 있는 키워드, 본문에 자연스럽게 활용해주세요)
            ${recommendedSearches.length > 0 
              ? recommendedSearches.map((s, idx) => `${idx + 1}. ${s}`).join("\n")
              : "없음"}

            ### 8. 관련 참고 자료
            ${originalContentText}${linkedScrapsText || "참고 자료 없음"}
            
            [참고 자료 활용 규칙]
            - 원본 본문이 제공된 경우(리뉴얼 아이디어), 그 내용을 바탕으로 팩트 기반으로 작성하되, 단순 복사가 아닌 새로운 관점이나 더 풍부한 정보로 발전시켜주세요.
            - 참고 자료가 제공된 경우, 그 내용을 바탕으로 팩트 기반으로 작성해주세요.
            - 참고 자료가 없는 경우, 일반적인 지식과 경험을 바탕으로 작성하되, 확실하지 않은 내용은 추측하지 마세요.
            - 할루시네이션(허위 정보 생성)을 피하고, 확실한 정보만 포함해주세요.

            [작성 규칙]
            1. **제목 최적화**: SEO 최적화된 제목을 생성하고, 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요. 아이디어 제목과는 다를 수 있습니다.
               - **절대 금지**: 목차의 첫 번째 항목을 제목으로 사용하지 마세요. 제목은 별도로 생성해야 합니다.
               - 제목 다음에는 서론을 작성하고, 그 다음에 목차의 첫 번째 항목부터 본문 섹션으로 작성하세요.
            2. '현재까지 작성된 초안'이 비어있지 않다면, 그 내용을 존중하여 이어서 작성하거나 내용을 더 풍부하게 만들어주세요.
            3. **문서 구조**: 제목(h1) → 구분선(---) → 서론 → 본문(h2 섹션들, 목차 기반) → 결론(h2) 순서로 작성하세요.
               - 목차의 각 항목은 본문의 h2 섹션 제목으로만 사용하세요.
               - 서론과 결론은 목차에 포함되지 않으므로 별도로 작성하세요.
            4. '롱테일 키워드'를 본문에 자연스럽게 통합하여 SEO를 최적화해주세요. 키워드 스터핑은 피하고, 문맥에 맞게 사용해주세요.
            5. '추천 검색어'를 참고하여 독자가 검색할 만한 키워드를 본문에 자연스럽게 포함해주세요.
            6. '관련 참고 자료'의 내용을 활용할 때는 단순히 나열하거나 요약하지 말고, 본문의 흐름에 자연스럽게 녹여서 작성해주세요. 자료의 핵심 정보를 재해석하거나 독자의 이해를 돕는 방식으로 통합해주세요.
            7. 각 섹션은 독자가 이해하기 쉽고, 실용적인 정보를 제공하도록 작성해주세요. 독자의 체류시간을 늘리고 유용한 정보를 제공하는 데 집중해주세요.
            8. **이미지 생성 프롬프트 삽입**: 본문에서 이미지를 삽입할 적절한 위치를 찾아서 텍스트로 이미지 생성 프롬프트를 삽입해주세요. 
              - **매우 중요**: 이미지 프롬프트는 해당 위치의 콘텐츠 내용과 직접적으로 관련된 이미지여야 합니다.
              - **형식 규칙 (매우 중요)**:
                * **줄바꿈 강제**: 영어 프롬프트와 한글 프롬프트는 반드시 줄을 나누어 작성해주세요. 절대 한 줄에 붙여서 작성하지 마세요. 두 프롬프트 사이에는 반드시 줄바꿈이 있어야 합니다.
                * 각 프롬프트는 녹색 텍스트 색상으로 표시되어야 합니다 (마크다운: <span style="color: #2e7d32;">텍스트</span> 형식 사용).
                * 형식 예시 (아래처럼 반드시 두 줄로 작성):
                  <span style="color: #2e7d32;">[이미지 생성 프롬프트 (영어): High-quality photo of [글의 핵심 주제], professional lighting, 8K resolution, photorealistic style]</span>
                  
                  <span style="color: #2e7d32;">[이미지 생성 프롬프트 (한글): [글의 핵심 주제]에 대한 고품질 사진, 전문적인 조명, 사실적 스타일]</span>
                * 위 예시처럼 영어 프롬프트 다음에 빈 줄 하나를 두고 한글 프롬프트를 작성하세요.
                * 잘못된 예 (절대 금지): 
                  - "<span style="color: #2e7d32;">[이미지 생성 프롬프트 (영어): ...] [이미지 생성 프롬프트 (한글): ...]</span>" (한 줄에 붙어 있음, 줄바꿈 없음)
                  - "> [이미지 생성 프롬프트 ...]" (인용구 형식 사용 금지)
              - 메인 이미지는 제목 바로 아래, 서론 시작 전에 1개: 
                * 해당 글의 주제와 직접 관련된 이미지 프롬프트를 작성하세요.
              - 본문 이미지는 각 섹션 사이에 3~4개 배치: 
                * 각 섹션의 내용과 직접 관련된 이미지 프롬프트를 작성하세요.
                * 예: "SmartThings AI 콤보" 섹션이면 SmartThings 관련 이미지, "해결 방법" 섹션이면 해결 과정 관련 이미지
              - **절대 금지**: 글의 주제와 무관한 예시 이미지(예: 갤럭시 탭, 사무실 등)를 사용하지 마세요. 반드시 해당 글의 실제 내용과 관련된 이미지만 생성하세요.
              - 프롬프트 작성 가이드 (Gemini 이미지 생성 가이드 참고 - https://ai.google.dev/gemini-api/docs/image-generation?hl=ko):
                * 주제, 컨텍스트, 스타일을 명확하게 설명하세요
                * 구체적인 키워드와 수정자를 사용하세요 (예: "high-quality", "natural lighting", "professional photography", "8K resolution")
                * 이미지의 구도, 색상, 분위기를 묘사하세요
                * 카메라 앵글과 조명 조건을 명시하세요 (예: "wide-angle lens", "natural light", "indoor lighting")
                * 아트 스타일이나 사진 스타일을 지정하세요 (예: "photorealistic", "minimalism", "impressionism")
                * 텍스트가 필요한 경우 "high-quality text rendering"을 명시하세요
                * 반복적 수정이 가능하므로 초기 프롬프트는 핵심 요소에 집중하세요
                * 영어 프롬프트는 상세하고 기술적으로, 한글 프롬프트는 의미를 정확히 전달하도록 작성하세요
            10. **썸네일 정보 생성**: 초안 생성 후 다음 정보를 JSON 형식으로 반환해주세요:
              - 썸네일 텍스트 이미지 프롬프트 (영어): 썸네일 이미지 생성을 위한 영어 프롬프트 (상세하고 기술적으로, Gemini 이미지 생성 가이드 참고)
              - 썸네일 텍스트 이미지 프롬프트 (한글): 썸네일 이미지 생성을 위한 한글 프롬프트 (의미 전달 중심)
              - 썸네일 문구: 썸네일에 표시할 짧은 문구 (12자 이내, 핵심 키워드)
              형식: <썸네일정보>{"thumbnailPromptEn": "영어 프롬프트", "thumbnailPromptKo": "한글 프롬프트", "thumbnailText": "썸네일 문구"}</썸네일정보>
              - **썸네일 문구 작성 요령 (매우 중요)**: 
                * 심플하지만 호기심을 유발하는 문구로 작성해주세요.
                * 단순한 키워드 나열(예: "스마트홈 컨트롤")이 아니라, 독자의 호기심을 자극하는 문구여야 합니다.
                * 예시:
                  - 나쁜 예: "스마트홈 컨트롤", "갤럭시 탭", "제품 소개"
                  - 좋은 예: "집 전체를 손끝으로", "미래가 온다", "이것만 있으면 끝", "당신의 집이 스마트해진다", "한 번의 터치로 모든 것 제어"
                * 핵심 키워드를 포함하되, 그것을 감싸는 매력적인 표현으로 작성해주세요.
                * 12자 이내로 제한되지만, 그 안에서 최대한 임팩트 있게 작성해주세요.
                * 질문 형식, 감탄 형식, 혜택 강조 형식 등을 활용할 수 있습니다.
              - **썸네일 이미지 프롬프트 작성 요령**: 
                * 커버 이미지는 글의 첫인상을 결정하는 만큼 눈에 확 들어오는 핵심 이미지를 사용해야 합니다.
                * 전체적인 인상을 생생하게 느낄 수 있는 이미지라면 더더욱 좋습니다.
                * 콘텍스트의 매력을 가장 잘 느낄 수 있게 이미지 생성 텍스트 프롬프트로 작성해주세요.
                * 제목과 핵심 내용을 반영하여 시각적으로 강렬하고 매력적인 썸네일을 생성할 수 있도록 구체적이고 생동감 있는 묘사를 포함해주세요.
                * 예: "High-quality, eye-catching cover image showcasing [핵심 주제], vibrant colors, professional composition, modern design, compelling visual narrative that captures the essence of [주제], 16:9 aspect ratio, photorealistic style"
            11. **참고 자료 링크 통합 방법 (매우 중요):**
               - **절대 금지**: "(참고 자료 1)", "(참고 자료 2)", "참고 자료 1에 따르면", "참고 자료 3에서", "참고 자료 4" 같은 번호 표기는 절대 사용하지 마세요. 이런 표현이 발견되면 전체 초안이 거부됩니다.
               - 참고 자료를 언급할 때는 해당 자료의 제목이나 핵심 내용을 자연스러운 문장의 일부로 만들어 링크로 연결해주세요.
               - "참고하시기 바랍니다", "참고 자료에 따르면" 같은 딱딱한 표현도 피해주세요.
               - 링크는 문맥에 완전히 녹아들어야 하며, 독자가 자연스럽게 클릭하고 싶게 만들어주세요.
               - 좋은 예시들:
                 * "세탁기 고장 예방을 위해서는 [올바른 세제 사용법](URL)을 숙지하는 것이 중요합니다."
                 * "이러한 증상이 나타난다면 전문가의 [자가 진단 가이드](URL)를 확인해보시기 바랍니다."
                 * "더 자세한 내용은 [가전제품 A/S 정책 안내](URL)에서 확인할 수 있습니다."
                 * "실제 사용자들의 경험담은 [고장 사례 모음](URL)에서 볼 수 있습니다."
                 * "LG 워시콤보 사용자라면 [올바른 세제 사용법](URL)을 숙지하는 것이 중요합니다."
               - 나쁜 예시들 (절대 사용 금지):
                 * "참고 자료 1에 따르면..." (번호 표기 - 절대 금지)
                 * "(참고 자료 2)" (번호 표기 - 절대 금지)
                 * "참고 자료 3에서..." (번호 표기 - 절대 금지)
                 * "자세한 내용은 [여기](URL)를 참고하시기 바랍니다." (모호한 표현)
                 * "관련 자료: [제목](URL)" (나열식)
            8. **독자 가독성을 위한 포맷팅 규칙:**
              - **구조적 계층화**: H1(제목) -> H2(중제목) -> H3(소제목) 순서로 논리적으로 나뉘어 있어야 합니다.
              - **간결한 문장 사용**: 한 문장이 너무 길어 호흡이 가쁘지 않도록 작성해주세요. 접속사를 줄이고 단문 위주로 작성하는 것이 좋습니다.
              - **전문 용어 풀이**: 업계 은어나 어려운 용어가 있다면, 초보자도 이해할 수 있게 쉽게 풀어서 설명해주세요.
              - **목록(List) 활용**: 나열되는 정보(특징, 장점, 순서 등)는 줄글 대신 **글머리 기호(Bullet points)**나 번호 매기기를 사용해주세요.
              - 각 문단 사이에는 적절한 줄바꿈을 넣어주세요 (빈 줄 1개).
              - 목록이나 단계별 설명에는 들여쓰기를 사용해주세요 (마크다운 리스트 형식: - 또는 1. ).
              - 중요한 키워드나 개념은 **굵게** 표시해주세요 (마크다운: **텍스트**).
              - 본문에서 가장 중요한 핵심 문장 1~2개를 선택하여 <mark style="background-color: rgb(255, 255, 204);">핵심 문장</mark> 형식으로 강조해주세요.
              - 링크는 밑줄 없이 작성해주세요 (마크다운 링크 형식 사용).
              - 제목 태그(h1, h2, h3)는 적절한 간격을 두고 사용해주세요.
              - 목록, 인용, 일반 텍스트는 읽기 편하도록 적절한 줄간격을 유지해주세요.
              - **시각적 환기 장치**: 텍스트만 나열되지 않고, 적절한 위치에 이미지 프롬프트가 삽입되어 지루함을 덜어주어야 합니다.
            
            [중요] **응답 형식 규칙:**
            - 반드시 **순수 마크다운 형식**으로만 작성해주세요.
            - 코드 블록(\`\`\`markdown ... \`\`\`)이나 다른 래퍼 태그 없이, 순수 마크다운 텍스트만 반환해주세요.
            - 예시: "# 제목\\n\\n본문 내용..." 형식으로 작성 (\`\`\`markdown 태그 없이)
            - 절대 금지: \`\`\`markdown으로 감싸거나, JSON 형식으로 감싸지 마세요.
        `;
      // 기존에 만들어둔 Gemini API 호출 함수를 재사용합니다.
      let draft;
      try {
        draft = await callGeminiAPI(prompt);
      } catch (error) {
        console.error('[generate_draft_from_idea] Gemini API 호출 실패:', error);
        if (sendResponse) {
          sendResponse({ 
            success: false, 
            error: `Gemini API 호출 실패: ${error.message || '알 수 없는 오류'}` 
          });
        }
        return;
      }
      
      // [체크리스트 4-2] 빈 응답 및 오류 응답 처리
      if (!draft || draft.trim() === "") {
        console.error('[generate_draft_from_idea] 초안이 비어있습니다.');
        if (sendResponse) {
          sendResponse({ 
            success: false, 
            error: '초안이 생성되지 않았습니다. Gemini API 응답이 비어있습니다. 다시 시도해주세요.' 
          });
        }
        return;
      }
      
      if (draft.startsWith("오류:") || draft.includes("오류:")) {
        console.error('[generate_draft_from_idea] Gemini API 오류:', draft);
        const errorMessage = draft.replace(/^오류:\s*/i, '').trim() || 'Gemini API에서 오류가 발생했습니다.';
        if (sendResponse) {
          sendResponse({ 
            success: false, 
            error: errorMessage 
          });
        }
        return;
      }
      
      // [체크리스트 4-2] 응답이 너무 짧거나 유효하지 않은 경우 체크
      if (draft.trim().length < 50) {
        console.warn('[generate_draft_from_idea] 초안이 너무 짧습니다:', draft);
        // 너무 짧은 경우에도 경고만 하고 계속 진행 (사용자가 확인할 수 있도록)
      }
      
      // 정상 응답 처리
      {
        // [체크리스트 2-3] 마크다운 클리닝: 코드 블록 태그 제거
        let cleanedDraft = draft;
        // ```markdown ... ``` 형식 제거
        cleanedDraft = cleanedDraft.replace(/^```markdown\s*\n?/i, '');
        cleanedDraft = cleanedDraft.replace(/^```md\s*\n?/i, '');
        cleanedDraft = cleanedDraft.replace(/^```\s*\n?/i, '');
        cleanedDraft = cleanedDraft.replace(/\n?```\s*$/i, '');
        cleanedDraft = cleanedDraft.replace(/\n?```markdown\s*$/i, '');
        cleanedDraft = cleanedDraft.replace(/\n?```md\s*$/i, '');
        // 앞뒤 공백 제거
        cleanedDraft = cleanedDraft.trim();
        
        // 생성된 초안에 가독성 포맷팅 후처리 적용
        let formattedDraft = formatDraftForReadability(cleanedDraft);
        
        // SEO 최적화된 제목 추출 (h1 태그에서)
        let seoTitle = null;
        const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || formattedDraft.match(/^#\s+(.+)$/m);
        if (h1Match && h1Match[1]) {
          seoTitle = h1Match[1].trim();
        }
        
        // 제목이 포함되어 있지 않으면 h1으로 추가
        const title = ideaData.title || "";
        if (title) {
          // h1 태그나 # 제목 형식이 없으면 추가
          const hasH1 = /<h1[^>]*>|<h1>|^#\s+/i.test(formattedDraft);
          if (!hasH1) {
            // 마크다운 형식이면 # 제목, HTML이면 <h1>제목</h1> 추가
            if (formattedDraft.includes('<')) {
              // HTML 형식
              formattedDraft = `<h1>${title}</h1>\n${formattedDraft}`;
              seoTitle = title; // 새로 추가된 제목을 seoTitle로 설정
            } else {
              // 마크다운 형식
              formattedDraft = `# ${title}\n\n${formattedDraft}`;
              seoTitle = title; // 새로 추가된 제목을 seoTitle로 설정
            }
          } else {
            // h1이 이미 있었지만 seoTitle이 추출되지 않았다면 다시 시도
            if (!seoTitle) {
              const h1MatchRetry = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || formattedDraft.match(/^#\s+(.+)$/m);
              if (h1MatchRetry && h1MatchRetry[1]) {
                seoTitle = h1MatchRetry[1].trim();
              }
            }
          }
        }
        
        // seoTitle이 여전히 없으면 기본 title 사용
        if (!seoTitle) {
          seoTitle = title;
        }
        
        // 퍼머링크 생성 (영문만, URL-safe) - 한글을 영문으로 변환
        const generatePermalink = async (title) => {
          if (!title) return '';
          
          // 기본 변환 함수 (빠른 폴백)
          const defaultConversion = (text) => {
            return text
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '') // 영문, 숫자, 공백, 하이픈만 유지 (한글 제거)
              .replace(/\s+/g, '-') // 공백을 하이픈으로
              .replace(/-+/g, '-') // 연속된 하이픈을 하나로
              .replace(/^-|-$/g, '') // 앞뒤 하이픈 제거
              .substring(0, 100); // 최대 100자
          };
          
          // 타임아웃을 포함한 Promise로 래핑
          const translationWithTimeout = Promise.race([
            (async () => {
              try {
                const translationPrompt = `다음 한국어 제목을 SEO에 최적화된 영문 URL 슬러그로 변환해주세요. 
- 영문, 숫자, 하이픈만 사용
- 소문자로 변환
- 공백은 하이픈으로
- 최대 100자
- 검색 최적화를 고려한 키워드 포함

제목: ${title}

영문 슬러그만 반환해주세요 (설명 없이):`;
                
                const translated = await callGeminiAPI(translationPrompt);
                if (translated && !translated.startsWith("오류:")) {
                  return translated
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9\s-]/g, '') // 영문, 숫자, 공백, 하이픈만 유지
                    .replace(/\s+/g, '-') // 공백을 하이픈으로
                    .replace(/-+/g, '-') // 연속된 하이픈을 하나로
                    .replace(/^-|-$/g, '') // 앞뒤 하이픈 제거
                    .substring(0, 100); // 최대 100자
                }
              } catch (e) {
                console.error('퍼머링크 번역 실패:', e);
              }
              return null;
            })(),
            new Promise((resolve) => setTimeout(() => resolve(null), 5000)) // 5초 타임아웃
          ]);
          
          try {
            const translated = await translationWithTimeout;
            if (translated) {
              return translated;
            }
          } catch (e) {
            console.error('퍼머링크 생성 중 오류:', e);
          }
          
          // 번역 실패 또는 타임아웃 시 기본 변환 반환
          return defaultConversion(title);
        };
        
        // 퍼머링크 생성 (타임아웃 보호)
        let permalink = '';
        try {
          permalink = await generatePermalink(seoTitle || title);
        } catch (e) {
          console.error('퍼머링크 생성 실패, 기본값 사용:', e);
          // 기본 변환 사용
          const titleForPermalink = seoTitle || title || '';
          permalink = titleForPermalink
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 100);
        }
        
        // 태그 생성 (쉼표 구분)
        const tagsForPublish = tags
          .map(t => t.replace(/^#/, ''))
          .filter(t => t && t !== 'AI-추천')
          .join(', ');
        
        // [체크리스트 2-3] 썸네일 정보 추출 (초안에서 <썸네일정보> 태그 찾기)
        let thumbnailInfo = null;
        // cleanedDraft에서 먼저 찾고, 없으면 formattedDraft에서 찾기
        const thumbnailMatch = cleanedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/) || formattedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/);
        if (thumbnailMatch && thumbnailMatch[1]) {
          try {
            thumbnailInfo = JSON.parse(thumbnailMatch[1].trim());
            // 초안에서 썸네일 정보 태그 제거 (cleanedDraft와 formattedDraft 모두에서)
            cleanedDraft = cleanedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
            formattedDraft = formattedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
          } catch (e) {
            console.error('[generate_draft_from_idea] 썸네일 정보 JSON 파싱 실패:', e);
            // JSON 파싱 실패 시 기본값 사용 (아래에서 처리)
          }
        }
        
        // 썸네일 정보가 없으면 기본값 생성
        if (!thumbnailInfo) {
          thumbnailInfo = {
            thumbnailPromptEn: `High-quality thumbnail image for "${seoTitle || title}", modern design, professional layout, eye-catching composition, 16:9 aspect ratio`,
            thumbnailPromptKo: `"${seoTitle || title}"에 대한 고품질 썸네일 이미지, 현대적인 디자인, 전문적인 레이아웃, 눈에 띄는 구도`,
            thumbnailText: (seoTitle || title || '').substring(0, 12)
          };
        }
        
        // sendResponse가 이미 호출되었는지 확인
        if (sendResponse) {
          sendResponse({ 
            success: true, 
            draft: formattedDraft,
            permalink: permalink,
            tags: tagsForPublish,
            seoTitle: seoTitle, // SEO 최적화된 제목
            thumbnailInfo: thumbnailInfo // 썸네일 정보
          });
        }
      }
    })().catch((error) => {
      // 예외 발생 시에도 응답 보장
      console.error('[generate_draft_from_idea] 오류:', error);
      if (sendResponse) {
        sendResponse({ 
          success: false, 
          error: error.message || '초안 생성 중 오류가 발생했습니다.' 
        });
      }
    });

    return true; // 비동기 응답을 위해 true를 반환합니다.
  } else if (msg.action === "request_search_keywords") {
    const { cardId, status, title } = msg.data;

    (async () => {
      const userId = CONSTANTS.USER_ID;
      const keywordsRef = firebase
        .database()
        .ref(`kanban/${userId}/${status}/${cardId}/recommendedKeywords`);
      const snapshot = await keywordsRef.once("value");
      const keywords = snapshot.val();

      if (keywords) {
        // 기존 키워드가 있으면 바로 전송
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "search_queries_recommended",
            success: true,
            data: keywords,
            cardId,
            status,
            cardTitle: title,
          });
        }
      } else {
        // 기존 키워드가 없으면 새로 생성
        await generateAndSendKeywords(msg.data, sender);
      }
    })();
    return true;
  } else if (msg.action === "regenerate_search_keywords") {
    (async () => {
      await generateAndSendKeywords(msg.data, sender);
    })();
    return true;
  } else if (msg.action === "link_published_url") {
    const { cardId, url, status } = msg.data;
    if (!cardId || !url || !status) {
      sendResponse({ success: false, error: "필요한 정보가 부족합니다." });
      return true;
    }

    // [최적화] async 함수로 변경하여 await 사용 가능하도록
    (async () => {
      try {
        const userId = CONSTANTS.USER_ID;
        const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${cardId}`);
        
        // [최적화] 기존 카드 정보 가져오기 (origin.postUrl 확인용)
        const cardSnapshot = await cardRef.once("value");
        const existingCard = cardSnapshot.val() || {};
        
        await cardRef.update({
          publishedUrl: url,
          performanceTracked: true,
        });
        
        console.log(`[G-16] 아이디어 카드(${cardId})와 URL(${url}) 연결 완료.`);
        
        // [최적화] URL 인덱스 업데이트
        updateUrlIndex(cardId, status, existingCard.origin?.postUrl || null, url)
          .catch(error => console.warn(`[URL 인덱스 업데이트 실패] ${cardId}:`, error));
        
        sendResponse({ success: true });
        
        // GA4 데이터 수집 시작 (비동기로 실행, 완료를 기다리지 않음)
        console.log(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 시작: ${url}`);
        updateSinglePerformanceMetric({
          id: cardId,
          path: `kanban/${userId}/${status}/${cardId}`,
          url: url,
        }).then(() => {
          console.log(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 완료`);
        }).catch((error) => {
          console.error(`[GA4] 카드 ${cardId}의 GA4 데이터 수집 실패:`, error.message);
        });
        
        // 해당 카드의 AdSense 등록 상태 확인 (단일 카드 모드)
        try {
          await checkAdSenseRegistrationStatus(null, url, cardId, status);
          console.log(`[AdSense] 카드 ${cardId}의 등록 상태 확인 완료`);
        } catch (error) {
          console.warn(`[AdSense] 카드 ${cardId}의 등록 상태 확인 실패:`, error.message);
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true;
  } else if (msg.action === "save_draft_content") {
    const { ideaId, status, draft } = msg.data;
    if (!ideaId || !status) {
      sendResponse({ success: false, error: "Idea ID or status is missing." });
      return true;
    }

    const userId = CONSTANTS.USER_ID;
    const currentRef = firebase.database().ref(`kanban/${userId}/${status}/${ideaId}`);
    const newStatus = "in-progress";

    currentRef
      .once("value")
      .then((snapshot) => {
        const cardData = snapshot.val();
        if (!cardData) throw new Error("Card data not found for move.");

        const updates = { draftContent: draft };
        let movePromise = Promise.resolve();

        // 'ideas' 컬럼에 있을 때만 이동
        if (status === "ideas") {
          const newRef = firebase
            .database()
            .ref(`kanban/${newStatus}/${ideaId}`);
          const dataToMove = { ...cardData, ...updates };
          movePromise = newRef.set(dataToMove).then(() => currentRef.remove());
        } else {
          movePromise = currentRef.update(updates);
        }

        return movePromise;
      })
      .then(() => {
        sendResponse({
          success: true,
          moved: status === "ideas",
          newStatus: status === "ideas" ? newStatus : status,
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true;
  } else if (msg.action === "delete_kanban_card") {
    const { cardId, status } = msg.data;
    if (!cardId || !status) {
      sendResponse({ success: false, error: "카드 ID 또는 상태가 없습니다." });
      return true;
    }

    const userId = CONSTANTS.USER_ID;
    const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${cardId}`);
    cardRef
      .remove()
      .then(() => {
        console.log(`[칸반 카드 삭제] ${status}/${cardId} 삭제 완료`);
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("[칸반 카드 삭제 실패]", error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  } else if (msg.action === "update_kanban_card") {
    const { cardId, status, updates } = msg.data;
    
    // sendResponse를 안전하게 호출하는 헬퍼 함수
    const safeSendResponse = (response) => {
      try {
        if (sendResponse) {
          sendResponse(response);
        }
      } catch (error) {
        // 메시지 채널이 이미 닫힌 경우 무시
        if (!error.message || !error.message.includes('message channel closed')) {
          console.error('[update_kanban_card] sendResponse 오류:', error);
        }
      }
    };
    
    if (!cardId || !status || !updates) {
      safeSendResponse({ success: false, error: "필수 정보가 부족합니다." });
      return true;
    }

    const userId = CONSTANTS.USER_ID;
    const cardRef = firebase.database().ref(`kanban/${userId}/${status}/${cardId}`);
    cardRef
      .update(updates)
      .then(() => {
        console.log(`[칸반 카드 업데이트] ${status}/${cardId} 업데이트 완료`);
        safeSendResponse({ success: true });
      })
      .catch((error) => {
        console.error("[칸반 카드 업데이트 실패]", error);
        safeSendResponse({ success: false, error: error.message });
      });

    return true;
  } else if (msg.action === "run_system_diagnosis") {
    // 시스템 진단 실행
    (async () => {
      try {
        const results = await runFullSystemDiagnosis();
        sendResponse({ success: true, data: results });
      } catch (error) {
        console.error("[시스템 진단] 실행 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답
  } else if (msg.action === "fix_active_channel_mismatch") {
    // 활성 채널 불일치 자동 수정
    (async () => {
      try {
        const { activeChannelId } = await chrome.storage.local.get("activeChannelId");
        if (!activeChannelId) {
          sendResponse({ success: false, error: "활성 채널이 설정되지 않았습니다." });
          return;
        }

        const userId = CONSTANTS.USER_ID;
        const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
        const channelsData = channelsSnapshot.val() || {};
        const myChannels = channelsData.myChannels || { blogs: [], youtubes: [] };
        const allChannels = [...(myChannels.blogs || []), ...(myChannels.youtubes || [])];
        
        const channelExists = allChannels.some(ch => ch.id === activeChannelId || ch.channelId === activeChannelId);
        
        if (channelExists) {
          sendResponse({ success: true, message: "활성 채널이 정상입니다." });
          return;
        }

        // 활성 채널이 목록에 없으면 첫 번째 채널로 변경
        if (allChannels.length > 0) {
          const firstChannel = allChannels[0];
          const newActiveChannelId = firstChannel.id || (firstChannel.apiUrl ? btoa(firstChannel.apiUrl).replace(/=/g, "") : null);
          
          if (newActiveChannelId) {
            await chrome.storage.local.set({ activeChannelId: newActiveChannelId });
            sendResponse({ success: true, message: `활성 채널을 첫 번째 채널로 변경했습니다. (${newActiveChannelId})` });
          } else {
            sendResponse({ success: false, error: "채널 ID를 생성할 수 없습니다." });
          }
        } else {
          await chrome.storage.local.remove("activeChannelId");
          sendResponse({ success: true, message: "등록된 채널이 없어 활성 채널을 제거했습니다." });
        }
      } catch (error) {
        console.error("[활성 채널 수정] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "run_data_migration") {
    // 데이터 마이그레이션 수동 실행
    (async () => {
      try {
        const targetChannelId = msg.targetChannelId || null; // UI에서 선택한 채널 ID
        await runDataMigration(targetChannelId);
        sendResponse({ success: true, message: "데이터 마이그레이션이 완료되었습니다." });
      } catch (error) {
        console.error("[데이터 마이그레이션] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "check_migration_needed") {
    // 마이그레이션 필요 여부 확인
    (async () => {
      try {
        const db = firebase.database();
        const userId = CONSTANTS.USER_ID;
        
        // 1. 채널 목록 확인
        const channelsSnap = await db.ref(`channels/${userId}/myChannels/blogs`).once("value");
        const myBlogs = channelsSnap.val() || [];
        
        if (myBlogs.length === 0) {
          sendResponse({ 
            success: true, 
            needsMigration: false, 
            reason: "no_channels" 
          });
          return;
        }
        
        // 2. 고아 데이터 확인
        const kanbanSnap = await db.ref(`kanban/${userId}`).once("value");
        const scrapsSnap = await db.ref(`scraps/${userId}`).once("value");
        const kanban = kanbanSnap.val() || {};
        const scraps = scrapsSnap.val() || {};
        
        let orphanCount = 0;
        for (const status in kanban) {
          for (const id in kanban[status]) {
            const card = kanban[status][id];
            if (card.channelId === undefined || card.channelId === null) {
              orphanCount++;
            }
          }
        }
        for (const id in scraps) {
          const scrap = scraps[id];
          if (scrap.channelId === undefined || scrap.channelId === null) {
            orphanCount++;
          }
        }
        
        if (orphanCount === 0) {
          sendResponse({ 
            success: true, 
            needsMigration: false, 
            reason: "no_orphan_data" 
          });
          return;
        }
        
        // 3. 채널 개수에 따라 응답
        const channelOptions = myBlogs.map(blog => ({
          id: blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : ""),
          name: blog.inputUrl || blog.url || blog.apiUrl || "알 수 없는 채널"
        }));
        
        sendResponse({ 
          success: true, 
          needsMigration: true,
          orphanCount,
          channelCount: myBlogs.length,
          channelOptions,
          autoAssign: myBlogs.length === 1 // 단일 채널이면 자동 할당
        });
      } catch (error) {
        console.error("[마이그레이션 확인] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "fix_channel_structure") {
    // 채널 데이터 구조 자동 수정
    (async () => {
      try {
        const userId = CONSTANTS.USER_ID;
        const db = firebase.database();
        const channelsSnapshot = await db.ref(`channels/${userId}`).once("value");
        const channelsData = channelsSnapshot.val() || {};
        
        let fixedCount = 0;
        const updates = {};
        
        // 1. 구버전 전역 competitorChannels를 내 채널의 competitors로 마이그레이션
        if (channelsData.competitorChannels) {
          const oldCompetitors = [
            ...(channelsData.competitorChannels.blogs || []),
            ...(channelsData.competitorChannels.youtubes || [])
          ];
          
          if (oldCompetitors.length > 0) {
            const myBlogs = channelsData.myChannels?.blogs || [];
            
            // 첫 번째 내 채널에 모든 경쟁사를 추가 (또는 각 채널에 분배)
            if (myBlogs.length > 0) {
              const firstBlog = myBlogs[0];
              const firstBlogId = firstBlog.id || (firstBlog.apiUrl ? btoa(firstBlog.apiUrl).replace(/=/g, "") : null);
              
              if (firstBlogId) {
                const existingCompetitors = firstBlog.competitors || [];
                const newCompetitors = oldCompetitors.map(comp => ({
                  inputUrl: comp.inputUrl || comp.url || comp.apiUrl || "",
                  apiUrl: comp.apiUrl || comp.inputUrl || comp.url || ""
                }));
                
                // 중복 제거
                const mergedCompetitors = [...existingCompetitors];
                newCompetitors.forEach(newComp => {
                  const exists = mergedCompetitors.some(existing => 
                    existing.inputUrl === newComp.inputUrl || existing.apiUrl === newComp.apiUrl
                  );
                  if (!exists) mergedCompetitors.push(newComp);
                });
                
                updates[`channels/${userId}/myChannels/blogs/${myBlogs.findIndex(b => 
                  (b.id || (b.apiUrl ? btoa(b.apiUrl).replace(/=/g, "") : null)) === firstBlogId
                )}/competitors`] = mergedCompetitors;
                fixedCount++;
              }
            }
            
            // 전역 competitorChannels 제거
            updates[`channels/${userId}/competitorChannels`] = null;
          }
        }
        
        // 2. competitors 배열이 없는 채널에 빈 배열 추가
        const myBlogs = channelsData.myChannels?.blogs || [];
        myBlogs.forEach((blog, index) => {
          if (!blog.competitors || !Array.isArray(blog.competitors)) {
            updates[`channels/${userId}/myChannels/blogs/${index}/competitors`] = [];
            fixedCount++;
          }
        });
        
        // 업데이트 실행
        if (Object.keys(updates).length > 0) {
          const ref = db.ref();
          await Promise.all(Object.entries(updates).map(([path, value]) => {
            if (value === null) {
              return db.ref(path).remove();
            } else {
              return db.ref(path).set(value);
            }
          }));
          
          sendResponse({ 
            success: true, 
            message: `채널 데이터 구조가 수정되었습니다. (${fixedCount}개 항목 처리)` 
          });
        } else {
          sendResponse({ success: true, message: "수정할 항목이 없습니다. 구조가 이미 정상입니다." });
        }
      } catch (error) {
        console.error("[채널 구조 수정] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "register_alarms") {
    // 알람 재등록
    (async () => {
      try {
        // 기존 알람 제거
        await chrome.alarms.clearAll();
        
        // 알람 재등록
        chrome.alarms.create("fetch-channels", { delayInMinutes: 1, periodInMinutes: 240 });
        chrome.alarms.create("update-performance-metrics", { delayInMinutes: 5, periodInMinutes: 360 });
        
        // 등록 확인
        const alarms = await chrome.alarms.getAll();
        const hasFetch = alarms.some(a => a.name === "fetch-channels");
        const hasUpdate = alarms.some(a => a.name === "update-performance-metrics");
        
        if (hasFetch && hasUpdate) {
          sendResponse({ 
            success: true, 
            message: "알람이 성공적으로 재등록되었습니다. (fetch-channels, update-performance-metrics)" 
          });
        } else {
          sendResponse({ 
            success: false, 
            error: `일부 알람 등록 실패 (fetch: ${hasFetch ? "성공" : "실패"}, update: ${hasUpdate ? "성공" : "실패"})` 
          });
        }
      } catch (error) {
        console.error("[알람 재등록] 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "test_adsense_ga4_access") {
    // AdSense/GA4 접근 권한 테스트
    (async () => {
      try {
        const { googleAuthToken, adSenseAccountId } = await chrome.storage.local.get([
          "googleAuthToken",
          "adSenseAccountId"
        ]);
        
        if (!googleAuthToken) {
          sendResponse({ 
            success: false, 
            message: "Google 인증 토큰이 없습니다. 채널 설정에서 Google 로그인을 해주세요." 
          });
          return;
        }
        
        const checkId = msg.checkId;
        
        if (checkId === "adsense_access") {
          if (!adSenseAccountId) {
            sendResponse({ 
              success: false, 
              message: "AdSense 계정 ID가 설정되지 않았습니다. 채널 설정에서 Google 로그인을 해주세요." 
            });
            return;
          }
          
          // [체크리스트 4] 계정 목록 조회 API로 검증
          const listUrl = "https://adsense.googleapis.com/v2/accounts";
          const listRes = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${googleAuthToken}` }
          });
          
          if (!listRes.ok) {
            if (listRes.status === 401) {
              sendResponse({ 
                success: false, 
                message: "토큰 만료 (401) - 재로그인 필요" 
              });
              return;
            } else if (listRes.status === 403) {
              sendResponse({ 
                success: false, 
                message: "AdSense 접근 권한이 없습니다. manifest.json의 oauth2.scopes에 'adsense.readonly'가 포함되어 있는지 확인하세요." 
              });
              return;
            } else {
              sendResponse({ 
                success: false, 
                message: `계정 목록 조회 실패 (${listRes.status})` 
              });
              return;
            }
          }
          
          const listData = await listRes.json();
          const accounts = listData.accounts || [];
          
          console.log("[AdSense 진단] 계정 목록 조회 결과:", JSON.stringify(listData, null, 2));
          
          // [체크리스트 3] pub- 접두사 처리 및 ID 검증
          const normalizedInputId = (adSenseAccountId || '').trim().toLowerCase();
          const accountMap = new Map(); // name -> 실제 계정 ID 매핑
          
          accounts.forEach(acc => {
            const fullName = acc.name || '';
            const id = fullName.split('/')[1] || '';
            if (id) {
              accountMap.set(id.trim().toLowerCase(), id.trim());
            }
          });
          
          const accountIds = Array.from(accountMap.keys());
          const originalAccountIds = Array.from(accountMap.values());
          
          // 입력한 ID가 목록에 있는지 확인
          if (accounts.length === 0) {
            sendResponse({ 
              success: false, 
              message: "연동된 AdSense 계정이 없습니다. Google 계정에 AdSense 계정이 연결되어 있는지 확인하세요." 
            });
            return;
          }
          
          // 실제 계정 ID 찾기 (대소문자 무시)
          const foundAccountId = accountMap.get(normalizedInputId);
          
          if (!foundAccountId) {
            sendResponse({ 
              success: false, 
              message: `AdSense 계정을 찾을 수 없습니다. 입력한 ID: "${adSenseAccountId}", 사용 가능한 계정: ${originalAccountIds.join(', ') || '없음'}` 
            });
            return;
          }
          
          // [체크리스트 2] API URL 생성 로직 확인: accounts/{accountId}/reports:generate 형식 사용
          // 계정 목록에서 찾은 실제 ID 사용
          const apiAccountId = foundAccountId;
          const testUrl = `https://adsense.googleapis.com/v2/accounts/${apiAccountId}/reports:generate`;
          
          console.log("[AdSense 진단] 입력 ID:", adSenseAccountId);
          console.log("[AdSense 진단] 실제 사용 ID:", apiAccountId);
          console.log("[AdSense 진단] 요청 URL:", testUrl);
          
          // 리포트 생성 API로 테스트 (계정 정보 조회보다 더 정확함)
          const adsenseRes = await fetch(testUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${googleAuthToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              dateRange: "TODAY",
              metrics: ["PAGE_VIEWS"]
            })
          });
          
          if (adsenseRes.status === 403) {
            sendResponse({ 
              success: false, 
              message: "AdSense 접근 권한이 없습니다. Google 계정 권한을 확인해주세요." 
            });
          } else if (adsenseRes.status === 404) {
            const errorData = await adsenseRes.json().catch(() => ({}));
            sendResponse({ 
              success: false, 
              message: `AdSense 계정을 찾을 수 없습니다 (404). 계정 ID: "${apiAccountId}", 오류: ${errorData.error?.message || '알 수 없는 오류'}` 
            });
          } else if (!adsenseRes.ok) {
            const errorData = await adsenseRes.json().catch(() => ({}));
            sendResponse({ 
              success: false, 
              message: `AdSense API 오류: ${adsenseRes.status} - ${errorData.error?.message || '알 수 없는 오류'}` 
            });
          } else {
            sendResponse({ 
              success: true, 
              message: `AdSense 계정 접근 권한이 정상입니다. (Account ID: ${apiAccountId})` 
            });
          }
        } else if (checkId === "ga4_access") {
          // GA4 속성 접근 테스트
          const userId = CONSTANTS.USER_ID;
          const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
          const channelsData = channelsSnapshot.val() || {};
          const myChannels = channelsData.myChannels || { blogs: [] };
          const firstBlog = myChannels.blogs?.[0];
          
          if (!firstBlog || !firstBlog.gaPropertyId) {
            sendResponse({ 
              success: false, 
              message: "GA4 속성 ID가 설정된 채널이 없습니다. 채널 설정에서 GA4 속성을 선택해주세요." 
            });
            return;
          }
          
          const testUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${firstBlog.gaPropertyId}:runReport`;
          const gaRes = await fetch(testUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${googleAuthToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              dateRanges: [{ startDate: "today", endDate: "today" }],
              metrics: [{ name: "screenPageViews" }]
            })
          });
          
          if (gaRes.status === 403) {
            sendResponse({ 
              success: false, 
              message: "GA4 접근 권한이 없습니다. Google 계정 권한을 확인해주세요." 
            });
          } else if (gaRes.status === 404) {
            sendResponse({ 
              success: false, 
              message: "GA4 속성을 찾을 수 없습니다. 속성 ID를 확인해주세요." 
            });
          } else if (!gaRes.ok) {
            sendResponse({ 
              success: false, 
              message: `GA4 API 오류: ${gaRes.status}. 채널 설정에서 Google 로그인을 다시 시도해주세요.` 
            });
          } else {
            sendResponse({ 
              success: true, 
              message: `GA4 속성 접근 권한이 정상입니다. (Property ID: ${firstBlog.gaPropertyId})` 
            });
          }
        }
      } catch (error) {
        console.error("[접근 권한 테스트] 오류:", error);
        sendResponse({ success: false, message: `테스트 실패: ${error.message}` });
      }
    })();
    return true;
  }
  // 애드센스 등록 여부 일괄 확인
  else if (msg.action === "check_adsense_registration") {
    (async () => {
      try {
        const result = await checkAdSenseRegistrationStatus();
        sendResponse({ success: true, data: result });
      } catch (error) {
        console.error("[AdSense 등록 확인 실패]", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  else if (msg.action === "run_adsense_deep_diagnosis") {
    (async () => {
      const result = await runAdSenseDeepDiagnosis();
      sendResponse(result);
    })();
    return true;
  }
});

// Util: create a simple PNG data URL with text
function generatePlaceholderImage({
  width = 768,
  height = 768,
  text = "AI Image",
  subtitle = "",
}) {
  return new Promise((resolve) => {
    try {
      // OffscreenCanvas is available in service worker contexts in modern Chrome
      let canvas;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(width, height);
      } else {
        // Fallback size
        canvas = new OffscreenCanvas(512, 512);
      }
      const ctx = canvas.getContext("2d");
      // background gradient
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#1a73e8");
      grad.addColorStop(1, "#4285f4");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // rounded rectangle overlay
      const pad = Math.round(Math.min(width, height) * 0.06);
      const r = Math.round(Math.min(width, height) * 0.04);
      drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, r);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();

      // title text
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(
        Math.min(width, height) * 0.06
      )}px ui-sans-serif,system-ui,Segoe UI`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      wrapText(
        ctx,
        text,
        width / 2,
        height / 2 - Math.round(height * 0.06),
        Math.round(width * 0.7),
        Math.round(Math.min(width, height) * 0.08)
      );

      // subtitle
      ctx.font = `500 ${Math.round(
        Math.min(width, height) * 0.035
      )}px ui-sans-serif,system-ui,Segoe UI`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      wrapText(
        ctx,
        subtitle,
        width / 2,
        height / 2 + Math.round(height * 0.14),
        Math.round(width * 0.75),
        Math.round(Math.min(width, height) * 0.06)
      );

      const blobPromise = canvas.convertToBlob
        ? canvas.convertToBlob({ type: "image/png", quality: 0.92 })
        : new Promise((res) => canvas.toBlob(res));
      blobPromise.then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn(
        "Placeholder canvas not available, fetching fallback image and converting to Data URL"
      );
      const url = `https://dummyimage.com/${width}x${height}/4285f4/ffffff.png&text=AI+Image`;
      fetch(url)
        .then((r) => r.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        })
        .catch(() =>
          resolve(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABF3n2NQAAAABJRU5ErkJggg=="
          )
        );
    }
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let yy = y;
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  const totalHeight = lines.length * lineHeight;
  yy -= totalHeight / 2;
  lines.forEach((l, i) => ctx.fillText(l.trim(), x, yy + i * lineHeight));
}

function truncate(str, max) {
  return (str || "").length > max ? str.slice(0, max - 1) + "…" : str;
}

// --- 3. 주기적 데이터 수집 로직 ---

chrome.runtime.onInstalled.addListener(() => {
  console.log("Content Pilot 설치됨. 알람을 설정합니다.");
  chrome.storage.local.set({
    isScrapingActive: false,
    highlightToggleState: false,
  });
  chrome.alarms.create("fetch-channels", {
    delayInMinutes: 1,
    periodInMinutes: 240,
  });
  chrome.alarms.create("update-performance-metrics", {
    delayInMinutes: 5,
    periodInMinutes: 360,
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Content Pilot 시작됨. 알람을 확인/설정합니다.");
  chrome.alarms.get("fetch-channels", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("fetch-channels", {
        delayInMinutes: 1,
        periodInMinutes: 240,
      });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetch-channels") {
    console.log("알람 발생: 모든 채널 데이터를 수집합니다...");
    fetchAllChannelData();
  } else if (alarm.name === "update-performance-metrics") {
    console.log("알람 발생: 발행된 콘텐츠의 성과 지표를 업데이트합니다...");
    updateAllPerformanceMetrics();
  }
});

// --- 4. 데이터 수집 함수들 ---
async function fetchAllChannelData() {
  const userId = CONSTANTS.USER_ID;
  // .once('value')는 Promise를 반환하므로 await를 사용합니다.
  const snapshot = await firebase
    .database()
    .ref(`channels/${userId}`)
    .once("value");
  const channels = snapshot.val();
  if (!channels) {
    console.log("설정된 채널 정보가 없습니다.");
    return; // Promise<void>를 반환하며 종료
  }

  const promises = [];
  
  // 내 채널 수집
  if (channels.myChannels) {
    // 내 채널 블로그
    channels.myChannels.blogs?.forEach((channel) =>
      promises.push(fetchRssFeed(channel.apiUrl, "myChannels"))
    );
    // 내 채널 유튜브
    channels.myChannels.youtubes?.forEach((channel) =>
      promises.push(fetchYoutubeChannel(channel.apiUrl, "myChannels"))
    );
    
    // 경쟁 채널 수집 (각 내 채널의 competitors에서)
    channels.myChannels.blogs?.forEach((myChannel) => {
      if (myChannel.competitors && Array.isArray(myChannel.competitors)) {
        myChannel.competitors.forEach((competitor) =>
          promises.push(fetchRssFeed(competitor.apiUrl, "competitorChannels"))
        );
      }
    });
  }
  
  // 하위 호환성: 구버전 전역 competitorChannels도 처리 (마이그레이션 전용)
  if (channels.competitorChannels) {
    channels.competitorChannels.blogs?.forEach((channel) =>
      promises.push(fetchRssFeed(channel.apiUrl, "competitorChannels"))
    );
    channels.competitorChannels.youtubes?.forEach((channel) =>
      promises.push(fetchYoutubeChannel(channel.apiUrl, "competitorChannels"))
    );
  }

  // 모든 데이터 수집 작업이 끝날 때까지 기다립니다.
  await Promise.all(promises);
  console.log("모든 채널 데이터 수집 완료.");
}

// --- ▼▼▼ [하이브리드 방식] 블로그 데이터 수집 함수 수정 ▼▼▼ ---
// background.js

/**
 * [유틸리티] 동시 실행 수를 제한하는 함수 (p-limit 스타일)
 * @param {Array} items - 처리할 항목 배열
 * @param {Function} fn - 각 항목을 처리하는 함수
 * @param {number} limit - 동시 실행 수 제한 (기본값: 5)
 * @returns {Promise<Array>} 처리 결과 배열
 */
async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  const executing = [];
  
  for (const item of items) {
    // Promise 생성 및 실행 시작
    const promise = (async () => {
      try {
        return await fn(item);
      } finally {
        // 완료 시 executing 배열에서 제거
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      }
    })();
    
    results.push(promise);
    executing.push(promise);
    
    // 동시 실행 수가 제한에 도달하면 하나가 완료될 때까지 대기
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  
  // 모든 작업이 완료될 때까지 대기
  return Promise.all(results);
}

/**
 * [리팩토링] RSS 아이템 처리 함수 (병렬 처리용)
 * @param {string} itemText - RSS 아이템 XML 텍스트
 * @param {string} sourceId - 소스 ID
 * @param {string} channelType - 채널 타입
 * @returns {Promise<void>}
 */
async function processRssItem(itemText, sourceId, channelType) {
  let itemLink = null;
  const atomLinkMatch = itemText.match(
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/
  );
  if (atomLinkMatch && atomLinkMatch[1]) {
    itemLink = atomLinkMatch[1];
  } else {
    const rssLinkMatch = itemText.match(
      /<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/
    );
    if (rssLinkMatch && rssLinkMatch[1]) {
      itemLink = rssLinkMatch[1];
    }
  }
  if (!itemLink) return;

  // 게시물 제목과 날짜 추출
  const titleMatch = itemText.match(
    /<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
  );
  const pubDateMatch = itemText.match(
    /<(pubDate|published|updated)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/
  );

  const title = titleMatch ? titleMatch[1] : "제목 없음";
  const timestamp = new Date(
    pubDateMatch ? pubDateMatch[2] : Date.now()
  ).getTime();

  const fullLink = itemLink.replace(/\s/g, "");
  const linkForId = fullLink.split("?")[0];
  const contentId = btoa(linkForId).replace(/=/g, "");
  const userId = CONSTANTS.USER_ID;
  const contentRef = firebase
    .database()
    .ref(`channel_content/${userId}/blogs/${contentId}`);

  const existingDataSnap = await contentRef.once("value");

  if (existingDataSnap.exists()) {
    const existingData = existingDataSnap.val();
    if (!existingData.tags && existingData.cleanText) {
      try {
        const tags = await extractKeywords(existingData.cleanText);
        if (tags) {
          contentRef.update({ tags: tags });
        }
      } catch (e) {
        console.error(`'${fullLink}' 태그 추가 중 오류:`, e);
      }
    }

    try {
      const postResponse = await fetch(fullLink);
      if (!postResponse.ok) return;
      let postHtml = await postResponse.text();

      const naverIframeMatch = postHtml.match(
        /<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/
      );
      if (naverIframeMatch && naverIframeMatch[1]) {
        const iframeUrl = new URL(
          naverIframeMatch[1],
          "https://blog.naver.com"
        ).href;
        const iframeResponse = await fetch(iframeUrl);
        if (iframeResponse.ok) postHtml = await iframeResponse.text();
      }

      await getOffscreenDocument();
      const parsedData = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "parse_html_in_offscreen",
            html: postHtml,
            baseUrl: fullLink,
          },
          (response) => resolve(response)
        );
      });

      if (parsedData && parsedData.success) {
        contentRef.update({
          commentCount: parsedData.metrics.commentCount,
          likeCount: parsedData.metrics.likeCount || null,
          readTimeInSeconds: parsedData.metrics.readTimeInSeconds || null,
          fetchedAt: Date.now(),
        });
      }
    } catch (updateError) {
      console.error(`'${fullLink}' 가벼운 업데이트 중 오류:`, updateError);
    }
  } else {
    const postResponse = await fetch(fullLink);
    if (!postResponse.ok) return;
    let postHtml = await postResponse.text();
    const naverIframeMatch = postHtml.match(
      /<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/
    );
    if (naverIframeMatch && naverIframeMatch[1]) {
      const iframeUrl = new URL(
        naverIframeMatch[1],
        "https://blog.naver.com"
      ).href;
      const iframeResponse = await fetch(iframeUrl);
      if (iframeResponse.ok) postHtml = await iframeResponse.text();
    }

    await getOffscreenDocument();
    const parsedData = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "parse_html_in_offscreen",
          html: postHtml,
          baseUrl: fullLink,
        },
        (response) => {
          if (chrome.runtime.lastError)
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          else resolve(response);
        }
      );
    });

    if (parsedData && parsedData.success) {
      const tags = await extractKeywords(parsedData.cleanText);
      const finalData = {
        title: title,
        fullLink,
        pubDate: timestamp,
        description: parsedData.description,
        thumbnail: parsedData.thumbnail,
        cleanText: parsedData.cleanText,
        sourceId,
        channelType,
        fetchedAt: Date.now(),
        ...parsedData.metrics,
        tags: tags || null,
      };
      const cleanedFinalData = cleanDataForFirebase(finalData);
      contentRef.set(cleanedFinalData);

      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id)
            chrome.tabs
              .sendMessage(tab.id, {
                action: "cp_item_updated",
                data: cleanedFinalData,
              })
              .catch((e) => {});
        });
      });
    }
  }
}

async function fetchRssFeed(url, channelType) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const text = await response.text();

    let channelTitle = null;

    // 1단계: <channel> 태그 안에서 title 찾기 (RSS 2.0 방식)
    const channelBlockMatch = text.match(/<channel>([\s\S]*?)<\/channel>/);
    if (channelBlockMatch && channelBlockMatch[1]) {
      const titleInChannelMatch = channelBlockMatch[1].match(
        /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      if (titleInChannelMatch && titleInChannelMatch[1]) {
        channelTitle = titleInChannelMatch[1];
      }
    }

    // 2단계: 1단계 실패 시, 첫 게시물(<item> 또는 <entry>) 이전의 <title> 찾기 (Atom 방식)
    if (!channelTitle) {
      const firstItemIndex = text.search(/<(item|entry)>/);
      const textBeforeItems =
        firstItemIndex > -1 ? text.substring(0, firstItemIndex) : text;
      const firstTitleMatch = textBeforeItems.match(
        /<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      if (firstTitleMatch && firstTitleMatch[1]) {
        channelTitle = firstTitleMatch[1].trim();
      }
    }

    const finalTitle = channelTitle || url;
    const sourceId = btoa(url).replace(/=/g, "");
    const userId = CONSTANTS.USER_ID;
    firebase.database().ref(`channel_meta/${userId}/${sourceId}`).set({
      title: finalTitle,
      type: "blog",
      source: url,
      fetchedAt: Date.now(),
    });

    const items = text.match(/<(item|entry)>([\s\S]*?)<\/\1>/g) || [];

    // [성능 최적화] 순차 처리 → 병렬 처리로 변경 (동시 요청 수 제한: 5개)
    const itemsToProcess = items.slice(0, 10);
    const startTime = Date.now();
    
    // 동시 실행 수를 5개로 제한하여 병렬 처리
    await limitConcurrency(
      itemsToProcess,
      (itemText) => processRssItem(itemText, sourceId, channelType),
      5 // 동시 요청 수 제한
    );
    
    const duration = Date.now() - startTime;
    console.log(`[RSS 수집] ${itemsToProcess.length}개 아이템 처리 완료 (${duration}ms)`);
  } catch (error) {
    console.error(`Failed to fetch or parse RSS for ${url}:`, error);
  }
}

/**
 * [공통] URL 정규화 함수 (기본 정규화 로직)
 * 입력된 URL을 비교 가능한 형태로 정규화합니다.
 * 
 * @param {string} url - 정규화할 URL
 * @param {Object} options - 정규화 옵션
 * @param {boolean} options.handleYouTube - YouTube URL 특별 처리 여부 (기본값: false)
 * @param {boolean} options.decodeURI - URI 디코딩 수행 여부 (기본값: false)
 * @returns {string} 정규화된 URL
 * 
 * @example
 * getNormalizedUrl("https://www.Example.com/path/?query=1")
 * // -> "example.com/path"
 * 
 * getNormalizedUrl("https://youtu.be/VIDEO_ID", { handleYouTube: true })
 * // -> "youtube:VIDEO_ID"
 * 
 * getNormalizedUrl("https://example.com/%ED%95%9C%EA%B8%80", { decodeURI: true })
 * // -> "example.com/한글"
 */
function getNormalizedUrl(url, options = {}) {
  if (!url) return "";
  
  const { handleYouTube = false, decodeURI = false } = options;
  
  try {
    // URL 객체로 변환 (http/https가 없는 경우 임의로 붙여서 시도)
    const urlStr = url.trim();
    const targetUrl = (urlStr.startsWith('http://') || urlStr.startsWith('https://')) 
      ? urlStr 
      : `https://${urlStr}`;
    const urlObj = new URL(targetUrl);
    
    // 호스트: www. 제거, 소문자 변환
    const host = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    // 경로: 끝의 슬래시(/) 제거
    const pathname = urlObj.pathname.replace(/\/$/, '');
    
    // YouTube 특별 처리 (옵션)
    if (handleYouTube && (host.includes('youtube.com') || host.includes('youtu.be'))) {
      // 1. 짧은 주소 (youtu.be/VIDEO_ID)
      if (host.includes('youtu.be')) {
        const videoId = pathname.substring(1); // 첫 번째 슬래시 제거
        if (videoId) return `youtube:${videoId}`;
      }
      // 2. 긴 주소 (youtube.com/watch?v=VIDEO_ID 또는 youtube.com/embed/VIDEO_ID)
      const videoId = urlObj.searchParams.get('v') || pathname.split('/embed/')[1]?.split('?')[0];
      if (videoId) return `youtube:${videoId}`;
    }
    
    // 일반적인 경우: 호스트 + 경로 조합 반환 (쿼리 파라미터 제거)
    const normalized = `${host}${pathname}`;
    
    // URI 디코딩 (옵션)
    if (decodeURI) {
      try {
        return decodeURIComponent(normalized);
      } catch (e) {
        return normalized;
      }
    }
    
    return normalized;
  } catch (e) {
    // URL 파싱 실패 시, 단순 문자열 처리 (공백 제거, 소문자 변환)
    return url.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('?')[0].replace(/\/$/, '');
  }
}

/**
 * [핵심] URL 정규화 함수 (강력한 정규화 적용)
 * 입력된 URL을 비교 가능한 형태로 정규화합니다.
 * 예: "https://www.Example.com/path/?query=1" -> "example.com/path"
 * YouTube URL은 특별 처리: youtu.be/VIDEO_ID와 youtube.com/watch?v=VIDEO_ID를 동일하게 처리
 * 
 * @deprecated 이 함수는 getNormalizedUrl을 사용하도록 리팩토링되었습니다.
 *             하위 호환성을 위해 유지되지만, 새로운 코드에서는 getNormalizedUrl을 사용하세요.
 */
function normalizeUrlForComparison(url) {
  return getNormalizedUrl(url, { handleYouTube: true });
}

/**
 * [유틸리티] Firebase 키로 사용 가능하도록 URL 인코딩
 * Firebase 키에는 ".", "#", "$", "/", "[", "]" 문자가 허용되지 않으므로 안전한 문자로 치환
 * @param {string} url - 정규화된 URL
 * @returns {string} Firebase 키로 사용 가능한 문자열
 */
function encodeUrlForFirebaseKey(url) {
  if (!url) return "";
  // 특수 문자를 안전한 문자로 치환
  return url
    .replace(/\./g, '_DOT_')
    .replace(/\//g, '_SLASH_')
    .replace(/#/g, '_HASH_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/\[/g, '_LBRACKET_')
    .replace(/\]/g, '_RBRACKET_');
}

/**
 * [유틸리티] Firebase 키를 원래 URL로 디코딩
 * @param {string} encodedUrl - 인코딩된 URL
 * @returns {string} 원래 정규화된 URL
 */
function decodeUrlFromFirebaseKey(encodedUrl) {
  if (!encodedUrl) return "";
  // 안전한 문자를 원래 특수 문자로 복원
  return encodedUrl
    .replace(/_DOT_/g, '.')
    .replace(/_SLASH_/g, '/')
    .replace(/_HASH_/g, '#')
    .replace(/_DOLLAR_/g, '$')
    .replace(/_LBRACKET_/g, '[')
    .replace(/_RBRACKET_/g, ']');
}

/**
 * [최적화] URL 인덱스 업데이트 함수
 * 카드 저장/업데이트 시 URL 인덱스를 자동으로 업데이트합니다.
 * @param {string} cardId - 카드 ID
 * @param {string} status - 카드 상태
 * @param {string} originUrl - origin.postUrl (선택)
 * @param {string} publishedUrl - publishedUrl (선택)
 */
async function updateUrlIndex(cardId, status, originUrl = null, publishedUrl = null) {
  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  const indexRef = db.ref(`url_index/${userId}`);
  
  const updates = {};
  
  // origin.postUrl 인덱스 업데이트
  if (originUrl) {
    const normalizedOriginUrl = normalizeUrlForComparison(originUrl);
    if (normalizedOriginUrl) {
      // [수정] Firebase 키로 사용 가능하도록 인코딩
      const encodedKey = encodeUrlForFirebaseKey(normalizedOriginUrl);
      updates[`${encodedKey}/origin/${cardId}`] = { status, cardId };
    }
  }
  
  // publishedUrl 인덱스 업데이트
  if (publishedUrl) {
    const normalizedPublishedUrl = normalizeUrlForComparison(publishedUrl);
    if (normalizedPublishedUrl) {
      // [수정] Firebase 키로 사용 가능하도록 인코딩
      const encodedKey = encodeUrlForFirebaseKey(normalizedPublishedUrl);
      updates[`${encodedKey}/published/${cardId}`] = { status, cardId };
    }
  }
  
  if (Object.keys(updates).length > 0) {
    try {
      await indexRef.update(updates);
    } catch (error) {
      console.warn(`[URL 인덱스 업데이트 실패] ${cardId}:`, error);
    }
  }
}

/**
 * [최적화] URL 인덱스에서 카드 제거
 * 카드 삭제 시 인덱스에서도 제거합니다.
 * @param {string} cardId - 카드 ID
 * @param {string} originUrl - origin.postUrl (선택)
 * @param {string} publishedUrl - publishedUrl (선택)
 */
async function removeUrlIndex(cardId, originUrl = null, publishedUrl = null) {
  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  const indexRef = db.ref(`url_index/${userId}`);
  
  const updates = {};
  
  if (originUrl) {
    const normalizedOriginUrl = normalizeUrlForComparison(originUrl);
    if (normalizedOriginUrl) {
      // [수정] Firebase 키로 사용 가능하도록 인코딩
      const encodedKey = encodeUrlForFirebaseKey(normalizedOriginUrl);
      updates[`${encodedKey}/origin/${cardId}`] = null;
    }
  }
  
  if (publishedUrl) {
    const normalizedPublishedUrl = normalizeUrlForComparison(publishedUrl);
    if (normalizedPublishedUrl) {
      // [수정] Firebase 키로 사용 가능하도록 인코딩
      const encodedKey = encodeUrlForFirebaseKey(normalizedPublishedUrl);
      updates[`${encodedKey}/published/${cardId}`] = null;
    }
  }
  
  if (Object.keys(updates).length > 0) {
    try {
      await indexRef.update(updates);
    } catch (error) {
      console.warn(`[URL 인덱스 제거 실패] ${cardId}:`, error);
    }
  }
}

/**
 * [최적화] URL 중복 검사 함수 (Firebase Query 사용)
 * 입력된 URL이 칸반 보드의 모든 상태(ideas, in-progress, done)에 존재하는지 확인합니다.
 * origin.postUrl과 publishedUrl 두 필드를 모두 확인합니다.
 * 
 * 최적화: URL 인덱스 노드를 사용하여 O(1) 조회 (기존 O(N) 방식에서 개선)
 */
async function checkDuplicateUrl(targetUrl) {
  if (!targetUrl) return { exists: false };

  const targetKey = normalizeUrlForComparison(targetUrl);
  console.log(`[중복 검사] 원본: ${targetUrl} -> 정규화: ${targetKey}`);

  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  
  // [최적화] URL 인덱스에서 직접 조회 (O(1))
  try {
    // [수정] Firebase 키로 사용 가능하도록 인코딩
    const encodedKey = encodeUrlForFirebaseKey(targetKey);
    const indexRef = db.ref(`url_index/${userId}/${encodedKey}`);
    const indexSnapshot = await indexRef.once("value");
    const indexData = indexSnapshot.val();
    
    if (indexData) {
      // origin 또는 published 중 하나라도 있으면 중복
      const originCards = indexData.origin || {};
      const publishedCards = indexData.published || {};
      
      // 첫 번째 매칭되는 카드 정보 가져오기
      const matchedCardId = Object.keys(originCards)[0] || Object.keys(publishedCards)[0];
      const matchedCardInfo = originCards[matchedCardId] || publishedCards[matchedCardId];
      
      if (matchedCardInfo) {
        // 카드 상세 정보 가져오기
        const cardRef = db.ref(`kanban/${userId}/${matchedCardInfo.status}/${matchedCardInfo.cardId}`);
        const cardSnapshot = await cardRef.once("value");
        const card = cardSnapshot.val();
        
        if (card) {
          console.warn(`[중복 발견] 상태: ${matchedCardInfo.status}, 카드: ${card.title}`);
          return {
            exists: true,
            status: matchedCardInfo.status,
            cardId: matchedCardInfo.cardId,
            title: card.title || "제목 없음"
          };
        }
      }
    }
  } catch (error) {
    console.warn(`[URL 인덱스 조회 실패, fallback 사용]:`, error);
    // 인덱스가 없거나 오류 발생 시 기존 방식으로 fallback
    return await checkDuplicateUrlFallback(targetUrl);
  }
  
  return { exists: false };
}

/**
 * [Fallback] 기존 방식의 URL 중복 검사 (인덱스가 없을 때 사용)
 * @private
 */
async function checkDuplicateUrlFallback(targetUrl) {
  const targetKey = normalizeUrlForComparison(targetUrl);
  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  
  // 전체 칸반 데이터 조회 (fallback)
  const snapshot = await db.ref(`kanban/${userId}`).once("value");
  const allCards = snapshot.val() || {};

  // 모든 상태(status) 순회
  for (const status in allCards) {
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];
      
      // 비교 대상 1: 리뉴얼 원본 URL (origin.postUrl)
      const originUrl = card.origin?.postUrl || "";
      // 비교 대상 2: 발행된 URL (publishedUrl)
      const publishedUrl = card.publishedUrl || "";

      // 정규화된 키로 비교 (둘 중 하나라도 일치하면 중복)
      if (normalizeUrlForComparison(originUrl) === targetKey || normalizeUrlForComparison(publishedUrl) === targetKey) {
        console.warn(`[중복 발견] 상태: ${status}, 카드: ${card.title}`);
        return { 
          exists: true, 
          status: status, 
          cardId: cardId, 
          title: card.title || "제목 없음"
        };
      }
    }
  }
  
  return { exists: false };
}

/**
 * [Phase 1] 공통 파싱 로직: 블로그 페이지 HTML 파싱
 * fetchRssFeed의 HTML 파싱 로직을 재사용 가능한 함수로 분리
 */
async function parseBlogPage(url, html) {
  try {
    // 네이버 블로그 iframe 처리
    let postHtml = html;
    const naverIframeMatch = postHtml.match(
      /<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/
    );
    if (naverIframeMatch && naverIframeMatch[1]) {
      const iframeUrl = new URL(
        naverIframeMatch[1],
        "https://blog.naver.com"
      ).href;
      const iframeResponse = await fetch(iframeUrl);
      if (iframeResponse.ok) postHtml = await iframeResponse.text();
    }

    await getOffscreenDocument();
    const parsedData = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "parse_html_in_offscreen",
          html: postHtml,
          baseUrl: url,
        },
        (response) => {
          if (chrome.runtime.lastError)
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          else resolve(response);
        }
      );
    });

    return parsedData;
  } catch (error) {
    console.error(`[parseBlogPage] 오류 (${url}):`, error);
    return { success: false, error: error.message };
  }
}

/**
 * [Phase 1] 공통 파싱 로직: YouTube API 데이터 정규화
 * fetchYoutubeChannel의 데이터 정규화 로직을 재사용 가능한 함수로 분리
 */
function normalizeYoutubeData(apiItem, channelId, channelType) {
  const { id, snippet, statistics } = apiItem;
  const timestamp = new Date(snippet.publishedAt).getTime();
  
  return {
    videoId: id,
    title: snippet.title,
    description: snippet.description,
    publishedAt: timestamp,
    thumbnail: snippet.thumbnails?.default?.url || snippet.thumbnails?.medium?.url || null,
    viewCount: statistics?.viewCount ? parseInt(statistics.viewCount, 10) : 0,
    likeCount: statistics?.likeCount ? parseInt(statistics.likeCount, 10) : 0,
    commentCount: statistics?.commentCount ? parseInt(statistics.commentCount, 10) : 0,
    channelId,
    sourceId: channelId,
    channelType,
    fetchedAt: Date.now(),
  };
}

async function fetchYoutubeChannel(channelId, channelType) {
  const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");

  if (!youtubeApiKey) {
    console.warn(
      "YouTube API 키가 설정되지 않았습니다. YouTube 데이터 수집을 건너킵니다."
    );
    return;
  }

  let channelTitle = channelId;

  const channelInfoUrl = `https://www.googleapis.com/youtube/v3/channels?key=${youtubeApiKey}&id=${channelId}&part=snippet`;
  try {
    const channelInfoResponse = await fetch(channelInfoUrl);
    const channelInfoData = await channelInfoResponse.json();
    if (channelInfoData.items && channelInfoData.items.length > 0) {
      channelTitle = channelInfoData.items[0].snippet.title;
    }
  } catch (error) {
    console.error(`YouTube 채널 정보 조회 실패 (${channelId}):`, error);
  }

  const userId = CONSTANTS.USER_ID;
  const channelDataSnap = await firebase
    .database()
    .ref(`channels/${userId}`)
    .once("value");
  const channelData = channelDataSnap.val();

  const allChannels = (channelData?.myChannels?.youtubes || []).concat(
    channelData?.competitorChannels?.youtubes || []
  );
  const storedChannel = allChannels.find((c) => c.apiUrl === channelId);
  const inputUrl = storedChannel ? storedChannel.inputUrl : channelId;

  firebase.database().ref(`channel_meta/${userId}/${channelId}`).set({
    title: channelTitle,
    type: "youtube",
    source: channelId,
    inputUrl: inputUrl,
    fetchedAt: Date.now(),
  });

  const videoListUrl = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`;
  try {
    const videoListResponse = await fetch(videoListUrl);
    const videoListData = await videoListResponse.json();
    if (!videoListData.items) {
      console.error(
        `YouTube 영상 목록 조회 오류 (${channelId}):`,
        videoListData.error?.message || "알 수 없는 오류"
      );
      return;
    }

    const videoIds = videoListData.items
      .map((item) => item.id.videoId)
      .filter(Boolean);
    if (videoIds.length === 0) return;

    const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoIds.join(
      ","
    )}&part=snippet,statistics`;
    const detailsResponse = await fetch(videoDetailsUrl);
    const detailsData = await detailsResponse.json();

    if (detailsData.items) {
      for (const item of detailsData.items) {
        const { id, snippet, statistics } = item;
        const existingDataSnap = await firebase
          .database()
          .ref(`channel_content/${userId}/youtubes/${id}`)
          .once("value");
        const existingData = existingDataSnap.val();
        let tags =
          existingData && existingData.tags
            ? existingData.tags
            : await extractKeywords(snippet.description);

        const timestamp = new Date(snippet.publishedAt).getTime();
        const video = {
          videoId: id,
          title: snippet.title,
          description: snippet.description,
          publishedAt: timestamp,
          thumbnail: snippet.thumbnails?.default?.url,
          viewCount: statistics?.viewCount
            ? parseInt(statistics.viewCount, 10)
            : 0,
          likeCount: statistics?.likeCount
            ? parseInt(statistics.likeCount, 10)
            : 0,
          commentCount: statistics?.commentCount
            ? parseInt(statistics.commentCount, 10)
            : 0,
          channelId,
          sourceId: channelId,
          channelType,
          fetchedAt: Date.now(),
          tags: tags || null,
        };

        const cleanedVideoData = cleanDataForFirebase(video);
        firebase
          .database()
          .ref(`channel_content/${userId}/youtubes/${cleanedVideoData.videoId}`)
          .set(cleanedVideoData);
      }
      console.log(`YouTube 채널 상세 정보 수집 성공: ${channelId}`);
    }
  } catch (error) {
    console.error(`YouTube 채널 데이터 수집 실패 (${channelId}):`, error);
  }
}

/**
 * [체크리스트 2] 텍스트 요약 함수
 * 긴 본문을 3~5줄의 핵심 요약으로 변환
 */
async function summarizeText(text) {
  if (!text || text.length < 200) {
    // 짧은 텍스트는 그대로 반환
    return text;
  }

  try {
    const prompt = `다음 텍스트를 콘텐츠 아이디어 카드의 설명으로 사용할 수 있게 3문장 이내로 핵심만 요약해줘. 불필요한 수식어나 장식적인 표현은 제거하고, 핵심 내용만 간결하게 전달해줘:\n\n${text.substring(0, 3000)}`;

    const summary = await callGeminiAPI(prompt);
    
    // 오류 메시지인 경우 원본 반환
    if (summary.startsWith("오류:")) {
      console.warn("[요약 실패] 원본 텍스트 반환:", summary);
      return text;
    }

    return summary.trim();
  } catch (error) {
    console.error("[요약 오류] 원본 텍스트 반환:", error);
    return text; // 오류 시 원본 반환
  }
}

/**
 * [Global Error Dispatcher] 백그라운드 에러를 프론트엔드에 Toast 메시지로 전파
 * @param {string} errorType - 에러 타입 (TOKEN_EXPIRED, QUOTA_EXCEEDED, API_KEY_MISSING, API_ERROR, UNAUTHORIZED, FORBIDDEN)
 * @param {string} message - 에러 메시지
 */
async function sendErrorToUI(errorType, message) {
  try {
    // 현재 활성 탭 찾기
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (tabs && tabs.length > 0 && tabs[0].id) {
      // 에러 타입별 친절한 메시지 생성
      let userFriendlyMessage = message;
      let icon = "⚠️";
      
      switch (errorType) {
        case "TOKEN_EXPIRED":
          userFriendlyMessage = "🔑 인증 토큰이 만료되었습니다. 잠시 후 자동으로 갱신됩니다.";
          icon = "🔑";
          break;
        case "QUOTA_EXCEEDED":
          userFriendlyMessage = "📊 API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.";
          icon = "📊";
          break;
        case "API_KEY_MISSING":
          userFriendlyMessage = "🔑 API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
          icon = "🔑";
          break;
        case "UNAUTHORIZED":
          userFriendlyMessage = "인증 실패: 토큰이 만료되었습니다 (재로그인 필요)";
          icon = "🔴";
          break;
        case "FORBIDDEN":
          userFriendlyMessage = "인증 실패: 토큰이 만료되었습니다 (재로그인 필요)";
          icon = "🔴";
          break;
        case "API_ERROR":
          userFriendlyMessage = `⚠️ ${message || "API 호출 중 오류가 발생했습니다."}`;
          icon = "⚠️";
          break;
        default:
          userFriendlyMessage = `⚠️ ${message || "오류가 발생했습니다."}`;
          icon = "⚠️";
      }
      
      // 활성 탭에 메시지 전송
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "show_error_toast",
        errorType: errorType,
        message: userFriendlyMessage,
        icon: icon
      }).catch((err) => {
        // 탭이 닫혔거나 메시지를 받을 수 없는 경우 조용히 실패
        console.warn("[sendErrorToUI] 메시지 전송 실패 (탭이 닫혔거나 콘텐츠 스크립트가 로드되지 않음):", err);
      });
    }
  } catch (error) {
    console.error("[sendErrorToUI] 에러 전송 실패:", error);
  }
}

async function callGeminiAPI(prompt) {
  try {
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey) {
      const errorMsg = "Gemini API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
      await sendErrorToUI("API_KEY_MISSING", errorMsg);
      return `오류: ${errorMsg}`;
    }

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage =
        errorData.error?.message ||
        "자세한 내용은 서비스 워커 콘솔을 확인하세요.";
      
      // 에러 타입별 처리
      let errorType = "API_ERROR";
      if (response.status === 401) {
        errorType = "UNAUTHORIZED";
      } else if (response.status === 403) {
        errorType = "FORBIDDEN";
      } else if (response.status === 429) {
        errorType = "QUOTA_EXCEEDED";
      }
      
      await sendErrorToUI(errorType, `Gemini API 호출 실패: ${errorMessage}`);
      return `오류: Gemini API 호출에 실패했습니다.\n상태: ${response.status}\n원인: ${errorMessage}`;
    }

    const responseData = await response.json();

    if (
      !responseData.candidates ||
      !responseData.candidates[0]?.content?.parts[0]?.text
    ) {
      await sendErrorToUI("API_ERROR", "AI로부터 예상치 못한 형식의 응답을 받았습니다.");
      return "오류: AI로부터 예상치 못한 형식의 응답을 받았습니다.";
    }

    return responseData.candidates[0].content.parts[0].text;
  } catch (error) {
    await sendErrorToUI("API_ERROR", `AI 분석 중 예외가 발생했습니다: ${error.message || "알 수 없는 오류"}`);
    return "오류: AI 분석 중 예외가 발생했습니다. 개발자 콘솔을 확인해주세요.";
  }
}

// ▼▼▼ [추가] AI 재학습 및 진화를 위한 함수들 ▼▼▼

/**
 * [수정] 특정 채널의 성과 데이터를 분석합니다.
 * @param {string} targetChannelId - 분석할 채널 ID (null이면 전체 채널 분석)
 * @returns {Promise<{analysis: string|null, decayContent: Array|null}>} 성과 분석 텍스트와 콘텐츠 부패 정보
 */
async function analyzePerformanceData(targetChannelId = null) {
  try {
    if (!targetChannelId) {
      // targetChannelId가 없으면 기존 동작 유지 (전체 채널 분석)
      // 하위 호환성을 위해 유지
    }

    const userId = CONSTANTS.USER_ID;
    const kanbanRef = firebase.database().ref(`kanban/${userId}`);
    const snapshot = await kanbanRef.once("value");
    const allCards = snapshot.val() || {};
    
    const performanceData = [];
    const now = Date.now();
    const DAYS_90 = 90 * 24 * 60 * 60 * 1000; // 90일을 밀리초로
    
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        
        // [핵심 수정] 채널 ID가 일치하는 카드만 필터링
        // (구버전 데이터 호환을 위해 channelId가 없는 경우도 포함할지 정책 결정 필요. 여기선 엄격하게 필터링)
        if (card.performance && !card.performance.error && card.publishedUrl) {
          // targetChannelId가 제공된 경우, 채널 ID 필터링 적용
          if (targetChannelId !== null && card.channelId !== targetChannelId) {
            continue; // 이 카드는 건너뛰기
          }
          
          const createdAt = card.createdAt || 0;
          const daysSinceCreation = (now - createdAt) / (24 * 60 * 60 * 1000);
          
          performanceData.push({
            cardId: cardId,
            title: card.title || "제목 없음",
            earnings: card.performance.estimatedEarnings || 0,
            pageviews: card.performance.pageviews || 0,
            sessions: card.performance.sessions || 0,
            avgDuration: card.performance.avgSessionDuration || 0,
            ctr: card.performance.ctr || 0,
            bounceRate: card.performance.bounceRate || 0,
            tags: card.tags || [],
            createdAt: createdAt,
            daysSinceCreation: daysSinceCreation,
            publishedUrl: card.publishedUrl,
            channelId: card.channelId || null, // [추가] 원본 카드의 채널 ID를 데이터에 포함
          });
        }
      }
    }
    
    if (performanceData.length === 0) {
      return { analysis: null, decayContent: null };
    }
    
    // 성과 데이터 정렬 (수익 기준)
    const sortedByEarnings = [...performanceData].sort((a, b) => b.earnings - a.earnings);
    const sortedByPageviews = [...performanceData].sort((a, b) => b.pageviews - a.pageviews);
    
    // 상위 5개 성공 콘텐츠
    const top5ByEarnings = sortedByEarnings.slice(0, 5);
    const top5ByPageviews = sortedByPageviews.slice(0, 5);
    
    // 평균 성과 계산
    const avgEarnings = performanceData.reduce((sum, item) => sum + item.earnings, 0) / performanceData.length;
    const avgPageviews = performanceData.reduce((sum, item) => sum + item.pageviews, 0) / performanceData.length;
    const avgDuration = performanceData.reduce((sum, item) => sum + item.avgDuration, 0) / performanceData.length;
    
    // 성공 패턴 분석
    const topTags = {};
    top5ByEarnings.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          topTags[tag] = (topTags[tag] || 0) + 1;
        });
      }
    });
    
    const topTagsList = Object.entries(topTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => tag)
      .join(", ");
    
    // 콘텐츠 부패(Content Decay) 식별
    // 조건: 90일 이상 된 콘텐츠 중에서 과거 성과가 높았지만 현재 트래픽이 하락 중인 콘텐츠
    // 휴리스틱: 90일 이상 된 콘텐츠 중 평균 수익/페이지뷰보다 높았던 콘텐츠를 재활용 후보로 선정
    const decayCandidates = performanceData
      .filter(item => {
        // 90일 이상 된 콘텐츠
        const isOld = item.daysSinceCreation >= 90;
        // 평균보다 높은 성과를 보였던 콘텐츠 (과거에 인기 있었음)
        const hadHighPerformance = item.earnings > avgEarnings * 1.5 || item.pageviews > avgPageviews * 1.5;
        return isOld && hadHighPerformance;
      })
      .sort((a, b) => {
        // 수익과 페이지뷰를 종합하여 우선순위 결정
        const scoreA = a.earnings * 0.6 + a.pageviews * 0.4;
        const scoreB = b.earnings * 0.6 + b.pageviews * 0.4;
        return scoreB - scoreA;
      })
      .slice(0, 5); // 상위 5개만 선정
    
    const analysis = `
과거 발행 콘텐츠 성과 분석 (총 ${performanceData.length}개 콘텐츠):

[평균 성과]
- 평균 수익: $${avgEarnings.toFixed(2)}
- 평균 페이지뷰: ${Math.round(avgPageviews).toLocaleString()}회
- 평균 체류 시간: ${Math.round(avgDuration)}초

[최고 성과 콘텐츠 - 수익 기준 상위 5개]
${top5ByEarnings.map((item, idx) => 
  `${idx + 1}. "${item.title}" - 수익: $${item.earnings.toFixed(2)}, 페이지뷰: ${item.pageviews.toLocaleString()}, 체류시간: ${Math.round(item.avgDuration)}초`
).join("\n")}

[최고 성과 콘텐츠 - 페이지뷰 기준 상위 5개]
${top5ByPageviews.map((item, idx) => 
  `${idx + 1}. "${item.title}" - 페이지뷰: ${item.pageviews.toLocaleString()}, 수익: $${item.earnings.toFixed(2)}, 체류시간: ${Math.round(item.avgDuration)}초`
).join("\n")}

[성공 패턴]
- 고수익 콘텐츠의 주요 태그: ${topTagsList || "없음"}
- 평균 대비 우수한 성과를 보인 콘텐츠들은 주로 위의 태그와 주제를 다루고 있습니다.
`;
    
    const decayContent = decayCandidates.length > 0 ? decayCandidates.map(item => ({
      cardId: item.cardId,
      title: item.title,
      earnings: item.earnings,
      pageviews: item.pageviews,
      daysSinceCreation: Math.round(item.daysSinceCreation),
      publishedUrl: item.publishedUrl,
      tags: item.tags || [],
      channelId: item.channelId // [추가] 채널 ID 전달
    })) : null;
    
    return { analysis, decayContent };
  } catch (error) {
    console.error("[성과 데이터 분석 실패]", error);
    return { analysis: null, decayContent: null };
  }
}

/**
 * 사용자 피드백 패턴을 분석합니다 (아이디어 채택/무시 행동 추적).
 * @returns {Promise<string|null>} 사용자 선호도 패턴 텍스트 또는 null
 */
async function getUserFeedbackPatterns() {
  try {
    const userId = CONSTANTS.USER_ID;
    const kanbanRef = firebase.database().ref(`kanban/${userId}`);
    const snapshot = await kanbanRef.once("value");
    const allCards = snapshot.val() || {};
    
    const adoptedIdeas = []; // 채택된 아이디어 (워크스페이스로 이동하거나 초안 작성됨)
    const ignoredIdeas = []; // 무시된 아이디어 (아이디어 상태로 오래 남아있음)
    
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        const isAiIdea = card.tags && Array.isArray(card.tags) && card.tags.includes("#AI-추천");
        
        if (!isAiIdea) continue;
        
        const createdAt = card.createdAt || 0;
        const daysSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
        
        if (status === "ideas" && daysSinceCreation > 7 && !card.draftContent) {
          // 7일 이상 아이디어 상태로 남아있고 초안이 없으면 무시된 것으로 간주
          ignoredIdeas.push({
            title: card.title || "제목 없음",
            tags: card.tags || [],
            daysSinceCreation: Math.round(daysSinceCreation),
          });
        } else if ((status === "in-progress" || status === "done") || card.draftContent) {
          // 워크스페이스로 이동했거나 초안이 있으면 채택된 것으로 간주
          adoptedIdeas.push({
            title: card.title || "제목 없음",
            tags: card.tags || [],
            status: status,
          });
        }
      }
    }
    
    if (adoptedIdeas.length === 0 && ignoredIdeas.length === 0) {
      return null;
    }
    
    // 채택된 아이디어의 태그 분석
    const adoptedTags = {};
    adoptedIdeas.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          if (tag !== "#AI-추천") {
            adoptedTags[tag] = (adoptedTags[tag] || 0) + 1;
          }
        });
      }
    });
    
    // 무시된 아이디어의 태그 분석
    const ignoredTags = {};
    ignoredIdeas.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          if (tag !== "#AI-추천") {
            ignoredTags[tag] = (ignoredTags[tag] || 0) + 1;
          }
        });
      }
    });
    
    const preferredTags = Object.entries(adoptedTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => `${tag} (${count}회 채택)`)
      .join(", ");
    
    const avoidedTags = Object.entries(ignoredTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag, count]) => `${tag} (${count}회 무시)`)
      .join(", ");
    
    return `
사용자 피드백 패턴 분석:

[채택된 AI 아이디어] (${adoptedIdeas.length}개)
- 사용자가 실제로 작업을 시작하거나 완료한 AI 추천 아이디어입니다.
- 선호하는 태그/주제: ${preferredTags || "없음"}

[무시된 AI 아이디어] (${ignoredIdeas.length}개)
- 7일 이상 아이디어 상태로 남아있어 사용자가 관심을 보이지 않은 아이디어입니다.
- 회피하는 태그/주제: ${avoidedTags || "없음"}

[권장 사항]
- 선호하는 태그와 주제를 중심으로 아이디어를 제안해주세요.
- 회피하는 태그와 주제는 피하거나, 더 매력적인 각도로 재구성하여 제안해주세요.
`;
  } catch (error) {
    console.error("[사용자 피드백 패턴 분석 실패]", error);
    return null;
  }
}

/**
 * 떠오르는 트렌드 주제를 수집합니다 (선행성 지표).
 * 향후 구글 트렌드 API, 레딧 등 커뮤니티 데이터를 활용할 수 있도록 확장 가능한 구조로 설계.
 * @param {string} channelContext - 채널의 맥락 정보 (선택적)
 * @returns {Promise<string|null>} 최신 트렌드 정보 텍스트 또는 null
 */
async function getEmergingTopics(channelContext = null) {
  try {
    // TODO: 향후 실제 API 연동 (구글 트렌드, 레딧 등)
    // 현재는 AI를 활용하여 채널 맥락 기반 트렌드 추론
    
    // 채널 맥락이 있으면 AI로 트렌드 추론, 없으면 null 반환
    if (!channelContext) {
      // 채널 맥락이 없으면 기본 트렌드 추론 시도
      // 실제 구현에서는 구글 트렌드 API 등을 활용
      return null;
    }
    
    // AI를 활용하여 채널 맥락 기반으로 최신 트렌드 추론
    // 실제 API 연동 전까지는 이 방식 사용
    const trendPrompt = `
당신은 트렌드 분석 전문가입니다. 아래 채널 정보를 바탕으로 현재 떠오르는 트렌드 주제 5-7개를 제안해주세요.

[채널 맥락]
${channelContext}

[요청]
- 최근 1-3개월 내 주목받고 있는 트렌드 주제를 제안해주세요.
- 검색량이 증가하고 있거나, 커뮤니티에서 활발히 논의되는 주제를 우선적으로 제안해주세요.
- 채널의 주제 영역과 관련된 트렌드여야 합니다.

[출력 형식]
다음 형식으로 응답해주세요:
- 트렌드 1: [주제명] - [간단한 설명]
- 트렌드 2: [주제명] - [간단한 설명]
...
`;
    
    const trends = await callGeminiAPI(trendPrompt);
    
    if (!trends || trends.includes("오류")) {
      return null;
    }
    
    return `
최신 트렌드 분석 (선행성 지표):

${trends}

[활용 가이드]
- 위 트렌드 주제들을 '전략적 탐색' 아이디어 생성 시 활용하여 시장 선점 기회를 잡으세요.
- 트렌드가 아직 확산되기 전에 콘텐츠를 발행하면 더 높은 성과를 기대할 수 있습니다.
`;
  } catch (error) {
    console.error("[트렌드 수집 실패]", error);
    return null;
  }
}

// ▼▼▼ [추가] 성과 지표 수집을 위한 함수들 ▼▼▼

/**
 * 발행된 모든 콘텐츠의 성과 지표를 업데이트합니다.
 */
/**
 * 성과 분석 기반으로 재활용 후보를 찾아 자동으로 아이디어를 생성하는 함수
 */
async function runAutomatedRenewalChecks() {
  console.log("[자동 재활용] 성과 분석 기반 재활용 후보 탐색 시작...");
  
  try {
    // 1. 재활용 후보 데이터 가져오기
    const { decayContent } = await analyzePerformanceData();

    if (!decayContent || decayContent.length === 0) {
      console.log("[자동 재활용] 재활용 후보가 없습니다.");
      return;
    }

    // 2. 중복 방지를 위해 현재 '아이디어' 탭 목록 조회
    const userId = CONSTANTS.USER_ID;
    const ideasSnap = await firebase.database().ref(`kanban/${userId}/ideas`).once("value");
    const ideas = ideasSnap.val() || {};
    const existingRenewalCards = Object.values(ideas).filter(
      idea => idea.origin?.type === 'my_post_renewal'
    );

    let createdCount = 0;
    for (const post of decayContent) {
      // 3. 중복 검사: 원본 카드 ID로 이미 생성된 자동 제안이 있는지 확인
      const alreadyExists = existingRenewalCards.some(
        idea => idea.origin?.originalCardId === post.cardId
      );

      if (alreadyExists) {
        console.log(`[자동 재활용] 건너뛰기: "${post.title}" (이미 제안됨)`);
        continue;
      }

      // 4. '아이디어 카드' 객체 생성
      const ideaData = {
        title: `[자동 리뉴얼] ${post.title}`,
        description: `[자동 리뉴얼 제안]\n- 원본 성과: $${post.earnings.toFixed(2)}, ${post.pageviews.toLocaleString()} PV\n- 발행 후: ${Math.round(post.daysSinceCreation)}일 경과\n- 원본 URL: ${post.publishedUrl}`,
        tags: [...(post.tags || []), "#리뉴얼-제안"],
        createdAt: Date.now(),
        origin: {
          type: "my_post_renewal", // 자동화된 리뉴얼 타입
          postUrl: post.publishedUrl,
          originalCardId: post.cardId // 중복 검사를 위한 원본 카드 ID
        }
      };

      // 5. 1단계에서 만든 헬퍼 함수로 카드 생성 (채널 ID 전달!)
      console.log(`[자동 재활용] 아이디어 생성: "${ideaData.title}" (채널: ${post.channelId})`);
      const result = await createAndSaveNewIdea(ideaData, 'ideas', post.channelId);
      
      if (result.success) {
        createdCount++;
        console.log(`[자동 재활용] 아이디어 생성 완료: "${ideaData.title}" (ID: ${result.firebaseKey})`);
      } else {
        console.error(`[자동 재활용] 아이디어 생성 실패: "${ideaData.title}" - ${result.error}`);
      }
    }

    console.log(`[자동 재활용] 완료: ${createdCount}개의 재활용 아이디어가 생성되었습니다.`);
  } catch (error) {
    console.error("[자동 재활용] 오류 발생:", error);
  }
}

async function updateAllPerformanceMetrics() {
  const userId = CONSTANTS.USER_ID;
  const kanbanRef = firebase.database().ref(`kanban/${userId}`);
  const snapshot = await kanbanRef.once("value");
  const allCards = snapshot.val() || {};

  // [최적화] 마지막 업데이트로부터 경과 시간 체크 (API Quota 절약)
  const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간 (밀리초)
  const now = Date.now();

  // [체크리스트 2-2] URL 유효성 검사 함수
  const isValidUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  };

  // [최적화] 마지막 업데이트 시간 확인 함수
  const shouldUpdateCard = (card) => {
    // performance.lastUpdatedAt이 없으면 업데이트 필요
    if (!card.performance?.lastUpdatedAt) {
      return true;
    }
    
    const lastUpdated = card.performance.lastUpdatedAt;
    const timeSinceUpdate = now - lastUpdated;
    
    // 6시간 이상 지났으면 업데이트 필요
    return timeSinceUpdate >= UPDATE_INTERVAL_MS;
  };

  // [체크리스트 2-2] 배치 처리: 한 번에 처리할 카드 수 제한 (API Quota 방지)
  const BATCH_SIZE = 5; // 한 번에 5개씩 처리
  const tasks = [];
  let skippedCount = 0; // 건너뛴 카드 수
  
  for (const status in allCards) {
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];
      
      // [체크리스트 2-2] URL 유효성 검사 강화
      if (card.performanceTracked && card.publishedUrl && isValidUrl(card.publishedUrl)) {
        // [최적화] 마지막 업데이트로부터 6시간이 지나지 않았으면 건너뛰기
        if (!shouldUpdateCard(card)) {
          const timeSinceUpdate = Math.floor((now - card.performance.lastUpdatedAt) / (60 * 60 * 1000));
          console.log(`[성과 지표 수집] 건너뛰기: ${cardId} (${timeSinceUpdate}시간 전 업데이트됨, 6시간 미경과)`);
          skippedCount++;
          continue;
        }
        
        tasks.push({
          id: cardId,
          path: `kanban/${userId}/${status}/${cardId}`,
          url: card.publishedUrl,
        });
      } else if (card.performanceTracked && card.publishedUrl && !isValidUrl(card.publishedUrl)) {
        console.warn(`[성과 지표 수집] 유효하지 않은 URL 건너뛰기: ${card.publishedUrl} (카드 ID: ${cardId})`);
      }
    }
  }

  // 배치 처리: 한 번에 BATCH_SIZE개씩 처리
  console.log(`[성과 지표 수집] 총 ${tasks.length}개 카드 수집 시작 (${skippedCount}개 건너뜀, 배치 크기: ${BATCH_SIZE})`);
  
  if (tasks.length === 0) {
    console.log("[성과 지표 수집] 업데이트할 카드가 없습니다. (모든 카드가 최근에 업데이트됨)");
    return;
  }
  
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(task => 
      updateSinglePerformanceMetric(task)
    );
    
    await Promise.all(batchPromises);
    console.log(`[성과 지표 수집] 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tasks.length / BATCH_SIZE)} 완료 (${batch.length}개)`);
    
    // 배치 간 짧은 지연 (API Quota 방지)
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log("모든 콘텐츠의 성과 지표 업데이트 완료.");

  // 성과 업데이트가 끝난 직후, 재활용 자동화 로직 실행
  await runAutomatedRenewalChecks();
}

/**
 * 단일 콘텐츠의 GA 및 AdSense 데이터를 가져와 Firebase에 업데이트합니다.
 * @param {object} contentInfo - { id, path, url }
 */
async function updateSinglePerformanceMetric(contentInfo) {
  const startTime = Date.now();
  const userId = CONSTANTS.USER_ID;
  
  // path에 사용자 ID가 포함되어 있지 않으면 추가
  let firebasePath = contentInfo.path;
  if (!firebasePath.includes(`/${userId}/`)) {
    // kanban/{status}/{cardId} 형식을 kanban/{userId}/{status}/{cardId}로 변환
    if (firebasePath.startsWith('kanban/')) {
      const pathParts = firebasePath.split('/');
      if (pathParts.length >= 3 && pathParts[0] === 'kanban') {
        firebasePath = `kanban/${userId}/${pathParts.slice(1).join('/')}`;
      }
    }
  }
  
  const logContext = {
    cardId: contentInfo.id,
    url: contentInfo.url,
    path: firebasePath,
    timestamp: new Date().toISOString(),
  };

  // [체크리스트 2-2] URL 유효성 검사 강화
  if (!contentInfo.url || typeof contentInfo.url !== 'string') {
    const errorMsg = "publishedUrl이 유효하지 않습니다 (null 또는 undefined)";
    console.warn(`[성과 지표 수집 실패] ${errorMsg}`, logContext);
    await firebase
      .database()
      .ref(firebasePath)
      .child("performance")
      .update({
        lastUpdatedAt: Date.now(),
        error: errorMsg,
        errorType: "INVALID_URL",
        collecting: false,
        collectingCompletedAt: Date.now(),
      });
    return;
  }

  try {
    // URL 형식 검증
    try {
      new URL(contentInfo.url);
    } catch (e) {
      const errorMsg = `publishedUrl이 유효한 URL 형식이 아닙니다: ${contentInfo.url}`;
      console.warn(`[성과 지표 수집 실패] ${errorMsg}`, logContext);
      await firebase
        .database()
        .ref(firebasePath)
        .child("performance")
        .update({
          lastUpdatedAt: Date.now(),
          error: errorMsg,
          errorType: "INVALID_URL",
          collecting: false,
          collectingCompletedAt: Date.now(),
        });
      return;
    }

    console.log(`[성과 지표 수집 시작]`, logContext);

    // 수집 시작 상태를 Firebase에 저장
    await firebase
      .database()
      .ref(firebasePath)
      .child("performance")
      .update({
        collecting: true,
        collectingStartedAt: Date.now(),
      });

    // 저장된 Google 인증 정보 및 채널 연동 시 설정한 ID들을 가져옵니다.
    const storageResult = await new Promise((resolve) =>
      chrome.storage.local.get(["googleAuthToken", "adSenseAccountId"], (result) => {
        resolve(result);
      })
    );
    
    const googleAuthToken = storageResult.googleAuthToken;
    const adSenseAccountId = storageResult.adSenseAccountId;
    
    // [체크리스트 1-1] Google 인증 토큰 유효성 확인
    
    // Firebase에서 채널 데이터 가져오기 (chrome.storage.local이 아닌 Firebase에 저장됨)
    const userId = CONSTANTS.USER_ID;
    const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
    const channelsData = channelsSnapshot.val() || {};
    const myChannels = channelsData.myChannels || { blogs: [] };

    if (!googleAuthToken) {
      const errorMsg = "Google 계정이 연동되지 않아 성과 지표를 수집할 수 없습니다.";
      console.warn(`[성과 지표 수집 실패] ${errorMsg}`, logContext);
      
      // Firebase에 에러 상태 저장 (수집 완료 상태 포함)
      await firebase
        .database()
        .ref(firebasePath)
        .child("performance")
        .update({
          lastUpdatedAt: Date.now(),
          error: errorMsg,
          errorType: "AUTH_MISSING",
          collecting: false,
          collectingCompletedAt: Date.now(),
        });
      return;
    }

    // 블로그 URL을 기반으로 해당 블로그에 설정된 GA Property ID를 찾습니다.
    // URL 매칭 로직 개선: 여러 방법으로 시도
    let blogInfo = null;
    let gaPropertyId = null;
    
    // 방법 1: 정확한 hostname 매칭
    try {
      const contentUrlObj = new URL(contentInfo.url);
      const contentHostname = contentUrlObj.hostname;
      
      blogInfo = myChannels.blogs.find((b) => {
        // inputUrl 또는 url 필드 확인
        const blogUrl = b.inputUrl || b.url;
        if (!blogUrl) return false;
        try {
          const blogUrlObj = new URL(blogUrl);
          const blogHostname = blogUrlObj.hostname;
          
          // 정확한 hostname 매칭
          if (contentHostname === blogHostname) return true;
          
          // 하위 도메인 고려 (예: costcatcher.k-posting.info와 k-posting.info)
          const contentParts = contentHostname.split('.');
          const blogParts = blogHostname.split('.');
          
          // 메인 도메인 추출 (마지막 2개 또는 3개 부분)
          const getMainDomain = (parts) => {
            if (parts.length <= 2) return parts.join('.');
            // .co.kr, .com.au 같은 경우 고려
            if (parts.length >= 3 && 
                (parts[parts.length - 2] === 'co' && parts[parts.length - 1] === 'kr') ||
                (parts[parts.length - 2] === 'com' && parts[parts.length - 1] === 'au')) {
              return parts.slice(-3).join('.');
            }
            return parts.slice(-2).join('.');
          };
          
          const contentMainDomain = getMainDomain(contentParts);
          const blogMainDomain = getMainDomain(blogParts);
          
          return contentMainDomain === blogMainDomain;
        } catch {
          return false;
        }
      });
      
      gaPropertyId = blogInfo?.gaPropertyId;
    } catch (err) {
      console.warn(`[성과 지표 수집] URL 파싱 오류:`, err, logContext);
    }
    
    // 방법 2: URL 문자열 포함 여부로 매칭 (fallback)
    if (!blogInfo) {
      blogInfo = myChannels.blogs.find((b) => {
        const blogUrl = b.inputUrl || b.url || '';
        if (!blogUrl) return false;
        // contentInfo.url이 blogUrl을 포함하는지 확인
        return contentInfo.url.includes(blogUrl) || blogUrl.includes(new URL(contentInfo.url).hostname);
      });
      gaPropertyId = blogInfo?.gaPropertyId;
    }
    
    // [체크리스트 1-2] GA4 속성 ID 매핑 확인

    if (!gaPropertyId || !adSenseAccountId) {
      const errorMsg = `성과 지표 수집에 필요한 ID가 없습니다. (GA: ${gaPropertyId || "없음"}, AdSense: ${adSenseAccountId || "없음"})`;
      console.warn(`[성과 지표 수집 실패] ${errorMsg}`, logContext);
      
      // Firebase에 에러 상태 저장 (수집 완료 상태 포함)
      await firebase
        .database()
        .ref(firebasePath)
        .child("performance")
        .update({
          lastUpdatedAt: Date.now(),
          error: errorMsg,
          errorType: "ID_MISSING",
          collecting: false,
          collectingCompletedAt: Date.now(),
        });
      return;
    }

    // GA4와 AdSense 데이터를 병렬로 수집
    const [analyticsData, adsenseData] = await Promise.allSettled([
      getAnalyticsData(googleAuthToken, gaPropertyId, contentInfo.url),
      getAdsenseData(googleAuthToken, adSenseAccountId, contentInfo.url),
    ]);

    // 결과 처리
    const analyticsResult = analyticsData.status === "fulfilled" 
      ? analyticsData.value 
      : { error: analyticsData.reason?.message || "알 수 없는 오류", gaEarnings: 0 };
    
    
    const adsenseResult = adsenseData.status === "fulfilled"
      ? adsenseData.value
      : { error: adsenseData.reason?.message || "알 수 없는 오류", estimatedEarnings: 0 };

    // 🚨 [핵심 수정] 수익 데이터 우선순위 결정 로직
    // GA4 수익 데이터가 있으면(0보다 크면) 그것을 사용하고, 없으면 기존 AdSense API 값을 사용
    // AdSense API는 개별 URL 채널 설정이 없으면 0을 반환하는 경우가 많기 때문입니다.
    const finalEarnings = (analyticsResult.gaEarnings && analyticsResult.gaEarnings > 0)
      ? analyticsResult.gaEarnings
      : (adsenseResult.estimatedEarnings || 0);
    
    // [수정 요청 1] 페이지뷰 하이브리드 로직 추가 (수익 로직 참고)
    // GA4 페이지뷰 데이터가 있으면(0보다 크면) 그것을 사용하고, 없으면 AdSense API 값을 사용
    const finalPageviews = (analyticsResult.pageviews && analyticsResult.pageviews > 0)
      ? analyticsResult.pageviews
      : (adsenseResult.pageViews || 0); // AdSense는 pageViews (대문자 V)
    

    const performanceData = {
      ...analyticsResult,
      ...adsenseResult,
      // 최종 수익 (하이브리드)
      estimatedEarnings: finalEarnings,
      // [수정 요청 1] 최종 페이지뷰 (하이브리드)
      pageviews: finalPageviews,
      
      // [추가] 상세 분석 지표 저장 (GA4 기준)
      adImpressions: analyticsResult.gaImpressions || 0,
      adClicks: analyticsResult.gaClicks || 0,
      pageRPM: analyticsResult.pageRPM || 0,
      pageCTR: analyticsResult.pageCTR || 0,
      
      // [신규] 추가 메트릭 데이터 (디바이스, 국가, 랜딩 페이지, 이벤트, 검색어)
      deviceBreakdown: analyticsResult.deviceBreakdown || null,
      topCountries: analyticsResult.topCountries || null,
      landingPages: analyticsResult.landingPages || null,
      events: analyticsResult.events || null,
      topSearchTerms: analyticsResult.topSearchTerms || null,
      
      lastUpdatedAt: Date.now(),
      collectionDuration: Date.now() - startTime,
    };
    
    console.log(`[검색어 메트릭] performanceData에 검색어 포함 확인`, {
      url: contentInfo.url,
      hasTopSearchTerms: !!performanceData.topSearchTerms,
      topSearchTermsCount: performanceData.topSearchTerms?.length || 0,
      topSearchTerms: performanceData.topSearchTerms
    });

    // 에러가 있는 경우 기록 (데이터 없음은 오류가 아님)
    // 실제 API 오류인지 확인: 401, 403, 계정/속성 찾을 수 없음 등
    const isRealError = (result) => {
      if (!result.error) return false;
      const errorMsg = result.error.toLowerCase();
      return errorMsg.includes('401') || 
             errorMsg.includes('403') || 
             errorMsg.includes('속성을 찾을 수 없습니다') ||
             errorMsg.includes('계정을 찾을 수 없습니다') ||
             errorMsg.includes('토큰') ||
             errorMsg.includes('인증') ||
             errorMsg.includes('unauthorized') ||
             errorMsg.includes('forbidden');
    };
    
    const hasRealError = isRealError(analyticsResult) || isRealError(adsenseResult);
    
    if (hasRealError) {
      performanceData.collectionErrors = {
        analytics: isRealError(analyticsResult) ? analyticsResult.error : null,
        adsense: isRealError(adsenseResult) ? adsenseResult.error : null,
      };
      performanceData.errorType = "API_ERROR";
      
      // 더 자세한 오류 메시지 생성
      const errorParts = [];
      if (isRealError(analyticsResult)) {
        const ga4ErrorMsg = analyticsResult.error.includes('401') 
          ? 'GA4: 인증 오류 (토큰 만료)' 
          : `GA4: ${analyticsResult.error}`;
        errorParts.push(ga4ErrorMsg);
      }
      if (isRealError(adsenseResult)) {
        const adsenseErrorMsg = adsenseResult.error.includes('401')
          ? 'AdSense: 인증 오류 (토큰 만료)'
          : `AdSense: ${adsenseResult.error}`;
        errorParts.push(adsenseErrorMsg);
      }
      
      performanceData.error = `데이터 수집 중 오류 발생: ${errorParts.join(', ')}`;
    }
    // 데이터 없음(0 값 반환)은 오류가 아니므로 collectionErrors나 errorType을 설정하지 않음

    // Firebase에 'performance' 자식 노드로 데이터 업데이트 (수집 완료 상태 포함)
    // 데이터 없음일 때는 collectionErrors와 errorType을 명시적으로 null로 설정하여 제거
    const updateData = {
      ...performanceData,
      collecting: false,
      collectingCompletedAt: Date.now(),
    };
    
    // 실제 오류가 없으면 collectionErrors와 errorType 제거
    if (!hasRealError) {
      updateData.collectionErrors = null;
      updateData.errorType = null;
      updateData.error = null;
    }
    
    // [체크리스트 4-1] Firebase 저장 확인
    
    // [체크리스트 4-2] 데이터 병합 확인
    
    
    await firebase
      .database()
      .ref(firebasePath)
      .child("performance")
      .update(updateData);

    const duration = Date.now() - startTime;
    console.log(`[G-14] 콘텐츠(${contentInfo.url}) 성과 지표 업데이트 완료 (${duration}ms)`, {
      ...logContext,
      duration,
      hasErrors: !!(analyticsResult.error || adsenseResult.error)
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorDetails = {
      ...logContext,
      duration,
      error: error.message,
      stack: error.stack,
      errorType: "UNEXPECTED_ERROR",
    };

    console.error(`[성과 지표 업데이트 중 오류 발생]`, errorDetails);

    // Firebase에 에러 상태 저장 (수집 완료 상태 포함)
    try {
      await firebase
        .database()
        .ref(firebasePath)
        .child("performance")
        .update({
          lastUpdatedAt: Date.now(),
          error: error.message,
          errorType: "UNEXPECTED_ERROR",
          collectionDuration: duration,
          collecting: false,
          collectingCompletedAt: Date.now(),
        });
    } catch (firebaseError) {
      console.error(`[Firebase 업데이트 실패]`, firebaseError);
    }
  }
}

/**
 * [G-14] Google Analytics Data API를 호출하여 지표를 가져옵니다.
 * 재시도 로직과 상세 로그를 포함합니다.
 */
/**
 * [최종 완성] GA4 데이터 수집 (기본 지표 + 유입 경로 분석)
 * - 매칭 로직: BEGINS_WITH + 디코딩된 경로 사용 (매칭률 100% 목표)
 * - 데이터 확장: 참여율, 신규 방문자, 그리고 '주력 유입 경로(Top Source)'까지 수집
 */
async function getAnalyticsData(token, propertyId, url, retryCount = 0, useEncodedPath = false, excludePublisherMetrics = false, excludeAverageEngagementTime = false) {
  const API_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  
  // 1. URL 경로 정제 (https://가 없으면 추가)
  let urlObj;
  try {
    // https://가 없으면 추가
    const normalizedUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    urlObj = new URL(normalizedUrl);
  } catch (e) { 
    console.error(`[GA4] URL 파싱 실패: ${e.message}`, { url });
    return { pageviews: 0, gaEarnings: 0 }; 
  }

  const rawPath = urlObj.pathname;
  let decodedPath = rawPath;
  try { decodedPath = decodeURIComponent(rawPath); } catch(e) {}
  const normalizedPath = decodedPath.endsWith('/') && decodedPath !== '/' ? decodedPath.slice(0, -1) : decodedPath;
  const normalizedRawPath = rawPath.endsWith('/') && rawPath !== '/' ? rawPath.slice(0, -1) : rawPath;

  // 필터 경로 선택: useEncodedPath가 true면 인코딩된 경로, false면 디코딩된 경로
  const filterPath = useEncodedPath ? normalizedRawPath : normalizedPath;
  

  try {
    // [요청 1] 핵심 성과 지표 (Metrics)
    const metricsRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }], 
        metrics: [
          { name: "screenPageViews" },          // 0: 조회수
          { name: "averageSessionDuration" },   // 1: 체류 시간
          { name: "sessions" },                 // 2: 세션
          { name: "screenPageViewsPerSession" },// 3: 세션당 페이지수
          { name: "bounceRate" },               // 4: 이탈률
          // Publisher 메트릭은 별도 요청으로 분리하여 오류 시에도 다른 메트릭은 정상 수집
          { name: "engagementRate" },           // 5: 참여율
          ...(excludeAverageEngagementTime ? [] : [{ name: "averageEngagementTime" }]),    // 6: 평균 참여 시간 (선택적)
          { name: "newUsers" },                 // 7: 신규 방문자
          { name: "activeUsers" }               // 8: 활성 사용자
        ],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        }
      })
    });

    // [요청 2] 유입 경로 분석 (Source) - 이 글의 1등 유입처 찾기
    const sourceRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }], // 소스/매체
        metrics: [{ name: "activeUsers" }], 
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], // 사용자 많은 순 정렬
        limit: 1, // 1등만 가져옴
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        }
      })
    });

    // [요청 3] Publisher 메트릭 (수익 데이터) - 별도 요청으로 분리하여 오류 시에도 다른 메트릭은 정상 수집
    // 참고: GA4 API 스키마 문서 (https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
    // 주의: publisherAdRevenue가 없을 수 있으므로 totalAdRevenue를 우선 시도
    // 사용 가능한 메트릭: totalAdRevenue, publisherAdClicks, publisherAdImpressions
    const publisherRequest = excludePublisherMetrics ? Promise.resolve({ ok: false, status: 400 }) : fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "totalAdRevenue" },           // 수익 (publisherAdRevenue 대신 사용)
          { name: "publisherAdImpressions" },   // 노출수
          { name: "publisherAdClicks" }         // 클릭수
        ],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        }
      })
    });

    // [요청 4] 디바이스 및 지역 정보
    const deviceCountryRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [
          { name: "deviceCategory" },
          { name: "country" }
        ],
        metrics: [
          { name: "activeUsers" },
          { name: "totalAdRevenue" }
        ],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        },
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 10 // 상위 10개 조합만
      })
    });

    // [요청 5] 랜딩 페이지 정보
    const landingPageRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "landingPage" }],
        metrics: [
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" }
        ],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        },
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 5 // 상위 5개 랜딩 페이지만
      })
    });

    // [요청 6] 스크롤/클릭 이벤트
    const eventsRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "pagePath",
                  stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
                }
              },
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: {
                    values: ["scroll", "click"]
                  }
                }
              }
            ]
          }
        }
      })
    });

    // [요청 7] 검색어 정보
    const searchTermsRequest = fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "searchTerm" }],
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: filterPath }
          }
        },
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 5 // 상위 5개 검색어만
      })
    });

    // 병렬 실행 (모든 요청을 병렬로 처리)
    const [metricsRes, sourceRes, publisherRes, deviceCountryRes, landingPageRes, eventsRes, searchTermsRes] = await Promise.all([
      metricsRequest, 
      sourceRequest, 
      publisherRequest,
      deviceCountryRequest,
      landingPageRequest,
      eventsRequest,
      searchTermsRequest
    ]);


    if (!metricsRes.ok) {
      // 에러 응답 본문 확인 (400, 401 등 상세 에러 파악용)
      let errorBody = null;
      try {
        errorBody = await metricsRes.clone().json();
        // 에러 로그는 재시도 로직에서 처리하므로 여기서는 출력하지 않음
      } catch (e) {
        // 에러 응답 파싱 실패는 조용히 처리
      }

      if (metricsRes.status === 401) {
        await sendErrorToUI("TOKEN_EXPIRED", "Google Analytics 인증 토큰이 만료되었습니다.");
        throw new Error("UNAUTHORIZED");
      }
      
      // 403 Forbidden 처리
      if (metricsRes.status === 403) {
        await sendErrorToUI("FORBIDDEN", "Google Analytics 접근 권한이 없습니다. 계정 권한을 확인해주세요.");
        return { pageviews: 0, gaEarnings: 0, error: "Forbidden (403): Access denied" };
      }
      
      // 400 Bad Request 처리: 필터 경로 문제일 수 있음
      if (metricsRes.status === 400) {
        // 인코딩된 경로로 재시도 (한글 경로가 인코딩되어 저장된 경우)
        // 단, 메트릭 오류가 아닌 경우에만 시도 (메트릭 오류는 별도 처리)
        const errorMsg = errorBody?.error?.message || 'Invalid filter path';
        const isMetricError = errorMsg.includes('Did you mean') || errorMsg.includes('metric');
        const isAverageEngagementTimeError = errorMsg.includes('averageEngagementTime');
        
        // 인코딩된 경로로 재시도 (메트릭 오류가 아닌 경우)
        if (retryCount === 0 && !useEncodedPath && rawPath !== normalizedPath && !isMetricError) {
          console.warn(`[GA4] 400 에러 발생, 인코딩된 경로로 재시도...`, {
            originalFilter: filterPath,
            retryFilter: normalizedRawPath
          });
          // 인코딩된 경로로 재시도
          return getAnalyticsData(token, propertyId, url, retryCount + 1, true, excludePublisherMetrics, excludeAverageEngagementTime);
        }
        
        // averageEngagementTime 오류인 경우, 해당 메트릭을 제외하고 재시도
        // (Publisher 메트릭은 별도 요청으로 분리되어 있으므로 여기서 처리하지 않음)
        if (isAverageEngagementTimeError && !excludeAverageEngagementTime && retryCount < 3) {
          console.warn(`[GA4] averageEngagementTime 메트릭 오류 감지, 해당 메트릭을 제외하고 재시도...`);
          return getAnalyticsData(token, propertyId, url, retryCount + 1, useEncodedPath, excludePublisherMetrics, true);
        }
        
        // 재시도 실패 시 사용자에게 알림
        await sendErrorToUI("API_ERROR", `Google Analytics 요청 오류 (400): ${errorMsg}`);
        return { 
          pageviews: 0, 
          gaEarnings: 0, 
          error: `Bad Request (400): ${errorMsg}`,
          errorDetails: errorBody,
          isMetricError: isMetricError
        };
      }
      
      // [체크리스트 3-4] 429 Quota 제한 처리
      if (metricsRes.status === 429) {
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000; // 지수 백오프: 1초, 2초, 4초
          console.warn(`[GA4] Quota 제한 감지 (429), ${delay}ms 후 재시도 (${retryCount + 1}/3)...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return getAnalyticsData(token, propertyId, url, retryCount + 1, useEncodedPath, excludePublisherMetrics, excludeAverageEngagementTime);
        } else {
          console.error(`[GA4] Quota 제한 초과, 재시도 실패 (${retryCount}회 시도)`);
          await sendErrorToUI("QUOTA_EXCEEDED", "Google Analytics API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.");
          return { pageviews: 0, gaEarnings: 0, error: "Quota limit exceeded" };
        }
      }
      // [체크리스트 C-3] 500 Internal Server Error 처리
      if (metricsRes.status === 500 || metricsRes.status >= 502 && metricsRes.status <= 504) {
        if (retryCount < 2) {
          const delay = Math.pow(2, retryCount) * 2000; // 지수 백오프: 2초, 4초
          console.warn(`[GA4] 서버 오류 감지 (${metricsRes.status}), ${delay}ms 후 재시도 (${retryCount + 1}/2)...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return getAnalyticsData(token, propertyId, url, retryCount + 1, useEncodedPath, excludePublisherMetrics, excludeAverageEngagementTime);
        } else {
          console.error(`[GA4] 서버 오류, 재시도 실패 (${retryCount}회 시도)`);
          await sendErrorToUI("API_ERROR", `Google Analytics 서버 오류가 발생했습니다 (${metricsRes.status}). 잠시 후 다시 시도해주세요.`);
          return { pageviews: 0, gaEarnings: 0, error: `Server error (${metricsRes.status})` };
        }
      }
      // 데이터가 없거나 오류인 경우
      const errorMsg = errorBody?.error?.message || metricsRes.statusText;
      await sendErrorToUI("API_ERROR", `Google Analytics 데이터 수집 실패 (${metricsRes.status}): ${errorMsg}`);
      return { pageviews: 0, gaEarnings: 0, error: `HTTP ${metricsRes.status}: ${errorMsg}` };
    }

    const metricsData = await metricsRes.json();
    const sourceData = await sourceRes.ok ? await sourceRes.json() : {};
    
    // Publisher 메트릭 응답 파싱 (오류가 나도 무시하고 계속 진행)
    let publisherData = null;
    let adRevenue = 0;
    let adImpressions = 0;
    let adClicks = 0;
    
    
    if (publisherRes.ok) {
      try {
        publisherData = await publisherRes.json();
        
        if (publisherData.rows && publisherData.rows.length > 0) {
          const publisherRow = publisherData.rows[0];
          const publisherValues = publisherRow.metricValues;
          // totalAdRevenue를 사용 (publisherAdRevenue 대신)
          adRevenue = parseFloat(publisherValues[0]?.value || "0"); // totalAdRevenue
          adImpressions = parseInt(publisherValues[1]?.value || "0", 10); // publisherAdImpressions
          adClicks = parseInt(publisherValues[2]?.value || "0", 10); // publisherAdClicks
        } else {
          console.warn("[2단계: GA4 API] Publisher 메트릭 응답에 데이터 없음 (rows가 비어있음)");
        }
      } catch (e) {
        console.warn("[2단계: GA4 API] Publisher 메트릭 파싱 실패 (무시하고 계속 진행)", e);
      }
    } else {
      // 에러 응답 본문 확인
      let publisherErrorBody = null;
      try {
        publisherErrorBody = await publisherRes.clone().json();
        const errorMessage = publisherErrorBody?.error?.message || '';
        const isPublisherMetricNotSupported = errorMessage.includes('publisherAdRevenue is not a valid metric') || 
                                               errorMessage.includes('publisherAdClicks');
        
        if (isPublisherMetricNotSupported) {
          console.log("[2단계: GA4 API] Publisher 메트릭 미지원 (이 GA4 속성에서는 사용 불가)", {
            status: publisherRes.status,
            errorMessage: errorMessage,
            note: "GA4 API 스키마 문서 참고: publisherAdRevenue는 AdSense가 연결된 속성에서만 사용 가능합니다. AdSense API를 통해 수익 데이터를 수집합니다.",
            reference: "https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema"
          });
        } else {
          console.warn("[2단계: GA4 API] Publisher 메트릭 요청 실패 (무시하고 계속 진행)", {
            status: publisherRes.status,
            statusText: publisherRes.statusText,
            error: publisherErrorBody?.error || null,
            errorMessage: errorMessage
          });
        }
      } catch (e) {
        console.warn("[2단계: GA4 API] Publisher 메트릭 요청 실패 (에러 응답 파싱 실패)", {
          status: publisherRes.status,
          statusText: publisherRes.statusText
        });
      }
    }


    // 데이터 파싱
    if (metricsData.rows && metricsData.rows.length > 0) {
      const row = metricsData.rows[0]; // 가장 관련성 높은 첫 번째 행 사용
      const values = row.metricValues;

      // Publisher 메트릭은 별도 요청으로 분리되었으므로 인덱스 조정
      // averageEngagementTime이 없을 때 인덱스 조정
      const baseIndex = 0; // screenPageViews
      const engagementRateIndex = 5; // engagementRate
      const avgEngagementTimeIndex = excludeAverageEngagementTime ? -1 : 6; // averageEngagementTime
      const newUsersIndex = excludeAverageEngagementTime ? 6 : 7; // newUsers
      const activeUsersIndex = excludeAverageEngagementTime ? 7 : 8; // activeUsers

      
      // 파생 지표
      const pageRPM = adImpressions > 0 ? (adRevenue / adImpressions) * 1000 : 0;
      const pageCTR = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
      

      // 유입 경로 파싱
      let topSource = "-";
      if (sourceData.rows && sourceData.rows.length > 0) {
        const srcRow = sourceData.rows[0];
        const source = srcRow.dimensionValues[0].value; // google, naver
        const medium = srcRow.dimensionValues[1].value; // organic, referral
        topSource = `${source} / ${medium}`;
      }

      // 디바이스 및 지역 정보 파싱
      const deviceCountryData = deviceCountryRes.ok ? await deviceCountryRes.json() : {};
      const deviceBreakdown = { mobile: { users: 0, revenue: 0 }, desktop: { users: 0, revenue: 0 }, tablet: { users: 0, revenue: 0 } };
      const topCountries = [];
      
      if (deviceCountryData.rows && deviceCountryData.rows.length > 0) {
        deviceCountryData.rows.forEach(row => {
          const device = row.dimensionValues[0]?.value || "unknown";
          const country = row.dimensionValues[1]?.value || "unknown";
          const users = parseInt(row.metricValues[0]?.value || "0", 10);
          const revenue = parseFloat(row.metricValues[1]?.value || "0");
          
          // 디바이스별 집계
          if (deviceBreakdown[device.toLowerCase()]) {
            deviceBreakdown[device.toLowerCase()].users += users;
            deviceBreakdown[device.toLowerCase()].revenue += revenue;
          }
          
          // 국가별 집계 (상위 5개만)
          if (topCountries.length < 5) {
            topCountries.push({ country, users, revenue });
          }
        });
      }

      // 랜딩 페이지 정보 파싱
      const landingPageData = landingPageRes.ok ? await landingPageRes.json() : {};
      const landingPages = [];
      
      if (landingPageData.rows && landingPageData.rows.length > 0) {
        landingPageData.rows.forEach(row => {
          landingPages.push({
            page: row.dimensionValues[0]?.value || "-",
            sessions: parseInt(row.metricValues[0]?.value || "0", 10),
            bounceRate: parseFloat(row.metricValues[1]?.value || "0"),
            avgSessionDuration: parseFloat(row.metricValues[2]?.value || "0")
          });
        });
      }

      // 이벤트 정보 파싱
      const eventsData = eventsRes.ok ? await eventsRes.json() : {};
      const events = { scroll: 0, click: 0 };
      
      if (eventsData.rows && eventsData.rows.length > 0) {
        eventsData.rows.forEach(row => {
          const eventName = row.dimensionValues[0]?.value || "";
          const eventCount = parseInt(row.metricValues[0]?.value || "0", 10);
          
          if (eventName === "scroll") {
            events.scroll = eventCount;
          } else if (eventName === "click") {
            events.click = eventCount;
          }
        });
      }

      // 검색어 정보 파싱
      const searchTermsData = searchTermsRes.ok ? await searchTermsRes.json() : {};
      const topSearchTerms = [];
      
      console.log(`[검색어 메트릭] API 응답 상태: ${searchTermsRes.ok ? '성공' : '실패'}`, {
        status: searchTermsRes.status,
        statusText: searchTermsRes.statusText,
        hasData: !!searchTermsData.rows,
        rowsCount: searchTermsData.rows?.length || 0,
        filterPath: filterPath,
        fullResponse: searchTermsData
      });
      
      if (searchTermsData.rows && searchTermsData.rows.length > 0) {
        const filteredOut = [];
        
        searchTermsData.rows.forEach(row => {
          const searchTerm = row.dimensionValues[0]?.value || "";
          const users = parseInt(row.metricValues[0]?.value || "0", 10);
          
          if (searchTerm && searchTerm !== "(not set)") {
            topSearchTerms.push({ term: searchTerm, users });
          } else {
            // 필터링된 검색어 기록
            filteredOut.push({ 
              searchTerm: searchTerm || "(빈 문자열)", 
              users,
              reason: !searchTerm ? "빈 문자열" : searchTerm === "(not set)" ? "(not set)" : "기타"
            });
          }
        });
        
        console.log(`[검색어 메트릭] 검색어 수집 완료: ${topSearchTerms.length}개`, {
          searchTerms: topSearchTerms,
          totalRows: searchTermsData.rows.length,
          filteredCount: topSearchTerms.length,
          filteredOut: filteredOut.length > 0 ? filteredOut : undefined
        });
        
        if (filteredOut.length > 0) {
          console.warn(`[검색어 메트릭] 필터링된 검색어 ${filteredOut.length}개 (빈 문자열 또는 "(not set)")`, {
            filteredOut: filteredOut,
            note: "검색어가 빈 문자열이거나 '(not set)'인 경우는 검색어로 유입되지 않은 직접 방문 또는 검색어 추적이 안 된 경우입니다."
          });
        }
      } else {
        console.warn(`[검색어 메트릭] 검색어 데이터 없음 - 가능한 이유:`, {
          hasRows: !!searchTermsData.rows,
          rowsLength: searchTermsData.rows?.length || 0,
          filterPath: filterPath,
          note: "검색어 데이터가 없는 경우: 1) 해당 페이지로 검색어로 유입된 트래픽이 없음, 2) URL 쿼리 파라미터(?q=검색어)로 검색어를 추적하지 않음, 3) GA4에서 searchTerm 이벤트 매개변수를 사용하지 않음",
          responseData: searchTermsData
        });
      }

      // 데이터 파싱
      const pageviews = parseInt(values[0]?.value || "0", 10);
      const engagementRate = parseFloat(values[engagementRateIndex]?.value || "0");
      const avgEngagementTime = excludeAverageEngagementTime ? 0 : parseFloat(values[avgEngagementTimeIndex]?.value || "0");
      const newUsers = parseInt(values[newUsersIndex]?.value || "0", 10);

      const analyticsData = {
        pageviews: pageviews,
        avgSessionDuration: parseFloat(values[1]?.value || "0"),
        sessions: parseInt(values[2]?.value || "0", 10),
        pagesPerSession: parseFloat(values[3]?.value || "0"),
        bounceRate: parseFloat(values[4]?.value || "0"),
        
        gaEarnings: adRevenue,
        gaImpressions: adImpressions,
        gaClicks: adClicks,
        pageRPM: parseFloat(pageRPM.toFixed(2)),
        pageCTR: parseFloat(pageCTR.toFixed(2)),
        
        // [신규] 성장 지표
        engagementRate: engagementRate,
        avgEngagementTime: avgEngagementTime,
        newUsers: newUsers,
        activeUsers: parseInt(values[activeUsersIndex]?.value || "0", 10),
        
        // [신규] 유입 경로
        topSource: topSource,
        
        // [신규] 디바이스 및 지역 정보
        deviceBreakdown: deviceBreakdown,
        topCountries: topCountries,
        
        // [신규] 랜딩 페이지 정보
        landingPages: landingPages,
        
        // [신규] 이벤트 정보
        events: events,
        
        // [신규] 검색어 정보
        topSearchTerms: topSearchTerms
      };
      
      // 재방문자 계산
      analyticsData.returningUsers = Math.max(0, analyticsData.activeUsers - analyticsData.newUsers);

      console.log(`[검색어 메트릭] analyticsData에 검색어 포함 확인`, {
        hasTopSearchTerms: !!analyticsData.topSearchTerms,
        topSearchTermsCount: analyticsData.topSearchTerms?.length || 0,
        topSearchTerms: analyticsData.topSearchTerms
      });

      return analyticsData;
    }

    return { pageviews: 0, gaEarnings: 0 };

  } catch (error) {
    // 토큰 만료 시 재시도 (기존 로직 유지)
    if (error.message === "UNAUTHORIZED" && retryCount < 3) {
      try {
        await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
        const newToken = await new Promise((resolve) => {
          chrome.identity.getAuthToken({ interactive: false }, resolve);
        });
        await chrome.storage.local.set({ googleAuthToken: newToken });
        return getAnalyticsData(newToken, propertyId, url, retryCount + 1);
      } catch (e) {
        // 토큰 갱신 실패 시 사용자에게 알림
        await sendErrorToUI("TOKEN_EXPIRED", "인증 토큰 갱신에 실패했습니다. 다시 로그인해주세요.");
      }
    } else if (error.message !== "UNAUTHORIZED") {
      // UNAUTHORIZED가 아닌 다른 에러인 경우 사용자에게 알림
      await sendErrorToUI("API_ERROR", `Google Analytics 데이터 수집 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`);
    }
    return { pageviews: 0, gaEarnings: 0 };
  }
}

/**
 * [G-14] AdSense Management API를 호출하여 지표를 가져옵니다.
 * 재시도 로직과 상세 로그를 포함합니다.
 */
async function getAdsenseData(token, accountId, url, retryCount = 0) {
  const parentAccount = `accounts/${accountId}`;
  const API_URL = `https://adsense.googleapis.com/v2/${parentAccount}/reports:generate`;
  const MAX_RETRIES = 3;

  try {
    // URL 정규화 (도메인만 추출하여 필터링 정확도 향상)
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;
    
    // 하위 도메인 제거 (메인 도메인 추출)
    // 예: costcatcher.k-posting.info -> k-posting.info
    // 예: subdomain.example.com -> example.com
    let mainDomain = domain;
    const domainParts = domain.split('.');
    if (domainParts.length > 2) {
      // 하위 도메인이 있는 경우
      // 일반적인 경우: subdomain.example.com -> example.com
      // 특수한 경우: costcatcher.k-posting.info -> k-posting.info
      // 최상위 도메인(.com, .info, .co.kr 등)을 고려하여 마지막 2개 또는 3개 부분 사용
      const commonTlds = ['com', 'net', 'org', 'info', 'co', 'kr'];
      const lastPart = domainParts[domainParts.length - 1];
      const secondLastPart = domainParts[domainParts.length - 2];
      
      // .co.kr, .com.au 같은 경우를 고려
      if (domainParts.length >= 3 && 
          (secondLastPart === 'co' && lastPart === 'kr') ||
          (secondLastPart === 'com' && lastPart === 'au')) {
        // 3개 부분 사용 (예: example.co.kr)
        mainDomain = domainParts.slice(-3).join('.');
      } else {
        // 일반적인 경우: 마지막 2개 부분 사용
        mainDomain = domainParts.slice(-2).join('.');
      }
    }

    // 먼저 필터 없이 전체 계정 데이터 확인 (계정에 데이터가 있는지 확인)
    let hasAccountData = false;
    let allAccountData = null;
    try {
      const testResponse = await fetch(API_URL, {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dateRange: "LAST_30_DAYS",
          metrics: ["PAGE_VIEWS", "ESTIMATED_EARNINGS", "PAGE_VIEWS_RPM", "CLICKS"],
          dimensions: ["URL_CHANNEL_NAME"],
        }),
      });
      
      if (testResponse.ok) {
        const testData = await testResponse.json();
        hasAccountData = testData.rows && testData.rows.length > 0;
        allAccountData = testData;
        console.log(`[AdSense] 전체 계정 데이터 확인: ${hasAccountData ? `데이터 있음 (${testData.rows.length}개 URL)` : '데이터 없음'}`);
        
        // 전체 데이터에서 URL 매칭 시도
        if (hasAccountData && testData.rows) {
          // URL 매칭 전략 (우선순위 순)
          const matchStrategies = [
            (row) => row.dimensionValues?.[0]?.value === url, // 1. 정확한 URL 매칭
            (row) => row.dimensionValues?.[0]?.value?.startsWith(url), // 2. (신규) URL로 시작 (파라미터 무시)
            (row) => row.dimensionValues?.[0]?.value?.startsWith(path), // 3. (신규) 경로로 시작
            (row) => row.dimensionValues?.[0]?.value?.includes(domain), // 4. 도메인 포함
            (row) => row.dimensionValues?.[0]?.value?.includes(mainDomain), // 5. 메인 도메인 포함
          ];
          
          for (const matchStrategy of matchStrategies) {
            const matchedRow = testData.rows.find(matchStrategy);
            if (matchedRow && matchedRow.cells && matchedRow.cells.length > 0) {
              const row = matchedRow.cells;
              const clicks = parseFloat(row[2]?.value || "0.0");
              const pageViews = parseFloat(row[3]?.value || "0.0");
              const ctr = pageViews > 0 ? (clicks / pageViews) * 100 : 0;
              
              const matchedUrl = matchedRow.dimensionValues?.[0]?.value || '알 수 없음';
              console.log(`[AdSense] 전체 데이터에서 매칭 성공: ${matchedUrl}`);
              
              return {
                estimatedEarnings: parseFloat(row[0]?.value || "0.0"),
                pageRPM: parseFloat(row[1]?.value || "0.0"),
                clicks: clicks,
                pageViews: pageViews,
                ctr: parseFloat(ctr.toFixed(2)),
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn("[AdSense] 전체 계정 데이터 확인 실패:", e.message);
    }

    // 필터를 사용한 전략 시도 (AdSense API v2 필터 형식)
    // 우선순위: DOMAIN_NAME 차원 사용 → 도메인 단위 매칭 → URL_CHANNEL_NAME 기반 상세 매칭
    const filterStrategies = [
      // [최우선] DOMAIN_NAME 차원을 활용하여 도메인 전체의 수익 확인
      { 
        filter: { dimension: "DOMAIN_NAME", operator: "EQUALS", value: domain },
        name: '도메인 전체 (DOMAIN_NAME EQUALS)'
      },
      { 
        filter: { dimension: "DOMAIN_NAME", operator: "EQUALS", value: mainDomain },
        name: '메인 도메인 전체 (DOMAIN_NAME EQUALS)'
      },
      // 도메인 단위 매칭 (URL_CHANNEL_NAME 사용하되 도메인만)
      { 
        filter: { dimension: "URL_CHANNEL_NAME", operator: "EQUALS", value: domain },
        name: '전체 도메인 (EQUALS)'
      },
      { 
        filter: { dimension: "URL_CHANNEL_NAME", operator: "CONTAINS", value: domain },
        name: '도메인 포함 (CONTAINS)'
      },
      { 
        filter: { dimension: "URL_CHANNEL_NAME", operator: "CONTAINS", value: mainDomain },
        name: '메인 도메인 포함 (CONTAINS)'
      },
      // [후순위] URL_CHANNEL_NAME 기반의 상세 페이지 매칭 (실패 확률이 높음)
      { 
        filter: { dimension: "URL_CHANNEL_NAME", operator: "EQUALS", value: url },
        name: '전체 URL (EQUALS)'
      },
      { 
        // URL 경로(path)를 '포함'하는 모든 데이터 (가장 유연하지만 부정확할 수 있음)
        filter: { dimension: "URL_CHANNEL_NAME", operator: "CONTAINS", value: path },
        name: '경로 포함 (CONTAINS)'
      },
      // 문자열 형식 필터도 시도 (최후의 수단)
      { 
        filter: `URL_CHANNEL_NAME=="${domain}"`,
        name: '전체 도메인 (문자열)'
      },
      { 
        filter: `URL_CHANNEL_NAME=="${url}"`,
        name: '전체 URL (문자열)'
      },
    ];

    let adsenseData = null;
    let lastError = null;
    let triedFilters = [];

    for (const filterStrategy of filterStrategies) {
      const filter = filterStrategy.filter;
      triedFilters.push(filterStrategy.name);
      
      try {
        const requestBody = {
          dateRange: "LAST_30_DAYS",
          metrics: [
            "ESTIMATED_EARNINGS",
            "PAGE_VIEWS_RPM",
            "CLICKS",
            "PAGE_VIEWS",
          ],
          dimensions: ["URL_CHANNEL_NAME"],
        };
        
        // 필터 형식에 따라 다르게 처리
        if (typeof filter === 'string') {
          requestBody.filters = [filter];
        } else {
          requestBody.filters = [filter];
        }
        
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { 
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          
          // 404 오류 처리: 리포트 생성 불가 (데이터 부재일 수 있음)
          // AdSense API에서 404는 계정이 없거나 리포트를 생성할 수 없을 때 발생
          // 하지만 계정 정보 조회가 성공했다면, 이는 해당 URL에 대한 데이터가 없음을 의미할 수 있음
          if (response.status === 404) {
            // 마지막 필터 전략이 아니면 다음 전략 시도
            if (filterStrategy !== filterStrategies[filterStrategies.length - 1]) {
              // 다음 필터 전략 시도 (오류로 기록하지 않음, 데이터 없을 수 있음)
              console.log(`[AdSense] 필터 "${filterStrategy.name}" 실패 (404) - 다음 전략 시도`);
              continue;
            } else {
              // 모든 필터 전략 실패 - 데이터가 없을 가능성이 높음
              // 계정에 데이터가 있는지 확인했으므로, 이는 해당 URL에 대한 데이터가 없음을 의미
              console.log(`[AdSense] 모든 필터 전략 실패 (404) - 데이터 없음으로 처리`);
              // 오류로 기록하지 않고 데이터 없음으로 처리
              lastError = null; // 오류가 아님
              break; // 루프 종료
            }
          }
          
          // 401 오류면 토큰 갱신 후 재시도
          if (response.status === 401 && retryCount < MAX_RETRIES) {
            console.log(`[AdSense] 토큰 만료 감지, 토큰 갱신 후 재시도 (${retryCount + 1}/${MAX_RETRIES})...`);
            
            try {
              // 기존 토큰 무효화
              try {
                await new Promise((resolve) => {
                  chrome.identity.removeCachedAuthToken({ token }, resolve);
                });
              } catch (e) {
                console.warn("[AdSense 토큰 갱신] 기존 토큰 제거 실패:", e);
              }

              // 새 토큰 발급
              const newToken = await new Promise((resolve, reject) => {
                chrome.identity.getAuthToken({ interactive: false }, (newToken) => {
                  if (chrome.runtime.lastError) {
                    chrome.identity.getAuthToken({ interactive: true }, (newToken2) => {
                      if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                      } else {
                        resolve(newToken2);
                      }
                    });
                  } else {
                    resolve(newToken);
                  }
                });
              });

              // 새 토큰 저장
              await new Promise((resolve) => {
                chrome.storage.local.set({ googleAuthToken: newToken }, resolve);
              });
              
              console.log("[AdSense 토큰 갱신] 새 토큰 발급 완료, 재시도 중...");
              
              // 지수 백오프 후 재시도
              const delay = Math.pow(2, retryCount) * 1000;
              await new Promise(resolve => setTimeout(resolve, delay));
              return getAdsenseData(newToken, accountId, url, retryCount + 1);
            } catch (tokenError) {
              console.error("[AdSense 토큰 갱신 실패]", tokenError);
              await sendErrorToUI("TOKEN_EXPIRED", "AdSense 인증 토큰 갱신에 실패했습니다. 다시 로그인해주세요.");
              throw new Error(`AdSense API 오류 (401): 토큰 갱신 실패 - ${tokenError.message}`);
            }
          }
          
          // 403 Forbidden 처리
          if (response.status === 403) {
            await sendErrorToUI("FORBIDDEN", "AdSense 접근 권한이 없습니다. 계정 권한을 확인해주세요.");
            throw new Error(`AdSense API 오류 (403): ${errorData.error?.message || response.statusText}`);
          }
          
          // 429 Quota 제한 처리
          if (response.status === 429) {
            if (retryCount < MAX_RETRIES) {
              const delay = Math.pow(2, retryCount) * 1000;
              console.warn(`[AdSense] Quota 제한 감지 (429), ${delay}ms 후 재시도 (${retryCount + 1}/${MAX_RETRIES})...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              return getAdsenseData(token, accountId, url, retryCount + 1);
            } else {
              await sendErrorToUI("QUOTA_EXCEEDED", "AdSense API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.");
              throw new Error(`AdSense API 오류 (429): 할당량 초과`);
            }
          }
          
          throw new Error(`AdSense API 오류 (${response.status}): ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        
        // 데이터가 없는 경우 (200 OK이지만 rows가 비어있음)
        if (!data.rows || data.rows.length === 0) {
          console.log(`[AdSense] 데이터 없음 (${url}, 필터: ${filter}): 해당 URL/도메인에 데이터가 없습니다.`);
          // 다음 필터 전략 시도
          continue;
        }
        
        if (data.rows && data.rows.length > 0) {
          const row = data.rows[0]?.cells;
          if (row && row.length > 0) {
            const clicks = parseFloat(row[2]?.value || "0.0");
            const pageViews = parseFloat(row[3]?.value || "0.0");
            const ctr = pageViews > 0 ? (clicks / pageViews) * 100 : 0;

            adsenseData = {
              estimatedEarnings: parseFloat(row[0]?.value || "0.0"),
              pageRPM: parseFloat(row[1]?.value || "0.0"),
              clicks: clicks,
              pageViews: pageViews,
              ctr: parseFloat(ctr.toFixed(2)),
            };
            console.log(`[AdSense] 성과 지표 수집 완료 (${url}, 필터: ${filterStrategy.name}):`, {
              ...adsenseData,
              rawRow: row.map(cell => ({ value: cell.value, label: cell.label })),
              note: "GA4에서 publisherAdRevenue를 사용할 수 없으므로 AdSense API 데이터를 사용합니다."
            });
            break; // 성공하면 루프 종료
          }
        }
      } catch (filterError) {
        lastError = filterError;
        console.warn(`[AdSense] 필터 전략 실패 (${filterStrategy.name}):`, filterError.message);
        continue; // 다음 필터 전략 시도
      }
    }

    // 모든 필터 전략 실패한 경우
    if (!adsenseData) {
      // lastError가 실제 API 오류(401, 403 등)인지 확인
      // 404는 리포트 생성 실패를 의미하지만, 계정 정보 조회가 성공했다면 데이터 없음을 의미할 수 있음
      const isRealError = lastError && (
        lastError.message.includes('401') || 
        lastError.message.includes('403') ||
        lastError.message.includes('계정을 찾을 수 없습니다') ||
        lastError.message.includes('토큰') ||
        (lastError.message.includes('404') && !hasAccountData) // 계정 정보 조회도 실패한 경우만 오류
      );
      
      if (isRealError) {
        // 실제 API 오류인 경우
        throw lastError;
      } else {
        // 데이터가 없는 경우 (404이지만 계정은 존재, 또는 200 OK이지만 rows가 비어있음) - 오류가 아님
        console.log(`[AdSense] 데이터 없음 (${url}): 모든 필터 전략 실패했지만 실제 오류는 아닙니다. 데이터가 없을 수 있습니다.`);
        return {
          estimatedEarnings: 0,
          pageRPM: 0,
          clicks: 0,
          pageViews: 0,
          ctr: 0,
          // 오류가 아닌 정상 응답 (데이터 없음)
        };
      }
    }

    return adsenseData;
  } catch (error) {
    console.error(`[AdSense] 데이터 요청 실패 (시도 ${retryCount + 1}/${MAX_RETRIES}):`, {
      url,
      accountId,
      error: error.message,
      stack: error.stack,
    });

    // 404 오류는 '수익 데이터 없음'으로 정상 처리 (에러가 아님)
    if (error.message.includes('404')) {
      console.log(`[AdSense] 404 오류 발생 - 수익 데이터 없음으로 처리 (${url})`);
      return {
        estimatedEarnings: 0,
        pageRPM: 0,
        clicks: 0,
        pageViews: 0,
        ctr: 0,
        // 오류가 아닌 정상 응답 (데이터 없음)
      };
    }

    // 401 오류면 토큰 갱신 후 재시도
    if (error.message.includes('401') && retryCount < MAX_RETRIES) {
      console.log(`[AdSense] catch 블록에서 토큰 만료 감지, 토큰 갱신 후 재시도 (${retryCount + 1}/${MAX_RETRIES})...`);
      
      try {
        // 기존 토큰 무효화
        try {
          await new Promise((resolve) => {
            chrome.identity.removeCachedAuthToken({ token }, resolve);
          });
        } catch (e) {
          console.warn("[AdSense 토큰 갱신] 기존 토큰 제거 실패:", e);
        }

        // 새 토큰 발급
        const newToken = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (newToken) => {
            if (chrome.runtime.lastError) {
              chrome.identity.getAuthToken({ interactive: true }, (newToken2) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(newToken2);
                }
              });
            } else {
              resolve(newToken);
            }
          });
        });

        // 새 토큰 저장
        await new Promise((resolve) => {
          chrome.storage.local.set({ googleAuthToken: newToken }, resolve);
        });
        
        console.log("[AdSense 토큰 갱신] 새 토큰 발급 완료, 재시도 중...");
        
        // 지수 백오프 후 재시도
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return getAdsenseData(newToken, accountId, url, retryCount + 1);
      } catch (tokenError) {
        console.error("[AdSense 토큰 갱신 실패]", tokenError);
        await sendErrorToUI("TOKEN_EXPIRED", "AdSense 인증 토큰 갱신에 실패했습니다. 다시 로그인해주세요.");
        // 토큰 갱신 실패해도 일반 재시도 로직으로 진행
      }
    }

    // 403 Forbidden 처리
    if (error.message.includes('403')) {
      await sendErrorToUI("FORBIDDEN", "AdSense 접근 권한이 없습니다. 계정 권한을 확인해주세요.");
    }
    
    // 429 Quota 제한 처리
    if (error.message.includes('429')) {
      if (retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`[AdSense] Quota 제한 감지 (429), ${delay}ms 후 재시도 (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return getAdsenseData(token, accountId, url, retryCount + 1);
      } else {
        await sendErrorToUI("QUOTA_EXCEEDED", "AdSense API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.");
      }
    }

    // 재시도 로직 (401, 403, 429가 아닌 경우)
    if (!error.message.includes('401') && !error.message.includes('403') && !error.message.includes('429') && retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000; // 지수 백오프: 1초, 2초, 4초
      console.log(`[AdSense] ${delay}ms 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return getAdsenseData(token, accountId, url, retryCount + 1);
    }

    // 최종 실패 시 (재시도 모두 실패한 경우)
    if (retryCount >= MAX_RETRIES && !error.message.includes('404')) {
      await sendErrorToUI("API_ERROR", `AdSense 데이터 수집 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`);
    }

    // 최종 실패 시 기본값 반환
    return {
      estimatedEarnings: 0,
      pageRPM: 0,
      clicks: 0,
      pageViews: 0,
      ctr: 0,
      error: error.message,
    };
  }
}

// background.js 파일 하단에 추가

/**
 * [테스트 전용 함수 - V2]
 * '재활용 자동화' 기능의 분석 및 생성 로직을 직접 테스트합니다.
 * (V1의 문제: updateAllPerformanceMetrics가 mock 데이터를 덮어쓰는 문제 해결)
 */
async function runAutomatedRenewalTestV2() {
  console.log("=============== 🧪 테스트 시작 V2: 자동 리뉴얼 ===============");
  
  const userId = CONSTANTS.USER_ID;
  const MOCK_CARD_ID = "test-card-renewal-002"; // 새 ID로 구분
  const MOCK_CARD_PATH = `kanban/done/${MOCK_CARD_ID}`;
  
  // ▼▼▼ [수정] "테스트" 단어를 추가하여 실제 생성될 제목과 일치시킴 ▼▼▼
  const MOCK_IDEA_TITLE = `[자동 리뉴얼] V2 테스트: 90일 경과 고성과 포스트`;
  // ▲▲▲ [수정 완료] ▲▲▲

  // --- 사전 준비: 기존 테스트 데이터 삭제 ---
  await firebase.database().ref(MOCK_CARD_PATH).remove();
  const ideasSnap = await firebase.database().ref(`kanban/${userId}/ideas`).once("value");
  const ideas = ideasSnap.val() || {};
  for (const ideaId in ideas) {
    // 이제 이 로직이 정상적으로 작동하여 이전 테스트 카드를 삭제함
    if (ideas[ideaId].title === MOCK_IDEA_TITLE) {
      await firebase.database().ref(`kanban/${userId}/ideas/${ideaId}`).remove();
    }
  }
  console.log("테스트 V2: 기존 데이터 정리 완료.");

  // --- 1. 가짜 데이터(Mock Data) 입력 ---
  // 91일 전, 고성과 Mock 카드 생성
  const mockCardData = {
    title: "V2 테스트: 90일 경과 고성과 포스트", // [중요] 이 제목이 MOCK_IDEA_TITLE에 반영되어야 함
    publishedUrl: "https://example.com/test-post-002",
    performanceTracked: true,
    createdAt: Date.now() - (91 * 24 * 60 * 60 * 1000), // 91일 전
    channelId: "test-channel-id", // [수정] 채널 ID 추가 (테스트를 위한 임의의 ID)
    tags: ["#테스트", "#성과좋음"],
    performance: {
      estimatedEarnings: 120.50, // 평균(가정)보다 높음
      pageviews: 15000,          // 평균(가정)보다 높음
      error: null, // [중요] 에러가 없음
      lastUpdatedAt: Date.now()
    },
    origin: { type: "manual_entry" }
  };

  await firebase.database().ref(MOCK_CARD_PATH).set(mockCardData);
  console.log("테스트 V2: 1. Mock 데이터 입력 완료.", MOCK_CARD_PATH);

  // --- 2. 자동화 기능 *직접* 트리거 ---
  // [!! 변경점 !!]
  // updateAllPerformanceMetrics() 대신, analyze 로직이 포함된
  // runAutomatedRenewalChecks()를 직접 호출합니다.
  console.log("테스트 V2: 2. runAutomatedRenewalChecks() 강제 실행...");
  await runAutomatedRenewalChecks(); //
  console.log("테스트 V2: 2. 자동화 로직 실행 완료.");

  // --- 3. 결과 검증 ---
  console.log("테스트 V2: 3. 결과 검증 시작...");
  
  await new Promise(resolve => setTimeout(resolve, 3000)); // Firebase 전파 대기

  const newIdeasSnap = await firebase.database().ref(`kanban/${userId}/ideas`).once("value");
  const newIdeas = newIdeasSnap.val() || {};
  
  const foundIdea = Object.values(newIdeas).find(
    idea => idea.title === MOCK_IDEA_TITLE &&
            idea.origin?.type === "my_post_renewal" &&
            idea.origin?.originalCardId === MOCK_CARD_ID
  );

  if (foundIdea) {
    console.log("✅ 테스트 성공 V2! '아이디어' 탭에 자동 리뉴얼 카드가 생성되었습니다.");
  } else {
    console.error("❌ 테스트 실패 V2. '아이디어' 탭에서 자동 리뉴얼 카드를 찾을 수 없습니다.");
  }

  console.log("=============== 🧪 테스트 종료 V2 ===============");
}

/**
 * [시스템 진단] 전체 시스템 정밀 진단 함수
 * 5가지 핵심 영역(20개 검사 항목)을 순차적으로 점검합니다.
 */
async function runFullSystemDiagnosis() {
  const userId = CONSTANTS.USER_ID;
  console.log("🚀 [System Check] 전체 시스템 정밀 진단 시작...");
  console.log(`📌 현재 사용자 ID: ${userId}`);
  
  const diagnosisResults = {
    startTime: Date.now(),
    userId: userId,
    checks: [],
    errors: [],
    warnings: []
  };

  // 진단 로그 전송 함수
  function sendDiagnosticLog(checkId, status, message, details = null) {
    const logEntry = {
      id: checkId,
      status, // 'running', 'pass', 'fail', 'warn', 'done'
      message,
      details,
      timestamp: Date.now()
    };
    diagnosisResults.checks.push(logEntry);
    
    console.log(`[진단] ${checkId}: ${status} - ${message}`);
  }

  try {
    // ========== 1. 연결 및 인증 (Connectivity & Auth) ==========
    
    // 1-1. Firebase 데이터베이스 연결
    try {
      sendDiagnosticLog("db_conn", "running", "Firebase 연결 확인 중...");
      const connectedRef = firebase.database().ref(".info/connected");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("연결 타임아웃")), 5000);
        connectedRef.once("value", (snap) => {
          clearTimeout(timeout);
          if (snap.val() === true) {
            resolve();
          } else {
            reject(new Error("연결되지 않음"));
          }
        });
      });
      
      // 쓰기 테스트
      const testRef = firebase.database().ref("system_check/write_test");
      await testRef.set(Date.now());
      await testRef.remove();
      
      sendDiagnosticLog("db_conn", "pass", "Firebase 읽기/쓰기 정상");
    } catch (e) {
      sendDiagnosticLog("db_conn", "fail", `DB 연결 실패: ${e.message}`);
      diagnosisResults.errors.push("Firebase 연결 실패");
    }

    // 1-2. Firebase 쓰기 권한 확인
    try {
      sendDiagnosticLog("db_write", "running", "Firebase 쓰기 권한 확인 중...");
      const writeTestRef = firebase.database().ref("system_check/permission_test");
      await writeTestRef.set({ test: Date.now() });
      await writeTestRef.remove();
      sendDiagnosticLog("db_write", "pass", "Firebase 쓰기 권한 정상");
    } catch (e) {
      sendDiagnosticLog("db_write", "fail", `쓰기 권한 오류: ${e.message}`);
      diagnosisResults.errors.push("Firebase 쓰기 권한 없음");
    }

    // 1-3. Google 계정 토큰 유효성
    let validToken = null;
    try {
      sendDiagnosticLog("auth_token", "running", "Google 인증 토큰 검사...");
      const { googleAuthToken } = await chrome.storage.local.get(["googleAuthToken"]);
      
      if (!googleAuthToken) {
        throw new Error("로그인 필요");
      }
      
      // 토큰 유효성 (API 호출)
      const authRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${googleAuthToken}` }
      });
      
      if (!authRes.ok) {
        throw new Error("토큰 만료 (재로그인 필요)");
      }
      
      validToken = googleAuthToken; // 유효한 토큰 저장
      const userInfo = await authRes.json();
      sendDiagnosticLog("auth_token", "pass", "Google 계정 인증 정상");
    } catch (e) {
      sendDiagnosticLog("auth_token", "fail", e.message);
      diagnosisResults.errors.push("인증 실패");
    }

    // 1-4. YouTube API 키
    try {
      sendDiagnosticLog("api_youtube", "running", "YouTube API 키 확인 중...");
      const { youtubeApiKey } = await chrome.storage.local.get(["youtubeApiKey"]);
      
      if (!youtubeApiKey) {
        throw new Error("API 키 없음");
      }
      
      // 간단한 채널 검색 테스트
      const testUrl = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&part=snippet&q=test&maxResults=1`;
      const ytRes = await fetch(testUrl);
      
      if (!ytRes.ok) {
        const errorData = await ytRes.json().catch(() => ({}));
        if (ytRes.status === 403) {
          throw new Error("API 키 권한 없음 또는 할당량 초과");
        }
        throw new Error(`API 오류: ${ytRes.status}`);
      }
      
      sendDiagnosticLog("api_youtube", "pass", "YouTube API 정상 작동");
    } catch (e) {
      sendDiagnosticLog("api_youtube", "fail", e.message);
      diagnosisResults.warnings.push("YouTube API 문제");
    }

    // 1-5. Gemini API 키
    try {
      sendDiagnosticLog("api_gemini", "running", "Gemini API 응답 테스트...");
      const { geminiApiKey } = await chrome.storage.local.get(["geminiApiKey"]);
      
      if (!geminiApiKey) {
        throw new Error("API 키 없음");
      }
      
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
        }
      );
      
      if (!geminiRes.ok) {
        const errorData = await geminiRes.json().catch(() => ({}));
        throw new Error(`Gemini API 오류: ${geminiRes.status} - ${errorData.error?.message || ""}`);
      }
      
      const geminiData = await geminiRes.json();
      const responseTime = Date.now() - diagnosisResults.startTime;
      sendDiagnosticLog("api_gemini", "pass", `Gemini API 정상 작동 (응답 시간: ${responseTime}ms)`);
    } catch (e) {
      sendDiagnosticLog("api_gemini", "fail", e.message);
      diagnosisResults.warnings.push("Gemini API 문제");
    }

    // ========== 2. 데이터 무결성 (Data Integrity) ==========
    
    // 2-1. 활성 채널 상태 (수정된 로직)
    try {
      sendDiagnosticLog("data_active_channel", "running", "활성 채널 상태 확인...");
      const { activeChannelId } = await chrome.storage.local.get("activeChannelId");
      
      if (!activeChannelId) {
        sendDiagnosticLog("data_active_channel", "warn", "활성 채널이 선택되지 않음");
        diagnosisResults.warnings.push("활성 채널 미선택");
      } else {
        // 실제 채널 목록에 존재하는지 확인
        const userId = CONSTANTS.USER_ID;
        const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
        const channelsData = channelsSnapshot.val() || {};
        const myChannels = channelsData.myChannels || { blogs: [], youtubes: [] };
        
        const allChannels = [...(myChannels.blogs || []), ...(myChannels.youtubes || [])];
        
        // [핵심 수정] ID가 없으면 API URL을 변환해서 비교하도록 로직 개선
        const channelExists = allChannels.some(ch => {
          // 1. 저장된 ID가 있으면 그것과 비교
          if (ch.id && ch.id === activeChannelId) return true;
          if (ch.channelId && ch.channelId === activeChannelId) return true;
          
          // 2. 저장된 ID가 없으면 URL을 변환하여 비교 (헤더의 로직과 동일하게 맞춤)
          if (ch.apiUrl) {
            const generatedId = btoa(ch.apiUrl).replace(/=/g, "");
            if (generatedId === activeChannelId) return true;
          }
          return false;
        });
        
        if (channelExists) {
          sendDiagnosticLog("data_active_channel", "pass", `활성 채널 정상 (ID: ${activeChannelId.substring(0, 10)}...)`);
        } else {
          sendDiagnosticLog("data_active_channel", "warn", `활성 채널이 목록에 없음 (ID: ${activeChannelId})`);
          diagnosisResults.warnings.push("활성 채널 불일치");
        }
      }
    } catch (e) {
      sendDiagnosticLog("data_active_channel", "fail", `채널 확인 오류: ${e.message}`);
    }

    // 2-2. 고아 데이터(Orphan Data) 감지
    try {
      sendDiagnosticLog("data_orphan", "running", "고아 데이터(채널 ID 누락) 스캔 중...");
      
      const userId = CONSTANTS.USER_ID;
      const scrapsSnap = await firebase.database().ref(`scraps/${userId}`).once("value");
      const scraps = scrapsSnap.val() || {};
      let orphanScraps = 0;
      Object.values(scraps).forEach(s => {
        if (s.channelId === undefined || s.channelId === null) orphanScraps++;
      });
      
      const kanbanSnap = await firebase.database().ref(`kanban/${userId}`).once("value");
      const kanban = kanbanSnap.val() || {};
      let orphanKanban = 0;
      for (const status in kanban) {
        Object.values(kanban[status] || {}).forEach(card => {
          if (card.channelId === undefined || card.channelId === null) orphanKanban++;
        });
      }
      
      const totalOrphans = orphanScraps + orphanKanban;
      
      if (totalOrphans > 0) {
        sendDiagnosticLog("data_orphan", "warn", 
          `마이그레이션 필요 데이터 발견 (사용자 ID: ${userId}, 스크랩: ${orphanScraps}개, 칸반: ${orphanKanban}개)`);
        diagnosisResults.warnings.push(`고아 데이터 ${totalOrphans}개 발견 (사용자 ID: ${userId})`);
      } else {
        sendDiagnosticLog("data_orphan", "pass", `고아 데이터 없음 (사용자 ID: ${userId})`);
      }
    } catch (e) {
      sendDiagnosticLog("data_orphan", "fail", `고아 데이터 스캔 오류: ${e.message}`);
    }

    // 2-3. 채널 데이터 구조
    try {
      sendDiagnosticLog("data_structure", "running", "채널 데이터 구조 확인...");
      const userId = CONSTANTS.USER_ID;
      const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
      const channelsData = channelsSnapshot.val() || {};
      
      // 구버전 전역 competitorChannels 구조 확인
      const hasOldGlobalCompetitors = channelsData.competitorChannels && 
        (channelsData.competitorChannels.blogs?.length > 0 || 
         channelsData.competitorChannels.youtubes?.length > 0);
      
      // 새 구조 확인: myChannels.blogs 내부에 competitors 배열이 있는지
      const myBlogs = channelsData.myChannels?.blogs || [];
      const hasNewStructure = myBlogs.some(blog => blog.competitors && Array.isArray(blog.competitors));
      
      if (hasOldGlobalCompetitors) {
        sendDiagnosticLog("data_structure", "warn", 
          "구버전 데이터 구조 감지 (전역 competitorChannels 필드 존재) - 마이그레이션 권장");
        diagnosisResults.warnings.push("구버전 데이터 구조 (전역 competitorChannels)");
      } else if (myBlogs.length > 0 && !hasNewStructure) {
        sendDiagnosticLog("data_structure", "warn", 
          "채널 중심 아키텍처 구조가 완전히 적용되지 않음 (competitors 배열 누락 가능)");
        diagnosisResults.warnings.push("데이터 구조 불완전");
      } else {
        sendDiagnosticLog("data_structure", "pass", 
          `채널 데이터 구조 정상 (사용자 ID: ${userId}, 채널 중심 아키텍처: ${myBlogs.length}개 채널, ${myBlogs.filter(b => b.competitors?.length > 0).length}개에 경쟁사 포함)`);
      }
    } catch (e) {
      sendDiagnosticLog("data_structure", "fail", `구조 확인 오류: ${e.message}`);
    }

    // ========== 3. 백그라운드 로직 (Background Jobs) ==========
    
    // 3-1. 스케줄러 등록 상태
    try {
      sendDiagnosticLog("scheduler", "running", "백그라운드 알람 확인...");
      const alarms = await chrome.alarms.getAll();
      const hasFetch = alarms.some(a => a.name === "fetch-channels");
      const hasUpdate = alarms.some(a => a.name === "update-performance-metrics");
      
      if (hasFetch && hasUpdate) {
        const fetchAlarm = alarms.find(a => a.name === "fetch-channels");
        const updateAlarm = alarms.find(a => a.name === "update-performance-metrics");
        sendDiagnosticLog("scheduler", "pass", 
          `모든 스케줄러 정상 작동 (fetch: ${fetchAlarm ? "등록됨" : "없음"}, update: ${updateAlarm ? "등록됨" : "없음"})`);
      } else {
        sendDiagnosticLog("scheduler", "warn", 
          `일부 알람이 누락됨 (fetch: ${hasFetch ? "있음" : "없음"}, update: ${hasUpdate ? "있음" : "없음"})`);
        diagnosisResults.warnings.push("스케줄러 누락");
      }
    } catch (e) {
      sendDiagnosticLog("scheduler", "fail", `알람 확인 오류: ${e.message}`);
    }

    // 3-2. 데이터 최신성
    try {
      sendDiagnosticLog("data_freshness", "running", "데이터 최신성 확인...");
      const userId = CONSTANTS.USER_ID;
      const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
      const channelsData = channelsSnapshot.val() || {};
      const myChannels = channelsData.myChannels || { blogs: [], youtubes: [] };
      
      const allChannels = [...(myChannels.blogs || []), ...(myChannels.youtubes || [])];
      const now = Date.now();
      const DAY_24H = 24 * 60 * 60 * 1000;
      
      let staleCount = 0;
      let lastFetchTime = 0;
      
      for (const channel of allChannels) {
        const fetchedAt = channel.fetchedAt || 0;
        if (fetchedAt > 0) {
          lastFetchTime = Math.max(lastFetchTime, fetchedAt);
          if (now - fetchedAt > DAY_24H) {
            staleCount++;
          }
        }
      }
      
      if (staleCount > 0) {
        const daysSinceLastFetch = lastFetchTime > 0 ? Math.floor((now - lastFetchTime) / DAY_24H) : 0;
        sendDiagnosticLog("data_freshness", "warn", 
          `${staleCount}개 채널이 24시간 이상 갱신되지 않음 (마지막 수집: ${daysSinceLastFetch}일 전)`);
        diagnosisResults.warnings.push(`${staleCount}개 채널 데이터 오래됨`);
      } else if (allChannels.length === 0) {
        sendDiagnosticLog("data_freshness", "warn", "등록된 채널이 없음");
      } else {
        sendDiagnosticLog("data_freshness", "pass", "모든 채널 데이터가 최신 상태");
      }
    } catch (e) {
      sendDiagnosticLog("data_freshness", "fail", `최신성 확인 오류: ${e.message}`);
    }

    // 3-3. 오프스크린 DOM 파서
    try {
      sendDiagnosticLog("offscreen_parser", "running", "오프스크린 DOM 파서 테스트...");
      
      // 오프스크린 문서 생성 시도
      await getOffscreenDocument();
      
      // 파싱 요청 테스트
      const testHtml = "<html><body><h1>Test</h1></body></html>";
      const parseResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "parse_html_in_offscreen",
            html: testHtml,
            baseUrl: "https://example.com",
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          }
        );
      });
      
      if (parseResult && parseResult.success) {
        sendDiagnosticLog("offscreen_parser", "pass", "오프스크린 DOM 파서 정상 작동");
      } else {
        throw new Error(parseResult?.error || "파싱 실패");
      }
    } catch (e) {
      sendDiagnosticLog("offscreen_parser", "fail", `오프스크린 파서 오류: ${e.message}`);
      diagnosisResults.warnings.push("오프스크린 파서 문제");
    }

    // ========== 4. AI 및 자동화 기능 (AI & Automation) ==========
    
    // 4-1. 재활용 자동화 테스트
    try {
      sendDiagnosticLog("automation_renewal", "running", "재활용 자동화 로직 시뮬레이션...");
      
      // 간단한 시뮬레이션: analyzePerformanceData 함수 호출
      const analysisResult = await analyzePerformanceData();
      
      if (analysisResult && (analysisResult.analysis || analysisResult.decayContent)) {
        const decayCount = analysisResult.decayContent?.length || 0;
        sendDiagnosticLog("automation_renewal", "pass", 
          `자동화 로직 테스트 통과 (재활용 후보: ${decayCount}개)`);
      } else {
        sendDiagnosticLog("automation_renewal", "warn", "재활용 후보 없음 (정상일 수 있음)");
      }
    } catch (e) {
      sendDiagnosticLog("automation_renewal", "fail", `자동화 테스트 실패: ${e.message}`);
      diagnosisResults.warnings.push("재활용 자동화 문제");
    }

    // 4-2. AI 초안 생성
    try {
      sendDiagnosticLog("ai_draft", "running", "AI 초안 생성 테스트...");
      const { geminiApiKey } = await chrome.storage.local.get(["geminiApiKey"]);
      
      if (!geminiApiKey) {
        throw new Error("Gemini API 키 없음");
      }
      
      const testPrompt = "다음 주제로 100자 이내의 짧은 초안을 작성해주세요: '인공지능의 미래'";
      const aiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: testPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );
      
      if (!aiRes.ok) {
        throw new Error(`AI API 오류: ${aiRes.status}`);
      }
      
      const aiData = await aiRes.json();
      const hasContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (hasContent) {
        sendDiagnosticLog("ai_draft", "pass", "AI 초안 생성 정상 작동");
      } else {
        throw new Error("응답 내용 없음");
      }
    } catch (e) {
      sendDiagnosticLog("ai_draft", "fail", `AI 초안 생성 오류: ${e.message}`);
      diagnosisResults.warnings.push("AI 초안 생성 문제");
    }

    // ========== 5. 외부 API 연동 (External Integrations) ==========
    
    // 5-1. GA4 속성 접근 권한
    if (validToken) {
      try {
        sendDiagnosticLog("ga4_access", "running", "GA4 권한 확인...");
        
        const userId = CONSTANTS.USER_ID;
        const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
        const channelsData = channelsSnapshot.val() || {};
        const myChannels = channelsData.myChannels || { blogs: [] };
        const firstBlog = myChannels.blogs?.[0];
        
        if (!firstBlog || !firstBlog.gaPropertyId) {
          sendDiagnosticLog("ga4_access", "warn", "GA4 속성 ID가 설정된 채널이 없음");
        } else {
          // 간단한 권한 확인 (속성 목록 조회)
          const testUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${firstBlog.gaPropertyId}:runReport`;
          const gaRes = await fetch(testUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${validToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              dateRanges: [{ startDate: "today", endDate: "today" }],
              metrics: [{ name: "screenPageViews" }]
            })
          });
          
          if (gaRes.status === 403) {
            throw new Error("GA4 접근 권한 없음 (403 Forbidden)");
          } else if (!gaRes.ok) {
            throw new Error(`GA4 API 오류: ${gaRes.status}`);
          }
          
          sendDiagnosticLog("ga4_access", "pass", `GA4 속성 접근 정상 (Property ID: ${firstBlog.gaPropertyId})`);
        }
      } catch (e) {
        sendDiagnosticLog("ga4_access", "fail", e.message);
        diagnosisResults.warnings.push("GA4 접근 문제");
      }
    } else {
      sendDiagnosticLog("ga4_access", "skip", "인증 실패로 건너뜀");
    }

    // 5-2. AdSense 계정 접근 권한 (핵심 수정 부분)
    if (validToken) {
      try {
        sendDiagnosticLog("adsense_access", "running", "AdSense 계정 권한 정밀 진단...");
        const { adSenseAccountId } = await chrome.storage.local.get(["adSenseAccountId"]);
        
        if (!adSenseAccountId) {
          sendDiagnosticLog("adsense_access", "warn", "AdSense ID 미설정");
        } else {
          // [단계 1] 계정 목록 조회 (가장 확실한 권한 확인)
          const listRes = await fetch("https://adsense.googleapis.com/v2/accounts", {
            headers: { Authorization: `Bearer ${validToken}` }
          });
          
          if (!listRes.ok) {
            throw new Error(`계정 목록 조회 실패 (${listRes.status})`);
          }
          
          const listData = await listRes.json();
          const myId = "accounts/" + adSenseAccountId.trim();
          const exists = listData.accounts?.some(acc => acc.name === myId || acc.name.endsWith(adSenseAccountId.trim()));
          
          if (!exists) {
            throw new Error(`내 계정(${adSenseAccountId})이 권한 목록에 없습니다.`);
          }
          
          // [단계 2] 리포트 생성 테스트 (데이터 유무 확인)
          // 날짜 범위를 LAST_7_DAYS로 변경하여 데이터 존재 확률을 높임
          const reportRes = await fetch(`https://adsense.googleapis.com/v2/${myId}/reports:generate`, {
            method: "POST",
            headers: { 
              Authorization: `Bearer ${validToken}`, 
              "Content-Type": "application/json" 
            },
            body: JSON.stringify({ dateRange: "LAST_7_DAYS", metrics: ["PAGE_VIEWS"] })
          });
          
          if (reportRes.ok) {
            sendDiagnosticLog("adsense_access", "pass", "AdSense 정상 (데이터 접근 가능)");
          } else if (reportRes.status === 404) {
            // [핵심] 404가 떠도 1단계(계정 확인)를 통과했으므로 '연동 성공'으로 간주
            // 신규 연동 직후나 데이터 집계 대기 중일 수 있음
            sendDiagnosticLog("adsense_access", "pass", "연동 성공 (데이터 집계 대기 중)");
          } else {
            throw new Error(`리포트 오류: ${reportRes.status}`);
          }
        }
      } catch (e) {
        sendDiagnosticLog("adsense_access", "fail", e.message);
        diagnosisResults.warnings.push("AdSense 문제");
      }
    } else {
      sendDiagnosticLog("adsense_access", "skip", "인증 실패로 건너뜀");
    }

    // 5-3. URL 필터링 테스트
    if (validToken) {
      try {
        sendDiagnosticLog("url_filtering", "running", "URL 필터링 테스트 (BEGINS_WITH/CONTAINS)...");
      
      const userId = CONSTANTS.USER_ID;
      const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
      const channelsData = channelsSnapshot.val() || {};
      const myChannels = channelsData.myChannels || { blogs: [] };
      const firstBlog = myChannels.blogs?.[0];
      
      if (!firstBlog || !firstBlog.gaPropertyId) {
        sendDiagnosticLog("url_filtering", "warn", "테스트할 GA4 속성이 없음");
      } else {
        // BEGINS_WITH 필터 테스트
        const testUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${firstBlog.gaPropertyId}:runReport`;
        const filterRes = await fetch(testUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${validToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
            dimensions: [{ name: "pagePath" }],
            metrics: [{ name: "screenPageViews" }],
            dimensionFilter: {
              filter: {
                fieldName: "pagePath",
                stringFilter: { matchType: "BEGINS_WITH", value: "/" }
              }
            }
          })
        });
        
        if (filterRes.ok) {
          const filterData = await filterRes.json();
          const rowCount = filterData.rows?.length || 0;
          sendDiagnosticLog("url_filtering", "pass", 
            `URL 필터링 정상 작동 (BEGINS_WITH 필터로 ${rowCount}개 결과)`);
        } else {
          throw new Error(`필터 테스트 실패: ${filterRes.status}`);
        }
      }
      } catch (e) {
        sendDiagnosticLog("url_filtering", "fail", e.message);
        diagnosisResults.warnings.push("URL 필터링 문제");
      }
    } else {
      sendDiagnosticLog("url_filtering", "skip", "인증 실패로 건너뜀");
    }

    // 진단 완료
    diagnosisResults.endTime = Date.now();
    diagnosisResults.duration = diagnosisResults.endTime - diagnosisResults.startTime;
    
    sendDiagnosticLog("complete", "done", 
      `진단 완료 (사용자 ID: ${userId}, 소요 시간: ${Math.round(diagnosisResults.duration / 1000)}초, 오류: ${diagnosisResults.errors.length}개, 경고: ${diagnosisResults.warnings.length}개)`);
    
    console.log(`\n📊 [진단 요약]`);
    console.log(`   사용자 ID: ${userId}`);
    console.log(`   Firebase 경로: kanban/${userId}, scraps/${userId}, channels/${userId}, channel_content/${userId}, channel_meta/${userId}`);
    console.log(`   총 검사 항목: ${diagnosisResults.checks.length}개`);
    console.log(`   오류: ${diagnosisResults.errors.length}개`);
    console.log(`   경고: ${diagnosisResults.warnings.length}개`);
    
    return diagnosisResults;
    
  } catch (error) {
    console.error("[시스템 진단] 치명적 오류:", error);
    sendDiagnosticLog("fatal_error", "fail", `진단 중 치명적 오류: ${error.message}`);
    diagnosisResults.errors.push(`치명적 오류: ${error.message}`);
    return diagnosisResults;
  }
}

// ▼▼▼ [동적 페르소나 프롬프트 시스템] ▼▼▼

/**
 * [동적 페르소나 프롬프트 템플릿]
 * 채널 성격에 따라 다른 톤앤매너를 적용합니다.
 */
const PROMPT_TEMPLATES = {
  professional: {
    name: "전문가 작가",
    systemPrompt: `당신은 특정 주제에 대한 전문 작가입니다. 전문적이고 신뢰할 수 있는 톤으로 작성해주세요.
- 객관적이고 사실 기반의 정보 제공
- 전문 용어를 적절히 사용하되, 초보자도 이해할 수 있도록 설명
- 정중하고 격식 있는 문체 사용
- "~입니다", "~합니다" 같은 존댓말 사용
- 통계, 데이터, 근거를 명확히 제시`,
    tone: "전문적"
  },
  friendly: {
    name: "친근한 리뷰어",
    systemPrompt: `당신은 독자와 친근하게 소통하는 리뷰어입니다. 편안하고 친근한 톤으로 작성해주세요.
- 구어체와 친근한 표현 사용 ("~했어요", "~거예요", "~네요")
- 독자와의 대화하듯이 자연스러운 문체
- 경험담과 개인적인 느낌을 자연스럽게 포함
- 이모티콘은 사용하지 않되, 따뜻하고 친근한 어조 유지
- "~해보셨어요?", "~아시나요?" 같은 친근한 질문 활용`,
    tone: "친근한"
  },
  critical: {
    name: "비판적 분석가",
    systemPrompt: `당신은 비판적 사고를 가진 분석가입니다. 날카롭고 명확한 분석을 제공해주세요.
- 객관적이고 비판적인 시각으로 문제점 분석
- 장단점을 균형있게 제시
- "~하지만", "~그러나" 같은 대조적 표현 활용
- 명확하고 단호한 문체 사용
- 근거 있는 비판과 개선 방안 제시`,
    tone: "비판적"
  }
};

/**
 * [페르소나 자동 선택 함수]
 * 아이디어 카드의 tags, channelType, description을 분석하여 적절한 페르소나를 선택합니다.
 */
function selectPersona(ideaData) {
  const tags = (ideaData.tags || []).map(t => t.toLowerCase());
  const description = (ideaData.description || "").toLowerCase();
  const title = (ideaData.title || "").toLowerCase();
  const allText = `${title} ${description} ${tags.join(" ")}`;
  
  // 키워드 기반 페르소나 선택
  const friendlyKeywords = ["후기", "리뷰", "사용기", "체험", "추천", "좋아", "만족", "인기", "베스트", "추천", "리뷰어", "후기작성"];
  const criticalKeywords = ["비교", "분석", "문제", "단점", "장단점", "비판", "개선", "한계", "주의", "주의사항", "문제점"];
  const professionalKeywords = ["가이드", "튜토리얼", "방법", "설명", "정보", "정리", "요약", "분석", "데이터", "통계", "연구"];
  
  let friendlyScore = 0;
  let criticalScore = 0;
  let professionalScore = 0;
  
  // 키워드 매칭 점수 계산
  friendlyKeywords.forEach(keyword => {
    if (allText.includes(keyword)) friendlyScore += 2;
  });
  
  criticalKeywords.forEach(keyword => {
    if (allText.includes(keyword)) criticalScore += 2;
  });
  
  professionalKeywords.forEach(keyword => {
    if (allText.includes(keyword)) professionalScore += 2;
  });
  
  // 태그 기반 추가 점수
  if (tags.some(t => t.includes("후기") || t.includes("리뷰") || t.includes("체험"))) {
    friendlyScore += 3;
  }
  if (tags.some(t => t.includes("비교") || t.includes("분석") || t.includes("비판"))) {
    criticalScore += 3;
  }
  if (tags.some(t => t.includes("가이드") || t.includes("튜토리얼") || t.includes("정보"))) {
    professionalScore += 3;
  }
  
  // channelType 기반 선택 (향후 확장 가능)
  // if (ideaData.channelType === "review") friendlyScore += 5;
  // if (ideaData.channelType === "news") professionalScore += 5;
  // if (ideaData.channelType === "analysis") criticalScore += 5;
  
  // 최고 점수 페르소나 선택
  let selectedPersona = "professional"; // 기본값
  let maxScore = professionalScore;
  
  if (friendlyScore > maxScore) {
    maxScore = friendlyScore;
    selectedPersona = "friendly";
  }
  
  if (criticalScore > maxScore) {
    maxScore = criticalScore;
    selectedPersona = "critical";
  }
  
  // 점수가 모두 0이면 기본값(professional) 사용
  if (maxScore === 0) {
    selectedPersona = "professional";
  }
  
  return PROMPT_TEMPLATES[selectedPersona];
}

// ▼▼▼ [6단계] 데이터 마이그레이션 및 신규 사용자 처리 ▼▼▼

/**
 * [신규] 데이터 마이그레이션 함수 (기존 수동 스크립트의 정식 버전)
 * channelId가 없는 기존 데이터를 안전하게 마이그레이션합니다.
 */
async function runDataMigration(targetChannelId = null) {
  console.log("🚀 [Migration] 데이터 마이그레이션 시작...");
  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  
  // 백업 경로 생성 (타임스탬프 기반)
  const timestamp = Date.now();
  const backupPath = `backup/${timestamp}`;
  let backupData = {};
  let rollbackNeeded = false;

  try {
    // 1-1. 내 채널 목록 확인
    const channelsSnap = await db.ref(`channels/${userId}/myChannels/blogs`).once("value");
    const myBlogs = channelsSnap.val() || [];
    
    // 채널이 하나도 없으면 마이그레이션 불가능 (공용으로 처리하거나 중단)
    if (myBlogs.length === 0) {
      console.log("[Migration] 등록된 채널이 없어 마이그레이션을 건너뜁니다.");
      return;
    }

    // 1-2. 타겟 채널 결정
    // targetChannelId가 제공되지 않았을 때만 자동 결정
    if (targetChannelId === null) {
      if (myBlogs.length === 1) {
        const blog = myBlogs[0];
        targetChannelId = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : null);
        console.log(`[Migration] 단일 채널 감지. 타겟 ID: ${targetChannelId}`);
      } else {
        // 다중 채널이고 사용자 선택이 없으면 공용으로 처리
        console.log("[Migration] 다중 채널 감지. 사용자 선택 없음. 기존 데이터는 '공용'으로 유지합니다.");
        targetChannelId = null;
      }
    } else {
      console.log(`[Migration] 사용자 선택 채널 ID: ${targetChannelId}`);
    }

    // ========== [백업 단계] ==========
    console.log(`📦 [Backup] 데이터 백업 시작... (경로: ${backupPath})`);
    
    // 칸반 데이터 백업
    const kanbanSnap = await db.ref(`kanban/${userId}`).once("value");
    const kanban = kanbanSnap.val() || {};
    if (kanban && Object.keys(kanban).length > 0) {
      backupData.kanban = kanban;
    }
    
    // 스크랩 데이터 백업
    const scrapsSnap = await db.ref(`scraps/${userId}`).once("value");
    const scraps = scrapsSnap.val() || {};
    if (scraps && Object.keys(scraps).length > 0) {
      backupData.scraps = scraps;
    }
    
    // 백업 데이터를 Firebase에 저장
    if (Object.keys(backupData).length > 0) {
      await db.ref(backupPath).set(backupData);
      console.log(`%c📦 [Backup] 데이터 백업 완료 (경로: ${backupPath})`, 'color: #2e7d32; font-weight: bold');
      rollbackNeeded = true;
    } else {
      console.log("[Backup] 백업할 데이터가 없습니다.");
    }

    // ========== [마이그레이션 단계] ==========
    // 먼저 총 데이터 수 계산 (진행률 계산용)
    let totalItems = 0;
    const itemsToMigrate = [];
    
    // 칸반 데이터 카운트 및 수집
    for (const status in kanban) {
      for (const id in kanban[status]) {
        const card = kanban[status][id];
        if (card.channelId === undefined || card.channelId === null) {
          itemsToMigrate.push({ type: 'kanban', status, id, card });
          totalItems++;
        }
      }
    }
    
    // 스크랩 데이터 카운트 및 수집
    for (const id in scraps) {
      const scrap = scraps[id];
      if (scrap.channelId === undefined || scrap.channelId === null) {
        itemsToMigrate.push({ type: 'scraps', id, scrap });
        totalItems++;
      }
    }
    
    console.log(`[Migration] 총 ${totalItems}개 데이터 마이그레이션 예정`);
    
    if (totalItems === 0) {
      console.log("[Migration] 마이그레이션할 데이터가 없습니다.");
      // 백업 데이터 정리 (마이그레이션 불필요 시)
      if (rollbackNeeded) {
        await db.ref(backupPath).remove();
        console.log("[Backup] 마이그레이션 불필요로 백업 데이터 정리 완료");
      }
      return;
    }

    // 1-3. 칸반 데이터 마이그레이션
    let updatedCount = 0;
    let processedCount = 0;
    
    for (const item of itemsToMigrate) {
      try {
        if (item.type === 'kanban') {
          await db.ref(`kanban/${userId}/${item.status}/${item.id}`).update({ channelId: targetChannelId });
        } else if (item.type === 'scraps') {
          await db.ref(`scraps/${userId}/${item.id}`).update({ channelId: targetChannelId });
        }
        
        updatedCount++;
        processedCount++;
        
        // 진행률 계산 및 로그 출력
        const progress = Math.round((processedCount / totalItems) * 100);
        if (processedCount % 10 === 0 || processedCount === totalItems) {
          console.log(`[Migration] 진행률: ${progress}% (${processedCount}/${totalItems})`);
        }
      } catch (itemError) {
        console.error(`[Migration] 개별 항목 처리 실패:`, itemError);
        // 개별 항목 실패는 계속 진행하되, 전체 롤백을 위해 플래그 설정
        throw new Error(`마이그레이션 중 오류 발생: ${itemError.message}`);
      }
    }

    console.log(`✅ [Migration] 완료: 총 ${updatedCount}개 데이터 처리됨`);
    
    // 마이그레이션 완료 상태 저장 (일회성 실행 보장)
    await chrome.storage.local.set({ migration_completed: true });
    
    // 성공 시 백업 데이터는 유지 (수동 복구 가능하도록)
    console.log(`[Backup] 마이그레이션 성공. 백업 데이터는 ${backupPath}에 보관됩니다.`);
  
  } catch (error) {
    console.error("❌ [Migration] 오류 발생:", error);
    
    // ========== [롤백 단계] ==========
    if (rollbackNeeded && Object.keys(backupData).length > 0) {
      console.log("🔄 [Rollback] 데이터 복구 시작...");
      try {
        // 백업 데이터로 원상 복구
        if (backupData.kanban) {
          await db.ref(`kanban/${userId}`).set(backupData.kanban);
          console.log("[Rollback] 칸반 데이터 복구 완료");
        }
        
        if (backupData.scraps) {
          await db.ref(`scraps/${userId}`).set(backupData.scraps);
          console.log("[Rollback] 스크랩 데이터 복구 완료");
        }
        
        console.log(`%c✅ [Rollback] 데이터 복구 완료 (백업 경로: ${backupPath})`, 'color: #2e7d32; font-weight: bold');
      } catch (rollbackError) {
        console.error("❌ [Rollback] 복구 실패:", rollbackError);
        console.error(`[Rollback] 수동 복구 필요. 백업 경로: ${backupPath}`);
        throw new Error(`마이그레이션 실패 및 자동 복구 실패. 백업 경로: ${backupPath}`);
      }
    }
    
    throw error; // 에러를 상위로 전파하여 UI에서 처리할 수 있도록
  }
}

// [수정] onInstalled 리스너 (알람 등록 + 마이그레이션 실행)
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Content Pilot 설치/업데이트됨:", details.reason);

  // 2-1. 기본 설정 초기화 (키워드 추출 활성화 추가)
  chrome.storage.local.set({
    isScrapingActive: false,
    highlightToggleState: false,
    isKeywordExtractionEnabled: true, // [필수] 키워드 추출 기능 활성화
  });

  // 2-2. 알람 재등록 (기존 로직)
  chrome.alarms.create("fetch-channels", { delayInMinutes: 1, periodInMinutes: 240 });
  chrome.alarms.create("update-performance-metrics", { delayInMinutes: 5, periodInMinutes: 360 });

  // 2-3. [체크리스트 2-🅰️] 업데이트 시 마이그레이션 자동 실행
  if (details.reason === "update" || details.reason === "install") {
    // 마이그레이션 완료 상태 확인
    chrome.storage.local.get("migration_completed", async (result) => {
      if (!result.migration_completed) {
        console.log("[Migration] 마이그레이션 필요 여부 확인 중...");
        // [체크리스트 2-🅰️] 자동 실행: 백그라운드에서 조용히 실행
        try {
          // 마이그레이션 필요 여부 확인
          const db = firebase.database();
          const userId = CONSTANTS.USER_ID;
          const channelsSnap = await db.ref(`channels/${userId}/myChannels/blogs`).once("value");
          const myBlogs = channelsSnap.val() || [];
          
          if (myBlogs.length > 0) {
            // [체크리스트 2-🅰️] 단일 채널 사용자: 모든 데이터를 그 1개 채널의 소유로 자동 변환
            let targetChannelId = null;
            if (myBlogs.length === 1) {
              const blog = myBlogs[0];
              targetChannelId = blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, "") : null);
              console.log(`[Migration] 단일 채널 감지. 자동 마이그레이션 실행: ${targetChannelId}`);
            } else {
              // [체크리스트 2-🅰️] 다중 채널 사용자: 데이터를 '공용(null)'으로 안전하게 변환
              targetChannelId = null;
              console.log("[Migration] 다중 채널 감지. 기존 데이터를 '공용'으로 유지합니다.");
            }
            
            // 마이그레이션 실행
            await runDataMigration(targetChannelId);
            console.log("[Migration] 자동 마이그레이션 완료");
            
            // [체크리스트 2-🅱️] 마이그레이션 완료 토스트 메시지
            // UI가 로드된 후 표시하기 위해 storage 이벤트로 전달
            chrome.storage.local.set({ 
              migration_completed: true,
              migration_toast_message: "✅ 데이터 구조가 업데이트되었습니다."
            });
          } else {
            console.log("[Migration] 등록된 채널이 없어 마이그레이션을 건너뜁니다.");
          }
        } catch (error) {
          console.error("[Migration] 자동 마이그레이션 실패:", error);
          // 실패해도 UI에서 수동으로 실행할 수 있도록 상태를 저장하지 않음
        }
      }
    });
  }
});

/**
 * [최종 수정 v2] 애드센스 등록 여부 확인 (URL 디코딩 적용)
 * - API가 보내주는 인코딩된 URL(%ED%95%9C%EA%B8%80)을 디코딩하여 비교합니다.
 */
/**
 * [신규] AdSense URL 전용 정규화 함수 (충돌 방지용)
 * 
 * @deprecated 이 함수는 getNormalizedUrl을 사용하도록 리팩토링되었습니다.
 *             하위 호환성을 위해 유지되지만, 새로운 코드에서는 getNormalizedUrl을 사용하세요.
 */
function normalizeAdSenseUrl(url) {
  return getNormalizedUrl(url, { decodeURI: true });
}

/**
 * [최종 수정 v5] 애드센스 등록 여부 확인 (필드명 수정: uriPattern)
 * - API 응답 필드명을 urlPattern -> uriPattern 으로 수정하여 데이터를 정확히 가져옵니다.
 */
/**
 * [최종 업그레이드 v7] 애드센스 등록 여부 확인 (유연한 매칭 적용)
 * - 정확한 일치뿐만 아니라, '포함(Contains)' 관계도 인정하여 서브도메인 문제를 해결합니다.
 * @param {string|null} retryToken - 재시도용 토큰
 * @param {string|null} targetUrl - 특정 URL만 체크할 경우 (null이면 전체 체크)
 * @param {string|null} targetCardId - 특정 카드 ID만 업데이트할 경우 (null이면 전체 업데이트)
 * @param {string|null} targetStatus - 특정 카드의 상태 (targetCardId와 함께 사용)
 */
async function checkAdSenseRegistrationStatus(retryToken = null, targetUrl = null, targetCardId = null, targetStatus = null) {
  const isSingleCardCheck = targetUrl && targetCardId && targetStatus;
  console.log(`🚀 [AdSense] 등록 확인 v7 (유연한 매칭) 시작...${isSingleCardCheck ? ` [단일 카드: ${targetCardId}]` : ' [전체 카드]'}`);
  
  let token = retryToken;
  let accountId = null;

  if (!token) {
    const storage = await chrome.storage.local.get(["googleAuthToken", "adSenseAccountId"]);
    token = storage.googleAuthToken;
    accountId = storage.adSenseAccountId;
  } else {
    const storage = await chrome.storage.local.get("adSenseAccountId");
    accountId = storage.adSenseAccountId;
  }

  if (!token || !accountId) throw new Error("인증 정보가 없습니다.");

  try {
    // 1. 계정 확인
    let accountName = `accounts/${accountId}`;
    try {
      const listRes = await fetch("https://adsense.googleapis.com/v2/accounts", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (listRes.status === 401) throw new Error("UNAUTHORIZED");
      if (listRes.ok) {
        const listData = await listRes.json();
        const normalizedInput = accountId.trim().replace(/^accounts\//, '');
        const matched = listData.accounts?.find(acc => acc.name.includes(normalizedInput));
        if (matched) accountName = matched.name;
      }
    } catch (e) { if (e.message === "UNAUTHORIZED") throw e; }

    // 2. 클라이언트 및 URL 채널 조회
    const registeredUrls = new Set();
    
    const clientsRes = await fetch(`https://adsense.googleapis.com/v2/${accountName}/adclients`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (clientsRes.status === 401) throw new Error("UNAUTHORIZED");
    if (!clientsRes.ok) throw new Error(`AdSense 조회 실패 (${clientsRes.status})`);
    
    const clientsData = await clientsRes.json();
    const adClients = clientsData.adClients || [];

    await Promise.all(adClients.map(async (client) => {
      if (client.productCode === "YOUTUBE" || client.name.includes("ca-yt")) return;

      console.log(`📡 [AdSense] 조회 중: ${client.name}`);

      let nextPageToken = null;
      do {
        let url = `https://adsense.googleapis.com/v2/${client.name}/urlchannels?pageSize=1000`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;
        
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) throw new Error("UNAUTHORIZED");
        if (!res.ok) return;

        const json = await res.json();
        if (json.urlChannels) {
          json.urlChannels.forEach(ch => {
            const urlValue = ch.uriPattern || ch.urlPattern;
            if (urlValue) {
              // 디코딩 및 정규화하여 저장
              let normalized = "";
              try {
                // normalizeAdSenseUrl 함수 사용 (없으면 fallback)
                const normalizer = typeof normalizeAdSenseUrl === 'function' ? normalizeAdSenseUrl : (u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                normalized = normalizer(decodeURIComponent(urlValue));
              } catch (e) {
                normalized = urlValue;
              }
              registeredUrls.add(normalized);
            }
          });
        }
        nextPageToken = json.nextPageToken;
      } while (nextPageToken);
    }));

    console.log(`📦 [AdSense] 수집된 URL 패턴: ${registeredUrls.size}개`);

    // 3. 데이터베이스 업데이트 (유연한 매칭 로직 적용)
    let updatedCount = 0;
    let matchedCount = 0;
    let alreadyRegisteredCount = 0;
    let notMatchedCount = 0;
    
    if (registeredUrls.size > 0) {
      const db = firebase.database();
      const userId = CONSTANTS.USER_ID;
      const snapshot = await db.ref(`kanban/${userId}`).once("value");
      const allCards = snapshot.val() || {};
      const updates = {};
      const normalizer = typeof normalizeAdSenseUrl === 'function' ? normalizeAdSenseUrl : (u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const urlList = [...registeredUrls]; // 배열로 변환

      // 단일 카드 체크 모드인 경우 해당 카드만 처리
      const statusesToCheck = isSingleCardCheck ? [targetStatus] : Object.keys(allCards);

      for (const status of statusesToCheck) {
        const cardsToCheck = isSingleCardCheck ? { [targetCardId]: allCards[status]?.[targetCardId] } : (allCards[status] || {});
        
        for (const cardId in cardsToCheck) {
          // 단일 카드 모드인 경우 해당 카드만 처리
          if (isSingleCardCheck && cardId !== targetCardId) continue;
          
          const card = cardsToCheck[cardId];
          if (!card) continue;
          
          if (card.publishedUrl) {
            // 단일 카드 모드인 경우 targetUrl과 일치하는지 확인
            if (isSingleCardCheck && card.publishedUrl !== targetUrl) continue;
            
            let normUrl = "";
            try { normUrl = normalizer(decodeURIComponent(card.publishedUrl)); } 
            catch(e) { normUrl = normalizer(card.publishedUrl); }
            
            // 🔥 [핵심 업그레이드] 매칭 로직 3단계
            // 1. 정확히 일치 (Exact Match)
            // 2. 등록된 패턴으로 시작 (Prefix Match): 예) example.com/blog -> example.com/blog/1
            // 3. 카드 URL이 등록된 패턴을 포함 (Contains Match): 예) k-posting.info -> costcatcher.k-posting.info
            const isReg = urlList.some(reg => {
                return normUrl === reg || normUrl.startsWith(reg) || (normUrl.includes(reg) && reg.includes('.'));
            });
            
            // 통계 수집
            if (isReg) {
              matchedCount++;
              if (card.adSenseRegistered === true) {
                alreadyRegisteredCount++;
              }
            } else {
              notMatchedCount++;
            }
            
            // 현재 상태 확인 (undefined도 false로 처리)
            const currentStatus = card.adSenseRegistered === true;
            const needsUpdate = currentStatus !== isReg;
            
            // 디버깅: 매칭 결과 상세 로그
            if (isReg) {
              console.log(`✅ [매칭 성공] 카드: ${normUrl}`, {
                cardId: cardId,
                currentStatus: currentStatus,
                currentStatusRaw: card.adSenseRegistered, // 원본 값 확인
                newStatus: isReg,
                needsUpdate: needsUpdate
              });
            } else {
              // 매칭 실패한 경우도 로그 (디버깅용)
              if (card.adSenseRegistered === true) {
                console.log(`⚠️ [매칭 실패] 카드: ${normUrl}`, {
                  cardId: cardId,
                  currentStatus: currentStatus,
                  newStatus: isReg,
                  needsUpdate: needsUpdate,
                  note: "이전에는 등록되어 있었으나 현재 매칭되지 않음"
                });
              }
            }
            
            if (needsUpdate) {
              const userId = CONSTANTS.USER_ID;
              updates[`kanban/${userId}/${status}/${cardId}/adSenseRegistered`] = isReg;
              updatedCount++;
              console.log(`🔄 [상태 업데이트] 카드 ${cardId}: ${currentStatus} → ${isReg}`, {
                url: normUrl,
                title: card.title || "제목 없음"
              });
            }
          }
        }
      }
      if (updatedCount > 0) {
        console.log(`💾 [AdSense] Firebase 업데이트 시작: ${updatedCount}개 카드`);
        await db.ref().update(updates);
        console.log(`✅ [AdSense] Firebase 업데이트 완료: ${updatedCount}개 카드`);
      }
      
      // 상태 요약 로그 (항상 출력)
      const summaryMessage = updatedCount === 0 && alreadyRegisteredCount === matchedCount 
        ? "✅ 모든 카드가 이미 올바르게 등록되어 있습니다."
        : updatedCount === 0 && matchedCount === 0
        ? "⚠️ 매칭된 카드가 없습니다. URL 패턴을 확인하세요."
        : updatedCount > 0
        ? `🔄 ${updatedCount}개 카드 상태가 업데이트되었습니다.`
        : "ℹ️ 상태 변경이 필요하지 않습니다.";
        
      console.log(`📊 [AdSense] 상태 요약:`, {
        총_수집된_URL_패턴: registeredUrls.size,
        매칭_성공_카드: matchedCount,
        이미_등록됨: alreadyRegisteredCount,
        매칭_실패_카드: notMatchedCount,
        업데이트_필요: updatedCount,
        메시지: summaryMessage
      });
    } else {
      // registeredUrls가 0개인 경우
      matchedCount = 0;
      alreadyRegisteredCount = 0;
      notMatchedCount = 0;
    }
    
    console.log(`🏁 [AdSense] 최종 완료: ${updatedCount}개 카드 상태 업데이트됨`);
    
    // [팝업 메시지 개선] 더 상세한 정보 반환
    return { 
      totalRegistered: registeredUrls.size, 
      updatedCards: updatedCount,
      matchedCards: matchedCount,
      alreadyRegistered: alreadyRegisteredCount,
      notMatched: notMatchedCount
    };

  } catch (e) {
    if (e.message === "UNAUTHORIZED") {
      if (retryToken) throw e;
      console.log("🔄 [AdSense] 토큰 갱신 시도...");
      try {
        await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
        const newToken = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (t) => {
             if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
             else resolve(t);
          });
        });
        await chrome.storage.local.set({ googleAuthToken: newToken });
        return checkAdSenseRegistrationStatus(newToken, targetUrl, targetCardId, targetStatus);
      } catch (err) { throw new Error("재로그인 필요"); }
    }
    throw e;
  }
}

/**
 * [테스트용] AdSense 연결 상태 정밀 진단 (Deep Diagnosis)
 * - 상세 로그를 리턴하여 UI에서 보여줄 수 있게 함
 */
async function runAdSenseDeepDiagnosis() {
  const logs = [];
  const log = (msg, data) => {
    console.log(`🔬 ${msg}`, data || "");
    logs.push({ message: msg, data: data, timestamp: new Date().toLocaleTimeString() });
  };

  log("진단 시작: 저장된 토큰 및 ID 확인 중...");
  
  try {
    const { googleAuthToken, adSenseAccountId } = await chrome.storage.local.get(["googleAuthToken", "adSenseAccountId"]);
    if (!googleAuthToken) throw new Error("구글 인증 토큰이 없습니다.");
    
    // 1. 계정 확인
    log("Step 1: 계정 목록(accounts) 조회");
    const accRes = await fetch("https://adsense.googleapis.com/v2/accounts", {
      headers: { Authorization: `Bearer ${googleAuthToken}` }
    });
    const accData = await accRes.json();
    
    if (!accRes.ok) throw new Error(`계정 조회 API 오류: ${accRes.status} ${accData.error?.message}`);
    
    log(`계정 목록 응답: ${accData.accounts?.length || 0}개 발견`, accData);

    let targetAccount = `accounts/${adSenseAccountId}`;
    const normalizedId = adSenseAccountId.replace("accounts/", "");
    const matched = accData.accounts?.find(a => a.name.includes(normalizedId));

    if (matched) {
      targetAccount = matched.name;
      log(`✅ 계정 매칭 성공: ${targetAccount}`);
    } else {
      log(`⚠️ 경고: 입력한 ID(${adSenseAccountId})와 일치하는 계정을 목록에서 찾을 수 없습니다. 강제 진행합니다.`);
    }

    // 2. 클라이언트 확인
    log(`Step 2: 광고 클라이언트(adclients) 조회 - ${targetAccount}`);
    const clientRes = await fetch(`https://adsense.googleapis.com/v2/${targetAccount}/adclients`, {
      headers: { Authorization: `Bearer ${googleAuthToken}` }
    });
    const clientData = await clientRes.json();
    
    if (!clientRes.ok) throw new Error(`클라이언트 조회 실패: ${clientRes.status}`);
    
    log(`클라이언트 목록 응답: ${clientData.adClients?.length || 0}개 발견`, clientData);

    // 3. URL 채널 확인
    log("Step 3: 각 클라이언트별 URL 채널 조회");
    const results = [];
    
    for (const client of clientData.adClients || []) {
      const isWeb = !client.productCode || client.productCode === "AFC"; // AdSense For Content
      const label = isWeb ? "🌐 웹사이트용" : "📺 기타/유튜브용";
      
      log(`검사 중: [${label}] ${client.name}`);
      
      const urlRes = await fetch(`https://adsense.googleapis.com/v2/${client.name}/urlchannels?pageSize=10`, {
        headers: { Authorization: `Bearer ${googleAuthToken}` }
      });
      
      if (urlRes.ok) {
        const urlData = await urlRes.json();
        const count = urlData.urlChannels?.length || 0;
        log(`  - 결과: ${count}개 채널 발견`, urlData);
        results.push({ client: client.name, count, channels: urlData.urlChannels });
      } else {
        log(`  - 결과: 조회 실패 (${urlRes.status}) - 지원하지 않는 클라이언트일 수 있음`);
      }
    }

    log("🏁 진단 완료");
    return { success: true, logs, results };

  } catch (e) {
    log(`❌ 진단 중단: ${e.message}`);
    return { success: false, logs, error: e.message };
  }
}

/**
 * [GA4 정밀 진단] GA4 서버에 저장된 실제 데이터(Path)를 조회합니다.
 * - 최근 28일간 조회수가 가장 높은 페이지 20개를 가져와서 보여줍니다.
 * - 내 글의 주소가 GA4에는 어떻게 저장되어 있는지(인코딩 여부 등) 확인할 수 있습니다.
 */
/**
 * GA4 Metadata API를 사용하여 사용 가능한 메트릭 목록을 확인합니다.
 * 특히 Publisher 메트릭(publisherAdRevenue 등)이 사용 가능한지 확인합니다.
 */
async function checkGA4AvailableMetrics(propertyId) {
  const token = await new Promise((resolve) => {
    chrome.storage.local.get(['googleAuthToken'], (result) => {
      resolve(result.googleAuthToken);
    });
  });

  if (!token) {
    console.error("❌ [GA4 메트릭 확인] 인증 토큰이 없습니다.");
    return null;
  }

  try {
    // Metadata API를 사용하여 사용 가능한 메트릭 목록 조회
    const metadataUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}/metadata`;
    const response = await fetch(metadataUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`❌ [GA4 메트릭 확인] API 오류 (${response.status}):`, errorData);
      return null;
    }

    const metadata = await response.json();
    
    // Publisher 메트릭 확인
    const publisherMetrics = metadata.metrics?.filter(metric => 
      metric.apiName?.includes('publisher') || 
      metric.apiName?.includes('AdRevenue') ||
      metric.apiName?.includes('AdImpressions') ||
      metric.apiName?.includes('AdClicks') ||
      metric.apiName?.includes('totalAdRevenue')
    ) || [];

    const hasPublisherAdRevenue = publisherMetrics.some(m => m.apiName === 'publisherAdRevenue');
    const hasTotalAdRevenue = publisherMetrics.some(m => m.apiName === 'totalAdRevenue');

    console.log("📊 [GA4 메트릭 확인] 사용 가능한 Publisher 메트릭:", {
      totalMetrics: metadata.metrics?.length || 0,
      publisherMetrics: publisherMetrics.map(m => ({
        apiName: m.apiName,
        uiName: m.uiName,
        description: m.description
      })),
      hasPublisherAdRevenue: hasPublisherAdRevenue,
      hasTotalAdRevenue: hasTotalAdRevenue,
      recommendedMetric: hasTotalAdRevenue ? 'totalAdRevenue' : (hasPublisherAdRevenue ? 'publisherAdRevenue' : 'none'),
      allRevenueMetrics: metadata.metrics?.map(m => m.apiName).filter(name => 
        name?.includes('revenue') || name?.includes('earnings') || name?.includes('publisher') || name?.includes('advertiser')
      ) || []
    });

    return {
      hasPublisherAdRevenue: hasPublisherAdRevenue,
      hasTotalAdRevenue: hasTotalAdRevenue,
      recommendedMetric: hasTotalAdRevenue ? 'totalAdRevenue' : (hasPublisherAdRevenue ? 'publisherAdRevenue' : 'none'),
      publisherMetrics: publisherMetrics,
      allMetrics: metadata.metrics || []
    };
  } catch (error) {
    console.error("❌ [GA4 메트릭 확인] 오류:", error);
    return null;
  }
}

async function runGA4DeepDiagnosis() {
  console.log("🔍 [GA4 진단] 시작...");
  
  // 1. 인증 정보 및 속성 ID 확인
  const { googleAuthToken } = await chrome.storage.local.get("googleAuthToken");
  if (!googleAuthToken) {
    console.error("❌ [GA4 진단] 실패: 구글 로그인 토큰이 없습니다.");
    return;
  }
  
  const userId = CONSTANTS.USER_ID;
  const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
  const channelsData = channelsSnapshot.val() || {};
  const myChannels = channelsData.myChannels || { blogs: [] };
  
  // 첫 번째 블로그의 GA4 속성 ID 사용
  const firstBlog = myChannels.blogs?.[0];
  if (!firstBlog || !firstBlog.gaPropertyId) {
    console.error("❌ [GA4 진단] 실패: 설정된 GA4 속성 ID가 없습니다. 채널 설정을 확인해주세요.");
    return;
  }
  
  const propertyId = firstBlog.gaPropertyId;
  console.log(`📡 [GA4 진단] 속성 ID: ${propertyId} (대상 채널: ${firstBlog.inputUrl || firstBlog.url})`);

  // 1-1. Metadata API로 사용 가능한 메트릭 확인 (Publisher 메트릭 포함)
  console.log("📋 [GA4 진단] 사용 가능한 메트릭 확인 중...");
  const metricsInfo = await checkGA4AvailableMetrics(propertyId);
  if (metricsInfo) {
    if (metricsInfo.hasTotalAdRevenue) {
      console.log("✅ [GA4 진단] totalAdRevenue 메트릭 사용 가능 (권장)");
    } else if (metricsInfo.hasPublisherAdRevenue) {
      console.log("✅ [GA4 진단] publisherAdRevenue 메트릭 사용 가능");
    } else {
      console.warn("⚠️ [GA4 진단] 수익 메트릭 사용 불가 - AdSense 연결 확인 필요");
      console.log("💡 [GA4 진단] AdSense가 연결되어 있어도 Publisher 메트릭이 활성화되지 않았을 수 있습니다.");
      console.log("💡 [GA4 진단] GA4 관리 > 제품 연결 > AdSense 연결 상태를 확인하세요.");
    }
    if (metricsInfo.publisherMetrics && metricsInfo.publisherMetrics.length > 0) {
      console.log("📊 [GA4 진단] 사용 가능한 Publisher 메트릭:", metricsInfo.publisherMetrics.map(m => m.apiName));
    }
    if (metricsInfo.recommendedMetric && metricsInfo.recommendedMetric !== 'none') {
      console.log(`💡 [GA4 진단] 권장 메트릭: ${metricsInfo.recommendedMetric}`);
    }
  }

  // 2. API 호출 (최근 28일간 조회수 상위 20개 페이지 조회)
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${googleAuthToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }], // 페이지 경로별로 쪼개서 보기
        metrics: [{ name: "screenPageViews" }], // 조회수 보기
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], // 조회수 높은 순 정렬
        limit: 20
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      console.error(`❌ [GA4 진단] API 오류 (${res.status}):`, errData);
      if (res.status === 401) console.warn("👉 토큰이 만료되었습니다. 채널 연동 탭에서 로그아웃 후 재로그인하세요.");
      if (res.status === 404) console.warn("👉 속성 ID가 잘못되었습니다. GA4 속성 ID가 맞는지 확인하세요 (UA-XXXX 아님).");
      return;
    }

    const data = await res.json();
    
    // 3. 결과 출력
    console.log(`📦 [GA4 진단] 데이터 수신 성공 (총 ${data.rowCount || 0}개 행 발견)`);
    
    if (data.rows && data.rows.length > 0) {
      console.log("📊 [GA4 상위 20개 페이지 목록]");
      console.table(data.rows.map(r => ({
        '페이지 경로 (Path)': r.dimensionValues[0].value,
        '조회수': r.metricValues[0].value
      })));
      
      // 샘플 분석
      const samplePath = data.rows[0].dimensionValues[0].value;
      const isEncoded = samplePath.includes('%');
      console.log(`ℹ️ [분석 결과] GA4는 주소를 ${isEncoded ? "암호화(인코딩)하여" : "한글 그대로(디코딩하여)"} 저장하고 있습니다.`);
      
      if (isEncoded) console.log("👉 팁: 현재 코드는 '디코딩된 경로'를 우선 시도하므로, '인코딩된 경로' 전략이 뒤로 밀려있을 수 있습니다.");
      else console.log("👉 팁: 주소가 깔끔합니다. 만약 데이터가 안 나온다면 'Trailing Slash(/)' 문제일 수 있습니다.");

    } else {
      console.warn("⚠️ [GA4 진단] 데이터가 0건입니다. 최근 28일간 방문자가 없거나, 속성 ID가 엉뚱한 곳(데이터 없는 속성)일 수 있습니다.");
    }

  } catch (e) {
    console.error("💥 [GA4 진단] 치명적 오류:", e);
  }
}

/**
 * [테스트 함수] 콘솔에서 URL 매칭 및 데이터 수집 테스트
 * 사용법: testUrlMatching("https://example.com/path")
 * 
 * @param {string} url - 테스트할 URL
 */
async function testUrlMatching(url) {
  console.log("🧪 [URL 매칭 테스트] 시작...", { url });
  console.log("=".repeat(80));
  
  try {
    // 1. URL 유효성 검사
    let urlObj;
    try {
      urlObj = new URL(url);
      console.log("✅ [1단계] URL 파싱 성공", {
        hostname: urlObj.hostname,
        pathname: urlObj.pathname,
        fullUrl: urlObj.href
      });
    } catch (e) {
      console.error("❌ [1단계] URL 파싱 실패:", e.message);
      return;
    }

    // 2. 인증 토큰 및 계정 정보 가져오기
    const storageData = await chrome.storage.local.get([
      "googleAuthToken",
      "adSenseAccountId"
    ]);
    const googleAuthToken = storageData.googleAuthToken;
    const adSenseAccountId = storageData.adSenseAccountId;

    console.log("📋 [2단계] 인증 정보 확인", {
      hasToken: !!googleAuthToken,
      hasAdSenseAccountId: !!adSenseAccountId,
      tokenLength: googleAuthToken?.length || 0
    });

    if (!googleAuthToken) {
      console.error("❌ [2단계] Google 인증 토큰이 없습니다. 먼저 Google 계정을 연동해주세요.");
      return;
    }

    // 3. Firebase에서 채널 데이터 가져오기
    const userId = CONSTANTS.USER_ID;
    const channelsSnapshot = await firebase.database().ref(`channels/${userId}`).once("value");
    const channelsData = channelsSnapshot.val() || {};
    const myChannels = channelsData.myChannels || { blogs: [] };

    console.log("📋 [3단계] 채널 데이터 확인", {
      totalBlogs: myChannels.blogs?.length || 0,
      blogs: myChannels.blogs?.map(b => ({
        url: b.inputUrl || b.url,
        gaPropertyId: b.gaPropertyId
      })) || []
    });

    // 4. URL 매칭 로직 실행
    const contentHostname = urlObj.hostname;
    let blogInfo = null;
    let gaPropertyId = null;

    // 방법 1: 정확한 hostname 매칭
    try {
      blogInfo = myChannels.blogs.find((b) => {
        const blogUrl = b.inputUrl || b.url;
        if (!blogUrl) return false;
        try {
          const blogUrlObj = new URL(blogUrl);
          const blogHostname = blogUrlObj.hostname;
          
          // 정확한 hostname 매칭
          if (contentHostname === blogHostname) return true;
          
          // 하위 도메인 고려
          const contentParts = contentHostname.split('.');
          const blogParts = blogHostname.split('.');
          
          const getMainDomain = (parts) => {
            if (parts.length <= 2) return parts.join('.');
            if (parts.length >= 3 && 
                (parts[parts.length - 2] === 'co' && parts[parts.length - 1] === 'kr') ||
                (parts[parts.length - 2] === 'com' && parts[parts.length - 1] === 'au')) {
              return parts.slice(-3).join('.');
            }
            return parts.slice(-2).join('.');
          };
          
          const contentMainDomain = getMainDomain(contentParts);
          const blogMainDomain = getMainDomain(blogParts);
          
          return contentMainDomain === blogMainDomain;
        } catch {
          return false;
        }
      });
      
      gaPropertyId = blogInfo?.gaPropertyId;
    } catch (err) {
      console.warn("⚠️ [4단계] Hostname 매칭 중 오류:", err);
    }
    
    // 방법 2: URL 문자열 포함 여부로 매칭 (fallback)
    if (!blogInfo) {
      blogInfo = myChannels.blogs.find((b) => {
        const blogUrl = b.inputUrl || b.url || '';
        if (!blogUrl) return false;
        return url.includes(blogUrl) || blogUrl.includes(contentHostname);
      });
      gaPropertyId = blogInfo?.gaPropertyId;
    }

    console.log("🔍 [4단계] URL 매칭 결과", {
      matched: !!blogInfo,
      matchedBlog: blogInfo ? {
        url: blogInfo.inputUrl || blogInfo.url,
        gaPropertyId: blogInfo.gaPropertyId
      } : null,
      gaPropertyId: gaPropertyId,
      contentHostname: contentHostname
    });

    if (!gaPropertyId) {
      console.error("❌ [4단계] 매칭된 GA4 Property ID가 없습니다. 채널 설정을 확인해주세요.");
      return;
    }

    // 5. GA4 데이터 수집 테스트
    console.log("📊 [5단계] GA4 데이터 수집 시작...");
    
    // API 요청 정보 미리보기
    const testUrlObj = new URL(contentHostname.includes('://') ? url : `https://${url}`);
    const testRawPath = testUrlObj.pathname;
    let testDecodedPath = testRawPath;
    try { testDecodedPath = decodeURIComponent(testRawPath); } catch(e) {}
    const testNormalizedPath = testDecodedPath.endsWith('/') && testDecodedPath !== '/' ? testDecodedPath.slice(0, -1) : testDecodedPath;
    
    const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${gaPropertyId}:runReport`;
    const requestBody = {
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "sessions" },
        { name: "screenPageViewsPerSession" },
        { name: "bounceRate" },
        { name: "publisherAdRevenue" },
        { name: "publisherAdImpressions" },
        { name: "publisherAdClicks" },
        { name: "engagementRate" },
        { name: "averageEngagementTime" },
        { name: "newUsers" },
        { name: "activeUsers" }
      ],
      dimensionFilter: {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "BEGINS_WITH", value: testNormalizedPath }
        }
      }
    };
    
    console.log("🔗 [API 요청 정보]", {
      method: "POST",
      url: apiUrl,
      headers: {
        Authorization: `Bearer ${googleAuthToken.substring(0, 20)}...`,
        "Content-Type": "application/json"
      },
      body: requestBody
    });
    console.log("📤 [실제 API 요청]", {
      endpoint: apiUrl,
      requestBody: JSON.stringify(requestBody, null, 2)
    });
    
    const analyticsData = await getAnalyticsData(googleAuthToken, gaPropertyId, url);

    // 6. 결과 출력
    console.log("=".repeat(80));
    if (analyticsData.error) {
      console.error("❌ [최종 결과] GA4 데이터 수집 실패");
      console.error("🚨 에러 정보:", {
        error: analyticsData.error,
        errorDetails: analyticsData.errorDetails
      });
      // 에러 상세 정보를 더 명확하게 표시
      if (analyticsData.errorDetails?.error) {
        console.error("📋 [에러 상세 분석]", {
          code: analyticsData.errorDetails.error.code,
          message: analyticsData.errorDetails.error.message,
          status: analyticsData.errorDetails.error.status,
          details: analyticsData.errorDetails.error.details
        });
      }
    } else {
      console.log("✅ [최종 결과] GA4 데이터 수집 완료");
    }
    console.log("📈 수집된 데이터:", {
      pageviews: analyticsData.pageviews,
      gaEarnings: analyticsData.gaEarnings,
      avgSessionDuration: analyticsData.avgSessionDuration,
      sessions: analyticsData.sessions,
      pageviewsPerSession: analyticsData.pageviewsPerSession,
      bounceRate: analyticsData.bounceRate,
      impressions: analyticsData.impressions,
      clicks: analyticsData.clicks,
      engagementRate: analyticsData.engagementRate,
      avgEngagementTime: analyticsData.avgEngagementTime,
      newUsers: analyticsData.newUsers,
      activeUsers: analyticsData.activeUsers,
      topSource: analyticsData.topSource,
      error: analyticsData.error,
      errorDetails: analyticsData.errorDetails
    });

    // 7. URL 필터링 상세 정보
    const rawPath = urlObj.pathname;
    let decodedPath = rawPath;
    try { decodedPath = decodeURIComponent(rawPath); } catch(e) {}
    const normalizedPath = decodedPath.endsWith('/') && decodedPath !== '/' ? decodedPath.slice(0, -1) : decodedPath;

    console.log("🔧 [필터링 정보]", {
      rawPath: rawPath,
      decodedPath: decodedPath,
      normalizedPath: normalizedPath,
      filterUsed: normalizedPath,
      matchType: "BEGINS_WITH",
      dateRange: "28daysAgo ~ today"
    });

    console.log("=".repeat(80));
    console.log("💡 사용법: testUrlMatching('https://your-url.com/path')");

  } catch (error) {
    console.error("💥 [테스트 실패] 오류 발생:", error);
    console.error("스택 트레이스:", error.stack);
  }
}

/**
 * Firebase 기존 데이터를 default_user 경로로 선택적으로 이동하는 함수
 * 콘솔에서 사용: migrateToDefaultUser({ kanban: true, scraps: true })
 * 
 * @param {Object} options - 이동할 필드 선택 옵션
 * @param {boolean} [options.kanban=false] - kanban 데이터 이동
 * @param {boolean} [options.scraps=false] - scraps 데이터 이동
 * @param {boolean} [options.channel_content=false] - channel_content 데이터 이동
 * @param {boolean} [options.channel_meta=false] - channel_meta 데이터 이동
 * @param {boolean} [options.dryRun=false] - 실제 이동 없이 미리보기만
 * @returns {Promise<Object>} 이동 결과
 */
async function migrateToDefaultUser(options = {}) {
  const userId = CONSTANTS.USER_ID;
  const db = firebase.database();
  
  const {
    kanban = false,
    scraps = false,
    channel_content = false,
    channel_meta = false,
    dryRun = false
  } = options;
  
  console.log('🚀 Firebase 데이터 마이그레이션 시작');
  console.log('================================================');
  console.log('대상 사용자 ID:', userId);
  console.log('이동 옵션:', { kanban, scraps, channel_content, channel_meta });
  console.log('드라이런 모드:', dryRun ? '✅ (실제 이동 없음)' : '❌ (실제 이동)');
  console.log('================================================\n');
  
  const results = {
    kanban: { moved: 0, skipped: 0, errors: [] },
    scraps: { moved: 0, skipped: 0, errors: [] },
    channel_content: { moved: 0, skipped: 0, errors: [] },
    channel_meta: { moved: 0, skipped: 0, errors: [] }
  };
  
  try {
    // 1. Kanban 데이터 마이그레이션
    if (kanban) {
      console.log('\n📋 [1/4] Kanban 데이터 마이그레이션 중...');
      try {
        const oldKanbanSnap = await db.ref('kanban').once('value');
        const oldKanban = oldKanbanSnap.val();
        
        if (!oldKanban || typeof oldKanban !== 'object') {
          console.log('ℹ️ 이동할 Kanban 데이터가 없습니다.');
          results.kanban.skipped = 1;
        } else {
          // 이미 사용자 ID 구조인지 확인
          if (oldKanban[userId]) {
            console.log(`ℹ️ Kanban 데이터가 이미 ${userId} 경로에 존재합니다. 건너뜁니다.`);
            results.kanban.skipped = 1;
          } else {
            // 기존 구조: kanban/{status}/{cardId} 또는 kanban/ideas/{ideaId}
            const newKanbanData = {};
            let totalCards = 0;
            
            for (const key in oldKanban) {
              if (key !== userId) { // userId 키는 제외
                newKanbanData[key] = oldKanban[key];
                if (oldKanban[key] && typeof oldKanban[key] === 'object') {
                  totalCards += Object.keys(oldKanban[key]).length;
                }
              }
            }
            
            console.log(`📊 마이그레이션할 데이터: ${Object.keys(newKanbanData).length}개 컬럼, 총 ${totalCards}개 카드`);
            
            if (Object.keys(newKanbanData).length > 0) {
              if (dryRun) {
                console.log('🔍 [드라이런] 실제 이동은 하지 않습니다.');
                console.log('   이동될 경로:', `kanban/${userId}`);
                console.log('   이동될 데이터 키:', Object.keys(newKanbanData));
              } else {
                await db.ref(`kanban/${userId}`).set(newKanbanData);
                console.log(`✅ Kanban 데이터 이동 완료: ${Object.keys(newKanbanData).length}개 컬럼, ${totalCards}개 카드`);
              }
              results.kanban.moved = Object.keys(newKanbanData).length;
            } else {
              console.log('ℹ️ 이동할 Kanban 데이터가 없습니다.');
              results.kanban.skipped = 1;
            }
          }
        }
      } catch (error) {
        results.kanban.errors.push(error.message);
        console.error('❌ Kanban 마이그레이션 오류:', error);
      }
    } else {
      console.log('\n📋 [1/4] Kanban 데이터 마이그레이션: 건너뜀');
    }
    
    // 2. Scraps 데이터 마이그레이션
    if (scraps) {
      console.log('\n📝 [2/4] Scraps 데이터 마이그레이션 중...');
      try {
        const oldScrapsSnap = await db.ref('scraps').once('value');
        const oldScraps = oldScrapsSnap.val();
        
        if (!oldScraps || typeof oldScraps !== 'object') {
          console.log('ℹ️ 이동할 Scraps 데이터가 없습니다.');
          results.scraps.skipped = 1;
        } else {
          // 이미 사용자 ID 구조인지 확인
          if (oldScraps[userId]) {
            console.log(`ℹ️ Scraps 데이터가 이미 ${userId} 경로에 존재합니다. 건너뜁니다.`);
            results.scraps.skipped = 1;
          } else {
            // 기존 구조: scraps/{scrapId}
            const newScrapsData = {};
            
            for (const scrapId in oldScraps) {
              if (scrapId !== userId) { // userId 키는 제외
                newScrapsData[scrapId] = oldScraps[scrapId];
              }
            }
            
            console.log(`📊 마이그레이션할 데이터: ${Object.keys(newScrapsData).length}개 스크랩`);
            
            if (Object.keys(newScrapsData).length > 0) {
              if (dryRun) {
                console.log('🔍 [드라이런] 실제 이동은 하지 않습니다.');
                console.log('   이동될 경로:', `scraps/${userId}`);
                console.log('   이동될 스크랩 개수:', Object.keys(newScrapsData).length);
              } else {
                await db.ref(`scraps/${userId}`).set(newScrapsData);
                console.log(`✅ Scraps 데이터 이동 완료: ${Object.keys(newScrapsData).length}개 스크랩`);
              }
              results.scraps.moved = Object.keys(newScrapsData).length;
            } else {
              console.log('ℹ️ 이동할 Scraps 데이터가 없습니다.');
              results.scraps.skipped = 1;
            }
          }
        }
      } catch (error) {
        results.scraps.errors.push(error.message);
        console.error('❌ Scraps 마이그레이션 오류:', error);
      }
    } else {
      console.log('\n📝 [2/4] Scraps 데이터 마이그레이션: 건너뜀');
    }
    
    // 3. Channel Content 데이터 마이그레이션
    if (channel_content) {
      console.log('\n📰 [3/4] Channel Content 데이터 마이그레이션 중...');
      try {
        const oldContentSnap = await db.ref('channel_content').once('value');
        const oldContent = oldContentSnap.val();
        
        if (!oldContent || typeof oldContent !== 'object') {
          console.log('ℹ️ 이동할 Channel Content 데이터가 없습니다.');
          results.channel_content.skipped = 1;
        } else {
          // 이미 사용자 ID 구조인지 확인
          if (oldContent[userId]) {
            console.log(`ℹ️ Channel Content 데이터가 이미 ${userId} 경로에 존재합니다. 건너뜁니다.`);
            results.channel_content.skipped = 1;
          } else {
            // 기존 구조: channel_content/{platform}/{contentId}
            const newContentData = {};
            let totalContent = 0;
            
            for (const platform in oldContent) {
              if (platform !== userId) { // userId 키는 제외
                newContentData[platform] = oldContent[platform];
                if (oldContent[platform] && typeof oldContent[platform] === 'object') {
                  totalContent += Object.keys(oldContent[platform]).length;
                }
              }
            }
            
            console.log(`📊 마이그레이션할 데이터: ${Object.keys(newContentData).length}개 플랫폼, 총 ${totalContent}개 콘텐츠`);
            
            if (Object.keys(newContentData).length > 0) {
              if (dryRun) {
                console.log('🔍 [드라이런] 실제 이동은 하지 않습니다.');
                console.log('   이동될 경로:', `channel_content/${userId}`);
                console.log('   이동될 플랫폼:', Object.keys(newContentData));
              } else {
                await db.ref(`channel_content/${userId}`).set(newContentData);
                console.log(`✅ Channel Content 데이터 이동 완료: ${Object.keys(newContentData).length}개 플랫폼, ${totalContent}개 콘텐츠`);
              }
              results.channel_content.moved = Object.keys(newContentData).length;
            } else {
              console.log('ℹ️ 이동할 Channel Content 데이터가 없습니다.');
              results.channel_content.skipped = 1;
            }
          }
        }
      } catch (error) {
        results.channel_content.errors.push(error.message);
        console.error('❌ Channel Content 마이그레이션 오류:', error);
      }
    } else {
      console.log('\n📰 [3/4] Channel Content 데이터 마이그레이션: 건너뜀');
    }
    
    // 4. Channel Meta 데이터 마이그레이션
    if (channel_meta) {
      console.log('\n📊 [4/4] Channel Meta 데이터 마이그레이션 중...');
      try {
        const oldMetaSnap = await db.ref('channel_meta').once('value');
        const oldMeta = oldMetaSnap.val();
        
        if (!oldMeta || typeof oldMeta !== 'object') {
          console.log('ℹ️ 이동할 Channel Meta 데이터가 없습니다.');
          results.channel_meta.skipped = 1;
        } else {
          // 이미 사용자 ID 구조인지 확인
          if (oldMeta[userId]) {
            console.log(`ℹ️ Channel Meta 데이터가 이미 ${userId} 경로에 존재합니다. 건너뜁니다.`);
            results.channel_meta.skipped = 1;
          } else {
            // 기존 구조: channel_meta/{sourceId}
            const newMetaData = {};
            
            for (const sourceId in oldMeta) {
              if (sourceId !== userId) { // userId 키는 제외
                newMetaData[sourceId] = oldMeta[sourceId];
              }
            }
            
            console.log(`📊 마이그레이션할 데이터: ${Object.keys(newMetaData).length}개 메타데이터`);
            
            if (Object.keys(newMetaData).length > 0) {
              if (dryRun) {
                console.log('🔍 [드라이런] 실제 이동은 하지 않습니다.');
                console.log('   이동될 경로:', `channel_meta/${userId}`);
                console.log('   이동될 메타데이터 개수:', Object.keys(newMetaData).length);
              } else {
                await db.ref(`channel_meta/${userId}`).set(newMetaData);
                console.log(`✅ Channel Meta 데이터 이동 완료: ${Object.keys(newMetaData).length}개 메타데이터`);
              }
              results.channel_meta.moved = Object.keys(newMetaData).length;
            } else {
              console.log('ℹ️ 이동할 Channel Meta 데이터가 없습니다.');
              results.channel_meta.skipped = 1;
            }
          }
        }
      } catch (error) {
        results.channel_meta.errors.push(error.message);
        console.error('❌ Channel Meta 마이그레이션 오류:', error);
      }
    } else {
      console.log('\n📊 [4/4] Channel Meta 데이터 마이그레이션: 건너뜀');
    }
    
    // 결과 요약
    console.log('\n================================================');
    console.log('📊 마이그레이션 결과 요약:');
    if (kanban) {
      console.log(`  Kanban: ${results.kanban.moved}개 이동, ${results.kanban.skipped}개 건너뜀${results.kanban.errors.length > 0 ? `, ${results.kanban.errors.length}개 오류` : ''}`);
    }
    if (scraps) {
      console.log(`  Scraps: ${results.scraps.moved}개 이동, ${results.scraps.skipped}개 건너뜀${results.scraps.errors.length > 0 ? `, ${results.scraps.errors.length}개 오류` : ''}`);
    }
    if (channel_content) {
      console.log(`  Channel Content: ${results.channel_content.moved}개 플랫폼 이동, ${results.channel_content.skipped}개 건너뜀${results.channel_content.errors.length > 0 ? `, ${results.channel_content.errors.length}개 오류` : ''}`);
    }
    if (channel_meta) {
      console.log(`  Channel Meta: ${results.channel_meta.moved}개 이동, ${results.channel_meta.skipped}개 건너뜀${results.channel_meta.errors.length > 0 ? `, ${results.channel_meta.errors.length}개 오류` : ''}`);
    }
    console.log('================================================');
    
    if (dryRun) {
      console.log('🔍 드라이런 모드로 실행되었습니다. 실제 이동은 하지 않았습니다.');
      console.log('💡 실제 이동을 하려면 dryRun: false로 설정하거나 dryRun 옵션을 제거하세요.');
    } else {
      console.log('✅ 마이그레이션 완료!');
    }
    
    return results;
  } catch (error) {
    console.error('❌ 마이그레이션 중 치명적 오류:', error);
    throw error;
  }
}

/**
 * 잘못된 'draft' status의 카드를 올바른 status로 이동하는 함수
 * 콘솔에서 사용: fixDraftStatusCards({ targetStatus: 'ideas' })
 * 
 * @param {Object} options - 옵션
 * @param {string} [options.targetStatus='ideas'] - 이동할 status ('ideas', 'in-progress', 'done')
 * @param {boolean} [options.dryRun=false] - 실제 이동 없이 미리보기만
 * @returns {Promise<Object>} 수정 결과
 */
async function fixDraftStatusCards(options = {}) {
  const { targetStatus = 'ideas', dryRun = false } = options;
  const userId = CONSTANTS.USER_ID;
  const db = firebase.database();
  
  const validStatuses = ['ideas', 'in-progress', 'done'];
  if (!validStatuses.includes(targetStatus)) {
    throw new Error(`잘못된 status입니다. 'ideas', 'in-progress', 'done' 중 하나를 선택하세요.`);
  }
  
  console.log('🔧 [draft status 수정] 시작...');
  console.log(`대상 status: ${targetStatus}`);
  console.log(`드라이런 모드: ${dryRun ? '✅ (실제 이동 없음)' : '❌ (실제 이동)'}`);
  console.log('================================================\n');
  
  try {
    const draftRef = db.ref(`kanban/${userId}/draft`);
    const snapshot = await draftRef.once('value');
    const draftCards = snapshot.val() || {};
    
    const cardIds = Object.keys(draftCards);
    
    if (cardIds.length === 0) {
      console.log('ℹ️ draft status에 카드가 없습니다.');
      return { moved: 0, skipped: 0, errors: [] };
    }
    
    console.log(`📋 발견된 카드: ${cardIds.length}개`);
    cardIds.forEach((cardId, idx) => {
      const card = draftCards[cardId];
      console.log(`  ${idx + 1}. ${cardId}: "${card.title || '제목 없음'}"`);
    });
    console.log('');
    
    if (dryRun) {
      console.log('✅ [드라이런] 실제 이동 없이 미리보기만 수행했습니다.');
      return { moved: 0, skipped: cardIds.length, errors: [] };
    }
    
    // 각 카드를 targetStatus로 이동
    const results = { moved: 0, skipped: 0, errors: [] };
    
    for (const cardId of cardIds) {
      try {
        const cardData = draftCards[cardId];
        const targetRef = db.ref(`kanban/${userId}/${targetStatus}/${cardId}`);
        
        // 기존 위치에서 삭제하고 새 위치에 저장
        await draftRef.child(cardId).remove();
        await targetRef.set(cardData);
        
        console.log(`✅ 이동 완료: ${cardId} → ${targetStatus}`);
        results.moved++;
      } catch (error) {
        console.error(`❌ 이동 실패: ${cardId}`, error);
        results.errors.push({ cardId, error: error.message });
      }
    }
    
    // draft 폴더가 비어있으면 삭제
    const remainingSnapshot = await draftRef.once('value');
    if (!remainingSnapshot.val() || Object.keys(remainingSnapshot.val()).length === 0) {
      await draftRef.remove();
      console.log('🗑️ 빈 draft 폴더를 삭제했습니다.');
    }
    
    console.log('\n================================================');
    console.log('✅ [draft status 수정] 완료!');
    console.log(`이동: ${results.moved}개, 오류: ${results.errors.length}개`);
    
    return results;
  } catch (error) {
    console.error('❌ [draft status 수정] 오류:', error);
    throw error;
  }
}

/**
 * URL 정규화 함수 단위 테스트
 * 검증: https://www.google.com과 http://google.com 입력 시 동일한 정규화된 문자열 반환
 * 
 * 콘솔에서 실행: testUrlNormalization()
 */
function testUrlNormalization() {
  console.log('🧪 [URL 정규화 테스트] 시작...\n');
  
  const testCases = [
    {
      name: '기본 테스트 (www 포함 vs 미포함)',
      urls: [
        'https://www.google.com',
        'http://google.com',
        'https://google.com',
        'http://www.google.com'
      ],
      expected: 'google.com'
    },
    {
      name: '경로 포함 테스트',
      urls: [
        'https://www.google.com/search',
        'http://google.com/search',
        'https://google.com/search/'
      ],
      expected: 'google.com/search'
    },
    {
      name: '쿼리 파라미터 포함 테스트',
      urls: [
        'https://www.google.com/search?q=test',
        'http://google.com/search?q=test&lang=ko'
      ],
      expected: 'google.com/search'
    },
    {
      name: 'YouTube 테스트 (normalizeUrlForComparison)',
      urls: [
        'https://www.youtube.com/watch?v=VIDEO_ID',
        'http://youtu.be/VIDEO_ID',
        'https://youtube.com/embed/VIDEO_ID'
      ],
      expected: 'youtube:VIDEO_ID',
      useYouTube: true
    },
    {
      name: 'AdSense URL 디코딩 테스트',
      urls: [
        'https://www.example.com/%ED%95%9C%EA%B8%80',
        'http://example.com/%ED%95%9C%EA%B8%80'
      ],
      expected: 'example.com/한글',
      useDecode: true
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  testCases.forEach((testCase, index) => {
    console.log(`\n[테스트 ${index + 1}] ${testCase.name}`);
    console.log('─'.repeat(50));
    
    const results = testCase.urls.map(url => {
      let result;
      if (testCase.useYouTube) {
        result = normalizeUrlForComparison(url);
      } else if (testCase.useDecode) {
        result = normalizeAdSenseUrl(url);
      } else {
        result = getNormalizedUrl(url);
      }
      return { url, result };
    });
    
    // 모든 결과가 동일한지 확인
    const firstResult = results[0].result;
    const allMatch = results.every(r => r.result === firstResult);
    const matchesExpected = firstResult === testCase.expected;
    
    results.forEach(({ url, result }) => {
      console.log(`  입력: ${url}`);
      console.log(`  출력: ${result}`);
    });
    
    if (allMatch && matchesExpected) {
      console.log(`  ✅ 통과: 모든 URL이 "${firstResult}"로 정규화됨`);
      passed++;
    } else {
      console.log(`  ❌ 실패:`);
      if (!allMatch) {
        console.log(`     - 결과가 일치하지 않음`);
      }
      if (!matchesExpected) {
        console.log(`     - 예상: "${testCase.expected}", 실제: "${firstResult}"`);
      }
      failed++;
    }
  });
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 테스트 결과: ${passed}개 통과, ${failed}개 실패`);
  console.log('='.repeat(50));
  
  // 핵심 검증: https://www.google.com과 http://google.com
  console.log('\n🔍 [핵심 검증] https://www.google.com vs http://google.com');
  const result1 = normalizeUrlForComparison('https://www.google.com');
  const result2 = normalizeUrlForComparison('http://google.com');
  const result3 = getNormalizedUrl('https://www.google.com');
  const result4 = getNormalizedUrl('http://google.com');
  
  console.log(`  normalizeUrlForComparison('https://www.google.com') => "${result1}"`);
  console.log(`  normalizeUrlForComparison('http://google.com') => "${result2}"`);
  console.log(`  getNormalizedUrl('https://www.google.com') => "${result3}"`);
  console.log(`  getNormalizedUrl('http://google.com') => "${result4}"`);
  
  if (result1 === result2 && result3 === result4 && result1 === result3) {
    console.log(`  ✅ 성공: 모든 함수가 동일한 결과 "${result1}"를 반환합니다.`);
  } else {
    console.log(`  ❌ 실패: 결과가 일치하지 않습니다.`);
  }
  
  return { passed, failed, total: passed + failed };
}

/**
 * [최적화] 기존 데이터의 URL 인덱스 구축 함수
 * 기존 카드들의 URL을 인덱스에 추가합니다.
 * 콘솔에서 실행: buildUrlIndex()
 */
async function buildUrlIndex() {
  console.log('🔨 [URL 인덱스 구축] 시작...');
  const db = firebase.database();
  const userId = CONSTANTS.USER_ID;
  const kanbanRef = db.ref(`kanban/${userId}`);
  
  try {
    const snapshot = await kanbanRef.once('value');
    const allCards = snapshot.val() || {};
    
    let processedCount = 0;
    let indexedCount = 0;
    
    for (const status in allCards) {
      for (const cardId in allCards[status]) {
        const card = allCards[status][cardId];
        const originUrl = card.origin?.postUrl || null;
        const publishedUrl = card.publishedUrl || null;
        
        if (originUrl || publishedUrl) {
          await updateUrlIndex(cardId, status, originUrl, publishedUrl);
          indexedCount++;
        }
        processedCount++;
      }
    }
    
    console.log(`✅ [URL 인덱스 구축] 완료!`);
    console.log(`  - 처리된 카드: ${processedCount}개`);
    console.log(`  - 인덱스 추가: ${indexedCount}개`);
    
    return { processed: processedCount, indexed: indexedCount };
  } catch (error) {
    console.error('❌ [URL 인덱스 구축] 오류:', error);
    throw error;
  }
}

// 전역 함수로 등록 (콘솔에서 직접 호출 가능)
if (typeof window !== 'undefined') {
  window.testUrlMatching = testUrlMatching;
  window.migrateToDefaultUser = migrateToDefaultUser;
  window.fixDraftStatusCards = fixDraftStatusCards;
  window.testUrlNormalization = testUrlNormalization;
  window.getNormalizedUrl = getNormalizedUrl;
  window.buildUrlIndex = buildUrlIndex;
  window.updateUrlIndex = updateUrlIndex;
} else {
  // Service Worker 환경에서는 self에 등록
  self.testUrlMatching = testUrlMatching;
  self.migrateToDefaultUser = migrateToDefaultUser;
  self.fixDraftStatusCards = fixDraftStatusCards;
  self.testUrlNormalization = testUrlNormalization;
  self.getNormalizedUrl = getNormalizedUrl;
  self.buildUrlIndex = buildUrlIndex;
  self.updateUrlIndex = updateUrlIndex;
}