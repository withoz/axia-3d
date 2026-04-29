import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  server: {
    port: 3000,
    open: true,
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
          // OCCT.js (STEP/IGES) → 분리 청크 (ADR-035 P20.1).
          // optionalDependency — 설치 시에만 chunk 생성. 메인 번들 영향 0.
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
