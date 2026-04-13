/**
 * FileManager — Scene Save/Load (.axia binary format)
 *
 * Handles saving and loading AXiA 3D project files.
 * Format: Binary snapshot from WASM engine with metadata.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { Toast } from '../ui/Toast';
import { Material } from '../materials/MaterialLibrary';

const AXIA_MAGIC = 0x41584941;  // 'AXIA' in ASCII
const AXIA_VERSION = 2;  // Bumped version to support materials

export interface AxiaFileMetadata {
  version: number;
  timestamp: string;
  name: string;
  materials?: Material[];  // Serialized materials (v2+)
}

export class FileManager {
  private bridge: WasmBridge;
  private currentFileName: string = 'untitled.xia';
  private materialLibrary: any = null;  // MaterialLibrary reference

  constructor(bridge: WasmBridge) {
    this.bridge = bridge;
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

      console.log(`[FileManager] 프로젝트 저장 중: ${this.currentFileName}`);

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
          console.log(`[FileManager] 재질 ${customMaterials.length}개 저장됨`);
        }
      }

      // Combine metadata + snapshot into single file
      const fileData = this.createAxiaFile(metadata, snapshotData);

      // Trigger download
      this.downloadFile(fileData, this.currentFileName);
      Toast.success(`저장 완료: ${this.currentFileName}`);
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

        console.log('[FileManager] 프로젝트 열기 대화 표시');

        input.addEventListener('change', async (event) => {
          const files = (event.target as HTMLInputElement).files;
          const file = files?.[0];

          try {
            document.body.removeChild(input);
          } catch (e) {
            // 이미 제거된 경우 무시
          }

          if (!file) {
            console.log('[FileManager] 파일 선택 취소됨');
            resolve(false);
            return;
          }

          try {
            console.log(`[FileManager] 파일 선택됨: ${file.name}`);
            this.currentFileName = file.name;

            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            const fileData = new Uint8Array(arrayBuffer);

            // Parse AXIA file format
            const { metadata, snapshot } = this.parseAxiaFile(fileData);

            console.log('[FileManager] 메타데이터:', metadata);
            console.log(`[FileManager] 스냅샷 크기: ${snapshot.length} bytes`);

            // Restore custom materials if available
            if (metadata.materials && this.materialLibrary && typeof this.materialLibrary.addCustom === 'function') {
              for (const material of metadata.materials) {
                try {
                  this.materialLibrary.addCustom(material);
                  console.log(`[FileManager] 재질 복원: ${material.name}`);
                } catch (err) {
                  console.warn(`[FileManager] 재질 복원 실패: ${material.name}`, err);
                }
              }
            }

            // Load snapshot into engine
            const success = this.bridge.importSnapshot(snapshot);
            if (success) {
              Toast.success(`로드 완료: ${this.currentFileName}`);
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
        });

        input.addEventListener('cancel', () => {
          console.log('[FileManager] 파일 선택 대화 취소됨');
          try {
            document.body.removeChild(input);
          } catch (e) {
            // 무시
          }
          resolve(false);
        });

        // Trigger file picker
        setTimeout(() => {
          try {
            input.click();
          } catch (e) {
            console.error('[FileManager] 파일 선택 대화 실패:', e);
            try {
              document.body.removeChild(input);
            } catch (ex) {
              // 무시
            }
            resolve(false);
          }
        }, 50);
      } catch (err) {
        console.error('[FileManager] 파일 선택 대화 생성 실패:', err);
        resolve(false);
      }
    });
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
