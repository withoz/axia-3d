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
import { traverseBrep, type BRepTraversalResult } from './occtBrepTraversal';
import {
  tessellateShape,
  tessellateEdges,
  type FaceTessellation,
  type EdgeTessellation,
} from './occtTessellate';

/** OCCT.js 인스턴스 핸들 (opencascade.js v2 API). */
type OcctInstance = unknown;

/**
 * Per-face metadata side-table entry (ADR-126 β).
 *
 * ADR-126 (Amendment 2 of ADR-122 α-2) refactor: per-face metadata moved
 * from per-face Three.js `Group.userData` to *single shared side-table*
 * indexed by W-δ traversal stable index. Drawcalls collapse from
 * N (face Mesh × 2 front+back) → 2 (faces-front + faces-back merged Mesh).
 *
 * The side-table is stored on the *parent import Group*:
 *   `importGroup.userData.faceMetadata: Map<number, FaceMetadata>`
 *
 * **Indices into the merged BufferGeometry** (allow future per-face
 * picking / hover / inspection without per-face Mesh objects):
 * - `vertStart` / `vertCount`: range in merged `position` / `normal` arrays
 * - `indexStart` / `indexCount`: range in merged `index` array
 *
 * **Backward compat**: `faceIndex` matches W-δ traversal stable index
 * (ADR-081 W-δ + ADR-083 T-γ + ADR-084 E-γ + ADR-086 O-δ canonical).
 */
export interface FaceMetadata {
  /** W-δ stable index from OCCT BRep traversal (ADR-081 W-δ). */
  faceIndex: number;
  /** ADR-081 W-γ surface promotion result, if any. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  surface?: any;
  /** ADR-086 O-δ — boundary polygon for axia DCEL inject (Float32Array xyz). */
  boundaryPolygon?: Float32Array;
  /**
   * ADR-086 O-δ — axia FaceId.raw() after `injectIntoAxia` success.
   * Populated by `injectIntoAxia`; undefined before inject.
   */
  axiaFaceId?: number;
  /** Vertex start offset in merged BufferGeometry positions. */
  vertStart: number;
  /** Vertex count (positions = vertCount × 3 floats). */
  vertCount: number;
  /** Index start offset in merged BufferGeometry index. */
  indexStart: number;
  /** Triangle index count. */
  indexCount: number;
}

/** Import 결과 — Three.js Group + metadata. */
export interface StepIgesImportResult {
  group: THREE.Group;
  format: 'step' | 'iges';
  faceCount: number;
  edgeCount: number;
  /** OCCT 가 보고한 import warnings (있는 경우). */
  warnings: string[];
  /**
   * W-δ BRep traversal 결과 — face/edge 별 promoted analytic surface/curve
   * + stable index. caller (W-η UI integration) 가 axia FaceId / EdgeId
   * 로 매핑.
   *
   * Optional — OCCT.js 미설치 / shape 추출 실패 시 undefined.
   */
  traversal?: BRepTraversalResult;
}

/**
 * ADR-086 O-δ — `StepIgesImporter.injectIntoAxia` result.
 *
 * Map of `traversalIndex` (W-δ stable) → axia `FaceId.raw()`. Caller
 * (FileImporter) 가 사용자 facing pick / engine ops 시 활용.
 */
export interface InjectIntoAxiaResult {
  /** Map of W-δ traversal stable index → axia FaceId.raw(). */
  faceIndexToAxiaId: Map<number, number>;
  /** Per-face inject warnings (P21.7 답습). */
  warnings: string[];
}

/**
 * Minimal bridge interface for ADR-086 O-δ inject dispatch — duck-typed
 * subset of `WasmBridge`. Caller 가 의존성 주입.
 */
export interface InjectBridge {
  injectExternalFaceNoSurface?(positionsXyz: Float64Array): number;
  injectExternalFacePlane?(
    positionsXyz: Float64Array,
    origin: [number, number, number],
    normal: [number, number, number],
    basisU: [number, number, number],
  ): number;
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

  /**
   * ADR-085 P-β — Stage progress callback (user-facing wait time
   * visibility, Drift #5 perception 개선).
   *
   * `importFile` 도중 stage 별로 fire:
   * - `engine_load`: OCCT chunk fetch + initOpenCascade + libs
   *   (~180s, Drift #5 본체)
   * - `parse`: STEP/IGES file parse + traverseBrep (~5s)
   * - `tessellate`: BRepMesh + Three.js Mesh/Edge 생성 (~5-30s)
   *
   * `onLoadingStart` / `onLoadingEnd` 는 backward compat 유지 —
   * `engine_load` stage 의 시작 / 끝 에서 자동 fire.
   */
  public onStage?: (
    stage: 'engine_load' | 'parse' | 'tessellate',
    message: string,
  ) => void;

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

    // ADR-085 P-β — engine_load stage 시작 (Drift #5 ~180s 본체).
    // Backward compat: onLoadingStart 도 동일 시점에 fire.
    this.onLoadingStart?.(LOADING_MESSAGE);
    this.onStage?.('engine_load', LOADING_MESSAGE);
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
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let mod: any | undefined;
    try {
      // ADR-082 C-ε amendment (drift #3 fix):
      //   기존 `/* @vite-ignore */ moduleName` 동적 string 패턴 (ADR-035
      //   P20.7) 은 Vite 의 import 분석을 차단 → opencascade-deps chunk
      //   미생성 → browser dynamic import resolve 실패. 사용자 결재 (ADR-082
      //   §3.5 amendment, 2026-05-08) 로 literal specifier 로 변경.
      //
      //   효과:
      //   - Vite 가 'opencascade-deps' lazy chunk 생성 → browser 정상 로드
      //   - opencascade.js 가 dependencies 로 승격 (build-time required)
      //   - --no-optional install 시나리오 미지원 (이전 의도 무효임이 drift
      //     #3 으로 확인됨)
      //   - Initial bundle 0MB strict 유지 (P20.C #2) — lazy chunk 만 추가
      mod = await import('opencascade.js');
    } catch (e) {
      debugWarn('[StepIgesImporter] opencascade.js import failed:', e);
      throw new Error(NOT_INSTALLED_MESSAGE);
    }
    if (!mod) {
      throw new Error(NOT_INSTALLED_MESSAGE);
    }
    // ADR-082 C-γ wrapper drift #1 fix:
    //   opencascade.js v2 의 entry 는 `initOpenCascade(settings)` 임 — 우리
    //   초기 코드의 `mod.default()` 가정은 잘못. 53 mock 회귀가 false
    //   positive 였던 구체 사례. (P21.7 typed warnings 정합 — fatal 아닌
    //   명확 진단 메시지로 throw.)
    //
    // Settings 정책 (web-bundler 환경):
    //   - `libs` 미지정 시 기본 module set 으로 로드 (web bundler 가
    //     `.wasm` URL 자동 해결).
    //   - Node test 환경은 별도 wrapping 필요 (C-δ Playwright 또는 별도
    //     ADR 에서 처리).
    const initFn = mod.initOpenCascade ?? mod.default;
    if (typeof initFn !== 'function') {
      throw new Error(
        `${NOT_INSTALLED_MESSAGE}\n\n` +
        '(진단: opencascade.js 패키지에서 initOpenCascade entry 를 찾지 못함 — ' +
        '버전 호환성 issue 의심. ADR-082 L1 lock-in semver caret 범위 확인.)',
      );
    }
    // initOpenCascade signature: settings { mainJS, mainWasm, libs, module }.
    //
    // **C-ε wrapper drift #4 fix**: STEP/IGES API 는 dynamic library
    // (TKSTEP/TKIGES/etc.) 로딩 필요 — `libs: []` default 면 base 만
    // 로드되어 `STEPControl_Reader_1` 등 API 부재. ocDataExchangeBase
    // + ocDataExchangeExtra 가 STEP/IGES bundle. ocCore + ocModelingAlgorithms
    // 도 BRep / topology 전체 지원에 필요.
    //
    // **ADR-121 α Finding #2 fix (사용자 시연 evidence 2026-05-17)**:
    // `ocVisualApplication` 추가 필수 — TKLCAF (Light CAF) 가 포함된
    // bundle. ocDataExchangeBase 의 XCAF (Extended CAF for STEP color/
    // layer attributes) 가 `TDF_Attribute` (TKLCAF) 를 참조. 미로딩 시
    // `Assertion failed: bad export type for '_ZTI13TDF_Attribute':
    // undefined` 발생 → STEP import 완전 실패.
    //
    // 사용자 시연 (2026-05-17) console error 로 직접 확인:
    //   [18:31:37] Assertion failed: bad export type for
    //   `_ZTI13TDF_Attribute`: undefined
    //   [18:31:37] Unhandled promise: abort(...)
    //
    // ADR-119 γ-7 pre-warm 의 silent failure root cause. 본 fix 후
    // STEP import production-ready.
    //
    // **ADR-121 Amendment 1 (사용자 2차 시연 evidence 2026-05-17, 19:02)**:
    // `ocVisualApplication` 추가만으로 부족 — **load order critical**.
    // opencascade.js README canonical order:
    //   ocCore → ocModelingAlgorithms → ocVisualApplication →
    //   ocDataExchangeBase → ocDataExchangeExtra
    // dataExchange 가 visualApplication 의 TDF_Attribute 참조하므로
    // visualApplication 이 *사전* 로드 필수. 잘못된 sequence 시 동일
    // assertion 재발.
    //
    // Fix: ocVisualApplication 을 dataExchange 그룹 *앞* 으로 이동.
    const occt = await initFn.call(mod, {
      libs: [
        // ADR-121 Amendment 1: canonical sequence (opencascade.js README)
        mod.ocCore,
        mod.ocModelingAlgorithms,
        mod.ocVisualApplication, // ← MUST BE BEFORE dataExchange (TDF_Attribute)
        mod.ocDataExchangeBase,
        mod.ocDataExchangeExtra,
      ],
    });
    debugLog('[StepIgesImporter] OCCT.js init complete');
    return occt;
    /* eslint-enable @typescript-eslint/no-explicit-any */
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

    // ADR-085 P-β — parse stage 시작 (engine_load 완료 후, ~5s 소요).
    this.onStage?.('parse', '파일 분석 중...');

    // OCCT.js 의 STEP/IGES API 호출 — 실제 binding 은 opencascade.js v2 의
    // STEPControl_Reader / IGESControl_Reader 를 거친다.
    const shape = await this._readShape(occt, bytes, format);

    // W-δ — BRep traversal + face/edge index promotion (ADR-081 §3.4).
    // shape 가 추출되면 traverseBrep 으로 face/edge 별 AnalyticSurface /
    // AnalyticCurve 활성화. shape === null 이면 traversal 미수행.
    let traversal: BRepTraversalResult | undefined;
    const warnings: string[] = [];
    if (shape) {
      traversal = traverseBrep(occt, shape);
      warnings.push(...traversal.warnings);
    } else {
      warnings.push('STEP/IGES shape 추출 실패 — traversal 건너뜀');
    }

    // ADR-085 P-β — tessellate stage 시작 (~5-30s 소요).
    this.onStage?.('tessellate', 'Mesh 생성 중...');

    // ADR-083 T-γ — BRepMesh tessellation + Three.js BufferGeometry 생성.
    // shape 가 추출되면 face 별 Mesh 를 group 에 채워서 viewport 표시.
    const { group, tessellationWarnings } = this._convertToThreeGroup(
      occt,
      shape,
      format,
      file.name,
    );
    warnings.push(...tessellationWarnings);

    return {
      group,
      format,
      faceCount: traversal?.faces.length ?? this._countMeshes(group),
      edgeCount: traversal?.edges.length ?? this._countLines(group),
      warnings,
      traversal,
    };
  }

  /**
   * STEP / IGES bytes → TopoDS_Shape (graceful failure).
   *
   * **W-δ scope**: OCCT.js v2 의 `STEPControl_Reader_1` /
   * `IGESControl_Reader_1` + Emscripten FS 사용. 실패 (reader API 미존재 /
   * malformed file 등) 시 `null` 반환 — caller 는 traversal 생략 + warning
   * 누적 (P21.7 정합).
   */
  private async _readShape(
    occt: OcctInstance,
    bytes: Uint8Array,
    format: 'step' | 'iges',
  ): Promise<unknown | null> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const o = occt as any;
    try {
      const fs = o?.FS;
      if (!fs) {
        debugWarn('[StepIgesImporter] OCCT FS unavailable — cannot stage file');
        return null;
      }
      const filename = format === 'step' ? '/input.step' : '/input.iges';
      // writeFile / createDataFile wrapper version-tolerant
      if (typeof fs.writeFile === 'function') {
        fs.writeFile(filename, bytes);
      } else if (typeof fs.createDataFile === 'function') {
        fs.createDataFile('/', filename.slice(1), bytes, true, true, true);
      } else {
        debugWarn('[StepIgesImporter] OCCT FS write API unavailable');
        return null;
      }
      const ReaderCtor = format === 'step'
        ? (o.STEPControl_Reader_1 ?? o.STEPControl_Reader)
        : (o.IGESControl_Reader_1 ?? o.IGESControl_Reader);
      if (!ReaderCtor) {
        debugWarn(`[StepIgesImporter] ${format} reader ctor missing`);
        return null;
      }
      const reader = new ReaderCtor();
      reader.ReadFile?.(filename);
      reader.TransferRoots?.();
      const shape = reader.OneShape?.();
      if (!shape || shape.IsNull?.()) {
        debugWarn('[StepIgesImporter] OneShape() returned null/empty');
        return null;
      }
      return shape;
    } catch (e) {
      debugWarn('[StepIgesImporter] _readShape failed:', e);
      return null;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  /**
   * OCCT BRep → THREE.Group 변환 (ADR-083 T-γ).
   *
   * `tessellateShape` (T-β) 의 per-face buffer 결과 를 Three.js
   * BufferGeometry + Mesh 로 변환. ADR-046 default two-tone 재질 적용
   * (외부 #e8e8e8, 내부 #9898b4).
   *
   * **Failure modes** (P21.7 답습):
   * - shape null → empty group + warning, fatal 아님
   * - per-face geometry 생성 실패 → face-level warning, 다른 face 계속
   * - tessellation 결과 빈 buffer (NbNodes=0) → mesh 없이 skip
   *
   * @returns `{ group, tessellationWarnings }` — caller (importFile)
   *   가 warnings 통합
   */
  private _convertToThreeGroup(
    occt: OcctInstance,
    shape: unknown,
    format: 'step' | 'iges',
    fileName: string,
  ): { group: THREE.Group; tessellationWarnings: string[] } {
    const group = new THREE.Group();
    group.name = `${format.toUpperCase()}: ${fileName}`;

    if (!shape) {
      const reason = 'shape null — tessellation 건너뜀';
      debugWarn(`[StepIgesImporter] ${reason}`);
      return { group, tessellationWarnings: [reason] };
    }

    // T-β tessellateShape 호출 (ADR-083 §3.2).
    const tess = tessellateShape(occt, shape);
    debugLog(
      `[StepIgesImporter] tessellation: ${tess.faces.length} faces, ` +
      `${tess.warnings.length} warning(s)`,
    );

    // ADR-046 two-tone — 외부 standard 재질 + 내부 dimmed 재질.
    // ADR-018: closed solid 의 wall 은 two-tone, open mesh 의 sheet 는
    // 양면 white. STEP 의 import 결과는 default 로 closed solid 가정 —
    // 향후 ADR 에서 volumeFlags 활용 정밀화.
    const frontMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      side: THREE.FrontSide,
      roughness: 0.6,
      metalness: 0.1,
    });
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x9898b4,
      side: THREE.BackSide,
      roughness: 0.7,
      metalness: 0.05,
    });

    // ──────────────────────────────────────────────────────────────
    // ADR-126 β — Merged BufferGeometry pattern (ADR-122 α-2 pivot).
    //
    // Previous (per LOCKED #55 / ADR-125 audit): N face = N×2 Mesh + N
    // BufferGeometry (each face had own Group{front+back Mesh}). For
    // STEP 500 face import: 1000 drawcalls.
    //
    // Now: collapse to 2 Mesh (front+back) sharing ONE merged
    // BufferGeometry. Per-face metadata moves to side-table
    // `group.userData.faceMetadata: Map<faceIndex, FaceMetadata>` —
    // includes `vertStart`/`vertCount`/`indexStart`/`indexCount` for
    // future per-face picking via geometry sub-range.
    //
    // Drawcalls: N×2 → 2 (e.g., STEP 500 face: 1000 → 2 = **500×
    // 감소**, ADR-122 Amendment 2 hotspot D 본질 해소).
    //
    // **Edges sub-group UNCHANGED** — ADR-084 E-γ per-edge LineSegments
    // pattern preserved (edges are typically << faces, and per-edge
    // hover/selection needs edge-level entity).
    // ──────────────────────────────────────────────────────────────
    const mergeResult = this._mergeFacesIntoSingleGeometry(tess.faces, tess.warnings);
    if (mergeResult.geometry) {
      const frontMesh = new THREE.Mesh(mergeResult.geometry, frontMat);
      frontMesh.name = 'faces-front';
      const backMesh = new THREE.Mesh(mergeResult.geometry, backMat);
      backMesh.name = 'faces-back';
      group.add(frontMesh);
      group.add(backMesh);
    }
    // Side-table always attached (even when empty) for downstream code
    // to find via uniform path. Edges (ADR-084 E-γ) iterate separately.
    group.userData.faceMetadata = mergeResult.metadata;

    // ADR-084 E-γ — BRep edge wireframe rendering.
    // BRepMesh_IncrementalMesh 가 이미 적용된 shape 위에 Polygon3D 추출 →
    // edges sub-group 으로 group 에 추가. ADR-018 정책 답습 (LineMaterial
    // #333366 일관).
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x333366 });
    const edgeTess = tessellateEdges(occt, shape);
    if (edgeTess.edges.length > 0) {
      const edgesGroup = new THREE.Group();
      edgesGroup.name = 'edges';
      for (const edge of edgeTess.edges) {
        try {
          const lineSeg = this._edgeToLine(edge, edgeMat);
          if (lineSeg) {
            edgesGroup.add(lineSeg);
          }
        } catch (e) {
          edgeTess.warnings.push(`edge[${edge.index}] line 생성: ${String(e)}`);
        }
      }
      if (edgesGroup.children.length > 0) {
        group.add(edgesGroup);
      }
    }
    // edge tessellation warnings → caller 에 통합
    for (const w of edgeTess.warnings) {
      tess.warnings.push(w);
    }

    return { group, tessellationWarnings: tess.warnings };
  }

  /**
   * Per-edge EdgeTessellation → Three.js LineSegments (ADR-084 E-γ).
   *
   * 빈 buffer (positions.length === 0) 은 null 반환 — caller 가 skip.
   * userData.edgeIndex (W-δ stable index 답습) — caller (W-η downstream)
   * 가 axia EdgeId 매핑 시 활용.
   */
  private _edgeToLine(
    edge: EdgeTessellation,
    edgeMat: THREE.Material,
  ): THREE.LineSegments | null {
    if (edge.positions.length === 0 || edge.indices.length === 0) {
      return null;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(edge.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(edge.indices, 1));
    geom.computeBoundingSphere();

    const lineSeg = new THREE.LineSegments(geom, edgeMat);
    lineSeg.name = `edge-${edge.index}`;
    lineSeg.userData.edgeIndex = edge.index;
    return lineSeg;
  }

  /**
   * ADR-126 β — Merge N face tessellations into single shared BufferGeometry
   * + side-table `Map<faceIndex, FaceMetadata>`.
   *
   * **Drawcall reduction**: N×2 (per-face Group{front+back Mesh}) → 2
   * (faces-front + faces-back merged Mesh sharing geometry).
   *
   * **Per-face metadata**: moved from `Group.userData` per face to
   * shared `Map<faceIndex, FaceMetadata>` indexed by W-δ stable index.
   * Includes `vertStart`/`vertCount`/`indexStart`/`indexCount` for
   * potential future per-face picking via geometry sub-range.
   *
   * **Normal computation**:
   * - If all faces have non-zero normals → use as-is (concatenate)
   * - If any face has zero-fill normals → `computeVertexNormals()`
   *   on merged geometry (matches previous per-face fallback semantics)
   *
   * **Index offsetting**: per-face indices rebased to merged vertex
   * offsets. `Uint32Array` (not Uint16) — safe for >65K vertices.
   *
   * @param faces - tessellation results from `tessellateShape`
   * @param warnings - mutated; per-face errors appended
   * @returns `{ geometry, metadata }` — geometry is `null` if all faces
   *   skipped (empty/invalid); metadata is always a Map (possibly empty).
   */
  private _mergeFacesIntoSingleGeometry(
    faces: FaceTessellation[],
    warnings: string[],
  ): { geometry: THREE.BufferGeometry | null; metadata: Map<number, FaceMetadata> } {
    const metadata = new Map<number, FaceMetadata>();

    // First pass: count totals + filter valid faces.
    let totalVerts = 0;
    let totalIndices = 0;
    let anyZeroFillNormals = false;
    const validFaces: FaceTessellation[] = [];

    for (const face of faces) {
      try {
        if (face.positions.length === 0 || face.indices.length === 0) {
          continue;
        }
        if (face.positions.length % 3 !== 0) {
          warnings.push(`face[${face.index}] mesh 생성: positions length not multiple of 3`);
          continue;
        }
        const vertCount = face.positions.length / 3;
        // Detect zero-fill normals (HasNormals=false) — triggers fallback
        // computeVertexNormals on merged geometry (matches legacy behavior).
        if (face.normals.length === face.positions.length) {
          const hasNonZeroNormal = face.normals.some(v => v !== 0);
          if (!hasNonZeroNormal) {
            anyZeroFillNormals = true;
          }
        } else {
          // Length mismatch → fallback needed
          anyZeroFillNormals = true;
        }
        totalVerts += vertCount;
        totalIndices += face.indices.length;
        validFaces.push(face);
      } catch (e) {
        warnings.push(`face[${face.index}] mesh 생성: ${String(e)}`);
      }
    }

    if (validFaces.length === 0) {
      return { geometry: null, metadata };
    }

    // Second pass: allocate merged buffers + copy.
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);
    let vertOffset = 0;
    let indexOffset = 0;

    for (const face of validFaces) {
      const vertCount = face.positions.length / 3;
      const vertStart = vertOffset;
      const indexStart = indexOffset;
      const indexCount = face.indices.length;

      // Copy positions.
      positions.set(face.positions, vertOffset * 3);

      // Copy normals — if length matches, otherwise leave as zero
      // (computeVertexNormals fallback will replace).
      if (face.normals.length === face.positions.length) {
        normals.set(face.normals, vertOffset * 3);
      }
      // else: zero-filled, fallback runs below

      // Copy indices with vertex offset rebase.
      for (let i = 0; i < indexCount; i++) {
        indices[indexOffset + i] = face.indices[i] + vertOffset;
      }

      // Side-table entry.
      const meta: FaceMetadata = {
        faceIndex: face.index,
        vertStart,
        vertCount,
        indexStart,
        indexCount,
      };
      if (face.surface) meta.surface = face.surface;
      if (face.boundaryPolygon && face.boundaryPolygon.length > 0) {
        meta.boundaryPolygon = face.boundaryPolygon;
      }
      metadata.set(face.index, meta);

      vertOffset += vertCount;
      indexOffset += indexCount;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    if (anyZeroFillNormals) {
      // Fallback: compute on merged geometry. Slight semantic shift —
      // previously per-face computeVertexNormals; now merged. Should
      // produce identical visual result (geometry is just concatenated).
      geom.computeVertexNormals();
    }
    geom.computeBoundingSphere();

    return { geometry: geom, metadata };
  }

  // ════════════════════════════════════════════════════════════════
  // ADR-086 O-δ — Axia DCEL Injection
  // ════════════════════════════════════════════════════════════════

  /**
   * Inject all face boundaries from imported group into axia DCEL.
   *
   * **ADR-126 β refactor**: reads from `group.userData.faceMetadata`
   * (side-table `Map<faceIndex, FaceMetadata>`) instead of walking
   * `group.children` for `face-N` Group children. Per-face metadata
   * (surface, boundaryPolygon, axiaFaceId) lives in the side-table —
   * the imported group now has only `faces-front` + `faces-back` Mesh
   * (merged geometry) + `edges` sub-Group.
   *
   * Stores returned axia `FaceId.raw()` back into the side-table entry
   * (`meta.axiaFaceId = ...`) — caller can iterate `faceMetadata` map
   * to find the mapping.
   *
   * **Surface kind dispatch** (unchanged):
   * - `Plane` → `injectExternalFacePlane(positions, origin, normal, basisU)`
   * - 그 외 (Tessellate / Cylinder / Sphere / 기타) → `injectExternalFaceNoSurface(positions)`
   *
   * **Failure modes** (P21.7 답습, unchanged):
   * - bridge inject 메서드 미존재 → graceful skip + warning
   * - boundaryPolygon 부재 (length 0) → skip face + warning
   * - inject 반환값 -1 → skip face + warning (axia DCEL 거부)
   * - **NEW**: faceMetadata side-table 부재 → empty result + warning
   *   (legacy callers that pass non-ADR-126 groups)
   *
   * @param bridge - WasmBridge 또는 minimal subset (InjectBridge)
   * @param group - importFile 결과의 Three.js Group (ADR-126 side-table)
   * @returns `{ faceIndexToAxiaId, warnings }` — caller 가 사용자 facing
   *   pick UX / engine ops 시 활용
   */
  injectIntoAxia(
    bridge: InjectBridge,
    group: THREE.Group,
  ): InjectIntoAxiaResult {
    const result: InjectIntoAxiaResult = {
      faceIndexToAxiaId: new Map(),
      warnings: [],
    };

    const metadata = group.userData.faceMetadata as Map<number, FaceMetadata> | undefined;
    if (!metadata) {
      result.warnings.push(
        'No faceMetadata side-table found on group — was this group built by ADR-126 _convertToThreeGroup?',
      );
      return result;
    }

    for (const [faceIndex, meta] of metadata) {
      const boundaryPolygon = meta.boundaryPolygon;
      const surface = meta.surface;

      if (!boundaryPolygon || boundaryPolygon.length < 9) {
        result.warnings.push(
          `face[${faceIndex}]: missing/insufficient boundaryPolygon — inject skipped`,
        );
        continue;
      }

      // Convert Float32Array to Float64Array for WASM (Rust expects f64).
      const positions64 = new Float64Array(boundaryPolygon);

      let axiaFaceId = -1;
      try {
        if (surface && surface.kind === 'Plane' && bridge.injectExternalFacePlane) {
          // Compute basis_u from normal (any perpendicular direction works).
          // For simplicity: pick world X if normal isn't parallel, else Y.
          const normal: [number, number, number] = surface.normal;
          let basisU: [number, number, number] = [1, 0, 0];
          // |normal · X| > 0.9 면 X 와 거의 평행 → Y 사용
          if (Math.abs(normal[0]) > 0.9) basisU = [0, 1, 0];
          // Project basis_u onto plane (Gram-Schmidt 단순화)
          const dot = basisU[0] * normal[0] + basisU[1] * normal[1] + basisU[2] * normal[2];
          basisU = [
            basisU[0] - dot * normal[0],
            basisU[1] - dot * normal[1],
            basisU[2] - dot * normal[2],
          ];
          const len = Math.sqrt(basisU[0] ** 2 + basisU[1] ** 2 + basisU[2] ** 2);
          if (len > 1e-9) {
            basisU = [basisU[0] / len, basisU[1] / len, basisU[2] / len];
          }
          axiaFaceId = bridge.injectExternalFacePlane(
            positions64,
            surface.origin as [number, number, number],
            normal,
            basisU,
          );
        } else if (bridge.injectExternalFaceNoSurface) {
          // Fallback: no analytic surface (Tessellate / unsupported variant)
          axiaFaceId = bridge.injectExternalFaceNoSurface(positions64);
        } else {
          result.warnings.push(
            `face[${faceIndex}]: bridge inject methods unavailable`,
          );
          continue;
        }
      } catch (e) {
        result.warnings.push(`face[${faceIndex}] inject: ${String(e)}`);
        continue;
      }

      if (axiaFaceId < 0) {
        result.warnings.push(
          `face[${faceIndex}]: bridge inject returned -1 (DCEL rejected)`,
        );
        continue;
      }

      // ADR-126 β — store back into side-table (NOT per-face userData,
      // since per-face Group no longer exists).
      meta.axiaFaceId = axiaFaceId;
      result.faceIndexToAxiaId.set(faceIndex, axiaFaceId);
    }

    debugLog(
      `[StepIgesImporter] injectIntoAxia: ${result.faceIndexToAxiaId.size} faces injected, ` +
      `${result.warnings.length} warning(s)`,
    );
    if (result.warnings.length > 0) {
      debugWarn('[StepIgesImporter] inject warnings:', result.warnings.slice(0, 3));
    }

    return result;
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
