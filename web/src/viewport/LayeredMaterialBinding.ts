/**
 * LayeredMaterialBinding — ADR-099 L-δ.
 *
 * Binds a `LayeredChannels` payload to a Three.js `MeshStandardMaterial`
 * by loading each channel through the shared `TextureCache` and assigning
 * to the canonical PBR slots:
 *
 *   albedo   → material.map           (sRGB color space)
 *   normal   → material.normalMap     (linear / no color space)
 *   roughness→ material.roughnessMap  (linear)
 *   metallic → material.metalnessMap  (linear)
 *
 * Lock-ins applied (ADR-099):
 *   - L-E Three.js 4-map binding canonical (map / normalMap /
 *     roughnessMap / metalnessMap) — Three.js MeshStandardMaterial slots
 *   - Color space: only albedo sets `colorSpace = SRGBColorSpace`;
 *     other 3 channels use `NoColorSpace` (linear) per Three.js docs
 *     ("Color maps should be sRGB; data maps should be linear")
 *   - TextureCache 4× — same cache, no new infrastructure (L-E note
 *     "TextureCache 4× 확장"). Single-channel callers (legacy
 *     `applyTextureAsync`) co-exist unchanged
 *   - Backward compat — `applyLayeredChannels` is additive; existing
 *     `applyTextureAsync` / `applyAuxTexturesAsync` paths in Viewport.ts
 *     UNCHANGED until L-ζ migration (separate sub-step)
 *
 * Design choices:
 *   - Pure utility — no direct dependency on Viewport (testable in
 *     isolation against mock material + mock cache)
 *   - Async-friendly — returns a Promise that resolves when all 4
 *     channels have either loaded or rejected (caller may await for
 *     deterministic render ordering)
 *   - Failure isolation — if one channel fails to load, the others
 *     still apply; failures returned as a per-channel error array
 *
 * Out of scope (별도 sub-step):
 *   - L-ε UI integration (TextureUploadDialog 4-tab)
 *   - L-ζ bridge TS wrappers + main.ts wiring
 *   - L-η Real Chromium E2E with actual texture round-trip
 *   - Migrate single-texture VisualProperties.texture/aux → layered
 *     (host responsibility — call before invoking this utility)
 */

import * as THREE from 'three';
import type { LayeredChannels, TextureInfo } from '../materials/MaterialLibrary';

/**
 * Subset of THREE.MeshStandardMaterial used by this utility. Defined as
 * a structural type so tests can pass mocks without instantiating the
 * full Three.js material class.
 */
export interface LayeredBindingTarget {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  metalnessMap: THREE.Texture | null;
  needsUpdate: boolean;
}

/**
 * Subset of TextureCache used by this utility. Same structural-typing
 * approach for test mockability.
 */
export interface TextureCacheLike {
  get(dataUrl: string): THREE.Texture | null;
  load(dataUrl: string): Promise<THREE.Texture>;
}

export type LayeredChannelName = 'albedo' | 'normal' | 'roughness' | 'metallic';

export interface LayeredChannelFailure {
  channel: LayeredChannelName;
  error: string;
}

export interface LayeredBindingResult {
  /** Channels successfully bound (in load-completion order). */
  applied: LayeredChannelName[];
  /** Per-channel load failures. Other channels still bind. */
  failures: LayeredChannelFailure[];
}

/**
 * Apply a `LayeredChannels` payload to a `MeshStandardMaterial`-like
 * target via the supplied `TextureCache`. Resolves when all 4 channels
 * have been attempted (loaded or failed). Sets `target.needsUpdate =
 * true` exactly once at the end if any channel applied.
 *
 * Color space policy (L-E):
 *   - albedo  → SRGBColorSpace
 *   - normal/roughness/metallic → NoColorSpace (linear)
 *
 * Caller may pre-check `LayeredChannels.has_any_channel()` (no helper
 * on TS side; just `Boolean(layered.albedo || layered.normal ||
 * layered.roughness || layered.metallic)`) to skip the call entirely
 * when no channels are populated.
 */
export async function applyLayeredChannels(
  target: LayeredBindingTarget,
  layered: LayeredChannels,
  cache: TextureCacheLike,
): Promise<LayeredBindingResult> {
  const applied: LayeredChannelName[] = [];
  const failures: LayeredChannelFailure[] = [];

  const assign = (slot: keyof LayeredBindingTarget, tex: THREE.Texture, sRGB: boolean) => {
    // Color space — albedo (sRGB) vs data maps (linear/no color space).
    // Mock textures lack `colorSpace`; guard with `in`.
    if ('colorSpace' in tex) {
      try {
        (tex as { colorSpace: string }).colorSpace =
          sRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      } catch { /* read-only or mock — ignore */ }
    }
    (target as unknown as Record<string, THREE.Texture | null>)[slot] = tex;
  };

  const channels: Array<[LayeredChannelName, TextureInfo | undefined, keyof LayeredBindingTarget, boolean]> = [
    ['albedo',    layered.albedo,    'map',          true],
    ['normal',    layered.normal,    'normalMap',    false],
    ['roughness', layered.roughness, 'roughnessMap', false],
    ['metallic',  layered.metallic,  'metalnessMap', false],
  ];

  const loads = channels.map(async ([name, info, slot, sRGB]) => {
    if (!info) return;
    // Try synchronous cache first to avoid an extra Promise tick when
    // the texture is already resident.
    const cached = cache.get(info.dataUrl);
    if (cached) {
      assign(slot, cached, sRGB);
      applied.push(name);
      return;
    }
    try {
      const tex = await cache.load(info.dataUrl);
      assign(slot, tex, sRGB);
      applied.push(name);
    } catch (e) {
      failures.push({
        channel: name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  await Promise.all(loads);
  if (applied.length > 0) {
    target.needsUpdate = true;
  }
  return { applied, failures };
}

/**
 * Synchronously clear all 4 layered channels from a target material.
 * Used when a material loses its layered payload (e.g. all 4 channels
 * cleared via `clearLayeredChannel`). `needsUpdate` set when any slot
 * was non-null before.
 */
export function clearLayeredChannels(target: LayeredBindingTarget): void {
  let changed = false;
  if (target.map) { target.map = null; changed = true; }
  if (target.normalMap) { target.normalMap = null; changed = true; }
  if (target.roughnessMap) { target.roughnessMap = null; changed = true; }
  if (target.metalnessMap) { target.metalnessMap = null; changed = true; }
  if (changed) target.needsUpdate = true;
}

/**
 * Quick predicate — has at least one populated channel? Mirrors Rust
 * `LayeredChannels::has_any_channel`.
 */
export function hasAnyLayeredChannel(layered: LayeredChannels): boolean {
  return Boolean(
    layered.albedo || layered.normal || layered.roughness || layered.metallic,
  );
}
