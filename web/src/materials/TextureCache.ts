/**
 * TextureCache — dataUrl → THREE.Texture with LRU-style caching.
 *
 * - Avoids re-decoding the same base64 image on every mesh rebuild
 * - Exposes `dispose()` to release GPU memory when the cache is cleared
 * - Synchronous access (returns already-cached Texture); asynchronous load for new URLs
 *
 * Usage:
 *   const tex = await textureCache.load(dataUrl);
 *   mesh.material.map = tex;
 */

import * as THREE from 'three';

type CacheEntry = { texture: THREE.Texture; refCount: number };

class TextureCacheImpl {
  private cache = new Map<string, CacheEntry>();

  /** Load or return cached THREE.Texture for a data URL. */
  async load(dataUrl: string): Promise<THREE.Texture> {
    const existing = this.cache.get(dataUrl);
    if (existing) {
      existing.refCount++;
      return existing.texture;
    }

    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        dataUrl,
        (tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        (err) => reject(err),
      );
    });

    this.cache.set(dataUrl, { texture, refCount: 1 });
    return texture;
  }

  /** Synchronous lookup — returns cached Texture or null if not yet loaded. */
  get(dataUrl: string): THREE.Texture | null {
    return this.cache.get(dataUrl)?.texture ?? null;
  }

  /** Release one reference; if count hits 0, dispose GPU memory. */
  release(dataUrl: string): void {
    const entry = this.cache.get(dataUrl);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      entry.texture.dispose();
      this.cache.delete(dataUrl);
    }
  }

  /** Dispose all textures (e.g. on viewport tear-down). */
  disposeAll(): void {
    for (const entry of this.cache.values()) {
      entry.texture.dispose();
    }
    this.cache.clear();
  }

  /** Stats for debugging. */
  size(): number {
    return this.cache.size;
  }
}

const instance = new TextureCacheImpl();

export function getTextureCache(): TextureCacheImpl {
  return instance;
}

export type { TextureCacheImpl as TextureCache };
