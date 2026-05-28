/**
 * SliceTool hotfix 회귀 자산 (2026-05-28).
 *
 * Trigger: 사용자 스크린샷 evidence — `sliceVolumeByPlane ERROR:
 * slice_volume_by_plane: empty face set` 3번 반복 발생.
 *
 * Root cause: SliceTool.onActivate() 가 face 미선택 시 Toast.warning +
 * phase='idle' 만 set 하고 종료. 그러나 onMouseDown('idle') 이 phase
 * 를 'awaiting_p2' 로 전이 → 3 클릭 → commit 도달 → engine
 * "empty face set" error.
 *
 * Hotfix: `commitWithNormal()` 시작 시 `volumeFaceIds.length === 0`
 * pre-check + 한국어 Toast.error + cleanup. + Engine error 메시지
 * 한국어 translation (translateEngineError helper).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SliceTool } from './SliceTool';
import { Toast } from '../ui/Toast';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

vi.mock('../ui/Toast', () => ({
  Toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function mockToolContext() {
  return {
    bridge: {
      engine: {
        sliceVolumeByPlane: vi.fn().mockReturnValue('{"ok":true,"newXia":42}'),
        get_xia_for_face: vi.fn().mockReturnValue(1),
        getXiaFaceIds: vi.fn().mockReturnValue(new Uint32Array([10, 11, 12])),
      },
      markDirty: vi.fn(),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
    },
    selection: {
      getSelectedFaces: vi.fn().mockReturnValue([]),  // default: empty
    },
    syncMesh: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('SliceTool hotfix — empty volume pre-check + Toast 한국어', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: SliceTool;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = mockToolContext();
    tool = new SliceTool(ctx);
  });

  /**
   * Hotfix #1 — onActivate face 미선택 시 phase='idle' 유지 + Toast.warning.
   * 그러나 onMouseDown('idle') 이 phase 전이 가능 — 그래서 commit 까지
   * 도달 가능. 본 test 는 그 후속 흐름 검증.
   */
  it('hotfix_commit_without_activate_blocks_empty_volume_face_set', () => {
    // Simulate: 사용자가 face 미선택 + Slice 도구 활성 → onActivate 가
    // phase='idle' 로 종료 + volumeFaceIds = []. 사용자 3 클릭 → commit 도달.
    ctx.selection.getSelectedFaces.mockReturnValue([]);
    tool.onActivate();
    // After onActivate: phase='idle', volumeFaceIds=[]
    expect(tool.isBusy()).toBe(false);

    // Simulate 3 clicks → commit 진입
    const p1 = new THREE.Vector3(0, 0, 0);
    const p2 = new THREE.Vector3(10, 0, 0);
    const p3 = new THREE.Vector3(0, 10, 0);
    tool.onMouseDown({} as MouseEvent, p1);
    tool.onMouseDown({} as MouseEvent, p2);
    tool.onMouseDown({} as MouseEvent, p3);

    // commit 도달 — hotfix pre-check 가 차단해야 함
    // engine.sliceVolumeByPlane 호출 안 됨 (pre-check 가 막아야)
    expect(ctx.bridge.engine.sliceVolumeByPlane).not.toHaveBeenCalled();

    // Toast.error 한국어 안내 호출 확인
    const mockedError = vi.mocked(Toast.error);
    expect(mockedError).toHaveBeenCalled();
    const errArgs = mockedError.mock.calls.find((call) =>
      String(call[0]).includes('솔리드') && String(call[0]).includes('volume')
    );
    expect(errArgs).toBeDefined();
  });

  /**
   * Hotfix #2 — translateEngineError "empty face set" → 한국어 사용자
   * facing 메시지.
   */
  it('hotfix_engine_error_translated_to_korean_user_facing', () => {
    // Setup volume face_ids 정상 (3 face) → commit 진입 → engine error
    ctx.selection.getSelectedFaces.mockReturnValue([10]);
    tool.onActivate();
    // engine.sliceVolumeByPlane 가 empty face set engine error 반환
    ctx.bridge.engine.sliceVolumeByPlane.mockReturnValue(
      JSON.stringify({ ok: false, error: 'slice_volume_by_plane: empty face set' }),
    );

    const p1 = new THREE.Vector3(0, 0, 0);
    const p2 = new THREE.Vector3(10, 0, 0);
    const p3 = new THREE.Vector3(0, 10, 0);
    tool.onMouseDown({} as MouseEvent, p1);
    tool.onMouseDown({} as MouseEvent, p2);
    tool.onMouseDown({} as MouseEvent, p3);

    // Toast.error 호출 + 한국어 translation 확인
    const mockedError = vi.mocked(Toast.error);
    const koreanErrArgs = mockedError.mock.calls.find((call) =>
      String(call[0]).includes('Slice 실패') &&
      String(call[0]).includes('솔리드') &&
      String(call[0]).includes('Push/Pull')
    );
    expect(koreanErrArgs).toBeDefined();
  });

  /**
   * Hotfix #3 — translateEngineError 다른 engine error 변형도 한국어 안내.
   */
  it('hotfix_multiple_engine_errors_translated', () => {
    ctx.selection.getSelectedFaces.mockReturnValue([10]);
    tool.onActivate();

    const mockedError = vi.mocked(Toast.error);
    const errorScenarios = [
      {
        engineErr: 'slice_volume_by_plane: input faces span multiple XIAs',
        expectedSubstring: '여러 볼륨',
      },
      {
        engineErr: 'slice_volume_by_plane: face FaceId(5) has no owning XIA',
        expectedSubstring: 'Sheet face',
      },
    ];

    for (const { engineErr, expectedSubstring } of errorScenarios) {
      mockedError.mockClear();
      ctx.bridge.engine.sliceVolumeByPlane.mockReturnValue(
        JSON.stringify({ ok: false, error: engineErr }),
      );
      const fresh = new SliceTool(ctx);
      fresh.onActivate();
      fresh.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      fresh.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      fresh.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 10, 0));

      const matched = mockedError.mock.calls.find((call) =>
        String(call[0]).includes(expectedSubstring),
      );
      expect(matched, `engine error "${engineErr}" should translate to include "${expectedSubstring}"`).toBeDefined();
    }
  });
});
