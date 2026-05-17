# ADR-124 — WASM SIMD Activation (β implementation of ADR-123 Q1=D)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β implementation single atomic PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — ADR-123 Q1=D + Q2=ADR-123 D 먼저 → ADR-122 α-1 후속) |
| Anchor | ADR-123 §2 Option D — *"WASM SIMD activation"* 1st recommendation (단순/신속/정확, 2-3일 atomic, 매우 낮은 risk, 2-4× immediate gain) |
| Parent | ADR-123 (α spec — 10 lettered AxiA-native options matrix), ADR-118 / ADR-119 (α spec → β impl atomic 패턴 답습) |
| Cross-cut | ADR-035 P20.C #2 (initial bundle 0MB strict), ADR-046 P31 #4 (additive only), LOCKED #44 (Complete Meaning per Merge) |

---

## 1. Canonical Anchor

ADR-123 α spec 의 결재:
> "결재 승인합니다"

= Q1=D + Q2=ADR-123 D 먼저 → ADR-122 α-1 후속 + Q3/Q4 default 채택.

본 ADR-124 는 ADR-123 Q1=D 의 *single atomic PR β implementation* (ADR-118 → ADR-119 패턴 1:1 mirror).

## 2. Change Summary

### 2.1 New file: `.cargo/config.toml`

```toml
[target.wasm32-unknown-unknown]
rustflags = [
    "-C", "target-feature=+simd128",
]
```

Cargo 가 `wasm32-unknown-unknown` target 빌드 시 자동 적용. 모든 wasm-pack 호출 site (build.yml / ci.yml / deploy.yml / mcp.yml / release.yml / update-visual-baselines.yml / ensure-wasm.mjs / web/scripts) 가 **수정 0** 으로 SIMD 활성화. Single SSOT per L-124-1.

### 2.2 New verifier: `web/scripts/verify-simd.mjs`

Post-build evidence check:
- `.cargo/config.toml` SSOT 무결성 (file exists + section header + +simd128 + target-feature= form)
- `axia_wasm_bg.wasm` Code section 의 0xFD-prefixed SIMD opcode count (≥ 50 임계)
- Bonus telemetry: Code section size / Total WASM size / SIMD opcode count

WASM module walker 가 sections 를 parse 하여 Code section bytes 만 scan — naive 전체 binary scan 보다 false positive 회피.

### 2.3 `web/package.json` `wasm:verify` 확장

```json
"wasm:verify": "node scripts/verify-wasm.mjs && node scripts/verify-simd.mjs",
"wasm:verify-simd": "node scripts/verify-simd.mjs"
```

기존 `verify-wasm.mjs` UNCHANGED, drop-in 추가. `npm run build:wasm` 이 자동으로 SIMD 검증 통과 확인.

### 2.4 New regression test: `web/src/build/wasmSimdActivation.test.ts`

Vitest source-level guard (6 tests, WASM 빌드 없이 실행 가능):
- `.cargo/config.toml` exists
- `[target.wasm32-unknown-unknown]` section header
- `+simd128` flag present (quoted or unquoted form 둘 다 허용)
- `rustflags = [...]` array form (string form 거부 — Cargo 가 안 honor 함)
- ADR-124 + ADR-123 reference comments (drift documentation)
- 다른 target override 없음 (scope creep 방지 — native build 보호)

## 3. Lock-ins (canonical, L-124-1 ~ L-124-8)

- **L-124-1** `.cargo/config.toml` = SSOT (Single Source of Truth) — 모든 wasm-pack 호출 site 수정 없이 자동 적용. 향후 새 workflow 추가 시 RUSTFLAGS 환경변수 설정 불필요.
- **L-124-2** Target-specific only — `[target.wasm32-unknown-unknown]` section 만 사용. Native cargo 빌드 (Linux/macOS/Windows host) 영향 0. 회귀 테스트로 강제 (다른 target section 추가 시 fail).
- **L-124-3** Regression guard 2-layer — vitest source-level (`wasmSimdActivation.test.ts` 6 tests) + post-build binary scan (`verify-simd.mjs` 8 checks). 둘 중 하나라도 fail = CI block.
- **L-124-4** SIMD evidence threshold = 50 opcodes — Rust 1.75+ 의 typical auto-vectorization 최소 임계 (실측 7221 opcodes — Code section 2.1 MB 의 0.33%). 임계 미달 시 source 의 hot loop 가 vectorize 불가능한 상태로 회귀했음을 의미.
- **L-124-5** Initial bundle 0MB strict 유지 (P20.C #2) — `axia_wasm_bg.wasm` size 변화 measurement 후 confirm (실측: 2410.4 KB, SIMD opcodes 가 compact 함). 사용자 facing bundle 영향 0.
- **L-124-6** ADR-046 P31 #4 additive only — Public API surface UNCHANGED. `unsafe` SIMD intrinsics 사용 0 (Rust 1.75+ 의 LLVM auto-vectorization 만 활용).
- **L-124-7** Browser 호환성 보장 — `+simd128` 은 WebAssembly SIMD W3C standardized (2021). Chrome 91+ / Firefox 89+ / Safari 16.4+ / Edge 91+ / Node 16.4+. caniuse 99%+ 지원 (2026-05-17).
- **L-124-8** 절대 #[ignore] 금지 — 6 vitest + 8 verify-simd checks 모두 unconditional.

## 4. 측정 매트릭스 (실측 evidence)

### 4.1 빌드 evidence

```
wasm-pack build --target web 결과:
  Finished `release` profile [optimized] target(s) in 20.65s
  axia_wasm_bg.wasm 2410.4 KB (Code section 2121.1 KB)
```

verify-simd.mjs 결과:
```
✓ .cargo/config.toml SSOT 4 checks
✓ WASM binary 4 checks (magic / version / code section / SIMD opcodes ≥ 50)
✓ Code section size: 2121.1 KB
✓ Total WASM size:   2410.4 KB
✓ SIMD opcode count: 7221  ← 강력한 auto-vectorization evidence
```

### 4.2 회귀 사양

| Layer | 결과 |
|---|---|
| axia-core (native cargo test) | 302 passed / 0 failed |
| axia-geo (native cargo test) | 1392 passed / 0 failed |
| axia-wasm (native cargo test) | 0 tests (cdylib only) |
| vitest (TS) | 1916 passed / 0 failed / 1 skipped — **+6 ADR-124 SIMD regression** |
| verify-wasm.mjs | All checks passed |
| verify-simd.mjs | All checks passed |

**합계 +6 회귀** (절대 #[ignore] 금지 6/6 준수).

### 4.3 Expected runtime gain (ADR-123 §1.3 finding #1 추정)

ADR-123 §1.3 의 expectation 은 *2-4× engine compute 가속* — Vec3 ops (dot / cross / normalize), Newell normal sum, Boolean SSI Newton steps 의 hot loops. Auto-vectorization 결과의 *실제 runtime benchmark* 는 다음 atomic ADR (별도 evidence track) 의 scope. 본 ADR 은 *SIMD 활성화 자체* 의 architectural lock-in.

### 4.4 사용자 facing 변화 매트릭스

| 측면 | Before | After ADR-124 |
|---|---|---|
| Public API | UNCHANGED | UNCHANGED |
| Initial bundle size | 724.99 kB (LOCKED #32 baseline) | 724.99 kB (변화 0, WASM lazy chunk) |
| `axia_wasm_bg.wasm` | (pre-SIMD baseline 없음 — 즉시 활성화) | 2410.4 KB with 7221 SIMD opcodes |
| Build complexity | wasm-pack default | `.cargo/config.toml` 추가 (1 file) |
| Browser compatibility | All modern | Same (Safari 16.4+ 이미 baseline) |
| Engine compute speed | 1× baseline | 2-4× (auto-vectorized hot loops, 실측 benchmark 별도 ADR) |

## 5. Out of Scope (별도 ADR per LOCKED #44)

- **Runtime benchmark evidence** — 실제 syncMesh / Boolean SSI / Newell normal 의 before/after wall-clock — 별도 trigger ADR (사용자 시연 게이트 후)
- **`std::simd` / `core::arch::wasm32` intrinsics 직접 사용** — Auto-vectorization 으로 부족한 hot loop 발견 시 별도 ADR (현재 unsafe SIMD intrinsics 0)
- **Threads + Atomics** (Web Worker 다중 thread SIMD) — ADR-123 Option G 의 자연 후속, 별도 multi-week ADR
- **WASM relaxed-simd** (FMA, swizzle, dot product) — relaxed-simd 는 별도 target-feature (2024+ 표준화), 별도 ADR 시 추가
- **Linux/macOS/Windows native SIMD** — `[target.x86_64-*]` / `[target.aarch64-*]` 등 추가 — L-124-2 의 scope creep 차단 (현재 wasm only)
- **WebGPU compute shader** — 다른 architectural ADR (ADR-123 Option F)

## 6. Cross-link

- **ADR-123** — α spec 의 직접 β implementation (Q1=D)
- **ADR-122** — Q2 next step (병행 또는 후속)
- **ADR-118 → ADR-119** — α spec → β impl atomic 패턴 source (본 ADR 답습)
- **ADR-035 P20.C #2** — initial bundle 0MB strict (L-124-5)
- **ADR-046 P31 #4** — additive only (L-124-6)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical (runtime benchmark trigger 시)
- **LOCKED #44** — Complete Meaning per Merge (single atomic PR)
- **LOCKED #43 priority audit** — 본 ADR 은 priority 매트릭스 외부 — architectural performance optimization

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| β-1 `.cargo/config.toml` SSOT | ✅ | `[target.wasm32-unknown-unknown]` + `+simd128` + ADR-123/124 reference comments |
| β-2 WASM build 검증 | ✅ | `wasm-pack build` succeeds (20.65s) |
| β-3 SIMD opcode evidence | ✅ | 7221 opcodes in Code section (≥ 50 threshold) |
| β-4 `web/scripts/verify-simd.mjs` post-build verifier | ✅ | 8 checks (SSOT + binary evidence) |
| β-5 `web/package.json` `wasm:verify` 통합 | ✅ | drop-in 추가, 기존 verify-wasm.mjs UNCHANGED |
| β-6 `web/src/build/wasmSimdActivation.test.ts` vitest regression | ✅ | 6 tests source-level guard |
| β-7 Native cargo tests 회귀 | ✅ | axia-core 302 / axia-geo 1392 / axia-wasm 0 — 모두 unchanged |
| β-8 Vitest full suite 회귀 | ✅ | 1916 passed (+6 ADR-124) / 1 skipped / 0 failed |
| β-9 CLAUDE.md LOCKED entry | ✅ | LOCKED #54 신규 |
| β-10 회고 + closure (본 PR) | ✅ | 본 ADR + commit + PR |

## E. Lessons (canonical for future build-flag ADRs)

- **L-124-α-1 — `.cargo/config.toml` SSOT 의 architectural 가치**: 6 GitHub Actions workflows + 1 dev script (ensure-wasm.mjs) + 2 npm scripts (wasm:build / wasm:build:nodejs) = **9 wasm-pack 호출 site 모두 영향**. RUSTFLAGS 환경변수 방식이었다면 각각 수정 필요 — single SSOT 가 향후 새 workflow 추가 시에도 자동 적용. 향후 build-flag 변경 (예: opt-level / lto / debug-info) 도 동일 패턴 권장.
- **L-124-α-2 — 2-layer regression guard 패턴**: vitest source-level (config 파일 자체 검증) + post-build binary scan (실제 compile output 검증). 한 layer 만 있으면 *config 만 보존되고 binary 가 regress* 또는 *binary 는 OK 인데 config 가 stale* case 둘 다 가능. 향후 build-output-affecting ADR 모두 2-layer 강제 권장.
- **L-124-α-3 — Auto-vectorization 의존의 risk-management**: `+simd128` 만으로 *모든* hot loop 가 자동 vectorize 되지 않음 — LLVM 의 vectorization heuristic 에 의존. 향후 runtime benchmark (별도 ADR) 에서 fall short 한 hot loop 발견 시 `unsafe` `core::arch::wasm32::*` intrinsics 직접 사용 (별도 ADR scope, L-124-out-of-scope §5 #2).
- **L-124-α-4 — Browser 호환성의 baseline shift**: Safari 16.4 (March 2023) 가 WASM SIMD baseline. 본 ADR 은 *그 baseline 위에서만 안전* — 그 이전 Safari 사용자는 WASM 로딩 실패. ADR-082 / ADR-119 가 OCCT.js / Drift #5 의 browser baseline 을 이미 modern 으로 끌어올렸으므로 (CAD interop 자체가 modern browser 필요), 본 ADR 의 baseline shift 는 incremental 위험 0.
- **L-124-α-5 — Single atomic PR per LOCKED #44 의 정확 적용**: β implementation 의 *모든 layer* (build config + verifier script + npm integration + vitest guard + ADR docs + LOCKED entry) 가 단일 PR. 부분 merge 시 invariant violation (예: config 만 추가하고 guard 없으면 silent regression risk). 향후 build-output-affecting ADR 모두 동일 atomic 강제.
