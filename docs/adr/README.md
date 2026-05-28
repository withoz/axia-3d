# Architecture Decision Records (ADR)

이 디렉토리는 AXiA 3D 엔진의 주요 설계 결정을 기록합니다.

## 목적
- 왜 그 결정을 내렸는지 **맥락과 근거**를 남겨, 미래의 재검토 시 배경을 잃지 않기 위함
- 설계 원칙에 예외가 생기는 경우, 그 이유를 추적 가능하게 함
- 신규 기여자가 "왜 이렇게 되어 있나?"를 빠르게 파악

## 포맷

각 ADR은 다음 구조를 따릅니다:

- **Status** — Proposed / Draft / Accepted / Deferred / Superseded by ADR-XXX
  (canonical 5-state, [STATUS-POLICY.md](./STATUS-POLICY.md) 참조)
- **Date** — 결정 시점
- **Context (맥락)** — 왜 이 결정이 필요했는가
- **Decision (결정)** — 무엇을 선택했는가
- **Rationale (근거)** — 왜 그것을 선택했는가
- **Consequences (결과)** — 긍정/부정적 파생 효과
- **Alternatives (대안)** — 고려했지만 선택하지 않은 것들
- **When to Revisit (재검토 트리거)** — 재검토가 필요해지는 조건
- **Related (관련 기록)** — 다른 ADR / 커밋 / 이슈

자세한 lifecycle policy + Status notation canonical: [STATUS-POLICY.md](./STATUS-POLICY.md).

## 카테고리별 색인 (143+ ADRs, 2026-05-22 갱신 — ADR-141 Master Roadmap + ADR-162/163 hotfix + 15 누락 catalog 추가 + 13 broken link 정정 + STATUS-POLICY 신설)

ADR 은 단조 증가 번호이지만 주제별로 8개 트랙으로 자연 그룹화됩니다.

### 1. Foundation (#001~#009) — 시민권·기하 안정성

| # | 제목 | 상태 |
|---|------|------|
| [001](./001-geometry-semantic-layer-separation.md) | Geometry/Semantic 레이어 분리 | Accepted |
| [002](./002-xia-state-from-face-count.md) | XIA 상태는 면 개수로 계산 | Accepted |
| [003](./003-geometric-validity-principle.md) | Geometric Validity (Degenerate 사전 차단) | Accepted |
| [004](./004-xia-level-stable-id.md) | 안정 ID는 XIA-level만 (Face GUID 금지) | Accepted |
| [005](./005-coplanar-merge-purely-geometric.md) | Coplanar Merge는 순수 기하 연산 | Accepted |
| [006](./006-face-merge-future-work.md) | Face Merge 미지원 케이스 명시 | Accepted |
| [007](./007-face-orientation-policy.md) | Face Orientation Policy (Rev 2, 7원칙) | Accepted |
| [008](./008-face-operation-axioms.md) | Face Operation Axioms (9개) | Accepted |
| [009](./009-orphan-face-recovery.md) | Orphan Face Recovery (Smart Auto) | Accepted |

### 2. UX & Performance Budgets (#010~#014)

| # | 제목 | 상태 |
|---|------|------|
| [010](./010-inference-resolution.md) | Inference Resolution Table | Proposed |
| [011](./011-tool-inertia.md) | Tool Inertia & Predictive Switch | Proposed |
| [012](./012-latency-budget.md) | Latency Budget ⭐ (메타-원칙 #11) | Accepted |
| [013](./013-memory-budget.md) | Memory Budget & Bounded Collections ⭐ (#12, #13) | Accepted |
| [014](./014-meta-principles-extension.md) | 메타-원칙 확장 (#11~#16) | Accepted (Amendment 1 — 2026-05-21) |

### 3. Topology — Face/Edge 합성·분할 (#015~#026)

| # | 제목 | 상태 |
|---|------|------|
| [015](./015-stacked-inner-rect-topology.md) | Stacked Inner RECT — Manifold-First B1 | Superseded by 016/021 |
| [016](./016-conditional-auto-hole-promote.md) | Conditional Auto-Hole Promote | Accepted |
| [018](./018-uniform-surface-render.md) | Uniform Surface Render Policy | Accepted |
| [019](./019-line-is-truth-face-is-byproduct.md) | Line is Truth, Face is Byproduct | Accepted |
| [021](./021-closed-edge-loop-divides-face.md) | Closed Edge Loop Divides Face (P7) | Accepted |
| [022](./022-vertex-shared-connectivity-epsilon-doubling.md) | Vertex-Shared Pinch Auto-Promote (P9) | Accepted |
| [023](./023-bridge-topology-endpoint-on-hole-boundary.md) | Bridge Topology, Endpoint-on-Hole-Boundary (P8) | Accepted |
| [024](./024-corner-patch-3way-fillet.md) | 3-Way Corner Chamfer (P10 MVP) | Accepted |
| [025](./025-closed-edge-cycle-must-face.md) | Closed Edge Cycle MUST Synthesize Face (P11) | Accepted |
| [026](./026-cardinal-plane-ssot.md) | Bridge SSOT — Cardinal Plane Snap (P12) | Accepted |

### 4. NURBS Kernel (#027~#034, #052~#062)

자체 NURBS Kernel — Phase A~M 점진 구축.

| # | 제목 | 상태 |
|---|------|------|
| [027](./027-nurbs-kernel-initiative.md) | NURBS Kernel Initiative (kickoff) | Accepted |
| [028](./028-analytic-edge-curve-foundation.md) | Phase A — Analytic Edge Curve Foundation | Accepted |
| [029](./029-free-form-curves.md) | Phase B — Bezier / B-spline 자유곡선 | Accepted |
| [030](./030-nurbs-curves-cci.md) | Phase C — NURBS Curves + CCI | Accepted |
| [031](./031-analytic-surface-primitives.md) | Phase D — Analytic Surface Primitives | Accepted |
| [032](./032-promotion-paths.md) | Phase D' — Primitive Surface Promotion | Accepted |
| [033](./033-nurbs-surfaces.md) | Phase E — NURBS Surfaces | Accepted |
| [034](./034-surface-surface-intersection.md) | Phase F — Surface-Surface Intersection | Accepted |
| [052](./052-nurbs-kernel-completion-roadmap.md) | NURBS Kernel Completion Roadmap | Accepted |
| [053](./053-phase-h-transform-continuity.md) | Phase H — Transform Continuity | Accepted |
| [054](./054-phase-i-knot-insertion.md) | Phase I — Knot Insertion | Accepted |
| [055](./055-phase-j-robust-boolean.md) | Phase J — Robust Boolean | Accepted |
| [056](./056-phase-k-fitting-construction.md) | Phase K — Fitting / Construction | Accepted |
| [057](./057-phase-l-advanced-surfaces.md) | Phase L — Advanced Surfaces | Accepted |
| [058](./058-phase-m-robust-predicates.md) | Phase M — Robust Predicates | Accepted |
| [059](./059-phase-n-curve-surface-mandatory.md) | Phase N — Curve/Surface Mandatory | Accepted |
| [060](./060-phase-o-tools-nurbs-aware.md) | Phase O — Tools NURBS-aware | Accepted |
| [061](./061-phase-p-narrow-tessellation-cache.md) | Phase P — Narrow Tessellation Cache | Accepted |
| [062](./062-phase-l2-path-z-validated-surface-attach.md) | Phase L2 — Validated Surface Attach | Accepted |

### 5. STEP / IGES Interop (#035~#036, #081~#086)

| # | 제목 | 상태 |
|---|------|------|
| [035](./035-step-iges-strategy.md) | STEP/IGES Hybrid Strategy (P20) | Accepted |
| [036](./036-step-iges-curve-surface-promotion.md) | STEP/IGES Curve & Surface Promotion (P21) | Accepted |
| [081](./081-step-iges-nurbs-class-import.md) | NURBS-class Import Activation | Accepted |
| [082](./082-occt-real-runtime-corpus.md) | OCCT.js Real Runtime Activation | Accepted |
| [083](./083-brepmesh-tessellation-mvp.md) | BRepMesh Tessellation MVP (visual unlock) | Accepted |
| [084](./084-brep-edge-wireframe-mvp.md) | BRep Edge Wireframe MVP | Accepted |
| [085](./085-toast-progress-ux-mvp.md) | Toast Progress UX MVP | Accepted |
| [086](./086-wasmbridge-owner-id-mapping.md) | WasmBridge Owner-ID Mapping (Approach A) | Accepted |

### 6. Pick / Hover / Selection (#037~#040, #047)

| # | 제목 | 상태 |
|---|------|------|
| [037](./037-pick-promote-principle.md) | Pick → Promote (P22) | Accepted |
| [038](./038-surface-aware-normals.md) | Surface-Aware Normals (P23) | Accepted |
| [039](./039-hover-preselect-owner-id-unification.md) | Hover Owner-ID Unification (P24) | Accepted |
| [040](./040-analytic-curve-distance-hover.md) | AnalyticCurve Distance Hover (P25) | Accepted |
| [047](./047-snap-chain-self-touch-prevention.md) | Snap Chain Self-Touch Prevention (P32) | Accepted |

### 7. MCP / Distribution (#041~#044)

| # | 제목 | 상태 |
|---|------|------|
| [041](./041-mcp-surface.md) | AxiA MCP Capability Surface (P26) | Accepted |
| [042](./042-mcp-capability-policy.md) | MCP Capability ALLOW/DENY (P27) | Accepted |
| [043](./043-mcp-init-scaffold.md) | `npm create axia-mcp` Scaffold (P28) | Accepted |
| [044](./044-npm-release-process.md) | npm Release Process (P29) | Accepted |

### 8. UI / UX Strategy (#045~#046, #063, #068~#070)

| # | 제목 | 상태 |
|---|------|------|
| [045](./045-ui-surface-consolidation.md) | UI Surface Consolidation + ActionCatalog SSOT (P30) | Accepted |
| [046](./046-ui-ux-long-term-strategy.md) | UI/UX Long-term Strategy + Product Identity (P31) | Accepted |
| [063](./063-adr-046-phase-1-path-z-capability-explorer-pilot.md) | Phase 1 — Capability Explorer Pilot | Accepted |
| [068](./068-adr-046-phase-1-path-y-invariant-verifier-pilot.md) | Phase 1 — Invariant Verifier Pilot | Accepted |
| [069](./069-adr-046-phase-1-path-y-audit-log-viewer-pilot.md) | Phase 1 — Audit Log Viewer Pilot | Accepted |
| [070](./070-adr-046-phase-1-path-y-analytic-hover-overlay-pilot.md) | Phase 1 — Analytic Hover Overlay Pilot | Accepted |

### 9. Three-Layer Citizenship (#048~#051, #091, #095~#100)

**역사적 명명**: ADR-049 의 Two-Layer 모델이 ADR-095 (Reference 시민권)
로 **Three-Layer** 자연 진화. Form / Property / Reference 3 시민권은
mutually exclusive geometry ownership. LOCKED #26 메타-원칙 #2 정착.

| # | 제목 | 상태 |
|---|------|------|
| [048](./048-citizenship-model-conceptual-gap.md) | Citizenship Model Conceptual Gap | Superseded by 049 |
| [049](./049-two-layer-citizenship-model.md) | Two-Layer Citizenship Model (canonical, Amendments 1~4) | Accepted |
| [050](./050-shape-xia-type-split.md) | Shape/Xia Type Split + Promotion (Phase 1) | Accepted |
| [051](./051-p7-canonical-restatement.md) | P7 Canonical Restatement + verify_p7_manifold | Accepted |
| [091](./091-material-removal-shape-demotion.md) | Material Removal → Shape Demotion (Phase 2) | Accepted |
| [095](./095-reference-citizenship-phase-3.md) | Reference Citizenship (Phase 3) | Accepted |
| [096](./096-step-iges-reference-auto-classification.md) | STEP/IGES Reference Auto-Classification | Accepted |
| [097](./097-topology-damage-auto-recovery.md) | Topology Damage Auto-Recovery (Phase 4) | Accepted |
| [098](./098-asset-library-3-tier-material-scope.md) | Asset Library 3-Tier Material Scope (Phase 5-A) | Accepted |
| [099](./099-layered-material-pbr-channels.md) | Layered Material 4-PBR Channels (Phase 5-B) | Accepted |
| [100](./100-material-removal-recovery.md) | Material Removal Recovery (Phase 5-C) | Accepted |

🎉 **LOCKED #26 Two-Layer Citizenship Model 5-Phase 완전 closure** (2026-05-10).
ADR-049 Amendments 1~4 참조.

### 10. Boolean / Press-Pull / Visual (#064, #066~#067, #074~#078)

| # | 제목 | 상태 |
|---|------|------|
| [064](./064-nurbs-boolean-to-dcel.md) | NURBS Boolean → DCEL (Path Z) | Accepted |
| [066](./066-multi-face-nurbs-boolean-dispatch.md) | Multi-face NURBS Boolean Dispatch (Path Y) | Accepted |
| [067](./067-press-pull-engine.md) | Press-Pull Engine | Accepted |
| [074](./074-boolean-group-selection-ux.md) | Boolean Group Selection UX (E.3) | Accepted |
| [075](./075-nurbs-boolean-browser-e2e.md) | NURBS Boolean Browser E2E (Playwright) | Accepted |
| [076](./076-legacy-boolean-path-sunset.md) | Legacy Boolean Path Sunset (E.5 Cleanup) | Accepted |
| [077](./077-visual-regression-infrastructure.md) | Visual Regression Infrastructure | Accepted |
| [078](./078-boolean-group-persistence.md) | Boolean Group Persistence (P-1~P-4) | Accepted |

### 11. Solid / Offset / Kernel-Native Reset (#079~#080, #087~#110)

| # | 제목 | 상태 |
|---|------|------|
| [079](./079-solid-extrusion-surface-native.md) | Create Solid — Surface-Native Extrusion | Accepted |
| [080](./080-offset-dimension-aware-semantics.md) | Offset Dimension-Aware Semantics | Accepted |
| [087](./087-kernel-native-command-suite-reset.md) | Kernel-Native Command Suite Reset | Accepted |
| [088](./088-curve-owner-id-grouping.md) | curve_owner_id Grouping (Phase 1) | Accepted |
| [089](./089-true-kernel-native-closed-edges.md) | True Kernel-Native Closed Edges (Phase 2) | Accepted |
| [090](./090-true-kernel-native-cylinder-path-b.md) | True Kernel-Native Cylinder (Path B, deferred) | Deferred (ADR-094 refined plan 후속) |
| [091](./091-material-removal-shape-demotion.md) | Material Removal → Shape 가역 강등 (Phase 2) | Accepted |
| [092](./092-pushpull-top-boundary-closed-curve-preservation.md) | Push-Pull Top Boundary Closed-Curve Preservation (Partial Path B) | Accepted |
| [093](./093-cylinder-side-face-owner-id-grouping.md) | Cylinder Side Face Owner-ID Grouping (B-MVP — Path B Light) | Accepted |
| [094](./094-path-b-full-refined-plan.md) | Path B-full Refined Plan (Multi-week Atomic Architectural Track) | Accepted |
| [095](./095-reference-citizenship-phase-3.md) | Reference Citizenship (Three-Layer Citizenship Phase 3) | Accepted |
| [096](./096-step-iges-reference-auto-classification.md) | STEP/IGES Import — Reference Auto-Classification | Accepted |
| [097](./097-topology-damage-auto-recovery.md) | Topology Damage Auto-Recovery (Three-Layer Citizenship Phase 4) | Accepted |
| [098](./098-asset-library-3-tier-material-scope.md) | Asset Library 3-Tier Material Scope (Phase 5-A) | Accepted |
| [099](./099-layered-material-pbr-channels.md) | Layered Material 4-PBR Channels (Phase 5-B) | Accepted |
| [100](./100-material-removal-recovery.md) | Material Removal Recovery (Phase 5-C) | Accepted |
| [107](./107-as-shape-path-b-unification.md) | `*AsShape` → Path B Canonical Unification (Layer Separation) | Draft |
| [108](./108-rect-line-layer-h-policy.md) | RECT/Line Layer H Policy (Layer Separation Sibling) | Draft |
| [109](./109-arc-extrude-cylinder-promotion.md) | Arc Extrude Cylinder Promotion | Draft |
| [110](./110-boolean-path-b-compat.md) | Boolean Path B Compatibility (Pre-polygonize for Boolean) | Draft |

### 12. Coplanar Auto-Intersect + Z-up + Boundary Tool (#101~#140)

| # | 제목 | 상태 |
|---|------|------|
| [101](./101-coplanar-partial-overlap-p7-completion.md) | Coplanar Partial Overlap Auto-Intersect (P7 Completion) | Accepted (Superseded by ADR-139 trigger) |
| [102](./102-push-pull-detach-on-arrangement.md) | Push/Pull Detach-on-Arrangement (Manifold Reconciliation) | Accepted |
| [103](./103-z-up-coordinate-migration.md) | Z-up Coordinate Migration (Engine + Viewport) | Accepted |
| [104](./104-path-b-expansion-spec.md) | Path B Expansion (Sphere/Cone/Torus) | Proposed |
| [106](./106-shadow-system-removal-and-redesign.md) | Shadow System Removal + Future Redesign | Accepted |
| [111](./111-bvh-defer-to-idle.md) | BVH Defer to Next Frame | Accepted |
| [112](./112-edges-empty-explicit-no-fallback.md) | Edges Empty 명시 처리 | Accepted |
| [113](./113-sphere-path-b-production-wiring.md) | Sphere Path B Production Wiring | Accepted |
| [114](./114-cone-path-b-production-wiring.md) | Cone Path B Production Wiring | Accepted |
| [115](./115-torus-path-b-production-wiring.md) | Torus Path B Production Wiring | Accepted |
| [116](./116-path-b-family-user-facing-closure.md) | Path B Family User-Facing Closure | Accepted |
| [117](./117-cylinder-symmetry-torustool-ui.md) | Cylinder Direct Dispatch + TorusTool UI | Accepted |
| [118](./118-step-timing-reduction.md) | STEP/IGES Engine Pre-warm (α spec) | Proposed |
| [119](./119-step-iges-prewarm-implementation.md) | STEP/IGES Pre-warm (β implementation) | Accepted |
| [120](./120-nurbs-aware-coplanar-intersect.md) | NURBS-Aware Coplanar Intersect (α spec) | Proposed |
| [121](./121-step-prewarm-lib-fix-and-path-b-area.md) | STEP Pre-warm lib fix + Path B area | Accepted |
| [122](./122-gpu-instancing-for-repetitive-geometry.md) | GPU Instancing for Repetitive Geometry (α spec) | Proposed |
| [123](./123-axia-native-optimization.md) | AxiA-Native Optimization Audit (α spec) | Proposed |
| [124](./124-wasm-simd-activation.md) | WASM SIMD Activation | Accepted |
| [125](./125-selection-rendering-audit-closure.md) | Selection Rendering Audit Closure (α-1 Pivot) | Accepted |
| [126](./126-step-iges-merged-buffergeometry.md) | STEP/IGES Merged BufferGeometry | Accepted |
| [127](./127-helper-lines-audit-closure.md) | Helper Lines Audit Closure (α-4 Pivot) | Accepted |
| [128](./128-vertex-on-edge-fallback.md) | Vertex-on-edge Fallback | Accepted |
| [129](./129-next-priority-audit.md) | Next Priority Audit (LOCKED #43 Successor) | Proposed |
| [130](./130-pillar-1-discoverability-audit.md) | Pillar 1 (Discoverability) Audit | Proposed |
| [131](./131-cmdk-already-exists-pivot.md) | CommandPalette Already Exists Pivot | Accepted |
| [132](./132-dual-catalog-unification-audit.md) | Dual Catalog Unification Audit | Proposed |
| [133](./133-adapter-layer-implementation.md) | Adapter Layer (Path E β) | Accepted |
| [134](./134-rendering-performance-audit.md) | Rendering Performance Audit (α spec) | Proposed |
| [135](./135-lod-chord-tol-implementation.md) | Distance-based LOD chord_tol | Accepted |
| [136](./136-face-split-downstream-sync-coherence.md) | Face Split Downstream Sync Coherence (α spec) | Draft |
| [137](./137-guidance-only-snap.md) | Guidance-only Snap (α spec) | Draft |
| [138](./138-multi-loop-face-policy.md) | Multi-loop Face Policy (Path A vs B) | Superseded by ADR-139 |
| [139](./139-boundary-tool-auto-cycle-deprecation.md) | Boundary Tool + Auto-cycle Deprecation | Accepted (β implementation 진행 중) |
| [140](./140-surface-aware-get-draw-plane.md) | Surface-aware getDrawPlane (곡면 face 위 도구 정확도) | Accepted |

### 14. Sprint 외 hotfix (#162+, 별도 트랙)

본 카테고리는 ADR-141 §3 (Sprint 1~6+4.5) reserve 외 별도 트랙 — 사용자
facing critical hotfix (defer 부적합). 회귀 +Sprint 외 누적.

| # | 제목 | 상태 | Track |
|---|------|------|---|
| [162](./162-dwg-dxf-menu-wiring-hotfix.md) | DWG/DXF Menu Wiring Hotfix (Path A → Path B routing) | **α + β-1 closed** | Track 2 |
| [163](./163-worktree-closure-audit.md) | Worktree Closure Audit (Sprint 0 γ 자연 후속) | α (β actual closure 사용자 결재 후) | Track 3 |
| [164](./164-auto-plane-detection-sticky-last-drawn.md) | Auto Plane Detection (Sticky Last Drawn Plane) — 사용자 작업지시 | Accepted | Track 4 |

### 13. Master Roadmap (#141~#161 reserve, 2026-05-22)

본 카테고리는 외부 에이전트 마스터 완성 계획 (5/5 결재 lock-in, 2026-05-22)
의 main 통합 트랙. 21~29주 / 5~7개월 production-grade RC + 회귀 +330.
ADR-141 (Master Roadmap) + ADR-142~161 (Sprint 1~6+4.5 worker ADRs).

| # | 제목 | 상태 | Sprint |
|---|------|------|---|
| [141](./141-master-roadmap-sprint0-foundation-sync.md) | **Master Roadmap (Sprint 0 closure)** | **Accepted** | **S0** |
| [142](./142-closed-curve-face-split-5-functions.md) | Closed-curve face split 5 함수 hotfix | **α + Amendment 1 + β-1 closed** | S1 |
| 143 (reserve) | Surface-aware getDrawPlane (ADR-140 β 자연 후속) | Reserved | S1 |
| [144](./144-step-4-65-silent-dissolve-regression-sweep.md) | Step 4.65 silent dissolve 회귀 자산 sweep | Accepted | S1 |
| [145](./145-circle-annulus-explicit-activation.md) | Circle annulus 명시 활성 (옵션 B, 결재 1) | Accepted | S1 |
| [146](./146-step-1-inferencing-completion.md) | Step 1 Inferencing 보강 (node, latency, Recency) | Accepted | S2 |
| [147](./147-step-2-scenario-b1-spatial-hash-precision.md) | Step 2 Scenario B1 (spatial-hash 1μm → 0.1μm, 10× precision) | Accepted | S2 |
| [148](./148-point-localized-boundary-tool.md) | B-γ' Point-Localized BoundaryTool (ADR-139 자연 후속) | Accepted | S2 |
| [149](./149-t-junction-sweep-explicit-tool.md) | T-junction Sweep 명시 도구 | Accepted | S3 |
| [150](./150-auto-coplanar-face-merge-sweep.md) | 자동 Coplanar Face Merge Sweep (opt-in) | Accepted | S3 |
| [151](./151-connected-stacked-inner-component-merge-resolver.md) | Connected Stacked-inner Component-Merge Resolver | Accepted | S3 |
| [152](./152-p7-m4-m5-euler-genus.md) | P7-M4/M5 + Euler/Genus 모듈 | Proposed | S4 |
| 153 (reserve) | Best-fit Plane SVD + Pullback | Reserved | S4 |
| 154 (reserve) | Mesh::heal() 통합 entry | Reserved | S4 |
| 155 (reserve) | **Curve-to-Curve Face Split (10 sub-step, 4~6주)** | Reserved | S4.5 |
| 156 (reserve) | 곡면 위 Sketch + Sphere/Cylinder Mode | Reserved | S5 |
| 157 (reserve) | OCCT BRepFeat_SplitShape 활용 | Reserved | S5 |
| 158 (reserve) | **DrawEllipseTool — NURBS-only (옵션 A, 결재 2)** | Reserved | S5 |
| 159 (reserve) | **Surface-aware Push/Pull** | Reserved | S5 |
| 160 (reserve) | 영구 Annotation Entity | Reserved | S6 |
| 161 (reserve) | Face 위 Hole Pattern Array | Reserved | S6 |

## 충돌 시 우선순위 매트릭스 (P7/P8/P9/P11, 보고서 P6)

ADR-021 P7 / ADR-022 P9 / ADR-023 P8 / ADR-025 P11 이 **동시 적용 가능한
사례** 의 우선순위 정의 (보고서 §2 P6 Medium 권장). 운영 시 ad-hoc 결재
회피.

| 순위 | 원칙 | ADR | 의미 |
|---|---|---|---|
| 1 | **P11** Closed cycle MUST face | ADR-025 | 가장 강한 강제력 — 닫힌 cycle 은 반드시 면 (메타-원칙 #14) |
| 2 | **P7** Closed loop divides face | ADR-021 | face partition 정합 — containment auto-split (Superseded by ADR-139 trigger) |
| 3 | **P9** Vertex-shared pinch | ADR-022 | manifold preservation — 1-vertex pinch auto-promote |
| 4 | **P8** Endpoint-on-hole bridge | ADR-023 | endpoint disambiguation — hole boundary bridge |

**ADR-139 후 정합**: P11 / P7 의 *자동 trigger* 는 Boundary tool 명시
only 로 supersede. *결과 invariant* (메타-원칙 #14) 는 모두 보존.
**우선순위 자체는 변경 없음** — 동시 trigger 가능한 케이스의 처리 순서.

## 메타-원칙 (#1~#16)

| # | 원칙 | 축 | 출처 |
|---|------|-----|------|
| 1 | 기존 명령은 모두 그대로 | 호환 | 세션 |
| 2 | 외부 참조는 형태/모양만 | 호환 | 세션 |
| 3 | 상태바는 보호 | UX | 세션 |
| 4 | 단일 진실 원천 (SSOT) | 일관성 | ADR-001 |
| 5 | 사용자 편의 최우선 | UX | ADR-009 |
| 6 | Preventive over Curative | 안정성 | ADR-003 |
| 7 | Topology > Cache | 일관성 | ADR-007 |
| 8 | 즉각 반응 > 완전성 | UX/성능 | 세션 |
| 9 | 회귀 없음 | 품질 | 세션 |
| 10 | ADR 불변 | 거버넌스 | README |
| 11 | Latency Budget First | 성능 | ADR-014 |
| 12 | Memory Budget Per **Subsystem** (명명 정정 2026-05-21) | 메모리 | ADR-014 + ADR-013 §1 |
| 13 | One Source, Two Views | 메모리/일관성 | ADR-014 |
| **14** | **면은 닫힌 경계로부터 유도된다** (H₁=0 한정, Jordan-Schoenflies 정리 기반, 학술적 정밀화 2026-05-21) — **WHAT layer** | **기하 본질** | **세션 2026-05-08, ADR-014 Amendment 1** |
| **15** | **동일 분할 = 동일 topological contract** (HARD flag 부여, 2026-05-16) | **분할 정합** | **ADR-101 Amendment 9** |
| **16** | **자동화 antipattern** (휴리스틱 자동화 = cascading 부작용 source, 2026-05-18) — **WHEN layer** | **UX/거버넌스** | **ADR-139, CLAUDE.md LOCKED #64** |

### 메타-원칙 #14 (canonical)

> "면은 닫힌 경계로부터 유도된다." — 사용자 통찰, 2026-05-08

ADR-019 ("Line is Truth, Face is Byproduct") 의 가장 본질 형태. Edge 가
fundamental 이고 Face 는 closed edge cycle 의 derivation. 모든 후속
결정 (ADR-087/088/089/090) 의 anchor. CLAUDE.md 의 메타-원칙 #14 절
참조.

## LOCKED 정책 (불변 정책 — CLAUDE.md 참조)

| # | ADR | 영역 |
|---|-----|------|
| 1 | ADR-021 | Closed Edge Loop Divides Face (P7) |
| 2 | ADR-007 | Winding 일괄 강제 |
| 3 | M1 | Sub-face XIA Inheritance |
| 4 | — | Connector 정의 |
| 5 | — | 1.5μm spatial-hash dedup tolerance |
| 6 | ADR-018 | Uniform Surface Render |
| 7 | ADR-026 | Bridge SSOT — Cardinal Plane Snap (P12) |
| 8 | ADR-019 | Line is Truth |
| 9 | ADR-022 | Vertex-Shared Pinch Auto-Promote (P9) |
| 10 | ADR-023 | Bridge Topology (P8) |
| 11 | ADR-024 | 3-Way Corner Chamfer (P10) |
| 12 | ADR-025 | Closed Edge Cycle MUST Face (P11) |
| 13 | ADR-035 | STEP/IGES Hybrid Strategy (P20) |
| 14 | ADR-036 | Curve/Surface Promotion (P21) |
| 15 | ADR-037 | Pick → Promote (P22) |
| 16 | ADR-038 | Surface-Aware Normals (P23) |
| 17 | ADR-039 | Hover Owner-ID (P24) |
| 18 | ADR-040 | AnalyticCurve Distance Hover (P25) |
| 19 | ADR-041 | MCP Capability Surface (P26) |
| 20 | ADR-042 | MCP ALLOW/DENY (P27) |
| 21 | ADR-043 | MCP Scaffold (P28) |
| 22 | ADR-044 | npm Release (P29) |
| 23 | ADR-045 | UI Surface SSOT (P30) |
| 24 | ADR-046 | UI/UX Strategy (P31) |
| 25 | ADR-047 | Snap Self-Touch (P32) |
| 26 | ADR-049/050/051 | Two-Layer Citizenship Phase 1 |
| 27 | ADR-080 | Offset Dimension-Aware |
| 28 | ADR-081 | STEP/IGES NURBS-class Import |
| 29 | ADR-082 | OCCT Real Runtime |
| 30 | ADR-083 | BRepMesh Tessellation MVP |
| 31 | ADR-084 | BRep Edge Wireframe |
| 32 | ADR-085 | Toast Progress UX |
| 33 | ADR-086 | WasmBridge Owner-ID Mapping |
| 34 | ADR-087 | Kernel-Native Command Suite Reset |
| 35 | ADR-089 | True Kernel-Native Closed Edges |
| 36 | ADR-097 | Topology Damage Auto-Recovery (Phase 4) |
| 37 | ADR-098 | Asset Library 3-Tier Material Scope (Phase 5-A) |
| 38 | ADR-100 | Material Removal Recovery (Phase 5-C) |
| 39 | ADR-099 | Layered Material 4-PBR Channels (Phase 5-B) |
| 40 | — | Render chord_tol + Hover Group Unification (LOCKED #40) |
| 41 | ADR-101 | Coplanar Partial Overlap Auto-Intersect (Superseded by ADR-139) |
| 42 | ADR-102 | Push/Pull Detach-on-Arrangement |
| 43 | ADR-103 | Z-up Coordinate Migration |
| 44 | — | Complete Meaning per Merge |
| 45 | ADR-111 | BVH Defer to Next Frame |
| 46 | ADR-112 | Edges Empty 명시 처리 |
| 47 | ADR-113 | Sphere Path B Production Wiring |
| 48 | ADR-114 | Cone Path B Production Wiring |
| 49 | ADR-115 | Torus Path B Production Wiring |
| 50 | ADR-116 | Path B Family User-Facing Closure |
| 51 | ADR-117 | Cylinder Direct Dispatch + TorusTool UI |
| 52 | ADR-118 + ADR-119 | STEP/IGES Engine Pre-warm |
| 53 | ADR-121 | STEP pre-warm libs + Path B area |
| 54 | ADR-123 + ADR-124 | AxiA-native optimization + WASM SIMD |
| 55 | ADR-125 + ADR-122 Amendment 1 | Selection Rendering Audit Pivot |
| 56 | ADR-126 + ADR-122 Amendment 2 | STEP/IGES Merged BufferGeometry |
| 57 | ADR-127 + ADR-122 Amendment 3 | Helper Lines Audit Pivot |
| 58 | ADR-128 + ADR-120 Amendment 1 | Vertex-on-edge Fallback |
| 59 | ADR-131 + ADR-130 Amendment 1 | CommandPalette Already Exists Pivot |
| 60 | ADR-133 | Adapter Layer (Path E β) |
| 61 | ADR-045 D1 Amendment 1 + ADR-129 Amendment 1 | Identity vs Dispatch |
| 62 | ADR-135 | Distance-based LOD chord_tol |
| 63 | — | PR #101 z=0 Invariant Closure |
| 64 | ADR-139 | Boundary-only Face Synthesis (Auto-cycle Deprecation) |
| 65 | ADR-141 | Master Roadmap (Sprint 0 Foundation Sync, 21~29주 +330 회귀) |
| 66 | STATUS-POLICY.md | ADR Status & Lifecycle Policy Enforcement (5-state + 3-tier + CI 자동 검증) |

자세한 LOCKED 정책 본문은 `CLAUDE.md` §1~§66 참조.

## 변경 규칙

- 기존 ADR 을 **수정하지 않음**. 설계가 바뀌면 새 ADR 을 작성하고 이전 것을 `Superseded` 로 표시.
- 단, ADR §D Acceptance Log / §E Lessons 등 *closure 후* 추가 commit log 는 additive 로 허용 (Path Z atomic 패턴).
- ADR 번호는 단조 증가. 결번 가능 (017, 020, 065, 071~073 등 — 통합/취소된 결정).
- 모든 ADR 은 `docs/adr/` 한 곳에서만 관리.

## Path Z Atomic 패턴 (#064 이후 표준)

복잡한 architectural 변경은 sub-step (α spec → β core → γ integration → ... → ω closure) 의 commit-by-commit atomic 분할로 진행. 각 sub-step:
1. 사용자 사전 결재
2. 회귀 추가 (절대 #[ignore] 금지)
3. CI 통과
4. ADR §D Acceptance Log 갱신
5. commit

대표 사례: ADR-064 (Path Z 11 sub-step), ADR-074 (5-layer atomic), ADR-078 (6-layer persistence), ADR-089 (A-α ~ A-Δ 24+ sub-step).

## Defer 항목 (명시적으로 보류)

- Worker thread offload — ADR-012 강등 정책에 따라 *필요 시* 활성
- GPU picking — BVH 로 충분, 추후 검토
- IndexedDB telemetry 영속화 — 메모리 ring buffer 로 충분
- Parametric History Phase 3 (downstream 자동 재계산) — 별도 ADR 예정
- Boundary Extraction (Solid → Face)
- Electron/Tauri 데스크톱 앱
- ADR-090 Path B (true kernel-native cylinder) — 트리거 정량 매트릭스 (chord error / memory footprint) 충족 시 진입
- Periodic NURBS surface (closed in u/v) — Phase L 후속, 별도 ADR
- Sweep / Offset / Loft / Revolve advanced — Phase K/L 트랙
- AP238 / IFC import — ADR-035 P20.B non-goal
