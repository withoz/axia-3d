/**
 * Tests for UnitSystem — unit conversion, formatting, parsing, snap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnitSystem } from './UnitSystem';

// Mock localStorage (jsdom provides it, but ensure clean state)
beforeEach(() => {
  localStorage.clear();
});

describe('UnitSystem', () => {
  let units: UnitSystem;

  beforeEach(() => {
    units = new UnitSystem();
  });

  describe('defaults', () => {
    it('uses mm as default unit', () => {
      expect(units.unit).toBe('mm');
    });

    it('uses precision 4 by default', () => {
      expect(units.precision).toBe(4);
    });

    it('has grid snap enabled by default', () => {
      expect(units.gridSnap).toBe(true);
    });

    it('has snap interval 1mm by default', () => {
      expect(units.snapInterval).toBe(1);
    });
  });

  describe('fromInternal() / toInternal()', () => {
    it('mm → mm is identity', () => {
      expect(units.fromInternal(100)).toBe(100);
      expect(units.toInternal(100)).toBe(100);
    });

    it('mm → cm conversion', () => {
      units.unit = 'cm';
      expect(units.fromInternal(100)).toBeCloseTo(10); // 100mm = 10cm
      expect(units.toInternal(10)).toBeCloseTo(100);   // 10cm = 100mm
    });

    it('mm → m conversion', () => {
      units.unit = 'm';
      expect(units.fromInternal(1000)).toBeCloseTo(1);  // 1000mm = 1m
      expect(units.toInternal(1)).toBeCloseTo(1000);
    });

    it('mm → inch conversion', () => {
      units.unit = 'in';
      expect(units.fromInternal(25.4)).toBeCloseTo(1);  // 25.4mm = 1in
      expect(units.toInternal(1)).toBeCloseTo(25.4);
    });

    it('mm → feet conversion', () => {
      units.unit = 'ft';
      expect(units.fromInternal(304.8)).toBeCloseTo(1); // 304.8mm = 1ft
      expect(units.toInternal(1)).toBeCloseTo(304.8);
    });
  });

  describe('format()', () => {
    it('formats with unit suffix', () => {
      const result = units.format(123.456789);
      expect(result).toBe('123.4568 mm');
    });

    it('formats without unit suffix', () => {
      const result = units.format(123.456789, false);
      expect(result).toBe('123.4568');
    });

    it('respects precision', () => {
      units.precision = 2;
      expect(units.format(123.456789)).toBe('123.46 mm');
    });

    it('formats in different units', () => {
      units.unit = 'cm';
      expect(units.format(100)).toBe('10.0000 cm');
    });

    it('inserts thousand separators (regression: 2026-04-27)', () => {
      // 1,234.5678 mm — 정수부에만 콤마, 소수부 그대로.
      expect(units.format(1234.5678)).toBe('1,234.5678 mm');
      expect(units.format(1234567.89, false)).toBe('1,234,567.8900');
      expect(units.format(-9876.54, false)).toBe('-9,876.5400');
    });
  });

  describe('snap()', () => {
    it('snaps to nearest interval', () => {
      expect(units.snap(1.3)).toBe(1);
      expect(units.snap(1.7)).toBe(2);
      expect(units.snap(2.5)).toBe(3); // rounds up
    });

    it('returns original value when snap disabled', () => {
      units.gridSnap = false;
      expect(units.snap(1.3)).toBe(1.3);
    });

    it('snaps with custom interval', () => {
      units.snapInterval = 5;
      expect(units.snap(7)).toBe(5);
      expect(units.snap(8)).toBe(10);
    });
  });

  describe('parseInput()', () => {
    it('parses plain number as current unit', () => {
      // Default unit is mm
      expect(units.parseInput('100')).toBe(100);
    });

    it('parses number with mm suffix', () => {
      expect(units.parseInput('50mm')).toBe(50);
    });

    it('parses number with cm suffix', () => {
      expect(units.parseInput('10cm')).toBeCloseTo(100); // 10cm = 100mm
    });

    it('parses number with m suffix', () => {
      expect(units.parseInput('1m')).toBeCloseTo(1000); // 1m = 1000mm
    });

    it('parses number with in suffix', () => {
      expect(units.parseInput('1in')).toBeCloseTo(25.4);
    });

    it('parses number with ft suffix', () => {
      expect(units.parseInput('1ft')).toBeCloseTo(304.8);
    });

    it('returns null for invalid input', () => {
      expect(units.parseInput('abc')).toBeNull();
      expect(units.parseInput('')).toBeNull();
    });

    it('handles whitespace', () => {
      expect(units.parseInput('  100  ')).toBe(100);
      expect(units.parseInput(' 10 cm ')).toBeCloseTo(100);
    });

    it('when current unit is cm, plain number is cm', () => {
      units.unit = 'cm';
      expect(units.parseInput('10')).toBeCloseTo(100); // 10cm = 100mm
    });
  });

  describe('precision clamping', () => {
    it('clamps precision to 0-8 range', () => {
      units.precision = -5;
      expect(units.precision).toBe(0);

      units.precision = 100;
      expect(units.precision).toBe(8);
    });

    it('rounds fractional precision', () => {
      units.precision = 3.7;
      expect(units.precision).toBe(4);
    });
  });

  describe('snapInterval minimum', () => {
    it('enforces minimum of 0.0001', () => {
      units.snapInterval = 0;
      expect(units.snapInterval).toBe(0.0001);

      units.snapInterval = -1;
      expect(units.snapInterval).toBe(0.0001);
    });
  });

  describe('onChange listener', () => {
    it('fires when unit changes', () => {
      const listener = vi.fn();
      units.onChange(listener);
      units.unit = 'cm';
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not fire when set to same unit', () => {
      const listener = vi.fn();
      units.onChange(listener);
      units.unit = 'mm'; // same as default
      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribes correctly', () => {
      const listener = vi.fn();
      const unsub = units.onChange(listener);
      unsub();
      units.unit = 'cm';
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('localStorage persistence', () => {
    it('saves unit to localStorage', () => {
      units.unit = 'cm';
      const stored = JSON.parse(localStorage.getItem('axia3d-units')!);
      expect(stored.unit).toBe('cm');
    });

    it('restores unit from localStorage', () => {
      localStorage.setItem('axia3d-units', JSON.stringify({
        unit: 'in', precision: 2, gridSnap: false, snapInterval: 5,
      }));
      const restored = new UnitSystem();
      expect(restored.unit).toBe('in');
      expect(restored.precision).toBe(2);
      expect(restored.gridSnap).toBe(false);
      expect(restored.snapInterval).toBe(5);
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('axia3d-units', 'not valid json');
      const restored = new UnitSystem();
      expect(restored.unit).toBe('mm'); // falls back to default
    });
  });

  describe('allUnits static', () => {
    it('returns all 5 unit configs', () => {
      const all = UnitSystem.allUnits;
      expect(all).toHaveLength(5);
      expect(all.map(u => u.type)).toEqual(['mm', 'cm', 'm', 'in', 'ft']);
    });
  });
});
