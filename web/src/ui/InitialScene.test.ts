import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadInitialScene, InitialSceneDeps } from './InitialScene';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockDeps(): InitialSceneDeps {
  return {
    bridge: {
      create_cylinder: vi.fn().mockReturnValue(0),
      faceCount: vi.fn().mockReturnValue(0),
      drawRect: vi.fn().mockReturnValue(0),
      drawCircle: vi.fn().mockReturnValue(0),
      pushPull: vi.fn(),
      create_sphere: vi.fn().mockReturnValue(1),
      create_cone: vi.fn().mockReturnValue(2),
      revolveProfile: vi.fn().mockReturnValue([3, 4, 5]),
      sweepProfileAlongPath: vi.fn().mockReturnValue([6, 7, 8]),
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
    it('starts with empty scene (no geometry creation calls)', async () => {
      loadInitialScene(deps);
      await new Promise(r => setTimeout(r, 50));

      expect((deps.bridge.create_cylinder as any).mock.calls.length).toBe(0);
      expect((deps.bridge.create_cone as any).mock.calls.length).toBe(0);
      expect((deps.bridge.create_sphere as any).mock.calls.length).toBe(0);
      expect((deps.bridge.revolveProfile as any).mock.calls.length).toBe(0);
      expect((deps.bridge.sweepProfileAlongPath as any).mock.calls.length).toBe(0);
      expect((deps.bridge.drawRect as any).mock.calls.length).toBe(0);
      expect((deps.bridge.drawCircle as any).mock.calls.length).toBe(0);
    });

    it('syncs the (empty) mesh once so viewport / BVH initialise cleanly', () => {
      loadInitialScene(deps);
      expect(deps.toolManager.syncMesh).toHaveBeenCalledTimes(1);
    });

    it('sets file status to untitled', () => {
      loadInitialScene(deps);
      expect(deps.updateFileStatus).toHaveBeenCalledWith('untitled');
    });

    it('does not fetch .xia file (always starts fresh)', () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
      loadInitialScene(deps);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
