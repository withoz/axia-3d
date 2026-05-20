# ADR-106: Split-Site Surface Owner-ID Propagation (ADR-093 D-β L9)

- **Status**: Accepted (R-α single-step closure, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: Bug review report 2026-05-19 시나리오 3 (HIGH). ADR-093
  D-β `face_to_surface_owner_id` map 의 *L9 inheritance promise* 가 6
  split sites + Path B annulus + cleanup 에서 미구현. ADR-094 default
  ON 후 사용자 가시 (Path B 측면 선택 N−1).
- **Parent**: ADR-093 (Surface owner-id grouping), ADR-094 (Path B-full)
- **Sibling**: ADR-089 A-χ-β (surface inheritance pattern — owner_id
  로 mirror)

---

## A. Problem Statement

ADR-093 D-β 가 `Mesh.face_to_surface_owner_id: FxHashMap<FaceId, u32>`
도입 시 *Invariants 명시*:

```rust
/// Invariants:
/// - Set only by `set_face_surface_owner_id` (allocation site:
///   `extrude_planar_cylinder` post N-side creation, or future
///   primitive constructors)
/// - Inherited by `face_split_*` (LOCKED #35 L9 cross-cut, future
///   sub-step or ADR-093 amendment)              ← MISSING
/// - Cleared on `remove_face` (face deactivation) ← MISSING
```

**L9 inheritance + cleanup 약속 모두 미구현**. Bug report 2026-05-19
시나리오 3 이 6 split sites + Path B annulus + remove_face 모두 audit
완료.

**사용자 영향** (ADR-094 default ON 후 가시화):
- Path A 실린더 측면 quad 자르기 → sub-faces 가 owner_id 없음 →
  `walk_face_owner_siblings` 가 split 자리에 [fid] 만 반환 →
  **측면 그룹 클릭 시 N−1 face 만 잡힘**.
- Path B annulus → Path A 의 owner_id 부여 (line 534-537) 와 비대칭 →
  single-face annulus 도 selection 그룹 ID 부재 (future face_split_*
  propagation 의 시작점 없음).
- `remove_face` map cleanup 누락 → stale entries 누적 (메타-원칙 #12
  Memory Budget Per Entity 잠재 위반).

---

## B. Lock-ins

### R-A — 6 split sites 모두 동일 패턴 (capture + propagate)
ADR-089 A-χ-β 의 `parent_surface` capture/propagate 패턴을 owner_id
에도 1:1 mirror. 동일 site 에 1-2 line 추가:

```rust
let parent_owner_id = mesh.face_surface_owner_id(face_id);
// ... soft_remove / remove_face / add_face_with_holes ...
if let Some(owner) = parent_owner_id {
    mesh.set_face_surface_owner_id(new_face, Some(owner));
}
```

**6 sites**:
1. `face_split.rs::split_face_by_chain` — 2 sub-faces (fa, fb)
2. `face_split.rs::split_face_case_b` — 2 sub-faces (face_1, face_2)
3. `face_split.rs::split_face_case_c` — 1 new_face
4. `face_split.rs::split_face_case_d` — 1 new_face
5. `mesh.rs::split_face` — face_id keeps slot, face_b new
6. `boolean.rs::split_faces_by_intersections` — N sub-faces

### R-B — Path B annulus owner_id 부여 (Path A 대칭)
`extrude_cylinder_kernel_native` 의 annulus face 에
`next_surface_owner_id()` allocation. Single-face group 이지만 walk
semantics 일관성 + future face_split_* 시작점 보장.

### R-C — `remove_face` / `soft_remove_face` 모두 map cleanup
두 함수 모두 `self.faces.remove(face_id)` 후
`self.face_to_surface_owner_id.remove(&face_id)` 추가. ADR-093 D-β
*"Cleared on remove_face"* 약속 실현.

### R-D — Engine 외부 변경 0
WASM bridge / TS / Playwright 변경 없음. 본 fix 는 *engine 내부 약속
실현*. 사용자 facing 효과 (Path B 측면 그룹 selection N face 모두 선택)
는 자동.

### R-E — 회귀 자산 3건 (절대 #[ignore] 금지)
- `adr106_split_face_propagates_surface_owner_id_to_face_b` —
  `mesh.split_face` 후 parent + face_b 모두 같은 owner + walk 정합
- `adr106_path_b_annulus_face_has_owner_id` — Path B
  `extrude_cylinder_kernel_native` 결과 annulus face 가 owner_id
  보유 + walk = self
- `adr106_remove_face_cleans_surface_owner_id_map` — remove_face 후
  map entry 정리됨

face_split.rs 4 site (split_face_by_chain / case_b/c/d) 는 ADR-089
A-χ-β surface 회귀 자산 (mesh.rs:11515~)과 동일 패턴이므로 별도 회귀
없이 1:1 mirror 신뢰. boolean.rs site 도 동일 패턴.

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| 6 split sites | `parent_owner_id` capture + sub-faces 에 propagate (1-2 line each) |
| Path B annulus | `next_surface_owner_id()` allocation + `set_face_surface_owner_id` 호출 |
| `remove_face` cleanup | `face_to_surface_owner_id.remove(&face_id)` 추가 |
| `soft_remove_face` cleanup | 동일 |
| 회귀 | axia-geo 1259 → **1262 PASS** (+3), 절대 #[ignore] 금지 3/3 |
| CI | Build AXiA 3D / CI (Web E2E) / MCP Server 모두 green 유지 |

---

## D. Acceptance Log

### R-α (본 commit) — Engine fix + 3 회귀 + ADR

- **commit**: 본 commit
- **변경 (5 파일)**:
  - `crates/axia-geo/src/operations/face_split.rs` (4 sites: chain +
    case_b/c/d) — parent_owner_id capture + propagate
  - `crates/axia-geo/src/mesh.rs` (`split_face`) — face_b 에 propagate
    + `remove_face` cleanup
  - `crates/axia-geo/src/operations/create_solid.rs` (`extrude_cylinder_
    kernel_native`) — Path B annulus owner_id allocation
  - `crates/axia-geo/src/operations/offset.rs` (`soft_remove_face`) —
    map cleanup
  - `crates/axia-geo/src/operations/boolean.rs`
    (`split_faces_by_intersections`) — N sub-faces 에 propagate
- **신규 회귀 자산 (3 in `create_solid.rs::tests`)**:
  - `adr106_split_face_propagates_surface_owner_id_to_face_b`
  - `adr106_path_b_annulus_face_has_owner_id`
  - `adr106_remove_face_cleans_surface_owner_id_map`
- **회귀**: axia-geo lib **1262 PASS** (이전 1259, +3), 0 failed, 0 ignored
- **사용자 facing**: Path A cylinder 측면 quad 자르기 → 측면 그룹
  selection 이 N face 모두 잡힘 (이전 N−1). Path B annulus + future
  face split 도 same. Memory: cylinder-heavy scene 의 stale
  `face_to_surface_owner_id` entries 누적 차단.

---

## E. Lessons

1. **약속된 invariant 의 추적 가능성** — ADR-093 D-β 의 `Invariants:`
   doc comment 에 *"Inherited by face_split_* / Cleared on remove_face"*
   가 명시됐으나 구현 누락. 향후 invariant 문서화 시 *"구현 검증
   회귀"* 동시 commit 강제 검토 (메타-원칙 #9 회귀 없음 + memory-of-
   promise 강화).
2. **default flip 의 side effect 가시화** — ADR-094 default ON (2026-05-09)
   후 Path A 가 사용자 facing 우선 (Path B 측면 quad 가 user click
   target). 본 fix 가 *Path A* 경로의 ADR-093 L9 약속 실현 — Path B
   default flip 이 *Path A 결함의 사용자 가시 증가* 라는 자연 인과.
   ADR-094 LOCKED #35 amendment (ADR-104 사후 등재) 의 side effect
   inventory 확장 candidate.
3. **회귀 자산의 균형** — 3 core sites (mesh.split_face / Path B
   annulus / remove_face) 만 직접 회귀. 4 face_split.rs sites +
   boolean.rs site 는 ADR-089 A-χ-β surface 회귀와 *동일 패턴 1:1
   mirror* — 추가 회귀 없이 패턴 신뢰. 향후 sites drift 위험은 ADR-089
   회귀가 surface 가 깨지는 즉시 fail 하여 보조.

---

## F. Cross-link

- ADR-093 D-β (Surface owner-id grouping — 본 ADR 의 약속 source)
- ADR-094 (Path B-full + default ON — 사용자 가시화 trigger)
- ADR-089 A-χ-β (surface inheritance pattern — 본 fix 의 mirror source)
- LOCKED #35 ADR-094 amendment (side effect inventory)
- 메타-원칙 #4 (SSOT — owner_id 약속 vs 구현 일치), #9 (회귀 없음),
  #12 (Memory Budget Per Entity — cleanup invariant)
- Bug review report 2026-05-19 시나리오 3 (HIGH)
