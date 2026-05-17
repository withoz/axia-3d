# ADR-109 — Arc Extrusion → Cylinder Surface Promotion

| Field | Value |
|---|---|
| Status | **Draft (spec only, π-α — 사용자 결재 2026-05-16)** |
| Date | 2026-05-16 |
| Supersedes | — |
| Related | ADR-079 (Create Solid surface-native — W-2-γ Cylinder branch), ADR-094 (Path B-full default ON), ADR-107 (`*AsShape` → Path B Canonical Unification), ADR-093 (cylinder side face owner-id grouping), ADR-027/028 (NURBS Kernel + Edge curve attach) |
| Cross-cut | 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다"), 메타-원칙 #15 ("동일 분할 = 동일 topological contract") |

## 1. Anchor 통찰 (canonical, 사용자 2026-05-16)

> **"호 그리기 잘됩니다. 현재 화면에서 원통과 반원통이 성질이 다릅니다."**

사용자 시각 시연:
- 완전 cylinder (drawCircleAsCurve + extrude) = 매끈 single cylindrical side face
- 반원통 (Arc + chord + extrude) = **16 vertical edges visible, N quad side faces**

ADR-107 (Circle → Path B 통합) + ADR-094 (Path B-full default) 으로 *Circle* 영역의 Cylinder surface promotion 완료. 그러나 **Arc + chord 의 mixed boundary** 영역 미반영 — 결함 G 의 자연 sibling.

## 2. 발견 (audit evidence 2026-05-16)

| 도구 path | Faces | Cylinder surface | Layer |
|---|---|---|---|
| Full cylinder (drawCircleAsCurve + extrude) | 3 (top + bottom + side) | **1** ✅ | Path B canonical |
| **Half cylinder (Arc + chord + extrude)** | **19** (2 caps + chord side + **16 quad sides**) | **0** ❌ | **Q3 fallback** (legacy push_pull) |

### 2.1 Architectural root cause

`create_solid_extrude` (engine) 의 dispatch:
1. `classify_boundary` (create_solid.rs:2569) — Arc 와 Line 섞이면 **`BoundaryKind::Mixed`**
2. `match (Plane, Mixed)` → **`SolidError::NotYetSupported`** ("Plane mixed boundary → GeneralSweep (W-3 scope)")
3. Scene dispatch 가 NotYetSupported → **`Q3 fallback to legacy push_pull`** (axia-wasm/lib.rs:3032)
4. Legacy push_pull = mesh-level extrude — N quad sides 모두 **Plane surface** (chord 평면, Cylinder metadata 없음)

→ Arc curve metadata 가 inspect 안 됨 → 16 quad sides 가 각 Plane → smooth-group hide (Cylinder 만 인식) 미작동 → vertical edges visible.

### 2.2 결함의 사용자 facing 효과

- **시각**: 16 vertical edges visible (사용자 통찰의 직접 evidence)
- **Selection**: 16 quad sides 각각 별개 entity (ADR-093 owner-id grouping 미작동 — Cylinder surface 부여 안 됨)
- **Engine ops**: 후속 Offset / Boolean / Fillet 에서 Cylinder surface 인식 안 됨 (모두 Plane 으로 처리)

## 3. Decision (canonical fix scope)

본 ADR 은 **fallback push_pull 후 post-process** 로 Arc side faces 에 Cylinder surface 자동 promote. ADR-079 W-2-γ 의 자연 extension — Mixed boundary 영역의 Arc 측 측면만 promote.

### 3.1 P-1 (canonical) — Post-process Cylinder surface promotion

`create_solid_extrude` 의 Q3 fallback path 결과 후, 새 side faces 의 bottom boundary edge 가 `AnalyticCurve::Arc` 부여된 경우 → 그 side face 에 **Cylinder surface attach** (Arc 의 center / radius / normal 활용).

```rust
// Post-process (가칭):
fn promote_arc_side_faces_to_cylinder(
    mesh: &mut Mesh,
    side_faces: &[FaceId],
    extrude_axis: DVec3,
) {
    for &side in side_faces {
        // boundary edges 중 Arc curve attach 된 edge 찾기
        let Some(arc_params) = find_arc_curve_in_boundary(mesh, side) else { continue };
        // Cylinder surface 부여 (Arc 의 axis = extrude direction, radius = Arc.radius)
        let cylinder = AnalyticSurface::Cylinder {
            axis_origin: arc_params.center,
            axis_dir: extrude_axis,
            radius: arc_params.radius,
            ref_dir: arc_params.basis_u,
            u_range: ...,
            v_range: ...,
        };
        mesh.set_face_surface(side, Some(cylinder));
    }
}
```

### 3.2 5 lock-in 원칙 (canonical)

- **L1 — Post-process only** (Q3 fallback path 자체 unchanged): 기존 `extrude_planar_box` / `extrude_planar_cylinder` 분기 무변화. Mixed boundary 만 post-process.
- **L2 — Arc curve detection**: side face 의 bottom boundary edge inspect. `Some(AnalyticCurve::Arc { center, radius, normal, basis_u, .. })` 부여된 edge → promotion.
- **L3 — Chord/Line side faces UNCHANGED**: Mixed boundary 의 chord 측 (Line edge) side face 는 Plane 그대로. Arc 측만 Cylinder.
- **L4 — Same Cylinder surface for all Arc side faces**: N Arc sub-segments 의 N quad sides 가 모두 **동일 Cylinder surface instance** (axis_origin, axis_dir, radius, ref_dir 동일). ADR-094 Path B-full 의 single side face canonical 답습 (단 face count 는 N 그대로 — surface metadata 만 unification).
- **L5 — Render path 자동 정합**: ADR-089 A-τ smooth-group edge hide (mesh.rs:5388-5404) 가 `surfaces_in_same_smooth_group` Cylinder branch 자동 활성 → vertical edges hide. 시각적 매끈 cylindrical side.

### 3.3 LOCKED 정책 정합

- **LOCKED #16 (ADR-038 P23 + K-ε hotfix)**: render path 의 coplanar Plane edge hide 정책 자동 적용 + Cylinder smooth-group hide ✅
- **LOCKED #26 (ADR-049 Two-Layer Citizenship)**: Shape/Xia 시민권 영향 0 (surface metadata 만 변경)
- **LOCKED #35 (ADR-094 Path B-full)**: Circle 영역의 single side face canonical — 본 ADR 은 Mixed 영역의 N quad sides 의 **surface metadata 통합** (face count unchanged)
- **메타-원칙 #14 / #15**: Layer 일관성 강화

## 4. Approach — Path Z atomic plan

### 4.1 Step roadmap

| Step | Title | 변경 | 회귀 (예상) | Risk |
|---|---|---|---|---|
| **π-α** | Spec only (본 commit) | docs only | 0 | 0 |
| **π-β** | Engine fix — `promote_arc_side_faces_to_cylinder` helper + Q3 fallback path 통합 | axia-geo +3~5 | 낮음 (additive) |
| **π-γ** | 미리보기 시연 — 사용자 시연 reproduce + Cylinder surface confirmed | Playwright +1 (선택) | 낮음 |
| **π-δ** | Closure — CLAUDE.md amendment 또는 docs update | 0 | 낮음 |

**누적 회귀 예상**: **+3~6** (절대 #[ignore] 금지 100% 준수).

### 4.2 사용자 결재 시점

- π-α 진입 결재 (✅ 본 commit, 사용자 결재 2026-05-16)
- π-β/γ/δ 별 결재 (Path Z atomic)

## 5. Out-of-scope (deferred)

- **Side face count unification** (16 quad sides → 1 cylindrical face) — Path B-full 의 진정한 single side face 통합. 별도 ADR (multi-week). 본 ADR 은 surface metadata 만 통합.
- **Bezier / BSpline / NURBS curve extrude → Surface promotion** — Arc 의 cylindrical analog. NURBS surface promotion 은 별도 ADR.
- **Cone surface promotion** (Arc + non-parallel chord → 부채꼴 → Cone) — Arc 의 special case 외, 별도 ADR.
- **Revolve / Sweep / Loft 영역** — Extrude only. 본 ADR scope 외.
- **Render path 변경** — ADR-089 A-τ smooth-group hide 가 자동 정합. 본 ADR scope 외.

## 6. 회귀 영향 예측

- **기존 회귀 자산**: 영향 0 (additive only — Q3 fallback path unchanged, Mixed boundary post-process 만 추가)
- **새 회귀 자산**: +3~5 (axia-geo)
  - `adr109_pi_beta_arc_extrude_promotes_cylinder` — 반원통 reproduce → 16 quad sides 의 Cylinder surface 확인
  - `adr109_pi_beta_chord_side_unchanged` — chord side 의 Plane surface 보존 (L3 scope 정확성)
  - `adr109_pi_beta_full_cylinder_unchanged` — Path B full cylinder 영향 0
- **사용자 facing 변화**: 반원통 의 16 quad sides 가 single Cylinder surface 공유 → smooth-group hide 자동 활성 → vertical edges hide → **매끈 cylindrical side** (사용자 시각 시연 정합) ✨

## 7. Acceptance criteria (π-α 시점)

본 commit (π-α) 가 만족해야:
- ✅ `docs/adr/109-arc-extrude-cylinder-promotion.md` 신설 (본 파일)
- ✅ §1 Anchor (사용자 통찰) / §2 audit evidence / §3 Decision (P-1 + L1~L5) / §4 Path Z atomic plan / §5 Out-of-scope / §6 회귀 영향 / §7 Acceptance criteria 명시
- ✅ ADR-079/094/107/093/027/028 cross-link
- ✅ 메타-원칙 #14 / #15 명시
- ✅ Code 변경 0 — spec only

## 8. Cross-link

- **ADR-079** (Create Solid surface-native) — W-2-γ Cylinder branch 의 Arc + Mixed boundary 자연 extension
- **ADR-094** (Path B-full default ON) — 완전 cylinder 의 Path B canonical (반원통은 본 ADR scope)
- **ADR-107** (`*AsShape` → Path B Canonical Unification) — Circle 영역 canonical, Arc 는 본 ADR sibling
- **ADR-093** (cylinder side face owner-id grouping) — 본 ADR 의 Cylinder surface promotion 후 자동 활성
- **ADR-027/028** (NURBS Kernel + Edge curve attach) — Arc curve metadata 의 prerequisite
- **ADR-089 A-τ** (smooth-group edge hide) — Cylinder surface 부여 후 자동 정합
- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") — Arc boundary 에서 Cylindrical side face 유도
- **메타-원칙 #15** ("동일 분할 = 동일 topological contract") — Arc 영역의 cross-cut layer 일관성

---

*ADR-109 π-α — Arc Extrusion → Cylinder Surface Promotion 의 architectural
spec. ADR-079 W-2-γ 의 Mixed boundary 영역 자연 extension. 사용자 시연
"원통과 반원통의 성질이 다름" (2026-05-16) 의 root cause fix.*
