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
import { debugLog } from '../utils/debug';
import { telemetry } from '../core/telemetry';

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
  // 축 / 그리드 (SketchUp-style inference)
  | 'axisX'           // X축 추론 (빨강)
  | 'axisY'           // Y축 추론 (파랑)
  | 'axisZ'           // Z축 추론 (초록)
  | 'grid'            // 그리드 스냅
  // 기타
  | 'node'            // 노드
  | 'insertion'       // 삽입점
  | 'nearest'         // 근처점
  // 특수
  | 'tempTrack'       // 임시 추적점
  | 'from'            // 시작점 (기준점)
  | 'mid2p'           // 2점 사이의 중간
  | 'loopClose';      // 루프 닫기 (녹색)

/**
 * ADR-146 β-1 — Deprecated SnapTypes (Q1=(b) 의식적 deprecate).
 *
 * External anchor: `reports/입력보정파이프라인_적용계획.html` §2.2 P8 +
 * ADR-146 §2.1 Q1=(b) 결재 (2026-05-26).
 *
 * Canonical: `'node'` SnapType (DXF POINT primitive vertex 의미) 는 currently
 * findSnap 분기 0 — silent skip. AxiA 의 vertex snap 은 모두 `'endpoint'`
 * 가 처리 (edge endpoint + vertex/anchor). 별도 `'node'` 의 architectural
 * 의미 미정의.
 *
 * Policy (ADR-146 L-146-1 메타-원칙 #16 정합):
 * - SnapType union 보존 (legacy localStorage / 외부 caller 호환)
 * - SnapMarkerDef visual config 보존 (Line 118)
 * - findSnap 진입 시 deprecated mode 활성 → 명시 telemetry +
 *   debug log (silent skip 차단, 메타-원칙 #4 SSOT 정합)
 * - 향후 DrawPoint 도구 활성 시 별도 ADR 에서 unfreeze 가능
 *
 * Re-introduction requires: 새 ADR + DrawPoint primitive tool + node snap
 * 분기 (findSnap branch + getNodeSnapPositions API).
 */
export const DEPRECATED_SNAP_TYPES: ReadonlySet<SnapType> = new Set<SnapType>([
  'node',
]);

// ═══ Snap marker shape definitions ═══
export interface SnapMarkerDef {
  shape: 'square' | 'triangle' | 'x' | 'circle' | 'diamond' | 'perpendicular'
       | 'parallel' | 'dot' | 'plus' | 'extension' | 'apparent' | 'geometric'
       | 'filledCircle' | 'onFace';
  color: string;
  label: string;        // Korean tooltip label
  labelEn: string;      // English label
}

// SketchUp-style color scheme (A2):
//   endpoint=green, midpoint=cyan, intersection=red X, on-edge=magenta,
//   on-face=blue, parallel/perp=pink, axis X=red Y=blue Z=green
const C_ENDPOINT      = '#00C800';  // green
const C_MIDPOINT      = '#00E0E0';  // cyan
const C_INTERSECTION  = '#E02020';  // red
const C_CENTER        = '#008000';  // darker green
const C_PERPENDICULAR = '#E060B0';  // pink
const C_PARALLEL      = '#E060B0';  // pink
const C_TANGENT       = '#00B894';  // teal
const C_QUADRANT      = '#008080';  // teal-dark
const C_ON_EDGE       = '#D845D8';  // magenta
const C_ON_FACE       = '#2E7BFF';  // blue
const C_EXTENSION     = '#E060B0';  // pink dashed
const C_AXIS_X        = '#E02020';  // red
const C_AXIS_Y        = '#2E7BFF';  // blue
const C_AXIS_Z        = '#00C800';  // green
const C_GRID          = '#808080';  // grey
const C_MISC          = '#FF8F2F';  // orange
const C_LOOP_CLOSE    = '#00CC44';  // bright green

export const SNAP_MARKERS: Record<SnapType, SnapMarkerDef> = {
  endpoint:      { shape: 'square',        color: C_ENDPOINT,      label: '끝점',         labelEn: 'Endpoint' },
  midpoint:      { shape: 'triangle',      color: C_MIDPOINT,      label: '중간점',       labelEn: 'Midpoint' },
  intersection:  { shape: 'x',             color: C_INTERSECTION,  label: '교차점',       labelEn: 'Intersection' },
  apparent:      { shape: 'apparent',      color: C_INTERSECTION,  label: '가상 교차점',   labelEn: 'Apparent Int.' },
  extension:     { shape: 'extension',     color: C_EXTENSION,     label: '연장선',       labelEn: 'Extension' },
  center:        { shape: 'circle',        color: C_CENTER,        label: '중심점',       labelEn: 'Center' },
  geometric:     { shape: 'geometric',     color: C_CENTER,        label: '기하학적 중심', labelEn: 'Geo. Center' },
  quadrant:      { shape: 'diamond',       color: C_QUADRANT,      label: '사분점',       labelEn: 'Quadrant' },
  tangent:       { shape: 'circle',        color: C_TANGENT,       label: '접점',         labelEn: 'Tangent' },
  perpendicular: { shape: 'perpendicular', color: C_PERPENDICULAR, label: '수직점',       labelEn: 'Perpendicular' },
  parallel:      { shape: 'parallel',      color: C_PARALLEL,      label: '평행',         labelEn: 'Parallel' },
  onFace:        { shape: 'onFace',        color: C_ON_FACE,       label: '면 위',        labelEn: 'On Face' },
  axisX:         { shape: 'parallel',      color: C_AXIS_X,        label: 'X축',          labelEn: 'On Red Axis' },
  axisY:         { shape: 'parallel',      color: C_AXIS_Y,        label: 'Y축',          labelEn: 'On Blue Axis' },
  axisZ:         { shape: 'parallel',      color: C_AXIS_Z,        label: 'Z축',          labelEn: 'On Green Axis' },
  grid:          { shape: 'plus',          color: C_GRID,          label: '그리드',       labelEn: 'Grid' },
  node:          { shape: 'dot',           color: C_ON_EDGE,       label: '노드',         labelEn: 'Node' },
  insertion:     { shape: 'plus',          color: C_MISC,          label: '삽입',         labelEn: 'Insertion' },
  nearest:       { shape: 'x',             color: C_ON_EDGE,       label: '근처점',       labelEn: 'Nearest' },
  tempTrack:     { shape: 'plus',          color: C_MISC,          label: '임시 추적점',   labelEn: 'Temp Track' },
  from:          { shape: 'dot',           color: C_MISC,          label: '시작점',       labelEn: 'From' },
  mid2p:         { shape: 'triangle',      color: C_MIDPOINT,      label: '2점 중간',     labelEn: 'Mid 2 Points' },
  loopClose:     { shape: 'filledCircle',  color: C_LOOP_CLOSE,    label: '루프 닫기',     labelEn: 'Close Loop' },
};

export interface SnapPoint {
  type: SnapType;
  position: THREE.Vector3;
  screenPos?: THREE.Vector2;     // screen pixel position
  distance?: number;             // screen distance from mouse (pixels)
  edgeRef?: { a: THREE.Vector3; b: THREE.Vector3 }; // edge reference for extension/parallel
  /** A6: origin point for guide line rendering (axis/parallel/perpendicular) */
  guideFrom?: THREE.Vector3;
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

// ═══ Performance limits (S5) ═══
// 각 O(N)/O(N²) 스냅 모드의 최대 순회 개수. 대형 씬에서 mousemove 부담 방지.
const MAX_EDGES_PER_MODE = 500;
const MAX_FACES_PER_MODE = 300;

/**
 * ADR-146 β-3 — Recency (A4) module-level constants.
 *
 * Canonical anchor: CLAUDE.md "SketchUp-style Inference Engine §Scoring":
 *   "priority × 1000 - pixel distance ... Recency bonus (A4): 400ms 이내
 *    같은 타입 재등장 시 -0.5 보정"
 *
 * Behavior contract:
 *   - 같은 타입 SnapPoint 가 RECENCY_MS 이내 재등장 시 -RECENCY_BONUS_MAGNITUDE
 *     (priority 감소 = 우선순위 상승)
 *   - 다른 타입 → no bonus
 *   - RECENCY_MS 초과 → no bonus
 *
 * Changing these constants requires a new ADR (LOCKED #66 Sunset Policy
 * — Recency contract is part of the canonical user-facing UX).
 */
export const RECENCY_MS = 400;
export const RECENCY_BONUS_MAGNITUDE = 0.5;

/**
 * ADR-146 β-3 — Pure Recency bonus computation (extracted for testability).
 *
 * @param lastSnap - The previous snap result (or null if none).
 * @param lastSnapTime - performance.now() of the previous snap.
 * @param candidateType - Type of the candidate being scored.
 * @param now - Current performance.now() value.
 * @returns Negative bonus (priority reduction = higher rank) when recency
 *   conditions met, 0 otherwise.
 */
export function computeRecencyBonus(
  lastSnap: SnapPoint | null,
  lastSnapTime: number,
  candidateType: SnapType,
  now: number,
): number {
  if (!lastSnap) return 0;
  if (lastSnap.type !== candidateType) return 0;
  const age = now - (lastSnapTime || 0);
  if (age > RECENCY_MS) return 0;
  return -RECENCY_BONUS_MAGNITUDE;
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
  axisX: 8,         // 축 추론 — parallel과 동급 우선순위
  axisY: 8,
  axisZ: 8,
  grid: 18,         // grid는 가장 낮은 우선순위 (SketchUp 관습)
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

  // Phase B4: Spatial hash — world cells → vertex indices.
  // Cell size should be a multiple of typical snap threshold (≈ 10-100× pixel threshold).
  private static readonly CELL_SIZE = 5000; // mm
  private _vertexCells: Map<string, number[]> = new Map();

  // Phase C2: cache signature for dirty tracking — updateFromMesh early-outs
  // when the incoming mesh buffers match the last build.
  private _cacheSig: string = '';

  // Reference point for perpendicular/tangent/parallel/extension
  private referencePoint: THREE.Vector3 | null = null;

  // Extension tracking: hovered edge history
  private hoveredEdge: EdgeSegment | null = null;

  // Temp track points accumulated during a command
  private trackPoints: THREE.Vector3[] = [];

  // Mid-between-2-points mode
  private mid2pFirst: THREE.Vector3 | null = null;

  // Last snap result
  private _lastSnap: SnapPoint | null = null;
  /** performance.now() of the last snap — for A4 recency bonus */
  private _lastSnapTime: number = 0;

  /**
   * ADR-146 β-1 — Deprecated SnapType warning state.
   *
   * Records which deprecated modes have been warned about (once per session
   * per type). Prevents log spam on every findSnap call. Cleared by
   * `resetDeprecationWarnings()` (test helper).
   */
  private _deprecationWarned: Set<SnapType> = new Set();

  // ═══ Phase B1: Inference Lock ═══
  /**
   * When set, findSnap projects the cursor onto this snap's constraint and
   * returns the locked snap with the projected position. Used for SketchUp-style
   * Shift-to-lock behavior: hover a snap → hold Shift → snap is "sticky" along
   * its axis/direction.
   */
  private _lockedInference: SnapPoint | null = null;

  // ═══ Phase B2: Inference Chaining ═══
  /**
   * Queue of recently hovered edges. When the cursor passes over an edge, it's
   * added here and its direction is used to suggest parallel/extension snaps
   * even when the edge is not the immediate target.
   */
  private _recentHoveredEdges: EdgeSegment[] = [];
  private static readonly RECENT_EDGE_CAP = 3;

  // ═══ Phase B3: Tentative Snap (Tab cycling) ═══
  /** Index into the last candidate list — cycled by Tab */
  private _tentativeIndex: number = 0;
  /** Last ranked candidates (updated each findSnap call). Frozen for Tab cycling. */
  private _lastRankedCandidates: SnapPoint[] = [];

  // Callbacks
  private _onSnapChange?: (snap: SnapPoint | null) => void;

  // ═══ ADR-047 P32 — Chain self-touch prevention ═══
  /**
   * Positions to EXCLUDE from endpoint/nearest snap (position-based, ε=1.5μm
   * matching LOCKED #5 spatial-hash dedup tolerance). Set per-frame by the
   * active tool (e.g. DrawLineTool sets chainPoints[1..] so the chain cannot
   * snap onto its own pending vertices, while chainStart remains available
   * for the close gesture).
   */
  private _excludePositions: THREE.Vector3[] = [];
  /** Squared world-space tolerance for position-based exclusion. (1.5μm)² */
  private static readonly EXCLUDE_TOL_SQ = 1.5e-3 * 1.5e-3;


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
        'axisX', 'axisY', 'axisZ',   // A3: 축 추론 기본 활성
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

  /**
   * ADR-146 β-1 — Reset deprecation warning state (test helper).
   *
   * Allows test runners to verify the "once-per-session" behavior by
   * clearing the warning record between assertions. Not intended for
   * production use.
   */
  resetDeprecationWarnings(): void {
    this._deprecationWarned.clear();
  }

  /**
   * ADR-146 β-1 — Inspect deprecation warning state (test helper).
   *
   * Returns a read-only snapshot of which deprecated SnapTypes have already
   * been warned about in the current session.
   */
  getDeprecationWarned(): ReadonlySet<SnapType> {
    return this._deprecationWarned;
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

  /**
   * Line 도구에 최적화된 snap 프리셋 적용.
   *
   * 면 자동 생성(drawLine의 loop closure, face split, D resolver)에 가장 우호적인
   * snap 모드만 활성화. 원칙:
   *  - 기존 vertex/edge/midpoint에 정확히 붙도록 유도 → loop closure 성공률 ↑
   *  - 기하학적 정확성 보장 (axis/parallel/perpendicular)
   *  - "빈 공간에 떠 있는" snap(extension/apparent/grid)은 제외 → dangling vertex 방지
   *
   * 비활성화된 모드는 `saveSnapConfig`로 복원 가능 (Line 도구 해제 시).
   */
  applyFaceCreationPreset(): void {
    this.config.modes = new Set<SnapType>([
      // 핵심: loop closure + face split 트리거
      'endpoint',       // 기존 vertex에 정확히 붙음 (loop 닫기의 기본)
      'midpoint',       // 기존 edge 중점 → edge split + face 재분할
      'intersection',   // 실제 교차 vertex — 자동 vertex 삽입 + split
      'nearest',        // edge 위 임의 점 → endpoint-on-edge 케이스 (split 트리거)
      'onFace',         // 면 내부 점 → face split 케이스
      // 기하학적 정확성 (선을 정확한 방향으로 유지 → 이후 다른 선과 정확히 교차)
      'perpendicular',
      'parallel',
      'axisX', 'axisY', 'axisZ',
    ]);
    // 의도적으로 제외: extension, apparent, grid, center, quadrant, tangent, geometric
    // — 이들은 "빈 공간"에 snap하여 dangling vertex를 만들 가능성이 있음.
  }

  /**
   * 현재 snap 모드 스냅샷. 도구 전환 시 원복을 위해 저장해 둘 수 있음.
   */
  saveSnapConfig(): Set<SnapType> {
    return new Set(this.config.modes);
  }

  /**
   * 저장된 snap 모드 복원.
   */
  restoreSnapConfig(saved: Set<SnapType>): void {
    this.config.modes = new Set(saved);
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

  // ═══ Phase B1: Inference Lock API ═══

  /**
   * Lock the current snap. Subsequent findSnap calls project the cursor onto
   * this snap's constraint (axis / plane / line) and keep returning it until
   * `clearLockedInference()` is called.
   */
  setLockedInference(snap: SnapPoint | null) {
    this._lockedInference = snap;
  }
  clearLockedInference() {
    this._lockedInference = null;
  }
  hasLockedInference(): boolean {
    return this._lockedInference !== null;
  }
  getLockedInference(): SnapPoint | null {
    return this._lockedInference;
  }

  // ═══ Phase B2: Inference Chaining API ═══

  /**
   * Register an edge the user just hovered over. The edge's direction is
   * used to generate parallel/extension candidates in subsequent findSnap calls.
   * Capped at RECENT_EDGE_CAP.
   */
  recordHoveredEdge(a: THREE.Vector3, b: THREE.Vector3) {
    // Dedup: skip if same edge already in queue (by both endpoints)
    for (const e of this._recentHoveredEdges) {
      if (e.a.distanceToSquared(a) < 1 && e.b.distanceToSquared(b) < 1) return;
      if (e.a.distanceToSquared(b) < 1 && e.b.distanceToSquared(a) < 1) return;
    }
    this._recentHoveredEdges.push({ a: a.clone(), b: b.clone() });
    while (this._recentHoveredEdges.length > SnapManager.RECENT_EDGE_CAP) {
      this._recentHoveredEdges.shift();
    }
  }
  clearRecentEdges() {
    this._recentHoveredEdges = [];
  }
  getRecentEdges(): readonly EdgeSegment[] {
    return this._recentHoveredEdges;
  }

  // ═══ Phase B3: Tentative Snap API (Tab cycling) ═══

  /**
   * Advance through the last candidate list. Returns the new best-candidate,
   * or null if no candidates are ranked.
   */
  cycleTentative(): SnapPoint | null {
    if (this._lastRankedCandidates.length === 0) return null;
    this._tentativeIndex =
      (this._tentativeIndex + 1) % this._lastRankedCandidates.length;
    const chosen = this._lastRankedCandidates[this._tentativeIndex];
    this.setResult(chosen);
    return chosen;
  }
  resetTentative() {
    this._tentativeIndex = 0;
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
   * ADR-047 P32 — Set vertex positions excluded from endpoint snap.
   *
   * Called by ToolManager before each findSnap, sourced from the active
   * tool's `getExcludedSnapPoints()` (e.g. chainPoints[1..] for an
   * in-progress DrawLine chain). Pass `[]` to clear.
   *
   * Pre-existing chainStart is intentionally NOT excluded — auto-close to
   * the start point is the user's primary close gesture (loopClose).
   */
  setExcludePositions(positions: readonly THREE.Vector3[]): void {
    this._excludePositions = positions.map(p => p.clone());
  }

  /** True if `pos` is within tolerance of any excluded position. */
  private isPositionExcluded(pos: THREE.Vector3): boolean {
    if (this._excludePositions.length === 0) return false;
    for (const ex of this._excludePositions) {
      if (pos.distanceToSquared(ex) <= SnapManager.EXCLUDE_TOL_SQ) return true;
    }
    return false;
  }

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
      // ADR-047 P32: skip chain-pending vertices to avoid self-touch.
      if (this.isPositionExcluded(v)) continue;
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

  /** Force the next `updateFromMesh` to rebuild even if signature matches.
   *  Called by operations that add NEW faces but where we want to be
   *  defensive about the sig check missing a change (e.g. clipboard paste,
   *  array, boolean — all topology-changing ops). */
  invalidateCache(): void {
    this._cacheSig = '';
  }

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
    // Phase C2: cheap signature — array lengths are usually enough to detect
    // topology changes. Vertex positions within unchanged buffers don't change.
    // When positions DO change (translate/rotate/scale), the bridge currently
    // calls syncMesh which invokes this function. In delta paths the lengths
    // stay the same → we'd skip rebuild, missing moved positions. Extend
    // signature with a positions hash sample to catch that too.
    let posSample = 0;
    const step = Math.max(1, Math.floor(positions.length / 32));
    for (let i = 0; i < positions.length; i += step) {
      posSample = (posSample * 31 + Math.round(positions[i] * 1000)) | 0;
    }
    const sig = `${positions.length}:${indices.length}:${faceMap.length}:${edgeLines?.length ?? 0}:${snapVerticesF64?.length ?? 0}:${posSample}`;
    if (sig === this._cacheSig) {
      // No-op: cache still valid. Caller called syncMesh but nothing changed
      // geometrically that affects snap. Saves the O(V+E+F) rebuild.
      return;
    }
    this._cacheSig = sig;

    this.vertices = [];
    this.edges = [];
    this.faceCenters = [];
    this.faceData.clear();

    const vertSet = new Map<string, THREE.Vector3>();

    // ── 1) Unique vertices — prefer f64 precision for exact snap ──
    // S2 fix: dedup 키를 μm (1e-3 mm) 정밀도로 변경.
    // 이전 toFixed(1)은 0.1mm 반올림이라 미세 간격 정점이 병합되어
    // 일부 정점에 스냅 안 걸리는 문제가 있었음.
    const dedupKey = (x: number, y: number, z: number) =>
      `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;

    if (snapVerticesF64 && snapVerticesF64.length >= 3) {
      // Use f64 vertex positions from WASM (exact DCEL coordinates, no f32 loss)
      const vertCount = snapVerticesF64.length / 3;
      for (let i = 0; i < vertCount; i++) {
        const v = new THREE.Vector3(
          snapVerticesF64[i * 3],
          snapVerticesF64[i * 3 + 1],
          snapVerticesF64[i * 3 + 2],
        );
        const key = dedupKey(v.x, v.y, v.z);
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
        const key = dedupKey(v.x, v.y, v.z);
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
        const keyA = dedupKey(a.x, a.y, a.z);
        const keyB = dedupKey(b.x, b.y, b.z);
        if (!vertSet.has(keyA)) vertSet.set(keyA, a.clone());
        if (!vertSet.has(keyB)) vertSet.set(keyB, b.clone());
      }
    } else if (positions.length > 0) {
      // Fallback: boundary edges from triangles
      const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; count: number }>();
      const ek = (a: THREE.Vector3, b: THREE.Vector3) => {
        const ka = dedupKey(a.x, a.y, a.z);
        const kb = dedupKey(b.x, b.y, b.z);
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

    // Phase B4: Rebuild vertex spatial hash for fast endpoint proximity queries
    this._vertexCells.clear();
    const cs = SnapManager.CELL_SIZE;
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      const cx = Math.floor(v.x / cs);
      const cy = Math.floor(v.y / cs);
      const cz = Math.floor(v.z / cs);
      const key = `${cx},${cy},${cz}`;
      let bucket = this._vertexCells.get(key);
      if (!bucket) {
        bucket = [];
        this._vertexCells.set(key, bucket);
      }
      bucket.push(i);
    }

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
        const key = dedupKey(v.x, v.y, v.z);
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
    // ADR-146 β-2 (Q2=a) — Direct latency measurement.
    // PickingRouter wrap 외 findSnap 진입~출구 직접 측정. Hover 16ms
    // budget 의 sub-component (메타-원칙 #11 정합). telemetry.measure
    // captures elapsed on both success and exception paths.
    return telemetry.measure('findSnap', (): SnapPoint | null => {
    if (!this.config.enabled) {
      this.setResult(null);
      return null;
    }

    // Phase B1: Inference lock short-circuit
    // When locked, project cursor onto the lock's constraint and return it.
    if (this._lockedInference) {
      const projected = this.projectOntoLock(
        this._lockedInference,
        mouseX, mouseY, camera, canvas, groundPoint,
      );
      this.setResult(projected);
      return projected;
    }

    // ADR-146 β-1 — Deprecated SnapType warning (once per session per type).
    // Q1=(b) 의식적 deprecate path — silent skip 차단 (메타-원칙 #4 SSOT).
    // 사용자가 deprecated mode 활성 시 debugLog + state mark.
    // 향후 ADR (DrawPoint primitive tool) 에서 unfreeze 가능.
    for (const depType of DEPRECATED_SNAP_TYPES) {
      if (this.config.modes.has(depType) && !this._deprecationWarned.has(depType)) {
        this._deprecationWarned.add(depType);
        debugLog(
          `[ADR-146 β-1] SnapType '${depType}' is deprecated (no findSnap branch). ` +
          `Use 'endpoint' instead. Re-introduction requires new ADR.`,
        );
      }
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

    const addCandidate = (type: SnapType, position: THREE.Vector3, screenPx: THREE.Vector2, edgeRef?: EdgeSegment, guideFrom?: THREE.Vector3) => {
      const dist = mousePx.distanceTo(screenPx);
      candidates.push({
        type,
        position: position.clone(),
        screenPos: screenPx.clone(),
        distance: dist,
        edgeRef: edgeRef ? { a: edgeRef.a.clone(), b: edgeRef.b.clone() } : undefined,
        guideFrom: guideFrom ? guideFrom.clone() : undefined,
      });
    };

    const modes = this.config.modes;

    // ── Endpoint (끝점) ■ ──
    if (modes.has('endpoint')) {
      // Phase B4: use spatial hash if we have a groundPoint (3D location)
      // to narrow candidates. Falls back to linear scan when no groundPoint.
      const candIdx = groundPoint
        ? this.queryVertexCells(groundPoint)
        : null;
      const iter = candIdx
        ? (fn: (v: THREE.Vector3) => void) => { for (const i of candIdx) fn(this.vertices[i]); }
        : (fn: (v: THREE.Vector3) => void) => { for (const v of this.vertices) fn(v); };
      iter(v => {
        // ADR-047 P32: skip chain-pending vertices to prevent self-touch
        // (chainStart remains available for loopClose).
        if (this.isPositionExcluded(v)) return;
        const s = toScreenPx(v);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('endpoint', v, s);
        }
      });
    }

    // ── Midpoint (중간점) ▲ ──
    if (modes.has('midpoint')) {
      const cap = Math.min(this.edges.length, MAX_EDGES_PER_MODE);
      for (let i = 0; i < cap; i++) {
        const edge = this.edges[i];
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
      // Phase B2: recently hovered edges also contribute extension candidates
      for (const edge of this._recentHoveredEdges) {
        const ext = this.extensionSnap(groundPoint, edge, threshold * 1.5, toScreenPx, mousePx);
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
      const cap = Math.min(this.edges.length, MAX_EDGES_PER_MODE);
      for (let i = 0; i < cap; i++) {
        const edge = this.edges[i];
        const perp = this.perpendicularPoint(this.referencePoint, edge.a, edge.b);
        if (!perp) continue;
        const s = toScreenPx(perp);
        if (s && mousePx.distanceTo(s) <= threshold) {
          addCandidate('perpendicular', perp, s, edge, this.referencePoint);
        }
      }
    }

    // ── Parallel (평행) // ──
    if (modes.has('parallel') && this.referencePoint && groundPoint) {
      const cap = Math.min(this.edges.length, MAX_EDGES_PER_MODE);
      for (let i = 0; i < cap; i++) {
        const edge = this.edges[i];
        const par = this.parallelSnap(this.referencePoint, groundPoint, edge);
        if (!par) continue;
        const s = toScreenPx(par);
        if (s && mousePx.distanceTo(s) <= threshold * 1.5) {
          addCandidate('parallel', par, s, edge, this.referencePoint);
        }
      }
      // Phase B2: Inference chaining — recently hovered edges also contribute
      // parallel/extension candidates even after user's cursor leaves them.
      for (const edge of this._recentHoveredEdges) {
        const par = this.parallelSnap(this.referencePoint, groundPoint, edge);
        if (!par) continue;
        const s = toScreenPx(par);
        if (s && mousePx.distanceTo(s) <= threshold * 2) {
          addCandidate('parallel', par, s, edge, this.referencePoint);
        }
      }
    }

    // ── A3: Axis inference (X/Y/Z) — SketchUp style ──
    // referencePoint가 있을 때(그리는 중) 세계 축 방향으로 스냅.
    // 커서 방향이 축 ±axisSnapAngle 이내면 그 축에 투영.
    if (this.referencePoint && groundPoint) {
      const AXIS_ANGLE_DEG = 7.0;
      const cosThresh = Math.cos(AXIS_ANGLE_DEG * Math.PI / 180);
      const axes: Array<{ type: SnapType; dir: THREE.Vector3 }> = [
        { type: 'axisX', dir: new THREE.Vector3(1, 0, 0) },
        { type: 'axisY', dir: new THREE.Vector3(0, 1, 0) },
        { type: 'axisZ', dir: new THREE.Vector3(0, 0, 1) },
      ];
      const delta = groundPoint.clone().sub(this.referencePoint);
      const deltaLen = delta.length();
      if (deltaLen > 1e-6) {
        const dirN = delta.clone().divideScalar(deltaLen);
        for (const ax of axes) {
          if (!modes.has(ax.type)) continue;
          const cosA = Math.abs(dirN.dot(ax.dir));
          if (cosA < cosThresh) continue;
          // Sign-aware projection onto axis
          const sign = dirN.dot(ax.dir) >= 0 ? 1 : -1;
          const projLen = delta.dot(ax.dir) * sign;
          const signedDir = ax.dir.clone().multiplyScalar(sign);
          const axisPt = this.referencePoint.clone()
            .add(signedDir.multiplyScalar(projLen));
          const s = toScreenPx(axisPt);
          if (s && mousePx.distanceTo(s) <= threshold * 2) {
            // A6: guideFrom = referencePoint → SnapVisual이 축 방향 점선 렌더
            addCandidate(ax.type, axisPt, s, undefined, this.referencePoint);
          }
        }
      }
    }

    // ── On Face (면 위 투영) — 사용자 요청: 주변 면에 맞춤 ──
    if (modes.has('onFace') && faceHitPoint) {
      const s = toScreenPx(faceHitPoint);
      // S4 fix: 다른 모드와 일관되게 threshold 체크 추가.
      // onFace는 priority 14로 마지막이므로 다른 스냅이 있으면 그쪽이 이김.
      if (s && mousePx.distanceTo(s) <= threshold) {
        addCandidate('onFace', faceHitPoint, s);
      }
    }

    // ── Tangent (접점) — reference point에서 원형 face로의 접선 ──
    if (modes.has('tangent') && this.referencePoint) {
      let faceCount = 0;
      for (const [, data] of this.faceData) {
        if (faceCount++ >= MAX_FACES_PER_MODE) break;
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
      const cap = Math.min(this.edges.length, MAX_EDGES_PER_MODE);
      for (let i = 0; i < cap; i++) {
        const edge = this.edges[i];
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

    // ── A1: Grid snap (가장 낮은 우선순위) ──
    if (modes.has('grid') && groundPoint && this.config.gridSpacing > 0) {
      const gs = this.config.gridSpacing;
      const gridPt = new THREE.Vector3(
        Math.round(groundPoint.x / gs) * gs,
        Math.round(groundPoint.y / gs) * gs,
        Math.round(groundPoint.z / gs) * gs,
      );
      const s = toScreenPx(gridPt);
      if (s && mousePx.distanceTo(s) <= threshold * 1.5) {
        addCandidate('grid', gridPt, s);
      }
    }

    // ── Pick best candidate ──
    if (candidates.length === 0) {
      this.setResult(null);
      return null;
    }

    // A4: Recency bonus — 최근 RECENCY_MS 이내 같은 타입이 이겼으면 약간의
    // 우선순위 가산. 사용자가 연속 작업 중 같은 스냅 타입을 선호하는 경향
    // 반영. ADR-146 β-3 에서 module-level `computeRecencyBonus()` 로 추출.
    const now = performance.now();

    // Sort: (priority + recency), then screen distance
    candidates.sort((a, b) => {
      const pa = SNAP_PRIORITY[a.type]
        + computeRecencyBonus(this._lastSnap, this._lastSnapTime, a.type, now);
      const pb = SNAP_PRIORITY[b.type]
        + computeRecencyBonus(this._lastSnap, this._lastSnapTime, b.type, now);
      if (pa !== pb) return pa - pb;
      return (a.distance || 0) - (b.distance || 0);
    });

    // Phase B3: store ranked list for Tab cycling (Tentative snap)
    this._lastRankedCandidates = candidates;
    this._tentativeIndex = 0;

    // Remove duplicates: if endpoint and nearest are at same position, keep endpoint
    const best = candidates[0];
    this.setResult(best);
    this._lastSnapTime = now;
    return best;
    }); // end telemetry.measure (ADR-146 β-2)
  }

  /**
   * Phase B1: Project cursor onto a locked inference's constraint.
   * - axisX/Y/Z: project cursor ray onto the world axis line through guideFrom
   * - parallel/perpendicular: project along the edge direction or perpendicular
   * - endpoint/midpoint/center/etc. (point snaps): return unchanged (point lock)
   * - grid / onFace / extension / nearest: return unchanged
   */
  private projectOntoLock(
    lock: SnapPoint,
    mouseX: number, mouseY: number,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    groundPoint?: THREE.Vector3 | null,
  ): SnapPoint {
    const rect = canvas.getBoundingClientRect();
    const toScreenPx = (p: THREE.Vector3): THREE.Vector2 => {
      const v = p.clone().project(camera);
      return new THREE.Vector2(
        (v.x * 0.5 + 0.5) * rect.width + rect.left,
        (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      );
    };

    // Axis lock: project groundPoint onto the world axis passing through guideFrom
    if (lock.type === 'axisX' || lock.type === 'axisY' || lock.type === 'axisZ') {
      const origin = lock.guideFrom ?? lock.position;
      const axis = lock.type === 'axisX'
        ? new THREE.Vector3(1, 0, 0)
        : lock.type === 'axisY'
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1);
      const target = groundPoint ?? lock.position;
      const delta = target.clone().sub(origin);
      const t = delta.dot(axis);
      const projected = origin.clone().add(axis.clone().multiplyScalar(t));
      const s = toScreenPx(projected);
      const d = Math.sqrt((mouseX - s.x) ** 2 + (mouseY - s.y) ** 2);
      return { ...lock, position: projected, screenPos: s, distance: d };
    }

    // Parallel/perpendicular lock: project along the edge direction from guideFrom
    if ((lock.type === 'parallel' || lock.type === 'perpendicular')
      && lock.edgeRef && lock.guideFrom) {
      const dir = lock.edgeRef.b.clone().sub(lock.edgeRef.a).normalize();
      const target = groundPoint ?? lock.position;
      const delta = target.clone().sub(lock.guideFrom);
      const t = delta.dot(dir);
      const projected = lock.guideFrom.clone().add(dir.clone().multiplyScalar(t));
      const s = toScreenPx(projected);
      const d = Math.sqrt((mouseX - s.x) ** 2 + (mouseY - s.y) ** 2);
      return { ...lock, position: projected, screenPos: s, distance: d };
    }

    // Point locks: return as-is
    return lock;
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

  /**
   * Push/Pull "alignment" distance — find signed distance along startNormal
   * from startHitPoint to a nearby reference vertex / edge / parallel face.
   *
   * v1 scope:
   *   - Parallel faces (|n·targetN| > 0.95) — plane-to-plane perpendicular distance
   *   - Edges — closest-point-on-segment to the normal line
   *   - Vertices — direct projection onto the normal line
   *
   * @param mouseX client X
   * @param mouseY client Y
   * @param camera active camera
   * @param canvas renderer canvas
   * @param startFaceId — start face (excluded from alignment, self-reference)
   * @param startHitPoint — point on the start face (centroid or click hit)
   * @param startNormal — the start face's normal (unit vector)
   * @returns alignment info or null
   */
  findAlignedDistance(
    mouseX: number, mouseY: number,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    startFaceId: number,
    startHitPoint: THREE.Vector3,
    startNormal: THREE.Vector3,
  ): {
    dist: number;
    target: THREE.Vector3;
    targetType: 'vertex' | 'edge' | 'face';
  } | null {
    const rect = canvas.getBoundingClientRect();
    const mousePx = new THREE.Vector2(mouseX, mouseY);
    const threshold = this.config.pixelThreshold * 1.5; // 조금 너그러운 임계값

    const toScreenPx = (pos: THREE.Vector3): THREE.Vector2 | null => {
      const v = pos.clone().project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return new THREE.Vector2(
        (v.x * 0.5 + 0.5) * rect.width + rect.left,
        (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      );
    };

    /** signed distance from startHitPoint to p along startNormal */
    const alignDist = (p: THREE.Vector3): number => {
      return p.clone().sub(startHitPoint).dot(startNormal);
    };

    type Candidate = {
      dist: number;
      target: THREE.Vector3;
      targetType: 'vertex' | 'edge' | 'face';
      screenDist: number;
      priority: number; // lower = higher priority
    };
    const candidates: Candidate[] = [];

    const MIN_ALIGN_DIST = 1.0; // 1mm 이하 거리 제외 (자기 자신과 가까운 면)

    // ── Vertices (priority 0) ──
    // S5: 성능 캡 (엄청 큰 씬에서 mousemove 부담 방지)
    const vertCap = Math.min(this.vertices.length, MAX_EDGES_PER_MODE);
    for (let vi = 0; vi < vertCap; vi++) {
      const v = this.vertices[vi];
      const d = alignDist(v);
      if (Math.abs(d) < MIN_ALIGN_DIST) continue;
      const s = toScreenPx(v);
      if (!s) continue;
      const sd = mousePx.distanceTo(s);
      if (sd > threshold) continue;
      candidates.push({ dist: d, target: v.clone(), targetType: 'vertex', screenDist: sd, priority: 0 });
    }

    // ── Edges (priority 1) — closest point on segment projected to normal line ──
    const edgeCap = Math.min(this.edges.length, MAX_EDGES_PER_MODE);
    for (let ei = 0; ei < edgeCap; ei++) {
      const edge = this.edges[ei];
      // Find the parameter on edge that minimizes distance to the normal line at startHitPoint
      // Normal line: P(s) = startHitPoint + s * startNormal
      // Edge: E(t) = edge.a + t * (edge.b - edge.a)
      // Minimize |E(t) - P(s)|^2 jointly.
      const ab = edge.b.clone().sub(edge.a);
      const ao = edge.a.clone().sub(startHitPoint);
      const abab = ab.dot(ab);
      const abn = ab.dot(startNormal);
      const aon = ao.dot(startNormal);
      const abao = ab.dot(ao);
      const denom = abab - abn * abn;
      if (Math.abs(denom) < 1e-8) continue; // edge parallel to normal — skip
      const t = (-abao + abn * aon) / denom;
      if (t < -0.01 || t > 1.01) continue; // projection outside segment
      const tClamped = Math.max(0, Math.min(1, t));
      const closestOnEdge = edge.a.clone().add(ab.clone().multiplyScalar(tClamped));
      const d = alignDist(closestOnEdge);
      if (Math.abs(d) < MIN_ALIGN_DIST) continue;
      const s = toScreenPx(closestOnEdge);
      if (!s) continue;
      const sd = mousePx.distanceTo(s);
      if (sd > threshold) continue;
      candidates.push({ dist: d, target: closestOnEdge, targetType: 'edge', screenDist: sd, priority: 1 });
    }

    // ── Parallel faces (priority 2) ──
    let faceIter = 0;
    for (const [fid, data] of this.faceData) {
      if (faceIter++ >= MAX_FACES_PER_MODE) break;
      if (fid === startFaceId) continue; // self-reference
      const cosAng = Math.abs(data.normal.dot(startNormal));
      if (cosAng < 0.95) continue; // not parallel
      // Distance from startHitPoint to target face plane along startNormal
      // plane: n·x + d = 0  →  t = -(n·hit + d) / (n·normal)
      const nDotN = data.normal.dot(startNormal);
      if (Math.abs(nDotN) < 1e-6) continue;
      const tParam = -(data.normal.dot(startHitPoint) + data.planeD) / nDotN;
      if (Math.abs(tParam) < MIN_ALIGN_DIST) continue;
      const intersectPt = startHitPoint.clone().add(startNormal.clone().multiplyScalar(tParam));
      const s = toScreenPx(intersectPt);
      if (!s) continue;
      const sd = mousePx.distanceTo(s);
      if (sd > threshold) continue;
      candidates.push({ dist: tParam, target: intersectPt, targetType: 'face', screenDist: sd, priority: 2 });
    }

    if (candidates.length === 0) return null;

    // Sort: priority first, then screen distance
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.screenDist - b.screenDist;
    });

    const best = candidates[0];
    return { dist: best.dist, target: best.target, targetType: best.targetType };
  }

  /**
   * Phase B4: Query vertex indices in the 3×3×3 cell neighborhood of `world`.
   * Returns `null` if the hash is empty (caller should fall back to linear).
   */
  private queryVertexCells(world: THREE.Vector3): number[] | null {
    if (this._vertexCells.size === 0) return null;
    const cs = SnapManager.CELL_SIZE;
    const cx = Math.floor(world.x / cs);
    const cy = Math.floor(world.y / cs);
    const cz = Math.floor(world.z / cs);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this._vertexCells.get(`${cx+dx},${cy+dy},${cz+dz}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
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
