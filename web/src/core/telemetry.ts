/**
 * AXiA Telemetry — ADR-012 (Latency Budget) 측정 인프라
 *
 * "측정 없이는 어디가 budget 을 깨고 있는지 알 수 없어서, 다른 ADR 의
 * 효과 검증도 어렵다." — 그래서 이 모듈을 다른 ADR 보다 먼저 통과시킨다.
 *
 * 사용법:
 *   import { telemetry, BudgetKey } from './core/telemetry';
 *
 *   // (1) 단일 작업 계측
 *   telemetry.measure('hover', () => doHoverPick(e));
 *
 *   // (2) 수동 기록 (예: 비동기/콜백)
 *   const t0 = performance.now();
 *   await doStuff();
 *   telemetry.record('commit', performance.now() - t0);
 *
 *   // (3) WASM 경계 호출 1회 발생 (BridgeWasm에서 호출)
 *   telemetry.recordCrossing();
 *
 *   // (4) Frame 경계 (rAF 안에서 처음/끝)
 *   telemetry.startFrame();
 *   ... rAF body ...
 *   telemetry.endFrame();
 *
 * 활성화:
 *   `window.__AXIA_DEBUG = true` 면 자동으로 `window.__AXIA_TELEMETRY`
 *   getter 가 노출돼 콘솔에서 즉시 확인 가능. 비활성 시 record 호출은
 *   여전히 동작하지만 노출만 안 됨 (zero overhead 가까움).
 */

import { isDebug } from '../utils/debug';

// ── Budget keys & defaults ────────────────────────────────────────

/** 작업 종류. 추가 시 BUDGETS 와 동기화. */
export type BudgetKey =
  // ── 사용자 입력 즉시 응답 (ADR-012 §1) ──
  | 'hover'        // 마우스 hover → snap/highlight 피드백
  | 'click'        // 클릭 → preview/ghost
  | 'commit'       // 도구 commit → 토폴로지 반영
  | 'heavy'        // Boolean / large import / batch
  // ── 내부 작업 단위 (ADR-012 §2 FrameScheduler TaskKey) ──
  | 'syncMesh'     // ToolManager.syncMesh 전체
  | 'updateMesh'   // viewport.updateMesh (geometry 재생성)
  | 'smoothNormals'
  | 'snapRebuild'  // SnapManager.updateFromMesh
  | 'bvhRebuild'
  | 'meshRefresh'  // mesh refresh chain
  | 'drawCommand'  // bridge.drawLine / drawRect / drawCircle
  | 'wasmCall'     // 단일 WASM 호출 (boundary)
  // ── syncMesh sub-steps (Sprint 2 §2 분해 측정) ──
  | 'syncMesh.bridgeQueries'  // getEdgeLines + getEdgeMap + getDelta + getBuffers
  | 'syncMesh.deltaApply'     // viewport.applyDelta
  | 'syncMesh.fullUpdate'     // viewport.updateMesh full path
  | 'syncMesh.selection'      // selection.updateBuffers + updateEdgeBuffers
  | 'syncMesh.snapSchedule'   // scheduleSnapRefresh enqueue (≠ rebuild)
  // ── syncMesh sub-steps (Sprint 3 추가 측정) ──
  | 'syncMesh.stats'          // viewport.setStats (DOM update)
  // syncMesh.shadow removed 2026-05-16 (shadow system → ADR-106)
  // ── viewport.updateMesh 내부 분해 (Sprint 4 §3) ──
  | 'updateMesh.dispose'      // 이전 mesh dispose
  | 'updateMesh.geometry'     // BufferGeometry + setAttribute
  | 'updateMesh.material'     // material 생성/조회
  | 'updateMesh.edges'        // edge LineSegments2 빌드
  // ── Picking router (ADR-012 §4) ──
  | 'picking.face'
  | 'picking.edge'
  | 'picking.snap'
  // ── ADR-146 β-2 — SnapManager.findSnap direct latency (Q2=a) ──
  // PickingRouter wrap 외 findSnap 진입~출구 직접 측정. Hover 16ms budget
  // 의 sub-component 관찰성 (메타-원칙 #11 정합).
  | 'findSnap';

/** ADR-012 §3 — frame 당 WASM crossing 상한.
 *   "1 Command = 1 입력 + 1 mesh 결과 = 2회" 가 ideal,
 *   syncMesh 의 buffer 조회 등이 추가되어도 4회 안.
 *   초과 시 BatchCommand 도입 또는 query 통합 신호. */
export const CROSSING_PER_FRAME_LIMIT = 4;

/** ADR-012 §1 - 단계별 latency budget (ms). */
export const BUDGETS: Record<BudgetKey, number> = {
  hover: 16,         // 60fps 보장
  click: 33,         // 30fps 즉시 시각 피드백
  commit: 100,       // 체감 즉시
  heavy: 500,        // progress UI 임계
  // 내부 — 사용자 입력 budget 안에 들어가야 하므로 더 빡빡
  syncMesh: 33,
  updateMesh: 33,
  smoothNormals: 16, // 1-frame 안에 끝나야 rAF 체인 방지
  snapRebuild: 16,
  bvhRebuild: 33,
  meshRefresh: 33,
  drawCommand: 100,  // 사용자가 즉각 반응 기대하는 단위
  wasmCall: 50,      // 단일 호출은 충분히 빠르게
  // syncMesh sub-step budgets — 합쳐서 syncMesh budget(33ms) 이내가 목표.
  'syncMesh.bridgeQueries': 8,
  'syncMesh.deltaApply':    8,
  'syncMesh.fullUpdate':   16,
  'syncMesh.selection':     6,
  'syncMesh.snapSchedule':  3,
  'syncMesh.stats':         2,
  // 'syncMesh.shadow' budget removed 2026-05-16 (shadow system → ADR-106)
  // updateMesh sub-steps — 합쳐서 syncMesh.fullUpdate budget(16ms) 안.
  'updateMesh.dispose':     3,
  'updateMesh.geometry':    8,
  'updateMesh.material':    3,
  'updateMesh.edges':       3,
  // Picking — hover budget(16ms) 안에 들어가야 함.
  'picking.face': 8,
  'picking.edge': 8,
  'picking.snap': 8,
  // ADR-146 β-2 — SnapManager.findSnap 직접 측정 budget (picking.snap 동급).
  // Hover budget 16ms 의 sub-component. PickingRouter wrap 은 외부 측정,
  // findSnap entry~exit 직접 관찰성 분리 (메타-원칙 #11).
  findSnap: 8,
};

// ── Data shapes ───────────────────────────────────────────────────

export interface BudgetViolation {
  key: BudgetKey;
  elapsed: number;       // ms
  budget: number;        // ms
  ts: number;            // Date.now()
}

/** Public-facing snapshot (for window.__AXIA_TELEMETRY console use). */
export interface TelemetrySnapshot {
  /** Recent budget violations (ring buffer, newest last). */
  budgetViolations: BudgetViolation[];
  /** Average frame time over last N frames (ms). */
  avgFrameTime: number;
  /** Max frame time over last N frames (ms). */
  maxFrameTime: number;
  /** WASM crossings this frame (current). */
  crossingsThisFrame: number;
  /** Average WASM crossings per frame. */
  avgCrossingsPerFrame: number;
  /** Bytes copied across WASM↔JS this frame (snapshot 시점). */
  copyBytesThisFrame: number;
  /** Avg / Max bytes copied per frame (last 120 frames). */
  avgCopyBytesPerFrame: number;
  maxCopyBytesPerFrame: number;
  /** Largest single task observed (over violations). */
  largestTask: BudgetViolation | null;
  /** Current rAF chain depth (should always be ≤ 1). */
  rafChainDepth: number;
  /** Max rAF chain depth observed. */
  maxRafChainDepth: number;
  /** Total frames observed. */
  framesObserved: number;
  /** Total tasks measured. */
  tasksObserved: number;
}

// ── Implementation ────────────────────────────────────────────────

/**
 * Memory-bounded ring buffer (ADR-013 §2 — every collection has a cap).
 */
class RingBuffer<T> {
  private buf: T[] = [];
  constructor(private cap: number) {}
  push(v: T): void {
    this.buf.push(v);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  toArray(): T[] { return this.buf.slice(); }
  get length(): number { return this.buf.length; }
  clear(): void { this.buf.length = 0; }
}

class TelemetryCore {
  // Bounded collections (ADR-013 §2)
  private violations = new RingBuffer<BudgetViolation>(1000);
  private frameTimings = new RingBuffer<number>(120);   // ~2 sec @ 60fps
  private crossingsHistory = new RingBuffer<number>(120);

  // Per-frame state
  private currentFrameStart = 0;
  private crossingsThisFrame = 0;
  private copyBytesThisFrame = 0;
  // Rolling history for copy bytes (last N frames).
  private copyBytesHistory = new RingBuffer<number>(120);

  // Rolling stats
  private rafChainDepth = 0;
  private maxRafChainDepth = 0;
  private largestTask: BudgetViolation | null = null;
  private tasksObserved = 0;
  private framesObserved = 0;

  /** Time `fn` and record under `key`. Returns fn's return value. */
  measure<T>(key: BudgetKey, fn: () => T): T {
    const t0 = performance.now();
    let result: T;
    try {
      result = fn();
    } finally {
      this.record(key, performance.now() - t0);
    }
    return result;
  }

  /** Async variant — `fn` is awaited before recording. */
  async measureAsync<T>(key: BudgetKey, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.record(key, performance.now() - t0);
    }
  }

  /** Manual record. `elapsed` is ms. */
  record(key: BudgetKey, elapsed: number): void {
    this.tasksObserved++;
    const budget = BUDGETS[key];
    if (elapsed > budget) {
      const v: BudgetViolation = { key, elapsed, budget, ts: Date.now() };
      this.violations.push(v);
      if (!this.largestTask || elapsed > this.largestTask.elapsed) {
        this.largestTask = { ...v };
      }
    }
  }

  /** WASM ↔ JS crossing. Bridge calls this once per JS→Rust call. */
  recordCrossing(): void {
    this.crossingsThisFrame++;
  }

  /** Bytes copied across the WASM↔JS boundary this frame (ADR-013 §4).
   *  Bridges call this with the byte size of each Vec<T> result they
   *  receive from Rust (which wasm-bindgen materialises as a TypedArray
   *  copy by default). Monitoring this lets us decide when to migrate
   *  hot paths to zero-copy memory views. */
  recordCopyBytes(bytes: number): void {
    if (bytes > 0) this.copyBytesThisFrame += bytes;
  }

  /** Enter rAF callback — increments chain depth (should never go > 1). */
  enterRaf(): void {
    this.rafChainDepth++;
    if (this.rafChainDepth > this.maxRafChainDepth) {
      this.maxRafChainDepth = this.rafChainDepth;
    }
  }
  exitRaf(): void {
    this.rafChainDepth = Math.max(0, this.rafChainDepth - 1);
  }

  /** Mark the start of a frame (typical: top of render loop). */
  startFrame(): void {
    this.currentFrameStart = performance.now();
  }

  /** Mark end of frame; records frame timing + resets per-frame counters.
   *  ADR-012 §3 — `crossingsPerFrame > 4` 면 경고 violation 으로 기록
   *  ('wasmCall' key 차용 — frame 단위 누적 위반은 단일 record). */
  endFrame(): void {
    const elapsed = performance.now() - this.currentFrameStart;
    this.frameTimings.push(elapsed);
    this.crossingsHistory.push(this.crossingsThisFrame);
    this.copyBytesHistory.push(this.copyBytesThisFrame);
    this.copyBytesThisFrame = 0;
    if (this.crossingsThisFrame > CROSSING_PER_FRAME_LIMIT) {
      // wasmCall budget(50ms) 자리에 frame 단위 crossing 초과를 기록.
      // budget 비교는 BUDGETS['wasmCall'] 와 무관하지만 violation 분류
      // 용 key 로 사용. elapsed 자리에 crossings 수 (ms 가 아님).
      const v: BudgetViolation = {
        key: 'wasmCall',
        elapsed: this.crossingsThisFrame,
        budget: CROSSING_PER_FRAME_LIMIT,
        ts: Date.now(),
      };
      this.violations.push(v);
    }
    this.crossingsThisFrame = 0;
    this.framesObserved++;
  }

  /** Public snapshot — used by `window.__AXIA_TELEMETRY` getter. */
  snapshot(): TelemetrySnapshot {
    const ft = this.frameTimings.toArray();
    const ch = this.crossingsHistory.toArray();
    const cb = this.copyBytesHistory.toArray();
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
    const max = (a: number[]) => a.length === 0 ? 0 : Math.max(...a);
    return {
      budgetViolations: this.violations.toArray(),
      avgFrameTime: ft.length === 0 ? 0 : +(sum(ft) / ft.length).toFixed(2),
      maxFrameTime: +max(ft).toFixed(2),
      crossingsThisFrame: this.crossingsThisFrame,
      avgCrossingsPerFrame: ch.length === 0 ? 0 :
        +(sum(ch) / ch.length).toFixed(2),
      copyBytesThisFrame: this.copyBytesThisFrame,
      avgCopyBytesPerFrame: cb.length === 0 ? 0 :
        Math.round(sum(cb) / cb.length),
      maxCopyBytesPerFrame: max(cb),
      largestTask: this.largestTask ? { ...this.largestTask } : null,
      rafChainDepth: this.rafChainDepth,
      maxRafChainDepth: this.maxRafChainDepth,
      framesObserved: this.framesObserved,
      tasksObserved: this.tasksObserved,
    };
  }

  /** Test/dev — reset all counters. */
  reset(): void {
    this.violations.clear();
    this.frameTimings.clear();
    this.crossingsHistory.clear();
    this.copyBytesHistory.clear();
    this.currentFrameStart = 0;
    this.crossingsThisFrame = 0;
    this.copyBytesThisFrame = 0;
    this.rafChainDepth = 0;
    this.maxRafChainDepth = 0;
    this.largestTask = null;
    this.tasksObserved = 0;
    this.framesObserved = 0;
  }

  /** Filter violations by key (handy for triage). */
  violationsByKey(key: BudgetKey): BudgetViolation[] {
    return this.violations.toArray().filter(v => v.key === key);
  }
}

// ── Singleton + window exposure ──────────────────────────────────

const _t = new TelemetryCore();
export const telemetry = _t;

declare global {
  interface Window {
    __AXIA_TELEMETRY?: TelemetrySnapshot;
    __AXIA_TELEMETRY_RESET?: () => void;
    /** Hot-path counter increment — called by WasmBridge.markDirty().
     *  Defined as a plain function (not method) for minimal lookup cost. */
    __AXIA_TELEMETRY_TICK?: () => void;
    /** Frame boundaries — Viewport's render loop calls these. */
    __AXIA_TELEMETRY_FRAME_START?: () => void;
    __AXIA_TELEMETRY_FRAME_END?: () => void;
    /** Generic record hook — modules without telemetry import call this. */
    __AXIA_TELEMETRY_RECORD?: (key: string, ms: number) => void;
    /** Copy-bytes hook — WasmBridge calls this with byte size of each
     *  Vec<T> result it materialises as a JS TypedArray. */
    __AXIA_TELEMETRY_COPY?: (bytes: number) => void;
  }
}

/**
 * Install `window.__AXIA_TELEMETRY` (live getter — recomputes on access)
 * + `window.__AXIA_TELEMETRY_RESET()`. Always installs the property so
 * users can flip __AXIA_DEBUG at runtime. Cost is zero when not accessed.
 */
export function installTelemetryGlobal(): void {
  if (typeof window === 'undefined') return;
  // Use accessor so each console read shows the current snapshot.
  Object.defineProperty(window, '__AXIA_TELEMETRY', {
    configurable: true,
    get: () => {
      // Cheap — only show when DEBUG flag set, otherwise hint.
      if (!isDebug()) {
        return {
          hint: 'window.__AXIA_DEBUG = true 후 다시 확인하세요.',
          ...telemetry.snapshot(),
        } as unknown as TelemetrySnapshot;
      }
      return telemetry.snapshot();
    },
  });
  (window as Window).__AXIA_TELEMETRY_RESET = () => telemetry.reset();
  // Hot-path tick — bound here once so WasmBridge can increment without
  // pulling the whole telemetry module into its dependency cycle.
  (window as Window).__AXIA_TELEMETRY_TICK = () => telemetry.recordCrossing();
  (window as Window).__AXIA_TELEMETRY_FRAME_START = () => telemetry.startFrame();
  (window as Window).__AXIA_TELEMETRY_FRAME_END   = () => telemetry.endFrame();
  (window as Window).__AXIA_TELEMETRY_RECORD = (key: string, ms: number) => {
    // Validate key against known budgets; unknown keys silently ignored
    // so dev-time string mismatches don't crash production.
    if ((BUDGETS as Record<string, number>)[key] !== undefined) {
      telemetry.record(key as BudgetKey, ms);
    }
  };
  (window as Window).__AXIA_TELEMETRY_COPY = (bytes: number) => telemetry.recordCopyBytes(bytes);
}
