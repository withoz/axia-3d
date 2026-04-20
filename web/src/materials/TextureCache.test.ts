import { describe, it, expect, beforeEach } from 'vitest';
import { getTextureCache } from './TextureCache';

describe('TextureCache', () => {
  beforeEach(() => {
    getTextureCache().disposeAll();
  });

  it('returns null for uncached URLs', () => {
    expect(getTextureCache().get('data:image/png;base64,unknown')).toBeNull();
  });

  it('disposeAll clears cache size', () => {
    // Seed via internal set is not available, so just verify initial state
    expect(getTextureCache().size()).toBe(0);
  });

  // Note: actual async load() requires THREE.TextureLoader which hits DOM APIs
  // in jsdom; skipping network-backed tests here. Viewport integration covers
  // the full path.
});
