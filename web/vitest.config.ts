import { defineConfig } from 'vitest/config';

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
    // Mock Three.js and WASM modules that can't run in Node
    alias: {
      'three': './src/__mocks__/three.ts',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
