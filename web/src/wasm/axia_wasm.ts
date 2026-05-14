/**
 * Tracked TypeScript stub for `web/src/wasm/axia_wasm`.
 *
 * Why this exists
 * ───────────────
 * LOCKED #40 follow-up (2026-05-14, PR #18) untracked the wasm-pack
 * output files (`axia_wasm.js` / `axia_wasm.d.ts` / `axia_wasm_bg.wasm`
 * / `axia_wasm_bg.wasm.d.ts`) so the binary cannot desync from source.
 * Production / dev clones rebuild these via `wasm-pack build` (called
 * by the `postinstall` hook in `web/package.json`).
 *
 * However the `test` job in `.github/workflows/build.yml` runs without
 * a Rust toolchain (it only typechecks + runs vitest), so the artifact
 * is absent there. `WasmBridge.ts` imports `init` and `AxiaEngine` from
 * `../wasm/axia_wasm`, and Vite's import analysis rejects unresolved
 * modules at *transform* time — even when tests later replace them via
 * `vi.mock(...)` with a factory.
 *
 * This `.ts` stub gives Vite a real file to resolve against. Module
 * resolution precedence in `vite` / `vitest` is `.js` > `.ts`, so:
 *
 *   • Production (wasm-pack ran): `axia_wasm.js` exists → Vite picks
 *     it. This stub is silently ignored. Behaviour unchanged from
 *     pre-LOCKED-#40 era.
 *   • Test (`build.yml` test job, no Rust): only `axia_wasm.ts` exists
 *     → Vite resolves to it. `vi.mock(...)` in test files then replaces
 *     the export at runtime; the stub itself is never executed.
 *
 * `wasm-pack build` writes `axia_wasm.js` and `axia_wasm.d.ts` but
 * does NOT touch `axia_wasm.ts`, so committing this file is safe
 * across rebuilds.
 *
 * The stub's runtime behaviour is intentionally trivial — every test
 * that depends on it overrides via `vi.mock` with a factory. The stub
 * exists to satisfy the resolver, not to provide functionality.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Stand-in for the wasm-bindgen-generated `AxiaEngine` class. The
 * shape mirrors the real generated `.d.ts` enough that TS doesn't
 * complain at import sites; all methods are no-ops because every
 * test mocks them via `vi.mock`.
 */
export class AxiaEngine {
  free(): void {
    /* no-op stub — tests replace this via vi.mock */
  }
}

/**
 * Stand-in for the wasm-bindgen-generated init function. Mirrors the
 * "default export is an init function returning a thenable" shape that
 * `WasmBridge.boot` awaits.
 */
const init = (_input?: unknown): Promise<unknown> => Promise.resolve({});

export default init;
