import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SnapManager } from './SnapManager';
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

  it('default modes do NOT include midpoint or nearest', () => {
    expect(snap.isActive('midpoint')).toBe(false);
    expect(snap.isActive('nearest')).toBe(false);
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
    const { Vector3 } = require('three');
    snap.setReferencePoint(new Vector3(10, 20, 30));
    // Should not throw
  });

  it('setReferencePoint accepts null', () => {
    snap.setReferencePoint(null);
    // Should not throw
  });

  // ── addTrackPoint / clearTrackPoints ──

  it('addTrackPoint and clearTrackPoints', () => {
    const { Vector3 } = require('three');
    snap.addTrackPoint(new Vector3(1, 0, 0));
    snap.addTrackPoint(new Vector3(0, 1, 0));
    // Should not throw
    snap.clearTrackPoints();
    // Should not throw
  });

  // ── setMid2pFirst ──

  it('setMid2pFirst accepts Vector3 or null', () => {
    const { Vector3 } = require('three');
    snap.setMid2pFirst(new Vector3(5, 5, 5));
    snap.setMid2pFirst(null);
    // Should not throw
  });

  // ── setParallelRef ──

  it('setParallelRef accepts Vector3 or null', () => {
    const { Vector3 } = require('three');
    snap.setParallelRef(new Vector3(1, 0, 0));
    snap.setParallelRef(null);
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
});
