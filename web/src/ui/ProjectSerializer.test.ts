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
      // ADR-078 P-2 — Boolean group tag bridge methods.
      setBooleanGroupTag: vi.fn(),
      getBooleanGroupAFaces: vi.fn().mockReturnValue([]),
      getBooleanGroupBFaces: vi.fn().mockReturnValue([]),
      clearBooleanGroupTags: vi.fn(),
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
      // ADR-078 P-3 — SelectionManager exposed via toolManager.selection.
      selection: {
        getGroupA: vi.fn().mockReturnValue([]),
        getGroupB: vi.fn().mockReturnValue([]),
        restoreGroupTags: vi.fn(),
      },
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

  // ════════════════════════════════════════════════════════════════════════
  // ADR-078 P-3 — Boolean group tag save/load sync.
  // Per P-3 lock-ins:
  //   L1: Save sync clear → set(A) → set(B) idempotent (clear-only when both empty)
  //   L2: Load sync = syncMesh 직후 1 pull + restoreGroupTags 1 emit
  //   L3: restoreGroupTags policy locked in SelectionManager
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-078 P-3 boolean group sync', () => {
    it('saveProject pushes clear → set(A) → set(B) when groups present', () => {
      // Set up SelectionManager mock to return non-empty group tags.
      (deps.toolManager as any).selection.getGroupA.mockReturnValue([10, 20]);
      (deps.toolManager as any).selection.getGroupB.mockReturnValue([30]);

      api.saveProject();

      // L1: clear ALWAYS first.
      expect(deps.bridge.clearBooleanGroupTags).toHaveBeenCalledTimes(1);
      // Then set per non-empty group.
      expect(deps.bridge.setBooleanGroupTag).toHaveBeenCalledTimes(2);
      expect(deps.bridge.setBooleanGroupTag).toHaveBeenNthCalledWith(1, [10, 20], 'A');
      expect(deps.bridge.setBooleanGroupTag).toHaveBeenNthCalledWith(2, [30], 'B');

      // Push must complete BEFORE exportSnapshot (call ordering).
      const clearOrder = (deps.bridge.clearBooleanGroupTags as any).mock.invocationCallOrder[0];
      const exportOrder = (deps.bridge.exportSnapshot as any).mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(exportOrder);
    });

    it('saveProject calls clear-only when both groups empty (idempotent)', () => {
      // Both groups empty (default mock state).
      api.saveProject();

      expect(deps.bridge.clearBooleanGroupTags).toHaveBeenCalledTimes(1);
      // No set calls when both empty (L1 lock-in).
      expect(deps.bridge.setBooleanGroupTag).not.toHaveBeenCalled();
    });

    it('openProject pulls groupA + groupB via getBooleanGroupAFaces/BFaces and calls restoreGroupTags', async () => {
      // Mock bridge to return persisted group tags after import.
      (deps.bridge.getBooleanGroupAFaces as any).mockReturnValue([10, 20]);
      (deps.bridge.getBooleanGroupBFaces as any).mockReturnValue([30]);

      // Build a fake .xia JSON file content.
      const projectJson = JSON.stringify({
        format: 'xia',
        version: '1.0.0',
        mesh: 'AQID', // base64 of [1,2,3]
        units: { unit: 'mm', precision: 4 },
      });

      const fakeFile = {
        text: () => Promise.resolve(projectJson),
      } as any;

      let capturedOnChange: (() => Promise<void>) | null = null;
      const fakeInput = {
        type: '',
        accept: '',
        style: { display: '' },
        files: [fakeFile],
        click: vi.fn(),
        addEventListener: (event: string, cb: any) => {
          if (event === 'change') capturedOnChange = cb;
        },
        removeEventListener: vi.fn(),
        parentNode: { removeChild: vi.fn() },
      };

      // Override createElement spy installed in beforeEach (preserve deps mocks).
      const docCreate = document.createElement as any;
      docCreate.mockImplementation((tag: string) => {
        if (tag === 'input') return fakeInput;
        if (tag === 'a') return { href: '', download: '', click: vi.fn() };
        return undefined;
      });
      vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => el);

      api.openProject();

      // Trigger the captured onChange handler.
      expect(capturedOnChange).not.toBeNull();
      await capturedOnChange!();

      // L2: getA / getB called once each, then restoreGroupTags once.
      expect(deps.bridge.getBooleanGroupAFaces).toHaveBeenCalledTimes(1);
      expect(deps.bridge.getBooleanGroupBFaces).toHaveBeenCalledTimes(1);
      expect((deps.toolManager as any).selection.restoreGroupTags).toHaveBeenCalledTimes(1);
      expect((deps.toolManager as any).selection.restoreGroupTags).toHaveBeenCalledWith(
        [10, 20],
        [30],
      );

      // syncMesh must precede pull (ADR-078 P-3-f L2 lock-in).
      const syncOrder = (deps.toolManager.syncMesh as any).mock.invocationCallOrder[0];
      const restoreOrder = ((deps.toolManager as any).selection.restoreGroupTags as any).mock.invocationCallOrder[0];
      expect(syncOrder).toBeLessThan(restoreOrder);
    });
  });
});
