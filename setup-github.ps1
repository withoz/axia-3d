# AXiA 3D GitHub Setup Script (PowerShell)
# 사용: ./setup-github.ps1

param(
    [string]$GitHubUsername = "",
    [string]$RepoName = "axia-3d"
)

# 1. GitHub 정보 입력
if ([string]::IsNullOrEmpty($GitHubUsername)) {
    $GitHubUsername = Read-Host "GitHub 사용자명을 입력하세요"
}

if ([string]::IsNullOrEmpty($RepoName)) {
    $RepoName = Read-Host "Repository 이름을 입력하세요 (기본값: axia-3d)"
    if ([string]::IsNullOrEmpty($RepoName)) {
        $RepoName = "axia-3d"
    }
}

$RepoUrl = "https://github.com/$GitHubUsername/$RepoName.git"

Write-Host "`n📦 AXiA 3D GitHub Setup" -ForegroundColor Cyan
Write-Host "================================"
Write-Host "Username: $GitHubUsername"
Write-Host "Repository: $RepoName"
Write-Host "URL: $RepoUrl"
Write-Host "================================`n"

# 2. Git 초기화 확인
if (Test-Path ".git") {
    Write-Host "⚠️  Git 저장소가 이미 초기화되어 있습니다." -ForegroundColor Yellow
    $reinit = Read-Host "재초기화하시겠습니까? (y/n)"
    if ($reinit -ne "y") {
        Write-Host "✅ 기존 저장소 사용" -ForegroundColor Green
    }
    else {
        Remove-Item -Force -Recurse .git
        Write-Host "🔄 Git 저장소 재초기화 중..." -ForegroundColor Yellow
        git init
    }
}
else {
    Write-Host "🔄 Git 저장소 초기화 중..." -ForegroundColor Yellow
    git init
}

# 3. .gitignore 생성 (없으면)
if (-not (Test-Path ".gitignore")) {
    Write-Host "📝 .gitignore 생성 중..."
    @"
# Dependencies
node_modules/
/web/node_modules/
package-lock.json

# Build artifacts
/web/dist/
/web/build/
*.wasm

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Optional npm cache
.npm
.cache/

# Rust
/crates/target/
Cargo.lock
"@ | Out-File -Encoding UTF8 -FilePath ".gitignore"
    Write-Host "✅ .gitignore 생성됨" -ForegroundColor Green
}

# 4. Git 설정
Write-Host "🔧 Git 설정 중..."
git config user.name "WYKO" 2>$null
git config user.email "withoz1111@gmail.com" 2>$null

# 5. 모든 파일 추가
Write-Host "📦 파일 추가 중..."
git add .

# 6. 초기 커밋
Write-Host "💾 초기 커밋 중..."
git commit -m "Initial commit: AXiA 3D with CommandInput system and GitHub Actions CI/CD

- CommandInput UI for CAD-style command entry
- Line command handler (L, setTool)
- GitHub Actions workflows (build, deploy)
- DraggablePanelManager with state machine
- Rust WASM engine integration
- File I/O support (DXF/DWG/SKP/OBJ/STL/glTF)"

# 7. 브랜치 이름 변경
Write-Host "🔄 메인 브랜치 이름 변경 중..."
git branch -M main 2>$null

# 8. 원격 저장소 추가
Write-Host "🌐 원격 저장소 설정 중..."
git remote remove origin 2>$null
git remote add origin $RepoUrl

# 9. 확인 및 푸시 안내
Write-Host "`n✅ 로컬 저장소 준비 완료!" -ForegroundColor Green
Write-Host "`n📝 다음 단계:" -ForegroundColor Cyan
Write-Host "1. GitHub에서 $RepoName 저장소 생성:"
Write-Host "   https://github.com/new"
Write-Host ""
Write-Host "2. 저장소에 푸시:"
Write-Host "   git push -u origin main"
Write-Host ""
Write-Host "3. GitHub Pages 설정:"
Write-Host "   Settings → Pages → Source: gh-pages"
Write-Host ""
Write-Host "4. Actions 자동 빌드 확인:"
Write-Host "   Actions 탭에서 workflow 상태 확인"
Write-Host ""

# 10. 푸시 진행 여부
$push = Read-Host "지금 바로 푸시하시겠습니까? (y/n)"
if ($push -eq "y") {
    Write-Host "🚀 푸시 중..." -ForegroundColor Yellow
    git push -u origin main

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ 푸시 완료!" -ForegroundColor Green
        Write-Host "Repository: $RepoUrl"
    }
    else {
        Write-Host "`n❌ 푸시 실패. 다음 명령으로 다시 시도하세요:" -ForegroundColor Red
        Write-Host "git push -u origin main"
    }
}
else {
    Write-Host "`n💾 로컬에만 저장되었습니다. 언제든 다음 명령으로 푸시할 수 있습니다:" -ForegroundColor Yellow
    Write-Host "git push -u origin main"
}

Write-Host "`n"
