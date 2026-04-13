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
          // dxf/dwgdxf/jszip → import/export 청크
          if (id.includes('node_modules/dxf') ||
              id.includes('node_modules/dwgdxf') ||
              id.includes('node_modules/jszip')) {
            return 'file-io-libs';
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
