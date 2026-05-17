# ADR-108 — RECT/Line Layer H Policy (Layer Separation Sibling)

| Field | Value |
|---|---|
| Status | **Draft (spec only — 사용자 결재 2026-05-16)** |
| Date | 2026-05-16 |
| Supersedes | — |
| Related | ADR-107 (`*AsShape` → Path B Canonical Unification — Circle 영역), ADR-019 (Line is Truth), ADR-027/028 (NURBS Kernel + Edge curve attach), ADR-049/050 (Two-Layer Citizenship Shape/Xia) |
| Cross-cut | 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다"), 메타-원칙 #15 ("동일 분할 = 동일 topological contract") |

## 1. Anchor (결함 G full coverage)

ADR-107 이 **Circle Layer H** (drawCircleAsShape: 32 polygon edges + Arc curve attach per segment) → Path B 통합으로 closure 했다. 그러나 **결함 G 의 RECT/Line 영역** 은 아직:

- `drawRectAsShape` — 4 LINE edges, 각 edge 에 `AnalyticCurve::Line` attach (curveKind=1)
- `drawLineAsShape` — 1 LINE edge, `AnalyticCurve::Line` attach (curveKind=1)

둘 다 **Layer H (Hybrid)** — DCEL polygon (mesh truth) + AnalyticCurve attach (analytic truth) 동시. ADR-107 결함 G 의 RECT/Line sibling.

## 2. 발견 (audit evidence)

ADR-107 ζ-α audit (2026-05-16) 의 §2.2 매트릭스:

| Case | curveKind | Layer | 정합 (ADR-107) |
|---|---|---|---|
| RECT (drawRectAsShape) | 1 (Line) × 4 | **Layer H** | 🚨 미해결 |
| Circle Path B (drawCircleAsCurve) | 2 (Circle) × 1 | Layer B canonical | ✅ ADR-107 |
| Circle Path A (drawCircleAsShape) | 3 (Arc) × N | Layer H → Path B (ADR-107 ζ-β) | ✅ ADR-107 |
| Line (drawLineAsShape) | 1 (Line) × 1 | **Layer H** | 🚨 미해결 |

→ **ADR-107 §4 L4 명시**: "RECT 는 본 ADR scope 외. RECT 의 4 LINE edges 는 본질적으로 polygonal (자연 Layer A 후보, 또는 Line curve attach 의 Layer H 정책 별도). RECT 의 layer 분리는 별도 ADR." → 본 ADR-108.

## 3. 현재 구현 한계 (architectural)

### 3.1 RECT 의 Layer H ambiguity (덜 심각)

Circle 의 Layer H 와 다르게, RECT 의 Layer H 는 ambiguity 가 **상대적으로 낮음**:

| 측면 | Circle Layer H (ADR-107) | RECT/Line Layer H (본 ADR) |
|---|---|---|
| Render path 분기 | Arc fast-path (mesh.rs:5408-5447) vs polygon chord — 모호 | **Line curve = straight line, polygon edge = straight line — 시각 동일** |
| Engine ops truth | Arc curve metadata vs N polygon segments — 정확도 차이 | **Line curve = identical 2-vert line — 정확도 동일** |
| 메모리 효율 | Path B = 97% 절감 (32 segs → 1 self-loop) | **RECT = 4 verts unchanged (이미 minimal). Line = 2 verts unchanged** |
| 결함 D 같은 trigger | vertex-on-corner degeneracy 발생 (ADR-101 §A9.8) | **straight Line — degeneracy 없음** |

→ **RECT/Line Layer H 는 시각 / engine / 메모리 측면 모두 ambiguity 없음**. ADR-107 의 Circle Layer H 와 다른 영역.

### 3.2 architectural 일관성 측면

그러나 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다") + 메타-원칙 #15 ("동일 분할 = 동일 topological contract") 의 layer separation 정합 시점에서는 여전히 결함 G 의 일부:

- ADR-107 closure 후 Circle = Layer B canonical
- RECT/Line = 여전히 Layer H (curve attach)
- 사용자 통찰 "메시 곡면과 기하 원의 곡면이 동시에 작용" 의 *모든* layer 통합 안 됨

## 4. Decision 후보 (L1~L3 분석)

본 ADR 은 **spec only** — 결정 후보 분석 + 사용자 결재 trigger. Implementation 은 별도 ADR.

### 4.1 L1 — Layer H 그대로 보존 (현상 유지)

**근거**:
- RECT/Line Layer H 의 ambiguity 가 시각/engine/메모리 측면에서 **거의 0** (§3.1)
- ADR-088 P22.5 owner-ID grouping 의 RECT/Line edges 활용 사례 (ADR-028 Line curve attach 기반)
- Layer H 가 향후 NURBS 확장 시 metadata 보존 측면에서 유리 (e.g., 분할/Offset 시 curve metadata 유지)

**Trade-off**:
- 메타-원칙 #14 deepest realization 의 *부분 미달* (Layer H 잔존)
- 사용자 통찰 "동시 작용" 의 RECT/Line 영역 미해소

### 4.2 L2 — RECT/Line → Layer A (Pure Mesh) 전환

**근거**:
- RECT/Line 은 본질적으로 polygonal (4/2 verts)
- Line curve attach 가 의미 없음 (2-vert line = straight, curve 형태 없음)
- Layer A (no curve metadata) 가 가장 단순 + canonical

**Trade-off**:
- ADR-088 P22.5 owner-ID grouping 의 RECT/Line edges 활용 사례 (curve attach 가 grouping prerequisite) 손상
- ADR-028 Phase A 의 "all draw operations attach analytic curve" 원칙과 충돌
- Render path 의 Line curve fast-path 우회 (현재는 단순 chord 라 영향 0)

### 4.3 L3 — RECT/Line Layer H 유지 + 명시 documentation

**근거**:
- L1 (현상 유지) + 명시 lock-in
- ADR-108 이 결함 G 의 RECT/Line 영역을 "intentional Layer H" 로 명시 → 향후 reader 가 confused 않음
- 메타-원칙 #14 의 deepest realization 은 Circle (ADR-107) 에 한정

**Trade-off**:
- 사용자 통찰 "동시 작용" 의 RECT/Line 영역 영구 미해소 (lock-in)

## 5. 사용자 결재 후보 (L1 / L2 / L3 — 추천: L3)

본 ADR 은 결정 명시 안 함 — 사용자 결재 후 별도 commit 으로 L1/L2/L3 lock-in. **추천 = L3** (현상 유지 + 명시 documentation):

- Trade-off 최소 (회귀 영향 0)
- 메타-원칙 #14 의 deepest realization 은 *Circle 영역에 한정*. RECT/Line 은 본질적 polygonal — 별도 정합
- ADR-028 Phase A canonical (모든 draw 가 curve attach) 보존
- ADR-088 P22.5 owner-ID grouping 의 RECT/Line edges 활용 보존

## 6. Path Z atomic plan (예상)

본 ADR 은 spec only — implementation 별도 sub-step 또는 별도 ADR.

| Step | Title | 회귀 | Risk |
|---|---|---|---|
| **σ-α** | Spec only (본 commit) | +0 | 0 |
| σ-β | 사용자 결재 L1/L2/L3 (별도 commit on this branch 또는 별도 PR) | +0 (L1/L3) 또는 +5~10 (L2 implementation) | L2 = 중간 risk |
| σ-γ | (L2 선택 시) RECT/Line → Layer A 전환 implementation | +5~10 (axia-core) | ADR-028 회귀 영향 |
| σ-δ | Closure — CLAUDE.md LOCKED #41 amendment 또는 LOCKED #44 신설 | 0 | 낮음 |

## 7. Out-of-scope (deferred)

- **Implementation 본체** — 본 ADR 은 spec only, L1/L2/L3 결재 후 별도 PR
- **ADR-107 ζ-ε snapshot legacy 호환** — Circle 영역만, RECT/Line 은 본 ADR scope 외
- **ADR-088 P22.5 owner-ID grouping 의미 변경** — Layer 정책과 별개 영역
- **Bezier closed-curve / NURBS closed-curve `*AsShape` 통합** — 해당 도구 미존재, scope 외
- **Path B style RECT (4-edge canonical with rectangle metadata)** — RECT 는 본질적으로 4-vert/4-edge, "Path B" 개념 불일치. 별도 ADR 가능 (가칭 ADR-109 "Rectangle as Analytic Primitive")

## 8. 회귀 영향 예측 (L1/L2/L3 별)

| 옵션 | 회귀 영향 | 사용자 facing |
|---|---|---|
| **L1 — Layer H 보존** | 0 | 0 (변화 없음) |
| **L2 — Layer A 전환** | +5~10 (ADR-028 회귀 영향) | curve metadata 손실 (Offset/split 시 정확도 동일 — 영향 0) |
| **L3 — 현상 유지 + documentation** | 0 | 0 (변화 없음) + 향후 reader confusion 차단 |

→ **L3 = 권장** (회귀 영향 0 + canonical documentation).

## 9. Acceptance criteria (σ-α 시점)

본 commit (σ-α) 가 만족해야:
- ✅ `docs/adr/108-rect-line-layer-h-policy.md` 신설 (본 파일)
- ✅ §1 Anchor (결함 G full coverage) / §2 audit evidence / §3 현재 한계 / §4 L1/L2/L3 분석 / §5 사용자 결재 후보 / §6 Path Z atomic plan / §7 Out-of-scope / §8 회귀 영향 / §9 Acceptance criteria 명시
- ✅ ADR-107 sibling 명시 (결함 G full coverage)
- ✅ ADR-019/027/028/049/050/088 cross-link
- ✅ 메타-원칙 #14 / #15 명시
- ✅ Code 변경 0 — spec only

## 10. Cross-link

- **ADR-107** (`*AsShape` → Path B Canonical Unification — Circle 영역) — sibling. 본 ADR 이 RECT/Line 영역.
- **ADR-019** (Line is Truth, Face is Byproduct) — Line curve attach 의 ancestor (ADR-028 Phase A 의 prerequisite)
- **ADR-027** (NURBS Kernel Initiative)
- **ADR-028 Phase A** (Edge.curve = Option<AnalyticCurve>) — Line curve attach 의 base
- **ADR-049/050** (Two-Layer Citizenship Shape/Xia) — 시민권 layer 와 본 ADR 의 geometric layer 직교
- **ADR-088 Phase 1** (curve_owner_id grouping) — RECT/Line curve attach 가 prerequisite
- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") — Circle 영역만 deepest realization (ADR-107)
- **메타-원칙 #15** ("동일 분할 = 동일 topological contract") — Layer 일관성 확장
- **결함 G** (사용자 통찰 2026-05-16 "메시 곡면과 기하 원의 곡면이 동시에 작용") — Circle (ADR-107 closure) + RECT/Line (본 ADR 의 trigger)

---

*ADR-108 σ-α — RECT/Line Layer H Policy 의 architectural spec. ADR-107 sibling
으로 결함 G full coverage. spec only — 사용자 결재 (L1/L2/L3) 후 별도
implementation PR.*
