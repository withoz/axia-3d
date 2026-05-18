# ADR-127 — Helper Lines Audit Closure (ADR-122 α-4 Pivot)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — audit closure + α-4 pivot decision, docs only single PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "승인합니다" Option A 채택, audit-first canonical 3번째 적용) |
| Anchor | Pre-implementation audit of helper line rendering (SnapVisual, DimensionLabel, DrawPlaneIndicator) found ADR-122 §2 hotspot C ("Helper lines") architectural premise *largely 부정확* — Canvas 2D 위임이 이미 dominant |
| Parent | ADR-122 (α spec — Amendment 3 추가 대상), ADR-125 (audit closure 패턴 source — 1:1 mirror) |
| Cross-cut | ADR-046 P31 #4 (additive only), ADR-076 §C-amendment-1 (부정 결정 명시 lock-in 패턴), ADR-126 (직전 β implementation), ADR-018 (visual policy) |

---

## 1. Canonical Anchor

ADR-126 closure (LOCKED #56) 후 ADR-123 Q2 default 정합으로 ADR-122 α-4 (Helper lines KAYAC pattern) audit 진입. 사용자 결재 (2026-05-17, audit findings 보고 후):

> "승인합니다" (Option A — 순수 audit closure ADR-127, ADR-125 답습)

본 ADR 은 **세션 audit-first canonical 의 3번째 success** (ADR-125 α-1, ADR-126 α-2 pivot 답습). Helper line rendering 의 architectural reality 가 spec 가정과 다름을 명시 lock-in + ADR-122 §2 hotspot C 정정.

---

## 2. Audit Findings (canonical evidence)

### 2.1 Helper line rendering 매트릭스 (실측)

| Helper Line Source | Code site (line) | ADR-122 §2 hotspot C 가정 | 실측 audit | 상태 |
|---|---|---|---|---|
| **SnapVisual** (snap guide lines) | `SnapVisual.ts` 21-434 | "LineSegments2 별 drawcall, N drawcalls" | **Canvas 2D 1 stroke per guide** | ✅ **이미 optimized** (3D 안 씀) |
| **DimensionLabel** (dim ticks) | `DimensionLabel.ts` 40-482 | "LineSegments per tick" | **Canvas 2D N strokes** (no 3D overhead) | ✅ **이미 optimized** (3D 안 씀) |
| **DrawPlaneIndicator** (axis gizmo) | `DrawPlaneIndicator.ts` 42-164 | "1 LineSegments per axis" | **3 separate `THREE.Line`** (NOT merged, shared material) | ⚠️ Real but marginal hotspot (2 drawcalls 절감 가능) |
| **Viewport edge overlays** (non-manifold / free edge) | `Viewport.ts` 2591-2673 | not classified | `LineSegments2` (LineMaterial fast path) | ✅ 이미 fast |
| **PrimitivePreviewManager** (radius/height) | `PrimitivePreviewManager.ts` 10-143 | not classified | 1-2 LineSegments per active tool | ✅ lightweight |
| **SnapManager** | `SnapManager.ts` | not classified | No Three.js Line rendering — delegated to SnapVisual canvas | ✅ 정합 |

### 2.2 Architectural reason — Canvas 2D overlay pattern

ADR-122 §2 hotspot C 가정의 무효 사유: AxiA 의 SnapVisual + DimensionLabel 가 **2D Canvas overlay** 패턴 채택 — Three.js 3D scene 위에 별도 2D layer 로 helper 표시. 3D LineSegments 자체 사용 안 함 → drawcall hotspot 자연 부재.

이는 ADR-074 (group outline merged geometry, 2026-05-05) 의 *type-level merged geometry pattern* 과 동일 architectural pattern — *implicit optimization*. ADR-122 §2 작성 시점 (2026-05-17) 에 이 implicit optimization audit 누락.

### 2.3 DrawPlaneIndicator 분석 (유일한 잔존 hotspot)

`DrawPlaneIndicator.ts:46-87`:
```typescript
// 현재 구현 — 3 separate Three.js Line objects per gizmo update
const rightLine = new THREE.Line(rightGeom, material);   // X axis red
const upLine = new THREE.Line(upGeom, material);         // Y axis green
const normalLine = new THREE.Line(normalGeom, material); // Z axis blue (normal)
```

**Gain 분석**:
- 현재: 3 `THREE.Line` per gizmo (X / Y / normal axes)
- 가능: 1 `LineSegments` with 3 drawRanges + 3 color attribute = 1 drawcall
- 절감: **2 drawcalls per active drawing tool** (gizmo visible 시점만)

**Trigger 조건**: 사용자가 Drawing tool (Line/Rect/Circle/Polygon 등) 활성화 시점에만 visible — 일반 사용 시 단일 active tool (3 drawcalls 정상)

**ADR-122 §2 spec 평가**: "medium gain" → **실제로 low gain** (marginal). ADR-046 P31 #1 "가볍게" 정합으로 implement 거부.

### 2.4 진짜 N-drawcall hotspot 없음

ADR-122 §2 hotspot C "Helper lines" 의 가정된 N-drawcall pattern 은 audit 결과 **존재하지 않음**:
- SnapVisual: N → 0 (Canvas 2D)
- DimensionLabel: N → 0 (Canvas 2D)
- DrawPlaneIndicator: 3 fixed (axis gizmo, marginal)
- Viewport overlays: 1-2 fixed (LineSegments2 fast path)

→ **α-4 hotspot 가정 자체가 무효** (ADR-125 α-1 의 평행 사례 — 이미 optimal).

---

## 3. Pivot Decision (canonical lock-in)

### 3.1 Pivot summary

ADR-122 α-4 (Helper lines KAYAC pattern) 의 β implementation 을 **거부**. 사유:
- Canvas 2D 위임이 hotspot 자연 부재
- DrawPlaneIndicator 만 minor merge candidate (2 drawcalls marginal) — ADR-046 P31 #1 "가볍게" 거부
- ADR-122 §2 hotspot C 가정 무효 → 후속 atomic 가치 없음

**대안 채택**:
- ADR-122 §spec 자체 보존 + Amendment 3 추가 (current state correction)
- 추천 매트릭스 정정 (α-4 deprecation, α-3 / α-5 / α-6 묶음 자연 deprecation)
- 다음 priority 진입 (LOCKED #43 priority #4 — ADR-120 Q1 결재)

### 3.2 거부 근거 (lock-in)

- **L-127-D1** Canvas 2D 위임이 이미 dominant — SnapVisual + DimensionLabel 가 3D LineSegments 사용 안 함, hotspot 가정 자연 무효
- **L-127-D2** DrawPlaneIndicator merge gain 마진 (2 drawcalls per active tool) — ADR-046 P31 #1 "가볍게" 거부
- **L-127-D3** ADR-074 (group outline merged geometry, 2026-05-05) 시점에 type-level merged geometry pattern 이 이미 architectural standard — 향후 추가 helper line 도 본 pattern 답습 권장
- **L-127-D4** ADR-046 P31 #4 additive only 정합 — visual change 없음, 사용자 facing 변화 0

### 3.3 ADR-122 hotspot 매트릭스 closure

ADR-122 §2 hotspot 매트릭스 전체 closure (Amendment 1/2/3 누적):

| Hotspot | 가정 | Audit | Status | Closure ADR |
|---|---|---|---|---|
| A — Selection BBox | N drawcalls | 1 (merged per type) | ❌ 가정 무효 | **ADR-125** Amendment 1 |
| B — Snap markers | 2D canvas | 0 GPU drawcalls | ✅ 정합 | (audit only) |
| **C — Helper lines** | **N drawcalls** | **Canvas 2D + 1-3 fixed** | ❌ **가정 largely 무효** | **ADR-127 Amendment 3** |
| **D — Reference imported mesh** | N × 2 | N × 2 | ✅ **진짜 hotspot** | **ADR-126** Amendment 2 (β impl) |
| E — Primitive preview | per-tool | 1 (이미 single) | ❌ 이미 optimal | (audit only) |
| F — Construction lines | N drawcalls | (per-edge LineSegments) | (별도 audit 필요 시) | future ADR |
| G — Clash detection | N drawcalls | rarely > 50 | (low priority) | future ADR |

**핵심 finding**: 7 hotspots 중 **단 1 (D)** 만 진짜 N-drawcall hotspot. ADR-126 가 그 single hotspot 해소.

---

## 4. Lock-ins (canonical, L-127-1 ~ L-127-9)

- **L-127-1** Pre-implementation audit canonical 강화 (ADR-125 L-125-1 의 3번째 적용) — 세션 패턴 정착 evidence
- **L-127-2** Canvas 2D overlay pattern 이 helper line rendering 의 canonical (SnapVisual + DimensionLabel) — 향후 새 helper line 도 본 pattern 답습 권장 시점부터
- **L-127-3** DrawPlaneIndicator 3-Line pattern 보존 (merge gain marginal, ADR-046 P31 #1 "가볍게" 정합)
- **L-127-4** ADR-122 α-4 spec 보존 (NOT superseded) + Amendment 3 추가 — ADR-125 §A1.3 spec preservation pattern 답습 (3번째 적용)
- **L-127-5** ADR-122 §2 hotspot C 가정 무효 명시 — 향후 helper line N-drawcall 가정 회피 anchor
- **L-127-6** ADR-122 추천 매트릭스 정정 — α-4 deprecation, α-3/α-5/α-6 묶음 자연 deprecation (A 가정 무효 → 묶음 의미 감소 보강)
- **L-127-7** 부정 결정의 architectural value (ADR-076 §C-amendment-1 + ADR-125 L-125-6 답습 — 3번째 적용)
- **L-127-8** 다음 priority 진입 anchor — LOCKED #43 priority #4 (ADR-120 Q1 결재) 가 자연 next
- **L-127-9** 절대 #[ignore] 금지

---

## 5. 회귀 (0)

본 ADR 은 docs only. 회귀 없음.

- `cargo test`: UNCHANGED
- `vitest run`: UNCHANGED (1917 maintained per LOCKED #56)
- Playwright E2E: UNCHANGED
- ADR-077 V-2 visual baselines: UNCHANGED

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **DrawPlaneIndicator merge** (3 Line → 1 LineSegments) — marginal gain (~2 drawcalls), ADR-046 P31 #1 거부. 별도 trigger 시 추가 ADR 가능 (예: 동시 multi-tool 활성 시점 발견 시)
- **Three.js mock additions** (`LineSegments2`, `LineGeometry`, `LineSegmentsGeometry`, `LineMaterial`) — 미래 ADR 시 필요 시 추가 (현재 deferred)
- **Construction lines (ADR-095 Reference citizen)** — `web/src/citizenship/` 의 ConstructionLine 별 rendering audit 필요 시 별도 ADR (현재 audit scope 외)
- **Helper line LOD** (distance-based culling) — 별도 perf ADR 시
- **ADR-122 §C hotspot full audit** — Construction lines / Clash detection 등 다른 hotspot 의 별도 audit ADR 가능 시

---

## 7. Cross-link

- **ADR-122** — Amendment 3 추가 대상 (current state correction)
- **ADR-125** — audit closure 패턴 source (1:1 mirror — α-1 audit closure)
- **ADR-126** — 직전 β implementation (α-2 pivot + impl)
- **ADR-074** — type-level merged geometry pattern source (implicit optimization 정착)
- **ADR-046 P31 #1** "가볍게" (DrawPlaneIndicator merge marginal gain 거부 사유)
- **ADR-046 P31 #4** additive only (visual + API 변화 0)
- **ADR-076 §C-amendment-1** — 부정 결정 명시 lock-in 패턴 source (3번째 답습)
- **ADR-077 V-2** — visual baseline 보존 (UNCHANGED)
- **ADR-018** — visual policy (helper line 색상 / 두께 정책 보존)
- **LOCKED #44** — Complete Meaning per Merge (docs-only PR scope)
- **LOCKED #55** (ADR-125 + ADR-122 Amendment 1) — audit-first canonical 1번째 success
- **LOCKED #56** (ADR-126 + ADR-122 Amendment 2) — audit-first canonical 2번째 success (pivot + β impl)
- **LOCKED #57** (본 PR — ADR-127 + ADR-122 Amendment 3) — audit-first canonical 3번째 success (pure audit closure)
- **LOCKED #43 priority #4** — 본 ADR closure 후 자연 next anchor (ADR-120 Q1 결재)

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Audit `SnapVisual.ts` rendering | ✅ | Canvas 2D — no 3D LineSegments |
| Audit `DimensionLabel.ts` rendering | ✅ | Canvas 2D — no 3D LineSegments |
| Audit `DrawPlaneIndicator.ts` rendering | ✅ | 3 separate Three.js Line (marginal merge candidate) |
| Audit `Viewport.ts` overlays | ✅ | LineSegments2 fast path (이미 optimal) |
| Audit `PrimitivePreviewManager.ts` | ✅ | 1-2 LineSegments per tool (lightweight) |
| Audit `SnapManager.ts` | ✅ | No Three.js Line rendering (delegated to SnapVisual canvas) |
| Pivot decision lock-in | ✅ | §3 (α-4 거부 + 다음 priority 진입 anchor) |
| ADR-122 Amendment 3 (current state correction) | ✅ | `docs/adr/122-*.md` Amendment 3 section |
| CLAUDE.md LOCKED #57 entry | ✅ | LOCKED #57 |

---

## E. Lessons (canonical for future helper line / audit-first ADRs)

- **L-127-α-1 — Audit-first canonical 패턴 정착 (3번째 success)**: ADR-125 (α-1 audit closure) → ADR-126 (α-2 pivot + β impl) → **ADR-127 (α-4 audit closure)** — 세션 단일 트리거 (ADR-123 Q2 default) 3 atomic ADR 3 audit-first finding 패턴 정착. 향후 모든 architectural ADR 의 β implementation 진입 시 audit 우선 강제 기본 default.
- **L-127-α-2 — Implicit optimization pattern 의 architectural value 재확인**: 5개월 누적 자산 (ADR-074 merged geometry, SnapVisual Canvas 2D, DimensionLabel Canvas 2D) 가 implicit optimization 으로 hotspot 가정 자연 무효화. 향후 N-drawcall 가정 ADR 작성 시 *반드시* implicit optimization audit 우선 강제.
- **L-127-α-3 — Canvas 2D overlay pattern canonical (helper line rendering)**: SnapVisual + DimensionLabel 의 Canvas 2D 위임 패턴이 helper line 의 *canonical architectural choice* — 3D LineSegments 사용 시점부터 review 필요. 향후 새 helper line 도입 시 본 pattern 우선 검토 권장.
- **L-127-α-4 — 부정 결정 lock-in 패턴 정착 (3번째 적용)**: ADR-076 §C-amendment-1 (legacy deletion 부정) → ADR-125 (α-1 pivot 부정) → ADR-127 (α-4 부정). 부정 결정 silent 회피 차단 + 명시 documented 패턴 일관 답습. 향후 누군가 ADR-122 α-4 implement 시도 시 본 ADR 즉시 발견 가능.
- **L-127-α-5 — Spec preservation + Amendment pattern 3번째 적용**: ADR-122 Amendment 1 (α-1) + Amendment 2 (α-2) + **Amendment 3 (α-4)** — 단일 spec 의 3 amendment 누적. supersede 회피 + current state correction. 향후 selection > 1000 instances 또는 multi-tool 동시 활성 trigger 시점에 α-4 implement 가능성 보존.
- **L-127-α-6 — α-3 / α-5 / α-6 묶음 자연 deprecation**: ADR-122 §2 hotspot A + C 가정 모두 무효 확인 → A + C 포함 묶음 (α-3, α-5) 자연 의미 감소. α-6 (spec only) 는 본 audit closure 가 그 역할 수행. ADR-122 family closure 자연 도달 (α-2 만 implement, 나머지 모두 audit closure 또는 자연 deprecation).
- **L-127-α-7 — 다음 priority 진입 자연 transition**: 본 ADR closure → ADR-122 family 자연 완성 → LOCKED #43 priority #4 (ADR-120 NURBS-aware coplanar) Q1 결재 가 next anchor. 세션 패턴: audit closure → 다음 priority natural transition.
