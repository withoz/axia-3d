# ADR-185 — Circle Containment Auto Ring+Disk (원 안에 원 → 면분할)

**Status**: Accepted (demo-verified 2026-06-01 — 원 안에 원 → ring + disk 자동 분할)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 작업지시 (2026-06-01):
> "원안의 원을 그려서 면분할 되는 기능 구현"
> (trigger 결재) "A. 자동 (그리면 즉시 annulus)"
**Direct precursors**: ADR-145 (Circle annulus 명시 promote — manual), ADR-101
(coplanar auto-intersect — partial overlap), ADR-176 (auto-behaviors default ON),
ADR-089 (Path B closed-curve Circle face).

---

## 1. Problem statement

원(circle) 안에 더 작은 원을 그려도 면이 분할되지 않았다 — 두 disk 가 단순히
겹쳐 있을 뿐 (audit: faceCount +1, 분할 0). 사용자는 "그려서 면분할 되는"
자동 동작을 원함.

현재 상태 (audit):
- **partial overlap** (ADR-101/176): `auto_intersect_coplanar` 가 자동 3 sub-face.
- **containment** (원 안에 원): `auto_intersect_coplanar` 는 `Ok(None)` 반환
  (line 447 "full containment → None") → 분할 안 됨.
- **manual annulus** (ADR-145): `promote_circles_to_annulus` 우클릭 ContextMenu
  존재. 단 inner face **deactivate** → ring + *빈 hole* (washer). 메타-원칙 #16
  정합으로 *일부러* manual.

"면분할" 은 보통 ring + **inner disk** (둘 다 face, SketchUp 식) → manual annulus
(ring + 빈 hole) 와 다름.

---

## 2. Solution — auto containment 감지 → ring + disk (inner disk 보존)

### 2.1 Engine — `split_face_by_inner_circle` (annulus.rs)

`promote_circles_to_annulus` 와 동일 validation (active / circle / coplanar /
contained) 이지만, **inner disk 를 보존**:

| | annulus (ADR-145) | ring+disk (ADR-185) |
|---|---|---|
| outer hole HE | inner 의 outer-loop HE (CCW) reparent | inner edge 의 **twin HE** (CW, ring 측) |
| inner face | **deactivate** | **유지 (disk)** |
| 결과 | ring + 빈 hole (washer) | ring + disk (면분할) |

inner edge 는 2 face-bearing HE (HE1 = disk, HE2 = ring hole) → manifold.

### 2.2 Engine — `detect_circle_containment` (annulus.rs)

두 face 가 coplanar Circle + 한쪽이 다른쪽 완전 포함 (`d + r_inner ≤ r_outer`)
이면 `(outer, inner)` 반환. partial / disjoint / non-circle → `None`.

### 2.3 Scene wiring (scene.rs `intersect_faces_inner`)

coplanar scan 의 각 pair 에서, **`auto_intersect_coplanar` *전*** 에
`detect_circle_containment` 실행 (핵심 — auto_intersect_coplanar 가 Path B
Circle 을 polygonize 해서 Circle 메타데이터를 파괴하므로 그 전에 detect).
containment → `split_face_by_inner_circle` (새 face 0, outer→ring + inner→disk,
둘 다 XIA 보존).

### 2.4 Trigger — `auto_intersect_on_draw` fold (no new flag)

별도 flag 없이 기존 `auto_intersect_on_draw` (ADR-176 production default ON)
gating 재사용 — auto-annulus 는 같은 coplanar auto-split family. 새 WASM/TS
surface 0.

---

## 3. 메타-원칙 #16 — 결재된 예외

ADR-145 는 containment annulus 를 **manual** 로 (메타-원칙 #16 "휴리스틱 자동화
antipattern" — containment 는 "구멍 vs 별개 원판" 의도 모호). ADR-185 는 사용자
명시 결재 ("A. 자동") 로 이를 **override** — ADR-176 (partial overlap auto) 의
precedent 정합. 안전장치:
- 깨끗한 well-defined 연산 (containment → ring+disk), tested 로직 재사용.
- `auto_intersect_on_draw` toggle 로 OFF 가능 (escape hatch).
- manual annulus (ADR-145, ring+빈hole washer) 는 **보존** — 다른 use case.

→ 메타-원칙 #16 자체 불변, containment auto 만 사용자 결재 예외 (ADR-176 답습).

---

## 4. Lock-ins

- **L-185-1** `split_face_by_inner_circle` — twin HE 로 ring + disk (inner 보존).
- **L-185-2** `detect_circle_containment` — coplanar Circle + `d+r_in ≤ r_out`.
- **L-185-3** containment detect 는 `auto_intersect_coplanar` *전* (polygonize
  전 Circle 메타데이터 사용).
- **L-185-4** `auto_intersect_on_draw` fold — 새 flag/WASM/TS 0.
- **L-185-5** manifold 보존 (inner edge 2 face-bearing HE) — verify_face_invariants.
- **L-185-6** manual annulus (ADR-145, ring+빈hole) 보존 — 별 use case.
- **L-185-7** 메타-원칙 #16 override = 사용자 결재 예외 (ADR-176 precedent).
- **L-185-8** 절대 #[ignore] 금지.

---

## 5. Demo verification (Claude Preview MCP, 2026-06-01, real Chromium + WASM)

| 검증 | 결과 |
|---|---|
| outer circle r=100 → inner r=40 concentric | faceCount 1 → **2** ✅ |
| 중앙(r<35) triangle 보유 face 수 | **1** (inner disk 만) → outer 는 ring ✅ |
| ring + disk vs 2 겹친 disk | **ring + disk** ✅ |
| manifold (engine test verify_face_invariants) | 0 violations ✅ |

---

## 6. 회귀 자산 (절대 #[ignore] 금지)

- `annulus.rs` (+2): `adr185_split_keeps_inner_disk_ring_plus_disk` (ring+disk +
  manifold) / `adr185_split_rejects_not_contained`
- `scene.rs` (+1): `adr185_concentric_circles_auto_ring_plus_disk` (draw 2
  concentric → 2 faces, 1 ring + manifold)

axia-geo 1550 → **1552**, axia-core 325 → **326**. vitest unchanged (no TS surface).

---

## 7. Cross-link

- **ADR-145** Circle annulus (manual promote — validation 재사용, ring+빈hole 보존)
- **ADR-101** coplanar auto-intersect (partial overlap — containment 은 별 경로)
- **ADR-176** auto-behaviors default ON (auto_intersect_on_draw fold + 메타-원칙
  #16 override precedent)
- **ADR-089** Path B Circle face (1 anchor + 1 self-loop edge, twin HE)
- **메타-원칙 #16** 휴리스틱 자동화 (결재된 예외) / **#4** SSOT (reuse)
- **ADR-087 K-ζ** 사용자 시연 게이트 / **LOCKED #44** Complete Meaning per Merge

---

## 8. Out of scope (follow-up)

- **RECT / Polygon containment** auto ring+disk — 본 ADR 은 Circle 만 (Circle
  metadata 기반). 일반 coplanar 다각형 containment 는 별도.
- **다단 nested** (원 안 원 안 원) — 현재 first-match per draw. 다단 자동은 별도.
- **Settings UI toggle** (auto-annulus 독립 on/off) — 현재 auto_intersect fold.
