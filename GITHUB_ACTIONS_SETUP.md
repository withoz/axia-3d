# GitHub Actions 자동 빌드 설정

## 📋 개요

AXiA 3D 프로젝트가 GitHub Actions로 자동 빌드되도록 설정되었습니다.

## 🔄 Workflows

### 1. **build.yml** — CI/CD 빌드
- **트리거**: main, develop 브랜치 push 또는 PR
- **작업**:
  - Node.js 20.x, 22.x 에서 빌드
  - TypeScript 타입 체크
  - Vite 번들링
  - 테스트 실행
  - 빌드 결과물 저장 (30일)

### 2. **deploy.yml** — GitHub Pages 배포
- **트리거**: main 브랜치 push (자동) 또는 수동 (workflow_dispatch)
- **작업**:
  - 빌드 후 GitHub Pages에 배포
  - 자동 URL: `https://{github-username}.github.io/{repo-name}`

## 🚀 설정 방법

### 1. GitHub Repository 생성 (아직 없다면)

```bash
cd "E:\AXiA 3D"
git init
git add .
git commit -m "Initial commit: AXiA 3D with CommandInput system"
git branch -M main
git remote add origin https://github.com/{username}/axia-3d.git
git push -u origin main
```

### 2. GitHub Pages 활성화

1. Repository → Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `gh-pages` (자동 생성됨)
4. Save

### 3. 빌드 상태 확인

- Actions 탭에서 workflow 상태 확인
- 실패 시 로그 확인 및 수정

## 📊 Workflow 상태 배지

README.md에 추가:

```markdown
![Build Status](https://github.com/{username}/axia-3d/actions/workflows/build.yml/badge.svg)
![Deploy Status](https://github.com/{username}/axia-3d/actions/workflows/deploy.yml/badge.svg)
```

## 🔧 커스터마이징

### Node.js 버전 변경

`build.yml`:
```yaml
matrix:
  node-version: [18.x, 20.x, 22.x]  # 원하는 버전 추가
```

### 배포 브랜치 변경

`deploy.yml`:
```yaml
on:
  push:
    branches: [ main, develop ]  # develop도 배포하려면
```

### 아티팩트 보관 기간 변경

`build.yml`:
```yaml
retention-days: 30  # 기본값, 원하는 날짜로 변경
```

## ✅ 빌드 성공 확인

```
✓ Install dependencies
✓ Run TypeScript compiler
✓ Build with Vite
✓ Upload artifacts
✓ Deploy to GitHub Pages
```

## 🆘 트러블슈팅

### 빌드 실패: "Module not found"
- `npm ci` 실패 → `package-lock.json` 확인
- 로컬에서 `npm ci` 실행 후 커밋

### 배포 실패: "GitHub Pages not configured"
- Settings → Pages → Source 재확인
- gh-pages 브랜치 존재 확인

### 테스트 실패
- 로컬에서 `npm run test` 실행
- 테스트 코드 검토 및 수정

## 📝 환경 변수 설정 (필요 시)

`.github/workflows/build.yml`:
```yaml
env:
  NODE_OPTIONS: --max-old-space-size=4096  # 메모리 제한
```

## 🎯 다음 단계

1. ✅ GitHub Repository 생성
2. ✅ Actions workflows 배포
3. ⏳ 첫 빌드 실행
4. ⏳ GitHub Pages 확인
5. ⏳ 개발 시 자동 빌드 확인

---

**관련 파일**:
- `.github/workflows/build.yml`
- `.github/workflows/deploy.yml`
- `web/package.json`
- `web/package-lock.json`
