/**
 * Command Registry — CAD-style command handlers for CommandInput
 *
 * Extracted from main.ts (lines 162-240).
 * Registers 'line', 'help' commands and keyboard shortcut for toggle.
 */

import { CommandInput } from './CommandInput';
import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { getMergeTolerance, setMergeTolerance, getRespectMaterial, setRespectMaterial } from '../tools/MergeSettings';
import { getCurveRegistry } from '../curves/CurveRegistry';

export interface CommandRegistryDeps {
  commandInput: CommandInput;
  bridge: WasmBridge;
  toolManager: ToolManager;
}

export function initCommandRegistry(deps: CommandRegistryDeps): void {
  const { commandInput, bridge, toolManager } = deps;

  // Register line command handler
  commandInput.registerHandler({
    name: 'line',
    aliases: ['L'],
    help: 'Draw a line. Usage: L [length] [height] or L x1,y1,z1 x2,y2,z2',
    execute: (args: string[]) => {
      if (args.length === 0) {
        toolManager.setTool('line');
        commandInput.printSuccess('라인 도구 활성화됨. 클릭으로 시작점을 선택하세요.');
        return;
      }

      // Parse length argument
      if (args.length === 1) {
        const length = parseFloat(args[0]);
        if (isNaN(length) || length <= 0) {
          throw new Error('유효한 길이를 입력하세요');
        }
        toolManager.setTool('line');
        commandInput.printSuccess(`라인 도구: 길이 ${length} mm`);
        return;
      }

      // Parse coordinate arguments (x1,y1,z1 x2,y2,z2)
      if (args.length >= 2) {
        const pt1Parts = args[0].split(',');
        const pt2Parts = args[1].split(',');

        if (pt1Parts.length !== 3 || pt2Parts.length !== 3) {
          throw new Error('좌표 형식: x1,y1,z1 x2,y2,z2');
        }

        const x1 = parseFloat(pt1Parts[0]);
        const y1 = parseFloat(pt1Parts[1]);
        const z1 = parseFloat(pt1Parts[2]);
        const x2 = parseFloat(pt2Parts[0]);
        const y2 = parseFloat(pt2Parts[1]);
        const z2 = parseFloat(pt2Parts[2]);

        if ([x1, y1, z1, x2, y2, z2].some(isNaN)) {
          throw new Error('모든 좌표는 숫자여야 합니다');
        }

        // ADR-087 K-ζ — kernel-aware drawLineAsShape only.
        bridge.drawLineAsShape(x1, y1, z1, x2, y2, z2, 0, 0, 0);
        toolManager.syncMesh();
        const len = Math.sqrt(
          (x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2
        );
        commandInput.printSuccess(`라인 생성됨 (길이: ${len.toFixed(2)} mm)`);
        return;
      }

      throw new Error('명령 형식이 잘못되었습니다');
    }
  });

  // 면 통합 tolerance 설정 커맨드 (B1)
  commandInput.registerHandler({
    name: 'mergetol',
    aliases: ['mtol'],
    help: '면 통합 각도 tolerance 설정 (°). 예: mergetol 2 — 2°까지 허용',
    execute: (args: string[]) => {
      if (args.length === 0) {
        commandInput.printInfo(`현재 merge tolerance: ${getMergeTolerance()}°`);
        return;
      }
      const v = parseFloat(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > 10) {
        throw new Error('유효한 각도(0~10°)를 입력하세요');
      }
      setMergeTolerance(v);
      commandInput.printSuccess(`면 통합 tolerance: ${v}° (0.5° = strict, 2~5° = loose)`);
    },
  });

  // Phase I6 — 곡선 레이어 관리 커맨드
  commandInput.registerHandler({
    name: 'curves',
    aliases: ['listcurves'],
    help: '등록된 Curve 목록 표시 (CurveRegistry)',
    execute: () => {
      const registry = getCurveRegistry();
      const all = registry.getAll();
      if (all.length === 0) {
        commandInput.printInfo('등록된 곡선 없음');
        return;
      }
      const lines = all.map(c => {
        switch (c.kind) {
          case 'arc':
            return `#${c.id} Arc: R=${(c as any).radius?.toFixed(1)} seg=${c.segments}`;
          case 'bezier':
            return `#${c.id} Bezier (4 ctrl pts) seg=${c.segments}`;
          case 'catmull-rom':
            return `#${c.id} Catmull-Rom (${(c as any).points?.length ?? 0} pts)`;
          case 'freehand':
            return `#${c.id} Freehand (${(c as any).rawPoints?.length ?? 0} raw pts)`;
          case 'ellipse':
            return `#${c.id} Ellipse Rx=${(c as any).xRadius?.toFixed(1)} Ry=${(c as any).yRadius?.toFixed(1)}`;
        }
      });
      commandInput.printInfo(
        `곡선 ${all.length}개:\n` + lines.join('\n')
      );
    },
  });

  commandInput.registerHandler({
    name: 'clearcurves',
    help: 'CurveRegistry 전체 초기화 (DCEL 영향 없음)',
    execute: () => {
      const registry = getCurveRegistry();
      const n = registry.size();
      registry.clear();
      commandInput.printSuccess(`${n}개 curve 메타데이터 제거 (DCEL edges는 보존)`);
    },
  });

  // Phase H — Import Normalizer 수동 실행
  commandInput.registerHandler({
    name: 'normalize',
    aliases: ['renormalize'],
    help: '현재 mesh에 Import Normalizer 재실행 (ADR-007 Barrier)',
    execute: () => {
      const report = bridge.normalizeForImport();
      const parts = [
        report.degenerateRemoved > 0 && `퇴화 ${report.degenerateRemoved}개 제거`,
        report.windingFlipped > 0 && `winding ${report.windingFlipped}개 flip`,
        report.normalsRecomputed > 0 && `normal ${report.normalsRecomputed}개 재계산`,
        report.isolatedVertsRemoved > 0 && `고아 vertex ${report.isolatedVertsRemoved}개 제거`,
      ].filter(Boolean).join(', ');
      toolManager.syncMesh();
      commandInput.printSuccess(
        `Normalize 완료${parts ? ': ' + parts : ' (변경 없음)'} / ` +
        `${report.remainingViolations > 0
          ? '남은 위반 ' + report.remainingViolations + '건'
          : 'invariants 통과'}`
      );
    },
  });

  // Phase H5 — Face Synthesis (자유 엣지 → 면)
  commandInput.registerHandler({
    name: 'synthfaces',
    aliases: ['synthface', 'makefaces'],
    help: '자유 엣지로 이뤄진 닫힌 polygon을 face로 합성 (수동 트리거)',
    execute: () => {
      const free = bridge.countFreeEdges();
      if (free === 0) {
        commandInput.printInfo('자유 엣지가 없습니다');
        return;
      }
      const created = bridge.synthesizeFacesFromFreeEdges();
      toolManager.syncMesh();
      commandInput.printSuccess(
        created > 0
          ? `${created}개 면 합성 완료 (자유 엣지 ${free}개 중)`
          : `${free}개 자유 엣지 발견하나 닫힌 polygon 미감지`
      );
    },
  });

  // Phase H — 현재 mesh invariant 검증 (topology + outward)
  commandInput.registerHandler({
    name: 'verify',
    aliases: ['check'],
    help: 'ADR-007 invariant 검증 — topology + outward normal 리포트',
    execute: () => {
      const topo = bridge.verifyInvariants();
      const outward = bridge.verifyOutwardNormals();

      const lines: string[] = [];
      // Topology part
      if (topo.valid) {
        lines.push(`✓ Topology: ${topo.checkedFaces}개 face invariants 통과`);
      } else {
        lines.push(`✗ Topology: ${topo.violationCount}개 위반 (${topo.checkedFaces}개 검사)`);
        topo.violations.slice(0, 3).forEach(v => lines.push('  - ' + v));
        if (topo.violations.length > 3) lines.push(`  ... (+${topo.violations.length - 3} more)`);
      }
      // Outward part
      if (!outward.isClosedSolid) {
        lines.push(`· Outward: open surface — 검증 스킵 (OK)`);
      } else if (outward.inwardCount === 0) {
        lines.push(`✓ Outward: ${outward.checkedFaces}개 face 모두 바깥 향함`);
      } else {
        lines.push(
          `✗ Outward: ${outward.inwardCount}/${outward.checkedFaces}개 face 내부 향함`
        );
        if (outward.inwardFaces.length > 0) {
          const ids = outward.inwardFaces.slice(0, 5).join(', ');
          const more = outward.inwardFaces.length > 5 ? ` +${outward.inwardFaces.length - 5}` : '';
          lines.push(`  face IDs: ${ids}${more}`);
        }
      }

      const allOk = topo.valid && (!outward.isClosedSolid || outward.inwardCount === 0);
      if (allOk) commandInput.printSuccess(lines.join('\n'));
      else commandInput.printError(lines.join('\n'));
    },
  });

  // 1순위 (2026-04-26) — non-manifold edge 진단 및 자동 수리.
  commandInput.registerHandler({
    name: 'repair',
    aliases: ['fix-mesh'],
    help: '비-manifold edge (3+ face) 자동 수리. 사용: repair [diag|fix]',
    execute: (args) => {
      const sub = (args[0] || 'fix').toLowerCase();
      const engine = bridge.engine as any;
      if (sub === 'diag' || sub === 'check') {
        if (!engine?.findNonManifoldEdges) {
          commandInput.printError('repair: WASM에 findNonManifoldEdges 미노출 — rebuild 필요');
          return;
        }
        const json = engine.findNonManifoldEdges();
        const result = JSON.parse(json);
        if (result.count === 0) {
          commandInput.printSuccess('✓ 비-manifold edge 0개 — 메시 깨끗');
        } else {
          const sample = result.edges.slice(0, 5).map((e: any) =>
            `edge ${e.edge}: ${e.faceCount} faces`).join('\n  ');
          const more = result.edges.length > 5 ? `\n  ... (+${result.edges.length - 5} more)` : '';
          commandInput.printError(
            `✗ 비-manifold edge ${result.count}개:\n  ${sample}${more}\n` +
            `  → "repair fix" 명령으로 자동 수리`
          );
        }
        return;
      }
      // Default = fix
      if (!engine?.repairNonManifoldEdges) {
        commandInput.printError('repair: WASM에 repairNonManifoldEdges 미노출 — rebuild 필요');
        return;
      }
      const json = engine.repairNonManifoldEdges();
      const r = JSON.parse(json);
      bridge.markDirty();
      const tm = (window as any).__axia?.services?.get?.('toolManager');
      tm?.syncMesh?.();
      if (r.facesDetached === 0) {
        commandInput.printSuccess(
          `✓ 수리할 non-manifold edge 없음 (검사 ${r.edgesExamined}개)`
        );
      } else {
        commandInput.printSuccess(
          `✓ 수리 완료: edge ${r.edgesRepaired}개 정리, ` +
          `${r.facesDetached}개 face 분리, ` +
          `${r.vertsCreated}개 vertex 복제` +
          (r.edgesSkipped > 0 ? ` (${r.edgesSkipped}개 skip)` : '')
        );
      }
    },
  });

  // ADR-007 Phase 4 — CAD 모드 (single-sided 렌더) 토글
  commandInput.registerHandler({
    name: 'cadmode',
    aliases: ['singleside'],
    help: 'CAD 모드 토글 (single-sided 렌더, GPU 성능↑). 사용: cadmode [on|off|toggle]',
    execute: (args: string[]) => {
      // @ts-ignore — viewport는 DraggablePanels 모듈을 통해 간접 접근
      const viewport = (window as any).__axiaViewport;
      if (!viewport?.setSingleSidedRender) {
        // 대체: toolManager 체인에서 찾기
        const vp = (toolManager as any).viewport;
        if (!vp?.setSingleSidedRender) {
          commandInput.printError('viewport 접근 불가');
          return;
        }
        const cur = vp.isSingleSidedRender();
        if (args.length === 0) {
          commandInput.printInfo(`CAD 모드: ${cur ? 'ON' : 'OFF'}`);
          return;
        }
        const v = args[0].toLowerCase();
        let next: boolean;
        if (v === 'on' || v === 'true' || v === '1') next = true;
        else if (v === 'off' || v === 'false' || v === '0') next = false;
        else if (v === 'toggle' || v === 't') next = !cur;
        else throw new Error('사용법: cadmode [on|off|toggle]');
        vp.setSingleSidedRender(next);
        toolManager.syncMesh(); // mesh 재생성
        commandInput.printSuccess(
          `CAD 모드: ${next ? 'ON — single-sided 렌더 (외부=Front)' : 'OFF — two-tone 렌더'}`
        );
        return;
      }
      // Fallback 경로 (실제로는 여기 도달 안 함)
    },
  });

  // 면 통합 재질 경계 존중 토글 (C2)
  commandInput.registerHandler({
    name: 'mergemat',
    aliases: ['mmat'],
    help: '면 통합 시 재질 경계 존중 토글 (on/off/toggle). 현재값 출력: 인수 없음',
    execute: (args: string[]) => {
      const cur = getRespectMaterial();
      if (args.length === 0) {
        commandInput.printInfo(`재질 경계 존중: ${cur ? 'ON' : 'OFF'}`);
        return;
      }
      const v = args[0].toLowerCase();
      let next: boolean;
      if (v === 'on' || v === 'true' || v === '1') next = true;
      else if (v === 'off' || v === 'false' || v === '0') next = false;
      else if (v === 'toggle' || v === 't') next = !cur;
      else throw new Error('사용법: mergemat [on|off|toggle]');
      setRespectMaterial(next);
      commandInput.printSuccess(`재질 경계 존중: ${next ? 'ON — 같은 재질끼리만 병합' : 'OFF — 재질 무시'}`);
    },
  });

  // Register help command
  commandInput.registerHandler({
    name: 'help',
    aliases: ['H', '?'],
    help: 'Show available commands',
    execute: () => {
      const commands = [
        'L [길이] - 라인 도구 활성화',
        'R [너비,높이,깊이] - 직사각형',
        'C [반지름] - 원 그리기',
        'P [x,y,z] - 점 생성',
      ];
      commandInput.printInfo(commands.join('\n'));
    }
  });

  // Keyboard shortcut to toggle command input (Backtick or Ctrl+K)
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === '`' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      commandInput.toggle();
    }
  });
}
