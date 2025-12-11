# 🔨 빌드 및 익스텐션 재로드
Write-Host "🔨 빌드 중..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ 빌드 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "📌 다음 단계를 수행하세요:" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1️⃣  크롬에서 chrome://extensions/ 접속" -ForegroundColor White
    Write-Host ""
    Write-Host "  2️⃣  'Content Pilot' 카드에서 '새로고침(⟳)' 버튼 클릭" -ForegroundColor White
    Write-Host ""
    Write-Host "  3️⃣  테스트 중인 웹페이지에서 F5로 새로고침" -ForegroundColor White
    Write-Host ""
    Write-Host "  4️⃣  익스텐션 아이콘 클릭하여 정상 작동 확인" -ForegroundColor White
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "💡 Tip: Service Worker를 재시작하려면 chrome://extensions/에서" -ForegroundColor Gray
    Write-Host "   'Service Worker' 링크를 클릭 후 DevTools를 닫으세요." -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ 빌드 실패!" -ForegroundColor Red
    Write-Host "위의 오류 메시지를 확인하세요." -ForegroundColor Red
    Write-Host ""
}
