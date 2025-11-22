// js/services/aiService.js
// Gemini API 관련 서비스

/**
 * UI에 에러 메시지를 전송하는 헬퍼 함수
 * @param {string} errorType - 에러 타입
 * @param {string} message - 에러 메시지
 */
async function sendErrorToUI(errorType, message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: "show_error_toast",
        errorType: errorType,
        message: message,
      }, () => {
        if (chrome.runtime.lastError) {
          // 수신자가 없거나 탭이 닫힌 경우 조용히 무시
        }
      });
    }
  } catch (e) {
    // 에러 전송 실패는 조용히 무시
  }
}

/**
 * Gemini API를 호출하는 함수
 * @param {string} prompt - AI에게 전달할 프롬프트
 * @returns {Promise<string>} AI 응답 텍스트
 */
export async function callGeminiAPI(prompt) {
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

console.log('[System] aiService 모듈 로드 완료');

