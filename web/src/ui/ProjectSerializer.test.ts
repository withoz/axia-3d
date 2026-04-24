import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initProjectSerializer, ProjectSerializerDeps } from './ProjectSerializer';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockDeps(): ProjectSerializerDeps {
  return {
    bridge: {
      exportSnapshot: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
      importSnapshot: vi.fn().mockReturnValue(true),
      getMeshBuffers: vi.fn().mockReturnValue({
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 1, 0]),
        indices: new Uint32Array([0]),
        faceMap: new Uint32Array([1]),
      }),
      getEdgeLines: vi.fn().mockReturnValue(new Float32Array([0, 0, 0, 1, 0, 0])),
    } as any,
    viewport: {
      getCameraState: vi.fn().mockReturnValue({ position: [0, 10, 10], target: [0, 0, 0] }),
      setCameraState: vi.fn(),
      getStyleSettings: vi.fn().mockReturnValue({ bgMode: 'gradient2', gridVisible: true }),
      updateBackground: vi.fn(),
      setFaceColors: vi.fn(),
      setEdgeStyle: vi.fn(),
      setGridVisible: vi.fn(),
      setAxisVisible: vi.fn(),
    } as any,
    toolManager: {
      syncMesh: vi.fn(),
    } as any,
    units: {
      unit: 'mm',
      precision: 4,
    } as any,
  };
}

describe('ProjectSerializer', () => {
  let deps: ReturnType<typeof mockDeps>;
  let api: ReturnType<typeof initProjectSerializer>;

  // Mock URL and anchor for download
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deps = mockDeps();
    api = initProjectSerializer(deps);

    clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as any;
      }
      if (tag === 'input') {
        const input = document.createElement('input');
        return input;
      }
      return document.createElement(tag);
    });
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  describe('initProjectSerializer', () => {
    it('returns saveProject and openProject functions', () => {
      expect(api.saveProject).toBeInstanceOf(Function);
      expect(api.openProject).toBeInstanceOf(Function);
    });
  });

  describe('saveProject', () => {
    it('calls bridge.exportSnapshot', () => {
      api.saveProject();
      expect(deps.bridge.exportSnapshot).toHaveBeenCalled();
    });

    it('creates download link and clicks it', () => {
      api.saveProject();
      expect(clickSpy).toHaveBeenCalled();
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('includes camera and style in save', () => {
      api.saveProject();
      expect(deps.viewport.getCameraState).toHaveBeenCalled();
      expect(deps.viewport.getStyleSettings).toHaveBeenCalled();
    });

    it('falls back when exportSnapshot returns null', () => {
      (deps.bridge.exportSnapshot as any).mockReturnValue(null);
      api.saveProject();
      // Fallback uses getMeshBuffers
      expect(deps.bridge.getMeshBuffers).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('openProject', () => {
    it('creates file input element', () => {
      // We need to restore createElement for this test
      vi.restoreAllMocks();
      const createSpy = vi.spyOn(document, 'createElement');
      api = initProjectSerializer(deps);
      api.openProject();
      expect(createSpy.mock.calls.some(c => c[0] === 'input')).toBe(true);
    });
  });

  describe('base64 round-trip (via save)', () => {
    it('snapshot data is base64 encoded in save output', () => {
      // The save function creates a JSON blob. We can verify by inspecting
      // what was passed to Blob constructor
      const BlobSpy = vi.fn().mockImplementation(function(this: any, parts: any[], opts: any) {
        this._parts = parts;
        this._type = opts?.type;
      });
      globalThis.Blob = BlobSpy as any;

      api.saveProject();

      expect(BlobSpy).toHaveBeenCalled();
      const json = BlobSpy.mock.calls[0][0][0];
      const parsed = JSON.parse(json);
      expect(parsed.format).toBe('xia');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.mesh).toBeDefined();
      expect(typeof parsed.mesh).toBe('string'); // base64 string
      expect(parsed.units.unit).toBe('mm');
      expect(parsed.units.precision).toBe(4);
    });
  });

  describe('fallback save format', () => {
    it('fallback includes buffers as arrays', () => {
      (deps.bridge.exportSnapshot as any).mockReturnValue(null);

      const BlobSpy = vi.fn().mockImplementation(function(this: any, parts: any[], _opts: any) {
        this._parts = parts;
      });
      globalThis.Blob = BlobSpy as any;

      api.saveProject();

      const json = BlobSpy.mock.calls[0][0][0];
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe('1.0.0-fallback');
      expect(parsed.buffers).toBeDefined();
      expect(parsed.buffers.positions).toEqual([0, 0, 0]);
      expect(parsed.edgeLines).toEqual([0, 0, 0, 1, 0, 0]);
    });
  });
});
