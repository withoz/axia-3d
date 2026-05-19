// 2m × 4m 직사각형 면 + r=0.5m 원형 hole 생성 후 .axia 저장
// ADR-021 P7 (Closed Edge Loop Divides Face): 외부 RECT 내부에 그려진
// closed CIRCLE 의 segments → connected inner component → ring+hole 자동 합성.
// 단위: mm (LOCKED #5).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmModule = await import(
  pathToFileURL(resolve(__dirname, '../../packages/axia-wasm-node/dist/axia_wasm.js')).href
);

const { AxiaEngine, schema_version, engine_version } = wasmModule;

console.log('schema:', schema_version());
console.log('engine:', engine_version());

const eng = new AxiaEngine();

// XY 평면 (Z=0) 위 2000mm × 4000mm 직사각형
//   center = (0, 0, 0), normal = +Z, u-axis = +X, width = 2000mm, height = 4000mm
const rectShapeId = eng.draw_rect_as_shape(
  0, 0, 0,        // center
  0, 0, 1,        // normal (+Z)
  1, 0, 0,        // u-axis (+X)
  2000, 4000      // width × height (mm)
);
if (rectShapeId < 0) {
  throw new Error('draw_rect_as_shape failed');
}
console.log('rect shape id:', rectShapeId);

// 동심 원 r=500mm (XY 평면, center 동일)
// draw_circle_as_shape(cx, cy, cz, nx, ny, nz, radius, segments)
// 64 segments → ADR-021 P7 inner connected component → hole 합성
const circShapeId = eng.draw_circle_as_shape(
  0, 0, 0,        // center
  0, 0, 1,        // normal (+Z)
  500,            // radius (mm)
  64              // segments
);
if (circShapeId < 0) {
  throw new Error('draw_circle_as_shape failed');
}
console.log('circle shape id:', circShapeId);

// Invariant 검증 (ADR-007)
console.log('invariants:', eng.verifyInvariants());
console.log('stats:', eng.get_stats());

// `draw_*_as_shape` 는 두 face 를 *독립* 으로 만든다 (rect face + disk face,
// coplanar overlapping). 자동 P7 hole-promote 안 됨 (LOCKED #15 ADR-022 P9
// 의 component-merge 가 same-draw-batch 에서만 fire).
// → `mergeCoplanarContaining(outer, inner, tol)` 로 명시 promote.
//    Phase F (ADR-006 C1): inner 를 outer 의 hole loop 로 흡수.
const faceMap = eng.get_face_map();
const faces = [...new Set(faceMap)].map((fid) => ({ fid, area: eng.faceArea(fid) }));
faces.sort((a, b) => b.area - a.area);
console.log('faces (by area desc):', faces);
const [outer, inner] = faces;

const merged = eng.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
if (merged < 0) {
  throw new Error(`mergeCoplanarContaining failed: ${eng.lastError?.() ?? '(no detail)'}`);
}
console.log(`merged: outer ${outer.fid} ← hole ${inner.fid} = new face ${merged}`);
console.log(`hole loops on merged face ${merged}:`, eng.faceInnerLoopCount(merged));
console.log(`merged face area: ${eng.faceArea(merged).toFixed(0)} mm² (expect ~${(8_000_000 - 784_137).toFixed(0)} = ring)`);
console.log('after merge:', eng.get_stats());
console.log('invariants:', eng.verifyInvariants());

// .xia 저장 — UI ProjectSerializer 와 동일한 JSON 봉투 포맷.
// (raw bincode snapshot 그대로 저장하면 UI 의 JSON.parse 가 실패함)
const snapshot = eng.exportSnapshotStrict();
if (!snapshot || snapshot.length === 0) {
  const err = eng.lastError?.() ?? '(no detail)';
  throw new Error(`exportSnapshotStrict failed: ${err}`);
}

const project = {
  format: 'xia',
  version: '1.0.0',
  engine: 'AXiA 3D',
  created: new Date().toISOString(),
  units: { unit: 'mm', precision: 2 },
  camera: null,
  style: null,
  mesh: Buffer.from(snapshot).toString('base64'),
};

const outDir = resolve(__dirname, '../demo-output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'rect-2x4m-with-hole-r0.5m.xia');
writeFileSync(outPath, JSON.stringify(project, null, 2));
console.log(`saved: ${outPath} (snapshot=${snapshot.length} B, b64=${project.mesh.length} B)`);
