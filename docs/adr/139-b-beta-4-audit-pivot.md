# ADR-139 B-β-4 — audit pivot (DrawLine TS layer 자동 face 합성 폐기 audit 결과)

**Status**: Accepted (docs only — audit-first canonical 9번째 적용, B-β-4 scope pivot)
**Date**: 2026-05-21
**Author**: WYKO + Claude
**관련 ADR**: ADR-139 §14 B-β-4 atomic sub-step
**Path Z position**: B-β-2 closure (PR #130) → **B-β-4 audit pivot (본 doc)** → B-β-3 audit / β implementation

## 1. 목적

ADR-139 B-ζ audit (PR #128) 가 식별한 B-β-4 sub-step ("DrawLine closed
loop 자동 face 합성 폐기, TS, ~30분, 영향 vitest DrawLine 36 tests") 의
**사전 검토 audit**. B-β-1 / B-β-2 closure 후 자연 진입 시점.

## 2. 사전 검토 결과 (audit-first 9번째 적용)

### 2.1 TS DrawLineTool.ts 의 자동 face 합성 로직 audit

**Finding (canonical)**: DrawLineTool.ts 는 **자체 자동 face 합성 로직을
가지지 않음**. Face 생성은 *engine 측* 의 책임:

```
사용자 click ×N (closed loop)
  ↓
DrawLineTool.commitLine()  ← TS layer
  ↓
bridge.drawLineAsShape(...)  ← WASM call
  ↓
Scene::exec_draw_line_as_shape  ← Engine
  ↓
run_face_synthesis_postprocess  ← 모든 phase 가 여기서 실행
  - Step 4.5/4.6/4.9 (M1 / sub-face)
  - Step 4.95 second-pass component-merge
  - Step 4.99 final sweep (resolve_planar_free_faces) ← B-β-2 gated ✓
  - Phase 5 (DFS cycle finder)
  - Phase 6 (strand absorption)
  - Phase 7 STRICT (closed-shape finalizer — Q2-a 보존)
  ↓
faceCount 증가 (또는 미증가)
  ↓
TS DrawLineTool 의 facesAfter > facesBefore 비교
  ↓
Toast "면 생성됨" or "면 생성 실패"
```

**TS 의 역할은 *관찰자*** — 자체 face 합성 로직 없음.

### 2.2 vitest DrawLineTool.test.ts 의 expectation audit

B-ζ audit §2.5 가 식별한 "vitest DrawLine 36 tests" 의 실제 expectation:

| 분류 | Count | Update type |
|---|---|---|
| State machine (Idle/Armed/Drawing/Confirmed transitions) | ~15 | **불변** (face synthesis 무관) |
| Click handling (mouse down/move/up, button=0/1/2) | ~8 | **불변** |
| Chain tracking (chainStart, chainPoints, snap exclusion) | ~5 | **불변** (LOCKED #25 ADR-047 P32 — snap, NOT face) |
| Axis lock / inferred axis | ~4 | **불변** |
| VCB input / dimension labels | ~2 | **불변** |
| Activation/deactivation lifecycle | ~2 | **불변** |
| `faceCount` mock check | **0** | (없음) |
| `drawLineAsShape` assertion | ~1 | **불변** (mock 호출 검증) |

**Summary**: 36 tests 중 **0 tests** 가 closed loop → 자동 face 합성
expectation 보유. 모두 TS-layer state machine + snap + UI 관련.

**B-ζ audit estimate 오차**: "36 tests 재작성" 예상 → **실측 0 tests
재작성 필요**.

### 2.3 SettingsPanel UX audit

`web/src/units/SettingsPanel.ts` 의 "자동 합성" toggle UI:
- `auto_intersect_on_draw` checkbox (B-β-1 후 default OFF)
- 신규 `auto_face_synthesis_on_draw` checkbox (B-β-2 후 default OFF) —
  아직 UI 미노출 (별도 sub-step 가능)

본 audit scope 외 — 별도 UX polish 트랙.

### 2.4 Toast 메시지 audit

DrawLineTool.ts 의 closed loop Toast (lines 480-486):
```typescript
if (faceCreated) {
  Toast.info('루프 닫힘 — 면 생성됨', 1800);
} else if (isLoopClose) {
  Toast.warning('루프 닫힘 — 면 생성 실패 (비평면 또는 자체교차)', 2500);
}
```

ADR-139 후 의미 변화:
- `faceCreated=true` → 사용자가 explicit opt-in 한 경우 (legacy 행동)
- `faceCreated=false` AND `isLoopClose` → ADR-139 default OFF 경우 **정상** (자동 trigger 폐기)
- 현재 메시지 "면 생성 실패" 는 ADR-139 후 **misleading** — Boundary tool 안내 권장

**Out of scope** for B-β-4 (audit pivot): Toast 재워딩은 Boundary tool 도입 (B-γ ~ B-ε) 시점에 자연 통합 권장 (사용자 facing 일관성).

## 3. Pivot decision (canonical)

### 3.1 B-β-4 의 실제 scope

B-ζ audit 의 추정 ("36 tests 재작성, ~30분") 가 **architectural reality**
와 mismatch:

- **vitest 36 tests**: 0 tests 재작성 필요 (audit-first finding)
- **TS layer 자동 face 합성 로직**: 부재 (engine-side only)
- **Toast 메시지**: Boundary tool 도입 시 자연 통합 권장 (별도 트랙)

### 3.2 B-β-4 closure 형태

본 audit doc 으로 **자연 closure** — 별도 implementation PR 불필요:
- vitest 36 tests **불변 보존** ✅
- DrawLineTool.ts 코드 변경 0 ✅
- Toast 메시지 재워딩 → Boundary tool 도입 (B-γ ~ B-ε) 시 통합

### 3.3 ADR-139 B-β 전체 sub-step 재정의

B-ζ audit §4.1 의 B-β sub-step 분할 갱신:

| Sub-step | Original scope | Audit-revised scope |
|---|---|---|
| B-β-1 | `auto_intersect_on_draw` flag default false (~1일) | **✅ 완료** (PR #129, 13 tests 영향) |
| B-β-2 | Step 4.99 `resolve_planar_free_faces` auto disable (~1일) | **✅ 완료** (PR #130, 회귀 0 — mop-up 단계) |
| B-β-3 | Step 4.95 second-pass + Phase 5/6 disable (~1-2일) | **다음 진입** (가장 큰 영향) |
| **B-β-4** | ~~DrawLine closed loop 자동 face 합성 폐기 (TS, ~30분)~~ | **✅ audit closure** (본 doc, 실측 0 TS-side 변경 필요) |

## 4. Lock-ins (audit pivot 정책)

- **L-Bβ4-1** Audit-first canonical 9번째 적용 — β implementation 진입
  전 architectural reality 재확인
- **L-Bβ4-2** DrawLineTool.ts 자체 자동 face 합성 로직 부재 lock-in —
  TS layer = 관찰자, engine = 본체
- **L-Bβ4-3** vitest 36 tests 모두 **불변 보존** — state machine + snap
  + UI 관련, face synthesis 무관
- **L-Bβ4-4** Toast 메시지 재워딩 → Boundary tool 도입 (B-γ ~ B-ε) 시
  통합 (별도 트랙, audit 외 scope)
- **L-Bβ4-5** B-ζ audit estimate (36 tests 재작성) 의 architectural
  finding 정정 명시 — audit-first canonical 의 self-applying robustness
  evidence
- **L-Bβ4-6** B-β-4 별도 implementation PR **불필요** — 본 audit doc
  으로 closure
- **L-Bβ4-7** 절대 #[ignore] 금지 (vitest 36 tests 모두 PASS 유지)

## 5. Lessons (canonical for audit-first pivots)

- **L1 Audit ADR ITSELF의 architectural reality 재확인 강제** —
  ADR-131 §A1.4 (audit ADR self-applying robustness) 답습. B-ζ audit
  의 추정도 implementation 진입 전 검증 필요.
- **L2 Code path 명확화 가치** — "X 도구의 자동 Y 합성 폐기" 가정 시
  실제 X 도구가 자동 Y 합성 로직을 *소유* 하는지 검증. TS 도구는
  대부분 engine 의 관찰자.
- **L3 Audit-first canonical 9번째 적용** — ADR-125/126/127/131/132/
  134 + B-ζ-1 audit + ADR-128 priority + 본 doc.
- **L4 Spec preservation pattern 8번째 누적** — ADR-122 amendments 3
  + ADR-120 + ADR-130 + ADR-045 + ADR-129 + B-ζ-1 audit revision + 본
  doc. B-ζ audit 의 estimate 자체는 보존, scope 만 정정.
- **L5 부정 결정 lock-in 5번째 적용** — ADR-076 / ADR-125 / ADR-127 /
  ADR-131 + 본 doc. B-β-4 별도 implementation 거부 + 명시 lock-in.

## 6. Cross-link

- ADR-139 α / B-β audit / B-ζ audit / B-η/θ/κ/λ docs batch / B-β-1 / B-β-2
- ADR-125/126/127/131/132/134 (audit-first canonical 1~7번째)
- LOCKED #25 ADR-047 P32 (snap chain self-touch — DrawLineTool chainPoints 본 목적)
- LOCKED #44 (Complete Meaning per Merge — docs only PR)
- 메타-원칙 #14 (WHAT 불변) + #16 (WHEN 자동화 antipattern)
- ADR-076 §C-amendment-1 (부정 결정 lock-in 패턴 source)

## 7. Acceptance Log

- **2026-05-21 audit pivot** (본 commit) — B-β-4 scope architectural
  reality check. vitest 36 tests 의 expectation 분류 + TS DrawLineTool.ts
  자동 face 합성 로직 부재 확인 → audit-first 9번째 적용 pivot.
- **(다음 단계)** — B-β-3 audit (Step 4.95 second-pass + Phase 5/6
  disable 의 영향 inventory) 또는 사용자 시연 baseline.

---

**다음 trigger**: B-β-3 audit (사전 검토) 또는 B-β-3 implementation
(direct 진입) 또는 사용자 시연 baseline.
