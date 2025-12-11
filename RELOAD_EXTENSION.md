# 🔄 크롬 익스텐션 재로드 가이드

## 문제 상황

빌드 후 코드 변경사항이 반영되지 않을 때 (에러가 계속 발생할 때)

## 해결 방법

### 방법 1: 크롬 확장 프로그램 페이지에서 재로드 (권장)

1. 크롬 브라우저 주소창에 입력:

   ```
   chrome://extensions/
   ```

2. 우측 상단 "개발자 모드" 활성화 확인

3. "Content Pilot" 확장 프로그램 카드 찾기

4. **새로고침 아이콘 (⟳) 클릭** 또는 "다시 로드" 버튼 클릭

5. 페이지 새로고침 (F5) 후 익스텐션 재실행

### 방법 2: 완전 재설치 (문제가 지속될 경우)

1. `chrome://extensions/` 접속

2. Content Pilot 확장 프로그램 **"제거"** 클릭

3. **"Load unpacked"** (압축해제된 확장 프로그램 로드) 클릭

4. `C:\Content-Pilot` 폴더 선택

5. 페이지 새로고침 후 익스텐션 재실행

### 방법 3: Service Worker 재시작

1. `chrome://extensions/` 접속

2. Content Pilot 카드에서 **"서비스 워커"** 링크 클릭 (파란색 텍스트)

3. 열린 DevTools 창에서 **"×"** 또는 창 닫기

4. 익스텐션이 자동으로 Service Worker 재시작

5. 페이지 새로고침 후 익스텐션 재실행

## 확인 방법

재로드 후 다음을 확인:

1. **콘솔 로그 확인**:
   - F12 → Console 탭
   - 이전 에러 메시지가 사라졌는지 확인

2. **정상 작동 확인**:
   - 스크랩 기능 테스트
   - 오류 메시지 없이 정상 동작하는지 확인

## 자동화 스크립트 (PowerShell)

빠른 재로드를 위한 스크립트:

```powershell
# reload-extension.ps1
Write-Host "🔨 빌드 중..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 빌드 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📌 다음 단계:" -ForegroundColor Cyan
    Write-Host "1. 크롬에서 chrome://extensions/ 접속" -ForegroundColor White
    Write-Host "2. Content Pilot의 '새로고침(⟳)' 버튼 클릭" -ForegroundColor White
    Write-Host "3. 테스트 페이지에서 F5로 새로고침" -ForegroundColor White
} else {
    Write-Host "❌ 빌드 실패!" -ForegroundColor Red
}
```

실행:

```powershell
.\reload-extension.ps1
```

## 주의사항

⚠️ **반드시 빌드 후 익스텐션 재로드**해야 변경사항이 반영됩니다!

- `npm run build` 실행 → 익스텐션 재로드 → 페이지 새로고침
- Service Worker는 자동으로 재시작되지 않을 수 있음
- 캐시 문제가 있을 경우: Ctrl+Shift+Delete → 캐시 삭제 후 재시작
