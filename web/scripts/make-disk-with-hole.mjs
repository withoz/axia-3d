// 큰 원 (r=2m) face + 동심 작은 원 (r=0.5m) hole.
// ADR-006 C1 Phase F: mergeCoplanarContaining 으로 inner 를 outer 의 hole loop 로 promote.
// 단위: mm (LOCKED #5).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmModule = await import(
  pathToFileURL(resolve(__dirname, '../../packages/axia-wasm-node/dist/axia_wasm.js')).href
);
const { AxiaEngine } = wasmModule;

const eng = new AxiaEngine();

// 큰 원: 동심 (원점), XY 평면, r=2000mm, 128-segment
const outerId = eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 2000, 128);
if (outerId < 0) throw new Error('outer circle failed');

// 작은 원: 동심, r=500mm, 64-segment
const innerId = eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);
if (innerId < 0) throw new Error('inner circle failed');

console.log('before merge:', eng.get_stats());

// 두 face 식별 (면적 desc)
const faceIds = [...new Set(eng.get_face_map())];
const faces = faceIds.map((fid) => ({ fid, area: eng.faceArea(fid) }));
faces.sort((a, b) => b.area - a.area);
console.log('faces:', faces);
const [outer, inner] = faces;

// Inner → hole loop of outer
const merged = eng.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
if (merged < 0) {
  throw new Error(`mergeCoplanarContaining failed: ${eng.lastError?.() ?? '(no detail)'}`);
}
console.log(`merged: outer ${outer.fid} ← hole ${inner.fid} = new face ${merged}`);
console.log(`hole loops on face ${merged}:`, eng.faceInnerLoopCount(merged));
console.log('after merge:', eng.get_stats());
console.log('invariants:', eng.verifyInvariants());

// .xia JSON 봉투
const snapshot = eng.exportSnapshotStrict();
if (!snapshot?.length) {
  throw new Error(`exportSnapshotStrict failed: ${eng.lastError?.() ?? '(no detail)'}`);
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
const outPath = resolve(outDir, 'disk-r2m-with-hole-r0.5m.xia');
writeFileSync(outPath, JSON.stringify(project, null, 2));
console.log(`saved: ${outPath} (snapshot=${snapshot.length} B)`);
