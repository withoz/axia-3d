/**
 * GroupTool — 그룹 생성/편집 도구
 *
 * 스케치업 스타일 그룹 인터랙션:
 * - 면 선택 후 G키 또는 메뉴 → 그룹 생성
 * - 그룹 선택 후 클릭 → 그룹 전체 선택
 * - 그룹 더블클릭 → 그룹 편집 모드 진입
 * - ESC → 그룹 편집 모드 종료
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { Toast } from '../ui/Toast';
import { debugLog } from '../utils/debug';

export class GroupTool implements ITool {
  readonly name = 'group';
  private ctx: ToolContext;
  private busy = false;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    // 그룹 도구 활성화 시 선택 상태 유지
    const selected = this.ctx.selection.getSelectedFaces();
    if (selected.length > 0) {
      Toast.info(`${selected.length}개 면 선택됨 — Enter로 그룹 생성`);
    } else {
      Toast.info('그룹에 포함할 면들을 선택하세요');
    }
  }

  onDeactivate(): void {
    this.busy = false;
  }

  onMouseDown(e: MouseEvent, _point: THREE.Vector3 | null): void {
    // 그룹 편집 모드에서의 클릭 처리
    if (this.ctx.selection.isInGroupEditMode()) {
      const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
      if (hit && hit.faceIndex != null) {
        const fid = this.getFaceId(hit.faceIndex);
        const handled = this.ctx.selection.handleGroupEditClick(fid, e.shiftKey, e.ctrlKey);
        if (!handled) {
          // 그룹 외부 클릭 → 편집 모드 종료됨
          Toast.info('그룹 편집 모드 종료');
        }
      } else {
        // 빈 공간 클릭
        this.ctx.selection.handleGroupEditClick(-1, false, false);
      }
      return;
    }

    // 일반 모드: face 선택
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.faceIndex != null) {
      const fid = this.getFaceId(hit.faceIndex);
      if (fid >= 0) {
        // 그룹에 속한 face 클릭 → 그룹 전체 선택
        const groupId = this.ctx.selection.getGroupId(fid);
        if (groupId !== undefined && !e.shiftKey && !e.ctrlKey && !e.altKey) {
          this.ctx.selection.selectGroup(groupId);
          Toast.info(`Group-${groupId} 선택됨 — 더블클릭으로 편집`);
        } else {
          this.ctx.selection.handleClick(fid, e.shiftKey, e.ctrlKey, !!e.altKey);
        }
      }
    } else {
      this.ctx.selection.handleClick(-1, false, false);
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    // hover highlight
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.faceIndex != null) {
      const fid = this.getFaceId(hit.faceIndex);
      this.ctx.selection.setHover(fid);
    } else {
      this.ctx.selection.clearHover();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.ctx.selection.isInGroupEditMode()) {
        this.ctx.selection.exitGroupEdit();
        Toast.info('그룹 편집 모드 종료');
      } else {
        this.ctx.selection.clearSelection();
      }
      e.preventDefault();
      return;
    }

    // Enter → 선택된 면들로 그룹 생성
    if (e.key === 'Enter') {
      this.createGroupFromSelection();
      e.preventDefault();
      return;
    }

    // Delete/Backspace → 선택된 그룹 해제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.ungroupSelection();
      e.preventDefault();
      return;
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  // ════════════════════════════════════════════════
  // 그룹 조작 메서드
  // ════════════════════════════════════════════════

  /** 현재 선택에서 그룹 생성 */
  createGroupFromSelection(): number | null {
    const selected = this.ctx.selection.getSelectedFaces();
    if (selected.length < 2) {
      Toast.warning('그룹을 만들려면 2개 이상의 면을 선택하세요');
      return null;
    }

    // WASM 백엔드에 그룹 생성 요청
    const groupId = this.ctx.bridge.createGroup(`Group`, selected);
    if (groupId > 0) {
      // 로컬 SelectionManager도 동기화
      this.ctx.selection.groupSelected();
      Toast.success(`Group-${groupId} 생성 (${selected.length}개 면)`);
      debugLog(`[GroupTool] Group-${groupId} created with faces:`, selected);
      return groupId;
    } else {
      // Fallback: WASM 미지원 시 로컬에서만 그룹 생성
      const localGid = this.ctx.selection.groupSelected();
      if (localGid != null) {
        Toast.success(`Group-${localGid} 생성 (${selected.length}개 면)`);
        return localGid;
      }
      Toast.error('그룹 생성 실패');
      return null;
    }
  }

  /** 선택된 그룹 해제 */
  ungroupSelection(): boolean {
    const selected = this.ctx.selection.getSelectedFaces();
    if (selected.length === 0) {
      Toast.warning('해제할 그룹을 선택하세요');
      return false;
    }

    // WASM 측 그룹 해제
    const groupId = this.ctx.selection.getGroupId(selected[0]);
    if (groupId !== undefined) {
      this.ctx.bridge.deleteGroup(groupId);
    }

    // 로컬 해제
    const result = this.ctx.selection.ungroupSelected();
    if (result) {
      Toast.info('그룹 해제됨');
    }
    return result;
  }

  /** 더블클릭으로 그룹 편집 모드 진입 */
  enterEditMode(faceId: number): boolean {
    const groupId = this.ctx.selection.getGroupId(faceId);
    if (groupId === undefined) return false;

    const entered = this.ctx.selection.enterGroupEdit(groupId);
    if (entered) {
      Toast.info(`Group-${groupId} 편집 모드 — ESC로 종료`);
    }
    return entered;
  }

  private getFaceId(faceIndex: number): number {
    if (faceIndex >= 0 && faceIndex < this.ctx.faceMap.length) {
      return this.ctx.faceMap[faceIndex];
    }
    return -1;
  }
}
