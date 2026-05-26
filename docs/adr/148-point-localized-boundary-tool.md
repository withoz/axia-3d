# ADR-148 — B-γ' Point-Localized BoundaryTool (ADR-139 자연 후속)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-26
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 2 마지막 ADR.
ADR-141 §3 reserve:
> "ADR-148 | B-γ' Point-Localized BoundaryTool (ADR-139 자연 후속) | S2 | 1주"
**Direct predecessor**: LOCKED #64 ADR-139 (Boundary tool 명시 only)
§14 B-γ' sub-step — "`Mesh::boundary_from_point(p, plane)` 신규 point-
based localization (full mesh sweep 보다 정밀)".
**Sprint**: S2 (ADR-141 §3 — 2~3주, 회귀 +30 share ~10).

## Canonical anchor

ADR-139 §14 B-γ MVP audit pivot (2026-05-22) 후 명시 deferred:
> "B-γ MVP 의 본질: ADR-139 가 자동 trigger 폐기 → 명시 trigger 가 필요한데,
> `resynthesize-faces` 가 *전체 mesh sweep* 명시 trigger 로 이미 활성.
> 사용자 명시 호출 = 보고서 4단계 파이프라인의 entry point.
> ...
> B-γ' (가칭) — Point-based localization (`Mesh::boundary_from_point
> (p, plane)` 신규 — click point 근처 region-limited boundary detection,
> ADR-139 §10 L-139-5 specific). Full mesh sweep 보다 정밀."

**CAD 표준 BOUNDARY 명령**: AutoCAD `BOUNDARY` / `BPOLY` / `BHATCH` 등
은 사용자가 *영역 내부의 한 점*을 클릭하면 그 점을 둘러싼 가장 작은
boundary loop 를 검출하여 결과 boundary 를 생성. 본 ADR 은 AxiA 의
equivalent.

## 1. Problem statement

### 1.1 현재 `resynthesize_orphan_faces` 한계

**현재 구현** (`crates/axia-core/src/scene.rs:resynthesize_orphan_faces`):
- 전체 mesh 의 *모든* orphan edges 수집
- `mop_up_orphan_cycles_via_dfs` 가 MAX_ROUNDS=8 동안 DFS 로 모든 cycle 발견
- 발견된 cycle 마다 face 합성

**문제점**:
1. **정밀도 부족** — 사용자가 *특정 영역* 에만 면을 만들고 싶어도 전체
   sweep 발동. 다른 영역의 unwanted face 도 합성될 수 있음.
2. **성능** — 대형 mesh (수천 orphan edges) 에서 O(N²) DFS 비용.
3. **사용자 의도 표현 한계** — "이 영역 boundary 만" 의도 표현 불가.
4. **CAD 표준 deviation** — AutoCAD/SketchUp 등 표준 BOUNDARY 는 *point-
   click* 기반.

### 1.2 메타-원칙 #16 정합 강화

ADR-139 (LOCKED #64) 의 *명시 trigger* 정책의 더 정밀한 표현:
- 현재 `resynthesize-faces` (B-γ MVP) — *전체* 명시 trigger
- **B-γ' (본 ADR)** — *국지적* 명시 trigger (사용자 의도 정밀 표현)

메타-원칙 #16: "자동화는 사용자 의도를 미리 알 수 없다 — 휴리스틱 자동화는
cascading 부작용의 source." Point-localized = *사용자가 명시 지정한 영역*
만 처리 → 다른 영역 부작용 0.

### 1.3 외부 anchor (ADR-139 §10 L-139-5)

> "L-139-5 — Algorithm = planar graph face traversal (기존 DCEL 자산
> + Cardinal projection LOCKED #63 + BVH spatial accel) — 새 알고리즘 0"

본 ADR 은 L-139-5 의 *point-localized* 변형. BVH spatial accel 자연 활용
(point proximity query).

## 2. Solution architecture

### 2.1 Engine API (Rust)

```rust
// crates/axia-geo/src/mesh.rs (또는 operations/boundary.rs 신설)

/// ADR-148 — Point-localized boundary face detection.
///
/// Given a 3D point and a plane, find the *smallest enclosing orphan
/// edge cycle* on that plane containing the point. Returns the synthesized
/// face if found, else None with diagnostic.
///
/// CAD 표준 BOUNDARY 명령 equivalent — user clicks inside a region,
/// tool finds the enclosing boundary.
///
/// # Errors
/// - `BoundaryError::PointNotOnPlane` — 점이 plane 에 평면적 (1.5μm)
/// - `BoundaryError::NoEnclosingCycle` — 점을 둘러싼 cycle 없음
/// - `BoundaryError::CycleAlreadyFaced` — cycle 이 이미 face 가짐
pub fn boundary_from_point(
    mesh: &mut Mesh,
    point: DVec3,
    plane: Plane,
    search_radius: f64, // 0 = unbounded (default 1000mm)
) -> Result<FaceId, BoundaryError>;
```

**Validation 4단계**:
1. point 가 plane 에 평면적 (LOCKED #5 ε=1.5μm)
2. orphan edges 수집 (active edges with no face)
3. 점을 둘러싼 *가장 작은* simple closed cycle 검출
4. cycle 이 이미 face 인지 검사 (중복 차단)

### 2.2 Q1 결재 anchor — 알고리즘 선택

**옵션 (a) — Smallest enclosing cycle (직접)** (정확 path):
- 모든 orphan cycle 추출 (DFS, current implementation 재활용)
- 각 cycle 에 대해 point-in-polygon 2D 검사
- 점 포함 cycle 중 area 최소값 선택
- 구현 비용 ~2-3일
- **장점**: CAD parity (AutoCAD BOUNDARY semantic), 정확
- **단점**: 모든 cycle 추출 비용 (full mesh worst case)

**옵션 (b) — Ray-casting BFS** (효율 path):
- 점에서 임의 방향으로 ray 발사
- ray 와 가장 먼저 교차하는 orphan edge 발견
- 그 edge 에서 시작하여 leftmost-turn walker 로 cycle 완성
- 구현 비용 ~3-4일
- **장점**: O(N) (cycle 추출 없음)
- **단점**: leftmost-turn walker edge case (T-junction, vertex shared)

**옵션 (c) — Hybrid (BVH + DFS)** (균형 path):
- BVH spatial query 로 *search_radius* 이내 orphan edges 만 수집
- 그 subset 에 DFS cycle finder 적용
- point-in-polygon 검사 후 smallest 선택
- 구현 비용 ~2일
- **장점**: search_radius 로 비용 제한, 기존 DFS 재활용
- **단점**: search_radius 휴리스틱 (사용자 지정 또는 default 1000mm)

**최우선 추천: (c) Hybrid** — 기존 DFS 자산 재활용 + BVH spatial accel
정합. search_radius default 1000mm (10×10×10m 작업 공간 표준).
Sprint 2 budget (1주) 정합. ADR-139 L-139-5 "기존 DCEL 자산 + BVH"
canonical 답습.

### 2.3 Q2 결재 anchor — UI integration path

**옵션 (a) — Boundary tool (ToolManager)** (CAD parity):
- 신규 `BoundaryTool` 등록 (`web/src/tools/BoundaryTool.ts`)
- Keyboard shortcut 'B' (현재 'b' = bottom view) — 충돌 → 'Ctrl+B' or 'Alt+B'
- 활성 시 cursor crosshair + 클릭 → `bridge.boundaryFromPoint(...)`
- 구현 비용 ~1일

**옵션 (b) — ContextMenu action** (단순 path):
- 우클릭 → "이 영역 면 만들기" action
- ContextMenu 가시성 — 우클릭 위치 ground plane 추론
- 구현 비용 ~30분
- **장점**: 단순, 즉시 가치
- **단점**: 우클릭 위치 = plane intersection (less explicit)

**옵션 (c) — Both** (full coverage):
- Tool + ContextMenu 둘 다 활성 (사용자 선호 path 선택)
- 구현 비용 ~1.5일

**최우선 추천: (a) BoundaryTool** — ADR-139 §14 B-ε 직계 정합:
> "B-ε — TS BoundaryTool 신규 ('B' 단축키 + cursor crosshair)"
- Shortcut: 'Ctrl+B' (bottom view 'b' 충돌 회피, CAD 관습 정합)
- 향후 ContextMenu 도 추가 가능 (메타-원칙 #5 사용자 편의)

### 2.4 BoundaryError 4 variants

```rust
pub enum BoundaryError {
    /// 점이 plane 에 평면적 (LOCKED #5 ε=1.5μm 초과)
    PointNotOnPlane { distance_mm: f64 },
    /// 점을 둘러싼 orphan cycle 없음 (free space click)
    NoEnclosingCycle,
    /// 발견된 cycle 이 이미 active face
    CycleAlreadyFaced { existing_face_id: FaceId },
    /// search_radius 내 orphan edges 0 (작업 영역 비어 있음)
    NoOrphanEdgesInRadius,
}
```

Toast.error 매핑 (한국어):
- PointNotOnPlane → "클릭 위치가 평면 위가 아닙니다 (거리 {N}mm)"
- NoEnclosingCycle → "이 영역을 둘러싼 boundary 가 없습니다"
- CycleAlreadyFaced → "이 영역에 이미 면이 있습니다"
- NoOrphanEdgesInRadius → "주변에 boundary 후보가 없습니다 (반경 {R}mm 확대 필요)"

## 3. Sub-step plan (Path Z atomic)

### 3.1 Plan 매트릭스

| Sub-step | Scope | 비용 | 회귀 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | ~30분 | 0 |
| **β-1** | Engine API skeleton + BoundaryError + 4 validation | ~1일 | axia-geo +4 |
| **β-2** | Engine algorithm (Hybrid BVH + DFS, Q1=c) | ~2일 | axia-geo +3 (happy path + smallest selection) |
| **β-3** | WASM bridge + TS wrapper | ~30분 | axia-wasm +2 + vitest +2 |
| **β-4** | UI BoundaryTool (Q2=a, Ctrl+B) | ~1일 | vitest +3 |
| **γ** | E2E (Playwright) + closure docs (Status flip + §9 Lessons) | ~1시간 | Playwright +1 |
| **합계** | **~4-5일 (Sprint 2 1주 share)** | | **+15** |

### 3.2 Path Z atomic 답습

ADR-145 (Circle annulus) / ADR-146 (Step 1 Inferencing) / ADR-139 (Boundary
tool) 패턴 답습 — sub-step 별 single atomic PR.

### 3.3 회귀 추정

axia-geo +7 / axia-wasm +2 / vitest +5 / Playwright +1 = **+15 total**.
ADR-141 §3 Sprint 2 share +30 의 ~50% (ADR-147 자연 분담 +15).

## 4. Lock-ins

- **L-148-1** ADR-139 명시 trigger only — 사용자 클릭 = 명시 의도
  (휴리스틱 자동 활성 0, 메타-원칙 #16 정합)
- **L-148-2** ADR-139 L-139-5 정합 — 기존 DCEL + BVH 자산 재활용
  (새 알고리즘 0, Hybrid Q1=(c) 채택 근거)
- **L-148-3** LOCKED #5 정합 — point-plane proximity 1.5μm spatial-hash
  tolerance
- **L-148-4** LOCKED #63 z=0 invariant 정합 — Cardinal plane snap 시
  자동 Z=0 plane 추론 (사용자 facing 단순화)
- **L-148-5** LOCKED #44 (Complete Meaning per Merge) — 각 sub-step
  single atomic PR
- **L-148-6** LOCKED #66 (Sunset Policy) — α "Proposed" / γ "Accepted"
- **L-148-7** 절대 #[ignore] 금지 — 15 회귀 자산 모두 enabled
- **L-148-8** ADR-046 P31 #4 additive only — `Mesh` / `WasmBridge`
  signature UNCHANGED, 새 method 추가만
- **L-148-9** Keyboard shortcut canonical — Ctrl+B (bottom view 'b'
  충돌 회피, CAD 관습 정합)
- **L-148-10** BoundaryError variants 4 명시 — silent skip 차단,
  사용자 facing Toast.error 한국어 매핑

## 5. Out of scope (별도 ADR)

- **Multi-loop boundary** (ring with holes) — 본 ADR 은 single simple
  closed cycle. Multi-loop ADR-016 Q2 정책 정합 별도.
- **3D BOUNDARY** (closed shell from orphan faces) — ADR-139 §14 B-μ,
  별도 ADR
- **Auto plane inference** (사용자 점만 클릭, plane 자동 추론) —
  ADR-141 §3 reserve 외부, future ADR
- **ContextMenu integration** — Q2=(a) BoundaryTool 우선, ContextMenu
  는 follow-up ADR

## 6. Cross-link

- **ADR-141** (Master Roadmap S2)
- **ADR-139** (LOCKED #64 Boundary tool 명시 only — 직계 predecessor)
- **ADR-146** (Step 1 Inferencing — Sprint 2 첫 ADR closure)
- **ADR-016** (Multi-loop face Q2 — 별도 deferred)
- **외부 anchor**: ADR-139 §14 B-γ' sub-step + reports/입력보정파이프라인_
  적용계획.html §priority P9~P12
- **LOCKED #5** (1.5μm spatial-hash — proximity tolerance)
- **LOCKED #44** (Complete Meaning per Merge)
- **LOCKED #63** (z=0 invariant — Cardinal plane snap)
- **LOCKED #64** (ADR-139 — direct predecessor)
- **LOCKED #65** (ADR-141 Master Roadmap S2 reserve)
- **LOCKED #66** (ADR-164 Sunset Policy)
- **메타-원칙 #5** (사용자 편의 — 명시 trigger)
- **메타-원칙 #14** (면은 닫힌 경계로부터 유도된다 — Jordan-Schoenflies)
- **메타-원칙 #16** (자동화 antipattern — 사용자 클릭 명시 의도)

## 7. Sub-step roadmap

| Sub-step | Scope | 회귀 | 비용 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | 0 | ~30분 |
| **β-1** | Engine API skeleton + BoundaryError + 4 validation | axia-geo +4 | ~1일 |
| **β-2** | Engine algorithm (Hybrid Q1=c) | axia-geo +3 | ~2일 |
| **β-3** | WASM bridge + TS wrapper | axia-wasm +2 + vitest +2 | ~30분 |
| **β-4** | UI BoundaryTool (Q2=a, Ctrl+B) | vitest +3 | ~1일 |
| **γ** | E2E + closure docs | Playwright +1 | ~1시간 |
| **합계** | | **+15** | **~4-5일** |

각 sub-step single atomic PR (LOCKED #44).

## 8. Acceptance Log

- **2026-05-26 α** (본 commit) — α spec + Q1/Q2 결재 anchor + sub-step
  plan + lock-ins.
- **(β-1 ~ γ, ~4-5일)** — 별도 사용자 결재 후 진행 (Q1 결정 + Q2 결정).

---

**다음 trigger**: β-1 진입 결재 (Q1 → 옵션 (c) Hybrid 권장 / Q2 →
옵션 (a) BoundaryTool 권장)
또는 Sprint 2 잔존 ADR-147 (Step 2 Scenario B1) 진입.
