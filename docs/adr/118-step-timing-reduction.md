# ADR-118 — STEP/IGES Init Timing Reduction (Drift #5 Architectural Closure)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — sub-step lock-ins pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결정 + Claude spec) |
| Anchor | LOCKED #43 절대 우선순위 priority #3 — "STEP timing 단축" |
| Parent | ADR-082 (Drift #5 봉인 — 본질 단축은 별도 architectural ADR), ADR-085 (Toast Progress UX MVP — *perception* 만 다룸, *본질 단축* deferred to this ADR) |
| Cross-cut | ADR-035 P20.C #2 (initial bundle 0MB strict), ADR-082 C-ε (libs 명시), ADR-046 P31 (P1 + P3 가치) |

---

## 0. Summary

> ADR-082 Drift #5 (browser env OCCT init 180s+ wait) 의 **본질적 architectural 해소**. 현재 cold path 만 존재 (no streaming compile, no cache, no pre-warm). 4 fix paths 매트릭스 + lettered options 으로 사용자 결재 받음 → 채택된 path 만 별도 atomic sub-step PR 진행. Multi-week scope, LOCKED #44 의미 단위 분할 강제.

---

## 1. Context

### 1.1 LOCKED #43 priority #3 anchor

```
1. ADR-103 Z-up                              ✅ closure
2. Path B (Sphere/Cone/Torus 확장)           ✅ 100% closure (ADR-094/113/114/115/116/117)
3. STEP timing 단축                           ← 본 ADR
4. NURBS-aware coplanar intersect
```

사용자 결재 (2026-05-17, ADR-117 후): "3. STEP timing 단축 ← 다음 priority (multi-week) 으로 승인합니다"

### 1.2 Drift #5 정량 분해 (ADR-085 §1.3 측정)

```
Stage 1: OCCT.js chunk fetch       ~5-10s   (5.37MB lazy chunk + 50+ WASM files)
Stage 2: initOpenCascade + libs    ~120-180s ← Drift #5 본체
Stage 3: STEP file parse           ~1-5s
Stage 4: BRep traversal            ~0.1s
Stage 5: BRepMesh tessellation     ~5-30s
Stage 6: Three.js Group 생성       ~0.1s
─────────────────────────────────────
Total                              ~130-225s  (180s typical)
```

**95% 이 Stage 2 (initOpenCascade + libs)** — 5+ MB WASM compile + module link sequential.

### 1.3 현재 코드 audit (`web/src/import/StepIgesImporter.ts:170-232`)

- **No streaming compile**: `WebAssembly.compileStreaming()` 미사용
- **No persistent cache**: Cache API / IndexedDB / Service Worker 미사용 (cold init 매 page load)
- **No pre-warm**: 사용자가 Import 클릭해야 OCCT 로딩 시작 (180s wait → import 시작 가능)
- **All 4 libs eagerly loaded**: ocCore + ocModelingAlgorithms + ocDataExchangeBase + ocDataExchangeExtra
- **No worker thread**: main thread 180s 동안 일부 unresponsive (browser 가 chunk task로 어느정도 분산하지만 보장 없음)
- **Bundle current**: opencascade-deps lazy chunk 5.37 MB / 57 WASM module files

### 1.4 ADR-085 의 위치 명시

ADR-085 P-β (Toast progress) 는 **wait 의 perception 만 다룸** — *본질 단축* 은 §2.2 Out of scope:
> "Drift #5 timing 단축 자체 — WASM streaming compile / parallel libs / cache 등. **별도 architectural ADR**."

본 ADR-118 이 그 architectural ADR.

### 1.5 사용자 가치 anchor (ADR-046 P31)

- **P1 (건축/디자인)**: 실 STEP 열기 까지 180s 대기 → demo 시 인내심 imposed. 단축 시 *production-ready CAD interop* 첫 활성.
- **P3 (AI 협업자)**: AI agent 의 batch STEP import 시 180s × N 누적 — 단축 시 *automated workflow* unlock.

**Demo readiness 95% → 99%+** (Drift #5 본질 해소 후).

---

## 2. Fix Path Options Matrix

각 option 의 측정 evidence + scope + risk.

| Option | scope | 예상 효과 | 시간 estimate | risk | 사용자 facing 변화 |
|---|---|---|---|---|---|
| **γ-1** WASM streaming compile (`WebAssembly.compileStreaming`) | ~30 LoC + Vite plugin config | **30-50% 단축** (180s → ~110s) — browser 가 download 중 compile | 1-2일 atomic | 낮음 (modern browsers native) | wait 시간 short, but still 90~110s |
| **γ-2** Persistent module cache (Cache API + service worker 또는 IndexedDB) | ~100 LoC + cache invalidation 정책 | **subsequent loads 95% 단축** (180s → ~5-10s, just module link). 첫 load = 동일. | 3-5일 atomic | 중간 (cache invalidation + version mgmt) | 첫 방문 180s, 재방문 ~5s |
| **γ-3** Conditional lib loading (STEP only OR IGES only based on file extension) | ~50 LoC | **~20-30% 단축** if STEP/IGES 선택 시점 분기 가능 (~180s → ~120-140s). IGES skip TKSTEP 등 | 2-3일 atomic | 중간 (API surface 변경 — file type 선택 UX 필요) | 약간 단축, file type UX 추가 |
| **γ-4** Pre-warm on page load (background OCCT init) | ~30 LoC + telemetry | **사용자 perceived 0s** if init 완료 후 import 클릭. background init 도중 클릭 시 wait short. | 1-2일 atomic | 낮음 (idle browser cost만 — 메모리/CPU) | 첫 import 즉시 (page 로드 완료 후) |
| **γ-5** Worker thread compile (Web Worker offload) | ~150 LoC + postMessage protocol | main thread responsive (현재도 chunk-based 로 어느정도 OK), compile time 동일 | 5-7일 atomic | 높음 (WASM module passing 복잡, opencascade.js API may not support worker context) | wait 시간 동일, but UI responsive |
| **γ-6** Bundle size reduction (custom OCCT build with only needed APIs) | weeks of OCCT custom build + maintenance | **50-70% bundle 감소** + 그만큼 compile 단축. multi-week, OCCT toolchain 학습 필요 | 2-4주 atomic | 매우 높음 (OCCT custom build 유지보수 부담) | bundle ↓, compile ↓ |
| **γ-7** 묶음 γ-1 + γ-4 (low-risk, immediate impact) | ~60 LoC | 첫 방문: 90~110s. Page reload 후 background init → 사용자 perceived 0s for subsequent imports. | 2-3일 atomic | 낮음 | 90% 가용성 (재방문 시 즉시) |
| **γ-8** 묶음 γ-1 + γ-2 + γ-4 (production-ready full closure) | ~200 LoC + cache invalidation 정책 | 첫 방문 90s, 재방문 5s, pre-warm 0s | 1-1.5주 atomic | 중간 (cache mgmt) | 본질 해소 — 사용자 facing wait 거의 0 |
| **γ-9** Audit / spec only (본 ADR draft) — defer implementation | docs only | 0 (deferred) | 본 PR | 0 | 0 (사용자 결재 후 별도 implementation PR) |

### 2.1 추천 매트릭스 (사용자 가치 × scope × risk)

| 추천 순위 | Option | 근거 |
|---|---|---|
| **1st** | **γ-7 (γ-1 + γ-4)** | 사용자 가치 즉시 (90% gain) + 낮은 risk + 2-3일 atomic — 단순/신속/정확 |
| **2nd** | **γ-8 (γ-1 + γ-2 + γ-4)** | 본질 architectural 해소 (production-ready) + 1-1.5주 atomic — 사용자 가치 100% but cache mgmt 정책 부담 |
| **3rd** | **γ-1 만** (streaming compile only) | 1-2일 minimum atomic, 30-50% gain — 다른 option 보다 작지만 즉시 closure |
| **4th** | **γ-9 (audit 만)** | 즉시 implementation 없이 spec 만 lock-in — γ-1~γ-8 중 어떤 path 인지 사용자 결정 시간 확보 |

### 2.2 Path A 비교 (각 option independent 효과)

| Stage 2 cost | 현재 | γ-1 | γ-2 (2nd load) | γ-3 (STEP only) | γ-4 (after pre-warm) | γ-7 (1+4) | γ-8 (1+2+4) |
|---|---|---|---|---|---|---|---|
| Stage 2 actual | 180s | 110s | 5s | 130s | 0s (background) | 0s (background) | 0s |
| User-perceived wait | 180s | 110s | 5s | 130s | 0s (after page load) | 0s | 0s |

---

## 3. 결재 트리거 (사용자 명시 선택 필요)

본 ADR α (spec only) 는 implementation 0 — 단지 매트릭스 audit + lettered options 제시. 사용자 결재 후 채택된 path 만 별도 atomic sub-step PR 진행 (LOCKED #44 정합).

### 3.1 핵심 결정 항목

- **Q1** Path 선택 — γ-1 / γ-2 / γ-3 / γ-4 / γ-5 / γ-6 / γ-7 / γ-8 중 채택
- **Q2** Atomic 분할 단위 — single PR (γ-7/γ-8) vs sub-step seq (γ-1 먼저, γ-2 후)
- **Q3** 사용자 시연 게이트 위치 — implementation 후 즉시 (γ-7 권장) vs incremental (γ-1 후 → γ-4 후 → γ-2 후)
- **Q4** Cache invalidation 정책 (γ-2 / γ-8 선택 시) — opencascade.js version bump 시 cache 자동 무효화 / 사용자 명시 / TTL 기반?
- **Q5** Pre-warm trigger (γ-4 / γ-7 / γ-8 선택 시) — page load 직후 / idle callback / user idle detection (mouse 정지 N초)?

### 3.2 권장 default (사용자 별도 결정 시 채택)

- **Q1 default**: **γ-7 (γ-1 + γ-4 묶음)** — 단순/신속/정확 canonical 정합. 2-3일 atomic, low risk, 90%+ user-perceived 단축. γ-8 (cache 포함) 은 후속 별도 ADR.
- **Q2 default**: Single atomic PR (γ-7 묶음) — LOCKED #44 의미 단위
- **Q3 default**: Implementation 후 즉시 (사용자 시연 게이트 ADR-087 K-ζ canonical 답습)
- **Q4 N/A** (γ-2 미채택 시)
- **Q5 default**: page load 직후 + idle callback fallback

---

## 4. Out of Scope (별도 ADR per LOCKED #44)

- **γ-2 cache invalidation 세부 정책** (TTL / version-based / manual purge) — γ-7 채택 후 γ-8 trigger 시 별도 ADR
- **γ-6 custom OCCT build** — 2-4주 multi-week, OCCT toolchain learning curve — separate ADR
- **γ-5 worker thread** — opencascade.js worker context 호환성 audit 필요 — separate ADR
- **ADR-085 i18n stage messages** (별도 cross-cut)
- **Bundle size reduction beyond γ-6** — Tree-shaking / dead code elimination on OCCT JS wrapper

---

## 5. Lock-ins (canonical for whichever path is chosen)

- **L-118-1** ADR-082 Drift #5 의 본질 architectural 해소 — ADR-085 perception (Toast progress) 위에 *실제 단축* 추가
- **L-118-2** Initial bundle 0MB strict 유지 (P20.C #2 답습) — opencascade-deps 5.37 MB lazy chunk 유지, 추가 chunk 만 가능
- **L-118-3** No `ocCore` / `ocModelingAlgorithms` 제거 (BRep 의존 — γ-3 시에도 두 lib 유지)
- **L-118-4** ADR-085 Toast progress UX 보존 — pre-warm 시에도 stage 표시 유지 (background init 도 사용자 인지 가능)
- **L-118-5** ADR-046 P31 #4 additive only — API surface (StepIgesImporter.importFile) signature UNCHANGED
- **L-118-6** 사용자 시연 게이트 필수 (ADR-087 K-ζ canonical) — 실제 wait 시간 measure 후 closure
- **L-118-7** 절대 #[ignore] 금지

---

## 6. 사용자 facing 매트릭스 예측 (option 별)

| Stage / Option | Before | γ-1 alone | γ-2 alone (2nd load) | γ-7 (γ-1+γ-4) | γ-8 (γ-1+γ-2+γ-4) |
|---|---|---|---|---|---|
| 첫 import wait | 180s | 110s | 180s (cache miss) | 0s (pre-warm 완료 후) | 0s |
| 재방문 wait | 180s | 110s | 5s | ~0s | 0s |
| Bundle increase | 0 | 0 | 0 | 0 | 0 |
| Implementation risk | n/a | 낮음 | 중간 | 낮음 | 중간 |
| Maintenance burden | n/a | 0 | cache mgmt | 0 | cache mgmt |

---

## 7. Cross-link

- ADR-082 (OCCT real runtime corpus) §Drift #5 — 본 ADR 의 직접 trigger
- ADR-085 (Toast Progress UX) §1.5 Out of scope — "Drift #5 timing 단축 자체 — 별도 architectural ADR"
- ADR-083 (BRepMesh Tessellation MVP) §Visual unlock — Drift #5 단축 후 demo 완전 활성
- ADR-035 P20.C #2 (initial bundle 0MB strict) — 본 ADR 답습
- ADR-046 P31 (P1 + P3 두 페르소나 가치 anchor)
- ADR-087 K-ζ (사용자 시연 게이트 canonical)
- LOCKED #43 priority #3 (STEP timing 단축)
- LOCKED #44 (Complete Meaning per Merge)

---

## 8. 결재 요청 (사용자 명시 선택 필요)

본 spec only PR (α) 은 implementation 0. 사용자 결재 후 채택된 option 의 atomic sub-step PR 진행.

**채택 option 결재** + Q2-Q5 default 채택 여부 명시 부탁드립니다.
