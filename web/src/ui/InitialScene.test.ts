import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadInitialScene, InitialSceneDeps } from './InitialScene';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockDeps(): InitialSceneDeps {
  return {
    bridge: {
      create_cylinder: vi.fn().mockReturnValue(0),
      faceCount: vi.fn().mockReturnValue(1),
      drawRect: vi.fn().mockReturnValue(0),
      pushPull: vi.fn(),
      create_sphere: vi.fn().mockReturnValue(1),
    } as any,
    fileManager: {
      loadFromArrayBuffer: vi.fn().mockResolvedValue(true),
      getCurrentFileName: vi.fn().mockReturnValue('test-project.xia'),
    } as any,
    toolManager: {
      syncMesh: vi.fn(),
    } as any,
    updateFileStatus: vi.fn(),
  };
}

describe('InitialScene', () => {
  let deps: ReturnType<typeof mockDeps>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    deps = mockDeps();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('loadInitialScene - success', () => {
    it('fetches xia file and loads via FileManager', async () => {
      const mockBuffer = new ArrayBuffer(16);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockBuffer),
      });

      loadInitialScene(deps);
      // Wait for async operations
      await new Promise(r => setTimeout(r, 10));

      expect(globalThis.fetch).toHaveBeenCalledWith('/assets/AXiA_Project_2026-04-13.xia');
      expect(deps.fileManager.loadFromArrayBuffer).toHaveBeenCalled();
      expect(deps.updateFileStatus).toHaveBeenCalledWith('test-project.xia');
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });
  });

  describe('loadInitialScene - fetch failure', () => {
    it('creates fallback shapes when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      loadInitialScene(deps);
      // createFallbackScene uses async + setTimeout(0) between each WASM call
      await new Promise(r => setTimeout(r, 200));

      // Fallback: creates cylinder, box (drawRect + pushPull), sphere
      expect(deps.bridge.create_cylinder).toHaveBeenCalled();
      expect(deps.bridge.drawRect).toHaveBeenCalled();
      expect(deps.bridge.pushPull).toHaveBeenCalled();
      expect(deps.bridge.create_sphere).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('creates fallback when response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
      });

      loadInitialScene(deps);
      await new Promise(r => setTimeout(r, 200));

      expect(deps.bridge.drawRect).toHaveBeenCalled();
    });
  });

  describe('loadInitialScene - import failure', () => {
    it('calls fallback when import returns false', async () => {
      const mockBuffer = new ArrayBuffer(16);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockBuffer),
      });
      (deps.fileManager.loadFromArrayBuffer as any).mockResolvedValue(false);

      loadInitialScene(deps);
      // Failure path now calls createFallbackScene with async setTimeout
      await new Promise(r => setTimeout(r, 200));

      // Fallback shapes should be created
      expect(deps.bridge.create_cylinder).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(deps.updateFileStatus).not.toHaveBeenCalled();
    });
  });
});
