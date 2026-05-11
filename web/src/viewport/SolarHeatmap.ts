/**
 * SolarHeatmap — 누적 그림자 기반 일사 분석 오버레이.
 *
 * 하루 또는 1년간의 여러 시간대에 대해 projected shadow를 샘플링하고, 각
 * 지점이 그늘이었던 "비율"을 2D heatmap으로 지면에 오버레이.
 *
 * 알고리즘 (MVP):
 *   1. 사용자가 헤드맵 모드를 시작하면:
 *      - Grid 해상도 N × N (기본 50×50) 지면 XZ cells 준비
 *      - 샘플 시간 24개(1시간 간격) 또는 12개(2시간 간격)
 *   2. 각 시간 t에 대해:
 *      - sun_dir 계산 → mesh.compute_ground_projected_shadows
 *      - 결과 triangles를 2D XZ로 투영
 *      - 각 cell에 대해 "shadow가 겹치는가" 판정 → shaded_count++
 *   3. 결과:
 *      - shade_ratio[cell] = shaded_count / total_samples
 *      - 색상 매핑: 0.0 (완전 햇빛) → 노랑, 1.0 (완전 그늘) → 검정
 *   4. Three.js plane geometry에 vertex color로 적용, 지면 바로 위에 오버레이
 *
 * UI: Solar Study 패널에서 "Heatmap 생성" 버튼 → 프로그레스 후 표시/숨김 토글.
 */

import * as THREE from 'three';
import type { Viewport } from './Viewport';
import type { WasmBridge } from '../bridge/WasmBridge';

interface HeatmapConfig {
  resolution: number;   // N×N grid
  sizeMM: number;       // 지면 heatmap의 한 변 길이 (mm)
  timeSamples: number;  // 하루 샘플 개수
  lat: number;
  lon: number;
  dateISO: string;      // YYYY-MM-DD
}

export class SolarHeatmap {
  private viewport: Viewport;
  private bridge: WasmBridge;
  private mesh: THREE.Mesh | null = null;

  constructor(viewport: Viewport, bridge: WasmBridge) {
    this.viewport = viewport;
    this.bridge = bridge;
  }

  /** 누적 계산 + 지면 위 시각화 mesh 생성. */
  async generate(cfg: HeatmapConfig): Promise<void> {
    const { resolution: N, sizeMM: S, timeSamples: T } = cfg;

    // 각 cell의 그늘 count
    const count = new Uint16Array(N * N);

    const halfS = S / 2;
    const cellSize = S / N;

    // 시간 샘플: 6h ~ 18h 균등 분할.
    const hours: number[] = [];
    for (let i = 0; i < T; i++) {
      hours.push(6 + (12 * i) / (T - 1));
    }

    // 각 시간에서 sun 방향 계산 + shadow 추출.
    for (const h of hours) {
      const sun = computeSunXYZ(cfg.lat, cfg.lon, cfg.dateISO, h);
      if (sun.elevation <= 0) continue;
      const sunDir = sunAzElToDir(sun.azimuth, sun.elevation);

      const tris = this.bridge.computeGroundProjectedShadows(sunDir.x, sunDir.y, sunDir.z);
      if (!tris || tris.length === 0) continue;

      // 각 삼각형을 2D(XZ)로 사영하고 grid cell 인덱스에 대해 점유 기록.
      // 단순화: 삼각형의 bounding box 내 모든 cell에 대해 centroid-in-tri 테스트.
      for (let i = 0; i < tris.length; i += 9) {
        // Only ground-level triangles (y ≈ 0.5).
        if (tris[i + 1] > 1.5) continue;

        const x0 = tris[i + 0], z0 = tris[i + 2];
        const x1 = tris[i + 3], z1 = tris[i + 5];
        const x2 = tris[i + 6], z2 = tris[i + 8];

        const minX = Math.min(x0, x1, x2);
        const maxX = Math.max(x0, x1, x2);
        const minZ = Math.min(z0, z1, z2);
        const maxZ = Math.max(z0, z1, z2);

        const i0 = Math.max(0, Math.floor((minX + halfS) / cellSize));
        const i1 = Math.min(N - 1, Math.floor((maxX + halfS) / cellSize));
        const j0 = Math.max(0, Math.floor((minZ + halfS) / cellSize));
        const j1 = Math.min(N - 1, Math.floor((maxZ + halfS) / cellSize));

        for (let j = j0; j <= j1; j++) {
          for (let k = i0; k <= i1; k++) {
            const cx = (k + 0.5) * cellSize - halfS;
            const cz = (j + 0.5) * cellSize - halfS;
            if (pointInTri(cx, cz, x0, z0, x1, z1, x2, z2)) {
              count[j * N + k] += 1;
            }
          }
        }
      }
    }

    // Build colored plane mesh.
    const geo = new THREE.PlaneGeometry(S, S, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);  // XZ plane
    const colors = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const shadeRatio = count[j * N + k] / hours.length;
        // Yellow (sunny) → dark blue (shaded) colormap.
        const r = 1.0 - shadeRatio * 0.9;
        const g = 1.0 - shadeRatio * 0.7;
        const b = 0.3 + shadeRatio * 0.3;
        const idx = (j * N + k) * 3;
        colors[idx] = r;
        colors[idx + 1] = g;
        colors[idx + 2] = b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.remove();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'solar-heatmap';
    this.mesh.position.y = 0.2;  // 지면 바로 위
    this.mesh.userData.noPick = true;
    this.mesh.renderOrder = -3;
    this.viewport.scene.add(this.mesh);
  }

  remove(): void {
    if (this.mesh) {
      this.viewport.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }

  isActive(): boolean { return this.mesh !== null; }
}

// ─── helpers ──────────────────────────────────────────────────────

function pointInTri(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function computeSunXYZ(
  lat: number, lon: number, dateISO: string, hourLocal: number,
): { azimuth: number; elevation: number } {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const doy = Math.floor((dt.getTime() - jan1.getTime()) / 86400000) + 1;
  const gamma = 2 * Math.PI * (doy - 1 + (hourLocal - 12) / 24) / 365;
  const delta =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hourAngle = Math.PI / 12 * (hourLocal - 12);
  const latRad = lat * Math.PI / 180;
  const sinEl = Math.sin(latRad) * Math.sin(delta)
              + Math.cos(latRad) * Math.cos(delta) * Math.cos(hourAngle);
  const elRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azRad = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(delta) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourAngle),
  );
  let azDeg = (azRad * 180 / Math.PI + 180) % 360;
  if (azDeg < 0) azDeg += 360;
  void lon;  // 현재 lon은 timezone meridian offset 미적용 (MVP)
  return { azimuth: azDeg, elevation: elRad * 180 / Math.PI };
}

function sunAzElToDir(azDeg: number, elDeg: number): THREE.Vector3 {
  const azRad = azDeg * Math.PI / 180;
  const elRad = elDeg * Math.PI / 180;
  // sun travel direction (sun → ground) = -sun_position_direction.
  const dx = -Math.sin(azRad) * Math.cos(elRad);
  const dy = -Math.sin(elRad);
  const dz = -Math.cos(azRad) * Math.cos(elRad);
  return new THREE.Vector3(dx, dy, dz).normalize();
}
