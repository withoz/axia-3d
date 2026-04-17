/**
 * SnapManager — ZWCAD/AutoCAD OSNAP-style snap point detection engine.
 *
 * ZWCAD 스냅 재지정 메뉴 전체 구현:
 *
 * ── 특수 스냅 ──
 *   - tempTrack:       임시 추적점 (Temporary Track Point)
 *   - from:            시작점 (From — 기준점 오프셋)
 *   - mid2p:           2점 사이의 중간 (Mid Between 2 Points)
 *
 * ── 기본 기하학 스냅 ──
 *   - endpoint:        끝점 (Endpoint) — ■ 사각형
 *   - midpoint:        중간점 (Midpoint) — ▲ 삼각형
 *   - intersection:    교차점 (Intersection) — ✕ X마커
 *   - apparent:        가상 교차점 (Apparent Intersection) — ✕□ X+사각형
 *   - extension:       연장선 (Extension) — ···· 점선
 *
 * ── 도형 스냅 ──
 *   - center:          중심점 (Center) — ○ 원형
 *   - geometric:       기하학적 중심 (Geometric Center) — □· 사각형+점
 *   - quadrant:        사분점 (Quadrant) — ◇ 다이아몬드
 *   - tangent:         접점 (Tangent) — ○/ 접선
 *
 * ── 관계 스냅 ──
 *   - perpendicular:   수직점 (Perpendicular) — ⊥ 직각
 *   - parallel:        평행 (Parallel) — // 평행선
 *
 * ── 기타 ──
 *   - node:            노드 (Node) — · 점
 *   - insertion:       삽입 (Insertion) — ⊞ 삽입점
 *   - nearest:         근처점 (Nearest) — ✕ X마커
 *   - grid:            그리드 (Grid) — + 십자
 */

import * as THREE from 'three';

// ═══ Snap Types ═══
export type SnapType =
  // 기본 기하학 스냅
  | 'endpoint'        // 끝점
  | 'midpoint'        // 중간점
  | 'intersection'    // 교차점
  | 'apparent'        // 가상 교차점
  | 'extension'       // 연장선
  // 도형 스냅
  | 'center'          // 중심점
  | 'geometric'       // 기하학적 중심
  | 'quadrant'        // 사분점
  | 'tangent'         // 접점
  // 관계 스냅
  | 'perpendicular'   // 수직점
  | 'parallel'        // 평행
  // 면 스냅
  | 'onFace'          // 면 위 투영점 (cursor ray ∩ face plane)
  // 기타
  | 'node'            // 노드
  | 'insertion'       // 삽입점
  | 'nearest'         // 근처점
  // 특수
  | 'tempTrack'       // 임시 추적점
  | 'from'            // 시작점 (기준점)
  | 'mid2p'           // 2점 사이의 중간
  | 'loopClose';      // 루프 닫기 (녹색)

// ═══ Snap marker shape definitions ═══
export interface SnapMarkerDef {
  shape: 'square' | 'triangle' | 'x' | 'circle' | 'diamond' | 'perpendicular'
       | 'parallel' | 'dot' | 'plus' | 'extension' | 'apparent' | 'geometric'
       | 'filledCircle' | 'onFace';
  color: string;
  label: string;        // Korean tooltip label
  labelEn: string;      // English label
}

// 스냅 마커 색상: 빨간색 통일
const G = '#FF3333';   // 기본 스냅
const Y = '#FF3333';   // 보조 스냅
const M = '#FF3333';   // 특수 스냅

export const SNAP_MARKERS: Record<SnapType, SnapMarkerDef> = {
  endpoint:      { shape: 'square',        color: G, label: '끝점',         labelEn: 'Endpoint' },
  midpoint:      { shape: 'triangle',      color: G, label: '중간점',       labelEn: 'Midpoint' },
  intersection:  { shape: 'x',            color: G, label: '교차점',       labelEn: 'Intersection' },
  apparent:      { shape: 'apparent',      color: G, label: '가상 교차점',   labelEn: 'Apparent Int.' },
  extension:     { shape: 'extension',     color: G, label: '연장선',       labelEn: 'Extension' },
  center:        { shape: 'circle',        color: G, label: '중심점',       labelEn: 'Center' },
  geometric:     { shape: 'geometric',     color: G, label: '기하학적 중심', labelEn: 'Geo. Center' },
  quadrant:      { shape: 'diamond',       color: G, label: '사분점',       labelEn: 'Quadrant' },
  tangent:       { shape: 'circle',        color: G, label: '접점',         labelEn: 'Tangent' },
  perpendicular: { shape: 'perpendicular', color: G, label: '수직점',       labelEn: 'Perpendicular' },
  parallel:      { shape: 'parallel',      color: G, label: '평행',         labelEn: 'Parallel' },
  onFace:        { shape: 'onFace',        color: G, label: '면 위',        labelEn: 'On Face' },
  node:          { shape: 'dot',           color: G, label: '노드',         labelEn: 'Node' },
  insertion:     { shape: 'plus',          color: G, label: '삽입',         labelEn: 'Insertion' },
  nearest:       { shape: 'x',            color: Y, label: '근처점',       labelEn: 'Nearest' },
  tempTrack:     { shape: 'plus',          color: Y, label: '임시 추적점',   labelEn: 'Temp Track' },
  from:          { shape: 'dot',           color: M, label: '시작점',       labelEn: 'From' },
  mid2p:         { shape: 'triangle',      color: Y, label: '2점 중간',     labelEn: 'Mid 2 Points' },
  loopClose:     { shape: 'filledCircle',  color: '#00CC44', label: '루프 닫기', labelEn: 'Close Loop' },
};

export interface SnapPoint {
  type: SnapType;
  position: THREE.Vector3;
  screenPos?: THREE.Vector2;     // screen pixel position
  distance?: number;             // screen distance from mouse (pixels)
  edgeRef?: { a: THREE.Vector3; b: THREE.Vector3 }; // edge reference for extension/parallel
}

export interface SnapConfig {
  enabled: boolean;               // master toggle (F3)
  modes: Set<SnapType>;           // active snap modes
  pixelThreshold: number;         // max screen distance in pixels
  gridSpacing: number;            // grid snap spacing (mm)
  showTooltip: boolean;           // show snap type label
  showMarker: boolean;            // show snap marker
  magnetStrength: number;         // 0=off, 1=normal
}

// ═══ Internal geometry types ═══
interface EdgeSegment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

// ═══ Priority (lower = higher priority) ═══
const SNAP_PRIORITY: Record<SnapType, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  apparent: 3,
  center: 4,
  geometric: 5,
  quadrant: 6,
  perpendicular: 7,
  tangent: 8,
  parallel: 9,
  extension: 10,
  node: 11,
  insertion: 12,
  nearest: 13,
  onFace: 14,       // 면 투영은 다른 모드보다 낮은 우선순위 (edge/vertex 우선)
  tempTrack: 15,
  from: 16,
  mid2p: 17,
  loopClose: -1,    // highest priority — loop close overrides all
};

export class SnapManager {
  private config: SnapConfig;

  // Cached geometry data
  private vertices: THREE.Vector3[] = [];
  private edges: EdgeSegment[] = [];
  private faceCenters: THREE.Vector3[] = [];
  private faceData: Map<number, { center: THREE.Vector3; verts: THREE.Vector3[]; normal: THREE.Vector3; planeD: number }> = new Map();

  // Reference point for perpendicular/tangent/parallel/extension
  private referencePoint: THREE.Vector3 | null = null;

  // Extension tracking: hovered edge history
  private hoveredEdge: EdgeSegment | null = null;

  // Parallel tracking: reference edge direction
  private parallelRef: THREE.Vector3 | null = null;

  // Temp track points accumulated during a command
  private trackPoints: THREE.Vector3[] = [];

  // Mid-between-2-points mode
  private mid2pFirst: THREE.Vector3 | null = null;

  // Last snap result
  private _lastSnap: SnapPoint | null = null;

  // Callbacks
  private _onSnapChange?: (snap: SnapPoint | null) => void;

  constructor() {
    this.config = {
      enabled: true,
      modes: new Set<SnapType>([
        'endpoint',
        'midpoint',
        'intersection',
        'center',
        'perpendicular',
        'parallel',
        'extension',
        'onFace',
      ]),
      pixelThreshold: 15,
      gridSpacing: 1000,
      showTooltip: true,
      showMarker: true,
      magnetStrength: 1,
    };
  }

  // ═══ Configuration ═══

  get enabled(): boolean { return this.config.enabled; }
  set enabled(v: boolean) { this.config.enabled = v; }
  get modes(): Set<SnapType> { return this.config.modes; }
  get lastSnap(): SnapPoint | null { return this._lastSnap; }
  get pixelThreshold(): number { return this.config.pixelThreshold; }
  set pixelThreshold(v: number) { this.config.pixelThreshold = v; }
  get showTooltip(): boolean { return this.config.showTooltip; }
  set showTooltip(v: boolean) { this.config.showTooltip = v; }
  get showMarker(): boolean { return this.config.showMarker; }
  set showMarker(v: boolean) { this.config.showMarker = v; }

  // ═══ Snap Override (replaces window.__axia_snap_override) ═══
  private _snapOverride: SnapType | 'none' | undefined;

  /** Set a one-shot snap override (from context menu) */
  setOverride(type: SnapType | 'none'): void { this._snapOverride = type; }

  /** Get current snap override without consuming it */
  getOverride(): SnapType | 'none' | undefined { return this._snapOverride; }

  /** Get and clear the current snap override (consume on use) */
  consumeOverride(): SnapType | 'none' | undefined {
    const v = this._snapOverride;
    this._snapOverride = undefined;
    return v;
  }

  toggleMode(mode: SnapType): boolean {
    if (this.config.modes.has(mode)) {
      this.config.modes.delete(mode);
      return false;
    }
    this.config.modes.add(mode);
    return true;
  }

  setMode(mode: SnapType, active: boolean) {
    if (active) this.config.modes.add(mode);
    else this.config.modes.delete(mode);
  }

  isActive(mode: SnapType): boolean {
    return this.config.modes.has(mode);
  }

  /** Toggle master on/off (F3) */
  toggle(): boolean {
    this.config.enabled = !this.config.enabled;
    return this.config.enabled;
  }

  /** Set reference point (line start, etc.) for perpendicular/parallel snap */
  setReferencePoint(pt: THREE.Vector3 | null) {
    this.referencePoint = pt ? pt.clone() : null;
  }

  /** Set parallel reference direction from an edge */
  setParallelRef(dir: THREE.Vector3 | null) {
    this.parallelRef = dir ? dir.clone().normalize() : null;
  }

  /** Add a temporary tracking point */
  addTrackPoint(pt: THREE.Vector3) {
    this.trackPoints.push(pt.clone());
  }

  /** Clear tracking points (new command start) */
  clearTrackPoints() {
    this.trackPoints = [];
    this.mid2pFirst = null;
  }

  /** Set first point for mid-between-2-points */
  setMid2pFirst(pt: THREE.Vector3 | null) {
    this.mid2pFirst = pt ? pt.clone() : null;
  }

  /** Register snap change callback */
  onSnapChange(cb: (snap: SnapPoint | null) => void) {
    this._onSnapChange = cb;
  }

  // ═══ Always-On Endpoint Inference (SketchUp-style) ═══

  /**
   * Find the nearest endpoint regardless of snap enabled/disabled state.
   * SketchUp's inference engine always pulls toward endpoints.
   * Returns the exact f64 vertex position if within pixel threshold, or null.
   */
  findNearestEndpoint(
    mx: number, my: number,
    camera: THREE.Camera,
    canvas: HTMLElement,
    threshold?: number,
  ): SnapPoint | null {
    const pxThreshold = threshold ?? this.config.pixelThreshold;
    const rect = canvas.getBoundingClientRect();
    let best: SnapPoint | null = null;
    let bestDist = pxThreshold;

    for (const v of this.vertices) {
      const projected = v.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
      const dx = mx - sx;
      const dy = my - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          type: 'endpoint',
          position: v.clone(),
          screenPos: new THREE.Vector2(sx, sy),
          distance: dist,
        };
      }
    }
    return best;
  }

  // ═══ Geometry Update ═══

  /**
   * Update cached geometry from mesh buffers.
   * Call after syncMesh().
   */
  updateFromMesh(
    positions: Float32Array,
    indices: Uint32Array,
    faceMap: Uint32Array,
    edgeLines?: Float32Array | null,
    snapVerticesF64?: Float64Array | null,
  ) {
    this.vertices = [];
    this.edges = [];
    this.faceCenters = [];
    this.faceData.clear();

    const vertSet = new Map<string, THREE.Vector3>();

    // ── 1) Unique vertices — prefer f64 precision for exact snap ──
    if (snapVerticesF64 && snapVerticesF64.length >= 3) {
      // Use f64 vertex positions from WASM (exact DCEL coordinates, no f32 loss)
      const vertCount = snapVerticesF64.length / 3;
      for (let i = 0; i < vertCount; i++) {
        const v = new THREE.Vector3(
          snapVerticesF64[i * 3],
          snapVerticesF64[i * 3 + 1],
          snapVerticesF64[i * 3 + 2],
        );
        const key = `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
        if (!vertSet.has(key)) vertSet.set(key, v);
      }
    } else if (positions.length > 0) {
      // Fallback: f32 render buffer (precision loss possible)
      const vertCount = positions.length / 3;
      for (let i = 0; i < vertCount; i++) {
        const v = new THREE.Vector3(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
        );
        const key = `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
        if (!vertSet.has(key)) vertSet.set(key, v);
      }
    }

    // ── 2) Edges (모서리 — DCEL hard edges 우선) ──
    if (edgeLines && edgeLines.length >= 6) {
      for (let i = 0; i < edgeLines.length; i += 6) {
        const a = new THREE.Vector3(edgeLines[i], edgeLines[i + 1], edgeLines[i + 2]);
        const b = new THREE.Vector3(edgeLines[i + 3], edgeLines[i + 4], edgeLines[i + 5]);
        this.edges.push({ a, b });
        // Also register edge endpoints as vertices for endpoint snap
        const keyA = `${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}`;
        const keyB = `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
        if (!vertSet.has(keyA)) vertSet.set(keyA, a.clone());
        if (!vertSet.has(keyB)) vertSet.set(keyB, b.clone());
      }
    } else if (positions.length > 0) {
      // Fallback: boundary edges from triangles
      const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; count: number }>();
      const ek = (a: THREE.Vector3, b: THREE.Vector3) => {
        const ka = `${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}`;
        const kb = `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
        return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      };
      const triCount = indices.length / 3;
      for (let t = 0; t < triCount; t++) {
        const [i0, i1, i2] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
        const verts = [i0, i1, i2].map(i => new THREE.Vector3(
          positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]
        ));
        for (const [a, b] of [[verts[0], verts[1]], [verts[1], verts[2]], [verts[2], verts[0]]]) {
          const key = ek(a, b);
          const ex = edgeMap.get(key);
          if (ex) ex.count++; else edgeMap.set(key, { a: a.clone(), b: b.clone(), count: 1 });
        }
      }
      for (const [, e] of edgeMap) this.edges.push({ a: e.a, b: e.b });
    }

    // Finalize vertex list
    this.vertices = Array.from(vertSet.values());

    // Early exit if no face data to process
    if (positions.length === 0 && this.edges.length === 0) return;

    // ── 3) Face data (중심점, 기하학적 중심, 사분점용) ──
    const faceVertMap = new Map<number, Set<string>>();
    const faceVertList = new Map<number, THREE.Vector3[]>();
    const triCount = indices.length / 3;
    for (let t = 0; t < triCount; t++) {
      const fid = faceMap[t];
      if (!faceVertMap.has(fid)) {
        faceVertMap.set(fid, new Set());
        faceVertList.set(fid, []);
      }
      const set = faceVertMap.get(fid)!;
      const list = faceVertList.get(fid)!;
      for (let j = 0; j < 3; j++) {
        const idx = indices[t * 3 + j];
        const v = new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
        const key = `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
        if (!set.has(key)) {
          set.add(key);
          list.push(v);
        }
      }
    }

    for (const [fid, verts] of faceVertList) {
      const center = new THREE.Vector3();
      for (const v of verts) center.add(v);
      center.divideScalar(verts.length);
      this.faceCenters.push(center);

      // ── Face plane equation (onFace snap) ──
      // Best-fit normal from first non-degenerate triangle (center, v0, v1)
      let normal = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const e1 = verts[i].clone().sub(center);
        const e2 = verts[j].clone().sub(center);
        const n = e1.cross(e2);
        if (n.lengthSq() > 1e-6) {
          normal = n.normalize();
          break;
        }
      }
      const planeD = -normal.dot(center);
      this.faceData.set(fid, { center, verts: [...verts], normal, planeD });
    }
  }

  // ═══ Main Snap Detection ═══

  /**
   * Find the best snap point near the mouse cursor.
   *
   * @param mouseX - clientX
   * @param mouseY - clientY
   * @param camera - active camera (perspective or ortho)
   * @param canvas - renderer DOM element
   * @param groundPoint - ground plane intersection (for grid/nearest)
   * @returns best SnapPoint or null
   */
  findSnap(
    mouseX: number,
    mouseY: number,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    groundPoint?: THREE.Vector3 | null,
    faceHitPoint?: THREE.Vector3 | null,
  ): SnapPoint | null {
    if (!this.config.enabled) {
      this.setResult(null);
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const mousePx = new THREE.Vector2(mouseX, mouseY);
    const threshold = this.config.pixelThreshold;
    const candidates: SnapPoint[] = [];

    // Helper: world→screen pixel
    const toScreenPx = (pos: THREE.Vector3): THREE.Vector2 | null => {
      const v = pos.clone().project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return new THREE.Vector2(
        (v.x * 0.5 + 0.5) * rect.width + rect.left,
        (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      );
    };

    const addCandidate = (type: SnapType, position: THREE.Vector3, screenPx: THREE.Vector2, edgeRef?: EdgeSegment) => {
      const dist = mousePx.distanceTo(screenPx);
      candidates.push({
        type,
        position: position.clone(),
        screenPos: screenPx.clone(),
        distance: dist,
        edgeRef: edgeRef ? { a: edgeRef.a.clone(), b: edgeRef.b.clone() } : undefined,
      });
    };

    const modes = this.config.modes;

    // ── Endpoint (끝점) ■ ──
    if (modes.has('endpoint')) {
      for (const v of this.vertices) {
        const s = toScreenPx(v);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('endpoint', v, s);
        }
      }
    }

    // ── Midpoint (중간점) ▲ ──
    if (modes.has('midpoint')) {
      for (const edge of this.edges) {
        const mid = edge.a.clone().add(edge.b).multiplyScalar(0.5);
        const s = toScreenPx(mid);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('midpoint', mid, s, edge);
        }
      }
    }

    // ── Intersection (교차점) ✕ ──
    if (modes.has('intersection')) {
      const maxEdges = Math.min(this.edges.length, 200); // perf limit
      for (let i = 0; i < maxEdges; i++) {
        for (let j = i + 1; j < maxEdges; j++) {
          const pt = this.segmentIntersection(this.edges[i], this.edges[j]);
          if (!pt) continue;
          const s = toScreenPx(pt);
          if (s && mousePx.distanceTo(s) <= threshold) {
            addCandidate('intersection', pt, s);
          }
        }
      }
    }

    // ── Apparent Intersection (가상 교차점) ✕□ ──
    if (modes.has('apparent')) {
      const maxEdges = Math.min(this.edges.length, 100);
      for (let i = 0; i < maxEdges; i++) {
        for (let j = i + 1; j < maxEdges; j++) {
          const pt = this.apparentIntersection(this.edges[i], this.edges[j], camera, rect);
          if (!pt) continue;
          const s = toScreenPx(pt);
          if (s && mousePx.distanceTo(s) <= threshold) {
            addCandidate('apparent', pt, s);
          }
        }
      }
    }

    // ── Extension (연장선) ···· ──
    if (modes.has('extension') && groundPoint) {
      for (const edge of this.edges) {
        const ext = this.extensionSnap(groundPoint, edge, threshold, toScreenPx, mousePx);
        if (ext) {
          addCandidate('extension', ext.position, ext.screenPx, edge);
        }
      }
    }

    // ── Center (중심점) ○ ──
    if (modes.has('center')) {
      for (const c of this.faceCenters) {
        const s = toScreenPx(c);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('center', c, s);
        }
      }
    }

    // ── Geometric Center (기하학적 중심) □· ──
    if (modes.has('geometric')) {
      for (const [, data] of this.faceData) {
        const s = toScreenPx(data.center);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('geometric', data.center, s);
        }
      }
    }

    // ── Quadrant (사분점) ◇ ──
    if (modes.has('quadrant')) {
      // For circle-like faces (many vertices), detect 0/90/180/270 degree points
      for (const [, data] of this.faceData) {
        if (data.verts.length < 8) continue; // likely a circle approximation
        const quads = this.quadrantPoints(data.center, data.verts);
        for (const q of quads) {
          const s = toScreenPx(q);
          if (s && mousePx.distanceTo(s) <= threshold) {
            addCandidate('quadrant', q, s);
          }
        }
      }
    }

    // ── Perpendicular (수직점) ⊥ ──
    if (modes.has('perpendicular') && this.referencePoint) {
      for (const edge of this.edges) {
        const perp = this.perpendicularPoint(this.referencePoint, edge.a, edge.b);
        if (!perp) continue;
        const s = toScreenPx(perp);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('perpendicular', perp, s, edge);
        }
      }
    }

    // ── Parallel (평행) // ──
    if (modes.has('parallel') && this.referencePoint && groundPoint) {
      for (const edge of this.edges) {
        const par = this.parallelSnap(this.referencePoint, groundPoint, edge);
        if (!par) continue;
        const s = toScreenPx(par);
        if (s && mousePx.distanceTo(s) <= threshold * 1.5) {
          addCandidate('parallel', par, s, edge);
        }
      }
    }

    // ── On Face (면 위 투영) — 사용자 요청: 주변 면에 맞춤 ──
    if (modes.has('onFace') && faceHitPoint) {
      const s = toScreenPx(faceHitPoint);
      if (s) {
        // onFace는 항상 pickup 지점이 정확하므로 threshold 내면 후보로 추가
        // (다른 높은 우선순위 스냅이 있으면 그쪽이 이김 — priority 14)
        addCandidate('onFace', faceHitPoint, s);
      }
    }

    // ── Tangent (접점) — reference point에서 원형 face로의 접선 ──
    if (modes.has('tangent') && this.referencePoint) {
      for (const [, data] of this.faceData) {
        if (data.verts.length < 8) continue; // 원형 근사 face만 (8+ vertices)
        // Average radius
        let sumR = 0;
        for (const v of data.verts) sumR += v.distanceTo(data.center);
        const r = sumR / data.verts.length;
        const tangents = this.tangentPoints(this.referencePoint, data.center, r, data.normal);
        for (const t of tangents) {
          const s = toScreenPx(t);
          if (s && mousePx.distanceTo(s) <= threshold) {
            addCandidate('tangent', t, s);
          }
        }
      }
    }

    // ── Nearest (근처점) ──
    if (modes.has('nearest') && groundPoint) {
      let bestNearest: { pos: THREE.Vector3; dist: number; edge: EdgeSegment } | null = null;
      for (const edge of this.edges) {
        const pt = this.closestPointOnSegment(groundPoint, edge.a, edge.b);
        const s = toScreenPx(pt);
        if (!s) continue;
        const d = mousePx.distanceTo(s);
        if (d <= threshold && (!bestNearest || d < bestNearest.dist)) {
          bestNearest = { pos: pt, dist: d, edge };
        }
      }
      if (bestNearest) {
        addCandidate('nearest', bestNearest.pos, toScreenPx(bestNearest.pos)!, bestNearest.edge);
      }
    }

    // ── Pick best candidate ──
    if (candidates.length === 0) {
      this.setResult(null);
      return null;
    }

    // Sort: priority, then screen distance
    candidates.sort((a, b) => {
      const pa = SNAP_PRIORITY[a.type];
      const pb = SNAP_PRIORITY[b.type];
      if (pa !== pb) return pa - pb;
      return (a.distance || 0) - (b.distance || 0);
    });

    // Remove duplicates: if endpoint and nearest are at same position, keep endpoint
    const best = candidates[0];
    this.setResult(best);
    return best;
  }

  /** One-shot snap override (ZWCAD 스냅 재지정) — ignores active modes & enabled state, uses only specified type */
  findSnapOverride(
    type: SnapType,
    mouseX: number,
    mouseY: number,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    groundPoint?: THREE.Vector3 | null,
    faceHitPoint?: THREE.Vector3 | null,
  ): SnapPoint | null {
    // Temporarily force snap ON and switch to override mode only
    const origEnabled = this.config.enabled;
    const origModes = new Set(this.config.modes);
    this.config.enabled = true;
    this.config.modes = new Set([type]);
    const result = this.findSnap(mouseX, mouseY, camera, canvas, groundPoint, faceHitPoint);
    this.config.enabled = origEnabled;
    this.config.modes = origModes;
    return result;
  }

  /** Tangent points from external point P to circle (center C, radius r) on plane with normal n */
  private tangentPoints(p: THREE.Vector3, center: THREE.Vector3, r: number, normal: THREE.Vector3): THREE.Vector3[] {
    // Project P onto face plane
    const toP = p.clone().sub(center);
    const distFromPlane = toP.dot(normal);
    const pOnPlane = p.clone().sub(normal.clone().multiplyScalar(distFromPlane));
    const d = pOnPlane.distanceTo(center);
    if (d <= r + 1e-4) return []; // P inside or on circle — no tangent
    // Angle between CP and tangent line
    const alpha = Math.acos(r / d);
    const cpDir = pOnPlane.clone().sub(center).normalize();
    // Rotate cpDir by ±alpha around normal to get tangent directions from center
    const rotated = (angle: number): THREE.Vector3 => {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      // Rodrigues' rotation around normal
      const k = normal;
      return cpDir.clone().multiplyScalar(cos)
        .add(k.clone().cross(cpDir).multiplyScalar(sin))
        .add(k.clone().multiplyScalar(k.dot(cpDir) * (1 - cos)));
    };
    const t1 = center.clone().add(rotated(alpha).multiplyScalar(r));
    const t2 = center.clone().add(rotated(-alpha).multiplyScalar(r));
    return [t1, t2];
  }

  // ═══ Internal helpers ═══

  private setResult(snap: SnapPoint | null) {
    this._lastSnap = snap;
    this._onSnapChange?.(snap);
  }

  /** Closest point on segment AB from P */
  private closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    const ab = b.clone().sub(a);
    const lenSq = ab.dot(ab);
    if (lenSq < 1e-10) return a.clone();
    let t = p.clone().sub(a).dot(ab) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return a.clone().add(ab.multiplyScalar(t));
  }

  /** Perpendicular foot from ref to segment AB (null if outside) */
  private perpendicularPoint(ref: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 | null {
    const ab = b.clone().sub(a);
    const lenSq = ab.dot(ab);
    if (lenSq < 1e-10) return null;
    const t = ref.clone().sub(a).dot(ab) / lenSq;
    if (t < -0.01 || t > 1.01) return null;
    return a.clone().add(ab.multiplyScalar(Math.max(0, Math.min(1, t))));
  }

  /** Segment-segment intersection (3D, within tolerance) */
  private segmentIntersection(e1: EdgeSegment, e2: EdgeSegment): THREE.Vector3 | null {
    const d1 = e1.b.clone().sub(e1.a);
    const d2 = e2.b.clone().sub(e2.a);
    const d12 = e1.a.clone().sub(e2.a);

    const d1d1 = d1.dot(d1);
    const d2d2 = d2.dot(d2);
    const d1d2 = d1.dot(d2);
    const d12d1 = d12.dot(d1);
    const d12d2 = d12.dot(d2);

    const denom = d1d1 * d2d2 - d1d2 * d1d2;
    if (Math.abs(denom) < 1e-10) return null;

    const t1 = (d1d2 * d12d2 - d2d2 * d12d1) / denom;
    const t2 = (d1d1 * d12d2 - d1d2 * d12d1) / denom;

    if (t1 < -0.01 || t1 > 1.01 || t2 < -0.01 || t2 > 1.01) return null;

    const p1 = e1.a.clone().add(d1.multiplyScalar(t1));
    const p2 = e2.a.clone().add(d2.multiplyScalar(t2));

    if (p1.distanceTo(p2) > 1.0) return null;
    return p1.add(p2).multiplyScalar(0.5);
  }

  /** Apparent intersection — where two edges would meet if extended (2D projection) */
  private apparentIntersection(
    e1: EdgeSegment, e2: EdgeSegment,
    _camera: THREE.Camera, _rect: DOMRect,
  ): THREE.Vector3 | null {
    // Extend edges infinitely and find closest approach
    const d1 = e1.b.clone().sub(e1.a);
    const d2 = e2.b.clone().sub(e2.a);
    const d12 = e1.a.clone().sub(e2.a);

    const d1d1 = d1.dot(d1);
    const d2d2 = d2.dot(d2);
    const d1d2 = d1.dot(d2);
    const d12d1 = d12.dot(d1);
    const d12d2 = d12.dot(d2);

    const denom = d1d1 * d2d2 - d1d2 * d1d2;
    if (Math.abs(denom) < 1e-10) return null;

    const t1 = (d1d2 * d12d2 - d2d2 * d12d1) / denom;
    const t2 = (d1d1 * d12d2 - d1d2 * d12d1) / denom;

    // At least one must be OUTSIDE segment range (otherwise it's a real intersection)
    if (t1 >= -0.01 && t1 <= 1.01 && t2 >= -0.01 && t2 <= 1.01) return null;

    // Limit extension to reasonable range (3x segment length)
    if (Math.abs(t1) > 3 || Math.abs(t2) > 3) return null;

    const p1 = e1.a.clone().add(d1.multiplyScalar(t1));
    const p2 = e2.a.clone().add(d2.multiplyScalar(t2));

    if (p1.distanceTo(p2) > 5.0) return null; // 5mm tolerance for apparent
    return p1.add(p2).multiplyScalar(0.5);
  }

  /** Extension snap — point along edge's extension line near the mouse */
  private extensionSnap(
    groundPoint: THREE.Vector3,
    edge: EdgeSegment,
    threshold: number,
    toScreenPx: (pos: THREE.Vector3) => THREE.Vector2 | null,
    mousePx: THREE.Vector2,
  ): { position: THREE.Vector3; screenPx: THREE.Vector2 } | null {
    const dir = edge.b.clone().sub(edge.a).normalize();
    const len = edge.a.distanceTo(edge.b);

    // Check extension beyond both endpoints
    for (const [origin, sign] of [[edge.b, 1], [edge.a, -1]] as [THREE.Vector3, number][]) {
      // Project groundPoint onto extension line
      const toGround = groundPoint.clone().sub(origin);
      const t = toGround.dot(dir) * sign;

      if (t <= 0 || t > len * 3) continue; // only forward, limited range

      const extPt = origin.clone().add(dir.clone().multiplyScalar(t * sign));
      const s = toScreenPx(extPt);
      if (!s) continue;

      // Check if near the extension LINE (not just any point)
      const dist = mousePx.distanceTo(s);
      if (dist <= threshold) {
        return { position: extPt, screenPx: s };
      }
    }
    return null;
  }

  /** Parallel snap — find point where mouse ray is parallel to an edge from reference */
  private parallelSnap(
    ref: THREE.Vector3,
    groundPoint: THREE.Vector3,
    edge: EdgeSegment,
  ): THREE.Vector3 | null {
    const edgeDir = edge.b.clone().sub(edge.a).normalize();
    const refToGround = groundPoint.clone().sub(ref);

    // Project refToGround onto edgeDir
    const t = refToGround.dot(edgeDir);
    if (Math.abs(t) < 1) return null; // too close

    const projected = ref.clone().add(edgeDir.multiplyScalar(t));

    // Check parallelism: the projected point should be close to the ground point
    const deviation = projected.distanceTo(groundPoint);
    const parallelThresholdMm = Math.max(50, Math.abs(t) * 0.05); // 5% or 50mm

    if (deviation < parallelThresholdMm) {
      return projected;
    }
    return null;
  }

  /** Quadrant points for a circle-like face (4 cardinal points on the perimeter) */
  private quadrantPoints(center: THREE.Vector3, verts: THREE.Vector3[]): THREE.Vector3[] {
    if (verts.length < 4) return [];

    // Find the face plane normal
    const v0 = verts[0].clone().sub(center);
    const v1 = verts[1].clone().sub(center);
    const normal = v0.clone().cross(v1).normalize();

    // Find local X and Y axes on the face plane
    let localX = v0.clone().normalize();
    let localY = normal.clone().cross(localX).normalize();

    // Average radius
    let sumR = 0;
    for (const v of verts) sumR += v.distanceTo(center);
    const radius = sumR / verts.length;

    // 4 quadrant points
    return [
      center.clone().add(localX.clone().multiplyScalar(radius)),   // 0°
      center.clone().add(localY.clone().multiplyScalar(radius)),   // 90°
      center.clone().add(localX.clone().multiplyScalar(-radius)),  // 180°
      center.clone().add(localY.clone().multiplyScalar(-radius)),  // 270°
    ];
  }
}
