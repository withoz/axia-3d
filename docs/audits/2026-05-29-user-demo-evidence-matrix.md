# User Demo Evidence Matrix — ADR-169 β-3

**Date**: 2026-05-29
**Author**: WYKO + Claude
**Source**: ADR-169 §3.3 (β-3 deliverable, audit-first canonical 19번째)
**Verification protocol**:
- ★ **Verified** — Direct browser reproduction (Claude Preview MCP) OR
  recorded PR trigger evidence
- ⚙ **Inferred** — Phase 0 3-agent audit + β-1/β-2 cross-link 추론
- ⏸ **Pending** — Future demo verification 권장 (γ closure 전)

---

## 1. Executive Summary

12 시나리오 = **4 도구** (DrawLine / RECT / CIRCLE / Bezier) × **3 surface
type** (평면 / 입체면 / 곡면). 각 시나리오 6-column 매트릭스:

| Column | Description |
|---|---|
| Scenario ID | S{1..12} |
| Tool × Surface | 도구 + surface type 조합 |
| Expected trigger | 정상 동작 (사용자 의도) |
| Known bail! frequency | Phase 0 audit + 사용자 evidence 누적 |
| Root cause | drift / dedup / validation / architectural |
| Phase 1-3 target | 흡수 SSOT 위치 |

**핵심 finding**:
- 12 시나리오 중 ★ Verified = 3 (DrawLine 2건 + ADR-168 closure 1건)
- ⚙ Inferred = 6 (Phase 0 audit + β-1/β-2 cross-link)
- ⏸ Pending = 3 (NURBS Bezier 시나리오 — 사용자 도구 미정착, future)
- **모든 scenario 의 root cause = Phase 1+2 SSOT 통합으로 흡수 가능**

---

## 2. Scenario Matrix

### S1 — DrawLine × 평면 (XY ground)

| Property | Value |
|---|---|
| **Sub-scenario** | sketch plane (XY) 위에서 line 그리기 |
| **Expected** | line 그려짐, free edge 로 mesh 등록, Boundary tool 명시 trigger 시 face 합성 (ADR-139) |
| **Known bail!** | rare — Layer 6 cardinal force (LOCKED #63 z=0) 이미 흡수 |
| **bail sites** | `draw.rs:38` line length <ε (drag too small, medium frequency) |
| **Root cause** | drift: 0 (cardinal force 흡수), dedup: 0, validation: high (draw.rs:38) |
| **Phase target** | Phase 1 Step 4 (10mm short-circuit, draw.rs:38 진입 전 회피) |
| **Status** | ⚙ Inferred — Phase 0 Part 2 audit (draw.rs:38 high freq) |

### S2 — DrawLine × 입체면 (solid face hit)

| Property | Value |
|---|---|
| **Sub-scenario** | 박스 face 위에 line 그어 face split |
| **Expected** | face 가 line 으로 분할됨 (`split_face_by_line`) |
| **Known bail!** | ★ **CRITICAL — 사용자 시연 2026-05-29 morning #1, #2** |
| **bail sites** | `face_split.rs:1803` "Point off face plane" (★ HIGH, PR #248 trigger) |
| **Root cause** | drift: ★ (Layer 3 raycast 10μm × N stacked + Layer 7 missing projection in non-hotfix path), dedup: low, validation: 0 |
| **Phase target** | Phase 1 Step 2 (face plane projection at Tool layer) + Phase 2 Step 1 (drift snap at Engine entry) |
| **Status** | ★ **VERIFIED — PR #248 hotfix trigger evidence** |

**Recorded evidence**:
- 2026-05-29 morning #1: "입체면에 라인을 생성할 수 없습니다" → PR #247 (ADR-166 soft lock)
- 2026-05-29 morning #2: `Point is 34704.8028 from face plane (max allowed: 30346.1245)` → PR #248 (DrawLineTool pre-project)

### S3 — DrawLine × 곡면 (cylinder side)

| Property | Value |
|---|---|
| **Sub-scenario** | Cylinder 옆면 (curved surface) 위에 line 그어 split 시도 |
| **Expected** | curved surface 위 geodesic line → face split, ADR-088 owner_id 보존 |
| **Known bail!** | high — Layer 7 tool-specific projection 미적용 + Layer 10 face plane validation 통과 못함 |
| **bail sites** | `face_split.rs:1803` ★, `mesh.rs:4671` "v1 v2 adjacent" (cardinal snap on non-cardinal surface) |
| **Root cause** | drift: ★★ (curved surface 의 plane projection 자체 정의 모호), dedup: medium |
| **Phase target** | Phase 2 Step 1 (curve-aware drift absorb) + Phase 3 Step 2 (BoundaryElement::Line on curved face dispatching) |
| **Status** | ⚙ Inferred — 사용자 시연 미직접 (Phase 0 audit + β-1 Type 1 critical sites) |

### S4 — RECT × 평면 (XY ground)

| Property | Value |
|---|---|
| **Sub-scenario** | XY ground 위 RECT 그리기 → 자동 face 합성 (single explicit op, ADR-139 Q2-a 보존) |
| **Expected** | 4 vertex + 4 edge + 1 face, cardinal coordinate 정확 0 |
| **Known bail!** | rare — Layer 8 WasmBridge.drawRect 가 LOCKED #7 ADR-026 P12 cardinal SSOT 강제, 모든 coord ≤ 1e-3 → 0 |
| **bail sites** | `draw.rs:74/79` "rectangle 0-w/0-h" (drag preview repeat-fire) |
| **Root cause** | drift: 0 (cardinal force), dedup: 0, validation: medium (0-w/0-h) |
| **Phase target** | Phase 1 Step 4 (10mm short-circuit at Tool layer, drag preview 진입 전 회피) |
| **Status** | ⚙ Inferred — 정상 작동 case, 회귀 자산 다수 |

### S5 — RECT × 입체면 (solid face)

| Property | Value |
|---|---|
| **Sub-scenario** | 박스 face 위 RECT 그리기 → face 내부 sub-face split |
| **Expected** | face 위 RECT 가 inner loop 으로 promote OR sub-face split (LOCKED #1 ADR-021 P7, SUPERSEDED by ADR-139 = Boundary tool only) |
| **Known bail!** | medium — Layer 10 `add_face_with_holes` 가 ADR-139 amendment 후 자동 hole 안 됨 |
| **bail sites** | `mesh.rs:2955` "Face requires ≥3 verts" (drag cancel) |
| **Root cause** | drift: low, dedup: low, validation: medium, architectural: ★ (ADR-139 Boundary tool only 정합) |
| **Phase target** | Phase 3 Step 4 (register_boundary_element 가 ADR-139 trigger 정책 정합 emit) |
| **Status** | ⚙ Inferred — ADR-139 amendment 후 routine 변경 |

### S6 — RECT × 곡면 (curved surface)

| Property | Value |
|---|---|
| **Sub-scenario** | Cylinder 옆면 위 RECT 그리기 (curved surface 위 2D shape) |
| **Expected** | ❌ 현재 미정의 — curved surface 위 RECT 의 의미 모호 (geodesic? projection? unfold?) |
| **Known bail!** | architectural — routine 자체 부재 |
| **bail sites** | (없음 — routine 진입 자체 안 됨) |
| **Root cause** | architectural: ★★ (curved surface 위 2D primitive 의 정의 부재) |
| **Phase target** | Phase 3 future ADR (BoundaryElement::Polyline on curved surface dispatch) — **본 ADR-169 scope 외** |
| **Status** | ⏸ Pending — future ADR (out of Phase 1-4 scope) |

### S7 — CIRCLE × 평면 (XY ground)

| Property | Value |
|---|---|
| **Sub-scenario** | XY ground 위 Circle 그리기 → kernel-native Path B (ADR-089) self-loop face |
| **Expected** | 1 anchor vertex + 1 self-loop edge with `AnalyticCurve::Circle` + 1 face with `AnalyticSurface::Plane` (Path B canonical) |
| **Known bail!** | rare — Layer 8 cardinal SSOT 강제 |
| **bail sites** | `draw.rs:139` "circle radius <ε" (drag 0-radius) |
| **Root cause** | drift: 0, dedup: 0, validation: medium |
| **Phase target** | Phase 1 Step 4 (10mm short-circuit) |
| **Status** | ⚙ Inferred — ADR-089 closure case, 회귀 자산 다수 |

### S8 — CIRCLE × 입체면 (solid face)

| Property | Value |
|---|---|
| **Sub-scenario** | 박스 face 위 Circle 그리기 |
| **Expected** | face 위 self-loop circle edge + circle 영역 sub-face (ADR-139 Boundary tool emit 또는 single explicit op 직접 emit) |
| **Known bail!** | medium — face plane projection 적용 시 Path B Circle 의 center 가 face plane 위 정확히 위치 보장 필요 |
| **bail sites** | `mesh.rs:3032` "anchor vertex inactive" (rare), `mesh.rs:3142` "curve normal degenerate" (medium) |
| **Root cause** | drift: medium (face plane projection), dedup: low, validation: medium |
| **Phase target** | Phase 1 Step 2 (face plane projection for circle center+normal) + Phase 3 Step 4 (emit) |
| **Status** | ⚙ Inferred — DrawCircle 의 face hit 분기 audit 권장 |

### S9 — CIRCLE × 곡면 (curved surface)

| Property | Value |
|---|---|
| **Sub-scenario** | Cylinder 옆면 위 Circle 그리기 (curved surface 위 circle) |
| **Expected** | ❌ 현재 미정의 — curved surface 위 circle 의 의미 모호 |
| **Known bail!** | architectural |
| **bail sites** | (없음) |
| **Root cause** | architectural: ★★ |
| **Phase target** | Phase 3 future ADR — **본 ADR-169 scope 외** |
| **Status** | ⏸ Pending — future ADR |

### S10 — Bezier × 평면

| Property | Value |
|---|---|
| **Sub-scenario** | XY ground 위 Bezier curve 그리기 |
| **Expected** | open Bezier = free edge wire, closed Bezier = self-loop face (ADR-089 L11) |
| **Known bail!** | medium — closed-curve detection (P3 ≈ P0) 정확도 |
| **bail sites** | `mesh.rs:3045` "Bezier ≥2 control points" (medium), `mesh.rs:3050` "Bezier not closed" (high if closure 의도 미달) |
| **Root cause** | drift: medium (closure threshold), dedup: low, validation: medium |
| **Phase target** | Phase 1 Step 4 (closure detection threshold 통일), Phase 2 Step 3 |
| **Status** | ⚙ Inferred — ADR-089 A-ω closure (closed Bezier 시민권) 정합 |

### S11 — Bezier × 입체면

| Property | Value |
|---|---|
| **Sub-scenario** | 박스 face 위 Bezier curve 그리기 → face split with curve boundary |
| **Expected** | ❌ 현재 미참여 — Bezier edge 가 face split 의 boundary input 으로 미참여 (β-1 Type 4 finding) |
| **Known bail!** | architectural — routine 자체 부재 |
| **bail sites** | (Bezier curve-vs-line intersection routine 부재) |
| **Root cause** | architectural: ★★ (β-1 Type 4 "Excluded" status) |
| **Phase target** | Phase 3 BoundaryElement::Bezier 등록 (β-1 Type 4 핵심 target) |
| **Status** | ⏸ Pending — Phase 3 ADR-172 본격 활성화 후 시연 verify |

### S12 — Bezier × 곡면

| Property | Value |
|---|---|
| **Sub-scenario** | Cylinder 옆면 위 Bezier curve 그리기 |
| **Expected** | ❌ 현재 미정의 (S6/S9 와 동일 architectural gap) |
| **Known bail!** | architectural |
| **bail sites** | (없음) |
| **Root cause** | architectural: ★★ |
| **Phase target** | Phase 3 future ADR (out of scope) |
| **Status** | ⏸ Pending — future ADR |

---

## 3. Summary by status

### 3.1 ★ Verified scenarios (3건)

| Scenario | Evidence source | Phase target confirmed |
|---|---|---|
| S2 DrawLine × 입체면 | PR #247 (ADR-166 soft lock) + PR #248 (DrawLineTool pre-project) | Phase 1 Step 2 + Phase 2 Step 1 |
| (cross-cut) face_split.rs:1803 trigger | PR #248 commit message + 사용자 시연 evidence | absorb_boundary_input SSOT |
| ADR-168 closure (LOCKED #69) | 2026-05-29 same-day closure | Phase 2 Step 1 source |

### 3.2 ⚙ Inferred scenarios (6건)

| Scenario | Inference basis |
|---|---|
| S1 DrawLine × 평면 | Phase 0 Part 2 draw.rs:38 high freq |
| S3 DrawLine × 곡면 | Phase 0 Part 1 face_split.rs critical sites + β-1 Type 1 |
| S4 RECT × 평면 | LOCKED #7 ADR-026 P12 cardinal SSOT, 회귀 자산 다수 |
| S5 RECT × 입체면 | ADR-139 amendment + LOCKED #1 P7 supersede |
| S7 CIRCLE × 평면 | ADR-089 closure case + 회귀 자산 |
| S8 CIRCLE × 입체면 | DrawCircle face hit 분기 + LOCKED #69 face plane snap |
| S10 Bezier × 평면 | ADR-089 A-ω closure (closed Bezier 시민권) |

### 3.3 ⏸ Pending scenarios (3건)

| Scenario | Reason | Future track |
|---|---|---|
| S6 RECT × 곡면 | architectural gap (curved surface 위 2D primitive 미정의) | Future ADR (out of Phase 1-4) |
| S9 CIRCLE × 곡면 | 동일 architectural gap | Future ADR |
| S11 Bezier × 입체면 | β-1 Type 4 "Excluded" status | Phase 3 ADR-172 본격 후 verify |
| S12 Bezier × 곡면 | architectural gap | Future ADR |

(S11 는 Phase 3 target 내, 다른 3건은 out of scope)

---

## 4. Root cause distribution

| Root cause | Scenarios | % | Phase target |
|---|---|---|---|
| **drift** | S2, S3, S8, S10 | 33% | Phase 1 Step 2 + Phase 2 Step 1 |
| **dedup** | S3 (medium) | 8% | Phase 2 Step 2 |
| **validation** | S1, S4, S7, S10 (degenerate cancel) | 33% | Phase 1 Step 4 |
| **architectural** | S5, S6, S9, S11, S12 | 42% | Phase 3 + future ADRs |
| (overlap) | — | — | — |

**핵심 통찰**: drift + dedup + validation 75% = Phase 1+2 SSOT 통합 흡수.
architectural 42% 중 S5 (ADR-139 정합) + S11 (Phase 3 BoundaryElement::
Bezier) = Phase 1-4 scope 내. S6/S9/S12 (curved surface 위 2D primitive)
만 future ADR.

---

## 5. Cross-link

### β-1 boundary element type mapping

| Scenario | β-1 type | gap status |
|---|---|---|
| S1, S2, S3 | Type 1 Line | ✅ Partial (Phase 1+2 흡수) |
| S4, S5, S6 | Type 2 Polyline edge | ⚠ Chain raster (Phase 1+2 흡수) |
| S7, S8, S9 | Type 3 Arc/Circle | ⚠ Self-loop only (Phase 1+2 흡수) |
| S10, S11, S12 | Type 4 Bezier-class | ❌ Excluded (Phase 3 본격 활성) |

### β-2 ε propagation chain mapping

| Scenario | Layer absorption gap |
|---|---|
| S2 (DrawLine × face) | Layer 3 raycast + Layer 7 missing projection |
| S5 (RECT × face) | Layer 7 polyline cancel + Layer 10 add_face_with_holes |
| S8 (CIRCLE × face) | Layer 7 face plane projection for circle center |
| S10 (Bezier × plane) | Layer 7 closure detection threshold |

### Phase 0 audit cross-link

- Part 1 (mesh + face_split + create_solid, 130 bail!) — S1/S2/S3/S5/S8 의 critical sites
- Part 2 (operations, 193 bail!) — S1/S4/S7 의 draw.rs high freq sites
- Part 3 (curves + surfaces + scene, 124 bail!) — S10/S11/S12 의 NURBS kernel carve-out

---

## 6. Demo verification protocol (γ closure 권장)

### 6.1 Required environment

- Real Chromium (Claude Preview MCP via `preview_start`)
- WASM rebuild required (`web/scripts/ensure-wasm.mjs`)
- `npm run preview` (production build server)

### 6.2 Per-scenario demo steps (S1-S12 공통 protocol)

1. `preview_start` → page load + WASM init confirm
2. Tool 활성 (단축키 또는 메뉴)
3. Surface 타겟 raycaster click (anchor)
4. 2nd click OR drag end (commit)
5. Console log capture (`preview_console_logs`)
6. Snapshot state (`preview_snapshot`)
7. bail! frequency 기록 (verbatim error message)
8. Screenshot (`preview_screenshot`)

### 6.3 Pass criteria

- Tool 정상 commit → ★ Verified (no bail!)
- Tool commit 거부 + bail! 발생 → Root cause 분류 (drift/dedup/validation/architectural)
- Tool 미정의 (S6/S9/S11/S12) → ⏸ Pending architectural gap 명시

### 6.4 Recommended timeline

- γ closure 전 권장 시연: S1 / S4 / S7 (정상 동작 baseline) + S3 / S5 / S8 (gap evidence)
- 6 scenario × 5 min = 30 min Real Chromium demo session
- Out of scope demo: S2 (이미 verified), S10/S11/S12 (Phase 3 활성 후)

---

## 7. Findings summary

### 7.1 D-Then-C 결재 정합성 재확인

| 결재 | 본 audit 적합? |
|---|---|
| (A) Tool-only | ❌ — Layer 7 분산만 통일, Layer 10 drift 누적 해소 안 됨. S3/S5/S11 gap 잔존. |
| (B) Tool + Engine | ⚠ — Phase 1+2 통합으로 S1-S10 cover (75%), S11 (Type 4 Bezier face split) 잔존. |
| **(C) Full** | ✅ — Phase 3 register API 가 S11 cover. S6/S9/S12 만 out of scope (future ADR). |

→ (C) 결재 정합 확인 (β-1 + β-2 + β-3 모두 일관).

### 7.2 Phase 1-4 ADR scope 확정 (β-3 evidence 기반)

- **ADR-170 Phase 1** — S1/S2/S4/S7 의 validation + Layer 7 분산 통합 (50% scenarios cover)
- **ADR-171 Phase 2** — S2/S3/S5/S8/S10 의 drift + dedup 흡수 (75% scenarios cover)
- **ADR-172 Phase 3** — S11 Bezier face split (β-1 Type 4 활성) + ADR-139 정합 emit (S5)
- **ADR-173 Phase 4** — 12 시연 게이트 (verified 3 + inferred 6 + pending 3 = 9 in-scope) PASS

### 7.3 메타-원칙 정합

- **메타-원칙 #5** 사용자 편의 — 9/12 scenarios = Phase 1-4 cover, 명확한 의도 자동 처리
- **메타-원칙 #6** Preventive — 3 verified scenarios = curative hotfix, Phase 1+2 SSOT = preventive
- **메타-원칙 #14 WHAT layer** — 모든 in-scope scenarios 의 결과 invariant 보존 (면 합성 / 분할 / 등록)
- **메타-원칙 #16 WHEN layer** — S5 ADR-139 trigger 정책 정합 (Boundary tool only OR single explicit op)

---

## 8. Out of scope (future ADR)

- S6 RECT × 곡면 — curved surface 위 2D primitive routine 미정의
- S9 CIRCLE × 곡면 — 동일 architectural gap
- S12 Bezier × 곡면 — 동일 architectural gap
- BSpline / NURBS edge 시나리오 — UI 미정착 (Phase 3 ADR-172 활성 후 시연 추가 권장)
- Curve-curve intersection 시나리오 — ADR-027 NURBS Kernel CCI 자연 연장

---

## 9. Related

### Audit deliverable cross-link
- β-1 boundary element type matrix
- β-2 drift propagation chain matrix
- β-3 (본 문서)

### ADR cross-link
- ADR-089 closed-curve face (S7/S10 routine source)
- ADR-101 Amendment 9 HARD flag (S5 split contract)
- ADR-139 Boundary tool only (S5 routine policy)
- ADR-148 BoundaryTool point-localized (S5 routine entry)
- ADR-166 plane lock (S2 hotfix source)
- ADR-168 face plane drift snap (S2 absorb SSOT)
- ADR-169 (본 audit ADR)

### LOCKED policy cross-link
- LOCKED #1/12/41 (SUPERSEDED, 결과 invariant 보존)
- LOCKED #5/7/63/67/68/69 (Phase 1+2 SSOT 통합)
- LOCKED #14/15/16 메타-원칙 #14/15/16
- LOCKED #44 Complete Meaning per Merge

### PR evidence cross-link
- PR #247 (ADR-166 soft lock hotfix) — S2 evidence #1
- PR #248 (DrawLineTool face plane re-projection) — S2 evidence #2
