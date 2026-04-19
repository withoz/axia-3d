/**
 * Keyboard Shortcuts — Tool, View, and Ctrl-combo key bindings
 *
 * Extracted from main.ts (sections 5 + 6: lines 603-854).
 * Consolidates 6 keydown listeners into structured handlers.
 */

import { Viewport, ViewMode } from '../viewport/Viewport';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { vcbTools } from './VCB';

export interface KeyboardShortcutsDeps {
  toolManager: ToolManager;
  viewport: Viewport;
  toolbar: HTMLElement;
  viewModeBar: HTMLElement | null;
  saveProject: () => void;
  openProject: () => void;
}

/** Tool name → display name mapping */
const toolNames: Record<string, string> = {
  select: 'Select', line: 'Line', rect: 'Rectangle',
  circle: 'Circle', pushpull: 'Push/Pull', move: 'Move',
  rotate: 'Rotate', scale: 'Scale', offset: 'Offset',
  erase: 'Erase', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
};

/** View mode → display name mapping */
const viewNames: Record<string, string> = {
  '3d': '3D Perspective',
  top: 'Top (XY)', bottom: 'Bottom (XY)',
  front: 'Front (XZ)', back: 'Back (XZ)',
  right: 'Right (YZ)', left: 'Left (YZ)',
};

export function initKeyboardShortcuts(deps: KeyboardShortcutsDeps): void {
  const { toolManager, viewport, toolbar, viewModeBar, saveProject, openProject } = deps;

  // ── View switch helper ──
  const switchView = (mode: ViewMode) => {
    viewport.setViewMode(mode);
    viewModeBar?.querySelectorAll('.view-btn').forEach(b => {
      const v = (b as HTMLElement).dataset.view;
      b.classList.toggle('active', v === mode);
    });
    const toolLabel = document.getElementById('tool-label');
    if (toolLabel) toolLabel.textContent = viewNames[mode] || mode;
  };

  // ── Tool label update helper ──
  const updateToolLabel = (tool: string) => {
    const toolLabel = document.getElementById('tool-label');
    if (toolLabel) toolLabel.textContent = toolNames[tool] || tool;
  };

  // ── Toolbar / tool-label 동기화 헬퍼 ──
  const syncToolbarHighlight = (tool: string) => {
    toolbar.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
    });
  };

  // ── 입력 요소 포커스 가드 (텍스트 입력 중 단축키 차단) ──
  const isTypingInInput = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (el as HTMLElement).isContentEditable === true
    );
  };

  // ── Main keyboard shortcuts (Section 5) ──
  window.addEventListener('keydown', (e) => {
    if (isTypingInInput(e.target)) return;

    // Spacebar: SketchUp 스타일 — 진행 중이면 cancel, 이후 항상 Select 도구로 전환
    // (CAD의 "cancel" 의미와 SketchUp의 "select tool" 의미를 통합)
    if (e.key === ' ') {
      e.preventDefault();
      if (toolManager.isToolBusy()) {
        toolManager.cancelCurrentTool();
      }
      if (toolManager.currentTool !== 'select') {
        toolManager.setTool('select');
        syncToolbarHighlight('select');
        updateToolLabel('select');
      }
      return;
    }

    // Delete: 선택된 face 삭제
    if (e.key === 'Delete') {
      toolManager.executeAction('delete');
      return;
    }

    // Shift+N: 면 반전 (플레인 N은 Cone 도구에 예약되어 있어 충돌 방지)
    if ((e.key === 'N' || e.key === 'n') && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toolManager.executeAction('flip-faces');
      return;
    }

    // F3: OSNAP 토글
    if (e.key === 'F3') {
      e.preventDefault();
      toolManager.snap.toggle();
      // Update OSNAP UI
      const statOsnap = document.getElementById('stat-osnap');
      if (statOsnap) {
        const on = toolManager.snap.enabled;
        statOsnap.textContent = on ? 'ON' : 'OFF';
        statOsnap.style.color = on ? '#44ff88' : '#ff4444';
      }
      return;
    }

    // A5: Snap 타입별 단축 토글 (Alt + E/M/I/C/P/L/F/G)
    // Alt 조합으로 기존 단축키(X, Y, Z, H, V 등)와 충돌 방지
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const map: Record<string, string> = {
        'e': 'endpoint', 'm': 'midpoint', 'i': 'intersection',
        'c': 'center',   'p': 'perpendicular',
        'l': 'parallel', 'f': 'onFace',   'g': 'grid',
        'x': 'extension','n': 'nearest',
      };
      const mode = map[e.key.toLowerCase()];
      if (mode) {
        e.preventDefault();
        const active = toolManager.snap.toggleMode(mode as never);
        // Mirror change to checkbox panel
        const cb = document.querySelector<HTMLInputElement>(
          `input[data-mode="${mode}"]`);
        if (cb) cb.checked = active;
        // Briefly flash status bar
        const statOsnap = document.getElementById('stat-osnap');
        if (statOsnap) {
          const txt = `${mode} ${active ? 'ON' : 'OFF'}`;
          const prev = statOsnap.textContent;
          statOsnap.textContent = txt;
          setTimeout(() => { statOsnap.textContent = prev; }, 800);
        }
        return;
      }
    }

    // 화살표 키: 축 잠금 (SketchUp 스타일)
    if (e.key === 'ArrowRight') { e.preventDefault(); toolManager.setAxisLock('x'); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); toolManager.setAxisLock('y'); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); toolManager.setAxisLock('z'); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); toolManager.setAxisLock(null); return; }

    // Ctrl+S: 저장
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveProject();
      return;
    }
    // Ctrl+O: 열기
    if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      openProject();
      return;
    }
    // Ctrl+Shift+G: 그룹 해제
    if (e.ctrlKey && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      toolManager.executeAction('ungroup');
      return;
    }
    // Ctrl+G: 그룹
    if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      toolManager.executeAction('group');
      return;
    }

    // Ctrl+A: 모두 선택
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      toolManager.executeAction('select-all');
      return;
    }

    // Ctrl+M: 면 통합 (선택된 coplanar 인접 face를 하나로)
    if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      toolManager.executeAction('merge-faces');
      return;
    }

    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (e.repeat) return;
      if (!e.isTrusted) { console.warn('[Undo] blocked non-trusted event'); return; }
      toolManager.executeAction('undo');
      const undoBtn = toolbar.querySelector('[data-tool="undo"]');
      if (undoBtn) { undoBtn.classList.add('flash'); undoBtn.addEventListener('animationend', () => undoBtn.classList.remove('flash'), { once: true }); }
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      if (e.repeat) return;
      if (!e.isTrusted) { console.warn('[Redo] blocked non-trusted event'); return; }
      toolManager.executeAction('redo');
      const redoBtn = toolbar.querySelector('[data-tool="redo"]');
      if (redoBtn) { redoBtn.classList.add('flash'); redoBtn.addEventListener('animationend', () => redoBtn.classList.remove('flash'), { once: true }); }
    } else if (e.key === 'Escape') {
      // Escape: 그룹 편집 모드 종료 → 3D 뷰 복귀 → Select 도구
      if (toolManager.selection.isInGroupEditMode()) {
        toolManager.selection.exitGroupEdit();
        return;
      }
      if (viewport.viewMode !== '3d') {
        viewport.setViewMode('3d');
        viewModeBar?.querySelectorAll('.view-btn').forEach(b =>
          b.classList.toggle('active', (b as HTMLElement).dataset.view === '3d')
        );
        const toolLabel = document.getElementById('tool-label');
        if (toolLabel) toolLabel.textContent = '3D Perspective';
      } else {
        toolManager.setTool('select');
        syncToolbarHighlight('select');
      }
    } else if (e.shiftKey && !e.ctrlKey && !e.altKey) {
      // Shift 조합 단축키
      const shiftMap: Record<string, string> = {
        'L': 'polyline',
        'F': 'freehand',
      };
      const shiftTool = shiftMap[e.key];
      if (shiftTool) {
        toolManager.setTool(shiftTool);
        toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        updateToolLabel(shiftTool);
      }
    } else if (!e.ctrlKey && !e.altKey) {
      // 뷰 단축키 (AutoCAD 스타일) — t, b, f, k 는 여기서 걸러냄
      if (e.key === 'h' || e.key === 'H') {
        viewport.resetCamera();
        return;
      }

      const viewKeySet = new Set(['t', 'b', 'f', 'k']);
      if (viewKeySet.has(e.key.toLowerCase())) return; // 뷰 섹션에서 처리

      // 도구가 활성 작업 중이면 도구 전환 차단 (Escape로만 취소)
      if (toolManager.isToolBusy()) return;

      const keyMap: Record<string, string> = {
        'v': 'select', 'V': 'select',
        'l': 'line', 'L': 'line',
        'r': 'rect', 'R': 'rect',
        'g': 'polygon', 'G': 'polygon',
        'c': 'circle', 'C': 'circle',
        'a': 'arc', 'A': 'arc',
        'p': 'pushpull', 'P': 'pushpull',
        'h': 'sphere', 'H': 'sphere',
        'y': 'cylinder', 'Y': 'cylinder',
        'n': 'cone', 'N': 'cone',
        'm': 'move', 'M': 'move',
        'q': 'rotate', 'Q': 'rotate',
        's': 'scale', 'S': 'scale',
        'o': 'offset', 'O': 'offset',
        'e': 'erase', 'E': 'erase',
      };
      const tool = keyMap[e.key];
      if (tool) {
        toolManager.setTool(tool);
        syncToolbarHighlight(tool);
        updateToolLabel(tool);
      }
    }
  });

  // ── Home button (Section 5b) ──
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      viewport.resetCamera();
    });
  }

  // ── View mode buttons + keyboard shortcuts (Section 6) ──
  if (viewModeBar) {
    viewModeBar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.view-btn') as HTMLElement;
      if (!btn) return;
      const mode = btn.dataset.view as ViewMode;
      if (!mode) return;

      viewModeBar.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewport.setViewMode(mode);
      updateToolLabel(viewNames[mode] || mode);
    });

    // ── 키보드 단축키: AutoCAD 스타일 + Blender 넘패드 ──
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;

      // VCB 활성 도구에서는 넘패드도 숫자 입력으로 사용 (뷰 전환 차단)
      const currentTool = toolManager.currentTool;
      const isVcbTool = vcbTools.has(currentTool);
      const isNumpad = e.code.startsWith('Numpad');
      if (isVcbTool && isNumpad && !e.ctrlKey) return; // VCB 핸들러가 처리

      let mode: ViewMode | null = null;

      // Blender 넘패드 (Ctrl 조합 포함)
      if (e.code === 'Numpad7') mode = e.ctrlKey ? 'bottom' : 'top';
      else if (e.code === 'Numpad1') mode = e.ctrlKey ? 'back' : 'front';
      else if (e.code === 'Numpad3') mode = e.ctrlKey ? 'left' : 'right';
      else if (e.code === 'Numpad0' || e.code === 'Numpad5') mode = '3d';

      // AutoCAD / 3ds Max 스타일 단축키 (Ctrl 없이)
      if (!e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 't') mode = 'top';
        else if (key === 'b') mode = 'bottom';
        else if (key === 'f') mode = 'front';
        else if (key === 'k') mode = 'back';
      }

      if (mode) {
        e.preventDefault();
        switchView(mode);
      }
    });
  }
}
