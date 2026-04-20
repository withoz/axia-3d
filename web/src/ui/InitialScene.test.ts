import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadInitialScene, InitialSceneDeps } from './InitialScene';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockDeps(): InitialSceneDeps {
  return {
    bridge: {
      create_cylinder: vi.fn().mockReturnValue(0),
      faceCount: vi.fn().mockReturnValue(1),
      drawRect: vi.fn().mockReturnValue(0),
      drawCircle: vi.fn().mockReturnValue(0),
      pushPull: vi.fn(),
      create_sphere: vi.fn().mockReturnValue(1),
      create_cone: vi.fn().mockReturnValue(2),
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
    it('creates Papillon scene (legs, body, head, snout, ears, nose, tail) on startup', async () => {
      loadInitialScene(deps);
      // async + setTimeout(0) between each WASM call
      await new Promise(r => setTimeout(r, 500));

      // 4 legs + 1 tail = 5 cylinders
      expect((deps.bridge.create_cylinder as any).mock.calls.length).toBe(5);
      // body + snout = 2 drawCircle+pushPull pairs
      expect((deps.bridge.drawCircle as any).mock.calls.length).toBe(2);
      expect((deps.bridge.pushPull as any).mock.calls.length).toBe(2);
      // head + nose = 2 spheres
      expect((deps.bridge.create_sphere as any).mock.calls.length).toBe(2);
      // 2 ears as cones
      expect((deps.bridge.create_cone as any).mock.calls.length).toBe(2);
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
