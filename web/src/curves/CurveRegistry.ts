/**
 * CurveRegistry — 씬에 등록된 Curve 객체들의 저장소 (Phase I, 2026-04-20).
 *
 * Curve Layer 전역 싱글톤. Arc/Bezier/Spline/Freehand 등 사용자 곡선의
 * 원본 정의를 보존. DCEL과 독립적이지만 tessellated edge ID를 연결해
 * 편집 시 재생성 가능.
 *
 * Save/Load: AXIA v3 포맷에서 이 registry를 직렬화.
 */

import { Curve } from './Curve';

type Listener = () => void;

class CurveRegistryImpl {
  private curves = new Map<number, Curve>();
  /** curve id → tessellated edge id 배열 (편집 시 재구성에 사용) */
  private edgeLinks = new Map<number, number[]>();
  private listeners = new Set<Listener>();

  add(curve: Curve): void {
    this.curves.set(curve.id, curve);
    this.notify();
  }

  remove(id: number): boolean {
    const ok = this.curves.delete(id);
    this.edgeLinks.delete(id);
    if (ok) this.notify();
    return ok;
  }

  get(id: number): Curve | undefined {
    return this.curves.get(id);
  }

  getAll(): Curve[] {
    return Array.from(this.curves.values());
  }

  size(): number {
    return this.curves.size;
  }

  clear(): void {
    this.curves.clear();
    this.edgeLinks.clear();
    this.notify();
  }

  /** 편집 시 재tessellate 위해 curve ↔ edges 연결 저장 */
  linkEdges(curveId: number, edgeIds: number[]): void {
    this.edgeLinks.set(curveId, edgeIds);
  }

  getLinkedEdges(curveId: number): number[] {
    return this.edgeLinks.get(curveId) ?? [];
  }

  /** JSON 직렬화 (AXIA 파일 포함용) */
  toJSON(): { curves: Curve[]; edgeLinks: [number, number[]][] } {
    return {
      curves: this.getAll(),
      edgeLinks: Array.from(this.edgeLinks.entries()),
    };
  }

  fromJSON(data: { curves?: Curve[]; edgeLinks?: [number, number[]][] }): void {
    this.curves.clear();
    this.edgeLinks.clear();
    if (data.curves) {
      for (const c of data.curves) this.curves.set(c.id, c);
    }
    if (data.edgeLinks) {
      for (const [cid, eids] of data.edgeLinks) this.edgeLinks.set(cid, eids);
    }
    this.notify();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

const instance = new CurveRegistryImpl();

export function getCurveRegistry(): CurveRegistryImpl {
  return instance;
}

export type CurveRegistry = CurveRegistryImpl;
