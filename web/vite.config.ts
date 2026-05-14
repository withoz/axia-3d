import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';

/**
 * ADR-082 C-ε amendment (drift #3 fix):
 *   opencascade.js 의 `module.TK*.wasm` 파일들은 Emscripten 의 `env`
 *   import 를 가짐 — Rollup 의 ESM 링킹과 호환 안 됨. 이들을 URL 문자열
 *   로 처리하는 plugin (`?url` 효과를 자동 적용).
 *
 *   효과: opencascade.js index.js 의 `export { default as TK* } from
 *   './module.TK*.wasm'` 가 *URL string* 으로 해석되어 Emscripten loader
 *   가 fetch + instantiate. Rollup 은 .wasm 을 module 로 링크 시도하지
 *   않음.
 */
function opencascadeWasmAsUrl(): Plugin {
  return {
    name: 'opencascade-wasm-as-url',
    enforce: 'pre',
    async resolveId(source, importer) {
      // opencascade.js 내부의 .wasm import 만 가로채기 (다른 wasm 패키지
      // 영향 없음 — wasm-pack 산출 등은 vite-plugin-wasm 정상 처리)
      if (
        source.endsWith('.wasm') &&
        importer &&
        importer.includes('opencascade.js')
      ) {
        // 자기 자신을 resolve 한 후 ?url suffix 부착으로 Vite 가 URL 처리
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (resolved) {
          return resolved.id + '?url';
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [opencascadeWasmAsUrl(), wasm()],
  /**
   * 2026-05-14 — Relative base for multi-host deployment.
   *
   * The same dist/ ships to two hosts:
   *   1. https://withoz.github.io/axia-3d/   (GitHub Pages, subpath)
   *   2. https://aixxia.kr/                  (custom domain, apex)
   *
   * Default Vite `base: '/'` produces absolute asset URLs like
   * `/assets/index-XXX.js`, which resolve to:
   *   - GitHub Pages: `withoz.github.io/assets/index-XXX.js` → 404
   *     (assets actually live at `/axia-3d/assets/...`)
   *   - aixxia.kr   : `aixxia.kr/assets/...` → OK
   *
   * Setting `base: './'` emits relative URLs (`./assets/index-XXX.js`),
   * which resolve correctly against whatever base path the page is
   * served from. This is the canonical "deploy-anywhere" setting for
   * SPAs that need to work at multiple roots without rebuilding.
   *
   * Trade-off: dynamic imports inside the code that compute URLs by
   * hand must use `import.meta.env.BASE_URL` rather than hard-coded
   * `/...` prefixes. Existing code uses Vite's standard import paths,
   * which are unaffected.
   */
  base: './',
  server: {
    port: 3000,
    open: true,
  },
  /**
   * ADR-082 C-ε amendment (dev server hang 방지):
   *   opencascade.js 는 ~250MB unzipped + 50+ WASM modules — Vite 의
   *   dev server pre-bundling (esbuild) 이 처리하려다가 hang 또는
   *   극단 지연 발생. lazy import (`() => import('opencascade.js')`)
   *   는 production build 에선 정상 (lazy chunk) 이지만 dev mode 에선
   *   dependency optimization 단계가 별도로 실행됨.
   *
   *   `optimizeDeps.exclude` 로 dev server 가 opencascade.js 를 pre-bundle
   *   안 하도록 강제 — runtime 시 lazy load 만. production build 는 영향
   *   없음 (manualChunks 가 별도 처리).
   */
  optimizeDeps: {
    exclude: ['opencascade.js'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Three.js 로더 → 별도 청크 (import 시에만 로딩)
          if (id.includes('three/examples/jsm/loaders/')) {
            return 'three-loaders';
          }
          // dxf/dwgdxf/jszip/rhino3dm → import/export 청크
          if (id.includes('node_modules/dxf') ||
              id.includes('node_modules/dwgdxf') ||
              id.includes('node_modules/jszip') ||
              id.includes('node_modules/rhino3dm')) {
            return 'file-io-libs';
          }
          // OCCT.js (STEP/IGES) → 분리 청크 (ADR-035 P20.1, ADR-082 C-ε).
          // dependencies 등급 (ADR-082 §3.5 amendment) — lazy chunk 강제.
          if (id.includes('node_modules/opencascade.js')) {
            return 'opencascade-deps';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
