import { describe, it, expect, vi } from 'vitest';
import { LodTracker, decideLod, LOD_THRESHOLDS, type LodSignal } from './lod';

const sig = (over: Partial<LodSignal>): LodSignal => ({
  screenAreaPx2: 1000,
  distance: 1000,
  isFrustumIn: true,
  isActive: false,
  ...over,
});

describe('decideLod — ADR-013 §5 결정 함수', () => {
  it('frustum 외부 → LOD 3', () => {
    expect(decideLod(sig({ isFrustumIn: false }))).toBe(3);
  });

  it('활성 객체는 항상 LOD 0', () => {
    // far + small + frustum 외부 except isFrustumIn=true
    expect(decideLod(sig({ isActive: true, screenAreaPx2: 1, distance: 99999999 }))).toBe(0);
  });

  it('큰 화면 영역 → LOD 0', () => {
    expect(decideLod(sig({ screenAreaPx2: LOD_THRESHOLDS.fullArea + 1 }))).toBe(0);
  });

  it('중간 영역 → LOD 1', () => {
    expect(decideLod(sig({ screenAreaPx2: 50 }))).toBe(1);
  });

  it('작은 영역 → LOD 2', () => {
    expect(decideLod(sig({ screenAreaPx2: 2 }))).toBe(2);
  });

  it('너무 멀면 LOD 2 (frustum 안이어도)', () => {
    expect(decideLod(sig({ distance: LOD_THRESHOLDS.farDistance + 1 }))).toBe(2);
  });
});

describe('LodTracker', () => {
  it('update returns level + remembers it', () => {
    const t = new LodTracker();
    expect(t.update(1, sig({ screenAreaPx2: 200 }))).toBe(0);
    expect(t.get(1)).toBe(0);
    expect(t.update(1, sig({ screenAreaPx2: 50 }))).toBe(1);
    expect(t.get(1)).toBe(1);
  });

  it('onChange fires only on level change', () => {
    const t = new LodTracker();
    const cb = vi.fn();
    t.onChange(cb);
    // First update sets initial level — no fire (no prev)
    t.update(1, sig({ screenAreaPx2: 200 })); // 0
    expect(cb).not.toHaveBeenCalled();
    // Same level → no fire
    t.update(1, sig({ screenAreaPx2: 150 })); // still 0
    expect(cb).not.toHaveBeenCalled();
    // Change → fire with prev=0 next=1
    t.update(1, sig({ screenAreaPx2: 50 }));  // 1
    expect(cb).toHaveBeenCalledWith(1, 0, 1);
  });

  it('updateMany returns count of changed', () => {
    const t = new LodTracker();
    t.update(1, sig({ screenAreaPx2: 200 }));   // 0
    t.update(2, sig({ screenAreaPx2: 50 }));    // 1
    const m = new Map<number, LodSignal>([
      [1, sig({ screenAreaPx2: 150 })],   // 0 → 0 (no change)
      [2, sig({ screenAreaPx2: 1 })],     // 1 → 2 (changed)
    ]);
    const changed = t.updateMany(m);
    expect(changed).toBe(1);
    expect(t.get(2)).toBe(2);
  });

  it('reset clears tracker', () => {
    const t = new LodTracker();
    t.update(1, sig({}));
    t.reset();
    expect(t.size()).toBe(0);
  });

  it('snapshot returns a copy', () => {
    const t = new LodTracker();
    t.update(1, sig({ screenAreaPx2: 50 }));
    const s = t.snapshot();
    s.set(99, 0);
    expect(t.get(99)).toBe(0); // tracker default
    expect(t.size()).toBe(1);
  });

  it('unsubscribe stops callbacks', () => {
    const t = new LodTracker();
    const cb = vi.fn();
    const off = t.onChange(cb);
    t.update(1, sig({ screenAreaPx2: 200 }));
    t.update(1, sig({ screenAreaPx2: 50 }));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    t.update(1, sig({ screenAreaPx2: 1 }));
    expect(cb).toHaveBeenCalledTimes(1); // no new call
  });
});
