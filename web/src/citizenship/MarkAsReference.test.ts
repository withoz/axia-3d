/**
 * ADR-095 Phase 3-δ — MarkAsReference helper regression coverage.
 *
 * jsdom 단위 테스트 격리 — DOM / Inspector 의존성 없이 helper 자체
 * 검증. 다중 trigger point (Inspector / ContextMenu) 의 SSOT 봉인.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  markFacesAsReference,
  markEdgesAsReference,
  markVertsAsReference,
} from './MarkAsReference';
import type { WasmBridge } from '../bridge/WasmBridge';

function makeBridgeStub(opts: {
  createIM?: (name: string, fids: number[], src?: string) => number;
  createCL?: (name: string, eids: number[]) => number;
  createPC?: (name: string, vids: number[]) => number;
}): WasmBridge {
  return {
    createReferenceImportedMesh: vi.fn(opts.createIM ?? (() => 1)),
    createReferenceConstructionLine: vi.fn(opts.createCL ?? (() => 2)),
    createReferencePointCloud: vi.fn(opts.createPC ?? (() => 3)),
  } as unknown as WasmBridge;
}

describe('ADR-095 Phase 3-δ markFacesAsReference', () => {
  it('성공 시 refId 반환', () => {
    const bridge = makeBridgeStub({ createIM: () => 42 });
    const r = markFacesAsReference(bridge, [1, 2], 'Site', '/site.step');
    expect(r.ok).toBe(true);
    expect(r.refId).toBe(42);
    expect(bridge.createReferenceImportedMesh).toHaveBeenCalledWith(
      'Site', [1, 2], '/site.step',
    );
  });

  it('빈 face 배열 → 사용자 facing 거부', () => {
    const bridge = makeBridgeStub({});
    const r = markFacesAsReference(bridge, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('선택된 면이 없습니다');
    expect(bridge.createReferenceImportedMesh).not.toHaveBeenCalled();
  });

  it('R-B violation (Xia owned) → 사용자 facing 한국어 메시지', () => {
    const bridge = makeBridgeStub({
      createIM: () => {
        throw new Error(
          'createReferenceImportedMesh: face FaceId(7) is owned by a Xia (Property citizen)',
        );
      },
    });
    const r = markFacesAsReference(bridge, [7]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('객체 (Xia) 에 속해');
  });

  it('R-B violation (Shape owned) → 사용자 facing 한국어 메시지', () => {
    const bridge = makeBridgeStub({
      createIM: () => {
        throw new Error(
          'createReferenceImportedMesh: face FaceId(3) is owned by a Shape (Form citizen)',
        );
      },
    });
    const r = markFacesAsReference(bridge, [3]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('형태 (Shape) 에 속해');
  });

  it('endpoint missing → 페이지 새로고침 안내', () => {
    const bridge = makeBridgeStub({
      createIM: () => {
        throw new Error('createReferenceImportedMesh: WASM endpoint missing');
      },
    });
    const r = markFacesAsReference(bridge, [1]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('새로고침');
  });
});

describe('ADR-095 Phase 3-δ markEdgesAsReference', () => {
  it('성공 시 refId 반환', () => {
    const bridge = makeBridgeStub({ createCL: () => 7 });
    const r = markEdgesAsReference(bridge, [10, 20], 'Center axis');
    expect(r.ok).toBe(true);
    expect(r.refId).toBe(7);
    expect(bridge.createReferenceConstructionLine).toHaveBeenCalledWith(
      'Center axis', [10, 20],
    );
  });

  it('빈 edge 배열 → 거부', () => {
    const bridge = makeBridgeStub({});
    const r = markEdgesAsReference(bridge, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('선택된 엣지가 없습니다');
  });

  it('이미 Reference 에 등록된 edge → 한국어 메시지', () => {
    const bridge = makeBridgeStub({
      createCL: () => {
        throw new Error(
          'createReferenceConstructionLine: edge EdgeId(5) already owned by Reference ReferenceId(2)',
        );
      },
    });
    const r = markEdgesAsReference(bridge, [5]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('이미 다른 참조에 등록');
  });
});

describe('ADR-095 Phase 3-δ markVertsAsReference', () => {
  it('성공 시 refId 반환', () => {
    const bridge = makeBridgeStub({ createPC: () => 9 });
    const r = markVertsAsReference(bridge, [1, 2, 3], 'Site Scan');
    expect(r.ok).toBe(true);
    expect(r.refId).toBe(9);
  });

  it('default name 사용', () => {
    const bridge = makeBridgeStub({});
    markVertsAsReference(bridge, [1]);
    expect(bridge.createReferencePointCloud).toHaveBeenCalledWith(
      'Point Cloud', [1],
    );
  });

  it('빈 vert 배열 → 거부', () => {
    const bridge = makeBridgeStub({});
    const r = markVertsAsReference(bridge, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('선택된 정점이 없습니다');
  });
});
