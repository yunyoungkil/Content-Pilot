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
 * [Smart Text Fitting] 텍스트 길이에 따라 폰트 크기를 자동 조절
 * 텍스트가 캔버스 영역에 완벽하게 맞도록 폰트 크기를 조정합니다.
 * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
 * @param {string} text - 렌더링할 텍스트
 * @param {number} maxWidth - 최대 너비 (픽셀)
 * @param {number} maxHeight - 최대 높이 (픽셀)
 * @param {string} fontFamily - 폰트 패밀리
 * @param {string} fontWeight - 폰트 굵기
 * @param {number} initialFontSize - 초기 폰트 크기
 * @param {number} minFontSize - 최소 폰트 크기 (기본값: 12)
 * @returns {Object} { fontSize, textWidth, textHeight, lines } - 최적화된 폰트 정보
 */
function fitTextToCanvas(
  ctx,
  text,
  maxWidth,
  maxHeight,
  fontFamily,
  fontWeight,
  initialFontSize,
  minFontSize = 12
) {
  if (!text || text.trim().length === 0) {
    return { fontSize: initialFontSize, textWidth: 0, textHeight: 0, lines: [] };
  }

  let fontSize = Math.min(initialFontSize, maxHeight * 0.8); // 최대 높이의 80%를 초기값으로
  let textWidth = 0;
  let textHeight = 0;
  let lines = [];

  // 이진 탐색으로 최적 폰트 크기 찾기
  let low = minFontSize;
  let high = Math.min(initialFontSize, maxHeight * 0.8);
  let bestSize = minFontSize;

  while (low <= high) {
    const testSize = Math.floor((low + high) / 2);
    ctx.font = `${fontWeight} ${testSize}px ${fontFamily}`;

    // 텍스트를 여러 줄로 나누기 (단어 단위)
    const words = text.split(/\s+/);
    const testLines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          testLines.push(currentLine);
          currentLine = word;
        } else {
          // 단어 하나가 너무 길면 강제로 자름
          testLines.push(word.substring(0, Math.floor((word.length * maxWidth) / metrics.width)));
          currentLine = '';
        }
      }
    }
    if (currentLine) {
      testLines.push(currentLine);
    }

    const lineHeight = testSize * 1.2; // 줄 간격
    const totalHeight = testLines.length * lineHeight;
    const maxLineWidth = Math.max(...testLines.map((line) => ctx.measureText(line).width));

    if (maxLineWidth <= maxWidth && totalHeight <= maxHeight) {
      bestSize = testSize;
      low = testSize + 1;
      lines = testLines;
      textWidth = maxLineWidth;
      textHeight = totalHeight;
    } else {
      high = testSize - 1;
    }
  }

  // 최종 폰트 크기로 다시 측정
  ctx.font = `${fontWeight} ${bestSize}px ${fontFamily}`;
  if (lines.length === 0) {
    // 줄 나누기 실패 시 단일 줄로 처리
    const metrics = ctx.measureText(text);
    if (metrics.width > maxWidth) {
      // 텍스트가 너무 길면 크기 조정
      const ratio = maxWidth / metrics.width;
      bestSize = Math.max(minFontSize, Math.floor(bestSize * ratio * 0.95));
      ctx.font = `${fontWeight} ${bestSize}px ${fontFamily}`;
      textWidth = ctx.measureText(text).width;
      textHeight = bestSize * 1.2;
      lines = [text];
    } else {
      textWidth = metrics.width;
      textHeight = bestSize * 1.2;
      lines = [text];
    }
  }

  return {
    fontSize: bestSize,
    textWidth,
    textHeight,
    lines,
  };
}

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
    return brightness < 128 ? '#FFFFFF' : '#000000';
  } catch (e) {
    console.warn('[Color Adjust] 색상 보정 실패:', e);
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
    let text = layer.text || '';

    // 조건부 치환: 정확히 플레이스홀더와 일치할 때만 동적 텍스트로 교체
    if (text === '{{SLOGAN}}') {
      text = dynamicText.slogan || '샘플 슬로건';
    } else if (text === '{{VISUALIZATION_CUE}}') {
      text = dynamicText.visualizationCue || '샘플 문구';
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
      const fontMatch = styles.font.match(/^(normal|bold|\d+)\s+(\d+)px\s+(.+)$/);
      if (fontMatch) {
        fontWeight = fontMatch[1];
        actualFontSize = parseInt(fontMatch[2], 10);
        fontFamily = fontMatch[3];
      } else {
        fontWeight = 'normal';
        actualFontSize = 20;
        fontFamily = 'Arial';
      }
    } else {
      // v2.4+: fontRatio를 캔버스 높이 기준으로 변환
      actualFontSize = (styles.fontRatio || 0.05) * canvasHeight;
      fontWeight = styles.fontWeight || 'normal';
      fontFamily = styles.fontFamily || 'Arial';
    }

    // 2. [Smart Text Fitting] 텍스트 길이에 따라 폰트 크기 자동 조절
    const maxWidth = canvasWidth * 0.9; // 캔버스 너비의 90%를 최대 너비로 설정
    const maxHeight = canvasHeight * 0.4; // 최대 높이 설정 (여러 줄 텍스트 지원)

    // fitTextToCanvas 함수로 최적 폰트 크기 계산
    const fitResult = fitTextToCanvas(
      ctx,
      text,
      maxWidth,
      maxHeight,
      fontFamily,
      fontWeight,
      actualFontSize,
      12 // 최소 폰트 크기
    );

    const finalFontSize = fitResult.fontSize;
    let textWidth = fitResult.textWidth;
    const textLines = fitResult.lines;

    // 최종 폰트 설정
    ctx.font = `${fontWeight} ${finalFontSize}px ${fontFamily}`;

    if (finalFontSize !== actualFontSize) {
      console.log(
        `[Text Render] 📏 폰트 크기 조정: ${actualFontSize}px → ${finalFontSize}px (${textLines.length}줄)`
      );
    }

    // 3. 정렬 및 기준선 설정 (JSON의 align, baseline 완벽 적용)
    ctx.textAlign = styles.align || 'left';
    ctx.textBaseline = styles.baseline || 'alphabetic';

    // 4. 색상 설정 (자동 색상 보정 적용)
    // 배경 이미지가 있는 경우 텍스트 색상을 자동으로 조정
    let textColor = styles.fill || '#000000';

    // 배경 이미지가 있는 경우 색상 보정 적용
    // (배경 레이어가 이미지 타입이고 텍스트 위치와 겹치는 경우)
    if (layer.autoColorAdjust !== false) {
      // 텍스트가 그려질 영역의 배경 밝기 분석
      const adjustedColor = adjustTextColorForBackground(
        ctx,
        actualX,
        actualY,
        textWidth,
        finalFontSize
      );
      if (adjustedColor) {
        textColor = adjustedColor;
        console.log(`[Text Render] 🎨 자동 색상 보정: ${textColor}`);
      }
    }

    ctx.fillStyle = textColor;

    // 5. 그림자 설정 (PRD v2.7: 하위 호환성 처리 + 명시적 초기화)
    if (styles.shadow) {
      ctx.shadowColor = styles.shadow.color || 'rgba(0,0,0,0.5)';
      const blurValue = styles.shadow.blur || 0;
      const offsetXValue = styles.shadow.offsetX || 0;
      const offsetYValue = styles.shadow.offsetY || 0;
      // v2.3: 절대 픽셀(>10), v2.4+: 비율(<=10)
      ctx.shadowBlur = blurValue > 10 ? blurValue : blurValue * canvasHeight;
      ctx.shadowOffsetX = offsetXValue > 10 ? offsetXValue : offsetXValue * canvasWidth;
      ctx.shadowOffsetY = offsetYValue > 10 ? offsetYValue : offsetYValue * canvasHeight;

      console.log(
        `[Text Render] 그림자: blur=${ctx.shadowBlur}, offset=(${ctx.shadowOffsetX}, ${ctx.shadowOffsetY}), color=${ctx.shadowColor}`
      );
    } else {
      // 그림자 없을 때 명시적 초기화 (중요: 이전 레이어의 그림자가 남지 않도록)
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // 6. 스타일 적용 로그
    console.log(
      `[Text Render] 스타일 적용: font="${ctx.font}", align="${ctx.textAlign}", baseline="${ctx.textBaseline}", fill="${ctx.fillStyle}"`
    );

    // 7. 텍스트 그리기 (여러 줄 지원)
    const lineHeight = finalFontSize * 1.2;
    const totalTextHeight = textLines.length * lineHeight;
    let startY = actualY;

    // baseline이 middle인 경우 수직 중앙 정렬
    if (ctx.textBaseline === 'middle') {
      startY = actualY - totalTextHeight / 2 + lineHeight / 2;
    } else if (ctx.textBaseline === 'bottom') {
      startY = actualY - totalTextHeight + lineHeight;
    }

    // 여러 줄 텍스트 렌더링
    if (textLines.length > 1) {
      textLines.forEach((line, index) => {
        const lineY = startY + index * lineHeight;
        console.log(
          `[Text Render] ✏️ fillText("${line}", ${actualX}, ${lineY}) [줄 ${index + 1}/${textLines.length}]`
        );
        ctx.fillText(line, actualX, lineY);
      });
    } else {
      console.log(`[Text Render] ✏️ fillText("${text}", ${actualX}, ${actualY})`);
      ctx.fillText(text, actualX, actualY);
    }

    // 7. 외곽선 (stroke) - 자동 색상 보정 적용 (여러 줄 지원)
    if (styles.stroke) {
      const strokeColor = textColor || styles.strokeColor || '#000000';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = styles.strokeWidth || 1;

      if (textLines.length > 1) {
        textLines.forEach((line, index) => {
          const lineY = startY + index * lineHeight;
          ctx.strokeText(line, actualX, lineY);
        });
      } else {
        ctx.strokeText(text, actualX, actualY);
      }
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

    if (layer.shape === 'rect') {
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
    } else if (layer.shape === 'circle') {
      ctx.save();

      // [TR-1] 공통 헬퍼를 사용한 좌표 및 크기 변환
      const actualX = renderHelpers.convertCoordinate(layer.x, canvasWidth);
      const actualY = renderHelpers.convertCoordinate(layer.y, canvasHeight);
      const actualRadius =
        renderHelpers.convertCoordinate(layer.widthRatio || 0.05, canvasWidth) / 2;

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
    // 모든 경우에 Promise 반환 (비동기 일관성)
    return new Promise((resolve) => {
      if (!background) {
        console.warn('[Background Render] ⚠️ 배경 정보 없음, 흰색으로 대체');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        resolve();
        return;
      }

      console.log(`[Background Render] 배경 타입: ${background.type}, 값: ${background.value}`);

      if (background.type === 'solid') {
        ctx.fillStyle = background.value || '#FFFFFF';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        console.log(`[Background Render] ✅ 단색 배경: ${ctx.fillStyle}`);
        resolve();
      } else if (background.type === 'gradient') {
        // 그라디언트 배경 (linear-gradient 파싱)
        console.log(`[Background Render] 그라디언트 파싱: ${background.value}`);
        const gradientMatch = (background.value || '').match(/linear-gradient\(([^)]+)\)/);
        if (gradientMatch) {
          const parts = gradientMatch[1].split(',').map((s) => s.trim());
          // 색상 값 추출 (퍼센트나 숫자 제거)
          const colors = parts
            .map((p) => {
              // #으로 시작하는 색상 값 찾기
              const colorMatch = p.match(/#[0-9a-fA-F]{3,8}/);
              if (colorMatch) {
                return colorMatch[0];
              }
              // rgb/rgba 형식도 지원
              const rgbMatch = p.match(/(rgba?\([^)]+\))/);
              if (rgbMatch) {
                return rgbMatch[1];
              }
              return null;
            })
            .filter((c) => c !== null);

          if (colors.length >= 2) {
            const gradient = ctx.createLinearGradient(0, 0, canvasWidth, 0);
            gradient.addColorStop(0, colors[0]);
            gradient.addColorStop(1, colors[colors.length - 1]);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            console.log(
              `[Background Render] ✅ 그라디언트: ${colors[0]} → ${colors[colors.length - 1]}`
            );
          } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            console.warn(
              `[Background Render] ⚠️ 그라디언트 색상 부족 (찾은 색상: ${colors.length}개)`
            );
          }
          resolve();
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          console.warn(`[Background Render] ⚠️ 그라디언트 파싱 실패`);
          resolve();
        }
      } else if (background.type === 'image') {
        // 이미지 배경 렌더링 (Base64 데이터 URL 지원)
        const imageValue = background.value || '';
        // Base64 데이터인 경우 요약만 표시
        let logValue = imageValue;
        if (imageValue.startsWith('data:image') && imageValue.length > 100) {
          logValue = `[Base64 Image: ${imageValue.length} chars]`;
        } else if (imageValue.length > 80) {
          logValue = imageValue.substring(0, 80) + '...';
        }
        console.log(`[Background Render] 이미지 배경 렌더링 시작: ${logValue}`);

        if (
          imageValue.startsWith('data:image/') ||
          imageValue.startsWith('http://') ||
          imageValue.startsWith('https://')
        ) {
          // 비동기 이미지 로드
          const img = new Image();
          img.crossOrigin = 'anonymous';

          img.onload = () => {
            // 이미지 비율을 유지하면서 캔버스를 채우기 (cover 방식)
            const imgAspect = img.width / img.height;
            const canvasAspect = canvasWidth / canvasHeight;

            let drawWidth, drawHeight, drawX, drawY;

            if (imgAspect > canvasAspect) {
              // 이미지가 더 넓음 - 높이에 맞춤
              drawHeight = canvasHeight;
              drawWidth = canvasHeight * imgAspect;
              drawX = (canvasWidth - drawWidth) / 2;
              drawY = 0;
            } else {
              // 이미지가 더 높음 - 너비에 맞춤
              drawWidth = canvasWidth;
              drawHeight = canvasWidth / imgAspect;
              drawX = 0;
              drawY = (canvasHeight - drawHeight) / 2;
            }

            // 배경을 먼저 채우기 (이미지가 채우지 못하는 부분)
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);

            // 이미지를 비율 유지하면서 그리기
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            console.log(
              `[Background Render] ✅ 이미지 배경 렌더링 완료: ${canvasWidth}x${canvasHeight} (원본: ${img.width}x${img.height}, 비율 유지)`
            );
            resolve();
          };

          img.onerror = (e) => {
            console.error('[Background Render] ❌ 이미지 로드 실패:', e);

            // Firebase Storage URL인 경우 CORS 오류일 수 있으므로 Base64로 변환 시도
            if (imageValue.includes('firebasestorage.googleapis.com')) {
              console.log('[Background Render] 🔄 Firebase Storage URL 감지, Base64 변환 시도...');
              chrome.runtime.sendMessage(
                {
                  action: 'fetch_image_as_base64',
                  url: imageValue,
                },
                (response) => {
                  if (response && response.success && response.dataUrl) {
                    // Base64로 변환 성공 - 다시 이미지 로드
                    const img2 = new Image();
                    img2.onload = () => {
                      const imgAspect = img2.width / img2.height;
                      const canvasAspect = canvasWidth / canvasHeight;

                      let drawWidth, drawHeight, drawX, drawY;

                      if (imgAspect > canvasAspect) {
                        drawHeight = canvasHeight;
                        drawWidth = canvasHeight * imgAspect;
                        drawX = (canvasWidth - drawWidth) / 2;
                        drawY = 0;
                      } else {
                        drawWidth = canvasWidth;
                        drawHeight = canvasWidth / imgAspect;
                        drawX = 0;
                        drawY = (canvasHeight - drawHeight) / 2;
                      }

                      ctx.fillStyle = '#000000';
                      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                      ctx.drawImage(img2, drawX, drawY, drawWidth, drawHeight);
                      console.log('[Background Render] ✅ Base64 변환 후 이미지 로드 성공');
                      resolve();
                    };
                    img2.onerror = () => {
                      console.error('[Background Render] ❌ Base64 변환 후에도 이미지 로드 실패');
                      ctx.fillStyle = '#F0F0F0';
                      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                      resolve();
                    };
                    img2.src = response.dataUrl;
                  } else {
                    // Base64 변환 실패 - 기본 배경
                    console.error('[Background Render] ❌ Base64 변환 실패:', response?.error);
                    ctx.fillStyle = '#F0F0F0';
                    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                    resolve();
                  }
                }
              );
            } else {
              // Firebase Storage가 아닌 경우 기본 배경
              ctx.fillStyle = '#F0F0F0';
              ctx.fillRect(0, 0, canvasWidth, canvasHeight);
              resolve();
            }
          };

          img.src = imageValue;
        } else {
          console.warn('[Background Render] ⚠️ 유효하지 않은 이미지 URL');
          ctx.fillStyle = '#F0F0F0';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          resolve();
        }
      } else {
        console.warn(`[Background Render] ⚠️ 알 수 없는 배경 타입: ${background.type}`);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        resolve();
      }
    });
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
      : layer.width || 50;
    const actualH = layer.heightRatio
      ? renderHelpers.convertCoordinate(layer.heightRatio, canvasHeight)
      : layer.height || 50;

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
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(0, 0, viewBoxSize, viewBoxSize);
        ctx.strokeStyle = '#FF6B00';
        ctx.strokeRect(0, 0, viewBoxSize, viewBoxSize);
      }
    } else {
      console.warn(`[SVG Render] ⚠️ pathData가 없습니다.`);
      // pathData 없으면 아이콘 플레이스홀더 표시
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(0, 0, viewBoxSize, viewBoxSize);
      ctx.fillStyle = '#333333';
      ctx.font = `${viewBoxSize * 0.5}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎨', viewBoxSize / 2, viewBoxSize / 2);
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
      const actualW = renderHelpers.convertCoordinate(
        layer.width || layer.widthRatio || 0.1,
        canvasWidth
      );
      const actualH = renderHelpers.convertCoordinate(
        layer.height || layer.heightRatio || 0.1,
        canvasHeight
      );

      ctx.save();

      // [FR-R3] Base64 이미지 데이터가 있으면 실제 렌더링
      if (
        layer.src &&
        (layer.src.startsWith('data:image') ||
          layer.src.startsWith('http://') ||
          layer.src.startsWith('https://'))
      ) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // 이미지 비율을 유지하면서 그리기
          const imgAspect = img.width / img.height;
          const targetAspect = actualW / actualH;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspect > targetAspect) {
            // 이미지가 더 넓음 - 높이에 맞춤
            drawHeight = actualH;
            drawWidth = actualH * imgAspect;
            drawX = actualX + (actualW - drawWidth) / 2;
            drawY = actualY;
          } else {
            // 이미지가 더 높음 - 너비에 맞춤
            drawWidth = actualW;
            drawHeight = actualW / imgAspect;
            drawX = actualX;
            drawY = actualY + (actualH - drawHeight) / 2;
          }

          // 배경을 먼저 채우기 (이미지가 채우지 못하는 부분)
          ctx.fillStyle = '#000000';
          ctx.fillRect(actualX, actualY, actualW, actualH);

          // 이미지를 비율 유지하면서 그리기
          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          console.log(
            `[Image Render] ✅ 이미지 로드 성공: ${actualW}x${actualH} (원본: ${img.width}x${img.height}, 비율 유지)`
          );
          ctx.restore();
          resolve();
        };
        img.onerror = (e) => {
          console.error('[Image Render] ❌ 이미지 로드 실패:', e);

          // Firebase Storage URL인 경우 CORS 오류일 수 있으므로 Base64로 변환 시도
          if (layer.src && layer.src.includes('firebasestorage.googleapis.com')) {
            console.log('[Image Render] 🔄 Firebase Storage URL 감지, Base64 변환 시도...');
            chrome.runtime.sendMessage(
              {
                action: 'fetch_image_as_base64',
                url: layer.src,
              },
              (response) => {
                if (response && response.success && response.dataUrl) {
                  // Base64로 변환 성공 - 다시 이미지 로드
                  const img2 = new Image();
                  img2.onload = () => {
                    const imgAspect = img2.width / img2.height;
                    const targetAspect = actualW / actualH;

                    let drawWidth, drawHeight, drawX, drawY;

                    if (imgAspect > targetAspect) {
                      drawHeight = actualH;
                      drawWidth = actualH * imgAspect;
                      drawX = actualX + (actualW - drawWidth) / 2;
                      drawY = actualY;
                    } else {
                      drawWidth = actualW;
                      drawHeight = actualW / imgAspect;
                      drawX = actualX;
                      drawY = actualY + (actualH - drawHeight) / 2;
                    }

                    ctx.fillStyle = '#000000';
                    ctx.fillRect(actualX, actualY, actualW, actualH);
                    ctx.drawImage(img2, drawX, drawY, drawWidth, drawHeight);
                    console.log('[Image Render] ✅ Base64 변환 후 이미지 로드 성공');
                    ctx.restore();
                    resolve();
                  };
                  img2.onerror = () => {
                    console.error('[Image Render] ❌ Base64 변환 후에도 이미지 로드 실패');
                    // 플레이스홀더 렌더링
                    ctx.fillStyle = '#DDDDDD';
                    ctx.fillRect(actualX, actualY, actualW, actualH);
                    ctx.strokeStyle = '#999999';
                    ctx.strokeRect(actualX, actualY, actualW, actualH);
                    ctx.fillStyle = '#666666';
                    ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('X', actualX + actualW / 2, actualY + actualH / 2);
                    ctx.restore();
                    resolve();
                  };
                  img2.src = response.dataUrl;
                } else {
                  // Base64 변환 실패 - 플레이스홀더
                  console.error('[Image Render] ❌ Base64 변환 실패:', response?.error);
                  ctx.fillStyle = '#DDDDDD';
                  ctx.fillRect(actualX, actualY, actualW, actualH);
                  ctx.strokeStyle = '#999999';
                  ctx.strokeRect(actualX, actualY, actualW, actualH);
                  ctx.fillStyle = '#666666';
                  ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText('X', actualX + actualW / 2, actualY + actualH / 2);
                  ctx.restore();
                  resolve();
                }
              }
            );
          } else {
            // Firebase Storage가 아닌 경우 플레이스홀더
            ctx.fillStyle = '#DDDDDD';
            ctx.fillRect(actualX, actualY, actualW, actualH);
            ctx.strokeStyle = '#999999';
            ctx.strokeRect(actualX, actualY, actualW, actualH);
            ctx.fillStyle = '#666666';
            ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('X', actualX + actualW / 2, actualY + actualH / 2);
            ctx.restore();
            resolve();
          }
        };
        img.src = layer.src;
      } else {
        // [기존] 플레이스홀더 렌더링
        ctx.fillStyle = '#DDDDDD';
        ctx.fillRect(actualX, actualY, actualW, actualH);
        ctx.strokeStyle = '#999999';
        ctx.strokeRect(actualX, actualY, actualW, actualH);
        ctx.fillStyle = '#666666';
        ctx.font = `${Math.max(12, canvasHeight * 0.03)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('IMAGE', actualX + actualW / 2, actualY + actualH / 2);
        ctx.restore();
        resolve();
      }
    });
  },
};

/**
 * [Smart Templates] 황금비율 계산 (1:1.618)
 * @param {number} canvasWidth - 캔버스 너비
 * @param {number} canvasHeight - 캔버스 높이
 * @returns {Object} 황금비율 좌표 { x, y, width, height }
 */
function calculateGoldenRatio(canvasWidth, canvasHeight) {
  const goldenRatio = 1.618;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / goldenRatio; // 황금비율 지점

  return {
    x: centerX,
    y: centerY,
    width: canvasWidth * 0.8,
    height: canvasHeight * 0.3,
  };
}

/**
 * [Smart Templates] 동적 템플릿 생성기
 * @param {string} templateType - 템플릿 타입: "comparison", "question", "list"
 * @param {string} title - 메인 타이틀
 * @param {string} subtitle - 서브타이틀 (선택)
 * @param {Object} background - 배경 설정
 * @param {Object} options - 추가 옵션
 * @returns {Object} TemplateDataSchema JSON 객체
 */
export function createSmartTemplate(
  templateType,
  title,
  subtitle = '',
  background = null,
  options = {}
) {
  const defaultBackground = background || {
    type: 'gradient',
    value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  };

  const layers = [];

  // 배경 오버레이 (가독성 향상)
  if (background?.type === 'image') {
    layers.push({
      type: 'shape',
      shape: 'rect',
      x: 0.5,
      y: 0.5,
      widthRatio: 1,
      heightRatio: 1,
      styles: {
        fill: 'rgba(0,0,0,0.4)',
      },
    });
  }

  switch (templateType) {
    case 'comparison': {
      // 비교형 템플릿: VS, Before/After 등
      const parts = title.split(/\s*(VS|vs|대|vs\.|VS\.)\s*/);
      if (parts.length >= 3) {
        const leftText = parts[0].trim();
        const rightText = parts[2].trim();
        const vsText = parts[1] || 'VS';

        // 왼쪽 텍스트 (황금비율 좌측)
        layers.push({
          type: 'text',
          text: leftText,
          x: 0.25,
          y: 0.5,
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.06,
            fontWeight: 'bold',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
          },
        });

        // VS 텍스트 (중앙)
        layers.push({
          type: 'text',
          text: vsText,
          x: 0.5,
          y: 0.5,
          autoColorAdjust: true,
          styles: {
            fill: '#FFD700',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.08,
            fontWeight: '900',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.9)', blur: 0.015, offsetX: 0, offsetY: 0.008 },
          },
        });

        // 오른쪽 텍스트 (황금비율 우측)
        layers.push({
          type: 'text',
          text: rightText,
          x: 0.75,
          y: 0.5,
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.06,
            fontWeight: 'bold',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
          },
        });
      } else {
        // VS가 없는 경우 일반 타이틀
        layers.push({
          type: 'text',
          text: title,
          x: 0.5,
          y: 0.382, // 황금비율 지점 (1/1.618)
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.08,
            fontWeight: 'bold',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
          },
        });
      }
      break;
    }

    case 'question': {
      // 질문형 템플릿: 물음표 강조
      layers.push({
        type: 'text',
        text: title.replace(/\?+$/, ''), // 물음표 제거 (별도로 추가)
        x: 0.5,
        y: 0.382, // 황금비율 지점
        autoColorAdjust: true,
        styles: {
          fill: '#FFFFFF',
          fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
          fontRatio: 0.07,
          fontWeight: 'bold',
          align: 'center',
          baseline: 'middle',
          shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
        },
      });

      // 큰 물음표 아이콘
      layers.push({
        type: 'text',
        text: '?',
        x: 0.85,
        y: 0.25,
        autoColorAdjust: false,
        styles: {
          fill: '#FFD700',
          fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
          fontRatio: 0.15,
          fontWeight: '900',
          align: 'center',
          baseline: 'middle',
          shadow: { color: 'rgba(0,0,0,0.9)', blur: 0.02, offsetX: 0, offsetY: 0.01 },
        },
      });

      if (subtitle) {
        layers.push({
          type: 'text',
          text: subtitle,
          x: 0.5,
          y: 0.618, // 황금비율 하단
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.04,
            fontWeight: 'normal',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 0.008, offsetX: 0, offsetY: 0.004 },
          },
        });
      }
      break;
    }

    case 'list': {
      // 리스트형 템플릿: 번호 또는 체크리스트
      const listItems = title
        .split(/\n|,|\./)
        .filter((item) => item.trim().length > 0)
        .slice(0, 3);
      const startY = 0.35;
      const itemSpacing = 0.15;

      listItems.forEach((item, index) => {
        const yPos = startY + index * itemSpacing;

        // 번호 또는 아이콘
        layers.push({
          type: 'text',
          text: `${index + 1}.`,
          x: 0.2,
          y: yPos,
          autoColorAdjust: false,
          styles: {
            fill: '#FFD700',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.06,
            fontWeight: '900',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.9)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
          },
        });

        // 리스트 아이템 텍스트
        layers.push({
          type: 'text',
          text: item.trim(),
          x: 0.5,
          y: yPos,
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.05,
            fontWeight: 'bold',
            align: 'left',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
          },
        });
      });

      if (subtitle) {
        layers.push({
          type: 'text',
          text: subtitle,
          x: 0.5,
          y: 0.8,
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.035,
            fontWeight: 'normal',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 0.008, offsetX: 0, offsetY: 0.004 },
          },
        });
      }
      break;
    }

    default: {
      // 기본 템플릿 (황금비율 배치)
      layers.push({
        type: 'text',
        text: title,
        x: 0.5,
        y: 0.382, // 황금비율 지점
        autoColorAdjust: true,
        styles: {
          fill: '#FFFFFF',
          fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
          fontRatio: 0.08,
          fontWeight: 'bold',
          align: 'center',
          baseline: 'middle',
          shadow: { color: 'rgba(0,0,0,0.8)', blur: 0.01, offsetX: 0, offsetY: 0.005 },
        },
      });

      if (subtitle) {
        layers.push({
          type: 'text',
          text: subtitle,
          x: 0.5,
          y: 0.618, // 황금비율 하단
          autoColorAdjust: true,
          styles: {
            fill: '#FFFFFF',
            fontFamily: options.fontFamily || "'Noto Sans KR', sans-serif",
            fontRatio: 0.05,
            fontWeight: 'normal',
            align: 'center',
            baseline: 'middle',
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 0.008, offsetX: 0, offsetY: 0.004 },
          },
        });
      }
    }
  }

  return {
    name: `Smart Template: ${templateType}`,
    background: defaultBackground,
    layers,
  };
}

/**
 * [Dynamic Template Loader] JSON 파일에서 템플릿 로드
 * @param {string|Object} templateSource - JSON 파일 경로 또는 템플릿 객체
 * @param {Object} dynamicText - 플레이스홀더 치환 데이터
 * @returns {Promise<Object>} TemplateDataSchema JSON 객체
 */
export async function loadTemplateFromJSON(templateSource, dynamicText = {}) {
  if (typeof templateSource === 'object') {
    // 이미 객체인 경우 플레이스홀더만 치환
    return replacePlaceholders(JSON.parse(JSON.stringify(templateSource)), dynamicText);
  }

  // JSON 파일 로드
  try {
    const response = await fetch(templateSource);
    const templateData = await response.json();
    return replacePlaceholders(templateData, dynamicText);
  } catch (error) {
    console.error(`[Template Loader] 템플릿 로드 실패:`, error);
    throw error;
  }
}

/**
 * 플레이스홀더 치환 헬퍼
 */
function replacePlaceholders(templateData, dynamicText) {
  const replaced = JSON.parse(JSON.stringify(templateData));

  if (replaced.layers) {
    replaced.layers.forEach((layer) => {
      if (layer.type === 'text' && layer.text) {
        if (layer.text === '{{SLOGAN}}') {
          layer.text = dynamicText.slogan || layer.text;
        } else if (layer.text === '{{VISUALIZATION_CUE}}') {
          layer.text = dynamicText.visualizationCue || layer.text;
        } else if (layer.text === '{{TITLE}}') {
          layer.text = dynamicText.title || layer.text;
        } else if (layer.text === '{{SUBTITLE}}') {
          layer.text = dynamicText.subtitle || layer.text;
        }
      }
    });
  }

  return replaced;
}

/**
 * [PRD v2.7 + v3.2] 범용 템플릿 렌더러 (비동기 지원)
 * AI가 생성한 TemplateDataSchema JSON을 기반으로 캔버스를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - 캔버스 2D 컨텍스트
 * @param {Object} templateData - TemplateDataSchema JSON 객체 (상대 좌표)
 * @param {Object} dynamicText - 플레이스홀더를 치환할 동적 텍스트 { slogan, visualizationCue }
 * @returns {Promise} 모든 레이어 렌더링 완료 시 resolve
 */
export async function renderTemplateFromData(ctx, templateData, dynamicText = {}) {
  if (!templateData) {
    console.error('[Template Renderer] 템플릿 데이터가 없습니다.');
    return;
  }

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  console.log(`[Template Renderer] 렌더링 시작 - 캔버스 크기: ${canvasWidth}x${canvasHeight}`);

  // Base64 데이터를 숨기고 요약 정보만 표시
  const sanitizedData = JSON.parse(JSON.stringify(templateData));
  if (sanitizedData.background?.value) {
    const bgValue = sanitizedData.background.value;
    if (bgValue.startsWith('data:image') || bgValue.length > 100) {
      // Base64 데이터인 경우 요약 정보만 표시
      sanitizedData.background.value = `[Base64 Image: ${bgValue.length} chars]`;
    } else if (bgValue.startsWith('https://firebasestorage.googleapis.com')) {
      // Firebase Storage URL인 경우 그대로 표시
      sanitizedData.background.value = bgValue.substring(0, 80) + '...';
    }
  }

  console.log(`[Template Renderer] 📋 템플릿 전체 데이터:`, JSON.stringify(sanitizedData, null, 2));
  console.log(`[Template Renderer] 📊 레이어 개수: ${templateData.layers?.length || 0}`);

  // 1. 배경 렌더링 (비동기 지원)
  await renderHelpers.drawBackground(ctx, templateData.background, canvasWidth, canvasHeight);

  // 2. [FR-R3] 레이어 렌더링 (비동기 지원)
  if (templateData.layers && Array.isArray(templateData.layers)) {
    for (let i = 0; i < templateData.layers.length; i++) {
      const layer = templateData.layers[i];

      console.log(`[Template Renderer] 🎨 레이어 ${i + 1}/${templateData.layers.length}:`, {
        type: layer.type,
        text: layer.text,
        x: layer.x,
        y: layer.y,
        styles: layer.styles,
      });

      switch (layer.type) {
        case 'text':
          renderHelpers.drawText(ctx, layer, canvasWidth, canvasHeight, dynamicText);
          break;

        case 'shape':
          renderHelpers.drawShape(ctx, layer, canvasWidth, canvasHeight);
          break;

        case 'image':
          // [FR-R3] 비동기 이미지 렌더링
          await renderHelpers.drawImage(ctx, layer, canvasWidth, canvasHeight);
          break;

        case 'svg':
          // [FR-R2] SVG 벡터 아이콘 렌더링
          renderHelpers.drawSVG(ctx, layer, canvasWidth, canvasHeight);
          break;

        default:
          console.warn(`[Template Renderer] ⚠️ 알 수 없는 레이어 타입: ${layer.type}`);
      }
    }
  }

  console.log(`[Template Renderer] ✅ 템플릿 "${templateData.name}" 렌더링 완료`);
}
