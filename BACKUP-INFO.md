# AXiA 3D — 백업 정보

**백업 생성 날짜**: 2026-04-12 20:41 UTC

## 백업 파일

### 1. 소스 코드 백업
**파일**: `AXiA-3D-source-20260412-204056.tar.gz` (87 MB)

**포함 내용**:
- 모든 Rust 소스 코드 (crates/axia-core, axia-geo, axia-wasm)
- TypeScript 소스 (web/src)
- 프로젝트 설정 파일 (Cargo.toml, package.json 등)
- 문서 (CLAUDE.md, ARCHITECTURE.md, IMPLEMENTATION_NOTES.md 등)
- 메모리 및 배포 정보

**제외 내용**:
- node_modules (npm install로 재설치 가능)
- crates/target (빌드 산출물)
- .git 레포지토리 히스토리
- 임시 파일 및 로그

### 2. 배포 패키지 백업
**파일**: `AXiA-3D-deploy-20260412-204056.tar.gz` (652 KB)

**포함 내용**:
- 프로덕션 빌드 (index.html + assets)
- 배포 가이드 (DEPLOYMENT-README.md)
- WASM 바이너리
- 최소화된 JavaScript

**크기**: 2.0 MB (압축 후 652 KB)

## 복구 방법

### 소스 코드 복구
```bash
tar -xzf AXiA-3D-source-20260412-204056.tar.gz
cd AXiA\ 3D/web
npm install
cd ../crates/axia-wasm
wasm-pack build --target web --out-dir ../../web/src/wasm
cd ../../web
npm run build
```

### 배포 패키지 복구
```bash
tar -xzf AXiA-3D-deploy-20260412-204056.tar.gz
# 배포 서버로 복사
cp -r axia-3d-deploy-20260412-204056/* /var/www/axia-3d/
```

## 백업 콘텐츠 체크리스트

- [x] 모든 Rust 소스 코드
- [x] 모든 TypeScript 소스 코드
- [x] 프로젝트 문서
- [x] 빌드 설정
- [x] 배포 패키지
- [x] 배포 가이드
- [x] 프로젝트 메모리/노트

## 최근 변경사항 (2026-04-12)

**새로 추가된 기능**:
- ✓ 부드러운 곡면 렌더링 (area-weighted normal averaging)
- ✓ 곡면 그룹 선택 (BFS with 30° angle threshold)
- ✓ 곡면 그룹 Push/Pull (radial extrusion)
- ✓ 통합 엣지 렌더링 임계값 (30°)

**알려진 문제**:
- ⚠️ 곡면 Push/Pull 후 갭 (gap) 문제 — 다음 반복에서 수정 예정

## 버전 정보

- **빌드 ID**: index-B-SZNBgs.js
- **빌드 타임**: 2026-04-12 20:29 UTC
- **Rust 버전**: 1.94.1
- **Three.js 버전**: 0.170.0
- **TypeScript 버전**: 5.7.0

## 저장 위치

```
/sessions/dreamy-hopeful-fermi/mnt/AXiA 3D/
├── AXiA-3D-source-20260412-204056.tar.gz      (소스 코드)
├── AXiA-3D-deploy-20260412-204056.tar.gz      (배포 패키지)
└── BACKUP-INFO.md                             (이 파일)
```

---

**이 백업은 완전하고 복구 가능합니다.**
