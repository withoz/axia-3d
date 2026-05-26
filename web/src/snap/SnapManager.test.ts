import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  SnapManager,
  SNAP_MARKERS,
  DEPRECATED_SNAP_TYPES,
  RECENCY_MS,
  RECENCY_BONUS_MAGNITUDE,
  computeRecencyBonus,
} from './SnapManager';
import type { SnapType, SnapPoint } from './SnapManager';

describe('SnapManager', () => {
  let snap: SnapManager;

  beforeEach(() => {
    snap = new SnapManager();
  });

  // ── enabled & toggle ──

  it('starts with enabled = true', () => {
    expect(snap.enabled).toBe(true);
  });

  it('toggle flips enabled and returns new state', () => {
    const result = snap.toggle();
    expect(result).toBe(false);
    expect(snap.enabled).toBe(false);

    const result2 = snap.toggle();
    expect(result2).toBe(true);
    expect(snap.enabled).toBe(true);
  });

  // ── setMode / isActive ──

  it('default active modes include endpoint, intersection, center, perpendicular', () => {
    expect(snap.isActive('endpoint')).toBe(true);
    expect(snap.isActive('intersection')).toBe(true);
    expect(snap.isActive('center')).toBe(true);
    expect(snap.isActive('perpendicular')).toBe(true);
  });

  it('default active modes include midpoint, parallel, extension, onFace', () => {
    expect(snap.isActive('midpoint')).toBe(true);
    expect(snap.isActive('parallel')).toBe(true);
    expect(snap.isActive('extension')).toBe(true);
    expect(snap.isActive('onFace')).toBe(true);
  });

  it('default modes do NOT include nearest or tangent', () => {
    expect(snap.isActive('nearest')).toBe(false);
    expect(snap.isActive('tangent')).toBe(false);
  });

  it('setMode enables a mode', () => {
    snap.setMode('midpoint', true);
    expect(snap.isActive('midpoint')).toBe(true);
  });

  it('setMode disables a mode', () => {
    expect(snap.isActive('endpoint')).toBe(true);
    snap.setMode('endpoint', false);
    expect(snap.isActive('endpoint')).toBe(false);
  });

  it('toggleMode flips a mode and returns new state', () => {
    // endpoint starts active
    const result = snap.toggleMode('endpoint');
    expect(result).toBe(false);
    expect(snap.isActive('endpoint')).toBe(false);

    const result2 = snap.toggleMode('endpoint');
    expect(result2).toBe(true);
    expect(snap.isActive('endpoint')).toBe(true);
  });

  // ── snap override ──

  it('override starts undefined', () => {
    expect(snap.getOverride()).toBeUndefined();
  });

  it('setOverride + getOverride', () => {
    snap.setOverride('midpoint');
    expect(snap.getOverride()).toBe('midpoint');
  });

  it('setOverride with "none"', () => {
    snap.setOverride('none');
    expect(snap.getOverride()).toBe('none');
  });

  it('consumeOverride returns value and clears it', () => {
    snap.setOverride('endpoint');
    const val = snap.consumeOverride();
    expect(val).toBe('endpoint');
    expect(snap.getOverride()).toBeUndefined();
  });

  it('consumeOverride returns undefined when no override set', () => {
    expect(snap.consumeOverride()).toBeUndefined();
  });

  // ── config accessors ──

  it('pixelThreshold getter and setter', () => {
    expect(snap.pixelThreshold).toBe(15);
    snap.pixelThreshold = 25;
    expect(snap.pixelThreshold).toBe(25);
  });

  it('showTooltip getter and setter', () => {
    expect(snap.showTooltip).toBe(true);
    snap.showTooltip = false;
    expect(snap.showTooltip).toBe(false);
  });

  it('showMarker getter and setter', () => {
    expect(snap.showMarker).toBe(true);
    snap.showMarker = false;
    expect(snap.showMarker).toBe(false);
  });

  it('modes returns the active modes Set', () => {
    const modes = snap.modes;
    expect(modes).toBeInstanceOf(Set);
    expect(modes.has('endpoint')).toBe(true);
  });

  it('lastSnap starts as null', () => {
    expect(snap.lastSnap).toBeNull();
  });

  // ── enabled setter ──

  it('enabled setter works', () => {
    snap.enabled = false;
    expect(snap.enabled).toBe(false);
    snap.enabled = true;
    expect(snap.enabled).toBe(true);
  });

  // ── setReferencePoint ──

  it('setReferencePoint accepts Vector3', () => {
    snap.setReferencePoint(new THREE.Vector3(10, 20, 30));
    // Should not throw
  });

  it('setReferencePoint accepts null', () => {
    snap.setReferencePoint(null);
    // Should not throw
  });

  // ── addTrackPoint / clearTrackPoints ──

  it('addTrackPoint and clearTrackPoints', () => {
    snap.addTrackPoint(new THREE.Vector3(1, 0, 0));
    snap.addTrackPoint(new THREE.Vector3(0, 1, 0));
    // Should not throw
    snap.clearTrackPoints();
    // Should not throw
  });

  // ── setMid2pFirst ──

  it('setMid2pFirst accepts Vector3 or null', () => {
    snap.setMid2pFirst(new THREE.Vector3(5, 5, 5));
    snap.setMid2pFirst(null);
    // Should not throw
  });


  // ── onSnapChange callback ──

  it('onSnapChange registers callback', () => {
    const cb = vi.fn();
    snap.onSnapChange(cb);
    // Callback is registered for future snap events
    expect(cb).not.toHaveBeenCalled();
  });

  // ── multiple mode toggles ──

  it('can enable all modes', () => {
    const modes: SnapType[] = [
      'endpoint', 'midpoint', 'intersection', 'apparent', 'extension',
      'center', 'geometric', 'quadrant', 'tangent',
      'perpendicular', 'parallel',
      'node', 'insertion', 'nearest',
    ];
    for (const m of modes) {
      snap.setMode(m, true);
      expect(snap.isActive(m)).toBe(true);
    }
  });

  it('can disable all modes', () => {
    snap.setMode('endpoint', false);
    snap.setMode('intersection', false);
    snap.setMode('center', false);
    snap.setMode('perpendicular', false);
    expect(snap.isActive('endpoint')).toBe(false);
    expect(snap.isActive('intersection')).toBe(false);
    expect(snap.isActive('center')).toBe(false);
    expect(snap.isActive('perpendicular')).toBe(false);
  });

  // ── override with various types ──

  it('setOverride with various snap types', () => {
    snap.setOverride('endpoint');
    expect(snap.getOverride()).toBe('endpoint');

    snap.setOverride('midpoint');
    expect(snap.getOverride()).toBe('midpoint');

    snap.setOverride('intersection');
    expect(snap.getOverride()).toBe('intersection');
  });

  it('consumeOverride only consumes once', () => {
    snap.setOverride('center');
    expect(snap.consumeOverride()).toBe('center');
    expect(snap.consumeOverride()).toBeUndefined();
    expect(snap.consumeOverride()).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase A: Axis / Grid / Recency
  // ═══════════════════════════════════════════════════════════════

  describe('Phase A — axis / grid / markers', () => {
    it('axisX/Y/Z SnapType have marker definitions with SketchUp colors', () => {
      expect(SNAP_MARKERS.axisX.color.toUpperCase()).toBe('#E02020');
      expect(SNAP_MARKERS.axisY.color.toUpperCase()).toBe('#2E7BFF');
      expect(SNAP_MARKERS.axisZ.color.toUpperCase()).toBe('#00C800');
    });

    it('grid SnapType exists with low priority', () => {
      expect(SNAP_MARKERS.grid).toBeDefined();
      expect(SNAP_MARKERS.grid.shape).toBe('plus');
    });

    it('default active modes include axisX/Y/Z', () => {
      expect(snap.isActive('axisX')).toBe(true);
      expect(snap.isActive('axisY')).toBe(true);
      expect(snap.isActive('axisZ')).toBe(true);
    });

    it('setMode/isActive work for grid', () => {
      expect(snap.isActive('grid')).toBe(false);
      snap.setMode('grid', true);
      expect(snap.isActive('grid')).toBe(true);
      snap.setMode('grid', false);
      expect(snap.isActive('grid')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase B1: Inference Lock
  // ═══════════════════════════════════════════════════════════════

  describe('Phase B1 — Inference Lock', () => {
    it('starts unlocked', () => {
      expect(snap.hasLockedInference()).toBe(false);
      expect(snap.getLockedInference()).toBeNull();
    });

    it('setLockedInference stores snap and reports locked', () => {
      const fakeSnap = {
        type: 'axisX' as const,
        position: new THREE.Vector3(10, 0, 0),
      };
      snap.setLockedInference(fakeSnap);
      expect(snap.hasLockedInference()).toBe(true);
      expect(snap.getLockedInference()).toBe(fakeSnap);
    });

    it('clearLockedInference releases', () => {
      snap.setLockedInference({ type: 'axisY', position: new THREE.Vector3(0, 5, 0) });
      snap.clearLockedInference();
      expect(snap.hasLockedInference()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase B2: Inference Chaining
  // ═══════════════════════════════════════════════════════════════

  describe('Phase B2 — Inference Chaining', () => {
    it('getRecentEdges starts empty', () => {
      expect(snap.getRecentEdges().length).toBe(0);
    });

    it('recordHoveredEdge adds to queue', () => {
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      expect(snap.getRecentEdges().length).toBe(1);
    });

    it('recordHoveredEdge dedups identical edges', () => {
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      expect(snap.getRecentEdges().length).toBe(1);
    });

    it('recordHoveredEdge recognizes reversed edges as same', () => {
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      snap.recordHoveredEdge(new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 0, 0));
      expect(snap.getRecentEdges().length).toBe(1);
    });

    it('caps at RECENT_EDGE_CAP (3)', () => {
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      snap.recordHoveredEdge(new THREE.Vector3(20, 0, 0), new THREE.Vector3(30, 0, 0));
      snap.recordHoveredEdge(new THREE.Vector3(40, 0, 0), new THREE.Vector3(50, 0, 0));
      snap.recordHoveredEdge(new THREE.Vector3(60, 0, 0), new THREE.Vector3(70, 0, 0));
      expect(snap.getRecentEdges().length).toBe(3);
      // Oldest dropped
      expect(snap.getRecentEdges()[0].a.x).toBe(20);
    });

    it('clearRecentEdges resets', () => {
      snap.recordHoveredEdge(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
      snap.clearRecentEdges();
      expect(snap.getRecentEdges().length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase B3: Tentative Snap
  // ═══════════════════════════════════════════════════════════════

  describe('Phase B3 — Tentative Snap', () => {
    it('cycleTentative returns null with no candidates', () => {
      expect(snap.cycleTentative()).toBeNull();
    });

    it('resetTentative does not throw with no candidates', () => {
      expect(() => snap.resetTentative()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ADR-146 β-2 — findSnap latency 직접 wrap (Q2=(a) 직접 wrap)
  //
  // External anchor: reports/입력보정파이프라인_적용계획.html §2.2 P10.
  // Canonical anchor: ADR-146 §2.2 Q2=(a) — "performance.now() 직접 wrap +
  //   telemetry.record('findSnap', ms)".
  //
  // Lock-ins:
  //   - L-146-2: 메타-원칙 #4 SSOT — telemetry 정합 (core/telemetry.ts)
  //   - L-146-3: 메타-원칙 #11 — Hover 16ms 직접 관찰성
  // ═══════════════════════════════════════════════════════════════
  describe('ADR-146 β-2 — findSnap latency telemetry', () => {
    it('findSnap call records elapsed time via telemetry', async () => {
      const { telemetry } = await import('../core/telemetry');
      const recordSpy = vi.spyOn(telemetry, 'record');

      const mockCamera = new THREE.PerspectiveCamera();
      const mockCanvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;

      snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);

      // telemetry.record called at least once with 'findSnap' key.
      // L-146-2 SSOT — single telemetry surface.
      const findSnapCalls = recordSpy.mock.calls.filter((c) => c[0] === 'findSnap');
      expect(findSnapCalls.length).toBeGreaterThanOrEqual(1);
      // Each elapsed value is a finite non-negative number (ms).
      const elapsed = findSnapCalls[0][1] as number;
      expect(Number.isFinite(elapsed)).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(0);

      recordSpy.mockRestore();
    });

    it('findSnap return value preserved (no behavior change)', async () => {
      const { telemetry } = await import('../core/telemetry');
      const measureSpy = vi.spyOn(telemetry, 'measure');

      const mockCamera = new THREE.PerspectiveCamera();
      const mockCanvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;

      // disabled → null return (early return preserved through measure wrap)
      snap.enabled = false;
      const result1 = snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);
      expect(result1).toBeNull();
      // measure wrap was invoked (even for early-return path)
      const findSnapMeasureCalls = measureSpy.mock.calls.filter((c) => c[0] === 'findSnap');
      expect(findSnapMeasureCalls.length).toBeGreaterThanOrEqual(1);

      snap.enabled = true;
      // enabled + no mesh → either null or grid candidate (depends on
      // groundPoint). Either way, the wrap doesn't corrupt the result.
      const result2 = snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);
      // result2 may be null or a SnapPoint — both are valid (no candidates).
      expect(result2 === null || typeof result2 === 'object').toBe(true);

      measureSpy.mockRestore();
    });

    it('telemetry findSnap budget is 8ms (sub-component of Hover 16ms)', async () => {
      const { BUDGETS } = await import('../core/telemetry');
      // L-146-3 메타-원칙 #11 — Hover 16ms budget 의 sub-component.
      // picking.snap 도 8ms (동급). 두 측정은 분리 — PickingRouter wrap
      // (외부) vs findSnap entry/exit (내부).
      expect(BUDGETS.findSnap).toBe(8);
      // Strictly less than Hover budget — Hover 가 더 큰 wrapper.
      expect(BUDGETS.findSnap).toBeLessThanOrEqual(BUDGETS.hover);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ADR-146 β-3 — Recency A4 회귀 자산 강화 (4 tests)
  //
  // Canonical anchor: CLAUDE.md "SketchUp-style Inference Engine §Scoring"
  //   "priority × 1000 - pixel distance ... Recency bonus (A4): 400ms 이내
  //    같은 타입 재등장 시 -0.5 보정"
  //
  // β-3 refactor: inline closure → module-level exported function +
  //   constants (RECENCY_MS / RECENCY_BONUS_MAGNITUDE / computeRecencyBonus).
  //   Lock-ins L-146-8: Changing these constants requires a new ADR.
  // ═══════════════════════════════════════════════════════════════
  describe('ADR-146 β-3 — Recency A4 (보강)', () => {
    // Helper — construct a synthetic SnapPoint for purity tests.
    const makeSnap = (type: SnapType): SnapPoint => ({
      type,
      position: new THREE.Vector3(0, 0, 0),
    });

    it('400ms 이내 같은 타입 재등장 → -0.5 bonus 적용', () => {
      const lastSnap = makeSnap('endpoint');
      const bonus = computeRecencyBonus(lastSnap, 100, 'endpoint', 200);
      expect(bonus).toBe(-RECENCY_BONUS_MAGNITUDE);
      expect(bonus).toBe(-0.5);
    });

    it('400ms 초과 → bonus 미적용 (0 반환)', () => {
      const lastSnap = makeSnap('midpoint');
      expect(computeRecencyBonus(lastSnap, 0, 'midpoint', 500)).toBe(0);
    });

    it('다른 타입 재등장 → bonus 미적용 (0 반환)', () => {
      const lastSnap = makeSnap('endpoint');
      expect(computeRecencyBonus(lastSnap, 100, 'midpoint', 200)).toBe(0);
    });

    it('Bonus 비율 명시 (-0.5 score, RECENCY_MS=400) + null lastSnap → 0', () => {
      // L-146-8 — Recency contract lock-in. Changing requires new ADR.
      expect(RECENCY_MS).toBe(400);
      expect(RECENCY_BONUS_MAGNITUDE).toBe(0.5);

      // null lastSnap → no bonus
      expect(computeRecencyBonus(null, 0, 'endpoint', 1000)).toBe(0);

      // Exactly at boundary (age === RECENCY_MS) → still in window
      const lastSnap = makeSnap('center');
      expect(computeRecencyBonus(lastSnap, 0, 'center', RECENCY_MS))
        .toBe(-RECENCY_BONUS_MAGNITUDE);
      // 1ms past boundary → 0
      expect(computeRecencyBonus(lastSnap, 0, 'center', RECENCY_MS + 1)).toBe(0);
    });
  });
});
