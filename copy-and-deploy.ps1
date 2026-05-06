# rnd-dashboard: public 폴더로 파일 복사 후 Firebase 30일 데모 채널 배포
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# 1. 요청된 4개 파일 복사
Copy-Item "$root\index.html" "$root\public\index.html" -Force
Copy-Item "$root\style.css" "$root\public\style.css" -Force
Copy-Item "$root\app.js" "$root\public\app.js" -Force
Copy-Item "$root\firebase.js" "$root\public\firebase.js" -Force

# 2. index.html이 참조하는 나머지 파일도 복사 (대시보드 정상 동작용)
Copy-Item "$root\firestore-service.js" "$root\public\firestore-service.js" -Force
Copy-Item "$root\firebase-config.example.js" "$root\public\firebase-config.example.js" -Force
Copy-Item "$root\CalendarManagement.js" "$root\public\CalendarManagement.js" -Force
Copy-Item "$root\MonthlyPayroll.js" "$root\public\MonthlyPayroll.js" -Force
Copy-Item "$root\ParticipationManagement.js" "$root\public\ParticipationManagement.js" -Force
Copy-Item "$root\QuickNav.js" "$root\public\QuickNav.js" -Force

# firebase-config.js가 있으면 복사 (없어도 firebase.js 기본값 사용)
if (Test-Path "$root\firebase-config.js") {
  Copy-Item "$root\firebase-config.js" "$root\public\firebase-config.js" -Force
}

Write-Host "파일 복사 완료." -ForegroundColor Green

# 3. Firebase 30일 데모 채널 배포
Set-Location $root
firebase hosting:channel:deploy demo --expires 30d
