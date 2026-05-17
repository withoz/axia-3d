# ADR-107 — `*AsShape` → Path B Canonical Unification (Layer Separation Policy)

| Field | Value |
|---|---|
| Status | **Draft (spec only, ζ-α — 사용자 결재 2026-05-16)** |
| Date | 2026-05-16 |
| Supersedes | — |
| Related | ADR-019 (Line is Truth), ADR-027 (NURBS Kernel), ADR-028 (Edge curve attach), ADR-049/050 (Two-Layer Citizenship Shape/Xia), ADR-087 (Kernel-Native Command Suite Reset), ADR-088 (curve_owner_id grouping), ADR-089 (Path B closed-curve face), ADR-094 (Path B-full default ON), ADR-101 Amendment 9 (메타-원칙 #15 lock-in) |
| Cross-cut | 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다"), 메타-원칙 #15 ("동일 분할 = 동일 topological contract") |

## 1. Anchor 통찰 (canonical, 사용자 2026-05-16)

> **"메시 곡면과 기하 원의 곡면이 동시에 작용하고 있습니다."**

사용자 미리보기 시연 (ADR-101 Amendment 9 PR #64 closure 후 추가 audit) 으로 발견된 architectural concern. `*AsShape` draw 도구 (drawRectAsShape / drawCircleAsShape / drawLineAsShape) 가 **Hybrid layer** (mesh polygon DCEL + AnalyticCurve metadata 동시 attach) 를 생성. 두 truth 가 동시 작용하여 향후 ops (Boolean / Offset / Push-Pull / fillet) 의 truth source 모호.

ADR-089 Path B kernel-native canonical (default ON 2026-05-09) 이 활성 후 hybrid layer 의 존재가 architectural redundancy + 미래 결함 source.

## 2. 발견 (audit evidence)

ADR-101 Amendment 9 PR #64 closure 후 사용자 미리보기 시연에서 발견:

### 2.1 3 Layer 분류 (canonical)

| Layer | DCEL 형태 | AnalyticCurve attach | Render truth |
|---|---|---|---|
| **A — Pure Mesh** | N polygon edges | None | mesh DCEL |
| **B — Pure Analytic** (canonical) | 1 self-loop edge | `Some(Circle/Arc/Bezier/...)` | AnalyticCurve |
| **H — Hybrid** (현재 `*AsShape` 결과) | N polygon edges | `Some(Arc/Line/...)` per segment | **모호** |

### 2.2 현재 `*AsShape` 도구의 layer 매핑 (audit 2026-05-16)

| Case | 실제 layer | 정합 |
|---|---|---|
| RECT (drawRectAsShape) | Layer H — Line curve attached per edge (curveKind=1) | 🚨 Hybrid |
| Circle Path A (drawCircleAsShape) | Layer H — Arc curve attached per segment (curveKind=3) | 🚨 Hybrid |
| Circle Path B (drawCircleAsCurve) | **Layer B canonical** — 1 self-loop with Circle curve (curveKind=2) | ✅ |

→ **모든 `*AsShape` draw 도구가 Hybrid layer 생성**. ADR-089 Path B (canonical Layer B) 만 정합.

### 2.3 Hybrid layer 의 시각 결함 evidence

ADR-101 Amendment 9 PR #64 의 미리보기 시연 (2026-05-16):
- Path A circle (drawCircleAsShape + extrude) → cylinder side faces 의 vertical edges 가 일부 시연에서 visible (smooth-group hide / angle-coplanar hide 가 hybrid layer 의 mesh polygon 기준 vs analytic 기준 모호)
- 좌측 Circle 들 wireframe 표시 우선 + face fill 약함 (render path 가 어느 truth 따를지 결정 모호)
- ADR-092 C-β Arc fast-path 가 hybrid layer 의 Arc curve metadata 기준으로 smooth tessellation — 정상 동작이나 polygon DCEL 과 *동시* render 시 시각 충돌 가능

## 3. 현재 구현 한계 (architectural)

### 3.1 Layer H (Hybrid) 의 ambiguity

`exec_draw_circle` (scene.rs:5036-5051):
1. N straight edges 생성 (DCEL polygon)
2. 각 edge 에 `AnalyticCurve::Arc{...}` attach (analytic metadata)
3. `curve_owner_id` 부여 (ADR-088 P22.5 owner grouping)
4. face 합성 (ADR-025 P11 closed cycle)
5. `Face.surface = Some(Plane{...})` (ADR-087 K-β)

→ DCEL polygon (mesh truth) + AnalyticCurve attach (analytic truth) 동시 존재. Render / ops 의 truth 결정 모호:
- Render `export_edge_lines_with_map` (mesh.rs:5408-5447 ADR-092 C-β): Arc fast-path = analytic truth 선호
- `export_buffers_inner` (mesh.rs Plane variant polygon path, ADR-087 K-ε hotfix): polygon truth
- Boolean / Offset / Push-Pull: 각각 다른 truth 따름 (분기 inconsistent)

### 3.2 ADR-094 Path B-full default ON 후의 redundancy

ADR-094 Path B-full default ON (2026-05-09) 으로 cylinder = 3 faces / 2 edges / 2 verts canonical. 그러나 `drawCircleAsShape` 는 여전히 32 polygonal segs + 32 Arc curve attach → **사용 사례 redundancy**:
- 시각 효과 동일 (Arc fast-path render)
- Engine ops 효과 동일 (analytic curve metadata 활용)
- 메모리 효과: Path B 의 97% 절감 (LOCKED #35 ADR-094 §6.3 측정값) 손실
- Selection 효과 동일 (ADR-088 owner_id grouping ↔ Path B 1 edge native)

→ Hybrid layer 가 Path B 대비 **모든 측면에서 부족** + architectural truth source 모호성 추가.

## 4. Decision (L3 canonical lock-in)

본 ADR 은 L1~L4 trade-off audit (ADR-101 Amendment 9 PR #64 의 결함 G audit, 2026-05-16) 결과 **L3 (canonical Path B 단일화)** 결재.

### 4.1 P-1 (canonical) — `*AsShape` → `*AsCurve` 자동 변환

`drawCircleAsShape(center, normal, radius, segments)` 는 향후 `drawCircleAsCurve(center, normal, radius)` 로 자동 dispatch. 기존 API signature 보존 (backward compat), 내부 구현 변경.

- DCEL: 32 polygonal segs → 1 anchor + 1 self-loop edge (Path B canonical)
- AnalyticCurve: 32 Arc segments → 1 Circle (canonical)
- Memory: 97% 절감 (LOCKED #35 ADR-094 §6.3)
- Render: 변화 없음 (ADR-089 A-κ closed-curve face render fast-path 가 동일 smooth tessellation)
- Selection: ADR-088 P22.5 owner-ID uniformity 자연 충족 (1 edge = 1 group)

### 4.2 7 lock-in 원칙 (canonical)

- **L1 — Backward compat API**: `drawCircleAsShape(...)` signature 보존. internal dispatch 만 변경. 기존 caller (TS / WASM bridge / DrawCircleTool) UNCHANGED.
- **L2 — `segments` 파라미터 = threshold-based dispatch** (사용자 결재 2026-05-16 (α) revision, ζ-β-α audit evidence): `segments` 가 **`POLYGON_THRESHOLD` (= 12) 미만** 이면 legacy polygon path (DrawPolygon use case 보존 — hexagon N=6 / octagon N=8 / decagon N=10), **`>= 12`** 면 Path B canonical 자동 변환 (circle approximation 의도). 회귀 evidence: `crates/axia-core/src/scene.rs:12415` 의 `DrawPolygon via DrawCircleAsShape with N=6` use case 보존 + DrawCircleTool default segments=32 (>= threshold) 시 Path B 자동 활성. Threshold = 12 근거 — N=12 (dodecagon) 부터는 circle approximation 자연 인식 (hexagon=6, octagon=8, decagon=10, dodecagon=12).
- **L3 — Layer A (Pure Mesh) escape hatch**: L2 threshold (segments < 12) 가 자연 escape hatch — 명시 polygon 의도 보존. 향후 명시 `drawCirclePolygonal(N)` API 또는 inspector toggle 은 future trigger 시 별도 ADR.
- **L4 — RECT 처리**: RECT 는 본 ADR scope 외. RECT 의 4 LINE edges 는 본질적으로 polygonal (자연 Layer A 후보, 또는 Line curve attach 의 Layer H 정책 별도). RECT 의 layer 분리는 별도 ADR.
- **L5 — Snapshot 호환**: 기존 .axia 파일의 Layer H Circle 은 load 시점에 자동 변환 또는 그대로 load (legacy 보존, V2 호환). 결정 별도 sub-step.
- **L6 — ADR-088 P22.5 owner-ID uniformity 자연 충족**: Path B 의 1 edge = 1 logical curve = 1 owner. ADR-088 의 N segment grouping 의미 사라짐 (1 edge 자체가 unit).
- **L7 — 메타-원칙 #14 deepest realization**: "면은 닫힌 경계로부터 유도된다" 의 *single edge boundary* 가 canonical. Hybrid layer 의 N segment boundary 는 byproduct → canonical layer 통합.

### 4.3 LOCKED 정책 정합

- **LOCKED #1 (ADR-021 P7)**: 닫힌 엣지 = 면 합성 — Path B 의 1 self-loop edge cycle 도 cycle. 자동 face 합성 정합.
- **LOCKED #12 (ADR-025 P11)**: 닫힌 엣지 = 반드시 면 — Path B canonical 답습.
- **LOCKED #15 (ADR-037 P22.5)**: edge owner-ID uniformity — Path B 의 1 edge = 1 owner ✅ trivially 충족.
- **LOCKED #16 (ADR-038 P23)**: surface-aware normals — Plane surface attach 정합.
- **LOCKED #26 (ADR-049 Two-Layer Citizenship)**: Shape ↔ Xia 시민권 정합. `drawCircleAsShape` 결과 = form-layer Shape (Path B canonical).
- **LOCKED #34 (ADR-087 K)**: Kernel-Native Command Suite Reset — Path B canonical 의 자연 연장. K-α~K-η 답습 패턴.
- **LOCKED #35 (ADR-089 + ADR-094)**: Path B 의 canonical + production default 정합. ADR-107 = Path B 의 진정한 single source unification.
- **메타-원칙 #14 / #15**: deepest realization (메타-원칙 #14 의 boundary single edge canonical + 메타-원칙 #15 의 동일 contract 답습).

## 5. Approach — Path Z atomic multi-step

### 5.1 Step roadmap (예상)

| Step | Title | 핵심 변경 | 회귀 (예상) | Risk |
|---|---|---|---|---|
| **ζ-α** | Spec only (본 commit) | ADR-107 본문 작성 | +0 | 0 |
| **ζ-β** | `exec_draw_circle_as_shape` internal dispatch | scene.rs:5089 dispatch to `exec_draw_circle_as_curve` 또는 직접 add_face_closed_curve | +3~5 (axia-core) | 낮음 |
| **ζ-γ** | WASM bridge `drawCircleAsShape` 호환 검증 | bridge layer test — signature 변경 없음, dispatch only | +1~2 (axia-wasm) | 낮음 |
| **ζ-δ** | DrawCircleTool default 검증 | UI tool 의 default segments 무시, Path B canonical 사용 | +1 (vitest) | 낮음 |
| **ζ-ε** | Snapshot legacy 호환 검증 | V2 snapshot 의 Layer H Circle load — auto-convert 또는 보존 결정 | +2~3 (axia-core scene::tests) | 중간 (snapshot drift) |
| **ζ-ζ** | 미리보기 시연 + ADR-101 Amendment 9 결함 G evidence 재시연 | Path A circle 의 시각 동일성 검증 (시각 결함 해소) | Playwright +1 | 낮음 |
| **ζ-η** | Closure — CLAUDE.md LOCKED #44 (가칭) 등재 + 메타-원칙 #14 deepest realization 명시 | docs only | 0 | 낮음 |

**누적 회귀 예상**: **+8~12** (절대 #[ignore] 금지 100% 준수).

### 5.2 사용자 결재 시점

- ζ-α 진입 결재 (✅ 본 commit, 사용자 (δ) 결재 2026-05-16)
- ζ-β/γ/δ/ε/ζ/η 별 결재 (Path Z atomic 패턴 답습)

## 6. Out-of-scope (deferred)

- **RECT (drawRectAsShape) 의 Line curve attach 처리** — Layer H 의 Line case. RECT 의 4 polygonal edges 가 Line curve attach 되는 정책 (의미: 사용자 의도 straight line). 본 ADR scope 외, 별도 ADR (가칭 ADR-108) 후보.
- **DrawLineAsShape 의 Line curve attach** — RECT 와 동일 영역, 별도 ADR.
- **L4 (Layer 명시 ID, Edge.layer enum)** — future canonical surgery, multi-week 트랙. 본 ADR L3 으로 충분.
- **Bezier / BSpline / NURBS closed curve** — 별도 도구 (drawBezierAsCurve 등) 가 이미 Layer B canonical. `drawBezierAsShape` 패턴이 없으므로 본 ADR scope 외.
- **Snapshot V3 schema migration** — 본 ADR 의 ζ-ε 가 V2 호환 (auto-convert 또는 legacy 보존). V3 schema 변경은 별도 ADR.
- **사용자 명시 mesh polygon 의도 (Layer A escape hatch) UI** — `drawCirclePolygonal(N)` 또는 inspector toggle 등. future trigger 시 별도 ADR.

## 7. 회귀 영향 예측

- **기존 회귀 자산**: ADR-088 의 N segment grouping 회귀 (~3건) — Path B 의 1 edge 로 의미 변경. 영향 audit 필요 (ζ-β 의 첫 sub-step).
- **ADR-101 회귀 자산**: RECT × CIRCLE mixed case 등 — Path B circle 으로 변경 시 ADR-101 Amendment 9 보너스 회귀 (`adr101_amendment9_rect_x_circle_mixed_non_degenerate_splits`) 가 polygonized 32 segs 가정. 영향 audit 필요.
- **ADR-101 Amendment 9 결함 D evidence (vertex-on-corner degeneracy)**: Path B 사용 시 vertex-on-corner case 자체 사라짐 (1 self-loop) — **결함 D 자연 해소 가능성**. ζ-ζ 시연으로 검증.
- **사용자 facing 변화**: 사용자 시각 일관 (모든 Circle = canonical Path B smooth). 메모리 97% 절감 (LOCKED #35). 사용자 체감 변화 0 ~ positive.

### 7.1 ADR-101 §A9.8 결함 D — Path B 자연 해소 CONFIRMED (2026-05-16 audit evidence)

**Audit context**: ADR-101 Amendment 9 PR #64 (2026-05-16) 의 §A9.8 의 "결함 D — Mixed case vertex-on-corner degeneracy" 가 본 ADR-107 trigger evidence 로 검증됨. 사용자 결재 (ν) 후 미리보기 환경 (port 3002, Path B default ON) 에서 reproduce + Path B 적용 결과 직접 측정.

**Audit 매트릭스 (3 scenario)**:

| Test | Tool | Stats | Split Δ | 결과 |
|---|---|---|---|---|
| **D1** (결함 D reproduce) | `drawCircleAsShape` (Path A, center=(10,5), 32 segs) | 36e / 34v / **2f** | **+2** ❌ | vertex-on-corner degenerate skip — ADR-101 §A9.8 결함 D 확정 |
| **D2** (ADR-107 trigger 검증) | **`drawCircleAsCurve` (Path B)** same center=(10,5) | 31e / 56v / **3f** | **+3** ✅ | **결함 D 자연 해소** ✨ |
| **D3** (sanity control) | Path B × Path B Circle | 50e / 94v / 3f | +3 ✅ | canonical |

**자연 해소 메커니즘 (D2 분석)**:
1. `bridge.drawCircleAsCurve` → Layer B canonical (1 self-loop edge + Circle curve)
2. `intersect_faces_inner` 호출 시 `auto_intersect_coplanar` 가 `polygonize_closed_curve_face` 사전 호출
3. polygonize 시 **chord_tol-driven sampling** — N segments 가 32 고정이 아닌 dynamic
4. → CIRCLE polygon 의 cardinal vertices 가 RECT corner 와 정확 일치하지 않음 (degenerate boundary 회피)
5. → `coplanar_intersection_segments` crossings = 2 정상 검출 → 3 sub-faces

**의의**:
- ADR-107 ζ-β engine dispatch 후 사용자 시연 시 결함 D 자동 해소 — Algorithm-level fix (Weiler-Atherton / Vatti / vertex-on-edge fallback) **별도 ADR 불필요**.
- ADR-101 §A9.8 의 "결함 D 별도 ADR (가칭 ADR-101-D 또는 ADR-103+)" deferred 트랙이 ADR-107 으로 **사실상 closed**.
- canonical Path B 의 chord_tol-driven sampling 이 degenerate case 회피 — 사용자 코드 변경 없이 자연 효과.

**Cross-link**:
- ADR-101 PR #64 §A9.8 결함 D — origin
- ADR-101 §A9.6 메타-원칙 #15 — "동일 분할 = 동일 topological contract — 빠르고, 신속하고, 정확하게" 의 layer 일관성 확장
- 본 ADR §4 Decision (L3) — `*AsShape` → Path B 통합 의 자연 effect

**Known boundary (보너스 발견, canonical 보존)**:
- D2 의 결과 edges (`curveKind=-1`, all straight line) — Path B circle 이 split 과정에서 polygonize 되어 boundary curve metadata 손실
- → canonical 의도 ("Path B = 1 self-loop boundary 유지") 가 split 후 보존되지 않음
- → 별도 architectural concern (NURBS-direct coplanar intersect, ADR-101 Amendment 8 §5 Out-of-scope #3 영역). 본 ADR scope 외, future ADR.

## 8. Acceptance criteria (ζ-α 시점)

본 commit (ζ-α) 가 만족해야:
- ✅ `docs/adr/107-as-shape-path-b-unification.md` 신설 (본 파일)
- ✅ §1 Anchor (사용자 통찰) / §2 Background / §3 현재 한계 / §4 Decision (L3) / §5 Approach / §6 Out-of-scope / §7 회귀 영향 / §8 Acceptance criteria 명시
- ✅ L1~L7 lock-ins 명시
- ✅ ADR-019/027/028/049/050/087/088/089/094/101 cross-link
- ✅ 메타-원칙 #14 / #15 deepest realization 명시
- ✅ Path Z atomic ζ-α~ζ-η roadmap (각 step 별 회귀 / risk 추정)
- ✅ Code 변경 0 — spec only

## 9. Cross-link

- **ADR-019** (Line is Truth, Face is Byproduct) — 메타-원칙 #14 의 ancestor
- **ADR-027** (NURBS Kernel Initiative) — analytic curve infrastructure
- **ADR-028 Phase A** (Edge.curve = Option<AnalyticCurve>) — Hybrid layer 의 prerequisite
- **ADR-049/050** (Two-Layer Citizenship Shape/Xia) — 시민권 layer 와 본 ADR 의 geometric layer 직교
- **ADR-087** (Kernel-Native Command Suite Reset) — K-β / K-ε hotfix 답습 패턴
- **ADR-088 Phase 1** (curve_owner_id grouping) — L6 lock-in 의 자연 충족 대상
- **ADR-089** (Path B closed-curve face) — canonical Layer B
- **ADR-094** (Path B-full default ON) — 본 ADR 의 자연 연장
- **ADR-101 Amendment 9** (메타-원칙 #15 + 결함 G audit evidence) — 본 ADR 의 trigger
- **메타-원칙 #14** (canonical) — "면은 닫힌 경계로부터 유도된다" deepest realization
- **메타-원칙 #15** (canonical) — "동일 분할 = 동일 topological contract" 의 layer 일관성 확장
- **LOCKED #1 / #12 / #15 / #16 / #26 / #34 / #35** — 모두 정합 (§4.3)

---

*ADR-107 ζ-α — `*AsShape` → Path B Canonical Unification 의 architectural spec.
ADR-101 Amendment 9 PR #64 closure 후 사용자 미리보기 시연 (2026-05-16) 으로
발견된 결함 G (메시 곡면 + 기하 원의 곡면 동시 작용) 의 canonical L3 fix.
Path Z atomic ζ-β~ζ-η 별도 PR 진행.*
