/**
 * Draggable Panel Manager — CAD-grade Panel State Machine
 *
 * Implements formal state transitions for panels:
 * - PanelState: Floating, Docked, AutoHide, Hidden
 * - DockPosition: Left, Right, Top, Bottom, CenterTab
 * - Magnetic snap zones at 25px threshold
 * - WorkspaceLayout persistence (localStorage)
 *
 * Architecture:
 * - transition() validates state changes
 * - PanelModel stores per-panel state
 * - Event-driven lifecycle (onActivate, onDeactivate, onDrag, onResize)
 */

import { debugLog } from '../utils/debug';

/** Layout chrome offsets the manager must respect so panels don't cover
 *  fixed UI:
 *   - top 28px = #menubar
 *   - bottom 36px = #bottombar (30px) + 1px gap + 5px clearance
 *  Floating panels' `y + height` must not exceed `innerHeight - BOTTOM_RESERVED`.
 */
export const TOP_RESERVED = 28;
export const BOTTOM_RESERVED = 36;

/** Clamp a floating rect so it stays within the safe viewport region. */
export function clampFloatingRect(rect: { x: number; y: number; width: number; height: number; }): { x: number; y: number; width: number; height: number; } {
  const vh = (typeof window !== 'undefined' ? window.innerHeight : 720);
  const vw = (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const usableTop = TOP_RESERVED;
  const usableBottom = vh - BOTTOM_RESERVED;
  const usableHeight = Math.max(120, usableBottom - usableTop);

  const width = Math.max(150, Math.min(rect.width, vw));
  // Cap height to fit inside the usable region.
  const height = Math.max(120, Math.min(rect.height, usableHeight));
  // Push y up if the panel would extend below the safe zone.
  let y = Math.max(usableTop, rect.y);
  if (y + height > usableBottom) y = Math.max(usableTop, usableBottom - height);
  // Keep horizontal in-bounds.
  let x = Math.max(0, Math.min(rect.x, vw - width));
  return { x, y, width, height };
}

enum PanelState {
  Floating = 'floating',
  Docked = 'docked',
  AutoHide = 'auto-hide',
  Hidden = 'hidden'
}

enum DockPosition {
  Left = 'left',
  Right = 'right',
  Top = 'top',
  Bottom = 'bottom',
  CenterTab = 'center-tab'
}

enum PanelEvent {
  DragEnd = 'drag-end',
  ResizeEnd = 'resize-end',
  DockRequest = 'dock-request',
  UndockRequest = 'undock-request',
  AutoHideRequest = 'auto-hide-request',
  HideRequest = 'hide-request',
  ShowRequest = 'show-request',
  ExpandAutoHide = 'expand-auto-hide',
  CollapseAutoHide = 'collapse-auto-hide'
}

type DockZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SizeConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface PanelModel {
  id: string;
  name: string;
  state: PanelState;
  dockPosition?: DockPosition;
  floatingRect: FloatingRect;
  sizeConstraints: SizeConstraints;
  isVisible: boolean;
  zIndex: number;
}

interface WorkspaceLayout {
  version: number;
  panels: Map<string, PanelModel>;
  lastModified: number;
}

interface DockZoneRect {
  zone: DockZone;
  rect: DOMRect;
}

export class DraggablePanelManager {
  private panels: Map<string, PanelModel> = new Map();
  private layout: WorkspaceLayout = {
    version: 1,
    panels: new Map(),
    lastModified: Date.now()
  };

  private nextZIndex: number = 1000;
  private draggedPanel: { id: string; startX: number; startY: number } | null = null;
  private autoHideExpandedPanel: string | null = null;
  private resizedPanel: { id: string; startWidth: number; startHeight: number } | null = null;

  // Magnetic snap threshold (px)
  private static readonly SNAP_THRESHOLD = 25;

  constructor() {
    this.initializePanels();
    this.loadLayout();
    this.setupEventListeners();
  }

  /**
   * Initialize default panels with constraints and positions
   */
  private initializePanels(): void {
    const defaultPanels = [
      // Defaults sized to the visible viewport — heights tuned so two
      // stacked right-side panels (Inspector above Style) fit between
      // the menubar (top 28px) and statusbar (bottom 36px) without
      // overlapping either.
      {
        id: 'xia-inspector',
        name: 'Inspector',
        state: PanelState.Floating,
        floatingRect: clampFloatingRect({ x: window.innerWidth - 340, y: 60, width: 320, height: 380 }),
        sizeConstraints: { minWidth: 250, minHeight: 300, maxWidth: 600, maxHeight: 1000 },
        isVisible: true
      },
      {
        id: 'style-panel',
        name: 'Style',
        state: PanelState.Floating,
        // Stack below Inspector — y picked so Style ends ≥ 36px above bottom.
        floatingRect: clampFloatingRect({ x: window.innerWidth - 340, y: 460, width: 320, height: 220 }),
        sizeConstraints: { minWidth: 250, minHeight: 200, maxWidth: 600, maxHeight: 800 },
        isVisible: true
      },
      {
        id: 'osnap-panel',
        name: 'Snap',
        state: PanelState.Hidden,
        floatingRect: clampFloatingRect({ x: 20, y: 480, width: 300, height: 200 }),
        sizeConstraints: { minWidth: 200, minHeight: 150, maxWidth: 600, maxHeight: 400 },
        isVisible: false
      }
    ];

    defaultPanels.forEach(p => {
      this.panels.set(p.id, {
        ...p,
        zIndex: this.nextZIndex++
      });
    });
  }

  /**
   * Register all panels in the DOM
   */
  public registerAllPanels(panelIds: string[]): void {
    panelIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) {
        console.warn(`[PanelManager] Panel not found: ${id}`);
        return;
      }

      const panel = this.panels.get(id);
      if (!panel) {
        console.warn(`[PanelManager] Panel model not registered: ${id}`);
        return;
      }

      // Apply initial styles
      el.classList.add('draggable-panel', `state-${panel.state}`);
      el.style.zIndex = String(panel.zIndex);

      if (panel.state === PanelState.Floating) {
        // Clamp the persisted rect so panels never extend over the
        // status bar (#bottombar) or up past the menubar.
        panel.floatingRect = clampFloatingRect(panel.floatingRect);
        el.style.position = 'fixed';
        el.style.left = `${panel.floatingRect.x}px`;
        el.style.top = `${panel.floatingRect.y}px`;
        el.style.width = `${panel.floatingRect.width}px`;
        el.style.height = `${panel.floatingRect.height}px`;
      }

      this.setupPanelDragResize(el, id);
    });
  }

  /**
   * State transition function with validation
   */
  public transition(panelId: string, event: PanelEvent, dockPos?: DockPosition): boolean {
    const panel = this.panels.get(panelId);
    if (!panel) {
      console.warn(`[PanelManager] Panel not found: ${panelId}`);
      return false;
    }

    const currentState = panel.state;
    let newState = currentState;
    let isValid = false;

    switch (event) {
      case PanelEvent.DockRequest:
        if (currentState === PanelState.Floating || currentState === PanelState.AutoHide) {
          newState = PanelState.Docked;
          if (dockPos) panel.dockPosition = dockPos;
          isValid = true;
        }
        break;

      case PanelEvent.UndockRequest:
        if (currentState === PanelState.Docked) {
          newState = PanelState.Floating;
          isValid = true;
        }
        break;

      case PanelEvent.AutoHideRequest:
        if (currentState === PanelState.Floating || currentState === PanelState.Docked) {
          newState = PanelState.AutoHide;
          isValid = true;
        }
        break;

      case PanelEvent.HideRequest:
        if (currentState !== PanelState.Hidden) {
          newState = PanelState.Hidden;
          panel.isVisible = false;
          isValid = true;
        }
        break;

      case PanelEvent.ShowRequest:
        if (currentState === PanelState.Hidden) {
          newState = PanelState.Floating;
          panel.isVisible = true;
          isValid = true;
        }
        break;

      default:
        break;
    }

    if (isValid && newState !== currentState) {
      panel.state = newState;
      this.applyPanelState(panelId);
      debugLog(`[Panel State] ${panelId}: ${currentState} → ${newState}`);
      return true;
    }

    return false;
  }

  /**
   * Get current state of a panel
   */
  public getPanelState(panelId: string): PanelState | null {
    return this.panels.get(panelId)?.state ?? null;
  }

  /**
   * Apply panel state to DOM
   */
  private applyPanelState(panelId: string): void {
    const el = document.getElementById(panelId);
    if (!el) return;

    const panel = this.panels.get(panelId);
    if (!panel) return;

    // Remove all state classes
    el.classList.remove('state-floating', 'state-docked', 'state-auto-hide', 'state-hidden');
    el.classList.add(`state-${panel.state}`);

    if (panel.state === PanelState.Floating) {
      panel.floatingRect = clampFloatingRect(panel.floatingRect);
      el.style.position = 'fixed';
      el.style.left = `${panel.floatingRect.x}px`;
      el.style.top = `${panel.floatingRect.y}px`;
      el.style.width = `${panel.floatingRect.width}px`;
      el.style.height = `${panel.floatingRect.height}px`;
      el.style.display = panel.isVisible ? 'block' : 'none';
    } else if (panel.state === PanelState.Hidden) {
      el.style.display = 'none';
    } else if (panel.state === PanelState.AutoHide) {
      el.style.display = this.autoHideExpandedPanel === panelId ? 'block' : 'none';
    }

    this.saveLayout();
  }

  /**
   * Setup drag and resize handlers for a panel
   */
  private setupPanelDragResize(el: HTMLElement, panelId: string): void {
    // Find header by class names used in actual HTML
    let header = el.querySelector('[data-panel-header]') as HTMLElement;
    if (!header) {
      header = el.querySelector('.xi-header, .sty-header, .osnap-header') as HTMLElement;
    }
    if (!header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startPanelX = 0;
    let startPanelY = 0;

    // Drag handler
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;

      const panel = this.panels.get(panelId);
      if (!panel) return;

      startX = e.clientX;
      startY = e.clientY;
      startPanelX = panel.floatingRect.x;
      startPanelY = panel.floatingRect.y;

      el.style.zIndex = String(++this.nextZIndex);

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const panel = this.panels.get(panelId);
      if (!panel) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newX = startPanelX + dx;
      const newY = startPanelY + dy;

      // Render phantom panel
      this.renderPhantomPanel(el, newX, newY);

      // Check dock zones
      const dockZone = this.detectDockZone(newX, newY);
      if (dockZone) {
        this.renderDockPreview(dockZone);
      } else {
        this.clearDockPreview();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;

      const panel = this.panels.get(panelId);
      if (!panel) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Clamp dragged position so panel cannot cover the status bar.
      const clamped = clampFloatingRect({
        x: startPanelX + dx,
        y: startPanelY + dy,
        width: panel.floatingRect.width,
        height: panel.floatingRect.height,
      });
      panel.floatingRect.x = clamped.x;
      panel.floatingRect.y = clamped.y;
      panel.floatingRect.width = clamped.width;
      panel.floatingRect.height = clamped.height;

      // Snap to dock zones if close enough
      const dockZone = this.detectDockZone(panel.floatingRect.x, panel.floatingRect.y);
      if (dockZone) {
        this.transition(panelId, PanelEvent.DockRequest, this.zoneToDockPosition(dockZone));
      }

      el.style.left = `${panel.floatingRect.x}px`;
      el.style.top = `${panel.floatingRect.y}px`;

      this.clearPhantomPanel();
      this.clearDockPreview();
      this.transition(panelId, PanelEvent.DragEnd);

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      this.saveLayout();
    };
  }

  /**
   * Detect if position is within dock zones
   */
  private detectDockZone(x: number, y: number): DockZone | null {
    const viewport = document.getElementById('viewport');
    if (!viewport) return null;

    const rect = viewport.getBoundingClientRect();

    // Left zone
    if (x - rect.left < DraggablePanelManager.SNAP_THRESHOLD) {
      return 'left';
    }
    // Right zone
    if (rect.right - x < DraggablePanelManager.SNAP_THRESHOLD) {
      return 'right';
    }
    // Top zone
    if (y - rect.top < DraggablePanelManager.SNAP_THRESHOLD) {
      return 'top';
    }
    // Bottom zone
    if (rect.bottom - y < DraggablePanelManager.SNAP_THRESHOLD) {
      return 'bottom';
    }

    return null;
  }

  /**
   * Convert dock zone to DockPosition enum
   */
  private zoneToDockPosition(zone: DockZone): DockPosition {
    const map: Record<DockZone, DockPosition> = {
      left: DockPosition.Left,
      right: DockPosition.Right,
      top: DockPosition.Top,
      bottom: DockPosition.Bottom,
      center: DockPosition.CenterTab
    };
    return map[zone] || DockPosition.Left;
  }

  /**
   * Render phantom panel during drag
   */
  private renderPhantomPanel(el: HTMLElement, x: number, y: number): void {
    el.classList.add('phantom-panel');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  /**
   * Clear phantom panel
   */
  private clearPhantomPanel(): void {
    document.querySelectorAll('.phantom-panel').forEach(el => {
      el.classList.remove('phantom-panel');
    });
  }

  /**
   * Render dock preview
   */
  private renderDockPreview(zone: DockZone): void {
    let existing = document.querySelector('.dock-preview') as HTMLElement | null;
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'dock-preview';
      document.body.appendChild(existing);
    }

    existing.classList.remove('dock-preview-left', 'dock-preview-right', 'dock-preview-top', 'dock-preview-bottom');
    existing.classList.add(`dock-preview-${zone}`);
    (existing as HTMLElement).style.display = 'block';
  }

  /**
   * Clear dock preview
   */
  private clearDockPreview(): void {
    const preview = document.querySelector('.dock-preview') as HTMLElement | null;
    if (preview) {
      preview.style.display = 'none';
    }
  }

  /**
   * AutoHide expand/collapse handlers
   */
  public expandAutoHidePanel(panelId: string): void {
    if (this.autoHideExpandedPanel) {
      this.collapseAutoHidePanel(this.autoHideExpandedPanel);
    }
    this.autoHideExpandedPanel = panelId;
    const el = document.getElementById(panelId);
    if (el) {
      el.classList.add('expanded');
    }
  }

  public collapseAutoHidePanel(panelId: string): void {
    if (this.autoHideExpandedPanel !== panelId) return;
    this.autoHideExpandedPanel = null;
    const el = document.getElementById(panelId);
    if (el) {
      el.classList.remove('expanded');
    }
  }

  /**
   * Save layout to localStorage
   */
  private saveLayout(): void {
    const layoutData = {
      version: 1,
      panels: Array.from(this.panels.entries()).map(([id, panel]) => ({
        id,
        state: panel.state,
        floatingRect: panel.floatingRect,
        dockPosition: panel.dockPosition,
        isVisible: panel.isVisible
      })),
      lastModified: Date.now()
    };
    localStorage.setItem('axia-panel-layout', JSON.stringify(layoutData));
  }

  /**
   * Load layout from localStorage
   */
  private loadLayout(): void {
    try {
      const data = localStorage.getItem('axia-panel-layout');
      if (!data) return;

      const layout = JSON.parse(data);
      layout.panels.forEach((p: any) => {
        const panel = this.panels.get(p.id);
        if (panel) {
          panel.state = p.state || PanelState.Floating;
          panel.floatingRect = p.floatingRect || panel.floatingRect;
          panel.dockPosition = p.dockPosition;
          panel.isVisible = p.isVisible !== false;
        }
      });
    } catch (e) {
      console.error('[PanelManager] Failed to load layout:', e);
    }
  }

  /**
   * Setup global event listeners
   */
  private setupEventListeners(): void {
    // AutoHide panel hover expand/collapse
    document.addEventListener('mouseenter', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.closest) {
        const panel = target.closest('.state-auto-hide');
        if (panel) {
          const panelId = panel.id;
          this.expandAutoHidePanel(panelId);
        }
      }
    }, true);

    document.addEventListener('mouseleave', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.closest) {
        const panel = target.closest('.state-auto-hide');
        if (panel) {
          const panelId = panel.id;
          this.collapseAutoHidePanel(panelId);
        }
      }
    }, true);
  }

  /**
   * Destroy and cleanup
   */
  public destroy(): void {
    this.saveLayout();
    this.clearPhantomPanel();
    this.clearDockPreview();
  }
}
