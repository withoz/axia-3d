import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/wasm/**', 'src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: '/src' },
      // Mock Three.js — exact match only so three/examples/... still resolves from node_modules
      { find: /^three$/, replacement: resolve(__dirname, 'src/__mocks__/three.ts') },
    ],
  },
});
