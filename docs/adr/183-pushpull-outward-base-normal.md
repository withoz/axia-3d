# ADR-183 — Push/Pull (Extrude) Outward Base Cap Normal

**Status**: Accepted (demo-verified 2026-06-01 — push-pull box: 0 inward + 그릴
수 있음, create_box 와 동등)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 보고 (2026-06-01):
> "이 두면에만 그리지 못합니다. 이것은 다른문제 인것 같아요. 면이 잘못된것인지?"
> (후속) "rect를 그리고 푸시풀로 만든 박스임"
**Direct precursors**: ADR-079 (Create Solid), ADR-007 (winding invariant),
ADR-018 (two-tone render), ADR-087 K-ε (Plane polygon render path).

---

## 1. Problem statement

`rect → Push/Pull(extrude)` 로 만든 박스의 일부 면이 BackSide(파랑 #9898b4)로
렌더되고, 그 면에 다시 그릴 수 없었다. 사용자는 "면이 잘못됨"을 의심.

진단 (엔진 자체 `verify_outward_normals`):

| | inward 면 | isFaceInVolume true | 상태 |
|---|---|---|---|
| **create_box** (BoxTool) | **0** | 6/6 | ✅ 정상 |
| **push-pull box** (extrude) | **1 (bottom)** | 1/6 (top 만) | ❌ |

push-pull 박스의 **bottom cap normal 이 INWARD(안쪽)**. 닫힌 manifold solid
(volume>0, non-manifold edge 0) 이지만 base 면만 안쪽을 향함.

원인 (`extrude_planar_box`, `crates/axia-geo/src/operations/create_solid.rs`):
- `profile_face`(사용자가 그린 rect)는 그릴 때의 normal(`+profile_normal`)을 유지.
- `dist > 0` 으로 위로 extrude 하면 profile 이 *바닥*이 되어 outward 는
  `-profile_normal` 이어야 함.
- 함수는 top/side 만 새로 만들고 **profile_face 를 그대로 bottom 으로 두어
  winding 을 안 뒤집음** (line 393 `all_solid_faces.push(profile_face)`).

→ bottom normal inward → 카메라가 BackSide(파랑) 봄 + FrontSide raycast 가
inward 면을 건너뜀 → "면 위에 못 그림". ADR-007 hint-기반 `verify_invariants`
는 통과(surface_normal hint 보존)라 안 잡혔고, 기하 outward 검사로 잡힘.

---

## 2. Solution — base cap winding flip

`extrude_planar_box` 끝(surface attach 직후)에서 **바닥이 되는 cap 의 winding 을
flip + Plane surface 재합성**:

```rust
let bottom_cap = if dist > 0.0 { profile_face } else { top_face };
self.flip_face(bottom_cap)?;                       // 역순 loop + cached normal 부호 반전
// newell_normal(winding-aware) 로 재합성 → outward 일관
let bpos = collect_loop_verts(bottom_cap) positions;
self.faces[bottom_cap].set_surface(Some(synthesize_plane_surface(&bpos)));
```

- `dist > 0` (위로) → `profile_face` 가 바닥 → flip.
- `dist < 0` (아래로) → `top_face` 가 바닥 → flip.
- `flip_face` 의 `reverse_loop` 은 edge degree 보존 → **manifold(is_closed_solid)
  유지**, 공유 edge twin 방향이 일관화 (orientation-consistent).
- Plane surface 재합성 → ADR-038 P23 / downstream op 의 surface normal 도 outward.

---

## 3. Lock-ins

- **L-183-1** Extrude(create_solid) 결과의 모든 cap 이 outward (verify_outward_
  normals().inward_count == 0), 양 방향(dist >0 / <0) 모두.
- **L-183-2** bottom cap = `dist>0 ? profile_face : top_face`.
- **L-183-3** flip 후 Plane surface 재합성 (newell winding-aware → outward).
- **L-183-4** manifold(is_closed_solid + non_manifold_edge 0) 보존 강제.
- **L-183-5** create_box 와 동등한 결과 (0 inward).
- **L-183-6** ADR-007 hint 기반 invariant 와 직교 (verify_invariants 보존).
- **L-183-7** 절대 #[ignore] 금지.

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01, real Chromium + WASM)

| 검증 | 결과 |
|---|---|
| rect → push-pull → verifyOutwardNormals | **inwardCount 0** ✅ (이전 1) |
| manifold | is_closed_solid:true, non_manifold 0 ✅ |
| push-pull 박스 side 면에 그리기 | onFace:true + pick 적중 + rect landed ✅ |

→ 사용자 보고한 "파랑 면 + 못 그림" 두 증상 모두 해소. push-pull 박스가
create_box 와 동등하게 outward.

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

`create_solid.rs` (+3):
- `adr183_create_solid_extrude_up_all_normals_outward` (dist>0 → 0 inward)
- `adr183_create_solid_extrude_down_all_normals_outward` (dist<0 → 0 inward)
- `adr183_create_solid_extrude_box_stays_closed_manifold` (flip 후 manifold 유지)

axia-geo: 1547 → **1550 PASS**. axia-core 325 / vitest 2086 unchanged.

---

## 6. Cross-link

- **ADR-079** Create Solid (extrude entry — extrude_planar_box)
- **ADR-007** winding invariant (hint 기반 — 본 결함 안 잡힘, outward 검사로 보강)
- **ADR-018** two-tone render (inward normal → BackSide 파랑이 증상)
- **ADR-087 K-ε** Plane polygon render path (winding/cached normal 사용)
- **ADR-038 P23** surface-aware normals (Plane surface 재합성 일관성)
- **flip_face / reverse_loop** (`operations/orient.rs`) — manifold-safe winding flip
- **verify_outward_normals** (`mesh_invariants.rs`) — 진단 + 회귀 anchor
- **메타-원칙 #6** Preventive (회귀 자산) / **#9** 회귀 없음
- **ADR-087 K-ζ** 사용자 시연 게이트 / **LOCKED #44** Complete Meaning per Merge

---

## 7. Out of scope (follow-up)

- **isFaceInVolume 분류 불완전** — push-pull 박스가 outward 가 된 후에도
  `isFaceInVolume` 가 6면 중 2면(caps)만 true (create_box 는 6/6). 별도
  volume-flood-fill 분류 버그. **현재 사용자 영향 없음** (outward normal 이면
  wall/sheet 모두 외부에서 white 렌더 + 그리기 정상) → 별도 ADR 후보.
- 다른 SolidKind(Cylinder/Sphere/Cone/Torus/NURBS) 의 base cap outward
  검증 — 본 ADR 은 Box(planar) 만. Path B primitive 는 별도.
