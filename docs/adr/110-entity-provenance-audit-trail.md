# ADR-110: Entity Provenance / Audit Trail (I2 — Phase 1 Tier 1)

- **Status**: P-α Draft (spec only, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: ADR-107 §C Tier 1 — *I2 Provenance / audit trail*. Tier
  1 batch 의 세 번째 ADR — *"더 많은 정보"* 축의 첫 번째 architectural
  결정.
- **Parent**: ADR-107 (DCEL Extension Survey)
- **Sibling**: ADR-108 (S1 BVH), ADR-109 (S3 fine-grained dirty) —
  Tier 1 batch
- **Successor (planned)**: 본 ADR 의 P-β/P-γ/P-δ sub-steps —
  multi-week atomic.

---

## A. Problem Statement

axia-engine 은 *operation log* 를 보존 (TransactionManager) 하지만
*entity 와 link* 는 부재:

| 현재 layer | 보존 정보 |
|-----------|---------|
| TransactionManager | Command sequence (insertSnapshot / replaceLast / replaceLastAfterSnapshot) — undo/redo 가능 |
| OperationLog (web/src/core) | 사용자 op log (cap 50, ring buffer) — UI 재실행 용 |
| AxiaEngine 의 audit trail (ADR-041 MCP) | MCP capability 호출 audit (file logging) |
| **Edge / Face / Vertex 의 creating Command** | **❌ 없음** — entity 가 *어떤 op 로 생성/수정* 됐는지 추적 불가 |

**증상 시나리오** (디버깅 + AI agent 의도 분석):

1. **"이 face 는 어떤 Command 가 만들었나?"** — Boolean / Push-Pull /
   Draw 등 어디 origin 인지 알 수 없음. 사용자 보고 "이 face 가
   이상한데" 시 origin trace 불가
2. **AI agent (MCP) 의도 분석** — agent 가 draw_rect → push_pull →
   boolean_subtract 호출 시퀀스. Resulting face 가 어떤 의도로 생성
   되었나 추적 → debug + provenance audit
3. **시민권 transition 추적** — ADR-049 Shape → Xia promote 시 entity
   가 어떤 promote_shape_to_xia Command 로 transition 됐나 추적
4. **회귀 분석** — bug report 분석 시 "이 invariant violation 의
   origin op 가 뭔가" 즉시 답 가능

---

## B. Lock-ins

### P-A — Per-entity Option<CommandId> field (Mesh-level Map 패턴)
ADR-091 §E L1 정합 — bincode struct field 추가 *대신* Mesh-level
HashMap:

```rust
pub struct Mesh {
    // ...existing fields...
    #[serde(default)]
    pub entity_provenance_faces: FxHashMap<FaceId, CommandId>,
    #[serde(default)]
    pub entity_provenance_edges: FxHashMap<EdgeId, CommandId>,
    #[serde(default)]
    pub entity_provenance_verts: FxHashMap<VertId, CommandId>,
}
```

- `CommandId` = monotonic u64 (TransactionManager 에서 allocation,
  TransactionManager 가 single SSOT)
- Face / Edge / Vertex struct UNCHANGED (bincode 호환)
- 옵션 (`Option<CommandId>` 가 아니라 map 부재 시 = None) → 메모리
  효율 (entity 1당 8 bytes vs map entry)

### P-B — Current vs. Anonymous distinction
- TransactionManager 의 *현재 active Command* 가 있으면 entity 생성/
  mutation 시 자동 stamp
- TransactionManager 외부 호출 (e.g. test fixture 직접 mesh API) 는
  *anonymous* — provenance 미기록 (map 에 entry 없음)
- → 자연스럽게 *production op* 만 audit, *internal scaffolding* 은
  noise free

### P-C — Allocation strategy: stamp on creation
- `add_face` / `add_face_with_holes` / `add_face_closed_curve` 시
  현재 active Command 가 있으면 stamp
- 6 split sites (face_split.rs, ADR-106 R-α 패턴) 시 *parent 의
  provenance* inherit (split 은 *재구성*, origin Command 는 split 을
  triggered Command — parent inheritance 가 자연)
- `split_face` (face_id 슬롯 유지) 는 stamp 변경 안 함 (face_b 만
  parent inherit)
- mutation (translate_verts / rotate_verts / scale_verts / set_face_
  surface 등) 은 *기존 stamp 보존* — provenance 가 *origin* 의미.
  *last modifier* 는 별도 트랙 (P-δ 또는 별도 ADR)

### P-D — API surface
```rust
impl Mesh {
    pub fn face_provenance(&self, face_id: FaceId) -> Option<CommandId>;
    pub fn edge_provenance(&self, edge_id: EdgeId) -> Option<CommandId>;
    pub fn vert_provenance(&self, vert_id: VertId) -> Option<CommandId>;
    pub fn faces_by_command(&self, command_id: CommandId) -> Vec<FaceId>;
    pub fn set_face_provenance(&mut self, face_id: FaceId, cmd: CommandId);
    // ... edge / vert ditto
}
```

### P-E — TransactionManager integration
- `Scene::execute(cmd)` 가 *current CommandId* 를 `Mesh.current_command_id:
  Option<CommandId>` 에 임시 stamp → mutation sites 가 그 값 read
- Command 완료 시 `current_command_id = None`
- nested Command 는 outer Command id 유지 (depth-1 only — 첫 outer 가
  origin)

### P-F — Cleanup on remove
- `remove_face` / `soft_remove_face` / `remove_edge_and_halfedges`
  시 provenance map entry 도 정리 (ADR-106 R-α 패턴 답습)

### P-G — Undo/redo semantics
- Snapshot-based undo: Mesh 전체 snapshot 복원 → provenance map 도
  자동 복원
- replaceLast / replaceLastAfterSnapshot: provenance 도 일관

### P-H — Future cross-cut: AI agent 의도 분석
- MCP capability dispatch (ADR-041) 가 *각 capability 의 CommandId
  range* 를 audit log 에 기록 → resulting entities 의 provenance 와
  cross-reference 가능
- Inspector UI 가 face hover 시 "이 face 는 Command #42 (draw_rect)
  가 생성, sub-modify by Command #43 (push_pull)" 표시 (P-δ 또는
  ADR-111 amendment)

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| Mesh-level maps 3개 | `entity_provenance_faces` / `entity_provenance_edges` / `entity_provenance_verts: FxHashMap<...>` |
| CommandId type | `u64` (monotonic, TransactionManager SSOT) |
| API | face/edge/vert_provenance + faces_by_command + setters |
| TransactionManager integration | `current_command_id: Option<CommandId>` + stamp on Command boundary |
| Mutation hook | add_face / split sites 가 current_command_id read + stamp |
| Cleanup hook | remove_face 가 map entry 정리 |
| Undo/redo | snapshot 복원 시 provenance map 정합 |
| Backward compat | serde default empty map → 기존 .axia 파일 호환 |
| 회귀 자산 | P-β +5 (stamp / inherit / cleanup / Command boundary / undo), P-γ +3 (TransactionManager integration), P-δ +3 (Inspector UI display) |

---

## D. Acceptance Log

### P-α (본 commit) — Spec only

- **commit**: 본 commit (`docs/adr/110-entity-provenance-audit-trail.md`)
- **변경**: ADR draft 1 file
- **회귀**: 0 (spec only)
- **코드 변경**: 0
- **다음**: P-β (Mesh field + API + stamp hook) — 사용자 결재 후 진행.

### P-β ~ P-δ (planned)

| Sub | 목표 | 예상 회귀 |
|-----|------|----------|
| P-β | Mesh-level field + API + Command boundary stamp (engine only) | +5 |
| P-γ | TransactionManager integration + Scene::execute stamp | +3 |
| P-δ | Inspector UI provenance display (optional, gated by user 결재) | +3 |

**예상 누적**: docs +1 + axia-geo / axia-core +8 + web +3,
multi-week atomic.

---

## E. Cross-cut

### ADR-108 (S1 BVH) 와 직교
BVH 는 spatial index, provenance 는 metadata. Independent.

### ADR-109 (S3 fine-grained dirty) 와 직교
Dirty regions 는 cache invalidation, provenance 는 origin tracking.
Independent.

### ADR-041 (MCP capability surface)
MCP dispatcher 가 *Command 단위 CommandId* allocation → MCP capability
호출 시 자동 provenance stamp. AI agent 의도 분석 자연 가능.

### ADR-049 (Three-Layer Citizenship)
Shape → Xia / Xia → Shape transition Command 의 provenance → entity
transition 추적.

### Phase 2 Tier 2 (I4 Mesh-level invariant flags)
`is_watertight()` 등의 derived state 가 provenance 와 결합 — "이
violation 의 origin Command 가 뭔가" trace.

---

## F. Lessons (preliminary — P-δ closure 시 보완)

1. **Mesh-level Map 의 *세 번째* canonical 적용** — ADR-091 §E L1
   pattern 이 ADR-093 (surface_owner_id) / ADR-094 (boundary_loops) /
   본 ADR (provenance) 모두 정합. *struct field 추가 금지* 의 자연
   기준점.
2. **Monotonic CommandId 의 timeless invariant** — SlotStorage 의
   monotonic id 패턴 답습. Command 가 undo 돼도 id 는 재사용 안 함
   (provenance 가 stable reference).
3. **AI agent 시대의 audit trail 가치** — MCP capability 의 P3 페르
   소나가 *intent declaration* (capability 호출) 을 *entity 생성*
   과 link 시키는 architectural anchor.

---

## G. Cross-link

- ADR-107 §C Tier 1 (I2 provenance — 본 ADR 의 source roadmap)
- ADR-108 (BVH 와 직교), ADR-109 (dirty regions 와 직교)
- ADR-091 §E L1 (Mesh-level Map canonical — 세 번째 적용)
- ADR-093 (surface_owner_id Mesh-level map — 동일 패턴)
- ADR-041 (MCP capability surface — provenance source)
- ADR-049 / ADR-050 (Three-Layer Citizenship — transition provenance)
- 메타-원칙 #4 (SSOT — TransactionManager CommandId 단일 source)
