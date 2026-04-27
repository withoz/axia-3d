/**
 * PickingRouter — ADR-012 §4 단일 picking 진입점.
 *
 * 문제:
 *   현재 Spatial Hash / BVH / Snap dirty flag 가 각각 잘 동작하지만
 *   *어떤 query 에 어느 자료구조를 쓸지* 결정 트리가 코드 곳곳에 흩어져
 *   있다. 호출자가 직접 picking 자료구조를 선택해야 하므로:
 *     - 잘못된 자료구조 사용 시 성능 저하
 *     - latency budget 측정의 일관성 부족
 *     - 향후 budget 위반 시 자동 강등 (low-LOD picking 등) 적용 어려움
 *
 * 해결:
 *   하나의 `route(query)` 진입점. 호출자는 *무엇을 찾는지* (query.kind)
 *   만 알면 되고 *어떻게 찾을지* 는 router 가 결정.
 *   매 query 의 elapsed 가 자동으로 telemetry 에 기록되어 hover budget
 *   (16ms) 안에 들어가는지 검증된다.
 *
 * 사용:
 *   import { pickingRouter } from './core/PickingRouter';
 *   const r = pickingRouter.route({ kind: 'face', x, y, viewport });
 *   if (r) { ... }
 *
 * 구현 노트:
 *   현 단계 (Sprint 2) 는 Viewport 의 기존 pick / pickEdge / pickEdgeOrFace
 *   를 wrap 하는 *측정 layer*. 자료구조 자체는 Viewport 내부 BVH /
 *   raycaster 가 담당. 향후 Sprint 4~5 에서 자료구조를 Router 안으로
 *   moved (LOD 강등 등 자동화) 가능.
 */

import * as THREE from 'three';
import { telemetry, type BudgetKey } from './telemetry';

/** A minimal Viewport-shaped object the router calls into.
 *  Defined as an interface so the router can be unit-tested without
 *  pulling Three.js / WebGL deps. */
export interface ViewportPickerLike {
  pick(x: number, y: number): THREE.Intersection | null;
  pickEdge(x: number, y: number): THREE.Intersection | null;
  pickEdgeOrFace(x: number, y: number, preferEdgeWithinPx?: number): {
    type: 'edge' | 'face';
    hit: THREE.Intersection;
  } | null;
}

export type PickQuery =
  | { kind: 'face'; x: number; y: number; viewport: ViewportPickerLike }
  | { kind: 'edge'; x: number; y: number; viewport: ViewportPickerLike }
  | {
      kind: 'edgeOrFace';
      x: number; y: number;
      viewport: ViewportPickerLike;
      /** Optional override for the edge-preference radius (px).
       *  Default in Viewport.pickEdgeOrFace = 5. Select / Erase tools
       *  pass a larger value (12) so casual cursor proximity to a
       *  visible edge yields edge selection. */
      preferEdgeWithinPx?: number;
    };

export type PickResult =
  | { kind: 'face'; hit: THREE.Intersection }
  | { kind: 'edge'; hit: THREE.Intersection }
  | { kind: 'face'; hit: THREE.Intersection; via: 'edgeOrFace' }
  | { kind: 'edge'; hit: THREE.Intersection; via: 'edgeOrFace' }
  | null;

class PickingRouterCore {
  /** Single entry point. Routes to the appropriate picker + measures. */
  route(query: PickQuery): PickResult {
    const key = this.budgetKeyFor(query);
    return telemetry.measure(key, () => this.dispatch(query));
  }

  // ── Internal ──

  private budgetKeyFor(query: PickQuery): BudgetKey {
    switch (query.kind) {
      case 'face':       return 'picking.face';
      case 'edge':       return 'picking.edge';
      case 'edgeOrFace': return 'picking.face';  // mixed; bias toward face budget
    }
  }

  private dispatch(query: PickQuery): PickResult {
    switch (query.kind) {
      case 'face': {
        const hit = query.viewport.pick(query.x, query.y);
        return hit ? { kind: 'face', hit } : null;
      }
      case 'edge': {
        const hit = query.viewport.pickEdge(query.x, query.y);
        return hit ? { kind: 'edge', hit } : null;
      }
      case 'edgeOrFace': {
        const r = query.viewport.pickEdgeOrFace(
          query.x, query.y, query.preferEdgeWithinPx,
        );
        if (!r) return null;
        return r.type === 'edge'
          ? { kind: 'edge', hit: r.hit, via: 'edgeOrFace' }
          : { kind: 'face', hit: r.hit, via: 'edgeOrFace' };
      }
    }
  }
}

export const pickingRouter = new PickingRouterCore();
