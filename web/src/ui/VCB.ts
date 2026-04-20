/**
 * VCB (Value Control Box) — SketchUp-style dimension input
 *
 * Extracted from main.ts (lines 884-1001).
 * Manages the command bar input for numeric dimension entry, auto-activation on keypress.
 */

import { ToolManager } from '../tools/ToolManagerRefactored';
import { UnitSystem } from '../units/UnitSystem';
import { debugLog, debugWarn } from '../utils/debug';

export interface VCBDeps {
  toolManager: ToolManager;
  units: UnitSystem;
}

/** 도구별 VCB 라벨 */
const vcbLabels: Record<string, string> = {
  offset: '오프셋 거리:',
  pushpull: '밀기/당기기 거리:',
  line: '길이:',
  rect: '가로, 세로:',
  circle: '반지름:',
  move: '이동 거리:',
  rotate: '각도(°):',
  scale: '배율:',
  select: '치수:',
};

/** VCB에 숫자 입력이 가능한 도구 Set — KeyboardShortcuts에서도 참조 */
export const vcbTools = new Set([
  'offset', 'pushpull', 'line', 'rect', 'circle', 'move', 'rotate', 'scale',
]);

export function initVCB(deps: VCBDeps): void {
  const { toolManager, units } = deps;

  const cmdInput = document.getElementById('cmd-input') as HTMLInputElement;
  const cmdLabel = document.getElementById('cmd-label') as HTMLSpanElement;
  const commandBar = document.getElementById('commandbar') as HTMLDivElement;

  /** VCB 활성화 */
  const activateVCB = (initialChar?: string) => {
    if (!cmdInput) return;
    commandBar?.classList.add('vcb-active');
    cmdInput.focus();
    if (initialChar) {
      cmdInput.value = initialChar;
    }
    // 라벨 업데이트
    const tool = toolManager.currentTool;
    if (cmdLabel) {
      cmdLabel.textContent = vcbLabels[tool] || '치수:';
    }
  };

  /** VCB 비활성화 */
  const deactivateVCB = () => {
    if (!cmdInput) return;
    commandBar?.classList.remove('vcb-active');
    cmdInput.blur();
    cmdInput.value = '';
  };

  if (cmdInput) {
    // Enter 또는 Spacebar: 값 확정 → 도구에 전달
    // (rect는 "가로 세로" 형식이므로 Spacebar를 공백으로 유지)
    cmdInput.addEventListener('keydown', (e) => {
      const isConfirmKey = e.key === 'Enter'
        || (e.key === ' ' && toolManager.currentTool !== 'rect');
      if (isConfirmKey) {
        e.preventDefault();
        const raw = cmdInput.value.trim();
        if (!raw) { deactivateVCB(); return; }

        const tool = toolManager.currentTool;

        // rect: "가로,세로" 또는 "가로 세로" 파싱
        if (tool === 'rect' && (raw.includes(',') || raw.includes(' '))) {
          const parts = raw.split(/[,\s]+/).map(s => units.parseInput(s.trim()));
          if (parts.length === 2 && parts[0] !== null && parts[1] !== null) {
            debugLog(`[VCB] rect: ${parts[0]}×${parts[1]} mm`);
            toolManager.applyVCBValue(parts[0]!, parts[1]!);
            deactivateVCB();
            return;
          }
        }

        // Phase 3 #5: scale 비균일 — "sx,sy,sz" 또는 "sx sy sz" 파싱
        // units.parseInput 대신 parseFloat — scale은 ratio (단위 없음)
        if (tool === 'scale' && (raw.includes(',') || raw.includes(' '))) {
          const parts = raw.split(/[,\s]+/).map(s => parseFloat(s.trim()));
          if (parts.length >= 2 && parts.every(v => Number.isFinite(v))) {
            const sx = parts[0]!;
            const sy = parts[1]!;
            const sz = parts[2] !== undefined ? parts[2]! : sy;
            debugLog(`[VCB] scale: ${sx}, ${sy}, ${sz}`);
            toolManager.applyVCBValue(sx, sy, sz);
            deactivateVCB();
            return;
          }
        }

        const mm = units.parseInput(raw);
        if (mm !== null) {
          debugLog(`[VCB] ${tool}: "${raw}" → ${mm.toFixed(2)} mm`);
          toolManager.applyVCBValue(mm);
          cmdInput.placeholder = units.format(mm);
          deactivateVCB();
        } else {
          debugWarn(`[VCB] Invalid: "${raw}"`);
          cmdInput.value = '';
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        deactivateVCB();
      }
    });

    // placeholder
    const updatePlaceholder = () => {
      if (!cmdInput) return;
      const tool = toolManager.currentTool;
      if (tool === 'rect') {
        cmdInput.placeholder = `가로, 세로 (${units.config.label})`;
      } else {
        cmdInput.placeholder = `숫자 입력 후 Enter (${units.config.label})`;
      }
    };
    units.onChange(updatePlaceholder);
    updatePlaceholder();
  }

  // 숫자키 자동 VCB 활성화 (캔버스에서 숫자/마이너스/소수점 입력 시)
  window.addEventListener('keydown', (e) => {
    // 이미 입력 필드에 포커스 → 무시
    if (e.target instanceof HTMLInputElement) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // 숫자, 마이너스, 소수점 키 감지 (넘패드 포함)
    const isNumericKey = /^[0-9.\-]$/.test(e.key);
    if (!isNumericKey) return;

    // VCB 가능한 도구에서만 활성화
    const tool = toolManager.currentTool;
    if (!vcbTools.has(tool)) return;

    e.preventDefault();
    e.stopPropagation(); // 뷰 전환 등 다른 핸들러로 전파 차단
    activateVCB(e.key);
  }, true); // capture phase — 다른 핸들러보다 먼저
}
