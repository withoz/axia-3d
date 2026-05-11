/**
 * FileManager — Scene Save/Load (.axia binary format)
 *
 * Handles saving and loading AXiA 3D project files.
 * Format: Binary snapshot from WASM engine with metadata.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { Toast } from '../ui/Toast';
import { Material } from '../materials/MaterialLibrary';
import { debugLog } from '../utils/debug';

const AXIA_MAGIC = 0x41584941;  // 'AXIA' in ASCII
const AXIA_VERSION = 2;  // Bumped version to support materials

export interface AxiaFileMetadata {
  version: number;
  timestamp: string;
  name: string;
  materials?: Material[];  // Serialized materials (v2+)
  /** Phase I4 — CurveRegistry JSON (shape unknown to FileManager, module-
   *  internal). Populated by dynamic import of CurveRegistry in save path
   *  and consumed symmetrically on load. */
  curves?: unknown;
}

export class FileManager {
  private bridge: WasmBridge;
  private currentFileName: string = 'untitled.xia';
  private materialLibrary: any = null;  // MaterialLibrary reference
  private _onFileChangeCallbacks: Array<() => void> = [];

  constructor(bridge: WasmBridge) {
    this.bridge = bridge;
  }

  /** Register a callback for file name changes (save/open) */
  onFileChange(cb: () => void): void {
    this._onFileChangeCallbacks.push(cb);
  }

  private notifyFileChange(): void {
    this._onFileChangeCallbacks.forEach(cb => cb());
  }

  /**
   * ADR-009 Smart Auto — after loading a file, classify any orphan faces
   * and automatically apply C1/C2 recovery. C3 cases surface a manual-
   * menu hint. User can opt out via `localStorage.axia:autorecover-orphans`.
   */
  private autoRecoverOrphansIfAny(): void {
    try {
      const pref = localStorage.getItem('axia:autorecover-orphans');
      if (pref === 'off') return;
    } catch { /* no localStorage in test env */ }

    if (!this.bridge.classifyOrphans) return;
    const report = this.bridge.classifyOrphans();
    if (!report) return;
    if (report.total_orphans === 0) return;

    const c1 = report.c1_count;
    const c2 = report.c2_count;
    const c3 = report.c3_count;

    // Nothing automatable.
    if (c1 === 0 && c2 === 0) {
      if (c3 > 0) {
        Toast.warning(
          `모호한 Orphan ${c3}건 발견. '정리 → Orphan 수동 복구' 메뉴 참고`,
          4000,
        );
      }
      return;
    }

    // Apply C1 + C2 automatically.
    const result = this.bridge.applyOrphanRecovery(
      { apply_c1: true, apply_c2: true, c3_decisions: [] },
      /*dryRun*/ false,
    );
    if (!result || result.error) {
      Toast.warning(
        `Orphan 자동 복구 실패: ${result?.error ?? '알 수 없음'} (원본 유지)`,
        4000,
      );
      return;
    }

    const autoFaces = result.faces_absorbed + result.faces_in_new_xias;
    const newXias = result.xias_created.length;
    let msg = `레거시 파일: ${autoFaces}개 face를 ${newXias}개 XIA로 자동 복구됨 · Ctrl+Z로 취소`;
    if (c3 > 0) {
      msg += `\n(모호한 Orphan ${c3}건은 '정리 → Orphan 수동 복구' 메뉴로 처리)`;
    }
    Toast.info(msg, 5000);
    debugLog('[FileManager] auto-recovered orphans:', result);
  }

  /** Set material library reference for serialization */
  setMaterialLibrary(lib: any): void {
    this.materialLibrary = lib;
  }

  /** Save current project to file */
  async saveProject(fileName?: string): Promise<boolean> {
    try {
      if (fileName) {
        this.currentFileName = fileName;
      }

      debugLog(`[FileManager] 프로젝트 저장 중: ${this.currentFileName}`);

      // Get binary snapshot from engine
      const snapshotData = this.bridge.exportSnapshot();
      if (!snapshotData) {
        Toast.error('스냅샷 생성 실패');
        return false;
      }

      // Create metadata with materials
      const metadata: AxiaFileMetadata = {
        version: AXIA_VERSION,
        timestamp: new Date().toISOString(),
        name: this.currentFileName.replace('.xia', ''),
      };

      // Include custom materials if materialLibrary is available
      if (this.materialLibrary && typeof this.materialLibrary.getCustom === 'function') {
        const customMaterials = this.materialLibrary.getCustom();
        if (customMaterials && customMaterials.length > 0) {
          metadata.materials = customMaterials;
          debugLog(`[FileManager] 재질 ${customMaterials.length}개 저장됨`);
        }
      }

      // Phase I4 — CurveRegistry 직렬화 (AXIA 파일 metadata에 포함)
      try {
        // 동적 import — FileManager는 curves 모듈에 직접 의존하지 않음
        const { getCurveRegistry } = await import('../curves/CurveRegistry');
        const registry = getCurveRegistry();
        if (registry.size() > 0) {
          metadata.curves = registry.toJSON();
          debugLog(`[FileManager] curve ${registry.size()}개 저장됨`);
        }
      } catch (e) {
        console.warn('[FileManager] curve 저장 실패:', e);
      }

      // Combine metadata + snapshot into single file
      const fileData = this.createAxiaFile(metadata, snapshotData);

      // Trigger download
      this.downloadFile(fileData, this.currentFileName);
      Toast.success(`저장 완료: ${this.currentFileName}`);
      this.notifyFileChange();
      return true;
    } catch (err) {
      console.error('[FileManager] 저장 실패:', err);
      Toast.error(`저장 실패: ${(err as Error).message}`);
      return false;
    }
  }

  /** Save As dialog */
  async saveAsProject(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const fileName = prompt('프로젝트 이름을 입력하세요:', this.currentFileName.replace('.xia', ''));
        if (!fileName) {
          resolve(false);
          return;
        }

        const finalName = fileName.endsWith('.xia') ? fileName : `${fileName}.xia`;
        this.saveProject(finalName).then(resolve);
      } catch (err) {
        console.error('[FileManager] Save As 실패:', err);
        resolve(false);
      }
    });
  }

  /** Open project from file */
  async openProject(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xia';
        input.style.display = 'none';
        document.body.appendChild(input);

        // Cleanup helper — removes DOM element and listeners exactly once
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          input.removeEventListener('change', onChange);
          input.removeEventListener('cancel', onCancel);
          if (input.parentNode) input.parentNode.removeChild(input);
        };

        const onChange = async (event: Event) => {
          const files = (event.target as HTMLInputElement).files;
          const file = files?.[0];
          cleanup();

          if (!file) {
            resolve(false);
            return;
          }

          try {
            this.currentFileName = file.name;

            const arrayBuffer = await file.arrayBuffer();
            const fileData = new Uint8Array(arrayBuffer);
            const { metadata, snapshot } = this.parseAxiaFile(fileData);

            // Restore custom materials if available
            if (metadata.materials && this.materialLibrary && typeof this.materialLibrary.addCustom === 'function') {
              for (const material of metadata.materials) {
                try {
                  this.materialLibrary.addCustom(material);
                } catch (_) { /* skip failed material */ }
              }
            }

            // Phase I4 — CurveRegistry 복원
            if (metadata.curves) {
              try {
                const { getCurveRegistry } = await import('../curves/CurveRegistry');
                getCurveRegistry().fromJSON(metadata.curves);
                const curvesJson = metadata.curves as { curves?: unknown[] };
                debugLog(`[FileManager] curve ${curvesJson.curves?.length ?? 0}개 복원`);
              } catch (e) {
                console.warn('[FileManager] curve 복원 실패:', e);
              }
            }

            const success = this.bridge.importSnapshot(snapshot);
            if (success) {
              Toast.success(`로드 완료: ${this.currentFileName}`);
              this.autoRecoverOrphansIfAny();
              this.notifyFileChange();
              resolve(true);
            } else {
              Toast.error('프로젝트 로드 실패');
              resolve(false);
            }
          } catch (err) {
            console.error('[FileManager] 파일 읽기 실패:', err);
            Toast.error(`파일 읽기 실패: ${(err as Error).message}`);
            resolve(false);
          }
        };

        const onCancel = () => {
          cleanup();
          resolve(false);
        };

        input.addEventListener('change', onChange);
        input.addEventListener('cancel', onCancel);

        // Trigger file picker
        setTimeout(() => {
          try {
            input.click();
          } catch (e) {
            console.error('[FileManager] 파일 선택 대화 실패:', e);
            cleanup();
            resolve(false);
          }
        }, 50);
      } catch (err) {
        console.error('[FileManager] 파일 선택 대화 생성 실패:', err);
        resolve(false);
      }
    });
  }

  /** Load project from raw ArrayBuffer (e.g., fetched from URL) */
  async loadFromArrayBuffer(data: Uint8Array, fileName?: string): Promise<boolean> {
    try {
      const { metadata, snapshot } = this.parseAxiaFile(data);

      debugLog('[FileManager] 메타데이터:', metadata);
      debugLog(`[FileManager] 스냅샷 크기: ${snapshot.length} bytes`);

      // 파일명 설정
      if (fileName) {
        this.currentFileName = fileName;
      } else if (metadata.name) {
        const name = metadata.name;
        this.currentFileName = name.endsWith('.xia') ? name : `${name}.xia`;
      }

      // 재질 복원
      if (metadata.materials && this.materialLibrary && typeof this.materialLibrary.addCustom === 'function') {
        for (const material of metadata.materials) {
          try {
            this.materialLibrary.addCustom(material);
          } catch (err) {
            console.warn(`[FileManager] 재질 복원 실패: ${material.name}`, err);
          }
        }
      }

      // Phase I4 — Curve 복원
      if (metadata.curves) {
        try {
          const { getCurveRegistry } = await import('../curves/CurveRegistry');
          getCurveRegistry().fromJSON(metadata.curves);
          const curvesJson = metadata.curves as { curves?: unknown[] };
          debugLog(`[FileManager] curve ${curvesJson.curves?.length ?? 0}개 복원`);
        } catch (e) {
          console.warn('[FileManager] curve 복원 실패:', e);
        }
      }

      // 스냅샷 로드
      const success = this.bridge.importSnapshot(snapshot);
      if (success) {
        debugLog(`[FileManager] 로드 완료: ${this.currentFileName}`);
        this.autoRecoverOrphansIfAny();
        this.notifyFileChange();
        return true;
      }
      console.error('[FileManager] importSnapshot 실패');
      return false;
    } catch (err) {
      console.error('[FileManager] ArrayBuffer 파싱 실패:', err);
      return false;
    }
  }

  /** Get current file name */
  getCurrentFileName(): string {
    return this.currentFileName;
  }

  /** Set current file name */
  setCurrentFileName(name: string): void {
    this.currentFileName = name.endsWith('.xia') ? name : `${name}.xia`;
  }

  // ─── Private helpers ───

  /** Create AXIA file format: [magic][version][metadata_len][metadata_json][snapshot] */
  private createAxiaFile(metadata: AxiaFileMetadata, snapshot: Uint8Array): Uint8Array {
    // Serialize metadata as JSON
    const metadataJson = JSON.stringify(metadata);
    const metadataBytes = new TextEncoder().encode(metadataJson);

    // Build file structure:
    // [4 bytes: magic] [4 bytes: version] [4 bytes: metadata length] [metadata] [snapshot]
    const totalSize = 4 + 4 + 4 + metadataBytes.length + snapshot.length;
    const fileData = new Uint8Array(totalSize);

    let offset = 0;

    // Write magic number (little-endian)
    const magicView = new DataView(fileData.buffer, offset, 4);
    magicView.setUint32(0, AXIA_MAGIC, true);
    offset += 4;

    // Write version (little-endian)
    const versionView = new DataView(fileData.buffer, offset, 4);
    versionView.setUint32(0, AXIA_VERSION, true);
    offset += 4;

    // Write metadata length (little-endian)
    const lenView = new DataView(fileData.buffer, offset, 4);
    lenView.setUint32(0, metadataBytes.length, true);
    offset += 4;

    // Write metadata JSON
    fileData.set(metadataBytes, offset);
    offset += metadataBytes.length;

    // Write snapshot
    fileData.set(snapshot, offset);

    return fileData;
  }

  /** Parse AXIA file format and extract metadata + snapshot */
  private parseAxiaFile(fileData: Uint8Array): { metadata: AxiaFileMetadata; snapshot: Uint8Array } {
    if (fileData.length < 12) {
      throw new Error('파일 크기가 너무 작습니다');
    }

    let offset = 0;

    // Read magic
    const magicView = new DataView(fileData.buffer, offset, 4);
    const magic = magicView.getUint32(0, true);
    offset += 4;

    if (magic !== AXIA_MAGIC) {
      throw new Error('유효하지 않은 AXIA 파일입니다');
    }

    // Read version
    const versionView = new DataView(fileData.buffer, offset, 4);
    const version = versionView.getUint32(0, true);
    offset += 4;

    // Support versions 1 (legacy) and 2+ (with materials)
    if (version < 1 || version > AXIA_VERSION) {
      throw new Error(`지원하지 않는 버전입니다 (v${version}). 현재 지원: v1~v${AXIA_VERSION}`);
    }

    // Read metadata length
    const lenView = new DataView(fileData.buffer, offset, 4);
    const metadataLen = lenView.getUint32(0, true);
    offset += 4;

    if (offset + metadataLen > fileData.length) {
      throw new Error('파일이 손상되었습니다');
    }

    // Read metadata JSON
    const metadataBytes = fileData.slice(offset, offset + metadataLen);
    const metadataJson = new TextDecoder().decode(metadataBytes);
    const metadata = JSON.parse(metadataJson) as AxiaFileMetadata;
    offset += metadataLen;

    // Rest is snapshot
    const snapshot = fileData.slice(offset);

    return { metadata, snapshot };
  }

  /** Trigger browser download */
  private downloadFile(data: Uint8Array, fileName: string): void {
    const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
