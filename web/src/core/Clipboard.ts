/**
 * Clipboard — in-memory geometry copy buffer.
 *
 * Windows 표준 Ctrl+C/X/V/D 워크플로우를 지원. 현재 MVP는 face 기반:
 *   - copy(faceIds) → IDs 스냅샷 저장 (원본은 건드리지 않음)
 *   - cut(faceIds)  → copy() + 호출자가 deletion 수행
 *   - get()          → 저장된 IDs 조회 (paste 시 사용)
 *
 * Paste는 ToolManager에서 arrayLinearFaces(1, offset)로 구현 —
 * 전용 clone API가 아직 없으므로 Array의 count=1 path 재사용.
 *
 * Known limitations (추후 개선):
 *   - face만 지원 (edge / vertex 클립보드는 Phase 2)
 *   - IDs만 저장 → 원본이 삭제되면 paste 실패 (Toast 안내)
 *   - 세션 간 공유 없음 (브라우저 시스템 클립보드와 미연계)
 */
export interface ClipboardContents {
  kind: 'faces';
  ids: number[];
  timestamp: number;
}

export class Clipboard {
  private contents: ClipboardContents | null = null;

  copy(kind: 'faces', ids: number[]): void {
    if (ids.length === 0) { this.contents = null; return; }
    this.contents = { kind, ids: ids.slice(), timestamp: Date.now() };
  }

  get(): ClipboardContents | null {
    return this.contents;
  }

  clear(): void { this.contents = null; }

  /** Has anything to paste? */
  hasContents(): boolean {
    return this.contents !== null && this.contents.ids.length > 0;
  }
}

let _singleton: Clipboard | null = null;
export function getClipboard(): Clipboard {
  if (!_singleton) _singleton = new Clipboard();
  return _singleton;
}
