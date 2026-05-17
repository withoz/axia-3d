/**
 * AxiaCommands — registers every existing AXiA user-facing command into
 * the CommandCatalog with full metadata (label, group, shortcut, …) and
 * a delegating `execute` callback.
 *
 * IMPORTANT: This file does NOT introduce any new commands or remove any
 * existing ones. It is purely a metadata layer that points at the
 * dispatchers already in `ToolManagerRefactored.executeAction` and
 * `MenuBar` action handlers. Adding/removing commands continues to be
 * done in those modules; this file just gives them a shared registry so
 * every UI surface (toolbar, menu, keyboard help, palette) sees the
 * same list.
 */

import type { ToolManager } from '../tools/ToolManagerRefactored';
import { getCommandCatalog, type CommandDef, type CommandGroup } from './CommandCatalog';

export interface CommandRegistrationDeps {
  toolManager: ToolManager;
  /** Fallback for IDs that aren't tools and aren't in toolManager.executeAction.
   *  We forward to the legacy MenuBar dispatch here. */
  dispatchMenuAction?: (id: string) => void;
}

/** Helper — define a tool-mode command (data-tool="X" → setTool('X')). */
function tool(
  id: string,
  toolName: string,
  group: CommandGroup,
  label: string,
  short: string,
  shortcut: string | undefined,
  toolbar: boolean,
  toolbarSection: string | undefined,
  deps: CommandRegistrationDeps,
): CommandDef {
  return {
    id, group, label, short, shortcut,
    description: label,
    isMode: true, toolName,
    toolbar, toolbarSection,
    active: () => (deps.toolManager as unknown as { _currentTool?: string })._currentTool === toolName,
    execute: () => deps.toolManager.setTool(toolName),
  };
}

/** Helper — define a one-shot action (data-action="X" → executeAction(X)). */
function action(
  id: string,
  group: CommandGroup,
  label: string,
  short: string,
  shortcut: string | undefined,
  toolbar: boolean,
  deps: CommandRegistrationDeps,
  customExecute?: () => void,
): CommandDef {
  return {
    id, group, label, short, shortcut,
    description: label,
    toolbar,
    execute: customExecute ?? (() => {
      // Try toolManager.executeAction first; if unhandled, fall through to
      // the legacy MenuBar dispatch.
      try { deps.toolManager.executeAction(id); }
      catch { deps.dispatchMenuAction?.(id); }
    }),
  };
}

/**
 * Register every known AXiA command in the catalog. Idempotent — calling
 * twice just overwrites the same entries (the catalog warns).
 *
 * Catalog organisation follows the user's mental model:
 *   group: 'select' / 'draw' / 'primitive' / 'modify' / 'boolean'
 *          / 'sketch' / 'group' / 'measure' / 'view' / 'snap'
 *          / 'edit' / 'file' / 'import' / 'export' / 'repair' / 'help'
 */
export function registerAxiaCommands(deps: CommandRegistrationDeps): void {
  const catalog = getCommandCatalog();
  const cmds: CommandDef[] = [];

  // ── Select ──────────────────────────────────────────────────────
  cmds.push(tool('tool-select', 'select', 'select', '선택 (Select)', '선택', 'V', true, 'select', deps));

  // ── Draw ────────────────────────────────────────────────────────
  cmds.push(tool('tool-line',       'line',       'draw', '선 (Line)',                    '선',    'L',  true, 'draw', deps));
  cmds.push(tool('tool-centerline', 'centerline', 'draw', '📐 중심선 (Centerline)',         '중심선', '⇧C', false, undefined, deps));
  cmds.push(tool('tool-freehand',   'freehand',   'draw', '자유선 (Freehand)',             '자유선', '⇧F', false, undefined, deps));
  cmds.push(tool('tool-bezier',     'bezier',     'draw', 'Bezier 곡선',                  'Bezier', undefined, false, undefined, deps));
  cmds.push(tool('tool-rect',       'rect',       'draw', '사각형 (Rectangle)',            '사각형', 'R',  true, 'draw', deps));
  cmds.push(tool('tool-circle',     'circle',     'draw', '원 (Circle)',                  '원',    'C',  true, 'draw', deps));
  cmds.push(tool('tool-arc',        'arc',        'draw', '호 (3-point Arc)',             '호',    'A',  false, undefined, deps));
  cmds.push(tool('tool-polygon',    'polygon',    'draw', '다각형 (Polygon)',              '다각형', undefined, false, undefined, deps));
  cmds.push(tool('tool-polyline',   'polyline',   'draw', '폴리선 (Polyline)',             '폴리선', undefined, false, undefined, deps));
  cmds.push(tool('tool-point',      'point',      'draw', '점 (Point)',                   '점',    undefined, false, undefined, deps));
  cmds.push(tool('tool-text3d',     'text3d',     'draw', '3D 텍스트',                   '텍스트', undefined, false, undefined, deps));

  // ── Primitive ───────────────────────────────────────────────────
  cmds.push(tool('tool-pushpull', 'pushpull', 'modify',    'Push/Pull',          'P/P',  'P', true, 'modify', deps));
  cmds.push(tool('tool-sphere',   'sphere',   'primitive', '구 (Sphere)',         '구',    'H', true, 'primitive', deps));
  cmds.push(tool('tool-cylinder', 'cylinder', 'primitive', '원통 (Cylinder)',     '원통',  'Y', false, undefined, deps));
  cmds.push(tool('tool-cone',     'cone',     'primitive', '원뿔 (Cone)',         '원뿔',  'N', false, undefined, deps));
  // ADR-117 δ — Torus primitive (ADR-115 Path B kernel-native canonical).
  cmds.push(tool('tool-torus',    'torus',    'primitive', '토러스 (Torus)',      '토러스', 'D', false, undefined, deps));
  cmds.push(tool('tool-box',      'box',      'primitive', '박스 (Box)',          '박스',  undefined, false, undefined, deps));

  // ── Modify ──────────────────────────────────────────────────────
  cmds.push(tool('tool-move',     'move',     'modify', '이동 (Move)',     '이동',   'M', true, 'modify', deps));
  cmds.push(tool('tool-rotate',   'rotate',   'modify', '회전 (Rotate)',   '회전',   'Q', false, undefined, deps));
  cmds.push(tool('tool-scale',    'scale',    'modify', '크기 (Scale)',    '크기',   'S', false, undefined, deps));
  cmds.push(tool('tool-offset',   'offset',   'modify', '오프셋 (Offset)', '오프셋', 'O', true, 'modify', deps));
  cmds.push(tool('tool-erase',    'erase',    'modify', '삭제 (Erase)',    '삭제',   'E', true, 'modify', deps));
  cmds.push(tool('tool-trim',     'trim',     'modify', '자르기 (Trim)',   '자르기', undefined, false, undefined, deps));
  cmds.push(tool('tool-extend',   'extend',   'modify', '연장 (Extend)',   '연장',   undefined, false, undefined, deps));
  cmds.push(tool('tool-explode',  'explode',  'modify', '분해 (Explode)',  '분해',   undefined, false, undefined, deps));
  cmds.push(tool('tool-slice',    'slice',    'modify', '평면으로 자르기 (Slice)', 'Slice', undefined, false, undefined, deps));

  // ── Modify (one-shot actions) ────────────────────────────────────
  cmds.push(action('mirror-x',         'modify', 'Mirror · YZ 평면 (X 반전)',  'Mirror X', undefined, false, deps));
  cmds.push(action('mirror-y',         'modify', 'Mirror · XZ 평면 (Y 반전)',  'Mirror Y', undefined, false, deps));
  cmds.push(action('mirror-z',         'modify', 'Mirror · XY 평면 (Z 반전)',  'Mirror Z', undefined, false, deps));
  cmds.push(action('revolve-x',        'modify', 'Revolve · X축 회전',         'Revolve X', undefined, false, deps));
  cmds.push(action('revolve-y',        'modify', 'Revolve · Y축 회전',         'Revolve Y', undefined, false, deps));
  cmds.push(action('revolve-z',        'modify', 'Revolve · Z축 회전',         'Revolve Z', undefined, false, deps));
  cmds.push(action('subdivide',        'modify', '매끄럽게 분할 (Subdivide)',   'Subdiv',   undefined, false, deps));
  cmds.push(action('thicken-faces',    'modify', '🧱 두께 부여 (Thicken/Shell)…', 'Thicken', undefined, false, deps));
  cmds.push(action('solidify',         'modify', '🧩 솔리드화 (Solidify)',     'Solidify', undefined, false, deps));
  cmds.push(action('fillet-edge',      'modify', '엣지 모깎기 (Fillet)…',      'Fillet',   undefined, false, deps));
  cmds.push(action('chamfer-edge',     'modify', '엣지 모따기 (Chamfer)…',     'Chamfer',  undefined, false, deps));
  cmds.push(action('bend-selection',   'modify', '선택 구부리기 (Bend)…',       'Bend',     undefined, false, deps));
  cmds.push(action('twist-selection',  'modify', '선택 비틀기 (Twist)…',        'Twist',    undefined, false, deps));
  cmds.push(action('taper-selection',  'modify', '선택 테이퍼 (Taper)…',        'Taper',    undefined, false, deps));
  cmds.push(action('array-linear',     'modify', '선형 배열 (Array Linear)…',  'Array',    undefined, false, deps));
  cmds.push(action('array-radial',     'modify', '원형 배열 (Array Radial)…',  'Radial',   undefined, false, deps));
  cmds.push(action('flip-faces',       'modify', '면 뒤집기 (Flip Faces)',     'Flip',     undefined, false, deps));
  cmds.push(action('split-edge-midpoint','modify', '엣지 중점 분할',             'Split½',   undefined, false, deps));
  cmds.push(action('convert-to-centerline','modify', '📐 엣지 → 중심선 변환',    '→중심선',  undefined, false, deps));
  cmds.push(action('convert-to-geometry',  'modify', '🔹 엣지 → 일반선 변환',     '→일반',    undefined, false, deps));
  cmds.push(action('assign-quick-color',   'modify', '🎨 빠른 색상 (Quick Color)…', 'Color',  undefined, false, deps));
  cmds.push(action('upload-texture',       'modify', '🖼️ 텍스처 업로드…',         'Texture', undefined, false, deps));

  // ── Boolean ─────────────────────────────────────────────────────
  cmds.push(action('bool-union',           'boolean', '합집합 (Union)',         '∪',  undefined, true, deps));
  cmds.push(action('bool-subtract',        'boolean', '차집합 (Subtract)',      '-',  undefined, true, deps));
  cmds.push(action('bool-intersect',       'boolean', '교집합 (Intersect)',     '∩',  undefined, true, deps));
  cmds.push(action('intersect-with-model', 'boolean', '모델과 교차 (Intersect with Model)', '✕',  undefined, false, deps));

  // ── Merge family ───────────────────────────────────────────────
  cmds.push(action('merge-faces',           'modify', '면 합치기 (Merge)',          'Merge',    undefined, false, deps));
  cmds.push(action('merge-faces-geometric', 'modify', '면 합치기 · 기하 기반',      'Merge-G',  undefined, false, deps));
  cmds.push(action('merge-faces-force',     'modify', '면 합치기 · 강제',           'Merge-F',  undefined, false, deps));
  cmds.push(action('merge-as-hole',         'modify', '내부 면 → 구멍으로 합치기',   'Hole',     undefined, false, deps));
  cmds.push(action('merge-xia-coplanar',    'modify', '동일 XIA · 동일평면 합치기',  'XIA-Co',   undefined, false, deps));

  // ── Sketch ──────────────────────────────────────────────────────
  cmds.push(action('sketch-start-auto',  'sketch', '✨ 스케치 시작 · 자동 평면',  '자동',  '⇧S', false, deps));
  cmds.push(action('sketch-start-xz',    'sketch', '✏️ 스케치 시작 · XZ 바닥',   'XZ',   undefined, false, deps));
  cmds.push(action('sketch-start-xy',    'sketch', '✏️ 스케치 시작 · XY 정면',   'XY',   undefined, false, deps));
  cmds.push(action('sketch-start-yz',    'sketch', '✏️ 스케치 시작 · YZ 측면',   'YZ',   undefined, false, deps));
  cmds.push(action('sketch-start-face',  'sketch', '✏️ 스케치 시작 · 선택 면',   '면',   undefined, false, deps));
  cmds.push(action('sketch-resume-last', 'sketch', '↩ 스케치 재개',             '재개', undefined, false, deps));
  cmds.push(action('sketch-align-up',    'sketch', '↻ up 카메라 정렬',           'Up↻',  undefined, false, deps));
  cmds.push(action('sketch-exit',        'sketch', '스케치 종료',                '종료', undefined, false, deps));

  // ── Group / Component ───────────────────────────────────────────
  cmds.push(action('group',           'group', '그룹 (Group)',           '그룹', 'Ctrl+G',       false, deps));
  cmds.push(action('ungroup',         'group', '그룹 해제 (Ungroup)',     '해제', 'Ctrl+Shift+G', false, deps));
  cmds.push(action('make-component',  'group', '컴포넌트 생성',            '컴포', undefined, false, deps));
  cmds.push(action('group-edit',      'group', '그룹 편집 모드',          '편집', undefined, false, deps));
  cmds.push(action('group-hide',      'group', '그룹 가시성 토글',         '가시', undefined, false, deps));
  cmds.push(action('group-lock',      'group', '그룹 잠금 토글',           '잠금', undefined, false, deps));

  // ── Measure / Constraint ────────────────────────────────────────
  cmds.push(tool('tool-measure', 'measure', 'measure', '측정 (Measure)', '측정', 'U', false, undefined, deps));
  cmds.push(action('measure-selection',           'measure', '선택 측정',              '측정',   undefined, false, deps));
  cmds.push(action('constrain-parallel',          'measure', '평행 (Parallel)',         '∥',     undefined, false, deps));
  cmds.push(action('constrain-perpendicular',     'measure', '수직 (Perpendicular)',    '⊥',     undefined, false, deps));
  cmds.push(action('constrain-collinear',         'measure', '동일 선상 (Collinear)',   '—',     undefined, false, deps));
  cmds.push(action('constrain-edge-length',       'measure', '엣지 길이 고정',          'Len',   undefined, false, deps));
  cmds.push(action('constrain-endpoint-distance', 'measure', '두 점 거리 고정',         '↔',     undefined, false, deps));

  // ── Edit ────────────────────────────────────────────────────────
  cmds.push(action('undo', 'edit', '되돌리기 (Undo)', 'Undo', 'Ctrl+Z', true, deps));
  cmds.push(action('redo', 'edit', '다시실행 (Redo)', 'Redo', 'Ctrl+Y', true, deps));
  cmds.push(action('select-all',      'edit', '전체 선택',           'All',   'Ctrl+A',       false, deps));
  cmds.push(action('deselect',        'edit', '선택 해제',           '해제',   'Esc',          false, deps));
  cmds.push(action('select-same',     'edit', '동일 항목 선택',       '동일',   undefined,       false, deps));
  cmds.push(action('delete',          'edit', '삭제',               'Del',   'Delete',        false, deps));
  cmds.push(action('duplicate',       'edit', '복제',               '복제',   'Ctrl+D',        false, deps));
  cmds.push(action('clipboard-copy',  'edit', '복사',               '복사',   'Ctrl+C',        false, deps));
  cmds.push(action('clipboard-cut',   'edit', '잘라내기',           '자르기', 'Ctrl+X',        false, deps));
  cmds.push(action('clipboard-paste', 'edit', '붙여넣기',           '붙여',   'Ctrl+V',        false, deps));
  cmds.push(action('rename',          'edit', '이름 변경',           '이름',   'F2',           false, deps));

  // ── View ────────────────────────────────────────────────────────
  cmds.push(action('view-3d',     'view', '3D 뷰',         '3D',     undefined, false, deps));
  cmds.push(action('view-top',    'view', '평면도 (Top)',  'Top',    undefined, false, deps));
  cmds.push(action('view-bottom', 'view', '저면도',        'Btm',    undefined, false, deps));
  cmds.push(action('view-front',  'view', '정면도',        '정면',   undefined, false, deps));
  cmds.push(action('view-back',   'view', '배면도',        '배면',   undefined, false, deps));
  cmds.push(action('view-left',   'view', '좌측면도',      '좌',     undefined, false, deps));
  cmds.push(action('view-right',  'view', '우측면도',      '우',     undefined, false, deps));
  cmds.push(action('view-home',   'view', '홈 뷰',         'Home',   undefined, false, deps));
  cmds.push(action('view-axis',   'view', '축 표시 토글',   '축',     undefined, false, deps));
  cmds.push(action('view-grid',   'view', '그리드 토글',    'Grid',   undefined, false, deps));
  cmds.push(action('view-history','view', '작업 기록 패널', 'History','⇧H',     false, deps));
  cmds.push(action('view-scenes', 'view', '장면 패널',     'Scenes', undefined, false, deps));
  cmds.push(action('view-ssao',   'view', 'SSAO 토글',     'SSAO',   undefined, false, deps));
  cmds.push(action('view-shadow-pro','view','그림자 PRO',  'Shadow', undefined, false, deps));
  cmds.push(action('view-sun-panel', 'view','태양 패널',   '태양',   undefined, false, deps));

  cmds.push(action('section-x',   'view', '단면 · X',  'Sec X', undefined, false, deps));
  cmds.push(action('section-y',   'view', '단면 · Y',  'Sec Y', undefined, false, deps));
  cmds.push(action('section-z',   'view', '단면 · Z',  'Sec Z', undefined, false, deps));
  cmds.push(action('section-off', 'view', '단면 OFF', 'Off',   undefined, false, deps));

  // ── Snap ────────────────────────────────────────────────────────
  cmds.push(action('osnap',          'snap', 'OSNAP 패널',         'OSNAP',  undefined, false, deps));
  cmds.push(action('snap-override',  'snap', '스냅 오버라이드',     'Snap+',  undefined, false, deps));
  cmds.push(action('axis',           'snap', '축 스냅',            'Axis',   undefined, false, deps));
  cmds.push(action('grid',           'snap', '그리드 스냅',         'Grid',   undefined, false, deps));
  cmds.push(action('edge',           'snap', '엣지 스냅',          'Edge',   undefined, false, deps));

  // ── File ────────────────────────────────────────────────────────
  cmds.push(action('file-new',     'file', '새 파일',     'New',     'Ctrl+N',      false, deps));
  cmds.push(action('file-open',    'file', '열기',       'Open',    'Ctrl+O',       false, deps));
  cmds.push(action('file-save',    'file', '저장',       'Save',    'Ctrl+S',       false, deps));
  cmds.push(action('file-saveas',  'file', '다른 이름으로 저장', 'Save As', 'Ctrl+Shift+S', false, deps));
  cmds.push(action('file-import',  'file', '가져오기 (Import)…', 'Import', undefined, false, deps));
  cmds.push(action('file-export',  'file', '내보내기 (Export)…', 'Export', undefined, false, deps));

  // ── Import ──────────────────────────────────────────────────────
  cmds.push(action('import-all',   'import', '모든 형식', '모두',  undefined, false, deps));
  cmds.push(action('import-dxf',   'import', 'DXF 가져오기',   'DXF',   undefined, false, deps));
  cmds.push(action('import-dwg',   'import', 'DWG 가져오기',   'DWG',   undefined, false, deps));
  cmds.push(action('import-obj',   'import', 'OBJ 가져오기',   'OBJ',   undefined, false, deps));
  cmds.push(action('import-stl',   'import', 'STL 가져오기',   'STL',   undefined, false, deps));
  cmds.push(action('import-gltf',  'import', 'glTF 가져오기',  'glTF',  undefined, false, deps));
  cmds.push(action('import-dae',   'import', 'DAE 가져오기',   'DAE',   undefined, false, deps));
  cmds.push(action('import-ply',   'import', 'PLY 가져오기',   'PLY',   undefined, false, deps));
  cmds.push(action('import-3ds',   'import', '3DS 가져오기',   '3DS',   undefined, false, deps));
  cmds.push(action('import-3dm',   'import', '3DM 가져오기',   '3DM',   undefined, false, deps));
  cmds.push(action('import-ifc',   'import', 'IFC 가져오기',   'IFC',   undefined, false, deps));

  // ── Export ──────────────────────────────────────────────────────
  cmds.push(action('export-dxf',  'export', 'DXF 내보내기',  'DXF',  undefined, false, deps));
  cmds.push(action('export-obj',  'export', 'OBJ 내보내기',  'OBJ',  undefined, false, deps));
  cmds.push(action('export-stl',  'export', 'STL 내보내기',  'STL',  undefined, false, deps));
  cmds.push(action('export-gltf', 'export', 'glTF 내보내기', 'glTF', undefined, false, deps));

  // ── Repair / Diagnostics ───────────────────────────────────────
  cmds.push(action('mesh-repair',       'repair', '🩹 메시 수리',           'Repair', undefined, false, deps));
  cmds.push(action('synthesize-faces',  'repair', '면 합성',                'Synth',  undefined, false, deps));
  cmds.push(action('clash-detect',      'repair', '간섭 검사',              'Clash',  undefined, false, deps));
  cmds.push(action('clash-clear',       'repair', '간섭 표시 제거',          'Clear',  undefined, false, deps));
  cmds.push(action('solar-heatmap',     'repair', '태양 히트맵',            'Solar',  undefined, false, deps));
  cmds.push(action('solar-heatmap-off', 'repair', '태양 히트맵 OFF',         'Off',    undefined, false, deps));
  cmds.push(action('reference-image',   'repair', '참조 이미지 추가',        'RefImg', undefined, false, deps));

  // ── Format / Settings ──────────────────────────────────────────
  cmds.push(action('format-units', 'view', '단위',         'Units',  undefined, false, deps));
  cmds.push(action('format-style', 'view', '스타일',       'Style',  undefined, false, deps));
  cmds.push(action('format-osnap', 'view', 'OSNAP',       'OSNAP',  undefined, false, deps));

  // ── Help ────────────────────────────────────────────────────────
  cmds.push(action('help',            'help', '도움말',         'Help',  'F1',  false, deps));
  cmds.push(action('help-shortcuts',  'help', '단축키 보기',     'Keys',  undefined, false, deps));
  cmds.push(action('help-about',      'help', '프로그램 정보',    'About', undefined, false, deps));

  catalog.registerMany(cmds);
}
