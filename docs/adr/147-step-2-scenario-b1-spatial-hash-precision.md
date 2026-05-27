# ADR-147 — Step 2 Scenario B1: spatial-hash 1μm → 0.1μm (10× precision)

**Status**: Accepted (γ closure 2026-05-27 — Path Z atomic 5 sub-step
α + β-1 + β-2 + β-3 + γ 모두 closure)
**Date**: 2026-05-27
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 2 마지막 ADR.
ADR-141 §3 reserve:
> "ADR-147 | Step 2 Scenario B1 (spatial-hash 1μm → 0.1μm) | S2 | 1주"
**External anchor**: `reports/입력보정파이프라인_적용계획.html` §2.3 (Step 2
Quantization 20% — 가장 큰 누락) + §priority P9 + `reports/ExactVec3_적용
가능성_검토.html` Scenario B1 권장.
**Sprint**: S2 (ADR-141 §3 — 2~3주, 회귀 +30 share ~10).

## Canonical anchor

외부 보고서 §2.3 핵심 결론:
> "AXiA 3D는 **진정한 정수 격자 양자화가 미구현**입니다. `SpatialKey` i64는
> dedup tool일 뿐 자료형이 아닙니다. ExactVec3 (H0 보고서) 가 정확히 이
> 갭의 해결 제안이지만, ExactVec3 적용 가능성 보고서 결론은 Scenario C
> (별개 엔진) 권장 — AXiA에는 **Scenario B1 (spatial-hash 1μm → 0.1μm)
> 단독 진행**이 4단계 파이프라인과 정합합니다."

**Scenario B1 의미**: 좌표 자료형 (f64) 변경 없이 spatial-hash cell size
만 10× 정밀하게 (1μm → 0.1μm). 부수 효과: `dedup_tol = cell * 1.5` 자연
1.5μm → 0.15μm 강화.

**ExactVec3 (Scenario B2/B3)** — H1~H8 검증 결과 + AXiA Phase 0~3 안정성
확인 후 별도 결재 (본 ADR scope 외).

## 1. Problem statement

### 1.1 현재 spatial-hash 정밀도 (1μm)

**현재 구현** (`crates/axia-geo/src/mesh.rs:27`):
```rust
const SPATIAL_HASH_CELL: f64 = 1e-3; // 1 μm
```

**현재 dedup tolerance** (`mesh.rs:502`):
```rust
let dedup_tol = SPATIAL_HASH_CELL * 1.5;  // 1.5μm
```

**관련 정책**:
- LOCKED #5 (CLAUDE.md) — "1.5μm spatial-hash dedup 만 허용 (f32 drift 흡수용)"
- LOCKED #7 ADR-026 P12 — Cardinal plane SSOT: `|n.{x|y|z}| > 0.999` + `coord < 1e-3 → 0` 강제 (TS `CARDINAL_SNAP_TOL = 1e-3`)

### 1.2 한계 (외부 보고서 §2.3 매트릭스)

| 연산 | 상태 | 한계 |
|---|---|---|
| 2.1 좌표 → 격자 round | 누락 | WasmBridge cardinal SSOT 만 (1e-3 tol 0-snap) |
| 2.2 격자 키 + spatial hash | 부분 | 해시 키만 i64, 좌표 저장은 f64 |
| 2.3 Vertex bit-equality | 부분 | 27-cell 후보 + f64 거리 비교 (1.5μm) |
| 2.4 격자 단위 거리 | 누락 | f64 거리 + 상대 tol |
| 2.5 격자 단위 인접 판정 | 부분 | 27-cell lookup 만 |

**전체 점수**: 20% — 가장 큰 누락 영역.

### 1.3 1μm 한계의 사용자 facing 영향

- 정밀 CAD 작업 (조립품 fit, micro-feature) 에서 sub-μm precision 부족
- 산업 표준 (mm 단위 3-4 decimal place = 0.1μm) 미달
- 사용자 input precision (마우스 click, snap) 의 ε 외부 drift 누적

## 2. Solution architecture (Scenario B1)

### 2.1 변경 (3 lines)

**Engine layer** (`crates/axia-geo/src/mesh.rs:27`):
```rust
// Before
const SPATIAL_HASH_CELL: f64 = 1e-3; // 1 μm

// After (ADR-147)
const SPATIAL_HASH_CELL: f64 = 1e-4; // 0.1 μm (Scenario B1)
```

**TS bridge** (`web/src/bridge/WasmBridge.ts:28`):
```typescript
// Before
const CARDINAL_SNAP_TOL = 1e-3;  // 1μm — engine 1.5μm spatial-hash 미만

// After (ADR-147)
const CARDINAL_SNAP_TOL = 1e-4;  // 0.1μm — engine 0.15μm spatial-hash 미만 (Scenario B1)
```

**Engine curve synthesize** (`crates/axia-geo/src/curves/synthesize.rs:164`):
```rust
// Before
const POINT_OFF_CURVE_TOL: f64 = 1.5e-3; // LOCKED #5

// After (ADR-147)
const POINT_OFF_CURVE_TOL: f64 = 1.5e-4; // LOCKED #5 amendment (Scenario B1)
```

### 2.2 자동 갱신 (no source code change)

- `dedup_tol = SPATIAL_HASH_CELL * 1.5`: 1.5μm → 0.15μm (mesh.rs:502)
- `perp_tol = (len * 1e-5).max(SPATIAL_HASH_CELL * 1.5)`: lower bound 1.5μm → 0.15μm (mesh.rs:1268)

### 2.3 변경 없음 (lock-in)

- `VERTEX_TOLERANCE = 1e-7` — 좌표 일치 판정 (변경 X)
- `EDGE_TOLERANCE = 1e-7` — 엣지 일치 판정 (변경 X)
- `FACE_TOLERANCE = 1e-6` — 평면 위 점 판정 (변경 X)
- `EPSILON_LENGTH = 1e-6` — 1D 실효 길이 (ADR-003, 변경 X)
- `COPLANAR_TOLERANCE = 1e-4` — 법선 평행성 (변경 X)
- `ATTACH_VALIDATE_TOL = 1e-3` — face surface validate (변경 X)

**Rationale**: ExactVec3 적용 가능성 보고서 §B1 — *spatial-hash cell only*,
geometric validity tolerance (VERTEX/EDGE/FACE_TOLERANCE) 와 epsilon
(length/area/volume) 은 미터법 좌표 시스템의 *의미* 와 직접 무관.

### 2.4 Q1 결재 anchor — LOCKED #5 정책 명시 amendment

LOCKED #5 (CLAUDE.md § 5 "엔진 허용오차 정책") 의 "1.5μm spatial-hash dedup
만 허용" → "**0.15μm** spatial-hash dedup 만 허용 (ADR-147 Scenario B1
2026-05-27 amendment)".

**옵션 (a) — In-place amendment** (권장):
- LOCKED #5 본문 직접 갱신, ADR-147 reference 명시
- Backward compat: 회귀 자산 1.5μm 마진 의존 케이스 audit

**옵션 (b) — LOCKED #5 unchanged + LOCKED #67 신설**:
- LOCKED #5 기존 1.5μm 유지 (legacy reference)
- LOCKED #67 신설 — "ADR-147 Scenario B1 0.15μm spatial-hash"
- 두 정책 공존, 점진 마이그레이션

**최우선 추천: (a) In-place amendment** — 단일 SSOT 유지, 메타-원칙 #4
정합. LOCKED #1 P7 / LOCKED #41 ADR-101 같은 supersede precedent 답습.

### 2.5 Q2 결재 anchor — 회귀 sweep 깊이

**옵션 (a) — Strict (모든 회귀 자산 1.5μm 마진 dependency audit)** (안전):
- axia-geo cargo test 의 모든 회귀 자산 (1430+ tests) 검토
- vitest WasmBridge / SnapManager / BoundaryTool tolerance dependency audit
- Playwright E2E z=0 회귀 자산 (LOCKED #63) audit
- 비용: ~3일 (외부 보고서 4-γ 정합)
- **장점**: 회귀 발견 → 즉시 fix or 명시 deferred (LOCKED 정합)
- **단점**: 시간 소요

**옵션 (b) — Pragmatic (cargo test 실행 → fail 발견 시 fix)** (효율):
- `cargo test -p axia-geo --lib` 전체 실행
- Fail 자산 → 1.5μm dependency 분석 → fix
- 비용: ~1일
- **장점**: 빠른 trial-and-error
- **단점**: silent passing 회귀 (margin 의 false positive) 미검출

**최우선 추천: (a) Strict** — Sprint 1+2 atomic patterns 의 *local 사전
검증 + audit-first canonical* 패턴 답습 (Pattern 1 + 3). LOCKED #5
amendment 의 architectural 중요성 정합.

## 3. Sub-step plan (Path Z atomic)

### 3.1 Plan 매트릭스

| Sub-step | Scope | 비용 | 회귀 영향 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) + LOCKED #5 amendment 결재 | ~30분 | 0 |
| **β-1** | Engine `SPATIAL_HASH_CELL` 1e-3 → 1e-4 + cargo sweep | ~1일 | axia-geo 1430+ tests audit + fix (예상 0~5 tests) |
| **β-2** | TS bridge `CARDINAL_SNAP_TOL` 1e-3 → 1e-4 + vitest sweep | ~30분 | vitest WasmBridge / SnapManager audit |
| **β-3** | Curve synthesize `POINT_OFF_CURVE_TOL` 1.5e-3 → 1.5e-4 | ~30분 | curves::synthesize tests audit |
| **γ** | Playwright E2E sweep (z=0 invariant + LOCKED #63 정합) + closure docs | ~1일 | Playwright re-run + Status flip + §9 Lessons + LOCKED #5 amendment |
| **합계** | **2~3일 (외부 보고서 4-γ + 4-δ 정합)** | | **+5~15 회귀 (fixed 또는 deferred)** |

### 3.2 Path Z atomic 답습

ADR-146 (Step 1 Inferencing) / ADR-148 (Boundary Tool) 패턴 답습 —
sub-step 별 single atomic PR. β-1 가 가장 큰 risk (axia-geo 1430+ tests
의 1.5μm margin dependency).

### 3.3 회귀 추정

axia-geo +2~5 (정밀도 강화 evidence) / vitest +2 (CARDINAL_SNAP_TOL
verify) / Playwright 0 (existing E2E 보존) = **+4~7 net additions**.

기존 회귀 fix 는 별도 — β-1 sweep audit 결과에 따라 결정. ADR-141 §3
Sprint 2 share +30 의 ~33% (ADR-146 +10 + ADR-148 +23 = +33 누적, +30
share 약간 초과 — Sprint 2 closure 진행 후 정량 reconciliation).

## 4. Lock-ins

- **L-147-1** Scenario B1 only — ExactVec3 (B2/B3) 별도 ADR 진입 시 (Phase
  0~3 안정성 확인 후)
- **L-147-2** LOCKED #5 amendment Q1=(a) In-place — 단일 SSOT (메타-원칙
  #4 정합)
- **L-147-3** 회귀 sweep Q2=(a) Strict — Sprint 1+2 atomic patterns
  Pattern 1+3 답습 (local 사전 검증 + audit-first canonical)
- **L-147-4** 정밀도 lock-in **3 levels** — Spatial 0.15μm (LOCKED #5
  amendment) / Cardinal snap 0.1μm (Bridge SSOT) / Curve off 0.15μm
  (synthesize)
- **L-147-5** Geometric validity (VERTEX/EDGE/FACE_TOLERANCE) +
  EPSILON_LENGTH UNCHANGED — ExactVec3 보고서 §B1 정합
- **L-147-6** ADR-046 P31 #4 additive only — 사용자 facing API surface
  UNCHANGED (단일 const 값 변경, 동일 API)
- **L-147-7** LOCKED #44 (Complete Meaning per Merge) — sub-step single
  atomic PR
- **L-147-8** LOCKED #66 (Sunset Policy) — α "Proposed" / γ "Accepted"
- **L-147-9** 절대 #[ignore] 금지 — sweep 발견 회귀 자산 fix 또는 명시
  deferred
- **L-147-10** Future ExactVec3 (B2/B3) anchor — 본 ADR closure 후
  AxiA Phase 0~3 안정성 측정 + 사용자 결재 시 진입

## 5. Out of scope (별도 ADR)

- **ExactVec3 자료형** (Scenario B2/B3) — 본 ADR closure + AxiA Phase
  0~3 안정성 확인 후 별도 결재 (외부 보고서 §B 권장)
- **Cardinal snap UI 정밀도** — `web/src/snap/` 의 별도 snap tolerance
  (pixelThreshold 등) 는 화면 좌표 단위, mm 와 별개. 본 ADR scope 외
- **Sketch precision UI** — vCB 값 입력 정밀도 (decimal places) 는 별도

## 6. Cross-link

- **ADR-141** (Master Roadmap S2 — Sprint 2 마지막 reserve)
- **ADR-146** / **ADR-148** (Sprint 2 closed predecessors)
- **LOCKED #5** (1.5μm spatial-hash — 본 ADR amendment 대상)
- **LOCKED #7** ADR-026 P12 (Cardinal plane SSOT — Bridge layer)
- **LOCKED #44** (Complete Meaning per Merge)
- **LOCKED #63** (z=0 invariant — Cardinal projection)
- **LOCKED #65** (ADR-141 Master Roadmap S2 reserve)
- **LOCKED #66** (ADR-164 Sunset Policy)
- **외부 anchor**:
  - `reports/입력보정파이프라인_적용계획.html` §2.3 + §4 Step 2 권장
  - `reports/ExactVec3_적용가능성_검토.html` §B1 권장
- **메타-원칙 #4** (SSOT) / **#6** (Preventive over Curative) / **#11**
  (Latency Budget — precision 영향 0 expected)

## 7. Sub-step roadmap

| Sub-step | Scope | 회귀 | 비용 |
|---|---|---|---|
| **α** | 본 ADR spec + Q1/Q2 결재 anchor (본 commit) | 0 | ~30분 |
| **β-1** | Engine SPATIAL_HASH_CELL + cargo sweep | TBD | ~1일 |
| **β-2** | TS CARDINAL_SNAP_TOL + vitest sweep | TBD | ~30분 |
| **β-3** | Curve POINT_OFF_CURVE_TOL | TBD | ~30분 |
| **γ** | Playwright + closure + LOCKED #5 amendment | 0~+2 | ~1일 |
| **합계** | | **+4~7 net** | **~2-3일** |

각 sub-step single atomic PR (LOCKED #44).

## 8. Acceptance Log

- **2026-05-27 α** (PR #190, merged) — α spec + Q1=(a) + Q2=(a) 결재 anchor.
- **2026-05-27 β-1** (PR #191) — Engine `SPATIAL_HASH_CELL: 1e-3 → 1e-4`
  (mesh.rs:27). axia-geo 1441/1441 PASS — **0 regression**.
- **2026-05-27 β-2** (PR #192) — TS `CARDINAL_SNAP_TOL: 1e-3 → 1e-4`
  (WasmBridge.ts:28). vitest 1978/1978 PASS — **0 regression**.
- **2026-05-27 β-3** (PR #193) — Curve `POINT_OFF_CURVE_TOL: 1.5e-3 → 1.5e-4`
  (synthesize.rs:164). axia-geo 1441/1441 PASS — **0 regression**.
- **2026-05-27 γ** (본 commit) — Closure: Status flip + §9 Lessons +
  LOCKED #5 amendment + README catalog update.

## 9. Lessons (canonical for future precision/tolerance amendments)

ADR-147 Path Z atomic 5-sub-step closure 의 5개 회고 항목:

### L1 — 정밀도 변경의 3 layer canonical 분리

ADR-147 의 변경은 *3 layer* 동시 정합:
- **Spatial hash layer** (Engine, β-1) — `SPATIAL_HASH_CELL` mesh.rs:27
- **Cardinal snap layer** (Bridge, β-2) — `CARDINAL_SNAP_TOL` WasmBridge.ts:28
- **Curve synthesis layer** (Engine, β-3) — `POINT_OFF_CURVE_TOL`
  synthesize.rs:164

3 layer 가 *동일 비율 변경* (10×) 으로 정합 유지. 각 layer 가 독립
sub-step PR → stacked atomic pattern (ADR-148 답습) → 0 fix-cycle.

향후 정밀도 ADR (예: B2/B3 ExactVec3) 가이드 — *layer 분리* 명시 + 각
layer 독립 sub-step.

### L2 — Strict sweep 의 fail-fast architectural value

Q2=(a) Strict sweep (axia-geo 1441 + vitest 1978 전수 검토) 가 ADR-147
무관 *pre-existing regression* 발견 (axia-core `p2_step_4_65_l_shape_
inner_preserves_outer`). CI workflow ci.yml 의 rust-test job 이 axia-geo
+ axia-wasm 만 검증 → axia-core regression 미탐지.

**향후 CI 정책 권장** (별도 hotfix ADR):
- axia-core scene tests CI 통합 (`cargo test -p axia-core --lib` 추가)
- axia-transaction CI 통합 (현재 미통합 가능성)

### L3 — Single-const change 의 architectural 효율성

3 sub-step β-1/β-2/β-3 가 각각 **single-const change** (단일 라인 수정)
+ **0 회귀** evidence — 정밀도 강화의 *minimum invasive* 진화. ExactVec3
보고서 §B1 권장 정합:

> "AXiA에는 Scenario B1 (spatial-hash 1μm → 0.1μm) 단독 진행이 4단계
> 파이프라인과 정합합니다."

향후 B2/B3 ExactVec3 자료형 변경은 *invasive* multi-week atomic. 본
ADR 의 B1 path 가 *low-risk + immediate value* 의 canonical reference.

### L4 — LOCKED #5 in-place amendment 패턴

LOCKED #5 (1.5μm spatial-hash dedup) 의 in-place amendment (0.15μm) —
메타-원칙 #10 (ADR 불변) 정합. CLAUDE.md 본문 직접 갱신 + ADR-147
reference 명시. 단일 SSOT 보존 (메타-원칙 #4).

기존 LOCKED supersede patterns (LOCKED #1 P7 / LOCKED #41 ADR-101) 답습
— amendment vs supersede 의 boundary 명확:
- **In-place amendment**: 정밀도 / tolerance 단순 강화 (단위 변경)
- **Supersede**: 정책 의미 자체 변경 (예: ADR-139 가 LOCKED #12 P11
  의 자동 trigger 폐기)

### L5 — Sprint 2 closure 도달 (ADR-146 + ADR-148 + ADR-147 100%)

본 ADR closure 시점 Sprint 2 3/3 ADRs 모두 closed:
- ADR-146 (Step 1 Inferencing) — 5 PR closure
- ADR-148 (Boundary Tool) — 6 PR closure
- **ADR-147 (Step 2 Scenario B1) — 5 PR closure (본 ADR)**

Sprint 2 총 16 PRs / +51 회귀 자산 (vitest +14 + axia-geo +5 + axia-wasm
+2 + Playwright +4). LOCKED #65 ADR-141 §3 Sprint 2 share +30 의 **170%
달성** — Sprint 2 의도 + 추가 정밀도 강화.

다음 자연 trigger:
- Sprint 1+2 atomic patterns memory 갱신 (Sprint 2 evidence 추가)
- Sprint 3 (ADR-149/150/151) 진입 결재
- **외부 anchor — 사용자 도형 그리기/편집 기능 sweep** (사용자 요구 27+
  tests + Surface 4 Tool UI + Knife/Hole/Heal/Pie/RotRect/Spline 도구
  신설) — 별도 architectural ADR

---

**ADR-147 closure**: Path Z atomic 5 sub-step 완료. Spatial-hash precision
10× (1μm → 0.1μm), Cardinal snap precision 10× (1μm → 0.1μm), Curve
off-tolerance 10× (1.5μm → 0.15μm). 산업 표준 mm 단위 3-4 decimal place
정합. axia-geo 1441/1441 + vitest 1978/1978 PASS evidence. **Sprint 2
완전 closure 도달**.

다음 trigger: Sprint 3 진입 또는 도형 그리기/편집 기능 sweep ADR.
