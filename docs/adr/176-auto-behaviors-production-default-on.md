# ADR-176 — Auto-Behaviors Production Default ON (ADR-139 amendment)

**Status**: Accepted (demo-verified 2026-06-01 — auto-intersect + auto-face-
synthesis production default ON, invariant 0 violations)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 보고 (2026-06-01): "우리엔진의 루틴이 바뀌어서 모두
작동을 하지 않습니다" + "겹침/포함 자동 분할이 안 됨" (#1).
**사용자 결재 (2026-06-01)**: "둘 다 고침 (추천) — 자동 동작 기본 ON".
**Direct precursors**:
- ADR-139 (LOCKED #64) — auto trigger 폐기, default OFF (메타-원칙 #16) — 본 ADR 이 *production default* 만 amend
- ADR-169~173 (LOCKED #70~74) — Phase 1-4 absorb 파이프라인 견고화
- ADR-049 P-5e-α — engine default OFF + production default ON via localStorage (canonical)
- ADR-101 (LOCKED #41) — coplanar overlap → 3 sub-face (auto-intersect 로직)

---

## 1. Problem statement

### 1.1 사용자 보고 (2026-06-01)

> "겹치는 도형/포함 도형을 그렸는데 자동으로 3분할/구멍이 안 생긴다."

사용자의 핵심 비전 **"선만 그려, 케이크는 알아서 나뉜다"** (axia-sketch
parity) 가 기본 제품에서 작동하지 않음.

### 1.2 Root cause — ADR-139 default OFF

ADR-139 (2026-05-18, 메타-원칙 #16) 가 두 자동 동작 flag 를 **기본 OFF** 로
전환:

| Flag | 기본값 (ADR-139) | 영향 |
|---|---|---|
| `auto_intersect_on_draw` | false | 겹침 → 3분할 안 됨 |
| `auto_face_synthesis_on_draw` | false | 포함 → ring+hole 안 됨, sliver mop-up 안 됨 |

ADR-139 이 OFF 로 한 이유: 자동 합성이 *cascading 부작용*(P5.UX.39-45)을
만들었기 때문 (메타-원칙 #16 "휴리스틱 자동화는 cascading 부작용의 source").

### 1.3 시점 통찰 — 모순이 아니라 견고화 완료

- **2026-05-18** ADR-139 — 파이프라인이 *견고하지 않아* 자동 동작 OFF.
- **2026-05-29~31** ADR-169~173 (Phase 1-4) — absorb SSOT + crossing-split
  으로 파이프라인 **견고화**.
- **2026-06-01** ADR-176 — 견고해졌으니 자동 동작 **다시 ON**.

ADR-139 은 "*견고해질 때까지* 끈다"였고, Phase 1-4 가 견고하게 만들었으므로
이제 켜는 것이 정합. **메타-원칙 #16 자체(휴리스틱 antipattern)는 불변** —
본 ADR 은 *production default* 만 변경.

---

## 2. Solution — production default ON (engine default OFF 유지)

ADR-049 P-5e-α canonical 패턴 (Path B 답습):

```
Engine default (scene.rs)  : OFF  (회귀 자산 300+ 보존, Scene::new() 불변)
Production default (TS)     : ON   (main.ts wiring 이 init 시 engine 에 push)
Explicit OFF preference     : 보존 (localStorage 'false' → OFF)
```

### 2.1 변경 (2 TS Settings 모듈)

`web/src/tools/AutoIntersectSettings.ts` + `AutoFaceSynthesisSettings.ts`:

```typescript
// ADR-176: production default ON
let current = true;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false;   // explicit OFF preference 보존
} catch { /* private mode */ }
```

`web/src/main.ts` (기존 wiring, 변경 0):
```typescript
bridge.setAutoIntersectOnDraw(getAutoIntersect());          // init push
bridge.setAutoFaceSynthesisOnDraw(getAutoFaceSynthesis());  // init push
```

### 2.2 Engine 변경 0

`scene.rs:400/402` 의 engine default (false) UNCHANGED. 모든 axia-core
회귀 자산이 Scene::new() default OFF 위에서 동작 — 회귀 0.

---

## 3. Lock-ins

- **L-176-1** Production default ON, engine default OFF (ADR-049 P-5e-α canonical)
- **L-176-2** Explicit `localStorage 'false'` OFF preference 보존
- **L-176-3** 메타-원칙 #16 (휴리스틱 antipattern) 자체는 불변 — production default 만 변경
- **L-176-4** Phase 1-4 (ADR-169~173) 견고화가 활성 근거
- **L-176-5** Boundary tool (ADR-139 B-γ) 명시 trigger 도 보존 (additive)
- **L-176-6** 회귀 자산 강제 — invariant 0 violations (demo-verified)
- **L-176-7** 절대 #[ignore] 금지

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01)

production default ON 적용 + invariant 안전성:

| 시나리오 | 결과 |
|---|---|
| `getAutoIntersectOnDraw()` default | **true** ✅ |
| `getAutoFaceSynthesisOnDraw()` default | **true** ✅ |
| 겹침 RECT 2개 → sub-faces | delta **3** ✅ |
| 포함 (big+small) → ring+hole | delta 2 ✅ |
| **멀티-RECT 스트레스 (4겹 staggered)** | **9 sub-faces, invariant 0 violations** ✅ |
| `verifyInvariants()` | **valid=true, violationCount=0** ✅ (cascading 손상 없음) |

→ Phase 1-4 견고화로 ADR-139 이 우려한 cascading 손상이 발생하지 않음.

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

axia-core scene::tests (+2):
- `adr176_rect_as_shape_origin_corner_auto_intersect_on` — 원점 cardinal rect
  + auto-intersect ON → 1 face (atomic path no-op 정합)
- `adr176_two_rects_as_shape_partial_overlap_auto_split` — 겹침 rect 2개 →
  3 sub-faces (ADR-101 P7 + auto-default 정합)

axia-core: 323 → **325 PASS**. tsc 0 errors. Playwright: 모든 auto-spec 가
explicit `'true'` opt-in / annulus-demo `'false'` opt-out → 영향 0.

---

## 6. ADR-139 amendment (canonical)

> **ADR-139 amendment (ADR-176, 사용자 결재 2026-06-01)**
>
> LOCKED #64 ADR-139 의 `auto_intersect_on_draw` + `auto_face_synthesis_
> on_draw` **production default 를 ON 으로** 전환. Engine default 는 OFF
> 유지 (회귀 자산 보존). 근거: Phase 1-4 (ADR-169~173) absorb 견고화 완료.
> 메타-원칙 #16 (휴리스틱 antipattern) 자체는 불변 — Boundary tool 명시
> trigger 도 보존. Demo-verified: 멀티-RECT 스트레스에서 invariant 0 violations.

---

## 7. Out of scope (별도 ADR)

- #3 입체면 face-drawing robustness (start-off-face → z=0 lock) — ADR-177 (가칭)
- Settings UI 의 auto-toggle 가시성 개선 — future
- 사용자 manual 시연 (real mouse, 겹침/포함/멀티) 회고 — follow-up

---

## 8. Cross-link

- **LOCKED #64** ADR-139 (auto trigger 폐기 — 본 ADR 이 production default amend)
- **LOCKED #70~74** ADR-169~173 (Phase 1-4 견고화 — 활성 근거)
- **LOCKED #41** ADR-101 (coplanar overlap auto-split 로직)
- **ADR-049 P-5e-α** (engine OFF + production ON canonical)
- **ADR-094 B-η** (Cylinder Path B production default ON — 패턴 source)
- **메타-원칙 #5** 사용자 편의 / **#6** Preventive (invariant 검증) / **#10**
  ADR 불변 (ADR-139 amendment via 사용자 결재) / **#16** 자동화 antipattern
  (불변 보존 — production default 만 변경)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (demo-verified)
