import { describe, it, expect, beforeEach, vi } from 'vitest';
import { importDxfFile, DxfImportDeps } from './DxfImportHandler';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('./Toast', () => ({ Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const alertMock = vi.fn();
globalThis.alert = alertMock;
// Phase H4 — unit prompt mock: 기본 "mm" 반환 (Cancel 안 함)
globalThis.prompt = vi.fn().mockReturnValue('mm');

function mockDeps(): DxfImportDeps {
  return {
    bridge: {
      importDxf: vi.fn().mockReturnValue({
        ok: true,
        totalVerts: 100,
        totalFaces: 50,
        lines: 10,
        polylines: 5,
        circles: 3,
        arcs: 2,
        faces3d: 0,
        solids: 0,
        ellipses: 0,
        splines: 0,
        skipped: 1,
      }),
      normalizeForImport: vi.fn().mockReturnValue({
        degenerateRemoved: 0,
        windingFlipped: 0,
        normalsRecomputed: 0,
        isolatedVertsRemoved: 0,
        remainingViolations: 0,
      }),
      countFreeEdges: vi.fn().mockReturnValue(0),
    } as any,
    toolManager: {
      syncMesh: vi.fn(),
    } as any,
  };
}

describe('DxfImportHandler', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    deps = mockDeps();
    alertMock.mockClear();
    document.body.innerHTML = '';
  });

  describe('importDxfFile', () => {
    it('creates hidden file input', () => {
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.accept).toBe('.dxf');
      expect(input.style.display).toBe('none');
    });

    it('triggers input click', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
      importDxfFile(deps);
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls bridge.importDxf with file data', async () => {
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      // jsdom File doesn't support arrayBuffer(), so create a mock file object
      const buf = new ArrayBuffer(4);
      const file = { name: 'test.dxf', size: 4, arrayBuffer: () => Promise.resolve(buf) };
      Object.defineProperty(input, 'files', { value: [file] });

      await input.onchange?.({} as any);

      expect(deps.bridge.importDxf).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('alerts when importDxf returns null', async () => {
      (deps.bridge.importDxf as any).mockReturnValue(null);
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const buf = new ArrayBuffer(1);
      const file = { name: 'test.dxf', size: 1, arrayBuffer: () => Promise.resolve(buf) };
      Object.defineProperty(input, 'files', { value: [file] });

      await input.onchange?.({} as any);

      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('WASM'));
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('alerts when result.ok is false', async () => {
      (deps.bridge.importDxf as any).mockReturnValue({ ok: false, error: 'Parse error' });
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const buf = new ArrayBuffer(1);
      const file = { name: 'test.dxf', size: 1, arrayBuffer: () => Promise.resolve(buf) };
      Object.defineProperty(input, 'files', { value: [file] });

      await input.onchange?.({} as any);

      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Parse error'));
    });

    it('does nothing when no file selected', async () => {
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', { value: [] });

      await input.onchange?.({} as any);

      expect(deps.bridge.importDxf).not.toHaveBeenCalled();
    });

    it('removes input from DOM after file selection', async () => {
      importDxfFile(deps);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const buf = new ArrayBuffer(1);
      const file = { name: 'test.dxf', size: 1, arrayBuffer: () => Promise.resolve(buf) };
      Object.defineProperty(input, 'files', { value: [file] });

      await input.onchange?.({} as any);

      // Input should be removed from body
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });
  });
});
