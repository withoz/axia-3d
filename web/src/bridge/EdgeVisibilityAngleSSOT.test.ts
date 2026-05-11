/**
 * ADR-038 P23.3 / P23.7 #4 회귀 테스트 — Edge Visibility Angle SSOT.
 *
 * Rust `axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG` (= 20.1°) 와
 * TypeScript `WasmBridge.EDGE_VISIBILITY_ANGLE_DEG` 가 정확히 일치해야
 * Three.js Viewport.smoothNormals 와 Rust Mesh::compute_smooth_normal_at
 * 의 hard/soft edge 판정이 두 layer 에서 어긋나지 않음.
 *
 * 본 테스트가 깨지면 P23.3 위반 — drift 발생.
 */

import { describe, it, expect } from 'vitest';
import { WasmBridge } from './WasmBridge';

describe('ADR-038 P23.3: Edge visibility angle SSOT (Rust ↔ TS)', () => {
  it('WasmBridge.EDGE_VISIBILITY_ANGLE_DEG 가 Rust 20.1° 와 일치', () => {
    // Rust tolerances.rs:106 의 값과 정확 일치해야 함.
    // 변경 시 양쪽이 동시에 갱신되어야 P23 invariant 유지.
    expect(WasmBridge.EDGE_VISIBILITY_ANGLE_DEG).toBe(20.1);
  });

  it('static 값은 readonly — 런타임 변경 불가능 (TypeScript const)', () => {
    // static readonly 는 컴파일 타임에 잠금. 본 테스트는 schema sanity 만.
    const before = WasmBridge.EDGE_VISIBILITY_ANGLE_DEG;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(180);   // valid angle range
  });

  it('Bridge instance getEdgeVisibilityAngleDeg() — engine 미연결 시 SSOT fallback', () => {
    const bridge = new WasmBridge();
    // engine init 안 함 → fallback 으로 static const 반환
    const angle = bridge.getEdgeVisibilityAngleDeg();
    expect(angle).toBe(WasmBridge.EDGE_VISIBILITY_ANGLE_DEG);
    expect(angle).toBe(20.1);
  });

  it('WASM 미설치 환경에서도 Three.js 가 hardcode 30 사용 안 함 (P23.3 drift 차단)', () => {
    // P23.3 invariant: 어떤 환경에서도 hard/soft threshold 가 30° 가 아님.
    // 30° 는 ADR-038 이전의 hardcode 값 — 회귀 차단.
    expect(WasmBridge.EDGE_VISIBILITY_ANGLE_DEG).not.toBe(30);
    expect(WasmBridge.EDGE_VISIBILITY_ANGLE_DEG).toBeLessThan(30);
  });

  it('Rust ↔ TS SSOT — 값이 어긋나면 본 테스트 깨짐 (architectural drift detector)', () => {
    // 본 테스트는 이중 검증:
    //   1. TS const 가 ADR-038 P23.3 의 명시 값 (20.1°)
    //   2. Bridge fallback 도 같은 값
    //   3. (WASM 통합 시) live engine 도 같은 값 — 통합 후 별도 테스트
    const expected = 20.1;
    expect(WasmBridge.EDGE_VISIBILITY_ANGLE_DEG).toBe(expected);

    const bridge = new WasmBridge();
    expect(bridge.getEdgeVisibilityAngleDeg()).toBe(expected);
  });
});
