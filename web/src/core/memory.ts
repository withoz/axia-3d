/**
 * AXiA Memory Budget — ADR-013 §1·§2 측정 인프라
 *
 * "메모리 폭발 = GC stop-the-world = 프레임 끊김" 의 인과 사슬을 끊으려면
 * 모든 자료구조가 cap 을 갖고, 글로벌 예산이 명시되어야 한다.
 *
 * 사용:
 *   import { memoryBudget } from './core/memory';
 *
 *   memoryBudget.registerSampler('snapCache', () => snap.estimateBytes());
 *   memoryBudget.registerSampler('bvh',       () => viewport.estimateBvhBytes());
 *
 *   memoryBudget.snapshot();  // 현재 사용량 + budget 비교
 *
 *   window.__AXIA_DEBUG = true;
 *   window.__AXIA_MEMORY  // 콘솔에서 즉시 확인
 */

import { isDebug } from '../utils/debug';

// ── ADR-013 §1 예산 (typical 1만 face 기준) ─────────────────────────

export interface BudgetTier {
  /** 권장 (이 값 이하 권장) */
  target: number;
  /** Soft limit — 도달 시 evict 정책 발동 */
  soft: number;
  /** Hard limit — 도달 시 사용자 toast + 강제 정리 */
  hard: number;
}

export const MEMORY_BUDGETS: Record<string, BudgetTier> = {
  rust:       { target:  50, soft:  80, hard: 120 },  // MB — Rust slot storage
  geometry:   { target:  80, soft: 120, hard: 200 },  // MB — Three.js BufferGeometry
  bvh:        { target:  20, soft:  40, hard:  60 },
  snapCache:  { target:  10, soft:  15, hard:  20 },
  history:    { target:  30, soft:  50, hard:  80 },  // OperationLog + snapshots
  undo:       { target:  50, soft:  80, hard: 150 },  // TransactionManager snapshots
  // 합계 target: 240 MB / soft: 385 MB / hard: 630 MB
};

// ── Snapshot data shape ─────────────────────────────────────────────

export interface MemorySnapshot {
  /** 영역별 현재 사용량 (bytes). Sampler 가 반환한 값 그대로. */
  bytes: Record<string, number>;
  /** MB 단위로 변환된 사용량. */
  mb: Record<string, number>;
  /** 영역별 budget 대비 사용률 (%). */
  pct: Record<string, number>;
  /** 영역별 budget tier (target/soft/hard) 인지 표시. */
  tier: Record<string, 'ok' | 'target+' | 'soft+' | 'hard+'>;
  /** 전체 합계 (MB). */
  totalMb: number;
  /** 전체 budget (target / soft / hard 합) 대비 사용률. */
  budgetUsedPct: { target: number; soft: number; hard: number };
}

// ── Implementation ──────────────────────────────────────────────────

type Sampler = () => number;  // bytes

class MemoryBudgetCore {
  private samplers = new Map<string, Sampler>();

  /** Register a byte-counter for a memory area.
   *  `key` 는 MEMORY_BUDGETS 의 key 와 매칭 — 일치하지 않으면 budget=0 처리. */
  registerSampler(key: string, fn: Sampler): void {
    this.samplers.set(key, fn);
  }

  /** Take a snapshot of current memory usage.
   *  Cost: ~O(samplers.size) — each sampler is called once. Cheap. */
  snapshot(): MemorySnapshot {
    const bytes: Record<string, number> = {};
    const mb: Record<string, number> = {};
    const pct: Record<string, number> = {};
    const tier: Record<string, 'ok' | 'target+' | 'soft+' | 'hard+'> = {};
    let totalMb = 0;
    let totalTarget = 0, totalSoft = 0, totalHard = 0;

    for (const [key, sampler] of this.samplers) {
      let b: number;
      try { b = sampler(); } catch { b = 0; }
      const m = b / (1024 * 1024);
      bytes[key] = b;
      mb[key] = +m.toFixed(2);
      totalMb += m;

      const budget = MEMORY_BUDGETS[key];
      if (budget) {
        const usedPct = (m / budget.soft) * 100;
        pct[key] = +usedPct.toFixed(1);
        tier[key] =
          m > budget.hard   ? 'hard+'   :
          m > budget.soft   ? 'soft+'   :
          m > budget.target ? 'target+' : 'ok';
        totalTarget += budget.target;
        totalSoft   += budget.soft;
        totalHard   += budget.hard;
      } else {
        pct[key] = 0;
        tier[key] = 'ok';
      }
    }

    return {
      bytes, mb, pct, tier,
      totalMb: +totalMb.toFixed(2),
      budgetUsedPct: {
        target: totalTarget > 0 ? +((totalMb / totalTarget) * 100).toFixed(1) : 0,
        soft:   totalSoft   > 0 ? +((totalMb / totalSoft)   * 100).toFixed(1) : 0,
        hard:   totalHard   > 0 ? +((totalMb / totalHard)   * 100).toFixed(1) : 0,
      },
    };
  }

  /** True if any tracked area is at hard limit (callers should evict NOW). */
  isOverHardLimit(): boolean {
    const s = this.snapshot();
    return Object.values(s.tier).some(t => t === 'hard+');
  }

  /** True if any tracked area is at soft limit. */
  isOverSoftLimit(): boolean {
    const s = this.snapshot();
    return Object.values(s.tier).some(t => t === 'soft+' || t === 'hard+');
  }

  /** Return the list of areas currently over their soft limit. */
  areasOverSoft(): string[] {
    const s = this.snapshot();
    return Object.entries(s.tier)
      .filter(([, t]) => t === 'soft+' || t === 'hard+')
      .map(([k]) => k);
  }

  /** Currently registered sampler keys. */
  registeredAreas(): string[] {
    return Array.from(this.samplers.keys());
  }
}

export const memoryBudget = new MemoryBudgetCore();

// ── Default samplers — register at module load when `window` exists ──

declare global {
  interface Window {
    __AXIA_MEMORY?: MemorySnapshot;
    __AXIA_MEMORY_AREAS?: () => string[];
  }
}

/**
 * Register baseline samplers + install `window.__AXIA_MEMORY` getter.
 * Other modules can call memoryBudget.registerSampler() afterwards.
 */
export function installMemoryGlobal(): void {
  if (typeof window === 'undefined') return;

  // ── (a) Rust slot storage — WebAssembly.Memory.byteLength ──
  // Best-effort: requires the engine to expose a wasm Memory reference.
  memoryBudget.registerSampler('rust', () => {
    const w = window as unknown as {
      __axia?: { services?: { get?: (k: string) => unknown } };
    };
    const bridge = w.__axia?.services?.get?.('bridge') as
      | { engine?: { memory?: WebAssembly.Memory } }
      | undefined;
    return bridge?.engine?.memory?.buffer?.byteLength ?? 0;
  });

  Object.defineProperty(window, '__AXIA_MEMORY', {
    configurable: true,
    get: () => {
      if (!isDebug()) {
        return {
          hint: 'window.__AXIA_DEBUG = true 후 다시 확인하세요.',
          ...memoryBudget.snapshot(),
        } as unknown as MemorySnapshot;
      }
      return memoryBudget.snapshot();
    },
  });
  (window as Window).__AXIA_MEMORY_AREAS = () => memoryBudget.registeredAreas();
}

// ── Bounded Collection — ADR-013 §2 helper ─────────────────────────

/**
 * Generic LRU-bounded Map. Insertion / access reorders entry to most-recent.
 * Used wherever a cache's size could grow unboundedly.
 *
 * 사용:
 *   const cache = new BoundedLRU<string, MeshData>(200);
 *   cache.set('a', data);
 *   cache.get('a');  // moves 'a' to most-recent
 */
export class BoundedLRU<K, V> {
  private map = new Map<K, V>();
  constructor(private cap: number) {
    if (cap < 1) throw new Error('BoundedLRU cap must be ≥ 1');
  }

  get capacity(): number { return this.cap; }
  get size(): number { return this.map.size; }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    // Move to most-recent position.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.cap) {
      // Evict least-recently-used (the oldest entry, which is first in iter).
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean { return this.map.has(key); }
  delete(key: K): boolean { return this.map.delete(key); }
  clear(): void { this.map.clear(); }
  keys(): IterableIterator<K> { return this.map.keys(); }
  values(): IterableIterator<V> { return this.map.values(); }
}
