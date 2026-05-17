# ADR-111 — BVH Build Defer to Next Frame (α — Primitive Create Click Latency)

- **Status**: Accepted (2026-05-17)
- **사용자 결재**: 매트릭스 audit + lettered options 결재 패턴
  (feedback_decision_pattern.md #1 + #2). 옵션 **α 우선** 채택 — "단순/
  신속/정확" canonical principle 정합. β (full delta-buffer extension)
  는 별도 ADR 후속.
- **Trigger**: 사용자 시연 보고 "그릴때 너무느려요" (2026-05-17, 2 개
  중첩 sphere 화면). 직접 측정 결과: `create_sphere` (Rust) = 1~16 ms
  (단순/신속), 그러나 `tm.syncMesh()` 동기 path 의 `viewport.updateMesh
  .fullUpdate` 안에서 **`computeBoundsTree({indirect:true})` = 145 ms**
  (3-sphere = 376K tris 상태, fullUpdate 비용의 55%, 메타-원칙 #11
  Click 33ms budget 의 4~10× 초과).
- **Cross-link**: PR #73 β (Lazy syncMesh via RAF) 답습 패턴 *확장* —
  syncMesh 자체의 RAF defer 위에 syncMesh *내부* 의 BVH 작업도 한 frame
  더 defer.

---

## 1. Canonical Statement

```
BVH (three-mesh-bvh) build cost ≈ O(N log N) over triangle count is the
single largest contributor (55%) to viewport.updateMesh in primitive
create flow. Defer to next animation frame via frameScheduler TaskKey
'bvhRebuild' (BUDGETS = 33ms). Picking 은 build 완료 후 O(log N), 그
사이 first frame 은 naive O(N) raycast fallback (three-mesh-bvh 의 자연
동작). 메타-원칙 #11 Click 33ms budget 정합 강제.
```

## 2. 측정 매트릭스

### 2.1 Before (PR #73 β only, BVH inline)

clean scene → 3 spheres 누적, real SphereTool flow:

| Sphere # | clicks (user-perceived) | forced sync | total |
|---|---|---|---|
| 1st | — | 132.4 ms | 133.5 ms |
| 2nd | — | 245.0 ms | 253.6 ms |
| 3rd | — | 331.0 ms | 346.6 ms |

`syncMesh.fullUpdate` 내부 분해 (3-sphere 상태):

| 구간 | 시간 | 비율 |
|---|---|---|
| **computeBoundsTree (BVH)** | **145.5 ms** | **55%** |
| geometry rebuild | 30.6 ms | 12% |
| back-mesh clone × 2 | ~30 ms | 12% |
| wall/sheet index loop | 13.9 ms | 5% |
| edges | 0.2 ms | 0% |

### 2.2 After (α — BVH defer to next frame)

clean scene → 3 spheres 누적, real SphereTool flow:

| Sphere # | clicks (user-perceived) | forced sync | total | 개선 |
|---|---|---|---|---|
| 1st | **2.4 ms** ✓ | 87.3 ms | 89.7 ms | **33% ↓** |
| 2nd | 13.1 ms ✓ | 190.3 ms | 203.4 ms | **20% ↓** |
| 3rd | **18.4 ms** ✓ Click 33ms 정합 | 254.2 ms | 272.6 ms | **21% ↓** |

**핵심 win**: clicks (user-perceived) **2~18 ms** — Click 33ms budget
정합. 사용자가 클릭한 직후 다음 frame 에 sphere visual 즉시 paint,
BVH/sync 비용은 *그 다음* frame 에서 흡수 (사용자 UI 인터랙션 영향 0).

## 3. Lock-ins

### L-111-1 — frameScheduler TaskKey 'bvhRebuild' 사용
- `BUDGETS['bvhRebuild'] = 33ms` (`web/src/core/telemetry.ts:88`) 의 등록된
  budget key.
- latest-wins dedup 자동 — 연속 `updateMesh()` 시 *최신* mesh 의 BVH 만
  build (stale geometry 위 build 차단).

### L-111-2 — `_scheduleBvhBuild` 위치 정합 (PR #73 β 답습)
- `viewport/Viewport.ts:_scheduleSmoothNormals` 메서드의 자매 패턴.
- 동일한 시그니처 (`(geometry: THREE.BufferGeometry) => void`).
- 동일한 dispose guard (`if (!geometry.getAttribute('position')) return`).
- 동일한 `console.warn` 실패 모드.

### L-111-3 — `{ indirect: true }` 옵션 보존 (Critical)
- `three-mesh-bvh` 의 `indirect: true` 는 *반드시* 보존.
- 미지정 시 `geometry.index.array` 가 permute 되어 `faceMap[ti]` →
  faceId 매핑이 깨짐 → 박스 클릭 → 다른 sphere 가 selection 되는
  Viewport.ts:1073 ✱ Critical 회귀 재발.

### L-111-4 — Picking O(N) naive fallback 의 시각적 비용 0
- three-mesh-bvh 가 patch 되어 있지 않을 때 `raycaster.intersectObjects`
  는 native Three.js naive raycast 으로 fallback (silent).
- BVH build 가 완료되지 않은 1 frame 사이에 사용자가 click pick 을 하면
  ~16~30 ms 의 native raycast 비용 — 사용자가 인식 불가능한 단일
  frame 영역.

### L-111-5 — Telemetry 통합 (메타-원칙 #11 정합)
- `frameScheduler.schedule('bvhRebuild', fn)` 가 자동으로
  `telemetry.record('bvhRebuild', elapsed)` 호출 (FrameScheduler.ts:131).
- BVH 가 budget (33ms) 초과 시 `telemetry.violationsByKey('bvhRebuild')`
  에 누적. 이미 budget violation 데이터 수집 인프라 활성.

### L-111-6 — LOCKED #40 / LOCKED #16 회귀 0
- chord_tol (LOCKED #40 `ANALYTIC_CHORD_TOL = 0.02`) 변경 0.
- ADR-038 P23 surface-aware normals 변경 0.
- 시각 quality 회귀 0 (rendering pipeline 의 동기 path 만 변경 — BVH
  는 picking-only).

### L-111-7 — ADR-046 P31 #4 additive only
- 메뉴 / 단축키 / 툴바 외부 ID UNCHANGED.
- API surface (`Viewport.updateMesh()`) signature UNCHANGED.
- 사용자 facing behavior change 0 — *오직* 클릭 응답 속도만 향상.

### L-111-8 — 메타-원칙 #11 정합 (Click 33ms budget)
- 1st sphere: 2.4 ms (7% of budget) ✓
- 3rd sphere: 18.4 ms (56% of budget) ✓
- 클릭 user-perceived latency가 budget 안에 들어옴. forced sync (BVH +
  edges + wall/sheet loop) 는 RAF 다음 frame 에서 흡수.

## 4. 후속 트랙 (별도 ADR)

### β — Delta-buffer extension to primitives
- 현재 delta-buffer 경로는 translate/rotate/scale (position-only mutations)
  에만 적용 — primitive create 는 topology change → full rebuild.
- primitive 추가 시 *해당 face 의 buffer 만* incremental update 가능.
- 예상 sync 비용 30 ms 수준 (90% 감소, 메타-원칙 #11 syncMesh budget
  33ms 완전 정합).
- ADR scope: WasmBridge.ts + lib.rs ~150 LoC + mark_topology_changed
  의 contract 재정의.

### γ — EdgesGeometry fallback 비용 audit
- `bridge.getEdgeLines()` 가 null 반환 시 `THREE.EdgesGeometry(geometry,
  30)` 으로 fallback — 376K tris 기준 230~270 ms 측정.
- α 이후 *다음* 가장 큰 비용. 본 ADR scope 외, 별도 audit 결재 필요.
- 후보 fix: EdgesGeometry 도 RAF defer, OR 엔진 측 edge line generation
  의 empty array 정합 조사.

### δ — BVH worker thread (OffscreenCanvas 호환성 audit 후)
- BVH build 자체를 worker thread 로 이동 → main thread 0 ms.
- 본 ADR scope 외, browser 호환성 audit 우선.

## 5. 회귀 자산 (절대 #[ignore] 금지)

`web/src/viewport/Viewport.bvh.test.ts` — 7 tests:
- `computeBoundsTree NOT called synchronously on schedule` (defer 검증)
- `computeBoundsTree called after frameScheduler.flushNow()` (실행 검증)
- `computeBoundsTree invoked with indirect: true (faceMap integrity)`
  (L-111-3 lock-in)
- `consecutive scheduleBvhBuild → only latest geometry BVH built`
  (latest-wins dedup)
- `skip BVH build when position attribute cleared (geometry disposed)`
  (dispose guard)
- `geometry without computeBoundsTree is silently skipped` (graceful
  no-op)
- `bvhRebuild is a known BudgetKey` (telemetry integration)

전체 vitest 자산 1838 tests PASS (회귀 0, 새 7 추가).

## 6. Lessons

### L1 — Path Z atomic 패턴 의 sub-ADR 변형
- ADR-111 은 PR #73 β (Lazy syncMesh via RAF) 의 자연 확장 — 같은
  defer 패턴을 syncMesh *내부* 의 가장 큰 sub-step 에 1 더 적용.
- **가이드**: 큰 syncMesh 내부에서 추가 defer 후보가 있으면 *같은*
  frameScheduler TaskKey 패턴으로 계속 분리 가능.

### L2 — 측정 우선, fix 결정 (메타-원칙 #6 Preventive over Curative)
- 사용자 보고 "그릴때 너무느려요" 를 받으면 *즉시* 측정 — 가정으로
  fix path 결정 금지.
- 본 ADR 의 초기 가정 (analytic check loop bottleneck) 은 측정 후
  *틀린* 것으로 확인 (0.2 ms, 0.0001 ms/call). 진짜 cost 는 BVH
  (145ms) 였음.

### L3 — α + β 분리 의 가치 (Spec-less canonical fix scope)
- α (30분 closure) 가 β (multi-week atomic delta-buffer ADR) 보다 먼저
  진행 → 즉시 사용자 facing gain.
- 사용자 결재 "단순/신속/정확" canonical principle 정합 — single PR
  으로 전체 cost 의 55% 흡수.
- 향후 ADR 가이드: 측정 기반 lettered options 결재 시 *가장 단순* 한
  option 우선 (즉시 사용자 검증 + 후속 atomic 트랙 분리 검증).

## 7. Acceptance Log

- **α-1**: spec + 측정 audit (직접 preview 환경 측정 — 사용자 "직접
  테스트 해주세요" 결재)
- **α-2**: `Viewport.ts._scheduleBvhBuild` 메서드 추가 + 호출 site 의
  inline `computeBoundsTree` 교체 (commit 본 PR)
- **α-3**: `Viewport.bvh.test.ts` 7 회귀 추가 (절대 #[ignore] 금지)
- **α-4**: real Chromium 측정 검증 (3-sphere 누적: 1st=2.4ms / 3rd=18.4ms
  user-perceived, 모두 Click 33ms 정합)
- **α-5**: ADR + LOCKED #45 + commit + PR (본 단계)
