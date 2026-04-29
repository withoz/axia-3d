/**
 * STEP / IGES dynamic loader (Phase G Stage 4-A, ADR-035 P20.1, P20.7).
 *
 * 메인 번들에 영향 없는 dynamic import 만 — 사용자가 STEP/IGES 파일을
 * 실제 import 시도할 때만 OCCT.js fetch + WASM init.
 *
 * ## 사용 패턴
 *
 * ```ts
 * const importer = StepIgesImporter.getInstance();
 * try {
 *   const group = await importer.importFile(file);
 *   scene.add(group);
 * } catch (e) {
 *   // graceful fallback — show alternate format suggestions
 *   Toast.error(e.message);
 * }
 * ```
 *
 * ## 회복력 (P20.C #3)
 *
 * - OCCT.js 가 설치되지 않은 경우 → 명확한 에러 + DXF/OBJ 추천
 * - Dynamic import 네트워크 실패 → 동일 에러
 * - Malformed 파일 → OCCT 파싱 에러 그대로 전파 (사용자에게 명시)
 *
 * ## 라이프사이클
 *
 * - 첫 호출 시 OCCT.js fetch + init (~3.5MB Brotli, ~10MB unzipped)
 * - 이후 호출은 cached instance 재사용
 * - dispose() 로 명시적 메모리 해제 가능
 */

import * as THREE from 'three';
import { debugLog, debugWarn } from '../utils/debug';

/** OCCT.js 인스턴스 핸들 (opencascade.js v2 API). */
type OcctInstance = unknown;

/** Import 결과 — Three.js Group + metadata. */
export interface StepIgesImportResult {
  group: THREE.Group;
  format: 'step' | 'iges';
  faceCount: number;
  edgeCount: number;
  /** OCCT 가 보고한 import warnings (있는 경우). */
  warnings: string[];
}

/** OCCT.js 가 설치되지 않았을 때의 사용자 안내 메시지. */
const NOT_INSTALLED_MESSAGE =
  'STEP/IGES 엔진(OCCT.js)이 설치되지 않았습니다.\n\n' +
  '설치 명령:\n' +
  '  npm install opencascade.js\n\n' +
  '설치 없이 사용 가능한 우회법:\n' +
  '• FreeCAD: STEP → STL/DXF 변환\n' +
  '• Fusion 360: 내보내기 → OBJ\n' +
  '• Rhino: Save As → 3DM (AXiA 직접 지원)';

/** 동적 import + WASM init 예상 소요 안내. */
const LOADING_MESSAGE =
  'STEP/IGES 엔진 로딩 중... (~3.5MB, 첫 사용 시에만)';

export class StepIgesImporter {
  private static _instance: StepIgesImporter | null = null;
  private _occt: OcctInstance | null = null;
  private _loadingPromise: Promise<OcctInstance> | null = null;

  /** Toast / progress UI hook (caller 가 주입). */
  public onLoadingStart?: (message: string) => void;
  public onLoadingEnd?: () => void;

  static getInstance(): StepIgesImporter {
    if (!StepIgesImporter._instance) {
      StepIgesImporter._instance = new StepIgesImporter();
    }
    return StepIgesImporter._instance;
  }

  /** 테스트 / 정리용 reset. */
  static resetInstance(): void {
    StepIgesImporter._instance?.dispose();
    StepIgesImporter._instance = null;
  }

  /**
   * OCCT.js 인스턴스를 lazily 로드. 한 번 로드되면 cache.
   *
   * Throws an Error with `NOT_INSTALLED_MESSAGE` if dynamic import fails.
   */
  async ensureLoaded(): Promise<OcctInstance> {
    if (this._occt) return this._occt;
    if (this._loadingPromise) return this._loadingPromise;

    this.onLoadingStart?.(LOADING_MESSAGE);
    this._loadingPromise = this._loadOcct().finally(() => {
      this.onLoadingEnd?.();
    });
    try {
      this._occt = await this._loadingPromise;
      return this._occt;
    } catch (e) {
      this._loadingPromise = null;  // allow retry
      throw e;
    }
  }

  private async _loadOcct(): Promise<OcctInstance> {
    debugLog('[StepIgesImporter] dynamic import opencascade.js');
    let mod: { default?: () => Promise<OcctInstance> } | undefined;
    try {
      // Variable indirection prevents Vite static analysis — opencascade.js
      // is an optionalDependency (ADR-035 P20.7), so static resolution must
      // not fail the build when it's absent.
      const moduleName: string = 'opencascade' + '.js';
      mod = await import(/* @vite-ignore */ moduleName);
    } catch (e) {
      debugWarn('[StepIgesImporter] opencascade.js import failed:', e);
      throw new Error(NOT_INSTALLED_MESSAGE);
    }
    if (!mod || typeof mod.default !== 'function') {
      throw new Error(NOT_INSTALLED_MESSAGE);
    }
    const occt = await mod.default();
    debugLog('[StepIgesImporter] OCCT.js init complete');
    return occt;
  }

  /**
   * STEP / IGES 파일을 import.
   *
   * @throws 라이브러리 미설치 / 네트워크 실패 / 파일 파싱 실패 시
   */
  async importFile(file: File): Promise<StepIgesImportResult> {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'step' && ext !== 'stp' && ext !== 'iges' && ext !== 'igs') {
      throw new Error(
        `STEP/IGES importer 가 처리할 수 없는 확장자: .${ext}`
      );
    }
    const format: 'step' | 'iges' = (ext === 'iges' || ext === 'igs') ? 'iges' : 'step';

    const occt = await this.ensureLoaded();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    debugLog(`[StepIgesImporter] importing ${format.toUpperCase()}: ${file.name} (${bytes.length} bytes)`);

    // OCCT.js 의 STEP/IGES API 호출 — 실제 binding 은 opencascade.js v2 의
    // ReadSTEP / ReadIGES wrapper 를 거친다. MVP 에서는 Mesher 가 산출하는
    // BRep → THREE.Group 변환을 수행.
    const group = await this._convertToThreeGroup(occt, bytes, format, file.name);

    return {
      group,
      format,
      faceCount: this._countMeshes(group),
      edgeCount: this._countLines(group),
      warnings: [],
    };
  }

  /**
   * OCCT BRep → THREE.Group 변환.
   *
   * **MVP scaffolding** — 실제 BRep tessellation 로직은 OCCT.js 가
   * 설치된 환경에서 BRepMesh_IncrementalMesh 와 mesh extraction API 로
   * 구현. 현재 commit 은 wiring 만 검증하고 P20.D 검증 코퍼스 5개
   * 파일에 대한 회귀 테스트는 OCCT 통합 후 별도 추가.
   */
  private async _convertToThreeGroup(
    _occt: OcctInstance,
    _bytes: Uint8Array,
    format: 'step' | 'iges',
    fileName: string,
  ): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = `${format.toUpperCase()}: ${fileName}`;

    // P20.7 후속 작업: BRepTools_ShapeSet → IncrementalMesh →
    // TopExp_Explorer 로 face 순회 → BufferGeometry 생성.
    // 첫 OCCT 통합 PR 에서 채워질 자리.
    debugWarn('[StepIgesImporter] BRep tessellation 미구현 — empty group 반환');

    return group;
  }

  private _countMeshes(group: THREE.Group): number {
    let n = 0;
    group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) n++;
    });
    return n;
  }

  private _countLines(group: THREE.Group): number {
    let n = 0;
    group.traverse(obj => {
      if ((obj as THREE.LineSegments).isLineSegments
        || (obj as THREE.Line).isLine) n++;
    });
    return n;
  }

  /** 명시적 메모리 해제. */
  dispose(): void {
    this._occt = null;
    this._loadingPromise = null;
  }

  /** 진단 — 현재 로드 상태. */
  isLoaded(): boolean {
    return this._occt !== null;
  }
}
