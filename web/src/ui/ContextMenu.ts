/**
 * Context Menu — Right-click context menu with snap submenu
 *
 * Extracted from main.ts (lines 1003-1222).
 * Handles context menu display, group/component actions, view switching,
 * and snap override submenu with hover behavior.
 */

import { Viewport, ViewMode } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { debugLog } from '../utils/debug';

export interface ContextMenuDeps {
  viewport: Viewport;
  bridge: WasmBridge;
  toolManager: ToolManager;
  viewModeBar: HTMLElement | null;
  /** OSNAP settings panel open callback */
  openOsnapPanel?: () => void;
}

export function initContextMenu(deps: ContextMenuDeps): void {
  const { viewport, bridge, toolManager, viewModeBar, openOsnapPanel } = deps;
  const snapManager = toolManager.snap;

  const ctxMenu = document.getElementById('context-menu');
  if (!ctxMenu) return;

  // 컨텍스트 메뉴 표시
  viewport.onContextMenu((x, y) => {
    // 라인 그리기 중 우클릭 → 라인 종료 + 메뉴도 표시
    if (toolManager.currentTool === 'line' && toolManager.isToolBusy()) {
      toolManager.cancelCurrentTool();
    }

    // ── 그룹/컴포넌트 메뉴 상황별 표시 ──
    const selected = toolManager.selection.getSelectedFaces();
    const hasSelection = selected.length > 0;
    const canGroup = selected.length >= 2;
    let selectedGroupId: number | undefined;
    if (hasSelection) {
      selectedGroupId = toolManager.selection.getGroupId(selected[0]);
    }
    const isInGroup = selectedGroupId !== undefined;
    const isEditingGroup = toolManager.selection.isInGroupEditMode();

    // 그룹 메뉴 항목 가져오기
    const groupItems = ctxMenu.querySelectorAll('.ctx-group-item');
    const groupSep = ctxMenu.querySelector('.ctx-group-sep') as HTMLElement;

    // 각 항목별 표시 조건
    groupItems.forEach(item => {
      const el = item as HTMLElement;
      const action = el.dataset.action;
      let show = false;
      switch (action) {
        case 'group':          show = canGroup && !isInGroup; break;
        case 'ungroup':        show = isInGroup; break;
        case 'group-edit':     show = isInGroup && !isEditingGroup; break;
        case 'make-component': show = isInGroup; break;
        case 'group-lock':     show = isInGroup; break;
        case 'group-hide':     show = isInGroup; break;
      }
      el.style.display = show ? '' : 'none';
    });

    // 구분선: 그룹 관련 항목이 하나라도 보이면 표시
    const anyGroupVisible = Array.from(groupItems).some(
      el => (el as HTMLElement).style.display !== 'none'
    );
    if (groupSep) groupSep.style.display = anyGroupVisible ? '' : 'none';

    // 화면 밖으로 나가지 않도록 위치 조정
    const menuW = 200, menuH = 400;
    const cx = Math.min(x, window.innerWidth - menuW);
    let cy: number;
    if (y + menuH > window.innerHeight) {
      cy = y - menuH;  // 클릭 위치 위로 펼침 (ZWCAD 스타일)
    } else {
      cy = y;
    }
    cy = Math.max(4, cy);
    ctxMenu.style.left = cx + 'px';
    ctxMenu.style.top = cy + 'px';
    ctxMenu.classList.add('visible');
  });

  // 메뉴 아이템 클릭
  ctxMenu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.ctx-item') as HTMLElement;
    if (!item) return;
    const action = item.dataset.action;
    ctxMenu.classList.remove('visible');

    switch (action) {
      case 'snap-override': return; // hover로 처리, 클릭 무시
      case 'undo': toolManager.executeAction('undo'); break;
      case 'redo': toolManager.executeAction('redo'); break;
      case 'delete': toolManager.executeAction('delete'); break;
      case 'select-all': toolManager.executeAction('select-all'); break;
      case 'select-same': toolManager.executeAction('select-same'); break;
      case 'deselect': toolManager.selection.clearSelection(); break;
      // 그룹 / 컴포넌트
      case 'group': toolManager.executeAction('group'); break;
      case 'ungroup': toolManager.executeAction('ungroup'); break;
      case 'group-edit': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) toolManager.selection.enterGroupEdit(gid);
        }
        break;
      }
      case 'make-component': toolManager.executeAction('make-component'); break;
      case 'group-lock': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) bridge.toggleGroupLock(gid);
        }
        break;
      }
      case 'group-hide': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) {
            bridge.toggleGroupVisibility(gid);
            toolManager.syncMesh();
          }
        }
        break;
      }
      // 뷰
      case 'view-top': viewport.setViewMode('top'); break;
      case 'view-front': viewport.setViewMode('front'); break;
      case 'view-right': viewport.setViewMode('right'); break;
      case 'view-3d': viewport.setViewMode('3d'); break;
    }

    // 뷰 모드 UI 동기화
    if (action?.startsWith('view-')) {
      const mode = action.replace('view-', '') as ViewMode;
      viewModeBar?.querySelectorAll('.view-btn').forEach(b =>
        b.classList.toggle('active', (b as HTMLElement).dataset.view === mode)
      );
      const toolLabel = document.getElementById('tool-label');
      if (toolLabel) {
        const names: Record<string, string> = {
          '3d': '3D Perspective',
          top: 'Top (XY)', front: 'Front (XZ)',
          right: 'Right (YZ)',
        };
        toolLabel.textContent = names[mode] || mode;
      }
    }
  });

  // ═══ 스냅 재지정 서브메뉴 — hover로 열기 (CAD 스타일) ═══
  const snapSub = document.getElementById('snap-submenu');
  const snapTrigger = ctxMenu.querySelector('.ctx-submenu-trigger') as HTMLElement;

  if (snapTrigger && snapSub) {
    // hover → 서브메뉴 표시
    snapTrigger.addEventListener('mouseenter', () => {
      const rect = snapTrigger.getBoundingClientRect();
      let left = rect.right + 2;
      const subW = 210, subH = 480;
      if (left + subW > window.innerWidth) left = rect.left - subW - 2;
      let top: number;
      if (rect.bottom + subH > window.innerHeight) {
        top = rect.bottom - subH; // 위로 펼침 (ZWCAD 스타일)
      } else {
        top = rect.top;
      }
      top = Math.max(4, top);
      snapSub.style.left = left + 'px';
      snapSub.style.top = top + 'px';
      snapSub.classList.add('visible');
    });

    // 메인 메뉴의 다른 항목에 hover하면 서브메뉴 닫기
    ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
      if (item === snapTrigger) return;
      item.addEventListener('mouseenter', () => {
        snapSub.classList.remove('visible');
      });
    });

    // 서브메뉴 밖으로 나가면 닫기 (메인메뉴/서브메뉴 둘 다 벗어났을 때)
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const startClose = () => {
      closeTimer = setTimeout(() => snapSub.classList.remove('visible'), 150);
    };
    const cancelClose = () => {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    };
    snapSub.addEventListener('mouseenter', cancelClose);
    snapSub.addEventListener('mouseleave', startClose);
    snapTrigger.addEventListener('mouseleave', startClose);
    snapTrigger.addEventListener('mouseenter', cancelClose);
  }

  // 메뉴 외부 클릭 시 닫기
  window.addEventListener('mousedown', (e) => {
    if (!ctxMenu.contains(e.target as Node) && !(snapSub && snapSub.contains(e.target as Node))) {
      ctxMenu.classList.remove('visible');
      snapSub?.classList.remove('visible');
    }
  });

  // ═══ 스냅 재지정 서브메뉴 클릭 ═══
  if (snapSub) {
    snapSub.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.snap-ov') as HTMLElement;
      if (!item) return;
      const snapType = item.dataset.snap;

      // 메뉴 닫기
      snapSub.classList.remove('visible');
      ctxMenu.classList.remove('visible');

      if (snapType === 'none') {
        snapManager.setOverride('none');
      } else if (snapType === 'settings') {
        openOsnapPanel?.();
      } else if (snapType) {
        debugLog('[OSNAP] Override snap:', snapType);
        snapManager.setOverride(snapType);
      }
    });
  }
}
