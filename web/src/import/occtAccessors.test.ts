/**
 * Regression tests for occtAccessors helpers (ADR-036, 검토자 footgun 회피 패턴).
 *
 * 본 테스트는 helper 의 다형 접근 패턴이 wrapper 차이를 흡수하는지 검증.
 * OCCT.js 가 설치되지 않아도 테스트 가능 — mock 객체로 6 가지 wrapper
 * 패턴 모두 시뮬레이션.
 */

import { describe, it, expect } from 'vitest';
import {
  pntToVec3,
  readArray1Real,
  readUvBounds,
  readEdgeCurve,
  readFaceSurface,
  downCastTo,
} from './occtAccessors';

describe('pntToVec3', () => {
  it('gp_Pnt-like { X(), Y(), Z() } → [x, y, z]', () => {
    const pnt = { X: () => 1.5, Y: () => -2.0, Z: () => 0.0 };
    expect(pntToVec3(pnt)).toEqual([1.5, -2.0, 0.0]);
  });
});

describe('readArray1Real (다형 wrapper 호환)', () => {
  it('Lower/Upper/Value 패턴 (OCCT 표준 1-based)', () => {
    const arr = {
      Lower: () => 1, Upper: () => 3,
      Value: (i: number) => i * 10,
    };
    expect(readArray1Real(arr)).toEqual([10, 20, 30]);
  });

  it('Length/Get 패턴 (occt.js 일부 빌드)', () => {
    const arr = {
      Length: () => 4,
      Get: (i: number) => i + 0.5,
    };
    expect(readArray1Real(arr)).toEqual([1.5, 2.5, 3.5, 4.5]);
  });

  it('numeric index 패턴 ([i] direct access)', () => {
    // 1-based array-like
    const arr: { [i: number]: number; Length: () => number } = {
      1: 100, 2: 200, 3: 300,
      Length: () => 3,
    };
    expect(readArray1Real(arr)).toEqual([100, 200, 300]);
  });

  it('null / undefined 입력 → []', () => {
    expect(readArray1Real(null)).toEqual([]);
    expect(readArray1Real(undefined)).toEqual([]);
  });

  it('Lower 우선순위 (Length 가 있어도 Lower 사용)', () => {
    const arr = {
      Lower: () => 0, Upper: () => 2,  // 0-based 가정
      Length: () => 999,                // 무시되어야
      Value: (i: number) => i,
    };
    expect(readArray1Real(arr)).toEqual([0, 1, 2]);
  });

  it('Value 우선순위 (Get 보다 먼저)', () => {
    const arr = {
      Lower: () => 1, Upper: () => 2,
      Value: (_i: number) => 999,
      Get: (_i: number) => 0,  // 무시되어야
    };
    expect(readArray1Real(arr)).toEqual([999, 999]);
  });
});

describe('스텁 헬퍼 (OCCT 미통합 단계)', () => {
  it('readUvBounds 는 undefined 반환 (스텁)', () => {
    expect(readUvBounds(null, null)).toBeUndefined();
  });

  it('readEdgeCurve 는 undefined 반환 (스텁)', () => {
    expect(readEdgeCurve(null, null)).toBeUndefined();
  });

  it('readFaceSurface 는 undefined 반환 (스텁)', () => {
    expect(readFaceSurface(null, null)).toBeUndefined();
  });
});

describe('downCastTo — Handle 래핑 함정 회피', () => {
  it('null occt → undefined', () => {
    expect(downCastTo(null, 'Handle_Geom_Plane_2', {})).toBeUndefined();
  });

  it('null handle → undefined', () => {
    expect(downCastTo({}, 'Handle_Geom_Plane_2', null)).toBeUndefined();
  });

  it('handleClass 미존재 → undefined', () => {
    expect(downCastTo({}, 'Handle_Geom_Foo_X', { dummy: true })).toBeUndefined();
  });

  it('정상 DownCast → wrapped.get() 결과 반환', () => {
    const rawObject = { IsURational: () => false };
    const occt = {
      Handle_Geom_BSplineSurface_2: {
        DownCast: (_h: unknown) => ({
          IsNull: () => false,
          get: () => rawObject,
        }),
      },
    };
    const result = downCastTo(occt, 'Handle_Geom_BSplineSurface_2', { dummy: true });
    expect(result).toBe(rawObject);
  });

  it('IsNull() === true → undefined', () => {
    const occt = {
      Handle_Geom_Plane_2: {
        DownCast: (_h: unknown) => ({
          IsNull: () => true,
          get: () => ({}),
        }),
      },
    };
    expect(downCastTo(occt, 'Handle_Geom_Plane_2', { dummy: true })).toBeUndefined();
  });

  it('wrapped.get 미존재 → wrapped 자체 반환 (fallback)', () => {
    const wrapped = { IsNull: () => false, foo: 'bar' };
    const occt = {
      Handle_Geom_X: {
        DownCast: (_h: unknown) => wrapped,
      },
    };
    expect(downCastTo(occt, 'Handle_Geom_X', { dummy: true })).toBe(wrapped);
  });
});
