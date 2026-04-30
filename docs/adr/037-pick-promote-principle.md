# ADR-037: Pick → Promote 원칙 (Selection 의 의미 단위 강제)

**Status**: **Accepted** (2026-05-01) — LOCKED 정책 #15
**Initiative**: AxiA 3D selection / picking 아키텍처 SSOT
**Builds on**: ADR-014 메타-원칙 #13 (One Source, Two Views), ADR-028
(분석적 곡선), ADR-031 (분석적 곡면), ADR-032 (Promotion paths),
ADR-036 (STEP/IGES Promotion)

## Context

AnalyticCurve / AnalyticSurface 가 Phase A~E 로 도입되면서, **하나의 곡선
이 DCEL 에서 단일 EdgeId** 로 저장된다 (ADR-028). 사용자가 circle 한
점을 클릭하면 **circle 전체가 선택**되어야 함이 자연스러운 CAD 기대.

### 기술 현실

WebGL / Three.js 는 NURBS / Bezier curve 를 직접 렌더링할 수 없음 → 모든
곡선/곡면은 GPU 전송 시점에 polyline / triangle 로 tessellate 됨 (ADR-014
메타-원칙 #13 의 "Two Views"). 따라서:

- **저장 (truth)**: 1 EdgeId + AnalyticCurve
- **렌더 (view)**: N segments / triangles
- **raycast hit**: segment index / triangle index — **dirty**

### 위험: 사용자가 "조각조각" 인상을 받는 회귀

raycast 결과를 그대로 selection state 에 저장하면 사용자는 segment 별로
선택되는 것처럼 보임 — CAD 표준 동작 위배.

### 산업 표준 — Pick → Promote 2단계

모든 산업 CAD (SolidWorks / Fusion / CATIA / Rhino / OCCT) 는 동일 패턴:

```
[Ray hits something]
        ↓
hit primitive id (segment / triangle index)   ← dirty
        ↓
metadata lookup (faceMap / edgeMap)
        ↓
promote to semantic owner (EdgeId / FaceId / VertexId)   ← clean
        ↓
selection state ← clean ID 만 저장
```

## Decision

### P22 — 새 원칙: Pick → Promote 강제

> **모든 raycast 결과는 즉시 owner ID (EdgeId / FaceId / VertexId) 로
> promote 후 저장한다. segment / triangle index 를 selection state 에
> 저장 금지. highlight / hover / preview 모두 owner ID 기준으로 작동.**

### P22 세부 규칙

**P22.1 — Selection state schema 강제**

`SelectionManager.selectedFaces` / `selectedEdges` / `selectedVertices` 의
원소는 **항상 의미 ID** (Rust `FaceId` / `EdgeId` / `VertexId` 의 raw
representation `u32` 또는 wrapper 타입):

```typescript
// ✅ allowed
private selectedFaces: Set<FaceId>;
private selectedEdges: Set<EdgeId>;

// ❌ forbidden
private selectedFaces: Set<TriangleIndex>;
private selectedEdges: Set<SegmentIndex>;
```

**P22.2 — Tessellation 메타데이터 일관성**

각 tessellated geometry 에는 owner 매핑 metadata 가 부착됨:
- `Viewport.faceMap: Uint32Array` — `triangle index → FaceId`
- Tool context `edgeMap: Uint32Array` — `segment index → EdgeId`
- 길이 = geometry triangle / segment 수와 정확 일치
- 신규 도구 추가 시 hit data 사용 전 반드시 본 매핑 거치기

**P22.3 — 토폴로지 변경 후 rebuild 강제**

다음 연산 후 `faceMap` / `edgeMap` 재구축:
- `split_edge` / `merge_faces_by_edge`
- Boolean (Union / Subtract / Intersect)
- Push-Pull (CreateFace 모드 = topology change)
- Erase (cascade 포함)
- Draw (line / rect / circle / arc / Bezier / freehand)
- STEP/IGES import (Phase G Stage 4)

ADR-035 P20.7 의 STEP import 도 마찬가지 — 새 entity 들이 Mesh 에 추가
되면 metadata rebuild 필수.

**P22.4 — Highlight / hover / preview 도 owner ID 기준**

```typescript
// Selection 후 같은 EdgeId / FaceId 의 모든 drawable 동시 강조
for (const fid of selectedFaces) {
  highlightAllTrianglesWithFaceId(fid);
}
for (const eid of selectedEdges) {
  highlightAllSegmentsWithEdgeId(eid);
}
```

❌ 절대 금지:
- "hit 된 한 triangle 만 강조"
- "raycast 결과 segment 만 색칠"

**P22.5 — 분석적 곡선의 균일 promotion**

`Edge.curve = Some(AnalyticCurve)` 인 edge 는 단일 EdgeId 를 가지지만 N
segments 로 tessellate 됨. **모든 segment 가 동일 EdgeId 로 promote** 되
어야 함:

```typescript
// 회귀 invariant: circle 64-segment tessellation 의 모든 segment 는
// 같은 EdgeId 로 매핑됨
const edgeIds = new Set<number>();
for (let segIdx = 0; segIdx < 63; segIdx++) {
  edgeIds.add(edgeMap[segIdx]);
}
assert(edgeIds.size === 1);  // ← 균일 promotion
```

**P22.6 — Selection 의 "조각" 모드는 디버그 전용**

기본 동작은 항상 owner 단위:
- 선 클릭 → 전체 curve / edge 선택
- 면 클릭 → 전체 surface / face 선택

"facet 별 선택" / "tessellation debug" 같은 분할 모드는:
- **개발자 디버그 토글** (`__AXIA_DEBUG_FACET_SELECT = true`) 으로만 노출
- 사용자 UI 메뉴에는 노출 금지 (UX 악화 — 산업 CAD 도 같음)

### P22.7 — STEP / IGES import 통합 (ADR-036 cross-link)

Stage 4-A / 4-B 의 promote_curve / promote_surface 결과로 mesh 에 attach
된 분석적 entity 도 P22 적용 — import 직후 metadata rebuild 후 사용자
는 곡선 한 덩어리로 선택 가능.

## Implementation

### 현재 구현 검증 (이미 잠금 상태)

| 구성 | 위치 | 상태 |
|---|---|---|
| `Viewport.faceMap: Uint32Array` | `web/src/viewport/Viewport.ts:191` | ✅ 적용 |
| `ctx.edgeMap: Uint32Array` | tool context 주입 | ✅ 적용 |
| Face pick → promote | `SelectTool.ts:128-133` | ✅ `getFaceId(hit.faceIndex)` |
| Edge pick → promote | `SelectTool.ts:59-62` | ✅ `edgeMap[Math.floor(hit.index/2)]` |
| Selection state schema | `SelectionManager.selectedFaces/Edges` | ✅ Set\<id\> only |
| Highlight by owner ID | `SelectTool.ts:333-421` | ✅ `Set<FaceId>` / `Set<EdgeId>` 순회 |

### Invariant 회귀 테스트 (P22 영구 잠금용)

다음 3개 테스트가 **절대 깨지면 안 됨** (LOCKED #15 회귀 방지):

1. **`selection_promotes_curve_uniformly`** — 분석적 circle / arc 의 모든
   tessellated segment 가 동일 EdgeId 로 promote
2. **`selection_state_contains_owner_ids_not_indices`** — selection state
   의 원소는 valid EdgeId / FaceId 만 (raw triangle/segment index 거부)
3. **`metadata_rebuilt_after_topology_change`** — split_edge / Boolean /
   draw 후 faceMap / edgeMap stale 안 됨

### 신규 도구 추가 시 가드

새 도구 (Tool 클래스) 작성 시 직접 `hit.faceIndex` / `hit.index` 사용 전
반드시 promotion 거치기. 위반 시 ESLint custom rule 또는 PR review 단계
에서 차단.

## Risks & Mitigations

- **R1** — `faceMap` / `edgeMap` 메모리 사용 (mesh 크기 비례): 100k face
  mesh 에서 ~400KB. 무시 가능.
- **R2** — Topology 변경 후 rebuild 누락: P22.3 회귀 테스트로 차단.
- **R3** — Tessellation sample density 부족 → polyline 시각 인지: 별도
  렌더 품질 issue (P22 와 별개). adaptive sample 수 조정으로 해결.
- **R4** — 신규 도구가 promotion 우회: 회귀 테스트 + PR review 강제.

## Success Criteria

- ✅ ADR-037 의 P22 가 commit 으로 고정 (이 PR)
- ✅ CLAUDE.md LOCKED #15 추가
- ✅ 3 invariant 회귀 테스트 통과
- ⏳ 향후 모든 신규 도구 / Phase H+ 작업이 P22 를 위반하지 않는지
  지속 가드

## References

- ADR-014 메타-원칙 #13 (One Source, Two Views)
- ADR-028 (Analytic Edge Curve Foundation)
- ADR-031 (Analytic Surface Primitives)
- ADR-032 (Promotion paths)
- ADR-036 (STEP/IGES Curve & Surface Promotion)
- 산업 CAD 의 selection promote 패턴 (SolidWorks / Fusion / Rhino / OCCT
  ShapeAnalysis_Surface)

## 변경 이력

- **2026-05-01 (initial)**: P22 채택. Pick → Promote 강제 + 6 세부 규칙 +
  3 invariant 테스트 + STEP/IGES import 통합 (P22.7).
