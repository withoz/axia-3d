# ADR-136 — Face Split Downstream Sync Coherence (α spec)

**Status**: Draft (α spec only — β implementation deferred, multi-week atomic)
**Date**: 2026-05-18
**Author**: WYKO (사용자 결재) + Claude

## Canonical anchor (사용자 통찰, 2026-05-18)

> "처음부터 면분할이 완전하지 않았기 때문에 다른 부분과 충돌이 생기는것
>  같아요"

PR #101 의 z=0 invariant + DrawRectTool rewrite + snap disable closure
도중, *분할된 sub-face individual selection* 검증 시연 (사용자 결재
"분할된 면이 선택되도록 해주세요") 에서 **viewport.pick → hit=null**
결함 발견. 진단 결과 — engine 측 (face count / faceMap) 은 정확하지만
*downstream layer* (render mesh / BVH) 가 stale.

사용자 통찰은 **architectural deficiency** 노출 — 면분할 op 후
모든 downstream layer 의 atomic sync 보장 부재.

## 1. Problem statement

ADR-101 partial overlap auto-intersect / LOCKED #1 P7 containment split
후, 결과는 다음 layer 들에 분산 reflect:

| Layer | 책임 | 동기화 |
|---|---|---|
| Engine `Mesh` (DCEL) | face / edge / vertex update | atomic (in Rust op) |
| `bridge.getMeshBuffers().faceMap` | triangle → face_id 매핑 | atomic with engine (LOCKED #15 P22.3) |
| Viewport `THREE.Mesh.BufferGeometry` | render mesh vertices/indices/normals | **lazy via ToolManager.syncMesh()** |
| three-mesh-bvh `boundsTree` | spatial accel | **deferred 1 frame (ADR-111)** |
| `viewport.pick(x, y)` raycaster | screen-space → face hit | uses BVH (or naive fallback) |
| `SelectionManager` | selected face_ids set | reactive (on user click) |

**충돌 시나리오**:
- Engine: face=3 ✅
- faceMap: 3 distinct face_ids ✅
- syncMesh 호출: viewport mesh BufferGeometry 갱신 시작 (async)
- BVH 갱신: 다음 frame defer (ADR-111)
- 즉시 viewport.pick: **stale BVH** 사용 → 새 sub-face triangle 인식 못함 → hit=null

E2E test 에서 이 시나리오 reproduce:
- `bridge.drawRectAsShape × 2 partial overlap` → engine face=3
- `viewport.pick(cx-150, cy)` 직후 → hit=null
- 결과: SelectionManager 비어있음

## 2. LOCKED 정책 충돌 매트릭스

| 정책 | 의도 | 영향 |
|---|---|---|
| **LOCKED #15 P22.3** ADR-037 | "split_edge / merge_faces_by_edge / Boolean / Push-Pull / Erase / Draw / STEP-IGES import 후 faceMap / edgeMap 재구축 필수. stale 차단." | **synchronous** rebuild 의도 |
| **ADR-111 α** | "BVH defer to next frame (33ms budget)" — perf 최적화 | **async** BVH rebuild |
| **PR #73 β** | "Lazy syncMesh via RAF" — mesh sync 도 async | **async** mesh sync |

두 async 정책 (BVH + syncMesh) 가 LOCKED #15 P22.3 의 sync 의도와 충돌.
사용자 click 직후 (1 frame 이내) raycast → stale BVH → 새 face miss.

## 3. β implementation 후보 (3 path)

### Path A — Sync rebuild on topology change (LOCKED #15 강화)

- `Mesh::auto_intersect_coplanar` / `split_face*` 후 명시적 sync flush hook
- `bridge.drawRect/Circle/...` 의 결과 commit 시점에 *sync BVH rebuild* trigger
- ADR-111 BVH defer 정책 amendment 필요 (topology-changed flag → sync rebuild)

**Trade-off**: perf cost (33ms BVH defer budget 손실). 큰 mesh 에서 frame drop 가능.

### Path B — Pick path 의 sync rebuild guarantee

- `viewport.pick()` 호출 시점에 BVH stale flag check → 필요 시 sync rebuild
- pick latency 증가 (16ms hover budget 위반 risk)

**Trade-off**: pick path 의 latency 비용.

### Path C — Atomic op coalescing (Drawing 도구 path 만)

- DrawRect/Circle/... 도구의 commit 시점에 `await syncMesh + BVH rebuild`
- bridge 직접 호출 (test / scripting) 은 caller 책임
- 사용자 facing path 만 atomic, programmatic path 는 explicit sync

**Trade-off**: API asymmetry. test infra 복잡화.

### 추천

**Path A**: 정직한 fix. ADR-111 amendment 로 *topology change flag* 추가 →
flag set 시 next pick 까지 sync rebuild 강제. Sphere/Cylinder 같은 단순
position-only delta 의 경우 기존 defer 유지.

## 4. Lock-ins (β implementation 진행 시)

- **L-136-1** Single canonical sync flush API — `bridge.commitTopologyChange()` 또는 비슷
- **L-136-2** ADR-111 amendment: `topologyChanged` flag set 시 BVH sync rebuild
- **L-136-3** LOCKED #15 P22.3 강화 — split / overlap / containment 후 모든 layer atomic
- **L-136-4** Test hook — Playwright 의 `await page.waitForBvhSync()` helper
- **L-136-5** Latency budget 재평가 (메타-원칙 #11) — Click 33ms 안에 sync rebuild + selection
- **L-136-6** 회귀 자산 — z0-split-face-selection.spec.ts 의 S4/S5 가 real mouse click path 로 PASS (현재 engine + logic path 로만 PASS)
- **L-136-7** 사용자 시연 evidence (ADR-087 K-ζ canonical) — *click 으로 split sub-face 선택* 작동

## 5. Out of scope (deferred to separate ADRs)

- Multi-loop face auto-split (S4 finding) — 별도 ADR (가칭 "Multi-loop Face Auto-Intersect Extension")
- Snap re-introduction "Guidance-only Snap" — 별도 ADR (사용자 결재 "z=0 완성후 새로 정립")
- Push/Pull 후 3D 솔리드 face selection (별도 시나리오)

## 6. Cross-link

- LOCKED #1 ADR-021 P7 (containment split)
- LOCKED #15 P22.3 ADR-037 (topology rebuild after split)
- LOCKED #41 ADR-101 (coplanar partial overlap auto-intersect)
- LOCKED #44 (Complete Meaning per Merge — β 가 의미 단위)
- LOCKED #45 ADR-111 α (BVH defer to next frame)
- 메타-원칙 #11 (Latency Budget First)
- 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)
- ADR-087 K-ζ canonical (사용자 시연 게이트 → 본 ADR trigger)

## 7. Acceptance Log (α spec)

- **2026-05-18**: α spec 작성 (PR #101 closure 중 사용자 통찰 evidence)
  - Trigger: z0-split-face-selection.spec.ts 의 S4/S5 mouse click fail
  - 진단: viewport.pick hit=null (stale BVH 추정)
  - 사용자 결재: "처음부터 면분할이 완전하지 않았기 때문에 다른 부분과
    충돌이 생기는것 같아요"
  - Scope: α spec only — β implementation 별도 사용자 결재 + multi-week atomic
- **(β implementation): TBD** — 사용자 결재 후 별도 PR

## §A Approach 비교 매트릭스 (β 결재 시 참고)

| 측면 | Path A (Sync rebuild) | Path B (Pick path sync) | Path C (Drawing tools only) |
|---|---|---|---|
| Architectural clarity | ✅ 단일 invariant | ⚠ pick 의존 | ⚠ API asymmetry |
| Perf impact | Drawing op latency ↑ | Pick latency ↑ | Drawing op latency ↑ |
| Test infra | Simple (sync guarantee) | Complex (pick hook) | Hybrid (tool path only) |
| LOCKED #15 정합 | ✅ Strict | ⚠ Partial | ⚠ Partial |
| ADR-111 amendment | Required | Not required | Not required |
| Multi-week scope | 2-3주 | 1-2주 | 1주 |

**1차 결재 시 권장**: Path A (architectural clarity 우선).

---

**다음 trigger** (사용자 결재 시):
- β implementation Path 결정 (A/B/C)
- 실측 latency 측정 (Drawing op + Pick 의 33ms budget 정합)
- 회귀 자산 — z0-split-face-selection.spec.ts 의 S4/S5 mouse click path 활성
