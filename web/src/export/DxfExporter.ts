/**
 * DxfExporter — WASM 메시를 DXF로 변환
 *
 * 역할:
 *   1. WASM 엔진의 DCEL 메시 읽기
 *   2. Three.js 뷰포트의 기하 추출
 *   3. DxfWriter로 DXF 파일 생성
 */

import * as THREE from 'three';
import { DxfWriter } from './DxfWriter';
import { debugLog } from '../utils/debug';

export interface ExportOptions {
  name?: string;
  layers?: boolean;
  colors?: boolean;
  precision?: number;
}

export class DxfExporter {
  private writer: DxfWriter;

  constructor() {
    this.writer = new DxfWriter();
  }

  /**
   * Three.js Scene에서 기하 추출하여 DXF 생성
   */
  exportScene(scene: THREE.Scene, options: ExportOptions = {}): string {
    const { precision = 1 } = options;

    debugLog('[DxfExporter] DXF 내보내기 시작...');

    // 씬의 모든 메시 순회
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.extractMesh(object, precision);
      } else if (object instanceof THREE.LineSegments) {
        this.extractLineSegments(object, precision);
      } else if (object instanceof THREE.Points) {
        this.extractPoints(object, precision);
      }
    });

    const dxfContent = this.writer.export();
    debugLog('[DxfExporter] DXF 내보내기 완료');

    return dxfContent;
  }

  /**
   * 단일 메시에서 기하 추출
   */
  private extractMesh(mesh: THREE.Mesh, precision: number): void {
    const geometry = mesh.geometry;

    if (!(geometry instanceof THREE.BufferGeometry)) {
      console.warn('[DxfExporter] BufferGeometry만 지원합니다');
      return;
    }

    const positions = geometry.getAttribute('position');
    if (!positions) return;

    const posArray = positions.array as Float32Array;
    const index = geometry.getIndex();

    // 레이어 이름 설정
    const layerName = mesh.name || `Mesh_${Math.random().toString(36).substr(2, 9)}`;

    if (index) {
      // 인덱스가 있는 경우
      const indexArray = index.array as Uint32Array | Uint16Array;

      for (let i = 0; i < indexArray.length; i += 3) {
        const i1 = indexArray[i] * 3;
        const i2 = indexArray[i + 1] * 3;
        const i3 = indexArray[i + 2] * 3;

        const v1 = {
          x: this.round(posArray[i1], precision),
          y: this.round(posArray[i1 + 1], precision),
          z: this.round(posArray[i1 + 2], precision),
        };

        const v2 = {
          x: this.round(posArray[i2], precision),
          y: this.round(posArray[i2 + 1], precision),
          z: this.round(posArray[i2 + 2], precision),
        };

        const v3 = {
          x: this.round(posArray[i3], precision),
          y: this.round(posArray[i3 + 1], precision),
          z: this.round(posArray[i3 + 2], precision),
        };

        // 3각형을 FACE로 추가
        this.writer.addFace([v1, v2, v3], { layer: layerName });
      }
    } else {
      // 인덱스가 없는 경우
      for (let i = 0; i < posArray.length; i += 9) {
        const v1 = {
          x: this.round(posArray[i], precision),
          y: this.round(posArray[i + 1], precision),
          z: this.round(posArray[i + 2], precision),
        };

        const v2 = {
          x: this.round(posArray[i + 3], precision),
          y: this.round(posArray[i + 4], precision),
          z: this.round(posArray[i + 5], precision),
        };

        const v3 = {
          x: this.round(posArray[i + 6], precision),
          y: this.round(posArray[i + 7], precision),
          z: this.round(posArray[i + 8], precision),
        };

        this.writer.addFace([v1, v2, v3], { layer: layerName });
      }
    }

    debugLog(
      `[DxfExporter] 메시 '${layerName}' 추출 완료: ${Math.floor(posArray.length / 9)} 삼각형`
    );
  }

  /**
   * LineSegments에서 선 추출
   */
  private extractLineSegments(lines: THREE.LineSegments, precision: number): void {
    const geometry = lines.geometry;

    if (!(geometry instanceof THREE.BufferGeometry)) {
      return;
    }

    const positions = geometry.getAttribute('position');
    if (!positions) return;

    const posArray = positions.array as Float32Array;
    const layerName = lines.name || 'Lines';

    // 2개씩 점을 묶어서 선 생성
    for (let i = 0; i < posArray.length; i += 6) {
      const start = {
        x: this.round(posArray[i], precision),
        y: this.round(posArray[i + 1], precision),
        z: this.round(posArray[i + 2], precision),
      };

      const end = {
        x: this.round(posArray[i + 3], precision),
        y: this.round(posArray[i + 4], precision),
        z: this.round(posArray[i + 5], precision),
      };

      this.writer.addLine(start, end, { layer: layerName });
    }

    debugLog(`[DxfExporter] 선 '${layerName}' 추출 완료: ${posArray.length / 6} 선`);
  }

  /**
   * Points에서 점 추출 (원으로 표현)
   */
  private extractPoints(points: THREE.Points, precision: number): void {
    const geometry = points.geometry;

    if (!(geometry instanceof THREE.BufferGeometry)) {
      return;
    }

    const positions = geometry.getAttribute('position');
    if (!positions) return;

    const posArray = positions.array as Float32Array;
    const layerName = points.name || 'Points';

    // 각 점을 작은 원으로 표현
    for (let i = 0; i < posArray.length; i += 3) {
      const center = {
        x: this.round(posArray[i], precision),
        y: this.round(posArray[i + 1], precision),
        z: this.round(posArray[i + 2], precision),
      };

      // 반지름 1의 작은 원
      this.writer.addCircle(center, 1, { layer: layerName });
    }

    debugLog(
      `[DxfExporter] 점 '${layerName}' 추출 완료: ${posArray.length / 3} 점`
    );
  }

  /**
   * 정밀도에 맞춰 숫자 반올림
   */
  private round(value: number, precision: number): number {
    if (precision <= 0) return Math.round(value);
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * DXF 파일 다운로드
   */
  static downloadDxf(
    scene: THREE.Scene,
    filename: string = 'export.dxf',
    options: ExportOptions = {}
  ): void {
    const exporter = new DxfExporter();
    const dxfContent = exporter.exportScene(scene, options);

    // Blob 생성
    const blob = new Blob([dxfContent], { type: 'application/octet-stream' });

    // 다운로드 링크 생성 및 클릭
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    debugLog(`[DxfExporter] 다운로드 완료: ${filename}`);
  }
}
