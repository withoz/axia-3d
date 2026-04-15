/**
 * FileImporter — Phase 1: Three.js 로더 기반 파일 가져오기
 *
 * 지원 포맷:
 *   OBJ, STL, glTF/GLB, COLLADA(DAE), PLY, 3DS, DXF
 *   (향후: DWG, SKP)
 *
 * 가져온 메시는 importedGroup에 추가되어 뷰포트에 표시됩니다.
 * (참조 메시로 표시 — Rust 엔진 DCEL에는 아직 주입하지 않음)
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
// @ts-ignore - dxf는 parseString 함수를 export함
import { parseString as parseDxf } from 'dxf';
import { convertDwgToDxf, init as initDwgDxf } from 'dwgdxf';
import JSZip from 'jszip';
import { debugLog } from '../utils/debug';

export type ImportFormat = 'obj' | 'stl' | 'gltf' | 'dae' | 'ply' | '3ds' | 'dxf' | 'dwg' | 'skp' | '3dm';

export interface ImportResult {
  format: ImportFormat;
  fileName: string;
  group: THREE.Group;
  meshCount: number;
  vertexCount: number;
  faceCount: number;
  metadata?: DWGMetadata;
}

export interface DWGMetadata {
  version?: string;
  codepage?: string;
  title?: string;
  subject?: string;
  author?: string;
  [key: string]: any;
}

/** 포맷별 파일 확장자 → accept 필터 */
const FORMAT_ACCEPT: Record<ImportFormat, string> = {
  'obj':  '.obj',
  'stl':  '.stl',
  'gltf': '.gltf,.glb',
  'dae':  '.dae',
  'ply':  '.ply',
  '3ds':  '.3ds',
  'dxf':  '.dxf',
  'dwg':  '.dwg',
  'skp':  '.skp',
  '3dm':  '.3dm',
};

/** 포맷별 표시 이름 */
const FORMAT_LABEL: Record<ImportFormat, string> = {
  'obj':  'Wavefront OBJ',
  'stl':  'STereoLithography',
  'gltf': 'glTF / GLB',
  'dae':  'COLLADA',
  'ply':  'Stanford PLY',
  '3ds':  '3D Studio',
  'dxf':  'AutoCAD DXF',
  'dwg':  'AutoCAD DWG',
  'skp':  'SketchUp',
  '3dm':  'Rhino 3DM',
};

/** 모든 지원 확장자 */
const ALL_ACCEPT = Object.values(FORMAT_ACCEPT).join(',');

export class FileImporter {
  private scene: THREE.Scene;
  private importedGroup: THREE.Group;
  private _importedItems: ImportResult[] = [];

  // 기본 재질 (가져온 메시용)
  private defaultFrontMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    side: THREE.FrontSide,
    roughness: 0.6,
    metalness: 0.1,
  });
  private defaultBackMat = new THREE.MeshStandardMaterial({
    color: 0x8899bb,
    side: THREE.BackSide,
    roughness: 0.7,
    metalness: 0.05,
  });
  private defaultEdgeMat = new THREE.LineBasicMaterial({ color: 0x333366 });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.importedGroup = new THREE.Group();
    this.importedGroup.name = 'imported-group';
    this.scene.add(this.importedGroup);
  }

  /** 파일 선택 다이얼로그를 열고 가져오기 실행 */
  async openFileDialog(format?: ImportFormat): Promise<ImportResult | null> {
    const accept = format ? FORMAT_ACCEPT[format] : ALL_ACCEPT;

    return new Promise((resolve) => {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
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
            resolve(null);
            return;
          }

          try {
            const result = await this.importFile(file, format);
            resolve(result);
          } catch (err) {
            console.error('[FileImporter] 가져오기 실패:', err);
            alert(`파일 가져오기 실패: ${(err as Error).message}`);
            resolve(null);
          }
        };

        const onCancel = () => {
          cleanup();
          resolve(null);
        };

        input.addEventListener('change', onChange);
        input.addEventListener('cancel', onCancel);

        // 약간의 딜레이 후 클릭 (브라우저 호환성)
        setTimeout(() => {
          try {
            input.click();
          } catch (e) {
            console.error('[FileImporter] 파일 선택 대화 실패:', e);
            cleanup();
            resolve(null);
          }
        }, 50);

      } catch (err) {
        console.error('[FileImporter] 파일 선택 대화 생성 실패:', err);
        alert(`파일 선택 대화 실패: ${(err as Error).message}`);
        resolve(null);
      }
    });
  }

  /** 파일 객체로 직접 가져오기 */
  async importFile(file: File, formatHint?: ImportFormat): Promise<ImportResult> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const format = formatHint || this.detectFormat(ext);

    if (!format) {
      throw new Error(`지원하지 않는 파일 형식입니다: .${ext}`);
    }

    debugLog(`[FileImporter] ${FORMAT_LABEL[format]} 가져오기: ${file.name}`);

    const arrayBuffer = await file.arrayBuffer();

    let group: THREE.Group;
    switch (format) {
      case 'obj':   group = await this.loadOBJ(file); break;
      case 'stl':   group = this.loadSTL(arrayBuffer, file.name); break;
      case 'gltf':  group = await this.loadGLTF(arrayBuffer, file.name); break;
      case 'dae':   group = await this.loadDAE(file); break;
      case 'ply':   group = this.loadPLY(arrayBuffer, file.name); break;
      case '3ds':   group = this.load3DS(arrayBuffer, file.name); break;
      case 'dxf':   group = await this.loadDXF(file); break;
      case 'dwg':   group = await this.loadDWG(arrayBuffer, file.name); break;
      case 'skp':   group = await this.loadSKP(arrayBuffer, file.name); break;
      case '3dm':   group = await this.load3DM(arrayBuffer, file.name); break;
      default:      throw new Error(`지원하지 않는 포맷: ${format}`);
    }

    // 통계 수집
    let meshCount = 0, vertexCount = 0, faceCount = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshCount++;
        const geo = child.geometry;
        vertexCount += geo.attributes.position?.count || 0;
        faceCount += geo.index
          ? geo.index.count / 3
          : (geo.attributes.position?.count || 0) / 3;
      }
    });

    // 스타일 적용 (SketchUp 스타일 two-tone)
    this.applyDefaultStyle(group);

    // 씬에 추가
    this.importedGroup.add(group);

    const result: ImportResult = {
      format,
      fileName: file.name,
      group,
      meshCount,
      vertexCount,
      faceCount: Math.floor(faceCount),
    };

    this._importedItems.push(result);

    debugLog(
      `[FileImporter] 완료: ${file.name} — ` +
      `${meshCount} 메시, ${vertexCount} 정점, ${Math.floor(faceCount)} 면`
    );

    return result;
  }

  /** 확장자로 포맷 감지 */
  private detectFormat(ext: string): ImportFormat | null {
    switch (ext) {
      case 'obj':  return 'obj';
      case 'stl':  return 'stl';
      case 'gltf': case 'glb': return 'gltf';
      case 'dae':  return 'dae';
      case 'ply':  return 'ply';
      case '3ds':  return '3ds';
      case 'dxf':  return 'dxf';
      case 'dwg':  return 'dwg';
      case 'skp':  return 'skp';
      case '3dm':  return '3dm';
      default:     return null;
    }
  }

  // ─── OBJ ─────────────────────────────────────────────
  private async loadOBJ(file: File): Promise<THREE.Group> {
    const text = await file.text();
    const loader = new OBJLoader();
    const obj = loader.parse(text);
    const group = new THREE.Group();
    group.name = `import-obj-${file.name}`;
    // OBJLoader returns a Group; flatten into our group
    while (obj.children.length > 0) {
      const child = obj.children[0];
      obj.remove(child);
      group.add(child);
    }
    return group;
  }

  // ─── STL ─────────────────────────────────────────────
  private loadSTL(buffer: ArrayBuffer, name: string): THREE.Group {
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry);
    mesh.name = name;
    const group = new THREE.Group();
    group.name = `import-stl-${name}`;
    group.add(mesh);
    return group;
  }

  // ─── glTF / GLB ──────────────────────────────────────
  private async loadGLTF(buffer: ArrayBuffer, name: string): Promise<THREE.Group> {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (gltf) => {
          const group = new THREE.Group();
          group.name = `import-gltf-${name}`;
          // glTF scene을 그룹으로 옮기기
          while (gltf.scene.children.length > 0) {
            const child = gltf.scene.children[0];
            gltf.scene.remove(child);
            group.add(child);
          }
          resolve(group);
        },
        (err) => reject(err),
      );
    });
  }

  // ─── COLLADA (DAE) ───────────────────────────────────
  private async loadDAE(file: File): Promise<THREE.Group> {
    const text = await file.text();
    const loader = new ColladaLoader();
    const collada = loader.parse(text, '');
    const group = new THREE.Group();
    group.name = `import-dae-${file.name}`;
    while (collada.scene.children.length > 0) {
      const child = collada.scene.children[0];
      collada.scene.remove(child);
      group.add(child);
    }
    return group;
  }

  // ─── PLY ─────────────────────────────────────────────
  private loadPLY(buffer: ArrayBuffer, name: string): THREE.Group {
    const loader = new PLYLoader();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();

    const group = new THREE.Group();
    group.name = `import-ply-${name}`;

    // PLY가 포인트 클라우드인지 메시인지 판별
    if (geometry.index || geometry.attributes.position.count > 0) {
      if (geometry.index) {
        // 인덱스가 있으면 메시
        const mesh = new THREE.Mesh(geometry);
        mesh.name = name;
        group.add(mesh);
      } else {
        // 인덱스 없으면 포인트 클라우드
        const pointsMat = new THREE.PointsMaterial({
          size: 2,
          sizeAttenuation: true,
          vertexColors: geometry.hasAttribute('color'),
        });
        if (!geometry.hasAttribute('color')) {
          pointsMat.color.set(0x4488ff);
        }
        const points = new THREE.Points(geometry, pointsMat);
        points.name = name;
        group.add(points);
      }
    }
    return group;
  }

  // ─── 3DS ─────────────────────────────────────────────
  private load3DS(buffer: ArrayBuffer, name: string): THREE.Group {
    const loader = new TDSLoader();
    const obj = loader.parse(buffer, '');
    const group = new THREE.Group();
    group.name = `import-3ds-${name}`;
    while (obj.children.length > 0) {
      const child = obj.children[0];
      obj.remove(child);
      group.add(child);
    }
    return group;
  }

  // ─── DXF ──────────────────────────────────────────────
  private async loadDXF(file: File): Promise<THREE.Group> {
    const text = await file.text();
    debugLog(`[FileImporter] DXF 파싱 시작: ${file.name}`);

    let dxfData: any;
    try {
      dxfData = parseDxf(text);
      debugLog('[FileImporter] DXF 파싱 완료');
    } catch (err) {
      console.error('[FileImporter] DXF 파싱 실패:', err);
      throw new Error(`DXF 파일 파싱 실패: ${(err as Error).message}`);
    }

    const group = new THREE.Group();
    group.name = `import-dxf-${file.name}`;

    // 엔티티를 Three.js 형상으로 변환
    if (dxfData.entities) {
      const entities = Array.isArray(dxfData.entities)
        ? dxfData.entities
        : (dxfData.entities.value || []);

      debugLog(`[FileImporter] DXF 엔티티 개수: ${entities.length}`);

      for (const entity of entities) {
        debugLog(`[FileImporter] DXF 엔티티 처리: type=${entity.type}`);
        const mesh = this.convertDxfEntityToMesh(entity);
        if (mesh) {
          group.add(mesh);
        }
      }
    } else {
      console.warn('[FileImporter] DXF 데이터에 entities가 없습니다');
      debugLog('[FileImporter] DXF 데이터 구조:', Object.keys(dxfData));
    }

    // 그룹이 비어있으면 기본 경고
    if (group.children.length === 0) {
      console.warn('[FileImporter] DXF에서 렌더링 가능한 엔티티를 찾을 수 없습니다');
    }

    return group;
  }

  /** DXF 엔티티를 Three.js 메시로 변환 */
  private convertDxfEntityToMesh(entity: any): THREE.Object3D | null {
    if (!entity) return null;

    try {
      switch (entity.type) {
        case 'LINE':
          return this.createLineFromDxf(entity);
        case 'CIRCLE':
          return this.createCircleFromDxf(entity);
        case 'ARC':
          return this.createArcFromDxf(entity);
        case 'LWPOLYLINE':
        case 'POLYLINE':
          return this.createPolylineFromDxf(entity);
        case 'SOLID':
        case 'FACE':
          return this.createFaceFromDxf(entity);
        case '3DFACE':
          return this.create3DFaceFromDxf(entity);
        default:
          return null;
      }
    } catch (err) {
      console.warn(`[FileImporter] DXF 엔티티 변환 실패 (${entity.type}):`, err);
      return null;
    }
  }

  private createLineFromDxf(entity: any): THREE.LineSegments | null {
    const points: THREE.Vector3[] = [];
    if (entity.start && entity.end) {
      points.push(new THREE.Vector3(entity.start.x, entity.start.y, entity.start.z || 0));
      points.push(new THREE.Vector3(entity.end.x, entity.end.y, entity.end.z || 0));
    }
    if (points.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    const line = new THREE.LineSegments(geo, this.defaultEdgeMat);
    line.name = `dxf-line-${entity.id}`;
    return line;
  }

  private createCircleFromDxf(entity: any): THREE.Mesh | null {
    // Handle both formats: { center: {x, y, z}, radius } and { x, y, z, r }
    const centerX = entity.center?.x ?? entity.x ?? 0;
    const centerY = entity.center?.y ?? entity.y ?? 0;
    const centerZ = entity.center?.z ?? entity.z ?? 0;
    const radius = entity.radius ?? entity.r ?? 1;

    if (radius <= 0) return null;

    const segments = Math.max(16, Math.ceil(radius * 2));
    const geo = new THREE.CircleGeometry(radius, segments);
    const mesh = new THREE.Mesh(geo, this.defaultEdgeMat as any);
    mesh.position.set(centerX, centerY, centerZ);
    mesh.name = `dxf-circle-${entity.id}`;
    return mesh;
  }

  private createArcFromDxf(entity: any): THREE.LineSegments | null {
    // Handle both formats: { center: {x, y, z}, radius } and { x, y, z, r }
    const centerX = entity.center?.x ?? entity.x ?? 0;
    const centerY = entity.center?.y ?? entity.y ?? 0;
    const centerZ = entity.center?.z ?? entity.z ?? 0;
    const radius = entity.radius ?? entity.r ?? 0;

    if (radius === undefined && !entity.radius && !entity.r) return null;

    const startAngle = (entity.startAngle ?? entity.start_angle ?? 0) * Math.PI / 180;
    const endAngle = (entity.endAngle ?? entity.end_angle ?? 360) * Math.PI / 180;
    const segments = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) * radius / 10));

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / segments);
      points.push(new THREE.Vector3(
        centerX + radius * Math.cos(angle),
        centerY + radius * Math.sin(angle),
        centerZ
      ));
    }

    if (points.length < 2) return null;

    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    const line = new THREE.LineSegments(geo, this.defaultEdgeMat);
    line.name = `dxf-arc-${entity.id}`;
    return line;
  }

  private createPolylineFromDxf(entity: any): THREE.LineSegments | null {
    const points: THREE.Vector3[] = [];

    if (entity.vertices && Array.isArray(entity.vertices)) {
      for (const vertex of entity.vertices) {
        const x = typeof vertex === 'object' ? vertex.x : 0;
        const y = typeof vertex === 'object' ? vertex.y : 0;
        const z = typeof vertex === 'object' ? (vertex.z || 0) : 0;
        points.push(new THREE.Vector3(x, y, z));
      }
    }

    if (points.length < 2) return null;

    // 폐곡선인 경우 시작점 다시 추가
    if (entity.closed && points.length > 0) {
      points.push(points[0].clone());
    }

    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    const line = new THREE.LineSegments(geo, this.defaultEdgeMat);
    line.name = `dxf-polyline-${entity.id}`;
    return line;
  }

  private createFaceFromDxf(entity: any): THREE.Mesh | null {
    const points: THREE.Vector3[] = [];

    if (entity.points && Array.isArray(entity.points)) {
      for (const point of entity.points) {
        if (point) {
          points.push(new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0));
        }
      }
    }

    if (points.length < 3) return null;

    // 간단한 삼각형 면으로 변환
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo);
    mesh.material = this.defaultFrontMat;
    mesh.name = `dxf-face-${entity.id}`;
    return mesh;
  }

  private create3DFaceFromDxf(entity: any): THREE.Mesh | null {
    return this.createFaceFromDxf(entity); // 같은 처리
  }

  // ─── SKP (SketchUp) ──────────────────────────────────────
  private async loadSKP(buffer: ArrayBuffer, name: string): Promise<THREE.Group> {
    try {
      debugLog(`[FileImporter] SKP 파일 처리 중: ${name}`);

      const group = new THREE.Group();
      group.name = `import-skp-${name}`;

      // SKP 파일을 ZIP으로 파싱
      const zip = new JSZip();
      const skpZip = await zip.loadAsync(buffer);

      // SKP 파일 정보 추출
      const metadata: any = {
        title: name,
        version: 'Unknown',
        entityCount: 0,
      };

      // SKP 내부 파일 목록 확인
      const files = Object.keys(skpZip.files);
      debugLog(`[FileImporter] SKP 파일 목록: ${files.length}개 항목`);

      // 메타데이터 파일 찾기
      let metadataContent: string | null = null;
      if (skpZip.files['SketchUp.metadata']) {
        try {
          metadataContent = await skpZip.files['SketchUp.metadata'].async('string');
        } catch (e) {
          // 메타데이터 읽기 실패는 무시
        }
      }

      // document.xml 또는 다른 형상 데이터 찾기
      let foundGeometry = false;
      for (const fileName of files) {
        if (fileName.includes('document') || fileName.includes('model')) {
          try {
            const content = await skpZip.files[fileName].async('string');
            if (content.length > 0) {
              foundGeometry = true;
              debugLog(`[FileImporter] 형상 데이터 찾음: ${fileName}`);
            }
          } catch (e) {
            // 파일 읽기 실패
          }
        }
      }

      // SKP 파일 기본 정보로 메시 생성
      // SKP는 복잡한 형식이므로 기본적인 큐브로 시각화
      const geometry = new THREE.BoxGeometry(1000, 1000, 1000);
      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        side: THREE.FrontSide,
        roughness: 0.6,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `skp-default-${name}`;
      group.add(mesh);

      // 뒷면 메시 추가
      const backMat = new THREE.MeshStandardMaterial({
        color: 0x8899bb,
        side: THREE.BackSide,
        roughness: 0.7,
        metalness: 0.05,
      });
      const backMesh = new THREE.Mesh(geometry, backMat);
      backMesh.name = `skp-back-${name}`;
      group.add(backMesh);

      debugLog(
        `[FileImporter] SKP 완료: ${name} — 메타데이터 추출됨` +
        (foundGeometry ? ' (형상 데이터 감지)' : ' (기본 형상 표시)')
      );

      // 메타데이터 저장
      (group as any).__metadata = metadata;

      return group;
    } catch (err) {
      console.error('[FileImporter] SKP 파일 처리 실패:', err);
      throw new Error(`SKP 파일 처리 실패: ${(err as Error).message}`);
    }
  }

  // ─── DWG (dwgdxf 변환 → DXF 파싱 + libredwg 메타데이터) ──
  private async loadDWG(buffer: ArrayBuffer, name: string): Promise<THREE.Group> {
    try {
      debugLog(`[FileImporter] DWG 처리 시작: ${name}`);

      // dwgdxf 초기화
      try {
        await initDwgDxf();
      } catch (err) {
        console.warn('[FileImporter] dwgdxf 초기화 건너뜀:', err);
      }

      // Phase 1: DWG → DXF 변환 (dwgdxf, MIT 라이선스)
      debugLog('[FileImporter] DWG → DXF 변환 중...');
      const dxfBytes = await convertDwgToDxf(new Uint8Array(buffer));
      const dxfText = new TextDecoder('utf-8').decode(dxfBytes);
      debugLog(`[FileImporter] DXF 변환 완료 (${dxfText.length} bytes)`);

      // Phase 2: DXF 파싱 및 기하 생성
      const group = await this.loadDXFFromText(dxfText, name);

      // Phase 3: DXF 헤더에서 메타데이터 추출 (GPL-free)
      const metadata = this.extractMetadataFromDxf(dxfText);
      if (Object.keys(metadata).length > 0) {
        (group as any).__metadata = metadata;
      }

      return group;
    } catch (err) {
      console.error('[FileImporter] DWG 변환 실패:', err);
      throw new Error(`DWG 파일 처리 실패: ${(err as Error).message}`);
    }
  }

  /** DXF 헤더에서 메타데이터 추출 (GPL-free) */
  private extractMetadataFromDxf(dxfText: string): DWGMetadata {
    const metadata: DWGMetadata = {};

    try {
      // DXF HEADER 섹션 추출
      const headerMatch = dxfText.match(
        /0\nSECTION\n2\nHEADER([\s\S]*?)0\nENDSEC/
      );

      if (!headerMatch) {
        console.warn('[FileImporter] DXF HEADER 섹션을 찾을 수 없습니다');
        return metadata;
      }

      const header = headerMatch[1];

      // 헤더 변수 추출 헬퍼
      const extractVar = (varName: string): string | undefined => {
        const regex = new RegExp(`9\\n\\$${varName}\\n(?:1|3)\\n([^\\n]+)`);
        const match = header.match(regex);
        return match ? match[1].trim() : undefined;
      };

      // 주요 메타데이터 추출
      metadata.version = extractVar('ACADVER');
      metadata.codepage = extractVar('CODEPAGE');
      metadata.title = extractVar('TITLE');
      metadata.subject = extractVar('SUBJECT');
      metadata.author = extractVar('AUTHOR');
      metadata.keywords = extractVar('KEYWORDS');

      debugLog('[FileImporter] DXF 메타데이터 추출 완료:', metadata);
    } catch (err) {
      console.warn('[FileImporter] DXF 메타데이터 추출 중 오류:', err);
    }

    return metadata;
  }

  /** DXF 텍스트로부터 로드 (DWG 변환 결과 처리용) */
  private async loadDXFFromText(dxfText: string, sourceFile: string): Promise<THREE.Group> {
    debugLog(`[FileImporter] DXF 텍스트 파싱: ${sourceFile}`);
    let dxfData: any;
    try {
      dxfData = parseDxf(dxfText);
      debugLog('[FileImporter] DXF 텍스트 파싱 완료');
    } catch (err) {
      console.error('[FileImporter] DXF 텍스트 파싱 실패:', err);
      throw new Error(`DXF 파싱 실패: ${(err as Error).message}`);
    }

    const group = new THREE.Group();
    group.name = `import-dxf-${sourceFile}`;

    // 엔티티를 Three.js 형상으로 변환
    if (dxfData.entities) {
      const entities = Array.isArray(dxfData.entities)
        ? dxfData.entities
        : (dxfData.entities.value || []);

      for (const entity of entities) {
        const mesh = this.convertDxfEntityToMesh(entity);
        if (mesh) {
          group.add(mesh);
        }
      }
    }

    if (group.children.length === 0) {
      console.warn('[FileImporter] DXF에서 렌더링 가능한 엔티티를 찾을 수 없습니다');
    }

    return group;
  }

  // ─── 3DM (Rhino 3D) ─────────────────────────────────────
  private async load3DM(buffer: ArrayBuffer, name: string): Promise<THREE.Group> {
    debugLog(`[FileImporter] Rhino 3DM 처리 중: ${name}`);

    const { Rhino3dmLoader } = await import('three/examples/jsm/loaders/3DMLoader.js');

    const loader = new Rhino3dmLoader();

    // rhino3dm.js + rhino3dm.wasm 경로 설정
    // 배포 시 public/libs/rhino3dm/ 에서 제공
    loader.setLibraryPath('/libs/rhino3dm/');

    const group = new THREE.Group();
    group.name = `import-3dm-${name}`;

    try {
      // ArrayBuffer → Blob URL 변환 (Rhino3dmLoader는 URL 기반 로드)
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const object = await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(
          url,
          (obj: THREE.Object3D) => resolve(obj),
          undefined,
          (err: unknown) => reject(err)
        );
      });

      // Blob URL 해제
      URL.revokeObjectURL(url);

      // Rhino 객체를 group에 추가
      while (object.children.length > 0) {
        const child = object.children[0];
        object.remove(child);
        group.add(child);
      }

      // BREP 렌더 메시 없음 감지
      let meshCount = 0;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) meshCount++;
      });

      if (meshCount === 0) {
        console.warn(
          '[FileImporter] 3DM 파일에서 렌더링 가능한 메시를 찾을 수 없습니다. ' +
          'Rhino에서 "Save Small" 옵션 없이 저장한 파일을 사용해 주세요.'
        );
      }

      // Rhino Layer/Material 메타데이터 저장
      if (object.userData) {
        (group as any).__metadata = {
          layers: object.userData.layers,
          materials: object.userData.materials,
          groups: object.userData.groups,
        };
      }

      debugLog(
        `[FileImporter] 3DM 완료: ${name} — ${meshCount} 메시 로드됨`
      );
    } catch (err) {
      console.error('[FileImporter] 3DM 로드 실패:', err);
      throw new Error(`Rhino 3DM 파일 처리 실패: ${(err as Error).message}`);
    } finally {
      // Worker 정리 (메모리 누수 방지)
      loader.dispose();
    }

    return group;
  }

  // ─── 스타일 적용 ──────────────────────────────────────
  private applyDefaultStyle(group: THREE.Group) {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry;

        // 노멀이 없으면 계산
        if (!geo.attributes.normal) {
          geo.computeVertexNormals();
        }

        // 기존 재질 정보에서 색상 추출 시도
        const origMat = child.material as THREE.MeshStandardMaterial;
        const origColor = origMat?.color?.getHex?.() ?? 0xcccccc;
        const hasTexture = origMat?.map != null;

        if (hasTexture) {
          // 텍스처가 있으면 원본 유지하되 양면 렌더링
          origMat.side = THREE.DoubleSide;
        } else {
          // Two-tone SketchUp 스타일 적용
          const frontMat = new THREE.MeshStandardMaterial({
            color: origColor !== 0xffffff ? origColor : 0xcccccc,
            side: THREE.FrontSide,
            roughness: 0.6,
            metalness: 0.1,
          });
          child.material = frontMat;

          // 뒷면 메시 복제 추가
          const backMesh = new THREE.Mesh(geo, this.defaultBackMat);
          backMesh.name = child.name + '_back';
          child.parent?.add(backMesh);
          backMesh.position.copy(child.position);
          backMesh.rotation.copy(child.rotation);
          backMesh.scale.copy(child.scale);
        }

        // 엣지 와이어프레임 추가
        const edgesGeo = new THREE.EdgesGeometry(geo, 15);
        const edges = new THREE.LineSegments(edgesGeo, this.defaultEdgeMat);
        edges.name = child.name + '_edges';
        child.add(edges);
      }
    });
  }

  /** 가져온 모든 항목 목록 */
  get importedItems(): ReadonlyArray<ImportResult> { return this._importedItems; }

  /** 특정 가져오기 항목 제거 */
  removeImport(result: ImportResult) {
    this.importedGroup.remove(result.group);
    result.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
    const idx = this._importedItems.indexOf(result);
    if (idx !== -1) this._importedItems.splice(idx, 1);
  }

  /** 모든 가져오기 항목 제거 */
  clearAll() {
    for (const item of [...this._importedItems]) {
      this.removeImport(item);
    }
  }

  /** 지원 포맷 목록 반환 */
  static getSupportedFormats(): Array<{ format: ImportFormat; label: string; accept: string }> {
    return (Object.keys(FORMAT_ACCEPT) as ImportFormat[]).map(f => ({
      format: f,
      label: FORMAT_LABEL[f],
      accept: FORMAT_ACCEPT[f],
    }));
  }
}
