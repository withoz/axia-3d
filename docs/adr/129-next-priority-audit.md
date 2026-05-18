# ADR-129 — Next Priority Audit (LOCKED #43 Successor Track, α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — priority track lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "추천 승인합니다" Option A 채택) |
| Anchor | LOCKED #43 priority track 100% closure 후 자연 successor — 4 priorities 모두 completed (Z-up / Path B / STEP timing / NURBS-aware coplanar) |
| Parent | LOCKED #43 (직전 priority track, 100% closure), ADR-046 P31 (UI/UX long-term strategy — Pillar 1-5 anchor) |
| Cross-cut | ADR-045 (UI surface consolidation + ActionCatalog SSOT), ADR-077 (visual regression infrastructure), ADR-095 (Reference citizen Phase 3-ζ), ADR-104 family (Path B 100% closure), LOCKED #44 (Complete Meaning per Merge) |

---

## 0. Summary

> LOCKED #43 priority track 의 4 priorities (Z-up / Path B / STEP timing / NURBS-aware coplanar) 모두 100% closure 도달 (2026-05-17). 본 ADR 은 *successor priority track* 의 architectural direction audit + lettered options 매트릭스. 10 후보 영역 audit 후 4 high-priority 추천. ADR-118 / ADR-120 / ADR-122 / ADR-123 답습 패턴 (α spec only PR, β implementation 사용자 결재 후 별도 atomic).

---

## 1. Canonical Anchor

LOCKED #43 priority track 100% closure 도달 (2026-05-17, ADR-128 β implementation merge):

| Priority | Status | Closure ADR |
|---|---|---|
| #1 Z-up coordinate migration | ✅ closure | ADR-103 (pre-session) |
| #2 Path B (Sphere/Cone/Torus 확장) | ✅ closure | ADR-094/113/114/115/116/117 (pre-session) |
| #3 STEP timing 단축 | ✅ closure | ADR-118/119 + ADR-121 (pre-session) |
| #4 NURBS-aware coplanar intersect | ✅ **closure (본 세션)** | **ADR-120 Q1=G via ADR-128 β** |

**Historic milestone**: 모든 4 explicit priorities closure. 새 architectural direction 결정 필요.

사용자 결재 (2026-05-17, 새 priority audit 진입):
> "추천 승인합니다" (Option A — 새 priority audit ADR, 1일 audit + 결재)

본 ADR 은 audit-first canonical 의 5번째 적용 (ADR-125 α-1 / ADR-126 α-2 / ADR-127 α-4 / ADR-128 priority #4 답습). Priority track 자체의 audit-driven 결정.

---

## 2. Current State Audit (10 candidates)

### 2.1 Candidates matrix

| # | 후보 | 현재 state | Maturity | Readiness | Priority signal |
|---|---|---|---|---|---|
| **1** | AI MCP capability coverage (ADR-041/042/043/044) | 15 capabilities (Tier 0 read 5 + Tier 1 construct 10) in `packages/axia-mcp-server/`. Tier 2/3 = 0/0. | Level 2 (persistent graph) | High | MCP surface stable; gap is breadth |
| **2** | Runtime benchmark infrastructure (ADR-124/126) | `crates/axia-geo/benches/practicality_bench.rs` 10-suite + `BASELINE_2026-05-16.md`. No CI regression detection. | Level 1 (baseline only) | Medium | SIMD/drawcall wins unquantified |
| **3** | Vendor STEP corpus expansion (ADR-082/083) | 1 fixture (`test_part_1.step`, 3.1 KB hand-crafted AP203). No SolidWorks/Fusion/CATIA. Slow-channel only. | Level 1 (minimal proof) | Low | Risk for edge-case bugs |
| **4** | Reference rendering (ADR-095 Phase 4) | 3 types defined (`ConstructionLine`/`ImportedMesh`/`PointCloud`), data structure complete. **Render visual deferred** (ADR-095 §8). | Level 1 (data only) | Medium | ADR-046 Pillar 2 requirement |
| **5** | Constraint solver (ADR-3x) | Level 2 persistent graph (4 kinds). No iterative XPBD. | Level 2 | Low | Production stable; XPBD = long-arc research |
| **6** | Multi-document / project mgmt | Single-doc snapshot only. No workspace tabs / recent files. | Level 1 | Low-Medium | No user signal; Phase 5 scope |
| **7** | **ADR-046 P31 Pillar progress (UI/UX)** | **Pillar 1 (Discoverability): CapabilityExplorerPanel scaffolded, no impl. Pillar 3 (Mode Coherence): spec only, no UI filter. Pillar 4 (AI Seam): ActionCatalog locked. Pillar 5: no tier UI.** | Level 2 (policy locked, ~20% impl) | **High-Critical** | **P31 explicitly "가장 시급" (most urgent)** |
| **8** | Tessellation cache + LOD (ADR-123 B) | No cache layer. NURBS surfaces tessellate fresh per-call. ADR-123 audit closure: current state already optimal. | Level 1 | Low-Medium | ADR-123 B deprioritized post-audit |
| **9** | Visual quality + baselines (ADR-077) | V-3 Linux baseline generated (manual dispatch). V-4 cross-OS matrix **not CI-integrated**. Visual specs `skip()`. | Level 2 (Linux ready, multi-OS spec) | Medium | Regression coverage gap |
| **10** | ADR-104 family follow-ups | Family 100% complete (ADR-117). STEP export NURBSSurface round-trip = "future track". | Level 3 (family complete) | Very Low | No trigger condition |

### 2.2 Audit core findings

**Engine layer (ADR-001 ~ ADR-128)**: stable, mature. LOCKED #43 priority track 100% closure 후 engine-side architectural debt = minimal.

**UI/UX layer (ADR-046 P31 family)**: ~20% implementation. Pillar 1 (Discoverability) explicitly "가장 시급" per ADR-046 §8. Phase 2 (Discoverability) explicit gate on Pillar 1.

**Critical path 발견**: ADR-046 P31 Pillar 1 (Discoverability) — `CapabilityExplorerPanel.ts` 스캐폴드는 있으나 **CapabilityExplorer 구현 없음**. ActionCatalog SSOT (D1) policy 잠겼지만 UI binding 미완. Pillar 1 = Phase 2 prerequisite.

---

## 3. Priority Candidates Matrix (4 high-priority)

### 3.1 Priority #1 — ADR-046 P31 Pillar 1 (Discoverability)

| | |
|---|---|
| **Scope** | Capability Explorer + Cmd-K palette. `CapabilityExplorerPanel.ts` (existing scaffold) + ActionCatalog data binding + Cmd-K palette (FuzzySearch). Phase 1 (Polish) deadline closure. |
| **시간** | ~2주 atomic |
| **risk** | Low — ActionCatalog SSOT (D1) policy locked, MCP dispatch proven. Engine work 0. |
| **사용자 가치** | P31 product identity anchor. Discoverability = first-class principle (ADR-046 §6.5). "가장 시급" per ADR-046 §8. |
| **trigger 조건** | Pillar 1 = Phase 2 prerequisite (ADR-046 Phase 1 "~1개월" deadline). |
| **canonical 답습** | ADR-045 D1 (ActionCatalog SSOT) + ADR-045 D3 (CapabilityExplorer 안), ADR-046 P31 Pillar 1 |

### 3.2 Priority #2 — Visual Baseline Multi-OS Matrix (ADR-077 V-4)

| | |
|---|---|
| **Scope** | GHA matrix (macOS/Windows baselines) + Playwright baseline capture + CI integration. V-3 → V-4 explicit successor. |
| **시간** | ~2주 atomic |
| **risk** | Medium — GHA matrix overhead, baseline file maintenance burden. Implementation = infrastructure-heavy. |
| **사용자 가치** | Regression coverage = correctness validation. LOCKED #40 (chord_tol) / LOCKED #43 (NURBS intersect) 모두 visual pipeline touch → 미보호 시 regression risk. |
| **trigger 조건** | Phase 2 (Discoverability) UI validation needs regression gate. Visual specs 재활성화 prerequisite. |
| **canonical 답습** | ADR-077 V-1 (정책 locked) + V-3 (infra proven) → V-4 |

### 3.3 Priority #3 — Reference Visual Rendering (ADR-095 Phase 4 + ADR-046 Pillar 2)

| | |
|---|---|
| **Scope** | THREE.js shader pipeline — ConstructionLine (dashed), ImportedMesh (ghost), PointCloud (point sprite). Selection / hover integration. Per-instance rendering pattern (ADR-126 답습). |
| **시간** | ~3주 multi-week |
| **risk** | Medium-High — shader complexity (dashed lines / ghost geometry), selection coordinate precision (ADR-026/038 integration). |
| **사용자 가치** | Pillar 2 (Precision Visibility) requirement. 사용자가 reference type 시각적으로 구분 불가능 (현재 gap). |
| **trigger 조건** | ADR-095 Phase 3-ζ complete (data + undo/redo) → Phase 4 (rendering). |
| **canonical 답습** | ADR-095 Phase 3-ζ + ADR-046 Pillar 2 + ADR-126 Merged BufferGeometry pattern |

### 3.4 Priority #4 — Mode Coherence (ADR-046 Pillar 3)

| | |
|---|---|
| **Scope** | 4-mode workspace (Sketch / Model / Inspect / Debug). 사용자 toggle, default off, additive (ADR-046 Q4 합의). Menu filter architecture + mode switcher UI. |
| **시간** | ~3주 multi-week |
| **risk** | Medium — mode state management (transient vs persisted), menu filter scope creep (51 actions × 4 modes). |
| **사용자 가치** | Pillar 3 = additive workflow foundation. Pillar 5 (Progressive Disclosure) tier UI separation prerequisite. |
| **trigger 조건** | Phase 2 completion + user research validation (Discoverability) → Phase 3 explicit gate. |
| **canonical 답습** | ADR-046 P31 Pillar 3 + ADR-045 D2 (panel taxonomy) precedent |

### 3.5 Secondary candidates (deferred)

| 후보 | 이유 |
|---|---|
| Constraint solver XPBD (Level 3) | Production Level 2 안정. Long-arc research. ADR-046 Phase 5. |
| Vendor STEP corpus expansion | 1 fixture sufficient for ADR-082 C-ε. Expansion = regression robustness 만. Future Phase 5. |
| Tessellation cache (ADR-123 B) | ADR-123 audit closure 확인 — current state already optimal. |
| Multi-document workspace | Feature expansion (Phase 5 Expert Workflow). No user signal. |
| ADR-104 family follow-ups (STEP export) | Family 100% complete. STEP export = separate capability (not blocking). |

---

## 4. 결재 트리거 (사용자 명시 선택 필요)

### 4.1 Q1 — Priority track 선택

본 ADR 의 핵심 결재 — **새 LOCKED #X (가칭) priority track** 의 priority #1~4 채택:

- **(a) Recommended track (4-priority 매트릭스)**: P#1 Pillar 1 → P#2 V-4 → P#3 Reference Render → P#4 Mode Coherence
  - 위 §3 매트릭스 그대로 4-priority track 채택
  - Phase 2 (Discoverability) deadline → Phase 3 (Mode) 자연 sequence
  - Total ~10주 (각자 atomic per LOCKED #44)
- **(b) Pillar 1 only**: 우선 Pillar 1 만 진입 → β implementation 후 다음 priority 재평가 (점진)
- **(c) Custom matrix**: 사용자가 priority order 변경 또는 secondary 후보 일부 포함
- **(d) Defer 전체 priority track**: 별도 architectural direction (예: 사용자 시연 evidence-driven)

### 4.2 Q2 (Q1 선택 후) — Priority #1 진입 방식

- **(a) Audit-first canonical 5번째 적용**: ADR-130 (가칭) — Pillar 1 audit ADR (`CapabilityExplorerPanel.ts` 현재 상태 + ActionCatalog binding + Cmd-K library 후보 매트릭스) → β implementation
- **(b) 직접 β implementation**: ADR-046 P31 spec 충분, immediate implementation. 시간 ~2주.

### 4.3 Q3 — Atomic 분할 단위

- single PR per priority (LOCKED #44 정합)
- 또는 priority 별 sub-step seq (예: Pillar 1 = scaffold → ActionCatalog binding → Cmd-K → polish)

### 4.4 Q4 — 사용자 시연 게이트 (ADR-087 K-ζ)

- 각 priority closure 후 즉시 사용자 시연 (canonical 답습)
- 또는 priority track 전체 closure 후 통합 시연

### 4.5 권장 default

- **Q1 = (a) Recommended 4-priority track** — §3 매트릭스 그대로
- **Q2 = (a) Audit-first 5번째 적용** — Pillar 1 audit ADR (ADR-130 가칭) 먼저, β implementation 별도
- **Q3 single PR per priority** (LOCKED #44 정합)
- **Q4 각 priority closure 후 즉시 시연**

대안: **Q1 = (b) Pillar 1 only** + **Q2 = (b) 직접 β implementation** — 빠른 atomic, multi-week 회피.

---

## 5. Lock-ins (canonical, L-129-1 ~ L-129-8)

- **L-129-1** LOCKED #43 priority track 100% closure 명시 (architectural milestone evidence)
- **L-129-2** 새 priority track = ADR-046 P31 Pillar 1-3 implementation (UI/UX critical path)
- **L-129-3** Engine layer (ADR-001~128) = stable mature, 별도 architectural value track (audit-driven)
- **L-129-4** Audit-first canonical 5번째 적용 강제 — Pillar 1 β implementation 진입 전 audit 우선
- **L-129-5** ADR-046 P31 product identity anchor 정합 — 모든 priority candidate 가 P1 (건축/디자인) + P3 (AI 협업자) 가치 증가
- **L-129-6** ADR-046 P31 #4 additive only (menu 변경 additive, muscle memory 파괴 없음)
- **L-129-7** LOCKED #44 의미 단위 분할 — priority 별 atomic PR (3-4 priorities 묶지 않음)
- **L-129-8** 절대 #[ignore] 금지

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **Constraint solver XPBD (Level 3)** — long-arc research, ADR-046 Phase 5
- **Multi-document workspace** — feature expansion, Phase 5
- **Tessellation cache (ADR-123 B)** — ADR-123 audit closure 확인 (current optimal)
- **STEP export NURBSSurface round-trip** — ADR-104 family follow-up, future ADR
- **Vendor STEP corpus expansion** — regression robustness 만, no architectural gap
- **AI MCP Tier 2/3 capability breadth** — Pillar 4 AI Seam의 후속, 별도 ADR (ADR-046 Phase 4 explicit gate)

---

## 7. Cross-link

- **LOCKED #43** — 직전 priority track (100% closure milestone)
- **ADR-046 P31** — UI/UX long-term strategy (Pillar 1-5 anchor)
- **ADR-045** — UI surface consolidation + ActionCatalog SSOT (D1) + CapabilityExplorer 안 (D3)
- **ADR-077** — visual regression infrastructure (V-1 / V-3 / V-4)
- **ADR-095** — Reference citizen Phase 3-ζ (data complete, render deferred)
- **ADR-104 family** — Path B 100% closure (LOCKED #43 #2)
- **ADR-126** — Merged BufferGeometry pattern (Reference render Phase 4 답습 가능)
- **ADR-118 / ADR-120 / ADR-122 / ADR-123** — α spec → β implementation atomic 패턴 source (본 ADR 답습)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical
- **LOCKED #44** — Complete Meaning per Merge (priority 별 atomic PR)
- **LOCKED #58** — 직전 closure (ADR-128 + LOCKED #43 priority #4)

---

## 8. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 priority track 만 별도 atomic sub-step PR 진행.

**Q1 priority track 선택** + Q2-Q4 default 채택 여부 명시 부탁드립니다.

**권장 default 요약**:
- **Q1 (a) Recommended 4-priority track**: P#1 Pillar 1 → P#2 V-4 → P#3 Reference Render → P#4 Mode Coherence
- **Q2 (a) Audit-first 5번째 적용**: Pillar 1 audit ADR (ADR-130 가칭) 먼저
- **Q3 single PR per priority** (LOCKED #44 정합)
- **Q4 각 priority closure 후 즉시 시연** (ADR-087 K-ζ canonical)

**대안**:
- **Q1 (b) Pillar 1 only** — 점진, 빠른 atomic
- **Q1 (c) Custom matrix** — priority order 변경 또는 secondary 후보 포함
- **Q2 (b) 직접 β implementation** — Pillar 1 audit 생략, ~2주 atomic 진입

---

## Amendment 1 — Priority #1 부분 closure (2026-05-17, ADR-130/131/132/133 후속)

**상태**: ADR-129 spec 본문 (§§1~8) 보존. 본 amendment 만 추가.
**Trigger**: ADR-130 audit (Pillar 1 audit) → ADR-131 (dual catalog finding 발견) → ADR-132 audit + ADR-133 β implementation closure.
**사용자 결재**: 2026-05-17, "승인합니다" (Option A — small docs cleanup amendment).

### A1.1 Priority #1 (Pillar 1 Discoverability) 부분 closure 명시

ADR-129 §3.1 Priority #1 (Pillar 1 Discoverability) 의 실제 진행 매트릭스:

| Component | Spec scope (§3.1) | Actual status | Closure ADR |
|---|---|---|---|
| **Cmd-K palette** | 추가 implementation 필요 | ✅ **이미 production 활성** (286 LOC CommandPalette, 148 commands, fuzzy + ↑/↓ + Enter + Esc) | ADR-131 (audit closure pivot 6번째) |
| **ActionCatalog SSOT** | binding 추가 필요 | ✅ **161 entries (66 ADR-133 added)**, AC ⊇ CC invariant 강제 | ADR-133 β implementation |
| **CapabilityExplorerPanel** | Step 4 invoke 60% → 100% | ⚠ Step 4 dispatch 60% (UNCHANGED, ADR-130 §2.1 audit) | (future ADR — γ-3 sub-step) |
| **MenuBar / KeyboardShortcuts ActionCatalog binding** | Phase 2 prep | ❌ Not started (ADR-130 §2.3 binding gap) | (future ADR-134/135 가칭, γ-5/γ-6 sub-step) |
| **Fuzzy search library** | fuzzysort 권장 | ✅ Native (CommandPalette 자체 `score_match` + `containsAll`) | ADR-131 §2.4 finding |
| **i18n infrastructure** | Phase 2 explicit gate | ❌ Not started (ADR-130 §2.5 #3) | (future Phase 2 ADR) |
| **Tier 3 destructive content** | ADR-045 D3 reserved | ❌ 0 entries (ADR-130 §2.5 #4) | (future ADR) |

### A1.2 Priority #1 status redefinition

| Status field | Pre-ADR-130 | Post-ADR-133 (current) |
|---|---|---|
| Cmd-K palette implemented | "scaffold-only" 가정 | ✅ **Production active** |
| ActionCatalog identity SSOT | "spec only" | ✅ **161 entries with AC ⊇ CC invariant** |
| CapabilityExplorerPanel Step 4 | "scaffold" | ⚠ 60% (UNCHANGED) |
| Dual catalog architectural finding | (unknown) | ✅ **Architectural lock-in** (ADR-131 + ADR-132 + ADR-133) |
| Pillar 1 진짜 잔존 gap | (unknown) | §A1.3 4 영역 (ADR-131 §2.5 답습) |

**Priority #1 부분 closure 도달** — ADR-131/132/133 closure 가 *원래 spec의 60-70%* 수행. 잔존 30-40% = §A1.3.

### A1.3 진짜 Pillar 1 잔존 gap (ADR-131 §2.5 답습)

ADR-131 §2.5 의 진짜 Pillar 1 gap 4 영역:

1. **CapabilityExplorerPanel Step 4 dispatch 완료** (Tier 1/2/3 invoke logic, main.ts wiring) — γ-3 sub-step 추정 ~2-3일
2. **CapabilityExplorerPanel vs CommandPalette UX 중복 해소** — 두 different palette + F1 ShortcutHelp = 사용자 혼란 (별도 UX ADR)
3. **i18n infrastructure** (ADR-046 Q7 Korean+English) — Phase 2 explicit gate
4. **ActionCatalog Tier 3 destructive content** (ADR-045 D3 reserved, ADR-133 0 entries added) — future ADR

§A1.3 4 영역은 별도 ADR (가칭 ADR-135 + future) 으로 진입 가능.

### A1.4 Priority track sequence 유효성 재확인

ADR-129 §3 4-priority track (P#1 → P#2 → P#3 → P#4) 의 sequence **유효**:
- ✅ **P#1 Pillar 1 부분 closure** (ADR-131/132/133) — §A1.2 status
- ⏭ **P#2 Visual Baseline Multi-OS Matrix V-4** — 다음 진입 후보 (~2주 atomic)
- ⏭ P#3 Reference Visual Rendering (ADR-095 Phase 4) — 후속
- ⏭ P#4 Mode Coherence (ADR-046 Pillar 3) — 후속

P#1 잔존 gap (§A1.3) 의 4 영역 중 *critical path* 는 #1 (CapabilityExplorer Step 4) — 별도 ADR 시 진입 가능 but P#2 진입과 ortho gonal.

### A1.5 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-131/132/133 closure 의 자연 documentation
- ADR-129 §3 priority track sequence UNCHANGED

### A1.6 Cross-link (Amendment 1)

- **ADR-130 Amendment 1** — Pillar 1 audit findings (ADR-131 §A1.2 detailed source)
- **ADR-131** — dual catalog finding (Cmd-K already production)
- **ADR-132** — dual catalog unification audit (Path E 추천)
- **ADR-133** — Path E β implementation (161 AC entries + AC ⊇ CC invariant)
- **ADR-045 D1 Amendment 1** — identity vs dispatch 분리 명시 (본 PR 동시 commit)
- **LOCKED #59 / #60** — ADR-131 / ADR-133 closure entries
- **LOCKED #61** (본 amendment closure)
