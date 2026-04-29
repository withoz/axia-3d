# ADR-035: STEP / IGES 전략 — Hybrid (OCCT.js 옵션 + 자체 파서 spike)

**Status**: **Accepted** (2026-04-29, rev 1 보강 사용자 승인 2026-04-30) — Phase G Stage 4 kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase G Stage 4
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028~034 (Phases A~F + G1~G3)

## Context

Phase G1~G3 으로 NURBS surface SSI + trim curve 변환 + Boolean MVP 완성.
다음 단계는 **외부 세계와의 연결** — STEP / IGES import/export.

### 결정의 무게

이건 단순 구현 선택이 아니라 **제품 철학 결정**:

| 축 | OCCT.js | 자체 파서 (axia-foreign) |
|---|---|---|
| 번들 크기 | **+10MB** WASM (Brotli 후 ~3.5MB) | <500KB 예상 |
| 라이선스 | LGPL with FOSS exception | 자체 코드 (자유) |
| 지원 범위 | STEP AP203/AP214/AP242, IGES, IFC, BREP, ... | MVP: STEP AP203, IGES 5.3 |
| 시장 검증 | 30년 누적, OpenCascade 기반 | 신규, 검증 안 됨 |
| 통제 | 외부 deps update 의존 | 100% 자체 통제 |
| 시작 비용 | 1주일 (통합 + 캐스트) | 수개월 (파서 + AP entity 매핑) |
| 장기 부담 | OCCT 회귀 리스크 + 번들 부담 | 자체 유지보수 책임 |

### 사용자 가치 우선순위

> **외부 데이터 유입이 없으면 G1~G3 의 NURBS 능력은 사용자에게 전달
> 안 됨.** 번들 +10MB 비용을 감수해서라도 빠른 사용자 검증이 우선.
>
> 동시에 장기 번들 / 라이선스 / 통제 위험은 자체 파서로 헤지.

## Decision

### P20 — 새 원칙: STEP/IGES Hybrid Strategy

> **STEP / IGES 지원은 두 단계 hybrid 로 진행한다:**
>
> 1. **Stage 4-A (즉시 착수)**: OCCT.js 를 **온디맨드 로딩 플러그인**으로
>    옵션화한다. 사용자가 STEP/IGES 파일을 import 시도할 때만 동적
>    fetch + WASM init. 메인 번들에는 영향 없음.
> 2. **Stage 4-B (병행 spike)**: `axia-foreign` 자체 crate 에서 STEP AP203
>    / IGES 5.3 파서 spike 진행. MVP 범위 = NURBS surface + curve 의
>    형상 만 (assembly / metadata / annotation 제외).
>
> **목표 마일스톤**:
> - OCCT.js 통합 후 **3개월 내** 사용자 5개 이상의 실제 STEP/IGES
>   파일을 검증
> - 자체 파서 spike 가 **6개월 내** OCCT.js 와 동일한 5개 검증 파일
>   에서 1mm 이내 정확도 통과
> - 통과 시 OCCT.js 옵션 → deprecated, 자체 파서 default 로 promote.
> - 실패 시 OCCT.js 영구 default 로 격상, 자체 파서 보류.

### P20 세부 규칙

**P20.1 — OCCT.js 통합 (Stage 4-A)**
- 패키지: `opencascade.js@^2.0` (LGPL with FOSS exception, 적합)
- 로딩 전략: dynamic `import('opencascade.js')` 만 — UI File menu 의
  STEP/IGES import 클릭 시점.
- 진입점: `web/src/io/StepIgesImporter.ts` (지연 로딩 wrapper)
- Export 경로: 동일 모듈에서 OCCT.js 의 `BRepTools::Write` API 활용
- 사용자 피드백: 첫 import 시 Toast "STEP/IGES 엔진 로딩 중... (~3.5MB)"
- 실패 시 fallback 메시지 + alternate format (DXF / OBJ) 추천

**P20.2 — 자체 파서 spike (Stage 4-B)**
- 위치: 새 crate `crates/axia-foreign/`
- 의존성: 외부 의존성 0 (zero-deps 정책)
- MVP 범위:
  - **STEP AP203** import: B_SPLINE_SURFACE_WITH_KNOTS,
    BOUNDED_CURVE, CARTESIAN_POINT, ADVANCED_FACE
  - **IGES 5.3** import: Type 128 (NURBS surface), Type 126 (NURBS curve),
    Type 110 (line), Type 100 (circle), Type 116 (point)
  - Export: 같은 entity types 의 round-trip
- AP242 / IGES drafting / IFC 등은 spike 범위에서 제외

**P20.3 — 검증 코퍼스**
- `crates/axia-foreign/tests/fixtures/`:
  - `step/cube.stp` (8 vert, 6 face)
  - `step/cylinder.stp` (NURBS surface)
  - `step/freeform.stp` (실제 산업 파일 — 사용자 제공)
  - `iges/cube.igs`, `iges/freeform.igs`
- Round-trip 검증:
  - import → export → re-import → 좌표 차이 < 1e-3 mm
  - OCCT.js 와 자체 파서 cross-validation: 양쪽이 같은 mesh 산출

**P20.4 — 사용자 UX**
- File 메뉴: "STEP 가져오기" / "IGES 가져오기" 항목 (이미 stub 존재)
- Drag-and-drop 자동 dispatch (.stp .step .igs .iges 확장자)
- 진행률 모달 (대용량 파일 대비)
- 실패 시 진단 텍스트 + alternate format 제안 (DXF / OBJ)

**P20.5 — 라이선스 & 배포 정합**
- OCCT.js LGPL with FOSS exception → AXiA 의 라이선스 (TBD by user)
  와 호환성 검토 필요. **사용자 결재 항목.**
- 자체 파서는 AXiA 라이선스에 종속 (선택 자유)

**P20.6 — 메모리 / latency budget**
- OCCT.js init: 지연 로딩 → 첫 import 시 1회 (~2초 예상)
- Import 자체: ADR-014 메타-원칙 #11 "Heavy 500ms" 초과 → 모달 진행률 필수
- 메모리: OCCT.js heap separate (WASM linear memory 분리)

### P20.A — Format Priority (이후 논쟁 종료)

| 형식 | 우선순위 | MVP 범위 |
|---|---|---|
| **STEP AP242** | **Primary** (managed model-based 3D) | NURBS surface + curve + trim |
| **STEP AP214 / AP203** | Secondary (best-effort) | AP203 backward-compat 만 |
| **IGES 5.3** | Legacy support | Trimmed NURBS only |
| **STEP AP238 (STEP-NC)** | 범위 제외 | 별도 ADR |
| **IFC** | 범위 제외 | 별도 ADR |

### P20.B — Non-Goals (Stage 4 전체)

오해 방지를 위해 명시:
- ❌ **STEP / IGES Export** — Stage 4 는 import 우선, export 는 Stage 5
  로 격상 (사용자 검증 후 우선순위 재평가)
- ❌ **Assembly hierarchy 보존** — 단일 part 만 처리, sub-assembly 는
  flatten 또는 거부
- ❌ **PMI / GD&T import** — annotation, dimension, tolerance 정보 무시
- ❌ **Material / Texture metadata** — 형상만 import
- ❌ **Drawing views / projections** — 2D drafting 정보 제외

### P20.C — Stage 4-A 성공 기준 (Acceptance Criteria)

OCCT.js 통합 (Stage 4-A) 의 OK 판단 기준:

1. **기능적 정확성**:
   - STEP/IGES import → NURBS face / wire 생성 (trim loop 포함)
   - 생성된 face 가 G1~G3 Boolean 연산을 정상 통과 (union /
     subtract / intersect)
   - ADR-007 invariant (winding, face validity) 위반 0건
2. **성능 / 번들**:
   - **Dynamic import → initial bundle size 증가 0 MB** (vite analyzer
     검증)
   - 첫 import 시 OCCT.js init < 3초 (hot HTTP cache 기준)
   - 5MB 미만 STEP 파일 import < 5초 (P95)
3. **회복력**:
   - OCCT.js 네트워크 fetch 실패 시 graceful fallback
     (Toast 안내 + alternate format DXF/OBJ 추천)
   - Malformed 파일 → 명확한 에러 메시지 (silent failure 금지)
4. **회귀**:
   - 기존 750+ 회귀 테스트 0건 깨짐
   - 5개 검증 코퍼스 파일 round-trip < 1e-3 mm

### P20.D — 검증 코퍼스 출처

신뢰성 확보를 위해 **공개 + 벤더별 + 사용자 제공** 3축 혼합:

1. **공개 샘플 (2 파일)**:
   - NIST CAD test corpus (https://www.nist.gov/cad-test-files)
   - OCCT test models (`opencascade/data/`)
2. **CAD 벤더별 (3 파일, 1개씩)**:
   - SolidWorks 출력 STEP AP203
   - Fusion 360 출력 STEP AP242
   - CATIA 출력 IGES 5.3
3. **사용자 제공 (선택)**:
   - 익명화된 실제 산업 파일 — 사용자가 제공 시 fixtures 에 추가

위치: `crates/axia-foreign/tests/fixtures/`. 라이선스 중립 또는 명시
허가된 파일만 commit.

### P20.E — 12개월 Default 결정 트리거

자체 파서 (axia-foreign) 가 OCCT.js 를 대체할 자격을 얻는 정량 기준:

| 트리거 | 임계값 | 측정 방법 |
|---|---|---|
| **커버리지** | ≥ 80% 사용자 STEP/IGES 파일이 자체 파서로 import 가능 | 12개월 telemetry (opt-in) |
| **정확도** | OCCT.js 와 동일한 파일에서 ≤ 1e-3 mm 좌표 차이 | cross-validation harness |
| **유지보수 비용** | axia-foreign LOC < 8000, OCCT 회귀 bug ≤ 3건/분기 | git log + issue tracker |
| **번들 절감 체감** | OCCT.js 제거 시 dist 번들 ≥ 8 MB 감소 | vite-bundle-analyzer |
| **사용자 만족도** | NPS ≥ 7 (자체 파서 default 유저 설문) | 12개월 시점 설문 |

**결정 매트릭스**:
- 5개 트리거 모두 통과 → **자체 파서 default promote**, OCCT.js 옵션 유지
- 3~4개 통과 → **6개월 추가 spike** 후 재평가
- 2개 이하 통과 → **OCCT.js 영구 default**, 자체 파서는 학습용 보존

### P20.7 — Stage 4-A MVP 산출물 (이 ADR commit 의 명시 scope)

**이 ADR 은 결정의 고정만**. 코드 변경은 없음.

후속 commit 의 scope:
- `web/src/io/StepIgesImporter.ts` — OCCT.js 동적 로딩 wrapper
- `web/src/ui/MenuBar.ts` 의 STEP/IGES 메뉴 stub → 실제 dispatch 로 교체
- `web/package.json` 의 `opencascade.js` optional dependency
- `vite.config.ts` 의 manualChunks 에 `opencascade-deps` chunk
- 5개 STEP/IGES 회귀 테스트 (axia-foreign fixtures + WasmBridge integration)

### P20.8 — Stage 4-B Spike Backlog

별도 issues 로 트래킹:
- `axia-foreign-1`: STEP AP203 lexer + parser
- `axia-foreign-2`: IGES 5.3 fixed-format parser
- `axia-foreign-3`: AP203 → AnalyticSurface mapping
- `axia-foreign-4`: 라운드트립 export
- `axia-foreign-5`: cross-validation harness vs OCCT.js

## Implementation roadmap

| 마일스톤 | 기한 | 산출물 |
|---|---|---|
| ADR-035 accepted | 2026-04-29 (오늘) | 이 문서 |
| OCCT.js 통합 | +1주 | StepIgesImporter.ts |
| 5개 산업 파일 검증 | +3개월 | 검증 보고서 |
| 자체 파서 STEP MVP | +6개월 | axia-foreign import |
| 자체 파서 IGES MVP | +9개월 | axia-foreign IGES |
| Default 결정 | +12개월 | OCCT.js → 자체로 promote 또는 OCCT.js 영구 default |

## Risks & mitigations

- **R1 — OCCT.js 통합 회귀**: WASM linear memory 분리로 격리
- **R2 — 라이선스 충돌**: ADR 단계에서 사용자 결재 명시 (P20.5)
- **R3 — 번들 폭발**: 동적 로딩 강제 → 메인 번들 영향 0 (P20.1)
- **R4 — 자체 파서 spike 실패**: OCCT.js 가 영구 default 로 fallback —
  사용자 가치 보장됨 (Stage 4-A 만으로도 외부 연결 완성)
- **R5 — STEP AP242 / IFC 요구**: MVP 범위 제외, 별도 ADR 로 격상

## Success Criteria

세부 기준은 P20.C (Stage 4-A) 와 P20.E (12개월 default 결정) 참조.

- ✅ ADR-035 의 결정이 commit 으로 고정됨 (이 PR)
- ⏳ OCCT.js dynamic loader 로 cube.stp 라운드트립 통과 (P20.C #1)
- ⏳ Dynamic import → initial bundle 증가 0 MB (P20.C #2)
- ⏳ 5개 검증 코퍼스 파일 import 성공 + 1e-3 mm 라운드트립 (P20.C #4 + P20.D)
- ⏳ axia-foreign spike 가 cube.stp / IGES 라운드트립 통과
- ⏳ 12개월 시점 P20.E 5개 트리거 측정 → promote/keep 결정 회의

## References

- ISO 10303-203:2011 (STEP AP203 Configuration controlled 3D designs)
- ISO 10303-242:2014 (STEP AP242 — 보류)
- IGES 5.3 specification (USPRO)
- OpenCascade.js (https://github.com/donalffons/opencascade.js)
- ADR-027 (NURBS Kernel Initiative)
- PLAN-001 Phase G

## 변경 이력

- **2026-04-29 (initial)**: Hybrid 전략 채택. Stage 4-A OCCT.js 즉시 +
  Stage 4-B 자체 파서 spike 병행. 12개월 후 default 결정.
- **2026-04-30 (rev 1)**: 사용자 검토 보강 — P20.A (Format priority:
  AP242 primary), P20.B (Non-goals: export/assembly/PMI 제외),
  P20.C (Stage 4-A 4축 acceptance criteria), P20.D (검증 코퍼스 3축
  혼합: NIST + 벤더별 + 사용자), P20.E (12개월 5-트리거 정량 결정
  매트릭스).
