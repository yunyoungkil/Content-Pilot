/**
 * thumbnailGenerator.js
 *
 * PRD v2.7: 범용 캔버스 렌더러 기능 확장 (Shape & Gradient Rendering)
 * - v2.3 템플릿 하위 호환성 (절대 픽셀 좌표)
 * - v2.4+ 템플릿 반응형 렌더링 (비율 좌표)
 * - v2.7 Shape 레이어 렌더링 지원 (rect, circle)
 * - TemplateDataSchema JSON → Canvas 2D Context 렌더링
 */

/**
 * [Visual Engine v2.0] 자동 색상 보정 (Auto Color Grading)
 * 배경이 어두우면 텍스트를 밝게, 배경이 밝으면 텍스트를 어둡게 자동 조정합니다.
 * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
 * @param {number} x - 텍스트 X 좌표
 * @param {number} y - 텍스트 Y 좌표
 * @param {number} width - 텍스트 너비
 * @param {number} height - 텍스트 높이
 * @returns {string|null} 조정된 색상 (#FFFFFF 또는 #000000), 실패 시 null
 */
function adjustTextColorForBackground(ctx, x, y, width, height) {
  // 텍스트가 그려질 영역의 배경 밝기 분석
  try {
    // 텍스트 영역 주변 샘플링 (텍스트 위치 기준으로 약간 확장)
    const samplePadding = Math.max(10, height * 0.2);
    const sampleX = Math.max(0, x - samplePadding);
    const sampleY = Math.max(0, y - samplePadding);
    const sampleWidth = Math.min(ctx.canvas.width - sampleX, width + samplePadding * 2);
    const sampleHeight = Math.min(ctx.canvas.height - sampleY, height + samplePadding * 2);
    
    const imageData = ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
    const data = imageData.data;
    let r, g, b, avg;
    let colorSum = 0;
    let pixelCount = 0;

    for (let i = 0, len = data.length; i < len; i += 4) {
      r = data[i];
      g = data[i + 1];
      b = data[i + 2];
      // 알파 채널은 무시 (투명도 고려)
      avg = Math.floor((r + g + b) / 3);
      colorSum += avg;
      pixelCount++;
    }

    if (pixelCount === 0) return null;
    
    const brightness = Math.floor(colorSum / pixelCount);
    // 밝기(0~255)가 128보다 낮으면(어두우면) 흰색 텍스트, 높으면 검은색 텍스트 리턴
    return brightness < 128 ? "#FFFFFF" : "#000000";
  } catch (e) {
    console.warn("[Color Adjust] 색상 보정 실패:", e);
    return null; // 오류 시 null 반환 (기본 색상 사용)
  }
}

/**
 * [PRD v3.2 TR-1] 캔버스 렌더링 헬퍼 함수
 */
const renderHelpers = {
  /**
   * [TR-1] 공통 좌표 변환 헬퍼 (v2.3 절대 좌표 vs v2.4+ 비율 좌표)
   * @param {number} value - x, y, width, height 등의 값
   * @param {number} canvasSize - canvasWidth 또는 canvasHeight
   * @returns {number} 절대 픽셀 값
   */
  convertCoordinate: (value, canvasSize) => {
    if (!value) return 0;
    // v2.3 하위 호환성: 값이 1보다 크면 절대 픽셀로 간주
    return value > 1 ? value : value * canvasSize;
  },

  /**
   * FR-T1: 텍스트 레이어를 그립니다 (강화)
   * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
   * @param {Object} layer - 텍스트 레이어 객체
   * @param {number} canvasWidth - 캔버스 너비
   * @param {number} canvasHeight - 캔버스 높이
   * @param {Object} dynamicText - 플레이스홀더 치환 데이터
   */
  drawText: (ctx, layer, canvasWidth, canvasHeight, dynamicText) => {
    const styles = layer.styles || {};

    // 1. [PRD v3.2 FR-R1] 텍스트 내용 결정 - 플레이스홀더인 경우에만 치환
    let text = layer.text || "";

    // 조건부 치환: 정확히 플레이스홀더와 일치할 때만 동적 텍스트로 교체
    if (text === "{{SLOGAN}}") {
      text = dynamicText.slogan || "샘플 슬로건";
    } else if (text === "{{VISUALIZATION_CUE}}") {
      text = dynamicText.visualizationCue || "샘플 문구";
    }
    // 플레이스홀더가 아니면 원본 텍스트를 그대로 사용 (고충실도 복제)

    ctx.save();

    // [TR-1] 공통 헬퍼를 사용한 좌표 변환
    const actualX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
    const actualY = renderHelpers.convertCoordinate(layer.y, canvasHeight);

    // 하위 호환성: v2.3 템플릿의 'font' 문자열 vs v2.4+ 템플릿의 fontRatio/fontWeight/fontFamily 분리
    let actualFontSize, fontWeight, fontFamily;
    if (styles.font) {
      // v2.3 이하: "900 36px 'Noto Sans KR'" 형식 파싱
      const fontMatch = styles.font.match(
        /^(normal|bold|\d+)\s+(\d+)px\s+(.+)$/
      );
      if (fontMatch) {
        fontWeight = fontMatch[1];
        actualFontSize = parseInt(fontMatch[2], 10);
        fontFamily = fontMatch[3];
      } else {
        fontWeight = "normal";
        actualFontSize = 20;
        fontFamily = "Arial";
      }
    } else {
      // v2.4+: fontRatio를 캔버스 높이 기준으로 변환
      actualFontSize = (styles.fontRatio || 0.05) * canvasHeight;
      fontWeight = styles.fontWeight || "normal";
      fontFamily = styles.fontFamily || "Arial";
    }

    // 2. 폰트 설정
    ctx.font = `${fontWeight} ${actualFontSize}px ${fontFamily}`;

    // 3. 정렬 및 기준선 설정 (JSON의 align, baseline 완벽 적용)
    ctx.textAlign = styles.align || "left";
    ctx.textBaseline = styles.baseline || "alphabetic";

    // 4. 색상 설정 (자동 색상 보정 적용)
    // 배경 이미지가 있는 경우 텍스트 색상을 자동으로 조정
    let textColor = styles.fill || "#000000";
    
    // 배경 이미지가 있는 경우 색상 보정 적용
    // (배경 레이어가 이미지 타입이고 텍스트 위치와 겹치는 경우)
    if (layer.autoColorAdjust !== false) {
      // 텍스트가 그려질 영역의 배경 밝기 분석
      const adjustedColor = adjustTextColorForBackground(
        ctx, 
        actualX, 
        actualY, 
        ctx.measureText(text).width, 
        actualFontSize
      );
      if (adjustedColor) {
        textColor = adjustedColor;
        console.log(`[Text Render] 🎨 자동 색상 보정: ${textColor}`);
      }
    }
    
    ctx.fillStyle = textColor;

    // 5. 그림자 설정 (PRD v2.7: 하위 호환성 처리 + 명시적 초기화)
    if (styles.shadow) {
      ctx.shadowColor = styles.shadow.color || "rgba(0,0,0,0.5)";
      const blurValue = styles.shadow.blur || 0;
      const offsetXValue = styles.shadow.offsetX || 0;
      const offsetYValue = styles.shadow.offsetY || 0;
      // v2.3: 절대 픽셀(>10), v2.4+: 비율(<=10)
      ctx.shadowBlur = blurValue > 10 ? blurValue : blurValue * canvasHeight;
      ctx.shadowOffsetX =
        offsetXValue > 10 ? offsetXValue : offsetXValue * canvasWidth;
      ctx.shadowOffsetY =
        offsetYValue > 10 ? offsetYValue : offsetYValue * canvasHeight;

      console.log(
        `[Text Render] 그림자: blur=${ctx.shadowBlur}, offset=(${ctx.shadowOffsetX}, ${ctx.shadowOffsetY}), color=${ctx.shadowColor}`
      );
    } else {
      // 그림자 없을 때 명시적 초기화 (중요: 이전 레이어의 그림자가 남지 않도록)
      ctx.shadowColor = "rgba(0,0,0,0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // 6. 스타일 적용 로그
    console.log(
      `[Text Render] 스타일 적용: font="${ctx.font}", align="${ctx.textAlign}", baseline="${ctx.textBaseline}", fill="${ctx.fillStyle}"`
    );

    // 7. 텍스트 그리기
    console.log(`[Text Render] ✏️ fillText("${text}", ${actualX}, ${actualY})`);
    ctx.fillText(text, actualX, actualY);

    // 7. 외곽선 (stroke) - 자동 색상 보정 적용
    if (styles.stroke) {
      // stroke 색상도 자동 조정 (fill과 동일한 색상 사용)
      const strokeColor = textColor || styles.strokeColor || "#000000";
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = styles.strokeWidth || 1;
      ctx.strokeText(text, actualX, actualY);
    }

    ctx.restore();
  },

  /**
   * FR-S1: 도형(테두리, 밑줄 등)을 그립니다 (v3.1 스키마 적용)
   * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
   * @param {Object} layer - 도형 레이어 객체
   * @param {number} canvasWidth - 캔버스 너비
   * @param {number} canvasHeight - 캔버스 높이
   */
  drawShape: (ctx, layer, canvasWidth, canvasHeight) => {
    const styles = layer.styles || {};

    if (layer.shape === "rect") {
      ctx.save();

      // [TR-1] 공통 헬퍼를 사용한 크기 변환
      const actualWidth = renderHelpers.convertCoordinate(layer.widthRatio || 0, canvasWidth);
      const actualHeight = renderHelpers.convertCoordinate(layer.heightRatio || 0, canvasHeight);

      // [TR-1] 중심 좌표 → 좌측 상단 좌표 변환
      const centerX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
      const centerY = renderHelpers.convertCoordinate(layer.y, canvasHeight);
      const actualX = centerX - actualWidth / 2;
      const actualY = centerY - actualHeight / 2;

      console.log(
        `[Shape Render] 🔶 rect: center(${centerX}, ${centerY}), topLeft(${actualX}, ${actualY}), size: ${actualWidth}x${actualHeight}`
      );

      // 2. 채우기 스타일 적용
      if (styles.fill) {
        ctx.fillStyle = styles.fill;
        ctx.fillRect(actualX, actualY, actualWidth, actualHeight);
      }

      // 3. 테두리 스타일 적용
      if (styles.stroke) {
        ctx.strokeStyle = styles.stroke;
        const lineWidth = styles.lineWidth || 0.01;
        ctx.lineWidth = lineWidth > 1 ? lineWidth : lineWidth * canvasWidth;
        ctx.strokeRect(actualX, actualY, actualWidth, actualHeight);
      }

      ctx.restore();
    } else if (layer.shape === "circle") {
      ctx.save();

      // [TR-1] 공통 헬퍼를 사용한 좌표 및 크기 변환
      const actualX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
      const actualY = renderHelpers.convertCoordinate(layer.y, canvasHeight);
      const actualRadius = renderHelpers.convertCoordinate(layer.widthRatio || 0.05, canvasWidth) / 2;

      console.log(
        `[Shape Render] ⭕ circle: center(${actualX}, ${actualY}), radius: ${actualRadius}`
      );

      ctx.beginPath();
      ctx.arc(actualX, actualY, actualRadius, 0, Math.PI * 2);

      if (styles.fill) {
        ctx.fillStyle = styles.fill;
        ctx.fill();
      }

      if (styles.stroke) {
        ctx.strokeStyle = styles.stroke;
        const lineWidth = styles.lineWidth || 0.01;
        ctx.lineWidth = lineWidth > 1 ? lineWidth : lineWidth * canvasWidth;
        ctx.stroke();
      }

      ctx.restore();
    }
  },

  /**
   * 배경을 그립니다
   * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
   * @param {Object} background - 배경 객체
   * @param {number} canvasWidth - 캔버스 너비
   * @param {number} canvasHeight - 캔버스 높이
   */
  drawBackground: (ctx, background, canvasWidth, canvasHeight) => {
    if (!background) {
      console.warn("[Background Render] ⚠️ 배경 정보 없음, 흰색으로 대체");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      return;
    }

    console.log(
      `[Background Render] 배경 타입: ${background.type}, 값: ${background.value}`
    );

    if (background.type === "solid") {
      ctx.fillStyle = background.value || "#FFFFFF";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      console.log(`[Background Render] ✅ 단색 배경: ${ctx.fillStyle}`);
    } else if (background.type === "gradient") {
      // 그라디언트 배경 (linear-gradient 파싱)
      console.log(`[Background Render] 그라디언트 파싱: ${background.value}`);
      const gradientMatch = (background.value || "").match(
        /linear-gradient\(([^)]+)\)/
      );
      if (gradientMatch) {
        const parts = gradientMatch[1].split(",").map((s) => s.trim());
        const colors = parts.filter((p) => p.startsWith("#"));
        if (colors.length >= 2) {
          const gradient = ctx.createLinearGradient(0, 0, canvasWidth, 0);
          gradient.addColorStop(0, colors[0]);
          gradient.addColorStop(1, colors[colors.length - 1]);
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          console.log(
            `[Background Render] ✅ 그라디언트: ${colors[0]} → ${
              colors[colors.length - 1]
            }`
          );
        } else {
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          console.warn(`[Background Render] ⚠️ 그라디언트 색상 부족`);
        }
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        console.warn(`[Background Render] ⚠️ 그라디언트 파싱 실패`);
      }
    } else if (background.type === "image") {
      console.log(
        `[Background Render] 이미지 배경: ${background.value} (현재 미구현)`
      );
      ctx.fillStyle = "#F0F0F0";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } else {
      console.warn(
        `[Background Render] ⚠️ 알 수 없는 배경 타입: ${background.type}`
      );
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
  },

  /**
   * [PRD v3.2 FR-R2] SVG 벡터 아이콘을 그립니다
   * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
   * @param {Object} layer - SVG 레이어 객체
   * @param {number} canvasWidth - 캔버스 너비
   * @param {number} canvasHeight - 캔버스 높이
   */
  drawSVG: (ctx, layer, canvasWidth, canvasHeight) => {
    const styles = layer.styles || {};

    // [TR-1] 공통 헬퍼를 사용한 좌표 및 크기 변환
    const actualX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
    const actualY = renderHelpers.convertCoordinate(layer.y, canvasHeight);
    // widthRatio가 있으면 사용, 없으면 legacy width 또는 기본값
    const actualW = layer.widthRatio 
      ? renderHelpers.convertCoordinate(layer.widthRatio, canvasWidth)
      : (layer.width || 50);
    const actualH = layer.heightRatio
      ? renderHelpers.convertCoordinate(layer.heightRatio, canvasHeight)
      : (layer.height || 50);

    console.log(
      `[SVG Render] 🎨 SVG 아이콘: pos(${actualX}, ${actualY}), size: ${actualW}x${actualH}`
    );

    ctx.save();

    // 2. 좌표 이동 및 스케일 설정 (SVG path는 보통 작은 viewBox 기준)
    ctx.translate(actualX, actualY);

    // SVG viewBox 크기 추정 (일반적으로 24x24 또는 자동 감지)
    const viewBoxSize = layer.viewBoxSize || 24;
    const scaleX = actualW / viewBoxSize;
    const scaleY = actualH / viewBoxSize;
    ctx.scale(scaleX, scaleY);

    // 3. Path2D 객체 생성 (pathData가 있을 경우)
    if (layer.pathData) {
      try {
        const path = new Path2D(layer.pathData);

        // 4. 채우기 스타일 적용
        if (styles.fill) {
          ctx.fillStyle = styles.fill;
          ctx.fill(path);
          console.log(`[SVG Render] ✅ 채우기: ${styles.fill}`);
        }

        // 5. 테두리 스타일 적용
        if (styles.stroke) {
          ctx.strokeStyle = styles.stroke;
          ctx.lineWidth = styles.lineWidth || 1;
          ctx.stroke(path);
          console.log(`[SVG Render] ✅ 테두리: ${styles.stroke}`);
        }

        console.log(`[SVG Render] ✅ SVG 렌더링 완료`);
      } catch (error) {
        console.error(`[SVG Render] ❌ Path2D 생성 실패:`, error);
        // 에러 시 플레이스홀더 표시
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(0, 0, viewBoxSize, viewBoxSize);
        ctx.strokeStyle = "#FF6B00";
        ctx.strokeRect(0, 0, viewBoxSize, viewBoxSize);
      }
    } else {
      console.warn(`[SVG Render] ⚠️ pathData가 없습니다.`);
      // pathData 없으면 아이콘 플레이스홀더 표시
      ctx.fillStyle = "#FFD700";
      ctx.fillRect(0, 0, viewBoxSize, viewBoxSize);
      ctx.fillStyle = "#333333";
      ctx.font = `${viewBoxSize * 0.5}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🎨", viewBoxSize / 2, viewBoxSize / 2);
    }

    ctx.restore();
  },

  /**
   * [PRD v3.2 FR-R3] 이미지 레이어를 그립니다 (비동기 지원)
   * @returns {Promise} 이미지 로드 완료 시 resolve
   */
  drawImage: (ctx, layer, canvasWidth, canvasHeight) => {
    return new Promise((resolve) => {
      // [TR-1] 공통 헬퍼를 사용한 좌표 및 크기 변환
      const actualX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
      const actualY = renderHelpers.convertCoordinate(layer.y, canvasHeight);
      const actualW = renderHelpers.convertCoordinate(layer.width || layer.widthRatio || 0.1, canvasWidth);
      const actualH = renderHelpers.convertCoordinate(layer.height || layer.heightRatio || 0.1, canvasHeight);

      ctx.save();

      // [FR-R3] Base64 이미지 데이터가 있으면 실제 렌더링
      if (layer.src && layer.src.startsWith("data:image")) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, actualX, actualY, actualW, actualH);
          console.log(
            `[Image Render] ✅ 이미지 로드 성공: ${actualW}x${actualH}`
          );
          ctx.restore();
          resolve();
        };
        img.onerror = (e) => {
          console.error("[Image Render] ❌ 이미지 로드 실패:", e);
          // 플레이스홀더 렌더링
          ctx.fillStyle = "#DDDDDD";
          ctx.fillRect(actualX, actualY, actualW, actualH);
          ctx.strokeStyle = "#999999";
          ctx.strokeRect(actualX, actualY, actualW, actualH);
          ctx.fillStyle = "#666666";
          ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("X", actualX + actualW / 2, actualY + actualH / 2);
          ctx.restore();
          resolve();
        };
        img.src = layer.src;
      } else {
        // [기존] 플레이스홀더 렌더링
        ctx.fillStyle = "#DDDDDD";
        ctx.fillRect(actualX, actualY, actualW, actualH);
        ctx.strokeStyle = "#999999";
        ctx.strokeRect(actualX, actualY, actualW, actualH);
        ctx.fillStyle = "#666666";
        ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("IMAGE", actualX + actualW / 2, actualY + actualH / 2);
        ctx.restore();
        resolve();
      }
    });
  },
};

/**
 * [PRD v2.7 + v3.2] 범용 템플릿 렌더러 (비동기 지원)
 * AI가 생성한 TemplateDataSchema JSON을 기반으로 캔버스를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - 캔버스 2D 컨텍스트
 * @param {Object} templateData - TemplateDataSchema JSON 객체 (상대 좌표)
 * @param {Object} dynamicText - 플레이스홀더를 치환할 동적 텍스트 { slogan, visualizationCue }
 * @returns {Promise} 모든 레이어 렌더링 완료 시 resolve
 */
export async function renderTemplateFromData(
  ctx,
  templateData,
  dynamicText = {}
) {
  if (!templateData) {
    console.error("[Template Renderer] 템플릿 데이터가 없습니다.");
    return;
  }

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  console.log(
    `[Template Renderer] 렌더링 시작 - 캔버스 크기: ${canvasWidth}x${canvasHeight}`
  );
  console.log(
    `[Template Renderer] 📋 템플릿 전체 데이터:`,
    JSON.stringify(templateData, null, 2)
  );
  console.log(
    `[Template Renderer] 📊 레이어 개수: ${templateData.layers?.length || 0}`
  );

  // 1. 배경 렌더링
  renderHelpers.drawBackground(
    ctx,
    templateData.background,
    canvasWidth,
    canvasHeight
  );

  // 2. [FR-R3] 레이어 렌더링 (비동기 지원)
  if (templateData.layers && Array.isArray(templateData.layers)) {
    for (let i = 0; i < templateData.layers.length; i++) {
      const layer = templateData.layers[i];

      console.log(
        `[Template Renderer] 🎨 레이어 ${i + 1}/${templateData.layers.length}:`,
        {
          type: layer.type,
          text: layer.text,
          x: layer.x,
          y: layer.y,
          styles: layer.styles,
        }
      );

      switch (layer.type) {
        case "text":
          renderHelpers.drawText(
            ctx,
            layer,
            canvasWidth,
            canvasHeight,
            dynamicText
          );
          break;

        case "shape":
          renderHelpers.drawShape(ctx, layer, canvasWidth, canvasHeight);
          break;

        case "image":
          // [FR-R3] 비동기 이미지 렌더링
          await renderHelpers.drawImage(ctx, layer, canvasWidth, canvasHeight);
          break;

        case "svg":
          // [FR-R2] SVG 벡터 아이콘 렌더링
          renderHelpers.drawSVG(ctx, layer, canvasWidth, canvasHeight);
          break;

        default:
          console.warn(
            `[Template Renderer] ⚠️ 알 수 없는 레이어 타입: ${layer.type}`
          );
      }
    }
  }

  console.log(
    `[Template Renderer] ✅ 템플릿 "${templateData.name}" 렌더링 완료`
  );
}
