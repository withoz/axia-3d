# ADR-137 — Guidance-only Snap (α spec)

**Status**: Draft (α spec only — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-18
**Author**: WYKO (사용자 결재) + Claude

## Canonical anchor (사용자 결재, 2026-05-18)

> "스냅은 그리기에 대한 안내이어야 합니다"
> "z=0 완성후 스냅기능을 새로 정립합니다"

LOCKED #63 (z=0 invariant closure) 의 자연 follow-up. PR #101 에서 snap
시스템 전체 비활성 — 본 ADR 은 **새로운 정립** 의 architectural anchor.

이전 snap system 의 결함:
- **Commit 위치를 snap target 으로 자동 이동** → 사용자 click 의도와 결과 mismatch
- RECT corner 가 다른 vertex 로 자동 자석 → "별 모양 self-intersecting" 결함
- recursive use WASM errors (snapVisual.clear race condition)

본 ADR 의 새 원칙: **Snap = visual guidance only. Commit = raw mouse.**

## 1. Problem statement

기존 snap 시스템 (이전 SnapManager / SnapVisual) 의 architectural deficiency:

| 측면 | 이전 동작 | 결함 |
|---|---|---|
| Snap detection | vertex/midpoint/endpoint/intersection/axis 등 candidate 인식 | OK |
| Visual rendering | candidate 시각 marker | OK |
| **Commit influence** | snap 결과의 *world position* 을 click 결과로 자동 사용 | **사용자 의도와 mismatch** |
| Cardinal preservation | snap target 의 z 좌표 그대로 사용 | z drift 전파 (RECT corner 다른 face z) |
| Performance | snapVisual.clear 매 mousemove + WASM race | recursive use errors |

사용자 결재 "스냅은 그리기에 대한 안내이어야 합니다" 의 정확한 의미:
- Snap 의 **visual marker / inference line** 은 보여야 함 (사용자 정렬 guide)
- 사용자가 marker 보고 *visual 로 정확히* click 하면 그 위치 commit
- Commit 위치는 **사용자 click 의 raw mouse 위치** (snap 으로 자동 이동 X)

## 2. Architectural anchor

### Three-layer separation (canonical)

| Layer | 역할 | Output |
|---|---|---|
| **Detection** | snap candidate 찾기 (vertex/midpoint/endpoint/intersection/axis 등) | `SnapCandidate[]` (typed list) |
| **Rendering** | candidate 시각 marker (점 / 가이드 line / 색상 hint) | viewport overlay (DOM 또는 Three.js) |
| **Commit** | **사용자 click 위치 = raw 3D point** (cardinal force 후) | `THREE.Vector3` (cardinal axis = 0) |

**Critical invariant**: Detection + Rendering 결과는 Commit 에 **영향 없음**.
사용자 click 의 raw mouse → cardinal force → 그대로 commit.

### 사용자 explicit override (별도 gesture)

사용자가 *명시적* 으로 snap target 에 commit 하길 원할 때:

| Gesture | 동작 | 비고 |
|---|---|---|
| **Tab** | tentative snap — 다음 candidate 순환 | 명시적 selection |
| **K** | inference lock — snap 결과 위치 *명시적* commit | LOCKED #1 P28 ADR-047 답습 |
| **Visual click on marker** | snap marker 위에 정확히 click → 그 위치 commit | natural (raw mouse 결과) |

이 모든 explicit gesture 도 cardinal force 적용. snap target z 가 다른
값이어도 cardinal axis = 0 으로 강제.

## 3. β implementation Path (3 option)

### Path A — Visual only (가장 단순, 권장)

- Snap detection + rendering 만 활성
- Commit = raw mouse (snap 결과 무시)
- 사용자가 visual marker 따라 click → 자연 정렬
- Tab / K override 별도 ADR (Phase 2)

**Trade-off**: precision 정렬 어려움 (사용자 시각 precision 의존)

### Path B — Click-to-snap explicit gesture

- Snap candidate 위 click 시 *그 marker 위치 commit*
- Marker 외 click 은 raw mouse
- "snap proximity threshold" (e.g., 8px) — marker 근처 click 자동 snap

**Trade-off**: threshold 결정 (자동 snap 의 자석 효과 부분 부활)

### Path C — Hybrid (Path A + Path B)

- Default: Path A (visual only)
- 사용자 설정 토글 (settings panel): "근접 snap commit" on/off
- On 일 때 Path B 동작 (threshold 정책 추가)

**Trade-off**: UI complexity, 정책 분기

### 추천

**Path A**: 사용자 결재 "안내" 정확 정합. 가장 단순. 사용자 시각 precision 의존도 trade-off 는 *VCB (값 입력)* + *cardinal snap SSOT* 로 보완.

## 4. Lock-ins (β implementation 진행 시)

- **L-137-1** Snap detection / rendering / commit 의 3-layer 분리
- **L-137-2** Commit invariant — *항상* raw 3D point + cardinal axis force
  (LOCKED #63 strict 정합)
- **L-137-3** Visual marker = guidance only (자동 commit 영향 0)
- **L-137-4** Cardinal preservation — snap target z 가 다르더라도 commit
  시 cardinal axis = 0 force
- **L-137-5** SnapManager / SnapVisual class 재활성 (PR #101 에서 보존)
  — 단 commit path 만 우회
- **L-137-6** ToolManager.getSnappedPoint method = visual update + raw
  passthrough (현재 raw passthrough 유지 + visual rendering 추가)
- **L-137-7** Tab / K override 별도 Phase 2 ADR (본 ADR 은 Path A 만)
- **L-137-8** Settings panel 토글 부재 (Path A 만 — 단일 default)
- **L-137-9** 회귀 자산 — z=0 invariant 보존 + visual marker 시각 baseline
- **L-137-10** ADR-046 P31 #4 additive only — Snap detection / rendering
  API 추가만, commit path UNCHANGED

## 5. Out of scope (deferred to separate ADRs)

- Tab tentative snap 순환 (Phase 2)
- K inference lock (LOCKED #1 P28 ADR-047 reactivation, Phase 2)
- Settings panel snap toggle (Path B / C reactivation, Phase 3)
- Snap candidate priorities (axis / endpoint / midpoint 우선순위 정책,
  Phase 2)
- Snap chain self-touch prevention (LOCKED #1 P28 ADR-047 — 이미 정책
  존재, 재활성 시 답습)
- Hover preselect snap integration (LOCKED #17 ADR-039 P24 — 별도)

## 6. UX 매트릭스 (β implementation 시)

| 시나리오 | 동작 | 결과 |
|---|---|---|
| Mouse hover near vertex (within 12px) | vertex marker 표시 (작은 점) | visual hint |
| Mouse hover on edge | edge highlight (가는 line) | visual hint |
| Mouse hover near axis from reference point | axis guide line | visual hint |
| Click anywhere | raw mouse cardinal force commit | snap 영향 0 |
| Click *exactly* on snap marker | raw mouse = marker 위치 (자연 정렬) | precision-first |
| Click near (within 8px) but not on marker | raw mouse (marker 위치 아님) | sketch precision |

## 7. Cross-link

- LOCKED #1 ADR-021 P7 (closed edge divides face)
- LOCKED #1 P28 ADR-047 (Snap chain self-touch prevention — 재활성 시 답습)
- LOCKED #7 ADR-026 P12 (cardinal snap SSOT defense layer 2)
- LOCKED #17 ADR-039 P24 (Hover preselect owner-ID — snap 과 직교)
- LOCKED #44 (Complete Meaning per Merge — α/β atomic separation)
- LOCKED #63 (z=0 invariant closure — 본 ADR 의 직접 anchor)
- 메타-원칙 #5 (사용자 편의 최우선 — visual hint vs auto-commit 분리)
- 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다 — snap 결과 cardinal 정합)
- ADR-087 K-ζ canonical (사용자 시연 게이트 → 본 ADR trigger)
- **ADR-136 α spec** (Face Split Downstream Sync Coherence — orthogonal)

## 8. Acceptance Log (α spec)

- **2026-05-18**: α spec 작성 (PR #101 closure 직후 follow-up)
  - Trigger: LOCKED #63 z=0 invariant closure + 사용자 결재 "z=0 완성후
    스냅 새로 정립"
  - Path A (Visual only) 권장
  - β implementation 별도 사용자 결재 + atomic PR
- **(β implementation): TBD** — 사용자 결재 후 별도 PR

## 9. β implementation 결재 trigger (사용자 결재 시 진행)

- Path A/B/C 결정
- Snap detection 의 candidate kinds (vertex / midpoint / endpoint /
  intersection / on-edge / axis / extension / parallel / perpendicular 등)
- Rendering layer 선택 (DOM overlay vs Three.js scene marker)
- 회귀 자산 — visual baseline (ADR-077 V-2 인프라 답습)
- Latency budget (메타-원칙 #11 — 16ms hover budget 안에 detection +
  rendering)

---

**다음 trigger** (사용자 결재 시):
- β implementation Path 결정 (A/B/C)
- Detection candidate kinds enumeration
- Visual baseline 생성 (snap marker 색상 / 크기 / 위치)
- Real Chromium E2E spec (visual marker 표시 + click commit invariant)
