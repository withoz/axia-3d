/**
 * Command Registry — CAD-style command handlers for CommandInput
 *
 * Extracted from main.ts (lines 162-240).
 * Registers 'line', 'help' commands and keyboard shortcut for toggle.
 */

import { CommandInput } from './CommandInput';
import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { getMergeTolerance, setMergeTolerance } from '../tools/MergeSettings';

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

        bridge.drawLine(x1, y1, z1, x2, y2, z2);
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
