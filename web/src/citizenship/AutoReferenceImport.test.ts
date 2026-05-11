/**
 * ADR-096 M-β — AutoReferenceImport regression coverage.
 *
 * jsdom 격리 단위 테스트 — DOM / FileImporter 의존성 없이 helper
 * 자체 검증.
 */

import { describe, it, expect, vi } from 'vitest';
import { autoRegisterImportAsReference } from './AutoReferenceImport';
import type { WasmBridge } from '../bridge/WasmBridge';

function makeBridgeStub(opts: {
  createIM?: (name: string, fids: number[], src?: string) => number;
}): WasmBridge {
  return {
    createReferenceImportedMesh: vi.fn(
      opts.createIM ?? ((_n, _f, _s) => 1),
    ),
  } as unknown as WasmBridge;
}

describe('ADR-096 M-β autoRegisterImportAsReference', () => {
  it('성공 시 refId / refName / faceCount 반환', () => {
    const bridge = makeBridgeStub({ createIM: () => 42 });
    const r = autoRegisterImportAsReference(bridge, [10, 20, 30], 'site.step');
    expect(r.ok).toBe(true);
    expect(r.refId).toBe(42);
    expect(r.refName).toBe('site');
    expect(r.faceCount).toBe(3);
    expect(bridge.createReferenceImportedMesh).toHaveBeenCalledWith(
      'site', [10, 20, 30], 'site.step',
    );
  });

  it('Settings OFF (enabled=false) → graceful skip', () => {
    const bridge = makeBridgeStub({});
    const r = autoRegisterImportAsReference(
      bridge, [1], 'model.iges', { enabled: false },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('비활성');
    expect(bridge.createReferenceImportedMesh).not.toHaveBeenCalled();
  });

  it('빈 face 배열 → 사용자 facing 거부', () => {
    const bridge = makeBridgeStub({});
    const r = autoRegisterImportAsReference(bridge, [], 'site.step');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('등록할 face 가 없습니다');
    expect(bridge.createReferenceImportedMesh).not.toHaveBeenCalled();
  });

  it('Reference name 자동 생성 (M-L5) — file stem 추출', () => {
    const bridge = makeBridgeStub({ createIM: (name) => name === 'foo' ? 99 : -1 });
    expect(autoRegisterImportAsReference(bridge, [1], 'foo.step').refName).toBe('foo');
    expect(autoRegisterImportAsReference(bridge, [1], '/path/to/foo.step').refName).toBe('foo');
    expect(autoRegisterImportAsReference(bridge, [1], 'C:\\path\\to\\foo.iges').refName).toBe('foo');
    expect(autoRegisterImportAsReference(bridge, [1], 'noext').refName).toBe('noext');
  });

  it('file name 미제공 → fallback name', () => {
    const bridge = makeBridgeStub({});
    const r = autoRegisterImportAsReference(bridge, [1], undefined, {
      fallbackName: 'My Import',
    });
    expect(r.refName).toBe('My Import');
  });

  it('default fallback name = "Imported Mesh"', () => {
    const bridge = makeBridgeStub({});
    const r = autoRegisterImportAsReference(bridge, [1]);
    expect(r.refName).toBe('Imported Mesh');
  });

  it('R-B violation (face owned by Xia) → 한국어 메시지', () => {
    const bridge = makeBridgeStub({
      createIM: () => {
        throw new Error(
          'createReferenceImportedMesh: face FaceId(7) is owned by a Xia (Property citizen)',
        );
      },
    });
    const r = autoRegisterImportAsReference(bridge, [7], 'site.step');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('다른 객체');
  });

  it('endpoint missing → 페이지 새로고침 안내', () => {
    const bridge = makeBridgeStub({
      createIM: () => {
        throw new Error('createReferenceImportedMesh: WASM endpoint missing');
      },
    });
    const r = autoRegisterImportAsReference(bridge, [1], 'site.step');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('새로고침');
  });

  it('sourcePath = file name 그대로 전달', () => {
    const bridge = makeBridgeStub({});
    autoRegisterImportAsReference(bridge, [1], 'site.step');
    expect(bridge.createReferenceImportedMesh).toHaveBeenCalledWith(
      'site', [1], 'site.step',
    );
  });
});
