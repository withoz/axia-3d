/**
 * FrameScheduler — ADR-012 §2 rAF 체인 깊이 ≤ 1 구조적 보장
 *
 * 문제:
 *   여러 모듈이 각자 `requestAnimationFrame(...)` 을 호출하면 한 사용자
 *   입력에 대해 rAF 체인이 깊어진다 (rAF → rAF → rAF). 사용자는 입력 후
 *   3 frame (~50ms) 뒤에야 결과를 본다.
 *
 * 해결:
 *   동일 TaskKey 는 한 frame 안에 1회만 실행. 같은 key 의 새 task 가
 *   들어오면 기존 task 를 덮어쓰기 (latest wins). 한 frame 의 모든
 *   pending task 를 단일 rAF 안에 flush — chain depth = 1 보장.
 *
 * 사용:
 *   import { frameScheduler } from './core/FrameScheduler';
 *
 *   frameScheduler.schedule('smoothNormals', () => {
 *     // 다음 frame 에 1회 실행. 이미 같은 key 의 task 가 큐에 있으면
 *     // 이게 그것을 대체.
 *     viewport.smoothNormals(geometry);
 *   });
 *
 * 측정:
 *   각 task 의 elapsed 가 자동으로 telemetry 에 기록 (BUDGETS[key]).
 *   rAF 진입/종료가 telemetry.enterRaf / exitRaf 에 자동 기록되어
 *   maxRafChainDepth ≤ 1 검증이 가능하다.
 */

import { telemetry, BUDGETS, type BudgetKey } from './telemetry';

interface PendingTask {
  run: () => void;
  /** Optional override budget; default = BUDGETS[key] if defined. */
  budget?: number;
}

class FrameSchedulerCore {
  private pending = new Map<BudgetKey, PendingTask>();
  private rafId: number | null = null;
  /** Test-only — set true to flush synchronously on schedule() (vitest). */
  private syncMode = false;

  /**
   * Schedule `run` to execute at next animation frame. If a task with the
   * same `key` is already pending it gets *replaced* (latest wins —
   * standard for "redraw / refresh" idempotent operations).
   */
  schedule(key: BudgetKey, run: () => void, budget?: number): void {
    this.pending.set(key, { run, budget });
    if (this.syncMode) {
      this.flushOne(key);
      return;
    }
    if (this.rafId == null && typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  /** Cancel a pending task. No-op if nothing scheduled for `key`. */
  cancel(key: BudgetKey): void {
    this.pending.delete(key);
  }

  /** True if a task with the given key is queued. */
  has(key: BudgetKey): boolean {
    return this.pending.has(key);
  }

  /** Number of pending tasks. */
  get size(): number {
    return this.pending.size;
  }

  /** Drain all pending tasks immediately (test/teardown only). */
  flushNow(): void {
    if (this.rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flush();
  }

  /** Set sync mode (tests run scheduled tasks synchronously). */
  setSyncMode(on: boolean): void {
    this.syncMode = on;
  }

  // ── Internal ──

  private flush(): void {
    this.rafId = null;
    if (this.pending.size === 0) return;

    // Snapshot pending tasks in insertion order, clear queue first so a
    // task that schedules another work item gets a NEW rAF (chain depth
    // stays at 1; the next batch runs next frame).
    const tasks = Array.from(this.pending.entries());
    this.pending.clear();

    telemetry.enterRaf();
    try {
      for (const [key, task] of tasks) {
        this.runOne(key, task);
      }
    } finally {
      telemetry.exitRaf();
    }
  }

  private flushOne(key: BudgetKey): void {
    const task = this.pending.get(key);
    if (!task) return;
    this.pending.delete(key);
    telemetry.enterRaf();
    try {
      this.runOne(key, task);
    } finally {
      telemetry.exitRaf();
    }
  }

  private runOne(key: BudgetKey, task: PendingTask): void {
    const t0 = performance.now();
    try {
      task.run();
    } catch (e) {
      console.warn(`[FrameScheduler] task "${key}" threw:`, e);
    } finally {
      const elapsed = performance.now() - t0;
      // record() uses BUDGETS[key] internally; budget arg is informational.
      if (BUDGETS[key] !== undefined) {
        telemetry.record(key, elapsed);
      }
      void task.budget;
    }
  }
}

export const frameScheduler = new FrameSchedulerCore();
