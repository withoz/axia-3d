/**
 * ADR-099 L-δ — LayeredMaterialBinding utility tests.
 *
 * Pure utility (no Three.js DOM) — uses structural mocks for material
 * + cache. Verifies 4-channel binding, color-space policy, failure
 * isolation, and clear/predicate helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  applyLayeredChannels,
  clearLayeredChannels,
  hasAnyLayeredChannel,
  type LayeredBindingTarget,
  type TextureCacheLike,
} from './LayeredMaterialBinding';
import type { LayeredChannels, TextureInfo } from '../materials/MaterialLibrary';

function makeTarget(): LayeredBindingTarget {
  return {
    map: null,
    normalMap: null,
    roughnessMap: null,
    metalnessMap: null,
    needsUpdate: false,
  };
}

function makeTex(label: string): THREE.Texture {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { __label: label, colorSpace: '' } as any;
}

function makeCache(
  preloaded: Record<string, THREE.Texture> = {},
): TextureCacheLike {
  const map = new Map(Object.entries(preloaded));
  return {
    get: (url: string) => map.get(url) ?? null,
    load: vi.fn(async (url: string) => {
      const tex = makeTex(`loaded:${url}`);
      map.set(url, tex);
      return tex;
    }),
  };
}

function info(url: string): TextureInfo {
  return { dataUrl: url, projection: 'planar', scale: 0.001 };
}

describe('LayeredMaterialBinding (L-δ)', () => {
  describe('hasAnyLayeredChannel', () => {
    it('false for empty layered', () => {
      expect(hasAnyLayeredChannel({})).toBe(false);
    });

    it('true when albedo only', () => {
      expect(hasAnyLayeredChannel({ albedo: info('a') })).toBe(true);
    });

    it('true when metallic only', () => {
      expect(hasAnyLayeredChannel({ metallic: info('m') })).toBe(true);
    });
  });

  describe('applyLayeredChannels', () => {
    let target: LayeredBindingTarget;

    beforeEach(() => {
      target = makeTarget();
    });

    it('binds all 4 channels asynchronously', async () => {
      const layered: LayeredChannels = {
        albedo: info('albedo.png'),
        normal: info('normal.png'),
        roughness: info('roughness.png'),
        metallic: info('metallic.png'),
      };
      const cache = makeCache();
      const result = await applyLayeredChannels(target, layered, cache);

      expect(target.map).not.toBeNull();
      expect(target.normalMap).not.toBeNull();
      expect(target.roughnessMap).not.toBeNull();
      expect(target.metalnessMap).not.toBeNull();
      expect(target.needsUpdate).toBe(true);
      expect(result.applied).toHaveLength(4);
      expect(result.applied.sort()).toEqual(
        ['albedo', 'metallic', 'normal', 'roughness'],
      );
      expect(result.failures).toHaveLength(0);
    });

    it('binds partial subset (albedo only)', async () => {
      const layered: LayeredChannels = { albedo: info('a.png') };
      const cache = makeCache();
      const result = await applyLayeredChannels(target, layered, cache);

      expect(target.map).not.toBeNull();
      expect(target.normalMap).toBeNull();
      expect(target.roughnessMap).toBeNull();
      expect(target.metalnessMap).toBeNull();
      expect(result.applied).toEqual(['albedo']);
    });

    it('no-op for empty layered (needsUpdate stays false)', async () => {
      const cache = makeCache();
      const result = await applyLayeredChannels(target, {}, cache);
      expect(target.needsUpdate).toBe(false);
      expect(result.applied).toHaveLength(0);
    });

    it('uses synchronous cache.get when texture pre-loaded', async () => {
      const cached = makeTex('cached');
      const cache = makeCache({ 'pre.png': cached });
      await applyLayeredChannels(target, { albedo: info('pre.png') }, cache);
      expect(target.map).toBe(cached);
      // load should NOT have been called (cache hit).
      expect((cache.load as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('L-E color space — albedo sRGB, others NoColorSpace', async () => {
      const layered: LayeredChannels = {
        albedo: info('a.png'),
        normal: info('n.png'),
      };
      const cache = makeCache();
      await applyLayeredChannels(target, layered, cache);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((target.map as any)?.colorSpace).toBe(THREE.SRGBColorSpace);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((target.normalMap as any)?.colorSpace).toBe(THREE.NoColorSpace);
    });

    it('failure isolation — one channel fails, others bind', async () => {
      const cache: TextureCacheLike = {
        get: () => null,
        load: vi.fn(async (url: string) => {
          if (url === 'normal.png') throw new Error('bad normal');
          return makeTex(url);
        }),
      };
      const layered: LayeredChannels = {
        albedo: info('albedo.png'),
        normal: info('normal.png'),
        roughness: info('roughness.png'),
      };
      const result = await applyLayeredChannels(target, layered, cache);

      expect(target.map).not.toBeNull();
      expect(target.normalMap).toBeNull(); // failed
      expect(target.roughnessMap).not.toBeNull();
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].channel).toBe('normal');
      expect(result.failures[0].error).toContain('bad normal');
      expect(result.applied.sort()).toEqual(['albedo', 'roughness']);
    });

    it('needsUpdate stays false when ALL channels fail', async () => {
      const cache: TextureCacheLike = {
        get: () => null,
        load: vi.fn(async () => { throw new Error('all fail'); }),
      };
      const result = await applyLayeredChannels(
        target,
        { albedo: info('a.png'), normal: info('n.png') },
        cache,
      );
      expect(target.needsUpdate).toBe(false);
      expect(result.applied).toHaveLength(0);
      expect(result.failures).toHaveLength(2);
    });
  });

  describe('clearLayeredChannels', () => {
    it('clears all 4 slots when populated', () => {
      const target = makeTarget();
      target.map = makeTex('a');
      target.normalMap = makeTex('n');
      target.roughnessMap = makeTex('r');
      target.metalnessMap = makeTex('m');
      clearLayeredChannels(target);
      expect(target.map).toBeNull();
      expect(target.normalMap).toBeNull();
      expect(target.roughnessMap).toBeNull();
      expect(target.metalnessMap).toBeNull();
      expect(target.needsUpdate).toBe(true);
    });

    it('no-op when all already null (needsUpdate stays false)', () => {
      const target = makeTarget();
      clearLayeredChannels(target);
      expect(target.needsUpdate).toBe(false);
    });

    it('partial clear (some null already)', () => {
      const target = makeTarget();
      target.map = makeTex('a');
      // normal/roughness/metallic stay null
      clearLayeredChannels(target);
      expect(target.map).toBeNull();
      expect(target.needsUpdate).toBe(true);
    });
  });
});
