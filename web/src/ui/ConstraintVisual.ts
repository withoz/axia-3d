/**
 * ConstraintVisual — 3D 뷰포트에 constraint 상태를 시각적으로 오버레이.
 *
 * 각 활성 제약 참조 엣지의 중점(또는 vertex 위치)에 아이콘 표시:
 *   - Parallel      ∥
 *   - Perpendicular ⊥
 *   - Collinear     —
 *   - Distance      ↔
 *
 * 비활성 제약은 투명도 낮춰 렌더. SnapVisual과 유사한 독립 캔버스 오버레이.
 */

import * as THREE from 'three';
import type { WasmBridge } from '../bridge/WasmBridge';

type Kind = 'parallel' | 'perpendicular' | 'collinear' | 'distance';

interface ConstraintItem {
  id: number;
  kind: Kind | string;
  active: boolean;
  value?: number;
  refs: Array<{ edge?: [number, number]; vertex?: number }>;
}

const KIND_SYMBOL: Record<string, string> = {
  parallel: '∥',
  perpendicular: '⊥',
  collinear: '—',
  distance: '↔',
};

const KIND_COLOR: Record<string, string> = {
  parallel: '#9ecbff',
  perpendicular: '#ffc48a',
  collinear: '#d8a4ff',
  distance: '#7be288',
};

export class ConstraintVisual {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private bridge: WasmBridge;
  private visible = true;

  constructor(container: HTMLElement, bridge: WasmBridge) {
    this.container = container;
    this.bridge = bridge;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '55';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }
  toggle() { this.setVisible(!this.visible); }
  isVisible() { return this.visible; }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Snapshot-once cache (2026-05-02 architectural fix).
   *
   * Pattern: "Snapshot once, render forever until invalidated".
   *
   * Per-frame `update()` NEVER calls into WASM for the constraint list —
   * it only re-projects the cached snapshot via the camera transform. The
   * snapshot is refreshed exclusively in response to events fired by the
   * bridge (add/remove/toggle/resolve/undo/redo/import). This eliminates
   * the per-frame WASM borrow that was racing with mutating calls and
   * triggering wasm-bindgen "recursive use of an object detected" panics.
   *
   * Initial population happens lazily (on first update where visible=true)
   * to avoid bridge calls before the engine finishes WASM bootstrapping.
   */
  private _cachedList: ConstraintItem[] | null = null;
  private _unsubscribeFromBridge: (() => void) | null = null;

  /** Refresh the cache from WASM. Called on bridge events, NOT every frame. */
  refreshCache(): void {
    try {
      this._cachedList = this.bridge.listConstraints() as ConstraintItem[];
    } catch {
      // Defensive — never let a bridge failure clear an existing cache.
      // Worst case: we render last-known constraints until next event.
      if (this._cachedList === null) this._cachedList = [];
    }
  }

  /**
   * 전체 제약을 다시 그림. camera 인자로 스크린 투영.
   *
   * Pure projection from cached snapshot — NO WASM call here. Cache is
   * populated once on first call and refreshed only on bridge events
   * (subscription installed lazily on first update).
   */
  update(camera: THREE.Camera) {
    this.clear();
    if (!this.visible) return;

    // Lazy subscribe + first snapshot. Only happens once.
    if (this._unsubscribeFromBridge === null) {
      this._unsubscribeFromBridge = this.bridge.onConstraintsChanged(
        () => this.refreshCache(),
      );
      this.refreshCache();
    }

    const list = this._cachedList ?? [];
    if (list.length === 0) return;

    const rect = this.container.getBoundingClientRect();
    const toScreen = (v: THREE.Vector3): { x: number; y: number; z: number } | null => {
      const p = v.clone().project(camera);
      if (p.z < -1 || p.z > 1) return null;
      return {
        x: (p.x * 0.5 + 0.5) * rect.width,
        y: (-p.y * 0.5 + 0.5) * rect.height,
        z: p.z,
      };
    };

    const edgeMid = (vA: number, vB: number): THREE.Vector3 | null => {
      const pa = this.bridge.getVertexPos(vA);
      const pb = this.bridge.getVertexPos(vB);
      if (!pa || !pb) return null;
      return new THREE.Vector3((pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2);
    };

    const ctx = this.ctx;
    for (const c of list) {
      const sym = KIND_SYMBOL[c.kind] ?? '?';
      const color = KIND_COLOR[c.kind] ?? '#cccccc';
      const alpha = c.active ? 1.0 : 0.35;

      if (c.kind === 'distance') {
        const vA = c.refs[0]?.vertex;
        const vB = c.refs[1]?.vertex;
        if (vA === undefined || vB === undefined) continue;
        const pa = this.bridge.getVertexPos(vA);
        const pb = this.bridge.getVertexPos(vB);
        if (!pa || !pb) continue;
        const mid = new THREE.Vector3((pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2);
        const s = toScreen(mid);
        if (s) {
          this.drawMarker(s.x, s.y, sym, color, alpha, c.value);
        }
      } else {
        // edge-based constraint — draw icon at midpoint of each ref edge
        for (const ref of c.refs) {
          if (!ref.edge) continue;
          const mid = edgeMid(ref.edge[0], ref.edge[1]);
          if (!mid) continue;
          const s = toScreen(mid);
          if (s) {
            this.drawMarker(s.x, s.y, sym, color, alpha);
          }
        }
      }
      void ctx;
    }
  }

  private drawMarker(
    x: number, y: number,
    symbol: string, color: string, alpha: number,
    valueLabel?: number,
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Small colored circle backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    // Symbol
    ctx.fillStyle = color;
    ctx.font = '600 13px "Pretendard Variable", Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, x, y + 1);
    // Optional numeric value (Distance)
    if (valueLabel !== undefined) {
      const text = `${valueLabel.toFixed(1)}`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x + 12, y - 8, ctx.measureText(text).width + 6, 16);
      ctx.fillStyle = color;
      ctx.font = '500 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 15, y + 1);
    }
    ctx.restore();
  }

  dispose() {
    if (this._unsubscribeFromBridge) {
      this._unsubscribeFromBridge();
      this._unsubscribeFromBridge = null;
    }
    this.canvas.remove();
  }
}
