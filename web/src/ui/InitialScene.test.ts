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
    it('creates Papillon scene (revolve legs+body+snout, sphere head+nose, cone ears, sweep tail)', async () => {
      loadInitialScene(deps);
      await new Promise(r => setTimeout(r, 500));

      // No more plain cylinders — legs and tail use revolve / sweep
      expect((deps.bridge.create_cylinder as any).mock.calls.length).toBe(0);
      // 4 legs + body + snout = 6 revolves
      expect((deps.bridge.revolveProfile as any).mock.calls.length).toBe(6);
      // head + nose = 2 spheres
      expect((deps.bridge.create_sphere as any).mock.calls.length).toBe(2);
      // 2 ears as cones
      expect((deps.bridge.create_cone as any).mock.calls.length).toBe(2);
      // 1 tail as sweep
      expect((deps.bridge.sweepProfileAlongPath as any).mock.calls.length).toBe(1);
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
