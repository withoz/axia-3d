import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  beforeEach(() => {
    deps = mockDeps();
  });

  describe('loadInitialScene', () => {
    it('creates default shapes (cylinder + box + sphere) on startup', async () => {
      loadInitialScene(deps);
      // async + setTimeout(0) between each WASM call
      await new Promise(r => setTimeout(r, 200));

      expect(deps.bridge.create_cylinder).toHaveBeenCalled();
      expect(deps.bridge.drawRect).toHaveBeenCalled();
      expect(deps.bridge.pushPull).toHaveBeenCalled();
      expect(deps.bridge.create_sphere).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('sets file status to untitled', () => {
      loadInitialScene(deps);
      expect(deps.updateFileStatus).toHaveBeenCalledWith('untitled');
    });

    it('does not fetch .xia file (always generates fresh scene)', () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
      loadInitialScene(deps);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
