/**
 * EvictionPolicy — ADR-013 §3 자동 메모리 정리.
 *
 * Soft limit 도달 시 priority 순으로 cache 를 비워 메모리 압박을
 * 해소한다. 순서는 ADR-013 §3:
 *
 *   1. Snap cache LRU evict       (가장 안전, hover 시 lazy rebuild)
 *   2. BVH lazy rebuild           (다음 picking 시 rebuild)
 *   3. History oldest → delta     (full snapshot 폐기)
 *   4. Telemetry buffer flush     (오래된 violation 폐기)
 *   5. Undo cap 강제 축소         (마지막 수단)
 *
 * 사용:
 *   evictionPolicy.register('snap', 1, () => snap.clearCache());
 *   evictionPolicy.register('bvh',  2, () => viewport.disposeBvh());
 *
 *   // 주기적 또는 commit 직후 호출:
 *   const r = evictionPolicy.runIfNeeded();
 *   if (r.triggered) console.log(`Freed ${r.bytesFreed} bytes`);
 *
 * 설계 노트:
 *   - register 한 handler 는 priority 낮은 순 (1 → 5) 으로 호출
 *   - handler 가 반환한 byteCount 가 누적
 *   - soft limit 아래로 떨어지면 조기 종료 → 불필요 정리 회피
 *   - Hard limit 도달 시 모든 handler 강제 실행 (priority 무시)
 */

import { memoryBudget } from './memory';

export interface EvictionHandler {
  /** Memory area key (matches MEMORY_BUDGETS). */
  area: string;
  /** 1 (first to evict) … 99 (last). ADR-013 §3 권장 순서:
   *   snap=1, bvh=2, history=3, telemetry=4, undo=5. */
  priority: number;
  /** Evict and return number of bytes freed (best-effort estimate). */
  evict: () => number;
}

export interface EvictionResult {
  /** True if any eviction was performed. */
  triggered: boolean;
  /** Total bytes freed across all handlers. */
  bytesFreed: number;
  /** Areas that ran. */
  areasEvicted: string[];
  /** Reason that triggered eviction. */
  reason: 'soft' | 'hard' | 'manual' | 'none';
}

class EvictionPolicyCore {
  private handlers: EvictionHandler[] = [];

  /** Register an evict handler. Re-registering the same area replaces. */
  register(area: string, priority: number, evict: () => number): void {
    const idx = this.handlers.findIndex(h => h.area === area);
    const handler: EvictionHandler = { area, priority, evict };
    if (idx >= 0) this.handlers[idx] = handler;
    else this.handlers.push(handler);
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  /** Remove an evict handler. */
  unregister(area: string): void {
    this.handlers = this.handlers.filter(h => h.area !== area);
  }

  /** Number of registered handlers. */
  get size(): number { return this.handlers.length; }

  /** Currently registered handler areas in priority order. */
  registeredAreas(): string[] {
    return this.handlers.map(h => h.area);
  }

  /** Test/dev — clear all handlers. */
  reset(): void { this.handlers.length = 0; }

  /**
   * Run eviction if memory is over soft limit. Stops as soon as we drop
   * below soft limit (avoids over-aggressive cleanup).
   *
   * If `force=true`, runs ALL handlers regardless of memory state.
   */
  runIfNeeded(opts: { force?: boolean } = {}): EvictionResult {
    const force = opts.force === true;
    const isHard = memoryBudget.isOverHardLimit();
    const isSoft = memoryBudget.isOverSoftLimit();

    if (!force && !isSoft) {
      return { triggered: false, bytesFreed: 0, areasEvicted: [], reason: 'none' };
    }

    const reason: 'soft' | 'hard' | 'manual' = force ? 'manual' : isHard ? 'hard' : 'soft';
    let bytesFreed = 0;
    const areasEvicted: string[] = [];

    for (const h of this.handlers) {
      let freed = 0;
      try { freed = h.evict() | 0; }
      catch (e) { console.warn(`[EvictionPolicy] ${h.area} evict threw:`, e); }
      if (freed > 0) {
        bytesFreed += freed;
        areasEvicted.push(h.area);
      }
      // Hard limit: continue regardless. Soft: stop when below threshold.
      if (reason !== 'hard' && !force) {
        if (!memoryBudget.isOverSoftLimit()) break;
      }
    }
    return { triggered: areasEvicted.length > 0, bytesFreed, areasEvicted, reason };
  }
}

export const evictionPolicy = new EvictionPolicyCore();

declare global {
  interface Window {
    __AXIA_EVICT?: () => EvictionResult;
  }
}

/** Install console-accessible evict trigger: `window.__AXIA_EVICT()`. */
export function installEvictionGlobal(): void {
  if (typeof window === 'undefined') return;
  (window as Window).__AXIA_EVICT = () => evictionPolicy.runIfNeeded({ force: true });
}
