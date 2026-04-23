# STEP / IGES 지원 도입 평가 (AXiA 3D)

**작성일**: 2026-04-23
**상태**: 🔍 평가 단계 — 구현 전 아키텍처 결정 필요

---

## 배경

실용성 감사(PRACTICALITY_REPORT.md §④)에서 "엔지니어링 CAD 호환성" 기능 gap으로 STEP/IGES 미지원이 지적됨. 그러나 단순 구현이 아니라 **번들 크기 / 라이선스 / 메인터넌스 부담**을 신중히 평가 필요.

---

## 1. STEP / IGES 포맷 개요

| 항목 | STEP (ISO 10303) | IGES (ASME Y14.26M) |
|------|------------------|--------------------|
| 연도 | 1994 (AP203) / 계속 갱신 | 1980 (v1) / 1996 (v6 ANSI) |
| 지배적 엔지니어링 용도 | 기계 CAD 교환 표준 (SolidWorks/CATIA/NX) | 레거시, MIL/항공 |
| 기하 표현 | B-rep (surfaces, trimmed) / NURBS / CSG | 초기엔 2D wireframe, 후기 NURBS |
| 파일 크기 | 중~대 (텍스트, ASCII) | 큼 (ASCII) |
| 업계 사용률 | 🟢 매우 높음 | 🟡 감소 추세 |

---

## 2. 구현 옵션 비교

### Option A: **OCCT.js** (Open Cascade to WASM 포팅)

**Pros**:
- 업계 표준 CAD 커널 (Open Cascade Technology). STEP/IGES import 완전 지원
- B-rep 변환 정확도 매우 높음
- 라이선스: LGPL 2.1 + Exception — **dynamic linking 허용, 정적 링킹 금지**
- STEP/IGES 외에도 많은 포맷 지원 (BRep, STL, OBJ, IGES, STEP, XCAF, ...)

**Cons**:
- **번들 크기 10-15MB** (gzipped ~3-5MB). AXiA 현재 번들 252KB 대비 50배 이상 증가
- **LGPL 의무**: 소스 공개 or 라이선스 고지 + object file 재배포 가능성 유지
  - 웹 앱에서 dynamic linking이 의미 있으려면 사용자가 OCCT.wasm을 교체 가능해야 함
  - 라이선스 문구 노출 + OCCT 소스 링크 포함 필요
- **메인터넌스 복잡도 ↑**: OCCT는 C++ 대형 프로젝트, 버전 업그레이드 시 빌드 고통

**대표 프로젝트**:
- [OpenCascade wasm build](https://github.com/donalffons/opencascade.js) — JS API 래퍼
- [CadHub](https://cadhub.xyz) — OCCT.js 사용
- [LibrePad](https://github.com/libfive/libfive) — 다른 접근

**번들 처리 전략 (만약 도입 시)**:
- OCCT.wasm을 AXiA 메인 번들에서 분리, **lazy import**만으로 로드
- 사용자가 STEP 열 때만 다운로드 → 첫 사용 시 5-10초 대기
- Service Worker + IndexedDB 캐시로 후속 사용은 빠름

### Option B: **occt-import-js** (MIT, lightweight STEP import-only)

**Pros**:
- **순수 MIT 라이선스** — 최소 제약
- **번들 3-5MB** — OCCT.js보다 작음 (STEP import/export만 제공)
- npm 설치 단순, API 직관적

**Cons**:
- STEP만 지원, IGES 없음
- Export 없음 (import-only)
- OCCT 전체 기능의 ~10%만 노출 — 추후 "trimmed surface detail 손실" 같은 한계

**추천도**: ⭐⭐⭐⭐ — AXiA의 "경량 모델링" 포지션에 가장 적합

### Option C: **외부 변환 서버** (사용자 서버 or 공개 API)

- 사용자가 .step → .obj/.stl로 사전 변환 후 import
- 구현 비용 0, 클라이언트 번들 변화 없음
- UX는 나빠짐: "STEP 파일은 [FreeCAD/Fusion360 등]에서 먼저 변환해서 가져오세요"

**현재 AXiA가 채택한 암묵적 전략**: FileImporter에 안내 메시지

### Option D: 자체 구현 (Rust에서 STEP parser)

- 번들 최소, 라이선스 제약 없음
- STEP은 매우 복잡한 스펙(수백 entity 타입) — 제대로 구현하려면 6-12개월 전임 엔지니어 필요
- **비현실적** — 엔지니어 1명 전담 프로젝트 수준

---

## 3. 권장 결정 행렬

| 기준 | OCCT.js | occt-import-js | 외부 변환 | 자체 구현 |
|------|---------|---------------|----------|----------|
| 번들 크기 | 🔴 +10MB | 🟡 +3MB | 🟢 0 | 🟢 0 |
| 라이선스 리스크 | 🟡 LGPL | 🟢 MIT | 🟢 없음 | 🟢 없음 |
| 기능 커버 | 🟢 완전 | 🟡 import only | 🔴 없음 | 🔴 없음 |
| 구현 비용 | 🟡 중 | 🟢 낮음 | 🟢 0 | 🔴 매우 높음 |
| 사용자 UX | 🟢 우수 | 🟢 우수 | 🔴 불편 | — |
| 메인터넌스 | 🔴 높음 | 🟡 중 | 🟢 낮음 | 🔴 매우 높음 |

---

## 4. 🎯 권장안

### 단계별 접근

**Phase 1 (즉시 — 제로 비용)**:
- FileImporter에 "STEP/IGES는 지원 예정. 현재는 FreeCAD/Fusion360에서 STL/OBJ/GLTF로 변환 후 가져오세요" 안내 메시지 정교화
- Toast / 파일 다이얼로그에서 명확한 대안 링크 제공

**Phase 2 (우선순위 리뷰 후 — 1-2주)**:
- **occt-import-js** 도입 (Option B) — MIT 라이선스 안전, 3-5MB 번들
- Lazy import 적용 — 사용자가 STEP 열 때만 다운로드
- manualChunks vite 설정으로 step-io 별도 chunk 분리
- IGES는 **제외** (사용 빈도 낮음, OCCT.js 필요)

**Phase 3 (장기 — 필요 시)**:
- 엔터프라이즈 사용자 요청이 있으면 OCCT.js 풀 버전 평가
- 또는 AXiA → STEP export 요구가 강해지면 도입

### 현재 세션 결정

❌ **지금은 도입하지 않음**. 이유:
1. **번들 크기 부담** — 현재 252KB 초기 로드가 핵심 UX (Phase B 번들 최적화 결과). 3-10MB 추가는 경쟁력 손상
2. **사용자 페르소나 불일치** — 건축/제품 디자인 사용자는 STL/OBJ/GLTF로 충분
3. **라이선스 관리 부담** — AXiA 팀은 아직 소규모, LGPL compliance 관리 추가 부담

대신 이 문서로 **결정 근거 기록** + 미래 도입 경로 명시.

---

## 5. 관련 기록

- `PRACTICALITY_REPORT.md` §④ — STEP/IGES 미구현 지적
- `web/vite.config.ts` — manualChunks 번들 최적화 설정 (STEP 도입 시 여기에 추가)
- `CLAUDE.md` line 646-648 — "지원 예정" 문구

---

## 6. 재평가 조건

다음 중 하나 발생 시 이 문서 업데이트하고 Phase 2 진행 검토:

1. 사용자로부터 "STEP import 없으면 AXiA 안 씀" 피드백 > 5명
2. occt-import-js가 1MB 이하로 경량화됨
3. 경쟁 제품(SketchUp Web, Onshape 등)이 무료로 STEP import 제공 시작
4. AXiA 유료 플랜에서 "STEP 지원"을 가치 proposition으로 쓸 기회

현재 상태: 1-4 모두 해당 없음 → **유지 보류**.

---

*결정자*: AXiA 개발팀 | *다음 리뷰*: 2026 Q3 또는 Phase 2 착수 시
