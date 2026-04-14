/**
 * ComponentPanel — 그룹/컴포넌트 트리 패널 (아웃라이너)
 *
 * SketchUp의 "Outliner" 패널과 유사한 기능:
 * - 그룹/컴포넌트 트리 표시
 * - 가시성, 잠금 토글
 * - 이름 편집
 * - 선택/편집 모드 진입
 *
 * 위치: 우측 사이드바 (XIA Inspector 아래)
 */

import { WasmBridge, GroupInfo } from '../bridge/WasmBridge';
import { SelectionManager } from '../tools/SelectionManager';
import { Toast } from './Toast';

export interface ComponentPanelCallbacks {
  onGroupSelect?: (groupId: number) => void;
  onGroupDoubleClick?: (groupId: number) => void;
  onGroupDelete?: (groupId: number) => void;
  onRefresh?: () => void;
  /** 가시성 토글 후 뷰포트 갱신 */
  syncMesh?: () => void;
}

export class ComponentPanel {
  private container: HTMLElement;
  private bridge: WasmBridge;
  private selection: SelectionManager;
  private callbacks: ComponentPanelCallbacks;

  private panelEl: HTMLElement;
  private treeEl: HTMLElement;
  private groups: GroupInfo[] = [];
  private selectedGroupId: number | null = null;
  private visible = false;

  constructor(
    container: HTMLElement,
    bridge: WasmBridge,
    selection: SelectionManager,
    callbacks: ComponentPanelCallbacks = {},
  ) {
    this.container = container;
    this.bridge = bridge;
    this.selection = selection;
    this.callbacks = callbacks;

    // 패널 DOM 생성
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'component-panel';
    this.panelEl.className = 'component-panel';
    this.panelEl.innerHTML = `
      <div class="cp-header">
        <span class="cp-title">그룹 / 컴포넌트</span>
        <div class="cp-actions">
          <button class="cp-btn cp-btn-add" title="선택한 면으로 그룹 생성">+</button>
          <button class="cp-btn cp-btn-refresh" title="새로고침">⟳</button>
        </div>
      </div>
      <div class="cp-tree"></div>
      <div class="cp-empty">그룹이 없습니다</div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.treeEl = this.panelEl.querySelector('.cp-tree') as HTMLElement;

    // 이벤트 바인딩
    this.panelEl.querySelector('.cp-btn-add')?.addEventListener('click', () => {
      this.callbacks.onRefresh?.();
    });
    this.panelEl.querySelector('.cp-btn-refresh')?.addEventListener('click', () => {
      this.refresh();
    });

    // 스타일 삽입
    this.injectStyles();
  }

  /** 패널 표시/숨김 토글 */
  toggle(): void {
    this.visible = !this.visible;
    this.panelEl.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.refresh();
  }

  /** 패널 표시 */
  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'flex';
    this.refresh();
  }

  /** 패널 숨김 */
  hide(): void {
    this.visible = false;
    this.panelEl.style.display = 'none';
  }

  /** 그룹 목록 갱신 */
  refresh(): void {
    // WASM 백엔드에서 그룹 정보 가져오기
    const wasmGroups = this.bridge.getAllGroups();

    // WASM이 지원되면 WASM 데이터 사용, 아니면 로컬 데이터
    if (wasmGroups.length > 0) {
      this.groups = wasmGroups;
    } else {
      // 로컬 SelectionManager에서 가져오기
      this.groups = [];
      const localGroups = this.selection.getAllGroups();
      for (const [gid, faces] of localGroups) {
        this.groups.push({
          id: gid,
          name: `Group-${gid}`,
          faceCount: faces.size,
          faceIds: Array.from(faces),
          parent: null,
          children: [],
          visible: true,
          locked: false,
          isComponent: false,
        });
      }
    }

    this.render();
  }

  /** 트리 렌더링 */
  private render(): void {
    const emptyEl = this.panelEl.querySelector('.cp-empty') as HTMLElement;

    if (this.groups.length === 0) {
      this.treeEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';

    // 루트 그룹 필터링
    const rootGroups = this.groups.filter(g => g.parent === null || g.parent === 0);
    const childMap = new Map<number, GroupInfo[]>();
    for (const g of this.groups) {
      if (g.parent && g.parent > 0) {
        const children = childMap.get(g.parent) || [];
        children.push(g);
        childMap.set(g.parent, children);
      }
    }

    this.treeEl.innerHTML = '';
    for (const g of rootGroups) {
      this.treeEl.appendChild(this.createTreeNode(g, childMap, 0));
    }
  }

  /** 트리 노드 DOM 생성 */
  private createTreeNode(
    group: GroupInfo,
    childMap: Map<number, GroupInfo[]>,
    depth: number,
  ): HTMLElement {
    const node = document.createElement('div');
    node.className = 'cp-node';
    node.dataset.groupId = String(group.id);
    if (this.selectedGroupId === group.id) {
      node.classList.add('cp-selected');
    }

    const indent = depth * 16;
    const icon = group.isComponent ? '◆' : '▣';
    const lockIcon = group.locked ? '[L]' : '';
    const visIcon = group.visible ? '[V]' : '[H]';

    node.innerHTML = `
      <div class="cp-row" style="padding-left: ${indent + 4}px">
        <span class="cp-icon">${icon}</span>
        <span class="cp-name" title="${group.name}">${group.name}</span>
        <span class="cp-face-count">(${group.faceCount})</span>
        <span class="cp-lock cp-toggle" data-action="lock">${lockIcon}</span>
        <span class="cp-vis cp-toggle" data-action="vis">${visIcon}</span>
        <button class="cp-btn-delete cp-toggle" data-action="delete" title="그룹 해제">✕</button>
      </div>
    `;

    // 클릭: 그룹 선택
    const row = node.querySelector('.cp-row') as HTMLElement;
    row.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('.cp-toggle')?.getAttribute('data-action');
      if (action) {
        e.stopPropagation();
        this.handleAction(group.id, action);
        return;
      }
      this.selectGroupInPanel(group.id);
    });

    // 더블클릭: 편집 모드
    row.addEventListener('dblclick', () => {
      this.callbacks.onGroupDoubleClick?.(group.id);
    });

    // 자식 노드
    const children = childMap.get(group.id);
    if (children) {
      for (const child of children) {
        node.appendChild(this.createTreeNode(child, childMap, depth + 1));
      }
    }

    return node;
  }

  /** 패널에서 그룹 선택 */
  private selectGroupInPanel(groupId: number): void {
    this.selectedGroupId = groupId;
    this.callbacks.onGroupSelect?.(groupId);

    // 뷰포트에서도 그룹 선택
    this.selection.selectGroup(groupId);

    // UI 갱신
    this.treeEl.querySelectorAll('.cp-node').forEach(n => {
      n.classList.toggle('cp-selected', n.getAttribute('data-group-id') === String(groupId));
    });
  }

  /** 액션 처리 */
  private handleAction(groupId: number, action: string): void {
    switch (action) {
      case 'vis':
        this.bridge.toggleGroupVisibility(groupId);
        this.callbacks.syncMesh?.();
        this.refresh();
        break;
      case 'lock':
        this.bridge.toggleGroupLock(groupId);
        this.refresh();
        break;
      case 'delete':
        this.callbacks.onGroupDelete?.(groupId);
        this.bridge.deleteGroup(groupId);
        this.selection.ungroupSelected();
        Toast.info(`Group-${groupId} 해제됨`);
        this.refresh();
        break;
    }
  }

  /** CSS 스타일 삽입 */
  private injectStyles(): void {
    if (document.getElementById('cp-styles')) return;

    const style = document.createElement('style');
    style.id = 'cp-styles';
    style.textContent = `
      .component-panel {
        position: absolute;
        right: 8px;
        bottom: 60px;
        width: 260px;
        max-height: 300px;
        background: rgba(30, 30, 40, 0.95);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        font-size: 12px;
        color: #ccc;
        z-index: 100;
        overflow: hidden;
        backdrop-filter: blur(8px);
      }
      .cp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        background: rgba(255,255,255,0.05);
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .cp-title {
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .cp-actions {
        display: flex;
        gap: 4px;
      }
      .cp-btn {
        background: none;
        border: 1px solid rgba(255,255,255,0.15);
        color: #aaa;
        cursor: pointer;
        border-radius: 3px;
        padding: 1px 6px;
        font-size: 12px;
      }
      .cp-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .cp-tree {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
      }
      .cp-empty {
        text-align: center;
        padding: 16px;
        color: #666;
        font-style: italic;
      }
      .cp-node {
        user-select: none;
      }
      .cp-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        cursor: pointer;
        border-radius: 3px;
        margin: 0 4px;
      }
      .cp-row:hover { background: rgba(255,255,255,0.06); }
      .cp-selected > .cp-row { background: rgba(33, 150, 243, 0.2); }
      .cp-icon { font-size: 10px; width: 14px; text-align: center; }
      .cp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cp-face-count { color: #888; font-size: 10px; }
      .cp-toggle { cursor: pointer; font-size: 10px; opacity: 0.5; padding: 0 2px; }
      .cp-toggle:hover { opacity: 1; }
      .cp-btn-delete {
        background: none;
        border: none;
        color: #f44336;
        cursor: pointer;
        font-size: 11px;
        opacity: 0;
        transition: opacity 0.15s;
      }
      .cp-row:hover .cp-btn-delete { opacity: 0.6; }
      .cp-btn-delete:hover { opacity: 1 !important; }
    `;
    document.head.appendChild(style);
  }

  /** 패널 제거 */
  dispose(): void {
    this.panelEl.remove();
  }
}
