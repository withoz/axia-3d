// ADR-045 D1 — ActionCatalog SSOT.
//
// Seed data derived from `docs/audits/2026-05-02-integrity-matrix.csv`.
// Each ActionDef is a single source of truth for one operation
// across UI / Bridge / WASM / MCP layers.
//
// Adding an action:
//   1. Append to ALL_ACTIONS below.
//   2. Verify regression tests pass (see test/).
//   3. UI / Bridge / MCP server pick it up automatically via the
//      lookup helpers below.
//
// Removing or renaming an action:
//   - Move the old id to `aliases.legacy[]` to preserve compatibility.
//   - Bump release SCHEMA_VERSION (ADR-041 P26.2) — MAJOR if MCP
//     consumers may rely on the old name.

import type { ActionDef } from './types.js';

/**
 * The complete action catalog. Sorted alphabetically by canonical id
 * for ease of audit + diffing.
 */
export const ALL_ACTIONS: readonly ActionDef[] = [
  // ─── Array / Mirror ───────────────────────────────────────────────
  {
    id: 'array-linear',
    label: '선형 배열',
    description: 'Duplicate selection N times along a linear offset.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'arrayLinearFaces', wasm: 'arrayLinearFaces' },
    adrs: ['ADR-007'],
  },
  {
    id: 'array-radial',
    label: '원형 배열',
    description: 'Duplicate selection N times in a circular pattern.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'arrayRadialFaces', wasm: 'arrayRadialFaces' },
    adrs: ['ADR-007'],
  },
  {
    id: 'mirror-x',
    label: '미러 · YZ 평면',
    description: 'Mirror selected faces across the YZ plane (normal +X).',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'mirrorFaces', wasm: 'mirrorFaces', legacy: ['tool-mirror'] },
    adrs: ['ADR-007'],
  },
  {
    id: 'mirror-y',
    label: '미러 · XZ 평면',
    description: 'Mirror selected faces across the XZ plane (normal +Y).',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'mirrorFaces', wasm: 'mirrorFaces' },
    adrs: ['ADR-007'],
  },
  {
    id: 'mirror-z',
    label: '미러 · XY 평면',
    description: 'Mirror selected faces across the XY plane (normal +Z).',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'mirrorFaces', wasm: 'mirrorFaces' },
    adrs: ['ADR-007'],
  },

  // ─── Boolean ─────────────────────────────────────────────────────
  {
    id: 'bool-union',
    label: '합집합',
    description: 'Boolean union of two solid groups (A ∪ B).',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'booleanOp', wasm: 'boolean_op', mcp: 'boolean_union' },
    adrs: ['ADR-005', 'ADR-007'],
  },
  {
    id: 'bool-subtract',
    label: '차집합',
    description: 'Boolean subtract (A \\ B).',
    tier: 2,
    surfaces: ['menu', 'mcp'],
    aliases: { bridge: 'booleanOp', wasm: 'boolean_op', mcp: 'boolean_subtract' },
    adrs: ['ADR-005', 'ADR-007'],
  },
  {
    id: 'bool-intersect',
    label: '교집합',
    description: 'Boolean intersect (A ∩ B).',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'booleanOp', wasm: 'boolean_op', mcp: 'boolean_intersect' },
    adrs: ['ADR-005', 'ADR-007'],
  },
  {
    id: 'intersect-with-model',
    label: '모델과 교차',
    description: 'SketchUp-style: intersect selected faces with surrounding model.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'intersectWithModel', wasm: 'intersectWithModel' },
  },

  // ─── Clipboard / Edit ────────────────────────────────────────────
  {
    id: 'clipboard-copy',
    label: '복사',
    description: 'Copy selected faces to clipboard.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: {},
    status: 'ui-only',
  },
  {
    id: 'clipboard-cut',
    label: '잘라내기',
    description: 'Cut selected faces (copy + delete).',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'batchDelete', wasm: 'batch_delete' },
  },
  {
    id: 'clipboard-paste',
    label: '붙여넣기',
    description: 'Paste clipboard contents and enter placement mode.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'arrayLinearFaces', wasm: 'arrayLinearFaces' },
  },
  {
    id: 'duplicate',
    label: '복제',
    description: 'Duplicate selection inline.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'arrayLinearFaces', wasm: 'arrayLinearFaces' },
  },
  {
    id: 'delete',
    label: '삭제',
    description: 'Delete selected faces / edges (atomic batch).',
    tier: 2,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'batchDelete', wasm: 'batch_delete' },
  },
  {
    id: 'select-all',
    label: '모두 선택',
    description: 'Select all faces and edges.',
    tier: 0,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: {},
    status: 'ui-only',
  },
  {
    id: 'deselect',
    label: '선택 해제',
    description: 'Clear current selection.',
    tier: 0,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: {},
    status: 'ui-only',
  },
  {
    id: 'select-same',
    label: '동일요소 선택',
    description: 'Select all elements of the same type as current selection.',
    tier: 0,
    surfaces: ['context-only'],
    aliases: {},
    status: 'ui-only',
  },

  // ─── Constraints ─────────────────────────────────────────────────
  {
    id: 'constrain-parallel',
    label: '평행 정렬',
    description: 'Add parallel constraint between two edges.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'constrain-perpendicular',
    label: '수직 정렬',
    description: 'Add perpendicular constraint between two edges.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'constrain-collinear',
    label: '동일 선상 정렬',
    description: 'Add collinear constraint between two edges.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'constrain-edge-length',
    label: '엣지 길이',
    description: 'Pin an edge to a fixed length (distance constraint).',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'addDistanceConstraint', wasm: 'addDistanceConstraint' },
  },
  {
    id: 'constrain-endpoint-distance',
    label: '끝점 거리 고정',
    description: 'Pin distance between two edge endpoints.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'addDistanceConstraint', wasm: 'addDistanceConstraint' },
  },

  // ─── Convert / Edge class ────────────────────────────────────────
  {
    id: 'convert-to-centerline',
    label: '중심선으로 변환',
    description: 'Convert geometry edge to centerline (construction line).',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'setEdgeClass', wasm: 'setEdgeClass' },
  },
  {
    id: 'convert-to-geometry',
    label: '일반선으로 변환',
    description: 'Convert centerline back to geometry edge.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'setEdgeClass', wasm: 'setEdgeClass' },
  },

  // ─── Drawing tools (activate Tool class) ─────────────────────────
  {
    id: 'tool-line',
    label: '선',
    description: 'Activate Line drawing tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawLine', wasm: 'draw_line', mcp: 'draw_line' },
    adrs: ['ADR-019', 'ADR-026'],
  },
  {
    id: 'tool-polyline',
    label: '폴리선',
    description: 'Activate Polyline tool (multi-segment line).',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawPolyline', wasm: 'drawPolyline', mcp: 'draw_polyline' },
    adrs: ['ADR-012'],
  },
  {
    id: 'tool-rect',
    label: '사각형',
    description: 'Activate Rectangle tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawRect', wasm: 'draw_rect', mcp: 'draw_rect' },
    adrs: ['ADR-021', 'ADR-026'],
  },
  {
    id: 'tool-circle',
    label: '원',
    description: 'Activate Circle tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawCircle', wasm: 'draw_circle', mcp: 'draw_circle' },
    adrs: ['ADR-026'],
  },
  {
    id: 'tool-arc',
    label: '호',
    description: 'Activate Arc drawing tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawArcWithCurve', wasm: 'drawArcWithCurve' },
    adrs: ['ADR-028', 'ADR-032'],
  },
  {
    id: 'tool-polygon',
    label: '다각형',
    description: 'Activate Polygon (regular N-gon) tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'tool-freehand',
    label: '자유선',
    description: 'Activate Freehand drawing tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'tool-bezier',
    label: 'Bezier 곡선',
    description: 'Activate Cubic Bezier drawing tool.',
    tier: 1,
    surfaces: ['menu'],
    aliases: { bridge: 'drawBezierWithCurve', wasm: 'drawBezierWithCurve' },
    adrs: ['ADR-029', 'ADR-032'],
  },
  {
    id: 'tool-centerline',
    label: '중심선',
    description: 'Activate Centerline drawing tool.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'drawCenterline', wasm: 'drawCenterline' },
  },
  {
    id: 'tool-point',
    label: '점',
    description: '(Stub) Point drawing tool — not yet implemented.',
    tier: 1,
    surfaces: ['menu'],
    aliases: {},
    status: 'stub',
  },
  {
    id: 'tool-text3d',
    label: '3D 텍스트',
    description: '(Stub) 3D text tool — not yet implemented.',
    tier: 1,
    surfaces: ['menu'],
    aliases: {},
    status: 'stub',
  },

  // ─── Primitives ──────────────────────────────────────────────────
  {
    id: 'tool-box',
    label: '박스',
    description: 'Box primitive creator.',
    tier: 1,
    surfaces: ['menu'],
    aliases: { bridge: 'create_box', wasm: 'create_box' },
  },
  {
    id: 'tool-sphere',
    label: '구',
    description: 'Sphere primitive creator.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'create_sphere', wasm: 'create_sphere' },
  },
  {
    id: 'tool-cylinder',
    label: '원통',
    description: 'Cylinder primitive creator.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'create_cylinder', wasm: 'create_cylinder' },
  },
  {
    id: 'tool-cone',
    label: '원뿔',
    description: 'Cone primitive creator.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'create_cone', wasm: 'create_cone' },
  },

  // ─── Modify tools ────────────────────────────────────────────────
  {
    id: 'tool-pushpull',
    label: '밀기/당기기',
    description: 'Push/Pull face along its normal.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'pushPull', wasm: 'push_pull', mcp: 'push_pull' },
    adrs: ['ADR-005', 'ADR-007'],
  },
  {
    id: 'tool-move',
    label: '이동',
    description: 'Move tool — translate selected geometry.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'translateVerts', wasm: 'translateVerts', mcp: 'move_xia' },
  },
  {
    id: 'tool-rotate',
    label: '회전',
    description: 'Rotate tool.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'rotateVerts', wasm: 'rotateVerts', mcp: 'rotate_xia' },
  },
  {
    id: 'tool-scale',
    label: '크기 조정',
    description: 'Scale tool.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'scaleVerts', wasm: 'scaleVerts', mcp: 'scale_xia' },
  },
  {
    id: 'tool-offset',
    label: '오프셋',
    description: 'Offset tool — parallel face inset/outset.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'offset_face', wasm: 'offset_face', mcp: 'offset_face' },
  },
  {
    id: 'tool-erase',
    label: '삭제',
    description: 'Erase tool — topology-aware delete with merge fallback.',
    tier: 2,
    surfaces: ['menu', 'keyboard'],
    aliases: { bridge: 'batchEraseEdgesWithMerge', wasm: 'batchEraseEdgesWithMerge' },
    adrs: ['ADR-016', 'ADR-019'],
  },
  {
    id: 'tool-trim',
    label: '자르기',
    description: '(Stub) Trim tool — not yet implemented.',
    tier: 2,
    surfaces: ['menu'],
    aliases: {},
    status: 'stub',
  },
  {
    id: 'tool-extend',
    label: '연장',
    description: '(Stub) Extend tool — not yet implemented.',
    tier: 2,
    surfaces: ['menu'],
    aliases: {},
    status: 'stub',
  },
  {
    id: 'tool-slice',
    label: '평면으로 자르기',
    description: 'Slice tool — cut volume with a plane.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'sliceVolumeByPlane', wasm: 'sliceVolumeByPlane' },
  },
  {
    id: 'tool-measure',
    label: '측정 도구',
    description: 'Measure tool — distances / angles / volumes.',
    tier: 0,
    surfaces: ['menu', 'keyboard'],
    aliases: {},
    status: 'delegated',
  },

  // ─── Edge ops ────────────────────────────────────────────────────
  {
    id: 'fillet-edge',
    label: '엣지 모깎기',
    description: 'Round a manifold edge with a circular arc fillet.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: {
      bridge: 'filletEdge',
      wasm: 'filletEdge',
      mcp: 'fillet_edge',
      legacy: ['tool-fillet'],
    },
    adrs: ['ADR-024'],
  },
  {
    id: 'chamfer-edge',
    label: '엣지 모따기',
    description: 'Chamfer (1-segment fillet) on a manifold edge.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: {
      bridge: 'filletEdge',
      wasm: 'filletEdge',
      mcp: 'chamfer_edge',
      legacy: ['tool-chamfer'],
    },
  },
  {
    id: 'split-edge-midpoint',
    label: '엣지 중점 분할',
    description: 'Split an edge at its midpoint, inserting a new vertex.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'splitEdge', wasm: 'splitEdge' },
  },

  // ─── Mesh ops ────────────────────────────────────────────────────
  {
    id: 'flip-faces',
    label: '면 반전',
    description: 'Flip face winding (wall faces only — sheets skipped).',
    tier: 2,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'flipFaces', wasm: 'flipFaces' },
    adrs: ['ADR-007', 'ADR-018'],
  },
  {
    id: 'thicken-faces',
    label: '두께 부여',
    description: 'Shell operation — extrude faces uniformly.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'pushPull', wasm: 'push_pull' },
  },
  {
    id: 'subdivide',
    label: '매끄럽게 분할',
    description: 'Catmull-Clark subdivision on full mesh.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'subdivideCatmullClark', wasm: 'subdivideCatmullClark' },
  },
  {
    id: 'solidify',
    label: 'Solidify',
    description: 'Cap open boundary edges to close shell into a solid.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'synthesizeFacesFromFreeEdges', wasm: 'synthesizeFacesFromFreeEdges' },
  },
  {
    id: 'mesh-repair',
    label: 'Mesh Repair',
    description: '4-step mesh normalize: degenerate / winding / normal / isolate.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'normalizeForImport', wasm: 'normalizeForImport' },
    adrs: ['ADR-007'],
  },
  {
    id: 'synthesize-faces',
    label: '자유 엣지 → 면 합성',
    description: 'Manual trigger: convert free-edge cycles to faces.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'synthesizeFacesFromFreeEdges', wasm: 'synthesizeFacesFromFreeEdges' },
    adrs: ['ADR-019', 'ADR-021', 'ADR-025'],
  },

  // ─── Merge variants ──────────────────────────────────────────────
  {
    id: 'merge-faces',
    label: '면 통합',
    description: 'Merge coplanar adjacent faces (default tolerance).',
    tier: 2,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'mergeFacesByEdge', wasm: 'mergeFacesByEdge' },
    adrs: ['ADR-005'],
  },
  {
    id: 'merge-faces-geometric',
    label: '기하 병합',
    description: 'Geometric coplanar merge with size-mismatch tolerance.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: {
      bridge: 'mergeCoplanarFacesGeometric',
      wasm: 'mergeCoplanarFacesGeometric',
    },
  },
  {
    id: 'merge-faces-force',
    label: '강제 통합',
    description: 'Force merge unrelated faces by softening interior edges.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'softenInternalEdges', wasm: 'softenInternalEdges' },
    adrs: ['ADR-008'],
  },
  {
    id: 'merge-xia-coplanar',
    label: 'XIA 내 coplanar 면',
    description: 'Merge coplanar faces within the same XIA.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'tryMergeAdjacentFaces', wasm: 'tryMergeAdjacentFaces' },
  },
  {
    id: 'merge-as-hole',
    label: '수동 구멍',
    description: 'Manually merge inner face as a hole in outer face.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'mergeCoplanarContaining', wasm: 'mergeCoplanarContaining' },
    adrs: ['ADR-016', 'ADR-021'],
  },

  // ─── Group / Component ───────────────────────────────────────────
  {
    id: 'group',
    label: '그룹 만들기',
    description: 'Create a group from selected faces.',
    tier: 1,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'createGroup', wasm: 'create_group', mcp: 'create_group' },
  },
  {
    id: 'ungroup',
    label: '그룹 해제',
    description: 'Dissolve group, returning faces to standalone XIAs.',
    tier: 2,
    surfaces: ['keyboard', 'context'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'make-component',
    label: '컴포넌트로 변환',
    description: 'Convert group to reusable component.',
    tier: 2,
    surfaces: ['context-only'],
    aliases: { bridge: 'makeComponent', wasm: 'make_component' },
  },

  // ─── Deformation ─────────────────────────────────────────────────
  {
    id: 'bend-selection',
    label: '구부리기',
    description: 'Bend selected geometry along an axis.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'bendVerts', wasm: 'bendVerts' },
  },
  {
    id: 'twist-selection',
    label: '비틀기',
    description: 'Twist selected geometry around an axis.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'twistVertsDeform', wasm: 'twistVerts' },
  },
  {
    id: 'taper-selection',
    label: '테이퍼',
    description: 'Taper selected geometry from one end to the other.',
    tier: 2,
    surfaces: ['menu'],
    aliases: { bridge: 'taperVerts', wasm: 'taperVerts' },
  },

  // ─── Revolve ─────────────────────────────────────────────────────
  {
    id: 'revolve-x',
    label: 'Revolve · X축',
    description: 'Revolve profile around X axis to form a surface of revolution.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'revolveProfile', wasm: 'revolveProfile' },
  },
  {
    id: 'revolve-y',
    label: 'Revolve · Y축',
    description: 'Revolve profile around Y axis.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'revolveProfile', wasm: 'revolveProfile' },
  },
  {
    id: 'revolve-z',
    label: 'Revolve · Z축',
    description: 'Revolve profile around Z axis.',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: { bridge: 'revolveProfile', wasm: 'revolveProfile' },
  },

  // ─── Read / Inspect ──────────────────────────────────────────────
  {
    id: 'measure-selection',
    label: '선택 측정',
    description: 'Compute lengths / areas / volumes of current selection.',
    tier: 0,
    surfaces: ['menu'],
    aliases: { bridge: 'edgeLength', wasm: 'edgeLength' },
  },
  {
    id: 'undo',
    label: '실행 취소',
    description: 'Undo last operation.',
    tier: 0,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'undo', wasm: 'undo' },
  },
  {
    id: 'redo',
    label: '다시 실행',
    description: 'Redo last undone operation.',
    tier: 0,
    surfaces: ['menu', 'keyboard', 'context'],
    aliases: { bridge: 'redo', wasm: 'redo' },
  },

  // ─── Sketch ──────────────────────────────────────────────────────
  {
    id: 'sketch-start-auto',
    label: '스케치 시작 · 자동',
    description: 'Enter Sketch mode with auto-detected plane.',
    tier: 1,
    surfaces: ['menu', 'keyboard'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'sketch-start-xy',
    label: '스케치 시작 · XY',
    description: 'Enter Sketch mode on the world XY plane.',
    tier: 1,
    surfaces: ['menu'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'sketch-start-xz',
    label: '스케치 시작 · XZ',
    description: 'Enter Sketch mode on the world XZ plane.',
    tier: 1,
    surfaces: ['menu'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'sketch-start-yz',
    label: '스케치 시작 · YZ',
    description: 'Enter Sketch mode on the world YZ plane.',
    tier: 1,
    surfaces: ['menu'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'sketch-exit',
    label: '스케치 종료',
    description: 'Exit Sketch — synthesize faces and prompt extrude.',
    tier: 1,
    surfaces: ['menu'],
    aliases: { bridge: 'synthesizeFacesFromFreeEdges', wasm: 'synthesizeFacesFromFreeEdges' },
  },

  // ─── Material ────────────────────────────────────────────────────
  {
    id: 'assign-quick-color',
    label: '빠른 색상 지정',
    description: 'Apply ad-hoc color to selected faces (via MaterialLibrary handler).',
    tier: 2,
    surfaces: ['menu', 'context'],
    aliases: {},
    status: 'delegated',
  },
  {
    id: 'upload-texture',
    label: '텍스처 이미지 업로드',
    description: 'Upload an image to create a textured material (TextureUploadDialog).',
    tier: 2,
    surfaces: ['menu'],
    aliases: {},
    status: 'delegated',
  },
] as const;

// ─── Lookup indices (built once at module load) ────────────────────
const BY_ID = new Map<string, ActionDef>();
const BY_BRIDGE = new Map<string, ActionDef>();
const BY_WASM = new Map<string, ActionDef>();
const BY_MCP = new Map<string, ActionDef>();
const BY_LEGACY = new Map<string, ActionDef>();

for (const def of ALL_ACTIONS) {
  if (BY_ID.has(def.id)) {
    throw new Error(`ActionCatalog duplicate id: "${def.id}"`);
  }
  BY_ID.set(def.id, def);
  if (def.aliases.bridge) {
    if (!BY_BRIDGE.has(def.aliases.bridge)) BY_BRIDGE.set(def.aliases.bridge, def);
  }
  if (def.aliases.wasm) {
    if (!BY_WASM.has(def.aliases.wasm)) BY_WASM.set(def.aliases.wasm, def);
  }
  if (def.aliases.mcp) {
    if (BY_MCP.has(def.aliases.mcp)) {
      throw new Error(`ActionCatalog duplicate mcp alias: "${def.aliases.mcp}"`);
    }
    BY_MCP.set(def.aliases.mcp, def);
  }
  if (def.aliases.legacy) {
    for (const old of def.aliases.legacy) {
      if (BY_LEGACY.has(old)) {
        throw new Error(`ActionCatalog duplicate legacy alias: "${old}"`);
      }
      BY_LEGACY.set(old, def);
    }
  }
}

import type { LookupResult } from './types.js';

/** Find by canonical id (UI kebab). */
export function getActionById(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

/** Find by Bridge method name (camelCase). */
export function getActionByBridgeAlias(alias: string): ActionDef | undefined {
  return BY_BRIDGE.get(alias);
}

/** Find by WASM export name. */
export function getActionByWasmAlias(alias: string): ActionDef | undefined {
  return BY_WASM.get(alias);
}

/** Find by MCP capability id (snake_case, ADR-041 P26.3). */
export function getActionByMcpAlias(alias: string): ActionDef | undefined {
  return BY_MCP.get(alias);
}

/**
 * Generic lookup — tries every alias channel + legacy.
 * Returns a tagged result so callers can detect legacy hits.
 */
export function lookup(query: string): LookupResult {
  const direct = BY_ID.get(query);
  if (direct) return { kind: 'found', def: direct, via: 'canonical' };
  const bridge = BY_BRIDGE.get(query);
  if (bridge) return { kind: 'found', def: bridge, via: 'bridge' };
  const wasm = BY_WASM.get(query);
  if (wasm) return { kind: 'found', def: wasm, via: 'wasm' };
  const mcp = BY_MCP.get(query);
  if (mcp) return { kind: 'found', def: mcp, via: 'mcp' };
  const legacy = BY_LEGACY.get(query);
  if (legacy) return { kind: 'found-legacy', def: legacy, legacy_alias: query };
  return { kind: 'not-found', query };
}

/** All registered ids, sorted alphabetically. */
export function listActionIds(): string[] {
  return [...BY_ID.keys()].sort();
}

/** All actions for a given tier. */
export function actionsByTier(tier: 0 | 1 | 2 | 3): readonly ActionDef[] {
  return ALL_ACTIONS.filter((a) => a.tier === tier);
}

/** Total action count — useful for surface drift regression. */
export const CATALOG_SIZE = ALL_ACTIONS.length;
