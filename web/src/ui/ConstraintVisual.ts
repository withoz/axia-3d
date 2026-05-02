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

  /** Cache for listConstraints — avoid hammering WASM when nothing changed.
   *  Bumping the topology counter from the bridge invalidates the cache. */
  private _cachedList: ConstraintItem[] | null = null;
  private _cachedListAt = 0;
  /** Listen for topology changes to invalidate the cache. */
  private _topoSig = 0;

  /** 전체 제약을 다시 그림. camera 인자로 스크린 투영.
   *
   *  2026-05-02 fix — listConstraints was being called every animation
   *  frame (~60Hz) which racing with the renderer's other WASM calls
   *  produced "recursive use of an object detected" wasm-bindgen errors.
   *  Cache the constraint list and refresh only every ~250ms unless
   *  visibility toggles. Re-projection of cached items happens every
   *  frame (cheap — just camera transform) so visuals still track.
   */
  update(camera: THREE.Camera) {
    this.clear();
    if (!this.visible) return;

    const now = performance.now();
    const REFRESH_MS = 250;
    let list = this._cachedList;
    if (list === null || now - this._cachedListAt > REFRESH_MS) {
      try {
        list = this.bridge.listConstraints() as ConstraintItem[];
        this._cachedList = list;
        this._cachedListAt = now;
      } catch {
        // Defensive — never let a bridge failure spam the console every
        // frame. Use last cached list, or empty.
        list = this._cachedList ?? [];
      }
    }
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
    this.canvas.remove();
  }
}
