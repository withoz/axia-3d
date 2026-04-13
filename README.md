# AXiA 3D — 3D Modeling Platform

> 블렌더보다 쉽고, 스케치업보다 정확한 3D 모델링 플랫폼
> 
> Lighter than Blender, More Precise than SketchUp

## ✨ 주요 기능

### 🎨 모델링 도구
- **드로우 도구**: 선, 사각형, 원 그리기 (SketchUp 스타일)
- **변형 도구**: 이동, 회전, 스케일, 오프셋
- **고급 기능**: Push/Pull, Boolean 연산 (Union/Subtract/Intersect)
- **그룹 및 컴포넌트**: 재사용 가능한 부품 관리
- **스냅 시스템**: 정점, 엣지, 중점, 중심 자동 스냅

### 💻 UI/UX
- **드래그 가능한 패널**: Floating/Docked/AutoHide 상태
- **명령어 입력**: CAD 스타일 커맨드 라인 (`L 100` = 100mm 라인)
- **차원 표시**: 실시간 길이/각도 표시
- **Outliner 패널**: 그룹 및 컴포넌트 계층 관리

### 📁 파일 형식
- **Import**: DXF, DWG, SKP, OBJ, STL, glTF, DAE, PLY, 3DS
- **Export**: DXF, XIA (네이티브)

### ⚙️ 기술 스택
- **Rust WASM**: Half-Edge DCEL 기반 기하 커널
- **Three.js 0.170**: 고성능 3D 렌더링
- **TypeScript**: 타입 안전 프론트엔드
- **Vite**: 빠른 번들링

## 🚀 시작하기

### 필수 요구사항
- Node.js 20.x 이상
- npm 10.x 이상
- (선택) Rust 툴체인 (WASM 재빌드 시)

### 개발 모드

```bash
cd web
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 열기

### 프로덕션 빌드

```bash
cd web
npm install
npm run build
```

`dist/` 폴더에 빌드 결과물 생성

### 테스트

```bash
npm run test              # 한 번 실행
npm run test:watch       # 감시 모드
npm run test:coverage    # 커버리지 리포트
```

## 📋 명령어 입력 시스템

키보드: **백틱(`)** 또는 **Ctrl+K** 로 명령어 패널 열기

### 기본 명령어

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `L` | 라인 도구 활성화 | `L` (클릭으로 그리기) |
| `L [길이]` | 길이 지정 라인 | `L 100` (100mm) |
| `L x1,y1,z1 x2,y2,z2` | 좌표로 라인 생성 | `L 0,0,0 100,0,0` |
| `R` | 사각형 도구 | `R` |
| `C [반지름]` | 원 그리기 | `C 50` (반지름 50mm) |
| `H` 또는 `?` | 도움말 | `H` |

## 🏗️ 프로젝트 구조

```
AXiA 3D/
├── web/                          # 프론트엔드
│   ├── src/
│   │   ├── ui/
│   │   │   ├── CommandInput.ts    # 명령어 입력 UI
│   │   │   ├── DraggablePanelManager.ts
│   │   │   └── ComponentPanel.ts
│   │   ├── tools/
│   │   │   ├── DrawLineTool.ts
│   │   │   ├── PushPullTool.ts
│   │   │   ├── GroupTool.ts
│   │   │   └── ...
│   │   ├── viewport/
│   │   │   └── Viewport.ts        # Three.js 렌더링
│   │   └── main.ts
│   ├── vite.config.ts
│   └── package.json
│
├── crates/                        # Rust 엔진
│   ├── axia-geo/                  # 기하 커널
│   ├── axia-core/                 # 씬 및 그룹 관리
│   └── axia-wasm/                 # WASM 바인딩
│
├── .github/workflows/
│   ├── build.yml                  # CI 빌드
│   └── deploy.yml                 # GitHub Pages 배포
│
└── CLAUDE.md                       # 개발 지침
```

## 🔄 GitHub Actions CI/CD

### 자동 빌드 & 배포

1. **main 브랜치로 푸시** → GitHub Actions 자동 실행
2. **Node.js 20.x, 22.x에서 빌드**
3. **테스트 실행**
4. **GitHub Pages에 배포** (선택적)

### 상태 확인

- Repository → **Actions** 탭 → 최신 workflow 확인

### 로컬 GitHub 설정

```powershell
# PowerShell에서 실행
.\setup-github.ps1
```

또는 수동으로:

```bash
git init
git add .
git commit -m "Initial commit: AXiA 3D"
git branch -M main
git remote add origin https://github.com/{username}/{repo}.git
git push -u origin main
```

## 🛠️ Rust WASM 엔진 빌드

WASM 코드 수정 후:

```bash
cd crates/axia-wasm
wasm-pack build --target web --out-dir ../../web/src/wasm

# 또는 npm 스크립트 사용
cd ../../web
npm run wasm:build
```

## 📚 주요 파일

| 파일 | 설명 |
|------|------|
| `CLAUDE.md` | 개발 가이드 및 아키텍처 |
| `GITHUB_ACTIONS_SETUP.md` | CI/CD 설정 상세 가이드 |
| `setup-github.ps1` | GitHub 자동 설정 스크립트 |

## 🐛 트러블슈팅

### "Cannot find module '@rollup/rollup-linux-x64-gnu'"
- Windows: `npm install` (자동 처리)
- Linux: `npm ci --no-optional`

### "WASM not ready"
- 콘솔 경고이며, Three.js만으로도 기본 기능 작동
- 기하 연산 시 필요 (Push/Pull, Boolean 등)

### 빌드 에러
1. `npm install` 재실행
2. `npm cache clean --force`
3. `node_modules` 삭제 후 재설치

## 📖 문서

- [개발 가이드](./CLAUDE.md)
- [GitHub Actions 설정](./GITHUB_ACTIONS_SETUP.md)
- [빌드 & 테스트](./BUILD_AND_TEST.md)

## 🤝 기여

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능

## 👤 작성자

**WYKO** — AXiA 3D 프로젝트 개발자

- 📧 Email: withoz1111@gmail.com
- 🔗 GitHub: [@withoz1111](https://github.com/withoz1111)

## 🙏 감사의 말

- [Three.js](https://threejs.org/) — 3D 렌더링
- [Rust](https://www.rust-lang.org/) — 고성능 기하 커널
- [Vite](https://vitejs.dev/) — 빠른 번들링

---

**마지막 업데이트**: 2026-04-13
**버전**: 0.1.0 (Beta)

**🚀 시작하기 → `npm run dev` (web 폴더에서)**
