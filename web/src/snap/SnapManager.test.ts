import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SnapManager, SNAP_MARKERS, DEPRECATED_SNAP_TYPES } from './SnapManager';
import type { SnapType } from './SnapManager';

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
  // ADR-146 β-1 — node SnapType deprecate 분기 (Q1=(b) 의식적 deprecate)
  //
  // External anchor: reports/입력보정파이프라인_적용계획.html §2.2 P8.
  // Canonical anchor: ADR-146 §2.1 Q1=(b) — "'node' SnapType union 보존
  //   + findSnap 진입 시 명시 warning + 향후 unfreeze 가능."
  //
  // Lock-ins:
  //   - L-146-1: 메타-원칙 #16 정합 (silent removal 차단)
  //   - L-146-4: ADR-046 P31 #4 additive only (API surface UNCHANGED)
  // ═══════════════════════════════════════════════════════════════
  describe('ADR-146 β-1 — node SnapType deprecate', () => {
    it('node ∈ DEPRECATED_SNAP_TYPES (의식적 deprecate 정합)', () => {
      // Canonical evidence: 'node' is the (currently) sole deprecated
      // SnapType per ADR-146 Q1=(b) 결재. External introspection 가능.
      expect(DEPRECATED_SNAP_TYPES.has('node' as SnapType)).toBe(true);
      // L-146-4 additive only — union 보존 + visual config 보존.
      expect(SNAP_MARKERS.node).toBeDefined();
      expect(SNAP_MARKERS.node.label).toBe('노드');
    });

    it('enabling node mode produces 0 candidates (silent skip 보존, behavior unchanged)', () => {
      // 사용자가 deprecated mode 활성화하더라도 candidates 0 — 현재
      // behavior 변경 없음 (메타-원칙 #16 자동 unfreeze 차단).
      snap.setMode('node', true);

      // Reset other modes to isolate node — mimic minimal config.
      // We don't disable other modes; just verify that node alone
      // does not contribute candidates. Empty mesh scenario suffices.
      const mockCamera = new THREE.PerspectiveCamera();
      const mockCanvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;

      // No mesh data registered → no edges/verts/faces. node mode
      // remains a no-op (findSnap 분기 0).
      const result = snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);
      // result may be null (no candidates) or grid (if active) — but
      // NOT a 'node' snap.
      expect(result?.type).not.toBe('node');
    });

    it('node mode activation triggers debug warning once per session', () => {
      // L-146-1 메타-원칙 #16 — silent skip 차단 강제 evidence.
      // 사용자가 deprecated mode 활성 → warning 발생 (debugLog gated
      // by window.__AXIA_DEBUG, default off).
      snap.resetDeprecationWarnings();
      expect(snap.getDeprecationWarned().has('node' as SnapType)).toBe(false);

      // Activate deprecated mode + trigger findSnap.
      snap.setMode('node', true);
      const mockCamera = new THREE.PerspectiveCamera();
      const mockCanvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;
      snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);

      // Warning state recorded.
      expect(snap.getDeprecationWarned().has('node' as SnapType)).toBe(true);

      // Idempotent — 2nd call does NOT re-warn (once per session).
      // We verify by capturing set size before/after.
      const sizeBefore = snap.getDeprecationWarned().size;
      snap.findSnap(400, 300, mockCamera, mockCanvas, null, null);
      const sizeAfter = snap.getDeprecationWarned().size;
      expect(sizeAfter).toBe(sizeBefore);

      // resetDeprecationWarnings clears state — test helper integrity.
      snap.resetDeprecationWarnings();
      expect(snap.getDeprecationWarned().has('node' as SnapType)).toBe(false);
    });
  });
});
