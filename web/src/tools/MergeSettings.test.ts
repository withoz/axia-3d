import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMergeTolerance,
  setMergeTolerance,
  getRespectMaterial,
  setRespectMaterial,
  groupFacesByMaterial,
  MERGE_TOL_DEFAULT,
  MERGE_TOL_MAX,
} from './MergeSettings';

describe('MergeSettings', () => {
  beforeEach(() => {
    // 각 테스트 시작 시 기본값 복원
    setMergeTolerance(MERGE_TOL_DEFAULT);
    setRespectMaterial(false);
  });

  describe('tolerance', () => {
    it('starts at default 0.5°', () => {
      expect(getMergeTolerance()).toBe(0.5);
    });

    it('setMergeTolerance clamps negative to 0', () => {
      setMergeTolerance(-1);
      expect(getMergeTolerance()).toBe(0);
    });

    it('setMergeTolerance clamps above MAX to MAX', () => {
      setMergeTolerance(99);
      expect(getMergeTolerance()).toBe(MERGE_TOL_MAX);
    });

    it('setMergeTolerance ignores NaN', () => {
      setMergeTolerance(2);
      setMergeTolerance(NaN);
      expect(getMergeTolerance()).toBe(2);
    });
  });

  describe('respectMaterial', () => {
    it('starts false', () => {
      expect(getRespectMaterial()).toBe(false);
    });

    it('toggles', () => {
      setRespectMaterial(true);
      expect(getRespectMaterial()).toBe(true);
      setRespectMaterial(false);
      expect(getRespectMaterial()).toBe(false);
    });
  });

  describe('groupFacesByMaterial', () => {
    it('groups faces by material key', () => {
      const matMap = new Map<number, string>([
        [10, 'steel'], [11, 'steel'], [12, 'concrete'], [13, 'concrete'], [14, 'steel'],
      ]);
      const groups = groupFacesByMaterial(
        [10, 11, 12, 13, 14],
        (id) => matMap.get(id),
      );
      expect(groups.size).toBe(2);
      expect(groups.get('steel')).toEqual([10, 11, 14]);
      expect(groups.get('concrete')).toEqual([12, 13]);
    });

    it('uses _default_ key for faces without material', () => {
      const groups = groupFacesByMaterial(
        [1, 2, 3],
        (id) => (id === 2 ? 'wood' : undefined),
      );
      expect(groups.get('_default_')).toEqual([1, 3]);
      expect(groups.get('wood')).toEqual([2]);
    });
  });
});
