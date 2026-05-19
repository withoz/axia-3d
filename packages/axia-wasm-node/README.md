# `@axia/wasm-node` — Headless Node WASM Build

ADR-041 P26.4 implementation. AxiA engine WASM bundle compiled with
`wasm-pack --target nodejs` for use by `@axia/mcp-server` and other
headless consumers.

## Build

```bash
cd web
npm run wasm:build:nodejs
```

Output: `dist/` (gitignored, regenerable).

## Verify

```bash
node --input-type=module -e "
import('./dist/axia_wasm.js').then(m => {
  console.log('schema:', m.schema_version());
  console.log('engine:', m.engine_version());
  const eng = new m.AxiaEngine();
  console.log('instance OK');
});
"
```

Expected:
```
schema: 1.0.0
engine: 0.1.0
instance OK
```

## Constraints (ADR-041 P26.4)

- ❌ No `Three.js` / `Toast` / `SnapManager` dependencies
- ❌ No DOM / `window` / `document` access
- ✅ Pure WASM logic — usable in Node, Bun, Deno, Workers

`web_sys::console::log_1` calls are wasm-bindgen polyfilled in Node
(no-op in headless contexts that do not provide `console`).

## Consumers

- `packages/axia-mcp-server` — MCP Surface for AI agents (ADR-041)
- (future) CI tools, headless export pipelines, AXIA file batch processors

## Hole Synthesis Pattern (ADR-101 / LOCKED #40)

**중요**: `draw_rect_as_shape` / `draw_circle_as_shape` 를 두 번 호출해서
"큰 shape 안에 작은 shape" 를 만들면 **두 face 가 coplanar overlapping**
으로 잔존한다 — 자동 hole 합성 안 됨. ADR-021 P7 component-merge 는
*single draw batch* 의 free-edge resolution 단계에서만 fire 하며, headless
경로의 두 sequential 호출 사이엔 작동하지 않는다 (LOCKED #26 P-5e-γ
`replace_last_after_snapshot` single-Undo 정책의 자연 귀결).

진짜 hole 합성은 `mergeCoplanarContaining(outer, inner, angle_tol_deg)`
(ADR-006 C1 Phase F) 명시 호출이 정답 경로:

```js
import { AxiaEngine } from '@axia/wasm-node';

const eng = new AxiaEngine();

// 1. Outer + inner 를 각각 draw
eng.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000); // face 0
eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);            // face 1

// 2. faceArea desc 정렬로 outer/inner 분류
const faces = [...new Set(eng.get_face_map())]
  .map(fid => ({ fid, area: eng.faceArea(fid) }))
  .sort((a, b) => b.area - a.area);
const [outer, inner] = faces;

// 3. 명시 promote
const merged = eng.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
// merged 는 새 face id. faceInnerLoopCount(merged) === 1.

// 4. 검증
console.log(eng.verifyInvariants());        // { valid: true, ... }
console.log(eng.faceInnerLoopCount(merged)); // 1
```

**`.xia` UI 호환 저장**: `exportSnapshotStrict()` 의 raw bincode 는
AxiA UI 의 `Open` 로더 (`JSON.parse`) 와 비호환. UI 에서 열 수 있는
파일이 필요하면 `ProjectSerializer.saveProject` 와 동일한 JSON 봉투로
wrap:

```js
const snapshot = eng.exportSnapshotStrict();
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
fs.writeFileSync('foo.xia', JSON.stringify(project, null, 2));
```

자세한 내용: `docs/adr/101-headless-hole-synthesis-explicit-promote.md`.
일반 원칙: **메타-원칙 #15 — Headless API ≡ Tool Path 의미 동등**
(CLAUDE.md 참조).

## Schema Versioning

`schema_version()` returns the **MCP capability schema version** (semver).
MCP server uses this for handshake compatibility check:

| Engine reports | Server requires | Result |
|---|---|---|
| `1.0.0` | `^1.0.0` | OK |
| `1.5.0` | `^1.0.0` | OK (server tolerates new capabilities) |
| `2.0.0` | `^1.0.0` | **REJECT** — major change, breaking |
| `0.9.0` | `^1.0.0` | **REJECT** — engine too old |

`engine_version()` returns the cargo crate version — for audit log
correlation, NOT for compatibility check.
