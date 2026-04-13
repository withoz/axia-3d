/**
 * DxfWriter — AXiA 3D 자체 DXF Export 엔진
 *
 * MIT 라이선스 - 상용 소프트웨어에 안전하게 포함 가능
 * 외부 GPL 라이브러리 의존 없음
 *
 * 지원 엔티티:
 *   - LINE (직선)
 *   - CIRCLE (원)
 *   - ARC (호)
 *   - LWPOLYLINE (경량 폴리라인)
 *   - SOLID (솔리드 면)
 *   - FACE (3D 면)
 */

export interface Vector3 {
  x: number;
  y: number;
  z?: number;
}

export interface DxfEntity {
  type: string;
  layer?: string;
  color?: number;
  [key: string]: any;
}

export interface DxfLineEntity extends DxfEntity {
  type: 'LINE';
  start: Vector3;
  end: Vector3;
}

export interface DxfCircleEntity extends DxfEntity {
  type: 'CIRCLE';
  center: Vector3;
  radius: number;
}

export interface DxfArcEntity extends DxfEntity {
  type: 'ARC';
  center: Vector3;
  radius: number;
  startAngle: number; // 도 단위
  endAngle: number;   // 도 단위
}

export interface DxfPolylineEntity extends DxfEntity {
  type: 'LWPOLYLINE';
  points: Vector3[];
  closed?: boolean;
}

export interface DxfFaceEntity extends DxfEntity {
  type: 'FACE';
  vertices: Vector3[]; // 3개 또는 4개
}

/**
 * DXF 파일 생성기
 *
 * 사용 예시:
 * ```typescript
 * const writer = new DxfWriter();
 * writer.addLine({ x: 0, y: 0 }, { x: 100, y: 100 });
 * writer.addCircle({ x: 50, y: 50 }, 25);
 * const dxfString = writer.export();
 * downloadFile(dxfString, 'model.dxf');
 * ```
 */
export class DxfWriter {
  private entities: DxfEntity[] = [];
  private layers: Set<string> = new Set();
  private entityCount = 0;

  /** 직선 추가 */
  addLine(
    start: Vector3,
    end: Vector3,
    options: Partial<DxfLineEntity> = {}
  ): this {
    const entity: DxfLineEntity = {
      type: 'LINE',
      layer: 'Default',
      color: 256,
      ...options,
      start,
      end,
    };
    this.entities.push(entity);
    this.layers.add(entity.layer || 'Default');
    return this;
  }

  /** 원 추가 */
  addCircle(
    center: Vector3,
    radius: number,
    options: Partial<DxfCircleEntity> = {}
  ): this {
    if (radius <= 0) {
      console.warn('[DxfWriter] 원의 반지름이 0 이하입니다');
      return this;
    }

    const entity: DxfCircleEntity = {
      type: 'CIRCLE',
      layer: 'Default',
      color: 256,
      ...options,
      center,
      radius,
    };
    this.entities.push(entity);
    this.layers.add(entity.layer || 'Default');
    return this;
  }

  /** 호 추가 */
  addArc(
    center: Vector3,
    radius: number,
    startAngle: number,
    endAngle: number,
    options: Partial<DxfArcEntity> = {}
  ): this {
    if (radius <= 0) {
      console.warn('[DxfWriter] 호의 반지름이 0 이하입니다');
      return this;
    }

    const entity: DxfArcEntity = {
      type: 'ARC',
      layer: 'Default',
      color: 256,
      ...options,
      center,
      radius,
      startAngle,
      endAngle,
    };
    this.entities.push(entity);
    this.layers.add(entity.layer || 'Default');
    return this;
  }

  /** 폴리라인 추가 */
  addPolyline(
    points: Vector3[],
    options: Partial<DxfPolylineEntity> = {}
  ): this {
    if (points.length < 2) {
      console.warn('[DxfWriter] 폴리라인은 최소 2개의 점이 필요합니다');
      return this;
    }

    const entity: DxfPolylineEntity = {
      type: 'LWPOLYLINE',
      layer: 'Default',
      color: 256,
      ...options,
      points,
    };
    this.entities.push(entity);
    this.layers.add(entity.layer || 'Default');
    return this;
  }

  /** 면(face) 추가 */
  addFace(
    vertices: Vector3[],
    options: Partial<DxfFaceEntity> = {}
  ): this {
    if (vertices.length < 3 || vertices.length > 4) {
      console.warn('[DxfWriter] 면은 3개 또는 4개의 정점이 필요합니다');
      return this;
    }

    const entity: DxfFaceEntity = {
      type: 'FACE',
      layer: 'Default',
      color: 256,
      ...options,
      vertices,
    };
    this.entities.push(entity);
    this.layers.add(entity.layer || 'Default');
    return this;
  }

  /** 모든 엔티티 제거 */
  clear(): this {
    this.entities = [];
    this.layers.clear();
    this.entityCount = 0;
    return this;
  }

  /** DXF 형식으로 내보내기 */
  export(): string {
    let dxf = '';

    // HEADER 섹션
    dxf += this.generateHeader();

    // TABLES 섹션 (레이어 정의)
    dxf += this.generateTables();

    // ENTITIES 섹션
    dxf += this.generateEntities();

    // EOF
    dxf += '0\nEOF\n';

    return dxf;
  }

  /** 헤더 섹션 생성 */
  private generateHeader(): string {
    let header = '0\nSECTION\n2\nHEADER\n';

    // AutoCAD 버전
    header += '9\n$ACADVER\n1\nAC1015\n'; // R13

    // 단위 (밀리미터)
    header += '9\n$INSUNITS\n70\n4\n';

    // 그리드 크기
    header += '9\n$GRIDUNIT\n10\n10.0\n20\n10.0\n';

    // 스냅 크기
    header += '9\n$SNAPUNIT\n10\n1.0\n20\n1.0\n';

    // 범위 (자동 계산)
    const [min, max] = this.calculateBounds();
    header += `9\n$EXTMIN\n10\n${min.x}\n20\n${min.y}\n30\n${min.z}\n`;
    header += `9\n$EXTMAX\n10\n${max.x}\n20\n${max.y}\n30\n${max.z}\n`;

    header += '0\nENDSEC\n';
    return header;
  }

  /** 테이블 섹션 생성 (레이어 정의) */
  private generateTables(): string {
    let tables = '0\nSECTION\n2\nTABLES\n';

    // 레이어 테이블
    tables += '0\nTABLE\n2\nLAYER\n70\n' + (this.layers.size + 1) + '\n';

    // 기본 레이어 (0)
    tables += this.generateLayerEntry('0', 7); // 흰색

    // 사용자 정의 레이어
    const layerColors = new Map([
      ['Default', 256], // 색상 기본값
      ['Grid', 3],      // 녹색
      ['Geometry', 1],  // 빨강색
    ]);

    this.layers.forEach((layer) => {
      const color = layerColors.get(layer) || 256;
      tables += this.generateLayerEntry(layer, color);
    });

    tables += '0\nENDTABLE\n';
    tables += '0\nENDSEC\n';

    return tables;
  }

  /** 레이어 항목 생성 */
  private generateLayerEntry(name: string, color: number): string {
    let entry = '0\nLAYER\n';
    entry += '2\n' + name + '\n';        // 레이어 이름
    entry += '70\n0\n';                   // 플래그
    entry += '62\n' + color + '\n';      // 색상 번호
    entry += '6\nCONTINUOUS\n';          // 선 타입
    return entry;
  }

  /** 엔티티 섹션 생성 */
  private generateEntities(): string {
    let entities = '0\nSECTION\n2\nENTITIES\n';

    this.entityCount = 0;
    for (const entity of this.entities) {
      entities += this.generateEntity(entity);
    }

    entities += '0\nENDSEC\n';
    return entities;
  }

  /** 단일 엔티티 생성 */
  private generateEntity(entity: DxfEntity): string {
    const layer = entity.layer || 'Default';
    const color = entity.color || 256;

    let output = '';
    output += `0\n${entity.type}\n`;
    output += `8\n${layer}\n`;      // 레이어
    output += `62\n${color}\n`;     // 색상

    switch (entity.type) {
      case 'LINE':
        return output + this.generateLineData(entity as DxfLineEntity);

      case 'CIRCLE':
        return output + this.generateCircleData(entity as DxfCircleEntity);

      case 'ARC':
        return output + this.generateArcData(entity as DxfArcEntity);

      case 'LWPOLYLINE':
        return output + this.generatePolylineData(entity as DxfPolylineEntity);

      case 'FACE':
        return output + this.generateFaceData(entity as DxfFaceEntity);

      default:
        console.warn(`[DxfWriter] 지원하지 않는 엔티티 타입: ${entity.type}`);
        return '';
    }
  }

  /** LINE 데이터 생성 */
  private generateLineData(entity: DxfLineEntity): string {
    const { start, end } = entity;
    let data = '';
    data += `10\n${this.formatNumber(start.x)}\n`;
    data += `20\n${this.formatNumber(start.y)}\n`;
    data += `30\n${this.formatNumber(start.z || 0)}\n`;
    data += `11\n${this.formatNumber(end.x)}\n`;
    data += `21\n${this.formatNumber(end.y)}\n`;
    data += `31\n${this.formatNumber(end.z || 0)}\n`;
    return data;
  }

  /** CIRCLE 데이터 생성 */
  private generateCircleData(entity: DxfCircleEntity): string {
    const { center, radius } = entity;
    let data = '';
    data += `10\n${this.formatNumber(center.x)}\n`;
    data += `20\n${this.formatNumber(center.y)}\n`;
    data += `30\n${this.formatNumber(center.z || 0)}\n`;
    data += `40\n${this.formatNumber(radius)}\n`;
    return data;
  }

  /** ARC 데이터 생성 */
  private generateArcData(entity: DxfArcEntity): string {
    const { center, radius, startAngle, endAngle } = entity;
    let data = '';
    data += `10\n${this.formatNumber(center.x)}\n`;
    data += `20\n${this.formatNumber(center.y)}\n`;
    data += `30\n${this.formatNumber(center.z || 0)}\n`;
    data += `40\n${this.formatNumber(radius)}\n`;
    data += `50\n${this.formatNumber(startAngle)}\n`;
    data += `51\n${this.formatNumber(endAngle)}\n`;
    return data;
  }

  /** LWPOLYLINE 데이터 생성 */
  private generatePolylineData(entity: DxfPolylineEntity): string {
    const { points, closed } = entity;
    let data = '';
    data += `90\n${points.length}\n`;                  // 정점 개수
    data += `70\n${closed ? 1 : 0}\n`;                 // 닫힘 플래그

    for (const point of points) {
      data += `10\n${this.formatNumber(point.x)}\n`;
      data += `20\n${this.formatNumber(point.y)}\n`;
    }

    return data;
  }

  /** FACE 데이터 생성 */
  private generateFaceData(entity: DxfFaceEntity): string {
    const { vertices } = entity;
    let data = '';

    for (let i = 0; i < vertices.length; i++) {
      const vertex = vertices[i];
      const x10 = 10 + i;
      const x20 = 20 + i;
      const x30 = 30 + i;

      data += `${x10}\n${this.formatNumber(vertex.x)}\n`;
      data += `${x20}\n${this.formatNumber(vertex.y)}\n`;
      data += `${x30}\n${this.formatNumber(vertex.z || 0)}\n`;
    }

    // 4개 정점이 아니면 마지막 정점을 반복
    if (vertices.length === 3) {
      const v = vertices[2];
      data += `13\n${this.formatNumber(v.x)}\n`;
      data += `23\n${this.formatNumber(v.y)}\n`;
      data += `33\n${this.formatNumber(v.z || 0)}\n`;
    }

    return data;
  }

  /** 범위 계산 */
  private calculateBounds(): [Vector3, Vector3] {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (const entity of this.entities) {
      const points = this.extractPointsFromEntity(entity);
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        minZ = Math.min(minZ, point.z || 0);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        maxZ = Math.max(maxZ, point.z || 0);
      }
    }

    if (!isFinite(minX)) {
      return [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 100, z: 0 },
      ];
    }

    return [
      { x: minX, y: minY, z: minZ },
      { x: maxX, y: maxY, z: maxZ },
    ];
  }

  /** 엔티티에서 모든 점 추출 */
  private extractPointsFromEntity(entity: DxfEntity): Vector3[] {
    const points: Vector3[] = [];

    switch (entity.type) {
      case 'LINE': {
        const line = entity as DxfLineEntity;
        points.push(line.start, line.end);
        break;
      }

      case 'CIRCLE': {
        const circle = entity as DxfCircleEntity;
        points.push(circle.center);
        break;
      }

      case 'ARC': {
        const arc = entity as DxfArcEntity;
        points.push(arc.center);
        break;
      }

      case 'LWPOLYLINE': {
        const poly = entity as DxfPolylineEntity;
        points.push(...poly.points);
        break;
      }

      case 'FACE': {
        const face = entity as DxfFaceEntity;
        points.push(...face.vertices);
        break;
      }
    }

    return points;
  }

  /** 숫자 포맷팅 (소수점 제거) */
  private formatNumber(num: number): string {
    return num.toFixed(1).replace(/\.0$/, '');
  }
}
