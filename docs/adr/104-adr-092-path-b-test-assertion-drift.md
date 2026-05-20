# ADR-104: ADR-092 C-δ Playwright Test Path-B Assertion Drift Fix

- **Status**: Accepted (R-α single-step closure, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: ADR-102 R-θ deferred — `adr-092-pushpull-circle-rim.spec.ts:40`
  unconditional skip 였음. Engine truth audit 결과 *implementation 정상*,
  test assertion 이 ADR-094 Path B default ON (LOCKED #35 amendment,
  2026-05-09) 의 의미 변화 미반영.
- **Parent**: ADR-092 (closed-curve Push-Pull top rim Arc 보존), ADR-094
  (Path B-full Refined Plan)
- **Sibling**: ADR-102 R-θ (CI restoration skip — 본 ADR 의 trigger)

---

## A. Problem Statement

ADR-102 R-θ skip 항목 1 — `adr-092-pushpull-circle-rim.spec.ts:40`:

```js
expect(result.multiSegmentEdges).toBeGreaterThanOrEqual(16);
// Expected: >= 16, Received: 2
```

본 ADR audit 진행 시 Rust unit test 7/7 모두 PASS — Arc curves 정상
attach. Bridge / WASM path 모두 정상. 그러나 Browser Playwright 결과
는 `multiSegmentEdges: 2`.

진단 결과:
- **Rust unit test (Path A)**: 46 multi-segment edges × 8 seg = 368 entries
- **Browser Playwright (Path B)**: 2 multi-segment edges × 23 seg = 46 entries

원인 — **ADR-094 Path B default ON** (LOCKED #35 amendment, commit
2026-05-09 ~). 본 test 가 2026-05-09 작성, 같은 날 Path B default flip
이전의 Path A polygonal substitute 동작 (N edges × 1 Arc each) 기준
assertion.

Path B 의 canonical cylinder:
- 3 face / 2 edge / 2 vert (산업 CAD parity, ~97% memory reduction)
- 두 rim 모두 **single self-loop edge with Circle/Arc curve**
- ADR-089 A-κ-β closed-curve fast-path → 한 EdgeId 가 N polyline segment 발생

→ Path B 의 본 test 정합 observable: `multiSegmentEdges == 2` (top + bottom
rim self-loop) AND `totalSegmentsPost >= 16` (각 rim ≥ 8 seg = smooth).

---

## B. Lock-ins

### R-A — Test assertion 이 의미적 invariant 검증으로 정정

원래 의도: "top rim 이 polygon 으로 보이지 않고 매끈" (ADR-092 C-δ).
Path A 또는 Path B 어느 쪽이든 같은 semantic intent 충족.

**새 assertion** (Path B / Path A 둘 다 통과):
```ts
expect(result.totalSegmentsPost).toBeGreaterThanOrEqual(16);
expect(result.multiSegmentEdges).toBeGreaterThanOrEqual(2);
```

근거:
- Path B (default): `multiSegmentEdges = 2` (2 self-loop edges),
  `totalSegmentsPost = 46` (≥ 16 since 8 + 8 minimum)
- Path A (legacy, Path B 명시 OFF): `multiSegmentEdges ≈ 46`,
  `totalSegmentsPost ≈ 368`

### R-B — Rust 본체 변경 0
ADR-092 / ADR-094 / ADR-089 의 engine code, render path 모두 변경
없음. 본 ADR scope = **test-only assertion drift fix**.

### R-C — Skip 제거
`web/e2e/adr-092-pushpull-circle-rim.spec.ts:40` 의 ADR-102 R-θ
unconditional `test.skip` → 일반 `test` 로 복귀.

### R-D — 별도 트랙 분리 — ADR-103 (Three.js visual stability)
ADR-102 R-θ 의 다른 4 visual baseline skip (Linux only) 은 본 ADR
scope 외 — 별도 ADR-103 트랙 유지.

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| 새 assertion | 두 Path 모두 통과 (Browser default Path B, Rust unit test Path A) |
| 회귀 | 기존 7 Rust ADR-092 C-β unit tests 영향 0, Playwright spec 2/2 PASS |
| Skip 제거 | `test.skip` → `test` (line 40) |
| 기존 회귀 자산 | cargo `axia-geo 1259` 유지, vitest 1828+ 유지 |

---

## D. Acceptance Log

### R-α (본 commit) — Test assertion drift fix + audit ADR

- **commit**: 본 commit
- **변경 (2 files)**:
  - `web/e2e/adr-092-pushpull-circle-rim.spec.ts` — line 40 의
    `test.skip` 제거, assertion `multiSegmentEdges >= 16` →
    `totalSegmentsPost >= 16 + multiSegmentEdges >= 2` (Path B/A 둘 다
    통과)
  - `docs/adr/104-adr-092-path-b-test-assertion-drift.md` — 본 ADR
- **회귀**:
  - Local Playwright: 2/2 PASS (이전 1 fail / 1 pass — skip 제거 후
    원래 fail 이 회복)
  - cargo `axia-geo`: **1259 PASS** 변동 없음
- **다음**: CI 검증 — `e2e/adr-092` spec 자동 실행 후 green 확인.

---

## E. Lessons

1. **Path-aware assertions** — 같은 ADR (ADR-094) 가 동일 날짜 default
   flip 했을 때 동일 날짜 작성된 모든 test 가 의미 drift 위험. 향후
   default flip 의 acceptance log 에 "관련 test assertion sweep" step
   필수 검토.
2. **Engine truth vs render observable 분리** — Rust unit test (engine
   truth) 와 Playwright (render observable) 는 같은 invariant 의 다른
   manifestation. Assertion 작성 시 *intent* (matpe 매끈) 와 *path-
   specific manifestation* (N×8 vs 2×23 segments) 분리 권장.
3. **ADR-094 Path B default ON 의 side effect inventory**: 본 ADR 이
   첫 발견. 향후 ADR-094 LOCKED #35 entry 에 "default ON side effects"
   sub-section 추가 검토 (engine 변경 0, semantic invariant 변형 sites).

---

## F. Cross-link

- ADR-092 C-β/C-δ (closed Circle Push-Pull top rim Arc 보존 — engine
  본체 정상)
- ADR-094 Path B-full Refined Plan + default ON (LOCKED #35 amendment
  — 본 drift 의 origin)
- ADR-089 A-κ-β (closed-curve edge wireframe fast-path — Path B rim
  render path)
- ADR-102 R-θ (Pending Linux + ADR-092 skip — 본 ADR 의 trigger)
- 메타-원칙 #9 (회귀 없음 — 새 assertion 이 Path A/B 둘 다 통과 확인)
