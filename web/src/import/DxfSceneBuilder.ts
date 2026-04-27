/**
 * DxfSceneBuilder — convert a parsed DXF document into a THREE.Group
 * with proper hierarchy:
 *
 *   group ("import-dxf-<file>")
 *     ├─ layerGroup ("0", layer "0")          userData.layer = {...}
 *     │   ├─ entity-mesh   userData.entity = original DXF entity
 *     │   └─ ...
 *     ├─ layerGroup ("Walls")
 *     │   ├─ entity-mesh
 *     │   └─ blockInstance ("INSERT door-typ-A")  contains cloned entity meshes
 *     └─ ...
 *
 * Goals:
 *   1. Layer awareness — each entity goes to its named layer group, with
 *      DXF layer color / visibility / lock state preserved as userData.
 *   2. BLOCK / INSERT — block definitions are cached as template Groups;
 *      each INSERT entity instantiates a clone of the template, applying
 *      translation, rotation (around Z), scale, and row/column array.
 *   3. Full entity coverage — LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE
 *      / SOLID / FACE / 3DFACE / TEXT / MTEXT / ELLIPSE / SPLINE / POINT
 *      / DIMENSION / HATCH / INSERT.
 *   4. Per-entity color override (entity.colorNumber) wins over layer color
 *      ("BYLAYER"). Color is stored on the material so the renderer matches
 *      AutoCAD.
 *
 * The result is a fully-formed visualization Group. AXiA-native conversion
 * (entity → DCEL face/edge in scene) is a separate downstream step
 * (DxfImportHandler.importToScene).
 */

import * as THREE from 'three';

// ── DXF data shape ──────────────────────────────────────────────────

export interface DxfLayerInfo {
  name: string;
  colorNumber?: number;
  flags?: number;
  lineTypeName?: string;
  plot?: boolean;
  lineWeightEnum?: number;
}
export interface DxfBlockDef {
  name: string;
  x?: number; y?: number; z?: number;
  entities: DxfEntity[];
}
export interface DxfEntity {
  type: string;
  layer?: string;
  colorNumber?: number;
  visible?: boolean;
  handle?: string;
  // Geometry-specific (loose).
  [k: string]: unknown;
}
export interface DxfDocument {
  header?: Record<string, unknown>;
  tables?: { layers?: Record<string, DxfLayerInfo>; [k: string]: unknown };
  blocks?: DxfBlockDef[];
  entities?: DxfEntity[] | { value: DxfEntity[] };
  objects?: unknown;
}

// ── AutoCAD ACI palette (256 colors) — minimal subset ────────────────
// Index 0 = BYBLOCK, 256 = BYLAYER, 257 = BYENTITY (rare).
// We only inline the most used: 1=red, 2=yellow, 3=green, 4=cyan, 5=blue,
// 6=magenta, 7=white(black on white bg), 8/9=gray. Full ACI table at
// https://gohtx.com/acadcolors.php — we approximate with a small LUT.
const ACI_COLORS_HEX: Record<number, number> = {
  0: 0x000000,
  1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff,
  5: 0x0000ff, 6: 0xff00ff, 7: 0x000000, 8: 0x808080, 9: 0xc0c0c0,
  // 10–249 are spread across the AutoCAD color cube. Fall back to white.
  256: 0x000000, // BYLAYER
};

function aciToHex(idx: number | undefined, fallback = 0x000000): number {
  if (idx === undefined) return fallback;
  if (ACI_COLORS_HEX[idx] !== undefined) return ACI_COLORS_HEX[idx];
  // Heuristic for grays in the high range.
  if (idx >= 250 && idx <= 255) return 0x404040;
  return fallback;
}

// ── Builder ─────────────────────────────────────────────────────────

export interface DxfBuildOptions {
  /** Default layer color when a layer's `colorNumber` is missing. */
  defaultLayerColor?: number;
  /** Material for line/edge entities (LINE, ARC, POLYLINE, …). */
  edgeMaterial?: THREE.LineBasicMaterial;
  /** Material for filled face entities (3DFACE, SOLID). */
  frontMaterial?: THREE.Material;
}

export class DxfSceneBuilder {
  private layers: Map<string, DxfLayerInfo> = new Map();
  private layerGroups: Map<string, THREE.Group> = new Map();
  private blockTemplates: Map<string, THREE.Group> = new Map();
  private blockOrigins: Map<string, [number, number, number]> = new Map();
  private warnings: string[] = [];
  private edgeMatCache: Map<number, THREE.LineBasicMaterial> = new Map();
  private faceMatCache: Map<number, THREE.MeshBasicMaterial> = new Map();
  private opts: Required<DxfBuildOptions>;
  private root: THREE.Group | null = null;

  constructor(opts: DxfBuildOptions = {}) {
    this.opts = {
      defaultLayerColor: opts.defaultLayerColor ?? 0x000000,
      edgeMaterial: opts.edgeMaterial ?? new THREE.LineBasicMaterial({ color: 0x000000 }),
      frontMaterial: opts.frontMaterial ?? new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide }),
    };
  }

  /** Public entry point: parsed DXF document → fully populated Group. */
  build(dxfData: DxfDocument, sourceFile = 'unknown'): {
    group: THREE.Group;
    stats: {
      layers: number;
      blocks: number;
      entities: number;
      inserts: number;
      skipped: number;
      warnings: string[];
    };
  } {
    const root = new THREE.Group();
    root.name = `import-dxf-${sourceFile}`;
    root.userData.source = 'dxf';
    this.root = root;

    // 1) Build layer table (always include "0" default).
    this.parseLayerTable(dxfData);

    // 2) Pre-create one Group per layer.
    for (const [name, info] of this.layers) {
      const g = new THREE.Group();
      g.name = `layer:${name}`;
      g.userData.layer = { ...info };
      g.visible = !this.layerHidden(info);
      this.layerGroups.set(name, g);
      root.add(g);
    }

    // 3) Build block definition templates.
    this.buildBlockTemplates(dxfData.blocks ?? []);

    // 4) Process top-level entities.
    const entities = this.normalizeEntities(dxfData.entities);
    let processed = 0;
    let inserts = 0;
    let skipped = 0;
    for (const entity of entities) {
      const obj = this.entityToObject(entity);
      if (!obj) { skipped++; continue; }
      this.attachEntity(obj, entity);
      processed++;
      if (entity.type === 'INSERT') inserts++;
    }

    return {
      group: root,
      stats: {
        layers: this.layers.size,
        blocks: this.blockTemplates.size,
        entities: processed,
        inserts,
        skipped,
        warnings: this.warnings.slice(),
      },
    };
  }

  // ── Layer table ───────────────────────────────────────────────────

  private parseLayerTable(d: DxfDocument): void {
    const raw = d.tables?.layers ?? {};
    for (const name of Object.keys(raw)) {
      this.layers.set(name, raw[name]);
    }
    // Always have a "0" fallback.
    if (!this.layers.has('0')) {
      this.layers.set('0', { name: '0', colorNumber: 7 });
    }
  }

  /** DXF layer flags: bit 0 = frozen, bit 2 = locked. Hidden ⇔ frozen. */
  private layerHidden(info: DxfLayerInfo): boolean {
    return ((info.flags ?? 0) & 1) !== 0;
  }

  // ── Block templates ───────────────────────────────────────────────

  private buildBlockTemplates(blocks: DxfBlockDef[]): void {
    for (const blk of blocks) {
      if (!blk.name) continue;
      const tpl = new THREE.Group();
      tpl.name = `block:${blk.name}`;
      tpl.userData.block = {
        name: blk.name,
        origin: [blk.x ?? 0, blk.y ?? 0, blk.z ?? 0],
      };
      // Each block entity becomes a child of the template (no layer routing
      // — block entities inherit layer from the INSERT that references them).
      for (const ent of blk.entities ?? []) {
        const obj = this.entityToObject(ent);
        if (obj) tpl.add(obj);
      }
      this.blockTemplates.set(blk.name, tpl);
      this.blockOrigins.set(blk.name, [blk.x ?? 0, blk.y ?? 0, blk.z ?? 0]);
    }
  }

  // ── Entity dispatch ───────────────────────────────────────────────

  private entityToObject(e: DxfEntity): THREE.Object3D | null {
    try {
      switch (e.type) {
        case 'LINE':       return this.buildLine(e);
        case 'CIRCLE':     return this.buildCircle(e);
        case 'ARC':        return this.buildArc(e);
        case 'LWPOLYLINE':
        case 'POLYLINE':   return this.buildPolyline(e);
        case 'SOLID':
        case 'FACE':       return this.buildSolidFace(e);
        case '3DFACE':     return this.build3DFace(e);
        case 'POINT':      return this.buildPoint(e);
        case 'ELLIPSE':    return this.buildEllipse(e);
        case 'SPLINE':     return this.buildSpline(e);
        case 'TEXT':
        case 'MTEXT':      return this.buildText(e);
        case 'INSERT':     return this.buildInsert(e);
        case 'DIMENSION':  return this.buildDimension(e);
        case 'HATCH':      return this.buildHatch(e);
        default:
          this.warnings.push(`unsupported entity type: ${e.type}`);
          return null;
      }
    } catch (err) {
      this.warnings.push(`entity ${e.type} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Place an Object3D on its layer group. Block-instance children stay
   *  under the INSERT object — the INSERT itself is on the layer. */
  private attachEntity(obj: THREE.Object3D, entity: DxfEntity): void {
    const layerName = (entity.layer as string) ?? '0';
    let g = this.layerGroups.get(layerName);
    if (!g) {
      // Entity references an undeclared layer — create on the fly and
      // attach it directly to the root.
      const info: DxfLayerInfo = { name: layerName, colorNumber: 7 };
      this.layers.set(layerName, info);
      g = new THREE.Group();
      g.name = `layer:${layerName}`;
      g.userData.layer = info;
      this.layerGroups.set(layerName, g);
      this.root?.add(g);
    }
    obj.userData.entity = { type: entity.type, handle: entity.handle, layer: layerName };
    g.add(obj);
  }

  // ── Geometry builders ─────────────────────────────────────────────

  private getEdgeMaterial(entity: DxfEntity): THREE.LineBasicMaterial {
    const c = this.colorForEntity(entity);
    const cached = this.edgeMatCache.get(c);
    if (cached) return cached;
    const m = new THREE.LineBasicMaterial({ color: c });
    this.edgeMatCache.set(c, m);
    return m;
  }
  private getFaceMaterial(entity: DxfEntity): THREE.MeshBasicMaterial {
    const c = this.colorForEntity(entity);
    const cached = this.faceMatCache.get(c);
    if (cached) return cached;
    const m = new THREE.MeshBasicMaterial({
      color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.6,
    });
    this.faceMatCache.set(c, m);
    return m;
  }
  private colorForEntity(entity: DxfEntity): number {
    // Per-entity color override (1–255) wins. 256 = BYLAYER → use layer color.
    const ec = entity.colorNumber as number | undefined;
    if (ec !== undefined && ec >= 1 && ec <= 255) return aciToHex(ec, 0x000000);
    const layerName = (entity.layer as string) ?? '0';
    const layer = this.layers.get(layerName);
    return aciToHex(layer?.colorNumber, this.opts.defaultLayerColor);
  }

  private buildLine(e: DxfEntity): THREE.LineSegments | null {
    const start = e.start as { x: number; y: number; z?: number } | undefined;
    const end = e.end as { x: number; y: number; z?: number } | undefined;
    if (!start || !end) return null;
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints([
      new THREE.Vector3(start.x, start.y, start.z ?? 0),
      new THREE.Vector3(end.x, end.y, end.z ?? 0),
    ]);
    return new THREE.LineSegments(geo, this.getEdgeMaterial(e));
  }

  private buildCircle(e: DxfEntity): THREE.Line | null {
    const cx = (e.x as number) ?? (e.center as { x: number })?.x ?? 0;
    const cy = (e.y as number) ?? (e.center as { y: number })?.y ?? 0;
    const cz = (e.z as number) ?? (e.center as { z: number })?.z ?? 0;
    const r = (e.r as number) ?? (e.radius as number);
    if (!r || r <= 0) return null;
    const segments = Math.max(32, Math.ceil(r));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; ++i) {
      const t = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + r * Math.cos(t), cy + r * Math.sin(t), cz));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, this.getEdgeMaterial(e));
  }

  private buildArc(e: DxfEntity): THREE.Line | null {
    const cx = (e.x as number) ?? (e.center as { x: number })?.x ?? 0;
    const cy = (e.y as number) ?? (e.center as { y: number })?.y ?? 0;
    const cz = (e.z as number) ?? (e.center as { z: number })?.z ?? 0;
    const r = (e.r as number) ?? (e.radius as number);
    if (!r || r <= 0) return null;
    let s = ((e.startAngle as number) ?? (e.start_angle as number) ?? 0) * Math.PI / 180;
    let f = ((e.endAngle as number) ?? (e.end_angle as number) ?? 360) * Math.PI / 180;
    if (f <= s) f += Math.PI * 2;
    const segments = Math.max(16, Math.ceil(Math.abs(f - s) * r / 2));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; ++i) {
      const t = s + (f - s) * (i / segments);
      pts.push(new THREE.Vector3(cx + r * Math.cos(t), cy + r * Math.sin(t), cz));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, this.getEdgeMaterial(e));
  }

  private buildPolyline(e: DxfEntity): THREE.Line | null {
    const verts = (e.vertices as Array<{ x: number; y: number; z?: number }>) ?? [];
    if (verts.length < 2) return null;
    const pts = verts.map(v => new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0));
    if (e.closed) pts.push(pts[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, this.getEdgeMaterial(e));
  }

  private buildSolidFace(e: DxfEntity): THREE.Mesh | null {
    // SOLID is 4-vertex (or 3 with the 4th = 3rd) filled face in 2D.
    const corners = [
      this.xyz(e, '1'), this.xyz(e, '2'), this.xyz(e, '3'), this.xyz(e, '4'),
    ].filter(Boolean) as THREE.Vector3[];
    if (corners.length < 3) return null;
    const geo = new THREE.BufferGeometry();
    if (corners.length === 3) {
      geo.setFromPoints([corners[0], corners[1], corners[2]]);
      geo.setIndex([0, 1, 2]);
    } else {
      // SOLID winds AutoCAD-style "Z" → 0,1,3,2 makes a quad.
      geo.setFromPoints([corners[0], corners[1], corners[3], corners[2]]);
      geo.setIndex([0, 1, 2, 0, 2, 3]);
    }
    return new THREE.Mesh(geo, this.getFaceMaterial(e));
  }

  private build3DFace(e: DxfEntity): THREE.Mesh | null {
    return this.buildSolidFace(e);
  }

  private buildPoint(e: DxfEntity): THREE.Points {
    const x = (e.x as number) ?? 0, y = (e.y as number) ?? 0, z = (e.z as number) ?? 0;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z)]);
    const mat = new THREE.PointsMaterial({
      color: this.colorForEntity(e), size: 4, sizeAttenuation: false,
    });
    return new THREE.Points(geo, mat);
  }

  private buildEllipse(e: DxfEntity): THREE.Line | null {
    const cx = (e.x as number) ?? 0, cy = (e.y as number) ?? 0, cz = (e.z as number) ?? 0;
    const mx = (e.majorX as number) ?? 0, my = (e.majorY as number) ?? 0, mz = (e.majorZ as number) ?? 0;
    const ratio = (e.axisRatio as number) ?? 1;
    const start = (e.startAngle as number) ?? 0;
    const end = (e.endAngle as number) ?? Math.PI * 2;
    const major = new THREE.Vector3(mx, my, mz);
    const majorLen = major.length();
    if (majorLen < 1e-9) return null;
    // Normal = Z axis (assume XY plane). Minor = normal × major.
    const normal = new THREE.Vector3(0, 0, 1);
    const minor = new THREE.Vector3().crossVectors(normal, major).normalize().multiplyScalar(majorLen * ratio);
    const segments = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; ++i) {
      const t = start + (end - start) * (i / segments);
      const p = new THREE.Vector3(cx, cy, cz)
        .addScaledVector(major, Math.cos(t))
        .add(minor.clone().multiplyScalar(Math.sin(t)));
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, this.getEdgeMaterial(e));
  }

  private buildSpline(e: DxfEntity): THREE.Line | null {
    // Sample via THREE.CatmullRomCurve3 over control points (good enough
    // for visualization; full B-spline NURBS evaluation is left for AXiA-
    // native conversion).
    const cps = (e.controlPoints as Array<{ x: number; y: number; z?: number }>) ?? [];
    if (cps.length < 2) return null;
    const points = cps.map(p => new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0));
    const closed = !!e.closed;
    const curve = new THREE.CatmullRomCurve3(points, closed);
    const samples = curve.getPoints(Math.max(64, points.length * 8));
    const geo = new THREE.BufferGeometry().setFromPoints(samples);
    return new THREE.Line(geo, this.getEdgeMaterial(e));
  }

  private buildText(e: DxfEntity): THREE.Sprite | null {
    const text = (e.string as string) ?? '';
    if (!text) return null;
    const x = (e.x as number) ?? 0, y = (e.y as number) ?? 0, z = (e.z as number) ?? 0;
    const height = (e.textHeight as number) ?? 50;
    // Render text into a canvas texture (simple sprite placeholder; users
    // get a readable label without a TextGeometry build dep). Color from
    // entity/layer.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const fontSizePx = 64;
    canvas.width = 512; canvas.height = 128;
    ctx.fillStyle = `#${this.colorForEntity(e).toString(16).padStart(6, '0')}`;
    ctx.font = `${fontSizePx}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    // Sprite scale ~ DXF text height; aspect 4:1 from canvas dimensions.
    sprite.scale.set(height * 4, height, 1);
    return sprite;
  }

  private buildInsert(e: DxfEntity): THREE.Object3D | null {
    const blockName = e.block as string | undefined;
    if (!blockName) { this.warnings.push('INSERT without block name'); return null; }
    const tpl = this.blockTemplates.get(blockName);
    if (!tpl) { this.warnings.push(`INSERT references unknown block: ${blockName}`); return null; }
    const origin = this.blockOrigins.get(blockName) ?? [0, 0, 0];

    const x = (e.x as number) ?? 0, y = (e.y as number) ?? 0, z = (e.z as number) ?? 0;
    const sx = (e.scaleX as number) ?? 1, sy = (e.scaleY as number) ?? 1, sz = (e.scaleZ as number) ?? 1;
    const rotDeg = (e.rotation as number) ?? 0;
    const cols = (e.columnCount as number) ?? 1;
    const rows = (e.rowCount as number) ?? 1;
    const cs = (e.columnSpacing as number) ?? 0;
    const rs = (e.rowSpacing as number) ?? 0;

    const root = new THREE.Group();
    root.name = `insert:${blockName}`;
    root.userData.insert = { block: blockName, x, y, z, sx, sy, sz, rotDeg, cols, rows };

    // For each (col, row) make a fresh clone. We pre-clone once and copy
    // for arrays — minor optimisation.
    const baseClone = tpl.clone(true);
    // Block's local origin (insertion base point) applies as -origin offset
    // before rotation/scale (so the block's anchor lands at the INSERT's xyz).
    baseClone.position.set(-origin[0], -origin[1], -origin[2]);

    for (let r = 0; r < rows; ++r) {
      for (let c = 0; c < cols; ++c) {
        const inst = (c === 0 && r === 0) ? baseClone : baseClone.clone(true);
        const wrapper = new THREE.Group();
        wrapper.add(inst);
        wrapper.scale.set(sx, sy, sz);
        wrapper.rotation.z = rotDeg * Math.PI / 180;
        wrapper.position.set(x + c * cs, y + r * rs, z);
        root.add(wrapper);
      }
    }
    return root;
  }

  private buildDimension(e: DxfEntity): THREE.Object3D | null {
    // Lightweight rendering: just trace the dimension's defining points
    // and the dimension line via available 10/11/13/14 codes when present.
    // Full dimension rendering with text/arrowheads is non-trivial.
    const root = new THREE.Group();
    root.name = `dim:${e.handle ?? '?'}`;
    const pickPt = (suffix: string): THREE.Vector3 | null => {
      const x = e[`x${suffix}`] as number | undefined;
      const y = e[`y${suffix}`] as number | undefined;
      const z = e[`z${suffix}`] as number | undefined;
      if (x === undefined || y === undefined) return null;
      return new THREE.Vector3(x, y, z ?? 0);
    };
    const a = pickPt(''); // primary point
    const b = pickPt('1');
    const c = pickPt('3');
    const d = pickPt('4');
    const pts: THREE.Vector3[] = [];
    if (a && b) { pts.push(a, b); }
    if (c && d) { pts.push(c, d); }
    if (pts.length === 0) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.LineSegments(geo, this.getEdgeMaterial(e));
    root.add(line);
    return root;
  }

  private buildHatch(e: DxfEntity): THREE.Object3D | null {
    // Render only the boundary path(s) — the hatch fill is non-trivial to
    // tessellate properly. The boundary tells the user "there's a hatch
    // here" without producing visual clutter.
    const paths = (e.boundaryPaths as Array<{ points?: Array<{ x: number; y: number }> }>) ?? [];
    if (paths.length === 0) return null;
    const root = new THREE.Group();
    root.name = `hatch:${e.handle ?? '?'}`;
    for (const path of paths) {
      const pts = (path.points ?? []).map(p => new THREE.Vector3(p.x, p.y, 0));
      if (pts.length < 2) continue;
      pts.push(pts[0].clone()); // close
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      root.add(new THREE.Line(geo, this.getEdgeMaterial(e)));
    }
    return root.children.length > 0 ? root : null;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private xyz(e: DxfEntity, suffix: string): THREE.Vector3 | null {
    const x = e[`x${suffix}`] as number | undefined;
    const y = e[`y${suffix}`] as number | undefined;
    const z = e[`z${suffix}`] as number | undefined;
    if (x === undefined || y === undefined) return null;
    return new THREE.Vector3(x, y, z ?? 0);
  }

  private normalizeEntities(raw: DxfDocument['entities']): DxfEntity[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if ('value' in raw && Array.isArray(raw.value)) return raw.value;
    return [];
  }
}
