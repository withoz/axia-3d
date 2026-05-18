# ADR-125 — Selection Rendering Audit Closure (ADR-122 α-1 Pivot)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — audit closure + α-1 pivot decision, docs only single PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "C → A 순차 — 가장 단순/신속/정확 승인합니다") |
| Anchor | Pre-implementation audit (2026-05-17) of `SelectionManager.ts` found ADR-122 α-1 architectural premise *contradicted* by actual code — current state already optimal |
| Parent | ADR-122 (α spec for GPU instancing, includes Amendment 1 with current-state correction), ADR-123 (Q2 default — ADR-122 α-1 후속) |
| Cross-cut | ADR-074 (group A/B outline merged geometry), ADR-077 V-2 (visual baseline), ADR-088 (multi-segment edge), ADR-046 P31 #4 (additive only) |

---

## 1. Canonical Anchor

ADR-124 closure 후 ADR-123 Q2 default 정합으로 ADR-122 α-1 (Selection BBox InstancedMesh) β implementation 진입. **사전 검토 audit** 으로 `SelectionManager.ts` + `Viewport.ts` 현재 selection rendering 의 architectural truth 측정.

**Critical finding**: ADR-122 §2 hotspot A 의 가정 ("Selection BBox group select 시 *N drawcalls*") 가 *현재 코드 실측 1 drawcall* 과 불일치. ADR-122 α-1 의 "N drawcalls → 1 instance" 가정이 무효.

사용자 결재 (2026-05-17, audit finding 보고 후):
> "C → A 순차 — 가장 단순/신속/정확 승인합니다"

= **C** (본 ADR-125, audit closure docs) + **A** (별도 ADR-126, ADR-122 α-2 Reference imported mesh InstancedMesh — 진짜 N-drawcall hotspot).

본 ADR-125 는 architectural truth 의 lock-in + ADR-122 α-1 pivot decision lock-in. Docs only — 회귀 0.

---

## 2. Audit Findings (canonical evidence)

### 2.1 Current selection rendering — 이미 single-drawcall-per-outline-type

`web/src/tools/SelectionManager.ts` 측정 (2026-05-17 audit):

| Selection Type | Code site (line) | 현재 drawcall | 비고 |
|---|---|---|---|
| Face selection (cyan fill) | `rebuildSelectionMesh()` line 1124 | **1 drawcall** | 이미 merged geometry (single `THREE.Mesh`) |
| Face boundary outline | (disabled 2026-04-27) | 0 | "면만 선택되어야 한다" (audit comment line 1162) |
| Edge selection (orange Line2) | `rebuildEdgeSelectionLine()` line 1604 | 1 drawcall | 이미 merged `THREE.LineSegments2` |
| Edge hover (red Line2) | `rebuildEdgeHoverLine()` line 1648 | 1 drawcall | ADR-088 multi-segment 통합 |
| Group A outline (ADR-074) | `rebuildGroupOutlines()` line 1851 | **1 drawcall** | 이미 merged `THREE.LineSegments`, group A 전체 boundary BFS |
| Group B outline (ADR-074) | `rebuildGroupOutlines()` line 1851 | 1 drawcall | 동일 |
| **합계 (max simultaneous)** | — | **6 drawcalls** | 이미 optimal |

**결론**: ADR-122 α-1 의 "Selection BBox group select 시 N drawcalls" premise 가 잘못됨. 이미 outline-type 별 merged geometry — N face × 1 drawcall (per outline type).

### 2.2 Architectural reason — merged-geometry-per-type pattern

`buildBoundaryEdges()` (line 1247) 가 한 group 의 N face 의 boundary edges 를 BFS 로 traverse → single merged BufferGeometry 로 합성 → 1 LineSegments. ADR-074 §B-2 (group A/B outline 분리 결정, 2026-05-05) 시점에 이미 채택된 architectural choice.

**대비**: ADR-122 §2 hotspot A 의 가정은 "N face 각각 별도 LineSegments" — 이는 SketchUp / Fusion 의 outline-per-face 패턴. AxiA 는 ADR-074 시점에 *type-level merged geometry* 로 이미 선행 optimization.

### 2.3 진짜 N-drawcall hotspot — D (Reference imported mesh)

ADR-122 §2 hotspot 매트릭스 재평가:

| Hotspot | 가정 (ADR-122 §2) | 실측 (audit) | 진짜 hotspot? |
|---|---|---|---|
| A — Selection BBox | N drawcalls | **1 drawcall** (merged) | ❌ 가정 무효 |
| B — Snap markers | (이미 2D canvas) | 0 GPU drawcalls | ✅ 가정 정합 |
| C — Helper lines | N drawcalls | 1-5 LineSegments2 per type | ⚠️ medium |
| **D — Reference imported mesh** | N drawcalls | **N × 2 (front+back two-tone)** | ✅ **진짜 hotspot** |
| E — Primitive preview | N drawcalls | 1 (per-tool single mesh) | ❌ 이미 optimal |
| F — Construction lines | N drawcalls | 1 per type | ❌ medium |
| G — Clash detection | N drawcalls | rarely > 50 | ⚠️ low priority |

`web/src/import/StepIgesImporter.ts` (ADR-082 / ADR-083): STEP face 별 별도 `THREE.Mesh` × 2 (front Material + back Material, ADR-018 two-tone). **STEP 500 face import = 1000 drawcalls**. 이것이 진짜 N-drawcall hotspot.

### 2.4 CPU-side perf 별도 hotspot (선택적 별도 ADR)

`buildBoundaryEdges()` 의 BFS chain reconstruction (line 1316-1348) 은 selection > 1000 faces 시 매 selection change 마다 main thread O(N) work. Drawcall 은 1 이지만 CPU rebuild 비용 별도. **별도 trigger ADR** (사용자 시연 evidence 시).

---

## 3. Pivot Decision (canonical lock-in)

### 3.1 Pivot summary

ADR-122 α-1 (Selection BBox InstancedMesh) 의 β implementation 을 **거부**. 대신:

- **ADR-122 α-1 spec 자체 보존** + Amendment 1 추가 (current state correction)
- ADR-122 α-2 (Reference imported mesh InstancedMesh) 가 진짜 N-drawcall hotspot — 별도 ADR-126 (가칭) 으로 β implementation 진행
- ADR-122 §2 hotspot 매트릭스 정정 (Amendment 1 §1.2)

### 3.2 거부 근거 (lock-in)

- **L-125-D1** — ADR-122 α-1 강행 시 visual regression risk (outline → AABB box, ADR-074 group color outline 회귀)
- **L-125-D2** — Gain 0 (이미 1 drawcall per outline type — InstancedMesh 추가 시 instance matrix overhead 만 증가)
- **L-125-D3** — ADR-046 P31 #4 additive only 위배 위험 (visual change 발생)
- **L-125-D4** — ADR-074 / ADR-077 V-2 visual baseline regression risk

### 3.3 ADR-126 (가칭) 진입 결정 — 진짜 hotspot

별도 atomic PR per LOCKED #44:
- **Scope**: `StepIgesImporter.ts` 의 N face × Mesh × 2 → 1 InstancedMesh (per-instance front material) + 1 InstancedMesh (per-instance back material)
- **시간**: 1주 atomic
- **회귀 검증**: ADR-077 V-2 visual baseline + ADR-083 STEP import baseline + ADR-086 owner-ID 매핑 정합
- **Per-face metadata**: ADR-086 O-δ `userData.axiaFaceId` per-instance attribute 로 매핑 — owner-ID promotion 보존

---

## 4. Lock-ins (canonical, L-125-1 ~ L-125-9)

- **L-125-1** Pre-implementation audit canonical — spec 의 architectural premise 가 코드 실측과 다를 수 있음. 모든 β implementation 진입 전 *반드시* audit 우선. ADR-118 → ADR-119 / ADR-122 → ADR-125 패턴 답습.
- **L-125-2** Audit truth > spec assumption — 사용자 결재 시점의 가정이 코드 변경 누적으로 무효화될 수 있음. Audit finding 발견 시 즉시 사용자 결재 escalation (silent 변경 거부).
- **L-125-3** Visual regression 거부 정책 — ADR-046 P31 #4 additive only 의 *defensive interpretation*. visual change 의심 시 ADR-077 visual baseline 가드 + 사용자 결재 필수.
- **L-125-4** ADR-074 group outline merged geometry 정합 보존 — `rebuildGroupOutlines()` line 1851 의 `LineSegments` merged pattern 은 본 ADR 시점 architectural truth. 향후 변경 시 별도 ADR.
- **L-125-5** ADR-077 V-2 visual baseline 보존 — `web/e2e/visual/group-color.visual.spec.ts` 3 baseline (A only / B only / A+B) 변경 거부.
- **L-125-6** Pivot 의 architectural value — α-1 거부 결정 자체가 architectural lock-in (잘못된 path 강행 회피). ADR-076 §C-amendment-1 (cleanup deletion 정책) 답습 — 부정 결정도 명시적 lock-in.
- **L-125-7** ADR-122 α-1 spec 보존 — supersede 하지 않고 Amendment 1 으로 current state correction. 향후 selection > 1000 faces 시 별도 trigger ADR 가능.
- **L-125-8** ADR-122 α-2 (Reference imported mesh) 가 다음 β implementation 트랙 — 별도 ADR-126 (가칭).
- **L-125-9** 절대 #[ignore] 금지 — docs only, 회귀 0 (별도 atomic 의 회귀는 ADR-126 에서 검증).

---

## 5. 회귀 (0)

본 ADR 은 docs only. 회귀 없음.

- `cargo test`: UNCHANGED
- `vitest run`: UNCHANGED (1916 maintained per LOCKED #54)
- Playwright E2E: UNCHANGED (visual baselines 보존)
- ADR-122 PR #86 의 α spec docs 보존 (Amendment 1 추가만)

---

## 6. Cross-link

- **ADR-122** — Amendment 1 추가 대상 (current state correction)
- **ADR-123** — Q2 default ("ADR-122 α-1 후속") 의 architectural 재해석 — α-1 pivot 후 α-2 로 진입
- **ADR-124** — 직전 ADR (engine-side SIMD), 본 ADR 은 render-side audit 결과
- **ADR-074** — group A/B outline merged LineSegments pattern source (audit finding 의 architectural truth)
- **ADR-077 V-2** — visual baseline 가드
- **ADR-088** — multi-segment edge hover 통합 (audit 정합)
- **ADR-046 P31 #4** — additive only (L-125-3 defensive interpretation)
- **ADR-076 §C-amendment-1** — 부정 결정 명시 lock-in 패턴 source
- **ADR-126 (가칭)** — 본 ADR 의 자연 후속 (α-2 β implementation)
- **LOCKED #44** — Complete Meaning per Merge (audit + pivot decision = 단일 의미 단위)

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Audit `SelectionManager.ts` rendering | ✅ | §2.1 매트릭스 (6 drawcalls max, 모두 1-per-type) |
| Architectural reason audit | ✅ | §2.2 (ADR-074 merged geometry 답습) |
| 진짜 hotspot 재평가 | ✅ | §2.3 (D — Reference imported mesh = N × 2) |
| CPU-side perf 별도 hotspot 식별 | ✅ | §2.4 (selection > 1000 faces 시 BFS rebuild) |
| Pivot decision lock-in | ✅ | §3 (α-1 거부 + α-2 진입 anchor) |
| ADR-122 Amendment 1 (current state correction) | ✅ | `docs/adr/122-*.md` Amendment 1 section |
| CLAUDE.md LOCKED #55 entry | ✅ | LOCKED #55 |

---

## E. Lessons (canonical for future pre-implementation audits)

- **L-125-α-1 — Audit-first canonical 강화**: ADR-118/120/122 의 α spec 가 audit 없이 가정한 architectural state 가 ADR-122 α-1 에서 처음 *invalid* 확인. 향후 모든 α spec 에 *audit 우선 권장* lock-in (사용자 결재 시점 직전 자동 audit). ADR-103-ε § L2 (audit-first vs sed assumption) 의 더 깊은 적용.
- **L-125-α-2 — 5개월 누적 자산의 implicit optimization**: ADR-074 (2026-05-05) 의 group outline merged LineSegments 결정이 본 ADR (2026-05-17) 시점에 *implicit optimization* 으로 발견. 향후 다른 ADR 의 "현재 inefficient" 가정도 architecture audit 우선 권장 — 5개월간 누적된 optimization 이 spec assumption 보다 우선.
- **L-125-α-3 — 부정 결정의 architectural value (lock-in)**: ADR-076 (legacy deletion 부정 결정) 답습 — α-1 거부 결정 자체가 *명시 lock-in*. 향후 누군가 "ADR-122 α-1 implement" 시도 시 본 ADR-125 가 즉시 발견 가능. 부정 결정 silent 거부 (commit 없이 진행 안 함) 정책의 첫 *spec pivot* 사례.
- **L-125-α-4 — Spec preservation + Amendment pattern**: α-1 spec 을 supersede 하지 않고 Amendment 1 으로 *current state correction*. 향후 selection > 1000 faces trigger 시 본 α-1 + Amendment 1 가 architectural context anchor. 폐기 대비 *preservation + amendment* 가 더 유연.
- **L-125-α-5 — Q2 default 의 architectural 재해석**: ADR-123 Q2 default ("ADR-122 α-1 후속") 가 본 ADR 후 "ADR-122 α-2 후속" 으로 재해석. 향후 ADR 의 default option 도 audit 기반 재해석 가능 — *spec default 가 절대 아님*.
