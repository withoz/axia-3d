/**
 * FurShell — shell-technique fur overlay on a target Three.js mesh.
 *
 * The shell trick:
 *   - Duplicate the base mesh N times, each duplicate slightly expanded
 *     along vertex normals (layer k at offset = k * spacing).
 *   - Each shell gets a semi-transparent material with a procedural
 *     hair-like alpha pattern. Inner shells are denser; outer shells
 *     fade out and carry the tips.
 *   - Viewed from any angle, the overlapping semi-transparent shells
 *     appear as volumetric fur — this is how many real-time games
 *     (Pokemon Legends: Arceus, Shadow of the Colossus, etc.) ship fur.
 *
 * No texture assets required: the alpha pattern is a GLSL random
 * function based on 3D position + layer index. Color/length are
 * parameters.
 *
 * Designed to attach to a SINGLE source mesh (e.g. the puppy body).
 * Call `attach(mesh)` to replace any previously-attached shells.
 * `dispose()` removes all shells and frees GPU resources.
 */

import * as THREE from 'three';

export interface FurOptions {
  /** Fur length in world units (mm). */
  length?: number;
  /** Number of shell layers. More layers = denser fur, higher cost. */
  layers?: number;
  /** Base color (hex). */
  color?: number;
  /** Tip color (hex) — interpolated to over shell layers. */
  tipColor?: number;
  /** Density 0–1; higher = more hairs visible. */
  density?: number;
}

const VERT_SHADER = /* glsl */ `
  uniform float uShellOffset;
  uniform float uFurLength;
  varying vec3  vWorldPos;
  varying float vShellT;
  varying vec3  vNormal;

  void main() {
    vShellT = uShellOffset;
    vec3 offset = normal * uShellOffset * uFurLength;
    vec4 worldPos = modelMatrix * vec4(position + offset, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAG_SHADER = /* glsl */ `
  precision highp float;
  varying vec3  vWorldPos;
  varying float vShellT;
  varying vec3  vNormal;
  uniform vec3  uBaseColor;
  uniform vec3  uTipColor;
  uniform float uDensity;

  // 3D value-noise-ish hash — stable per world-position sampling seed.
  float hash(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p + 23.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    // Sample a stable "hair bundle" seed in world space. A slight
    // per-shell shift keeps hairs correlated across layers so a single
    // tuft rises together rather than each layer being independent.
    vec3 seed = floor(vWorldPos * 8.0);   // ~125 micro-bundles per world unit
    float h = hash(seed);

    // Discard this fragment if we're outside the "hair" at this shell:
    // keeping fewer hairs as we climb gives the classic tapered tip look.
    float visible = h < (uDensity * (1.0 - vShellT * 0.6)) ? 1.0 : 0.0;
    if (visible < 0.5) discard;

    // Base → tip color ramp driven by shell depth.
    vec3 col = mix(uBaseColor, uTipColor, vShellT);

    // Soft lighting: Lambertian against a fixed key direction. The
    // main-scene lights already lit the base mesh, so this tiny
    // contribution just keeps fur from looking pasted-on flat.
    float lambert = max(dot(vNormal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
    col *= 0.55 + 0.45 * lambert;

    // Alpha fade toward the tip for soft silhouette.
    float alpha = 1.0 - vShellT * vShellT;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class FurShell {
  private parent: THREE.Object3D | null = null;
  private shellGroup: THREE.Group;

  constructor() {
    this.shellGroup = new THREE.Group();
    this.shellGroup.name = 'fur-shell-group';
    this.shellGroup.userData.nonInteractive = true;
  }

  /**
   * Attach fur to a source mesh. Reuses the mesh's geometry (shared,
   * no copy) and places the new material on each of N shell layers
   * positioned as siblings of the source.
   */
  attach(sourceMesh: THREE.Mesh, options: FurOptions = {}): void {
    this.dispose();

    const opts = {
      length: options.length ?? 40,
      layers: options.layers ?? 24,
      color: options.color ?? 0xc99468,
      tipColor: options.tipColor ?? 0xf5e9d8,
      density: options.density ?? 0.6,
    };

    const baseColor = new THREE.Color(opts.color);
    const tipColor = new THREE.Color(opts.tipColor);

    for (let i = 1; i <= opts.layers; i++) {
      const t = i / opts.layers;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uShellOffset: { value: t },
          uFurLength:   { value: opts.length },
          uBaseColor:   { value: baseColor },
          uTipColor:    { value: tipColor },
          uDensity:     { value: opts.density },
        },
        vertexShader: VERT_SHADER,
        fragmentShader: FRAG_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const shell = new THREE.Mesh(sourceMesh.geometry, mat);
      shell.name = `fur-shell-${i}`;
      shell.userData.nonInteractive = true;
      // Render after the opaque mesh. Higher layer = later.
      shell.renderOrder = 1000 + i;
      shell.frustumCulled = sourceMesh.frustumCulled;
      this.shellGroup.add(shell);
    }

    // Attach as sibling — matches source mesh's transform + parent.
    const parent = sourceMesh.parent ?? sourceMesh;
    parent.add(this.shellGroup);
    this.shellGroup.position.copy(sourceMesh.position);
    this.shellGroup.rotation.copy(sourceMesh.rotation);
    this.shellGroup.scale.copy(sourceMesh.scale);
    this.parent = parent;
  }

  /** True if fur is currently attached. */
  get active(): boolean {
    return this.shellGroup.children.length > 0;
  }

  /** Remove all shell meshes and free their materials. */
  dispose(): void {
    for (const child of [...this.shellGroup.children]) {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.Material).dispose();
      }
      this.shellGroup.remove(child);
    }
    if (this.parent) {
      this.parent.remove(this.shellGroup);
      this.parent = null;
    }
  }
}
